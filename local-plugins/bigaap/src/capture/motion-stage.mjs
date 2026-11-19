/**
 * M2b — the live motion-observation stage.
 *
 * Phase 5.12 records what stylesheets DECLARE. M2a (`motion-observe.mjs`)
 * supplies the protocol for turning two timestamped samples into an observation
 * and, separately, for deciding whether a cause may be claimed. This module is
 * the part that actually goes and looks: it drives a capture session through a
 * fixed sequence of samples and writes the artifact those two modules describe.
 *
 * ## Why this exists at all
 *
 * Before it, the analyzer could only ever report motion as unknown, because
 * nothing ran the protocol against a live page. For a reference whose whole
 * character is its opening animation, "motion unknown" is the least useful true
 * sentence available. Looking and finding nothing is a different, better answer
 * than never looking — and the artifact distinguishes them.
 *
 * ## The control, and what licenses a page-load claim
 *
 * A causal claim needs a control: a comparable interval in which the action did
 * not happen. Page load is awkward here, because you cannot withhold it — by
 * the time you are sampling, it has already happened.
 *
 * The control used is the SETTLED-TO-STABLE interval. If an element changed
 * between the cold frame and the settled frame, and then did not change over a
 * comparable interval afterwards, the change was bounded to the period after
 * load and stopped on its own. That is what an entrance animation does, and it
 * is what an element in continuous motion does not: a looping animation keeps
 * changing and is refused a page-load claim, correctly.
 *
 * This is a real control and it is a WEAK one. It cannot separate "animated on
 * load" from "animated once, early, for an unrelated reason". So the claim it
 * licenses is `page-load`, never `delayed-page-load`, and the artifact records
 * which interval acted as the control so a reader can judge it.
 *
 * ## What is not attempted
 *
 * Hover, focus and click belong to the interaction stage, which has its own
 * safety gate; this stage records them as not-attempted rather than reaching
 * across that boundary. Reduced motion is attempted only when the driver says
 * it supports the emulation, and its absence is recorded as unsupported with a
 * reason — never as "reduced motion makes no difference".
 */

import {
  MOTION_CONTRACT_VERSION, CLAIM_TYPE, TRIGGER_CLASSIFICATION,
  CONTROL_RESULT, diffStates, emptyArtifact, resetObservationIds, nextObservationId
} from "./motion-observe.mjs";

/** Versions the additive stage sections, independently of the M2a contract. */
export const MOTION_STAGE_VERSION = "1";

/**
 * The sampling schedule.
 *
 * `settleMs` is where an entrance animation is expected to have finished;
 * `stableMs` is far enough past it that a still-changing element is visibly
 * still changing. The gap between them is the control interval, and it is
 * deliberately no shorter than the interval it controls for.
 */
export const DEFAULT_MOTION_BUDGET = Object.freeze({
  coldFrameMs: 0,
  settleMs: 1200,
  stableMs: 2600,
  scrollCheckpoints: 3,
  maxTotalMs: 25000,
  geometryTolerancePx: 1,
  maxParticipants: 40
});

/** Properties sampled per element. Fixed, so two frames are comparable. */
export const MOTION_SAMPLED_PROPERTIES = Object.freeze([
  "opacity", "transform", "visibility", "display",
  "clipPath", "filter", "backdropFilter", "color", "backgroundColor"
]);

/* ───────────────────────── the in-page sampler ──────────────────────────── */

/**
 * Runs inside the page. Returns one frame: every candidate element's box,
 * computed style subset, and animation/transition declarations.
 *
 * Written as a plain function body because it is serialised to the browser; it
 * closes over nothing and reads no module scope.
 */
export const MOTION_FRAME = () => {
  const path = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 12) {
      const parent = node.parentElement;
      if (!parent) break;
      const idx = Array.prototype.indexOf.call(parent.children, node) + 1;
      parts.unshift(node.tagName.toLowerCase() + ":nth-child(" + idx + ")");
      node = parent;
    }
    return parts.join(">");
  };

  const out = [];
  const all = document.querySelectorAll("body *");
  const limit = Math.min(all.length, 1500);
  for (let i = 0; i < limit; i++) {
    const el = all[i];
    const box = el.getBoundingClientRect();
    /* Zero-area elements cannot show a visual change worth reporting, and
     * including them buries the ones that can. */
    if (box.width < 2 || box.height < 2) continue;
    const cs = getComputedStyle(el);
    out.push({
      domPath: path(el),
      tag: el.tagName.toLowerCase(),
      boundingBox: { x: box.x + window.scrollX, y: box.y + window.scrollY, width: box.width, height: box.height },
      opacity: cs.opacity,
      transform: cs.transform,
      visibility: cs.visibility,
      display: cs.display,
      clipPath: cs.clipPath,
      filter: cs.filter,
      backdropFilter: cs.backdropFilter,
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      declarations: {
        animationName: cs.animationName === "none" ? null : cs.animationName,
        duration: cs.animationDuration === "0s" ? null : cs.animationDuration,
        delay: cs.animationDelay === "0s" ? null : cs.animationDelay,
        easing: cs.animationTimingFunction || null,
        iterationCount: cs.animationIterationCount || null,
        transitionProperty: cs.transitionProperty === "all" ? null : cs.transitionProperty,
        transitionDuration: cs.transitionDuration === "0s" ? null : cs.transitionDuration,
        transitionDelay: cs.transitionDelay === "0s" ? null : cs.transitionDelay,
        transitionEasing: cs.transitionTimingFunction || null
      }
    });
  }
  return { at: Date.now(), scrollY: window.scrollY, elements: out };
};

/* ────────────────────────────── pure derivation ─────────────────────────── */

const stateOf = (e) => {
  if (!e) return null;
  const s = { boundingBox: e.boundingBox };
  for (const k of MOTION_SAMPLED_PROPERTIES) s[k] = e[k] ?? null;
  return s;
};

const index = (frame) => {
  const map = new Map();
  for (const e of frame?.elements ?? []) if (!map.has(e.domPath)) map.set(e.domPath, e);
  return map;
};

const hasDeclaredTiming = (d) =>
  Boolean(d && (d.animationName || d.duration || d.transitionDuration));

/**
 * Turn three frames into an opening sequence.
 *
 * Pure, so the whole decision — including every refusal — is testable without a
 * browser. Which matters more here than usual: a gate that has only ever run
 * against the thing it gates is not evidence that it gates anything.
 */
export function deriveOpeningSequence({ cold, settled, stable, budget = DEFAULT_MOTION_BUDGET, failureReason = null } = {}) {
  if (failureReason) {
    return { status: "failed", reason: failureReason, windowMs: budget.stableMs, frames: [], participants: [], orderEstablished: false, staggerEstablished: false };
  }
  if (!cold || !settled) {
    return {
      status: "failed",
      reason: "the observation window closed before both a cold-load frame and a settled frame were captured",
      windowMs: budget.stableMs, frames: [], participants: [], orderEstablished: false, staggerEstablished: false
    };
  }

  const frames = [
    { frameId: "f0", label: "cold-load", atMs: 0 },
    { frameId: "f1", label: "settled", atMs: budget.settleMs },
    ...(stable ? [{ frameId: "f2", label: "stable", atMs: budget.stableMs }] : [])
  ];

  const coldIdx = index(cold);
  const settledIdx = index(settled);
  const stableIdx = stable ? index(stable) : null;

  const participants = [];
  let n = 0;
  for (const [domPath, settledEl] of settledIdx) {
    if (n >= budget.maxParticipants) break;
    const coldEl = coldIdx.get(domPath);
    if (!coldEl) continue;                       /* appeared later; not an entrance we timed */

    const before = stateOf(coldEl);
    const after = stateOf(settledEl);
    const changed = diffStates(before, after, { geometryTolerancePx: budget.geometryTolerancePx });
    if (!changed.length) continue;

    /* The control: did it keep changing after it settled? */
    let stillChanging = null;
    let controlResult = CONTROL_RESULT.ABSENT;
    let classification = TRIGGER_CLASSIFICATION.UNVERIFIED;
    let trigger = null;
    let reason = "no stable frame was captured, so a change across the load could not be distinguished from one that was going to continue anyway";

    if (stableIdx) {
      const stableEl = stableIdx.get(domPath);
      const controlChanged = stableEl
        ? diffStates(after, stateOf(stableEl), { geometryTolerancePx: budget.geometryTolerancePx })
        : [];
      stillChanging = controlChanged.length > 0;

      if (!stillChanging) {
        controlResult = CONTROL_RESULT.NO_CHANGE;
        classification = TRIGGER_CLASSIFICATION.VERIFIED;
        trigger = "page-load";
        reason = null;
      } else {
        const overlap = changed.filter((p) => controlChanged.includes(p));
        controlResult = overlap.length ? CONTROL_RESULT.SAME_CHANGE : CONTROL_RESULT.DIFFERENT_CHANGE;
        reason = overlap.length
          ? "the same propert" + (overlap.length === 1 ? "y" : "ies") + " (" + overlap.join(", ") +
            ") kept changing after the page settled, so the change is continuous rather than an entrance"
          : "the element was still changing after the page settled (" + controlChanged.join(", ") +
            "), so the load cannot be isolated as its cause";
      }
    }

    const declarations = settledEl.declarations ?? {};
    participants.push({
      elementId: "m_" + String(participants.length + 1).padStart(4, "0"),
      domPath,
      selectorAdmissible: true,
      order: participants.length,
      firstSeenMs: 0,
      settledMs: budget.settleMs,
      initial: before,
      settled: after,
      changedProperties: changed,
      declarations,
      /* Sampling gives the WINDOW, not the duration. Only a declaration states
       * a duration, so timing is `declared` when one exists and `none` when it
       * does not. Calling a two-frame window a measured duration would be
       * exactly the screenshot-into-timing conversion the design forbids. */
      timingSource: hasDeclaredTiming(declarations) ? "declared" : "none",
      stillChanging: stillChanging === true,
      staggerMsFromPrevious: null,
      evidenceStatus: hasDeclaredTiming(declarations) ? "observed" : "approximate",
      trigger: {
        classification,
        trigger,
        controlObservationId: stableIdx ? "f2" : null,
        controlResult,
        reason
      }
    });
    n++;
  }

  if (!participants.length) {
    return {
      status: "none-detected", reason: null, windowMs: budget.stableMs, frames,
      participants: [], orderEstablished: false, staggerEstablished: false
    };
  }

  return {
    status: "detected", reason: null, windowMs: budget.stableMs, frames, participants,
    /* Three samples cannot order events between them, and cannot measure a
     * stagger. Both are reported as unestablished rather than derived from the
     * order the DOM happened to be walked in. */
    orderEstablished: false,
    staggerEstablished: false
  };
}

/* ─────────────────────────────── the live stage ─────────────────────────── */

const wait = (sleep, ms) => (sleep ? sleep(ms) : new Promise((r) => setTimeout(r, ms)));

/**
 * Run the stage against a live capture session.
 *
 * `session` needs `evaluate(name, fn, arg)` and, for reduced motion, `run`.
 * Nothing else is assumed, so a fake session drives the whole path in tests.
 */
export async function runMotionStage({
  session, viewport, url = null, budget = DEFAULT_MOTION_BUDGET, sleep = null, say = () => {}
} = {}) {
  const b = { ...DEFAULT_MOTION_BUDGET, ...budget };
  const started = Date.now();
  resetObservationIds();

  const artifact = emptyArtifact({ viewport, url });
  artifact.$motionStage = MOTION_STAGE_VERSION;
  artifact.scrollCheckpoints = [];
  artifact.intersectionEntries = [];
  artifact.reducedMotion = { status: "not-attempted", differs: null, participantsSuppressed: [], note: null, reason: null };

  const sample = async (label) => {
    const r = await session.evaluate("motion-frame-" + label, MOTION_FRAME);
    return r?.result?.value ?? null;
  };

  let cold = null, settled = null, stable = null, failureReason = null;

  try {
    cold = await sample("cold");
    await wait(sleep, b.settleMs);
    settled = await sample("settled");

    if (Date.now() - started > b.maxTotalMs) {
      failureReason = "the motion budget of " + b.maxTotalMs + "ms was exhausted before a stable frame could be taken";
    } else {
      await wait(sleep, Math.max(0, b.stableMs - b.settleMs));
      stable = await sample("stable");
    }
  } catch (e) {
    failureReason = "the motion sampler failed: " + String(e?.message ?? e);
  }

  artifact.openingSequence = deriveOpeningSequence({ cold, settled, stable, budget: b, failureReason });
  if (failureReason) artifact.limitations.push(failureReason);

  /* Scroll checkpoints. Recorded as observations of what changed at each
   * position; no trigger is claimed from them here, because attributing a
   * change to scroll needs a control this stage does not take. */
  if (!failureReason && b.scrollCheckpoints > 0) {
    try {
      const height = await session.evaluate("motion-page-height", () => document.documentElement.scrollHeight);
      const total = height?.result?.value ?? 0;
      let previous = stable ?? settled;
      for (let i = 1; i <= b.scrollCheckpoints; i++) {
        if (Date.now() - started > b.maxTotalMs) {
          artifact.limitations.push("scroll checkpoints stopped after " + (i - 1) + " of " + b.scrollCheckpoints + ": motion budget exhausted");
          break;
        }
        const y = Math.round((total - viewport) * (i / (b.scrollCheckpoints + 1)));
        await session.evaluate("motion-scroll", (yy) => window.scrollTo(0, yy), y);
        await wait(sleep, 400);
        const frame = await sample("scroll-" + i);
        const changed = changedPaths(previous, frame, b);
        artifact.scrollCheckpoints.push({
          checkpointId: "sc_" + String(i).padStart(4, "0"),
          scrollY: y,
          atMs: Date.now() - started,
          changed
        });
        previous = frame;
      }
      await session.evaluate("motion-scroll-restore", () => window.scrollTo(0, 0));
      artifact.cleanup.scrollRestored = true;
    } catch (e) {
      artifact.limitations.push("scroll checkpoints failed: " + String(e?.message ?? e));
      artifact.cleanup.scrollRestored = false;
    }
  }

  /* Reduced motion. Attempted only if the driver supports the emulation; an
   * unsupported driver yields `unsupported` WITH a reason, never a claim that
   * reduced motion changes nothing. */
  if (typeof session.run === "function") {
    try {
      const set = await session.run("setReducedMotion", (driver, pageId) => driver.setReducedMotion(pageId, true));
      if (set?.status === "unsupported" || set?.unsupported === true) {
        artifact.reducedMotion = {
          status: "unsupported", differs: null, participantsSuppressed: [], note: null,
          reason: "the driver does not support reduced-motion emulation, so no comparison could be made"
        };
      } else {
        const reduced = await sample("reduced");
        const suppressed = suppressedParticipants(artifact.openingSequence, reduced, b);
        artifact.reducedMotion = {
          status: "compared",
          differs: suppressed.length > 0,
          participantsSuppressed: suppressed,
          note: suppressed.length
            ? "under reduced motion these participants were already at their settled state"
            : "no participant's settled state differed under reduced motion",
          reason: null
        };
        await session.run("clearReducedMotion", (driver, pageId) => driver.setReducedMotion(pageId, false));
        artifact.cleanup.reducedMotionRestored = true;
      }
    } catch (e) {
      artifact.reducedMotion = {
        status: "failed", differs: null, participantsSuppressed: [], note: null,
        reason: "the reduced-motion comparison failed: " + String(e?.message ?? e)
      };
      artifact.cleanup.reducedMotionRestored = false;
    }
  } else {
    artifact.reducedMotion.reason = "this session exposes no driver control, so reduced motion was never emulated";
  }

  /* Hover, focus and click are the interaction stage's territory, with its own
   * safety gate. Saying so is better than a silent omission a reader would
   * read as "there are none". */
  artifact.limitations.push(
    "hover, focus, click and menu states were not attempted by the motion stage; they belong to the interaction stage and are unknown here rather than absent"
  );

  artifact.cleanup.apparatusRemoved = true;   /* the sampler injects nothing */
  artifact.apparatusRemaining = 0;
  artifact.durationMs = Date.now() - started;

  say(`motion: ${artifact.openingSequence.status}, ${artifact.openingSequence.participants.length} participant(s), `
    + `reduced-motion ${artifact.reducedMotion.status}`);

  return artifact;
}

function changedPaths(before, after, budget) {
  if (!before || !after) return [];
  const beforeIdx = index(before);
  const out = [];
  for (const [path, el] of index(after)) {
    const prior = beforeIdx.get(path);
    if (!prior) continue;
    if (diffStates(stateOf(prior), stateOf(el), { geometryTolerancePx: budget.geometryTolerancePx }).length) out.push(path);
  }
  return out.slice(0, 60);
}

/** Participants whose cold-load state under reduced motion already matched settled. */
function suppressedParticipants(opening, reducedFrame, budget) {
  if (!reducedFrame || opening?.status !== "detected") return [];
  const idx = index(reducedFrame);
  const out = [];
  for (const p of opening.participants) {
    const el = idx.get(p.domPath);
    if (!el) continue;
    if (!diffStates(p.settled, stateOf(el), { geometryTolerancePx: budget.geometryTolerancePx }).length) out.push(p.elementId);
  }
  return out;
}

export const MOTION_ARTIFACT_FILENAME = "motion-observation.json";
export { MOTION_CONTRACT_VERSION, CLAIM_TYPE };

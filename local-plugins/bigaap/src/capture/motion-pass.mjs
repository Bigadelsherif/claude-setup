/**
 * The motion pass — a genuinely cold load, per viewport.
 *
 * ## Why it drives the driver directly
 *
 * A capture session opens the page AND navigates it AND waits for readiness
 * before handing control to its body. That ordering is right for a forensic
 * survey and fatal for motion: the recorder has to be installed BEFORE
 * navigation, or the first frame it takes is of a page that has already
 * finished animating. There is no hook in the session between "page exists" and
 * "page has navigated", so this pass owns the sequence itself:
 *
 *   start driver -> open a FRESH context -> install the recorder as an init
 *   script -> navigate -> harvest.
 *
 * Each viewport gets its own context, and the reduced-motion comparison gets
 * another one, so no run inherits another's cache, storage or emulation state.
 *
 * ## Why it navigates with `domcontentloaded`
 *
 * The brief asks for document readiness without waiting for animations to
 * finish, and `networkidle` waits for both. Waiting for idle would put the
 * first harvest after the entrance, which is the bug this pass exists to fix.
 * The recorder samples on its own schedule regardless; the wait condition only
 * decides when this process may start asking.
 *
 * ## Failure is data
 *
 * Nothing here throws upward. A driver that will not start, a navigation that
 * is blocked, a page that never runs the init script — each produces an
 * artifact that says so. An absent artifact and an artifact reporting a failure
 * mean different things to every reader downstream.
 */

import { PlaywrightDriver } from "../driver/playwright-driver.mjs";
import { emptyArtifact, MOTION_CONTRACT_VERSION } from "./motion-observe.mjs";
import { MOTION_STAGE_VERSION, MOTION_ARTIFACT_FILENAME } from "./motion-stage.mjs";
import { recorderSource, deriveColdLoad, FRAME_OFFSETS, TRACKED_PROPERTIES, cacheVerdict } from "./motion-recorder.mjs";

export { MOTION_ARTIFACT_FILENAME };

export const DEFAULT_COLD_BUDGET = Object.freeze({
  offsets: FRAME_OFFSETS,
  maxParticipants: 40,
  /* Raised from 500 after a real page hit the cap and reported the record as
   * truncated: motion below the cut is motion nobody looked at. Only diffs and
   * two full states cross the bridge, so the cost of a larger cap is modest. */
  maxElements: 1500,
  navigationTimeoutMs: 30000,
  harvestGraceMs: 400,
  scrollCheckpoints: 3
});

const wait = (sleep, ms) => (sleep ? sleep(ms) : new Promise((r) => setTimeout(r, ms)));

/**
 * Read a driver result.
 *
 * The envelope is `{ operation, status, value, error, … }` — `value` at the
 * top level, not nested under `result`. An earlier version of this file read
 * `r.result.value`, which is undefined for every real driver call; the fake
 * driver in the tests had been written to match that mistake, so the whole
 * suite passed while the live pass could not open a page. The fake now mirrors
 * this shape exactly, which is the only thing that makes these helpers worth
 * having.
 */
const ok = (r) => r?.status === "ok";
const value = (r) => (r && "value" in r ? r.value : null);
const unsupported = (r) => r?.status === "unsupported";
const failureOf = (r) => r?.error?.message ?? r?.errorCode ?? "the driver reported " + (r?.status ?? "no status");

/** An artifact for a pass that never got to look. */
export function unattemptedArtifact({ viewport, url, reason }) {
  const a = emptyArtifact({ viewport, url });
  a.$motionStage = MOTION_STAGE_VERSION;
  a.openingSequence = {
    status: "failed", reason, windowMs: null, frames: [],
    participants: [], orderEstablished: false, staggerEstablished: false, notDetected: null
  };
  a.scrollCheckpoints = [];
  a.intersectionEntries = [];
  a.reducedMotion = { status: "not-attempted", differs: null, participantsSuppressed: [], note: null, reason };
  a.limitations = [reason];
  return a;
}

/**
 * One cold load: fresh context, recorder first, then navigate.
 *
 * Returns the recorder payload and what was learned about the navigation, or a
 * failure reason. Never throws.
 */
async function coldLoad({ driver, url, viewport, height, budget, sleep, reducedMotion = false }) {
  let pageId = null;
  try {
    const opened = await driver.openPage({ viewport, height });
    pageId = value(opened)?.pageId ?? null;
    if (!pageId) return { ok: false, reason: "a fresh page context could not be opened: " + failureOf(opened) };

    /* Emulation before navigation, so the very first frame is already under the
     * setting being tested. Set afterwards it would describe the wrong load. */
    let reducedMotionApplied = null;
    if (reducedMotion) {
      const set = await driver.setReducedMotion(pageId, true);
      if (unsupported(set)) return { ok: false, reason: "the driver does not support reduced-motion emulation", unsupported: true };
      reducedMotionApplied = true;
    }

    /* Cache: a fresh context is the strongest lever this driver exposes. There
     * is no cache-disable operation on the interface, so rather than claim one,
     * the pass measures whether the document actually came from cache and
     * reports the answer. */
    const injected = await driver.injectScript(pageId, {
      content: recorderSource({ offsets: budget.offsets, properties: TRACKED_PROPERTIES, maxElements: budget.maxElements }),
      onInit: true
    });
    if (unsupported(injected)) return { ok: false, reason: "the driver cannot install an init script, so recording cannot begin before navigation", unsupported: true };

    const nav = await driver.navigate(pageId, url, { waitUntil: "domcontentloaded", timeoutMs: budget.navigationTimeoutMs });
    if (!ok(nav)) return { ok: false, reason: "navigation did not complete: " + failureOf(nav) };
    const navResult = value(nav);

    /* Let the recorder finish its own schedule before asking for the payload. */
    const last = budget.offsets[budget.offsets.length - 1];
    await wait(sleep, last + budget.harvestGraceMs);

    const harvested = await driver.evaluate(pageId, () => (window.__bigaapMotion ?? null));
    const payload = value(harvested);
    if (!payload) return { ok: false, reason: "the recorder was installed but produced no payload; the page may have blocked script execution", pageId };

    return { ok: true, payload, pageId, navigation: navResult, reducedMotionApplied };
  } catch (e) {
    return { ok: false, reason: "the cold load threw: " + String(e?.message ?? e) };
  } finally {
    if (pageId) { try { await driver.closePage(pageId); } catch { /* the context is going away regardless */ } }
  }
}

/**
 * Scroll checkpoints, in their own context, after the cold load.
 *
 * Separate on purpose: scrolling during the opening window would make
 * scroll-triggered motion indistinguishable from load motion, which is the one
 * distinction the brief asks to preserve.
 */
async function scrollPass({ driver, url, viewport, height, budget, sleep }) {
  let pageId = null;
  const checkpoints = [];
  try {
    const opened = await driver.openPage({ viewport, height });
    pageId = value(opened)?.pageId ?? null;
    if (!pageId) return { checkpoints, note: "no page context for the scroll pass: " + failureOf(opened) };

    await driver.navigate(pageId, url, { waitUntil: "domcontentloaded", timeoutMs: budget.navigationTimeoutMs });
    /* Let the page settle first — anything still moving from load would be
     * misread as a response to scrolling. */
    await wait(sleep, budget.offsets[budget.offsets.length - 1]);

    const snap = async () => value(await driver.evaluate(pageId, (props) => {
      const path = (el) => {
        const parts = []; let node = el;
        while (node && node.nodeType === 1 && parts.length < 12) {
          const parent = node.parentElement; if (!parent) break;
          parts.unshift(node.tagName.toLowerCase() + ":nth-child(" + (Array.prototype.indexOf.call(parent.children, node) + 1) + ")");
          node = parent;
        }
        return parts.join(">");
      };
      const out = {};
      const all = document.querySelectorAll("body *");
      for (let i = 0; i < Math.min(all.length, 500); i++) {
        const el = all[i];
        const b = el.getBoundingClientRect();
        if (b.width < 2 || b.height < 2) continue;
        const cs = getComputedStyle(el);
        const rec = {};
        for (const p of props) rec[p] = cs[p];
        out[path(el)] = rec;
      }
      return out;
    }, TRACKED_PROPERTIES));

    const height_ = value(await driver.evaluate(pageId, () => document.documentElement.scrollHeight)) ?? 0;
    let previous = await snap();

    for (let i = 1; i <= budget.scrollCheckpoints; i++) {
      const y = Math.round((height_ - viewport) * (i / (budget.scrollCheckpoints + 1)));
      await driver.evaluate(pageId, (yy) => window.scrollTo(0, yy), y);
      await wait(sleep, 500);
      const now = await snap();
      const changed = [];
      for (const [p, rec] of Object.entries(now ?? {})) {
        const prior = previous?.[p];
        if (!prior) continue;
        if (TRACKED_PROPERTIES.some((k) => prior[k] !== rec[k])) changed.push(p);
      }
      checkpoints.push({ checkpointId: "sc_" + String(i).padStart(4, "0"), scrollY: y, atMs: null, changed: changed.slice(0, 60) });
      previous = now;
    }
    return { checkpoints, note: null };
  } catch (e) {
    return { checkpoints, note: "the scroll pass failed: " + String(e?.message ?? e) };
  } finally {
    if (pageId) { try { await driver.closePage(pageId); } catch { /* going away */ } }
  }
}

/** Which participants were suppressed when reduced motion was on. */
function suppressedUnderReducedMotion(normal, reduced) {
  if (normal?.status !== "detected") return { differs: null, suppressed: [], note: "no opening sequence was detected without reduced motion, so there is nothing to compare" };
  if (reduced?.status !== "detected") {
    return {
      differs: true,
      suppressed: normal.participants.map((p) => p.elementId),
      note: "under reduced motion no opening sequence was detected at all, so every participant is suppressed"
    };
  }
  const reducedPaths = new Set(reduced.participants.map((p) => p.domPath));
  const suppressed = normal.participants.filter((p) => !reducedPaths.has(p.domPath)).map((p) => p.elementId);
  return {
    differs: suppressed.length > 0,
    suppressed,
    note: suppressed.length
      ? suppressed.length + " participant(s) did not move under reduced motion"
      : "the same participants moved under reduced motion"
  };
}

/**
 * Run the motion pass for one viewport.
 *
 * Owns the driver lifecycle so every context it opens is one it closes.
 */
export async function runMotionPass({
  url, viewport, height = 900, outDir = null,
  navigationTimeoutMs = null, driverFactory = null, sleep = null,
  budget = DEFAULT_COLD_BUDGET, onProgress = null
} = {}) {
  const b = { ...DEFAULT_COLD_BUDGET, ...budget, ...(navigationTimeoutMs ? { navigationTimeoutMs } : {}) };
  const say = (m) => onProgress?.(m);
  const started = Date.now();

  const artifact = emptyArtifact({ viewport, url });
  artifact.$motionContract = MOTION_CONTRACT_VERSION;
  artifact.$motionStage = MOTION_STAGE_VERSION;
  artifact.scrollCheckpoints = [];
  artifact.intersectionEntries = [];
  artifact.reducedMotion = { status: "not-attempted", differs: null, participantsSuppressed: [], note: null, reason: null };

  const driver = (driverFactory ?? (() => new PlaywrightDriver()))();
  let startedDriver = false;

  try {
    const start = await driver.start();
    if (!ok(start)) {
      return {
        artifact: unattemptedArtifact({ viewport, url, reason: "the browser driver could not start: " + failureOf(start) }),
        relativePath: rel(viewport), kind: kindOf(viewport)
      };
    }
    startedDriver = true;

    /* 1. The cold load. */
    const cold = await coldLoad({ driver, url, viewport, height, budget: b, sleep });
    if (!cold.ok) {
      artifact.openingSequence = {
        status: "failed", reason: cold.reason, windowMs: b.offsets[b.offsets.length - 1],
        frames: [], participants: [], orderEstablished: false, staggerEstablished: false, notDetected: null
      };
      artifact.limitations.push(cold.reason);
    } else {
      artifact.openingSequence = deriveColdLoad({ payload: cold.payload, viewport, budget: b });
      const cache = cacheVerdict(cold.payload?.navigation ?? null);
      artifact.coldLoad = {
        sampleOffsetsMs: b.offsets,
        framesCaptured: (cold.payload.frames ?? []).length,
        restoredFromCache: cache.restoredFromCache,
        cacheEvidence: cache.why,
        contentVisibleAtFirstFrame: cold.payload.firstFrameVisible ?? null,
        elementRecordTruncated: cold.payload.truncated === true,
        media: cold.payload.media ?? null,
        navigation: cold.payload.navigation ?? null,
        cacheDisabled: false,
        cacheDisabledNote: "this driver exposes no cache-disable operation; a fresh browser context was used instead and the actual cache outcome is reported above"
      };
      if (cold.payload.truncated) {
        artifact.limitations.push("the element record was truncated at " + b.maxElements + " elements; motion below that cut was not observed");
      }
    }

    /* 2. Reduced motion — its own fresh context, its own cold load. */
    const reduced = await coldLoad({ driver, url, viewport, height, budget: b, sleep, reducedMotion: true });
    if (!reduced.ok) {
      artifact.reducedMotion = {
        status: reduced.unsupported ? "unsupported" : "failed",
        differs: null, participantsSuppressed: [], note: null, reason: reduced.reason
      };
    } else {
      const reducedSequence = deriveColdLoad({ payload: reduced.payload, viewport, budget: b });
      const verdict = suppressedUnderReducedMotion(artifact.openingSequence, reducedSequence);
      artifact.reducedMotion = {
        status: "compared",
        differs: verdict.differs,
        participantsSuppressed: verdict.suppressed,
        note: verdict.note,
        reason: null,
        openingSequenceStatus: reducedSequence.status
      };
      artifact.cleanup.reducedMotionRestored = true;
    }

    /* 3. Scroll, in a third context, so load motion and scroll motion stay
     *    distinguishable. */
    if (b.scrollCheckpoints > 0) {
      const scroll = await scrollPass({ driver, url, viewport, height, budget: b, sleep });
      artifact.scrollCheckpoints = scroll.checkpoints;
      artifact.cleanup.scrollRestored = true;
      if (scroll.note) artifact.limitations.push(scroll.note);
    }
  } catch (e) {
    const reason = "the motion pass threw: " + String(e?.message ?? e);
    artifact.openingSequence = artifact.openingSequence ?? {
      status: "failed", reason, windowMs: null, frames: [], participants: [],
      orderEstablished: false, staggerEstablished: false, notDetected: null
    };
    artifact.limitations.push(reason);
  } finally {
    if (startedDriver) { try { await driver.stop(); } catch { /* nothing left to do */ } }
  }

  artifact.limitations.push(
    "hover, focus, click and menu states were not attempted by the motion stage; they belong to the interaction stage and are unknown here rather than absent"
  );
  artifact.cleanup.apparatusRemoved = true;
  artifact.apparatusRemaining = 0;
  artifact.durationMs = Date.now() - started;

  say(`motion: ${artifact.openingSequence?.status}, ${artifact.openingSequence?.participants?.length ?? 0} participant(s), `
    + `reduced-motion ${artifact.reducedMotion.status}`);

  return { artifact, relativePath: rel(viewport), kind: kindOf(viewport) };
}

const rel = (viewport) => `${viewport}\\${MOTION_ARTIFACT_FILENAME}`;
const kindOf = (viewport) => `motion-observation-${viewport}`;

/**
 * The shadow capture: one viewport, driven live, for the observe/normalize/
 * page-model pipeline rather than for the extractor.
 *
 * `extraction.mjs` runs the two-pass extractor through the same settle loop;
 * this runs `collectObservations` instead. The two are siblings, not layers —
 * neither calls the other, and this module changes nothing about what
 * `extraction.mjs` does or what the existing `analyze`/`recreate` path sees.
 *
 * Every dependency the browser touches goes through `withCaptureSession`, so a
 * viewport that fails to launch, navigate or settle is still closed and still
 * reports why — the same guarantee the extractor path already has.
 */

import { withCaptureSession } from "./session.mjs";
import { mountAwareSettle, MOUNT_SNAPSHOT, SCROLL_PASS, SETTLE_BUDGET } from "./settle.mjs";
import { collectObservations, REGION_SURVEY, OBSERVE_BUDGET, SCROLL_STATE } from "./observe.mjs";
import { candidatesFromObservations, planVisualCaptures, VISUAL_BUDGET } from "./visual.mjs";
import {
  INTERACTION_CANDIDATES, INTERACTION_ACTIVATE, INTERACTION_BUDGET,
  planInteractions, interactionEvidenceFrom
} from "./interact.mjs";
import {
  SUBTREE_SNAPSHOT, SUBTREE_BUDGET, INTERACTION_RESULT, diffSubtrees
} from "./interaction-diff.mjs";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const EMPTY_SNAPSHOT = {
  totalNodes: 0, visibleNodes: 0, hiddenNodes: 0, hiddenSubtrees: 0,
  hiddenByReason: {}, images: { total: 0, loaded: 0, failed: 0, pending: 0 },
  documentHeight: 0, scrollY: 0
};

/**
 * Captures one viewport's region observations: settle, then discover.
 *
 * Returns the capture `run` (for status/history), the `settle` report, the
 * `observed` output of `collectObservations`, and a `diagnostics` object in
 * the same shape every capture tool in this project emits — so a shadow
 * artifact is recognisable beside a real one, never mistaken for it.
 */
export async function captureRegionObservations({
  url, viewport = 1440, height = 900, settleMs = 400,
  onProgress = null, driverFactory = null, sleep = null,
  navigationTimeoutMs = 90_000, settleBudget = SETTLE_BUDGET, observeBudget = OBSERVE_BUDGET,
  /* Where crops go. Absent means the caller wants no visual capture at all,
   * which is a legitimate mode rather than a degraded one: the plan is still
   * produced and every region is still reported, as not-attempted. */
  visualDir = null, visualBudget = VISUAL_BUDGET,
  /* Interaction discovery is OFF unless a caller asks for it. It is the only
   * stage that changes the page, so it is opt-in rather than a default. */
  interactions = false, interactionBudget = INTERACTION_BUDGET
}) {
  if (visualDir) mkdirSync(visualDir, { recursive: true });
  const say = (m) => onProgress?.(m);

  const run = await withCaptureSession({
    url, viewport, height, sourceKind: "url", captureMode: "region-survey",
    ...(driverFactory ? { driverFactory } : {}),
    ...(sleep ? { sleep } : {}),
    /* Same choice `captureExtraction` makes and for the same reason: a style
     * read must not run against frozen animation, or every transition token
     * this survey collects reads as zero. */
    prepare: { timeoutMs: navigationTimeoutMs, freeze: false, reducedMotion: false }
  }, async (session) => {
    const settle = await mountAwareSettle({
      snapshot: async () => {
        const s = await session.evaluate("mount-snapshot", MOUNT_SNAPSHOT);
        return s.result?.value ?? EMPTY_SNAPSHOT;
      },
      scrollPass: async (dwellMs) => {
        const s = await session.evaluate("settle-scroll", SCROLL_PASS, dwellMs);
        return s.result?.value ?? null;
      },
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      budget: settleBudget,
      onProgress: say
    });
    say(`settle ${settle.outcome} (${settle.endedBy}) after ${settle.passCount} pass(es), `
      + `${settle.initial.visibleNodes} -> ${settle.final.visibleNodes} visible of ${settle.final.totalNodes}`);

    await new Promise((r) => setTimeout(r, settleMs));

    const observed = await collectObservations({
      survey: async () => {
        const s = await session.evaluate("region-survey", REGION_SURVEY);
        return s.result?.value ?? {
          regions: [], documentHeight: 0, viewportHeight: height, viewportWidth: viewport,
          url, visibilityState: "visible", scrollY: 0, diagnostics: []
        };
      },
      scrollTo: async (y) => {
        await session.evaluate("scroll-to", (yy) => window.scrollTo(0, yy), y);
      },
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      viewportWidth: viewport,
      budget: observeBudget,
      onProgress: say
    });
    say(`observed ${observed.counts.observations} time(s), ${observed.counts.regions} region(s), `
      + `stopped by ${observed.stoppedBy}`);

    /* Crop pass.
     *
     * Runs after the sweep, not during it, because "which observation shows
     * this panel best" cannot be answered until every observation exists. Each
     * crop returns to the scroll position its chosen observation was taken at,
     * so the stored picture belongs to one scroll state rather than to whatever
     * the page happened to be showing when the walk ended. */
    let visualResults = new Map();
    let visualPlan = [];
    if (visualDir) {
      const candidates = candidatesFromObservations(observed.observations ?? []);
      visualPlan = planVisualCaptures({
        candidates,
        observations: (observed.observations ?? []).map((o, i) => ({ ...o, observationId: `raw-${i}` })),
        canCapture: true,
        budget: visualBudget
      });
      const wanted = visualPlan.filter((p) => p.captureStatus === "captured");
      say(`visual: ${candidates.length} candidate(s), ${wanted.length} croppable`);

      for (const item of wanted) {
        const file = `${item.domPath.replace(/[^a-z0-9]+/gi, "-").slice(-80)}.png`;
        const target = join(visualDir, file);
        try {
          await session.evaluate("scroll-to-visual", (yy) => window.scrollTo(0, yy), item.observation?.scrollY ?? 0);
          await new Promise((r) => setTimeout(r, 180));
          const shot = await session.screenshotRegion(target, item.cropGeometry);
          if (shot?.error || !existsSync(target)) {
            visualResults.set(item.domPath, { error: shot?.error?.message ?? "screenshot produced no file" });
            continue;
          }
          const bytes = readFileSync(target);
          visualResults.set(item.domPath, {
            hash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
            artifactPath: `visual/${file}`,
            bytes: bytes.length
          });
        } catch (e) {
          visualResults.set(item.domPath, { error: e?.message ?? String(e) });
        }
      }
      say(`visual: ${[...visualResults.values()].filter((v) => v.hash).length} crop(s) stored`);
    }

    /* Interaction pass.
     *
     * Runs LAST, after every read-only stage, because it is the only stage that
     * changes the page. Anything that ran before it saw the page untouched; if
     * restoration fails, only this stage's own evidence is affected and the
     * capture says so rather than quietly continuing on a drifted page.
     *
     * Before/after are REAL observations appended to the stream with
     * `kind: interaction-state`, so the existing support machinery already
     * knows they cannot satisfy an above-fold or resting-page claim. No new
     * scope rule is invented here; the one that exists is reused.
     */
    let interactionResults = new Map();
    let interactionPlan = [];
    if (interactions) {
      const b = { ...INTERACTION_BUDGET, ...interactionBudget };
      const gathered = await session.evaluate("interaction-candidates", INTERACTION_CANDIDATES);
      const candidates = gathered.result?.value ?? [];
      interactionPlan = planInteractions({ candidates, budget: b });
      const wanted = interactionPlan.filter((p) => p.attempt);
      say(`interaction: ${candidates.length} candidate(s), ${wanted.length} safe to attempt, `
        + `${interactionPlan.filter((p) => p.refusalReason).length} refused`);

      const startedInteractions = Date.now();
      for (const item of wanted) {
        if (Date.now() - startedInteractions > b.maxTotalMs) {
          interactionResults.set(item.domPath, { error: "interaction-time-budget-exhausted" });
          continue;
        }
        try {
          /* A BOUNDED SUBTREE around the target, not the page's region list.
           * A menu opening changes an attribute and a `display` inside one nav
           * and reaches the region list not at all — which is why every real
           * site reported "no observable change" before this. */
          const beforeSnap = await session.evaluate("interaction-before", SUBTREE_SNAPSHOT,
            { domPath: item.domPath, budget: SUBTREE_BUDGET });
          const before = beforeSnap.result?.value ?? null;

          const clicked = await session.evaluate("interaction-activate", INTERACTION_ACTIVATE, item.domPath);
          const activation = clicked.result?.value ?? { ok: false, error: "no activation result" };
          if (!activation.ok) {
            interactionResults.set(item.domPath, { error: activation.error ?? "activation refused in page" });
            continue;
          }

          await new Promise((r) => setTimeout(r, b.settleMs));
          const afterSnap = await session.evaluate("interaction-after", SUBTREE_SNAPSHOT,
            { domPath: item.domPath, budget: SUBTREE_BUDGET });
          const after = afterSnap.result?.value ?? null;

          /* Restoration by re-activating the same control only works for a
           * TOGGLE — a menu, an accordion, a dialog. A carousel is not one:
           * pressing "Previous" twice moves back two slides, it does not undo
           * one. Treating that as a failed restoration was wrong twice over —
           * it called a working control broken, and it aborted discovery for
           * every target after it.
           *
           * So a non-toggle is not restored, and says so. The page is left in a
           * different but equally valid resting state rather than in a broken
           * one, which is why it does not compromise the capture. */
          const TOGGLES = new Set(["open-menu", "close-menu", "expand-accordion", "collapse-accordion", "open-dialog", "close-dialog"]);
          const isToggle = TOGGLES.has(item.action);

          let restore = null;
          let restoredState = null;
          if (isToggle) {
            restore = await session.evaluate("interaction-restore", INTERACTION_ACTIVATE, item.domPath);
            await new Promise((r) => setTimeout(r, b.settleMs));
            const restoredSnap = await session.evaluate("interaction-verify", SUBTREE_SNAPSHOT,
              { domPath: item.domPath, budget: SUBTREE_BUDGET });
            restoredState = restoredSnap.result?.value ?? null;
          }

          const diff = diffSubtrees(before, after, SUBTREE_BUDGET);
          const changed = diff.result !== INTERACTION_RESULT.NONE
            && diff.result !== INTERACTION_RESULT.FAILED;

          /* Restoration is measured with the SAME diff: the page is restored
           * when re-activating the toggle leaves no observable difference from
           * where it started. `null` means restoration was never applicable —
           * recorded as `not-needed`, neither a success nor a failure. */
          const restored = isToggle
            ? (Boolean(restore?.result?.value?.ok)
               && diffSubtrees(before, restoredState, SUBTREE_BUDGET).result === INTERACTION_RESULT.NONE)
            : null;

          const appeared = diff.changes.structure.filter((c) => c.change === "appeared").map((c) => c.domPath);
          const disappeared = diff.changes.structure.filter((c) => c.change === "disappeared").map((c) => c.domPath);

          interactionResults.set(item.domPath, {
            changed,
            restored,
            before: before ? [before] : null,
            after: after ? [after] : null,
            scrollY: before?.scrollY ?? 0,
            scrollState: SCROLL_STATE.AFTER_RETURN,
            affectedRegions: [...appeared, ...disappeared].slice(0, 40),
            /* The fine-grained result travels whole: the class, the counts,
             * and the exact attribute/text/geometry changes a prompt may cite. */
            resultClass: diff.result,
            signals: diff.signals,
            changes: diff.changes,
            changeCounts: diff.counts,
            focus: diff.focus,
            observedAt: Date.now() - startedInteractions
          });

          if (isToggle && restored === false) {
            /* A toggle that would not toggle back has left the page in a state
             * no earlier stage measured. Stop rather than gather more evidence
             * against it. A non-toggle is not checked here: it was never
             * expected to reverse. */
            say(`interaction: restoration failed on ${item.domPath} — stopping interaction discovery`);
            break;
          }
        } catch (e) {
          interactionResults.set(item.domPath, { error: e?.message ?? String(e) });
        }
      }
      say(`interaction: ${[...interactionResults.values()].filter((r) => r.changed).length} observed transition(s)`);
    }

    return {
      settle, observed, visualResults, visualPlan, visualCapable: Boolean(visualDir),
      interactionResults, interactionPlan,
      pageDiagnostics: await session.diagnostics()
    };
  });

  const {
    settle = null, observed = null, visualResults = new Map(), visualPlan = [], visualCapable = false,
    interactionResults = new Map(), interactionPlan = [], pageDiagnostics = null
  } = run.value ?? {};

  const diagnostics = {
    $captureContract: "1",
    url, viewport, capturedAt: run.metadata.completedAt,
    settle,
    observePlan: observed?.plan ?? null,
    observeStoppedBy: observed?.stoppedBy ?? null,
    observeCounts: observed?.counts ?? null,
    consoleErrors: (pageDiagnostics?.consoleErrors ?? []).slice(0, 20),
    pageErrors: (pageDiagnostics?.pageErrors ?? []).slice(0, 20),
    networkFailures: (pageDiagnostics?.networkFailures ?? []).slice(0, 20),
    visual: {
      attempted: visualPlan.length > 0,
      planned: visualPlan.length,
      croppable: visualPlan.filter((p) => p.captureStatus === "captured").length,
      stored: [...visualResults.values()].filter((v) => v.hash).length,
      failed: [...visualResults.values()].filter((v) => v.error).length
    },
    capture: run.metadata
  };

  return { run, settle, observed, visualResults, visualPlan, visualCapable, interactionResults, interactionPlan, interactionsAttempted: interactions, diagnostics };
}

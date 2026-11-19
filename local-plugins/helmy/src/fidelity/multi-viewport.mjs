/**
 * Four-viewport fidelity.
 *
 * Each viewport is a complete, independent run against ITS OWN reference. The
 * pairing rule is the one thing this module exists to enforce:
 *
 *   A target is never compared against a reference from a different viewport.
 *
 * A 1440 reference against a 768 target is not a fidelity finding, it is a
 * measurement error, and the viewport gate already refuses it. This module
 * refuses it earlier and more explicitly, so the run records a pairing error
 * rather than a comparison result.
 *
 * Nothing is averaged. There is no cross-viewport score, and the only thing
 * computed across viewports is the responsive progression comparison, which
 * compares how each side CHANGES rather than what each side is.
 */

import { runViewport } from "./viewport-run.mjs";
import { compareResponsive } from "./responsive.mjs";

export const VIEWPORTS = Object.freeze([1440, 1024, 768, 375]);

/**
 * Records a pairing error without running anything.
 *
 * Distinct from a gate failure: a gate failure means the comparison was
 * attempted and refused. This means it was never attempted, because the inputs
 * were wrong before any browser work began.
 */
function pairingError({ viewport, referenceViewport, reason }) {
  return {
    viewport: { width: viewport, height: null, devicePixelRatio: null },
    blocked: {
      comparisonPerformed: false,
      stage: "pairing",
      status: "pairing-error",
      failedGates: [{
        gate: "viewport-pairing",
        measured: `target at ${viewport}px paired with a reference at ${referenceViewport}px`,
        clears: `Supply a reference captured at ${viewport}px.`
      }],
      passedGates: [],
      categories: null,
      compositeScore: null,
      statement: reason
    },
    targetStarted: false,
    categories: null,
    differences: [],
    tasks: [],
    intrinsicFindings: [],
    states: [],
    compositeScore: null,
    readiness: "blocked",
    pairingError: { viewport, referenceViewport, reason }
  };
}

/**
 * Runs the viewport series.
 *
 * @param {object} opts.references  { [viewport]: { ir, raw, captureMeta, probe } }
 * @param {object} opts.targets     { [viewport]: { raw, probe, slug, captureMeta } }
 */
export function runViewportSeries({
  viewports = VIEWPORTS,
  references, targets,
  referenceSlugFor = (w) => `reference-${w}`,
  contentModeFor = () => ({}),
  statesFor = () => [],
  visualChecksFor = () => ({ target: null, reference: null }),
  pixelClustersFor = () => null,
  responsiveProbesFor = () => ({ reference: null, target: null }),
  classify = null
}) {
  const records = [];

  for (const viewport of viewports) {
    const reference = references[viewport];
    const target = targets[viewport];

    if (!reference) {
      records.push(pairingError({
        viewport, referenceViewport: null,
        reason: `No reference was captured at ${viewport}px. A target is never compared against a reference from another viewport, so this viewport is blocked rather than substituted.`
      }));
      continue;
    }
    if (!target) {
      records.push(pairingError({
        viewport, referenceViewport: viewport,
        reason: `No target was captured at ${viewport}px.`
      }));
      continue;
    }

    /* The pairing check proper: both sides must declare this viewport. */
    const refWidth = reference.ir?.coverage?.viewport?.width ?? null;
    const tgtWidth = target.raw?.meta?.viewport?.width ?? target.captureMeta?.viewportWidth ?? null;
    if (refWidth !== viewport || tgtWidth !== viewport) {
      records.push(pairingError({
        viewport, referenceViewport: refWidth,
        reason:
          `Pairing rejected before any comparison: the series asked for ${viewport}px, the reference reports ` +
          `${refWidth}px and the target reports ${tgtWidth}px. Comparing them would measure the viewport ` +
          "difference rather than the target."
      }));
      continue;
    }

    const checks = visualChecksFor(viewport);
    const record = runViewport({
      viewport,
      referenceIR: reference.ir,
      referenceRaw: reference.raw,
      referenceSlug: referenceSlugFor(viewport),
      referenceCaptureMeta: reference.captureMeta,
      target,
      contentMode: contentModeFor(viewport),
      states: statesFor(viewport),
      targetVisualChecks: checks?.target ?? null,
      referenceVisualChecks: checks?.reference ?? null,
      pixelClusters: pixelClustersFor(viewport),
      classify
    });

    records.push({ ...record, viewportWidth: viewport });
  }

  /* Responsive comparison runs over the whole series, excluding blocked
   * viewports from every progression rather than guessing at their values. */
  const series = records.map((r) => {
    const w = r.viewportWidth ?? r.viewport?.width;
    const probes = responsiveProbesFor(w) ?? {};
    return {
      viewport: w,
      blocked: !!r.blocked,
      referenceIR: references[w]?.ir ?? null,
      targetIR: r.targetIR ?? null,
      referenceProbe: probes.reference ?? null,
      targetProbe: probes.target ?? null,
      contentMode: r.contentMode ?? null
    };
  });
  const responsive = compareResponsive(series);

  return {
    viewports: records,
    responsive,
    /* Consolidated for reading; each task still carries its own viewport. */
    tasks: consolidateTasks(records),
    compositeScore: null,
    thresholdsValidated: false,
    note:
      "Per-viewport records are independent. No score is averaged across viewports, and the responsive " +
      "section compares progressions rather than values."
  };
}

/**
 * Consolidates tasks across viewports.
 *
 * A global value that differs at every viewport is one correction, not four —
 * but the evidence for each viewport is preserved, because an implementer needs
 * to know it holds everywhere rather than take it on trust.
 */
export function consolidateTasks(records) {
  const byDimension = new Map();

  for (const record of records) {
    const width = record.viewportWidth ?? record.viewport?.width;
    for (const task of record.tasks ?? []) {
      const key = `${task.category}::${task.referenceEvidence?.claim}::${task.expectedValue}::${task.currentValue}`;
      if (!byDimension.has(key)) {
        byDimension.set(key, {
          ...task,
          viewportsAffected: [],
          perViewportEvidence: []
        });
      }
      const entry = byDimension.get(key);
      entry.viewportsAffected.push(width);
      entry.perViewportEvidence.push({
        viewport: width,
        referenceEvidence: task.referenceEvidence,
        targetEvidence: task.targetEvidence,
        currentValue: task.currentValue,
        expectedValue: task.expectedValue,
        severity: task.severity,
        confidence: task.confidence
      });
    }
  }

  return [...byDimension.values()].map((t) => ({
    ...t,
    viewportsAffected: [...new Set(t.viewportsAffected)].sort((a, b) => b - a),
    /* A correction that holds at every compared viewport is global; one that
     * holds at some is viewport-specific, and saying which matters. */
    scope: t.viewportsAffected.length > 1 ? "global" : "viewport-specific",
    viewport: t.viewportsAffected.length === 1 ? t.viewportsAffected[0] : null
  }));
}

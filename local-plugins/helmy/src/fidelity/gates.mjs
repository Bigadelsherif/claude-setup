/**
 * Refusal gates.
 *
 * The loop refuses to compare rather than producing a fidelity score on
 * evidence that cannot support one. A score computed on degraded evidence is
 * worse than none, because it looks like a measurement.
 *
 * Gates 1–3 are reference-side and fire before the target is started. There is
 * no point launching an application to compare against a reference that cannot
 * support the comparison.
 */

import { SAFETY } from "../coverage/safety.mjs";

export const GATE = Object.freeze({
  REFERENCE_UNSAFE: "reference-unsafe-for-mode",
  REFERENCE_REGION_UNREACHED: "reference-primary-region-unreached",
  REFERENCE_CONTESTED: "reference-critical-claims-contested",
  TARGET_CAPTURE_INCOMPLETE: "target-capture-incomplete",
  VIEWPORT_MISMATCH: "viewport-mismatch",
  ASSETS_UNSTABLE: "fonts-or-assets-unstable",
  APP_START_FAILED: "target-application-failed-to-start",
  SCREENSHOT_STALE: "screenshot-stale",
  TARGET_COVERAGE_INSUFFICIENT: "target-ir-coverage-insufficient",
  REFERENCE_PROJECTIONS_STALE: "reference-projections-stale",
  REFERENCE_SAFETY_INTEGRITY: "reference-safety-gate-integrity"
});

/** Which gates can be evaluated before the target exists. */
export const REFERENCE_SIDE = new Set([
  GATE.REFERENCE_UNSAFE, GATE.REFERENCE_REGION_UNREACHED, GATE.REFERENCE_CONTESTED,
  GATE.REFERENCE_PROJECTIONS_STALE, GATE.REFERENCE_SAFETY_INTEGRITY
]);

const UNSAFE = new Set([SAFETY.INSUFFICIENT_COVERAGE, SAFETY.UNSAFE]);

const fail = (gate, measured, clears) => ({ gate, passed: false, measured, clears });
const pass = (gate, measured) => ({ gate, passed: true, measured, clears: null });

/**
 * Evaluates the reference-side gates.
 *
 * @param {object} referenceIR
 * @param {object} options.captureMeta  what the loading path recorded
 */
export function checkReference(referenceIR, { projectionsFresh = true, safetyIntegrity = true } = {}) {
  const checks = [];

  const status = referenceIR.safety?.status ?? null;
  checks.push(UNSAFE.has(status)
    ? fail(GATE.REFERENCE_UNSAFE, `safety.status = ${status}`,
        "Re-analyse the reference until it reaches `usable` or `usable-with-warnings` for the requested mode.")
    : pass(GATE.REFERENCE_UNSAFE, `safety.status = ${status}`));

  const reached = referenceIR.coverage?.contentReached ?? 0;
  checks.push(reached < 1
    ? fail(GATE.REFERENCE_REGION_UNREACHED, `coverage.contentReached = ${reached}`,
        "Recapture the reference so the primary content region is fully reached.")
    : pass(GATE.REFERENCE_REGION_UNREACHED, `coverage.contentReached = ${reached}`));

  const contested = referenceIR.contestedClaims ?? [];
  const criticalContested = contested.filter((c) => c.critical !== false);
  checks.push(criticalContested.length
    ? fail(GATE.REFERENCE_CONTESTED, `${criticalContested.length} contested critical claim(s)`,
        "Resolve the contested claims with a correction record, then regenerate.")
    : pass(GATE.REFERENCE_CONTESTED, "no contested critical claims"));

  checks.push(projectionsFresh
    ? pass(GATE.REFERENCE_PROJECTIONS_STALE, "projections match the IR hash")
    : fail(GATE.REFERENCE_PROJECTIONS_STALE, "projection IR-hash mismatch",
        "Regenerate the reference workspace so projections match the IR."));

  checks.push(safetyIntegrity
    ? pass(GATE.REFERENCE_SAFETY_INTEGRITY, "safety gate intact")
    : fail(GATE.REFERENCE_SAFETY_INTEGRITY, "V8 safety-gate integrity failed",
        "Investigate the workspace: artifacts exist that the safety gate should have withheld."));

  return checks;
}

/** Evaluates the target-side gates. */
export function checkTarget(targetIR, {
  referenceViewport, targetViewport, appStarted = true, assetsStable = true,
  screenshotIrHash = null, targetIrHash = null, captureTruncated = false, minCoverage = 0.3
} = {}) {
  const checks = [];

  checks.push(appStarted
    ? pass(GATE.APP_START_FAILED, "application started")
    : fail(GATE.APP_START_FAILED, "start() did not yield a reachable URL",
        "Fix the target application's start command or health check."));

  checks.push(!captureTruncated
    ? pass(GATE.TARGET_CAPTURE_INCOMPLETE, "capture complete")
    : fail(GATE.TARGET_CAPTURE_INCOMPLETE, "node cap reached or stylesheets blocked",
        "Raise the node cap or resolve the blocked stylesheets, then recapture."));

  checks.push(referenceViewport === targetViewport
    ? pass(GATE.VIEWPORT_MISMATCH, `${targetViewport}px both sides`)
    : fail(GATE.VIEWPORT_MISMATCH, `reference ${referenceViewport}px vs target ${targetViewport}px`,
        "Capture the target at the reference's viewport."));

  checks.push(assetsStable
    ? pass(GATE.ASSETS_UNSTABLE, "fonts ready and network idle")
    : fail(GATE.ASSETS_UNSTABLE, "fonts or network did not settle",
        "Increase the settle window or mask the unstable region."));

  /* A screenshot stamped with a different IR hash describes a different page
   * than the one being compared. */
  const stale = screenshotIrHash != null && targetIrHash != null && screenshotIrHash !== targetIrHash;
  checks.push(!stale
    ? pass(GATE.SCREENSHOT_STALE, screenshotIrHash ? "screenshot matches the target IR" : "no screenshot to check")
    : fail(GATE.SCREENSHOT_STALE, `screenshot ${screenshotIrHash} vs IR ${targetIrHash}`,
        "Retake the screenshot from the same capture that produced the target IR."));

  const factor = targetIR?.coverage?.coverageFactor ?? 0;
  checks.push(factor >= minCoverage
    ? pass(GATE.TARGET_COVERAGE_INSUFFICIENT, `coverageFactor = ${factor}`)
    : fail(GATE.TARGET_COVERAGE_INSUFFICIENT, `coverageFactor = ${factor}, below ${minCoverage}`,
        "Recapture the target; too little of it was sampled to compare."));

  return checks;
}

/**
 * A blocked comparison report.
 *
 * Emits NO category scores. A partial score is read as a low score, and the
 * whole point of refusing is to avoid publishing a number that looks like a
 * measurement of the target when it is a measurement of the evidence.
 */
export function blockedReport(checks, { stage, referenceSlug, targetSlug }) {
  const failed = checks.filter((c) => !c.passed);
  return {
    comparisonPerformed: false,
    stage,
    reference: referenceSlug,
    target: targetSlug,
    failedGates: failed.map((c) => ({ gate: c.gate, measured: c.measured, clears: c.clears })),
    passedGates: checks.filter((c) => c.passed).map((c) => c.gate),
    categories: null,
    compositeScore: null,
    statement:
      `No fidelity comparison was performed. ${failed.length} gate(s) failed at the ${stage} stage. ` +
      "No category scores were produced, because a score computed on this evidence would describe the evidence rather than the target."
  };
}

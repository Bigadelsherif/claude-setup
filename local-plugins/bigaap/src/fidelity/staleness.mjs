/**
 * Artifact staleness verification.
 *
 * Ten checks, run before any comparison. The one that matters most is the
 * extractor version: two IRs produced by different extractors are not
 * comparable, because a difference between them may be a change in what was
 * measured rather than a change in the target. Comparing them silently would
 * report the tool's own history as a fidelity finding.
 */

export const STALENESS = Object.freeze({
  REFERENCE_IR_HASH: "reference-ir-hash",
  TARGET_IR_HASH: "target-ir-hash",
  SCREENSHOT_HASH: "screenshot-hash",
  VIEWPORT_METADATA: "viewport-metadata",
  STATE_METADATA: "state-metadata",
  CAPTURE_TIMESTAMP: "capture-timestamp",
  SOURCE_URL: "source-url",
  DRIVER_VERSION: "driver-version",
  EXTRACTOR_VERSION: "extractor-version",
  TOLERANCE_VERSION: "tolerance-version"
});

export const VERDICT = Object.freeze({
  FRESH: "fresh",
  STALE: "stale",
  INCOMPATIBLE: "incompatible",
  UNVERIFIABLE: "unverifiable"
});

/** Default: a capture older than this is stale unless the caller says otherwise. */
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const check = (id, verdict, detail, remedy = null) => ({ check: id, verdict, detail, remedy });

/**
 * Verifies an artifact pair before comparison.
 *
 * Returns every check, not just the failures — a reader needs to know which
 * questions were asked as much as which were answered badly.
 */
export function verifyFreshness({
  reference, target, expected = {}, maxAgeMs = DEFAULT_MAX_AGE_MS, now = Date.now()
} = {}) {
  const checks = [];

  const hashPair = (id, actual, want, label) => {
    if (want == null) {
      checks.push(check(id, VERDICT.UNVERIFIABLE, `no expected ${label} was supplied, so freshness could not be verified`));
      return;
    }
    if (actual == null) {
      checks.push(check(id, VERDICT.STALE, `the artifact carries no ${label}`,
        "Recapture; an artifact without a hash cannot be shown to match the run."));
      return;
    }
    checks.push(actual === want
      ? check(id, VERDICT.FRESH, `${label} matches`)
      : check(id, VERDICT.STALE, `${label} is ${actual}, the run expects ${want}`,
          "Recapture, or re-run the analysis that produced the expected hash."));
  };

  hashPair(STALENESS.REFERENCE_IR_HASH, reference?.irHash, expected.referenceIrHash, "reference IR hash");
  hashPair(STALENESS.TARGET_IR_HASH, target?.irHash, expected.targetIrHash, "target IR hash");

  /* A screenshot stamped with a different IR hash describes a different page
   * than the one being compared. */
  if (target?.screenshotIrHash == null) {
    checks.push(check(STALENESS.SCREENSHOT_HASH, VERDICT.UNVERIFIABLE, "no screenshot was supplied for this comparison"));
  } else if (target.irHash && target.screenshotIrHash !== target.irHash) {
    checks.push(check(STALENESS.SCREENSHOT_HASH, VERDICT.STALE,
      `the screenshot is stamped ${target.screenshotIrHash} against an IR of ${target.irHash}`,
      "Retake the screenshot from the same capture that produced the target IR."));
  } else {
    checks.push(check(STALENESS.SCREENSHOT_HASH, VERDICT.FRESH, "the screenshot matches the target IR"));
  }

  const refVp = reference?.viewport ?? null;
  const tgtVp = target?.viewport ?? null;
  checks.push(refVp != null && tgtVp != null && refVp === tgtVp
    ? check(STALENESS.VIEWPORT_METADATA, VERDICT.FRESH, `both sides report ${refVp}px`)
    : check(STALENESS.VIEWPORT_METADATA, VERDICT.STALE,
        `reference ${refVp}px against target ${tgtVp}px`,
        "Capture both sides at the same viewport; a target is never compared against a reference from another."));

  const refState = reference?.state ?? "default";
  const tgtState = target?.state ?? "default";
  checks.push(refState === tgtState
    ? check(STALENESS.STATE_METADATA, VERDICT.FRESH, `both sides are in the \`${refState}\` state`)
    : check(STALENESS.STATE_METADATA, VERDICT.STALE, `reference \`${refState}\` against target \`${tgtState}\``,
        "Compare like states; a default capture is not evidence about a hover state."));

  const stamps = [reference?.capturedAt, target?.capturedAt].filter(Boolean).map((t) => new Date(t).getTime());
  if (stamps.length < 2) {
    checks.push(check(STALENESS.CAPTURE_TIMESTAMP, VERDICT.UNVERIFIABLE, "one or both captures carry no timestamp"));
  } else {
    const oldest = Math.min(...stamps);
    checks.push(now - oldest <= maxAgeMs
      ? check(STALENESS.CAPTURE_TIMESTAMP, VERDICT.FRESH,
          `oldest capture is ${Math.round((now - oldest) / 60000)} minute(s) old`)
      : check(STALENESS.CAPTURE_TIMESTAMP, VERDICT.STALE,
          `oldest capture is ${Math.round((now - oldest) / 3600000)} hour(s) old, past the ${Math.round(maxAgeMs / 3600000)}h window`,
          "Recapture. A target may have been redeployed since."));
  }

  if (!reference?.sourceUrl || !target?.sourceUrl) {
    checks.push(check(STALENESS.SOURCE_URL, VERDICT.UNVERIFIABLE, "a source URL is missing on one side"));
  } else {
    checks.push(check(STALENESS.SOURCE_URL, VERDICT.FRESH,
      `reference ${reference.sourceUrl}, target ${target.sourceUrl}`));
  }

  const versionCheck = (id, a, b, label, incompatibleIsFatal) => {
    if (a == null || b == null) {
      checks.push(check(id, VERDICT.UNVERIFIABLE, `${label} missing on one side`,
        "Recapture with a driver that stamps its version."));
      return;
    }
    if (a === b) { checks.push(check(id, VERDICT.FRESH, `${label} ${a} on both sides`)); return; }
    checks.push(check(id, incompatibleIsFatal ? VERDICT.INCOMPATIBLE : VERDICT.STALE,
      `${label} differs: ${a} against ${b}`,
      incompatibleIsFatal
        ? "Recapture both sides with one version. A difference between them may be a change in what was measured rather than in the target."
        : "Recapture for a like-for-like comparison."));
  };

  versionCheck(STALENESS.DRIVER_VERSION, reference?.driverVersion, target?.driverVersion, "driver version", false);
  versionCheck(STALENESS.EXTRACTOR_VERSION, reference?.extractorVersion, target?.extractorVersion, "extractor version", true);
  versionCheck(STALENESS.TOLERANCE_VERSION, reference?.toleranceVersion, target?.toleranceVersion, "tolerance version", true);

  const incompatible = checks.filter((c) => c.verdict === VERDICT.INCOMPATIBLE);
  const stale = checks.filter((c) => c.verdict === VERDICT.STALE);
  const unverifiable = checks.filter((c) => c.verdict === VERDICT.UNVERIFIABLE);

  return {
    checks,
    comparable: incompatible.length === 0 && stale.length === 0,
    verdict: incompatible.length ? VERDICT.INCOMPATIBLE : stale.length ? VERDICT.STALE : VERDICT.FRESH,
    incompatible: incompatible.map((c) => c.check),
    stale: stale.map((c) => c.check),
    unverifiable: unverifiable.map((c) => c.check),
    statement: incompatible.length
      ? `Refused: ${incompatible.map((c) => c.check).join(", ")}. Artifacts from incompatible versions are not compared.`
      : stale.length
        ? `Refused: ${stale.map((c) => c.check).join(", ")} stale. Recapture rather than compare.`
        : unverifiable.length
          ? `Comparable, with ${unverifiable.length} check(s) unverifiable — recorded rather than assumed to pass.`
          : "All ten freshness checks pass."
  };
}

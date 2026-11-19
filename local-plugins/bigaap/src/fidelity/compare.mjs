/**
 * IR comparison — the primary fidelity mechanism.
 *
 * Reference IR and target IR are produced by the same extractor, probe,
 * evidence grader and IR derivation, so their vocabularies are identical by
 * construction and a difference between them means something.
 *
 * Component-level matching is deliberately NOT load-bearing here. Test 19
 * measured the Phase 3.2 matcher against an independent implementation and got
 * precision 1.000 with recall 0.444 (def_0030): it never pairs the wrong
 * components, and it fails to pair most of them. Comparison therefore runs at
 * category and region level, and component identity is reported as resolved or
 * unresolved rather than assumed.
 */

import { TOLERANCE } from "../evidence/disagreement.mjs";

export const SEVERITY = Object.freeze({
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  INFORMATIONAL: "informational"
});

export const CATEGORY = Object.freeze({
  REGION_COVERAGE: "region-coverage",
  LAYOUT: "layout",
  TYPOGRAPHY: "typography",
  SPACING: "spacing",
  COLOR: "color",
  COMPONENTS: "components",
  STATES: "states",
  RESPONSIVE: "responsive",
  MOTION: "motion",
  ACCESSIBILITY: "accessibility",
  PIXEL_ONLY: "pixel-only"
});

/**
 * Tolerances, all inherited from the disagreement analyser so the fidelity loop
 * and the cross-source analyser cannot drift apart on what "the same value"
 * means.
 *
 * EVERY VALUE HERE IS UNVALIDATED. They were chosen, not measured, and the
 * report says so wherever a comparison depends on one.
 */
export const TOLERANCES = Object.freeze({
  px: TOLERANCE.px,
  ratio: TOLERANCE.ratio,
  colorDistance: TOLERANCE.colorDistance,
  ms: TOLERANCE.ms,
  fontSizePx: 0.5,
  shadowPx: 2,
  contrastRatio: 0.05,
  /** Instance counts vary with content length, not with fidelity. */
  countRelative: 0.4,
  $validated: false,
  $note: "Chosen, not measured. See PHASE-3.4-FIDELITY-PLAN.md §14.10."
});

/** Statuses that may never be compared — §4.3 admissibility. */
const INADMISSIBLE = new Set(["unknown"]);
/** Statuses admissible only when the comparator opts into degraded evidence. */
const DEGRADED = new Set(["estimated"]);

/**
 * Is this claim pair comparable at all?
 *
 * Returns a reason when it is not. An uncompared dimension must be LISTED,
 * never silently omitted — silence about a dimension reads as agreement.
 */
export function admissibility(reference, target, { supportsDegradedEvidence = false, contested = new Set() } = {}) {
  if (reference == null && target == null) return { admissible: false, reason: "absent on both sides" };
  if (reference == null) return { admissible: false, reason: "absent in the reference" };
  if (target == null) return { admissible: false, reason: "absent in the target" };

  if (INADMISSIBLE.has(reference.status)) return { admissible: false, reason: "reference claim is unknown" };
  if (INADMISSIBLE.has(target.status)) return { admissible: false, reason: "target claim is unknown" };

  if (contested.has(reference.claim)) {
    return { admissible: false, reason: "reference claim is contested-critical" };
  }

  const degraded = DEGRADED.has(reference.status) || DEGRADED.has(target.status);
  if (degraded && !supportsDegradedEvidence) {
    return { admissible: false, reason: "screenshot-estimated evidence; this comparator does not support degraded evidence" };
  }

  return { admissible: true, degraded, reason: null };
}

/**
 * Severity depends on the claims' STATUS as much as on the size of the gap.
 *
 * A 4px difference between two measured values is a real difference. A 40px
 * difference where one side is estimated is not a finding about the target — the
 * estimate could never have supported the assertion.
 */
export function severityFor({ referenceStatus, targetStatus, ratioOverTolerance, degraded, kind = "value" }) {
  if (degraded) return SEVERITY.INFORMATIONAL;
  if (kind === "structural") return SEVERITY.CRITICAL;

  const weakest = [referenceStatus, targetStatus].includes("inferred") ? "inferred" : "measured";
  if (weakest === "inferred") {
    return ratioOverTolerance > 2 ? SEVERITY.MEDIUM : SEVERITY.LOW;
  }
  if (ratioOverTolerance > 2) return SEVERITY.HIGH;
  if (ratioOverTolerance > 1) return SEVERITY.MEDIUM;
  return SEVERITY.LOW;
}

let diffSeq = 0;
const nextId = () => `diff_${String(++diffSeq).padStart(4, "0")}`;
export const resetDiffIds = () => { diffSeq = 0; };

/** Builds a difference record with all eleven required fields. */
export function difference({
  dimension, category, reference, target, absolute, unit, tolerance, toleranceSource,
  severity, affects, recommendedCorrection, automaticallyActionable, notActionableBecause = null, note = null
}) {
  const relative = reference?.value ? Math.abs(absolute / Number(reference.value)) : null;
  return {
    id: nextId(),
    dimension,
    category,
    referenceValue: reference?.value ?? null,
    referenceStatus: reference?.status ?? null,
    referenceEvidence: reference?.evidence ?? [],
    targetValue: target?.value ?? null,
    targetStatus: target?.status ?? null,
    targetEvidence: target?.evidence ?? [],
    difference: { absolute, unit, relative: relative == null ? null : Number(relative.toFixed(4)) },
    tolerance: { value: tolerance, unit, source: toleranceSource, validated: false },
    severity,
    /* Never more confident than the weaker input. */
    confidence: Math.min(reference?.confidence ?? 0, target?.confidence ?? 0),
    affects,
    recommendedCorrection,
    automaticallyActionable,
    notActionableBecause,
    note
  };
}

/** A dimension that could not be compared, recorded rather than dropped. */
export function skipped(dimension, category, reason) {
  return { dimension, category, compared: false, reason };
}

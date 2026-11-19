/**
 * The five-status vocabulary and the confidence arithmetic derived from it.
 *
 * The distinction that matters is HOW a number came to exist, not how sure we
 * feel about it. Feeling is derived; provenance is recorded.
 */

export const STATUS = Object.freeze({
  MEASURED: "measured",   // physical geometry read off the rendered layout
  OBSERVED: "observed",   // declared in a style source and read back directly
  INFERRED: "inferred",   // derived from a pattern across >= 3 measured/observed samples
  ESTIMATED: "estimated", // reconstructed from a screenshot or a partial signal
  UNKNOWN: "unknown"      // could not be determined
});

export const ALL_STATUSES = Object.freeze(Object.values(STATUS));

export const METHOD = Object.freeze({
  LAYOUT_RECT: "layout-rect",
  COMPUTED_STYLE: "computed-style",
  CSS_CUSTOM_PROPERTY: "css-custom-property",
  STYLESHEET_RULE: "stylesheet-rule",
  MEDIA_QUERY: "media-query",
  FREQUENCY_INFERENCE: "frequency-inference",
  STRUCTURAL_INFERENCE: "structural-inference",
  VISION: "vision",
  USER_CORRECTION: "user-correction",

  /* Motion observation (M2a).
   *
   * `RUNTIME_OBSERVATION` is a state change read off the live DOM between two
   * timestamped samples. It reaches `measured` because the CHANGE was directly
   * observed — not because the value it reports came from a declaration. That
   * is the difference between "this element declares a 600ms fade" and "this
   * element's opacity went 0 to 1 between these two instants".
   *
   * `RUNTIME_CORRELATION` is a relationship across several observations, and
   * caps at `inferred` for the same reason every other correlation does: it was
   * derived, not read. */
  RUNTIME_OBSERVATION: "runtime-observation",
  RUNTIME_CORRELATION: "runtime-correlation"
});

/* ------------------------------------------------------------------------ */
/* Phase 2: source and technique are separated.                             */
/*                                                                          */
/* `method` conflated WHERE evidence came from with HOW it was derived,      */
/* which makes it impossible to compare two sources for the same claim —     */
/* exactly what the disagreement rules need to do.                          */
/* ------------------------------------------------------------------------ */

export const SOURCE = Object.freeze({
  DOM: "dom",
  COMPUTED_STYLE: "computed-style",
  SCREENSHOT: "screenshot",
  VISUAL_MODEL: "visual-model",
  USER_CORRECTION: "user-correction"
});

export const TECHNIQUE = Object.freeze({
  DIRECT_READ: "direct-read",
  LAYOUT_MEASURE: "layout-measure",
  FREQUENCY_INFERENCE: "frequency-inference",
  STRUCTURAL_INFERENCE: "structural-inference",
  ASSERTION: "assertion",

  /* Screenshot techniques. Named separately from the DOM ones because the
   * disagreement rules need to know not just that two records differ, but by
   * what means each was arrived at. */
  VISUAL_OBSERVATION: "visual-observation",
  PIXEL_MEASUREMENT: "pixel-measurement",
  OCR: "OCR",
  REGION_COMPARISON: "region-comparison",

  /** @deprecated superseded by PIXEL_MEASUREMENT / VISION under the screenshot path */
  PIXEL_MEASURE: "pixel-measure",
  VISION_ESTIMATE: "vision-estimate",

  /* Sampling the same target at two instants and diffing. */
  RUNTIME_OBSERVATION: "runtime-observation",
  /* Relating several runtime observations to each other. */
  RUNTIME_CORRELATION: "runtime-correlation"
});

/**
 * The ceiling each source may reach, enforced rather than advised.
 *
 * No code path may promote a screenshot-derived record above `estimated`.
 * This is what makes the screenshot policy mechanically true instead of a
 * convention people remember to follow.
 */
const SOURCE_MAX_STATUS = Object.freeze({
  [SOURCE.DOM]: STATUS.MEASURED,
  [SOURCE.COMPUTED_STYLE]: STATUS.OBSERVED,
  [SOURCE.SCREENSHOT]: STATUS.ESTIMATED,
  [SOURCE.VISUAL_MODEL]: STATUS.ESTIMATED,
  [SOURCE.USER_CORRECTION]: STATUS.MEASURED
});

/** Trust ordering used when two sources contest the same claim. */
export const SOURCE_RANK = Object.freeze({
  [SOURCE.USER_CORRECTION]: 0,
  [SOURCE.DOM]: 1,
  [SOURCE.COMPUTED_STYLE]: 2,
  [SOURCE.SCREENSHOT]: 3,
  [SOURCE.VISUAL_MODEL]: 4
});

const STATUS_RANK = {
  [STATUS.MEASURED]: 4,
  [STATUS.OBSERVED]: 3,
  [STATUS.INFERRED]: 2,
  [STATUS.ESTIMATED]: 1,
  [STATUS.UNKNOWN]: 0
};

/** Clamps a status to what its source can legitimately support. */
export function capStatusForSource(status, source) {
  const ceiling = SOURCE_MAX_STATUS[source];
  if (!ceiling) return status;
  return STATUS_RANK[status] > STATUS_RANK[ceiling] ? ceiling : status;
}

export function maxStatusForSource(source) {
  return SOURCE_MAX_STATUS[source] ?? STATUS.UNKNOWN;
}

/** Legacy `method` values map onto the new pair. */
const METHOD_MIGRATION = {
  [METHOD.LAYOUT_RECT]: [SOURCE.DOM, TECHNIQUE.LAYOUT_MEASURE],
  [METHOD.COMPUTED_STYLE]: [SOURCE.COMPUTED_STYLE, TECHNIQUE.DIRECT_READ],
  [METHOD.CSS_CUSTOM_PROPERTY]: [SOURCE.COMPUTED_STYLE, TECHNIQUE.DIRECT_READ],
  [METHOD.STYLESHEET_RULE]: [SOURCE.COMPUTED_STYLE, TECHNIQUE.DIRECT_READ],
  [METHOD.MEDIA_QUERY]: [SOURCE.COMPUTED_STYLE, TECHNIQUE.DIRECT_READ],
  [METHOD.FREQUENCY_INFERENCE]: [SOURCE.COMPUTED_STYLE, TECHNIQUE.FREQUENCY_INFERENCE],
  [METHOD.STRUCTURAL_INFERENCE]: [SOURCE.DOM, TECHNIQUE.STRUCTURAL_INFERENCE],
  [METHOD.VISION]: [SOURCE.SCREENSHOT, TECHNIQUE.VISION_ESTIMATE],
  [METHOD.USER_CORRECTION]: [SOURCE.USER_CORRECTION, TECHNIQUE.ASSERTION],
  /* SOURCE.DOM, because the live document is what was sampled. Under
   * SOURCE.COMPUTED_STYLE the ceiling would cap these at `observed` and a
   * directly observed change could never be recorded as measured. */
  [METHOD.RUNTIME_OBSERVATION]: [SOURCE.DOM, TECHNIQUE.RUNTIME_OBSERVATION],
  [METHOD.RUNTIME_CORRELATION]: [SOURCE.DOM, TECHNIQUE.RUNTIME_CORRELATION]
};

export function sourceForMethod(method) {
  return METHOD_MIGRATION[method]?.[0] ?? SOURCE.COMPUTED_STYLE;
}

export function techniqueForMethod(method) {
  return METHOD_MIGRATION[method]?.[1] ?? TECHNIQUE.DIRECT_READ;
}

/** How much a disagreement should cost, scaled to how large it is. */
export function disagreementPenalty({ delta, unit = "px" }) {
  if (delta == null) return 1;
  const magnitude = Math.abs(delta);
  if (unit === "px") {
    if (magnitude <= 1) return 0.95;   // sub-pixel rendering noise
    if (magnitude <= 2) return 0.8;
    if (magnitude <= 4) return 0.65;
    return 0.5;
  }
  return magnitude === 0 ? 1 : 0.65;
}

/** Below this, a discrepancy is rendering noise rather than a finding. */
export const MATERIAL_DISAGREEMENT = Object.freeze({ px: 2, deltaE: 5 });

/** Which status a given extraction method can legitimately produce. */
const METHOD_STATUS = {
  [METHOD.LAYOUT_RECT]: STATUS.MEASURED,
  [METHOD.COMPUTED_STYLE]: STATUS.OBSERVED,
  [METHOD.CSS_CUSTOM_PROPERTY]: STATUS.OBSERVED,
  [METHOD.STYLESHEET_RULE]: STATUS.OBSERVED,
  [METHOD.MEDIA_QUERY]: STATUS.OBSERVED,
  [METHOD.FREQUENCY_INFERENCE]: STATUS.INFERRED,
  [METHOD.STRUCTURAL_INFERENCE]: STATUS.INFERRED,
  [METHOD.VISION]: STATUS.ESTIMATED,
  [METHOD.USER_CORRECTION]: STATUS.MEASURED,
  [METHOD.RUNTIME_OBSERVATION]: STATUS.MEASURED,
  [METHOD.RUNTIME_CORRELATION]: STATUS.INFERRED
};

export function statusForMethod(method) {
  return METHOD_STATUS[method] ?? STATUS.UNKNOWN;
}

const BASE_CONFIDENCE = {
  [STATUS.MEASURED]: 1.0,
  [STATUS.OBSERVED]: 0.95,
  [STATUS.INFERRED]: 0.75,
  [STATUS.ESTIMATED]: 0.45,
  [STATUS.UNKNOWN]: 0
};

/**
 * confidence = base(status) x agreement x sampleFactor
 * Never authored by hand — a hand-set confidence is an opinion wearing a number.
 */
export function confidenceFor({ status, sampleSize = 1, agreement = 1 }) {
  const base = BASE_CONFIDENCE[status] ?? 0;
  if (base === 0) return 0;
  const sampleFactor = Math.min(1, 0.6 + 0.1 * Math.max(0, sampleSize));
  const clampedAgreement = Math.max(0, Math.min(1, agreement));
  return Math.round(base * clampedAgreement * sampleFactor * 1000) / 1000;
}

/** Values a projection is allowed to render as an exact measurement. */
export function isExact(status) {
  return status === STATUS.MEASURED || status === STATUS.OBSERVED;
}

/** Statuses that must be visibly hedged wherever they appear. */
export function requiresHedge(status) {
  return status === STATUS.ESTIMATED || status === STATUS.UNKNOWN || status === STATUS.INFERRED;
}

export const STATUS_LABEL = Object.freeze({
  [STATUS.MEASURED]: "measured",
  [STATUS.OBSERVED]: "observed",
  [STATUS.INFERRED]: "inferred",
  [STATUS.ESTIMATED]: "estimated (not exact)",
  [STATUS.UNKNOWN]: "unknown"
});

/**
 * Spacing-scale inference.
 *
 * Phase 1 took the largest divisor explaining >=80% of observations and asserted
 * it. On a page with no consistent rhythm that manufactures a 4px system out of
 * noise — because almost every integer is divisible by 4 often enough to clear
 * a single threshold.
 *
 * The rule this module enforces: **the agent must not force every page into a
 * 4px or 8px system.** A page with a 6px rhythm gets 6. A page with no rhythm
 * gets `unknown`, and that is a correct answer.
 */

const round3 = (n) => Math.round(n * 1000) / 1000;

/** Bases worth testing, including the fractional ones real design systems use. */
const CANDIDATE_BASES = [
  2, 3, 4, 4.5, 5, 6, 6.5, 7, 8, 9, 10, 12, 14, 16, 18, 20, 24
];

export const SPACING_THRESHOLDS = Object.freeze({
  /** Coverage above which a base may be asserted with high confidence. */
  strong: 0.85,
  /** Coverage below which no base is claimed at all. */
  floor: 0.7,
  /** Margin the winner must hold over the runner-up to be unambiguous. */
  margin: 0.15,
  /** Below this margin two candidates are treated as indistinguishable. */
  ambiguous: 0.05,
  /**
   * The smallest base worth claiming.
   *
   * A 2px base "explains" every value on any page whose spacing happens to be
   * even, and a 1px base explains everything everywhere. Those are arithmetic
   * facts, not design systems. If nothing at or above this threshold fits, the
   * honest answer is that the page has no base unit.
   */
  minMeaningfulBase: 4
});

const divides = (value, base) => {
  const q = value / base;
  return Math.abs(q - Math.round(q)) < 1e-6;
};

/**
 * Scores every candidate base by frequency-weighted coverage.
 * Returns the full ranking — the runner-up is what makes ambiguity visible.
 */
export function scoreBases(entries) {
  const values = entries
    .map((e) => ({ px: typeof e.value === "number" ? e.value : Number.parseFloat(e.value), count: e.count ?? 1 }))
    .filter((v) => Number.isFinite(v.px) && v.px > 0);

  if (!values.length) return [];
  const weight = values.reduce((s, v) => s + v.count, 0);

  return CANDIDATE_BASES.map((base) => {
    const explained = values
      .filter((v) => divides(v.px, base))
      .reduce((s, v) => s + v.count, 0);
    return {
      base,
      coverage: round3(explained / weight),
      explainedWeight: explained,
      totalWeight: weight
    };
  })
    .filter((c) => c.coverage > 0)
    .sort((a, b) => {
      if (b.coverage !== a.coverage) return b.coverage - a.coverage;
      // A larger base explaining the same share is the more meaningful claim:
      // every multiple of 8 is also a multiple of 4, so 4 always ties or beats
      // 8 on coverage while saying strictly less about the design.
      return b.base - a.base;
    });
}

/**
 * Decides whether a base unit may be claimed, and how strongly.
 *
 * Returns a verdict object rather than a bare number, because "we could not
 * tell" is a first-class outcome here rather than an error.
 */
/**
 * Two bases are RIVALS only if neither divides the other.
 *
 * 2px and 4px are not competing hypotheses: every multiple of 4 is a multiple
 * of 2, so 2 can never score lower and comparing them says nothing. 6px and 8px
 * are genuine rivals, and a page where both fit equally well genuinely has no
 * determinable base.
 */
function areRivals(a, b) {
  const ratio = Math.max(a, b) / Math.min(a, b);
  return Math.abs(ratio - Math.round(ratio)) > 1e-6;
}

export function inferSpacingBase(entries) {
  const ranked = scoreBases(entries);
  const distinctValues = new Set(
    entries.map((e) => (typeof e.value === "number" ? e.value : Number.parseFloat(e.value)))
  ).size;

  if (ranked.length === 0 || distinctValues < 3) {
    return {
      decided: false,
      base: null,
      confidenceFactor: 0,
      coverage: 0,
      alternatives: ranked.slice(0, 3),
      reason: `Only ${distinctValues} distinct spacing value(s) observed; a scale cannot be inferred from that.`
    };
  }

  const clearsFloor = ranked.filter((c) => c.coverage >= SPACING_THRESHOLDS.floor);
  const qualifying = clearsFloor.filter((c) => c.base >= SPACING_THRESHOLDS.minMeaningfulBase);

  if (!qualifying.length) {
    const best = ranked[0];
    const trivial = clearsFloor.find((c) => c.base < SPACING_THRESHOLDS.minMeaningfulBase);

    if (trivial) {
      return {
        decided: false,
        base: null,
        confidenceFactor: 0,
        coverage: trivial.coverage,
        alternatives: ranked.slice(0, 3),
        reason:
          `Only trivial divisors fit: ${trivial.base}px explains ${Math.round(trivial.coverage * 100)}% of ` +
          `observed spacing, but no base of ${SPACING_THRESHOLDS.minMeaningfulBase}px or above clears the ` +
          `${Math.round(SPACING_THRESHOLDS.floor * 100)}% floor. A ${trivial.base}px divisor is an arithmetic ` +
          "property of the numbers, not a spacing system."
      };
    }

    return {
      decided: false,
      base: null,
      confidenceFactor: 0,
      coverage: best.coverage,
      alternatives: ranked.slice(0, 3),
      reason:
        `No candidate base explains more than ${Math.round(best.coverage * 100)}% of observed spacing ` +
        `(floor is ${Math.round(SPACING_THRESHOLDS.floor * 100)}%). This page has no consistent spacing rhythm.`
    };
  }

  // The largest qualifying base is the most specific claim the evidence
  // supports. Choosing the highest-coverage base instead would always collapse
  // to 1 or 2px, which is true of almost any page and says nothing.
  const chosen = qualifying.reduce((a, b) => (b.base > a.base ? b : a));

  // A rival is a qualifying base that neither divides nor is divided by the
  // chosen one, and that explains the observations comparably well.
  const rival = qualifying.find(
    (c) =>
      c.base !== chosen.base &&
      areRivals(c.base, chosen.base) &&
      c.coverage >= chosen.coverage - SPACING_THRESHOLDS.ambiguous
  );

  const alternatives = qualifying
    .filter((c) => c.base !== chosen.base)
    .slice(0, 3);

  if (rival) {
    return {
      decided: false,
      base: null,
      confidenceFactor: 0,
      coverage: chosen.coverage,
      alternatives: [chosen, rival, ...alternatives].slice(0, 3),
      reason:
        `Bases ${chosen.base}px and ${rival.base}px explain the observations almost equally ` +
        `(${Math.round(chosen.coverage * 100)}% vs ${Math.round(rival.coverage * 100)}%) and neither is a ` +
        `multiple of the other. The scale is ambiguous.`
    };
  }

  const nextRival = ranked.find((c) => c.base !== chosen.base && areRivals(c.base, chosen.base));
  const margin = nextRival ? round3(chosen.coverage - nextRival.coverage) : 1;
  const strong = chosen.coverage >= SPACING_THRESHOLDS.strong && margin >= SPACING_THRESHOLDS.margin;

  return {
    decided: true,
    base: chosen.base,
    coverage: chosen.coverage,
    margin,
    confidenceFactor: strong ? 1 : 0.7,
    strength: strong ? "strong" : "weak",
    alternatives,
    sampleSize: distinctValues,
    reason: strong
      ? `Base ${chosen.base}px explains ${Math.round(chosen.coverage * 100)}% of observed spacing, ` +
        `ahead of the nearest rival ${nextRival ? `${nextRival.base}px` : "(none)"} by ${Math.round(margin * 100)} points.`
      : `Base ${chosen.base}px explains ${Math.round(chosen.coverage * 100)}% of observed spacing, but the ` +
        `margin over ${nextRival ? `${nextRival.base}px` : "the nearest rival"} is only ${Math.round(margin * 100)} points.`
  };
}

/**
 * The ramp for a decided base: observed values that sit on it, including the
 * half-step.
 *
 * A 4px step on an 8px grid is a legitimate published ramp entry, not noise —
 * design systems routinely expose one sub-unit for tight pairs. Excluding it
 * would misreport the fixture, whose declared ramp starts at 4 on a base of 8.
 *
 * Fractional observations are kept as observed and never rounded to fit.
 */
export function rampForBase(entries, base) {
  const step = base / 2;
  const values = entries
    .map((e) => (typeof e.value === "number" ? e.value : Number.parseFloat(e.value)))
    .filter((v) => Number.isFinite(v) && v > 0 && v <= 256 && divides(v, step));
  return [...new Set(values)].sort((a, b) => a - b);
}

/** Splits a ramp into on-base steps and half-steps, for honest reporting. */
export function describeRamp(ramp, base) {
  const onBase = ramp.filter((v) => divides(v, base));
  const halfSteps = ramp.filter((v) => !divides(v, base));
  return { onBase, halfSteps };
}

/**
 * When no base is decided, the observed values are still real. They are
 * reported as observations with no scale claim attached — which is the honest
 * form of "here is what is on the page, and no, it is not a system".
 */
export function observedValues(entries, limit = 24) {
  const values = entries
    .map((e) => (typeof e.value === "number" ? e.value : Number.parseFloat(e.value)))
    .filter((v) => Number.isFinite(v) && v > 0 && v <= 256);
  return [...new Set(values)].sort((a, b) => a - b).slice(0, limit);
}

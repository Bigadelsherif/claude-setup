/**
 * Per-tolerance validation status.
 *
 * `TOLERANCES.$validated` is a single boolean over a set of seventeen
 * independently-evidenced things. It can only ever say "all of them" or "none
 * of them", and both are wrong once the entries diverge — which they now have:
 * two are validated by exhaustive enumeration and one cannot be validated at
 * all until a prior question is answered.
 *
 * A flag that cannot express that will be read as though it could. So the
 * status lives here, per entry, and the boolean is derived from it rather than
 * asserted beside it.
 *
 * **Backward compatibility is deliberate and load-bearing.** `TOLERANCES.$validated`
 * keeps its meaning exactly: `true` only when every entry is `validated`.
 * Nothing that reads the flag needs to change, and the flag cannot become
 * `true` while any entry is not — which is the property the audit checks.
 */

/**
 * The statuses, weakest first.
 *
 * `provisionally-supported` is not a near-miss for `validated`. It means the
 * rule holds on independent evidence but the evidence cannot close the
 * question — usually because the input space is open-ended, and no finite
 * fixture set closes an open-ended space.
 */
export const STATUS = Object.freeze({
  /** Evidence exists but does not support the value; or none has been gathered. */
  UNVALIDATED: "unvalidated",
  /** One case exercises it. One case is an example, not evidence. */
  BLOCKED_BY_SOURCE_LIMIT: "blocked-by-source-limit",
  /** Independent evidence supports it; the input space is open, so it cannot close. */
  PROVISIONALLY_SUPPORTED: "provisionally-supported",
  /** A prior question must be answered before the value means anything. */
  BLOCKED_ON_DEFINITION: "blocked-on-definition",
  /** Exhaustively enumerated, or supported by independent evidence either side of the boundary. */
  VALIDATED: "validated"
});

export const ALL_STATUSES = Object.freeze(Object.values(STATUS));

/**
 * What each status licenses.
 *
 * Written down because "provisionally-supported" reads like a soft yes and is
 * not one, and because a reader deciding whether to trust a score needs to know
 * what the number behind it rests on.
 */
export const STATUS_MEANING = Object.freeze({
  [STATUS.UNVALIDATED]:
    "No independent evidence supports this value. It is defensible and unmeasured. A finding that turns on it is a measurement against a chosen constant.",
  [STATUS.BLOCKED_BY_SOURCE_LIMIT]:
    "A single case exercises it. One case cannot distinguish a correct threshold from a lucky one.",
  [STATUS.PROVISIONALLY_SUPPORTED]:
    "Independent evidence supports the rule and found no counter-example, but the input space is open-ended, so absence of a counter-example is weak evidence of absence.",
  [STATUS.BLOCKED_ON_DEFINITION]:
    "The value cannot be validated because what it measures is undefined. Validating it would produce a number settled on an unknown scale, which is worse than an unvalidated one because it looks decided.",
  [STATUS.VALIDATED]:
    "Either exhaustively enumerated over a finite space, or supported by independent evidence on both sides of the boundary with no case authored from the constant."
});

/**
 * The current status of every calibrated entry.
 *
 * `evidence` states what was actually done. `blocks` names what must happen
 * before the status can improve — absent for entries already `validated`.
 */
export const TOLERANCE_STATUS = Object.freeze({
  "TOLERANCES.px": {
    status: STATUS.PROVISIONALLY_SUPPORTED,
    value: 1.5,
    evidence: "Four calibration fixtures across layout and spacing, two of them rendering-derived (fractional layout, antialiasing). Boundary located at 1.5px / 1.6px.",
    blocks: "Rendering-derived evidence from targets that did not produce the value, either side of the boundary."
  },
  "TOLERANCES.fontSizePx": {
    status: STATUS.PROVISIONALLY_SUPPORTED,
    value: 0.5,
    evidence: "Two fixtures, rendering-derived (font rasterisation). Boundary located at 0.5px / 0.6px.",
    blocks: "More than two independent cases."
  },
  "pixelDiff.channelTolerance": {
    status: STATUS.PROVISIONALLY_SUPPORTED,
    value: 12,
    evidence: "Two fixtures, rendering-derived (image compression, antialiasing).",
    blocks: "More than two independent cases, and the same axis question as `TOLERANCES.colorDistance`."
  },

  "TOLERANCES.colorDistance": {
    status: STATUS.BLOCKED_ON_DEFINITION,
    value: 12,
    evidence:
      "Two fixtures agree with the current value, and the boundary sits between 4 and 8 channel steps. " +
      "But the axis is undefined: 12 in Euclidean RGB, 12 in CIE ΔE2000 and 12 in per-channel maximum are three different tolerances, and the code does not say which is meant.",
    blocks:
      "Define the perceptual axis first. Until then the number cannot be validated, because there is nothing to validate it against — a distance without a metric is not a quantity. Candidate cand_01 stays open.",
    candidate: "cand_01"
  },

  "intrinsic.intentMarkers": {
    status: STATUS.PROVISIONALLY_SUPPORTED,
    value: "data-scrollable / data-decorative / aria-hidden / role=presentation / name stems",
    evidence: "Two fixtures — a deliberate overflow and a deliberate overlay — both correctly suppressed.",
    blocks:
      "The marker vocabulary is open-ended. A site can express intent in a way the list does not contain, and no finite fixture set closes that. This cannot reach `validated` by adding fixtures."
  },
  "intrinsic.contentComparable": {
    status: STATUS.PROVISIONALLY_SUPPORTED,
    value: "same src required for a crop claim",
    evidence: "Two fixtures: identical source cropped, and different sources of similar appearance. No crop claim across differing sources.",
    blocks: "Adversarial cases — same source with different query strings, one image served from two hosts, a `srcset` resolving differently by viewport."
  },
  "state.propertyComparison": {
    status: STATUS.PROVISIONALLY_SUPPORTED,
    value: "delta from rest; 1.5px numeric, 12 colour distance",
    evidence: "Two fixtures, plus the def_0031 regression: a layout difference does not make an unchanged state report a mismatch.",
    blocks:
      "This rule composes `TOLERANCES.px` and `TOLERANCES.colorDistance`. It cannot exceed the weaker of its inputs, and one of those is blocked on a definition. The RULE is supported; the NUMBERS are not this entry's to validate."
  },

  "severityFor": {
    status: STATUS.VALIDATED,
    value: "status-aware severity ladder",
    evidence:
      "Exhaustively enumerated: every (reference status × target status × magnitude band × degraded × kind) combination, each with its expected severity declared before the function was called. " +
      "The space is finite and every cell is covered, so this is validation rather than sampling.",
    blocks: null,
    note:
      "Spec-derived evidence is correct here. The ladder is a policy about evidence quality, not a measurement of rendering — there is no physical quantity for rendering-derived evidence to measure."
  },
  "admissibility": {
    status: STATUS.VALIDATED,
    value: "unknown and contested are inadmissible",
    evidence:
      "Exhaustively enumerated: the full status matrix on both sides, with and without the degraded-evidence opt-in and with and without a contested claim. Every cell pre-declared.",
    blocks: null,
    note: "Same reasoning as `severityFor`: a finite policy, enumerated rather than sampled."
  },

  /* Entries a single case exercises. Unchanged by Phase 4.9 and listed so the
   * set is complete rather than only the interesting parts of it. */
  "intrinsic.tapMinimum": { status: STATUS.BLOCKED_BY_SOURCE_LIMIT, value: 44, evidence: "One calibration case. It is a CONFIGURED POLICY rather than a measured threshold, so what could be validated is that the chosen policy propagates, not that 44 is the right number.", blocks: "It is a configured policy, not a measurement; validation means confirming propagation, which the tap-target tests already do." },
  "intrinsic.overflowPx": { status: STATUS.BLOCKED_BY_SOURCE_LIMIT, value: 1, evidence: "One calibration case. A single case cannot distinguish a correct one-pixel floor from a lucky one.", blocks: "A second independent case." },
  "intrinsic.samplePoints": { status: STATUS.BLOCKED_BY_SOURCE_LIMIT, value: 3, evidence: "One calibration case. Three sample points was chosen for cost, and no case tests whether a fourth would change a finding.", blocks: "A second independent case." },
  "intrinsic.zIndexComparison": { status: STATUS.BLOCKED_BY_SOURCE_LIMIT, value: "declared z-index vs paint order", evidence: "One calibration case, in which a declared z-index disagreed with the observed paint order and the rule reported it.", blocks: "A second independent case." },
  "state.excludedProperties": { status: STATUS.BLOCKED_BY_SOURCE_LIMIT, value: "top/left/right/bottom/x/y/scroll*", evidence: "One calibration case, plus the def_0031 regression that produced the exclusion — a state induction scrolls its element, so the coordinate measures the scroll as much as the state.", blocks: "A second independent case." },
  "correlation": { status: STATUS.BLOCKED_BY_SOURCE_LIMIT, value: "reference-correlated demotes", evidence: "One calibration case, in which a finding the reference shared was demoted rather than reported as a defect.", blocks: "A second independent case." },
  "progression-signature": { status: STATUS.BLOCKED_BY_SOURCE_LIMIT, value: "exact signature equality", evidence: "One calibration case. Exact equality is the strictest possible rule, so it cannot produce a false negative — but nothing tests how often it produces a false positive.", blocks: "A second independent case." },
  "content-mode gate": { status: STATUS.BLOCKED_BY_SOURCE_LIMIT, value: "equivalent-content required for comparative residue", evidence: "One calibration case, plus the Phase 3.4 slice in which independent content produced 42 clusters that were not defects.", blocks: "A second independent case." }
});

export const TOLERANCE_KEYS = Object.freeze(Object.keys(TOLERANCE_STATUS));

/**
 * Whether every entry is validated.
 *
 * This is what `TOLERANCES.$validated` means and has always meant. Deriving it
 * rather than storing it removes the way the two could disagree: a flag set by
 * hand can outlive the evidence it was set from.
 */
export function allValidated() {
  return TOLERANCE_KEYS.every((k) => TOLERANCE_STATUS[k].status === STATUS.VALIDATED);
}

/** The counts, for a report that should not have to compute them itself. */
export function statusSummary() {
  const counts = {};
  for (const key of TOLERANCE_KEYS) {
    const s = TOLERANCE_STATUS[key].status;
    counts[s] = (counts[s] ?? 0) + 1;
  }
  return {
    total: TOLERANCE_KEYS.length,
    counts,
    validated: TOLERANCE_KEYS.filter((k) => TOLERANCE_STATUS[k].status === STATUS.VALIDATED),
    blockedOnDefinition: TOLERANCE_KEYS.filter((k) => TOLERANCE_STATUS[k].status === STATUS.BLOCKED_ON_DEFINITION),
    allValidated: allValidated(),
    globalFlagNote:
      "`TOLERANCES.$validated` stays false while any entry is not validated. Two entries being validated does not license a flag that asserts all seventeen are."
  };
}

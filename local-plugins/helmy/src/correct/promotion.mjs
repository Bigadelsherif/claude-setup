/**
 * The promotion gate.
 *
 * Promotion is a correction about one page becoming a rule about every page.
 * It is the single change in this system with unbounded blast radius, and it is
 * the one most likely to be made casually — the observation is right, it felt
 * general, and nobody noticed the difference between "true here" and "true".
 *
 * So the gate is deliberately hard to pass and easy to reverse:
 *
 *   - **Two independent references, or an explicit human act.** Never a count
 *     of records: the same correction filed twice against one page is one
 *     person being sure, not two observations.
 *   - **Six conditions that hold it back regardless.** Each is a case where the
 *     evidence cannot support generalisation even if the correction is right.
 *   - **Demotion is a first-class event.** A rule that turns out to be local
 *     gets withdrawn without anyone having to delete history.
 *
 * The source-specific fact survives promotion. A promoted rule does not replace
 * the observation it came from — the observation is still what was measured on
 * that page, and if the rule is later demoted the observation is untouched.
 */

import { PROMOTION_STATUS, PROMOTION_THRESHOLD, SCOPE, CORRECTION_CATEGORY, REVIEW_STATUS } from "./record.mjs";
import { countWitnesses } from "./store.mjs";
import { STATUS } from "../evidence/status.mjs";

/** Why a correction is being held back from becoming a rule. */
export const HOLD = Object.freeze({
  SINGLE_WITNESS: "single-independent-reference",
  AMBIGUOUS_SOURCE: "source-is-ambiguous",
  SCREENSHOT_ESTIMATED: "evidence-is-screenshot-only-and-estimated",
  IMPACT_UNKNOWN: "impact-is-not-understood",
  CONFLICTS: "conflicts-with-an-existing-global-rule",
  TOUCHES_SAFETY: "affects-safety-or-evidence-status",
  NOT_ACCEPTED: "not-accepted-yet"
});

const HOLD_REASON = Object.freeze({
  [HOLD.SINGLE_WITNESS]: "One page is not a pattern. A correction seen on a single reference describes that reference; the second independent witness is what distinguishes a rule from a coincidence.",
  [HOLD.AMBIGUOUS_SOURCE]: "The correction does not say which source it disagrees with. A rule derived from an ambiguous source would apply to situations nobody checked.",
  [HOLD.SCREENSHOT_ESTIMATED]: "Every value on that side is estimated, so nothing could corroborate the correction. Generalising from it would turn one person's reading of a screenshot into a universal rule.",
  [HOLD.IMPACT_UNKNOWN]: "The correction's affected paths were never computed, so nobody knows what promoting it would change.",
  [HOLD.CONFLICTS]: "An existing global rule says something else. Two contradictory rules do not average; one of them is wrong and the conflict has to be resolved before either is trusted.",
  [HOLD.TOUCHES_SAFETY]: "Evidence status and safety gates are not generalisable judgements. A rule that raised a status everywhere would remove the distinction the statuses exist to draw.",
  [HOLD.NOT_ACCEPTED]: "A correction that has not been accepted for its own reference cannot be a rule for every reference."
});

/**
 * Decides whether a correction may become a global rule.
 *
 * Returns every hold rather than the first, so a reader learns everything
 * standing between this correction and a rule in one pass.
 *
 * `explicit` is the human act. It clears the witness requirement and nothing
 * else — a person may assert that a pattern generalises, and may not assert
 * that screenshot evidence became forensic or that a safety gate is optional.
 */
export function evaluatePromotion({
  correction,
  corrections = [],
  globalRules = [],
  explicit = false,
  actor = null
} = {}) {
  const holds = [];
  const witnesses = countWitnesses(corrections, correction);

  if (correction.reviewStatus !== REVIEW_STATUS.ACCEPTED) {
    holds.push(HOLD.NOT_ACCEPTED);
  }
  if (!witnesses.meetsThreshold && !explicit) {
    holds.push(HOLD.SINGLE_WITNESS);
  }
  if (!correction.sourceKind || correction.sourceKind === "unknown") {
    holds.push(HOLD.AMBIGUOUS_SOURCE);
  }
  if (correction.sourceKind === "screenshots" &&
      (correction.corrected?.status ?? correction.original?.status) === STATUS.ESTIMATED) {
    holds.push(HOLD.SCREENSHOT_ESTIMATED);
  }
  if (!(correction.affectedProjections ?? []).length && !(correction.affectedArtifacts ?? []).length) {
    holds.push(HOLD.IMPACT_UNKNOWN);
  }

  const conflict = globalRules.find((rule) =>
    rule.claim === correction.claim &&
    JSON.stringify(rule.value) !== JSON.stringify(correction.corrected?.value));
  if (conflict) holds.push(HOLD.CONFLICTS);

  const touchesSafety = [
    CORRECTION_CATEGORY.SOURCE_CLASSIFICATION,
    CORRECTION_CATEGORY.CONFIDENCE
  ].includes(correction.category);
  if (touchesSafety) holds.push(HOLD.TOUCHES_SAFETY);

  /* Screenshot-estimated and safety-touching holds are not clearable by an
   * explicit act. A person may assert that a pattern generalises; they may not
   * assert that the evidence was stronger than it was. */
  const unclearable = holds.filter((h) => h === HOLD.SCREENSHOT_ESTIMATED || h === HOLD.TOUCHES_SAFETY);

  return {
    promotable: holds.length === 0,
    holds: holds.map((code) => ({ code, why: HOLD_REASON[code] })),
    unclearableByExplicitAct: unclearable.map((code) => ({ code, why: HOLD_REASON[code] })),
    witnesses,
    explicit,
    actor,
    threshold: PROMOTION_THRESHOLD,
    /* Stated so a caller reporting a refusal can say what would change it. */
    whatWouldAllowIt: holds.length === 0
      ? null
      : holds.includes(HOLD.SINGLE_WITNESS) && holds.length === 1
        ? `A second independent reference showing the same thing, or an explicit \`helmy correction promote ${correction.id}\`.`
        : `Clear these first: ${holds.filter((h) => h !== HOLD.SINGLE_WITNESS).join(", ")}.`,
    sourceFactPreserved: true
  };
}

/**
 * The rule a promotion would add.
 *
 * Kept separate from the correction. The correction stays a fact about one
 * reference; the rule is a new object that cites it. Demoting the rule leaves
 * the fact exactly as it was, which is the property that makes promotion
 * reversible rather than merely undoable.
 */
export function buildGlobalRule(correction, { witnesses, promotedBy = null, at = new Date().toISOString() }) {
  return {
    $schemaVersion: "1",
    ruleId: `rule_${correction.id.replace("corr_", "")}`,
    claim: correction.claim,
    category: correction.category,
    value: correction.corrected?.value ?? null,
    status: correction.corrected?.status ?? null,
    /* The corrections this rests on, by id and by reference. A rule that cannot
     * name its witnesses cannot be reviewed later. */
    derivedFrom: {
      corrections: [correction.id],
      independentReferences: witnesses?.references ?? [],
      witnessCount: witnesses?.independentReferences ?? 0
    },
    promotedAt: at,
    promotedBy,
    demotedAt: null,
    /* The observation this came from is not replaced. */
    sourceFactPreserved: `Correction ${correction.id} remains a fact about ${correction.referenceId}. This rule cites it; it does not replace it.`,
    scope: SCOPE.GLOBAL_CANDIDATE
  };
}

/** Renders a promotion decision for a person. */
export function renderPromotionDecision(decision, correction) {
  const lines = [];
  if (decision.promotable) {
    lines.push(`${correction.id} may be promoted.`);
    lines.push("");
    lines.push(`Witnesses: ${decision.witnesses.independentReferences} independent reference(s) — ${decision.witnesses.references.join(", ") || "none recorded"}`);
    lines.push(decision.explicit ? "Promoted by explicit act." : `Threshold of ${decision.threshold} met by observation.`);
    lines.push("");
    lines.push("The correction stays a fact about its own reference. The rule cites it rather than replacing it, so demoting the rule later leaves the observation untouched.");
    return lines.join("\n");
  }

  lines.push(`${correction.id} is NOT promotable.`);
  lines.push("");
  lines.push(`Witnesses: ${decision.witnesses.independentReferences} independent reference(s), threshold ${decision.threshold}.`);
  lines.push("");
  lines.push("Held by:");
  for (const hold of decision.holds) {
    lines.push(`  - ${hold.code}`);
    lines.push(`    ${hold.why}`);
  }
  if (decision.unclearableByExplicitAct.length) {
    lines.push("");
    lines.push("These cannot be cleared by promoting explicitly:");
    for (const hold of decision.unclearableByExplicitAct) lines.push(`  - ${hold.code}`);
    lines.push("  A person may assert that a pattern generalises. A person may not assert that the evidence was stronger than it was.");
  }
  if (decision.whatWouldAllowIt) {
    lines.push("");
    lines.push(`What would allow it: ${decision.whatWouldAllowIt}`);
  }
  return lines.join("\n");
}

export { PROMOTION_STATUS, PROMOTION_THRESHOLD };

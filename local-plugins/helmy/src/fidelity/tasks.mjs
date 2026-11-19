/**
 * Correction-task generation.
 *
 * Report-first and manual-first. A task is automatic only when every one of the
 * seven blocking rules is clear, and in practice most are not: Phase 3.2
 * measured that deploy-safe selectors barely exist without author hooks, and
 * def_0030 blocks automatic component correction outright.
 *
 * `notAutomaticBecause` is never empty on a manual task.
 */

import { SEVERITY } from "./compare.mjs";
import { classifySelector, SELECTOR_CLASS } from "../deploy/selector-class.mjs";

const SEVERITY_ORDER = {
  [SEVERITY.CRITICAL]: 0, [SEVERITY.HIGH]: 1, [SEVERITY.MEDIUM]: 2,
  [SEVERITY.LOW]: 3, [SEVERITY.INFORMATIONAL]: 4
};

/** Selector classes a correction may be applied through. */
const APPLICABLE = new Set([SELECTOR_CLASS.PROJECT_STABLE, SELECTOR_CLASS.SEMANTIC_STABLE]);

/**
 * The seven rules from the plan's §8.1. Each returns a reason or null.
 *
 * Rule 5 dominates in practice and the design says so rather than discovering
 * it: on real pages without author hooks essentially every emitted selector is
 * positional.
 */
export function blockingReasons(diff, {
  componentIdentityResolved = false, contestedClaims = new Set(),
  dynamicValues = new Set(), selector = null, classify = null
} = {}) {
  const reasons = [];

  if (diff.affects?.kind === "component" && !componentIdentityResolved) {
    reasons.push("component identity is unresolved across the reference and the target (def_0030)");
  }
  if (contestedClaims.has(diff.dimension)) {
    reasons.push("the reference value is contested");
  }
  if (dynamicValues.has(diff.dimension)) {
    reasons.push("the target value is dynamic — it differed between two captures of the same build");
  }
  if (diff.affects?.kind === "component" && diff.affects?.scope === "beyond-component") {
    reasons.push("the change would affect elements outside the matched component");
  }
  if (selector) {
    const c = classifySelector(selector, { classify });
    if (!APPLICABLE.has(c.class)) {
      reasons.push(`no deploy-safe selector: the target selector is ${c.class}, not project-stable or semantic-stable`);
    }
  }
  if (diff.requiresProductJudgement) {
    reasons.push("the change requires product judgement — content, copy, imagery or information architecture");
  }
  if (["inferred", "estimated"].includes(diff.referenceStatus)) {
    reasons.push(`the reference claim is ${diff.referenceStatus}, not measured or observed`);
  }

  /* Anything the comparator itself already refused. */
  for (const r of diff.notActionableBecause ?? []) reasons.push(r);

  return [...new Set(reasons)];
}

let taskSeq = 0;
const nextId = () => `task_${String(++taskSeq).padStart(4, "0")}`;
export const resetTaskIds = () => { taskSeq = 0; };

/**
 * Ranks tasks: severity first, then how many other differences the fix would
 * resolve, then confidence. A container fix that clears twelve downstream pixel
 * findings outranks an isolated radius.
 */
function rank(task) {
  return [SEVERITY_ORDER[task.severity] ?? 9, -(task.resolvesOtherFindings ?? 0), -(task.confidence ?? 0)];
}

export function generateTasks(comparison, {
  componentIdentityResolved = false, contestedClaims = new Set(), dynamicValues = new Set(),
  targetSelectors = {}, classify = null, pixelAttributions = []
} = {}) {
  const tasks = comparison.differences.map((diff) => {
    const selector = targetSelectors[diff.dimension] ?? null;
    const reasons = blockingReasons(diff, {
      componentIdentityResolved, contestedClaims, dynamicValues, selector, classify
    });

    const resolves = pixelAttributions.filter((a) => a.differenceId === diff.id).length;
    const automatic = reasons.length === 0 && diff.automaticallyActionable === true;

    return {
      id: nextId(),
      category: diff.category,
      severity: diff.severity,
      referenceEvidence: {
        claim: diff.dimension, value: diff.referenceValue,
        status: diff.referenceStatus, evidence: diff.referenceEvidence
      },
      targetEvidence: {
        claim: diff.dimension, value: diff.targetValue,
        status: diff.targetStatus, evidence: diff.targetEvidence
      },
      currentValue: diff.targetValue,
      expectedValue: diff.referenceValue,
      /* Carried through from the difference rather than recomputed, so the task
       * and the finding it came from cannot disagree about the size of the gap. */
      difference: diff.difference ?? null,
      affects: { ...diff.affects, selector },
      proposedChange: diff.recommendedCorrection,
      confidence: diff.confidence,
      mode: automatic ? "automatic" : "manual",
      notAutomaticBecause: automatic ? [] : reasons,
      acceptanceCondition: acceptanceFor(diff),
      resolvesOtherFindings: resolves,
      sourceDifference: diff.id
    };
  });

  tasks.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return 0;
  });

  return tasks;
}

/**
 * An acceptance condition states what the next iteration must MEASURE, not what
 * the change should look like. It is checked against the recaptured target IR.
 */
export function acceptanceFor(diff) {
  const tol = diff.tolerance?.value ?? 0;
  const unit = diff.difference?.unit ?? "";
  if (diff.referenceValue == null) {
    return `Target IR reports \`${diff.dimension}\` consistent with the reference.`;
  }
  if (typeof diff.referenceValue === "number") {
    return `Target IR reports \`${diff.dimension}\` = ${diff.referenceValue}${unit === "px" ? "px" : ` ${unit}`}` +
      (tol ? ` ± ${tol}${unit === "px" ? "px" : ""}` : "") +
      `, and no other category score decreases.`;
  }
  return `Target IR reports \`${diff.dimension}\` = \`${diff.referenceValue}\`, and no other category score decreases.`;
}

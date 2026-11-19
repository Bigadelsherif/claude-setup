/**
 * What a correction may not do.
 *
 * A correction is a person overriding a measurement. Most of the time that is
 * exactly right — the person can see the page and the extractor cannot. But the
 * same mechanism, unguarded, is how a system that reports evidence turns into a
 * system that reports opinions with an evidence-shaped veneer.
 *
 * The guards below fall into two groups, and they refuse for different reasons.
 *
 * **Evidence protection** refuses things that would destroy the audit trail or
 * launder a weaker claim into a stronger one: deleting the original observation,
 * turning an estimate into a measurement, resolving a contested claim by
 * picking a side quietly. These are refused no matter who asks, because the
 * refusal is the feature — a system where a person can promote their own guess
 * to `measured` has no measured category at all.
 *
 * **Automatic-application limits** refuse a narrower thing: applying a
 * correction *without review*. The correction may be perfectly right; what is
 * unavailable is doing it unattended. Those all trace to the same root — the
 * system cannot reliably identify the same component across two builds
 * (`def_0030`, a permanent limitation on two witnesses) — and an automatic
 * correction acting on an unverified match writes a value onto whichever
 * element the matcher happened to pick.
 *
 * Every refusal names what would go wrong, not just that it is forbidden.
 */

import { CORRECTION_CATEGORY, SCOPE } from "./record.mjs";
import { STATUS } from "../evidence/status.mjs";
import { classifySelector, SELECTOR_CLASS } from "../deploy/selector-class.mjs";
import { classifyClassName } from "../deploy/class-kind.mjs";

export const REFUSAL = Object.freeze({
  DELETES_EVIDENCE: "would-delete-original-evidence",
  REWRITES_CAPTURE: "would-rewrite-source-capture",
  RAISES_CEILING: "would-raise-a-source-kind-status-ceiling",
  LAUNDERS_SCREENSHOT: "would-turn-screenshot-evidence-into-forensic-evidence",
  LAUNDERS_ESTIMATE: "would-turn-an-estimate-into-a-measurement",
  RESOLVES_CONTESTED: "would-resolve-a-contested-claim-without-recording-both-candidates",
  OVERRIDES_GATE: "would-override-a-safety-gate",
  CHANGES_DEFECT: "would-change-a-defect-status-implicitly",
  AUTO_PROMOTES: "would-promote-a-global-rule-automatically",
  MUTATES_REFERENCE: "would-mutate-the-reference-page",
  MUTATES_TARGET: "would-mutate-the-target-project",
  EDITS_ARTIFACT: "would-edit-a-generated-artifact-as-the-source-of-truth"
});

/**
 * The status ceiling a source kind can support.
 *
 * Screenshot evidence is estimated by construction. A correction may say the
 * estimate is wrong; it may not say the estimate was really a measurement,
 * because nothing about a person disagreeing with a screenshot turns the
 * screenshot into a computed style.
 */
export const SOURCE_CEILING = Object.freeze({
  screenshots: STATUS.ESTIMATED,
  "visual-model": STATUS.ESTIMATED,
  url: STATUS.MEASURED,
  dom: STATUS.MEASURED,
  "computed-style": STATUS.MEASURED
});

const STATUS_RANK = Object.freeze({
  [STATUS.UNKNOWN]: 0,
  [STATUS.ESTIMATED]: 1,
  [STATUS.INFERRED]: 2,
  [STATUS.OBSERVED]: 3,
  [STATUS.MEASURED]: 4
});

const refuse = (code, what, why, remedy) => ({ allowed: false, code, what, why, remedy });

/**
 * Checks a proposed correction against everything it must not do.
 *
 * Returns every refusal rather than the first: a caller fixing three problems
 * one round-trip at a time is a caller who gives up on the second.
 */
export function guardCorrection({
  correction,
  ir = null,
  evidence = null,
  sourceKind = null,
  automatic = false
} = {}) {
  const refusals = [];
  const effectiveSource = sourceKind ?? correction?.sourceKind ?? ir?.meta?.source?.kind ?? null;

  /* ---- evidence protection: refused however it is applied ---- */

  if (correction?.deleteEvidence || correction?.removeOriginalEvidence) {
    refusals.push(refuse(REFUSAL.DELETES_EVIDENCE,
      "Deleting the evidence that backed the original claim.",
      "The original observation is what makes the correction reviewable. Without it nobody can tell whether the correction was right, only that somebody changed something.",
      "Corrections supersede evidence. The original record stays, marked `supersededBy`, and remains readable."));
  }
  if (correction?.rewriteCapture || correction?.target === "capture") {
    refusals.push(refuse(REFUSAL.REWRITES_CAPTURE,
      "Rewriting the raw capture.",
      "The capture is what the page actually returned. Editing it means every later re-derivation inherits the edit as though it had been observed.",
      "Correct the derived claim. The capture is the one layer nothing may write."));
  }

  const ceiling = SOURCE_CEILING[effectiveSource];
  const proposed = correction?.corrected?.status;
  if (ceiling && proposed && STATUS_RANK[proposed] > STATUS_RANK[ceiling]) {
    refusals.push(refuse(REFUSAL.RAISES_CEILING,
      `Raising \`${correction.claim}\` to \`${proposed}\` on ${effectiveSource} evidence.`,
      `${effectiveSource} evidence tops out at \`${ceiling}\`. A person disagreeing with a screenshot does not turn the screenshot into a computed style, and a value marked measured will be built to a tolerance the evidence never supported.`,
      `Record it as \`${ceiling}\` or weaker, or capture the reference as a live page and re-derive.`));

    if (effectiveSource === "screenshots" && STATUS_RANK[proposed] >= STATUS_RANK[STATUS.OBSERVED]) {
      refusals.push(refuse(REFUSAL.LAUNDERS_SCREENSHOT,
        "Turning screenshot evidence into forensic evidence.",
        "Anything downstream that reads a forensic status treats the value as exact. This is the laundering path that a token file and an implementation prompt both trust.",
        "Capture the page live. Nothing else produces forensic evidence."));
    }
  }

  const originalStatus = correction?.original?.status;
  if (originalStatus === STATUS.ESTIMATED && proposed && STATUS_RANK[proposed] > STATUS_RANK[STATUS.ESTIMATED]) {
    refusals.push(refuse(REFUSAL.LAUNDERS_ESTIMATE,
      `Promoting \`${correction.claim}\` from estimated to \`${proposed}\`.`,
      "An estimate that becomes a measurement will be built to the digit. The correction may well be right about the value; it cannot be right about how the value came to be known.",
      "Keep the status at `estimated` and correct the value, or supply evidence from a live capture and re-derive."));
  }

  /* A contested claim may be corrected — a person may know which source is
   * right. What is refused is doing it without recording that there was a
   * disagreement, because that is the only trace anyone would have. */
  const contested = findContested(ir, correction?.claim);
  if (contested) {
    const candidates = correction?.corrected?.candidates ?? correction?.recordedCandidates ?? null;
    const notes = `${correction?.reason ?? ""}`;
    const recorded = Array.isArray(candidates) && candidates.length >= 2;
    const mentioned = /contest|disagree|candidate/i.test(notes);
    if (!recorded && !mentioned) {
      refusals.push(refuse(REFUSAL.RESOLVES_CONTESTED,
        `\`${correction.claim}\` is contested (${(contested.candidates ?? []).map((c) => `${c.source}: ${c.value}`).join(" vs ")}) and the correction records only one value.`,
        "Choosing a side silently is exactly what the disagreement machinery exists to prevent. Nothing downstream would say a decision was made, so nobody could revisit it.",
        "Record both candidates on the correction, and say in the reason which source you are trusting and why."));
    }
  }

  if (correction?.overrideSafetyGate || correction?.category === "safety-gate") {
    refusals.push(refuse(REFUSAL.OVERRIDES_GATE,
      "Overriding the safety gate.",
      "A gate exists to refuse output the evidence does not support. A gate a correction can switch off is not a gate.",
      "Correct the evidence the gate objected to and re-derive. If the gate is wrong, that is a defect — file it."));
  }
  if (correction?.defectStatus || correction?.closesDefect) {
    refusals.push(refuse(REFUSAL.CHANGES_DEFECT,
      "Changing a defect's status as a side effect.",
      "A defect is closed by evidence and a regression test, never by a correction deciding it is closed.",
      "File the evidence against the defect directly."));
  }
  if (correction?.scope === SCOPE.GLOBAL_CANDIDATE && correction?.autoPromote) {
    refusals.push(refuse(REFUSAL.AUTO_PROMOTES,
      "Promoting to a global rule automatically.",
      "A fact about one page becoming a universal rule is how a forensic tool turns into a style guide with opinions, and it happens one reasonable-looking promotion at a time.",
      "Promotion needs two independent witnesses or an explicit `bigaap correction promote`."));
  }
  if (correction?.writesTo === "reference" || correction?.mutatesReference) {
    refusals.push(refuse(REFUSAL.MUTATES_REFERENCE,
      "Writing to the reference.",
      "The reference is somebody else's page and an analysis target. Nothing here writes to it.",
      "Corrections write to this workspace's correction store."));
  }
  if (correction?.writesTo === "target" || correction?.mutatesTarget) {
    refusals.push(refuse(REFUSAL.MUTATES_TARGET,
      "Writing to the target project.",
      "The build is yours. This system describes and refuses; it does not edit your code.",
      "Read the regenerated prompt and apply it yourself."));
  }
  if (correction?.editsArtifact || /^(output|analysis)\//.test(String(correction?.claim ?? ""))) {
    refusals.push(refuse(REFUSAL.EDITS_ARTIFACT,
      "Editing a generated artifact as the source of truth.",
      "Everything in `output/` is a projection. An edit there is overwritten by the next re-derivation and, until then, disagrees with the IR it claims to come from.",
      "Correct the claim in the IR. The artifacts regenerate from it."));
  }

  /* ---- automatic application: a narrower refusal ---- */

  const automaticRefusals = automatic ? guardAutomatic({ correction, ir, evidence, sourceKind: effectiveSource }) : [];

  return {
    allowed: refusals.length === 0 && automaticRefusals.length === 0,
    refusals: [...refusals, ...automaticRefusals],
    /* Split so a caller can tell "this correction is unsafe" from "this
     * correction is fine but must be reviewed by a person". */
    evidenceRefusals: refusals,
    automaticRefusals,
    manualStillAvailable: refusals.length === 0 && automaticRefusals.length > 0
  };
}

/** What may never be applied unattended, and why each traces to def_0030. */
export const NOT_AUTOMATIC = Object.freeze([
  {
    category: CORRECTION_CATEGORY.COMPONENT_IDENTITY,
    why: "Matching a component across two builds has measured recall of 0.5 against a bar of 0.6 (def_0030, a permanent limitation on two independent witnesses). An automatic correction would write onto whichever element the matcher happened to pick."
  },
  {
    category: CORRECTION_CATEGORY.REGION,
    why: "A region correction changes what the whole analysis was about. Applying it unattended would silently re-scope every claim derived from the old region."
  },
  {
    category: CORRECTION_CATEGORY.SOURCE_CLASSIFICATION,
    why: "Source classification decides which status ceiling applies. Getting it wrong unattended is how an estimate becomes a measurement."
  }
]);

function guardAutomatic({ correction, ir, evidence, sourceKind }) {
  const out = [];
  const category = correction?.category;

  const blocked = NOT_AUTOMATIC.find((n) => n.category === category);
  if (blocked) {
    out.push(refuse(`not-automatic:${category}`,
      `Applying a ${category} correction without review.`,
      blocked.why,
      "Accept it explicitly with `bigaap correction accept <id>` after reading the preview."));
  }

  /* Selector corrections are automatic only for a selector that survives a
   * deploy. A positional or generated selector is valid until the reference's
   * next build, and a rule learned from one is worse than no rule: it will
   * match something, and the something will be wrong. */
  if (category === CORRECTION_CATEGORY.SELECTOR_CLASSIFICATION) {
    const selector = correction?.corrected?.value ?? correction?.original?.value;
    const classification = selector ? classifySelector(String(selector), { classify: classifyClassName }) : null;
    if (classification && [SELECTOR_CLASS.GENERATED, SELECTOR_CLASS.POSITIONAL, SELECTOR_CLASS.UTILITY_NONDISCRIMINATING].includes(classification.class)) {
      out.push(refuse(`not-automatic:selector-${classification.class}`,
        `Applying a correction about \`${selector}\`, which is ${classification.class}.`,
        classification.class === SELECTOR_CLASS.GENERATED
          ? "A build-generated selector is valid until the reference's next deploy. A rule learned from one will match something after the deploy, and the something will be wrong."
          : classification.class === SELECTOR_CLASS.POSITIONAL
            ? "A positional selector survives neither reordering nor insertion. It describes where a thing was, not what it is."
            : "A utility class describes presentation and discriminates poorly. A rule keyed on one will match far more than it means to.",
        "Correct it manually, or supply a semantic or author-controlled selector."));
    }
  }

  /* A contested critical claim is never automatic, whatever the category. */
  const contested = findContested(ir, correction?.claim);
  if (contested?.critical) {
    out.push(refuse("not-automatic:contested-critical",
      `\`${correction.claim}\` is contested and critical.`,
      "Two sources disagree about a value the build depends on. An automatic correction would assert whichever candidate the correction happened to name, with nothing recording that a choice was made.",
      "Resolve it by hand, recording both candidates and which source you trust."));
  }

  /* Screenshot-only estimated evidence is never automatic: there is nothing to
   * check the correction against. */
  if (sourceKind === "screenshots") {
    out.push(refuse("not-automatic:screenshot-only",
      "Applying a correction unattended against screenshot-only evidence.",
      "Every value on that side is estimated, so nothing in the run can corroborate or contradict the correction. An automatic apply would be a person's guess overwriting a machine's guess with no third opinion available.",
      "Review it. The correction may be right; it just cannot be checked."));
  }

  /* Content, IA, product requirements and brief values are not observations at
   * all — they are decisions, and a decision applied automatically is a
   * decision nobody made. */
  for (const [flag, what] of [
    ["changesContent", "content"],
    ["changesInformationArchitecture", "information architecture"],
    ["changesProductRequirement", "a product requirement"],
    ["changesTargetBrief", "a target brief value"]
  ]) {
    if (correction?.[flag]) {
      out.push(refuse(`not-automatic:${flag}`,
        `Changing ${what} unattended.`,
        `${what[0].toUpperCase()}${what.slice(1)} is a decision, not an observation. Applying it automatically means the decision was made by nobody.`,
        "State it in the target brief, or accept the correction explicitly."));
    }
  }

  if (correction?.ambiguousStructure) {
    out.push(refuse("not-automatic:ambiguous-structure",
      "Applying an ambiguous structural correction unattended.",
      "The structure the correction refers to could not be resolved to one element. Applying it would pick one.",
      "Disambiguate the target, or accept it explicitly."));
  }
  return out;
}

/** Finds a contested claim in the IR by path. */
function findContested(ir, claimPath) {
  if (!ir || !claimPath) return null;
  const listed = (ir.contestedClaims ?? []).find((c) => (c.claim ?? c.path) === claimPath);
  if (listed) return listed;

  const walk = (node, path = "") => {
    if (!node || typeof node !== "object") return null;
    if (Array.isArray(node)) {
      for (const [i, v] of node.entries()) {
        const found = walk(v, `${path}[${i}]`);
        if (found) return found;
      }
      return null;
    }
    if (node.contested && path === claimPath) return node;
    for (const [k, v] of Object.entries(node)) {
      if (k === "meta" || k === "safety") continue;
      const found = walk(v, path ? `${path}.${k}` : k);
      if (found) return found;
    }
    return null;
  };
  return walk(ir);
}

export { findContested };

/**
 * The fifteen readiness decisions.
 *
 * Separate decisions, never rolled into one. A single "ready" verdict would
 * have to pick a weakest link and then hide it: analysis mode is in a very
 * different state from automatic correction, and a reader who needs to know
 * which is which is exactly the reader a summary fails.
 *
 * Each decision names what it rests on. A decision with no evidence is
 * `undetermined`, which is not a soft `no` — it means the question was never
 * put to a test, and saying so is the only honest answer available.
 */

import { READINESS } from "./result.mjs";

export const DECISIONS = Object.freeze([
  "analysis-mode",
  "prompt-generation",
  "adaptation",
  "recreation",
  "single-viewport-fidelity",
  "multi-viewport-fidelity",
  "interaction-state-fidelity",
  "intrinsic-visual-checks",
  "equivalent-content-pixel-comparison",
  "independent-content-comparison",
  "automatic-global-value-correction",
  "manual-correction-workflow",
  "cli-use",
  "authenticated-targets",
  "production-use"
]);

/**
 * The standing decisions.
 *
 * These do not vary with a particular run: they are what the phases
 * established, and a run cannot promote one on its own. `basis` names the
 * evidence; `limits` names what the decision does not cover, because a
 * qualified yes read as an unqualified one is how a limitation gets lost.
 */
export const STANDING = Object.freeze({
  "analysis-mode": {
    decision: READINESS.USABLE_WITH_LIMITS,
    basis: "Evidence-backed IR with paired provenance and coverage, a safety gate that blocks prompt generation when coverage is too thin, and 555 unit tests over fixtures and six real targets.",
    limits: [
      "Coverage is reported, never assumed. A capture that reaches little of the main content produces a low-confidence IR and says so.",
      "Blocked stylesheets and truncated node budgets are recorded as unknowns, not silently omitted."
    ]
  },
  "prompt-generation": {
    decision: READINESS.USABLE_WITH_LIMITS,
    basis: "Projections are regenerated from the IR and stamped with its hash; the safety gate removes implementation prompts when the evidence does not support them.",
    limits: [
      "Prompts are implementation-ready text, not verified implementations.",
      "Emitted selectors carry the limitations in def_0020 and def_0022; a utility class is never recommended as deploy-stable."
    ]
  },
  adaptation: {
    decision: READINESS.USABLE_WITH_LIMITS,
    basis: "`adapt` requires a target brief and refuses without one; mode requirements are evaluated against available evidence rather than assumed.",
    limits: [
      "Adaptation reuses measured structure against a different brief. It does not verify that the adapted result satisfies the brief."
    ]
  },
  recreation: {
    decision: READINESS.USABLE_WITH_LIMITS,
    basis: "Recreation emits the full artifact set from measured evidence, with unknowns enumerated rather than filled in.",
    limits: [
      "A recreation is judged by the fidelity loop, which is report-first. Nothing here claims a recreation matches its reference."
    ]
  },
  "single-viewport-fidelity": {
    decision: READINESS.USABLE_WITH_LIMITS,
    basis: "Twelve categories scored from IR comparison with evidence coverage paired to every score; gates refuse a comparison rather than scoring it thin.",
    limits: [
      "Scores are null where there is no evidence, never zero.",
      "No threshold is validated. `TOLERANCES.$validated` is false and the calibration report says why."
    ]
  },
  "multi-viewport-fidelity": {
    decision: READINESS.USABLE_WITH_LIMITS,
    basis: "Four viewports run independently; one blocked viewport does not cancel the others, and the run status records the partial result rather than averaging it away.",
    limits: [
      "A responsive change is compared against the reference's own progression, so an intended transformation is not reported as a defect. That comparison needs both sides at both widths.",
      "A viewport with no target capture is `unavailable`, and no score is produced for the pair."
    ]
  },
  "interaction-state-fidelity": {
    decision: READINESS.USABLE_WITH_LIMITS,
    basis: "Nine states with six statuses; a state that cannot be induced is `unavailable` with its reason, never a mismatch. State comparison is a delta from rest and excludes viewport-relative geometry (def_0031).",
    limits: [
      "Only states the target actually implements can be observed. An absent state is unknown, not absent-by-design.",
      "Two-sided evidence is required: a state present on one side only is reported as such."
    ]
  },
  "intrinsic-visual-checks": {
    decision: READINESS.USABLE_WITH_LIMITS,
    basis: "Thirteen single-render checks that hold on the target alone, plus five non-defect context records. Correlation against the reference demotes a finding the reference shares.",
    limits: [
      "Intrinsic findings are facts about one render. Whether one is a defect depends on correlation and declared intent.",
      "The tap-target minimum is a configured policy, not a measurement; the policy and its rationale travel on every finding."
    ]
  },
  "equivalent-content-pixel-comparison": {
    decision: READINESS.USABLE_WITH_LIMITS,
    basis: "Six entry conditions must all hold before comparative pixel work runs; the normalisation contract is checked and geometry differences suppress residue rather than being re-counted as pixels.",
    limits: [
      "Only runs when equivalent content is established. It is not a general image-diff.",
      "No claim of pixel-perfect fidelity is made or supported."
    ]
  },
  "independent-content-comparison": {
    decision: READINESS.USABLE_WITH_LIMITS,
    basis: "Comparative pixel work is DISABLED in this mode rather than thresholded, because different copy produces clusters that are not defects — 42 false clusters in the Phase 3.4 slice.",
    limits: [
      "Structural, token and intrinsic evidence still apply. Pixel residue does not."
    ]
  },
  "automatic-global-value-correction": {
    decision: READINESS.NOT_USABLE,
    basis: "The loop is report-first and manual-first by design. Component-level cross-implementation matching is a PERMANENT LIMITATION as of Phase 4.9 (def_0030): two independently written pairs, recall 0.444 and 0.500 against a pre-declared bar of 0.6 that was not moved. Precision held at 1.000 on both, so what fails is completeness — and half the components is not a capability.",
    limits: [
      "Correction tasks are generated for a human to apply. Nothing applies them.",
      "Component-level automatic correction is blocked permanently, not pending. Category-level comparison is the ceiling.",
      "Two approaches were named and never evaluated — dropping the parent tag from `parentChildShape`, and matching on internal-shape sequence. Neither is ruled out; a permanent limitation is a statement about the capability as it stands, not a proof that the problem is unsolvable."
    ]
  },
  "manual-correction-workflow": {
    decision: READINESS.USABLE_WITH_LIMITS,
    basis: "Corrections are filed against evidence, projections are regenerated from the IR, and promotion requires two independent witnesses.",
    limits: [
      "A correction changes a claim, not a generated file. Editing a projection directly is unsupported and the hash stamp will disagree."
    ]
  },
  "cli-use": {
    decision: READINESS.USABLE_WITH_LIMITS,
    basis: "Every command returns the typed result contract, distinguishes blocked from failed by exit code, and preserves metadata, hashes and attempt history.",
    limits: [
      "The CLI drives local and public targets only.",
      "A command never emits a success result from skipped work; `not-attempted` exists for that case."
    ]
  },
  "authenticated-targets": {
    decision: READINESS.NOT_USABLE,
    basis: "Not implemented, and deliberately so. No command accepts credentials, and none bypasses a consent gate, a CAPTCHA or a bot check.",
    limits: [
      "An authenticated page must be opened by the person who owns the account. The tool does not do it for them."
    ]
  },
  "production-use": {
    decision: READINESS.NOT_USABLE,
    basis: "No threshold is validated as a whole; driver failures observed against local fixtures only and never in the field; def_0020 and def_0022 open; def_0030 a permanent limitation.",
    limits: [
      "This is a measurement and reporting instrument under active development. It is not claimed to be production-ready, and this decision is not a formality — it is the honest state of the evidence."
    ]
  }
});

/**
 * Applies what a particular run observed on top of the standing decisions.
 *
 * A run can only ever narrow a decision, never widen one. Observing that a
 * comparison completed does not license anything the phases did not already
 * establish; observing that every comparison was blocked does downgrade what
 * this run's evidence supports.
 */
export function readinessReport({ store = null } = {}) {
  const decisions = DECISIONS.map((id) => ({ id, ...STANDING[id], observed: null }));
  const byId = new Map(decisions.map((d) => [d.id, d]));

  if (store) {
    const results = store.results();
    const comparisons = results.filter((r) => r.operation === "compare");
    const blockedAll = comparisons.length > 0 && comparisons.every((r) => r.status === "blocked");

    const narrow = (id, note) => {
      const d = byId.get(id);
      if (!d) return;
      d.decision = READINESS.NOT_USABLE;
      d.observed = note;
    };

    if (blockedAll) {
      narrow("single-viewport-fidelity", "Every comparison in this run was blocked, so this run supports no fidelity claim.");
      narrow("multi-viewport-fidelity", "Every comparison in this run was blocked.");
    }
    if (comparisons.length === 0) {
      for (const id of ["single-viewport-fidelity", "multi-viewport-fidelity"]) {
        const d = byId.get(id);
        d.decision = READINESS.UNDETERMINED;
        d.observed = "No comparison has run in this workspace, so there is nothing to judge.";
      }
    }
    const states = results.filter((r) => r.operation === "capture-state");
    if (states.length && states.every((r) => r.detail?.available === false)) {
      const d = byId.get("interaction-state-fidelity");
      d.decision = READINESS.UNDETERMINED;
      d.observed = "No state could be induced on this target; every state capture came back unavailable.";
    }
  }

  return {
    decisions,
    /* Deliberately not a verdict. The count is a navigation aid; the decisions
     * are the answer, and collapsing them would undo the reason they are
     * separate. */
    counts: decisions.reduce((acc, d) => { acc[d.decision] = (acc[d.decision] ?? 0) + 1; return acc; }, {}),
    note: "Fifteen separate decisions. There is deliberately no overall verdict: the decisions differ, and one summary would have to hide the difference."
  };
}

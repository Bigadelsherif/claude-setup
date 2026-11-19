# Phase 4 — readiness decisions

Fifteen separate decisions. There is deliberately **no overall verdict**.

A single "ready" answer would have to pick a weakest link and then hide it.
Analysis mode and automatic correction are in very different states, and a
reader who needs to know which is which is exactly the reader a summary fails.
The decisions are the answer; the count below is a navigation aid, not a score.

**12 usable-with-limits · 3 not-usable · 0 usable · 0 undetermined**

These are the standing decisions — what the phases established. A particular run
can *narrow* one (a workspace with no comparison reports fidelity as
`undetermined`) but never widen one. `helmy readiness --run <dir>` prints them
with any narrowing applied.

The vocabulary:

- **usable** — the evidence supports it without qualification.
- **usable-with-limits** — supported, and the limits are part of the decision.
  Reading it as an unqualified yes is how a limitation gets lost.
- **not-usable** — the evidence does not support it, or it is not implemented.
- **undetermined** — the question was never put to a test. Not a soft no.

---

## 1. Analysis mode — `usable-with-limits`

**Rests on:** an evidence-backed IR with provenance and coverage paired rather
than multiplied into one number, a safety gate that blocks prompt generation
when coverage is too thin, and 572 unit tests over fixtures and six real
targets.

**Limits:**
- Coverage is reported, never assumed. A capture that reaches little of the main
  content produces a low-confidence IR and says so.
- Blocked stylesheets and truncated node budgets are recorded as unknowns, not
  silently omitted.

## 2. Prompt generation — `usable-with-limits`

**Rests on:** projections regenerated from the IR and stamped with its hash, and
a safety gate that removes implementation prompts when the evidence does not
support them.

**Limits:**
- Prompts are implementation-ready text, not verified implementations.
- Emitted selectors carry the limitations in `def_0020` and `def_0022`. A
  utility class is never recommended as deploy-stable.

## 3. Adaptation — `usable-with-limits`

**Rests on:** `adapt` requiring a target brief and refusing without one; mode
requirements evaluated against available evidence rather than assumed.

**Limits:**
- Adaptation reuses measured structure against a different brief. It does not
  verify that the adapted result satisfies the brief.

## 4. Recreation — `usable-with-limits`

**Rests on:** the full artifact set emitted from measured evidence, with
unknowns enumerated rather than filled in.

**Limits:**
- A recreation is judged by the fidelity loop, which is report-first. Nothing
  here claims a recreation matches its reference.

## 5. Single-viewport fidelity — `usable-with-limits`

**Rests on:** twelve categories scored from IR comparison with evidence coverage
paired to every score, and gates that refuse a comparison rather than scoring it
thin.

**Limits:**
- Scores are `null` where there is no evidence, never `0`. Zero would read as
  total disagreement.
- No threshold is validated. `TOLERANCES.$validated` is `false`.

## 6. Multi-viewport fidelity — `usable-with-limits`

**Rests on:** four viewports run independently; one blocked viewport does not
cancel the others, and the roll-up records the partial result rather than
averaging it away.

**Limits:**
- A responsive change is compared against the reference's own progression, so an
  intended transformation is not reported as a defect. That needs both sides at
  both widths.
- A viewport with no target capture is `unavailable`, and no score is produced
  for the pair.

## 7. Interaction-state fidelity — `usable-with-limits`

**Rests on:** nine states with six statuses; a state that cannot be induced is
`unavailable` with its reason, never a mismatch. State comparison is a delta
from rest and excludes viewport-relative geometry (`def_0031`).

**Limits:**
- Only states the target actually implements can be observed. An absent state is
  unknown, not absent-by-design.
- Two-sided evidence is required: a state present on one side only is reported
  as such.

## 8. Intrinsic visual checks — `usable-with-limits`

**Rests on:** thirteen single-render checks that hold on the target alone, plus
five non-defect context records; correlation against the reference demotes a
finding the reference shares.

**Limits:**
- Intrinsic findings are facts about one render. Whether one is a defect depends
  on correlation and declared intent.
- The tap-target minimum is a configured policy, not a measurement. The policy
  and its rationale travel on every finding.

## 9. Equivalent-content pixel comparison — `usable-with-limits`

**Rests on:** six entry conditions that must all hold before comparative pixel
work runs; a checked normalisation contract; and geometry differences
suppressing residue rather than being re-counted as pixels.

**Limits:**
- Only runs when equivalent content is established. It is not a general
  image-diff.
- No claim of pixel-perfect fidelity is made or supported.
- The stabilisation this depends on belongs to the *screenshot*, not to the
  extraction. The extraction is deliberately unfrozen so it can read transition
  values (`def_0032`), and the two are recorded separately for that reason.

## 10. Independent-content comparison — `usable-with-limits`

**Rests on:** comparative pixel work being **disabled** in this mode rather than
thresholded, because different copy produces clusters that are not defects — 42
false clusters in the Phase 3.4 slice.

**Limits:**
- Structural, token and intrinsic evidence still apply. Pixel residue does not.

## 11. Automatic global-value correction — `not-usable`

**Rests on:** a loop that is report-first and manual-first by design, and
component-level matching that is precise (1.000) and incomplete (recall 0.444) —
`def_0030`, open.

**Limits:**
- Correction tasks are generated for a human to apply. Nothing applies them, and
  every task result carries `automatic: false`.
- Component-level automatic correction stays blocked while `def_0030` is open,
  and `def_0030` is not closed by threshold tuning.

## 12. Manual correction workflow — `usable-with-limits`

**Rests on:** corrections filed against evidence, projections regenerated from
the IR, and promotion requiring two independent witnesses.

**Limits:**
- A correction changes a claim, not a generated file. Editing a projection
  directly is unsupported, and the hash stamp will disagree.

## 13. CLI use — `usable-with-limits`

**Rests on:** thirteen commands, one typed result contract, blocked distinguished
from failed by exit code, and metadata, hashes and attempt history preserved on
every result. 50 of 50 CLI smoke checks pass against real fixtures.

**Limits:**
- The CLI drives local and public targets only.
- A command never emits a success result from skipped work; `not-attempted`
  exists for that case.

## 14. Authenticated targets — `not-usable`

**Rests on:** not implemented, and deliberately so. No command accepts
credentials, and none bypasses a consent gate, a CAPTCHA or a bot check.

**Limits:**
- An authenticated page must be opened by the person who owns the account. The
  tool does not do it for them, and will not.

## 15. Production use — `not-usable`

**Rests on:** no validated threshold; thirteen of sixteen typed driver failures
never observed against a real browser; `def_0020`, `def_0022` and `def_0030`
open.

**Limits:**
- This is a measurement and reporting instrument under active development. It is
  not claimed to be production-ready, and this decision is not a formality — it
  is the honest state of the evidence.

---

## What would move a decision

Recorded so the decisions are falsifiable rather than fixed:

| Decision | What would change it |
| --- | --- |
| Single- and multi-viewport fidelity | Thresholds calibrated against independent fixtures that did not produce them, with the calibration reproducible. |
| Automatic global-value correction | `def_0030` closed by a matching approach with acceptable recall — not by tuning a threshold to the fixture that set it. |
| Production use | The above, plus the thirteen unobserved driver failures observed in the field, plus `def_0020` resolved or given a second witness. |
| Authenticated targets | Nothing. This one is a decision about scope, not about evidence. |

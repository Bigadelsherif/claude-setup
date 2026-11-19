# Corrections

A correction is the one place a person's judgement enters a system that otherwise only
reports what it measured.

That makes it the most dangerous write in the codebase, and everything below is built
around one constraint:

> **A correction adds a claim. It never removes an observation.**

## The record carries both sides

Every pair is recorded: the original value and the corrected one, the original status and
the corrected one, the evidence that backed the original and the evidence offered for the
replacement, the IR hash before and after.

A record carrying only the new value would be indistinguishable from a measurement — and
the whole point of a correction is that it is not one.

## The workflow

```bash
helmy correct --workspace ./ws --claim layout.container.maxWidth \
  --category factual-claim --value 1200 --reason "the capture measured a child"
```

That **proposes and previews**. Nothing changes. Then:

```bash
helmy correction accept corr_0001 --workspace ./ws
```

The split is deliberate. Proposing is cheap and reversible; deciding changes what the
system says. One command with a `--yes` flag would make review something people learn to
skip.

| Command | What it does |
| --- | --- |
| `helmy correct` | Propose and preview. Writes a proposal, changes nothing else. |
| `helmy correction show <id>` | The record and its whole event history. |
| `helmy correction accept <id>` | Re-derive, validate, publish — in that order. |
| `helmy correction reject <id> --reason` | Record the decision. Nothing is applied. |
| `helmy correction promote <id>` | Offer it as a rule. See [PROMOTION.md](PROMOTION.md). |
| `helmy correction history` | Every event, oldest first. |

Missing fields return `requires-user-input` (exit 6) naming each one. Nothing is invented
— an invented corrected value would be indistinguishable from a measurement.

## The eleven categories

| Category | What it corrects |
| --- | --- |
| `factual-claim` | The measured value was wrong. |
| `evidence-interpretation` | The measurement was right; what it was taken to mean was not. |
| `source-classification` | The evidence was attributed to the wrong kind of source. |
| `component-identity` | Two things were treated as one component, or one as two. |
| `selector-classification` | A selector was classified as more or less stable than it is. |
| `token-role` | A token was assigned the wrong role. |
| `region` | The analysed region was not the intended one. |
| `confidence` | The confidence does not match what backs it. |
| `reference-scoped-preference` | A standing choice for this reference. |
| `project-preference` | A standing choice for the project. |
| `global-rule-candidate` | Offered as a rule beyond this reference. |

## What a correction may never do

Each is refused however it is applied, and each refusal names what would go wrong:

- **Delete the original evidence.** It is what makes the correction reviewable. Without
  it nobody can tell whether the correction was right, only that somebody changed
  something.
- **Rewrite the raw capture.** The capture is what the page actually returned. Editing it
  means every later re-derivation inherits the edit as though it had been observed.
- **Raise a status above its source kind's ceiling.** Screenshot evidence tops out at
  `estimated`. A person disagreeing with a screenshot does not turn the screenshot into a
  computed style.
- **Turn an estimate into a measurement.** It will be built to the digit. The correction
  may be right about the value; it cannot be right about how the value came to be known.
- **Resolve a contested claim silently.** Choosing a side without recording that there
  was a disagreement leaves no trace anyone could revisit.
- **Override a safety gate.** A gate a correction can switch off is not a gate.
- **Change a defect's status.** A defect is closed by evidence and a regression test.
- **Promote a rule automatically.** See [PROMOTION.md](PROMOTION.md).
- **Write to the reference or your project.** The reference is an analysis target; the
  build is yours.
- **Edit a generated artifact as the source of truth.** Everything in `output/` is a
  projection. Correct the claim; the artifacts regenerate.

## History is append-only by construction

Accepting `corr_0001` does not edit `corr_0001.json` — it writes
`corr_0001.01.accepted.json` alongside it. A correction's current state is the newest
event bearing its id.

So the history is not a log kept beside the truth; it **is** the truth, and losing it
would require deleting files rather than merely forgetting to write one. Rejected,
superseded and blocked corrections all stay.

## Related

- [CORRECTION-SCOPES.md](CORRECTION-SCOPES.md) — how far a correction reaches
- [CORRECTION-REVIEW.md](CORRECTION-REVIEW.md) — the preview and the apply pipeline
- [PROMOTION.md](PROMOTION.md) — when a correction may become a rule
- [TASKS.md](TASKS.md) — why correction tasks are still manual

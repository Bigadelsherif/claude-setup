# Readiness

**Partly generated from `src/cli/readiness-model.mjs` by
`node tools/generate-command-docs.mjs`.**

`helmy readiness` answers one question: *can I do this, and if not, what do I do
next?* Everything in the output serves that, and the answer is the first line.

## The shape of the output

```
Recreate is blocked: no hover, focus or disabled state was induced in this capture.
→ Recapture with wider coverage, or use a mode this evidence supports.

readiness · recreate · url · ./ws
browser launched: false · capture attempted: false

BLOCKERS (1) — nothing below these can proceed
  - states: no hover, focus or disabled state was induced in this capture.
    Recapture with wider coverage, or use a mode this evidence supports.
    Recapturing may resolve this.
```

The decision is line one and the action is line two. Not a header, not a count of
checks — every line above the answer is a line read while still not knowing it.

**A positive summary never appears above a blocker.** "Ready — 3 blockers" is worse
than no summary at all: the eye takes the first word and the rest becomes detail.

## The sections, and why they stay separate

| Section | What it is | Why not merged |
| --- | --- | --- |
| BLOCKERS | The run was refused | Nothing below them can be acted on until they clear |
| WITHDRAWN BY PROMPT LINT | A prompt was refused on how it reads | Different remedy from an evidence gap |
| WARNINGS | The run continues | They change how far to trust it, not whether it exists |
| UNKNOWN | Looked for, not established | An unknown is a decision the evidence does not make for you — not a failure |
| CONTESTED | Two sources disagreed | Not an unknown: values exist and they conflict |
| LIMITATIONS | What this cannot do | Grouped by whether recapturing helps |
| OPEN DEFECTS | Standing limitations bearing on this run | Never blockers; shown only when relevant |

## Coverage and confidence

Two different questions, reported side by side and never multiplied:

- **Coverage** — was the right thing read? Reported by region, viewport, state,
  source kind, component and category.
- **Confidence** — how well was it read? Reported per category.

A confident reading of the wrong region and a hesitant reading of the right one are
not the same situation, and one number says they are.

**Nothing is averaged across viewports or states.** A layout that holds at 1440 and
breaks at 375 is not half correct; it is correct at one width and broken at another,
and the mean describes neither.

## There is no readiness score

`readinessModel.compositeScore` is `null`, and the note beside it says why. The
decisions differ, and one number would have to hide the difference — which is the
only thing it could accomplish.

## Verbosity

| | |
| --- | --- |
| default | The decision, the action, and every category that has content |
| `--verbose` | Adds the requirement-by-requirement view, per-dimension coverage, per-category confidence, and every artifact by name |
| `--json` | The model itself. Human output and JSON cannot drift, because the JSON *is* what the renderer reads |

## Commands that carry the model

- **`helmy readiness`** — Print the separate readiness decisions.
- **`helmy blockers`** — Report what would block a mode, without running it.
- **`helmy verify`** — Validate every artifact against its hash and provenance.
- **`helmy freshness`** — Run the ten staleness checks over a capture pair.
- **`helmy tasks`** — List the correction tasks from an iteration.
- **`helmy recovery`** — Show the driver attempt history across every capture in a run.
- **`helmy history`** — List fidelity iterations and re-verify their hashes.

None of them launches a browser. Each reports `browserLaunched: false` so the claim
is checkable rather than merely asserted.

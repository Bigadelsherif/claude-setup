---
description: Correct a claim in an existing analysis, then regenerate every downstream artifact from the corrected evidence.
argument-hint: <workspace> <claim-path> <corrected-value>
---

Record a correction against: **$ARGUMENTS**

**Never edit a generated file.** Outputs in `output/` are projections of
`analysis/ir.json`. Editing one desynchronises it from the evidence and fails
validation rule V6.

Build a correction record matching `schemas/correction.schema.json`. Every field
is required for a reason — fill them honestly:

- `claim` — the dotted path, e.g. `component.card.borderRadius`
- `original` / `corrected` — value and status for each
- `evidence` — what supports the correction. Cite a probe result, a computed
  style, a screenshot measurement. "The user said so" is acceptable only when
  the user is the authority on it (a preference, a brand fact).
- `reason` — **why the original was wrong**, not merely that it was
- `affects` — which extractor, heuristic, and module produced the error
- `ruleToAdd` — the rule that would prevent it recurring
- `scope` — `global` (a heuristic is wrong everywhere), `reference` (this site is
  unusual), or `preference` (how the user wants output shaped)

Then:

```bash
bigaap correct --workspace <ws> --file <correction.json>
```

This supersedes the old evidence (retaining it — history is not deleted), mints
a replacement record, re-derives the IR, and re-projects every artifact.

Confirm the corrected value appears in **every** affected projection, and report
which ones changed.

A `global` correction becomes a permanent rule only after recurring across two
references or on explicit `bigaap promote --id <id>`. Do not promote on the first
sighting: one unusual site should not rewrite how every future analysis behaves.

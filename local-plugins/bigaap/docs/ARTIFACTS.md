# Artifacts

**Generated from `src/artifacts/registry.mjs` by `node tools/generate-command-docs.mjs`.**

Everything this tool writes is a projection of an IR. This is the catalog: what each
artifact is, which modes produce it, what happens to it when the run is refused or its
source moves, and which projection owns it.

The registry is the single authority. The mode matrix, the validator, the freshness
checker, the exporter and this document all read from it, so a rule stated once is
enforced everywhere rather than restated in four places that can drift apart.

## Every artifact

| Artifact | File | Modes | Required | Blocked run | Stale |
| --- | --- | --- | --- | --- | --- |
| `design-spec` | `output/design-spec.md` | analyze, recreate, adapt, extend, improve | required for analyze, recreate, adapt, extend, improve | emit-as-partial | regenerate-safe |
| `rebuild-prompt` | `output/rebuild-prompt.md` | recreate, extend | required for recreate, extend | prune | regenerate-needs-review |
| `adaptation-prompt` | `output/adaptation-prompt.md` | adapt | required for adapt | prune | regenerate-needs-review |
| `improvement-prompt` | `output/improvement-prompt.md` | improve | required for improve | prune | regenerate-needs-review |
| `implementation-notes` | `output/implementation-notes.md` | recreate, adapt, extend | optional | prune | regenerate-needs-review |
| `coverage-report` | `output/coverage-report.md` | analyze, recreate, adapt, extend, improve | required for analyze, recreate, adapt, extend, improve | emit | regenerate-safe |
| `evidence-report` | `output/evidence-report.md` | analyze, recreate, adapt, extend, improve | optional | emit | regenerate-safe |
| `blocked-prompt` | `output/blocked-prompt.md` | analyze, recreate, adapt, extend, improve | optional | emit-only-when-blocked | regenerate-safe |
| `fidelity-report` | `output/fidelity-report.md` | recreate, adapt, extend, improve | optional | emit | regenerate-needs-review |
| `readiness-report` | `output/readiness-report.md` | analyze, recreate, adapt, extend, improve | optional | emit | regenerate-safe |
| `extracted-tokens` | `analysis/extracted-tokens.json` | analyze, recreate, adapt, extend, improve | required for recreate, adapt | emit | regenerate-safe |
| `estimated-tokens` | `analysis/estimated-tokens.json` | analyze, improve | optional | emit | regenerate-safe |
| `component-inventory` | `analysis/component-inventory.json` | analyze, recreate, adapt, extend, improve | required for analyze, recreate, adapt, extend, improve | emit | regenerate-safe |
| `evidence-map` | `analysis/evidence-map.json` | analyze, recreate, adapt, extend, improve | required for analyze, recreate, adapt, extend, improve | emit | regenerate-safe |
| `history-record` | `history/<iteration>/run.json` | analyze, recreate, adapt, extend, improve | optional | emit | preserve-only |
| `recovery-record` | `history/<iteration>/recovery.json` | analyze, recreate, adapt, extend, improve | optional | emit | preserve-only |
| `extraction-warnings` | `output/extraction-warnings.md` | analyze, recreate, adapt, extend, improve | required for analyze, recreate, adapt, extend, improve | emit | regenerate-safe |
| `mode-evaluation` | `output/mode-evaluation.md` | analyze, recreate, adapt, extend, improve | required for analyze, recreate, adapt, extend, improve | emit | regenerate-safe |
| `fidelity-checklist` | `output/fidelity-checklist.md` | recreate, extend | required for recreate, extend | prune | regenerate-needs-review |
| `screenshot-evidence-report` | `output/screenshot-evidence-report.md` | analyze, improve | optional | emit | regenerate-safe |
| `disagreement-report` | `output/disagreement-report.md` | analyze, recreate, adapt, extend, improve | optional | emit | regenerate-safe |
| `correction-tasks` | `output/correction-tasks.md` | recreate, adapt, extend, improve | optional | prune | regenerate-needs-review |
| `correction-log` | `corrections/correction-log.md` | recreate, adapt, extend, improve | optional | emit | preserve-only |

## Registered but not produced

These are named here so they are governed when they arrive — not to imply they exist.
Asking for one returns `not-implemented` with the phase it belongs to.

| Artifact | Belongs to |
| --- | --- |
| `correction-tasks` | Phase 5.7 — correction workflow |
| `correction-log` | Phase 5.7 — correction workflow |

## What each one is

### `design-spec`

What the reference is, claim by claim, with every value carrying its status and evidence.

- **File:** `output/design-spec.md` (`output/partial-design-spec.md` when the run is blocked)
- **Produced by:** analyze, recreate, adapt, extend, improve
- **Requires:** `ir`, `evidence`
- **Source IR:** `ir.json`
- **Source evidence:** `evidence-map.json`
- **Hashes carried:** ir, evidence
- **Readable by:** people
- **Statuses:** complete, partial, stale, superseded
- **Must contain:** "What was analyzed", "Requested mode", "Source kind", "Evidence status", "Coverage", "Generated", "Limitations", "Next"
- **Owned by:** `src/project/design-spec.mjs#projectDesignSpec`
- **Validated against:** *structure only*

### `rebuild-prompt`

Instructions to rebuild the measured system, with literal values and acceptance criteria.

- **File:** `output/rebuild-prompt.md`
- **Produced by:** recreate, extend
- **Requires:** `ir`, `evidence`, `stack`
- **Source IR:** `ir.json`
- **Source evidence:** `evidence-map.json`
- **Hashes carried:** ir, evidence, configuration
- **Readable by:** people
- **Statuses:** complete, stale, superseded
- **Never produced from:** screenshots evidence
- **Must contain:** "What was analyzed", "Requested mode", "Source kind", "Evidence status", "Coverage", "Generated", "Limitations", "Next", "Objective", "Reference evidence", "Page structure", "Design tokens", "Typography", "Layout and grid", "Components", "Component states", "Responsive behavior", "Motion", "Accessibility", "Assets and brand boundaries", "Technical implementation", "Acceptance criteria", "Evidence limitations", "Forbidden assumptions"
- **This is an implementation prompt.** It is withdrawn when a run is blocked, and
  never exported while stale or blocked.
- **Owned by:** `src/project/rebuild-prompt.mjs#projectRebuildPrompt`
- **Validated against:** *structure only*

### `adaptation-prompt`

Instructions to apply the measured system to a different product, described by a target brief.

- **File:** `output/adaptation-prompt.md`
- **Produced by:** adapt
- **Requires:** `ir`, `evidence`, `target-brief`, `stack`
- **Source IR:** `ir.json`
- **Source evidence:** `evidence-map.json`
- **Hashes carried:** ir, evidence, configuration
- **Readable by:** people
- **Statuses:** complete, stale, superseded
- **Never produced from:** screenshots evidence
- **Must contain:** "What was analyzed", "Requested mode", "Source kind", "Evidence status", "Coverage", "Generated", "Limitations", "Next", "Objective", "Reference design system", "Target product brief", "Target information architecture", "Preserved design principles", "Changed content anatomy", "Brand and asset replacement", "Implementation requirements", "Responsive behavior", "Accessibility", "Acceptance criteria", "Limitations"
- **This is an implementation prompt.** It is withdrawn when a run is blocked, and
  never exported while stale or blocked.
- **Owned by:** `src/project/adaptation-prompt.mjs#projectAdaptationPrompt`
- **Validated against:** *structure only*

### `improvement-prompt`

What is there, what is weak about it, what could be done, and what nobody knows — kept apart.

- **File:** `output/improvement-prompt.md`
- **Produced by:** improve
- **Requires:** `ir`, `evidence`, `accessibility-policy`
- **Source IR:** `ir.json`
- **Source evidence:** `evidence-map.json`
- **Hashes carried:** ir, evidence, configuration
- **Readable by:** people
- **Statuses:** complete, partial, stale, superseded
- **Must contain:** "What was analyzed", "Requested mode", "Source kind", "Evidence status", "Coverage", "Generated", "Limitations", "Next", "Observed reference behavior", "Evidence supporting the observation", "UX strengths", "UX critique", "Proposed improvements", "Reasoning for proposals", "What must remain unchanged", "Implementation requirements", "Accessibility", "Acceptance criteria", "Unknowns"
- **This is an implementation prompt.** It is withdrawn when a run is blocked, and
  never exported while stale or blocked.
- **Owned by:** `src/project/improvement-prompt.mjs#projectImprovementPrompt`
- **Validated against:** *structure only*

### `implementation-notes`

Stack-specific guidance that accompanies an implementation prompt without adding claims to it.

- **File:** `output/implementation-notes.md`
- **Produced by:** recreate, adapt, extend
- **Requires:** `ir`, `stack`
- **Source IR:** `ir.json`
- **Source evidence:** `evidence-map.json`
- **Hashes carried:** ir, configuration
- **Readable by:** people
- **Statuses:** complete, partial, stale, superseded
- **Must contain:** "What was analyzed", "Requested mode", "Source kind", "Evidence status", "Coverage", "Generated", "Limitations", "Next", "Stack", "Token mapping", "What this stack cannot express exactly", "What this does not decide"
- **Owned by:** `src/project/implementation-notes.mjs#projectImplementationNotes`
- **Validated against:** *structure only*

### `coverage-report`

What the capture reached and what it did not. Always written, including on a blocked run.

- **File:** `output/coverage-report.md`
- **Produced by:** analyze, recreate, adapt, extend, improve
- **Requires:** `ir`
- **Source IR:** `ir.json`
- **Source evidence:** `evidence-map.json`
- **Hashes carried:** ir
- **Readable by:** people
- **Statuses:** complete, partial, blocked, stale, superseded
- **Must contain:** "What was analyzed", "Requested mode", "Source kind", "Evidence status", "Coverage", "Generated", "Limitations", "Next"
- **Owned by:** `src/project/coverage-report.mjs#projectCoverageReport`
- **Validated against:** *structure only*

### `evidence-report`

Every claim grouped by how it came to be known, so provenance is readable without the IR.

- **File:** `output/evidence-report.md`
- **Produced by:** analyze, recreate, adapt, extend, improve
- **Requires:** `ir`, `evidence`
- **Source IR:** `ir.json`
- **Source evidence:** `evidence-map.json`
- **Hashes carried:** ir, evidence
- **Readable by:** people
- **Statuses:** complete, partial, blocked, stale, superseded
- **Must contain:** "What was analyzed", "Requested mode", "Source kind", "Evidence status", "Coverage", "Generated", "Limitations", "Next", "Measured", "Observed", "Inferred", "Estimated", "Unknown"
- **Owned by:** `src/project/evidence-report.mjs#projectEvidenceReport`
- **Validated against:** *structure only*

### `blocked-prompt`

Written in place of an implementation prompt: why it was refused, and what would change that.

- **File:** `output/blocked-prompt.md`
- **Produced by:** analyze, recreate, adapt, extend, improve
- **Requires:** `ir`
- **Source IR:** `ir.json`
- **Source evidence:** `evidence-map.json`
- **Hashes carried:** ir
- **Readable by:** people
- **Statuses:** blocked, stale, superseded
- **Must contain:** "What was analyzed", "Requested mode", "Source kind", "Evidence status", "Coverage", "Generated", "Limitations", "Next"
- **Owned by:** `src/project/blocked-prompt.mjs#projectBlockedPrompt`
- **Validated against:** *structure only*

### `fidelity-report`

Category-by-category comparison of a build against its reference. Never a single number.

- **File:** `output/fidelity-report.md`
- **Produced by:** recreate, adapt, extend, improve
- **Requires:** `reference-ir`, `target-ir`, `tolerance-policy`
- **Source IR:** `ir.json`
- **Source evidence:** `fidelity-comparison.json`
- **Hashes carried:** ir, configuration
- **Readable by:** people
- **Statuses:** complete, partial, blocked, stale, superseded
- **Must contain:** "What was compared", "Per category", "What is not validated"
- **Owned by:** `src/project/fidelity-report.mjs#projectFidelityReport`
- **Validated against:** *structure only*

### `readiness-report`

Fifteen separate readiness decisions. There is no overall verdict, by construction.

- **File:** `output/readiness-report.md`
- **Produced by:** analyze, recreate, adapt, extend, improve
- **Requires:** `defect-store`
- **Source IR:** *none — not projected from an IR*
- **Source evidence:** `defects/`
- **Hashes carried:** *none*
- **Readable by:** people
- **Statuses:** complete, stale, superseded
- **Must contain:** "Decisions"
- **Owned by:** `src/project/readiness-report.mjs#projectReadinessReport`
- **Validated against:** *structure only*

### `extracted-tokens`

Design tokens measured from the DOM and computed styles. Exact values only.

- **File:** `analysis/extracted-tokens.json`
- **Produced by:** analyze, recreate, adapt, extend, improve
- **Requires:** `ir`, `evidence`
- **Source IR:** `ir.json`
- **Source evidence:** `evidence-map.json`
- **Hashes carried:** ir, evidence
- **Readable by:** machines
- **Statuses:** complete, partial, stale, superseded
- **Never produced from:** screenshots evidence
- **Owned by:** `src/project/tokens.mjs#projectTokens`
- **Validated against:** *structure only*

### `estimated-tokens`

Token values read from screenshots. A different file from extracted tokens, on purpose.

- **File:** `analysis/estimated-tokens.json`
- **Produced by:** analyze, improve
- **Requires:** `ir`, `evidence`
- **Source IR:** `ir.json`
- **Source evidence:** `evidence-map.json`
- **Hashes carried:** ir, evidence
- **Readable by:** machines
- **Statuses:** partial, stale, superseded
- **Only produced from:** screenshots evidence
- **Owned by:** `src/project/screenshot-report.mjs#projectEstimatedTokens`
- **Validated against:** *structure only*

### `component-inventory`

Every component found, with its anatomy, confidence and the evidence behind each part.

- **File:** `analysis/component-inventory.json`
- **Produced by:** analyze, recreate, adapt, extend, improve
- **Requires:** `ir`
- **Source IR:** `ir.json`
- **Source evidence:** `evidence-map.json`
- **Hashes carried:** ir
- **Readable by:** machines
- **Statuses:** complete, partial, blocked, stale, superseded
- **Owned by:** `src/project/components.mjs#projectComponents`
- **Validated against:** *structure only*

### `evidence-map`

The evidence records every claim points at. Nothing may cite an id that is not in here.

- **File:** `analysis/evidence-map.json`
- **Produced by:** analyze, recreate, adapt, extend, improve
- **Requires:** `evidence`
- **Source IR:** *none — not projected from an IR*
- **Source evidence:** `evidence records`
- **Hashes carried:** evidence
- **Readable by:** machines
- **Statuses:** complete, partial, blocked, stale, superseded
- **Owned by:** `src/pipeline.mjs#runPipeline`
- **Validated against:** `schemas/evidence.schema.json`

### `history-record`

What one iteration did, with its hashes. Appended, never rewritten.

- **File:** `history/<iteration>/run.json`
- **Produced by:** analyze, recreate, adapt, extend, improve
- **Requires:** *nothing beyond the run itself*
- **Source IR:** *none — not projected from an IR*
- **Source evidence:** *none*
- **Hashes carried:** *none*
- **Readable by:** machines
- **Statuses:** complete, partial, blocked
- **Owned by:** `src/fidelity/history.mjs#FidelityHistory`
- **Validated against:** `schemas/fidelity-run.schema.json`

### `recovery-record`

Every capture attempt, including the ones that failed and what was done about them.

- **File:** `history/<iteration>/recovery.json`
- **Produced by:** analyze, recreate, adapt, extend, improve
- **Requires:** *nothing beyond the run itself*
- **Source IR:** *none — not projected from an IR*
- **Source evidence:** *none*
- **Hashes carried:** *none*
- **Readable by:** machines
- **Statuses:** complete, partial
- **Owned by:** `src/driver/interface.mjs#runOperation`
- **Validated against:** `schemas/recovery-policy.schema.json`

### `extraction-warnings`

What the extractor could not read, and why. Always written — a silent extraction failure looks identical to a page that had nothing there.

- **File:** `output/extraction-warnings.md`
- **Produced by:** analyze, recreate, adapt, extend, improve
- **Requires:** `ir`
- **Source IR:** `ir.json`
- **Source evidence:** `evidence-map.json`
- **Hashes carried:** ir
- **Readable by:** people
- **Statuses:** complete, partial, blocked, stale, superseded
- **Must contain:** "What was analyzed", "Requested mode", "Source kind", "Evidence status", "Coverage", "Generated", "Limitations", "Next"
- **Owned by:** `src/project/coverage-report.mjs#projectExtractionWarnings`
- **Validated against:** *structure only*

### `mode-evaluation`

Whether the requested mode's requirements were met, requirement by requirement, with the remedy for each that was not.

- **File:** `output/mode-evaluation.md`
- **Produced by:** analyze, recreate, adapt, extend, improve
- **Requires:** `ir`, `mode-requirements`
- **Source IR:** `ir.json`
- **Source evidence:** `evidence-map.json`
- **Hashes carried:** ir
- **Readable by:** people
- **Statuses:** complete, partial, blocked, stale, superseded
- **Must contain:** "What was analyzed", "Requested mode", "Source kind", "Evidence status", "Coverage", "Generated", "Limitations", "Next"
- **Owned by:** `src/project/mode-evaluation.mjs#projectModeEvaluation`
- **Validated against:** `schemas/mode-requirements.schema.json`

### `fidelity-checklist`

What to check a build against, derived from what was measured. Withdrawn on a blocked run alongside the prompt it accompanies.

- **File:** `output/fidelity-checklist.md`
- **Produced by:** recreate, extend
- **Requires:** `ir`
- **Source IR:** `ir.json`
- **Source evidence:** `evidence-map.json`
- **Hashes carried:** ir
- **Readable by:** people
- **Statuses:** complete, partial, stale, superseded
- **Must contain:** "What was analyzed", "Requested mode", "Source kind", "Evidence status", "Coverage", "Generated", "Limitations", "Next"
- **Owned by:** `src/project/components.mjs#projectFidelityChecklist`
- **Validated against:** *structure only*

### `screenshot-evidence-report`

What screenshot evidence could and could not establish, and the ceiling it caps every claim at.

- **File:** `output/screenshot-evidence-report.md`
- **Produced by:** analyze, improve
- **Requires:** `ir`
- **Source IR:** `ir.json`
- **Source evidence:** `evidence-map.json`
- **Hashes carried:** ir
- **Readable by:** people
- **Statuses:** partial, blocked, stale, superseded
- **Only produced from:** screenshots evidence
- **Must contain:** "What was analyzed", "Requested mode", "Source kind", "Evidence status", "Coverage", "Generated", "Limitations", "Next"
- **Owned by:** `src/project/screenshot-report.mjs#projectScreenshotReport`
- **Validated against:** *structure only*

### `disagreement-report`

Where two sources disagreed, what each said, and which was preferred. Written whenever more than one source contributed.

- **File:** `output/disagreement-report.md`
- **Produced by:** analyze, recreate, adapt, extend, improve
- **Requires:** `ir`
- **Source IR:** `ir.json`
- **Source evidence:** `evidence-map.json`
- **Hashes carried:** ir
- **Readable by:** people
- **Statuses:** complete, partial, blocked, stale, superseded
- **Must contain:** "What was analyzed", "Requested mode", "Source kind", "Evidence status", "Coverage", "Generated", "Limitations", "Next"
- **Owned by:** `src/project/disagreement-report.mjs#projectDisagreementReport`
- **Validated against:** *structure only*

### `correction-tasks`

Manual tasks derived from a fidelity comparison. Every task is for a person; nothing is applied automatically.

- **File:** `output/correction-tasks.md`
- **Produced by:** recreate, adapt, extend, improve
- **Requires:** `fidelity-comparison`
- **Source IR:** `ir.json`
- **Source evidence:** `fidelity-comparison.json`
- **Hashes carried:** ir, configuration
- **Readable by:** people
- **Statuses:** complete, partial, stale, superseded
- **Must contain:** "What was analyzed", "Requested mode", "Source kind", "Evidence status", "Coverage", "Generated", "Limitations", "Next", "Tasks", "Acceptance"
- **Owned by:** *nothing yet*
- **Validated against:** *structure only*

### `correction-log`

Every correction a person filed, what it superseded, and whether a promotion followed.

- **File:** `corrections/correction-log.md`
- **Produced by:** recreate, adapt, extend, improve
- **Requires:** `corrections`
- **Source IR:** *none — not projected from an IR*
- **Source evidence:** `corrections/`
- **Hashes carried:** *none*
- **Readable by:** people
- **Statuses:** complete, partial
- **Must contain:** "Corrections"
- **Owned by:** *nothing yet*
- **Validated against:** `schemas/correction.schema.json`

## Artifact statuses

| Status | Meaning |
| --- | --- |
| `complete` | Generated from evidence that met the mode's requirements. |
| `partial` | Generated, but the evidence did not cover everything it describes. |
| `blocked` | The safety gate refused the full artifact; this is the explanation. |
| `stale` | Its source moved after it was written. Preserved, not trusted. |
| `superseded` | A newer iteration replaced it. Kept for history. |

An artifact may only carry a status its definition lists. A rebuild prompt cannot be
`partial`: a set of build instructions with some of the values missing is not a partial
prompt, it is a wrong one.

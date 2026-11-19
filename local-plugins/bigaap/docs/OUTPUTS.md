# What each mode produces

**Generated from `src/artifacts/registry.mjs` by `node tools/generate-command-docs.mjs`.**

A mode is not a formatting choice. Each one makes a different claim, and the artifacts
it may produce follow from what its evidence can support.

## The matrix

| Artifact | analyze | recreate | adapt | extend | improve |
| --- | --- | --- | --- | --- | --- |
| `design-spec` | **required** | **required** | **required** | **required** | **required** |
| `rebuild-prompt` | — | **required** | — | **required** | — |
| `adaptation-prompt` | — | — | **required** | — | — |
| `improvement-prompt` | — | — | — | — | **required** |
| `implementation-notes` | — | optional | optional | optional | — |
| `coverage-report` | **required** | **required** | **required** | **required** | **required** |
| `evidence-report` | optional | optional | optional | optional | optional |
| `blocked-prompt` | optional | optional | optional | optional | optional |
| `fidelity-report` | — | optional | optional | optional | optional |
| `readiness-report` | optional | optional | optional | optional | optional |
| `extracted-tokens` | optional | **required** | **required** | optional | optional |
| `estimated-tokens` | optional | — | — | — | optional |
| `component-inventory` | **required** | **required** | **required** | **required** | **required** |
| `evidence-map` | **required** | **required** | **required** | **required** | **required** |
| `history-record` | optional | optional | optional | optional | optional |
| `recovery-record` | optional | optional | optional | optional | optional |
| `extraction-warnings` | **required** | **required** | **required** | **required** | **required** |
| `mode-evaluation` | **required** | **required** | **required** | **required** | **required** |
| `fidelity-checklist` | — | **required** | — | **required** | — |
| `screenshot-evidence-report` | optional | — | — | — | optional |
| `disagreement-report` | optional | optional | optional | optional | optional |
| `correction-tasks` | — | optional | optional | optional | optional |
| `correction-log` | — | optional | optional | optional | optional |

`—` means refused, not merely unusual: producing it from that mode is reported as a
`wrong-mode` error.

## Per mode

### `analyze`

**Always writes:** `output/design-spec.md`, `output/coverage-report.md`, `analysis/component-inventory.json`, `analysis/evidence-map.json`, `output/extraction-warnings.md`, `output/mode-evaluation.md`

**May write:** `output/evidence-report.md`, `output/blocked-prompt.md`, `output/readiness-report.md`, `analysis/extracted-tokens.json`, `analysis/estimated-tokens.json`, `history/<iteration>/run.json`, `history/<iteration>/recovery.json`, `output/screenshot-evidence-report.md`, `output/disagreement-report.md`

**Implementation prompt:** none. This mode explains; it does not instruct.

### `recreate`

**Always writes:** `output/design-spec.md`, `output/rebuild-prompt.md`, `output/coverage-report.md`, `analysis/extracted-tokens.json`, `analysis/component-inventory.json`, `analysis/evidence-map.json`, `output/extraction-warnings.md`, `output/mode-evaluation.md`, `output/fidelity-checklist.md`

**May write:** `output/implementation-notes.md`, `output/evidence-report.md`, `output/blocked-prompt.md`, `output/fidelity-report.md`, `output/readiness-report.md`, `history/<iteration>/run.json`, `history/<iteration>/recovery.json`, `output/disagreement-report.md`, `output/correction-tasks.md`, `corrections/correction-log.md`

**Implementation prompt:** `output/rebuild-prompt.md` — withdrawn when the run is blocked, and refused on screenshots evidence.

### `adapt`

**Always writes:** `output/design-spec.md`, `output/adaptation-prompt.md`, `output/coverage-report.md`, `analysis/extracted-tokens.json`, `analysis/component-inventory.json`, `analysis/evidence-map.json`, `output/extraction-warnings.md`, `output/mode-evaluation.md`

**May write:** `output/implementation-notes.md`, `output/evidence-report.md`, `output/blocked-prompt.md`, `output/fidelity-report.md`, `output/readiness-report.md`, `history/<iteration>/run.json`, `history/<iteration>/recovery.json`, `output/disagreement-report.md`, `output/correction-tasks.md`, `corrections/correction-log.md`

**Implementation prompt:** `output/adaptation-prompt.md` — withdrawn when the run is blocked, and refused on screenshots evidence.

### `extend`

**Always writes:** `output/design-spec.md`, `output/rebuild-prompt.md`, `output/coverage-report.md`, `analysis/component-inventory.json`, `analysis/evidence-map.json`, `output/extraction-warnings.md`, `output/mode-evaluation.md`, `output/fidelity-checklist.md`

**May write:** `output/implementation-notes.md`, `output/evidence-report.md`, `output/blocked-prompt.md`, `output/fidelity-report.md`, `output/readiness-report.md`, `analysis/extracted-tokens.json`, `history/<iteration>/run.json`, `history/<iteration>/recovery.json`, `output/disagreement-report.md`, `output/correction-tasks.md`, `corrections/correction-log.md`

**Implementation prompt:** `output/rebuild-prompt.md` — withdrawn when the run is blocked, and refused on screenshots evidence.

### `improve`

**Always writes:** `output/design-spec.md`, `output/improvement-prompt.md`, `output/coverage-report.md`, `analysis/component-inventory.json`, `analysis/evidence-map.json`, `output/extraction-warnings.md`, `output/mode-evaluation.md`

**May write:** `output/evidence-report.md`, `output/blocked-prompt.md`, `output/fidelity-report.md`, `output/readiness-report.md`, `analysis/extracted-tokens.json`, `analysis/estimated-tokens.json`, `history/<iteration>/run.json`, `history/<iteration>/recovery.json`, `output/screenshot-evidence-report.md`, `output/disagreement-report.md`, `output/correction-tasks.md`, `corrections/correction-log.md`

**Implementation prompt:** `output/improvement-prompt.md` — withdrawn when the run is blocked, and refused on no evidence.

## Source-kind protections

| Artifact | Rule |
| --- | --- |
| `rebuild-prompt` | never produced from screenshots evidence |
| `adaptation-prompt` | never produced from screenshots evidence |
| `extracted-tokens` | never produced from screenshots evidence |
| `estimated-tokens` | only produced from screenshots evidence |
| `screenshot-evidence-report` | only produced from screenshots evidence |

The load-bearing pair is `extracted-tokens.json` and `estimated-tokens.json`. They are
separate files rather than one file with a status field, because anything reading a
file named `extracted-tokens.json` will treat its values as exact — and most readers
will not check a status field before doing so.

## What a blocked run leaves behind

**Written:**

- `output/partial-design-spec.md` — under a name that cannot be mistaken for a complete artifact
- `output/coverage-report.md`
- `output/evidence-report.md`
- `output/blocked-prompt.md`
- `output/fidelity-report.md`
- `output/readiness-report.md`
- `analysis/extracted-tokens.json`
- `analysis/estimated-tokens.json`
- `analysis/component-inventory.json`
- `analysis/evidence-map.json`
- `history/<iteration>/run.json`
- `history/<iteration>/recovery.json`
- `output/extraction-warnings.md`
- `output/mode-evaluation.md`
- `output/screenshot-evidence-report.md`
- `output/disagreement-report.md`
- `corrections/correction-log.md`

**Withdrawn, with the removal recorded in history:**

- `output/rebuild-prompt.md`
- `output/adaptation-prompt.md`
- `output/improvement-prompt.md`
- `output/implementation-notes.md`
- `output/fidelity-checklist.md`
- `output/correction-tasks.md`

A build prompt from a previous run, sitting in a directory beside a report explaining
why this run was refused, is the most dangerous file this system can leave behind. It
reads exactly as authoritative as it did yesterday. So it is withdrawn — and because a
removal with no trace is indistinguishable from a file that never existed, the removal
is recorded with the file's hash and where its content is preserved.

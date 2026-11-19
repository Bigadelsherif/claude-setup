# Phase 5 — plan

**This is a plan. Nothing in it is implemented.** No production file changed in
writing it.

Phase 5 productizes what already exists. Phases 0–4.9 built an instrument that
measures carefully and reports honestly; almost none of that is pleasant to use.
Phase 5 closes that gap and adds no measurement capability.

---

## 1. Product goal

**Make the existing analysis, prompt-generation and limited fidelity workflow
reliable and pleasant to use from Claude Code.**

Reliable means: a command tells you what it needs, refuses clearly when it
cannot proceed, and never produces an artifact the evidence does not support.
Pleasant means: the common path is short, the vocabulary is consistent, and the
output is readable by a person before it is parseable by a machine.

Nothing in Phase 5 changes what the system can measure. If a Phase 5 change
alters a measurement, it is out of scope and should be filed rather than made.

### The one-line test for any Phase 5 change

*Would this change what the instrument reports, or only how a person reaches it?*
Only the second kind belongs here.

---

## 2. Non-goals

Explicitly out of scope, and not deferred-with-a-wink — these are decisions:

| Not in Phase 5 | Status |
| --- | --- |
| SaaS packaging | deferred to a later phase, with its own plan |
| Billing | deferred |
| Collaboration, multi-user accounts | deferred |
| Public hosting, web dashboard | deferred |
| Figma integration | deferred |
| **Authenticated capture** | **permanently out of scope.** A scope decision, not an evidence gap |
| **Automatic component-level correction** | **blocked by `def_0030`, a permanent limitation** |
| Broad framework support | deferred; one primary stack adapter in Phase 5 |
| Unattended/CI execution | deferred; the CLI is for an operator reading results |

Two of these are permanent. The rest are "not yet, and each needs its own plan".

---

## 3. Supported users and workflows

### Who

One developer or designer, working in one project, in Claude Code, on a machine
they control. That is the whole audience for Phase 5, and it is a boundary
rather than a starting point — the run directory is not concurrency-safe, and
nothing in Phase 5 makes it so.

### What they do

| Workflow | Frequency | Phase 5 priority |
| --- | --- | --- |
| Analyze a live reference | most common | highest |
| Analyze from screenshots only | common when a URL is unavailable | high |
| Generate an adaptation prompt against a brief | common | high |
| Generate an improvement prompt | common | high |
| Conditional rebuild prompt | occasional | medium |
| Fidelity comparison | occasional, and the most gated | medium |
| Record a correction | occasional, and load-bearing | medium |

### What they must never be able to do by accident

- Get an implementation prompt from evidence that does not support one.
- Get an artifact whose IR hash does not match the IR it claims to describe.
- Overwrite reference evidence with a configuration value.
- Read a score as a verdict.

---

## 4. Plugin architecture

### Layering, and the rule that keeps it honest

```
  Claude Code skill / slash commands
            │
            ▼
  Guided workflow layer          ← Phase 5. Asks, validates, explains, sequences
            │
            ▼
  CLI command layer              ← exists (Phase 4.8). Typed result contract
            │
            ▼
  Pipeline · fidelity · capture  ← exists. Unchanged by Phase 5
            │
            ▼
  Browser driver adapter         ← exists. The only Playwright importer
```

**The rule:** the workflow layer may only call the CLI layer, and may not reach
past it into the pipeline. Anything a workflow needs that the CLI cannot express
is a missing CLI capability, added there and given a typed result — not a
shortcut taken in the workflow.

This matters because the CLI layer is where `blocked` is distinguished from
`failed`, where hashes are attached, and where attempt history is preserved. A
workflow that bypasses it loses all three silently.

### Stack adapters sit beside the IR, never inside it

```
  IR (stack-agnostic)  ──→  stack adapter  ──→  implementation prompt
       │
       └──→ design-spec.md (stack-agnostic)
```

The IR records what was measured. A stack adapter renders that into instructions
for one target stack. **The analysis core must not import a stack adapter**, and
an audit invariant should enforce it the way the Playwright isolation invariant
is enforced today.

---

## 5. Command catalog

Fourteen commands. Each entry states required inputs, optional inputs, outputs,
statuses, failure behaviour, and an example.

Statuses are the seven from §13. Exit codes are inherited from the Phase 4.8
contract: `0` completed / completed-with-warnings, `1` failed, `3` blocked,
`4` cancelled, `5` not-attempted, and a new `6` for `requires-user-input`.

**No command name may imply a capability that does not exist.** In particular
there is no `bigaap fix`, no `bigaap apply`, and no `bigaap login`.

---

### 5.1 `bigaap init`

Initialize a project.

| | |
| --- | --- |
| **Required** | none — runs interactively |
| **Optional** | `--reference <url>`, `--stack <name>`, `--non-interactive`, `--dir <path>` |
| **Outputs** | `.bigaap-analyzer/` with config, brief template, workspace, output dirs |
| **Statuses** | completed · requires-user-input · failed |
| **Failure** | An existing `.bigaap-analyzer/` is never overwritten. Reports `failed` and points at `bigaap upgrade` |
| **Modes** | n/a |

```bash
bigaap init --reference https://example.com --stack next-tailwind
```

---

### 5.2 `bigaap analyze`

Analyze a live reference. Captures, derives the IR, projects artifacts.

| | |
| --- | --- |
| **Required** | a configured reference, or `--url` |
| **Optional** | `--for <mode>`, `--viewports`, `--states`, `--motion`, `--strict` |
| **Outputs** | `analysis/*.json`, `output/design-spec.md`, `coverage-report.md`, `evidence-report.md`, `mode-evaluation.md`, plus mode-specific prompts |
| **Statuses** | completed · completed-with-warnings · blocked · failed |
| **Failure** | A capture that cannot complete is `blocked` with the driver's typed code and its recommendation. Reference evidence from a previous run is never discarded |
| **Modes** | analyze · recreate · adapt · extend · improve |

```bash
bigaap analyze --for adapt --viewports 1440,768,375
```

---

### 5.3 `bigaap analyze-screenshots`

Analyze from screenshots when no URL is available.

| | |
| --- | --- |
| **Required** | `--images <dir or files>` |
| **Optional** | `--viewport-hint`, `--regions <file>` |
| **Outputs** | `analysis/screenshot-capture.json`, `output/screenshot-evidence-report.md`, a **partial** design spec |
| **Statuses** | completed-with-warnings · blocked · failed |
| **Failure** | Blocked if no region can be resolved |
| **Modes** | analyze only |

**This command can never return plain `completed`.** Screenshot evidence is
`estimated` by construction and ceiling-capped; the warning is the point.

```bash
bigaap analyze-screenshots --images ./refs --viewport-hint 1440
```

---

### 5.4 `bigaap brief`

Create or validate a target brief.

| | |
| --- | --- |
| **Required** | one of `--create`, `--validate`, `--edit` |
| **Optional** | `--from <file>` |
| **Outputs** | `input/target-brief.json`, a validation report |
| **Statuses** | completed · requires-user-input · failed |
| **Failure** | A malformed brief reports each violation against `target-brief.schema.json` with its path |
| **Modes** | n/a |

**`--create` never invents content.** It writes a template with every field
marked `REQUIRED — describe your product` and refuses to proceed while any
remains unfilled.

```bash
bigaap brief --create
bigaap brief --validate
```

---

### 5.5 `bigaap prompt adapt`

| | |
| --- | --- |
| **Required** | an analyzed reference; a valid target brief |
| **Optional** | `--stack`, `--out` |
| **Outputs** | `output/adaptation-prompt.md` |
| **Statuses** | completed · completed-with-warnings · blocked · requires-user-input |
| **Failure** | No brief → `requires-user-input` naming the missing fields. Insufficient evidence → `blocked` with the unmet mode requirements |
| **Modes** | adapt |

---

### 5.6 `bigaap prompt improve`

| | |
| --- | --- |
| **Required** | an analyzed reference |
| **Optional** | `--stack`, `--focus <category>` |
| **Outputs** | `output/improvement-prompt.md` |
| **Statuses** | completed · completed-with-warnings · blocked |
| **Modes** | improve |

---

### 5.7 `bigaap prompt rebuild`

The conditional rebuild prompt.

| | |
| --- | --- |
| **Required** | an analyzed reference meeting `recreate`'s requirements |
| **Optional** | `--stack`, `--accept-conditions` |
| **Outputs** | `output/rebuild-prompt.md`, `output/fidelity-checklist.md` — **or** `output/blocked-prompt.md` |
| **Statuses** | completed-with-warnings · blocked |
| **Failure** | When blocked it emits `blocked-prompt.md`, which explains what is missing and **contains no implementation instructions** |
| **Modes** | recreate |

**Conditional is not a hedge.** A rebuild prompt always carries its conditions,
and this command never returns plain `completed` — a rebuild is a starting
point judged by the fidelity loop, never a verified match.

---

### 5.8 `bigaap fidelity`

Run a fidelity comparison.

| | |
| --- | --- |
| **Required** | an analyzed reference; a target URL |
| **Optional** | `--viewports`, `--content-mode`, `--relationship`, `--states` |
| **Outputs** | an iteration under `history/`, `output/fidelity-report.md`, `output/correction-tasks.md` |
| **Statuses** | completed · completed-with-warnings · blocked · not-attempted |
| **Failure** | A gate refusal is `blocked` and emits **no** category scores and **no** tasks |
| **Modes** | equivalent-content · independent-content |

Wraps the existing `session` → `reference` → `capture` → `compare` sequence so
the operator issues one command rather than four.

---

### 5.9 `bigaap history`

| | |
| --- | --- |
| **Required** | none |
| **Optional** | `--iteration <n>`, `--verify` |
| **Outputs** | a listing; re-verified hashes |
| **Statuses** | completed · completed-with-warnings · not-attempted |
| **Failure** | Hash drift is `completed-with-warnings` and names the drifted files |

Iteration numbers are **not guaranteed contiguous** — an interrupted run leaves
its directory and the next write skips the number. The listing must say so
rather than letting a reader infer a lost iteration.

---

### 5.10 `bigaap recovery`

| | |
| --- | --- |
| **Required** | none |
| **Optional** | `--run <dir>`, `--failed-only` |
| **Outputs** | attempt history across every capture |
| **Statuses** | completed · completed-with-warnings · not-attempted |

---

### 5.11 `bigaap blockers`

Review what is currently blocking, without running anything.

| | |
| --- | --- |
| **Required** | none |
| **Optional** | `--for <mode>` |
| **Outputs** | a blocker list with the remedy for each |
| **Statuses** | completed · not-attempted |
| **Failure** | none — this command reports, it never executes |

The most important new command in Phase 5. It answers "why can't I get a
rebuild prompt?" without making the user trigger a blocked run to find out.

---

### 5.12 `bigaap tasks`

| | |
| --- | --- |
| **Required** | at least one fidelity iteration |
| **Optional** | `--iteration <n>`, `--format md\|json` |
| **Outputs** | `output/correction-tasks.md` |
| **Statuses** | completed · blocked · not-attempted |

**Every task is manual.** The output carries `automatic: false` and says so in
its first line.

---

### 5.13 `bigaap readiness`

| | |
| --- | --- |
| **Required** | none |
| **Optional** | `--json` |
| **Outputs** | `output/readiness-report.md` |
| **Statuses** | completed |

Prints the separate decisions. **No overall verdict**, and a test asserts the
output contains no such field.

---

### 5.14 `bigaap validate`

Validate generated artifacts.

| | |
| --- | --- |
| **Required** | none |
| **Optional** | `--strict`, `--fix-stale` |
| **Outputs** | a validation report |
| **Statuses** | completed · failed |
| **Failure** | A stale or hand-edited artifact is `failed`, naming the file and the hash mismatch |

`--fix-stale` **regenerates from the IR**. It never edits an artifact in place,
because an artifact is a projection and editing one is how it stops being one.

---

## 6. Project initialization

`bigaap init` creates:

```
.bigaap-analyzer/
  config.json               project configuration
  source.json               reference configuration
  preferences.json          user preferences
  stack.json                stack adapter configuration
  accessibility.json        tap-target and contrast policy
  fidelity.json             viewports, content mode, state list
  artifacts.json            output paths, history retention
  input/
    target-brief.json       template, every field marked REQUIRED
  raw/                      captures
  analysis/                 evidence and IR
  output/                   generated artifacts
  history/                  fidelity iterations, append-only
  feedback/corrections/     correction records
  logs/                     local telemetry
```

### Interactive by default

`init` asks for the reference URL, the target stack, the viewports and the
accessibility policy, showing the default and its rationale for each. It never
guesses a target brief.

`--non-interactive` requires every answer as a flag and **fails** rather than
defaulting where a default would be a guess.

### Never overwrites

An existing `.bigaap-analyzer/` is not overwritten. `init` reports `failed` and
directs the user to `bigaap upgrade`, which migrates configuration and leaves
evidence alone.

---

## 7. Configuration schemas

New schemas, in the style of the existing fifteen:

| Schema | Governs |
| --- | --- |
| `project-config.schema.json` | `config.json` |
| `source-config.schema.json` | `source.json` |
| `preferences.schema.json` | `preferences.json` |
| `stack-adapter.schema.json` | `stack.json` |
| `accessibility-policy.schema.json` | `accessibility.json` |
| `fidelity-config.schema.json` | `fidelity.json` |
| `artifact-config.schema.json` | `artifacts.json` |

### The provenance field — the part that matters

Every configuration value carries `kind`, and the kinds are **not
interchangeable**:

| `kind` | Means | May override evidence? |
| --- | --- | --- |
| `user-preference` | how output is presented | **no** |
| `project-requirement` | a constraint this project imposes | **no** |
| `reference-fact` | something measured from the reference | **it IS evidence; config may not set this** |
| `target-brief-requirement` | something the product must do | **no** |
| `tool-default` | what the tool chose, with its rationale | **no** |
| `unsupported-request` | recorded and refused | **no** |

**Configuration may never overwrite reference evidence.** A config file that
sets a `reference-fact` is a validation error, not a precedence question. The
only path from a person to a claim is a **correction record**, which carries
evidence, scope and a promotion decision.

`unsupported-request` exists so that asking for something unavailable is
recorded rather than silently dropped — a user who sets
`authenticatedCapture: true` gets an explicit refusal with the reason, not
silence.

---

## 8. Guided workflow design

Six workflows: **Analyze, Recreate, Adapt, Extend, Improve, Fidelity check.**

Each runs the same seven steps, in this order:

1. **Collect required inputs.** Missing input → `requires-user-input`, naming
   each field and where it goes. Never invented.
2. **Validate the requested mode** against `mode-requirements.schema.json`.
3. **Inspect evidence sufficiency** — coverage, contested claims, unknowns that
   the requested mode depends on.
4. **Explain blockers before execution.** If the mode cannot be satisfied, say
   so *now*, with the remedy, and do not capture.
5. **Run the correct pipeline.**
6. **Generate only valid artifacts, and prune stale ones.** An artifact the mode
   does not support is not written; one left over from a previous mode is
   removed, and the removal is reported.
7. **Report twice** — a concise human-readable result to the terminal, and the
   full machine-readable contract to `output/`.

### Step 4 is the one that changes the experience

Today a user discovers a blocker by triggering it. In Phase 5 the workflow
inspects first and explains before capturing, so a run that cannot succeed does
not cost a browser launch and a minute of waiting to say so.

### Never invented

The workflow never fabricates a target brief, a product requirement, or a
missing design value. Where a value is unknown, it stays `unknown` and the
artifact says so. This is not a UX preference; it is what the whole evidence
model is for.

---

## 9. Mode behavior

Five modes, already implemented, surfaced consistently:

| Mode | Needs a brief | Emits | Blocked behaviour |
| --- | --- | --- | --- |
| `analyze` | no | spec, coverage, evidence reports | rarely blocks; degrades with warnings |
| `recreate` | no | rebuild prompt + fidelity checklist | `blocked-prompt.md`, no implementation content |
| `adapt` | **yes** | adaptation prompt | `requires-user-input` if no brief; `blocked` if evidence insufficient |
| `extend` | yes | extension guidance | as `adapt` |
| `improve` | no | improvement prompt | `blocked` with unmet requirements |

A mode is refused, never downgraded silently. If `recreate` is unavailable, the
workflow says which requirement failed and what would satisfy it — it does not
quietly produce `analyze` output and let the user assume.

---

## 10. Output artifact structure

```
output/
  design-spec.md            what was measured, stack-agnostic
  rebuild-prompt.md         recreate — conditional
  adaptation-prompt.md      adapt — needs a brief
  improvement-prompt.md     improve
  implementation-notes.md   NEW — stack-specific caveats
  coverage-report.md        what was reached, what was not
  evidence-report.md        NEW — claims by status, with provenance
  correction-tasks.md       manual tasks from a fidelity run
  fidelity-report.md        NEW — the comparison, human-readable
  blocked-prompt.md         why no prompt was produced
  readiness-report.md       NEW — the separate decisions
```

### Every artifact carries

- `<!-- bigaap:ir-hash sha256:... -->`
- source and mode
- evidence status per claim: **measured · observed · inferred · estimated ·
  contested · unknown**
- its own limitations, inline rather than in an appendix

### Validation fails when

- the IR hash does not match the current IR (stale)
- the file's own hash does not match its recorded hash (hand-edited)
- the artifact is not supported by the mode that produced the run

### The rule that keeps artifacts honest

**An artifact is a projection, never a source.** Editing one is unsupported and
detectable. To change a claim, file a correction and regenerate.

Artifacts the requested mode does not support are **not written**, and stale
ones from a previous mode are **pruned and reported** — the existing pipeline
already does this and Phase 5 must not weaken it.

---

## 11. Prompt-generation architecture

### The separation

```
IR  ──→  prompt planner (stack-agnostic)  ──→  stack adapter  ──→  prompt.md
```

The planner decides *what* to say from the evidence: which tokens, which
components, which states, which responsive behaviour, which acceptance criteria,
which limitations. The adapter decides *how* to say it for one stack.

**The analysis core must not depend on Next.js or Tailwind**, and an audit
invariant should assert that no file under `src/evidence/`, `src/ir/` or
`src/extract/` mentions a stack name.

### Primary adapter: `next-tailwind`

- Next.js App Router · React · TypeScript
- Tailwind CSS, with **CSS custom properties as the token source of truth**
- GSAP or native CSS motion where the evidence supports a motion claim — and
  **only** where it does; an unmeasured transition is not invented

It is the *primary* adapter, not the only possible one. A second adapter is
deferred, and the architecture exists so adding one does not touch the IR.

### Every prompt must carry

- target product requirements (adapt/extend only, from the brief)
- responsive behaviour, per captured viewport
- accessibility, with the tap-target policy named and its rationale
- interaction states, with unavailable ones marked unknown rather than omitted
- acceptance criteria, checkable by a person
- **evidence limitations** — what was estimated, contested or unknown
- **manual correction tasks**, marked manual

### What a prompt may never do

- Copy a logo, brand name, proprietary copy, distinctive illustration,
  copyrighted photography or unique brand mark from the reference.
- Present an `estimated` value as if measured.
- Recommend a utility class or a hashed class as a deploy-stable selector.
- Claim a selector is deploy-safe. **`def_0020` is open and its containment
  marker was not built**, so a reader cannot tell which emitted selectors carry
  the unanchored-root risk. Every prompt that emits selectors must say this.

---

## 12. Correction workflow

Ten steps, each its own command or subcommand:

1. **Inspect a claim** — `bigaap claim <path>`: value, status, confidence, the
   evidence behind it.
2. **Inspect evidence** — every record supporting the claim, with method.
3. **Compare candidates** — where evidence disagrees, all candidates with their
   support, and no automatic tie-break.
4. **Record a correction** — `bigaap correct <claim> --value <v> --why <text>`.
5. **Choose scope** — `reference` (this project) or `global` (a learned rule).
6. **Preview affected artifacts** — which files change, before anything is
   written.
7. **Regenerate projections** — from the corrected IR.
8. **Review changes** — a diff of claims, not of prose.
9. **Reject a correction** — remove it and regenerate; the record is retained
   as rejected rather than deleted.
10. **Promote explicitly** — `bigaap promote`, never automatic, and requiring
    **two independent witnesses** unless forced with a recorded reason.

### Preserved, always

Original evidence · correction history · scope · recurrence count · promotion
status · affected artifacts · IR hashes before and after.

A correction never edits evidence. It supersedes a claim and records that it
did, so the original is still readable.

### Automatic correction

Limited to **global values already supported** — a token value applied
consistently across a project. **Component-level automatic correction is not
enabled**, and `def_0030` is a permanent limitation, not a pending one.

---

## 13. Readiness and safety UX

### Seven statuses

| Status | Exit | Means |
| --- | --- | --- |
| `completed` | 0 | done |
| `completed-with-warnings` | 0 | done, with something recorded beside it |
| `blocked` | 3 | a gate refused it; evidence intact, reason recorded |
| `failed` | 1 | the work broke |
| `cancelled` | 4 | stopped deliberately |
| `not-attempted` | 5 | nothing to do |
| `requires-user-input` | **6** | **NEW** — cannot proceed without an answer only the user has |

`requires-user-input` is new and load-bearing. Today a missing brief reports
`not-attempted`, which reads as "nothing to do" when the truth is "waiting for
you". They are different and must not share a code.

### Every workflow result shows

requested mode · evidence coverage · confidence (provenance × coverage, **paired,
never multiplied into one number**) · blockers · warnings · unknowns · contested
claims · open limitations · recommended next action.

### Never shown

- **No overall quality score.** There is no composite score anywhere and an
  audit invariant enforces it across sources and artifacts.
- **No overall readiness verdict.** The decisions differ, and one summary would
  have to hide the difference.

### Presentation rules

- A `null` score is rendered as `no evidence`, never as `0`.
- `blocked` and `failed` are visually distinct, not merely differently worded.
- A recommendation accompanies every blocker. A blocker without a remedy is a
  dead end.

---

## 14. Observability and privacy

**The privacy boundary is defined before any collection is implemented.** The
specification exists at `docs/PHASE-4.9-OBSERVABILITY.md`; Phase 5 implements it
unchanged, or amends it deliberately before implementing.

### Local log format

`.bigaap-analyzer/logs/telemetry.jsonl` — one JSON object per line, one line per
command:

`command · mode · sourceKind · viewport · status · blockers · evidenceCoverage ·
driverErrors · recoveryAttempts · timeouts · artifactHashes · defectCandidates ·
duration · correlationId`

### Never recorded, and never uploaded

Source pages · screenshots · user content · **target briefs** · proprietary copy
· brand assets · captured DOM · full URLs (origin only) · gate messages (codes
only).

The failure mode to design against is not a leak. It is a diagnostic channel
that becomes a content channel one useful field at a time — each addition
defensible, the sum indefensible.

### Retention

Rolling, project-local, capped by count and age (default 30 days / 500 entries),
pruned on write. A log that grows forever becomes a liability nobody chose.

### Redaction

Applied at **write** time, not at export. A redaction that only runs on export
means the unredacted data existed on disk, and the moment it does, the boundary
is a promise rather than a property.

### Correlation IDs

One per workflow invocation, propagated to every CLI call and capture contract
it makes. Random per run, never derived from anything about the user or target.

### Diagnostic export

`bigaap diagnostics --export` is **opt-in per invocation**. It prints exactly
what the bundle contains before writing it and requires confirmation. There is
no automatic upload and no background reporting.

### Error reporting

Errors are written locally with their correlation ID. **Nothing is transmitted.**
If remote error reporting is ever wanted, it needs its own plan and its own
consent design.

---

## 15. Installation and upgrade

### Standalone repository

```bash
git clone <repo> && cd bigaap-website-analyzer
npm install                 # Playwright is the only dependency, and it is a devDependency
npx playwright install chromium
node bin/bigaap.mjs init
```

### Claude Code plugin

Installed as a plugin exposing the commands as slash commands, backed by a skill
that carries the workflow guidance. **No Docker, at any point** — a tool that
requires a container to analyze a web page has misjudged its own weight.

### Version compatibility

Three versions already travel on every artifact and must keep doing so:

| Version | Changing it means |
| --- | --- |
| `EXTRACTOR_VERSION` | captures are **incompatible**; recapture required |
| `TOLERANCE_VERSION` | comparisons are incompatible |
| `CAPTURE_CONTRACT_VERSION` | artifacts need migration |

`bigaap upgrade` migrates configuration, reports which artifacts became stale,
and **never rewrites evidence**. Stale artifacts are regenerated from the IR or
reported as needing recapture — never silently reinterpreted.

### Uninstall

`bigaap uninstall` removes the plugin registration. It does **not** delete
`.bigaap-analyzer/`, and says so — a tool that deletes a user's evidence on
uninstall is a tool nobody trusts twice.

---

## 16. Testing strategy

### The floor, and it does not move

**588 unit · 12 live smoke · 50 CLI smoke · 21 audit invariants must remain
passing.** No existing test may be weakened, deleted, or have an assertion
loosened to accommodate Phase 5. A Phase 5 change that breaks an existing test
is wrong until proven otherwise, and the proof is a defect record.

### New coverage

| Area | Kind | Notes |
| --- | --- | --- |
| Plugin installation | integration | fresh checkout → working command |
| Command discovery | unit | every catalogued command is reachable and in help |
| Project initialization | integration | interactive and `--non-interactive` |
| Configuration validation | unit | each schema, valid and invalid |
| Every supported mode | integration | five modes end to end |
| Missing target brief | unit | `requires-user-input`, never invented |
| Malformed target brief | unit | every violation named with its path |
| Stale artifacts | unit | hash mismatch → validation failure |
| Blocked runs | integration | no prompt emitted, blocker explained |
| Failed runs | integration | distinct from blocked, distinct exit code |
| Correction workflows | integration | all ten steps, including reject |
| Output hashes | unit | every artifact carries and matches its IR hash |
| Prompt projections | unit | no brand assets; no unsupported claims; limitations present |
| Fidelity reports | integration | null scores rendered as no-evidence |
| **Privacy and redaction** | unit | **no forbidden field ever reaches a log line** |
| Recovery history | unit | preserved across retries |
| CLI exit codes | unit | all seven, including the new `6` |

### The privacy tests deserve their own note

They must assert the **absence** of forbidden content in written logs, using
realistic inputs — a brief with proprietary copy, a URL with a customer name in
its path, a page with brand text. Asserting that a redaction function works is
not the same as asserting nothing forbidden reaches disk.

---

## 17. Documentation strategy

| Document | Answers |
| --- | --- |
| `README.md` | what this is, in five lines, including what it does not do |
| `QUICKSTART.md` | reference URL → design spec, in under ten minutes |
| `WORKFLOWS.md` | the six guided workflows, one page each |
| `COMMANDS.md` | the fourteen commands, generated from the catalog |
| `CONFIGURATION.md` | every schema, every kind, and why config cannot override evidence |
| `LIMITATIONS.md` | the standing limitations, first-class rather than an appendix |
| `TROUBLESHOOTING.md` | every blocker code and its remedy |
| `CORRECTIONS.md` | how to disagree with a claim, and what happens next |

### Two rules

**The limitations are not an appendix.** `README.md` carries the short list on
its first screen: no validated threshold set, no authenticated capture, no
automatic component correction, two open defects and one permanent limitation.

**`COMMANDS.md` is generated from the command catalog**, so documentation cannot
drift from behaviour. A hand-written command reference is wrong within a month.

---

## 18. Private-release boundary

Twelve surfaces, decided separately. **There is no overall verdict.**

| Surface | Decision | Conditions |
| --- | --- | --- |
| Personal local use | **supported** | the intended shape |
| Claude Code project use | **supported** | one project, one operator; the run directory is not concurrency-safe |
| Public marketing sites | **supported with limits** | six real targets; no evidence for CDN-varying responses, heavy client routing, or content changing between captures |
| Dashboards | **supported with limits** | untested as a class. Heavy client routing and virtualised lists are exactly the unmeasured cases |
| Utility-heavy sites | **supported with limits** | `def_0022` open; ~1 name in 800 misclassified; the cost is a weaker selector, never a wrong claim |
| Screenshot-only references | **supported with limits** | evidence is `estimated` and ceiling-capped; `recreate` is unavailable from screenshots alone |
| **Authenticated pages** | **not supported** | permanently. No command accepts credentials |
| Adaptation workflows | **supported** | requires a valid brief; does not verify the result satisfies it |
| Recreation workflows | **supported, conditionally** | judged by the fidelity loop; a starting point, never a verified match |
| Fidelity workflows | **supported with limits** | no validated threshold set; scores are measurements, not verdicts |
| **Automatic corrections** | **global values only** | component-level permanently unavailable |
| **Unattended execution** | **not supported** | the CLI is for an operator reading results |

### Preserved limitations

- Authenticated targets not supported.
- Production automation not supported.
- Automatic component-level correction not supported.
- Cross-implementation component matching not supported — `def_0030`, permanent.
- The measured tolerances are not fully validated: 2 of 17 entries are
  `validated`, both finite policies; every measured numeric tolerance is not,
  and `TOLERANCES.$validated` stays `false`.
- `def_0020` open — unanchored structural selectors, containment marker not built.
- `def_0022` open — vowel-ratio misclassification.
- `def_0030` permanent limitation.
- Deploy-safety is not universal and is not claimed anywhere.

---

## 19. Implementation phases

Ordered to minimise risk. Each step is shippable and leaves the system working.

| # | Step | Why here | Risk |
| --- | --- | --- | --- |
| 1 | **Plugin command surface** | Everything else attaches to it. Naming is cheap to change now and expensive later | low |
| 2 | **Project initialization** | Every workflow needs somewhere to put things | low |
| 3 | **Guided analyze workflow** | The most-used path, and the template for the other five | medium |
| 4 | **Guided adapt workflow** | Introduces `requires-user-input` and brief validation | medium |
| 5 | **Guided improve workflow** | Reuses steps 3–4; little new surface | low |
| 6 | **Output validation and artifact management** | Staleness, pruning, hashes. Best placed after artifacts exist to manage | medium |
| 7 | **Correction workflow** | Touches the IR. Deliberately after validation, so a bad correction is detectable | **high** |
| 8 | **Private local observability** | Needs the commands to exist before it can log them | medium |
| 9 | **Fidelity workflow integration** | The most gated path, and the least used. Last because it benefits from everything above | medium |
| 10 | **Documentation and packaging** | Written against what was built, not what was planned | low |

### Deferred, each needing its own plan

Public web application · SaaS · billing · collaboration · Figma · authenticated
browser contexts · broad stack adapters · automatic component correction.

---

## 20. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | **A workflow bypasses the CLI layer** for convenience, losing blocked/failed distinction, hashes and attempt history | medium | **high** | Architectural rule in §4 plus an audit invariant that no workflow file imports the pipeline directly |
| R2 | **Configuration overrides evidence** through a plausible-looking option | medium | **high** | The `kind` field; setting a `reference-fact` in config is a validation error |
| R3 | **A convenience default becomes a silent guess** — a brief field defaulted "to be helpful" | medium | high | `--non-interactive` fails rather than defaults where a default would be a guess |
| R4 | **Pleasant output erodes honesty** — a summary line that reads as a verdict | **high** | high | No composite score, no overall verdict, `null` rendered as `no evidence`; enforced by audit |
| R5 | **The correction workflow corrupts the IR** | low | **high** | Step 7 lands after validation; corrections supersede rather than edit; preview before write |
| R6 | **Telemetry becomes a content channel** one field at a time | medium | **high** | Boundary written before implementation; redaction at write; per-field justification required |
| R7 | **Stack adapter leaks into the core** | medium | medium | Audit invariant that `src/evidence/`, `src/ir/`, `src/extract/` mention no stack name |
| R8 | **Existing tests weakened to fit new UX** | medium | **high** | The floor in §16; a broken existing test is wrong until a defect record proves otherwise |
| R9 | **Scope creep toward SaaS** | medium | medium | §2 non-goals; each deferred item needs its own plan |
| R10 | **`def_0020` surfaces in a user's prompt** as a selector that matches nothing | low | medium | Every selector-emitting prompt states the risk; the marker remains unbuilt and that is disclosed |
| R11 | **Plugin install friction** — a first run that fails on a missing browser | **high** | medium | `startup-failed` is now observed and classified; `init` checks for Chromium and gives the exact install command |

R11 is the most likely to actually happen, and the cheapest to prevent.

---

## 21. Known limitations carried into Phase 5

Unchanged by Phase 5, and Phase 5 must not appear to change them:

1. No validated threshold set. 2 of 17 entries are `validated` — both finite
   policies, neither a measured numeric tolerance. `TOLERANCES.$validated` is
   `false`.
2. `TOLERANCES.colorDistance` is `blocked-on-definition`: the perceptual axis is
   undefined, so the number cannot be validated at all.
3. Five driver failure categories remain unobserved; ten were observed **once
   each, against local fixtures**, never in the field.
4. Three of those ten are reachable only at driver level — in ordinary capture,
   a hanging subresource surfaces as `navigation-timeout` first.
5. `def_0020` open; the containment marker was deliberately not built.
6. `def_0022` open; no independent real-world second witness.
7. `def_0030` permanent limitation; cross-implementation component matching
   unsupported, category-level comparison is the ceiling.
8. `def_0007` is fixed with no regression test, and `bigaap defects` says so on
   every run.
9. No composite score, by construction.
10. Scores are `null` without evidence, and a consumer must handle that.
11. History iteration numbers are not contiguous after an interruption.
12. Operation bounds are wall-clock races, not cancellation; a timed-out call
    may still be running.

---

## 22. Success criteria

Phase 5 is complete when **all** of the following hold:

1. All fourteen catalogued commands exist, are discoverable, and match
   `COMMANDS.md` — which is generated, not written.
2. `bigaap init` produces a working project; a fresh checkout reaches a design
   spec in under ten minutes with no manual file editing.
3. All six guided workflows collect inputs, validate the mode, explain blockers
   **before** executing, and report twice.
4. Every generated artifact carries its IR hash, its mode, and per-claim
   evidence status; validation fails on stale or hand-edited files.
5. No artifact is produced that its mode does not support.
6. All seven statuses are reachable and distinct, with distinct exit codes.
7. No overall quality score and no overall readiness verdict appears anywhere;
   the audit enforces it.
8. The correction workflow supports all ten steps and preserves all seven
   records; automatic correction remains global-values-only.
9. Local telemetry records every specified field and **no forbidden one**, with
   redaction at write, proven by tests using realistic inputs.
10. Installation works without Docker, from a standalone repo and as a plugin.
11. **588 unit, 12 live smoke, 50 CLI smoke and 21 audit invariants still pass**,
    plus the new Phase 5 coverage.
12. The limitations in §21 are stated in `README.md`, not only in
    `LIMITATIONS.md`.
13. No document claims production readiness, universal deploy-safe selectors,
    pixel-perfect fidelity, validated thresholds across all metrics, general
    automatic correction, authenticated capture, framework-agnostic
    implementation support, or defect-free behaviour.

---

## 23. Phase 6 recommendations

Not commitments. Recorded so Phase 5 does not accidentally foreclose them.

| Candidate | Why it might be next | Prerequisite |
| --- | --- | --- |
| **Field telemetry review** | The only route to reclassifying the five unobserved driver failures and the ten fixture-observed ones | Phase 5 §14 shipped and used |
| **The colour axis** | `colorDistance` cannot be validated until the perceptual metric is decided. It is a small, self-contained question | none |
| **Threshold validation programme** | The measured tolerances need rendering-derived evidence from targets that did not produce them | more real captures |
| **`def_0020` containment marker** | Requires an `EXTRACTOR_VERSION` bump and a full recapture — a phase's work, not a fix | a recapture budget |
| **A second stack adapter** | Proves the adapter boundary is real rather than asserted | Phase 5 §11 shipped |
| **Component matching, second attempt** | The two approaches named and never evaluated in Phase 4.9 | its own evidence plan; `def_0030` stays permanent until then |
| **Dashboards as a target class** | Currently `supported with limits` on no evidence | captures of real dashboards |

### What Phase 6 should not be

Not SaaS. Not collaboration. Not billing. Those need a product decision that the
evidence does not currently inform, and taking them before the field telemetry
exists would be building on the one thing nobody has measured.

---

## Verification of this plan

Checked before completion — this plan does **not** claim:

- production readiness
- universal deploy-safe selectors
- pixel-perfect fidelity
- validated thresholds across all metrics
- general automatic correction
- authenticated capture support
- framework-agnostic implementation support
- defect-free behaviour

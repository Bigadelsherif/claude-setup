# Phase 5 — progress

| Workstream | Status | Notes |
| --- | --- | --- |
| 5.1 Plugin command surface | **Complete** | Sixteen commands catalogued, discoverable, documented; `requires-user-input` (exit 6); `bigaap blockers` preflight |
| 5.2 Project initialization | **Complete** | `.bigaap-analyzer/` with six schemas, five config states, an explicitly invalid brief template |
| 5.3 Guided workflows | Not started | The mode commands run preflight + pipeline; the guided experience is 5.3 |
| 5.4 Output quality | Not started | |
| 5.5 Prompt quality | Not started | |
| 5.6 Readiness and safety UX | Partial | Statuses and exit codes landed in 5.1; the presentation work is 5.6 |
| 5.7 Correction workflow | Not started | Deliberately after output validation |
| 5.8 Observability | Not started | Specified in PHASE-4.9-OBSERVABILITY.md; boundary defined before collection |
| 5.9 Private-release boundary | Planned | PHASE-5-PLAN.md §18 |
| 5.10 Testing strategy | Ongoing | The existing suites are a non-decreasing floor |
| 5.11 Installation and documentation | Partial | CLI.md, COMMANDS.md, BLOCKERS.md written; install docs are 5.11 |

---

## 5.1 — plugin command surface

**Reports:** [CLI.md](CLI.md) · [COMMANDS.md](COMMANDS.md) · [BLOCKERS.md](BLOCKERS.md)

### What was built

**A command catalog** (`src/cli/catalog.mjs`) that is the single source for
dispatch, help, generated documentation and the discovery tests. A hand-written
command reference drifts from behaviour within a month; this one cannot, and a
test fails if the generated documents fall out of date.

**Sixteen commands**, each carrying documented arguments, options, statuses,
outputs, failure behaviour and examples:

`init` · `analyze` · `recreate` · `adapt` · `extend` · `improve` · `blockers` ·
`capture` · `compare` · `intrinsic` · `tasks` · `history` · `recovery` ·
`freshness` · `verify` · `readiness`

**`requires-user-input`, exit code 6.** A missing target brief is no longer
`not-attempted`. The two say different things: `not-attempted` means there was
nothing to do, and sends a user looking elsewhere for a problem that is in front
of them. It is also not `blocked` — no amount of recapturing produces a brief.

**`bigaap blockers`** — a preflight that reports what would stop a mode without
running it, and **without launching a browser**. That is a contract, asserted
two ways: the module imports nothing that can reach a browser, and every report
records `browserLaunched: false`. Availability is checked by looking for an
installed browser on disk, which is the opposite of starting one.

Fifteen blocker codes across ten check families: mode validity, input
availability, brief presence and validity, reference artifacts, evidence
coverage, contested critical claims, source-kind admissibility, viewport and
state availability, stack configuration, driver availability, stale artifacts,
unsupported capabilities and standing limitations.

Each blocker carries six fields. Two of them decide what a user does next:

- **`recaptureResolves`** — capturing again would clear it.
- **`impossibleForInputKind`** — no capture of any kind will.

That distinction is the point of the command. "Recapture and it will work" and
"nothing you capture will ever fix this" are different answers, and a user
acting on the wrong one wastes a lot of time.

### Three refusals, deliberately not collapsed

| Situation | Status | Exit | Why |
| --- | --- | --- | --- |
| Target brief missing | `requires-user-input` | 6 | A person must write it. No capture helps. |
| Target brief malformed | `failed` | 1 | The input exists and is wrong. Recapturing changes nothing. |
| Evidence insufficient | `blocked` | 3 | A gate refused. Recapturing may help. |

### The contract now refuses unactionable results

Thrown at construction, not logged:

- `blocked` with no blocker
- `failed` with no error
- **`requires-user-input` with no stated user action** — new
- **`not-attempted` with no explanation of why work did not begin** — new
- `completed` carrying a blocker or an error

### Registered but not implemented

`init` was catalogued, documented and dispatched in 5.1, reporting `not-attempted`
naming its phase. It is implemented in 5.2. Registering it early was deliberate: the surface is what 5.1
delivers, and a user who runs it should get an honest "not yet, Phase 5.2"
rather than "unknown command", which reads as "you typed it wrong".

### Two things caught while building

**The failure probe reached past the adapter.** Audit invariant 1 caught
`tools/driver-failure-probe.mjs` importing Playwright directly to construct a
bogus launcher. Fixed by having the adapter forward launch options, so a caller
never needs the vendor package to set one.

**The audit's own report tripped its overclaim check.** `docs/phase4-audit.md`
quotes whatever it finds, so a finding in it echoed after the real cause was
fixed. Excluded, as the audit's source already is from the composite-score
check. The disclaimer-aware bullet handling was preserved and not weakened.

### Test state

**612 unit · 12 live smoke · 65 CLI smoke · 21 audit invariants.**
24 new unit tests, 15 new CLI smoke checks. No existing test weakened; three
Phase 4.8 tests were updated to follow the deliberate change — a seventh status,
a `not-attempted` guard, and help that is now generated rather than inline. Each
still asserts the same claim, checked where the behaviour moved to.

### Not changed

No IR model change. No capture behaviour change. No new capability. The commands
make the existing system easier to reach; none of them makes its conclusions
sound more certain than its evidence.

### Carried into 5.2

- `init` is a surface with no behaviour behind it.
- The mode workflows run preflight and the pipeline; they do not yet collect
  inputs interactively, sequence a capture, or prune across modes. That is 5.3.
- `bigaap blockers` cannot check the reference's evidence until an IR exists;
  before the first analysis it reports that and says so, rather than guessing.

---

## 5.2 — project initialization

**Reports:** [INIT.md](INIT.md) · [CONFIGURATION.md](CONFIGURATION.md) ·
[PROJECT-STRUCTURE.md](PROJECT-STRUCTURE.md)

### What was built

`bigaap init` creates `.bigaap-analyzer/` — six configuration files, a README and
five empty directories — and **launches no browser, fetches nothing and
analyses nothing.** A project can be created, read, reviewed and committed
before a single page is fetched.

**Five configuration states, not three.** `absent` · `incomplete` · `valid` ·
`invalid` · `unsupported`. The two extra ones earn their places: a target-brief
template is neither absent nor valid, and a file written by a newer build is
not broken. Collapsing either into `invalid` would send a user to fix something
that is not wrong.

**Six schemas.** `project-config`, `preferences`, `fidelity-policy` and
`stack-adapter` are new; `tap-target-policy` and `target-brief` were reused
unchanged.

### The two decisions that mattered

**The target brief is deliberately schema-INVALID.** Every required field says
`REQUIRED — replace this text`, and three markers announce what the file is. A
template that validated would let `adapt` describe a product nobody described,
and the output would read exactly as confident as one written from a real brief.
Until it is filled in, `adapt` and `extend` report `requires-user-input`.

**Configuration cannot claim to be evidence.** Every file may carry a `$kind`,
and `reference-fact` is not one configuration may declare. A file that tries is
reported `invalid` **by name** rather than by a generic schema error, so the
reason is legible. To change a measured claim, file a correction — that path
keeps the original reading and records who disagreed with it.

### Never overwrites, never fabricates

A re-run adds what is missing and preserves what exists. An invalid file is
preserved and reported as a conflict with its reason, never repaired —
repairing it would discard whatever the user meant by it. Replacing anything
requires `--force`, which names every file it replaced.

`init` creates no analysis artifacts, and the result reports
`analysisArtifactsCreated: []` rather than omitting it, so the absence is a
stated fact rather than something a reader has to notice.

### Nothing unsupported is enabled

- `allowAutomaticComponentCorrection` may only be `false` — the **schema**
  refuses `true`, so a hand-edited file cannot enable it either.
- `thresholdProfile` has one value, `unvalidated-defaults`, named for what it
  is. A profile called `calibrated` would imply evidence that does not exist.
- An unimplemented stack adapter is recorded as `unsupported` and refused up
  front, never silently replaced with the one that exists.
- `contentMode` defaults to `independent-content`, because equivalent-content
  has six entry conditions that must be established rather than declared.

### Blockers integration

Seven new codes: `project-not-initialized`, `project-config-invalid`,
`project-files-missing`, `target-brief-incomplete`,
`schema-version-incompatible`, `configuration-stale`,
`fidelity-policy-unsupported`.

`target-brief-incomplete` is separate from `target-brief-missing` on purpose.
Telling a user to create a file that already exists sends them looking for the
wrong thing.

Still no browser: the contract is asserted statically — `init.mjs`,
`project.mjs` and `blockers.mjs` import nothing that can reach one.

### One thing caught while building

**Two similarly-named statuses answered different questions.** The project
roll-up (`configurationStatus`) covers required files; `project.json` carries
its own `configurationStatus` meaning "has a reference been chosen". A reader
would have had no way to tell which they were holding. Both are now reported
under distinct names, and `inspectProject` returns `statusCovers` stating what
its roll-up includes.

### Test state

**638 unit · 12 live smoke · 75 CLI smoke · 21 audit invariants.**
26 new unit tests, 10 new CLI smoke checks. No existing test weakened; two
Phase 5.1 tests were updated because `init` is now implemented — the catalog
gained an `implemented` field separate from `phase`, so the tests assert the
mechanism rather than pinning a particular command as unfinished.

### Not changed

No IR model change. No capture behaviour change. No guided workflows, no
correction workflow, no observability.

### Carried into 5.3

- `init` is non-interactive in every mode; `--non-interactive` is accepted and
  currently changes nothing, because there is no prompting to suppress.
- A project is created but no workflow reads its defaults yet. Wiring
  `project.json`'s defaults into the mode commands is 5.3 work.

---

## 5.3 — guided workflows

**Reports:** [WORKFLOWS.md](WORKFLOWS.md) · [INPUTS.md](INPUTS.md) ·
[MODES.md](MODES.md) · [INTERACTIVE.md](INTERACTIVE.md)

### What was built

**Five-layer input resolution with provenance** (`src/cli/resolve.mjs`).
Arguments beat workspace configuration, which beats project configuration,
which beats preferences, which beats tool defaults. The order is the easy part.
The part that carries weight is that every resolved value records which layer
supplied it, whether you typed it, and what it displaced. A run that reports
`viewports: [1440]` without saying whether that width was your decision or the
tool's guess gives a reader no way to tell one from the other.

**Six categories configuration may never resolve.** Evidence status, safety
gates, defect status, unsupported capabilities, IR facts and reference
measurements are refused by name at resolution time, each with the reason it is
refused. These are not key names chosen to avoid typos — they are the boundary
between intent, which configuration expresses, and evidence, which it must not.
A gate that can be configured off is not a gate.

**Guided collection** (`src/cli/guided.mjs`). Prompting is opt-in *and*
requires a terminal on both ends. `--interactive` in a pipeline would otherwise
deadlock it, so a run that cannot ask returns `requires-user-input` listing what
it would have asked, rather than hanging or guessing.

**A twelve-step front on every mode command**, ordered so that everything which
can refuse cheaply happens before anything that costs a browser launch. Steps 5
through 9 are the guarded band; every result they produce carries
`browserLaunched: false`, so the claim is checkable rather than asserted.

**Cancellation as its own outcome, exit 4.** Distinct from failure and from
success, carrying where it stopped, what had been done, and what was not
attempted. Nothing is written, including answers already given — a
partially-saved configuration is worse than none, because the next run inherits
half a decision without saying so.

**Mode-specific requirements, declared as data** and rendered into
[MODES.md](MODES.md) by the generator, so the documentation cannot drift from
what is enforced.

### Two decisions worth naming

**A default shown at a prompt names its origin.** `[1440 · project default]`
rather than `[1440]`. Whether a width is your project's decision or the tool's
guess changes how hard the person sitting there should look at it, and the
bracket is the only place they will see it.

**Non-blocking guided inputs.** `productName` is asked for under `adapt` but
never blocks the run, because the target brief already carries the product name.
Refusing a run over a value the required input contains would be refusing over
nothing.

### Three defects found while building, all by the CLI smoke suite

**Interactive prompts were written to stdout.** The same command may be run with
`--json`, where stdout belongs entirely to the machine-readable result. A
question written there lands inside the JSON document and no parser can read the
output. On a terminal the streams interleave and the corruption is invisible,
which is what makes it worth a rule rather than a habit. Questions now go to
stderr. Regression test: `phase53-guided` 25, which drives the real reader over
injected streams and asserts both the stream it was given and the default.

**An existing capture was classified by its filename.** Screenshot evidence
written to `extract-1280.json` was read as a URL capture, which would have let
`recreate` — a mode that refuses screenshot evidence outright — run on
screenshots. The manifest is now the authority and the filename is only the
fallback. Regression test: `phase53-guided` 24, which asserts both halves: that
`recreate` refuses it and that `analyze` still accepts it without asking for a
reference it is already holding.

**`--json` output did not round-trip.** Resolution records carried `undefined`
for absent values, and `JSON.stringify` drops undefined properties — so the
emitted contract silently differed from the object it claimed to be. Absent
values are now `null`; `present` carries the distinction that matters.

Two of these three are the kind that pass every unit test and fail in a user's
hands. They were caught because the smoke suite runs the real binary as a child
process and parses what it actually printed.

### Interactive prompting was not reachable before this phase

`--interactive` was parsed, but the binary never supplied the TTY fact or wired
a reader, so `canPrompt` was never true and no question could ever be asked.
That is now wired, and exercised: cancellation is smoke-tested through the real
binary, with the harness setting only the two `isTTY` flags so the shipped
readline path runs against piped answers. The questions, the cancel word and the
exit code are all product behaviour; only the terminal detection is stubbed, and
it is stubbed in the harness rather than in the product.

### Test state

**666 unit · 12 live smoke · 96 CLI smoke · 21 audit invariants.**
28 unit tests for 5.3 (26 required, plus 2 regressions and 1 for prompt
provenance), 21 new CLI smoke checks covering the eleven required scenarios.

No existing test was weakened. Three were updated because behaviour changed
deliberately, and each was made no weaker:

- The missing-brief guidance now names the `--brief` flag *and* the conventional
  path; the assertion checks both, where it previously checked only the path.
- `productName` moved to non-blocking under `adapt`; the test now asserts it is
  absent from the hard-stop list *and* declared non-blocking, rather than
  asserting only that it was demanded.
- The `--json` contract test began failing on the round-trip; the product was
  fixed rather than the assertion relaxed.

### Not changed

No IR model change. No capture behaviour change. No correction workflow, no
observability, no dashboard, no authenticated capture, no automatic
component-level correction. No threshold was calibrated or marked validated.

### Carried into 5.4

- Workspace-level configuration is a resolution layer with no writer: nothing
  creates a workspace config file yet, so that layer is currently always empty.
- `stack` resolves against a single implemented adapter (`next-tailwind`).
  Anything else is refused rather than substituted, which is correct but means
  the layer is not yet exercised across adapters.

---

## 5.4 — output quality and artifact management

**Reports:** [ARTIFACTS.md](ARTIFACTS.md) · [OUTPUTS.md](OUTPUTS.md) ·
[FRESHNESS.md](FRESHNESS.md) · [EXPORTS.md](EXPORTS.md)

### What was built

**A central artifact registry** (`src/artifacts/registry.mjs`) — 23 definitions, each
stating what an artifact is, which modes may produce it, what has to be true for it
to exist, what happens to it when the run is refused or its source moves, and which
projection owns it. Before this, "may `analyze` emit a rebuild prompt?" had four
places to look — the projection index, the mode requirements table, the validation
gates and the workspace writer — and no single answer.

**The registry is honest about what does not exist.** `correction-tasks` and
`correction-log` belong to the Phase 5.7 correction workflow. They are registered
with `owningProjection: null` and `definitionStatus: "declared"`, so asking for one
returns "registered but has no producer yet (Phase 5.7)" rather than nothing at all.
A gap that reports itself is very different from one you find by discovering an empty
directory. A test asserts the mirror: everything claiming to be implemented names a
module that exists on disk.

**Metadata inside every artifact.** Nineteen fields, in an HTML comment block for
Markdown and under a reserved `$bigaap` key for JSON. The reason it travels *inside*
the file: a prompt in a downloads folder has no directory left to explain it, and no
way to say it was generated from screenshots of a different page three weeks ago. The
existing `bigaap:ir-hash` stamp is kept alongside it — V6 depends on it, and removing a
working integrity check to tidy a header would be a poor trade.

**Seventeen validation checks**, in four groups: identity, integrity, freshness, and
honesty. The honesty group is the one that matters — an estimate rendered as a
measurement, a contested value rendered as settled, a proposal rendered as an
observation, a target-brief requirement rendered as a finding about the reference.
Each of those produces a file that is well-formed, schema-valid, fresh, and wrong in
the only way that counts.

**Freshness across three hashes and two versions**, tracked separately because they
answer different questions. A moved IR means what we *concluded* changed; a moved
evidence hash means what we *observed* changed, which is more serious; a moved
configuration hash means the page did not move and the question did. A version
difference is `incompatible` rather than `stale`, because re-deriving cannot reconcile
it.

**Lifecycle with an asymmetric rule:** current output may be pruned; history never.
Pruning is sometimes mandatory — a rebuild prompt left standing after a refused re-run
reads exactly as authoritative as it did yesterday, sitting beside the report
explaining why the analysis was refused. But a removal with no trace is
indistinguishable from a file that never existed, so every prune writes a record with
the file's hash, why it went, and where the content is preserved.

**Export, with two refusals that have no override:** stale implementation prompts and
blocked ones. A stale *report* still exports, because it remains a true account of the
run that made it — which a stale instruction does not.

**Four projections that did not exist:** `evidence-report.md`, `implementation-notes.md`,
`fidelity-report.md`, `readiness-report.md`. Writing them was the alternative to
registering four more artifacts as unavailable, and each is derivable from data the
pipeline already had.

**A standard header on every human-readable artifact** (`src/project/header.mjs`) —
what was analyzed, requested mode, source kind, evidence status, coverage and
confidence side by side, limitations, timestamp, and the next recommended action. The
order is the argument: a reader learns what was looked at and how well before reading
a single conclusion. Putting confidence at the bottom means the conclusions get read
first and the caveats get read never. There is no overall quality verdict, and
coverage and confidence are never merged into one number.

### The integration check that found the rest

Unit tests confirmed the registry was internally consistent and the validator caught
what it was given. Neither could see the gap between them, so the last check runs the
real pipeline across all five modes and validates every file it projects with the real
validator. It failed immediately: the registry required sections like "What was
reached" that no projection emitted, because I had written the required-section lists
from what the artifacts *should* say rather than from what they *did*.

The fix was the shared header rather than relaxing the registry — the brief requires
those eight facts on every human-readable artifact, and eleven projections were each
writing their own partial version of them. That check is now test 35, and it is the
one most likely to catch the next mistake of this shape.

### Three real defects found while building

**The registry and the mode requirements table disagreed.** `extend` required
`output/rebuild-prompt.md`, and the registry said only `recreate` produced it — so
every `extend` run would have failed validation with a `wrong-mode` error on its own
required artifact. Worse, my first test papered over it with an assertion weak enough
to pass either way (`implementation prompts belong to exactly one mode`, checked as
`length <= 1`). Replaced with a cross-check that reads both tables and asserts they
agree, which fails whichever one is edited next.

**Four artifacts the pipeline writes were not registered at all** —
`extraction-warnings`, `mode-evaluation`, `fidelity-checklist`,
`screenshot-evidence-report`, plus `disagreement-report`. The pruner's hardcoded list
happened to include them; the registry did not. Both lists are now derived from the
registry, because two hardcoded lists is how an artifact gets added to one and
forgotten in the other — and the one it gets forgotten in is the pruner, which is
where a stale build prompt survives a refused run.

**Requiredness was a single boolean and it is per-mode.** `extracted-tokens.json` is
mandatory for `recreate` and `adapt`, which both stake instructions on exact values,
and merely useful for `analyze`. One flag had to pick one of those and be wrong about
the others; the generated matrix in OUTPUTS.md showed it as optional everywhere.

### One thing the existing tests caught

Attaching metadata made projection non-deterministic, because `generatedAt` came from
the clock. An existing test asserted byte-identical projection from the same IR and
failed immediately. The fix was to take the timestamp from the run rather than relax
the test: projection is a pure function of the IR, and a timestamp inside it would
have changed an artifact's hash on every re-derivation from an unchanged source,
making every freshness check report drift that was not there.

### Deterministic serialization

Keys sorted, arrays left alone. Arrays carry meaning — evidence order is priority, and
candidate order is what the disagreement machinery recorded — so sorting them would
destroy information to make a diff prettier. `undefined` throws rather than being
dropped, because `JSON.stringify` deletes those keys silently, and a key that vanishes
without a report is the failure the module exists to prevent. `null` survives, because
a `null` score means "no evidence" and dropping it turns "we did not look" into "this
question does not exist".

### Test state

**714 unit · 12 live smoke · 96 CLI smoke · 21 audit invariants · 8 generated-doc
currency checks.** 48 new unit tests for 5.4.

No existing test was weakened. One (`projection is deterministic`) failed against new
behaviour and the product was fixed rather than the assertion relaxed. Two of my own
new tests were corrected: one asserted a count of missing sections where it should
have asserted which ones, and one used a fixture that predated the standard header.
Both were made stronger rather than adjusted to pass — the first now asserts the exact
set, which stays honest as the header grows.

### Not changed

No correction workflow. No observability, no dashboard, no SaaS, no authenticated
capture, no Figma, no broad stack adapters, no automatic component-level correction.
No evidence, safety or readiness gate was altered — the artifact validator sits beside
those gates and never overrides one.

### Carried into 5.5

- The registry knows about `correction-tasks` and `correction-log` but nothing writes
  them. That is Phase 5.7, and the definitions exist so the rules are in place first.
- `implementation-notes.md` has stack guidance for `next-tailwind` only. Any other
  stack produces the file with the guidance section stating it has no adapter, rather
  than inventing guidance.
- Export is implemented as a decision layer. No CLI command surfaces it yet.

---

## 5.5 — prompt quality

**Reports:** [PROMPTS.md](PROMPTS.md) · [PROMPT-CONTRACT.md](PROMPT-CONTRACT.md) ·
[PROMPT-LINT.md](PROMPT-LINT.md) · [STACK-ADAPTERS.md](STACK-ADAPTERS.md)

### What was built

**A prompt contract** (`src/prompts/contract.mjs`) for all four prompt types. The
rebuild prompt declares sixteen required sections in a fixed order; adaptation twelve,
improvement eleven, implementation notes four. Order is checked, not just presence: a
prompt stating its acceptance criteria before its evidence limitations front-loads
what to do and buries what not to trust.

**One renderer** (`src/prompts/render.mjs`). If there were two places a measurement
could become an instruction, one of them would eventually render an estimate as a fact
and nothing would notice, because both outputs look the same. Seven statuses, each
with a rendering that cannot be mistaken for a stronger one.

The backtick carries the weight. An agent reading a prompt treats a backticked token
as a literal to copy, so only `measured` and `observed` — the two statuses that were
*read* rather than reasoned to — may produce one. An estimate renders as
`~24px *(estimated …)*` and is deliberately not copyable.

**Twenty-one lint rules** (`src/prompts/lint.mjs`), each with an id, severity,
location, evidence context, remediation, and whether it blocks. The blocking set is
deliberately small: a contested critical value rendered as settled, an estimate
rendered as a measurement, a brief requirement rendered as reference evidence, a
proposal rendered as an observation, a generated selector offered as a hook, copied
brand identity, foreign stack syntax, a stale or wrong-mode prompt. Every one produces
a prompt that reads correctly and instructs someone to do the wrong thing. Missing
sections and unsupported adjectives warn instead — they are bad, and they are visible
to whoever reads the prompt. These are not.

**A gate that actually gates.** The linter runs inside `projectAll`, and a prompt with
a blocking finding is withdrawn and replaced by an explanation naming every finding. A
linter whose findings are advisory is one nobody acts on.

**One stack adapter**, Next.js / React / TypeScript / Tailwind, with its output
contract declared as data. Every other stack is refused rather than approximated: the
notes state the absence, give only guidance that holds regardless of framework, and
say explicitly that none of it is adapter output. Foreign framework syntax is a
blocking finding, and code fences are searched too — syntax inside a fence is more
dangerous than syntax in prose, because it looks like something to copy.

### The prompts were rewritten to fit

Sixteen sections meant the rebuild prompt gained five it did not have: reference
evidence, page structure, component states, responsive behavior, technical
implementation, and forbidden assumptions — and "Non-goals" became the more accurate
"Assets and brand boundaries". Typography and layout were also swapped into contract
order.

**Evidence limitations became unconditional.** It used to be emitted only when there
were unknowns. A section that disappears when there is nothing to report teaches a
reader that its absence means nothing — and then its absence on a run that *did* have
gaps reads the same way. It now always appears; what changes is what it says.

### Five defects found while building

**`classifySelector` silently classified every generated selector as `unknown`.** Its
`classify` callback defaults to `() => "unknown"`, and the real heuristic lives inside
the browser-injected extractor. So the deploy-safety check returned "unknown" for
exactly the selectors it exists to catch. Fixed by making the extractor's own
classifier importable (`src/deploy/class-kind.mjs`) rather than duplicating a
heuristic whose comments record a version that misclassified 140 of 151 names on one
real site.

**V7 and the prompt contract disagreed.** V7 still demanded a "Non-goals" section
after the contract had split it in two, so a correctly-generated prompt failed
validation against a section nothing produced any more. V7 now reads the contract.

**The artifact registry and the prompt contract disagreed the same way.** Same fix:
the registry's `requiredSections` for prompts now come from the contract.

**`separatedSections` used shorthand names.** The registry listed "Observations,
Critique, Proposals, Unknowns" while the actual headings are "Observed reference
behavior, UX critique, Proposed improvements, Unknowns" — so the proposal-separation
check was matching against strings that never appear. Both now use the real titles.

**A remedy filter dropped the section it should have pointed at.** The
proposal-separation remedy filtered on `/proposal|critique/i`, and "Proposed
improvements" does not contain "proposal" — so the message named only "UX critique"
and omitted the section the reader actually needed.

### One defect in my own Phase 5.4 work

`analyzeWorkspace(ws, { mode })` sets the **capture** mode; the **analysis** mode goes
in `config.request.mode`. Phase 5.4's test 35 passed the analysis mode to the wrong
one, so it validated `analyze` output five times rather than five modes. Fixed, and
the collision is now documented where it bites. Corrected, the test immediately found
a real gap: `output/partial-design-spec.md` did not resolve in the registry, so a
blocked run produced a file the validator called unregistered and the pruner would not
withdraw.

### Test state

**740 unit · 12 live smoke · 96 CLI smoke · 21 audit invariants · 11 generated-doc
currency checks.** 26 new unit tests for 5.5.

No existing test was weakened. Nine were updated because the section structure changed
deliberately, and each was made **stronger**: every one that pinned a section by number
(`## 9. Acceptance criteria`) now matches by name, which is what those tests were
actually trying to assert and what stops them breaking on the next insertion. One test
sliced between two hardcoded section numbers and broke *silently* when renumbering
inverted the range — an empty slice then failed every assertion for the wrong reason;
it now finds the next heading.

### Not changed

No correction workflow. No observability, dashboard, SaaS, authenticated capture,
Figma, broad stack adapters, or automatic component-level correction. The IR and
evidence models are untouched — no prompt-quality defect required changing them.

### Carried into 5.6

- Prompt lint results are on the projection (`projection.lint`) but no CLI command
  surfaces a lint report yet.
- `PL03` (claims without evidence references) is a warning. The generated prompts now
  emit none, but the rule is not blocking, because a legacy or hand-edited prompt
  failing it is a quality problem rather than a dangerous one.
- The `improve` prompt's proposals are marked structurally but its rationale text is
  still hand-written per proposal rather than rendered through `renderProposal`.

---

## def_0037 — live-smoke concurrency integrity

**Fixed before Phase 5.6.** Regression tests: [tests/run-lock.test.mjs](../tests/run-lock.test.mjs).

### What was actually wrong

Not that two runs overlapped — that was my mistake. The defect was that the tool
converted the collision into a **plausible scenario report**: `9/12 passed`, exit 0,
three named scenarios failing, and the named set stable because those scenarios write
artifacts last. It read as three regressions in driver error recording.

A regression gets investigated. A harness collision gets re-run. Presenting one as the
other costs the reader the wrong hours.

### The lock

`src/util/run-lock.mjs`, taken **before the fixture server is probed and before any
scratch artifact exists**, so a refused run has touched nothing at all. Created with the
`wx` flag — the existence check and the create are one syscall, so two processes racing
cannot both succeed.

A refusal is **environment-not-ready, exit 2**, the same category the suites already use
for "the fixture server is not answering". Never exit 1: that means "the suite ran and
scenarios failed", which is precisely the false claim being prevented.

Released on success, failure, `SIGINT` (exit 130), `SIGTERM` (exit 143), process exit,
and uncaught exception. `release()` removes only a lock this process still owns — a run
whose lock was reclaimed while it was stalled must not delete the reclaimer's lock on its
way out, which would be the original defect with extra steps.

### Stale locks

The one genuinely delicate decision, resolved by asking which direction is safe to be
wrong in:

- **Owner's pid alive** → refuse. It may be a pid the OS reused for an unrelated process,
  in which case the refusal is unnecessary. That costs a re-run. A wrong reclaim costs a
  corrupted result that looks real.
- **Owner's pid gone** → reclaim, and announce it. A dead process cannot be writing
  artifacts. Pid reuse cannot mislead here: it can only make a dead owner look alive,
  which lands in the safe case above.
- **Unreadable lock** → never reclaimed. An unparseable lock is not evidence that its
  owner stopped, only that we cannot tell.

Nothing deletes a lock whose owner might still be running, under any flag. `EPERM` from
`kill(pid, 0)` counts as alive — the process exists and belongs to someone else.

### Report preservation

The report is written from exactly one place, guarded by a completeness check, and only
after the run records its full complement of checks. A short count means the suite did
not finish rather than that it found failures, and the two are reported differently: a
short run writes no report and exits 2.

This guard catches an **interrupted** run. It would not have caught the original
corruption, which completed all twelve checks with three artifact-less failures — the
lock is what catches that. Both are needed; neither substitutes for the other.

### One further finding, from proving it end to end

A lock carrying a UTF-8 BOM parsed as unreadable. It refused correctly, but for the wrong
reason, and told the reader to inspect a file that was fine. The BOM is now stripped.
Found only because the refusal was exercised against the real tool rather than the module
alone.

### Verification

| | |
| --- | --- |
| Unit | **755/755** (15 new) |
| Live smoke | **12/12**, single isolated run, lock released, report clean |
| CLI smoke | **96/96** |
| Audit invariants | **21/21** |
| Generated-doc currency | **11/11** |

End-to-end refusal proven against the real binary: with a lock held by a live process,
`node tools/live-smoke.mjs` exited 2, named the holder, ran no scenario, and left
`docs/live-smoke-report.md` byte-identical (md5 `5acefdc9…` before and after).

`def_0020` and `def_0022` remain open and untouched.

---

## 5.6 — readiness UX

**Reports:** [READINESS.md](READINESS.md) · [STATUS-CODES.md](STATUS-CODES.md) ·
[VERIFY.md](VERIFY.md) · [RECOVERY.md](RECOVERY.md) · [TASKS.md](TASKS.md) ·
[BLOCKERS.md](BLOCKERS.md)

### What was built

**A readiness presentation model** (`src/cli/readiness-model.mjs`) carrying every field
the phase names — requirements, coverage, confidence, contested claims, unknowns,
limitations, stale artifacts, lint findings, artifact state, open defects, recovery
history, recommended actions, and the explicit `browserLaunched: false` /
`captureAttempted: false` that make those claims checkable rather than asserted.

The `--json` output **is** the model. The human renderer reads the same object, so the
two cannot drift and anything visible in the prose is addressable in the JSON.

**A decision-first renderer** (`src/cli/present.mjs`). Line one is the decision, line
two is the next action:

```
Recreate is blocked: no hover, focus or disabled state was induced in this capture.
→ Recapture with wider coverage, or use a mode this evidence supports.
```

Not a header, not a count of checks. Every line above the answer is a line read while
still not knowing it. And a positive summary never appears above a blocker — "Ready —
3 blockers" is worse than no summary, because the eye takes the first word and the rest
becomes detail.

**One workspace context** (`src/cli/context.mjs`) that all seven commands read, so the
same fact cannot be phrased three ways. It launches nothing and writes nothing.

**Five distinctions the output refuses to merge**, each because merging them changes
what the reader does:

- a blocker is not a warning
- an unknown is not a failure — it is a decision the evidence does not make for you
- a contested claim is not an unknown — values exist and they conflict
- a limitation intrinsic to the input kind is not a coverage gap you can recapture your
  way out of
- coverage is not confidence, and neither is a score

**No composite score**, and `compositeScore: null` is present in the model so a reader
can see the absence is deliberate. Nothing is averaged across viewports or states: a
layout that holds at 1440 and breaks at 375 is not half correct.

### Four defects found while building

**Every artifact reported as stale in a perfectly fresh workspace.** The context hashed
the IR with `contentHash` when the artifacts were stamped by `hashIR` — two different
functions over the same object. A staleness report that is always wrong is worse than
none, because it trains the reader to ignore the real ones.

**`bigaap readiness` presented a blocked run as completed.** The model was given the
*reporting command's* status rather than the run's. `bigaap readiness` completing
successfully says nothing about whether the run it describes was refused — and
presenting a refused run as completed is the exact failure the phase forbids. The
context now derives the run's status from the safety gate and the mode evaluation, and
carries the gaps that refused it.

**Five commands never reached the model.** `verify`, `freshness`, `tasks`, `recovery`
and `history` bail out when there is no fidelity *session*, which is a different thing
from having no workspace. Answering "no session" while holding a fully analysed
workspace is a refusal to look at what the user pointed at. The absence result now
carries the model too.

**Open defects appeared on every run regardless.** The relevance test defaulted to
*show*, so a cross-build matching defect appeared on a single `analyze` capture where it
means nothing. A report that lists every open defect teaches the reader to skip the
section, which costs them the one that mattered. The default is now *hide*, and the
test is on what the run is doing.

### One assumption I got wrong

The model was written against an IR shape I assumed rather than checked:
`component.states` is an object keyed by state name, not an array; `verification` has
no `regions` list; the confidence categories differ from the ones the phase brief
names. The first of those threw on the first real run. Coverage now reads the real
shape, and confidence reports the **union** of the expected categories and the measured
ones — a fixed list would drop a category the analysis produced, and the IR's keys alone
would hide that an expected category was never measured.

### Test state

**782 unit · 12 live smoke · 96 CLI smoke · 21 audit invariants · 13 generated-doc
currency checks.** 27 new unit tests for 5.6, most of them asserting that two things
stay apart rather than that one thing is present.

No existing test was weakened. One of my own new tests asserted the wrong thing —
that `analyze` reports the correction artifacts as `no-producer`, when it correctly
reports them as `not-applicable` first. "This mode does not produce it" beats "nothing
writes it yet" when both are true, and the test now checks both answers in the mode
each belongs to.

### Not changed

No correction workflow, and `bigaap tasks` says explicitly that this phase implements no
way to apply one. No observability, dashboard, SaaS, authenticated capture, Figma, broad
stack adapters, or automatic component-level correction. No gate was weakened: the
presentation layer reads the gates' verdicts and never computes one.

### Carried into 5.7

- `bigaap blockers` carries its own preflight report but not the readiness model; the
  two overlap and have not been reconciled.
- Recovery attempts are read from capture contracts on disk. A run that never wrote one
  has no attempt history to show, and the output says so rather than inferring.

---

## 5.7 — correction workflow

**Reports:** [CORRECTIONS.md](CORRECTIONS.md) · [CORRECTION-SCOPES.md](CORRECTION-SCOPES.md) ·
[CORRECTION-REVIEW.md](CORRECTION-REVIEW.md) · [PROMOTION.md](PROMOTION.md)

### What was built

**A correction record carrying both sides of everything** (`src/correct/record.mjs`) —
original and corrected value, original and corrected status, the evidence behind each,
the IR hash before and after. A record carrying only the new value would be
indistinguishable from a measurement, and the whole point of a correction is that it is
not one. Eleven categories, five scopes, five review statuses, five promotion statuses.

**An append-only store by construction rather than by policy** (`src/correct/store.mjs`).
Accepting `corr_0001` writes `corr_0001.01.accepted.json` beside the proposal; a
correction's state is the newest event bearing its id. The history is not a log kept
beside the truth — it *is* the truth, and losing it would require deleting files rather
than forgetting to write one. `appendEvent` throws rather than overwrite.

**Twelve evidence protections and eight automatic-application limits**
(`src/correct/guard.mjs`), split because they refuse for different reasons. The first
group is refused however it is applied: deleting evidence, rewriting capture, raising a
status above its source kind's ceiling, laundering an estimate into a measurement,
resolving a contested claim silently, overriding a gate, changing a defect status,
writing to the reference or your project, editing an artifact as the source of truth.
The second group refuses only *unattended* application — the correction may be right;
what is unavailable is doing it without review. Every one of those traces to `def_0030`.

**A preview that provably mutates nothing** (`src/correct/preview.mjs`), showing the
claim, status and confidence changes, affected IR paths and projections, artifacts that
will change or be withdrawn, mode impact, readiness before and after, lint impact,
promotion position, and the risks.

**A seventeen-step apply pipeline** (`src/correct/pipeline.mjs`) where everything that
can refuse runs before anything is published. New artifacts are held in memory, checked
as a set, and published together or not at all — because a run that wrote artifacts as
it produced them would leave a workspace holding a *mixture* of two derivations with no
way to tell which file came from which.

**`stopOnNewUncertainty`, applied to corrections.** A correction that makes something
unmeasurable is stopped, not applied. A run can look better by measuring less, and that
is not an improvement. The escape hatch has to be typed.

**A promotion gate with seven holds** (`src/correct/promotion.mjs`). Two independent
*references* — never two records, because the same correction filed twice against one
page is one person being sure. An explicit act clears the witness requirement and
nothing else: a person may assert that a pattern generalises, and may not assert that
the evidence was stronger than it was.

### Five defects found while building

**`applyCorrections` superseded nothing.** It looked up the claim in `evidence.claims`,
an index the pipeline's evidence map does not carry. So a correction pushed its new
record, superseded none of the originals, and then *lost to the original at derivation
time* — the correction appeared to be applied and the value did not change. It now also
matches on `record.claim`, which is what the records actually carry.

**The apply pipeline published only projections.** `analysis/ir.json` and
`analysis/evidence-map.json` were left at their previous contents, so the workspace
showed corrected prose over an uncorrected IR — and the next command to open it would
have quietly undone the correction. Both now publish, and first.

**A corrected run put `undefined` into `ir.sourceKinds`.** The correction's evidence
record carried no `sourceKind`, and the field is derived as the distinct set across
records. It read downstream as a third unnamed source.

**`collectClaims` had no cycle or depth guard**, and a corrected IR was enough to blow
the stack — the validator died on the input it was asked to check. It now tracks
ancestors on the current path rather than every node visited, because an IR legitimately
shares objects between claims and treating a shared reference as a cycle would silently
drop real claims.

**Correction ids came from a module-global counter.** Two workspaces open in one process
interleaved their ids, so a fresh workspace's first correction could be `corr_0007`. Ids
now derive only from the workspace's own records, which also makes them reproducible.

### One decision worth naming

The pre-Phase-5.7 correction vocabulary (`measurement`, `global`, `pending`) is still
accepted by the schema alongside the current names. A schema that rejected records this
system itself wrote would be wrong about its own history. New records use the current
vocabulary; the rename of `global` to `global-candidate` was deliberate, because the old
name read as though promotion had already happened.

### Test state

**818 unit · 12 live smoke · 96 CLI smoke · 21 audit invariants · 13 generated-doc
currency checks.** 36 new unit tests for 5.7.

No existing test was weakened. One was updated: the Phase 5.1 approved-surface list
gained `correct` and `correction`. The list stays explicit rather than derived, because
adding a command should be a deliberate act somebody had to write down — which is the
whole reason that assertion exists.

### Not changed

No observability, dashboard, SaaS, authenticated capture, Figma, or broad stack
adapters. Automatic component-level correction remains refused, and `bigaap tasks` still
states that nothing can be applied automatically. The IR and evidence models are
unchanged — the correction workflow needed the layers that already existed.

### Carried into 5.8

- The guided interactive correction flow is not a prompt loop; the fields are few and
  the flags are the documented interface. `--interactive` is accepted and currently
  changes nothing.
- Promotion writes a rule object but nothing yet *reads* promoted rules back into a
  derivation. The gate and the record exist; consuming them is later work.
- `bigaap correction demote` is implemented in the store but has no CLI verb.

---

## 5.8 — local observability and privacy

**Reports:** [OBSERVABILITY.md](OBSERVABILITY.md) · [PRIVACY.md](PRIVACY.md) ·
[TELEMETRY.md](TELEMETRY.md) · [DATA-RETENTION.md](DATA-RETENTION.md)

### What was built

**A central redaction layer** (`src/observe/redact.mjs`) that no command bypasses,
because no command can write an event except through the store, and the store redacts
on the way to disk. A rule applied in eleven places is wrong in at least one of them,
and the one where it is wrong is the one that leaks.

Redaction **omits** rather than masks. A masked field still tells a reader something
existed there, and the only reliable way not to leak a value is not to hold it.

**A sixteen-entry never-record list**, held as data and read by three things: the
redactor, the tests, and the generated privacy documentation. A promise made in prose
and enforced in code drifts apart; this is the same list doing both jobs.

**A versioned event model** with fifteen classes. What an event carries was chosen by
subtraction — start from what would make a failure diagnosable, remove everything that
describes the page rather than the analysis, keep the shapes. Codes but never messages,
because a blocker's code is the diagnosable part and its message may quote a heading.
Confidence as counts and a range, because per-category numbers are a fingerprint of a
specific page.

**An append-only JSONL store** outside the analysis workspace, with rotation by rename,
age and size retention that reports every removal, and line-isolated corruption
recovery. A diagnostic store that becomes unreadable at the first bad byte fails exactly
when something has gone wrong, which is the only time anybody reads it.

**Off by default, with no upload path.** `remoteUpload` is reported as `false` rather
than being configurable, so the absence is visible rather than something to take on
trust. Six settings that would widen collection do not exist and are named explicitly,
so a reader looking for them finds a decision rather than an omission.

**`bigaap telemetry`**, named for the word people search for when they want to know what
a tool collects. Export has two gates — permitted in configuration, confirmed at the
call — because willingness to keep local diagnostics and willingness to hand them over
are different decisions.

### Two decisions worth naming

**Query parameters are dropped even at `minimal` redaction.** A query parameter is the
commonest place for a session id, a search term or a customer identifier to appear.
"Minimal redaction" means the operator accepts recording which pages were analysed; it
has never meant recording the parameters they were analysed with.

**Clearing deletes the salt.** Without it, hashes in any previously-exported diagnostic
become permanently ungroupable rather than merely deleted from this machine. That is
what makes clearing meaningful rather than local housekeeping.

### One defect found while building

**The default configuration failed its own validation.** `remoteEndpoint: null` is
carried deliberately so `telemetry status` can report the absence of an upload path as a
stated fact — but the validator refused the key by *name*, so enabling observability
returned `failed` on a config the tool itself had just written. It is now refused by
*value*: present and null is a statement, present and set is an attempt.

### Test state

**847 unit · 12 live smoke · 96 CLI smoke · 21 audit invariants · 13 generated-doc
currency checks.** 29 new unit tests for 5.8.

Most assert an absence, which is the awkward shape privacy testing always takes — an
absence can be produced by a bug as easily as by a guarantee. So they work in both
directions: the test that a screenshot is not recorded also asserts the surrounding
event *was*, otherwise it would pass against a store that writes nothing at all.

No existing test was weakened. One was updated: the approved-surface list gained
`telemetry`.

### Not changed

No remote telemetry, no dashboard, no SaaS. Promoted rules still do not affect
derivation — the observability implementation did not need them to, so they were left
alone. No authenticated capture, Figma, or broad stack adapters. Automatic
component-level correction remains refused.

### Carried into 5.9

- The recording helpers exist and are tested, but only `bigaap telemetry` calls them.
  Wiring `commandFinished` into the mode workflows is a one-line change per command and
  was deliberately not made in the same phase as the privacy boundary — a leak added
  alongside the mechanism that prevents leaks is the hardest kind to notice.
- `maxFiles` is configured but not enforced; rotation is bounded by size and age only.
- Verbose error recording is a setting with no consumer yet.

---

## 5.8 integration — observability wired into the real workflows

5.8 built the mechanism and deliberately left it unused. This connects it.

### Where the instrumentation went

Not at call sites — at **choke points**. Every fidelity command already ran through one
wrapper in `bin/bigaap.mjs`, so instrumenting the wrapper instruments all of them, and a
command added next year is observable without its author doing anything. The alternative,
a `commandFinished` call inside each command, is 23 opportunities to record a field
nobody vetted.

Four places carry it:

- **`runFidelity`** in `bin/bigaap.mjs` — start and end for every fidelity command,
  including the `catch` path, so a thrown command emits a failure rather than nothing.
- **`cmdReadiness`** in `src/cli/commands.mjs` — the readiness evaluation.
- **`reportRecoveryAttempts`** — one event per recovery attempt.
- **`src/cli/correct.mjs`** — proposal, guard refusal, apply-blocked, apply-accepted,
  rejection.

### Three leaks, all of them mine

Every one was introduced by this instrumentation, and none could have been caught by the
5.8 unit tests — they needed a real command with real arguments.

**Absolute paths in `projectId` and `workspaceId`.** Both are paths in this codebase. The
redactor rewrote fields whose names ended in `path`, `dir`, `root`, `file` or `workspace`;
neither name does. A path carrying the user's home directory reached an event. Fixed in
the redactor, not the callers.

**`--observability-root` was ignored.** The root resolver read `--project` and `cwd` but
not the flag it documented, so eight CLI tests wrote to the wrong place. A flag that is
accepted and discarded is worse than an unrecognised one.

**`mode` echoed argv.** `--for nonsense` was recorded verbatim. Nobody types `nonsense` —
but `--for customer-list-page` is a plausible mistake, and a field that echoes argv is a
channel for arbitrary text. `mode` is now clamped to the five known modes; anything else
records as `invalid`.

The pattern in all three: the privacy boundary held at the layer it was designed for, and
the leaks entered through the layer above it. The fix in each case was central, so no
future call site can reintroduce it.

### The two dangling settings

The phase required these be enforced or explicitly marked non-operative. Both are now
enforced.

- **`maxFiles`** is applied in `applyRetention`, oldest-first, each removal reporting
  `more than N rotated file(s) were kept`.
- **`verboseErrors`** adds exactly two fields: the exception's class name and its stack
  **depth**. Never the message, never a frame — a frame carries an absolute path.

### Test state

**865 unit · 12 live smoke · 96 CLI smoke · 21 audit invariants · 13 generated-doc
currency checks.** 18 new integration tests.

The currency figure was recorded as 15 in the 5.7 and 5.8 sections. It has been 13 since
5.6 — `tools/generate-command-docs.mjs` has thirteen targets and gained none in either
phase. Both lines are corrected above. A test count that drifts upward without anyone
adding a test is the kind of number that quietly stops meaning anything.

They test the wiring rather than the mechanism: that a blocked run emits `command-blocked`
and not `command-completed`, that a failed run's event carries codes and no message, that
a workspace path never appears in the store, that recording stays silent when disabled,
that a store write that fails does not fail the command.

No existing test was weakened.

### Not changed

No remote telemetry, no dashboard, no SaaS, no upload path. Promoted rules still do not
affect derivation. The IR and evidence model are untouched. No authenticated capture,
Figma, or broad stack adapters. Automatic component-level correction remains refused.

### Carried into 5.9

- Capture-level timing (`browser-operation-failed` with per-operation durations) is
  emitted by the recovery path but not yet by the capture path itself; the capture code
  does not currently thread an observability root.

---

## 5.9 — installation, upgrade, and packaging

Making the plugin installable, upgradeable, removable and understandable for
controlled private use. No Docker anywhere.

### The shape of it

Four modules under `src/install/` and one CLI surface:

- **`versions.mjs`** — every version this build declares, in one place. It
  declares none of its own: each field re-exports the constant its module
  already owns, so a version cannot be bumped twice and disagree with itself.
- **`manifest.mjs`** — the managed package boundary. An allowlist of
  directories AND a denylist checked after it, because either alone fails open.
- **`doctor.mjs`** — nine environment checks, none of which launches a browser.
- **`migrate.mjs`** — eight versioned migrations plus a record of the ones that
  deliberately do not exist.
- **`install.mjs`** — plan-then-perform for install, upgrade, repair, uninstall.

### Plan, then perform

Every operation is planned before it is performed, and the dry run is the
default. The split is what makes `--apply` truthful: the dry run and the real
run execute the same planner and differ only in whether the last step happens. A
dry run computed by a separate code path describes a program that does not exist.

### The rule everything follows from

**Never overwrite a file the user might have written.** Not warn-and-overwrite,
not overwrite-and-keep-a-copy — refuse, name the file, exit 3.

Conflict detection is by hash against the manifest. A managed file whose hash
matches is ours and may be replaced. One whose hash differs was changed by
somebody, and this build cannot tell an intentional edit from a corruption, so
it says exactly that and stops.

A target brief is `preserve`: placed once, never touched again. Replacing a
filled-in brief with an empty one is the single most damaging thing an upgrade
of this tool could do.

### Uninstall preserves by default

Six separately-selectable categories; only plugin code is removed by default.
Every irreversible category must be confirmed **by name** — a blanket
`--confirm` is refused, because saying yes to removing code is not consent to
losing a correction history. A partial confirmation refuses in full rather than
performing the confirmed part.

Unmanaged files are reported and left in place. Deleting a file this build did
not put there is how a tool takes something that was never its to take.

### Migrations add or rename; they never reinterpret

Renaming is safe because the value survives. Reinterpreting is not — migrating
an old `status: "ok"` to `completed` would silently upgrade a claim nobody made.

`error`, `fail` and `incomplete` are refused by name: each was used for two
current statuses that need opposite actions, and choosing one would fabricate
the distinction the result contract exists to preserve. Evidence, correction
content and provenance status are never migrated at all, and the reasons are
recorded in `DELIBERATELY_ABSENT` — an absent migration looks identical to a
forgotten one.

### Three defects found while building

**def_0038 — a test that could not fail.** Scanning the managed sources for raw
control bytes (which this phase hashes and packages) found three. Two were
cosmetic. The third was a literal `0x08` where `\b` belonged in
`tests/phase51-surface.test.mjs`, making the regex `/<BS>import\s*\(/` — a
pattern that cannot match any real file. The assertion had been passing
vacuously since it was written, and the property it guarded (that the
no-browser preflight module cannot reach a browser through a dynamic import)
was unprotected the whole time. The property was true; the test was not testing
it. `bigaap repair` now reports control bytes.

**def_0039 — a version that was never released.** `BIGAAP_VERSION` read
`paths.root("package.json")` where `paths` had no `root` member. The call threw
on every evaluation, the catch swallowed it, and every project ever created
recorded `bigaapVersion: "0.0.0"`. The substance is not the typo: a catch that
substitutes a plausible value removes every signal that would have surfaced the
fault. `"0.0.0"` is indistinguishable from a real reading; `null` is not, so it
is now null and `bigaap doctor` reports it as a blocker. The same expression had
been copied into the new version registry and failed identically there, which
is how it became visible at all.

**A shape mismatch of my own.** The first pass at the installation commands
passed `userActions` as strings; the result contract's presenter reads
`{ what, how }`. It rendered as `NEEDS YOU undefined` on the first real run.

### Test state

**896 unit · 12 live smoke · 96 CLI smoke · 21 audit invariants · 13
generated-doc currency checks.** 31 new unit tests for 5.9, of which one is
skipped on Windows (it needs POSIX file permissions) — 30 run here.

Most assert a refusal, and each also asserts the surrounding operation
succeeded: a refusal test that passes against a program which does nothing at
all is worth nothing. Test 24b plants a real `0x08` byte to prove the control-byte
detector detects; test 16b checks that the unambiguous statuses DO migrate, so
it cannot pass against a migration that never runs.

One existing test was updated rather than weakened: the approved-surface list in
`phase51-surface.test.mjs` gained the eight installation commands. That list is
explicit rather than derived precisely so that adding a command is a deliberate
act somebody had to write down.

### Not changed

No web dashboard, no SaaS, no billing, no collaboration, no authenticated
capture, no Figma, no broad stack adapters. Automatic component-level correction
remains refused. **No evidence, safety or readiness gate was touched** — the IR,
the evidence model, the safety gate and the readiness model are byte-identical
to their 5.8 state.

**No production-readiness claim is made.**

### Carried into 5.10

- `bigaap repair` cannot restore files in a repository checkout, because source
  and destination are the same file. It reports this rather than pretending. Git
  is the tool for that case.
- The `global` and `project` installation modes are implemented and tested
  against temporary directories, but have not been exercised against a real
  Claude Code plugin load. The verified path is the repository-local one.
- No minimum Claude Code version is declared, because none is known to be
  required. If one turns out to be, it belongs in `COMPATIBILITY`.

---

## 5.10 — private-release hardening and readiness audit

Determining whether the system is ready for controlled private use, with
explicit boundaries and **no single overall verdict**.

### The stray root file

Recorded before removal — path, 0 bytes, the canonical empty-file SHA-256, not
managed, not reaching the package — then removed as an explicit cleanup action
and the root re-verified. The record is in `docs/REPOSITORY-CLEANUP.md`.

One detail worth keeping: it was kept out of the package by the **allowlist
alone**. No denylist rule matched it, and nobody would have written one. That is
the case for two gates in series rather than a denylist.

### Three defects, and the pattern behind them

**def_0041 — every global installation was dead on arrival.** Denylist rules
written for user-data directories also matched source directories of the same
name: `screenshots?` matched `src/screenshot/`, `defects` matched
`src/defects/`. Five source modules were vetoed out of the package, and a second
occurrence dropped `src/extract/extract.js` because the `src` rule matched only
`.mjs`. `bin/bigaap.mjs` imports `src/defects/store.mjs` at module scope, so the
installed plugin failed at import resolution before any command ran — while the
install reported 227 files written, 0 failed, complete.

Nothing could notice, because verification hashes the files the manifest names
and they were all present and correct. **The manifest was consistent with itself
and wrong about the world.**

**def_0042 — one malformed correction record made a workspace permanently
unusable.** `applyCorrections` read `correction.corrected.status` unguarded while
`record.mjs` guarded the identical access. `correct --file` wrote the record
before validating it, against a schema that existed and was never called, and
the resulting TypeError named no file — so the user could not learn which record
to delete.

**def_0040 — project data written into a user's repository, unmentioned.** Fixed
by reporting rather than acting: init names what it created and which paths hold
user content, and deliberately does not touch the user's `.gitignore`.

The pattern in all three, and in the audit's own false positives: **a check that
verifies a thing against itself verifies nothing.** Phase 5.9 asserted that
files were copied and hashes matched — both true — while the artefact could not
start. The remedy in every case was to compare against something external: the
source tree, the schema, the running process.

### The audit's first run reported nine findings; four were its own bugs

`exec(` matched `RegExp.prototype.exec`. A case-insensitive `schema:` matched
the `SCHEMA` enum member. A single-level listing was reported as a symlink
escape. `for(;;)` was called unbounded where both sites cap their attempts.

Rewritten to test the property rather than a word. A check that cannot
distinguish what it claims to is worse than none — its output gets skimmed.

Phase 5.9's own test 23 had the same unanchored pattern as the defect it was
guarding, and passed while the package was broken.

### Two new harnesses

`tools/release-audit.mjs` — 31 security, consistency and limitation checks.
`tools/clean-room.mjs` — 28 workflow steps across six scenarios, driving the
**installed copy**, never the checkout.

### Test state

**908 unit (907 pass, 1 skipped on Windows) · 96 CLI smoke · 12 live smoke ·
21 audit invariants · 13 generated-doc currency · 31 release-audit checks ·
28 clean-room steps.** 12 new unit tests for 5.10.

Clean room: 0 repository-root pollution, 0 browser launches, 0 unrelated files
modified, target brief and correction history byte-identical throughout.

### Not changed

No dashboard, SaaS, billing, collaboration, authenticated capture, Figma or
broad stack adapters. Automatic component-level correction remains refused.
**No evidence, safety, readiness or correction gate was weakened.**

### Readiness

Twenty-one separate decisions in `docs/PHASE-5.10-RESULTS.md`. No overall score.

The one that matters most: **Claude Code plugin loading is unverified.** The
installed copy runs as a CLI; whether Claude Code loads it as a plugin was not
testable here, and no simulated loader was written — a stub reporting success
would look like verification.

**No production-readiness claim is made.**

---

## 5.10 manual verification — the real Claude Code loader

Phase 5.10 recorded plugin loading as `unverified`. This is what happened when
it was actually verified.

### The loader was available the whole time

`claude` 2.1.179, on PATH. `claude plugin validate <path>` is read-only, takes a
path, and touches nothing. Two phases labelled the capability `unverified` while
a thirty-second check sat one command away.

**`unverified` must mean *could not be checked*, never *was not checked*.** The
label was honest and it was doing work that verification should have done.

### It failed immediately, in two ways (def_0043)

```
× Found 2 errors:
  > author: Invalid input: expected object, received string
  > agents: Invalid input
```

The manifest had been written from assumption. `author: "Bigaap"` needed to be an
object; `agents: "./agents"` needed not to be a directory string. **The plugin
could not have loaded at any point in Phase 5.9 or 5.10.**

### A trap the validator does not catch

Fixing `agents` to an array of file paths made validation pass — and
`claude plugin details` then reported `Agents (0)`. The array silently
suppresses discovery. Removing the key entirely, so `./agents/` is found by
convention, gives `Agents (1)`.

Established by testing five manifest variants against the real loader in a
scratch marketplace, not by reading documentation. A validator that accepts a
shape the loader then ignores is worth knowing about.

### The installation mechanism was not what Phase 5.9 assumed (def_0044)

A Claude Code plugin is installed **from a marketplace**:

```
claude plugin marketplace add ./ --scope project
claude plugin install bigaap-ui-forensics@bigaap --scope project
```

`bigaap install --mode global`, built across Phase 5.9 with a package boundary, a
238-file manifest and per-file hashes, copies into a directory the loader does
not read. It produces a working CLI. It does not produce a loadable plugin.

And the real installer copies the **entire source tree** — 1121 files, 47.1 MB —
consulting neither the package manifest nor `.gitignore`. Installing from the
working checkout carried 120 files of analysis workspaces into the plugin cache.

### Verified result

All five components discovered: three commands, one agent, one skill. A real
workflow — version, doctor, init, blockers, readiness, analyze — driven from the
loader's own installed copy, in a fresh project holding unrelated user files:
every step as expected, 8 artifacts, IR hash `afbddb7060a21d61`, **no browser
launched**, **no unrelated file modified**.

### The pattern, one more time

Phase 5.9: tested that files were copied, not that the copy runs. Phase 5.10:
built an audit whose own first run produced four false findings from patterns
that could not distinguish what they claimed to. This phase: a manifest
describing an integration that had never been exercised.

Every one is the same shape — **a thing checked against itself is not checked**
— and every remedy was the same: compare against something external. The source
tree, the schema, the running process, the real loader.

### Still unverified

Interactive invocation inside a live session. Discovery is verified; that
`/analyze-reference` renders as intended in conversation was not driven here.

### Not changed

The release boundary is unchanged. No evidence, safety, readiness or correction
gate was touched. **No production-readiness claim is made.**

---

## 5.11 — asset evidence preservation

The extractor had been collecting media geometry since Phase 0. The derivation
dropped it. Every rebuild prompt therefore rendered an assets section that was
four lines of brand prohibition and no measured fact — a builder was told what
not to copy and given nothing to build instead.

This closes that, and nothing else.

### The gap was in derivation, not capture

`raw.images` already held selector, tag, rendered box, aspect ratio,
`object-fit`, alt presence and region for every `img`, `picture` and `video`.
`ir` had no `assets` key at all. The data reached the workspace and stopped
there.

That made this the cheapest available step toward the benchmark: no new browser
work, no new capture surface, and every existing fixture already carried the
evidence.

### What flows now

`raw.images` → evidence records → `ir.assets` → the prompt's §12, with
provenance intact at every hop. Each fact is an ordinary claim carrying its own
status, confidence and evidence ids, so a rendered box read off layout geometry
and an intrinsic size the element never exposed stay distinguishable.

The status split is the substance:

| Fact | Status | Why |
| --- | --- | --- |
| rendered box, aspect ratio | `measured` | read off layout geometry |
| `object-fit`, tag, region | `observed` | read from a declared style or the markup |
| alt **presence** | `observed` | an attribute that is there or is not |
| intrinsic size | `measured` when exposed, `unknown` otherwise | never back-filled |

### Three distinctions worth keeping

**A measured zero is not an absence of measurement.** A DOM capture always
carries an `images` array, so a zero-length one means the document was walked and
held no media — a finding about the page, recorded as `measured: 0`. A capture
with no array never enumerated anything and stays `unknown`. Collapsing those
would have made "this page has no images" and "nobody looked" the same value,
which is the distinction the whole evidence model exists to preserve.

**An intrinsic size is not a rendered box.** An image scaled into a larger box
would otherwise be recorded at the box's dimensions. Absent stays absent, and the
prompt says so rather than filling it in.

**Alt presence is not alt text.** Whether the attribute exists is a fact about
the markup; its content belongs to the reference's author. A test asserts the
text cannot reach the evidence map.

### Screenshot ceilings

`src/screenshot/ceilings.mjs` gained a suffix-matching list alongside its prefix
one, because the per-element leaves live under an indexed path
(`assets.items.3.objectFit`) that no fixed prefix reaches without also catching
the geometry beside it.

`object-fit`, alt presence, intrinsic size and tag name are refused outright from
a frame — each is a document fact rather than a visual one, and a pre-cropped
photo is identical to a cover-fitted one once painted. Rendered geometry is
**not** refused: a frame does show a box, and it is capped to `estimated` by the
ordinary ceiling rather than forbidden. A ceiling that refused everything would
be a blunt instrument, not a ceiling.

### PL22

A warning, never a blocker. Assets are not a safety property, and blocking a
prompt over a table would be out of proportion — but a section that renders its
title and nothing else is exactly the regression that went unnoticed for months.

It fires only when the IR carries measured media and none of it appears. A
capture that genuinely found nothing cannot trigger it: a measured zero is a
finding, not a missing fact.

### Two mistakes, both instructive

**PL22 could not fire when first written.** It searched the whole document for
values like `fill`, `cover`, `picture` and `img` — ordinary words that appear in
prose elsewhere, so the check passed even against a section stripped of its
facts. Now scoped to the assets section and keyed on numeric geometry, which does
not appear by accident. Caught only because the test asserted the failure case
rather than the passing one.

**The "no rule weakened" test asserted a rule table I had assumed rather than
read** — twice. PL01 and PL03 are warnings; PL08 and PL09 block. It now pins both
sets, so a rule quietly promoted to blocking is caught as readily as one demoted.

Both are the same shape as every earlier finding in this project: a check
verified against an assumption is not a check.

### Test state

**924 unit · 923 pass · 0 fail · 1 skipped** (POSIX-only, on Windows) — 15 new.
96 CLI smoke · 12 live smoke · 21 audit invariants · 13 doc currency ·
31 release-audit checks, 0 findings · 28 clean-room steps, 0 browser launches.

Every absence-test also asserts the surrounding operation succeeded. The
zero-media test checks the prohibitions survived; the screenshot test checks the
count is `unknown` *and* that no leaf is `measured`.

No generated artifact was written into `.ui-analysis` or the repository — every
regeneration during this milestone went to a temporary workspace.

### Deliberately not in this milestone

Motion extraction, video behaviour, responsive per-breakpoint analysis, and
marketplace packaging. `assets.count` from a screenshot is `unknown` rather than
estimated: the screenshot path has no media-region detector, and inventing one
was not in scope. That is the honest state, not a claim of coverage.

### Still missing for the benchmark

Assets remain partial. Video behaviour (autoplay, loop, poster), `srcset`,
`loading`, and focal points are not captured at all. Motion is unchanged and
remains the largest gap.

> Superseded in part by 5.12: declared motion is now extracted. What that
> milestone deliberately does **not** produce — triggers, stagger, scroll-linkage
> — is recorded there and in KNOWN-LIMITATIONS.md. The assets sentence still
> stands.

---

## 5.12 — declared-motion extraction (M1)

The motion section read `Transition timing: NOT DETERMINED` on real captures
while the extractor collected `animationName` and four transition longhands and
discarded all of them. Same shape of gap as 5.11's assets, one layer deeper:
this one needed new capture as well as new plumbing.

### Declared is the ceiling

Everything this milestone adds is read from computed style or from a stylesheet
rule. Every claim is `observed` — never `measured`, which is reserved for
geometry, and never `inferred`, which would mean deriving it from a pattern.

| Extracted | Where from |
| --- | --- |
| Eight animation longhands — name, duration, delay, timing, iterations, fill, direction, play-state | computed style, per element |
| Four transition longhands — property, duration, delay, timing | computed style, per element |
| `transform`, `will-change`, `filter`, `backdrop-filter` | computed style, per element |
| `@keyframes` **bodies** — offsets and declarations | same-origin stylesheet rules |
| `document.getAnimations()` | a runtime sample |

The `@keyframes` **names** were already captured and had been for phases; only
the bodies were missing. A name tells a builder that `fade-up` exists. The
offsets are what make it reproducible.

### What is deliberately not produced, and why it cannot be

**Triggers, stagger, and scroll-linkage are absent from every layer** — not
recorded in evidence, not derived into the IR, not rendered, and not inferrable
from what is. Each is unavailable for a structural reason rather than a
budgetary one:

- A declaration says an element *has* an animation. Whether anything starts it —
  page load, a class toggle, a scroll driver, never — leaves no trace in computed
  style.
- Two elements with different delays may be one staggered sequence or two
  unrelated rules. The difference is intent, and intent is not a CSS property.
- Computed style is byte-identical whether or not a scroll driver exists.

All three need multi-sample capture to earn. The prompt says so in its own
words, under a heading that exists for the purpose, and a test asserts the words
are there rather than merely that the fields are absent.

### Two things that are honest about their own limits

**`getAnimations()` is a time-dependent sample.** An animation that finished a
moment before capture is invisible; one that is running says nothing about what
started it. The evidence record carries that caveat in its notes, and a test
asserts the caveat is present — otherwise "running" reads as "runs on load".

**The per-element list is capped at 200.** A page can declare a transition on
thousands of elements. When the cap bites, the true total is still reported and
the prompt states that the rest were not captured and that their absence is not
evidence they do not animate. A list that silently stops at 200 looks like a
complete list of 200.

### A ceiling gap this closed

`tokens.motion.` was a forbidden screenshot prefix; `motion.` was not. Every
per-element claim added here would have escaped the ceiling entirely, and a
screenshot could have reported an `animation-delay`. A frame contains neither
the declaration nor the time.

### PL24, demoted before it shipped

Written first as blocking, then demoted to a warning on reading the section it
polices: the boundary note contains the phrase "on scroll" while explaining that
scroll-linkage is unknown. A blocking rule that fires on its own disclaimer is
worse than a warning that does not.

The real defence is structural — nothing upstream can supply a trigger, so there
is nothing for a prompt to carry one from. PL24 is the second line, and a second
line that can block on a false positive costs more than it saves.

### The golden fixture, and what justified changing it

Live smoke fell to 11/12 on *"full extraction matches the pre-migration
golden"*. It is the only suite that runs `extract.js` in a real browser, so it
is the only one that could have noticed.

Before touching the golden the diff was taken precisely: **two added top-level
keys (`motion`, `keyframeDetail`) and three new empty histograms; zero existing
values changed, zero keys removed.** Purely additive, so
`fixtures/raw/fid-equiv-1440.{raw,probe}.json` were regenerated and the suite
returned to 12/12. Those two files are the only repository artifacts this
milestone wrote.

A golden that must be reviewed on every additive change is doing its job. The
discipline is diffing it first, not updating it because it went red.

### An incident worth recording

The first live-smoke run hit a command timeout. That killed the shell wrapper
and **not** the node process: three strays survived and kept the def_0037 lock,
which then refused the next run rather than producing a corrupted 11/12 that
would have read as three real regressions.

pid 9192 was verified alive before it was stopped, rather than reclaiming a lock
whose owner might still have been working. The lock did exactly what it was
built for, against exactly the failure that motivated it.

### Test state

**942 unit · 941 pass · 0 fail · 1 skipped** (POSIX-only, Windows) — 18 new.
96 CLI smoke · 12 live smoke · 21 audit invariants · 13 doc currency ·
31 release-audit checks, 0 findings · 28 clean-room steps, 0 browser launches.

`.ui-analysis` untouched; every regenerated prompt went to temp.

### Deliberately not in this milestone

Video behaviour, responsive per-breakpoint analysis, packaging, Phase 6, and any
inference of trigger, stagger or scroll-linkage.

---

## 5.13 — M1 determinism correction, and M2a observed motion

Two pieces of work, gated: the correction had to pass before the milestone
started, because M2a's fixture is the thing that would have made the latent bug
fire.

### The M1 correction

`motion.running` samples `document.getAnimations()` — what happened to be in
flight when the capture read the page. It is a reading of one instant, and it
was sitting inside a byte-comparable golden.

It was `[]` on the forensic fixture by luck, not design: `@keyframes
bigaap-fade-up` is declared there and never applied, so nothing runs. The moment
any golden fixture animated, the comparison would have gone flaky and the
flakiness would have looked like an extractor defect. M2a's fixture — which
requires an autoplaying decoy — is exactly that page.

The comparison now drops the field. **The golden file keeps it.** An artifact
should record what the capture saw; an equality check should not depend on it.
Everything else under `motion` is read from declared style, is time-invariant,
and stays compared.

Proof the fix does something rather than merely passing: two captures differing
only in `motion.running` compared **unequal before** and **equal after**.

### M2a, and the distinction it exists to hold

Two statements, never merged:

> "opacity changed after scrolling" — a runtime observation
> "scrolling caused the opacity change" — a causal claim

The first needs two timestamped samples. The second needs a **control**: an
observation over comparable elapsed time with the action withheld. Without one
you cannot tell a triggered change from one that was going to happen anyway —
and an autoplaying animation is indistinguishable from a scroll-triggered one
if you only ever scroll.

So every causal claim carries the id of the control that licensed it, and a
claim whose control fails is downgraded to `unverified` **with the runtime
observation preserved**. Discarding the observation because attribution failed
would throw away a fact to punish a guess.

### The fixture is built to let gates fail

| Element | Behaviour | Result |
| --- | --- | --- |
| `#real-scroll` | opacity flips on scroll POSITION | **verified · no-change** |
| `#decoy-autoplay` | infinite keyframes from load | **unverified · same-change** |
| `#io-target` | class toggled by IntersectionObserver | **verified · no-change** |
| `#static-control` | inert | no change |

The decoy is the load-bearing one. A fixture where everything is genuinely
scroll-triggered would let a broken gate pass everything and look correct.

### Separation from the deterministic suite

Five ways, so neither can disturb the other: different file, port (4175 vs
4174), lock, fixture, and — the one that matters — **comparison model**. Live
smoke compares bytes; the motion suite compares classifications. Timestamps
differ every run by definition, so a byte comparison there would fail for
reasons that are not regressions, which is the fragility the M1 correction had
just removed from the golden.

### Three bugs, all mine

**The wrong envelope path.** `.result.value` is the capture SESSION's wrapper;
the driver returns a flat envelope with `.value`. Every sample returned null and
every diff was empty — and the symptom presented as "control absent", which is
what the gate correctly reports when nothing changed.

**Waiting on the mechanism instead of the observable.** The intersection wait
returned on the class flip, which is instantaneous, while the opacity transition
takes 200ms. Samples caught `entered: true, opacity: "0"`. The scroll action had
worked all along because it waited on opacity stability. Fixed by waiting on the
observable — **no threshold was loosened to make it pass.**

**A provoked failure that provoked nothing.** The driver reports a bad selector
as a failed envelope rather than by throwing, so the cleanup-after-failure test
was measuring an exception that never occurred. It now asserts the envelope
behaviour *and* raises a real throw, because what is under test is the `finally`,
not the cause of death.

### Test state

**961 unit · 960 pass · 0 fail · 1 skipped** — 19 new offline.
Browser suite **34/34 across 3 chained runs**, and **14/14 on each of 3
independent invocations**: six executions, no flakiness.
96 CLI smoke · 12 live smoke · 21 audit invariants · 13 doc currency ·
31 release-audit checks, 0 findings · 28 clean-room steps, 0 browser launches.

`CAPTURE_CONTRACT_VERSION` unchanged. Forensic golden unchanged. `.ui-analysis`
untouched. No stray processes or locks.

### The gap this milestone does NOT close

**`raw/motion-*.json` is not carried through evidence → IR → prompt.**
Observed motion is captured, classified and written to its artifact. It does not
reach a generated prompt, and no prompt today contains an observed-motion claim.

The receiving machinery is in place — `motion.observed` is refused by the
screenshot ceilings, and PL25/PL26 police control-less claims and stated
triggers for unverified classifications — but nothing feeds it yet. This is the
same shape of gap that assets sat in before 5.11, recorded here so it is not
discovered later as a surprise.

*Closed by 5.14 below.*

### Deliberately not in this milestone

Stagger, animation-progress series, video control, video crossfades,
reduced-motion comparison, broad timing calibration, packaging, Phase 6.

## 5.14 — M2c observed-motion prompt integration

The gap 5.13 recorded is closed. `raw/motion-<viewport>.json` now travels the
whole spine: artifact → evidence → IR → prompt, under the same rules everything
else travels under.

### What was added

`src/evidence/motion-observed.mjs` converts the artifact into evidence records.
It checks the contract version **before** the shape, because a newer artifact may
be perfectly well formed under a schema this build has never seen, and calling it
malformed would send someone to inspect a file that is fine. Five artifact states
are distinguished and each is reported by name: `valid`, `absent`, `invalid`,
`unsupported-version`, `refused-source`.

One evidence record is emitted per changed property. A verified trigger becomes a
separate record at `inferred` / `runtime-correlation` — inferred, not measured,
because the change is what was measured and the cause is what was reasoned from
it. An unverified trigger becomes `unknown` with motion evidence class
`unverified` and its reason preserved verbatim.

`ir.motion.observed` carries `artifact`, `runtime`, `triggers.verified`,
`triggers.unverified`, `controls`, `cleanup` and `limitations`. The two trigger
arrays are separate containers rather than a flag on one list, so a reader cannot
arrive at a verified trigger by ignoring a field.

The prompt's `### Observed runtime motion` subsection renders before/after per
observation, the sampled-property set so a reader knows what silence means, the
verified trigger with its control result, and the unverified one as an explicit
refusal ending in **Do not claim `X` caused this.** When no usable artifact
exists, the section states which of the four states applies and why.

### The semantic line this milestone exists to hold

A change is not a cause. Every rendering keeps them as two statements, and the
second one requires a control observation over comparable elapsed time with the
action withheld. On the fixture, `#real-scroll` and `#decoy-autoplay` both change
opacity; only the first gets a trigger, because only the first has a control that
stayed still. The decoy's change is still reported — it happened — and its cause
is refused in the same breath.

### Results

983 unit tests, 982 pass, 1 skip (POSIX permissions, on Windows), 0 fail.
22 of 22 M2c integration checks.
96 CLI smoke · 12 live smoke · 21 audit invariants · 13 doc currency ·
31 release-audit checks, 0 findings · 28 clean-room steps, 0 browser launches.

Forensic golden unchanged — byte-identical apart from timestamps. `.ui-analysis`
untouched, 120 files, none newer than 2026-08-12. Declared motion unchanged.
Asset output unchanged. `CAPTURE_CONTRACT_VERSION` and `MOTION_CONTRACT_VERSION`
both unchanged. No new browser capture was run.

`def_0045` was filed and fixed: the M1 no-trigger guarantee was enforced by
scanning all of `ir.motion` for the substring `trigger`, which cannot tell a
claim from an empty container and fired on `observed.triggers`. The scan now
covers the declared axis, where the ceiling was drawn, and the observed axis
gained the assertion the scan could never express — no artifact, therefore no
trigger. Third witness for the rule that a check verified against its own
assumptions verifies nothing.

### Remaining limitations

These stand after 5.14 and are not closed by it:

- The motion observation pass is **opt-in** and not part of a default analyze.
- Motion remains **per viewport**, with no cross-viewport reconciliation.
- **Stagger** is not implemented.
- **Animation-progress series** is not implemented.
- **Video behaviour and crossfades** are not implemented.
- **Reduced-motion comparison** is not implemented.
- **Timing thresholds remain uncalibrated.**
- **No production-readiness claim is permitted**, by this record or any other.

Only the fixture is proven. Six flakiness-free browser executions establish the
protocol against `fixtures/motion/`; that is not evidence about any other site.

### Deliberately not in this milestone

M2b, packaging, Phase 6. None of these begins without separate approval.

**Status: complete.**

## 5.15 — Prompt reachability and the resting-state correction

A product-level acceptance review against `stripe.com/pricing` found that the
main output did not exist. `bigaap recreate` returned exit 3 `blocked` on all
seven analysis workspaces, and `rebuild-prompt.md` — the thing this project is
for — could not be reached through the CLI at all. The prompt reviewed in that
report was obtainable only by calling the renderer directly.

### What was actually wrong

Not the gate's policy. The `states` requirement is declared advisory —
`severity: "warning"`, escalating only through `conditionalOn: "includeStates"`,
whose default is `false`. The design was already what was wanted.

`src/cli/resolve.mjs` declares `toolDefault: ["default"]` for the `states` key,
and `src/cli/workflow.mjs` computed `includeStates` as `!!states.length`.
`["default"]` has length 1, so every run escalated. But `"default"` is the
**resting** state — what a plain capture already holds, and the opposite of
asking for hover or focus recreation. The rest of the CLI already knew this:
`present.mjs`, `result.mjs` and `run-store.mjs` all test `state !== "default"`.
One consumer read a sentinel meaning *nothing requested* as *something
requested*, and the product's main output disappeared behind it.

The tool-default was left alone. `["default"]` is correct for the capture path,
which does need to know to capture the resting state. The fix is at the
interpretation site:

```js
states: (resolution.values.states ?? []).some((s) => s !== "default")
```

`[]` → false · `["default"]` → false · `["default", "hover"]` → true ·
`["hover", "focus"]` → true.

### What else this exposed

`--states` was parsed by `recreate` but never declared in its catalog entry, so
the value that blocked every run appeared in no help output and could not be
unset from the documented interface. It is declared now, and its describe text
says plainly that naming a non-resting state makes that state blocking when the
capture never induced it.

Advisory mode gaps reached no CLI surface at all — `states` had only ever been
escalated to a blocker or silent, so a prompt built without induced states would
have looked identical on the run to one built with them.
`modeEvaluation.warningGaps` is now surfaced, and mega-menu reports
`mode:states — no hover, focus or disabled state was induced in this capture`.

Two artifacts read `ir.modeEvaluation.mode`, a field the evaluator does not
emit — it emits `requestedMode`. Every prompt header therefore read
`**Requested mode:** not recorded`, and every artifact stamped `"mode":
"analyze"` regardless of the workflow that produced it. Same one-word cause,
fixed with it.

### The line this milestone does not cross

Missing interactive states remain a warning and an explicit limitation, in four
places, all keyed to absent evidence rather than to a gate decision: section 8's
existing refusal, the new section 14 note, the section 15 limitation entries and
section 16's forbidden assumption. A capture that HAS states takes the other
branch in both 8 and 14, which is asserted rather than assumed.

No gate was weakened. `component-anatomy`, `uncontested-criticals`, invalid
artifacts and screenshot-only input all still refuse. Asking for states that
were never induced — `--states hover,focus` — is still refused, and emits no
implementation prompt.

**`stripe.com/pricing` still does not produce a prompt, and that is correct.**
Its primary component resolved 1 of 3 required surface anatomy properties. The
honest route to a Stripe prompt is better component resolution, not a looser
gate, and it was not taken here.

### Normal-workflow verification

`node bin/bigaap.mjs recreate --workspace <temp copy> --stack next-tailwind`

| Capture | Exit | Status | Prompt |
| --- | --- | --- | --- |
| mega-menu | 0 | completed-with-warnings | `output/rebuild-prompt.md` |
| p30 | 0 | completed-with-warnings | `output/rebuild-prompt.md` |
| stripe-pricing | 3 | blocked | `blocked-prompt.md` only |

All 16 prompt sections present. Metadata and header both record `recreate`.

### Results

1003 unit tests, 1002 pass, 1 skip (POSIX permissions, on Windows), 0 fail.
20 of 20 focused reachability checks · 22 M2c integration · 96 CLI smoke ·
12 live smoke · 21 audit invariants · 13 doc currency · 31 release-audit
checks, 0 findings · 28 clean-room steps, 0 browser launches.

`.ui-analysis` untouched. Forensic golden unchanged. Declared-motion, asset and
observed-motion output unchanged. `analyze` unchanged — it still emits a design
spec and no rebuild prompt.

`def_0046` was filed before the fix and is fixed with regression coverage. Two
tests in `phase56-readiness-ux` failed once the fixture stopped blocking: one
listed every decision headline except `can continue with warnings`, the other
read `partial-design-spec.md` unconditionally, a file only the blocked branch
writes. Both had encoded the defect as expected behaviour; neither assertion was
weakened. Recorded under def_0046 rather than filed separately — same cause.

Fourth witness for the standing rule that a check verified against its own
assumptions verifies nothing: every prompt test called the renderer or the
projection directly, and CLI smoke exercised `recreate` only in its refusing
paths, so nothing anywhere asserted that the product's main output could be
produced. R7 and R8 run the real binary and look on disk.

### Remaining limitations

- **`stripe-pricing` remains blocked** on `component-anatomy`. Correct, not fixed.
- **No capture in this repository carries induced state evidence**, so section
  8's measured-states branch is exercised only by constructed IR.
- Page structure, coverage disclosure and component yield are unchanged, and
  remain the three highest-impact gaps for whole-page builders.
- **No production-readiness claim is permitted.**

### Deliberately not in this milestone

Component-yield improvements, M2b, packaging, Phase 6. None begins without
separate approval.

**Status: complete.**

## 5.16 slice A — coverage and census honesty

A product-level review asked why the prompt was weak for whole-page builders.
Inspecting that turned up something else: two statements in generated output
were false, and both came from one conflation — a number that meant either
*measured, and it is none* or *nobody finished looking*, rendered as though it
always meant the first.

### The two false statements

`pct(n, d)` returned `0` when `d` was not positive. `stripe.com/pricing` sampled
318 header, 291 nav and 156 footer nodes; its prompt, blocked prompt and
coverage report all printed **0.0%** for header and footer, because
`regionAvailable` counted no landmark elements and the division produced a
number anyway. A reader could not distinguish a region nobody visited from a
region with no denominator, and the second is not evidence of absence.

Media enumeration runs inside the budget-limited sample loop, so a truncated
capture enumerated 2 elements and section 12 rendered
`Media elements found: 2 (measured)` — page-wide census phrasing over a 43%
sample. The extractor had counted **526** media elements in the content region
and that number reached nothing. The zero-media branch was worse in principle:
*"The document was walked and no `img`, `picture` or `video` element was found —
a finding about the reference, not a gap in the capture"* was emitted with no
check that the walk had finished.

### What was already there

Every fact needed to keep the meanings apart had been recorded by the capture
and thrown away at the IR boundary: `coverage.truncated`, `nodeCap`,
`sampledByRegion`, `regionAvailable`, `primaryRegion.mediaCount`. The conflation
was invisible because the missing evidence was the evidence that would have
exposed it. Slice A carries all of it through and makes the projections consult
it. No new measurement was taken.

### The rules now

`null` means *no denominator*; `0` stays reserved for a measured zero. The two
call sites that feed arithmetic coerce with `?? 0` at the call site, so the
coercion is visible rather than hidden inside the helper — `contentReached` and
`coverageFactor` are unchanged. One formatter, `coveragePercent`, serves the
prompt, the blocked prompt and the coverage report, and states the sampled count
alongside "not measurable" so the phrase cannot be read as "empty".

A truncated walk renders sampled-scope wording and names the region count beside
it. A complete walk keeps the existing absence finding, which was always
legitimate there. An incomplete walk that found no media says whether the page
uses media is **unknown**. The measured claim itself is untouched in every case —
same status, evidence id, confidence — because the count was never wrong, only
its scope.

### Results

1018 unit tests, 1017 pass, 1 skip, 0 fail. 15 of 15 focused slice-A checks ·
42 M2c and 5.15 reachability · 96 CLI smoke · 12 live smoke · 21 audit
invariants · 13 doc currency · 31 release-audit checks, 0 findings · 28
clean-room steps.

mega-menu and p30 still exit 0 and emit prompts, with their zero-media findings
preserved and all three regions at 100%. `stripe-pricing` still exits 3 on
`component-anatomy`, unchanged and genuine.

Forensic golden unchanged. `.ui-analysis` unchanged and now **fingerprint-
protected**: A15 hashes the whole fixture tree either side of a CLI run rather
than asserting a file's absence. Declared-motion, observed-motion, `analyze` and
asset evidence bytes all unchanged. No landmark or structure was invented; no
threshold or gate moved.

`def_0047` records both conflations. It was filed after the fix rather than
before it, which departs from the standing rule; the full record existed as the
pre-edit inspection report, and the defect file was opened when the milestone
was recorded. Noted here rather than left tidy.

Two regressions were introduced and caught during the work. The first census
rewrite dropped `renderClaim`, losing the `measured` status and evidence id from
the media count — `phase511-assets` A3 failed on it, correctly, and the fix was
to change the label rather than the claim. The first version of A15 asserted a
generated file must not exist under `.ui-analysis`, which failed on fixture
history rather than on a write; it now fingerprints the tree. Neither assertion
was weakened.

### Remaining limitations

- **`stripe-pricing` still blocks** on `component-anatomy`. Correct.
- **Region-availability denominators remain zero for Stripe.** The extractor
  counts landmark availability differently from region attribution. Slice A
  reports that honestly; it does not reconcile the two accountings.
- **Page structure is unchanged** and still says no landmark structure was
  captured on pages that demonstrably have a header and footer. Slice B.
- **Component and repeat-group counts are still unguarded by truncation.** Only
  media was scoped, per the approved slice.
- **No production-readiness claim is permitted.**

### Deliberately not in this milestone

Slice B, slice C, M2b, packaging, Phase 6. None begins without separate approval.

**Status: complete.**

## 5.18 slice C — component evidence and repeated-structure honesty

Two losses, opposite in kind. A measurement that had nowhere to go, and a
detector whose findings had nowhere to be reported.

### The padding that ceased to exist

`if (uniform) { ... }` in `src/evidence/build.mjs` had no `else`. A padding that
was not identical on all four sides produced no claim, no `rec.unknown`, no
evidence record, and therefore no line in the prompt's evidence limitations
either — twenty lines above it, `borderRadius` records an explicit unknown when
it cannot attribute a value, which is the treatment padding should have had.

The consequence reached the gate. Surface anatomy entries are what the
`recreate` component-anatomy requirement counts, so `stripe.com/pricing` — which
measured `background: #fafbfd` **and** `padding: 16px 24px 16px 24px` — was
assessed at one property instead of two. The refusal was right either way, since
the requirement is three, but the number it cited was wrong, and a component
with three genuine non-uniform-padded properties would have been refused
outright.

Every fixture in this repository uses uniform padding, so nothing ever executed
the branch that dropped the value. Recorded as `def_0049`.

Non-uniform padding is now emitted as the collapsed shorthand — `16px 24px` —
with the four sides in `normalized`. A string, not an object, because
`formatValue` renders any object as `[object Object]` and because the shorthand
is pasteable as it stands. The uniform path is untouched, so `truth.json`'s
expectation that `24px 24px 24px 24px` yields numeric `24` still holds. A
padding that resolves to neither shape now records an unknown quoting the raw
value, so it can never leave silently again.

### Repeated structures, which are not components

The IR models one card and one button; everything else the repeat detector found
was used for scoring and discarded. A page whose content region holds 112 repeat
groups produced a prompt naming two things.

`ir.repeatedStructures` reports them as themselves: signature, instance count,
region, sample geometry. **Never a surface, and never in `ir.components`** — the
gate reads that array, so a repeated structure is unable to satisfy it by
construction rather than by a check that could later be forgotten. A test
injects forty fabricated structures with painted members and stable selectors
and asserts the verdict is byte-identical.

Nested duplicates collapse to the outermost member of each equal-count family,
which is how `div.PricingProductFeature` — the semantic feature row the
component resolver deliberately declines to ascend to — finally reaches a
builder, as a repeated structure with 57 instances and a known box, carrying no
surface claim.

### Scope, stated rather than divided

`repeatGroupsDetected` is the **serialised** count and the extractor caps its
list at 15. It keeps its name and meaning for existing consumers; the scope is
carried alongside in `repeatGroupsSerialised`, `repeatGroupsCap`,
`repeatGroupsTruncated` and `repeatGroupsInPrimaryRegion`.

The last two count **different sets and are never divided into one another**:
p30 serialises 8 while its content region holds 7, because a nav group is
serialised and is not in the content region. The prompt states each as its own
fact and says plainly *do not read one as a fraction of the other*.

Incompleteness and scope are also kept apart, which cost one iteration to get
right: the first rendering fired *"a sample, not a component inventory"* on p30,
whose walk completed and was never capped. That warning is now gated on
`capped || truncated`; the set-difference note stands on its own.

### Results

1065 unit tests, 1064 pass, 1 skip, 0 fail. 24 of 24 focused slice-C checks ·
80 across M2c, reachability, slice A and slice B · 96 CLI smoke · 12 live smoke ·
21 audit invariants · 13 doc currency · 31 release-audit checks, 0 findings ·
28 clean-room steps.

`stripe-pricing` still exits 3 on `component-anatomy`, now reading **2 surface
anatomy properties** against the unchanged `3 and 0.50 required`. mega-menu and
p30 still exit 0 and emit prompts, with uniform padding unchanged and
mega-menu's structures section omitted entirely rather than rendered empty.

Forensic golden unchanged. `.ui-analysis` byte-identical. Slice A's coverage
semantics and slice B's landmark states intact. Sections 10 and 12 untouched.
Screenshot-only IRs still validate; a capture with no repeats yields `null`.

### Remaining limitations

- **`stripe-pricing` remains blocked at 2 of 3.** The element has two measurable
  surface properties. No third was manufactured.
- **Selector stability is not measured** in any capture here — these fixtures
  predate `classProfile` — so structures are reported as `not-measured` and the
  prompt says the names may not be stable identifiers.
- **Repeat serialisation is still capped at 15.** Slice C discloses the cap; it
  does not raise it.
- **`def_0048` remains open** with one unexplained witness.
- **No production-readiness claim is permitted.**

### Deliberately not in this milestone

M2b, packaging, Phase 6. None begins without separate approval.

**Status: complete.**

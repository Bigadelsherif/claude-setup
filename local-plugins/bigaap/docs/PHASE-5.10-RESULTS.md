# Phase 5.10 — private-release verification results

Final hardening and readiness audit. Produced 2026-08-14.

**There is no overall release score, and none will be produced.** The decisions
below differ from one another, and a single number would hide the difference
exactly where a reader needs it. Read the table.

**No claim is made that this system is production-ready.**

---

## 1. The stray root file — handled explicitly

Recorded in full before removal, in [REPOSITORY-CLEANUP.md](REPOSITORY-CLEANUP.md).

| | |
| --- | --- |
| Path | `console.log('down'))` (repository root) |
| Type | Regular file — not a directory, not a symlink |
| Size | **0 bytes** |
| SHA-256 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| Managed | **No** — not in the 234-file manifest |
| Reaches the package | **No** |
| Origin | A shell command whose fragment `console.log('down'))` was read as a redirection target |

The hash is the canonical SHA-256 of empty input, which independently confirms
it held nothing.

**One detail worth recording:** it was kept out of the package by the
**allowlist alone**. `isExcluded()` returns `false` — no denylist rule matches
it, and nobody would have thought to write one. That is the two-gates-in-series
design doing its job, and the reason a denylist alone is not sufficient.

Removed as an explicit cleanup action after the record was written. The
repository root now holds 22 entries, all expected.

---

## 2. Readiness decisions

Separate, as required. `unverified` is not a soft `not-ready` — it means the
thing was not tested and no claim is made either way.

| Capability | Decision | Basis |
| --- | --- | --- |
| Repository-local installation | **ready** | Clean-room 28/28; the verified path |
| Global installation (`bigaap install --mode global`) | **ready-with-warnings** | The copied tree runs and answers. **It is not how a Claude Code plugin is installed** — see the row below and def_0044 |
| Claude Code plugin loading | **ready-with-warnings** | **Verified 2026-08-14 against Claude Code 2.1.179.** All 5 components discovered. Warnings: it required two manifest fixes (def_0043), and installing copies the whole directory (def_0044) |
| Project initialization | **ready** | Verified clean, beside unrelated files, and over existing configuration |
| Live URL analysis | **ready-with-warnings** | Live smoke 12/12 against a local fixture. Against arbitrary sites, def_0020 and CSP behaviour apply |
| Screenshot analysis | **ready-with-warnings** | Works; precision is reduced and reported as observed/estimated, never measured |
| Prompt generation | **ready** | 26 lint rules (PL22 in 5.11; PL23–PL24 in 5.12; PL25–PL26 in 5.13); only measured and observed claims render as exact |
| Adaptation | **ready-with-warnings** | Requires a filled-in target brief; reports `requires-user-input` until then |
| Improvement | **ready** | |
| Conditional recreation | **ready-with-warnings** | Emits a rebuild prompt when the safety gates allow one. Missing interactive states are **advisory** — a warning and an explicit prompt limitation — unless `--states` names a non-resting state, which makes their absence blocking. Genuine gates still refuse: component anatomy, contested criticals, invalid artifacts, screenshot-only input. **This basis was corrected after Phase 5.10 — see §10 below** |
| Fidelity comparison | **requires-additional-validation** | 6 of 17 tolerances unvalidated, 1 blocked-on-definition |
| Correction preview | **ready** | |
| Supported correction application | **ready** | Global values only |
| Automatic global-value correction | **ready-with-warnings** | Promotion needs two independent witnesses; promoted rules do not yet affect derivation |
| Component-level correction | **unsupported** | def_0030 — 0.5 recall against a 0.6 bar |
| Cross-implementation component matching | **unsupported** | def_0030, permanent limitation |
| Authenticated targets | **unsupported** | The tool never enters credentials |
| Unattended execution | **not-ready** | Every output requires review |
| Production automation | **unsupported** | Out of scope; see the release boundary |
| Private local use | **ready-with-warnings** | Read [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md) first |
| Controlled private release | **ready-with-warnings** | Conditional on the manual checklist, chiefly plugin loading |

---

## 3. Clean-room workflow

`node tools/clean-room.mjs` — **28 steps, 28 matched expectation, 0 browser
launches.**

Every step drives the **installed copy**, never the checkout. That is the point:
Phase 5.9's tests asserted that files were copied and that hashes matched — both
true — while every installation it produced could not start.

Six scenarios:

| Scenario | Result |
| --- | --- |
| Clean temporary directory | 21 steps, all as expected |
| Packaged copy driven as an installed plugin | The copy starts, dispatches, returns typed results |
| Project with unrelated files | **0 unrelated files modified** |
| Project with existing user configuration | Preserved |
| Project with a filled-in target brief | **Byte-identical after init and after a migration dry run** |
| Project with existing evidence and correction history | **Correction record byte-identical after analysis** |

Verified across all six:

- **Repository-root pollution: none.** The root was snapshotted before and after.
- **No writes outside the configured workspace.**
- **No secrets in package or events.**
- **No browser launched during preflight** — 0 launches across 28 steps.
- **No user files overwritten.**
- **No correction history deleted.**
- Repair left a modified managed file untouched and exited `requires-user-input`.
- Uninstall preserved the brief and the corrections by default.

---

## 4. Security and privacy audit

`node tools/release-audit.mjs` — **31 checks, 0 findings** after remediation.

| Check | Result |
| --- | --- |
| Raw control bytes in managed source | none in 239 files |
| Secrets and tokens in source | none; 3 documented vendor examples used as redaction test input |
| Absolute user paths in events | the event model accepts no such field |
| Query parameters in events | no URL field exists on an event |
| Screenshots in observability directories | none |
| DOM or HTML in events | no such field |
| Target-brief contents in events | no such field |
| Source page content in errors | codes only, never messages |
| Unmanaged files in the package | none; manifest complete at 118/118 source modules |
| Generated artifacts in the package | 13 generated docs, marked `regenerate`, never user outputs |
| Unsafe shell execution | no shipped module imports `child_process` |
| Unsafe dynamic evaluation | 2 reasoned exceptions, no `eval` |
| Path traversal | package paths are relative and posix-normalised |
| Symlink escape | every recursive walker uses `lstatSync` or `withFileTypes` **and** skips links |
| Unbounded file writes | 4 retention bounds, all configured and enforced |
| Unbounded retries | 2 unconditional loop headers, each with an attempt cap and an exit |
| Browser operations without timeouts | the driver declares timeouts and a default bound |

### The audit's own first run reported nine findings. Four were its own bugs.

Worth recording, because it is the same failure mode as def_0038:

- `exec(` matched `RegExp.prototype.exec` — six false findings.
- A case-insensitive `schema:` matched the `SCHEMA` enum member, inventing a
  reference to a `schema.schema.json` that never existed.
- A single-level `readdirSync` was reported as a symlink escape.
- `for(;;)` was reported as unbounded when both sites cap their attempts.

**A check that cannot distinguish what it claims to distinguish is worse than no
check**, because its output gets skimmed and then ignored. All four were
rewritten to test the property rather than a word.

---

## 5. Regression and consistency audit

**13 checks, 0 findings.**

Command catalog ↔ dispatch ↔ generated docs; statuses ↔ exit codes; artifact
registry; schemas referenced ↔ schemas on disk; version registry ↔ compatibility
table; manifest ↔ source tree; blocker code uniqueness; release documents.

All 27 commands are catalogued, dispatchable, documented with a failure
behaviour and an example, and present in `COMMANDS.md`.

---

## 6. Defects found and fixed this phase

### def_0041 — every global installation was dead on arrival (high)

Two denylist rules written to keep user data out of the package also matched
source directories of the same name. `screenshots?` matched `src/screenshot/`;
`defects` matched `src/defects/`. Five source modules were vetoed out, and a
second occurrence — the `src` rule matching only `.mjs` — dropped
`src/extract/extract.js` and `probe.js`.

`bin/bigaap.mjs` imports `src/defects/store.mjs` at module scope, so **the
installed plugin failed at import resolution before any command ran**, while the
install reported 227 files written, 0 failed, `complete: true`.

Nothing in the system could notice: verification hashes the files the manifest
names, and they were all present and correct. **The manifest was consistent with
itself and wrong about the world.**

Fixed by anchoring the rules at the path root, recording every allowlist/denylist
disagreement as a visible `vetoed` entry, and adding a completeness check that
walks the **source tree** rather than the manifest.

### def_0042 — one bad correction record made a workspace permanently unusable (high)

`applyCorrections` read `correction.corrected.status` with no guard, while
`record.mjs` guarded the identical access. A record with a flat shape — what a
person writes by hand — threw `TypeError: Cannot read properties of undefined`.

Compounded three ways: `bigaap correct --file` wrote the record **before**
anything validated it, against a schema that existed and was never called; the
crash named no file; and every later analysis repeated it, so the workspace
stayed broken with no way to learn which record to delete.

Fixed at both boundaries — validated on the way in, tolerated on the way out.
A malformed record is now named with its file, the readable ones still apply,
and the analysis completes.

### def_0040 — project data written into a user's repository, unmentioned (medium)

`bigaap init` creates `.bigaap-analyzer/` — holding the target brief, the user's
own product requirements — and never mentioned version control. Later commands
add `.fidelity-run/`, which holds screenshots of the reference page.

Fixed by **reporting, not acting**: init now names the paths it created and which
of them hold user content. It deliberately does **not** write to the user's
`.gitignore` — modifying a file the tool does not own, in a project it was
merely pointed at, is the class of action this codebase refuses everywhere else.

### And one in a test

Phase 5.9's test 23 used `(^|\/)screenshots?\/` — the same unanchored pattern as
the defect it was supposed to catch. It passed while the package was broken.
Now anchored the same way the real rules are.

---

## 7. Test results

| Suite | Result |
| --- | --- |
| Unit | **908 tests · 907 pass · 0 fail · 1 skipped** |
| CLI smoke | **96/96** |
| Live smoke (isolated, under its lock) | **12/12** |
| Audit invariants | **21/21** |
| Generated-document currency | **13/13** |
| Package manifest verification | complete; 118/118 source modules |
| Clean-room workflow | **28/28 steps** |
| Release audit | **31 checks, 0 findings** |

The skipped test needs POSIX file permissions and does not run on Windows. It is
skipped, not passing, and is reported as skipped.

The live smoke suite ran under its exclusive lock with no other instance in
flight.

---

## 8. Open limitations — reviewed, all preserved

None was closed by rewording, and none by moving a threshold.

| | Status |
| --- | --- |
| def_0020 — over-specific selector fallback | **open** |
| def_0022 — `y` not counted as a vowel | **open** |
| def_0030 — cross-build component matching | **permanent-limitation**, recall 0.5 vs bar 0.6, both still recorded |
| Six tolerances not fully validated | preserved; register still reports `$validated=false` |
| Authenticated capture | unavailable |
| Claude Code plugin loading | **verified** 2026-08-14 against Claude Code 2.1.179; two manifest defects found and fixed |
| Automatic component-level correction | unavailable |
| Cross-implementation component matching | unsupported |
| Utility-heavy selector limitations | preserved |
| Screenshot-only precision | preserved |
| Capture-level per-operation timing | deferred, still deferred |

Defect register: **42 total — 39 fixed, 2 open, 1 permanent limitation.** Every
fixed defect carries a passing regression test except def_0007, which carries a
stated reason (it needs network access to a CSP-strict third party).

---

## 9. Claude Code plugin loading — verified 2026-08-14

Performed against the real loader. No simulation, no stub.

| | |
| --- | --- |
| Claude Code version | **2.1.179** |
| Bigaap / plugin version | **0.1.0** |
| Installation method | `claude plugin marketplace add ./ --scope project`, then `claude plugin install bigaap-ui-forensics@bigaap --scope project` |
| Marketplace discovery | **success** — `bigaap`, source `Directory` |
| Plugin discovery | **success** — `bigaap-ui-forensics@bigaap`, scope project, enabled |
| Command discovery | **success** — `analyze-reference`, `correct-analysis`, `validate-analysis` |
| Agent discovery | **success** — `ui-forensics-capture` |
| Skill discovery | **success** — `ui-forensics` |
| Always-on token cost | ~282 |
| Install path | `~/.claude/plugins/cache/bigaap/bigaap-ui-forensics/0.1.0` |
| Project path | the repository root |
| Files created by the loader | 1121 (47.1 MB) |
| Browser launched | **none, at any point** |

### It did not work at first

The manifest had never been run against the real loader. It was rejected with
exit 1 and two errors: `author` was a string where an object is required, and
`agents` was a directory string. **The plugin could not have loaded at any point
in Phase 5.9 or 5.10** — and both phases correctly labelled it `unverified`
while the loader sat on PATH the whole time.

`unverified` must mean *could not be checked*, never *was not checked*. That is
the substance of [def_0043](../defects/def_0043.json).

### A trap the validator does not catch

With `agents` as an **array of file paths**, validation passes and
`claude plugin details` reports `Agents (0)`. Discovery is silently suppressed.
Removing the key entirely — convention discovery from `./agents/` — gives
`Agents (1)`.

Established by testing five manifest variants against the real loader in a
scratch marketplace. `bigaap doctor` now checks all of it, and a regression test
asserts it.

### The installation mechanism is not what earlier phases assumed

A Claude Code plugin is installed **from a marketplace**. `bigaap install --mode
global`, built in Phase 5.9, copies the package into
`~/.claude/plugins/bigaap-ui-forensics/` — which is not where the loader looks
and does not produce a loadable plugin. It remains useful as a plain CLI
installation; it is not a plugin installation.

The real installer copies the entire source directory and consults neither this
repository's 238-file package manifest nor its `.gitignore`
([def_0044](../defects/def_0044.json)). Installing from a working checkout
carried 120 files of analysis workspaces into the plugin cache. **Install from a
clean copy.**

### A real workflow, from the loader-installed copy

Driven from the loader's own cache directory, in a fresh temporary project
holding unrelated user files:

| Step | Status | Exit |
| --- | --- | --- |
| `version` | completed | 0 |
| `doctor` | completed | 0 |
| `init --non-interactive` | completed-with-warnings | 0 |
| `blockers --for analyze` | completed | 0 |
| `readiness` | completed-with-warnings | 0 |
| `analyze --for analyze` | completed-with-warnings | 0 |

- **Artifacts:** 8 from `analyze`, IR hash `afbddb7060a21d61`
- **Files created:** 7 under `.bigaap-analyzer/`, 13 under `ws/`
- **Files preserved:** the target-brief template, written once
- **Unrelated user files changed:** **none** — `README.md`, `src/app.js`, `package.json` all byte-identical
- **Browser launched:** **no**
- **Warnings:** the target-brief template is deliberately not schema-valid; the project-data notice from def_0040
- **Limitations hit:** none beyond those already recorded

### What remains unverified

Interactive behaviour **inside** a Claude Code session — that invoking
`/analyze-reference` renders as intended in conversation. Component *discovery*
is verified; component *invocation in a live session* was not driven here.

## 10. Corrections after Phase 5.10

This document is a dated snapshot. Where later work proved one of its decisions
rested on a false basis, the row above is corrected and the original is kept
here verbatim, because a readiness record that quietly rewrites itself is worth
less than one that shows where it was wrong.

### Conditional recreation — basis corrected 2026-08-16

**The original row read:**

> | Conditional recreation | **ready-with-warnings** | Correctly **blocked** without responsive and state evidence — the block is the feature |

**Why it was wrong.** The block was not a feature. `def_0046` established that
`recreate` refused **every capture in this repository**, so the product's main
output — the builder prompt — could not be reached through the CLI at all. The
`states` requirement was declared advisory in `requirements.mjs` and was being
escalated to blocking on every run, because the tool-default `["default"]` — the
*resting* state, a request for nothing — was counted as a request for state
recreation. Phase 5.10 recorded the symptom and reasoned backwards to a purpose
for it.

**The corrected behaviour**, in effect since Phase 5.15 and the basis for the
decision as it now stands:

- A rebuild prompt is emitted whenever the safety gates allow one.
- Missing interactive states are **advisory**: a CLI warning, and an explicit
  limitation in prompt sections 8, 14, 15 and 16.
- `--states hover,focus` — any non-resting state — makes their absence
  **blocking**, so an explicit request is refused rather than guessed at.
- Component anatomy, contested criticals, invalid artifacts and screenshot-only
  input still refuse. `stripe.com/pricing` remains blocked on component anatomy,
  and that refusal is correct.

**What this says about the readiness process.** A decision was recorded as
verified when the capability behind it had never been exercised end to end.
Every prompt test called the renderer or the projection directly, and CLI smoke
exercised `recreate` only in its refusing paths, so nothing anywhere asserted
that the main output could be produced. That assertion now exists
(`tests/phase515-prompt-reachability.test.mjs`, R7 and R8: run the real binary,
look on disk).

## Related

- [PRIVATE-RELEASE-BOUNDARY.md](PRIVATE-RELEASE-BOUNDARY.md)
- [PRIVATE-RELEASE-CHECKLIST.md](PRIVATE-RELEASE-CHECKLIST.md)
- [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md)
- [REPOSITORY-CLEANUP.md](REPOSITORY-CLEANUP.md)

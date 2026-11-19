# Phase 4 — results

Phase 4 built the fidelity loop: capture a reference and a target, compare them
across twelve categories, four viewports, nine interaction states and two
content modes, and emit correction tasks for a person to apply. It ends with the
whole of that reachable from a CLI whose every command says what happened in a
typed contract.

What follows is the record. The readiness decisions are in
[PHASE-4-READINESS.md](PHASE-4-READINESS.md) and the limitations in
[PHASE-4-LIMITATIONS.md](PHASE-4-LIMITATIONS.md); this document does not
summarise them, because a summary of a limitation is how one gets lost.

## Counts

| | |
| --- | --- |
| Unit tests | **572 passing, 0 failing** — `node --test tests/`, no browser required |
| Live smoke checks | **12 of 12 passing** — `node tools/live-smoke.mjs`, real Chromium |
| CLI smoke checks | **50 of 50 passing** — `node tools/cli-smoke.mjs`, real Chromium, CLI as a child process |
| Audit invariants | **16 of 16 passing** — `node tools/phase4-audit.mjs`, static, no browser |
| Test files | 26 |
| Source modules | 70 under `src/` |
| Tools | 47 under `tools/` |
| Schemas | 15 |
| Fixture artifacts | 388 JSON and PNG files under `fixtures/` |
| Defect records | 35 under `defects/` |
| Documents | 35 under `docs/` |

The three suites are separate on purpose. The unit suite must pass with no
browser and no server, so it can never report green by skipping. The live and
CLI smoke suites need both, and are run explicitly.

## What was built

**4.1 — the vertical slice.** One reference, two targets, two viewports, both
content modes, one hover state, one manual correction, one regression, one
interruption, one blocked comparison. Report-first and manual-first throughout.

**4.2 — four viewports.** 1440, 1024, 768, 375, each run independently. A
responsive change is compared against the reference's own progression across ten
dimensions, so an intended transformation is not reported as a defect. One
blocked viewport does not cancel the others.

**4.3 — interaction states.** Nine states, six statuses. A state that cannot be
induced is `unavailable` with its reason recorded — never a mismatch. State
comparison is a delta from rest and excludes viewport-relative geometry, because
inducing a state scrolls its element and the coordinate then measures the scroll
(def_0031).

**4.4 — intrinsic visual checks.** Thirteen single-render checks plus five
non-defect context records, with four correlation outcomes. A finding the
reference shares is demoted rather than reported. This is the channel that
carries the visual load when the two sides render different copy.

**4.5 — threshold calibration.** Twenty-four independent fixtures, a calibration
matrix, and an honest ceiling: `TOLERANCES.$validated` is `false` and stays
false. No threshold was tuned to make a test pass.

**4.6 — the browser driver.** Thirty-one operations behind one normalised
envelope, sixteen typed errors, twenty recovery policies, six run statuses, ten
staleness checks, and a configurable tap-target policy. The phase ended by
recording that none of it yet governed anything that captured.

**4.7 — capture-tool migration.** Eleven tools moved onto one shared capture
session. Nothing under `src/`, `tools/` or `bin/` imports Playwright by any form
or calls `chromium.launch`. Migration changed how captures execute and what they
record about themselves; it did not change what they observe — the full
extraction, all eleven state records and both fixture PNGs reproduce
byte-identically against their pre-migration goldens.

**4.8 — CLI integration and audit.** Thirteen fidelity commands, one typed
result contract, six statuses with distinct exit codes, and sixteen audited
invariants.

## The CLI

Thirteen commands, each returning the same contract and exiting on its own code.

| Command | Does |
| --- | --- |
| `session` | starts a capture session and pins the versions it will use |
| `reference` | captures and analyses the reference, then locks its IR for the run |
| `capture` | captures the target at every declared viewport |
| `capture-viewport` | captures the target at one viewport |
| `capture-state` | induces and reads one interaction state |
| `intrinsic` | runs the thirteen intrinsic checks on one side |
| `compare` | runs a fidelity comparison and writes an iteration |
| `history` | lists iterations and re-verifies their hashes |
| `recovery` | reads the attempt history across every capture in the run |
| `freshness` | runs the ten staleness checks over a capture pair |
| `tasks` | emits the correction tasks from an iteration |
| `verify` | validates every artifact against its hash and provenance |
| `readiness` | prints the fifteen readiness decisions |

### The result contract

Every command returns: `resultVersion`, `operation`, `status`, `reference`,
`target`, `viewport`, `state`, `mode`, `artifacts`, `hashes`, `warnings`,
`blockers`, `errors`, `recoveryHistory`, `readiness`, `readinessReason`,
`summary`, `detail`, `exitCode`, `producedAt`. Present on every result, whatever
the status — an absent field and a null field read differently, and a consumer
should not have to guess which it is looking at.

Six statuses, and **blocked is not failed**:

| Status | Exit | Means |
| --- | --- | --- |
| `completed` | 0 | the work was done |
| `completed-with-warnings` | 0 | done, with something recorded beside it |
| `failed` | 1 | the work broke |
| `blocked` | 3 | a gate refused it; the evidence is intact and the reason is recorded |
| `cancelled` | 4 | stopped deliberately |
| `not-attempted` | 5 | there was nothing to do |

The separation is enforced at construction: a `blocked` result with no blocker
throws, a `failed` with no error throws, and a `completed` carrying either
throws. A CI job that retries on 1 must not retry a run a safety gate refused —
the retry would be refused identically and the reason would scroll past twice.

`not-attempted` exists so a command never emits a success result over work it
skipped.

## The audit

Sixteen invariants, each read from the code or the artifacts rather than
asserted in prose — see [phase4-audit.md](phase4-audit.md). All sixteen pass.
Among them: no browser launch outside the adapter (117 sources checked); every
capture path through the shared session; every output hashed from the bytes
written; stale outputs refused; blocked runs emitting no categories and no
prompts; partial viewport results represented as partial; unavailable states
staying unknown; independent-content suppressing comparative residue; **no
composite score in 117 sources or any of 379 artifacts**; no tolerance marked
validated; the tap-target policy explicit and configurable; the three open
defects still open; and no unsupported readiness claim in any of 35 documents,
checked sentence by sentence.

## Defects

**35 filed · 32 fixed · 3 open.** Every fix carries a regression test, with one
recorded exception below.

Filed and fixed during Phase 4:

| ID | Severity | What it was |
| --- | --- | --- |
| `def_0031` | high | State comparison used absolute geometry, so a layout difference made an unchanged hover report a mismatch — one defect counted under two categories. |
| `def_0032` | high | The capture session froze animation for every caller; the freeze zeroes `transition-*` in computed style, which is exactly what the token extraction reads. Two independent witnesses. |
| `def_0033` | critical | Re-applying init scripts after a context recreation ran under a policy that itself asks for a recreation. Unbounded, with no I/O to time out: it allocated until the process aborted. |
| `def_0034` | medium | Cleanup cleared its page map and nulled its browser handle whether or not the closes threw, so the retry found nothing to do and reported success. A browser still running was recorded as released, every time. |
| `def_0035` | high | Every operation turned a *throw* into a typed error under a policy; nothing turned *took forever* into one, and the envelope has no representation for "never returned". An operation that hung stopped the run outright — no attempt recorded, no contract emitted, the process killed from outside. Found by the CLI smoke suite stalling three times at the same scenario. |

Still open, deliberately:

| ID | Severity | Why it stays open |
| --- | --- | --- |
| `def_0020` | medium | The structural selector fallback stops after six ancestors. One witness in 83 selectors across six pages; Phase 3.2 produced no second witness, and promotion requires two. |
| `def_0022` | low | The vowel-ratio test ignores `y`, so `system` classifies as a build hash. One real witness in 800 names on one target; the fix would touch how every class name on every site is classified. |
| `def_0030` | high | Component matching across independent implementations is precise (1.000) and incomplete (recall 0.444). Not fixable by threshold tuning, which the phase brief forbids. It blocks automatic component-level correction. |

The record for `def_0035` carries its own correction: it was first filed against
`chromium.launch()` on the evidence that no `chrome` process was alive.
Playwright's Chromium runs as `chrome-headless-shell`, and looking for the right
name showed the browser alive throughout — the hang was in closing a page whose
renderer was still stuck in a pending navigation. The observation that nothing
was bounded stood and is what the defect is about; the attribution to one
operation did not, and the fix went to all of them instead.

`def_0007` is marked fixed with no regression test, and is reported as such by
`bigaap defects`. It recorded that third-party capture through the MCP browser is
impossible under a strict CSP; the fix was to capture through a driver instead,
and there is no test that can assert the absence of a transport.

## Unobserved browser failures

**Thirteen of the sixteen typed driver failures have never occurred against a
real browser.** They are reachable through the migrated tools and tested against
a stub launcher; they are not field-observed.

16 categories, minus 2 observed, minus 1 unreachable by design, is 13. This
report said twelve until Phase 4.9 enumerated them (`def_0036`).

Observed live: `network-failure` (unreachable target, live smoke and CLI smoke),
`selector-not-found` (an un-inducible state, every state run).

Unobserved: `startup-failed`, `browser-unavailable`, `navigation-timeout`,
`page-error`, `script-injection-failed`, `screenshot-failed`,
`state-trigger-failed`, `font-timeout`, `asset-timeout`, `viewport-invalid`,
`content-not-ready`, `cleanup-failed`, `unknown-driver-error`.
`authentication-required` is unreachable by design.

A policy exercised in a test is not a policy that has been seen in the field.

## Tolerance status

`TOLERANCES.$validated` is **`false`**, and the audit fails if it becomes true
without evidence. The calibration phase ran twenty-four independent fixtures and
stopped short of `validated` rather than declaring it — the honest ceiling given
the evidence available. Every comparison result carries
`thresholdsValidated: false` on its contract, so a downstream reader cannot
mistake a score for a verdict.

## Selector limitations

Emitted selectors are usable and are not claimed to be stable everywhere:

- A utility class is never recommended as deploy-stable. The classifier reached
  precision 1.000 on hashed names after def_0012 and def_0021.
- The structural fallback can leave a selector unanchored (`def_0020`, open).
- One English word in 800 classifies as a build hash (`def_0022`, open).
- Structural-selector overmatching remains an open question, recorded rather
  than resolved.

## Component-matching limitations

Component matching across two independent implementations is **precise and
incomplete**: precision 1.000, recall 0.444 (`def_0030`, open). The consequence
is enforced, not merely noted — component-level fidelity comparison falls back
to category level, and automatic component correction is blocked.

## Authenticated capture

**Not supported, and not planned.** No command accepts credentials. No tool
bypasses a consent gate, a CAPTCHA or a bot check. An authenticated page must be
opened by the person who owns the account. The session record carries
`authenticatedCapture: false` so an artifact says so rather than being silent.

## Automatic correction

**Not supported.** The loop is report-first and manual-first by design. `tasks`
emits instructions for a person; nothing applies them, and the result contract
carries `automatic: false`. Component-level automatic correction is separately
blocked by `def_0030`.

## Production-readiness decision

**Not production-ready.**

This is not a formality and not a hedge. No threshold is validated. Thirteen of
sixteen typed driver failures have never occurred against a real browser. Three
defects are open, one of them high severity and blocking a whole capability. The
instrument measures carefully and reports what it measured; that is a different
thing from being ready to depend on in production, and the difference is the
point of saying so.

## Not claimed

Stated plainly, because each of these is a claim the evidence does not support:

- **Not** pixel-perfect fidelity.
- **Not** validated thresholds.
- **Not** general automatic correction.
- **Not** deploy-safe selectors everywhere.
- **Not** authenticated capture support.
- **Not** production readiness.
- **Not** a composite fidelity score — there is none, anywhere, by construction.
- **Not** defect-free operation. 34 defects are filed; 3 are open.

# Phase 4.9 — release-candidate hardening results

Phase 4.9 addressed the readiness blockers and nothing else. No features, no
packaging, no collaboration, no billing, no authenticated capture, and no
automatic component-level correction.

Five things changed, and one of them is a decision rather than a change.

---

## 1. The stale count, corrected

**Thirteen of sixteen typed driver failures were unobserved, not twelve.**
Filed as `def_0036` — a documentation defect, because no decision, gate or test
keyed off the figure; the harm was that a reader would trust a number the
repository did not support.

It appeared in **five** documents, not the three first identified:
`PHASE-4-RESULTS.md`, `PHASE-4-LIMITATIONS.md`, `PHASE-4-READINESS.md`,
`PHASE-3-PROGRESS.md` and `driver-integration-report.md`. All five corrected.

The class of error is now closed rather than the instance: a test derives the
count from `ALL_DRIVER_ERRORS` and fails if any document disagrees with it.

---

## 2. Driver failures — from 2 observed to 10

| | Before | After |
| --- | --- | --- |
| Observed against a real browser | 2 | **10** |
| Unreachable by design | 1 | 1 |
| Unobserved | 13 | **5** |

`fixtures/failure/observation-ledger.json` accounts for all sixteen, and every
observation wrote a real capture contract to `fixtures/failure/observed/`. A
probe that printed a result without producing a contract observed nothing.

### Newly observed (8)

| Category | How | Note |
| --- | --- | --- |
| `startup-failed` | a browser executable path that does not exist | the failure a first-time user is most likely to hit |
| `browser-unavailable` | the probe's own browser stopped, then a page requested | only the process this run owned was touched |
| `navigation-timeout` | a body that never finishes, **through the ordinary capture path** | |
| `content-not-ready` | DOM readiness with the navigation left in flight | driver level — see the ordering finding below |
| `font-timeout` | a `FontFace` whose source never responds, added after load | driver level |
| `asset-timeout` | an image that never completes, appended after load | driver level |
| `script-injection-failed` | an init script path that does not exist | also confirmed `def_0033`'s bounded repair refusal live |
| `state-trigger-failed` | an element covered by a full-viewport overlay | the selector **matched**, which is the whole point |

`state-trigger-failed` was the highest-value observation. It is the other side
of `selector-not-found`, and the distinction between "the selector matched
nothing" and "it matched something un-hoverable" is what the six state statuses
rest on. Only one side had ever been seen.

### An ordering finding, worth more than the observations

**Three categories are nearly unreachable through the ordinary capture path.**
`prepare()` navigates first, and `navigate` waits for network idle. A
subresource that hangs during load therefore makes the *navigation* time out,
and the run is reported as `navigation-timeout` before the font, asset or DOM
wait is ever consulted.

Both `font-timeout` and `asset-timeout` were attempted through
`withCaptureSession` first, and both produced a blocked navigation instead. They
are recorded as **`live-observed-driver-level`** rather than plain
`live-observed`, because what was confirmed is the typed error and its policy —
not that the sequence arises in ordinary capture. The ordering says it mostly
does not.

That is a more useful result than three more ticks in a column. In real use, a
slow font and a wedged origin both surface as `navigation-timeout`: correct, and
coarser than the sixteen categories imply.

### Still unobserved (5), each with a reason

| Category | Classification | Why |
| --- | --- | --- |
| `page-error` | `deterministic-contract-tested` | One guarded attempt at `chrome://crash`; the headless shell returned `network-failure` instead. **Not chased.** Memory exhaustion was ruled out — it endangers the host and produces an unreproducible result. |
| `screenshot-failed` | `deterministic-contract-tested` | The realistic causes are memory pressure and enormous captures, neither safe to force. A closed-page screenshot would be a synthetic condition dressed as a live one. |
| `viewport-invalid` | `deterministic-contract-tested` | A pre-flight guard. There is no browser behaviour to observe, and recording it as "observed live" would be technically true and substantively misleading. |
| `cleanup-failed` | `live-observation-not-practical` | Observed three times in Phase 4.8 as an unbounded **hang**, before `def_0035` gave the operation a bound. The condition is real and has happened; it has never been seen as a typed error, because the fix that would report it also removed the cause. Reproducing it now means re-introducing the wedge. |
| `unknown-driver-error` | `requires-future-production-telemetry` | By construction, a failure nobody anticipated. Manufacturing an unmatched message proves the fallback, not the purpose. |

`authentication-required` remains **unreachable by design** and is not counted
among the unobserved. It is a scope decision, not an evidence gap, and the audit
fails if it is ever folded into that count.

**None of these is production-validated.** Every observation happened once, on
one machine, against a local fixture. That is worth more than a stub and much
less than field evidence, and the ledger says so in its own header.

---

## 3. Tolerances — per-entry status, global flag unchanged

**`TOLERANCES.$validated` is still `false`, and no tolerance value changed.**

The single flag could only ever say "all seventeen" or "none", and the entries
have diverged. `src/fidelity/tolerance-status.mjs` now carries a status per
entry; the flag is **derived** from them rather than asserted beside them, so a
flag set by hand can no longer outlive its evidence. Backward compatibility is
exact: `$validated` is `true` only when every entry is `validated`.

| Status | Count | Entries |
| --- | --- | --- |
| `validated` | **2** | `severityFor`, `admissibility` |
| `provisionally-supported` | 6 | `TOLERANCES.px`, `fontSizePx`, `pixelDiff.channelTolerance`, `intrinsic.intentMarkers`, `intrinsic.contentComparable`, `state.propertyComparison` |
| `blocked-on-definition` | **1** | `TOLERANCES.colorDistance` |
| `blocked-by-source-limit` | 8 | the single-case entries, unchanged |

### The two that reached `validated`

`severityFor` and `admissibility` are **policies over a finite space**, not
measured thresholds — so they were **exhaustively enumerated**, not sampled:

- `severityFor`: all **300** cells (5 reference statuses × 5 target × 3
  magnitude bands × degraded × kind), each expectation declared before the
  function was called.
- `admissibility`: all **144** cells (the full status matrix on both sides
  including absent, × the degraded opt-in, × contested).

Spec-derived evidence is correct for these two and would not be for a numeric
tolerance. There is no physical quantity for rendering-derived evidence to
measure in a policy about evidence quality.

**Two validated entries did not flip the flag**, and a test asserts they cannot.
That is the whole reason the per-entry status exists.

### `colorDistance` — blocked on a definition

Not validated, and deliberately not attempted. **The axis is undefined**: 12 in
Euclidean RGB, 12 in CIE ΔE2000 and 12 in per-channel maximum are three
different tolerances, and the code does not say which is meant. A distance
without a metric is not a quantity.

Validating it now would produce a number settled on an unknown scale — worse
than an unvalidated one, because it would look decided. Candidate `cand_01`
stays open. The value remains `12`, untouched.

### `state.propertyComparison` cannot exceed its inputs

It composes `TOLERANCES.px` and `TOLERANCES.colorDistance`. One of those is
blocked on a definition, so this rule cannot be validated however many state
fixtures are added. The rule is supported; the numbers are not this entry's to
validate.

---

## 4. The three open defects — decided on evidence

### `def_0030` → **permanent limitation**

The second independent implementation pair was built and run.
`fixtures/fidelity-target-b/` is the harder case the first record predicted:
the painted surface re-nested two levels deep, children emitted in a different
source order with visual order restored via flex `order`, a different heading
level inside a `header`, body copy as a `div` rather than a `p`, the navigation
list removed entirely, and one reference component with no counterpart at all.

| | First pair | Second pair | Bar |
| --- | --- | --- | --- |
| Precision | 1.000 | 1.000 | ≥ zero wrong |
| Recall | 0.444 | **0.500** | ≥ 0.600 |
| Verdict | fails | **fails** | not moved |

**The bar was not moved and no threshold in `src/deploy/match.mjs` was changed.**

One pair required an **ambiguity allowance**, and the report says so rather than
counting a debatable hit as clean: the re-nesting split the reference's single
footer role across `.tile__base` and `.tile__tags`, and the matcher chose the
other one. Scoring that as *wrong* would have manufactured a precision failure
out of a debatable answer key — the same error as tuning a threshold to a
fixture, pointed the other way.

Two independent pairs, both failing a bar that was not moved. Precision holds;
what fails is completeness, and half the components is not a capability.
**Component-level cross-implementation matching is permanently unsupported.
Category-level comparison is the ceiling.**

Two approaches named in the plan were **not evaluated** — dropping the parent
tag from `parentChildShape`, and matching on internal-shape sequence. Neither is
ruled out. A permanent limitation is a statement about the capability as it
stands, not a proof that the problem is unsolvable.

Containment is unchanged and load-bearing: component-level comparison falls back
to category level, automatic component correction is blocked, and automatic
global-value correction stays `not-usable`. An audit invariant fails if any of
that relaxes.

### `def_0020` → **remains open**

Re-examined rather than assumed. Every committed live selector audit was
scanned: **six distinct targets, twelve audit files, and only tailwindcss.com
carries a dead emitted selector** — the original witness. No second independent
witness.

**A methodology correction was needed first.** The scan initially counted *audit
files* and reported a second witness, because `tailwind.selectors.json` and
`tailwind-post.selectors.json` are the same site before and after a fix.
Counting them separately would have closed the defect on a duplicate. It now
counts distinct hosts.

The `anchored: false` containment marker offered by the plan was **deliberately
not implemented**. Adding a field to the extractor's output changes every
capture it produces, requiring an `EXTRACTOR_VERSION` bump that makes every
committed golden `incompatible` and forces a full recapture. That is an
extractor change, not release-candidate hardening, and it would trade away the
byte-identical reproduction Phase 4.7 established for a marker nothing yet reads.

### `def_0022` → **remains open**

1840 distinct class names across 74 committed captures scanned. The only hits
are `styles`, and only in the synthetic build fixtures — the constructed
`styles-dark` case already recorded, found again in the generator that produced
it. **No independent real-world witness.**

**A second methodology correction.** The scan first accepted any run of four or
more lowercase letters as word-shaped, which matched `ypwjdc` — a generated
hash, correctly classified. It would have recorded a hash as a witness for a
defect about words being mistaken for hashes. The test now requires
English-looking consonant/vowel alternation, and synthetic captures are reported
separately because a generated build's names cannot be an independent witness.

**Neither defect was closed for non-recurrence.** Both were looked for and not
found, which is why they stay open.

### A new status, so nothing can vanish

`permanent-limitation` is neither open nor fixed. Before it was a first-class
status, a defect holding it would have been filtered out of both groups in the
rendered log and **disappeared** — the one outcome a defect register exists to
prevent. The log now has three sections and an audit invariant asserts every
defect appears in it, whatever its status.

**36 defects · 2 open · 33 fixed · 1 permanent limitation.**

---

## 5. Counts

| | |
| --- | --- |
| Unit tests | **588 passing, 0 failing** — `node --test tests/`, no browser required |
| Live smoke | **12 of 12 passing** |
| CLI smoke | **50 of 50 passing** |
| Audit invariants | **21 of 21** — five new in Phase 4.9 |
| Driver categories observed | 10 of 16 (+1 unreachable by design, 5 classified) |
| Tolerance entries validated | 2 of 17 · global flag `false` |
| Defects | 36 filed · 2 open · 33 fixed · 1 permanent limitation |

### New audit invariants

17. every typed driver failure is classified in the observation ledger, and its counts add to sixteen
18. `authentication-required` is recorded as unreachable by design, never as an unobserved failure
19. tolerance status is per entry, and the global flag is derived from it
20. `def_0030` is a permanent limitation on two witnesses, containment intact, bar unmoved
21. every defect appears in the rendered log, whatever its status

Two pre-existing invariants also caught real problems during this phase:
invariant 1 caught the failure probe importing Playwright directly to build a
bogus launcher — fixed by having the adapter forward launch options, so a caller
never needs the vendor package. Invariant 13 was rewritten to distinguish "still
open" from "decided", rather than asserting all three defects stay open.

---

## 6. Final verification

| Suite | Result |
| --- | --- |
| Unit (`node --test tests/`) | **588 passing, 0 failing** — 16 new, none needing a browser |
| Live smoke (`node tools/live-smoke.mjs`) | **12 of 12** |
| CLI smoke (`node tools/cli-smoke.mjs`) | **50 of 50** |
| Audit (`node tools/phase4-audit.mjs`) | **21 of 21** |

Reproduce the phase's own evidence with:

- `node tools/driver-failure-probe.mjs` — the observation ledger
- `node tools/def0030-second-witness.mjs` — the second implementation pair
- `node tools/open-defect-scan.mjs` — the second-witness scan for def_0020 and def_0022

## What did not change

- **No tolerance value.** Every value Phase 4.5 recorded is unchanged, and a
  test pins them.
- **`TOLERANCES.$validated` is still `false`.**
- **No defect closed.** Two stay open; one became a permanent limitation on
  evidence.
- **No threshold in the matcher**, and the recall bar was not lowered.
- **Authenticated capture** is not implemented and will not be.
- **Automatic component-level correction** stays blocked — now permanently
  rather than pending.

## Not claimed

- **Not** production-ready.
- **Not** validated thresholds — two entries of seventeen, and the flag says `false`.
- **Not** production-validated driver failures — ten observed once against local fixtures.
- **Not** pixel-perfect fidelity.
- **Not** general automatic correction.
- **Not** deploy-safe selectors everywhere.
- **Not** authenticated capture support.
- **Not** a composite fidelity score.
- **Not** defect-free operation.

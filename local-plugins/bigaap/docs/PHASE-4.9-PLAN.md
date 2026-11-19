# Phase 4.9 — release-candidate hardening plan

**This is a plan. Nothing in it is implemented.** No production code changes, no
defect closes, no threshold changes, and `TOLERANCES.$validated` stays `false`
throughout.

Phase 4.9 is not feature development. It addresses exactly the things standing
between the current state and a limited private release, and nothing else:
thirteen driver failures never seen against a real browser, six unvalidated
tolerances, three open defects, an undefined release boundary, no observability,
and no written regression policy.

---

## A correction that must be made first

**The count of unobserved driver failures is thirteen, not twelve.**

`PHASE-4-RESULTS.md`, `PHASE-4-LIMITATIONS.md` and `PHASE-4-READINESS.md` all
say twelve, and that number was repeated in the Phase 4 acceptance. It is an
undercount, and it came from me: I wrote the figure before enumerating the
categories against the code, and then reused it.

Enumerated against `ALL_DRIVER_ERRORS` (16 categories):

| | Count | Categories |
| --- | --- | --- |
| Observed against a real browser | 2 | `network-failure`, `selector-not-found` |
| Unreachable by design | 1 | `authentication-required` |
| **Not observed** | **13** | everything else |

16 − 2 − 1 = 13. The three Phase 4 documents need a one-word correction. This
plan does not make it, because this task is scoped to writing the plan; the
correction is listed as task **4.9.1-a** below and should be the first thing
done.

Nothing else in the Phase 4 results depends on the figure — no decision, gate or
test keys off it. It is a reporting error, not a behavioural one.

---

## 4.9.1 — The thirteen unobserved driver failures

### Purpose

To find out which of these can be observed honestly, observe those, and stop.
The count of observed failures is not a goal. A failure forced into existence by
destabilising the host machine teaches nothing about the recovery policy and
costs more than it returns.

### Rules

- **Do not force unsafe or unreliable browser failures merely to increase the
  observed count.** A category that cannot be reached safely is classified, not
  chased.
- **A failure that is reached live is not thereby "production-validated".** It
  was observed once, on one machine, against a fixture. That is worth more than
  a stub and much less than field evidence, and the wording must say so.
- Every live reproduction runs against a **local fixture**. No third-party site
  is used to provoke a failure.

### Classification vocabulary

| Label | Means |
| --- | --- |
| `live-reproducible` | Can be reached safely and deterministically against a local fixture. To be observed in 4.9. |
| `deterministic-contract-tested` | The contract and policy are proven against a stub; a live observation is either unsafe or adds nothing the stub does not already establish. |
| `live-observation-not-practical` | Reachable in principle, but only by means that risk the host, the run, or reproducibility. |
| `requires-future-production-telemetry` | Cannot be scheduled at all. Only real usage will produce it. |

Nothing is ever labelled `production-validated`.

### Task 4.9.1-a — Correct the count

Change twelve to thirteen in `PHASE-4-RESULTS.md`, `PHASE-4-LIMITATIONS.md` and
`PHASE-4-READINESS.md`, and list the categories explicitly in the limitations
document rather than as a bare number. No code change.

### Task 4.9.1-b — Check whether `cleanup-failed` is already observed

CLI smoke scenario 12 holds a page in a pending navigation to a black-holed port
and then closes it. Before `def_0035` that hung; with the bound in place, the
cleanup may now be timing out and producing a real `cleanup-failed` on every
run — in which case it is **already live-observed** and the count is twelve
after all, for a different reason than the one first written.

This is a read of an existing artifact, not an experiment: run the CLI smoke
suite with `--keep` and inspect the `failed-target` run's capture contracts for
a `cleanup-failed` attempt. Do this before building any new fixture.

### The thirteen

Shared across every row: **required evidence** is a written capture contract
containing the attempt history, the typed error code, the recovery attempts the
policy specifies, and the run status — the same contract any other capture
emits. A live observation that does not produce a contract is not evidence.

---

#### 1. `startup-failed`

| | |
| --- | --- |
| **Safe to reproduce live** | Yes |
| **Required condition** | A driver pointed at a browser executable that does not exist (`executablePath` to a bogus path, or `PLAYWRIGHT_BROWSERS_PATH` scoped to an empty directory for the child process only) |
| **Expected browser behaviour** | The launch fails immediately with a missing-executable error; no browser process starts |
| **Expected driver error** | `startup-failed` |
| **Recovery policy** | retry ×2, new context required, viewport blocked, **other viewports may not continue** — nothing runs without a browser |
| **Live observation necessary** | **Yes.** This is the failure a first-time user is most likely to hit, and the real message text is what `classifyPlaywrightError` matches on. A stub asserts the policy; only the real launcher proves the classifier recognises the real message |
| **Deterministic injection sufficient** | For the policy, yes. For the classifier, no |
| **Risk** | Low. Environment scoped to a child process; no global state touched |
| **Classification** | `live-reproducible` |

#### 2. `browser-unavailable`

| | |
| --- | --- |
| **Safe to reproduce live** | Yes |
| **Required condition** | Kill the browser process externally mid-run, then request a page — or call `stop()` and then `openPage()` |
| **Expected browser behaviour** | The connection is gone; the next operation finds no browser |
| **Expected driver error** | `browser-unavailable` |
| **Recovery policy** | retry ×1, new context required, viewport not blocked, other viewports may continue |
| **Live observation necessary** | Useful but not essential. The external-kill variant is the realistic one and is worth doing once |
| **Deterministic injection sufficient** | Yes for the policy |
| **Risk** | Low, provided the kill targets a process this run started. Must not kill browsers by name globally — that would take out an unrelated one |
| **Classification** | `live-reproducible` |

#### 3. `navigation-timeout`

| | |
| --- | --- |
| **Safe to reproduce live** | Yes |
| **Required condition** | A fixture route that accepts the connection, sends headers, and never completes the body — `GET /hang/never-finish` |
| **Expected browser behaviour** | `page.goto` waits until its own timeout expires |
| **Expected driver error** | `navigation-timeout` |
| **Recovery policy** | retry ×2, no new context, **viewport blocked**, other viewports may continue |
| **Live observation necessary** | Yes. It is cheap, deterministic, and distinguishes a timeout from `network-failure`, which is the pair most easily confused |
| **Deterministic injection sufficient** | For the policy, yes. For the classifier's ability to tell the two apart on real messages, no |
| **Risk** | Low. One held connection on a local server, released when the test ends |
| **Classification** | `live-reproducible` |

#### 4. `page-error` (renderer crash)

| | |
| --- | --- |
| **Safe to reproduce live** | **Conditionally.** `chrome://crash` kills one renderer deliberately and is the supported mechanism. Memory exhaustion is not safe and must not be attempted |
| **Required condition** | Navigate to `chrome://crash` inside a guarded, single-attempt probe |
| **Expected browser behaviour** | The renderer for that page dies; the browser process survives |
| **Expected driver error** | `page-error` |
| **Recovery policy** | retry ×1, **new context required**, viewport not blocked, other viewports may continue |
| **Live observation necessary** | Desirable, because the crash policy is the only one that recreates a context, and re-injection after recreation (`def_0033`) has never been exercised against a real crash |
| **Deterministic injection sufficient** | Yes for the policy and for re-injection; the stub already proves both |
| **Risk** | **Moderate.** `chrome://crash` may be blocked in headless shell builds, may leave a zombie renderer, and its availability is not contractual. One attempt, behind a guard, with a hard timeout. **Do not** pursue OOM as a fallback — exhausting host memory endangers the machine and produces an unreproducible result |
| **Classification** | Attempt once as `live-reproducible`; on failure or unavailability, record as **`deterministic-contract-tested`** and stop. Do not escalate |

#### 5. `script-injection-failed`

| | |
| --- | --- |
| **Safe to reproduce live** | Yes |
| **Required condition** | An init script whose path does not exist, or whose content is syntactically invalid |
| **Expected browser behaviour** | The injection call rejects before the page loads |
| **Expected driver error** | `script-injection-failed` |
| **Recovery policy** | retry ×1, new context required, **viewport blocked**, other viewports may continue |
| **Live observation necessary** | Yes — and specifically to confirm that the repair refusal from `def_0033` behaves the same way against a real adapter as against the stub |
| **Deterministic injection sufficient** | Mostly. The `def_0033` bound is already proven by a stub |
| **Risk** | Low |
| **Classification** | `live-reproducible` |

#### 6. `screenshot-failed`

| | |
| --- | --- |
| **Safe to reproduce live** | Yes |
| **Required condition** | Close the page, then request a screenshot of it |
| **Expected browser behaviour** | The screenshot call rejects against a closed target |
| **Expected driver error** | `screenshot-failed` |
| **Recovery policy** | retry ×2, no new context, viewport not blocked, other viewports may continue |
| **Live observation necessary** | Marginal. The closed-page route is a synthetic condition dressed as a live one — a real screenshot failure is usually an out-of-memory or a huge full-page capture, neither of which is safe to force |
| **Deterministic injection sufficient** | Yes |
| **Risk** | Low for the closed-page route; unacceptable for the realistic routes |
| **Classification** | `deterministic-contract-tested`. Observe opportunistically if it happens, do not build a fixture for it |

#### 7. `state-trigger-failed`

| | |
| --- | --- |
| **Safe to reproduce live** | Yes |
| **Required condition** | A fixture element that exists and cannot be interacted with: covered by a full-viewport overlay, or `pointer-events: none`, or zero-sized |
| **Expected browser behaviour** | `hover` waits for actionability and times out; the element is found, so this is not `selector-not-found` |
| **Expected driver error** | `state-trigger-failed` |
| **Recovery policy** | retry ×1, no new context, viewport not blocked, other viewports may continue |
| **Live observation necessary** | **Yes.** The distinction between "the selector matched nothing" and "the selector matched something un-hoverable" is exactly the distinction the six state statuses exist to carry, and only one side of it has ever been seen live |
| **Deterministic injection sufficient** | No — the boundary between the two codes is the thing being tested, and a stub decides it by fiat |
| **Risk** | Low |
| **Classification** | `live-reproducible` — highest value of the thirteen |

#### 8. `font-timeout`

| | |
| --- | --- |
| **Safe to reproduce live** | Yes |
| **Required condition** | A fixture with an `@font-face` whose `src` points at the hanging route from row 3, so `document.fonts.ready` never settles |
| **Expected browser behaviour** | The font load never completes; the readiness wait expires |
| **Expected driver error** | `font-timeout` |
| **Recovery policy** | retry ×1, no new context, viewport not blocked, other viewports may continue |
| **Live observation necessary** | Yes. This is a **degradation** path, not an abort: the capture must still complete with `readiness.fontsReady: false`, and that whole-run behaviour has only ever been asserted against a stub |
| **Deterministic injection sufficient** | For the code, yes. For the degradation, no — the interesting claim is that the capture survives |
| **Risk** | Low |
| **Classification** | `live-reproducible` |

#### 9. `asset-timeout`

| | |
| --- | --- |
| **Safe to reproduce live** | Yes |
| **Required condition** | A fixture that keeps a request open indefinitely (long-poll or endless event stream), so network idle is never reached |
| **Expected browser behaviour** | `networkidle` never fires; the wait expires |
| **Expected driver error** | `asset-timeout` |
| **Recovery policy** | retry ×1, no new context, viewport not blocked, other viewports may continue |
| **Live observation necessary** | Yes, for the same degradation reason as row 8 |
| **Deterministic injection sufficient** | Partially |
| **Risk** | Low. The held connection must be closed by the fixture server on shutdown, or the suite will not exit |
| **Classification** | `live-reproducible` |

#### 10. `viewport-invalid`

| | |
| --- | --- |
| **Safe to reproduce live** | Yes, trivially |
| **Required condition** | `openPage({ viewport: 100 })` — below the adapter's 240px floor |
| **Expected browser behaviour** | **None.** The guard rejects before any browser call is made |
| **Expected driver error** | `viewport-invalid` |
| **Recovery policy** | not retryable, **viewport blocked**, other viewports may continue |
| **Live observation necessary** | **No.** There is no browser behaviour to observe. Running it against a real driver exercises the same guard the stub does, one line earlier |
| **Deterministic injection sufficient** | **Yes, completely** |
| **Risk** | None |
| **Classification** | `deterministic-contract-tested`. Recording it as "observed live" would be technically true and substantively misleading — nothing about the browser was involved |

#### 11. `content-not-ready`

| | |
| --- | --- |
| **Safe to reproduce live** | Yes |
| **Required condition** | A route that streams a partial body and never closes it, so `DOMContentLoaded` never fires |
| **Expected browser behaviour** | The document stays in `loading`; the DOM-ready wait expires |
| **Expected driver error** | `content-not-ready` |
| **Recovery policy** | retry ×2, no new context, **viewport blocked**, other viewports may continue |
| **Live observation necessary** | Yes. Distinguishing this from `navigation-timeout` on real messages is the point; the classifier keys on the operation as well as the message |
| **Deterministic injection sufficient** | For the policy, yes |
| **Risk** | Low |
| **Classification** | `live-reproducible` |

#### 12. `cleanup-failed`

| | |
| --- | --- |
| **Safe to reproduce live** | Yes — and it may already be happening (task 4.9.1-b) |
| **Required condition** | A page held in a pending navigation to a black-holed address, then closed; `page.close()` does not return and the operation bound fires |
| **Expected browser behaviour** | The close call does not complete within the bound |
| **Expected driver error** | `cleanup-failed` |
| **Recovery policy** | retry ×1, no new context, viewport not blocked, other viewports may continue |
| **Live observation necessary** | Yes, and it must additionally confirm the `def_0034` behaviour against a real browser: only what actually closed is forgotten, so the retry retries the same resources rather than finding an empty list |
| **Deterministic injection sufficient** | No. `def_0034` was precisely a case where the stub and the real adapter could diverge, and the correct behaviour depends on real handle lifetimes |
| **Risk** | **Moderate, and it must be managed.** A cleanup that times out may leave a browser process alive. The reproduction must record the process id it started and kill it afterwards, and the suite must not leave orphans behind. This is a known cost of the racing bound and is stated in the limitations |
| **Classification** | `live-reproducible`, with mandatory process cleanup |

#### 13. `unknown-driver-error`

| | |
| --- | --- |
| **Safe to reproduce live** | Not meaningfully |
| **Required condition** | A real failure whose message no classifier branch matches. By construction, that is a failure nobody has anticipated |
| **Expected browser behaviour** | Unknown — that is the definition |
| **Expected driver error** | `unknown-driver-error`, with the original message preserved on `cause` |
| **Recovery policy** | retry ×1, new context required, **viewport blocked**, other viewports may continue |
| **Live observation necessary** | Impossible to schedule. Manufacturing an unmatched message proves the fallback works, which the stub already proves; it does not produce the thing this category exists for |
| **Deterministic injection sufficient** | For the mechanism, yes. For the purpose, no |
| **Risk** | Attempting to force it wastes effort and produces a false sense of coverage |
| **Classification** | **`requires-future-production-telemetry`** |

### Expected outcome of 4.9.1

| Classification | Count | Categories |
| --- | --- | --- |
| `live-reproducible` | 9 | 1, 2, 3, 5, 7, 8, 9, 11, 12 |
| Attempt once, then fall back | 1 | 4 (`page-error`) |
| `deterministic-contract-tested` | 2 | 6 (`screenshot-failed`), 10 (`viewport-invalid`) |
| `requires-future-production-telemetry` | 1 | 13 (`unknown-driver-error`) |

If all nine succeed and `page-error` succeeds, the observed count moves from 2
to 12 of 16, with 3 classified and 1 unreachable by design. **The wording that
replaces "twelve unobserved" must state the classification, not just the
number** — "observed once against a local fixture" and "seen in the field" are
different claims and the document must not blur them.

### Required deliverables

- `fixtures/failure/` — the hanging-route server extensions and the
  un-hoverable-element fixture. Local only.
- `tools/driver-failure-probe.mjs` — one probe per category, each writing a real
  capture contract to `fixtures/failure/observed/`.
- `docs/driver-failure-observation-report.md` — the thirteen rows above with
  outcome, contract path, and classification.
- Updates to the three Phase 4 documents (task 4.9.1-a).

---

## 4.9.2 — Threshold validation

### The conclusion, stated first

**`TOLERANCES.$validated` cannot honestly change in Phase 4.9.** The plan below
is designed to establish that as a measured finding rather than an assumption,
but the expected outcome is that it stays `false`, and the plan must not be run
as though the answer were in doubt in the other direction.

The reason is structural. `$validated` is a single flag over the whole tolerance
set. Flipping it asserts that *every* tolerance is validated. Of the six
unvalidated entries, one (`colorDistance`) cannot be validated at all until a
prior question is answered, and that question is not a Phase 4.9 question.

### The six, as recorded in `fixtures/calibration/tolerance-matrix.json`

| Tolerance | Current value | Category | Fixtures that produced the status | Provenance |
| --- | --- | --- | --- | --- |
| `TOLERANCES.colorDistance` | `12` | color | `cal_09_color_genuine`, `cal_10_color_negligible` | spec-derived |
| `intrinsic.intentMarkers` | marker set | intrinsic | `cal_14_overflow_false_alarm`, `cal_16_intentional_overlay` | spec-derived |
| `state.propertyComparison` | delta from rest; 1.5px / 12 colour | state | `cal_19_focus_ring_genuine`, `cal_22_state_visual_mismatch` | spec-derived |
| `intrinsic.contentComparable` | same `src` required for a crop claim | intrinsic | `cal_23_image_content_different`, `cal_24_image_content_equivalent` | spec-derived |
| `severityFor` | status-aware severity ladder | claim-status | `cal_25_estimated_large_gap`, `cal_26_measured_small_gap` | spec-derived |
| `admissibility` | unknown and contested are inadmissible | claim-status | `cal_27_unknown_not_mismatch`, `cal_28_contested_not_exact` | spec-derived |

**No value in this table is to be changed by this plan or during 4.9.**

Each is `unvalidated` for the same two reasons: two fixtures cannot validate
anything, and three of the six have `precision: null` / `recall: null` because
their cases produce no positives to score. Zero cases across the entire matrix
are `detector-derived`, which is the one genuinely good property here — no case
was written from the constant it tests.

### The distinction that governs the whole workstream

- **Rendering-derived evidence** is produced by the browser: antialiasing, font
  rasterisation, image compression, fractional layout. Nobody chose it. It can
  validate a numeric tolerance, because it is an independent sample of the noise
  the tolerance exists to absorb.
- **Spec-derived evidence** is chosen from what the check is *for* — WCAG
  contrast, CSS pixel semantics, published tap-target guidance. It can justify a
  value and can validate a *rule*, but it cannot validate a *number* against
  reality, because the number and the case come from the same reasoning.
- **Detector-derived evidence** is written from the threshold it tests. It
  validates nothing and the matrix currently contains none. It must stay at zero.

A numeric tolerance validated only by spec-derived cases is validated against
its own justification. That is the trap this section exists to avoid.

### Per-tolerance programme

Common requirements for every entry: fixtures must be **independent** — authored
without reference to the constant, ideally by capturing real rendering rather
than by construction — and the fixture provenance must be recorded per case, as
the existing matrix already does.

---

#### `TOLERANCES.colorDistance` — value 12

- **Prior question, unresolved:** *what is the axis?* The calibration report
  records the boundary as sitting between 4 and 8 channel steps and says the
  axis is unexamined. A distance of 12 in unspecified units cannot be validated;
  it must first be defined as Euclidean RGB, or CIE ΔE2000, or something else,
  and that choice changes what 12 means.
- **Required independent evidence:** ≥20 colour pairs sampled from real captures
  — the six real targets already in `fixtures/raw/` — spanning near-identical,
  marginally different, and clearly different, each labelled by a human before
  the detector is run.
- **Fixture provenance:** rendering-derived (real captures) rather than
  constructed swatches.
- **False-positive test:** two renderings of the same declared colour that
  differ only by antialiasing or compression must produce no finding.
- **False-negative test:** a genuine palette change of the smallest magnitude a
  designer would consider intentional must produce a finding.
- **Boundary coverage:** just-inside, at, just-outside, and 5× the value, on
  whichever axis is chosen.
- **Acceptance criteria:** the axis is documented; ≥20 independent cases;
  precision 1.000 and recall ≥0.9 with no case authored from the constant.
- **Regression requirements:** a boundary test pinning the value and the axis,
  which fails if either moves without a matrix update.
- **Possible in 4.9?** **No.** Defining the colour-difference axis is a design
  decision with its own evidence requirements. Attempting the validation without
  it would produce a number validated on an unknown scale, which is worse than
  an unvalidated one because it looks settled.

#### `intrinsic.intentMarkers` — a rule, not a number

- **Required independent evidence:** ≥12 real pages containing deliberate
  overflow or deliberate overlays, drawn from public sites already captured,
  labelled by inspection before running the detector.
- **Fixture provenance:** rendering-derived, from real captures.
- **False-positive test:** an intentionally scrollable region marked by any
  supported marker must not be reported as a defect.
- **False-negative test:** genuine unintended overflow with no marker must be
  reported.
- **Boundary coverage:** each marker independently; a region with two markers; a
  region whose marker is on an ancestor rather than the element.
- **Acceptance criteria:** every supported marker exercised by ≥2 independent
  cases; zero false positives; recall ≥0.9.
- **Regression requirements:** one test per marker; adding a marker requires a
  case before the marker.
- **Possible in 4.9?** **Partly.** The rule can reach `provisionally-supported`.
  It cannot reach `validated` in 4.9 because the marker vocabulary is open-ended
  — a site can express intent in a way the list does not contain, and no finite
  fixture set closes that.

#### `state.propertyComparison` — inherits two numbers

- **Structural constraint:** this rule composes `TOLERANCES.px` (1.5) and
  `TOLERANCES.colorDistance` (12). **It cannot be validated above the weakest of
  its inputs**, and one of those inputs cannot be validated in 4.9 at all.
- **Required independent evidence:** ≥10 real state pairs — hover, focus and
  active on real sites — captured on both sides, labelled before comparison.
- **Fixture provenance:** rendering-derived.
- **False-positive test:** an identical state on both sides, on pages whose
  layout differs, must produce no mismatch — the `def_0031` condition, on real
  pages rather than the fixture that found it.
- **False-negative test:** a genuinely different focus ring must be reported.
- **Boundary coverage:** a 1.4px and a 1.6px delta; colour deltas either side of
  whatever axis `colorDistance` settles on.
- **Acceptance criteria:** the delta-from-rest rule and the geometry exclusion
  hold on ≥10 independent real pairs, with zero false positives.
- **Possible in 4.9?** **The rule, yes, to `provisionally-supported`. The
  numbers, no** — they are not this entry's to validate.

#### `intrinsic.contentComparable` — a precondition, not a threshold

- **Required independent evidence:** ≥8 image pairs from real captures: same
  `src` cropped differently, same `src` identical, different `src` similar
  appearance, different `src` different appearance.
- **Fixture provenance:** rendering-derived.
- **False-positive test:** two different images that happen to have the same
  aspect ratio must not produce a crop claim.
- **False-negative test:** a genuine crop of the same source must produce one.
- **Boundary coverage:** identical `src` with different query strings; the same
  image served from two hosts; a `srcset` that resolves differently by viewport.
- **Acceptance criteria:** zero crop claims across differing sources; ≥8 cases;
  the `srcset` case explicitly recorded whichever way it falls.
- **Possible in 4.9?** **Yes**, to `provisionally-supported`. This is a
  precondition with a decidable answer, and it is the most tractable of the six.

#### `severityFor` — an enumerable ladder

- **Required independent evidence:** the ladder is a finite function of claim
  status × magnitude. It is validated by **exhaustive enumeration**, not by
  sampling: every (reference status, target status, magnitude band) combination,
  with the expected severity declared before the function is called.
- **Fixture provenance:** spec-derived is **acceptable here**, because the
  ladder is a policy about evidence quality rather than a measurement of
  rendering. There is no physical quantity for rendering-derived evidence to
  measure.
- **False-positive test:** an estimated claim with a 60× gap must never reach
  `high`.
- **False-negative test:** two measured claims with a 60× gap must reach `high`.
- **Boundary coverage:** every status pair × three magnitude bands, with the
  table checked for completeness rather than sampled.
- **Acceptance criteria:** the enumeration is complete and every cell agrees
  with a pre-declared expectation.
- **Possible in 4.9?** **Yes**, and it can reach `validated` for this entry —
  exhaustive enumeration of a finite policy is genuine validation.

#### `admissibility` — also an enumerable rule

- **Required independent evidence:** as above. Every combination of `unknown`,
  `contested`, `estimated`, `inferred`, `observed`, `measured` on both sides,
  with and without the degraded-evidence opt-in.
- **Fixture provenance:** spec-derived, for the same reason.
- **False-positive test:** an `unknown` on either side must never become a
  mismatch, under any magnitude.
- **False-negative test:** two `measured` claims that genuinely differ must be
  admitted and compared.
- **Boundary coverage:** the full 6×6 status matrix × the opt-in flag.
- **Acceptance criteria:** complete enumeration, every cell pre-declared.
- **Possible in 4.9?** **Yes**, and it can reach `validated` for this entry.

### What 4.9.2 can and cannot achieve

| Entry | Best reachable status in 4.9 |
| --- | --- |
| `severityFor` | `validated` |
| `admissibility` | `validated` |
| `intrinsic.contentComparable` | `provisionally-supported` |
| `intrinsic.intentMarkers` | `provisionally-supported` |
| `state.propertyComparison` | `provisionally-supported` (rule only) |
| `TOLERANCES.colorDistance` | unchanged — blocked on an unresolved prior question |

**Therefore `TOLERANCES.$validated` remains `false` at the end of 4.9.** Two of
six entries reaching `validated` does not license a flag that asserts all of
them are. If a future phase wants the flag, the honest route is to replace the
single boolean with per-tolerance statuses — which the matrix already carries —
and retire the flag rather than flip it. That change is itself a design decision
and is out of scope here.

### Required deliverables

- `docs/threshold-validation-plan.md` — the six programmes above, expanded with
  the specific fixture list.
- `fixtures/calibration/independent/` — new cases, provenance recorded per case,
  none authored from a constant.
- An updated `tolerance-matrix.json` with the new statuses. **No value changed.**

---

## 4.9.3 — The three open defects

**Rules for this section.** A defect is not closed because it has not recurred;
absence of a second witness is the reason it is open, not evidence that it is
gone. A blocker is not downgraded without evidence that the risk it names has
changed.

---

### `def_0020` — unanchored structural selector fallback

| | |
| --- | --- |
| **Severity** | medium · scope `reference` · `src/extract/extract.js` |
| **Current behaviour** | When the class-based selector is rejected, the fallback walks up at most six ancestors and joins them with child combinators. The walk stops wherever the guard runs out, leaving the root unanchored — no id, no data attribute, no document position |
| **Why it remains open** | One witness in 90 emitted stable selectors across six targets. The standing Phase 2 rule promotes a structural signature only on independent support from more than one target. Phase 3.2 produced no second witness across eight comparisons |
| **Known evidence** | On tailwindcss.com, `ul > li:nth-of-type(1) > a > svg > g > path:nth-of-type(1)` matches zero elements. Probing shows the prefix matches exactly one element which contains no `g`, so the unanchored root bound to the wrong `ul`. The other five targets have none |
| **Missing independent witness** | A second target on which an emitted stable selector matches zero or wrong elements, found without looking for it |
| **Risk** | A prompt names a selector that does not select the thing described. The reader applies it and gets nothing, or worse, applies it to a different subtree |
| **Blocks analysis?** | **No.** Analysis reports the selector alongside its evidence; nothing depends on the selector resolving |
| **Blocks adaptation?** | **No**, with the same reasoning |
| **Blocks recreation?** | **No**, but it degrades it — a recreation prompt naming a dead selector wastes the reader's time |
| **Blocks fidelity?** | **No.** Fidelity compares IR claims, not emitted selectors |
| **Safe containment** | The baseline test pins the current dead-selector count, so the rate cannot grow unnoticed. Emitted selectors are already accompanied by their evidence, so a reader can verify one. **Additional containment to specify in 4.9:** every emitted structural-fallback selector should carry an explicit `anchored: false` marker so a consumer can tell which selectors carry this risk, rather than the risk being uniform across all of them |
| **Criteria for closure** | Either (a) a second independent witness appears, the anchoring fix is applied, and dead selectors go to zero across all six targets with no regression in the other five; or (b) the containment marker above is implemented and the class is proven harmless because consumers can filter it |
| **Criteria for permanent limitation** | If, after capturing ten or more additional real targets, the rate stays at or below one in ninety and no consumer-visible harm is demonstrated, reclassify as a documented limitation with the marker in place. **Not** before ten targets |

---

### `def_0022` — vowel-ratio test ignores `y`

| | |
| --- | --- |
| **Severity** | low · scope `reference` · `src/extract/extract.js` |
| **Current behaviour** | The ratio counts only `aeiou`. An English word whose only other vowel is a single `e` falls below the 0.2 ratio and is classified as a build hash |
| **Why it remains open** | One real witness (`system`, tailwindcss.com) and one constructed case (`styles-dark`). Every committed capture was scanned for word-shaped names in the hashed bucket and none was found: one name in 800 on a single target. The fix touches how every class name on every site is classified |
| **Known evidence** | `system`: six characters, one `aeiou` vowel, ratio 0.167. Counting `y` would put it at 0.33. The boundary is pinned by a regression test |
| **Missing independent witness** | A second real target where a hand-written name is classified as generated |
| **Risk** | A readable name is excluded from selector candidates, where it may have been the best available anchor. This makes `def_0020` marginally more likely to fire, which is the only coupling between the two |
| **Blocks analysis?** | No |
| **Blocks adaptation?** | No |
| **Blocks recreation?** | No |
| **Blocks fidelity?** | No |
| **Safe containment** | The boundary is pinned by a test, so the classification cannot drift. The cost is a slightly worse selector, never a wrong claim |
| **Criteria for closure** | A second real witness on an independent target, then count `y` as a vowel, then verify that linear.app's 401 hashed names and every synthetic build's hashes are unaffected. The verification is the substantive part: the change must be shown not to reclassify a single genuine hash |
| **Criteria for permanent limitation** | If ten or more additional real targets produce no second witness, reclassify as a documented limitation. The defect is low severity and its containment is complete; permanent-limitation status is a reasonable resting place for it |

---

### `def_0030` — component matching precise but incomplete

| | |
| --- | --- |
| **Severity** | **high** · scope `global` · `src/deploy/match.mjs` |
| **Current behaviour** | The cross-build matcher was built and measured on two builds of the same page, where only generated names change. Against two independently written implementations of one design it achieves precision 1.000 and recall 0.444 |
| **Why it remains open** | It is not fixable by threshold tuning, and tuning it is what the phase brief forbids. Lowering 0.75 to 0.55 would recover three of five misses and would be exactly the move that is prohibited — lowering the gate to make the test pass |
| **Known evidence** | Against a hand-declared key of nine equivalent pairs: 4 correct, 0 wrong, 5 missed, against a pre-declared bar of zero wrong and recall ≥0.6. Four distinct causes among the misses, including `parentChildShape` encoding the parent's tag, which is not stable across implementations |
| **Missing independent witness** | A **second independently written implementation pair**. The one pair tested shares the internal shape of thumbnail, heading, copy and footer — because that is what an equivalent implementation means. A target that reorders or re-nests that shape would test the matcher harder and has never been tried, so true recall across real implementations is **likely lower than 0.444**, not higher |
| **Risk** | If relied upon, component-level fidelity would silently omit more than half the components and report the remainder as if the picture were complete. Precision 1.000 makes this worse, not better: everything reported is right, so nothing signals what is missing |
| **Blocks analysis?** | **No.** Analysis does not match across implementations |
| **Blocks adaptation?** | **No** |
| **Blocks recreation?** | **No** |
| **Blocks fidelity?** | **Partly, and the containment is already enforced.** Component-level comparison falls back to category level; category-level fidelity is unaffected |
| **Safe containment** | Already in place and load-bearing: component-level fidelity comparison is disabled, automatic component correction is blocked, and the readiness decision for automatic global-value correction is `not-usable` on this basis. **Nothing in 4.9 may relax any of these** |
| **Criteria for closure** | A second independent implementation pair, including at least one that reorders or re-nests the internal shape; then a matching approach — not a threshold change — that achieves zero wrong matches and recall ≥0.6 **on both pairs**; then the pre-declared bar met without the bar being moved. Candidate approaches identified but not evaluated: dropping the parent's tag from `parentChildShape`, and matching on internal-shape sequence rather than on aggregate score |
| **Criteria for permanent limitation** | If two independent pairs both fail the recall bar under every approach tried, declare component-level cross-implementation matching **permanently unsupported**, remove it from the fidelity surface rather than leaving it disabled, and state in the readiness decisions that category-level comparison is the ceiling. This is an acceptable outcome and should not be treated as a failure to be avoided |

### Required deliverable

`docs/open-defect-disposition.md` — the three records above, each with its
closure and permanent-limitation criteria, reviewed at the end of 4.9 and
updated with what was learned. **No defect is closed in 4.9 unless its stated
closure criteria are met in full.**

---

## 4.9.4 — Limited release boundary

**There is no global release verdict in this section, and one must not be added.**
A limited private release is a set of eleven separate permissions, and the
reason to enumerate them is that they differ.

| Surface | Limited private release | Conditions and reasoning |
| --- | --- | --- |
| **Analysis mode** | **Supported** | Evidence-backed IR with paired provenance and coverage; the safety gate blocks prompt generation when coverage is thin. Coverage is reported rather than assumed, so a reader can judge a weak capture as weak |
| **Prompt generation** | **Supported, with the selector caveat surfaced** | Requires that emitted structural-fallback selectors carry the `anchored: false` marker from 4.9.3. Without that marker a reader cannot tell which selectors carry the `def_0020` risk, and the release should not ship until they can |
| **Adaptation with a valid target brief** | **Supported** | `adapt` refuses without a brief; requirements are evaluated against available evidence. It does not verify that the adapted result satisfies the brief, and the release notes must say so |
| **Conditional recreation** | **Supported, conditionally** | The condition is explicit: recreation is judged by the fidelity loop, which is report-first. A recreation is a starting point, never a verified match |
| **Single-project Claude Code use** | **Supported** | This is the intended shape of the release. One project, one operator, local artifacts, no shared state. The CLI's run directory is the unit of state and is not concurrency-safe — single-project use is not merely the target, it is the boundary |
| **Trusted local websites** | **Supported** | Every fixture and smoke suite runs here. This is the best-evidenced surface in the system |
| **Third-party public websites** | **Supported with limits** | Six real targets captured across Phases 2 and 3. Limits to state plainly: no evidence about CDN-varying responses, heavy client-side routing, content that changes between captures, or sites with active bot detection. Capture is read-only and no consent gate, CAPTCHA or bot check is bypassed |
| **Utility-heavy websites** | **Supported with limits** | The classifier reached precision 1.000 on hashed names, and utility classes are never recommended as deploy-stable. The limit is `def_0022` — roughly one name in 800 misclassified — and the consequence is a weaker selector, never a wrong claim |
| **Authenticated targets** | **Not supported** | Not implemented, deliberately, and will not be. An authenticated page must be opened by the person who owns the account |
| **Production automation** | **Not supported** | No validated threshold; up to thirteen driver failures unobserved in the field even after 4.9; the CLI is designed for an operator reading results, not for a gate in a pipeline |
| **Automatic correction** | **Not supported** | Blocked by `def_0030` and by design. Tasks are instructions for a person; nothing applies them |

### Release-note requirements

The release notes must carry, in the reader's first screen and not in an
appendix: that no threshold is validated; that scores are measurements rather
than verdicts; that a `null` score means no evidence rather than total
disagreement; that blocked is not failed; and that three defects are open with
one of them high severity.

---

## 4.9.5 — Observability

### Principle

Learn from real usage without collecting anything that is not needed to learn.
The default is **local-only**: everything below is written to the run directory
and nothing leaves the machine unless the operator explicitly exports it.

**Never collected, by default or otherwise:** source page HTML, screenshots,
extracted copy, class names from third-party sites, URLs beyond their origin,
or any artifact content. The failure mode to avoid is a diagnostic channel that
quietly becomes a content channel.

### The record

One JSON-lines file per run directory, `telemetry.jsonl`, one line per command:

| Field | Content | Privacy note |
| --- | --- | --- |
| `command` | the CLI operation name | — |
| `mode` | content mode, or the analysis mode requested | — |
| `sourceKind` | `url` / `synthetic` / `file` | **Origin only, never the full URL.** A path can carry a customer name |
| `viewport` | width and height | — |
| `status` | one of the six | — |
| `blockers` | codes and stages only | Codes, not messages — a gate message can quote page content |
| `evidenceCoverage` | coverage factor, content-reached, sampled/total | Numeric only |
| `driverErrors` | typed codes and counts | Codes only |
| `recoveryAttempts` | per operation: attempts, recovered, final status | — |
| `timeouts` | which operation, which bound, whether it expired | Directly feeds 4.9.1's field evidence |
| `artifactHashes` | the hashes already on the contract | Hashes, never contents |
| `defectCandidates` | a typed code plus the invariant that failed | Never the data that failed it |

### `defectCandidates`

The most valuable field and the most dangerous. A defect candidate is recorded
when an invariant the system asserts about itself does not hold — a hash
mismatch, a category scoring `0` where `null` was expected, a state reported
mismatched with no two-sided evidence, a recovery that reported success without
an attempt.

It records **which invariant failed and where in the pipeline**, never the
values that failed it. A candidate is a prompt to investigate on the operator's
own machine, not a bug report containing their data.

### Export

An explicit `bigaap telemetry --export` produces a redacted bundle for sharing,
prints exactly what it contains before writing, and requires the operator to
confirm. There is no automatic upload, no background reporting, and no opt-out
switch to forget — because there is nothing running that would need one.

### What this buys

`unknown-driver-error` is classified `requires-future-production-telemetry` in
4.9.1. This is that telemetry. The `timeouts` and `driverErrors` fields are what
would eventually let the unobserved categories be reclassified from "observed
once against a fixture" to something stronger — and that reclassification is a
future phase's, not 4.9's.

---

## 4.9.6 — Regression policy

Written down because it has been followed by habit and once by correction, and a
habit is not a policy.

### Every fix, without exception

1. **Defect record before implementation.** The full eleven-field record, filed
   before any code changes. A fix written first and documented after describes
   the fix rather than the defect.
2. **Reproduction.** A concrete, re-runnable path to the wrong behaviour —
   a fixture, a command, a test. "It happened during X" is not a reproduction.
3. **Expected behaviour**, stated independently of the implementation, so the
   record survives a different fix than the one first imagined.
4. **Scope** — `reference`, `global`, or a named subsystem — so a reader can
   tell what else the fix touches.
5. **Regression test**, named in the record, failing before the fix and passing
   after. A record whose `regressionTest.status` is `none` is reported as such
   by `bigaap defects` on every run and must never be allowed to become routine.
6. **Impact on readiness**, stated explicitly: which of the fifteen decisions
   this changes, or the explicit statement that it changes none.
7. **Documentation update** in the same change, not deferred.

### Promotion discipline, unchanged

A defect is promoted for fixing on **two independent witnesses**, or on a cause
that is provable by inspection and does not rest on the measurement. Structural
defects — an unbounded loop, a missing base case, a flag that cannot be true —
qualify under the second clause. A single measured occurrence does not.

### Correction of an earlier record

**This behaviour is to be preserved, and it is not a formality.**

When a diagnosis turns out to be wrong, the record is corrected in place with a
`correctionOfEarlierRecord` field stating what was originally claimed, what
evidence produced the wrong claim, and what the evidence actually shows. The
original claim is not deleted.

`def_0035` is the worked example: it was first filed against `chromium.launch()`
on the evidence that no `chrome` process was alive. Playwright's browser runs as
`chrome-headless-shell`; looking for the right name showed it alive throughout,
and the hang was in closing a page whose renderer was stuck in a pending
navigation. The observation that nothing was bounded survived; the attribution
did not.

The reason to keep the wrong version is that the *method* that produced it —
checking for a process by a guessed name — is the reusable lesson, and deleting
the claim deletes the lesson with it.

---

## 4.9.7 — Completion criteria

Exact evidence required before each of the following. Nothing here may be
satisfied by argument; each requires an artifact.

### Before changing `TOLERANCES.$validated`

1. Every entry in `tolerance-matrix.json` at `validated`, not merely the six
   currently `unvalidated`.
2. The colour-difference axis documented and its value validated on that axis.
3. Zero `detector-derived` cases in the matrix.
4. Every numeric tolerance supported by rendering-derived evidence from targets
   that did not produce the value.
5. False-positive **and** false-negative coverage for each, with boundary cases
   either side.
6. **Expected outcome: not met in 4.9.** If the flag has not changed by the end
   of the phase, that is the plan working, not the plan failing.

Alternatively, and preferably: replace the single flag with the per-tolerance
statuses the matrix already carries, and retire it. That is a design change
requiring its own plan.

### Before closing `def_0020`

A second independent witness, the anchoring fix applied, dead selectors at zero
across all six targets with no regression in the other five — **or** the
`anchored: false` containment marker implemented and its sufficiency
demonstrated. Ten additional real targets without a second witness permits
reclassification as a permanent limitation, not closure.

### Before closing `def_0022`

A second real witness on an independent target; the `y` fix applied; and
demonstrated proof that linear.app's 401 hashed names and every synthetic
build's hashes are unchanged. The proof is the substantive requirement.

### Before closing `def_0030`

A second independently written implementation pair, at least one of which
reorders or re-nests the internal component shape; a matching approach that is
not a threshold change achieving zero wrong matches and recall ≥0.6 **on both
pairs**; the pre-declared bar met without moving the bar. Failure under every
approach tried permits declaring the capability permanently unsupported and
removing it, which is an acceptable outcome.

### Before enabling any automatic correction

1. `def_0030` closed by its criteria above.
2. Every tolerance the correction depends on at `validated`.
3. A demonstrated rollback path: any automatic change reversible from the run
   directory alone.
4. A dry-run mode proven to produce byte-identical output to the manual path.
5. An explicit opt-in per invocation. Never a default.

### Before enabling authenticated capture

**No criteria are defined, because this is a scope decision rather than an
evidence gap.** Enabling it would require a separate plan addressing credential
handling, and the current position is that credentials are never handled. This
entry exists to record that the answer is not "when we have more evidence".

### Before changing production use from `not-usable`

1. `TOLERANCES.$validated` genuinely `true`, or the per-tolerance replacement
   in place with every entry validated.
2. All three open defects closed or formally reclassified as permanent
   limitations with containment proven.
3. Driver failures observed in the **field** via 4.9.5's telemetry, not only
   against fixtures — with a stated minimum of real runs.
4. Concurrency behaviour of the run directory defined and tested, or documented
   as single-operator-only in the product itself rather than only in the docs.
5. A defined support and correction path for a user who receives a wrong claim.

### Before beginning general Phase 5 development

1. 4.9.1 complete: every category classified, the `live-reproducible` ones
   observed, the report written, the count corrected.
2. 4.9.2 complete: the six programmes run to whatever status they honestly
   reach, matrix updated, no value changed.
3. 4.9.3 complete: dispositions written; no defect closed without its criteria
   met.
4. 4.9.4 complete: the eleven release surfaces decided separately.
5. 4.9.5 complete: local telemetry implemented, export gated behind explicit
   confirmation, nothing uploaded by default.
6. 4.9.6 complete: the policy written into the contributing documentation.
7. Unit, live smoke and CLI smoke suites all passing, and the audit at 16/16 or
   higher.

---

## What Phase 4.9 will not do

- Not add features.
- Not change any tolerance value.
- Not close a defect that has merely stopped recurring.
- Not downgrade a blocker without evidence that its risk changed.
- Not force an unsafe browser failure to raise an observed count.
- Not produce a single overall readiness verdict.
- Not claim production readiness, validated thresholds, pixel-perfect fidelity,
  general automatic correction, deploy-safe selectors everywhere, authenticated
  capture support, a composite fidelity score, or defect-free operation.

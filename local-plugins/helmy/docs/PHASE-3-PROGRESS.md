# Phase 3 — progress

| Workstream | Status | Notes |
| --- | --- | --- |
| 3.0 Prompt projections | **Complete** | `adaptation-prompt.md`, `improvement-prompt.md`, `target-brief.schema.json`, V9 |
| 3.1 Utility-class validation | **Complete** | Hypothesis not confirmed; four defects found and fixed, one open by decision |
| 3.2 Cross-deployment validation | **Complete** | Identity survives a rebuild; deploy safety proven only where author hooks exist, unproven on every real site |
| 3.3 Unpainted-component modelling | **Complete** | Five concepts separated; `surface: null` explicit; anatomy guard live; one real unpainted component verified |
| 3.4 Fidelity loop | **Vertical slice complete** | [fidelity-slice-report.md](fidelity-slice-report.md) — report-first, manual-first; component matching demoted after Test 19 |

---

## 3.1 — utility-class validation

**Reports:** [utility-validation-report.md](utility-validation-report.md) ·
[selector-quality-report.md](selector-quality-report.md)

### Outcome in one line

The phase hypothesis — that utility class names cause unrelated elements to be
grouped together — **was not confirmed**. Measured false-grouping rates on
utility-heavy pages (0.000–0.023) do not exceed the hashed control (0.026). The
real exposure was in class classification and selector emission, not grouping.

### What was built

- **Group-coherence instrumentation** in `src/extract/extract.js`: twelve
  per-group signals, six independent disagreement families, flagged at two.
  Gated behind `window.__HELMY_NO_COHERENCE__` so that "measuring the grouping
  did not move it" is testable, and tested across three fixtures.
- **`tools/classify-audit.mjs`** — audits the class classifier against a live
  page using the extractor's own function, not a copy.
- **`tools/selector-audit.mjs`** — evaluates every emitted selector against the
  live DOM: match count, over-match ratio, region spread, utility-bearing,
  pure-structural, dead.
- **`fixtures/incoherent/`** — controlled incoherence fixture with ground truth
  written before capture. Proves the coherence metric is not simply dead.
- **`tests/utility-site.test.mjs`** — 19 tests.

### Defects

| ID | Status | Summary |
| --- | --- | --- |
| `def_0016` | fixed | Utility classes classified as build hashes. Hashed precision 0.073 → 1.000 on tailwindcss.com; controls unchanged. |
| `def_0017` | fixed | Utility classes in deploy-stable selectors. 53% → 0% on the worst two targets. |
| `def_0018` | fixed | Design spec printed the unusable class selector while a stable one sat unused in the IR. |
| `def_0019` | fixed | Three-character hash segments undetected; CSS-modules names used as stable anchors. |
| `def_0020` | **open by decision** | Structural fallback can emit a selector matching nothing. One witness; not promoted. Pinned by a baseline test. |

### Limitations carried forward

1. **`tagDiversity` cannot fire.** The grouping key begins with the tag name.
   Retained as an invariant with a test; identity disagreement is carried by
   `semanticRoleDiversity`.
2. **`textBearingProportion` is near-inert on containers.** It counts direct
   text nodes only, and most repeat-group members are containers whose text
   lives in children. Predicted wrong in the incoherence fixture's ground truth;
   the mis-prediction is recorded there rather than corrected away.
3. **Utility vocabulary is incomplete.** Syntactic detection (colon, brackets,
   `*`/`@` markers) is complete; stem-based detection is not, and cannot be made
   so by adding words. Residual under 0.5% of distinct names per target.
4. **Pure-structural selectors rose sharply** as utility anchors were removed —
   3 → 13 of 15 on tailwindcss.com. Correct against emitting a name that looks
   stable and is not, but brittle, and not presented as a clean win.
5. **Over-matching is unaddressed and is not a utility problem.** linear.app,
   which uses no utility classes, has a higher rate than three of four utility
   targets.

### Discipline

Target selection and hypothesis recorded before capture. Instrumentation added
before baseline, behind a gate, with an A/B proving it inert. Baseline measured
with the unmodified extractor; no heuristic changed during baseline capture. All
five defects filed with the full eleven-field record before any fix. `def_0020`
not fixed because it has a single witness, per the Phase 2 promotion rule.

### Test state

**292 passing, 0 failing** at the end of 3.1. 19 new in this workstream.

---

## 3.2 — cross-deployment selector validation

**Reports:** [cross-deployment-report.md](cross-deployment-report.md) ·
[build-comparison-report.md](build-comparison-report.md) ·
[selector-stability-report.md](selector-stability-report.md)

### Outcome in one line

Component identity survives a rebuild — 9 of 9 matched at confidence 1.00 using
only non-generated evidence — but **deploy safety and selector stability came
apart**: nine selectors survived a rebuild that renamed every class on the page
byte-identically, and none of them is deploy-safe, because they locate targets
by counting siblings.

### What was built

- **Parameterised build generator** — `tools/build-hashed-fixture.mjs` takes a
  seed, a naming-style rotation, optional author hooks, and an optional real
  structural mutation. Five builds generated.
- **`src/deploy/selector-class.mjs`** — the seven-class model, plus
  `deploySafetyVerdict`, which refuses to convert same-build agreement or a
  simulation into a deploy-safety claim.
- **`src/deploy/match.mjs`** — twelve-signal cross-build matcher. Reads no class
  name, id or selector. Six match states. Ambiguity preserved, never tie-broken.
- **`tools/compare-builds.mjs`** — driver; verifies the caller's declared
  relation against the captures rather than trusting it.
- **`tools/simulate-rebuild.mjs`** — Tier 2; rewrites generated identifiers in a
  real capture and stamps its own limits into the output.
- **`tools/build-baseline.mjs`** — the pre-change baseline record.
- **`tests/cross-deployment.test.mjs`** — 23 tests.

### Tiers

| Tier | Status | Result |
| --- | --- | --- |
| 1 — regenerated controlled fixture | done | 5 builds; all seven Tier-1 checks verified |
| 2 — transformed real capture | done, labelled simulation | 816 identifiers rewritten; 13 matched, 2 ambiguous, 0 deploy-safe |
| 3 — real redeployment | attempted, unavailable | Neither real site changed its identifiers; deploy safety unproven |

### Defects

| ID | Status | Summary |
| --- | --- | --- |
| `def_0021` | fixed | Generated name with a word-like tail leaked into 9 of 9 stable selectors in build B. Only a second build could expose it. Leakage 18 → 0 across five builds; cross-build selector overlap 0 → 9. |
| `def_0022` | **open by decision** | Vowel test ignores `y`, so `system` classifies as a hash. One real witness; not promoted. Boundary pinned. |
| `def_0020` | **still open** | No second witness in Phase 3.2. Not closed. |

### Limitations carried forward

1. **Deploy safety unproven on every real site.** No third-party redeployment
   could be induced; 15 of 15 selectors on linear.app are positional.
2. **`accessibleName` is in the matching model, weighted, and never available** —
   the extractor does not compute accessible names.
3. **Five builds from one generator are not five real deployments.** The failing
   shape behind `def_0021` was confirmed against a real styled-jsx name, but the
   generator remains a single source.
4. **The 0.75 / 0.40 / 0.12 thresholds are unvalidated.** They separate every
   case in these fixtures, which is weak evidence from a small sample. The card
   surface in A→C scored 0.74 against a 0.75 threshold — one point of margin.
5. **Nothing here inserts an element**, so the fixtures cannot exercise the
   failure that anchoring (`def_0020`) would prevent.
6. **`positionalWithinAnchor` is recorded, not scored.** Two of five deploy-safe
   selectors reach their target positionally from a hook.

### Discipline

Baseline recorded before any selector or matching change
(`fixtures/cross-build/baseline-a-vs-b.json`). Both defects filed with the full
record, including an explicit `witnessIndependence` field, before any fix.
`def_0020` not reclassified. Same-build determinism, simulation and genuine
rebuild kept in separate relations, each verified against the captures.

### Test state

**315 passing, 0 failing.** 23 new in this workstream; all 292 earlier tests
still pass.

---

## 3.3 — unpainted-component modelling

**Reports:** [unpainted-component-report.md](unpainted-component-report.md) ·
[component-model-report.md](component-model-report.md)

### Outcome in one line

The system could not represent a component that does not paint: **nine of ten
controlled unpainted fixtures produced no component at all**, each rejected with
`zero confidence | no resolvable anatomy`, because anatomy was defined as
surface. All ten now model correctly or are rejected for a stated, correct
reason, and a real unpainted component on nodejs.org/en/blog is verified.

### What was built

- **`src/component/surface.mjs`** — ten-value surface classification, with
  `surface: null` explicit and observed absence held apart from `unknown`.
- **`src/component/identity.mjs`** — eleven identity bases, two refused by rule
  (utility class, DOM position), two structural rejections (incoherent group,
  layout wrapper), plus the anatomy guard.
- **Extended component record** — `semanticUnit`, `identity`, `surface`,
  `wrapper`, `paintedDescendant`, `nonSurfaceProperties`, `anatomyVerdict`,
  `repetition`, `evidenceIds`, each carrying its own evidence.
- **Prompt changes** across rebuild, adaptation and improvement projections.
- **Eleven fixtures** in `fixtures/unpainted/` with declared truth, plus one
  real capture.
- **`tests/unpainted.test.mjs`** — 19 tests.

### Defects

Seven, all filed with the full record before any fix, all fixed with a passing
regression test: `def_0023` (critical), `def_0024`, `def_0025`, `def_0026`,
`def_0027`, `def_0028`, `def_0029`.

`def_0029` was found by a Phase 3.3 test rather than by inspection: the prompt
was stating "no painted surface was observed" and then listing
`background: transparent` four lines later.

### Limitations carried forward

1. **One component per capture.** The shared-wrapper fixture rejects the wrapper
   correctly and identifies neither component inside it.
2. **`inherited-surface`, `image-painted` and `none` are unexercised** by any
   fixture.
3. **Identity, anatomy and coherence thresholds are unvalidated** against a
   corpus of meaningful size.
4. **One real witness** for unpainted components; `def_0025`'s
   wrapper-with-painted-child pattern still has only fixture evidence.
5. **Two truth declarations were corrected after measurement**, recorded under
   `declarationCorrected` in `truth.json` rather than edited away.
6. **One pre-existing expectation was deliberately changed** — the test that
   required unpainted components to be rejected.

### Test state

**334 passing, 0 failing.** 19 new; all 315 earlier tests pass.

---

## 3.4 — fidelity loop, minimal vertical slice

**Plan:** [PHASE-3.4-FIDELITY-PLAN.md](PHASE-3.4-FIDELITY-PLAN.md) ·
**Validation:** [fidelity-plan-validation.md](fidelity-plan-validation.md) ·
**Results:** [fidelity-slice-report.md](fidelity-slice-report.md)

### Outcome in one line

The slice runs end to end, report-first and manual-first. **Test 19 was run
before the loop was built and failed**, so component-level matching was demoted
to observation and the comparison carries at category level — exactly the
fallback the phase brief specified, with no threshold lowered to make the test
pass.

### Test 19

Precision **1.000**, recall **0.444**, zero wrong matches, against a
pre-declared bar of zero wrong and recall ≥ 0.6. `def_0030` filed with the
reproduction. Component identity is reported as resolved or unresolved;
automatic component correction is blocked outright.

### What was built

- `src/fidelity/compare.mjs` — difference records, admissibility, status-aware severity
- `src/fidelity/categories.mjs` — eleven categories, score paired with evidenceCoverage
- `src/fidelity/gates.mjs` — eleven refusal gates, blocked report with no scores
- `src/fidelity/pixel.mjs` — residue rule, suppression, intrinsic findings
- `src/fidelity/tasks.mjs` — seven blocking rules, manual-first
- `src/fidelity/history.mjs` — append-only iterations, hashes, stop rules
- `src/fidelity/run.mjs` — the run
- `tools/test19-matcher.mjs`, `tools/pixel-diff.mjs`, `tools/visual-checks.mjs`, `tools/fidelity-slice.mjs`
- `fixtures/fidelity-target/` and `fixtures/fidelity-target-corrected/`
- `tests/fidelity.test.mjs` — 29 tests

### A measured correction to the plan

Comparative pixel diffing between the reference and an independent
implementation produced **42 clusters purely because the copy differs**. Two
changes followed: a global geometry difference now suppresses the comparative
pass, and overflow, clipping and stacking inversion are checked on the target
alone as single-render properties.

### Limitations

1. Component matching unreliable across implementations (`def_0030`, open).
2. Comparative pixel diffing needs equivalent content.
3. One viewport, one page, one component.
4. States and responsive unscoreable at one viewport.
5. `start()` not implemented on the driver; the slice serves through the
   fixture server.
6. No threshold validated; `TOLERANCES.$validated === false`, asserted by test.

### Test state

**363 passing, 0 failing.** 29 new; all 334 earlier tests pass.


---

## Phase 4.2 — four-viewport fidelity

**Result:** `fixtures/fidelity/phase42-slice-result.json` · `node tools/phase42-slice.mjs`

Four viewports (1440 / 1024 / 768 / 375), each against its own reference. A
target is never compared against a reference from another viewport: a
mispairing is refused at the pairing stage, before the target is started, and
recorded as a pairing error distinct from a gate failure.

The responsive comparison is the only thing computed across viewports, and it
compares PROGRESSIONS rather than values — a grid that steps 3/3/2/1 on both
sides agrees even though no single value is shared across the row.

| | Equivalent target | Independent target |
| --- | --- | --- |
| Responsive score | 1.000 over 10 dimensions | 0.778 over 9 |
| Navigation transformation | expected | **unexpected** — never changes shape |
| Tap targets | expected | **unexpected** — 37px at 375, below the 44px guideline |
| Stacking | expected | unavailable evidence |

**Test state: 421 passing, 0 failing.** 26 new.

---

## Phase 4.3 — interaction-state fidelity

**Report:** [interaction-state-report.md](interaction-state-report.md) ·
`node tools/phase43-slice.mjs`

All nine states compared at 1440 and 375 against controlled fixtures where the
target deliberately fails two. `states` scores **0.875 at coverage 0.889**.

| Outcome | State |
| --- | --- |
| matched | default, hover, active, selected, expanded, empty, error |
| mismatched | focus — no visible ring, four properties differ |
| unavailable | loading — not implemented, **not** a mismatch |
| unknown | the untriggerable control |

The 375px tap-target finding survives into the state report at **high** severity
with `classification: responsive-accessibility-mismatch`, and produces a task.

Six statuses all reachable; mode behaviour implemented for analyze, adapt,
recreate and improve. All state tasks manual.

**Test state: 452 passing, 0 failing.** 31 new.

---

## Phase 4.4 — intrinsic visual checks

**Report:** [intrinsic-visual-report.md](intrinsic-visual-report.md) ·
`node tools/phase44-slice.mjs`

Expanded from 3 checks to **13**, each independent and separately reported, plus
five context records that are never defects. Correlation has four outcomes and
only `target-only` makes the target responsible.

| Correlation | Controlled | Real target |
| --- | ---: | ---: |
| target-only | 27 | 0 |
| unknown | 25 | 166 |
| reference-correlated (demoted, no task) | 2 | 0 |
| reference-only (not a target defect) | 2 | 0 |

Real witness: **nextjs.org/showcase**, 9 check kinds on third-party markup,
selection recorded before capture. Every correlation `unknown` — the behaviour
under test, not a shortcoming.

Intentional conditions refused as defects: a declared carousel and a decorative
mask. Crop claims refused where the two images are not the same source.

`recreate` blocks only on findings that prevent reliable comparison
(`viewport-overflow`, horizontal scrollbar) — not merely because a defect exists.

**Test state: 487 passing, 0 failing.** 35 new.

---

## Phase 4.5 — threshold calibration

**Reports:** [threshold-calibration-report.md](threshold-calibration-report.md) ·
[false-positive-report.md](false-positive-report.md) ·
[false-negative-report.md](false-negative-report.md) · `node tools/calibrate.mjs`

**No tolerance was changed. `TOLERANCES.$validated` remains `false`.**

28 declared cases, **zero disagreements** — which is a limitation, not a result:
every case sat comfortably on one side of its threshold. Boundary sweeps were
added because of exactly that, and locate where each numeric detector flips.

| Status | Count |
| --- | ---: |
| provisionally-supported | 3 |
| unvalidated | 6 |
| blocked-by-source-limit | 8 |
| **validated** | **0 — structurally unreachable from this evidence** |

Every case was authored in the same session as the detectors it exercises, so
`validated` is capped out. 0 detector-derived cases; 4 rendering-derived.

Boundary sweeps: `px` flips at 1.5/1.6, `fontSizePx` at 0.5/0.6, `colorDistance`
between 4 and 8 channel steps — the last on an axis that is not perceptual, which
is why the number is not changed.

Five calibration candidates recorded, none applied. `cand_03` records that the
44px tap minimum is Apple HIG while WCAG 2.2 AA says 24 — the existing report
cites one standard as if it were the only one.

**Test state: 507 passing, 0 failing.** 20 new.

---

## Phase 4.6 — browser driver and recovery

**Reports:** [browser-driver-report.md](browser-driver-report.md) ·
[recovery-report.md](recovery-report.md)

The fidelity layer now depends on `BrowserDriver`, never on Playwright — asserted
by a test that walks every `.mjs` under `src/` and fails on a direct import.
Playwright is imported lazily, so all 29 new tests run with no browser installed.

- **30 operations**, one normalized envelope, `unsupported` declared rather than
  silently ignored.
- **16 typed error categories**; an unrecognised failure becomes
  `unknown-driver-error` rather than a wrong neighbour.
- **20 recovery policies**. A retry never overwrites the failed attempt.
- **Six run statuses**; three good viewports and one blocked is
  `completed-with-warnings`, not `failed`.
- **10 staleness checks**, with `incompatible` (extractor, tolerance version)
  separated from `stale` (driver version).
- **Tap-target policy configurable** — WCAG 24 / Apple 44 / Material 48, default
  `apple-hig` with its rationale recorded, propagating to findings, tasks and
  reports. Closes Phase 4.5 `cand_03`.

**Test state: 536 passing, 0 failing.** 29 new.

**Recorded limitation, carried into 4.7:** the isolation test covered `src/`
only. No capture tool had migrated, so the recovery policies governed nothing
that actually captured.

## Phase 4.7 — capture-tool migration

**Reports:** [capture-migration-report.md](capture-migration-report.md) ·
[driver-integration-report.md](driver-integration-report.md) ·
[live-smoke-report.md](live-smoke-report.md)

Eleven tools moved onto one shared capture session. The limitation above is
closed: no file under `src/`, `tools/` or `bin/` imports Playwright by any form
or calls `chromium.launch`, and there is no path from a tool to the driver that
skips a recovery policy.

- **`src/capture/session.mjs`** owns launch, readiness, stabilisation, retry,
  backoff, context recreation, artifact hashing, attempt history and cleanup.
- **A 25-field capture contract**, identical whatever tool produced it.
- **`stalenessRecord()`** joins the contract to the freshness checks, which had
  been returning eight of ten `unverifiable` against real captures.
- **31st driver operation** — `evaluate`, without which every tool would have
  reached past the interface to a raw page.
- **Migration did not change what is observed**: the full extraction, all eleven
  state records and both fixture PNGs reproduce byte-identically against their
  pre-migration goldens.

Three defects found by migrating, each filed in full before being fixed:
`def_0032` (stabilisation destroyed the motion tokens it was meant to protect,
two independent witnesses), `def_0033` (recovery could restart itself without
bound and killed the process), `def_0034` (a cleanup failure reported itself as
recovered, hiding a browser that may still be running).

**Test state: 555 passing, 0 failing.** 19 new, none needing a browser.
Live smoke 12/12 against the fixture server, run explicitly.

**Recorded limitation:** thirteen of the sixteen typed driver failures have never
occurred against a real browser. They are reachable through the migrated tools
and tested against a stub; they are not field-observed. No threshold is
validated by this phase and automatic component correction remains blocked by
`def_0030`.

## Phase 4.8 — CLI integration and readiness audit

**Reports:** [PHASE-4-RESULTS.md](PHASE-4-RESULTS.md) ·
[PHASE-4-READINESS.md](PHASE-4-READINESS.md) ·
[PHASE-4-LIMITATIONS.md](PHASE-4-LIMITATIONS.md) ·
[phase4-audit.md](phase4-audit.md) · [cli-smoke-report.md](cli-smoke-report.md)

- **Thirteen fidelity commands** on `helmy`, each through the shared capture
  session and each returning the typed result contract.
- **Six statuses with distinct exit codes.** `blocked` (3) is not `failed` (1),
  enforced at construction: a blocked result with no blocker throws, as does a
  `completed` carrying one.
- **`not-attempted` (5)** so a command never emits a success over skipped work.
- **Sixteen audited invariants**, each read from the code or the artifacts.
  Among them: no composite score in 117 sources or 379 artifacts, and no
  unsupported readiness claim in 38 documents, checked sentence by sentence.
- **Fifteen separate readiness decisions**, with no overall verdict. Twelve
  `usable-with-limits`, three `not-usable` (automatic correction, authenticated
  targets, production use).
- **The page-side probes and the full extraction were lifted into `src/`**, so
  the CLI and the tools run one measurement rather than two copies that drift.

Two correct requirements were found to collide and were resolved rather than
traded off: the full extraction must not freeze animation (`def_0032`), and
equivalent-content pixel comparison requires a frozen render. They describe
different artifacts, so the capture now reads style first and freezes second,
and `animationsFrozen` is recorded against the screenshot it is true of.

**Test state: 572 passing, 0 failing.** 17 new, none needing a browser.
Live smoke 12/12. CLI smoke 50/50. Audit 16/16.

`def_0035` was found by the CLI smoke suite stalling three times at the same
scenario: no driver operation was bounded in time, so one that hung stopped the
run with nothing recorded. Every operation now carries a bound and reports the
typed error its own policy already knows. The record carries its own correction
— the first filing blamed the browser launch, on a process check that looked for
the wrong process name.

**Recorded limitations:** unchanged from 4.7, plus everything in
PHASE-4-LIMITATIONS.md. Production use is `not-usable`, and that is the honest
state of the evidence rather than a formality.

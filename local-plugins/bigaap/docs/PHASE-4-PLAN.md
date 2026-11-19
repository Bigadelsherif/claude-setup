# Phase 4 — controlled fidelity expansion and hardening

**Status: plan only. Nothing in this document is implemented.**

Phase 3.4 proved a minimal vertical slice: one reference, one target, one
viewport, one page, one component. Phase 4 widens that along four axes —
content-equivalence policy, viewports, interaction states, intrinsic checks —
and hardens what the slice left thin. It does not widen the *authority* of the
system: automatic correction stays limited to reliable global values, and
component-level editing stays blocked.

---

## 1. Goals

1. **Make the pixel channel honest about content.** Phase 3.4 measured that a
   comparative diff between a reference and an independent implementation
   produces 42 clusters from copy differences alone. Phase 4 makes content
   equivalence an explicit, declared, verifiable mode rather than an assumption.
2. **Compare at four viewports without averaging them.** Each viewport keeps its
   own category results and its own readiness decision.
3. **Compare interaction states where both sides have evidence**, and mark them
   unknown where they do not — Phase 3.4 could score neither `states` nor
   `responsive`, and both reported `null` correctly.
4. **Expand intrinsic target-only checks** from three conditions to thirteen.
   These are the checks that survive content differences, which makes them the
   most portable evidence the loop has.
5. **Begin threshold calibration** against fixtures built for the purpose, with
   validation status recorded per tolerance. `TOLERANCES.$validated` stays
   `false` until a tolerance has been measured against a population that did not
   produce it.
6. **Design recovery** for the fifteen named failure modes, preserving history
   in every one.
7. **Put the browser behind an interface** so the fidelity layer stops depending
   on Playwright-specific calls.
8. **Produce eleven separate readiness decisions**, not one verdict.

## 2. Non-goals

- No dashboard, no SaaS, no billing, no multi-user anything.
- No broad framework adapters.
- **No automatic component-level code editing.** `def_0030` blocks it and Phase 4
  does not revisit that.
- No composite fidelity score, and no multiplication of score by
  `evidenceCoverage` into one number.
- No authenticated capture implementation. The driver interface reserves a place
  for it; the slice does not exercise it.
- No claim of production readiness for the loop as a whole.
- No multi-page fidelity. One page per run remains the unit.

---

## 3. Current baseline

What Phase 4 starts from, measured rather than assumed.

| Fact | Value | Source |
|---|---|---|
| Tests passing | 363 | `npm test` |
| Fidelity categories | 11, each with `score` + `evidenceCoverage` | `src/fidelity/categories.mjs` |
| Refusal gates | 11 | `src/fidelity/gates.mjs` |
| Composite score | none | asserted by test |
| Tolerances validated | **no** — `TOLERANCES.$validated === false` | asserted by test |
| Component matching | precision 1.000, recall 0.444 | `def_0030`, Test 19 |
| Comparative pixel diff | disabled when content equivalence unknown | Phase 3.4 finding |
| Intrinsic checks | 3 conditions: overflow, text clipping, stacking inversion | `tools/visual-checks.mjs` |
| Automatic correction | global values only; 1 of 1 task in the slice | `src/fidelity/tasks.mjs` |
| Viewports compared | 1 | slice scope |
| Interaction states compared | 0 — `states` scored `null` | slice result |
| Surface classifications | 10 defined; `inherited-surface` and `image-painted` **unexercised** | Phase 3.3 |
| Open defects | `def_0020`, `def_0022`, `def_0030` | `docs/DEFECT-LOG.md` |

Three inherited limitations that shape Phase 4 more than anything else:

- **Deploy-safe selectors barely exist without author hooks.** Phase 3.2
  measured 15 of 15 selectors on linear.app as positional. Any correction that
  needs a selector is manual by default, and that is a property of the web, not
  of the implementation.
- **Shared-wrapper modelling is unresolved.** Two different components sharing
  one layout wrapper are not separated (Phase 3.3 limitation, carried forward).
- **Pre-instrumentation captures are `assessable: false`**, not failed. Any
  Phase 4 comparison must preserve that distinction.

---

## 4. Fidelity architecture

Unchanged in shape from Phase 3.4; widened at three points.

```
reference workspace ──▶ reference IR ──┐
                                       ├─▶ gates ─▶ IR category comparison ─▶ tasks
target app ─▶ driver ─▶ capture ──▶ target IR ──┘         │
                    │                                     ├─▶ intrinsic checks (target-only)
                    └─▶ screenshots ──────────────────────┴─▶ comparative residue (gated on content mode)
```

Three widenings:

1. **Content mode** sits in front of the comparative residue channel and decides
   whether it may run at all (§5, §6).
2. **The viewport loop** wraps the whole diagram. Everything from capture to
   readiness happens per viewport (§7).
3. **The state loop** sits inside the viewport loop for the states that are
   requested and available (§8).

What does not change: the same extractor, probe, evidence grader and IR
derivation produce both sides. That is what makes the vocabularies comparable,
and it is not negotiable.

---

## 5. Equivalent-content policy

Comparative pixel residue may run **only** in equivalent-content mode, and the
mode is never chosen silently.

### 5.1 Entry conditions

All six must hold:

| Condition | How it is established |
|---|---|
| Content is equivalent or intentionally identical | **declared** by the caller, or **verified** (§5.2) |
| The content relationship is recorded | `contentRelationship` written into the run manifest |
| Viewport metadata compatible | identical width; height recorded, not compared |
| Device-pixel-ratio compatible | identical DPR; a 1x and a 2x screenshot are never rescaled to match |
| Fonts and assets loaded | `document.fonts.ready` resolved and network idle, both recorded |
| Animations frozen | freeze applied and recorded |
| Dynamic regions masked or stable | mask list declared, or a two-capture stability check passed |

### 5.2 Verification method

Declaration alone is accepted but recorded as such. Verification is stronger and
is attempted when possible:

- **Text-equivalence check.** Extract the visible text of the primary content
  region from both sides; compare normalised token sequences. Equivalence is
  reported as a ratio, with the threshold **explicitly unvalidated**.
- **Structural-count check.** Repeat-group instance counts within tolerance.
- **Two-capture stability check.** The target is captured twice; regions that
  differ between the two captures of the *same* build are dynamic by
  construction and are masked automatically.

The mode report records `declared`, `verified`, or `declared-unverified`. A run
that is `declared-unverified` still runs the comparative channel, and every
finding it produces carries that provenance.

### 5.3 Report contents

```
contentEquivalence: {
  mode: "equivalent-content",
  status: "verified" | "declared" | "declared-unverified",
  verificationMethod: [...],
  textEquivalenceRatio: <number|null>,
  thresholdValidated: false,
  maskedRegions: [{ selector, reason, source: "declared"|"stability-check" }],
  clusters: [{ id, box, attributedTo, actionable, why }],
  actionableClusters: <count>,
  informationalClusters: <count>
}
```

A cluster is **actionable** only when it is unattributed to an IR difference,
outside every mask, and matches a named promotion rule. Everything else is
informational.

---

## 6. Independent-content policy

The default. Selected whenever equivalent-content conditions are not met.

- **Ordinary comparative pixel diff is disabled.** Not thresholded — disabled.
  Phase 3.4 measured what happens otherwise: 42 clusters from copy alone.
- IR category comparison runs in full.
- Intrinsic target-only checks run in full — they are single-render properties
  and are immune to content differences, which is what makes them the backbone
  of this mode.
- Content-related visual differences are reported as **non-actionable
  informational**, with the content relationship stated as the reason.
- **A copy difference is never interpreted as a layout defect without supporting
  IR evidence.** If text reflows to a different height, that is reported only if
  a container, spacing or typography claim also differs.

Independent-content mode is not a degraded mode. It is the correct mode for
comparing a reference against an independent implementation, which is the
primary use case.

---

## 7. Multi-viewport model

Four viewports: **1440, 1024, 768, 375**.

### 7.1 Per-viewport record

Every viewport produces its own complete record. Nothing is averaged.

```
viewports: [{
  width, height, devicePixelRatio,
  referenceCapture: { status, coverage, contentReached, capturedAt, irHash },
  targetCapture:    { status, coverage, contentReached, capturedAt, irHash },
  fontReadiness:  { ready: bool, waitedMs, timedOut: bool },
  assetReadiness: { networkIdle: bool, failedRequests: [...] },
  contentMode: "equivalent-content" | "independent-content",
  categories: [ ...11 categories, each with score + evidenceCoverage ],
  responsiveDifferences: [...],
  intrinsicFindings: [...],
  blockers: [ ...failed gates ],
  evidenceLimitations: [...],
  readiness: "ready" | "ready-with-warnings" | "not-ready" | "requires-additional-validation" | "blocked"
}]
```

### 7.2 Rules

- **No averaging.** There is no cross-viewport score, composite or otherwise.
  Reporting "87% fidelity" across four viewports would hide a 375px layout that
  is entirely broken behind three that are fine.
- **A blocked viewport does not block the others.** If 375 fails to capture, the
  other three still produce results, and 375 reports `blocked` with its reason.
- **Responsive differences are cross-viewport claims** and are the one thing
  computed across viewports rather than within one: breakpoint boundaries, grid
  column progression, container behaviour. They are reported in a separate
  `responsive` section that names the viewports it compared, and they are the
  reason `ir.responsive` — empty at one viewport — becomes populated.
- **A viewport where the reference itself was never captured is not a target
  failure.** It reports `blocked` on the reference side.

### 7.3 What this makes newly possible

The `responsive` category, which reported `score: null, evidenceCoverage: 0`
throughout Phase 3.4, becomes scoreable. That is the main gain, and it is worth
being precise: it becomes scoreable *because more evidence exists*, not because
a rule was relaxed.

---

## 8. Interaction-state model

Nine states: **default, hover, focus, active, selected, expanded, loading,
empty, error**.

### 8.1 Capture

Each state is induced deliberately and captured with its own screenshot and its
own IR evidence:

| State | Induction | Notes |
|---|---|---|
| default | none | already captured |
| hover | pointer over a named selector | one element at a time |
| focus | `focus()` on a named selector | distinct from `:focus-visible` |
| active | pointer down, held | screenshot before release |
| selected | declared selector plus declared attribute | needs the caller to say what "selected" means |
| expanded | click a declared trigger; wait for `aria-expanded` | |
| loading | declared route or declared mock delay | may be uninducible |
| empty | declared route or declared fixture | product-specific |
| error | declared route or declared fixture | product-specific |

The last four require the caller to declare how to reach them. **A state that
cannot be induced is unknown, not absent.**

### 8.2 Comparison rule

> Only compare a state when **both** reference and target have valid evidence
> for it.

When a state is unavailable on either side:

- mark it `unknown`;
- preserve the reason verbatim (`not induced`, `no induction declared`,
  `induction timed out`, `selector not found`);
- **do not treat it as a mismatch** — this is the same discipline that made
  `states` report `null` rather than `0` in Phase 3.4;
- block only when the requested mode explicitly requires that state.

### 8.3 Stabilisation

Every state capture applies, and records: animation freezing, reduced-motion
preference, font-loading wait, network-idle wait. A state screenshot taken
mid-transition is worse than no screenshot, because it looks like evidence.

---

## 9. Intrinsic visual checks

Target-only, single-render, immune to content differences. Three exist; Phase 4
takes them to thirteen.

| # | Check | Detection method | Status |
|---|---|---|---|
| 1 | Viewport overflow | element right edge beyond `documentElement.clientWidth` | **exists** |
| 2 | Text clipping | `scrollWidth/Height` exceeds client box under `overflow: hidden` | **exists** |
| 3 | Stacking inversion | hit-test at element centre returns an overlapping non-descendant | **exists** |
| 4 | Occlusion (general) | as 3, generalised beyond the centre point to a sample grid | new |
| 5 | Unexpected scrollbars | `scrollWidth > clientWidth` on a non-scrolling container | new |
| 6 | Image crop | rendered box aspect against `naturalWidth/Height` | new |
| 7 | `object-fit` behaviour | computed `object-fit` against rendered vs natural aspect | new |
| 8 | Clipping by ancestor | element box outside the nearest clipping ancestor's box | new |
| 9 | Focus visibility | focus each focusable; compare computed outline/ring before and after | new |
| 10 | Minimum tap target | interactive element box below the declared minimum | new |
| 11 | Fixed-element collision | fixed element overlapping content at rest | new |
| 12 | Sticky-element collision | sticky element overlapping content when stuck | new |
| 13 | Content overflow of a container | child box exceeding a non-scrolling parent | new |

### 9.1 Finding record

```
{
  id, rule, viewport,
  targetEvidence: { selector, computedValues: {...}, measuredAt },
  affectedRegion: { x, y, width, height },
  detectionMethod: "hit-test" | "box-measurement" | "computed-style" | "natural-size",
  severity, confidence,
  actionable: bool,
  correlation: "target-only" | "reference-correlated"
}
```

### 9.2 The demotion rule

> If a condition exists in **both** reference and target, demote it to
> informational rather than reporting it as a target defect.

Already implemented for the three existing checks and extended to all thirteen.
A target that reproduces the reference's overflow is faithfully reproducing the
reference. That may be worth telling someone; it is not a fidelity defect.

Some checks — 9, 10 — are accessibility findings that may hold on the reference
too. They are still reported, correlated, and never silently dropped.

---

## 10. IR category comparison

Twelve categories, kept separate. Phase 3.4 had eleven; the twelfth splits
intrinsic checks from comparative residue, which Phase 3.4 had merged into one
`pixel-only` category.

| Category | Phase 3.4 | Phase 4 |
|---|---|---|
| region coverage | ✓ | ✓ |
| layout | ✓ | ✓ |
| typography | ✓ | ✓ |
| spacing | ✓ | ✓ |
| color | ✓ | ✓ |
| components | ✓ | ✓ |
| states | `null` always | scoreable when both sides have evidence |
| responsive behavior | `null` always | scoreable across viewports |
| motion | ✓ | ✓ |
| accessibility | ✓ | ✓ |
| **intrinsic visual checks** | merged into `pixel-only` | **separate** |
| **comparative pixel residue** | merged into `pixel-only` | **separate**, and often absent |

Splitting the last two matters: they answer different questions, have different
availability, and merging them meant a run in independent-content mode reported
a `pixel-only` score derived entirely from intrinsic checks while looking as
though a comparative diff had happened.

### 10.1 Per-category record

```
{
  category,
  score: <number|null>,
  evidenceCoverage: <number>,
  mismatchCount,
  severityDistribution: { critical, high, medium, low, informational },
  unresolvedClaims: [ "<dimension> (<reason>)" ],
  confidence: <number|null>,
  blockers: [...],
  limitations: [...]
}
```

### 10.2 Non-negotiable rules

- `score: null` when the category has no valid evidence. **Never `0`** — zero
  reads as total disagreement, null says the question was not asked.
- `score` and `evidenceCoverage` are reported **as a pair and never multiplied**.
  A perfect score over two of nine dimensions is not the claim a perfect score
  over nine of nine makes.
- **No composite fidelity score.** Not across categories, not across viewports,
  not across states.
- Every uncompared dimension appears in `unresolvedClaims` with its reason.
  Silence about a dimension reads as agreement.

---

## 11. Correction-task safety

### 11.1 Automatic correction may be considered for

Global values with a single authoritative definition and no selector dependency:

- container max-width
- global spacing variables
- verified colour tokens
- verified typography tokens
- global radius variables
- global elevation variables

"Verified" means the reference claim is `measured` or `observed`, uncontested,
and the target claim is admissible.

### 11.2 Automatic correction stays disabled for

- ambiguous components (`def_0030` — all of them, at present)
- positional selectors
- generated selectors
- utility selectors with poor discrimination
- contested reference claims
- product-specific information architecture
- content-dependent layout
- uncertain responsive behaviour
- unverified target selectors

Phase 3.2's measurement makes the practical position plain: on a real page
without author hooks, essentially every selector is positional, so essentially
every selector-dependent correction is manual. That is the expected steady
state, not a temporary limitation.

### 11.3 Task record

Adds two fields to the Phase 3.4 shape:

```
{
  id, category, severity,
  referenceEvidence: { claim, value, status, evidence[] },
  targetEvidence:    { claim, value, status, evidence[] },
  currentValue, expectedValue,
  difference: { absolute, relative, unit },
  affectedRegion,
  affectedSelector: <string|null>,     // null unless reliable
  proposedCorrection,
  confidence,
  mode: "automatic" | "manual",
  notAutomaticBecause: [...],          // never empty when manual
  acceptanceCondition,
  regressionRisk: {                    // NEW
    level: "low" | "medium" | "high",
    categoriesAtRisk: [...],
    why: "..."
  },
  viewportsAffected: [...]             // NEW
}
```

`regressionRisk` is what makes `stopOnRegression` actionable in advance rather
than only in hindsight: a container width change puts every layout-dependent
category at risk and should say so before it is applied.

---

## 12. Threshold-calibration strategy

**No tolerance is marked validated in this phase without evidence, and
`TOLERANCES.$validated` stays `false` until every tolerance in the set has
been measured.**

### 12.1 Calibration fixtures

Twelve, each built to isolate one condition:

| Fixture | Should produce |
|---|---|
| genuine layout mismatch | an IR difference |
| acceptable antialiasing | no finding |
| font-rendering difference | no IR finding; pixel informational at most |
| image compression difference | no finding |
| content difference | no layout finding without IR support |
| responsive difference | a responsive finding, not a layout one |
| genuine overflow | an intrinsic finding |
| genuine occlusion | an intrinsic finding |
| false pixel alarm | no actionable finding |
| false IR mismatch | no finding |
| acceptable fractional values | no finding |
| genuine spacing mismatch | an IR difference |

### 12.2 Per-tolerance record

```
{
  name, currentValue, unit,
  reason: "why this value was chosen",
  testPopulation: [ fixtures and real captures it was measured against ],
  falsePositiveBehavior: { rate, examples },
  falseNegativeBehavior: { rate, examples },
  validationStatus: "unvalidated" | "measured" | "contested",
  supportingEvidence: [ paths ]
}
```

### 12.3 The rule that matters

> **Do not calibrate a threshold using only the fixture that created it.**

This is the `def_0012` lesson restated for tolerances: a fixture written by the
author of the threshold will agree with it. Every tolerance needs at least one
population it was not designed against — a real capture, or a fixture built for
a different condition.

Expected honest outcome: several tolerances will end Phase 4 still
`unvalidated`, and that is a result, not a failure.

---

## 13. Recovery and iteration history

### 13.1 Failure modes and recovery

| Failure | Recovery | History |
|---|---|---|
| failed target startup | abort before capture; no target artifacts | iteration recorded, status `blocked-startup` |
| failed browser capture | retry once with a longer settle; then abort | both attempts recorded |
| interrupted iteration | mark `incomplete`; never resumed in place | next run starts a new iteration |
| stale screenshot | gate fails; screenshot discarded, not reused | recorded with both hashes |
| changed reference IR | run stops — `reference.lock.json` mismatch | lock and attempted hash both kept |
| changed target IR mid-iteration | iteration invalidated | recorded |
| rejected manual correction | recorded as a user decision; loop continues or stops per config | decision preserved |
| correction causing regression | `stopOnRegression`; the regressing iteration is kept | full artifacts kept |
| `stopOnNewUncertainty` | stop; record which category lost coverage | kept |
| max iteration count | stop | kept |
| user cancellation | stop; partial iteration marked `cancelled` | partial artifacts kept |
| browser timeout | abort iteration, status `timeout` | kept |
| font-loading timeout | continue with `fontsReady: false`; gate fails | recorded |
| asset-loading failure | continue; failed requests listed; gate fails | recorded |

### 13.2 Preserved per iteration

Already implemented and carried forward unchanged: reference IR hash, target IR
hash, comparison report, correction tasks, screenshots, intrinsic findings,
output hashes, user decisions, iteration status.

**History is append-only and is never overwritten, including on failure.** A
failed iteration is evidence about the loop.

Phase 4 adds `status` to every iteration record — `complete`, `blocked-*`,
`incomplete`, `cancelled`, `timeout` — so a reader can tell a clean run from an
aborted one without reconstructing it.

---

## 14. Browser-driver interface

The fidelity layer must depend on this interface, not on Playwright.

```
interface BrowserDriver {
  start(config): Promise<{ url, close() }>
  setViewport({ width, height, deviceScaleFactor }): Promise<void>
  goto(url, { waitUntil, timeoutMs }): Promise<void>
  waitForFonts({ timeoutMs }): Promise<{ ready, timedOut }>
  waitForNetworkIdle({ timeoutMs }): Promise<{ idle, failedRequests }>
  freezeAnimations(): Promise<void>
  setReducedMotion(enabled): Promise<void>
  extract(scriptPath): Promise<object>          // the existing extractor
  screenshot({ fullPage, path }): Promise<Buffer>
  interact(action): Promise<void>               // hover, focus, click, keypress
  evaluate(fn, arg): Promise<any>
  errors(): Array<BrowserError>
  cleanup(): Promise<void>
}
```

- Playwright is the first implementation and stays behind the interface.
- `start()` is currently unimplemented — the Phase 3.4 slice served the target
  through the fixture server. Phase 4 implements it for the slice's target only.
- **Authenticated contexts are reserved in the interface and not implemented.**
  Credentials are never handled by the loop; if an authenticated target is ever
  supported, the user authenticates and the driver attaches to that context.
- Errors, timeouts and cleanup are part of the interface because the recovery
  model in §13 depends on distinguishing them.

---

## 15. Artifact layout

```
<workspace>/
  reference.lock.json
  history.json
  calibration/
    tolerances.json
    fixtures/<condition>/...
  iterations/
    0001/
      status.json
      hashes.json
      decisions.json
      viewports/
        1440/
          target/raw/{extract,probe}.json
          target/ir.json
          capture-meta.json
          comparison.json
          categories.json
          intrinsic.json
          pixel/{mode.json,residue.json,clusters.json}
          screenshots/{default,hover,focus,...}.png
          states/<state>/{ir.json,intrinsic.json}
        1024/ ...
        768/  ...
        375/  ...
      responsive.json          # cross-viewport, computed once
      tasks.json               # tasks carry viewportsAffected
      blocked.json
```

Per-viewport directories, one cross-viewport `responsive.json`, one task list.
Nothing is overwritten between iterations.

---

## 16. Schema changes

| Schema | Change |
|---|---|
| `fidelity-run.schema.json` | **new** — run manifest: reference lock, viewports requested, content mode, states requested, driver config |
| `fidelity-comparison.schema.json` | **new** — per-viewport comparison: 12 categories, differences, unresolved claims |
| `fidelity-task.schema.json` | **new** — task record with `regressionRisk` and `viewportsAffected` |
| `intrinsic-finding.schema.json` | **new** — the 13 checks' finding shape |
| `tolerance-calibration.schema.json` | **new** — per-tolerance record from §12.2 |
| `ir.schema.json` | `responsive` gains breakpoint-boundary and per-viewport grid claims; `components[].states` gains per-state evidence |
| `screenshot-capture.schema.json` | gains `devicePixelRatio`, `fontsReady`, `networkIdle`, `animationsFrozen`, `state` |

All new schemas validate through the existing custom validator. V1 extends to
cover them.

---

## 17. CLI changes

```
bigaap fidelity init     --reference <workspace> --target <config> [--out <dir>]
bigaap fidelity compare  --run <dir> [--viewport 1440,768] [--content-mode independent|equivalent]
                        [--states default,hover] [--dry-run]
bigaap fidelity tasks    --run <dir> [--iteration N] [--severity high]
bigaap fidelity apply    --run <dir> --task <id> --confirm     # global values only
bigaap fidelity report   --run <dir> [--iteration N] [--viewport 1440]
bigaap fidelity history  --run <dir> [--verify]
```

- `--content-mode equivalent` is **required** to enable the comparative pixel
  channel. There is no default that turns it on.
- `--dry-run` is the default for `apply`; `--confirm` is required to write.
- `apply` refuses any task whose `mode` is `manual`, and says why.

---

## 18. Test matrix

| Area | Tests | Proves |
|---|---|---|
| Content mode | 8 | equivalent mode requires all six conditions; independent mode disables the comparative channel; mode is never selected silently |
| Multi-viewport | 10 | four viewports produce four independent records; no averaging; a blocked viewport does not block others; responsive becomes scoreable |
| Interaction states | 9 | one test per state: compared when both sides have evidence, `unknown` with a preserved reason otherwise, never a mismatch |
| Intrinsic checks | 13 | one per check, each with a positive fixture and a reference-correlated demotion case |
| Categories | 6 | 12 categories separate; `null` not `0`; score and coverage never multiplied; no composite anywhere |
| Task safety | 9 | six automatic-eligible value kinds; nine blocked conditions; `regressionRisk` present |
| Calibration | 12 | one per calibration fixture; every tolerance records validation status |
| Recovery | 15 | one per failure mode; history preserved in every one |
| Driver | 7 | the fidelity layer imports no Playwright symbol; interface methods are exercised through a stub driver |
| Slice | 10 | the ten proofs in §19 below |
| Regression | all 363 | every existing test still passes |

Approximate total: **463**.

---

## 19. Failure model

The Phase 4 vertical slice — one reference, one target, two viewports.

Required to prove:

1. Both viewports are captured.
2. Each viewport gets separate results.
3. Equivalent-content pixel mode works **only** when declared or verified.
4. Independent-content mode avoids misleading pixel clusters.
5. Intrinsic defects are detected.
6. IR mismatches generate correction tasks.
7. Manual correction updates history.
8. Regression stops the iteration.
9. Blocked reference analysis prevents target startup.
10. Previous artifacts remain intact.

Slice contents: one hover state, one intrinsic visual defect, one IR mismatch,
one manual correction, one correction regression, one interrupted iteration, one
blocked comparison.

Proof 9 is worth singling out: the reference-side gates already fire before the
target is touched, and the slice must show `start()` was never called.

---

## 20. Readiness criteria

Eleven separate decisions. **No overall verdict.**

| Capability | Criterion for `ready` |
|---|---|
| single-viewport IR comparison | all category tests pass; every uncompared dimension listed with a reason |
| multi-viewport IR comparison | four viewports independent; no averaging; responsive scoreable |
| equivalent-content pixel mode | all six entry conditions enforced; verification method recorded; never silent |
| independent-content mode | comparative channel disabled; no copy difference reported as a layout defect |
| interaction-state comparison | states compared only with two-sided evidence; unknown preserved with reason |
| intrinsic visual checks | 13 checks with positive fixtures and demotion cases |
| automatic global-value correction | six value kinds only; nine blocks enforced; `apply` refuses manual tasks |
| manual correction workflow | tasks carry acceptance conditions and regression risk; decisions recorded |
| recovery and history | 15 failure modes recover; history append-only in every one |
| production CLI use | **expected to end Phase 4 as `requires-additional-validation`** — thresholds unvalidated |
| authenticated targets | **`not-ready` by design** — out of scope, interface reserved only |

Statuses: `ready`, `ready-with-warnings`, `not-ready`,
`requires-additional-validation`, `blocked`.

Two are pre-declared rather than discovered: production CLI use cannot be
`ready` while tolerances are unvalidated, and authenticated targets are not
implemented. Saying so now prevents the phase from drifting toward claiming
them.

---

## 21. Known limitations

Carried in, and expected to remain at the end of Phase 4:

1. **Component matching is unreliable across implementations** (`def_0030`,
   recall 0.444). Automatic component correction stays blocked. Phase 4 does not
   attempt to fix this by tuning.
2. **Deploy-safe selectors barely exist without author hooks.** 15 of 15
   positional on linear.app. Most selector-dependent corrections are manual, and
   will stay manual.
3. **Comparative pixel diffing needs equivalent content** — unavailable for the
   primary reference-vs-implementation case.
4. **`def_0020` and `def_0022` remain open**, each with one witness. Phase 4 does
   not manufacture a second witness to close them.
5. **Shared-wrapper modelling is unresolved.** Two components sharing one layout
   wrapper are not separated.
6. **`inherited-surface` and `image-painted` remain unexercised** surface
   classifications.
7. **Tolerances are unvalidated**, and several will still be after §12.
8. **`accessibleName` is in the matching model, weighted, and never available** —
   the extractor does not compute accessible names.
9. **One page per run.** Multi-page fidelity is not designed here.
10. **Loading, empty and error states need caller declaration** and will be
    `unknown` on most targets.

---

## 22. Deferred work

- Multi-page and site-level fidelity.
- Authenticated capture implementation.
- Automatic component-level editing (blocked by `def_0030`).
- Framework adapters.
- Dashboard, SaaS, collaboration.
- Composite scoring of any kind.
- Cross-browser fidelity — one engine only in Phase 4.
- Visual-regression baselining across time, as distinct from
  reference-vs-target comparison.

---

## 23. Phase 5 recommendations

1. **Attack `def_0030` with evidence rather than thresholds.** Two candidate
   changes exist and neither may be adopted on one comparison:
   `parentChildShape` encodes the parent's tag and is unstable across
   implementations; the model lacks a within-set position signal that would
   separate ambiguous siblings. Build a population of reference/implementation
   pairs first.
2. **Resolve shared-wrapper modelling**, the last unaddressed Phase 3.3
   limitation.
3. **Compute accessible names** in the extractor, which unlocks a weighted
   matching signal that has never been available.
4. **Complete tolerance calibration** against real populations, and only then
   consider setting `$validated: true` per tolerance.
5. **Decide whether a composite score should ever exist.** If the answer is yes,
   it needs measured weights and the category scores must stay visible beside it.
   The honest default remains no.
6. **Cross-browser fidelity**, once one engine is trustworthy.

---

## Verification of this plan's claims

Checked before finishing, against the list of things this plan must not claim:

| Must not claim | This plan |
|---|---|
| pixel-perfect fidelity | §5, §6, §21.3 — comparative diffing is gated on content equivalence and unavailable for the primary case |
| validated thresholds | §12 — `$validated` stays `false`; §20 pre-declares production CLI as `requires-additional-validation`; §21.7 |
| general automatic correction | §11.1 — six global value kinds only; §11.2 — nine blocks; §21.2 |
| deploy-safe selectors everywhere | §3, §11.2, §21.2 — 15 of 15 positional on a real page, stated as the steady state |
| production readiness | §20 — eleven separate decisions, no overall verdict; production CLI pre-declared not ready |
| authenticated capture support | §14, §20, §22 — interface reserved, explicitly not implemented |
| a composite fidelity score | §2, §7.2, §10.2, §22 — refused at category, viewport and run level |

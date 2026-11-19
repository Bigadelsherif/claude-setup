# Phase 3.4 — fidelity loop plan

**Status: plan only. Nothing in this document is implemented.**

Written 2026-08-12, after Phases 3.0–3.3. It reuses the vocabulary, the
evidence discipline and several of the modules those phases produced, and it
inherits their known limitations rather than assuming them away.

---

## 1. Goals

1. **Measure how closely an implementation matches an approved reference, in the
   reference's own vocabulary.** The analysis system already speaks in
   containers, spacing bases, type ramps, colour roles, surface classifications
   and component anatomy. Fidelity must be expressed in those terms, because a
   difference stated in those terms is directly actionable and a difference
   stated in pixels usually is not.
2. **Produce prioritised, evidence-backed correction tasks** — each carrying
   both values, the tolerance it exceeded, the evidence behind it, and an
   explicit judgement about whether a machine may apply it.
3. **Detect what the IR cannot see** — overflow, stacking, clipping, compositing
   — through a secondary pixel channel that never overrides the IR.
4. **Refuse rather than mislead.** Where evidence is insufficient, contested or
   stale, produce a report explaining why no comparison was made. A fidelity
   score computed on degraded evidence is worse than none, because it looks like
   a measurement.
5. **Preserve every iteration.** History is append-only; a run's inputs,
   outputs, hashes and decisions must be reconstructable afterwards.

## 2. Non-goals

- **No composite fidelity score in 3.4.** Category scores only. A single number
  requires weights, and no measurement in this project yet justifies any
  particular weighting. Phase 3.1 declined to invent a selector-quality score
  for the same reason and that decision stands.
- **No code generation.** The loop compares and prescribes; producing the target
  implementation is the caller's job, whether human or another agent.
- **No unattended auto-fix.** Automatic application is opt-in, dry-run by
  default, and restricted by rules in §8.
- **No visual-regression product.** Pixel comparison exists to catch what the IR
  structurally cannot, not to become the measurement.
- **No new browser dependency.** Playwright arrives behind the existing
  `CaptureDriver` seam.
- **No multi-page crawling.** One page per run.

## 3. Fidelity pipeline

```
 ┌─ reference side (already exists) ──────────────────────────────┐
 │ 1. Load approved reference workspace                           │
 │    analysis/ir.json + analysis/evidence-map.json + safety      │
 │ 2. Validate reference safety for the requested mode            │
 └────────────────────────────────────────────────────────────────┘
                              │  refuse → blocked-comparison report
                              ▼
 ┌─ target side (new) ────────────────────────────────────────────┐
 │ 3. Receive or generate the implementation target               │
 │ 4. Start the target application  (driver.start)                │
 │ 5. Capture at the reference's viewports (driver.open/setViewport)│
 │ 6. Run the SAME extractor + probe against the target           │
 │ 7. Derive a target IR through the SAME evidence → IR path      │
 └────────────────────────────────────────────────────────────────┘
                              │  incomplete → blocked-comparison report
                              ▼
 ┌─ comparison ───────────────────────────────────────────────────┐
 │ 8. Compare reference IR ↔ target IR   (primary)                │
 │    …then pixel diff, for residue only  (secondary)             │
 │ 9. Category scores + prioritised correction tasks              │
 └────────────────────────────────────────────────────────────────┘
                              ▼
 ┌─ iteration ────────────────────────────────────────────────────┐
 │ 10. Optionally apply corrections (gated, dry-run by default)   │
 │ 11. Recapture, re-derive, re-compare                           │
 │ 12. Stop on threshold, iteration cap, regression, new          │
 │     uncertainty, critical failure, or user cancellation        │
 └────────────────────────────────────────────────────────────────┘
```

**Step 6 is the design's load-bearing decision.** The target is measured by the
same extractor, the same probe, the same evidence grader and the same IR
derivation as the reference. Two IRs produced by one pipeline are comparable
because their vocabularies are identical by construction. A separate
"implementation inspector" would drift from the analysis system within a phase,
and every difference it reported would be ambiguous between a real mismatch and
a disagreement between two measurers.

## 4. IR comparison model

### 4.1 Comparators

One comparator per claim family. Each declares its own tolerance, severity
mapping and evidence requirements — hard-coded tolerances scattered through a
diff function is how `def_0009`-class problems get made.

| # | Dimension | Compared as | Default tolerance | Notes |
|---|---|---|---|---|
| 1 | Content-region reach | ratio | exact (1.0 required) | A target whose content region was not reached is not comparable at all — see §6 |
| 2 | Container width | px | ±1.5px (`TOLERANCE.px`) | |
| 3 | Container padding | px | ±1.5px | |
| 4 | Grid columns | integer | exact | Per viewport |
| 5 | Grid gaps | px | ±1.5px | |
| 6 | Section spacing | px, against the spacing base | ±1 base unit | Compare the *base and ramp*, not every raw value |
| 7 | Typography | px + ratio | ±0.5px size, ±0.02 ratio | Ramp shape compared before individual values |
| 8 | Colour roles | perceptual distance | ΔE ≤ 12 (`TOLERANCE.colorDistance`) | Compared by ROLE, never by hex position |
| 9 | Radii | px | ±1.5px | |
| 10 | Borders | px + colour | ±1.5px, ΔE ≤ 12 | |
| 11 | Shadows | offset/blur/spread px + colour | ±2px, ΔE ≤ 12 | Rendering differs across engines; see §5 |
| 12 | Component count | integer | ±40% (`repeatMembership` rule) | Content length legitimately differs |
| 13 | Component identity | match state | — | Reuses `src/deploy/match.mjs` |
| 14 | Component anatomy | per-property | per-property | Surface and non-surface counted separately, per 3.3 |
| 15 | Surface classification | enum | exact | With the asymmetry in §4.4 |
| 16 | Responsive behaviour | breakpoint boundaries | exact boundaries, ±1.5px values | |
| 17 | Interaction states | presence + values | — | Usually `unknown` on both sides; see §6 |
| 18 | Motion | duration ms, easing | ±0 ms, exact easing | |
| 19 | Accessibility | contrast ratios, landmarks, target sizes | ratio ±0.05 | Findings, not styling |

Tolerances are imported from `src/evidence/disagreement.mjs` where they already
exist, so the fidelity loop and the cross-source disagreement analyser cannot
drift apart on what "the same value" means.

### 4.2 Component matching

Matching reference components to target components is the same problem Phase 3.2
solved for cross-build matching, and `src/deploy/match.mjs` is reused directly:
twelve signals, none of which is a class name, six match states, ambiguity
preserved rather than tie-broken.

**This reuse carries a risk that must be validated before it is trusted.** The
matcher was built and measured on two builds of *the same page*, where content,
structure and geometry are near-identical and only names change. A reference and
an independent implementation differ in content, wording, image sizes and often
markup. The 0.75 / 0.40 / 0.12 thresholds were never tested under that
condition, and Phase 3.2 recorded that the card surface in one comparison scored
0.74 against a 0.75 threshold — one point of margin.

Phase 3.4 must therefore:

- run the matcher against a reference and a *deliberately different but
  equivalent* implementation before relying on it;
- treat `ambiguous`, `insufficient-evidence` and `changed-structure` as
  **non-comparable**, not as mismatches — a component that could not be matched
  has not been shown to be wrong;
- report unmatched components on both sides as their own finding.

### 4.3 Evidence admissibility

A claim pair is compared only when **both sides** are admissible.

| Excluded | Because |
|---|---|
| `status: unknown` on either side | There is nothing to compare |
| Contested-critical claims | Phase 2 established these must not be emitted as exact; comparing them would launder that |
| `estimated` (screenshot-only) claims | Unless the comparator declares `supportsDegradedEvidence: true`, and then only as `informational` |
| `identity.assessable: false` | A pre-instrumentation capture cannot answer identity; unknown is not false (3.3) |
| Claims whose evidence ids do not resolve | V2 evidence-integrity failure; the run is invalid, not the target |

Excluded pairs are **listed** in the report with their reason. Silence about an
uncompared dimension would read as agreement.

### 4.4 Unpainted components — the asymmetry

Phase 3.3 made surface absence a first-class finding, and the comparison must
respect the direction of the claim.

| Reference | Target | Verdict |
|---|---|---|
| `surface: null`, `surfaceObserved: true` | no surface | **match** |
| `surface: null`, `surfaceObserved: true` | has a surface | **mismatch, high** — the target invented a background, border, radius or shadow the reference does not have |
| `surface: null`, `surfaceObserved: true` | has a surface, and the target brief requested it | **informational** — recorded as a target decision, exactly as the adaptation prompt labels it |
| `surfaceObserved: false` (unknown) | anything | **not comparable** |
| `descendant-painted` | painted on the component itself | **mismatch, medium** — right pixels, wrong element; it will diverge the moment the wrapper is restyled |
| `text-only` | `layout-only` | **informational** — the distinction turns on subtree text and is fragile (3.3 limitation) |

`inherited-surface` and `image-painted` remain unexercised by any fixture, so
comparators for them are written but marked **untested** in the report until a
fixture produces one.

### 4.5 Difference record

Every difference carries all eleven required fields:

```jsonc
{
  "id": "diff_0007",
  "dimension": "layout.container.maxWidth",
  "referenceValue": 1180, "referenceStatus": "measured", "referenceEvidence": ["ev_0142"],
  "targetValue": 1280,    "targetStatus": "measured",    "targetEvidence": ["tv_0091"],
  "difference": { "absolute": 100, "unit": "px", "relative": 0.085 },
  "tolerance": { "value": 1.5, "unit": "px", "source": "TOLERANCE.px" },
  "severity": "high",
  "confidence": 0.95,
  "affects": { "kind": "region", "id": "content-container" },
  "recommendedCorrection": "Set the primary content container max-width to 1180px…",
  "automaticallyActionable": true,
  "notActionableBecause": null
}
```

`confidence` is the lower of the two sides' claim confidences. A comparison is
never more confident than its weaker input.

### 4.6 Severity

| Severity | Meaning |
|---|---|
| `critical` | The target contradicts a structural fact: content region unreached, component count off by an order of magnitude, a component the reference has is absent |
| `high` | A measured token or layout value outside tolerance, or an invented surface |
| `medium` | An inferred value outside tolerance; right value on the wrong element |
| `low` | Within 2× tolerance, or an observed-vs-inferred pair that agrees in kind |
| `informational` | Degraded-evidence comparisons, target-brief decisions, and classification pairs known to be fragile |

Severity is a property of the **claim's status and kind**, not of how large the
number is. A 4px gap difference on a `measured` claim is `high`; a 40px
difference on an `estimated` one is `informational`, because the estimate could
not have supported the assertion in the first place.

## 5. Pixel comparison model

Runs **after** the IR comparison, and only on what the IR could not explain.

### 5.1 What it is for

Overflow, stacking and z-order, image crop, clipping, visual alignment,
compositing, shadow rendering, anti-aliasing, unexpected whitespace, and
viewport-specific drift. These are properties of the rendered result that no
computed-style reading exposes.

### 5.2 Residue rule

A pixel region is reported only when it is **not attributable to an IR
difference already found**. If the container is 100px too wide, everything to
its right will differ; reporting that as forty pixel findings would bury the one
correction that fixes them all. The pixel pass therefore:

1. takes the IR differences as input;
2. computes each one's expected affected area;
3. masks those areas;
4. reports what remains.

Unattributed residue is what the pixel channel is for. Everything else is noise
it already knows the cause of.

### 5.3 Normalisation, before any diff

Without these, the diff measures the harness rather than the implementation:

- **Font-ready wait** — `document.fonts.ready`, plus a settle window.
- **Network-idle wait**, bounded.
- **Animation freeze** — `animation-play-state: paused`, `transition: none`,
  and `prefers-reduced-motion: reduce` forced through the driver.
- **Dynamic-content masks** — declared regions (timestamps, counters, carousels,
  random content) excluded by selector, not by coordinates, so masks survive
  layout changes.
- **Scroll reset** and fixed-element handling.
- **Device-pixel-ratio recorded** in metadata and required to match; a 1× and a
  2× screenshot are not comparable and must not be silently rescaled.
- **Screenshot normalisation** — identical viewport, colour profile and encoder.

### 5.4 Thresholds

Per-pixel channel difference, minimum cluster size, and maximum share of the
viewport, all configurable. Anti-aliasing tolerance is separate from colour
tolerance because they fail differently: anti-aliasing produces single-pixel
edges, a wrong colour produces filled areas.

**A pixel difference is never a defect on its own.** Every pixel finding is
`informational` unless a rule promotes it — overflow past the viewport,
clipping of text, or a stacking inversion. Promotion rules are named and
testable, not a threshold on a number.

## 6. Evidence and safety gates

The loop **refuses to compare** — and emits a blocked-comparison report — when
any of these holds. Each maps to something the system already computes.

| # | Gate | Source |
|---|---|---|
| 1 | Reference is unsafe for the requested mode | `safety.status ∈ {insufficient-coverage, unsafe-for-prompt-generation}` |
| 2 | Reference primary region not reached | `coverage.contentReached < 1` / region verification failed |
| 3 | Critical reference claims contested | disagreement analysis, contested-critical set |
| 4 | Target capture incomplete | node cap truncation, blocked stylesheets, probe failure |
| 5 | Viewport mismatch | reference and target viewport width differ |
| 6 | Fonts or assets not stabilised | `document.fonts.ready` timeout, pending network |
| 7 | Application failed to start | driver `start()` non-zero exit or health-check timeout |
| 8 | Screenshot stale | screenshot IR-hash stamp ≠ current target IR hash |
| 9 | Target IR coverage insufficient | same coverage assessment as the reference side |
| 10 | Reference IR hash does not match its projections | V6 projection freshness |
| 11 | Reference safety gate integrity broken | V8 |

Gates 1–3 are **reference-side** and fail the run before the target is even
started — there is no point launching an application to compare against a
reference that cannot support the comparison.

The blocked-comparison report states which gate fired, what it measured, what
would clear it, and explicitly that **no fidelity score was produced**. It never
emits partial category scores, because a partial score is read as a low score.

## 7. Category scoring

Eleven categories. Each is scored independently and **no composite is produced
in Phase 3.4**.

| Category | Dimensions from §4.1 |
|---|---|
| Region coverage | 1 |
| Layout | 2, 3, 4, 5 |
| Typography | 7 |
| Spacing | 6 |
| Colour | 8 |
| Components | 12, 13, 14, 15 |
| States | 17 |
| Responsive | 16 |
| Motion | 18 |
| Accessibility | 19 |
| Pixel-only | §5 residue |

Each category reports six things:

```jsonc
{
  "category": "layout",
  "score": 0.82,                  // agreed comparisons ÷ admissible comparisons
  "evidenceCoverage": 0.67,       // admissible ÷ total dimensions in category
  "mismatches": 3,
  "severityBreakdown": { "critical": 0, "high": 1, "medium": 2, "low": 0, "informational": 4 },
  "unresolvedClaims": ["layout.grid.gap (reference unknown)"],
  "confidence": 0.71              // mean confidence of the compared pairs
}
```

`score` and `evidenceCoverage` are reported **as a pair, never multiplied**.
1.00 over two of nine dimensions is not the same claim as 1.00 over nine of
nine, and collapsing them is exactly the coverage-blind-confidence error that
`def_0002` was filed for.

A category with `evidenceCoverage: 0` reports `score: null`, not `0`.

If a composite is introduced later, its weights must be derived from measured
data and documented alongside it, and the eleven category scores must remain
visible next to it.

## 8. Correction-task schema

```jsonc
{
  "id": "task_0003",
  "category": "layout",
  "severity": "high",
  "referenceEvidence": { "claim": "layout.container.maxWidth", "value": 1180,
                         "status": "measured", "evidence": ["ev_0142"] },
  "targetEvidence":    { "claim": "layout.container.maxWidth", "value": 1280,
                         "status": "measured", "evidence": ["tv_0091"] },
  "currentValue": 1280,
  "expectedValue": 1180,
  "affects": { "selector": "main > .container", "selectorClass": "structural-stable",
               "componentId": null },
  "proposedChange": "Set the primary content container max-width to 1180px and preserve 24px horizontal padding below the max-width threshold.",
  "confidence": 0.95,
  "mode": "manual",
  "notAutomaticBecause": ["no deploy-safe selector: the target selector is structural-stable, not project-stable"],
  "acceptanceCondition": "Target IR reports layout.container.maxWidth = 1180 ± 1.5px at viewport 1440, and layout.container.paddingX is unchanged."
}
```

Tasks are ordered by severity, then by how many other differences they would
resolve (a container width fix that clears twelve downstream pixel findings
outranks an isolated radius), then by confidence.

### 8.1 When a task may not be automatic

`mode: "manual"` is forced when any of these holds. Every one is recorded in
`notAutomaticBecause`; the list is never empty for a manual task.

1. Component identity is `ambiguous`, `insufficient-evidence` or
   `changed-structure`.
2. The reference value is contested.
3. The target value is dynamic (differs between two captures of the same build).
4. The change would affect elements outside the matched component.
5. **No reliable selector exists.** A correction needs a selector classified
   `project-stable` or `semantic-stable` by `src/deploy/selector-class.mjs`.
6. The change requires product judgement — content, copy, imagery, information
   architecture.
7. The reference claim's status is `inferred` or `estimated`.

**Rule 5 will dominate in practice, and the plan says so rather than
discovering it in implementation.** Phase 3.2 measured that on real pages
without author hooks, essentially every emitted selector is `positional` — 15 of
15 on linear.app. Phase 3.1 measured that removing utility and generated classes
pushes selectors toward pure structure. `def_0020` remains open: an unanchored
structural selector can bind to a different subtree or to nothing.

The realistic expectation for 3.4 is therefore that **most correction tasks are
manual**, and that automatic application is available mainly for global
values — container width, spacing base, token colours — where the target is a
stylesheet declaration rather than an element. This is a limit of the evidence,
not a limit of ambition, and the plan is built around it rather than against it.

## 9. Iteration controls

| Control | Default | Behaviour |
|---|---|---|
| `maxIterations` | 5 | Hard cap |
| `minImprovement` | 0.02 | Stop if no targeted category improves by this much |
| `stopOnRegression` | true | Stop if any category score falls |
| `stopOnNewUncertainty` | true | Stop if `unresolvedClaims` grows or `evidenceCoverage` falls |
| `stopOnCriticalFailure` | true | Stop on any `critical` difference or any §6 gate |
| `requireApproval` | true | User approves the task set before anything is applied |
| `dryRun` | true | Compute and report; change nothing |
| `reportOnly` | false | Never propose changes at all |

`stopOnNewUncertainty` matters more than it looks. A change that makes a
component harder to identify can raise a category score while making the run
less trustworthy — fewer admissible comparisons, higher apparent agreement. The
control catches the case where fidelity appears to improve because measurement
got worse.

### 9.1 History is append-only

Each iteration writes a new immutable directory. Nothing is ever overwritten,
including on failure — a failed iteration is evidence.

Preserved per iteration: reference IR (or its hash and a pointer, when
unchanged), target IR, raw captures, comparison report, category scores,
correction tasks, screenshots, applied-change diff, user decisions, and the
hashes of all of them.

## 10. Browser-driver interface

The `CaptureDriver` seam in `src/browser/driver.mjs` already exists and already
has two implementations. Phase 3.4 extends it rather than replacing it:

```js
class CaptureDriver {
  async open(url)                    // exists
  async setViewport(width, height)   // exists
  async evaluate(source, args)       // exists
  async screenshot(options)          // exists
  async close()                      // exists

  // new in 3.4
  async start(appConfig)             // launch the target application; returns { url, stop() }
  async waitForStable(options)       // fonts ready, network idle, animations settled
  async setState(selector, state)    // hover / focus / active
  async setReducedMotion(enabled)
  async freezeAnimations()
  async maskRegions(selectors)
  async authenticate(context)        // never handles credentials itself — see below
}
```

Nothing downstream of capture imports this module; that property is why
Playwright could be added in Phase 2 without touching the IR, and it must hold.

`authenticate` accepts a pre-established context (a storage state the user
produced by logging in themselves). The standing constraint from Phase 0 is
unchanged: **the system never enters credentials.**

## 11. Minimal vertical slice

One reference, one target, one viewport, one page, one component.

**Reference:** `fixtures/controlled/` — BEM, painted card, readable selectors,
declared truth, and a known trap. It is the only fixture whose every value is
independently declared.

**Target:** a new `fixtures/fidelity-target/` — a deliberately imperfect
implementation of that page, served by the fixture server, carrying exactly:

| Planted difference | Kind | Expected outcome |
|---|---|---|
| Container max-width 1280 vs 1180 | IR, layout, `high` | One correction task, automatically actionable |
| A `z-index` inversion putting the badge behind the media block | pixel-only | Reported in the pixel category, no IR difference |

Everything else in the target matches within tolerance, so exactly two findings
are expected and any third is a false positive worth investigating.

The slice must prove all ten:

1. Reference analysis loads, with safety and mode evaluation intact.
2. Target application starts through the driver.
3. Target capture succeeds at 1440.
4. Target IR is generated by the same pipeline.
5. The container difference is detected, with both values, tolerance and evidence.
6. A correction task is generated with an acceptance condition.
7. The z-index difference is reported **only** in the pixel category, with no
   corresponding IR difference.
8. After the container is corrected, the layout category score improves and the
   task's acceptance condition is satisfied.
9. A planted regression in a *different* category (a colour change applied
   alongside the container fix) triggers `stopOnRegression`.
10. Iteration directories, hashes and user decisions are intact and immutable
    across all iterations.

An eleventh proof is required by §6 and is part of the slice: **one blocked
comparison.** Running the loop against a reference whose safety status is
`unsafe-for-prompt-generation` — the Stripe capture already in the repository —
must produce a blocked-comparison report, no category scores, and no target
launch.

## 12. Test strategy

| # | Test | Guards |
|---|---|---|
| 1 | Identical capture compared with itself scores 1.00 in every admissible category | The comparator does not invent differences |
| 2 | …and reports `evidenceCoverage` below 1.0 where dimensions are unknown | Coverage is not conflated with agreement |
| 3 | Each planted IR difference is detected exactly once | No duplicate findings |
| 4 | The pixel-only difference produces zero IR differences | Channel separation |
| 5 | A large IR difference masks its downstream pixel area | Residue rule |
| 6 | `unknown`, contested-critical and `estimated` claims are excluded and listed | §4.3 |
| 7 | Reference `surface: null` + target no surface = match | 3.3 asymmetry |
| 8 | Reference `surface: null` + target painted = `high` mismatch | The invention case |
| 9 | …unless the target brief requested it, then `informational` | Target decision labelling |
| 10 | `descendant-painted` vs self-painted is a `medium` mismatch | Right pixels, wrong element |
| 11 | Every §6 gate produces a blocked report and no scores | Refusal over false measurement |
| 12 | A correction task on a `positional` selector is `manual` with a stated reason | §8.1 rule 5 |
| 13 | Ambiguous component matches produce no correction task | Phase 3.2 discipline |
| 14 | Category score never rises when `evidenceCoverage` falls without a note | `stopOnNewUncertainty` |
| 15 | Regression in an untargeted category stops the loop | `stopOnRegression` |
| 16 | Iteration N's artifacts are byte-identical after iteration N+1 runs | Append-only history |
| 17 | Screenshot with a stale IR-hash stamp is rejected | Gate 8 |
| 18 | Device-pixel-ratio mismatch is rejected, not rescaled | §5.3 |
| 19 | The matcher is exercised on a reference vs an independently-written equivalent | §4.2 risk |
| 20 | All 334 existing tests continue to pass | No regression |

Test 19 is the one that could invalidate a design assumption, and it should be
run early rather than last.

## 13. Data retention and artifact layout

```
<workspace>/
  analysis/            reference IR, evidence map        (unchanged)
  output/              reference projections             (unchanged)
  fidelity/
    config.json                        run configuration, thresholds, masks
    reference.lock.json                reference IR hash + safety snapshot
    iterations/
      0001/
        target/
          raw/extract-1440.json
          raw/probe-1440.json
          ir.json
          screenshots/1440.png
          capture-meta.json            viewport, DPR, fonts-ready, waits, driver
        comparison.json                every difference record
        categories.json                the eleven category scores
        tasks.json                     correction tasks
        pixel/
          diff-1440.png
          residue.json
        decisions.json                 what the user approved or rejected
        applied.diff                   only when changes were applied
        hashes.json                    sha256 of every file above
      0002/ …
    history.json                       append-only index of iterations
```

`reference.lock.json` pins the reference IR hash for the whole run. If the
reference is re-analysed mid-run the loop stops rather than silently comparing
against a moved target — the same reasoning as V6 projection freshness.

Every artifact is stamped with the IR hash it derives from, matching the
existing `<!-- bigaap:ir-hash sha256:… -->` convention.

## 14. Known limitations

Carried in from earlier phases and inherited by this design:

1. **Correction tasks will mostly be manual**, because deploy-safe selectors are
   rare without author hooks (Phase 3.2: 15 of 15 positional on a real page).
2. **`def_0020` is open** — unanchored structural selectors can bind to nothing.
   Any automatic correction routed through one is unsafe, which §8.1 rule 5
   already forbids, but it also limits what the loop can verify.
3. **Cross-implementation component matching is unvalidated.** §4.2.
4. **One component per capture.** Phase 3.3's limitation means multi-component
   fidelity cannot be measured yet; a page with two distinct card types will
   compare only one.
5. **`inherited-surface` and `image-painted` are unexercised**, so their
   comparators cannot be validated in 3.4.
6. **Interaction states are almost always `unknown` on both sides**, so the
   States category will typically report `score: null` with `evidenceCoverage:
   0`. That is honest and nearly useless; inducing states is the prerequisite.
7. **`accessibleName` is in the matching model and never available** — the
   extractor does not compute accessible names (Phase 3.2).
8. **Shadow and anti-aliasing rendering differ across engines**, so pixel
   findings in those categories are informational unless a promotion rule fires.
9. **`text-only` vs `layout-only` turns on subtree text** and is fragile
   (Phase 3.3); differences there are informational.
10. **No threshold in this plan is validated.** Tolerances are inherited from
    `disagreement.mjs`, where they were chosen rather than measured. The same is
    true of `minImprovement` and the pixel thresholds.

## 15. Phase 3.4 completion criteria

1. The eleven-step pipeline runs end to end on the vertical slice.
2. The target IR is produced by the same extractor, probe, evidence grader and
   IR derivation as the reference — demonstrated, not asserted.
3. IR comparison is primary; every pixel finding is either attributed to an IR
   difference or reported as residue.
4. All eleven §6 gates are implemented, each with a test proving it blocks and
   emits no score.
5. Eleven category scores, each with score, coverage, mismatch count, severity
   breakdown, unresolved claims and confidence. **No composite score.**
6. Correction tasks carry all twelve schema fields; every `manual` task states
   why.
7. All seven §8.1 non-automatic rules are implemented and tested.
8. All eight iteration controls work, with append-only history proven by test 16.
9. The vertical slice's ten proofs plus the blocked comparison all pass.
10. Test 19 has been run and its result recorded — including if it invalidates
    the matcher reuse.
11. Every defect found is filed with the full record before its fix.
12. All 334 existing tests still pass.
13. Limitations in §14 are re-measured and updated, not copied forward
    unchanged.

## 16. Phase 4 recommendations

Ordered by how much each would unblock:

1. **State induction.** Hover, focus and active are `unknown` almost everywhere,
   which makes the States category vacuous and weakens component matching. This
   is the single largest gap in the evidence model.
2. **Multi-component extraction.** Removes Phase 3.3's one-component ceiling and
   Phase 3.4's inherited version of it.
3. **Accessible-name computation.** Fills the matching signal that has been
   declared, weighted and unavailable since Phase 3.2.
4. **Anchored structural selectors** (`def_0020`), once a second witness exists.
   This is the prerequisite for automatic corrections being anything other than
   rare.
5. **Threshold validation across a corpus.** Identity 6, anatomy 3, coherence 2
   families, match 0.75/0.40/0.12, and every tolerance in §4.1 are currently
   chosen rather than measured. A corpus large enough to test them would let
   several "unvalidated" caveats be removed honestly — and is the only
   legitimate route to a weighted composite fidelity score.
6. **Stack adapters**, which fidelity makes newly valuable: a correction task
   expressed against a known stack can be applied precisely rather than
   described.

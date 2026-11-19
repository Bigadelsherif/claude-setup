# Phase 2 progress — steps 1–6 of 8

**Status: partial.** The plan's steps 1–6 are implemented and tested. Steps 7–8
are not started. This document records exactly where the line falls, so nothing
here is mistaken for a finished phase.

`PHASE-2-RESULTS.md` will be written when the phase completes; it does not exist
yet, and writing it now would be claiming a result that has not happened.

---

## Done

### Step 1 — evidence-source schema

`method` conflated *where* evidence came from with *how* it was derived, which
made source-vs-source comparison impossible — and comparison is exactly what
the disagreement rules need.

Split into two orthogonal dimensions:

| Dimension | Values |
|---|---|
| `sourceKind` | `dom` · `computed-style` · `screenshot` · `visual-model` · `user-correction` |
| `technique` | `direct-read` · `layout-measure` · `frequency-inference` · `structural-inference` · `pixel-measure` · `vision-estimate` · `assertion` |

Each source carries a **status ceiling that is enforced, not advised**:
`capStatusForSource()` clamps on write, so no code path can record a
screenshot-derived value as `observed`. Screenshot records additionally require
`source.region` — a pixel measurement without the pixels it came from is
inadmissible.

`SOURCE_RANK` and `disagreementPenalty()` are in place for step 6. `contests[]`
exists on every record and is currently always empty.

Legacy `method` is retained and auto-migrates, so all 131 pre-existing tests
passed unchanged.

### Step 2 — spacing inference policy

The Phase 1 rule (largest divisor explaining ≥80%) manufactured a 4px system out
of noise. Replaced with a ranked search that can decline to answer.

| Fixture | Declared | Inferred | |
|---|---|---|---|
| `scale-8` | 8px | **8px** | strong |
| `scale-4` | 4px | **4px** | strong |
| `scale-6` | 6px | **6px** | not forced to 4 or 8 |
| `scale-irregular` | none | **undecided** | coverage 0.28, below floor |
| `scale-fractional` | 4.5px | **4.5px** | not rounded |

Two rules make this work, both learned from failures during implementation:

**Nested divisors are not competing hypotheses.** Every multiple of 8 is a
multiple of 2, so ranking by coverage alone always collapses to the smallest
base. The largest *qualifying* base is the most specific claim the evidence
supports.

**A trivial divisor is not a design system** (`def_0009`). On any page with even
spacing, 2px explains 100% of values. Bases below 4px can be scored but never
chosen; when only they fit, the verdict is undecided and says why.

When no base is decided, observed values still surface under
`scales.spacingObserved` as observations with no scale claim attached.

### Step 3 — hashed-classname fixture

`fixtures/hashed/` — 65 of 65 class names build-generated (`css-1a2b3c`,
`_bodj6_70`, `sc-jTzTBM`, `emotion-…`, `jsx-…`), containing repeated cards,
nested wrappers, breakpoints, hover/focus states, custom properties, type and
spacing scales, an image-painted surface, and a hidden mega-menu.

Everything recovered correctly against declared truth: component
`.jsx-t6yy8g0` (the wrapper), radius 14 (not the wrapper's 22), padding 24,
6 instances, container 1200/24, grid 3 columns, breakpoints `[768, 1024]`,
spacing base 8. Hidden navigation excluded.

**An honest qualification.** Grouping already worked before any change, because
hashed names are *stable within a build* — the signature never needed them to be
*readable*. The fixture proved something weaker than it appears.

What it did expose is a genuine defect (`def_0010`): the component was addressed
only as `.jsx-t6yy8g0`, so a rebuild prompt would have told an implementer to
write a selector that dies at the next deploy. Fixed by classifying every class
name and emitting a structural `stableSelector`:

```
main > section:nth-of-type(2) > div:nth-of-type(2) > article:nth-of-type(1)
```

**Still untested:** cross-build instability, and utility-class frameworks where
unrelated components share identical class strings. Neither is exercised by this
fixture. The planned structural signature (`tag + childTagSequence +
styleFingerprint`) addresses those and has **not** been implemented — the
existing signature was sufficient for A1–A3, and building machinery against an
unexercised risk would be speculation.

### Step 4 — mode requirement matrix

The gate now evaluates the **requested output** before projection. A gap blocks
only when the requested mode depends on it, which is what makes unknowns stop
being intrinsically bad.

`src/modes/requirements.mjs` holds the matrix as data, validated against
`schemas/mode-requirements.schema.json`. Every requirement resolves through one
of eleven declared resolvers (`claim`, `component`, `component-variants`,
`token-group`, `color-roles`, `viewports`, `states`, `imagery`, `motion`,
`a11y`, `region`) rather than a bespoke predicate, so the matrix stays
inspectable.

Each mode declares required and optional evidence, blocking versus warning
severities, its own thresholds, acceptable source kinds, whether screenshot
estimates are admissible, and the artifacts it needs. **There is deliberately no
global confidence threshold** — a test asserts the modes do not share one.

`evaluateMode()` returns the requested mode, required/available/missing
evidence, blocking and warning gaps, decision, confidence, and a recommended
next action. Four decisions are emitted, and the fourth carries real
information: `blocked-with-recapture-recommendation` means another capture of
the same page would supply what is missing, while a bare `blocked` means the
input kind itself cannot — a screenshot has no computed styles, and no amount
of re-capturing changes that.

**The decision grid** (`node tools/mode-matrix-report.mjs`):

| reference | analyze | recreate | adapt | extend | improve |
|---|---|---|---|---|---|
| fixture | allow | warn | allow | **BLOCK** | allow |
| mega-menu | allow | warn | warn | **BLOCK** | allow |
| hashed | allow | warn | allow | **BLOCK** | allow |
| stripe-pricing | allow | **BLOCK** | allow | **BLOCK** | allow |
| spacing-irregular | allow | **BLOCK** | **BLOCK** | **BLOCK** | warn |
| no-content | **BLOCK** | **BLOCK** | **BLOCK** | **BLOCK** | **BLOCK** |

This is the phase's central result made visible: **the same evidence yields
different verdicts depending on what was asked for.** Stripe is a perfectly good
analysis and an inadequate basis for a rebuild — it resolved one anatomy
property and no elevation or border tokens. Every reference blocks `extend`,
because none records a component variant, so none can show how its system flexes.

The Phase 1 blanket `zero-confidence-primary-component` blocker is now
mode-owned, resolving the "too strict for analyze" half of the plan's §7
critique; the "too permissive for recreate" half is resolved by the anatomy and
token requirements.

`output/mode-evaluation.md` is written for every run, safe or blocked.

**A defect this surfaced** (`def_0011`, high): two requirements demanded
`observed` of claims that are `inferred` by construction, making them
permanently unsatisfiable — `recreate` blocked on the controlled fixture, a
capture with 100% coverage and every value recovered exactly. A requirement's
minimum status must be reachable by the claim it checks.

### Step 5 — screenshot-only evidence path

Implemented as a **validating intake**, not an analyser. It receives
observations — from pixel measurement, a vision model, OCR — and decides what
each is allowed to claim. It produces no observation of its own, because a layer
that both invents values and judges them is not a check on anything.

**Three rules do the work.**

*No region, no evidence.* A measurement with no stated origin in the image
cannot be reproduced or corrected, so it is rejected outright rather than
recorded weakly. Regions carry coordinates, dimensions, detection method,
confidence and evidence ids; out-of-bounds regions are refused because they
would be measuring pixels that do not exist.

*The ceiling is enforced on write.* It is not uniform, which is the point:

| Technique | Scale known | Ceiling |
|---|---|---|
| pixel-measurement | yes | `observed` |
| pixel-measurement | no | `estimated` — a number without a scale has no unit |
| visual-observation | qualitative | `observed` — relationships survive rescaling |
| visual-observation | quantitative | `estimated` |

`measured` is unreachable by construction, and an inference stays an inference —
the ceiling caps, it never promotes.

*Unanswerable claims are refused, not downgraded.* Breakpoints, motion timing,
font sources, z-index and custom properties become `unknown` with a reason
naming the structural obstacle, because a low-confidence answer to an
unanswerable question is worse than no answer.

**The fixture** renders one page at 1280 and 480 plus a visible hover state,
then builds its capture from **real pixel measurement of the PNG** — the DOM is
used only to write `truth.json`. The pixel path recovered the container at
1080px exactly, the grid at 3 columns, and the card radius at 17.1px against a
DOM truth of 16 — antialiasing-bounded, which is what an honest estimate looks
like. Deriving the radius required correcting for the fact that a diagonal walk
enters a rounded corner at ~0.29r; the uncorrected number would have been
confidently wrong.

**Mode decisions on screenshot evidence:**

| analyze | recreate | adapt | extend | improve |
|---|---|---|---|---|
| allowed | **blocked** | **blocked** | **blocked** | allowed-with-warnings |

`recreate`, `adapt` and `extend` block with `remedy: source` — "Re-capturing
will not help; this is a limit of the input kind."

**No token file by default.** A token file is a set of commitments and an
estimate is not one. On explicit request an `estimated-tokens.json` is written
instead, never under the `extracted-tokens.json` name, with every entry carrying
source, status, confidence, region reference and limitations.

**Disagreements are preserved.** Both records survive, the claim becomes
contested with all candidates, confidence drops in proportion to the gap, and
the more appropriate source is *named* rather than silently applied — a rendered
colour is fairly sampled from an image, a visible hierarchy relationship is
better evidenced by the image than by the DOM.

**Two honesty gaps this surfaced and fixed:**

- V7 demanded a rebuild prompt from modes that produce none, which would have
  made `analyze` and `improve` permanently invalid.
- The matrix declared `adaptation-prompt.md` and `improvement-prompt.md` as
  *required* artifacts that the projector cannot yet write. Moved to a separate
  `plannedArtifacts` field — declaring a file that never appears is the same
  overclaiming the gate exists to prevent.

### Step 6 — vision disagreement integration

Both evidence paths now run in **one pipeline**. The ordering is the whole
point: each source is built independently, disagreement analysis runs across the
separate record sets, and only then are claims assembled. Merging first would
collapse two accounts into one value and destroy the signal the analysis exists
to find.

Records keep their own ids (`ev_` forensic, `sc_` screenshot) so two builders
cannot collide, and **nothing is dropped** — a source that loses a preference
keeps its record, its id, and its place in the claim's candidate list.

**Tolerance separates noise from findings.** Two values differing by less than
1.5px, or colours within a perceptual distance of 12, are recorded as
*corroboration* rather than conflict, carry **no penalty**, and never mark a
claim contested. Charging a penalty there would punish two methods for agreeing
as closely as their methods allow.

**Preference is claim-specific and must justify itself.** There is no global
ranking: geometry goes to the layout engine that computed it, declared colour to
computed style, perceived hierarchy to the image, visible text to OCR, identity
to the DOM because identity needs an addressable node. Where no rule applies the
disagreement **stays open** — "one of these is probably right" is not an
analysis. A visual model may describe relationships but never overrides an exact
forensic value.

**The controlled run** pairs the DOM fixture with a screenshot capture built to
reproduce all seven required scenarios:

| # | Scenario | DOM | Screenshot | Outcome |
|---|---|---|---|---|
| 1 | Card radius | 12px | 13.1px | **corroborated** — Δ1.1 within tolerance, penalty 1.0 |
| 2 | Container width | 1180px | 1186px | **contested, critical** — Δ6, prefers `dom`, penalty 0.55 |
| 3 | Colour | `#ffffff` | `#fdfdfe` | **corroborated** — perceptual Δ5.47, penalty 1.0 |
| 4 | Hierarchy | silent | `hero` | screenshot-only contribution, preserved |
| 5 | Component identity | `.card` | `[region:d-card-inner]` | **contested** — prefers `dom` |
| 6 | Breakpoints, motion | 768/1024/1440, 180ms | attempted | **rejected** as structurally unknowable; never contests the DOM value |
| 7 | Grid columns | 3 | 3 | identical — no record, no penalty |

**Criticality decides who may proceed.** The same evidence:

```
recreate  BLOCKED   mode:uncontested-criticals — 2 critical claim(s) contested:
                    layout.container.maxWidth (numeric-mismatch),
                    component.card.selector (component-identity-mismatch)
analyze   allowed   8 requirements met, 0 blocking
improve   allowed
```

Describing a disagreement is legitimate where building on one is not.

**Outputs:** `disagreement-report.md` (source comparison table, confidence
impact, per-disagreement detail with preference reasoning), a contested-claims
section in `design-spec.md`, `contestedClaims` on the IR, and an implementation-
notes section in any prompt that carries an approximate value. A contested claim
**never renders as a bare number** — `claimLine` refuses it and `literal` marks
it `CONTESTED`.

**Three gaps this surfaced:**

- V3 rejected contested claim lines because it looked for a status word after
  the marker, while a contested line puts the annotation in the bolded slot —
  there being no single value to bold. `contested` and `user-corrected` are now
  first-class annotations, which is right: "two sources disagree and here are
  both" is a stronger statement than any single status.
- The evidence-id pattern assumed one builder.
- `analyzeWorkspace` had no way to load a screenshot capture alongside a DOM
  one, so multi-source runs were only reachable from the API.

---

## Not started

| Step | Work | Blocking |
|---|---|---|
| 7 | Live hashed-classname site run | needs steps 4–6 to be meaningful |
| 8 | `PHASE-2-RESULTS.md`, readiness recommendation | needs all |

The policies for steps 4–6 are **specified** in `PHASE-2-PLAN.md` §4–§7
(requirement matrix, thresholds, screenshot rules, disagreement resolution).
Only the code is missing.

**The six states in the plan's §0 are not yet distinguishable.** States 1, 2 and
4 work today via the Phase 1 gate. State 3 (screenshot estimation) needs step 5.
States 5 and 6 (extractor failure vs site limitation) need the defect/limitation
discriminator, which is step 8 work.

Phase 2 is therefore **not complete**, and the fidelity-loop readiness question
cannot be answered yet.

---

## Test and defect status

**233 tests passing** (131 carried forward, 102 new). No regressions.

Step 4's gate criteria are all met: schema ✅ · implementation ✅ · projection
output ✅ · passing tests ✅ · at least one blocked case ✅ · at least one
allowed-with-warnings ✅ · at least one fully allowed ✅.

Step 5's completion criteria are all met: valid schema ✅ (`screenshot-capture`
plus extended `evidence`) · ceilings enforced ✅ · region provenance mandatory ✅
· artifacts clearly degraded ✅ · mode decisions correct across all five ✅ ·
disagreements preserved ✅ · all 15 required tests pass ✅ · previous tests still
pass ✅ · `.ui-analysis/shot-analyze` is allowed-with-warnings ✅ ·
`.ui-analysis/shot-recreate` is blocked ✅ · no screenshot run emits a falsely
exact token file ✅.

Step 6's completion criteria are all met: both paths in one pipeline ✅ · real
disagreements produced ✅ (4 comparisons, 2 genuine conflicts) · they survive in
the IR ✅ (`contestedClaims`) · the penalty is visible ✅ (0.55 vs 1.0) ·
preference is claim-specific ✅ · `recreate` blocks on a critical unresolved
disagreement ✅ · `analyze` and `improve` proceed ✅ · previous tests pass ✅ ·
no contested critical value is emitted as exact ✅.

**11 defects filed, 11 fixed, 10 with passing regression tests.** `def_0007`
(CSP transport) remains the only fix without one, and cannot have an offline
test.

A note on tooling: PowerShell 5.1 reads files as the system ANSI codepage, so
piping source through `Get-Content | Set-Content -Encoding utf8` double-encodes
every non-ASCII character. It corrupted two files during this phase.
`tools/fix-mojibake.mjs` now reverses it exactly via the CP1252 byte mapping,
and a repo-wide scan is clean.

New this phase:

| ID | Severity | Finding |
|---|---|---|
| `def_0009` | medium | Trivial divisor selected as a spacing base unit |
| `def_0010` | high | Build-generated class names emitted as implementer-facing selectors |
| `def_0011` | high | Mode requirements demanded a status their claims can never reach |

All three were found by the adversarial fixtures and tests rather than by
review, which is the argument for building them.

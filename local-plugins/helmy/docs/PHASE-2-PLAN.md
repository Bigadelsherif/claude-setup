# Phase 2 plan — adversarial validation

**Not feature expansion.** Phase 2 attacks the analysis system with inputs
designed to break it, and changes the gate from "is the evidence good?" to
"is the evidence sufficient *for what was asked*?"

**Out of scope, explicitly:** fidelity loop, pixel diffing, dashboard, Figma,
additional stack adapters.

---

## 0. The governing shift

Phase 1 asked one question: *did we look at the right region?*

Phase 2 asks a sharper one:

```
requested output
      ↓
required evidence          ← NEW: each prompt mode declares what it needs
      ↓
coverage and confidence check
      ↓
allow · warn · block
```

The consequence is that **unknowns stop being intrinsically bad**. A run with
fifty unknowns that nonetheless holds every claim `recreate` depends on is
usable. A run with three unknowns that happen to be the container width, the
type ramp, and the component anatomy is not. The current gate cannot tell those
apart, and that is the central defect Phase 2 fixes.

### The six states the system must distinguish

Phase 2 is complete only when a run is classifiable into exactly one of:

| # | State | Signature |
|---|---|---|
| 1 | Exact forensic analysis | DOM + computed-style evidence, high coverage, all required claims present |
| 2 | Degraded but usable | required claims present, non-required gaps labelled |
| 3 | Screenshot-based estimation | every value `estimated`, no token file, exactness claims refused |
| 4 | Insufficient evidence — blocked | a required claim for the requested mode is missing |
| 5 | Genuine extractor failure | claims disagree with a controlled fixture's declared truth |
| 6 | Site-specific limitation | evidence unreachable for a stated external reason |

States 5 and 6 are the hard pair. The discriminator is the **controlled
fixture**: a failure that reproduces against declared truth is ours; a gap that
only appears on a live site with a recorded cause (cross-origin CSS, canvas
rendering, auth wall) is the site's. Anything that cannot be assigned goes to a
defect report as `category: other` rather than being guessed at.

---

## 1. Adversarial test matrix

| ID | Target | Attacks | Expected verdict |
|---|---|---|---|
| **A1** | `fixtures/hashed/` | Generated class names (`css-1a2b3c`, `_3f9xk_12`, `sc-bdfBwQ`, `emotion-abc123`) | Components grouped correctly **without** readable names |
| **A2** | `fixtures/hashed/` | Nested wrappers with hashed names at every level | Identity resolves to the correct outer node |
| **A3** | `fixtures/hashed/` | Hidden nav with hashed names | Excluded, as in Phase 1 |
| **A4** | `fixtures/screenshot/` | PNG only, no DOM | All values `estimated`; no token file; exactness claims refused |
| **A5** | `fixtures/screenshot/` | Request `recreate` from a screenshot | **Blocked** — required evidence unavailable |
| **A6** | `fixtures/screenshot/` | Request `analyze` from a screenshot | `usable-with-warnings`, degraded |
| **A7** | `fixtures/spacing-8/` | Clean 8px scale | base 8, high confidence |
| **A8** | `fixtures/spacing-4/` | Clean 4px scale | base 4, high confidence |
| **A9** | `fixtures/spacing-6/` | 6px scale — neither 4 nor 8 | base **6**, not forced to 4 |
| **A10** | `fixtures/spacing-irregular/` | 7, 11, 13, 19, 23px | base **unknown**, ambiguity stated |
| **A11** | `fixtures/spacing-fractional/` | 4.5, 9, 13.5, 18px | base 4.5 or unknown; **never silently rounded** |
| **A12** | synthetic | DOM says 12px, screenshot says 16px | Both preserved, disagreement recorded, confidence lowered |
| **A13** | synthetic | Required claim missing for mode | Blocked with the specific claim named |
| **A14** | synthetic | 50 unknowns, all required claims present | `usable-with-warnings`, **not** blocked |
| **A15** | live | A real hashed-classname site | Recorded before any tuning |

**Discipline for A15:** capture, run, and record failures **before** touching a
heuristic. The Phase 1 run established this is the only way to learn whether
heuristics generalise; tuning first destroys the evidence.

---

## 2. Evidence-source schema

The current `method` enum conflates *where evidence came from* with *how it was
derived*. Phase 2 splits them, because the disagreement rules in §5 need to
compare sources independently of technique.

```jsonc
{
  "id": "ev_0142",
  "claim": "component.card.borderRadius",
  "value": "12px",
  "status": "observed",              // unchanged: measured|observed|inferred|estimated|unknown

  "source": "computed-style",        // NEW — where it came from
  "technique": "direct-read",        // NEW — how it was derived

  "sourceDetail": {                  // NEW — source-specific provenance
    "selector": ".card__inner",
    "domPath": "html>body>main>…",
    "region": null                   // screenshot sources carry {x,y,w,h} here
  },
  "contests": ["ev_0207"],           // NEW — evidence this disagrees with
  …
}
```

**`source` enum** — five sources, as specified:

| Source | Meaning | Max status |
|---|---|---|
| `dom` | Structure, attributes, ARIA, element counts | `measured` |
| `computed-style` | `getComputedStyle`, custom properties, stylesheet rules | `observed` |
| `screenshot` | Pixel measurement against a captured image | `estimated` |
| `visual-model` | A model's reading of an image | `estimated` |
| `user-correction` | Human assertion | `measured` |

**`technique` enum:** `direct-read` · `layout-measure` · `frequency-inference` ·
`structural-inference` · `pixel-measure` · `vision-estimate` · `assertion`.

**The cap is enforced, not advisory.** A `screenshot`-sourced record cannot be
promoted above `estimated` by any code path. This is what makes the §4 policy
mechanically true rather than a convention.

Migration: existing `method` values map cleanly
(`layout-rect` → `dom`/`layout-measure`, `computed-style` → `computed-style`/`direct-read`,
`vision` → `screenshot`/`vision-estimate`, …). `method` is retained as a derived
field for one phase so no existing consumer breaks.

---

## 3. Hashed-classname strategy

The current repeat signature is `tag + sorted class list`. On a hashed site the
classes are stable within one build and meaningless across builds — and worse,
utility-class frameworks give *different* components identical class strings.

**Component identity must never depend on a class name being readable.**

### Structural signature

```
structuralSignature = tag
                    + ":" + childTagSequence          // "div>h3,p,div"
                    + ":" + styleFingerprint          // hash of a fixed
                                                      // computed-style subset
                    + ":" + depthFromRegionRoot
```

The style fingerprint covers `display`, `flexDirection`, `gridTemplateColumns`,
`position`, `borderRadius`, `backgroundColor` presence, `boxShadow` presence,
`padding` shape, `fontSize`, `fontWeight` — properties that describe what a
thing *is*, not what it is called.

### Class-name classification

Each class is scored, not trusted:

| Pattern | Verdict |
|---|---|
| `css-1a2b3c`, `_3f9xk_12`, `sc-bdfBwQ`, `emotion-abc123`, `[a-z]{1,3}[A-Za-z0-9]{5,}` | `hashed` |
| `card`, `product-card`, `card__inner`, `card--featured` | `readable` |
| `flex`, `mt-4`, `text-sm`, `w-full` | `utility` |

Grouping uses the structural signature **always**. Class names are used only to
*label* a group and only when classified `readable`. A group whose classes are
all `hashed` gets a selector recommendation derived from stable anchors instead:
`data-*` attributes, ARIA roles, semantic tags, then an `nth-of-type` path.

### Stable selector emission

Generated prompts must not tell an implementer to write `.css-1a2b3c`. Where
class names are hashed, the component record carries
`stableSelector: "main > section:nth-of-type(2) > article"` and a note that the
source's class names are build-generated.

---

## 4. Screenshot-estimation policy

A screenshot is a legitimate input and a categorically weaker one. The policy
makes the difference impossible to lose downstream.

### Hard rules

1. Every screenshot-derived record is `source: "screenshot"`, `status: "estimated"`, and **cannot be promoted**.
2. `extracted-tokens.json` is **not generated** in screenshot mode. Tokens are commitments; estimates are not. (Overridable only by explicit `--allow-estimated-tokens`, which stamps the file as estimated throughout.)
3. Every screenshot record carries `sourceDetail.region = {x, y, width, height}` — the pixels the value came from. A measurement without a region is not admissible.
4. Rendering prose hedges every value ("approximately 24px"), enforced by V4.
5. Confidence base 0.45, further reduced by coverage.

### Claims a screenshot cannot support

These are emitted as `unknown` with a fixed reason, never estimated:

| Claim | Why not |
|---|---|
| `layout.breakpoints` | A single image shows one viewport; media queries are unobservable |
| `tokens.*` as CSS values | A colour can be sampled; a *token system* cannot be seen |
| `typography.*.fontFamily` | Rendered glyphs do not identify a font source or stack |
| `tokens.motion.*` | A still image has no timing |
| computed-style exactness | Rendered pixels conflate declared value, inheritance, and layout |

`typography.*.fontSize` and spacing **may** be estimated from pixel measurement,
because they are geometric — but they stay `estimated` and are labelled as
measured-from-image.

### Mode interaction

| Requested mode | Screenshot-only verdict |
|---|---|
| `analyze` | `usable-with-warnings` — describe what is visible |
| `recreate` | **blocked** — requires computed-style evidence |
| `adapt` | **blocked** — requires a token system |
| `extend` | **blocked** — requires component anatomy |
| `improve` | `usable-with-warnings` — UX critique needs less precision |

---

## 5. Vision-evidence integration

**Vision never overwrites forensics.** When a screenshot and the DOM disagree,
the disagreement is itself the finding.

### Resolution rules

1. Both records are retained; neither is deleted or superseded.
2. The claim becomes **contested**: it carries `candidates[]` with each value, source, and confidence, plus a `preferred` value chosen by source rank (`dom` > `computed-style` > `screenshot` > `visual-model`).
3. Confidence is multiplied by a disagreement penalty scaled to the magnitude of the difference — a 1px discrepancy is noise, a 4px one is a finding.
4. The contest is surfaced in `design-spec.md` and `extraction-warnings.md`.
5. A discrepancy above a material threshold (>2px, or ΔE > 5 for colour) nominates a **review item**; a discrepancy that recurs across references nominates a **defect**.

```jsonc
"component.card.borderRadius": {
  "value": 12, "status": "observed", "confidence": 0.62,
  "contested": true,
  "candidates": [
    { "value": 12, "source": "computed-style", "confidence": 0.95, "evidence": ["ev_0142"] },
    { "value": 16, "source": "screenshot",     "confidence": 0.45, "evidence": ["ev_0207"] }
  ],
  "disagreement": { "delta": 4, "unit": "px", "material": true, "reviewItem": "rev_0003" }
}
```

**Silently choosing one is forbidden.** A contested claim that renders as a bare
number is a V-rule violation.

---

## 6. Spacing inference policy

The current inference takes the largest divisor explaining ≥80% of observations
and asserts it. On an irregular page that manufactures a 4px system out of noise.

### New procedure

1. Score every candidate base 2–24 by frequency-weighted coverage.
2. Rank candidates. Record the **top three with their coverage**, not just the winner.
3. Decide:

| Condition | Verdict |
|---|---|
| Best coverage ≥ 0.85 and margin over runner-up ≥ 0.15 | `inferred`, high confidence |
| Best coverage ≥ 0.70 | `inferred`, reduced confidence, alternatives recorded |
| Best coverage < 0.70 | **`unknown`** — "no consistent base unit" |
| Two candidates within 0.05 coverage | **`unknown`** — ambiguous, both recorded |

4. Fractional bases (4.5, 6.5) are admissible candidates. Fractional observations are never rounded to make a base fit.
5. The ramp reports only values consistent with the chosen base. If the base is `unknown`, the ramp is emitted as **observed values** with no scale claim attached.

**The agent must not force every page into 4px or 8px.** A6 exists to prove it,
and A10 exists to prove the system will say "I don't know".

---

## 7. Confidence threshold policy

### Mode requirement matrix

Each prompt mode declares the claims it cannot function without.

| Mode | Required claims | min contentReached | min coverageFactor | min provenance |
|---|---|---|---|---|
| `analyze` | primary region identified | 0.25 | 0.30 | 0.40 |
| `recreate` | `layout.container.maxWidth`, ≥1 component with anatomy, `typography.body.fontSize`, ≥2 colour roles | 0.60 | 0.50 | 0.60 |
| `adapt` | `scales.spacingBaseUnit` **or** ramp, `typography.body.*`, ≥3 colour roles | 0.50 | 0.45 | 0.55 |
| `extend` | everything `recreate` needs, plus component variants | 0.60 | 0.55 | 0.60 |
| `improve` | `layout.container.*`, `a11y.contrastFindings`, ≥1 component | 0.60 | 0.50 | 0.55 |

### Supporting thresholds

| Signal | Threshold | Effect |
|---|---|---|
| repeat-group coverage (in content ÷ total) | < 0.25 | warn; < 0.10 with 0 in content → block |
| unknowns | **no threshold** | only matters if a *required* claim is unknown |
| critical-token availability | mode-specific list above | missing → block |
| viewport completeness | 1 of 4 | warn for `recreate`/`extend`; fine for `analyze` |
| state completeness | hover/focus uncaptured | warn always; never blocks |

### Is the current gate too permissive or too strict?

**Too strict in one way:** it blocks on `zero-confidence-primary-component`
regardless of mode. An `analyze` request does not need a component at all.

**Too permissive in another:** it allows `recreate` whenever `contentReached > 0`
and the coverage factor clears 0.25 — the Stripe run passed with **zero
elevation tokens, zero border tokens, and one anatomy entry**, which is not
enough to rebuild anything faithfully.

Both are the same root cause: the gate does not know what was asked for. The
requirement matrix fixes both directions at once.

---

## 8. Promotion policy for new defects

Extends the Phase 1 rules:

| Rule | Policy |
|---|---|
| Filing | Any adversarial-matrix failure files a defect before any fix |
| Severity `critical` | Must have a failing regression test **before** the fix, proving the test detects it |
| `fixed` | Only when `regressionTest.status === "passing"` |
| Recurrence | ≥2 distinct references promotes a proposed rule to global |
| Site-specific | `scope: "reference"`; never changes global heuristics |
| Contested-evidence defects | Filed only after a disagreement recurs on ≥2 references — a single mismatch is a review item |

`helmy defects` continues to report `fixed`-without-passing-test separately.
A defect closed without a test is a defect waiting to return.

---

## 9. Deliverables

**Before implementation** (this document): plan · test matrix · evidence-source
schema · screenshot policy · hashed-classname strategy · spacing policy ·
threshold policy · defect promotion policy. ✅

**After implementation:** `PHASE-2-RESULTS.md` · updated defect log · regression
tests for A1–A15 · comparison across all reference workspaces · a recommendation
on fidelity-loop readiness.

### Readiness criteria for the fidelity loop

The recommendation will be **yes** only if all hold:

1. All six states in §0 are distinguishable by an automated check.
2. The hashed real-site run either succeeds or blocks with an accurate reason.
3. Spacing inference declines to answer on `fixtures/spacing-irregular/`.
4. Screenshot mode never emits a token file or an exact claim.
5. No contested claim renders as a bare number.
6. Every reference workspace produces a mode-appropriate verdict.

Anything short of that means the fidelity loop would be comparing a build
against an analysis that cannot vouch for itself — which is how a
confidently-wrong reference becomes a confidently-wrong implementation.

---

## 10. Implementation order

| Step | Work | Gate |
|---|---|---|
| 1 | Evidence-source schema + migration | existing 131 tests still pass |
| 2 | Spacing inference policy + 5 spacing fixtures | A7–A11 |
| 3 | Hashed-classname fixture + structural signatures | A1–A3 |
| 4 | Mode requirement matrix + gate rework | A13, A14 |
| 5 | Screenshot path + policy enforcement | A4–A6 |
| 6 | Vision disagreement handling | A12 |
| 7 | Live hashed-site run, failures recorded first | A15 |
| 8 | Results, defect log, readiness recommendation | all |

Steps 1–3 are foundational and land first. Step 7 is deliberately last: it is the
only step whose value depends on everything before it already being honest.

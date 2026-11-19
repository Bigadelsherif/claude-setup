# Phase 1 results

**Completion criterion:** the Stripe capture is either correctly analysed with
pricing content reached, **or** safely blocked with an accurate
insufficient-coverage report — and the system proves which.

**Result: correctly analysed.** Pricing content reached, verified, and safe.

---

## Before and after

| | Phase 0 | Phase 1 |
|---|---|---|
| Nodes sampled | 386 / 5804 (6.7%) | 2500 / 5804 — **82.7% of visible** |
| Primary region | never entered | `#MktContent` (31941 chars, 526 media) |
| Repeat groups in content | **0 of 12** | **15 of 15** |
| Primary component | `.RefreshedNavItem__link` (a nav link, conf 0.00) | `.PricingProductFeature__priceContainer` (57×, all painted, conf 0.95) |
| contentReached | 0 | **1.00** |
| Overall confidence | 0.71 *(dishonest)* | 0.61 = provenance 0.76 × coverage 0.80 |
| Breakpoints | 14, incl. 599/600, 899/900/901, 1111/1112 | 11 boundaries, 4 range-pairs collapsed, direction preserved |
| `border.default` | `#425466` — the text colour | `#e7ecf1` — an authored border |
| `surface.raised` | `#0a2540` — also bound to brand | `#ffffff`; no colour occupies two roles |
| Zero-value tokens | `--radius-button: 0px` emitted | suppressed, recorded as unknown |
| Safety verdict | *(did not exist)* | `usable-with-warnings` |

The confidence figure is the one to read closely. It **fell** from 0.71 to 0.61
while the analysis became dramatically more correct — because 0.71 was never
earned. Coverage now multiplies into it, and 0.80 coverage on a page with 49
unreachable stylesheets is an honest number.

## Fixture regression

Neither reference regressed.

| | Fixture | Mega-menu (new) |
|---|---|---|
| Coverage | 100% of visible | 100% of visible |
| contentReached | 1.00 | 1.00 despite 1483 hidden nodes |
| Component | `.card` at 12px (wrapper 16px avoided) | `.product-card` at 10px (wrapper 20px avoided) |
| Safety | `usable` | `usable-with-warnings` |

## The gate, demonstrated

Feeding a capture that never reached content into a workspace that previously
held a valid prompt:

```
confidence: 0.04 (provenance 0.31 × coverage 0.14)
SAFETY  ***BLOCKED***: unsafe-for-prompt-generation
   blocker  content-not-reached: No sampled node fell inside the primary content region.
   blocker  region-verification-failed: repeat-groups-in-main, content-region-sampled,
            largest-repeat-in-content, content-reached
   blocker  coverage-below-floor: Coverage factor 0.14 is below the hard floor of 0.25.
  wrote output/partial-design-spec.md
  wrote output/blocked-prompt.md
  removed stale output/design-spec.md
  removed stale output/rebuild-prompt.md
  removed stale output/fidelity-checklist.md
validation: 0 error(s), 0 warning(s)
```

The stale prompt removal matters as much as the block itself. A workspace that
flips from safe to unsafe while keeping its old `rebuild-prompt.md` is the most
dangerous state the system can be in, and validation rule **V8** now fails any
run that leaves one behind.

## What shipped

**New pipeline stages** — `src/coverage/assess.mjs`, `verify-region.mjs`,
`safety.mjs`.

**Extractor 0.2.0** — stratified sampling (50/15/10/15/10), hidden-subtree
skipping with recorded reasons, region tagging, overlay and consent detection,
breakpoint direction, currentColor tagging, image-painted surface nomination,
area-capped repeat scoring with a full-bleed penalty.

**Probe 0.2.0** — `paintedVia` discriminator plus `backgroundImage`.

**Component acceptance** — zero-confidence, anatomy-less, nav-derived, or
under-repeated groups are demoted to `componentCandidates` with stated reasons.
Component *identity* resolves to the outermost group of equal instance count
that the chosen group substantially fills.

**Defect reports** — a second record type for code-level failures, with a
`regressionTest.status` that makes "fixed" mean "provably fixed".
[`docs/DEFECT-LOG.md`](DEFECT-LOG.md) · 8 filed, 8 fixed, 7 with passing tests.

**Tests** — 131 passing, 30 new. All 12 required regression cases covered.

## Known gaps carried forward

- **Checks 2 and 7 of the real-site checklist remain unexercised.** Stripe uses
  readable BEM, so hashed classnames were never tested; and no vision evidence
  was produced, so the estimated-value rule was never under pressure. Both need
  purpose-built targets.
- **Stripe's spacing ramp has 21 entries.** Plausibly correct for a page that
  large, but the ramp filter is permissive and unproven.
- **Elevation tokens remain empty on Stripe.** The sampled surfaces genuinely
  carry no shadow; whether the pricing cards do is unverified.
- **Multi-viewport capture, state induction, and the fidelity loop** are still
  out of scope, as instructed.

# False negatives — Phase 4.5 calibration

**0 false negatives across 11 positive cases.** Every genuine defect was caught.

A false negative here means a detector staying silent where the declared
expectation was `mismatch`, `finding` or `actionable`.

## Cases

| Case | Defect | Magnitude | Result |
|---|---|---|---|
| `cal_01` | Container width | 1180 → 1080px | mismatch, high |
| `cal_07` | Grid gap | 24 → 32px | mismatch |
| `cal_09` | Brand colour | indigo → crimson | mismatch |
| `cal_11` | Radius | 12 → 0px | mismatch |
| `cal_12` | Body type | 16 → 18px | mismatch |
| `cal_13` | Content overflow | 1700px in 1440px | finding |
| `cal_15` | Occlusion | covered at 3 of 3 sample points | finding |
| `cal_17` | Stacking inversion | z-index 10 beneath z-index 2 | finding |
| `cal_19` | Focus ring | 2px solid → none | mismatch, high |
| `cal_20` | Tap target | 28px against 44px | finding, high |
| `cal_22` | Hover lift | −2px → −8px | mismatch |
| `cal_24` | `object-fit` on the same image | cover → contain | actionable |
| `cal_26` | 1.5× tolerance, both measured | — | medium or higher |

## What this does and does not show

**Does show:** no detector is inert. Each of the thirteen intrinsic checks, each
IR category and the state comparator all fire on a genuine defect, and severity
respects claim status rather than magnitude alone.

**Does not show:** the *smallest* defect each detector catches. Every positive
case is far above its threshold — the closest is `cal_26` at 1.5× tolerance, and
that case tests severity rather than detection. The boundary sweeps partially
cover this for the three numeric tolerances; the other fourteen have no boundary
evidence at all.

## The gap that matters most

A false negative is more dangerous than a false positive in this system, because
a missed defect is silent while a spurious one is visible and can be dismissed.
Nothing in this run bounds the false-negative rate near a threshold:

- **`intrinsic.samplePoints`** uses three points. A defect covering less than a
  third of an element may be missed entirely, and no case measures that.
- **`intrinsic.zIndexComparison`** detects an inversion only when the declared
  z-index numbers disagree with the paint order. An inversion whose numbers
  happen to agree is invisible, and no case constructs one.
- **`intrinsic.intentMarkers`** suppresses declared conditions. A genuine defect
  on an element that happens to carry `aria-hidden` or a `mask` class name is
  suppressed with it, and no case tests that collision.

All three are recorded in the tolerance matrix as `blocked-by-source-limit` or
`requires-more-evidence`, and `cand_05` records the intent-marker risk directly.

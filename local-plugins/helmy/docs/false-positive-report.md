# False positives — Phase 4.5 calibration

**0 false positives across 12 negative cases.** Every condition that should have
stayed silent stayed silent.

A false positive here means a detector reporting a finding where the declared
expectation was `no-finding`, `suppressed`, `demoted`, `not-actionable` or
`inadmissible`.

## Cases

| Case | Condition | Provenance | Result |
|---|---|---|---|
| `cal_02` | Antialiasing between two subpixel offsets | rendering-derived | silent |
| `cal_03` | Font rasterisation at identical 16px | rendering-derived | silent |
| `cal_04` | JPEG quality difference on one image | rendering-derived | silent |
| `cal_05` | Different copy in the same layout | spec-derived | comparative channel **suppressed** |
| `cal_06` | 3→1 column reflow on both sides | spec-derived | expected transformation |
| `cal_08` | 24px against 24.4px fractional layout | rendering-derived | silent |
| `cal_10` | `#3538cd` against `#3639ce`, one channel step | spec-derived | silent |
| `cal_14` | A carousel declaring `data-scrollable` | spec-derived | recorded, not a defect |
| `cal_16` | A decorative mask clipping a gradient | spec-derived | recorded, not a defect |
| `cal_18` | A defect present in both reference and target | spec-derived | **demoted**, no task |
| `cal_21` | Identical hover at different page positions | spec-derived | silent |
| `cal_23` | Different `object-fit` on two different images | spec-derived | not actionable |
| `cal_25` | 60× tolerance on an estimated claim | spec-derived | informational |
| `cal_27` | Unknown value on one side | spec-derived | inadmissible |
| `cal_28` | Contested reference claim | spec-derived | inadmissible |

## What this does and does not show

**Does show:** the six false-positive sources the phases identified are all
suppressed — copy differences, fractional layout, scroll-induced state movement,
declared intent, reference-correlated conditions, and content-incomparable image
pairs. Each was a real failure mode found by measurement in an earlier phase, and
each stays fixed under calibration.

**Does not show:** that the thresholds are correctly placed. No negative case
sits near a boundary. `cal_08` is 0.4px against a 1.5px tolerance — comfortably
inside. `cal_10` is one channel step against a boundary that the sweep locates
between four and eight steps. A tolerance could be twice as loose as it should
be and every one of these cases would still pass.

## The untested suppression

Two rendering-derived cases — `cal_02` antialiasing and `cal_04` image
compression — assert the *absence* of clusters rather than measuring a real
rendering pair through the diff backend. The comparative pixel channel is
unavailable for the fixtures that exist, because they are not equivalent-content
pairs. Recorded as `cand_04`; the floor these cases exist to test has not
actually been exercised against the thing it suppresses.

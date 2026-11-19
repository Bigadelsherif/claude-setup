# Threshold calibration — Phase 4.5

Baseline run, 2026-08-12. **507 tests passing, 0 failing** — 20 new.

**No tolerance was changed. `TOLERANCES.$validated` remains `false`.**

Source data: `fixtures/calibration/cases.json` (declared first),
`fixtures/calibration/tolerance-matrix.json`,
`fixtures/calibration/candidates.json`.

---

## 1. The headline

28 declared cases, **zero disagreements**. Every detector classified every case
the way the case declared it should.

That is not a validation result, and it is important to say why. Zero
disagreements means every case sat comfortably on one side of its threshold. It
tells you the detectors are not obviously broken; it tells you **nothing about
where the thresholds belong**. A calibration that only tests obvious cases
cannot distinguish a well-chosen value from a lucky one.

So the run does two further things:

- **boundary sweeps** locate where each numeric detector actually flips;
- **status is capped below `validated`** for every tolerance, because every case
  was authored in the same session as the detector it exercises — the exact
  condition `def_0012` was filed for.

---

## 2. Calibration status

Nothing reached `validated`, and nothing could have.

| Status | Count | Tolerances |
|---|---:|---|
| `provisionally-supported` | 3 | `TOLERANCES.px`, `TOLERANCES.fontSizePx`, `pixelDiff.channelTolerance` |
| `unvalidated` | 6 | `TOLERANCES.colorDistance`, `intrinsic.intentMarkers`, `intrinsic.contentComparable`, `state.propertyComparison`, `severityFor`, `admissibility` |
| `blocked-by-source-limit` | 8 | `intrinsic.tapMinimum`, `intrinsic.overflowPx`, `intrinsic.samplePoints`, `intrinsic.zIndexComparison`, `state.excludedProperties`, `correlation`, `progression-signature`, `content-mode gate` |
| `requires-more-evidence` | 0 | — |
| **`validated`** | **0** | **structurally unreachable from this evidence** |

`provisionally-supported` is the ceiling here, and it means: separates
spec- or rendering-derived cases in both directions, and needs a population
authored outside this session before it can be validated.

`blocked-by-source-limit` means a single case exercises the tolerance. One case
cannot separate a working threshold from a lucky one.

---

## 3. Boundary sweeps

Where each numeric detector actually flips — measured, not assumed.

| Tolerance | Value | Silent up to | Reports from | Verdict |
|---|---:|---:|---:|---|
| `TOLERANCES.px` | 1.5 | 1.5px | 1.6px | The boundary sits exactly where the constant says |
| `TOLERANCES.fontSizePx` | 0.5 | 0.5px | 0.6px | Same |
| `TOLERANCES.colorDistance` | 12 | 4 channel steps | 8 channel steps | **The boundary is located but its axis is unexamined** |

The colour row is the substantive finding. The flip is between four and eight
per-channel steps from `#3538cd` — but the distance function is not a calibrated
perceptual metric, so a threshold on it is a number on an unknown axis. Changing
12 to some other number would move the boundary without making it mean anything.
Recorded as `cand_01`; **not changed**.

---

## 4. Provenance

Every case records how it was authored, because provenance bounds what the
evidence can support.

| Provenance | Count | What it means |
|---|---:|---|
| `spec-derived` | 24 | Chosen from what the check is *for*, or from published guidance — WCAG contrast and tap targets, CSS pixel semantics — without consulting the detector's constants |
| `rendering-derived` | 4 | Produced by the browser: antialiasing, font rasterisation, image compression, fractional layout. Nobody chose these values |
| `detector-derived` | **0** | No case was written from the thresholds it tests |

**The limitation that caps everything:** all 28 cases were authored in the same
session as the detectors. Spec- and rendering-derived provenance reduces the
dependence but does not remove it. A case written from the specification by the
same author who wrote the implementation can still share a blind spot with it.

This is recorded in `cases.json` under `provenanceModel.singleAuthorLimitation`
and asserted by test.

---

## 5. False positives and false negatives

Detailed in [false-positive-report.md](false-positive-report.md) and
[false-negative-report.md](false-negative-report.md).

**False positives: 0 of 12 negative cases.** Antialiasing, font rendering, image
compression, 0.4px fractional spacing, a one-step colour change, an intentional
carousel, a decorative mask, and scroll-induced state movement all stayed
silent.

**False negatives: 0 of 11 positive cases.** A 100px container change, an 8px
spacing step, a hue change, a 12→0px radius, 16→18px body text, a 260px
overflow, a full occlusion, a stacking inversion, a missing focus ring, a 28px
tap target and a 2→8px hover lift were all caught.

Precision and recall are 1.000 across the board — on cases that never approach a
boundary. The figure is reported and should not be read as accuracy.

---

## 6. Claim-status awareness preserved

The existing rule holds under calibration and is asserted:

| Situation | Severity |
|---|---|
| 60× tolerance, estimated claim | `informational` — an estimate could never have supported the assertion |
| 1.5× tolerance, two measured claims | `medium` |
| 60× tolerance, two measured claims | `high` |
| 60× tolerance, inferred reference | `medium` — magnitude alone cannot carry high severity on an inferred claim |
| unknown on either side | **inadmissible** — tolerance logic never turns an unknown into a mismatch |
| contested reference claim | **inadmissible** — never calibrated as if exact |

---

## 7. Cross-category safety

Calibration must not create duplicate findings. Each is asserted:

- A **layout difference** does not become a second state mismatch — state
  comparison excludes viewport-relative geometry by construction (`def_0031`).
- A **viewport difference** does not become a same-viewport mismatch — the
  responsive comparator compares progressions, never values across widths.
- A **container change** does not also produce pixel clusters — the geometry
  suppression rule keeps the comparative channel out of it.
- A **content difference** does not become an image-crop defect — a crop claim
  requires the same image source.
- An **intentional scroll container** does not become an overflow defect.
- **Antialiasing** does not become a radius mismatch — it produces no cluster
  above the floor and no IR difference at all.

---

## 8. Calibration candidates

Five recorded, **none applied**.

| Candidate | Tolerance | Status | Why not changed |
|---|---|---|---|
| `cand_01` | `colorDistance` | requires-more-evidence | The metric's axis is unexamined; changing the number moves a boundary on an unknown scale |
| `cand_02` | `px` | provisionally-supported | Separates cleanly, but all evidence is synthetic and it is shared with the disagreement analyser |
| `cand_03` | `tapMinimum` | blocked-by-source-limit | 44 is Apple HIG; WCAG 2.2 AA says 24. Which standard applies is a product decision, not a measurement |
| `cand_04` | `minCluster` | requires-more-evidence | Antialiasing and compression were never diffed through the real backend |
| `cand_05` | `intentMarkers` | requires-more-evidence | Lengthening the vocabulary trades false positives for false negatives with no evidence about which is worse |

Each candidate records the evidence that would settle it, the regression test a
change would need, and what else the change could damage.

`cand_03` is worth singling out: the report has been citing 44px as *the*
minimum when two published standards disagree. That is an overstatement in the
existing output, and the candidate records it rather than quietly restating it.

---

## 9. Known uncertainty

1. **Single-author provenance caps every status.** No tolerance can be validated
   until a population authored elsewhere exercises it.
2. **No case lands near a boundary.** The sweeps locate the flips; the declared
   cases do not probe them. A tolerance could be off by a factor of two and this
   run would not notice.
3. **The colour metric is not perceptual.** A threshold on it is a number on an
   unexamined axis.
4. **Antialiasing and compression were not diffed through the real backend** —
   both cases assert the absence of clusters rather than measuring a real
   rendering pair.
5. **`intrinsic.tapMinimum` cites one of two conflicting standards.**
6. **Eight tolerances have a single case each** and are marked
   `blocked-by-source-limit` rather than assessed.
7. **No real reference/implementation population exists** to measure how often
   sub-2px differences occur in practice or whether they matter.

---

## 10. Completion criteria

| Criterion | State |
|---|---|
| All current tolerances evaluated or explicitly marked unvalidated | 17 tolerances in the matrix, every one with a status and recommendation |
| Independent fixture provenance recorded | Per case; 0 detector-derived; single-author limit recorded and asserted |
| False-positive and false-negative behaviour reported | 0 and 0 across 23 directional cases, with the limitation stated |
| No tolerance changed without evidence | **No tolerance changed at all** |
| All new tests pass | 20/20 |
| All previous tests pass | 507/507 |
| `TOLERANCES.$validated` changed only if evidence supports it | Unchanged at `false` |
| Remaining uncertainty documented | §9, plus five candidates |

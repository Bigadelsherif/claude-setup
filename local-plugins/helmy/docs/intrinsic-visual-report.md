# Intrinsic visual checks — Phase 4.4

Measured 2026-08-12. **487 tests passing, 0 failing** — 35 new.

Source data: `fixtures/intrinsic/phase44-result.json`,
`fixtures/intrinsic/reference-correlation.json`,
`fixtures/intrinsic/checks/`.

---

## 1. What intrinsic means

Every check holds or fails on **one render of one page**. That is what makes
them usable when the reference and the target carry different content — the
condition that disabled comparative pixel diffing in Phase 3.4.

The probe (`tools/intrinsic-checks.mjs`) produces facts. Whether a fact is a
*defect* turns on two things the probe cannot know, and both are decided in
`src/fidelity/intrinsic.mjs`:

- **intent** — a carousel that scrolls and a container that scrolls by accident
  are the same measurement and different findings;
- **correlation** — a condition the reference also has is not a target defect.

---

## 2. The thirteen checks

All thirteen fire on the controlled fixtures. Each is independent and separately
reported.

| # | Check | Detection | 1440 defects | 375 defects |
|---|---|---|---:|---:|
| 1 | `content-overflow` | box-measurement | 1 | 1 |
| 2 | `accidental-clipping` | box-measurement | 2 | 3 |
| 3 | `occlusion` | hit-test | 4 | 1 |
| 4 | `stacking-order-inverted` | hit-test | 1 | 0 |
| 5 | `unexpected-horizontal-scrollbar` | box/computed | 1 | 1 |
| 6 | `unexpected-vertical-scrollbar` | computed-style | **0 (demoted)** | **0 (demoted)** |
| 7 | `viewport-overflow` | box-measurement | 1 | 0 |
| 8 | `image-crop-mismatch` | natural-size | 1 | 1 |
| 9 | `object-fit-mismatch` | computed-style | 1 | 1 |
| 10 | `text-truncation` | box-measurement | 2 | 3 |
| 11 | `focus-indicator-invisible` | computed-style | 5 | 5 |
| 12 | `tap-target-undersized` | box-measurement | 1 | 1 |
| 13 | `fixed-sticky-collision` | hit-test | 4 | 5 |

Three further checks are recorded and **never** reported as defects:
`intentional-clipping`, `declared-scroll-container`, and the
`object-fit-observation` / `focus-indicator-observation` context records. Two
more preserve an unanswered question rather than guessing: `image-crop-unknown`
(no readable natural size) and `focus-target-offscreen`.

---

## 3. Correlation

| Outcome | Controlled | Real target |
|---|---:|---:|
| `target-only` | 27 | 0 |
| `unknown` | 25 | 166 |
| `reference-correlated` | **2** | 0 |
| `reference-only` | 2 | 0 |

**Reference-correlated → demoted.** The fixtures share one condition on
purpose: both sides give `#vscroll` a height it cannot hold. The target's
finding is demoted to `informational`, marked `actionable: false`, excluded from
the defect count, and **generates no correction task**. Its reference evidence
is preserved rather than dropped.

**Target-only → full severity.** The focus indicator is removed on the target
only; the reference has the same elements *with* a ring. Severity stays `high`
and a task is generated.

**Unknown → neither promoted nor demoted.** `#target-only-widget` has no
counterpart in the reference, so the reference offers no evidence either way.
The target finding is preserved at its base severity with the limitation
recorded on the finding. The distinction between "the reference has this element
without the condition" and "the reference has no such element" is what the
probe's `allSelectors` list exists to make decidable.

**Reference-only → not a target defect.** A condition in the reference that the
target lacks is classified `missing-reference-behaviour-or-unknown` at
`informational`, with the detail stating plainly that whether it is required
design behaviour or a reference defect the target avoided is *not decided from
this evidence*.

---

## 4. False positives refused

Two conditions in the fixtures exist to be *not* reported:

- **`.scroller`** declares `data-scrollable` and is a carousel. It scrolls
  horizontally by design and is recorded as `declared-scroll-container`, never
  as an unexpected scrollbar. The undeclared `#vscroll` beside it still trips
  the check, so the distinction is doing work rather than suppressing the check.
- **`.mask`** declares `data-decorative` and clips a gradient into a rounded
  shape. Recorded as `intentional-clipping`. The accidental `#clipbox` beside it
  is still reported.

**Crop claims require comparable content.** An `object-fit` difference between
two images that are not the same source is recorded but marked non-actionable
and informational, with the limitation stated: no crop equivalence can be
established. An image with no readable natural size produces `image-crop-unknown`
rather than a crop claim.

---

## 5. Real-target validation

Selection recorded **before** capture in
`fixtures/intrinsic/real-target-selection.json`, per the standing rule that no
fixture written by the code's own author may be the only witness (`def_0012`).

**nextjs.org/showcase at 1440px** — 362 elements, 166 findings across **nine
distinct check kinds** on markup nobody here wrote:

```
occlusion 36 · tap-target-undersized 57 · object-fit-observation 31
stacking-order-inverted 18 · accidental-clipping 8 · focus-indicator-observation 8
focus-indicator-invisible 4 · content-overflow 2 · fixed-sticky-collision 2
```

Every correlation is `unknown`, because no reference exists for it — and that is
the behaviour under test rather than a shortcoming. Nothing measured on the real
target promotes or demotes any severity, and nothing there changed a threshold.

---

## 6. Mode behaviour

| Mode | Decision | Behaviour |
|---|---|---|
| **analyze** | allowed | Every finding with evidence and limitations; target-only findings warn |
| **recreate** | **blocked** | Only when a finding prevents *reliable comparison* — `viewport-overflow` and `unexpected-horizontal-scrollbar`. A small tap target does not block |
| **adapt** | allowed | Reference behaviour, target-brief requirements and target mismatches listed separately; a brief-sanctioned change is not also a mismatch |
| **improve** | allowed | Observations and proposals structurally separate; every proposal reads `**Proposed:**` and carries `observedInReference` |

The recreate rule is worth stating precisely: a defect existing is not grounds
to block. A page that overflows its viewport cannot be compared meaningfully,
because the comparison would measure the overflow rather than the design.

---

## 7. Tasks

25 at 1440, 23 at 375. **All manual** — an intrinsic defect is fixed by changing
layout or styling rules, not by substituting a measured value, and component
identity is unresolved across implementations (`def_0030`).

Each carries: id, check, viewport, state, category, severity, reference
evidence, target evidence, current value, expected value, affected region,
affected selector, confidence, mode, acceptance condition, classification and
limitations.

The 375px tap-target task carries
`classification: "responsive-accessibility-mismatch"` at `high` severity, with
the shortfall stated rather than implied.

---

## 8. Limitations

1. **Intent is read from declared markers** — `data-scrollable`,
   `data-decorative`, `aria-hidden`, `role="presentation"`, and a small
   vocabulary of class-name stems. An undeclared but deliberate condition reads
   as accidental. This is the check family's main false-positive source and it
   is not solved, only bounded.
2. **Two viewports, one state.** 1024 and 768 were not captured for intrinsic
   checks, and only the `default` state was run. The model is viewport- and
   state-keyed and would carry the rest without change.
3. **Occlusion uses a three-point sample grid**, not full coverage analysis. A
   condition that misses all three points is missed.
4. **Stacking inversion is detected by hit-test plus declared z-index**, not by
   reconstructing stacking contexts — deliberately, per the plan. A genuine
   inversion whose z-index numbers happen to agree with the paint order is not
   detected.
5. **Focus checks move focus** to read the indicator. Any page that reacts to
   focus with navigation or network activity would be perturbed by the check.
6. **No screenshot evidence** is attached to intrinsic findings; the record
   reserves the field.
7. **Thresholds remain unvalidated.** The 44px tap minimum and the 2% aspect
   tolerance were chosen, not measured.

---

## 9. Completion criteria

| Criterion | State |
|---|---|
| All 13 checks represented | 13/13, each emitted and separately reported |
| Each check has controlled test coverage | 13 detection tests + 22 behaviour tests |
| At least one real target tested | nextjs.org/showcase, 9 check kinds, selection recorded first |
| Reference-correlated findings demoted | 2 demoted, no tasks generated, asserted |
| Target-only findings remain actionable | 27, full severity, tasks generated |
| Unknown reference evidence stays unknown | 25 controlled + 166 real, neither promoted nor demoted |
| Responsive and state coverage separate | per-viewport and per-state records, asserted |
| All previous tests pass | 487/487 |
| No unsupported pixel-perfect or production-ready claim | asserted by test |

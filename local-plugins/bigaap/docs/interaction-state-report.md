# Interaction-state fidelity — Phase 4.3

Measured 2026-08-12 against controlled fixtures at 1440px and 375px.
**452 tests passing, 0 failing** — 31 new.

Source data: `fixtures/states/phase43-result.json`,
`fixtures/states/state-coverage.json`, `fixtures/states/captures/`.

---

## 1. The two rules

**Compare a state only when both sides have evidence for it.** An unavailable
state is recorded with its reason and is never a mismatch. The target here does
not implement `loading` at all; that is reported as `unavailable`, not as a
failure to match, and the state is not invented.

**Compare what the state does, not where its element sits.** Viewport-relative
geometry is excluded by construction — inducing a state scrolls its element into
view, so a coordinate measures the scroll as much as the state (`def_0031`). A
layout difference stays in the layout category and is never counted twice.

---

## 2. Results

All nine states, both viewports. The target deliberately fails two.

| State | Trigger | Status | Observation |
|---|---|---|---|
| default | none | matched | observed-in-both |
| hover | pointer | matched | observed-in-both |
| **focus** | keyboard | **mismatched** | observed-in-both |
| active | pointer-down | matched | observed-in-both |
| selected | attribute | matched | observed-in-both |
| expanded | declared-route | matched | observed-in-both |
| **loading** | declared-route | **unavailable** | observed-only-in-reference |
| empty | declared-route | matched | observed-in-both |
| error | declared-route | matched | observed-in-both |

`states` category: **score 0.875, evidenceCoverage 0.889** at both viewports.
Eight of nine states had two-sided evidence; seven of those eight agreed.

Two special cases:

- **Untriggerable** (`#no-trigger`, no induction declared) → `unknown`, reason
  preserved, not a mismatch.
- **Deep-scroll** (`#deep`, 1400px down the page, identical hover on both
  sides) → `matched`. Inducing it scrolls the element and changes its
  viewport-relative geometry; nothing about that reaches the comparison.

### The focus difference

```
outlineStyle   reference "solid"  target "none"    high
outlineColor   reference accent   target default   high
outlineOffset  reference 2px      target 0px       high
state-has-effect  reference true  target false     high
```

### The loading state

The target applies `?state=loading` and renders default content. The capture
checks that the state's own evidence actually rendered, so the route being
accepted is not mistaken for the state existing:

```
loading  unavailable  captureStatus: state-not-implemented
         reason: "the route was applied but `.region__loading` never rendered"
```

---

## 3. Six statuses, all reachable

| Status | Meaning | Where it occurs |
|---|---|---|
| `matched` | both sides had evidence and it agrees | 7 states |
| `mismatched` | both sides had evidence and it differs | focus |
| `unavailable` | reached, and not implemented on one side | loading |
| `unknown` | could not be reached at all | untriggerable |
| `blocked` | the requested mode requires it and it is missing | recreate with `loading` critical |
| `not-applicable` | the state does not apply to this component | asserted directly |

`unavailable` and `unknown` are kept apart deliberately: one is a fact about the
implementation, the other about the capture.

---

## 4. Accessibility findings

| Check | Severity | Correlation | Finding |
|---|---|---|---|
| `visible-focus` | **high** | target-only | The target renders no focus indicator where the reference does |
| `hover-only-behaviour` | **high** | target-only | Hover changes something with no keyboard equivalent |
| `loading-state-communication` | medium | target-only | No loading state, so a slow response communicates nothing |
| `tap-target-dimensions` | **high** | target-only | 37px against a 44px minimum at 375px |

The **375px tap-target finding is preserved at high severity** and carries
`classification: "responsive-accessibility-mismatch"`. It was not silently fixed
and its severity was not reduced. It produces a manual correction task.

A condition present on *both* sides is demoted to `informational` and marked
`reference-correlated` — a target reproducing the reference's missing focus ring
is not diverging from it. Asserted directly by test.

---

## 5. Mode behaviour

| Mode | Decision | Behaviour |
|---|---|---|
| **analyze** | allowed | Reports available states, preserves unknown ones, warns rather than blocks |
| **recreate**, `loading` critical | **blocked** | The one requested critical state lacks evidence |
| **recreate**, `loading` not critical | allowed-with-warnings | An optional unavailable state does not block |
| **recreate**, hover+focus critical | allowed-with-warnings | Both have evidence |
| **adapt** | allowed | `observedStatePrinciples` (source: reference-evidence) kept separate from `targetRequiredStates` (source: target-brief-requirement) |
| **improve** | allowed | `observations` and `proposals` structurally separate; every proposal reads `**Proposed:**` and carries `observedInReference: false` |

A brief may request a state the reference does not have. That is labelled a
target decision, and the missing state is never invented.

---

## 6. Correction tasks

Eight per viewport — four focus-property differences plus four accessibility
findings. Every one carries state, viewport, category, severity, reference
evidence, target evidence, current value, expected value, confidence,
manual/automatic status and an acceptance condition.

**All state tasks are manual.** A state treatment is applied through a selector,
and Phase 3.2 measured that deploy-safe selectors barely exist without author
hooks; component identity is also unresolved across implementations
(`def_0030`).

---

## 7. Motion and timing

Animation freezing was **available** for every capture and is recorded per
capture rather than assumed. No state record asserts a duration or an easing
curve — asserted by test. Where freezing fails, the limitation is written onto
the category and no timing claim is drawn.

---

## 8. Limitations

1. **States are induced one at a time** and read as computed values. A state
   whose effect is purely compositional is not captured.
2. **`changedFromDefault` is only measurable for induced states.** A route- or
   attribute-reached state is already in effect at load, so there is no rest
   reading; it reports `null`, not `false`. Recording `false` would assert the
   state does nothing.
3. **Screenshot evidence per state is not captured.** The record reserves the
   field; the slice populates computed evidence only.
4. **Two viewports, not four.** 1024 and 768 state captures were not taken;
   the model is viewport-specific and would carry them without change.
5. **`not-applicable` has no fixture.** It is reachable and asserted directly,
   but no controlled page exercises it.
6. **The accessibility checks are state-derived**, not a full audit —
   keyboard-reachability is inferred from focus evidence rather than by walking
   a tab order.

---

## 9. Completion criteria

| Criterion | State |
|---|---|
| All nine state categories represented | 9/9 |
| At least six states with controlled tests | 8 states compared, 7 with dedicated tests |
| Unavailable states remain unknown | `loading` unavailable, untriggerable unknown, neither a mismatch |
| State comparison does not duplicate layout | geometry excluded by construction, asserted two ways |
| Focus and accessibility states represented | 4 checks, focus at high severity |
| Viewport-specific state evidence | 1440 and 375, separate records |
| All previous tests pass | 452/452 |
| No unsupported motion or timing claims | asserted by test |
| 375px tap-target finding visible and classified | high severity, `responsive-accessibility-mismatch` |

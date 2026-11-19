# Plan validation against the existing extractor and IR

Step 1 of the Phase 3.4 sequence. The plan named nineteen comparison
dimensions; this checks each against what the IR actually contains, before any
comparator is written.

Checked against `fixture-1440` (the controlled reference) run through the full
pipeline at `recreate`.

## Available as planned

| # | Dimension | IR path | Form |
|---|---|---|---|
| 1 | Content-region reach | `coverage.contentReached` | ratio |
| 2 | Container width | `layout.containers[].maxWidth` | claim node |
| 3 | Container padding | `layout.containers[].paddingX` | claim node |
| 4 | Grid columns | `layout.grids[].columns` | claim node |
| 5 | Grid gaps | `layout.grids[].gap` | claim node |
| 7 | Typography | `tokens.typography`, `scales.typeRamp` | claim nodes + array |
| 8 | Colour roles | `tokens.color.*` — six roles | claim nodes, keyed by role |
| 9 | Radii | `tokens.radius`, `scales.radiusLadder` | claim nodes + array |
| 10 | Borders | `tokens.border.default` | claim node |
| 11 | Shadows | `tokens.elevation.card` | claim node |
| 12 | Component count | `components[].instanceCount` | claim node |
| 13 | Component identity | `components[].identity` (Phase 3.3) | structured |
| 14 | Component anatomy | `components[].anatomy` with `part` | array |
| 15 | Surface classification | `components[].surfaceClassification` + `surface` + `surfaceObserved` | enum + explicit null |
| 18 | Motion | `motion.transitions[].duration`/`.easing` | claim nodes |
| 19 | Accessibility | `a11y.contrastFindings[]` | structured |

Every one of these carries `status`, `confidence` and `evidence`, which is what
§4.3 admissibility and §4.5 difference records need. No adaptation required.

## Three corrections to the plan

**Dimension 6 — section spacing does not exist in the IR.**
There is no `layout.sectionSpacing`. What exists is `scales.spacingBaseUnit`,
`scales.spacingRamp` and `scales.spacingObserved`. Comparing raw section gaps
was never possible; comparing the *spacing system* is, and is the more useful
comparison anyway — a target built on an 8px base with a matching ramp is
faithful even where an individual gap differs. **The Spacing category compares
base unit, ramp and observed-value set. "Section spacing" is dropped as a
named dimension** rather than faked from margins.

**Dimension 16 — responsive is empty at one viewport.**
`ir.responsive` is `{}` on a single-viewport capture. The vertical slice is
explicitly one viewport, so the Responsive category will report
`score: null, evidenceCoverage: 0`. That is the designed behaviour, not a
failure, and it is worth seeing exercised in the slice.

**Dimension 17 — interaction states are `unknown` on both sides.**
`states.hover` and `states.focusVisible` carry `status: "unknown", reason: "Not
induced in Phase 0."` on every capture. The States category will also report
`score: null, evidenceCoverage: 0`. Recorded in the plan's §14.6 already; this
confirms it against the data.

## Consequence

Seventeen dimensions are comparable, two are structurally unavailable at one
viewport, and one is replaced by a better-founded comparison. The eleven
categories stand; two of them will legitimately report `null`.

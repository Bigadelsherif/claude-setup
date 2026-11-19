# Unpainted components — Phase 3.3

Measured 2026-08-12 against eleven controlled fixtures and one real page. Source
data: `fixtures/unpainted/baseline.json`, `fixtures/unpainted/truth.json`,
`fixtures/unpainted/mode-evaluation.json`.

---

## 1. The baseline

Before any code change, the current system was run against the ten fixtures.

**Nine of ten produced no component at all.** Every one was rejected with the
same two reasons:

```
zero confidence | no resolvable anatomy
```

Text-only feature rows, navigation items, link lists, pricing rows, table rows,
icon-label pairs, borderless tiles, a shared layout wrapper and the incoherent
control — all rejected. The only fixture that produced a component was
`painted-descendant`, the one whose inner div paints.

The rejection was never a judgement about the evidence. Anatomy was assembled
from five surface properties and confidence was their mean, so a component that
paints nothing had an empty anatomy array and a confidence of zero **by
construction**. Every affected group had 5 to 8 instances, sat inside a verified
content region, and carried readable project class names.

One confounder was removed before the baseline was recorded: four fixture pages
were too short for region verification's 200-character substantiality
threshold, which would have mixed "the page is small" into "the component is
unpainted". The pages were enlarged with an intro paragraph. No production code
was touched.

---

## 2. What the system can now identify without a painted surface

| Fixture | Component | Classification | `surface` | Non-surface properties |
| --- | --- | --- | --- | ---: |
| Text-only feature rows | `.feature` | `text-only` | **null** | 5 |
| Navigation items | `.topnav__item` | `text-only` | **null** | 3 |
| Link lists | `.linklist__item` | `text-only` | **null** | 4 |
| Pricing rows | `.plan` | `painted-border` | border only | 3 |
| Table rows | `.metrics__row` | `text-only` | **null** | 5 |
| Icon-label pairs | `.chip` | `text-only` | **null** | 5 |
| Borderless tiles | `.tile` | `text-only` | **null** | 5 |
| Wrapper + painted child | `.vehicle` | `descendant-painted` | on `div.vehicle__surface` | 4 |
| **Real: nodejs.org/en/blog** | `.index-module__c6PDtG__container` | `text-only` | **null** | 5 |

Identity is established from repeated structure, semantic role, tag and child
sequence, parent region, geometry, spacing relationships, icon-text pattern,
content role and style fingerprint — none of which is a surface. The real
component scores 16 on identity evidence with zero surface anatomy entries,
which is precisely the state the old model could not represent.

## 3. What it cannot identify

| Fixture | Outcome | Assessment |
| --- | --- | --- |
| Shared layout wrapper | No component emitted | **Partial pass.** The requirement — the wrapper must not be mistaken for a component — is met, and `.split__cell` is rejected as "a container, not a component: its instances hold different things". But neither `Statistic` nor `Testimonial` is identified either, because the pipeline emits at most one primary component per capture. Separating two components that share a wrapper needs multi-component extraction, which this phase did not build. |
| Incoherent unpainted group | No component emitted | **Pass.** Rejected as "not internally coherent: members disagree on identity, region, structure, geometry". |
| Navigation items | Component modelled; all four modes blocked | The component resolves correctly. Every mode blocks on `not-nav-dominated` — a page whose every repeat group is navigation genuinely is nav-dominated. The guard was not weakened to make a fixture pass. |

---

## 4. When surface absence is meaningful, and when it is merely unknown

This is the distinction the phase turned on, and both states carry
`surface: null`. What separates them is `surfaceObserved`.

| State | `surface` | `surfaceObserved` | Classification | Licenses |
| --- | --- | :--: | --- | --- |
| Measured absence | `null` | `true` | `text-only`, `layout-only`, `none` | A prompt may state "this component has no background" |
| Question unanswered | `null` | `false` | `unknown` | Nothing. The guard blocks recreate. |

`def_0026` was the failure that made this real. `resolveSurface` consulted the
probe only when it found something painting; when the probe ran and reported
`paints: false`, the result was discarded and the aggregate fallback reported
`unknown`. All seven genuinely unpainted fixtures classified as `unknown`
despite complete probe coverage — positive evidence of absence converted into
absence of evidence, which then blocked recreate for a reason that did not
apply.

---

## 5. Can recreate safely proceed?

Yes, under the guard, and the guard has teeth.

| Case | Non-surface properties | Guard | recreate |
| --- | ---: | --- | --- |
| `sparse-anatomy` (bare divs, one text node) | 2 | **blocks** | blocked |
| `text-rows`, `table-rows`, `icon-labels`, `spacing-cards` | 5 | allows | allowed-with-warnings |
| `link-list` | 4 | allows | allowed-with-warnings |
| `nav-items` | 3 | allows | blocked, on nav-dominance |
| `pricing-rows` (painted, thin surface evidence) | 3 | n/a | **blocked** on surface anatomy |
| **Real nodejs.org/en/blog** | 5 | allows | allowed-with-warnings |

`sparse-anatomy` was added specifically so the guard could be seen to block
something. Without it, "the guard never fired" would have been
indistinguishable from "the guard does not work".

Two adjustments were needed before it could fire at all. Computed font-size and
"carries text" are true of nearly every element, so counting them handed every
component free properties. Typography now counts only when it departs from the
page default — a decision someone made about the component — and content
hierarchy requires an ordered arrangement, not merely the presence of text.

`pricing-rows` blocking is the counterpart rule: a component that **does** paint
is judged on its surface evidence, and structural evidence may not substitute
for it. That preserves the original Phase 1 finding about `stripe-pricing-1440`,
which would otherwise have been let through by structural entries appearing in
the same anatomy array (`def_0028`).

---

## 6. No visual styling is invented

The rebuild prompt for an unpainted component now states the absence, lists only
evidenced structure, names what must not be invented, and gives acceptance
criteria:

```
**No painted surface was observed on this component** (`surface: null`,
classified `text-only`).

Evidenced without reference to any painted surface:
- tag: <div>
- child-structure: `h3,p`
- spacing: 8px gap
- repeated-geometry: geometry class `16:wide`
- content-hierarchy: heading-led content structure `h3,p`

**Do not invent** a background, border, border-radius, box-shadow or elevation
for this component. None was observed, and adding one would be your design
decision presented as the reference's.
```

For a painted descendant it names the owning element instead:

```
**This component paints nothing itself.** `div.vehicle__surface` inside it
carries the surface.

Put the background, border, radius and shadow on `div.vehicle__surface`, not on
`.vehicle`. The outer element is the component; the inner one is how it is
painted.
```

`def_0029` was caught by the test asserting this. The prompt was stating "no
painted surface was observed" and then, four lines later, listing
`background: transparent` and `padding: 0px` — because `resolveSurface` reports
the values it read even when nothing paints. The contradiction was invisible in
every summary view; it needed the prompt text to be read.

**adaptation-prompt.md** preserves the absence by default and labels any
introduced surface as a target decision:

> **Target decision, not reference evidence:** the brief describes VehicleCard
> as a surface-bearing component, so introducing a background, border or
> elevation is a deliberate departure from the reference. Take those values from
> the target's own token set — the reference cannot supply them, because it has
> none.

**improvement-prompt.md** records the absence as an observation, in the observed
section, leaving anything about adding a surface to the proposal section under
its own marker.

---

## 7. Defects

All seven filed with the full record before any fix.

| ID | Severity | Summary |
| --- | --- | --- |
| `def_0023` | critical | Anatomy defined as surface, so nine of ten unpainted fixtures produced no component. |
| `def_0024` | high | With nothing painting, scoring picked the text-bearing leaf: `.feature__title` instead of `.feature`, in five of ten cases. |
| `def_0025` | high | The IR had no field for the painted descendant, so a wrapper's inner surface was reported as the component's own. |
| `def_0026` | high | Probe evidence of absence was discarded; all seven unpainted fixtures classified `unknown`. |
| `def_0027` | medium | A border-only component read as unpainted; only `borderTopColor` was captured. |
| `def_0028` | high | The anatomy guard was computed, recorded, and never consulted — in both directions. |
| `def_0029` | high | `background: transparent` emitted as anatomy on a component with `surface: null`. |

`def_0027` was fixed **without** widening `paints()`. That predicate feeds
`paintedCount`, which feeds repeat scoring, region verification and primary
selection; broadening it would have changed component selection across every
capture in the repository to fix a classification problem.

---

## 8. Limitations

1. **One component per capture.** The shared-wrapper case rejects the wrapper
   correctly and identifies neither component inside it. Multi-component
   extraction was not built.
2. **`layout-only` is now rare.** Since text is read from the subtree rather
   than direct text nodes, almost any container with content classifies
   `text-only`. `layout-only` survives for genuinely empty structural nodes.
   Two truth declarations were corrected after measurement, recorded in
   `truth.json` under `declarationCorrected` rather than edited away.
3. **`inherited-surface` and `image-painted` are unexercised.** Both are in the
   classification model; no fixture produces either, so neither is tested
   against real behaviour.
4. **Identity thresholds are unvalidated.** A score of 6, or one sufficient
   basis. They separate every case here cleanly, which is weak evidence from
   twelve captures.
5. **Captures predating coherence instrumentation cannot be assessed for
   identity.** They are passed through rather than rejected — unknown is not
   false — so the identity gate simply does not apply to historical goldens.
6. **One real witness.** nodejs.org/en/blog. `def_0025`'s wrapper-with-painted-child
   pattern still has only fixture evidence.

## 9. Test state

**334 passing, zero failures.** 19 new in Phase 3.3 (`tests/unpainted.test.mjs`);
all 315 from earlier phases still pass, with one expectation deliberately
changed and documented in §2 of
[component-model-report.md](component-model-report.md).

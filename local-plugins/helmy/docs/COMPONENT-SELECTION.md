# Component selection and evidence quality

How the primary component is chosen today, why that is not the same question as
"which component is best evidenced", and what a diagnostics phase would owe a
reader. Written from measurements across every capture in this repository; the
numbers below are reproducible from the fixtures named beside them.

**Nothing in this document changes selection behaviour.** It describes what the
tool does now. The diagnostics contract below was proposed here and is
**implemented as of Phase 5.26** — `ir.componentDiagnostics`, read by nothing
that decides anything.

## Two questions, deliberately separate

| | Asks | Answered by |
| --- | --- | --- |
| **Selection** | which repeated element *is* this page's component | `detectRepeats` score, then `selectPrimaryRepeat` |
| **Sufficiency** | can *that* element be rebuilt from what was observed | the `component-anatomy` requirement |

Selection is structural. It ranks on repetition and occupied area, damped
equally (`√count × √area`), with multipliers for content region, painting, text
and navigation. Sufficiency is evidential: it counts resolved surface properties
on whatever selection produced, and refuses below three.

The two can disagree, and when they do the run is refused. That refusal is the
subject of this note.

## The disagreement, measured

For every repeat group in every capture, ranked by score, against the number of
surface properties its probe row actually resolved. `unknown` means no probe row
or no painted surface — not zero properties.

**`fixtures/tailwind-arbitrary/` (produx.design)**

| Rank | Score | Instances | Area | Resolved | What it is |
| --- | --- | --- | --- | --- | --- |
| **0** | 13127 | 3 | 177,282 | **2** | testimonial card, 410×432 — selected, refused |
| 3 | 10169 | 7 | 45,594 | 2 | |
| 5 | 9481 | 13 | 12,629 | 0 | |
| 14 | 6838 | 18 | 4,744 | **3** | 129×37 text chip, 9% of viewport width |

**`.ui-analysis/stripe-pricing/`**

| Rank | Score | Instances | Area | Resolved | What it is |
| --- | --- | --- | --- | --- | --- |
| **0** | 109258 | 57 | 102,060 | **2** | price container, 364×158 — selected, refused |
| 9 | 41144 | 23 | 1,352,548 | **3** | 810×1670 — a page section |

**`.ui-analysis/p30/`, `.ui-analysis/mega-menu/`, `fixtures/component-selection/resolved/`**

Selection and evidence agree. Rank 0 resolves the most properties (5, 3 and 5
respectively). On p30 and mega-menu ranks 0 and 1 tie because they are the same
component at two depths — `.card__inner` and `.card` — which is the relationship
`outermostOfSameComponent` exists to collapse.

## What the disagreement actually contains

On both captures where a lower-ranked candidate resolves more properties, **that
candidate is structurally the wrong element**, and wrong in the two specific ways
the scorer was built to prevent:

- stripe's rank 9 is **810 × 1670 pixels** — 56% of the viewport wide and taller
  than the fold. A section wrapper. Selecting it is the failure `def_0008` capped
  area to prevent.
- produx's rank 14 is **129 × 37 pixels**, all 18 instances text-bearing. A pill
  or chip. Selecting it is the failure `def_0053` damped count to prevent.

A section resolves three properties because sections have backgrounds and
padding. A chip resolves three because chips have a background, a radius and
padding. Neither fact makes them the page's component.

So the evidence-richest candidate is systematically **either too large or too
small**. This is not a coincidence of two captures; it follows from what a
surface is. Large wrappers and small chips are the elements most likely to carry
a complete, simple surface, precisely because they are not composed of parts.

## Why "try candidates until one passes" is the wrong repair

It is the obvious repair and it would defeat both prior fixes at once. Walking
down the ranking until the anatomy requirement is satisfied would have selected a
page section on stripe and a text chip on produx — the two outcomes `def_0008`
and `def_0053` were filed to stop. The gate would report `satisfied`, a rebuild
prompt would be emitted, and it would describe the wrong element with complete
confidence.

It also changes what the requirement means. `component-anatomy` currently asks
"is the page's primary component rebuildable". Under candidate-retry it would ask
"does the page contain any repeated element that is rebuildable", which is nearly
always yes and therefore nearly never informative.

The current behaviour — choose structurally, refuse honestly — is correct. What
is missing is not a different choice. It is **visibility into the choice**.

## What a reader cannot currently see

When `recreate` refuses on `component-anatomy`, the output names the selected
component, its resolved property count and the threshold. It does not say:

- what else was ranked, or where the selected element placed
- what the score was composed of, so a reader can tell whether repetition or
  area carried it
- how many candidates had probe data at all, so a reader can tell whether
  "resolved 2" is a fact about the element or an artifact of a 15-selector probe
  budget
- whether any other candidate resolved more, and what that candidate's geometry
  is — the information that lets a person decide the refusal is right

`ir.repeatedStructures` (Phase 5.18) lists lower-ranked groups with instances,
region and geometry, and deliberately carries **no** surface data, because its
contract is "these are not components". Extending it with resolved-property
counts would blur exactly the line it exists to draw. Diagnostics belong beside
it, not inside it.

## The contract, as implemented (Phase 5.26)

Optional `ir.componentDiagnostics`, read by nothing that decides anything.
`tests/phase527-component-diagnostics.test.mjs` D14 scans every module that
decides something — selection, requirements, evaluation, safety, coverage,
region verification and the prompt projections — and fails if any of them so
much as mentions the field or `wouldSatisfyAnatomy`.

```
componentDiagnostics: {
  selected: {                       // repeated from candidates[] for convenience
    rank, signature, stableSelector,
    resolvedProperties: <int|null>,
    confidence: <number|null>,
    wouldSatisfyAnatomy: <bool|null>,
    wouldSatisfyBasis: <string>,
    structuralNote: "section-scale" | "chip-scale" | "within-component-scale" | "scale-unknown"
  },
  candidates: [ {
    rank, selected, signature, stableSelector, score, instances, area,
    sample: { width, height }, region, inPrimaryRegion, paintedMembers,
    resolvedFrom: "probe" | "not-probed",
    resolvedProperties: <int|null>,     // null = no probe row; 0 = probed and empty
    confidence: <number|null>,          // only the selected candidate has one
    wouldSatisfyAnatomy: <bool|null>,
    wouldSatisfyBasis: <string>,
    structuralNote: <as above>
  } ],
  probeCoverage: { candidates, probed, unprobed, probeRan, note },
  thresholds: { minProperties: 3, minConfidence: 0.5, note },
  limits: { explanatoryOnly: true, note }
}
```

`scoreInputs` from the original proposal was dropped: the multipliers are not
carried on the serialised repeat group, so reporting them would mean either
recomputing the score outside the scorer — two definitions of one number — or
changing the extractor, which this milestone does not.

Binding requirements:

1. **Deterministic.** Ordered by score descending, ties broken by signature.
   Identical input yields byte-identical output. No new probing, no new capture,
   no scoring change — it reports what the existing passes already produced.
2. **`null` is not zero.** `resolvedProperties: null` with
   `resolvedFrom: "not-probed"` where no probe row exists. A candidate outside
   the probe budget has an unknown surface, and the same distinction this project
   enforces everywhere else applies here.
3. **`wouldSatisfyAnatomy` is a report, never a route.** It records that a
   lower-ranked candidate resolves three or more properties. It must not be
   readable by `selectPrimaryRepeat`, `evaluateMode` or any gate, and a
   structural test should assert that — the same guard `phase525` applies to
   `displaySelector`.
4. **`structuralNote` is derived from geometry against the viewport**, not from
   names: `section-scale` above a width and height share, `chip-scale` below an
   area floor, `within-component-scale` otherwise. It exists so a reader seeing
   `wouldSatisfyAnatomy: true` immediately sees *why it was not chosen*.
5. **Probe coverage is stated.** With 15 of 112 groups probed, "no better
   candidate exists" is not a claim the capture supports, and the diagnostics
   must not imply it.
6. **The threshold and the refusal do not move.** Three properties at 0.50
   confidence, and a run that fails it is still `blocked` with no prompt.

## What the implementation reports, measured

Run against the fixtures, with `null` meaning unprobed throughout:

| Capture | Selected | Resolved | Better-evidenced candidate | Its note |
| --- | --- | --- | --- | --- |
| produx.design | rank 0, conf 0.90 | 2 | rank 14, resolved 3 | **chip-scale** |
| stripe-pricing | rank 0, conf 0.96 | 2 | rank 9, resolved 3 | **section-scale** |
| synthetic `resolved` | rank 0, conf 0.96 | 5 | `div.tick`, 300 instances, resolved 1 | chip-scale |

Probe coverage is reported alongside: 5 of 15 candidates probed on produx, 2 of
15 on stripe-pricing. A candidate outside that budget carries
`resolvedProperties: null` and `wouldSatisfyAnatomy: null`, never a zero.

`wouldSatisfyAnatomy` is tri-state, and the third state matters: a non-selected
candidate that resolves three properties still reports `null`, because no
confidence was computed for it — only the selected component is evaluated, and
the requirement is two-part. Reporting `true` from the count alone would be
inventing the half that was never measured.

## Where this leaves the tool

The refusals on stripe-pricing and produx.design are correct and will stay.
Diagnostics would not make either page rebuildable; they would let a reader
confirm in one screen that the tool chose the right element and that the page
genuinely does not carry enough surface evidence — instead of taking that on
trust.

## Related

- `defects/def_0008.json` — area capped; section wrappers outscoring components
- `defects/def_0053.json` — count damped; decoration outscoring components
- `defects/def_0052.json` — why so many candidates read `unknown` before the
  selector-escaping fix
- [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md) — repeated structures are not
  components; repeat-group counts measure different sets

# The clone-prompt contract

This describes `clone-prompt.json` and `clone-prompt-refusal.json` — the artifacts
`bigaap inspect-page --experimental-page-model` writes for a coding agent to build
from. It is a different artifact from the analyze/recreate prompt described in
[PROMPT-CONTRACT.md](PROMPT-CONTRACT.md), and nothing here changes that path.

A clone prompt is the one output of this system that another agent acts on
literally. That asymmetry sets the rule everything below serves:

> **Every claim carries the evidence it came from, or it is not a claim.**

## The five gradings

Every dimension of a prompt is graded on one scale. The distinction the scale
exists to protect is between *we looked and found nothing* and *we never looked*.
Both leave a gap; only one is a fact about the page.

| grading | meaning |
| --- | --- |
| `observed-and-supported` | the evidence exists and the support class permits a claim from it |
| `observed-but-incomplete` | something was observed, but not all of it — truncated copy, partial crops, unmatched sections |
| `inferred` | the prompt states a choice rather than a measurement, and says so |
| `unknown` | nothing was observed. **Never rendered as 0%** — a page with no images has not failed asset coverage |
| `refused` | the support gate stopped this from being claimed at all |

A dimension with no evidence scores `null`, never zero. This is the same rule the
evidence layer uses for scores, for the same reason: a zero is a measurement, and
we did not make one.

## Two kinds of artifact

A capture produces exactly one of these. Never both, never a blend.

### `clone-prompt.json` — `kind: "prompt"`

Written only when at least one viewport's support class produces output. Carries:

| key | what it is |
| --- | --- |
| `$clonePrompt` | contract version |
| `url`, `route` | what was analyzed; one route per capture — this tool does not crawl |
| `supportClass`, `label` | the overall classification and its human label |
| `viewportsUsed` | every viewport that contributed, with its own support class |
| `excludedViewports` | viewports whose class did not produce output, listed rather than dropped |
| `sections` | every observed region in document order, classified or not |
| `outline` | `topLevelSections`, `containerSections`, `maxDepth` — the observed hierarchy |
| `repeatedGroups` | regions repeating on one structural basis, with member geometry |
| `header`/`navigation`/`hero`/`main`/`footer` | landmark slots, `unknown` when not observed |
| `scrollRevealedSections` | sections absent at rest that appeared during scroll |
| `interactionStates` | observed state transitions; empty when none were attempted |
| `acceptanceCriteria` | checkable claims, each with `sourceEvidenceIds` |
| `implementationRequirements` | what the builder must do, each with `sourceEvidenceIds` |
| `evidenceNotes` | conflicts, unstable geometry, and unknowns, stated rather than resolved |

### `clone-prompt-refusal.json` — `kind: "refusal"`

Written when **no** viewport produces output. Carries only `$clonePrompt`, `kind`,
`url`, `viewports` and `evidenceLimitations`.

A refusal contains **no CSS, no design tokens, no code fence, and no numbered build
step**. It is a report about the evidence, not a degraded attempt at a prompt.
`validateClonePrompt` refuses a refusal that carries any prompt-shaped key, and the
completeness report grades every dimension `refused`.

## What a section carries

Each entry in `sections` is one measured region:

- **identity** — `sectionId`, `domPath`, `tag`, `role`, `order`, `containment`
- **geometry** — `geometry` (document space) and `viewportGeometry` (per observation)
- **content** — `text`, `headings`, each with status, provenance and support flags
- **style** — `typography`, `colors`, `spacing`, `layout`, each `observed` or `unknown`
- **assets** — observed identities, render and intrinsic sizes, `alt` and `altPresent`
- **visuals** — located painted interiors; see below
- **responsive** — per-viewport comparison; see below
- **provenance** — every observation that saw it, with scroll state
- **`sourceEvidenceIds`** — the region, section, group and observation ids behind it

## The four evidence rules

These are enforced structurally, not by convention.

**1. Every viewport stays separate.** Ids are viewport-scoped by construction
(`s-1440-006`, `v-375-012`, `obs-768-003`). A claim citing evidence from another
viewport is a detectable leak, and the completeness report blocks on it.

**2. A responsive claim needs cross-viewport identity *and* geometry.** A
`responsive` entry is only `observed` when the section was matched at the other
viewport **by DOM identity** and both sides carry measured geometry. Matching more
loosely would let a 1440 measurement be offered as the 375 appearance of a region
that reflowed into something else. Entries record `differences` per property, each
with the `primary` and `compared` value.

**3. A scroll-revealed claim needs scroll-state provenance.** Every provenance
record carries `scrollState` (`initial` / `during-scroll` / `after-return`),
`scrollIndex`, `scrollStep`, `scrollY`, the viewport dimensions and the visibility
state. Scroll-revealed evidence can never satisfy an above-fold claim — the
`supports` flags carry that, and they are copied from normalization unchanged.

**4. A visual crop needs a hash and placement provenance.** Each entry in
`visuals.items` carries `visualId`, `type`, `confidence`, `resolved`,
`captureStatus`, `hash` or `source.identity`, `cropGeometry`, `cropIsPartial`, and a
`placement` naming the viewport, scroll state, scrollY and observation id it was
taken at. A crop that lacks either is graded `observed-but-incomplete`.

### What a visual crop is not

Every visual record carries a `doNot` field, in the artifact, in these words:

> Do not infer components, copy, layout or structure from this visual. It is a
> located region and, where one exists, a stored picture of it. Nothing in this
> record describes its contents.

Six origin types are distinguished — `image-asset`, `inline-svg`,
`canvas-webgl-video`, `css-rendered-ui`, `animation-dependent`, `unresolved` — and
`confidence` grades the **type assignment**, never the content. A canvas is typed
with confidence 1.0 and refused in the same breath, which is the clearest statement
of what the number means.

## Refusal reasons

An unresolved visual always names its cause, drawn from a closed set:
`not-visible-at-any-observation`, `zero-or-negligible-painted-area`,
`rendering-surface-cannot-be-read`, `source-identity-unavailable`,
`geometry-unstable-across-observations`, `region-exceeds-crop-budget`,
`crop-budget-exhausted-larger-regions-took-priority`,
`no-capture-capability-supplied`, `capture-attempted-and-failed`.

"We do not know" has to name its own cause, or later readers mistake it for
"there is nothing there".

## Completeness

`prompt-completeness.json` accompanies every prompt. It grades eighteen dimensions
— `pageStructure`, `structuralResolution`, `sections`, `textAndHeadings`, `layout`,
`typographyColorSpacing`, `assets`, `visualRegions`, `controlsObserved`,
`interactionStatesObserved`, `stateRestoration`, `interactionProvenance`,
`unsupportedInteractions`, `responsive`, `scrollReveal`, `unresolvedEvidence`,
`unsupportedRendering`, `references` — and reports `buildable: false` when any of
these hold:

- an evidence reference resolves to nothing (`unresolved-references`)
- a claim cites another viewport's evidence (`viewport-leak`)
- a viewport whose class produces output was excluded (`excluded-usable-viewport`)

Incompleteness is normal and is reported. These three are not: they are
correctness failures in the artifact rather than gaps in the page.

### The interaction dimensions

Five of the eighteen describe interaction, and they exist to keep one confusion
from ever occurring: **a page nobody interacted with must not score well on
interaction, and must not be reported as a page that has none.**

- `controlsObserved` — did discovery find anything affording an interaction?
  `unknown` when no discovery ran. When discovery ran and found nothing, that is
  `observed-and-supported` with an explicit "an observed absence, not an untried
  one", because it is a real finding about the page.
- `interactionStatesObserved` — how many transitions were actually seen. Controls
  that were all refused or cut by budget score `unknown`, never a percentage.
- `stateRestoration` — was the page put back? A run where restoration failed is
  `observed-but-incomplete`, and says the later evidence was gathered on a page
  that had drifted from its resting state.
- `interactionProvenance` — every `completed` transition must carry both `before`
  and `after` observation ids. A claim with one side is a claim about a moment,
  not a transition.
- `unsupportedInteractions` — what was declined on safety grounds, graded
  `refused` and stated as "a safety decision about this tool, not a statement
  about the page".

Interaction evidence is scope-locked. Every state carries `scope: "interacted"`
and a note saying it must not be used to satisfy an above-fold or resting-page
claim. Hover and focus evidence stays state-specific for the same reason.

### What the interaction observer refuses to touch

The gate is an allow-list, not a deny-list — being wrong about it should mean
missing a menu, never submitting a form. It refuses, in this order:

1. anything that submits — a submit control, or any control inside a `<form>`
2. anything near a credential field, and any password / email / tel / number field
3. any link that leaves the page (an in-page fragment is fine)
4. anything whose **accessible name** reads as destructive or transactional —
   delete, remove, buy, checkout, pay, subscribe, sign in, submit, save, publish
5. anything not visible at the moment of the attempt
6. any activation with no accessible name, since there would be nothing to record

Actions are derived from ARIA, never from appearance: `aria-haspopup` names what
a control opens and is read before `aria-expanded`, which on its own says only
that something is disclosed. A hamburger is a menu because its markup says so.

### Why `structuralResolution` exists

Every other dimension is a ratio over the sections that **were** found, so none of
them can see the sections that were **not**. A page modelled as one enormous region
therefore scores full marks on structure, layout, typography and colour — because
the single region it found genuinely has all of those.

Hacker News is the case that exposed it: it models as one `<center>` carrying the
whole page's copy, with a single 21-pixel search form beneath it. Every story row
is unaccounted for, and twelve dimensions reported green.

The dimension flags a section that carries more copy than the storage cap **while
its child sections cover under half its area** — the survey located the region but
could not take it apart. Having *a* child is not the test; how much of the region
its children actually cover is. The report names the largest such region and its
share of the page, and never sums overlapping regions into a share above 100%.

## What this contract does not promise

- **One route.** No crawling. A multi-route app needs one capture per route.
- **Intra-region placement.** Region boxes and asset render sizes are measured;
  where a text run or an image sits *inside* its region is not.
- **Pixel stability.** Region selection is deterministic. Crop bytes on a live
  site are not, and `animation-dependent` flags CSS-*declared* motion, which is
  not the same as observed pixel stability.
- **Interaction, unless it was attempted.** An empty `interactionStates` means no
  interaction was tried — not that the page has none.

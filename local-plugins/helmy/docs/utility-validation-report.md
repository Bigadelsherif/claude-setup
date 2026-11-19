# Utility-class validation — Phase 3.1

Measured 2026-08-12 against four utility-class-dominated public pages and three
controls. Every number below comes from a committed capture or audit file; none
is estimated.

---

## 1. The hypothesis, and what happened to it

Recorded in `fixtures/utility-site/target-selection.json` **before** any capture:

> On utility-class-dominated pages the repeat signature `tag + sorted class
> list` approaches `tag + noise`, because unrelated elements share identical
> class strings. If so, repeat groups will contain members that disagree on tag,
> region, geometry or child structure.

**The hypothesis was not confirmed.** Measured false-grouping rates:

| Page | Groups assessed | Potentially incoherent | Rate |
| --- | ---: | ---: | ---: |
| Controlled BEM fixture (control) | 8 | 0 | 0.000 |
| Controlled incoherence fixture (control) | 7 | 2 | 0.286 |
| linear.app — CSS-module hashes, no utilities (control) | 156 | 4 | 0.026 |
| tailwindcss.com | 87 | 2 | 0.023 |
| astro.build/themes | 30 | 0 | 0.000 |
| vercel.com/templates | 25 | 0 | 0.000 |
| nextjs.org/showcase | 32 | 0 | 0.000 |

No utility target exceeds the hashed control. Three of the four score zero.

The reason is structural: a group is keyed on `parentSelector + tag + sorted
class list`, not on the class list alone. Two elements must share a parent
selector *and* a tag *and* an identical class string before they merge. On the
pages measured, that conjunction was discriminating enough. The failure the
phase was designed to find does not occur at the rate the hypothesis predicted.

This is pinned by a test (`utility-heavy pages do not produce a higher
false-grouping rate than the hashed control`) so that if a future change makes
the hypothesis true, it fails loudly rather than quietly.

### What the phase found instead

Four defects, none of them about grouping, all of them about **naming**:

| Defect | What broke | Witnesses |
| --- | --- | ---: |
| `def_0016` | Utility classes were classified as build hashes | 4 |
| `def_0017` | Utility classes appeared in selectors advertised as deploy-stable | 3 |
| `def_0018` | The unusable class selector was printed as the component's selector | 2 |
| `def_0019` | Three-character hash segments slipped past hash detection | 2 |
| `def_0020` | A structural selector can bind to nothing (open, 1 witness) | 1 |

---

## 2. Targets and controls

Selected and justified before capture in
`fixtures/utility-site/target-selection.json`.

| Target | Utility share of class tokens | Rendering | Why chosen |
| --- | ---: | --- | --- |
| tailwindcss.com | 43% | Next.js, static | The canonical Tailwind site |
| astro.build/themes | 62% | Astro, static | Highest utility share surveyed; real card grid |
| vercel.com/templates | 48% | Next.js | Repeated product rows at scale |
| nextjs.org/showcase | 44% | Next.js | Sparse page; tests metric behaviour on few nodes |

Controls, chosen so a number can mean something:

- **Controlled BEM fixture** — hand-written, no utility classes. Establishes
  that a zero rate is achievable and that the classifier does not damage
  hand-written names.
- **linear.app** — CSS-module hashes, zero utility classes. Separates
  *unreadable* names from *non-discriminating* names.
- **Controlled incoherence fixture** (`fixtures/incoherent/`) — built for this
  phase. Establishes that the coherence metric is not simply dead.

---

## 3. Group-coherence measurement

### 3.1 Instrumentation before baseline

The twelve per-group signals were added to the extractor as measurement, gated
behind `window.__HELMY_NO_COHERENCE__`, before any target was captured and
before any heuristic was touched. The gate exists so the claim "measuring the
grouping did not move it" can be tested rather than asserted: the same three
pages were captured twice in one session, once with the signals on and once
with `--no-coherence`.

Repeat groups, coverage, histograms, layout and significant selectors are
**identical** across all three pairs. Scores are identical. Verified by
`group-coherence instrumentation does not change which groups are formed` and
`coherence is not an input to repeat scoring`.

### 3.2 The signals

| Signal | What it measures |
| --- | --- |
| `matchCount` | Instances in the group |
| `tagDiversity` | **Invariant, not a signal** — see below |
| `parentRegionDiversity` | Distinct page regions the members occupy |
| `childTagSequenceDiversity` | Distinct internal child-tag sequences |
| `textBearingProportion` | Share of members with direct text |
| `areaMedian` | Median rendered area |
| `areaSpread` | p90 ÷ p10 area ratio |
| `geometryClassDiversity` | Distinct size-band × aspect-shape classes |
| `styleFingerprintDiversity` | Distinct computed-style fingerprints |
| `semanticRoleDiversity` | Distinct explicit or implicit ARIA roles |
| `contentRegionDistribution` | Member counts per region |
| `visibleHiddenDistribution` | Visible members vs hidden sibling subtrees |

Two of the twelve do not work as originally specified, and this is recorded
rather than papered over:

- **`tagDiversity` cannot fire.** The grouping key begins with the tag name, so
  a group can never contain two tags. It is retained as an *invariant*: a test
  asserts it is always 1, and if it ever exceeds 1 the grouping key has changed
  and none of the other signals mean what they claim. Identity disagreement is
  carried by `semanticRoleDiversity`, which can vary within one tag through an
  explicit `role` attribute.
- **`textBearingProportion` is near-inert on containers.** It counts *direct*
  text nodes. On the incoherence fixture, four of nine members carry text, but
  all of it sits inside child `<span>` and `<label>` elements, so the group
  measures 0. The coherent `article.product` group measures 0 for the same
  reason. This was predicted wrong in the fixture's ground truth and the
  mis-prediction is recorded in `fixtures/incoherent/truth.json` under
  `predictionMiss`. The signal still discriminates on leaf-level groups; it is
  not a working signal on containers. **Open limitation, not fixed.**

So ten of twelve signals are live, one is an invariant, and one is
context-limited. Stated plainly because the phase brief asked for twelve.

### 3.3 The flagging rule

Signals are grouped into six independent families — identity, region,
structure, geometry, style, content — so that one underlying disagreement
cannot present itself as three. A group is marked `potentiallyIncoherent` when
**two or more families** disagree materially. One disagreement is ordinary
variation.

### 3.4 The metric discriminates

A rate of zero on four of seven pages is only meaningful if the metric can
return non-zero. `fixtures/incoherent/index.html` was built to force that, with
ground truth written from the markup before capture. It contains, in one page:

- `div.flex.gap-2.items-center` under `section.wrap` — nine elements sharing one
  class string, spanning `<main>` and `<footer>` through two parents that
  serialise identically, with areas spanning three orders of magnitude, seven
  distinct child sequences and six distinct roles. **Flagged**, on four
  families: identity, region, structure, geometry.
- `article.product` under `div.product-grid` — six instances of one real
  component. **Not flagged**, zero families.

Both directions are asserted by tests. A metric that flagged neither would be
dead; one that flagged both would be useless.

---

## 4. Class classification — def_0016 and def_0019

### 4.1 What was broken

`UTILITY_PATTERN` was anchored at the start of the class name and listed a
fixed set of prefixes, so it recognised only bare, unprefixed utilities. Every
variant-prefixed name (`dark:bg-gray-950`, `group-hover:opacity-75`,
`@4xl:grid-cols-3`), every arbitrary value (`w-[42px]`, `[--height:32px]`) and
every descendant variant (`[&>*]:p-6`, `**:[code]:pr-4`) fell through to hash
detection — where a vowel-poor fragment such as `xl:nth` reads as a build hash.

Separately, `isHashSegment` ignored segments shorter than four characters, so
CSS-modules names such as `showcase-sites-module__oN_qsG__siteCard` were called
readable and used as selector anchors.

### 4.2 Measured, before and after

Distinct class names per page, classified by the extractor's own function
(injected into the page, not re-implemented in the harness — a copy would agree
with itself and witness nothing, which is how `def_0012` survived).

| Page | Hashed precision before | after | Names misfiled before | after |
| --- | ---: | ---: | ---: | ---: |
| tailwindcss.com | 0.073 | **1.000** | 396 of 800 | **0** |
| astro.build/themes | 0.026 | n/a (0 hashed) | 81 of 272 | **1** |
| vercel.com/templates | 0.051 | **1.000** | 231 of 504 | **0** |
| nextjs.org/showcase | 0.738 | **1.000** | 66 of 279 | **1** |
| linear.app (control) | 1.000 | **1.000** | 0 | **0** |
| Controlled BEM (control) | n/a | n/a | 0 | **0** |

The two residuals are `astro-gray-700` — a bare colour-scale name with no
property prefix, genuinely ambiguous against a BEM block name — and
`jsx-2146603970`, a styled-jsx class that the classifier files as `unknown` and
the audit's independent ground truth calls utility-shaped. The second is an
artefact of the audit's heuristic, not a classifier error. Residual rate is
therefore 1 in 272 and 0 in 279, not zero, and is stated as such.

### 4.3 The controls held

This is the part that matters. A classifier that called everything a utility
would score perfectly on Tailwind and destroy every hand-written site.

- **linear.app**: 401 hashed, 0 utility, hashed precision 1.000. Unchanged
  through every iteration of the fix.
- **Controlled BEM fixture**: 28 of 28 names readable, 0 utility, 0 hashed.
  `container` was briefly misfiled as a utility during development and was
  removed from the vocabulary for exactly that reason — it is a Tailwind
  utility *and* one of the commonest hand-written layout classes, and excluding
  it costs nothing on utility sites.

### 4.4 Known limitation

Utility recognition is now syntactic where it can be — an unescaped colon, a
bracketed arbitrary value, a `*`/`@` variant marker — and vocabulary-based
where it cannot. The vocabulary list is inherently incomplete: a Tailwind
utility with a stem not in the list and no variant prefix (`astro-gray-700`)
will still be missed. The measured residual is under 0.5% of distinct names on
every target, but it is not zero and will not become zero by adding words.

---

## 5. Selector quality — def_0017, def_0018, def_0020

Covered in full in [selector-quality-report.md](selector-quality-report.md).
Summary: utility classes in deploy-stable selectors went from 53% / 53% / 33% /
0% across the four targets to **0% on all four**, with both controls unchanged
at 0%. One selector on tailwindcss.com matches nothing on the live page
(`def_0020`, open, single witness, pinned by a baseline test).

---

## 6. Discipline record

- Target selection and hypothesis recorded before capture.
- Instrumentation added before baseline, behind a gate, with an A/B test
  proving it did not alter grouping.
- Baseline captured and measured with the unmodified extractor. No heuristic
  was changed during baseline capture.
- All five defects filed with the full eleven-field record **before** any fix.
- `def_0020` deliberately **not fixed**: it has one witness, and the standing
  rule from Phase 2 is that a structural signature is promoted only when more
  than one target supports it independently. The measurement is pinned by a
  test so the count cannot rise unnoticed.
- Every claim in this report is backed by a committed file under
  `fixtures/utility-site/` or `fixtures/raw/`.

## 7. Test state

292 tests passing, zero failures. 19 of them are new in Phase 3.1
(`tests/utility-site.test.mjs`). 20 defects filed to date, 19 fixed, 1 open by
decision.

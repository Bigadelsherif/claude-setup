# Selector quality — Phase 3.1

Measured 2026-08-12. Every selector the system would hand to an implementer was
evaluated against the live page it came from, using
`tools/selector-audit.mjs`. Results are committed under
`fixtures/utility-site/*.selectors.json`.

---

## 1. Why this measurement exists

Group coherence asks whether a group's **members** resemble each other. It
cannot see the failure that actually reaches a person writing code: a selector
that is syntactically valid, describes nothing, and matches far more of the
page than the component it was derived from.

`.group.relative` is a legal CSS selector. On tailwindcss.com it matched 187
elements for a component with 121 instances, and it was printed in the design
spec as that component's selector. No coherence signal could have caught it,
because every one of those 121 members genuinely resembled the others.

So selectors are audited separately, against the live DOM.

---

## 2. What is measured, per selector

| Dimension | Measurement |
| --- | --- |
| **Stability** | Does the selector contain a build-generated class? |
| **Specificity** | How many elements does it match on the live page? |
| **Repeat coherence** | `matchCount ÷ instanceCount` — the over-match ratio |
| **Semantic relevance** | Does it contain a utility class, i.e. a name describing presentation rather than identity? |
| **Structural consistency** | Is it pure structure (`div > div:nth-of-type(2)`) with no class anchor at all? |
| **Region consistency** | How many page regions do its matches span? |
| **Deploy risk** | Utility-bearing or hash-bearing ⇒ will not survive a redesign or a deploy |

A selector is **unsafe to emit** when it carries a build hash (gone next
deploy) or a utility class (gone next design change, and shared with unrelated
elements meanwhile). These are different failures with the same consequence.

---

## 3. Baseline, before any fix

Emitted `stableSelector` values — the ones explicitly advertised as
deploy-stable.

| Page | Selectors | Containing a utility class | Pure structural |
| --- | ---: | ---: | ---: |
| Controlled BEM fixture (control) | 8 | 0 (0%) | 0 |
| linear.app (control) | 15 | 0 (0%) | 7 |
| tailwindcss.com | 15 | **8 (53%)** | 3 |
| astro.build/themes | 15 | **8 (53%)** | 5 |
| vercel.com/templates | 15 | **5 (33%)** | 10 |
| nextjs.org/showcase | 15 | 0 (0%) | 10 |

Examples of what was being emitted as deploy-stable:

- `div.max-w-full > section > div.isolate > ul > li:nth-of-type(1)`
- `a.place-content-center`
- `div.with-line-numbers > div > pre > code > code > span.line`

`max-w-full`, `isolate` and `place-content-center` name width, stacking context
and alignment. They are not identity, and they change whenever the design does.

The control separation is what makes this a finding rather than noise: both
non-utility pages sit at 0%.

---

## 4. After the fixes

| Page | Selectors | Utility-bearing | Pure structural | Matching nothing | Over-matching >1.5× |
| --- | ---: | ---: | ---: | ---: | ---: |
| Controlled BEM (control) | 8 | **0** | 0 | 0 | 0 |
| linear.app (control) | 15 | **0** | 7 | 0 | 0 |
| tailwindcss.com | 15 | **0** | 13 | 1 | 1 |
| astro.build/themes | 15 | **0** | 13 | 0 | 0 |
| vercel.com/templates | 15 | **0** | 15 | 0 | 0 |
| nextjs.org/showcase | 15 | **0** | 15 | 0 | 2 |

Three changes produced this:

1. **`def_0016`** — utility classes are now recognised, so they are excluded at
   selector *construction*, where the builder only ever accepts `readable`
   classes as anchors. Most of the improvement comes from here.
2. **`def_0017`** — the verification pass that rejected hash-bearing selectors
   now rejects utility-bearing ones too, catching anything construction missed.
3. **`def_0019`** — three-character hash segments are detected, so
   `section.showcase-sites-module__oN_qsG__showcase` is no longer accepted as a
   stable anchor. Before this, nextjs.org's "deploy-stable" selector contained
   two build hashes.

### The cost, stated plainly

Pure-structural selectors rose sharply — 3 → 13 on tailwindcss.com, 10 → 15 on
vercel and nextjs. A selector like `main > div > section:nth-of-type(3) > div:nth-of-type(2) > a:nth-of-type(1)`
is honest about carrying no identity, but it is brittle: any inserted wrapper
breaks it. This is the correct trade against emitting a name that looks stable
and is not, but it is a real cost and is not presented as a clean win.

---

## 5. What the reader now sees — def_0018

The system computed a usable selector and then printed the unusable one.

Before, on tailwindcss.com:

```
- Selector: `.group.relative`
```

Before, on nextjs.org/showcase:

```
- Selector: `.showcase-sites-module__oN_qsG__siteCard`
```

In both cases a deploy-stable alternative existed in the IR and was never
rendered. After:

```
- Selector: `div[data-tooltip-trigger='true']`
- Class selector in this capture: `.group.relative` — not usable as written,
  because its classes name presentation, not identity, and are shared with
  unrelated elements. Use the selector above.
```

```
- Selector: `main > div > section:nth-of-type(3) > div:nth-of-type(2) > a:nth-of-type(1)`
- Class selector in this capture: `.showcase-sites-module__oN_qsG__siteCard` —
  not usable as written, because its classes are build-generated and change on
  the next deploy. Use the selector above.
```

The reason is **stated, not hedged**. It is known at the point of emission —
whether the class list is hash-dominant or utility-dominant — so it is carried
through the IR as `selectorUnusableReason` rather than reduced to "either one or
the other". A test asserts both branches actually occur across the two targets,
so neither is untested.

---

## 6. Over-matching: measured, and not attributed to utilities

The over-match ratio is `matchCount ÷ instanceCount`. It was expected to be a
utility problem. It is not.

Across all emitted selectors — group signatures, stable selectors and
significant selectors alike:

| Page | Over-match rate, before | after |
| --- | ---: | ---: |
| Controlled BEM (control) | 0.000 | 0.000 |
| linear.app (control) | 0.148 | 0.148 |
| tailwindcss.com | 0.389 | 0.167 |
| astro.build/themes | 0.087 | 0.087 |
| vercel.com/templates | 0.000 | 0.000 |
| nextjs.org/showcase | 0.083 | 0.083 |

linear.app — which uses no utility classes at all — has a *higher* over-match
rate than three of the four utility targets, before and after. Over-matching is
a property of selectors that are not scoped to the group's parent, and it occurs
with hashed class names just as readily. Attributing it to utility classes would
have been wrong, and the control is what prevented that.

Only tailwindcss.com improved, and only because def_0017 replaced eight
utility-anchored selectors with structural ones. Nothing in this phase targeted
over-matching, and outside that one page nothing about it changed. It is
reported as an open, measured property of the system, not as something fixed.

Restricted to the selectors advertised as deploy-stable, the counts after the
fixes are: 0 on both controls, 0 on astro and vercel, 1 on tailwindcss.com and
2 on nextjs.org. The nextjs cases are `img[data-nimg='1']`, matching 44 images
against a group of 6 — a framework marker, not a component identifier.

---

## 7. Open: def_0020

One emitted selector on tailwindcss.com matches **zero** elements on the live
page:

```
ul > li:nth-of-type(1) > a > svg > g > path:nth-of-type(1)
```

Probing the chain live shows `ul > li:nth-of-type(1) > a > svg` matches exactly
one element, and that element contains no `<g>`. The structural fallback stops
after six ancestors and leaves the root unanchored, so a chain that truly
described one element's ancestry binds to a different subtree — or, here, to
nothing.

**Not fixed.** It has one witness among 83 emitted selectors across six pages.
The standing rule from Phase 2 is that a structural signature is promoted only
when more than one target supports it independently, and anchoring the fallback
changes how every selector on every page is built. The count is pinned by a
regression test with a per-page baseline, so it cannot rise unnoticed. The
proposed fix — continue the walk past the guard until an id, data attribute,
landmark or `body` is reached — is recorded in `defects/def_0020.json`.

---

## 8. Scoring

A selector's quality is reported as its component measurements rather than as a
single number. A composite score would have to weight deploy risk against
brittleness, and this phase produced no evidence for what that weighting should
be — a pure-structural selector is safer than a utility one and more fragile
than an id-anchored one, and nothing measured here says by how much. Emitting a
score would be inventing precision the measurements do not support.

The seven dimensions in §2 are each reported per selector in
`fixtures/utility-site/*.selectors.json`.

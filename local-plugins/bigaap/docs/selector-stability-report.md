# Selector stability — Phase 3.2

How every recommended selector is classified, what each class licenses, and what
was actually observed to survive a rebuild.

---

## 1. The seven classes

Implemented in [`src/deploy/selector-class.mjs`](../src/deploy/selector-class.mjs).
Classification is worst-first: a selector containing one generated class is
`generated`, however much semantic material surrounds it, because the reason it
fails is the reason a reader needs.

| Class | Built from | Deploy-safe on classification | Breaks when |
| --- | --- | :--: | --- |
| `semantic-stable` | element semantics, ARIA roles | yes | the meaning changes |
| `project-stable` | `data-testid` and similar author hooks, or project-maintained class names | yes | the project removes the hook |
| `structural-stable` | tags and structure, no names | yes | the DOM is restructured |
| `generated` | build hashes, volatile runtime ids | **no** | the next deploy |
| `positional` | `:nth-of-type`, `:nth-child`, `:first-child` | **no** | anything is inserted or reordered |
| `utility-nondiscriminating` | utility classes describing presentation | **no** | the design changes — and it over-matches meanwhile |
| `unknown` | nothing that identifies the target; framework markers only | **no** | unknowable |

Framework markers are deliberately *not* `project-stable`. `[data-nimg='1']`
and `[data-astro-cid-...]` identify a renderer, not a component: on
nextjs.org/showcase, `img[data-nimg='1']` matched 44 images for a group of 6.
They classify `unknown`.

### Classification is never sufficient

`deploySafetyVerdict` separates the two questions the phase brief insists on
keeping apart:

| Situation | Verdict |
| --- | --- |
| classification rejects it | `rejected` — no cross-build evidence needed |
| classification allows it, no second build compared | **`unproven`** |
| classification allows it, second capture is the *same build* | **`unproven`** — "determinism, not deploy safety" |
| classification allows it, different build, did not survive | `rejected` |
| classification allows it, verified different build, survived | **`proven`** |

A selector is deploy-safe only in the last row, and only when the comparison's
declared relation was independently verified against the captures.

---

## 2. Observed class distribution

Selectors emitted for the source capture of each comparison.

| Comparison | positional | project-stable | generated | unknown | Deploy-safe |
| --- | ---: | ---: | ---: | ---: | ---: |
| `a-vs-b` (no hooks) | 9 | 0 | 0 | 0 | 0 |
| `a-vs-c` (no hooks) | 9 | 0 | 0 | 0 | 0 |
| `d-vs-e` (hooks) | 2 | **5** | 2 | 0 | **5** |
| `a-vs-a` | 9 | 0 | 0 | 0 | 0 |
| `a-viewport` | 9 | 0 | 0 | 0 | 0 |
| `linear-simulated` (real page) | 15 | 0 | 0 | 0 | 0 |
| `real-linear-t1-vs-t2` | 15 | 0 | 0 | 0 | 0 |
| `real-nextjs-t1-vs-t2` | 13 | 0 | 0 | **2** | 0 |

The dominant finding is blunt: **on pages that provide no author hooks, almost
every emitted selector is positional and therefore not deploy-safe.** That is
15 of 15 on a real site. It is not a defect in the classifier — it is what the
extractor has to work with once generated names and utility classes are
correctly excluded, and it is the direct consequence of Phase 3.1's fixes.

The two `unknown` rows on nextjs.org are framework markers.

---

## 3. Stability observed, separately from safety

`selectorChanged` records whether the emitted selector differed between the two
captures. It answers a different question from deploy safety and the two answers
diverge sharply.

| Comparison | Selectors identical across the pair | Deploy-safe |
| --- | ---: | ---: |
| `a-vs-b` — every class name changed | **9 of 9** | 0 |
| `a-vs-c` — names changed + one component restructured | 5 of 7 | 0 |
| `d-vs-e` — names changed, hooks present | 7 of 9 | 5 |
| `linear-simulated` — 816 names rewritten | **13 of 13** | 0 |
| `real-linear-t1-vs-t2` | 13 of 13 | 0 |

Read the first and fourth rows together. Nine synthetic selectors and thirteen
real ones came back **byte-identical** after every generated identifier on the
page was replaced. By the narrow test of "did it survive this rebuild", they all
passed. Every one is still reported as not deploy-safe.

That is the correct answer and it is worth being explicit about why. These
selectors survived because the rebuild changed only names, and they contain no
names. What they do contain is sibling counting. A rebuild that inserts a
wrapper — the ordinary consequence of adding a feature — breaks all of them, and
nothing in these fixtures inserts anything. Reporting them as deploy-safe would
be generalising from the one kind of change that happens not to affect them.

The two selectors that *did* change in `d-vs-e` are the volatile-id rows, and
they are the only case in the phase where a classification prediction was
independently confirmed by an observed change: `#:r7zh:` → `#:rbf1:`.

---

## 4. Rejection rules, and what enforces each

The brief listed six things a deploy-safe selector must not depend on. Each is
enforced, and each has a test.

| Must be rejected if it depends on | Enforced by | Test |
| --- | --- | --- |
| generated hashes | `classifySelector` → `generated` | "generated selectors are rejected" |
| volatile IDs | `isVolatileId` — React `useId`, Radix, uuids, long digit tails | "volatile ids are rejected" |
| DOM position alone | `classifySelector` → `positional` | "positional selectors are rejected as deploy-safe" |
| utility strings with poor discrimination | `classifySelector` → `utility-nondiscriminating` | "nondiscriminating utility selectors are rejected" |
| content that changes between builds | no signal reads text content; `accessibleName` is weighted 1 and never available | — see §6 |
| unstable class ordering | the grouping signature sorts class names, so order cannot participate | "no match depends on a generated identifier" |

The volatile-id case is worth singling out because an id is normally the
strongest thing a selector can have. `#:r7zh:` is an id, is unique, is maximally
specific — and is regenerated every build. It classifies `generated`, not
`project-stable`, and the fixture proves the classification right by changing it
between builds.

---

## 5. def_0021 — generated-name leakage, found and fixed

The defect that only a second build could expose.

| Measurement | Before | After |
| --- | ---: | ---: |
| Build B stable selectors containing a generated name | **9 of 9** | **0 of 9** |
| Build C stable selectors containing a generated name | 9 of 9 | 0 of 9 |
| Stable-selector overlap between builds A and B | 0 of 9 | **9 of 9** |
| Generated names leaked, all five builds | 18 | **0** |

`jsx-tuhaukv` reads as a word: seven lowercase letters, three vowels, ratio
0.43. It passed every randomness test the detector had — mixed case, digit
interleaving, vowel scarcity — so it was called `readable` and accepted as a
selector anchor. Build A never produced such a name, which is why every capture
before Phase 3.2 looked clean. **A single build cannot expose a name that only
some builds produce.**

The fix consults the bundler prefix (`css-`, `jsx-`, `emotion-`, `sc-`) rather
than the shape of the tail, and treats a digit-leading segment as a hash.
`styles-` and `mod-` were deliberately left out: both are plausible hand-written
prefixes, and a false positive on a hand-authored site costs more than missing
one generated name the randomness tests may still catch.

Verified against every control: linear.app's 401 hashed names unchanged with
zero utility false positives, the BEM fixture still 28 of 28 readable, and all
315 tests passing.

Notice the third row. Removing the leak did not merely clean the selectors — it
made them *identical* across builds, because what remained was pure structure.
The leak was the only reason cross-build overlap was zero.

---

## 6. Limits

1. **No composite stability score.** Phase 3.1 declined to invent one without
   measured weights and nothing here changed that. Each selector carries its
   class, its reasons, whether it survived, and whether that survival was
   licensed — four facts, not one number.
2. **`accessibleName` is in the matching model, weighted, and never available.**
   The extractor does not compute accessible names, so the signal is untested in
   every comparison. Listed rather than quietly dropped.
3. **Content stability is untested.** No signal reads text, so no match can be
   broken by copy changes — but that also means nothing here demonstrates
   robustness to a content change, because none was made.
4. **`positionalWithinAnchor` is recorded, not scored.** Two of the five
   deploy-safe selectors reach their target by position from a hook. They are
   reported as `project-stable` with the qualifier attached, on the reading that
   the rejection rule is position *alone*. A stricter reading would reject them,
   and nothing measured here settles which is right.
5. **`def_0020` remains open.** Phase 3.1's unanchored structural fallback found
   no second witness here — every emitted selector matched something on its
   page. These fixtures never move an element, so they cannot exercise the
   failure anchoring would prevent, and the absence of recurrence is weak
   evidence rather than a clearance.
6. **`def_0022` remains open by decision.** `system` and `styles-dark` classify
   as hashes because the vowel test ignores `y`. One real witness in 800 names
   on one target; the boundary is pinned by a test in both directions.

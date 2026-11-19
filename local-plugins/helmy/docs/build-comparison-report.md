# Build comparison — Phase 3.2

Per-component cross-build results. Source data:
`fixtures/cross-build/*.json`.

Columns are the fields the phase brief specified. `evidence` is the count of
non-generated signals that agreed; the full list is in the JSON for every row.

---

## 1. A → B — names changed, nothing else

Build A vs build B: every generated class name differs, DOM structure, roles,
layout and computed values are held constant.

| Source | Target | State | Conf | Selector class | Sel. changed | Identity changed | Deploy-safe | Evidence |
| --- | --- | --- | ---: | --- | :--: | :--: | :--: | ---: |
| `main/div[0]x6` | `main/div[0]x6` | matched | 1.00 | positional | no | no | no | 10 |
| `main/article[1]x6` | `main/article[1]x6` | matched | 1.00 | positional | no | no | no | 10 |
| `main/div[2]x6` | `main/div[2]x6` | matched | 1.00 | positional | no | no | no | 10 |
| `main/p[3]x6` | `main/p[3]x6` | matched | 1.00 | positional | no | no | no | 10 |
| `main/h3[4]x6` | `main/h3[4]x6` | matched | 1.00 | positional | no | no | no | 10 |
| `main/span[5]x6` | `main/span[5]x6` | matched | 1.00 | positional | no | no | no | 10 |
| `main/div[6]x6` | `main/div[6]x6` | matched | 1.00 | positional | no | no | no | 10 |
| `nav/a[7]x3` | `nav/a[7]x3` | matched | 1.00 | positional | no | no | no | 9 |
| `nav/li[8]x3` | `nav/li[8]x3` | matched | 1.00 | positional | no | no | no | 9 |

Nine of nine matched at full confidence. Match method for each: agreement on
ten non-generated signals — tag, child-tag sequence, semantic role, parent
region, repeated-group membership, style fingerprint, geometry class,
painted-surface class, content role, parent-child shape. Unavailable throughout:
`dataAttribute` (this build has no hooks) and `accessibleName` (not extracted).

**Selector changed: no, on all nine.** The selectors are byte-identical across a
rebuild that renamed every class on the page. **Deploy-safe: no, on all nine** —
they are positional. Those two rows are the whole point of the comparison: the
selector survived *this* rebuild and is still not safe, because what it survived
was renaming, and what would break it is insertion.

Before `def_0021` was fixed, all nine of build B's selectors contained the
generated name `jsx-tuhaukv` and the overlap with build A was 0. Removing the
leak is what made them identical.

---

## 2. A → C — names changed **and** one component genuinely restructured

Build C removes the card's media block and adds a metadata row, so the card
surface has a different child sequence, the media block no longer exists, and
`dl`/`dt`/`dd` are new.

| Source | Target | State | Conf | Sel. changed | Identity changed | Deploy-safe | Conflicts |
| --- | --- | --- | ---: | :--: | :--: | :--: | --- |
| `main/div[0]x6` | — | **unmatched-source** | 0.74 | — | — | no | childTagSequence, geometryClass |
| `main/article[1]x6` | `main/article[1]x6` | matched | 0.89 | no | no | no | — |
| `main/div[2]x6` | — | **unmatched-source** | 0.59 | — | — | no | tag, repeatMembership, styleFingerprint, contentRole |
| `main/p[3]x6` | `main/p[2]x6` | matched | 1.00 | no | no | no | — |
| `main/h3[4]x6` | `main/h3[4]x6` | matched | 1.00 | no | no | no | — |
| `main/span[5]x6` | `main/span[3]x12` | matched | 0.88 | yes | no | no | repeatMembership |
| `main/div[6]x6` | `main/div[5]x6` | **changed-structure** | 0.84 | yes | **yes** | no | childTagSequence |
| `nav/a[7]x3` | `nav/a[9]x3` | matched | 1.00 | no | no | no | — |
| `nav/li[8]x3` | `nav/li[10]x3` | matched | 1.00 | no | no | no | — |
| — | `main/div[0]x6` | unmatched-target | — | — | — | no | — |
| — | `main/div[5]x6` | unmatched-target | — | — | — | no | — |
| — | `main/dl[6]x6` | unmatched-target | — | — | — | no | — |
| — | `main/dt[7]x6` | unmatched-target | — | — | — | no | — |
| — | `main/dd[8]x6` | unmatched-target | — | — | — | no | — |

Reading the rows that matter:

- The **card surface** scored 0.74, just under the 0.75 threshold, and was left
  unmatched. Its child sequence and geometry both changed. Correct — and worth
  noting how close it came, since a threshold of 0.70 would have called it a
  match. That proximity is exactly why no composite score is emitted.
- The **media block** was removed, scored 0.59, unmatched. Correct.
- The **card footer** gained a second badge, so its child sequence changed while
  everything else agreed: reported `changed-structure` with
  `componentIdentityChanged: true`, not `matched`. This is the state that stops
  a real change being reported as a survival.
- The **badge** matched at 0.88 despite build C rendering 12 of them instead of
  6. Instance count disagreed and was outvoted by eight agreeing signals. This
  is the intended behaviour — the same component used twice per card is still
  the same component — but it is a judgement encoded in weights, not a fact.
- Five new elements are `unmatched-target`. None was absorbed into an existing
  match.

---

## 3. D → E — names changed, author hooks present

The only pair where deploy safety can be proven, because it is the only pair
where the page offers anything other than position.

| Source | Target | State | Conf | Selector class | Sel. changed | Deploy-safe | Evidence |
| --- | --- | --- | ---: | --- | :--: | :--: | ---: |
| `main/div[0]x6` | `main/div[0]x6` | matched | 1.00 | **generated** | **yes** | no | 10 |
| `main/article[1]x6` | `main/article[1]x6` | matched | 1.00 | project-stable | no | **yes** | 11 |
| `main/div[2]x5` | `main/div[2]x5` | matched | 1.00 | project-stable † | no | **yes** | 11 |
| `main/p[3]x5` | `main/p[3]x5` | matched | 1.00 | project-stable | no | **yes** | 11 |
| `main/h3[4]x5` | `main/h3[4]x5` | matched | 1.00 | project-stable | no | **yes** | 11 |
| `main/span[5]x6` | `main/span[5]x6` | matched | 1.00 | **generated** | **yes** | no | 10 |
| `main/div[6]x5` | `main/div[6]x5` | matched | 1.00 | project-stable † | no | **yes** | 11 |
| `nav/a[7]x3` | `nav/a[7]x3` | matched | 1.00 | positional | no | no | 9 |
| `nav/li[8]x3` | `nav/li[8]x3` | matched | 1.00 | positional | no | no | 9 |

† Anchored by a `data-testid` but reaching its target positionally —
`div[data-testid='product-card-surface'] > div:nth-of-type(1)`. Two of the five
deploy-safe selectors are like this. It is not `positional`, because the
rejection rule is position *alone* and these are findable without counting from
the document root, but it is a weaker claim than a fully hook-identified
selector, and `positionalWithinAnchor: true` records it on the row rather than
letting the anchor hide it.

The two **generated** rows are the volatile-id case: `#:r7zh:` in build D,
`#:rbf1:` in build E. React's `useId` output, an id that looks maximally
specific and changes every build. Classification rejects it, and the empirical
`selectorChanged: yes` confirms the rejection was right. This is the one place
in the phase where a classification prediction was independently checked against
what actually happened.

Note also: eleven signals agreed on the hooked rows rather than ten, because
`dataAttribute` became available. `accessibleName` is still missing everywhere.

---

## 4. Controls — what must *not* produce a pass

| Comparison | What it holds constant | Matched | Deploy-safe | Why it matters |
| --- | --- | ---: | ---: | --- |
| `a-vs-a` | everything — two captures of one build | 9 | **0** | Perfect agreement, identifier overlap 1.000. Determinism, not deploy safety. |
| `a-viewport` | build; viewport 1440 → 768 | 9 | **0** | The grid reflows and geometry changes; identity does not. Zero `changed-structure`. |
| `linear-simulated` | real page; names rewritten by tooling | 13 | **0** | Relation `simulated-build` cannot license safety, whatever the match rate. |
| `real-linear-t1-vs-t2` | real site over time | 13 | **0** | Declared `different-build`; refused, overlap 1.000. |
| `real-nextjs-t1-vs-t2` | real site over time | 13 | **0** | Declared `different-build`; refused, overlap 1.000. |

The viewport control answers the brief's question about token differences: the
1440 and 768 captures differ in grid columns and geometry, and all nine
components still match with no structural change reported. A viewport change is
not an identity failure — and it is also not permitted to license deploy safety,
since nothing about the build changed.

---

## 5. Ambiguity

Two components on the real linear.app capture cannot be told apart:

```
ambiguous: main/div[1]x12  -> null
   two candidates within 0.105 of each other (0.84 vs 0.74); not resolved
   candidates: main/div[1]x12, main/div[13]x4
ambiguous: main/div[13]x4  -> null
   two candidates within 0.105 of each other (0.84 vs 0.74); not resolved
   candidates: main/div[13]x4, main/div[1]x12
```

Both targets remain `unmatched-target`. Neither ambiguity was resolved, no
tie-break was applied, and both candidates are recorded on each row. A separate
test constructs an exact duplicate pair and asserts the public matcher returns
`ambiguous` rather than choosing.

---

## 6. Mode evaluation across builds

Recorded in `fixtures/cross-build/mode-evaluation.json` so that a rebuild which
degrades what a mode is permitted to do becomes visible.

| Capture | analyze | recreate | improve | Confidence |
| --- | --- | --- | --- | ---: |
| build A | allowed | allowed-with-warnings | allowed | 0.751 |
| build B | allowed | allowed-with-warnings | allowed | 0.751 |
| build C | allowed | allowed-with-warnings | allowed | 0.755 |
| build D | allowed | allowed-with-warnings | allowed | 0.751 |
| build E | allowed | allowed-with-warnings | allowed | 0.751 |
| linear (simulated rebuild) | allowed | **blocked-with-recapture-recommendation** | allowed-with-warnings | 0.624 |

Builds A, B, D and E are identical to three decimal places. Renaming every class
on the page changed nothing about what the system is permitted to do. Build C
differs slightly (0.755) because its mutation produces two additional repeat
groups.

The simulated linear.app rebuild blocks `recreate` with two blocking gaps — the
same verdict the unmodified real capture produces. The rename did not change the
mode decision, which is the result that matters here: the gate responds to
evidence quality, not to identifier churn.

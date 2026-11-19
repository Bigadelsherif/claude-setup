# The component model — Phase 3.3

What a component record now holds, and why each field exists separately from
the others.

---

## 1. Five concepts, five fields

Before this phase these were one thing: a component was whatever had a surface.
That collapse produced two opposite failures at once — a component that paints
nothing could not be represented at all (`def_0023`), and a wrapper whose child
paints was reported as painting it itself (`def_0025`).

| Concept | Field | What it answers | Own evidence |
| --- | --- | --- | :--: |
| Semantic unit | `semanticUnit` | What the repeated thing IS | ✓ |
| Identity | `identity` | The evidence that these instances are one thing | ✓ |
| Surface | `surface`, `surfaceClassification`, `surfaceObserved` | What it paints, if anything | ✓ |
| Layout wrapper | `wrapper` | The container the instances sit in | ✓ |
| Painted descendant | `paintedDescendant` | The node inside it that paints | ✓ |

Plus `nonSurfaceProperties`, `anatomyVerdict`, `repetition`, `selectors`,
`stableSelector`, `selectorUnusableReason`, `evidenceIds` and `confidence`.

For the `painted-descendant` fixture:

```
semanticUnit        .vehicle
identity            sufficient, score 16, bases: repeated-structure, semantic-role,
                    tag-and-child-sequence, parent-region, geometry, ...
surface             { ownedBy: "div.vehicle__surface", background: "#f5f7fa",
                      border: "1px solid #dfe3e8", borderRadius: 12, ... }
surfaceClassification  descendant-painted
wrapper             div.listing
paintedDescendant   div.vehicle__surface
```

The article is the VehicleCard. The div merely paints it. Surface anatomy is
attributed with `part: "painted-descendant"`, never `part: "surface"`, so an
implementer is told which element to style.

---

## 2. `surface: null` is explicit

An omitted field reads as "not measured". `null` means "measured, and there is
none". Both states appear in the IR and they are not interchangeable:

```
surface: null,  surfaceObserved: true,   surfaceClassification: "text-only"
   → we looked; there is no background. A prompt may say so.

surface: null,  surfaceObserved: false,  surfaceClassification: "unknown"
   → we could not look. A prompt may say nothing, and recreate blocks.
```

Ten classifications are supported: `painted-background`, `painted-border`,
`painted-shadow`, `image-painted`, `text-only`, `layout-only`,
`inherited-surface`, `descendant-painted`, `none`, `unknown`. Seven are
exercised by the fixtures; `inherited-surface`, `image-painted` and `none` are
not, and are untested against real behaviour.

---

## 3. Identity without paint

Eleven bases may establish identity. Three are *sufficient* alone — semantic
role, accessibility attributes, an author-controlled project hook. The rest
accumulate toward a threshold of 6.

Two are recorded as **seen and refused**, never as evidence:

- **A shared utility class.** Presentation is worn by unrelated elements.
- **DOM position.** Where a thing sits is not what it is.

They appear in `identity.rejectedBases` with a reason, rather than being
silently dropped, so a reader can tell the difference between "there was no
such signal" and "there was one and it was refused".

Two structural rejections sit above the scoring:

- **Incoherent group.** If Phase 3.1's coherence signals report two independent
  families disagreeing, identity fails regardless of score. The incoherent
  control scores 11 and is still rejected.
- **Layout wrapper.** If instances hold *different* child structures and the
  node bears no text, it repeats like a container, not a component. This is what
  rejects `.split__cell`.

Both exist to stop the fix for `def_0023` trading a false negative for a false
positive. A model that admitted every repeated `<div>` would satisfy the first
half of this phase and be worse than what it replaced.

**Captures that predate coherence instrumentation return
`identity.assessable: false`** and are passed through untouched. Absence of a
signal is not evidence against — treating it otherwise would have rejected every
historical golden capture in the repository.

---

## 4. The anatomy guard

> No surface plus fewer than three reliable non-surface properties blocks
> recreate. Three or more may satisfy anatomy if the mode requirements permit.

Implemented literally in `evaluateAnatomy`, and — after `def_0028` — actually
consulted by the mode evaluator, which it previously was not.

Eleven properties may count: semantic role, tag, child structure, typography,
spacing, alignment, icon relationship, content hierarchy, interaction state,
responsive behaviour, repeated geometry.

Two were tightened when the guard proved unable to fire:

- **Typography** counts only when it departs from the page default. Every
  element has a computed font-size; recording one says nothing about *this*
  component. A departure is a decision someone made.
- **Content hierarchy** requires an ordered arrangement — a heading leading body
  copy, or three or more distinct child roles in a consistent order. "Carries
  text" is not a hierarchy and would have handed every component a free
  property.

A guard that counts facts true of every element is not a guard. After the
change, `sparse-anatomy` counts 2 and blocks; every describable component counts
3 or more.

### The counterpart rule

A component that **does** paint is judged on surface evidence, and structural
entries may not substitute. Since Phase 3.3 put structure into the same anatomy
array, `stripe-pricing-1440` — a painted component whose only resolved surface
property is a background — briefly passed the recreate gate on
`structure.tag` and `structure.spacing`. `RESOLVER.COMPONENT` now counts surface
entries for painted components and all entries for unpainted ones.

---

## 5. One expectation deliberately changed

`tests/hashed-site.test.mjs` test 6 previously asserted:

> the unpainted repeated element must be rejected rather than modelled

That assertion encoded the defect. It has been rewritten to assert the stronger
claim: the element is modelled, its lack of a surface is recorded explicitly,
and the anatomy guard — not an accident of the data model — decides whether
anything may be built from it. The linear.app element has one reliable property,
so the verdict blocks recreate. It is now caught by a rule rather than by the
side effect of a rule about something else.

This is the only pre-existing expectation changed in Phase 3.3. All 315 earlier
tests pass.

---

## 6. Confidence

Component confidence was the mean of five surface claims, which put every
unpainted component at zero — not because the evidence was weak but because the
wrong things were being averaged. It is now the mean over what was actually
evidenced: surface claims where they exist, plus identity, non-surface
properties and instance count.

The `surfaceObserved`/`surface` pair, not confidence, is what tells a reader
whether a surface exists. Confidence answers a different question — how well
supported the claims are — and conflating the two is what produced the original
failure.

---

## 7. What the model still cannot do

1. **More than one component per capture.** `card.primary` and `button.primary`
   are fixed slots. Two components sharing a wrapper cannot both be reported.
2. **Distinguish a wrapper that is also a component.** The wrapper rule keys on
   instances holding different things; a wrapper whose instances are uniform and
   which is itself a component is indistinguishable from either alone.
3. **Validate its own thresholds.** Identity 6, anatomy 3, coherence 2 families.
   All three separate every case in these twelve captures, and none has been
   tested against a corpus large enough to say they are right.
4. **Report `inherited-surface`.** The classification exists and nothing
   produces it, so its behaviour is unverified.

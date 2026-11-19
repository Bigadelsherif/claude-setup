# Phase 1 plan — derived from real-site run 001

Every item below traces to a recorded finding in
[REAL-SITE-FINDINGS.md](REAL-SITE-FINDINGS.md). Nothing here is speculative
tuning.

Ordered by severity. P0 items make the difference between an analysis that is
wrong-but-honest and one that is right.

---

## P0-1 — Make confidence coverage-aware *(F-01)*

**The failure:** 6.7% node coverage on the wrong region of the page produced
confidence 0.71, against 0.75 for a 100%-coverage run that was entirely correct.
Coverage is recorded and then ignored.

**Change:** introduce a coverage factor applied at IR level, separate from
per-claim provenance:

```
ir.confidence.overall = mean(claimConfidence) × coverageFactor

coverageFactor = f(nodesSampled/nodesTotal, sheetsAccessible/sheetsTotal,
                   contentReached)
```

`contentReached` is the new signal: the fraction of sampled repeat groups with
`inMain: true`. On this run it was **0**, which alone should have collapsed the
score.

**Also:** surface a `coverageWarnings` array in the IR and print it at the top of
the spec, above any measurement.

**Test:** a synthetic raw capture with `truncated: true` and `inMain: false`
everywhere must produce overall confidence below 0.35.

---

## P0-2 — Fix the sampling budget *(F-02)*

**The failure:** `collectNodes()` fills its 1200-node budget in DOM order, so
Stripe's collapsed mega-menu consumed all of it and the pricing content was never
seen.

**Change:** replace DOM-order priority with a **stratified budget**:

| Stratum | Share |
|---|---|
| `main` (or the largest content region if absent) | 50% |
| `header` / `nav` | 15% |
| `footer` | 10% |
| Detected repeat groups anywhere | 15% |
| Bounded random sample of the remainder | 10% |

Additional rules:
- Skip subtrees whose root is `display:none` before spending budget on them —
  Stripe burned ~800 nodes on hidden menu contents
- Raise `NODE_CAP` to 2500 now that the payload travels via Playwright to disk
  rather than through a truncating tool result
- Record per-stratum fill rates in `coverage`

**Test:** a fixture with a large hidden nav must still resolve the content-region
card as the primary component.

---

## P0-3 — Demote empty components *(F-03)*

**The failure:** `card.primary` was emitted with confidence 0.00 and zero anatomy.

**Change:** in `deriveIR`, a component with no anatomy entries or confidence
below a threshold moves to `components[].candidates` rather than being presented
as a modelled component. The spec renders candidates under a separate heading
that says plainly that nothing was resolved.

**Test:** a raw capture whose top repeat group has no resolvable surface must
produce zero modelled components and one candidate.

---

## P1-4 — Record breakpoint direction *(F-04)*

**The failure:** 14 "breakpoints" reported, where `599/600`, `899/900/901` and
`1111/1112` are min/max pairs describing the same boundary.

**Change:** `harvestStylesheets()` records `{ value, direction: "min"|"max", raw }`.
Derivation collapses `max: n-1` with `min: n` into a single boundary at `n`, and
the IR carries the direction.

**Test:** a fixture with paired queries must yield one boundary, not two.

---

## P1-5 — Constrain colour role inference *(F-05, corr_0002, corr_0003)*

**The failure:** `#533afd` bound to both `brand.primary` and `text.secondary`;
`#425466` bound to both `text.primary` and `border.default`.

**Change:**
- A colour bound to one role is excluded from mutually exclusive roles
- Border colour must come from an element with a non-default `border-style` and a
  colour distinct from its own `currentColor`
- When the only candidate for a role is already bound, emit `unknown` rather than
  double-binding

**Test:** a fixture where the link colour equals the brand colour must leave
`text.secondary` unknown, not duplicated.

---

## P1-6 — Suppress zero-valued surface tokens *(F-06, corr_0004)*

**Change:** a radius, border-width, or shadow measured as zero from a single
sample is not emitted as a token. Zero is emitted only when corroborated across
the majority of instances of that component type.

---

## P2-7 — Resolve `line-height: normal` *(F-07)*

**Change:** when computed line-height is `normal`, measure a text node's rendered
line box via `Range.getClientRects()` and record the result as `measured` with a
note that it was derived from layout rather than declaration.

---

## P2-8 — Report background images on painted surfaces *(F-08)*

**Change:** `paintedSurface` carries `backgroundImage` alongside
`backgroundColor`, and a `paintedVia: "color" | "image" | "both"` discriminator.

---

## P2-9 — Promote Playwright to the primary capture tier *(F-09)*

Already built as `tools/capture-playwright.mjs` and used for this run. Phase 1
should formalise it:

- Implement `PlaywrightDriver` against the existing `CaptureDriver` interface
- Multi-viewport capture (1440 / 1024 / 768 / 375) in one session
- Disk-written screenshots per viewport
- State induction (`:hover`, `:focus-visible`, `aria-expanded`)
- Keep `McpBrowserDriver` for quick same-origin work

**Still deferred:** the fidelity loop, pixel diffing, and build-side comparison.

---

## P1-10 — Add a channel for scope defects *(architectural)*

**The gap:** F-01 through F-04 and F-08 cannot be expressed as corrections. A
correction fixes a *wrong claim*; these are wrong *selection*, wrong
*aggregation*, wrong *emission*. Every individual claim Stripe produced was
locally defensible.

**Change:** add a second record type — a **defect report** — carrying the
observation, the affected module and heuristic, the reproducing capture, and the
proposed rule. It never patches evidence; it accumulates against the code and
feeds the Phase 1 backlog directly.

This matters more than any single heuristic fix. Without it, the learning system
can only ever learn that individual numbers were wrong, never that it was looking
in the wrong place.

---

## Regression targets

Phase 1 is complete when, re-running `stripe.com/pricing` unchanged:

1. The primary component resolves inside `main`, not the site header
2. Container max-width and padding come from the content region
3. Shadow and border tokens are non-empty (the page visibly uses both)
4. Overall confidence is **below 0.5** if coverage is still partial, and the
   spec leads with a coverage warning
5. Breakpoints collapse to distinct boundaries with recorded direction
6. No colour occupies two mutually exclusive roles
7. All 14 checklist items pass, with checks 2 and 7 genuinely exercised against a
   hashed-classname site and a screenshot-only input respectively

# Evidence status and confidence

## Why five statuses and not a confidence number

A single confidence score collapses two different things: how the value was
obtained, and how much it can be trusted. Provenance is a fact you record;
trust is a number you derive from it. Keeping them separate is what makes a
claim auditable — you can disagree with an inference without disputing that the
underlying samples were read correctly.

## The vocabulary

### `measured`
Physical geometry read off the rendered layout — `getBoundingClientRect`,
box-model resolution, computed column counts.

Method: `layout-rect`. Base confidence 1.0.

Example: a container's measured width of 1180px, with `max-width: 1180px`
confirmed across 5 instances.

### `observed`
Declared in a style source and read back directly — a computed style, a CSS
custom property, a stylesheet rule, a media-query condition.

Methods: `computed-style`, `css-custom-property`, `stylesheet-rule`, `media-query`.
Base confidence 0.95.

Slightly below `measured` because a declared value can be overridden by
something you did not sample, while rendered geometry is what it is.

### `inferred`
A pattern generalised across ≥3 measured or observed samples. The samples are
facts; the generalisation is a judgement.

Methods: `frequency-inference`, `structural-inference`. Base confidence 0.75.

Examples: an 8px base unit explaining 88% of observed spacing; "the most
frequent non-neutral colour is the brand colour" — a reasonable reading of the
evidence that is also the single most common thing users correct.

### `estimated`
Reconstructed from a screenshot or a partial signal. Base confidence 0.45.

Method: `vision`.

Must render with hedging ("approximately 24px") and is excluded from the token
file. Validation rule V4 enforces both.

### `unknown`
Not determined. Confidence 0.

This is a legitimate, useful output. `unknowns` is a required array on every IR,
and each entry carries a reason. A recorded gap tells the reader what to go and
check; a silent omission tells them nothing and looks like completeness.

## Confidence arithmetic

```
confidence = base(status) × agreement × sampleFactor

base:         measured 1.0 · observed 0.95 · inferred 0.75 · estimated 0.45 · unknown 0
agreement:    fraction of samples returning this value (0..1)
sampleFactor: min(1, 0.6 + 0.1 × sampleSize)
```

Both multipliers matter:

- **agreement below 1 is a signal, not noise.** It usually means a variant
  exists that the component inventory has not captured yet.
- **sampleFactor** keeps a single reading from carrying the same weight as
  fourteen consistent ones.

Confidence is always derived and never authored. `applyCorrections` is the only
place a confidence is set directly, and only because a human has asserted the
value.

## What each status is allowed to do

| | Renders exactly | Enters token file | Backs a fidelity assertion |
|---|---|---|---|
| `measured` | yes | yes | yes |
| `observed` | yes | yes | yes |
| `inferred` | yes, labelled | yes | yes, labelled |
| `estimated` | hedged only | **no** | no |
| `unknown` | never | **no** | no |

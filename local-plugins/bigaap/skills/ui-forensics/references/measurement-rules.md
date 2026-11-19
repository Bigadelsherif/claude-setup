# Measurement rules

## The law

Every claim carries **a value and a status**. Claims with status `measured`,
`observed`, or `inferred` additionally carry an evidence reference.

This is enforced by validation rule V3, not by good intentions. A spec that
fails V3 does not get prompts generated from it.

## Rewrites

Never write the left column. Write the right.

| Don't | Do |
|---|---|
| Modern layout | Main content sits in an 1180px max-width container with 24px horizontal padding [ev_0061] |
| Generous whitespace | The most frequent spacing values are 8px, 16px, 24px and 48px, on an 8px base unit [ev_0051] |
| Rounded cards | Cards use a 12px border radius; buttons use 8px; badges use a 999px pill [ev_0072, ev_0070, ev_0068] |
| Soft shadows | Card shadow is `0 8px 24px rgba(16, 24, 40, 0.08)` [ev_0075] |
| Large typography | The primary heading is 64px with a 1.05 line-height ratio and -0.03em letter spacing [ev_0036, ev_0038, ev_0040] |
| Subtle animation | Hover transitions run 180ms on `cubic-bezier(0.4, 0, 0.2, 1)` [ev_0079, ev_0080] |
| Clean type hierarchy | Rendered sizes are 14, 16, 20, 24, 40 and 64px [ev_0050] |
| Nice contrast | `text.primary` on `surface.page` measures 16.7:1, clearing WCAG AA [ev_0002, ev_0001] |

## The adjective advisory

Validation rule V5 warns on *modern, clean, generous, subtle, soft, sleek,
elegant, minimal, spacious, rounded, smooth, polished, premium, large, bold,
crisp, airy, refined* when they appear without a number or evidence reference in
the same sentence.

It is a **warning**, not a ban. "Cards use a subtle 12px radius" is fine — the
measurement is right there. "The design feels subtle" is not, because it asserts
nothing checkable.

The real gate is V3. V5 is a nudge on top of it.

## When you cannot measure

Say which of these applies and why:

- **`inferred`** — you have ≥3 consistent samples and are generalising from them.
  Name the sample size. "8px base unit, explaining 88% of observed spacing by
  frequency" is an inference with its working shown.
- **`estimated`** — you reconstructed it from a screenshot or a partial signal.
  Must render with hedging ("approximately 24px"). Excluded from the token file.
- **`unknown`** — you could not determine it. Record the claim path and the
  reason. This is a legitimate output.

An `unknown` with a reason is more useful than a confident wrong number, because
it tells the reader exactly what to go and check.

## Confidence

Never author a confidence value. It is derived:

```
confidence = base(status) × agreement × sampleFactor
base:         measured 1.0 · observed 0.95 · inferred 0.75 · estimated 0.45 · unknown 0
sampleFactor: min(1, 0.6 + 0.1 × sampleSize)
agreement:    fraction of samples returning this value
```

A hand-set confidence is an opinion wearing a number.

## Rounding

Computed values carry `rem` rounding artefacts — `16.008px` from a `1.0005rem`.
Snap to an integer only when the drift is under 0.05px, and record both values.

Do not round `67.2px`. A 1.05 ratio on a 64px heading genuinely produces 67.2px;
reporting 67px would be inventing precision that was never there.

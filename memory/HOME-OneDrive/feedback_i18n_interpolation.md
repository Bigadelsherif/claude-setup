---
name: feedback-i18n-interpolation
description: "Standing rule for i18n runtime interpolation — tFmt with named placeholders, JSX splitting, and what not to do"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 06e7ac3e-180c-41c7-b7c1-43f081cb3549
---

Apply this rule before making any i18n-related code changes.

## Runtime interpolation rule

If a runtime value is embedded inside a sentence or phrase, prefer a single translatable string with named `{{placeholder}}` slots and `tFmt()`.

```tsx
tFmt('Deal agreed at {{amount}} EGP', { amount: egp(n) })
tFmt('{{count}} cars added this week', { count: String(n) })
```

## Acceptable short-form exception

A short standalone count + noun label is acceptable without `tFmt` **only when** current supported locales (en/ar/fr) do not require different word order or extra grammar handling.

```tsx
`${n} ${t('cars')}`   // acceptable — French word order matches English here
```

## JSX / styled-content rule

If the translated text must wrap or split around styled JSX (a `<b>` amount, link, or icon), do not force `tFmt` if it would flatten the markup. Use JSX splitting or the smallest safe structure that preserves styling.

```tsx
<>{t('From ~')}<b>{egp(n)}</b>{t(' EGP/mo · Misr · AXA · gig')}</>
```

## Do not

- Concatenate multiple translated fragments around runtime values when a full-sentence `tFmt` key would work.
- Build the full English runtime string first and then pass that assembled result into `t()`.
- Fake-translate user-generated content, proper nouns, language self-names, or demo content just to claim completeness.

## Checklist when applying this rule in a phase

1. Identify every runtime sentence in scope.
2. Prefer converting those sentences to `tFmt` keys with named placeholders.
3. Leave short safe labels as-is only if grammar and word order are safe for en/ar/fr.
4. If markup prevents `tFmt`, keep the smallest JSX split possible and explain why.
5. Preserve existing English fallback behavior outside the scoped phase.

## After changes — required reporting

- List every new `tFmt` key added.
- List every place where JSX splitting was kept instead of `tFmt`.
- Call out any remaining runtime strings that still need a later interpolation or pluralization pass.

## Implementation note

`tFmt` is wired into `useT()` as of Phase 6 (`src/i18n/I18nProvider.tsx`). Destructure it alongside `t` and `ar`.

# Stack adapters

**Generated from `src/prompts/stack-adapter.mjs` by `node tools/generate-command-docs.mjs`.**

Implemented adapters: `next-tailwind`.

Every other stack is **refused rather than approximated**, and the refusal is the
feature. A prompt containing plausible-looking Svelte for a stack nobody implemented
is worse than a prompt containing none, because the reader cannot tell which parts
were checked.

## What an adapter is responsible for

| Area | What it covers |
| --- | --- |
| Component structure | How the measured components map onto files and props. Structure only — never a claim about the reference. |
| Token mapping | Measured values to design tokens, with the rule used where a value does not land on a step. |
| Tailwind mapping | Which utilities express which tokens, and when an arbitrary value is required instead. |
| CSS variable mapping | Which values belong in CSS custom properties rather than utilities, and why. |
| Responsive rules | How measured breakpoints become configured ones. Never a mapping onto the framework defaults. |
| State implementation | How measured interaction states are expressed, and what to do where a state was never induced. |
| Accessibility requirements | What the chosen policy requires, named as a published standard. |
| Acceptance criteria | What a reviewer checks in this stack specifically. |

## `next-tailwind` — Next.js · React · TypeScript · Tailwind CSS

| Area | How this stack expresses it | Exactness |
| --- | --- | --- |
| Spacing | Tailwind's scale is a fixed set of steps. A measured value between two steps needs an arbitrary value (`p-[13px]`) or a recorded decision to round. | arbitrary values are exact; scale steps are not |
| Typography | `text-*` carries both size and line-height. A measured size paired with a different measured line-height needs both set explicitly. | explicit size and leading are exact |
| Color | Use the literal measured value where it is not already in the configured palette. | arbitrary colors are exact; nearest-palette-match is not |
| Breakpoints | Configure the measured breakpoints in `tailwind.config`. Do not map them onto `sm`/`md`/`lg`. | configured breakpoints are exact |
| Radius, borders, shadows | Measured values go in CSS variables and are referenced from the theme, so one change updates every use. | exact |
| State | `hover:`, `focus-visible:`, `disabled:` variants express measured states. `focus-visible` rather than `focus` unless the reference was measured otherwise. | exact where the state was induced and measured |

### Where each one goes wrong

- **Spacing.** A silent substitution loses the measurement, and nothing downstream records that it happened.
- **Typography.** Taking the class default means the pairing is the framework's, not the reference's.
- **Color.** A nearest match is a substitution. Record it or use the literal.
- **Breakpoints.** The framework defaults are unlikely to match any real reference.
- **State.** Where a state was never induced, implement nothing and leave it in Unknowns.

### Motion

Use CSS transitions where the measured motion is a simple property change. Reach for GSAP only where the evidence records a sequence or an easing the platform cannot express. Where no motion was measured, add none.

### What it cannot express exactly

- Transition timing functions beyond the built-in easings — a measured cubic-bezier needs a custom theme entry.
- Sub-pixel measurements, which the scale has no representation for.
- Any value the analysis returned as unknown. The stack cannot supply what the evidence did not.

An adapter that claimed to express everything exactly would be lying about at least
one of these.

## An unsupported stack

When no adapter exists, the implementation notes state the absence — *"`svelte-kit` has no adapter in this build. No stack-specific guidance is generated for it, and none is invented."* — and then:

**What is still valid:**

- Every measured value in the accompanying prompt is stack-independent and complete.
- The acceptance criteria are expressed as measurements, so they can be checked in any stack.
- The evidence limitations apply regardless of what you build in.

**Guidance that holds regardless of framework:**

- Express measured values literally rather than mapping them onto whatever scale your framework ships with.
- Where a measured value does not fit your system's steps, record the substitution instead of making it silently.
- Where the analysis says unknown, decide it yourself and write the decision down — nothing here supplies a default.

Nothing framework-specific is invented, and the notes say so explicitly so the
guidance cannot be read as adapter output.

## Foreign syntax is rejected

Framework syntax belonging to a stack other than the requested one is a **blocking**
lint finding (`PL11`). Code fences are searched too — syntax inside a fence is more
dangerous than syntax in prose, not less, because it looks like something to copy.

| Stack | Detected by |
| --- | --- |
| Svelte | `/\$:\s*\w+|<script\s+lang="ts">[\s\S]*?export let\b|\bon:cli…` |
| Vue | `/\bv-if\b|\bv-for\b|\bv-model\b|<template>[\s\S]*?<script se…` |
| Angular | `/\*ngIf\b|\*ngFor\b|\[\(ngModel\)\]|\bNgModule\b/…` |
| Solid | `/\bcreateSignal\(|<Show\s+when=|<For\s+each=/…` |
| Flutter | `/\bWidget build\(|\bStatelessWidget\b|\bEdgeInsets\./…` |
| SwiftUI | `/\bstruct \w+: View\b|\.padding\(\.\w+|\bVStack\s*\{/…` |

The reverse also holds: framework syntax must stay **out** of the stack-agnostic
analysis, where a `className` would quietly commit a reader to React before anyone
chose it.

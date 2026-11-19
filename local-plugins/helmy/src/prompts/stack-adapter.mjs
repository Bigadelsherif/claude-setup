/**
 * Stack adapters.
 *
 * One adapter is implemented: Next.js / React / TypeScript / Tailwind. Every
 * other stack is refused rather than approximated, and the refusal is the
 * feature — a prompt containing plausible-looking Svelte for a stack nobody
 * implemented is worse than a prompt containing none, because the reader cannot
 * tell which parts were checked.
 *
 * Two things live here:
 *
 *   1. **The output contract** — what the adapter is responsible for saying, so
 *      the linter can check a prompt covers it.
 *   2. **Syntax detection** — framework-specific syntax that must not appear in
 *      stack-agnostic analysis, and must not appear at all for an unsupported
 *      stack.
 *
 * The second is what makes "never invent stack-specific syntax" enforceable
 * rather than a promise.
 */

export const SUPPORTED_STACKS = Object.freeze(["next-tailwind"]);

/** The adapter's output contract: eight things it must address. */
export const ADAPTER_CONTRACT = Object.freeze([
  { id: "component-structure", label: "Component structure", describe: "How the measured components map onto files and props. Structure only — never a claim about the reference." },
  { id: "token-mapping", label: "Token mapping", describe: "Measured values to design tokens, with the rule used where a value does not land on a step." },
  { id: "tailwind-mapping", label: "Tailwind mapping", describe: "Which utilities express which tokens, and when an arbitrary value is required instead." },
  { id: "css-variable-mapping", label: "CSS variable mapping", describe: "Which values belong in CSS custom properties rather than utilities, and why." },
  { id: "responsive-rules", label: "Responsive rules", describe: "How measured breakpoints become configured ones. Never a mapping onto the framework defaults." },
  { id: "state-implementation", label: "State implementation", describe: "How measured interaction states are expressed, and what to do where a state was never induced." },
  { id: "accessibility-requirements", label: "Accessibility requirements", describe: "What the chosen policy requires, named as a published standard." },
  { id: "acceptance-criteria", label: "Acceptance criteria", describe: "What a reviewer checks in this stack specifically." }
]);

/**
 * The implemented adapter.
 *
 * Everything here is a fact about the framework, not about any reference. That
 * separation is what lets implementation notes be generated without adding a
 * single claim to the analysis.
 */
export const NEXT_TAILWIND = Object.freeze({
  id: "next-tailwind",
  label: "Next.js · React · TypeScript · Tailwind CSS",
  frameworks: ["next", "react", "typescript", "tailwind"],
  motion: {
    preferred: "native CSS transitions",
    library: "GSAP",
    rule: "Use CSS transitions where the measured motion is a simple property change. Reach for GSAP only where the evidence records a sequence or an easing the platform cannot express. Where no motion was measured, add none."
  },
  mapping: [
    {
      area: "Spacing",
      how: "Tailwind's scale is a fixed set of steps. A measured value between two steps needs an arbitrary value (`p-[13px]`) or a recorded decision to round.",
      exact: "arbitrary values are exact; scale steps are not",
      caution: "A silent substitution loses the measurement, and nothing downstream records that it happened."
    },
    {
      area: "Typography",
      how: "`text-*` carries both size and line-height. A measured size paired with a different measured line-height needs both set explicitly.",
      exact: "explicit size and leading are exact",
      caution: "Taking the class default means the pairing is the framework's, not the reference's."
    },
    {
      area: "Color",
      how: "Use the literal measured value where it is not already in the configured palette.",
      exact: "arbitrary colors are exact; nearest-palette-match is not",
      caution: "A nearest match is a substitution. Record it or use the literal."
    },
    {
      area: "Breakpoints",
      how: "Configure the measured breakpoints in `tailwind.config`. Do not map them onto `sm`/`md`/`lg`.",
      exact: "configured breakpoints are exact",
      caution: "The framework defaults are unlikely to match any real reference."
    },
    {
      area: "Radius, borders, shadows",
      how: "Measured values go in CSS variables and are referenced from the theme, so one change updates every use.",
      exact: "exact",
      caution: null
    },
    {
      area: "State",
      how: "`hover:`, `focus-visible:`, `disabled:` variants express measured states. `focus-visible` rather than `focus` unless the reference was measured otherwise.",
      exact: "exact where the state was induced and measured",
      caution: "Where a state was never induced, implement nothing and leave it in Unknowns."
    }
  ],
  cannotExpressExactly: [
    "Transition timing functions beyond the built-in easings — a measured cubic-bezier needs a custom theme entry.",
    "Sub-pixel measurements, which the scale has no representation for.",
    "Any value the analysis returned as unknown. The stack cannot supply what the evidence did not."
  ]
});

export const ADAPTERS = Object.freeze({ "next-tailwind": NEXT_TAILWIND });

export const adapterFor = (stack) => ADAPTERS[stack] ?? null;
export const isSupportedStack = (stack) => SUPPORTED_STACKS.includes(stack);

/**
 * Framework syntax, by the stack it belongs to.
 *
 * Used two ways: to reject syntax from a stack nobody implemented, and to keep
 * framework syntax out of the stack-agnostic analysis — where a `className`
 * would quietly commit a reader to React before anyone chose it.
 */
export const STACK_SYNTAX = Object.freeze([
  { stack: "svelte", pattern: /\$:\s*\w+|<script\s+lang="ts">[\s\S]*?export let\b|\bon:click\b|\bsvelte:\w+/, label: "Svelte" },
  { stack: "vue", pattern: /\bv-if\b|\bv-for\b|\bv-model\b|<template>[\s\S]*?<script setup>|\b@click\s*=/, label: "Vue" },
  { stack: "angular", pattern: /\*ngIf\b|\*ngFor\b|\[\(ngModel\)\]|\bNgModule\b/, label: "Angular" },
  { stack: "solid", pattern: /\bcreateSignal\(|<Show\s+when=|<For\s+each=/, label: "Solid" },
  { stack: "flutter", pattern: /\bWidget build\(|\bStatelessWidget\b|\bEdgeInsets\./, label: "Flutter" },
  { stack: "swiftui", pattern: /\bstruct \w+: View\b|\.padding\(\.\w+|\bVStack\s*\{/, label: "SwiftUI" }
]);

/** Syntax belonging to the implemented adapter. Fine in a prompt, not in analysis. */
export const IMPLEMENTED_SYNTAX = Object.freeze([
  { pattern: /\bclassName\s*=/, label: "React `className`" },
  { pattern: /\buse[A-Z]\w+\(/, label: "React hook" },
  { pattern: /\btw-|@apply\b/, label: "Tailwind directive" },
  { pattern: /\bexport default function \w+\(/, label: "React component" }
]);

/**
 * Finds framework syntax that does not belong to the requested stack.
 *
 * Code fences are searched too. Syntax inside a fence is more dangerous than
 * syntax in prose, not less — it looks like something to copy.
 */
export function findForeignSyntax(text, { stack = "next-tailwind" } = {}) {
  const found = [];
  const lines = String(text ?? "").split("\n");

  for (const { stack: owner, pattern, label } of STACK_SYNTAX) {
    if (owner === stack) continue;
    lines.forEach((line, i) => {
      if (pattern.test(line)) {
        found.push({
          line: i + 1,
          stack: owner,
          label,
          text: line.trim().slice(0, 100),
          why: isSupportedStack(stack)
            ? `${label} syntax in a prompt targeting \`${stack}\`. A builder copying it would be writing for a framework nobody chose.`
            : `${label} syntax for a stack with no adapter. Nothing here was checked against ${label}, so its correctness is unknown and it looks authoritative anyway.`
        });
      }
    });
  }
  return found;
}

/** Finds implemented-stack syntax in a document that should be stack-agnostic. */
export function findStackSyntaxInAnalysis(text) {
  const found = [];
  const lines = String(text ?? "").split("\n");
  for (const { pattern, label } of IMPLEMENTED_SYNTAX) {
    lines.forEach((line, i) => {
      if (pattern.test(line)) {
        found.push({
          line: i + 1,
          label,
          text: line.trim().slice(0, 100),
          why: `${label} in stack-agnostic analysis. The analysis describes what was measured; committing it to a framework decides something nobody asked it to decide.`
        });
      }
    });
  }
  return found;
}

/**
 * What to say when the requested stack has no adapter.
 *
 * States the absence, gives only guidance that holds regardless of framework,
 * and never implies an adapter exists. The measured values are complete and
 * stack-independent — only the guidance about expressing them is missing, and
 * saying so precisely is the difference between a gap and a failure.
 */
export function unsupportedStackGuidance(stack) {
  return {
    stack,
    adapterAvailable: false,
    statement: `\`${stack}\` has no adapter in this build. No stack-specific guidance is generated for it, and none is invented.`,
    whatIsStillValid: [
      "Every measured value in the accompanying prompt is stack-independent and complete.",
      "The acceptance criteria are expressed as measurements, so they can be checked in any stack.",
      "The evidence limitations apply regardless of what you build in."
    ],
    safeGuidance: [
      "Express measured values literally rather than mapping them onto whatever scale your framework ships with.",
      "Where a measured value does not fit your system's steps, record the substitution instead of making it silently.",
      "Where the analysis says unknown, decide it yourself and write the decision down — nothing here supplies a default."
    ],
    /* Named explicitly so a caller cannot render this as though an adapter had
     * merely declined to say much. */
    doNotInfer: `Nothing above is specific to ${stack}. Do not read it as adapter output.`,
    supportedInstead: SUPPORTED_STACKS
  };
}

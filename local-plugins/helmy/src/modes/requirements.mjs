/**
 * Mode requirement matrix.
 *
 * The gate's Phase 1 question was "is the evidence good?". This is the Phase 2
 * question: **is the evidence sufficient for what was asked?**
 *
 * The difference matters because unknowns are not intrinsically bad. Fifty
 * unknowns that never touch what `recreate` depends on is a usable run. Three
 * unknowns that happen to be the container width, the type ramp and the
 * component anatomy is not. A single global threshold cannot tell those apart,
 * so there isn't one — each mode declares what it cannot function without.
 *
 * This file is DATA. Every requirement is expressed through a small set of
 * resolvers so the matrix stays schema-validatable and inspectable rather than
 * becoming a pile of bespoke predicates.
 */

import { STATUS } from "../evidence/status.mjs";

export const MODES = Object.freeze({
  ANALYZE: "analyze",
  RECREATE: "recreate",
  ADAPT: "adapt",
  EXTEND: "extend",
  IMPROVE: "improve"
});

export const DECISION = Object.freeze({
  ALLOWED: "allowed",
  ALLOWED_WITH_WARNINGS: "allowed-with-warnings",
  BLOCKED: "blocked",
  BLOCKED_WITH_RECAPTURE: "blocked-with-recapture-recommendation"
});

/**
 * How a gap could be closed. Drives whether a block is worth re-capturing for.
 *
 *  recapture — another capture of the same page would supply it
 *  source    — the input kind is fundamentally incapable (a screenshot has no
 *              computed styles, and no amount of re-capturing changes that)
 *  none      — the reference genuinely does not contain it
 */
export const REMEDY = Object.freeze({
  RECAPTURE: "recapture",
  SOURCE: "source",
  NONE: "none"
});

/** Resolver kinds a requirement may use. Each is implemented in evaluate.mjs. */
export const RESOLVER = Object.freeze({
  CLAIM: "claim",
  COMPONENT: "component",
  COMPONENT_VARIANTS: "component-variants",
  TOKEN_GROUP: "token-group",
  COLOR_ROLES: "color-roles",
  VIEWPORTS: "viewports",
  STATES: "states",
  IMAGERY: "imagery",
  MOTION: "motion",
  A11Y: "a11y",
  REGION: "region",
  UNCONTESTED: "uncontested-critical-claims",
  TARGET_BRIEF: "target-brief"
});

/* --------------------------------------------------------- shared pieces */

const regionReached = (severity = "blocking") => ({
  id: "target-region",
  label: "Target page region reached",
  resolver: RESOLVER.REGION,
  severity,
  remedy: REMEDY.RECAPTURE,
  description: "The primary content region was identified and sampled."
});

const primaryContainer = (severity = "blocking") => ({
  id: "primary-container",
  label: "Primary container",
  resolver: RESOLVER.CLAIM,
  claims: ["layout.container.maxWidth"],
  match: "all",
  minStatus: STATUS.INFERRED,
  severity,
  remedy: REMEDY.RECAPTURE,
  description: "A page container width, without which nothing can be laid out."
});

const layoutGrid = (severity) => ({
  id: "layout-grid",
  label: "Layout / grid structure",
  resolver: RESOLVER.CLAIM,
  claims: ["layout.grid.columns", "layout.container.paddingX"],
  match: "any",
  minStatus: STATUS.INFERRED,
  severity,
  remedy: REMEDY.RECAPTURE,
  description: "At least one structural rule for how content is arranged."
});

/**
 * Body type is read directly and can be held to `observed`. The ramp is a
 * pattern across samples and is `inferred` BY CONSTRUCTION — demanding
 * `observed` of it would make the requirement permanently unsatisfiable, which
 * is a bug in the requirement rather than a fact about any page.
 */
const typographyBody = (severity, minStatus = STATUS.OBSERVED) => ({
  id: "typography-body",
  label: "Body typography",
  resolver: RESOLVER.CLAIM,
  claims: ["tokens.typography.body.fontSize"],
  match: "all",
  minStatus,
  severity,
  remedy: REMEDY.RECAPTURE,
  description: "The base text size everything else is measured against."
});

const typographyScale = (severity) => ({
  id: "typography-scale",
  label: "Typography scale",
  resolver: RESOLVER.CLAIM,
  claims: ["scales.typeRamp"],
  match: "all",
  minStatus: STATUS.INFERRED,
  severity,
  remedy: REMEDY.RECAPTURE,
  description: "The set of rendered sizes. Inferred from samples, never declared."
});

const colorRoles = (minCount, severity) => ({
  id: "color-roles",
  label: `Colour roles (>= ${minCount})`,
  resolver: RESOLVER.COLOR_ROLES,
  minCount,
  severity,
  remedy: REMEDY.RECAPTURE,
  description: "Distinct named colour roles, not merely distinct colours."
});

/**
 * A base unit and a ramp are inferences; only the raw observed values are
 * `observed`. Any one of the three is enough to lay a page out, so the
 * requirement matches on `any` at the weakest of their statuses — a page with
 * no determinable scale still satisfies this through its observed values, which
 * is the correct outcome for `fixtures/spacing/scale-irregular`.
 */
const spacingRhythm = (severity) => ({
  id: "spacing",
  label: "Spacing rhythm",
  resolver: RESOLVER.CLAIM,
  claims: ["scales.spacingBaseUnit", "scales.spacingRamp", "scales.spacingObserved"],
  match: "any",
  minStatus: STATUS.INFERRED,
  severity,
  remedy: REMEDY.RECAPTURE,
  description: "A base unit, a ramp, or at minimum the observed spacing values."
});

/**
 * No unresolved disagreement about a value the output depends on.
 *
 * A contested decorative colour is a note. A contested container width is a
 * different page, and building from one would produce something that matches
 * neither source.
 */
const uncontestedCriticals = (severity) => ({
  id: "uncontested-criticals",
  label: "No unresolved disagreement on critical values",
  resolver: RESOLVER.UNCONTESTED,
  severity,
  remedy: REMEDY.NONE,
  description:
    "Container, grid, typography, spacing, component anatomy, responsive and interaction claims must not be contested between sources."
});

const componentAnatomy = (minAnatomy, minConfidence, severity) => ({
  id: "component-anatomy",
  label: `Primary component anatomy (>= ${minAnatomy} properties)`,
  resolver: RESOLVER.COMPONENT,
  minAnatomy,
  minConfidence,
  severity,
  remedy: REMEDY.RECAPTURE,
  description:
    "A modelled component whose surface resolved. A candidate that was rejected does not count."
});

/* ======================================================= the matrix ==== */

export const modeRequirements = Object.freeze({
  /* ------------------------------------------------------------ ANALYZE */
  analyze: {
    label: "Analyze",
    intent: "Explain the reference. Produce no implementation guidance.",
    required: [
      regionReached("blocking"),
      {
        id: "identifiable-layout",
        label: "Identifiable main layout",
        resolver: RESOLVER.CLAIM,
        claims: ["layout.container.maxWidth", "layout.grid.columns", "layout.breakpoints"],
        match: "any",
        minStatus: STATUS.ESTIMATED,
        severity: "blocking",
        remedy: REMEDY.RECAPTURE,
        description: "At least one structural fact about how the page is laid out."
      }
    ],
    optional: [
      typographyBody("warning"),
      typographyScale("warning"),
      colorRoles(2, "warning"),
      spacingRhythm("warning"),
      componentAnatomy(1, 0, "warning"),
      { id: "motion", label: "Motion", resolver: RESOLVER.MOTION, severity: "warning", remedy: REMEDY.RECAPTURE, description: "Transition timing. Not needed to describe a page." },
      { id: "states", label: "Interaction states", resolver: RESOLVER.STATES, minDetermined: 1, severity: "warning", remedy: REMEDY.RECAPTURE, description: "Hover/focus. Absence is reported, not fatal." }
    ],
    thresholds: {
      minConfidence: 0.25,
      minContentReached: 0.25,
      minCoverageFactor: 0.3,
      minComponentConfidence: 0
    },
    acceptableSourceKinds: ["dom", "computed-style", "screenshot", "visual-model", "user-correction"],
    allowScreenshotEstimates: true,
    requiredArtifacts: ["output/design-spec.md", "output/coverage-report.md", "output/extraction-warnings.md"],
    notes: "Partial evidence is acceptable provided everything is labelled and unknowns survive."
  },

  /* ----------------------------------------------------------- RECREATE */
  recreate: {
    label: "Recreate",
    intent: "Reproduce the structural and visual system as measured.",
    required: [
      regionReached("blocking"),
      primaryContainer("blocking"),
      layoutGrid("blocking"),
      typographyBody("blocking"),
      typographyScale("blocking"),
      colorRoles(3, "blocking"),
      spacingRhythm("blocking"),
      componentAnatomy(3, 0.5, "blocking"),
      uncontestedCriticals("blocking"),
      {
        id: "imagery",
        label: "Imagery behaviour",
        resolver: RESOLVER.IMAGERY,
        severity: "warning",
        remedy: REMEDY.RECAPTURE,
        description: "How media is sized and fitted, where the page uses media at all."
      },
      {
        id: "responsive",
        label: "Responsive behaviour for the requested viewports",
        resolver: RESOLVER.VIEWPORTS,
        severity: "blocking",
        remedy: REMEDY.RECAPTURE,
        description: "Every requested viewport must have been captured."
      },
      {
        id: "states",
        label: "Important interactive states",
        resolver: RESOLVER.STATES,
        minDetermined: 1,
        severity: "warning",
        conditionalOn: "includeStates",
        conditionalSeverity: "blocking",
        remedy: REMEDY.RECAPTURE,
        description: "Hover and focus. Blocking only when state recreation was requested."
      },
      {
        id: "motion",
        label: "Motion",
        resolver: RESOLVER.MOTION,
        severity: "warning",
        conditionalOn: "includeMotion",
        conditionalSeverity: "blocking",
        remedy: REMEDY.RECAPTURE,
        description: "Blocking only when motion recreation was requested."
      }
    ],
    optional: [],
    thresholds: {
      minConfidence: 0.55,
      minContentReached: 0.6,
      minCoverageFactor: 0.5,
      minComponentConfidence: 0.5
    },
    acceptableSourceKinds: ["dom", "computed-style", "user-correction"],
    allowScreenshotEstimates: false,
    requiredArtifacts: [
      "output/design-spec.md",
      "output/rebuild-prompt.md",
      "output/fidelity-checklist.md",
      "analysis/extracted-tokens.json"
    ],
    notes:
      "The strictest mode. Blocks when a critical value is only estimated, or when the primary component is uncertain."
  },

  /* -------------------------------------------------------------- ADAPT */
  adapt: {
    label: "Adapt",
    intent: "Apply the reference's design language to a different product's information architecture.",
    required: [
      regionReached("blocking"),
      {
        id: "target-brief",
        label: "Target product brief",
        resolver: RESOLVER.TARGET_BRIEF,
        severity: "blocking",
        // No capture of the reference can supply this; it is user input.
        remedy: REMEDY.NONE,
        description:
          "A validated target-brief.json. Without one there is no target product, and nothing may be invented to stand in for one."
      },
      typographyBody("blocking", STATUS.INFERRED),
      typographyScale("blocking"),
      colorRoles(3, "blocking"),
      spacingRhythm("blocking"),
      {
        id: "token-relationships",
        label: "Token relationships",
        resolver: RESOLVER.TOKEN_GROUP,
        groups: ["radius", "elevation", "border", "motion"],
        minGroups: 1,
        severity: "blocking",
        remedy: REMEDY.RECAPTURE,
        description: "At least one surface or motion token family, so the language has texture beyond colour and type."
      },
      {
        id: "component-patterns",
        label: "Component patterns",
        resolver: RESOLVER.COMPONENT,
        minAnatomy: 1,
        minConfidence: 0.4,
        severity: "warning",
        remedy: REMEDY.RECAPTURE,
        description: "How components are treated. Useful, not essential — the target supplies its own structure."
      },
      {
        id: "interaction-principles",
        label: "Interaction principles",
        resolver: RESOLVER.MOTION,
        severity: "warning",
        remedy: REMEDY.RECAPTURE,
        description: "Timing and easing that characterise how the language behaves."
      }
    ],
    optional: [],
    thresholds: {
      minConfidence: 0.45,
      minContentReached: 0.5,
      minCoverageFactor: 0.45,
      minComponentConfidence: 0
    },
    acceptableSourceKinds: ["dom", "computed-style", "user-correction"],
    allowScreenshotEstimates: false,
    requiredArtifacts: ["output/design-spec.md", "output/adaptation-prompt.md", "analysis/extracted-tokens.json"],
    plannedArtifacts: [],
    notes:
      "Does not require the original page structure, content, or brand identity — the target product supplies its own. Missing brand assets are never a gap here."
  },

  /* ------------------------------------------------------------- EXTEND */
  extend: {
    label: "Extend",
    intent: "Create a new page that belongs to the reference's existing system.",
    required: [
      regionReached("blocking"),
      primaryContainer("blocking"),
      layoutGrid("blocking"),
      typographyBody("blocking"),
      typographyScale("blocking"),
      colorRoles(3, "blocking"),
      spacingRhythm("blocking"),
      componentAnatomy(3, 0.5, "blocking"),
      uncontestedCriticals("blocking"),
      {
        id: "component-variants",
        label: "Component variants",
        resolver: RESOLVER.COMPONENT_VARIANTS,
        minVariants: 1,
        severity: "blocking",
        remedy: REMEDY.RECAPTURE,
        description:
          "At least one variant of a component. Without variation there is no evidence of how the system flexes, so a new page cannot be shown to belong to it."
      },
      {
        id: "responsive-rules",
        label: "Responsive rules",
        resolver: RESOLVER.CLAIM,
        claims: ["layout.breakpoints"],
        match: "all",
        minStatus: STATUS.OBSERVED,
        severity: "blocking",
        remedy: REMEDY.RECAPTURE,
        description: "The breakpoints a new page must honour."
      },
      {
        id: "interaction-patterns",
        label: "Interaction patterns",
        resolver: RESOLVER.STATES,
        minDetermined: 1,
        severity: "warning",
        remedy: REMEDY.RECAPTURE,
        description: "How the system responds to interaction."
      }
    ],
    optional: [],
    thresholds: {
      minConfidence: 0.55,
      minContentReached: 0.6,
      minCoverageFactor: 0.55,
      minComponentConfidence: 0.5
    },
    acceptableSourceKinds: ["dom", "computed-style", "user-correction"],
    allowScreenshotEstimates: false,
    requiredArtifacts: ["output/design-spec.md", "output/rebuild-prompt.md", "analysis/component-inventory.json"],
    notes: "Blocks when the reference system is too incomplete to determine how a new page would belong to it."
  },

  /* ------------------------------------------------------------ IMPROVE */
  improve: {
    label: "Improve",
    intent: "Identify UX weaknesses and propose an improved version retaining the design language.",
    required: [
      regionReached("blocking"),
      primaryContainer("blocking"),
      {
        id: "accessibility-evidence",
        label: "Accessibility evidence",
        resolver: RESOLVER.A11Y,
        severity: "blocking",
        remedy: REMEDY.RECAPTURE,
        description: "Contrast findings, without which a UX critique has nothing measurable to stand on."
      },
      {
        id: "observed-component",
        label: "At least one observed component",
        resolver: RESOLVER.COMPONENT,
        minAnatomy: 1,
        minConfidence: 0.3,
        severity: "blocking",
        remedy: REMEDY.RECAPTURE,
        description: "Something concrete to critique."
      },
      colorRoles(2, "warning"),
      typographyBody("warning"),
      typographyScale("warning"),
      spacingRhythm("warning")
    ],
    optional: [],
    thresholds: {
      minConfidence: 0.4,
      minContentReached: 0.5,
      minCoverageFactor: 0.45,
      minComponentConfidence: 0.3
    },
    acceptableSourceKinds: ["dom", "computed-style", "screenshot", "visual-model", "user-correction"],
    allowScreenshotEstimates: true,
    requiredArtifacts: ["output/design-spec.md", "output/improvement-prompt.md"],
    plannedArtifacts: [],
    notes:
      "Tolerates incomplete tokens. Must keep observed behaviour, inferred intent, detected weakness and proposed improvement separable — a proposal must never read as something the reference already does."
  }
});

export const DEFAULT_REQUEST = Object.freeze({
  mode: MODES.ANALYZE,
  viewports: [1440],
  includeMotion: false,
  includeStates: false
});

export function requirementsFor(mode) {
  return modeRequirements[mode] ?? null;
}

export function isKnownMode(mode) {
  return Object.hasOwn(modeRequirements, mode);
}

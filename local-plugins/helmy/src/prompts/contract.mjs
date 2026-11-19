/**
 * The prompt contract — what a generated prompt must contain to be usable.
 *
 * A prompt is the one artifact that leaves this system and becomes somebody
 * else's instructions. Every other output is read by a person who can go back
 * and check; a prompt is handed to an agent that will act on it literally.
 *
 * That asymmetry is why quality here is *structural* rather than editorial. A
 * style guide saying "avoid vague adjectives" is advice nobody can enforce and
 * everybody drifts from. A contract naming sixteen required sections, and a
 * linter that fails a prompt missing one, is enforceable — and what it enforces
 * is that the caveats travel with the instructions instead of being left in the
 * report nobody opened.
 *
 * Three things are declared here and nowhere else:
 *
 *   1. **Sections.** Which ones, in which order, and which may not be empty.
 *   2. **The header facts.** What every prompt states about its own evidence
 *      before it starts instructing.
 *   3. **The prohibitions.** What must never appear, each with the reason.
 *
 * The linter reads this. The projections read this. The generated documentation
 * reads this. Restating any of it in a fourth place is how they drift apart.
 */

import { HEADER_FIELDS } from "../project/header.mjs";

/** How a section's content is classified, for the separation rules. */
export const SECTION_KIND = Object.freeze({
  /** What was measured on someone else's page. */
  REFERENCE: "reference-evidence",
  /** What the target brief asks for. Never a measurement. */
  TARGET: "target-brief",
  /** Derived from reference evidence by a stated rule. */
  DERIVED: "derived",
  /** A suggestion. Never a description of the reference. */
  PROPOSAL: "proposal",
  /** A standing rule that is not derived from this analysis at all. */
  FIXED: "fixed"
});

/**
 * Every fact a prompt states about itself before it instructs.
 *
 * The first eight are the standard artifact header, shared with every other
 * human-readable artifact. The last four are prompt-specific: a reader deciding
 * whether to act on instructions needs to know what stack they assume, what
 * they need supplied, what constrains them, and what they are NOT allowed to
 * assume.
 */
export const PROMPT_HEADER_FIELDS = Object.freeze([
  ...HEADER_FIELDS,
  "Target stack",
  "Required inputs",
  "Implementation constraints",
  "Unsupported assumptions"
]);

/**
 * Language that describes without measuring.
 *
 * Not banned outright. An adjective carrying visual intent is genuinely useful
 * — "low visual density" tells a builder something a padding value does not.
 * What is banned is an adjective standing ALONE, because then it is the only
 * instruction and every reader resolves it differently.
 *
 * The rule: keep the adjective, pair it with the measurement.
 */
export const VAGUE_TERMS = Object.freeze([
  "modern", "clean", "generous", "subtle", "soft", "sleek", "elegant",
  "minimal", "spacious", "rounded", "smooth", "polished", "premium",
  "crisp", "airy", "refined", "beautiful", "professional", "sophisticated",
  "tasteful", "balanced", "harmonious", "striking", "bold", "large"
]);

/** Multi-word phrases the brief calls out by name. */
export const VAGUE_PHRASES = Object.freeze([
  "generous whitespace", "subtle shadow", "rounded cards", "large typography",
  "clean design", "modern look", "modern feel", "plenty of space",
  "nice spacing", "good contrast", "appropriate sizing"
]);

/**
 * What a prompt may never contain, whatever its type.
 *
 * Each entry is a lint rule's justification, kept beside the rule rather than
 * in a comment somewhere, so a reader asking "why is this forbidden" gets an
 * answer from the same table the check runs from.
 */
export const UNIVERSAL_PROHIBITIONS = Object.freeze([
  {
    id: "vague-unsupported",
    what: "A vague adjective with no measurement, evidence reference or labelled interpretation beside it.",
    why: "It is then the only instruction, and every reader resolves it differently. The build that comes back is not wrong so much as unrelated."
  },
  {
    id: "contested-as-exact",
    what: "A contested critical value rendered as one exact number.",
    why: "Two sources disagreed and the prompt picked one silently. Nothing downstream says a decision was made, so nobody can revisit it."
  },
  {
    id: "estimate-as-measurement",
    what: "A screenshot estimate rendered the way a measured value is.",
    why: "It will be built to the tolerance of a measurement, which the evidence never supported."
  },
  {
    id: "generated-selector",
    what: "A build-generated selector offered as an implementation hook.",
    why: "It is valid until the reference's next deploy. A build wired to one breaks silently, and the breakage looks like a bug in the new code."
  },
  {
    id: "component-correction",
    what: "An instruction to correct components automatically.",
    why: "Component matching across two builds is an open permanent limitation (def_0030). An automatic correction would act on a match nothing verified."
  },
  {
    id: "brand-asset",
    what: "A logo, brand name, proprietary copy, distinctive illustration or photograph copied from the reference.",
    why: "The reference is an analysis target, not a source of assets. Copying its identity is the one failure mode with a legal shape as well as a technical one."
  },
  {
    id: "invented-requirement",
    what: "A product requirement that came from neither the evidence nor a target brief.",
    why: "It reads identically to a measured one, and there is no way for the builder to tell which parts of the prompt somebody actually decided."
  },
  {
    id: "unknown-as-default",
    what: "An unknown value silently replaced by a plausible default.",
    why: "A gap that announces itself gets a decision. A gap filled with 16px gets built."
  }
]);

/* ---------------------------------------------------------- the contracts */

const REFERENCE_SECTIONS = (ids) => ids.map((id) => ({ ...id, kind: id.kind ?? SECTION_KIND.DERIVED }));

/**
 * One contract per prompt type.
 *
 * `sections` is ordered, and the order is checked: a prompt that states its
 * acceptance criteria before its evidence limitations is not merely untidy, it
 * front-loads what to do and buries what not to trust.
 */
export const PROMPT_CONTRACTS = Object.freeze({
  "rebuild-prompt": {
    artifactKind: "rebuild-prompt",
    filename: "output/rebuild-prompt.md",
    modes: ["recreate", "extend"],
    describe: "Instructions to rebuild the measured system.",
    forbiddenSourceKinds: ["screenshots"],
    requiresTargetBrief: false,
    sections: REFERENCE_SECTIONS([
      { id: "objective", title: "Objective", required: true },
      { id: "reference-evidence", title: "Reference evidence", required: true, kind: SECTION_KIND.REFERENCE },
      { id: "page-structure", title: "Page structure", required: true, kind: SECTION_KIND.REFERENCE },
      { id: "design-tokens", title: "Design tokens", required: true, kind: SECTION_KIND.REFERENCE },
      { id: "typography", title: "Typography", required: true, kind: SECTION_KIND.REFERENCE },
      { id: "layout-grid", title: "Layout and grid", required: true, kind: SECTION_KIND.REFERENCE },
      { id: "components", title: "Components", required: true, kind: SECTION_KIND.REFERENCE },
      { id: "component-states", title: "Component states", required: true, kind: SECTION_KIND.REFERENCE },
      { id: "responsive", title: "Responsive behavior", required: true },
      { id: "motion", title: "Motion", required: true, kind: SECTION_KIND.REFERENCE },
      { id: "accessibility", title: "Accessibility", required: true },
      { id: "assets-brand", title: "Assets and brand boundaries", required: true, kind: SECTION_KIND.FIXED },
      { id: "technical", title: "Technical implementation", required: true },
      { id: "acceptance", title: "Acceptance criteria", required: true },
      { id: "evidence-limitations", title: "Evidence limitations", required: true, kind: SECTION_KIND.REFERENCE },
      { id: "forbidden-assumptions", title: "Forbidden assumptions", required: true, kind: SECTION_KIND.FIXED }
    ]),
    prohibitions: UNIVERSAL_PROHIBITIONS.map((p) => p.id)
  },

  "adaptation-prompt": {
    artifactKind: "adaptation-prompt",
    filename: "output/adaptation-prompt.md",
    modes: ["adapt"],
    describe: "Instructions to apply the measured system to a different product.",
    forbiddenSourceKinds: ["screenshots"],
    requiresTargetBrief: true,
    /* The triad is what makes this prompt safe: every mapping states what was
     * measured, what the brief asks for, and the operation between them. A
     * mapping missing a leg is a claim with no stated origin. */
    requiresTriad: true,
    triad: Object.freeze([
      { leg: "reference-evidence", label: "Reference evidence", kind: SECTION_KIND.REFERENCE, why: "What was measured on the reference." },
      { leg: "target-requirement", label: "Target requirement", kind: SECTION_KIND.TARGET, why: "What the brief asks for, or that it says nothing." },
      { leg: "adaptation-instruction", label: "Adaptation instruction", kind: SECTION_KIND.DERIVED, why: "The operation between them, stated rather than implied." }
    ]),
    sections: REFERENCE_SECTIONS([
      { id: "objective", title: "Objective", required: true },
      { id: "reference-design-system", title: "Reference design system", required: true, kind: SECTION_KIND.REFERENCE },
      { id: "target-brief", title: "Target product brief", required: true, kind: SECTION_KIND.TARGET },
      { id: "target-ia", title: "Target information architecture", required: true, kind: SECTION_KIND.TARGET },
      { id: "preserved-principles", title: "Preserved design principles", required: true },
      { id: "changed-anatomy", title: "Changed content anatomy", required: true },
      { id: "brand-replacement", title: "Brand and asset replacement", required: true, kind: SECTION_KIND.FIXED },
      { id: "implementation", title: "Implementation requirements", required: true },
      { id: "responsive", title: "Responsive behavior", required: true },
      { id: "accessibility", title: "Accessibility", required: true },
      { id: "acceptance", title: "Acceptance criteria", required: true },
      { id: "limitations", title: "Limitations", required: true, kind: SECTION_KIND.REFERENCE }
    ]),
    prohibitions: [...UNIVERSAL_PROHIBITIONS.map((p) => p.id), "brief-as-evidence"]
  },

  "improvement-prompt": {
    artifactKind: "improvement-prompt",
    filename: "output/improvement-prompt.md",
    modes: ["improve"],
    describe: "What is there, what is weak about it, what could be done, and what nobody knows.",
    forbiddenSourceKinds: [],
    requiresTargetBrief: false,
    /* Every proposal is marked, and the marking is checked. An unmarked
     * proposal in a document that also describes the reference reads as a
     * description of the reference. */
    requiresProposalMarking: true,
    proposalMarker: "**Proposed:**",
    /* The four kinds of statement that must not blend, named exactly as their
     * headings appear. A shorthand list here and fuller titles in `sections`
     * would be two names for one thing, and the registry and the validator
     * would each pick a different one. */
    separatedSections: ["Observed reference behavior", "UX critique", "Proposed improvements", "Unknowns"],
    sections: REFERENCE_SECTIONS([
      { id: "observed-behavior", title: "Observed reference behavior", required: true, kind: SECTION_KIND.REFERENCE },
      { id: "observation-evidence", title: "Evidence supporting the observation", required: true, kind: SECTION_KIND.REFERENCE },
      { id: "strengths", title: "UX strengths", required: true, kind: SECTION_KIND.DERIVED },
      { id: "critique", title: "UX critique", required: true, kind: SECTION_KIND.DERIVED },
      { id: "proposals", title: "Proposed improvements", required: true, kind: SECTION_KIND.PROPOSAL },
      { id: "reasoning", title: "Reasoning for proposals", required: true, kind: SECTION_KIND.PROPOSAL },
      { id: "unchanged", title: "What must remain unchanged", required: true, kind: SECTION_KIND.REFERENCE },
      { id: "implementation", title: "Implementation requirements", required: true },
      { id: "accessibility", title: "Accessibility", required: true },
      { id: "acceptance", title: "Acceptance criteria", required: true },
      { id: "unknowns", title: "Unknowns", required: true, kind: SECTION_KIND.REFERENCE }
    ]),
    prohibitions: [...UNIVERSAL_PROHIBITIONS.map((p) => p.id), "proposal-as-observation"]
  },

  "implementation-notes": {
    artifactKind: "implementation-notes",
    filename: "output/implementation-notes.md",
    modes: ["recreate", "adapt", "extend"],
    describe: "How the chosen stack expresses values measured elsewhere. Contains no findings.",
    forbiddenSourceKinds: [],
    requiresTargetBrief: false,
    /* The one prompt-adjacent artifact that must make NO claims about the
     * reference. Everything measured lives in the prompt it accompanies. */
    forbidsReferenceClaims: true,
    sections: REFERENCE_SECTIONS([
      { id: "stack", title: "Stack", required: true, kind: SECTION_KIND.FIXED },
      { id: "token-mapping", title: "Token mapping", required: true, kind: SECTION_KIND.FIXED },
      { id: "cannot-express", title: "What this stack cannot express exactly", required: true, kind: SECTION_KIND.FIXED },
      { id: "not-decided", title: "What this does not decide", required: true, kind: SECTION_KIND.FIXED }
    ]),
    prohibitions: ["vague-unsupported", "unsupported-stack-syntax", "reference-claim-in-notes"]
  }
});

export const PROMPT_KINDS = Object.freeze(Object.keys(PROMPT_CONTRACTS));

export const contractFor = (kindOrFilename) =>
  PROMPT_CONTRACTS[kindOrFilename] ??
  Object.values(PROMPT_CONTRACTS).find((c) => c.filename === kindOrFilename) ??
  null;

/** Whether an artifact is governed by a prompt contract at all. */
export const isPrompt = (kindOrFilename) => contractFor(kindOrFilename) !== null;

/** The section titles a contract requires, in order. */
export const requiredSectionTitles = (contract) =>
  contract.sections.filter((s) => s.required).map((s) => s.title);

/** Looks up a prohibition's stated reason. */
export const prohibitionReason = (id) =>
  UNIVERSAL_PROHIBITIONS.find((p) => p.id === id)?.why ?? null;

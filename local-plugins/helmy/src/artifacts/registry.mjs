/**
 * The artifact registry — one definition per generated file.
 *
 * Everything the pipeline writes is a projection of an IR. Until now the rules
 * governing those projections were spread across `src/project/index.mjs`, the
 * mode requirements table, the validation gates and the workspace writer, which
 * meant a question like "may `analyze` emit a rebuild prompt?" had four places
 * to look and no single answer.
 *
 * This is that answer. Each definition states what an artifact is, what has to
 * be true for it to exist, what happens to it when the run is blocked or its
 * source moves underneath it, and which projection owns it. The mode matrix,
 * the validator, the freshness checker, the exporter and the generated
 * documentation all read from here, so a rule stated once is enforced
 * everywhere.
 *
 * The registry is also deliberately honest about what does NOT exist yet.
 * Several artifacts named in the Phase 5.4 brief have no producer — they belong
 * to the correction workflow, which is Phase 5.7 work. They are registered with
 * `producer: null` and `status: DECLARED`, so that asking the registry for them
 * returns "declared, not produced" rather than nothing at all. A gap that
 * reports itself is very different from one you discover by finding an empty
 * directory.
 */

/* ------------------------------------------------------------ vocabularies */

/** What an artifact carries about its own completeness. */
export const ARTIFACT_STATUS = Object.freeze({
  /** Generated from evidence that met the mode's requirements. */
  COMPLETE: "complete",
  /** Generated, but the evidence did not cover everything it describes. */
  PARTIAL: "partial",
  /** The safety gate refused the full artifact; this is the explanation. */
  BLOCKED: "blocked",
  /** Its source moved after it was written. Preserved, not trusted. */
  STALE: "stale",
  /** A newer iteration replaced it. Kept for history. */
  SUPERSEDED: "superseded"
});

export const ALL_ARTIFACT_STATUSES = Object.freeze(Object.values(ARTIFACT_STATUS));

/**
 * What happens to an artifact when its source IR, evidence or configuration
 * has changed since it was written.
 *
 * Nothing here regenerates silently. The difference between these values is
 * whether regeneration is SAFE to offer, not whether it happens on its own.
 */
export const STALE_BEHAVIOR = Object.freeze({
  /** Re-deriving from the current IR reproduces it. Offer regeneration. */
  REGENERATE_SAFE: "regenerate-safe",
  /**
   * Re-deriving would change what the artifact instructs someone to build.
   * Report it and let a person decide; do not offer a one-click regenerate.
   */
  REGENERATE_NEEDS_REVIEW: "regenerate-needs-review",
  /** Historical by nature. Never regenerated, never overwritten. */
  PRESERVE_ONLY: "preserve-only"
});

/** What happens to an artifact when the safety gate blocks the run. */
export const BLOCKED_BEHAVIOR = Object.freeze({
  /** Still written: a blocked run must account for itself. */
  EMIT: "emit",
  /** Written under a name that cannot be mistaken for a complete one. */
  EMIT_AS_PARTIAL: "emit-as-partial",
  /** Only written when the run IS blocked. */
  EMIT_ONLY_WHEN_BLOCKED: "emit-only-when-blocked",
  /**
   * Removed from the current output, and its removal recorded in history.
   * This is for implementation instructions: a stale build prompt sitting in a
   * directory next to a report explaining why the run was refused is the single
   * most dangerous artifact this system can leave behind.
   */
  PRUNE: "prune"
});

/** Which hashes an artifact must carry for its freshness to be checkable. */
export const HASH_REQUIREMENT = Object.freeze({
  IR: "ir",
  EVIDENCE: "evidence",
  CONFIGURATION: "configuration"
});

/** Whether a definition has a producer today. */
export const DEFINITION_STATUS = Object.freeze({
  /** Produced by a projection that exists. */
  IMPLEMENTED: "implemented",
  /** Registered so it is named and governed, but nothing writes it yet. */
  DECLARED: "declared"
});

/**
 * The eight facts every human-readable artifact opens with. Imported rather
 * than restated so the renderer and the validator cannot disagree about what a
 * complete header is.
 */
import { HEADER_FIELDS } from "../project/header.mjs";
import { contractFor, requiredSectionTitles } from "../prompts/contract.mjs";

/**
 * A prompt's required sections come from its prompt contract, not from a second
 * list kept here.
 *
 * This pair had already drifted once: the registry demanded "Non-goals" after
 * the contract had split that section into "Assets and brand boundaries" and
 * "Forbidden assumptions", so a correctly-generated prompt failed validation
 * against a section nothing produced any more.
 */
const promptSections = (kind) => [...HEADER_FIELDS, ...requiredSectionTitles(contractFor(kind))];

export const MODES = Object.freeze(["analyze", "recreate", "adapt", "extend", "improve"]);
export const SOURCE_KINDS = Object.freeze(["url", "screenshots"]);

/* ------------------------------------------------------------ definitions */

/**
 * One entry per artifact.
 *
 * `producingModes` is the mode matrix. An artifact absent from a mode's list is
 * not merely unusual for that mode — it is refused, and the validator reports
 * it as a wrong-mode artifact.
 */
export const ARTIFACTS = Object.freeze([
  {
    kind: "design-spec",
    filename: "output/design-spec.md",
    producingModes: ["analyze", "recreate", "adapt", "extend", "improve"],
    requiredInputs: ["ir", "evidence"],
    sourceIR: "ir.json",
    sourceEvidence: "evidence-map.json",
    hashRequirements: [HASH_REQUIREMENT.IR, HASH_REQUIREMENT.EVIDENCE],
    humanReadable: true,
    machineReadable: false,
    requiredForModes: ["analyze", "recreate", "adapt", "extend", "improve"],
    staleBehavior: STALE_BEHAVIOR.REGENERATE_SAFE,
    blockedBehavior: BLOCKED_BEHAVIOR.EMIT_AS_PARTIAL,
    blockedFilename: "output/partial-design-spec.md",
    owningProjection: "src/project/design-spec.mjs#projectDesignSpec",
    validationSchema: null,
    requiredSections: [...HEADER_FIELDS],
    supportedStatuses: [ARTIFACT_STATUS.COMPLETE, ARTIFACT_STATUS.PARTIAL, ARTIFACT_STATUS.STALE, ARTIFACT_STATUS.SUPERSEDED],
    definitionStatus: DEFINITION_STATUS.IMPLEMENTED,
    describe: "What the reference is, claim by claim, with every value carrying its status and evidence."
  },
  {
    kind: "rebuild-prompt",
    filename: "output/rebuild-prompt.md",
    /* `extend` shares it. Both produce build instructions grounded in the
     * measured system; extend scopes them to a new page rather than the
     * captured one. Giving extend a near-identical prompt under a second name
     * would duplicate the projection to express nothing. */
    producingModes: ["recreate", "extend"],
    requiredInputs: ["ir", "evidence", "stack"],
    sourceIR: "ir.json",
    sourceEvidence: "evidence-map.json",
    hashRequirements: [HASH_REQUIREMENT.IR, HASH_REQUIREMENT.EVIDENCE, HASH_REQUIREMENT.CONFIGURATION],
    humanReadable: true,
    machineReadable: false,
    requiredForModes: ["recreate", "extend"],
    isImplementationPrompt: true,
    forbiddenSourceKinds: ["screenshots"],
    staleBehavior: STALE_BEHAVIOR.REGENERATE_NEEDS_REVIEW,
    blockedBehavior: BLOCKED_BEHAVIOR.PRUNE,
    owningProjection: "src/project/rebuild-prompt.mjs#projectRebuildPrompt",
    validationSchema: null,
    requiredSections: promptSections("rebuild-prompt"),
    supportedStatuses: [ARTIFACT_STATUS.COMPLETE, ARTIFACT_STATUS.STALE, ARTIFACT_STATUS.SUPERSEDED],
    definitionStatus: DEFINITION_STATUS.IMPLEMENTED,
    describe: "Instructions to rebuild the measured system, with literal values and acceptance criteria."
  },
  {
    kind: "adaptation-prompt",
    filename: "output/adaptation-prompt.md",
    producingModes: ["adapt"],
    requiredInputs: ["ir", "evidence", "target-brief", "stack"],
    sourceIR: "ir.json",
    sourceEvidence: "evidence-map.json",
    hashRequirements: [HASH_REQUIREMENT.IR, HASH_REQUIREMENT.EVIDENCE, HASH_REQUIREMENT.CONFIGURATION],
    humanReadable: true,
    machineReadable: false,
    requiredForModes: ["adapt"],
    isImplementationPrompt: true,
    forbiddenSourceKinds: ["screenshots"],
    staleBehavior: STALE_BEHAVIOR.REGENERATE_NEEDS_REVIEW,
    blockedBehavior: BLOCKED_BEHAVIOR.PRUNE,
    owningProjection: "src/project/adaptation-prompt.mjs#projectAdaptationPrompt",
    validationSchema: null,
    requiredSections: promptSections("adaptation-prompt"),
    supportedStatuses: [ARTIFACT_STATUS.COMPLETE, ARTIFACT_STATUS.STALE, ARTIFACT_STATUS.SUPERSEDED],
    definitionStatus: DEFINITION_STATUS.IMPLEMENTED,
    describe: "Instructions to apply the measured system to a different product, described by a target brief."
  },
  {
    kind: "improvement-prompt",
    filename: "output/improvement-prompt.md",
    producingModes: ["improve"],
    requiredInputs: ["ir", "evidence", "accessibility-policy"],
    sourceIR: "ir.json",
    sourceEvidence: "evidence-map.json",
    hashRequirements: [HASH_REQUIREMENT.IR, HASH_REQUIREMENT.EVIDENCE, HASH_REQUIREMENT.CONFIGURATION],
    humanReadable: true,
    machineReadable: false,
    requiredForModes: ["improve"],
    isImplementationPrompt: true,
    staleBehavior: STALE_BEHAVIOR.REGENERATE_NEEDS_REVIEW,
    blockedBehavior: BLOCKED_BEHAVIOR.PRUNE,
    owningProjection: "src/project/improvement-prompt.mjs#projectImprovementPrompt",
    validationSchema: null,
    /* The four-way split is the whole point of the artifact. A proposal that
     * reads like an observation is a claim about the reference that nobody
     * measured. */
    requiredSections: promptSections("improvement-prompt"),
    separatedSections: contractFor("improvement-prompt").separatedSections,
    supportedStatuses: [ARTIFACT_STATUS.COMPLETE, ARTIFACT_STATUS.PARTIAL, ARTIFACT_STATUS.STALE, ARTIFACT_STATUS.SUPERSEDED],
    definitionStatus: DEFINITION_STATUS.IMPLEMENTED,
    describe: "What is there, what is weak about it, what could be done, and what nobody knows — kept apart."
  },
  {
    kind: "implementation-notes",
    filename: "output/implementation-notes.md",
    producingModes: ["recreate", "adapt", "extend"],
    requiredInputs: ["ir", "stack"],
    sourceIR: "ir.json",
    sourceEvidence: "evidence-map.json",
    hashRequirements: [HASH_REQUIREMENT.IR, HASH_REQUIREMENT.CONFIGURATION],
    humanReadable: true,
    machineReadable: false,
    requiredForModes: [],
    staleBehavior: STALE_BEHAVIOR.REGENERATE_NEEDS_REVIEW,
    blockedBehavior: BLOCKED_BEHAVIOR.PRUNE,
    owningProjection: "src/project/implementation-notes.mjs#projectImplementationNotes",
    validationSchema: null,
    requiredSections: promptSections("implementation-notes"),
    supportedStatuses: [ARTIFACT_STATUS.COMPLETE, ARTIFACT_STATUS.PARTIAL, ARTIFACT_STATUS.STALE, ARTIFACT_STATUS.SUPERSEDED],
    definitionStatus: DEFINITION_STATUS.IMPLEMENTED,
    describe: "Stack-specific guidance that accompanies an implementation prompt without adding claims to it."
  },
  {
    kind: "coverage-report",
    filename: "output/coverage-report.md",
    producingModes: ["analyze", "recreate", "adapt", "extend", "improve"],
    requiredInputs: ["ir"],
    sourceIR: "ir.json",
    sourceEvidence: "evidence-map.json",
    hashRequirements: [HASH_REQUIREMENT.IR],
    humanReadable: true,
    machineReadable: false,
    requiredForModes: ["analyze", "recreate", "adapt", "extend", "improve"],
    staleBehavior: STALE_BEHAVIOR.REGENERATE_SAFE,
    blockedBehavior: BLOCKED_BEHAVIOR.EMIT,
    owningProjection: "src/project/coverage-report.mjs#projectCoverageReport",
    validationSchema: null,
    requiredSections: [...HEADER_FIELDS],
    supportedStatuses: [ARTIFACT_STATUS.COMPLETE, ARTIFACT_STATUS.PARTIAL, ARTIFACT_STATUS.BLOCKED, ARTIFACT_STATUS.STALE, ARTIFACT_STATUS.SUPERSEDED],
    definitionStatus: DEFINITION_STATUS.IMPLEMENTED,
    describe: "What the capture reached and what it did not. Always written, including on a blocked run."
  },
  {
    kind: "evidence-report",
    filename: "output/evidence-report.md",
    producingModes: ["analyze", "recreate", "adapt", "extend", "improve"],
    requiredInputs: ["ir", "evidence"],
    sourceIR: "ir.json",
    sourceEvidence: "evidence-map.json",
    hashRequirements: [HASH_REQUIREMENT.IR, HASH_REQUIREMENT.EVIDENCE],
    humanReadable: true,
    machineReadable: false,
    requiredForModes: [],
    staleBehavior: STALE_BEHAVIOR.REGENERATE_SAFE,
    blockedBehavior: BLOCKED_BEHAVIOR.EMIT,
    owningProjection: "src/project/evidence-report.mjs#projectEvidenceReport",
    validationSchema: null,
    requiredSections: [...HEADER_FIELDS, "Measured", "Observed", "Inferred", "Estimated", "Unknown"],
    supportedStatuses: [ARTIFACT_STATUS.COMPLETE, ARTIFACT_STATUS.PARTIAL, ARTIFACT_STATUS.BLOCKED, ARTIFACT_STATUS.STALE, ARTIFACT_STATUS.SUPERSEDED],
    definitionStatus: DEFINITION_STATUS.IMPLEMENTED,
    describe: "Every claim grouped by how it came to be known, so provenance is readable without the IR."
  },
  {
    kind: "blocked-prompt",
    filename: "output/blocked-prompt.md",
    producingModes: ["analyze", "recreate", "adapt", "extend", "improve"],
    requiredInputs: ["ir"],
    sourceIR: "ir.json",
    sourceEvidence: "evidence-map.json",
    hashRequirements: [HASH_REQUIREMENT.IR],
    humanReadable: true,
    machineReadable: false,
    requiredForModes: [],
    staleBehavior: STALE_BEHAVIOR.REGENERATE_SAFE,
    blockedBehavior: BLOCKED_BEHAVIOR.EMIT_ONLY_WHEN_BLOCKED,
    owningProjection: "src/project/blocked-prompt.mjs#projectBlockedPrompt",
    validationSchema: null,
    requiredSections: [...HEADER_FIELDS],
    supportedStatuses: [ARTIFACT_STATUS.BLOCKED, ARTIFACT_STATUS.STALE, ARTIFACT_STATUS.SUPERSEDED],
    definitionStatus: DEFINITION_STATUS.IMPLEMENTED,
    describe: "Written in place of an implementation prompt: why it was refused, and what would change that."
  },
  {
    kind: "fidelity-report",
    filename: "output/fidelity-report.md",
    producingModes: ["recreate", "adapt", "extend", "improve"],
    requiredInputs: ["reference-ir", "target-ir", "tolerance-policy"],
    sourceIR: "ir.json",
    sourceEvidence: "fidelity-comparison.json",
    hashRequirements: [HASH_REQUIREMENT.IR, HASH_REQUIREMENT.CONFIGURATION],
    humanReadable: true,
    machineReadable: false,
    requiredForModes: [],
    staleBehavior: STALE_BEHAVIOR.REGENERATE_NEEDS_REVIEW,
    blockedBehavior: BLOCKED_BEHAVIOR.EMIT,
    owningProjection: "src/project/fidelity-report.mjs#projectFidelityReport",
    validationSchema: null,
    requiredSections: ["What was compared", "Per category", "What is not validated"],
    supportedStatuses: [ARTIFACT_STATUS.COMPLETE, ARTIFACT_STATUS.PARTIAL, ARTIFACT_STATUS.BLOCKED, ARTIFACT_STATUS.STALE, ARTIFACT_STATUS.SUPERSEDED],
    definitionStatus: DEFINITION_STATUS.IMPLEMENTED,
    describe: "Category-by-category comparison of a build against its reference. Never a single number."
  },
  {
    kind: "readiness-report",
    filename: "output/readiness-report.md",
    producingModes: ["analyze", "recreate", "adapt", "extend", "improve"],
    requiredInputs: ["defect-store"],
    sourceIR: null,
    sourceEvidence: "defects/",
    hashRequirements: [],
    humanReadable: true,
    machineReadable: false,
    requiredForModes: [],
    staleBehavior: STALE_BEHAVIOR.REGENERATE_SAFE,
    blockedBehavior: BLOCKED_BEHAVIOR.EMIT,
    owningProjection: "src/project/readiness-report.mjs#projectReadinessReport",
    validationSchema: null,
    requiredSections: ["Decisions"],
    supportedStatuses: [ARTIFACT_STATUS.COMPLETE, ARTIFACT_STATUS.STALE, ARTIFACT_STATUS.SUPERSEDED],
    definitionStatus: DEFINITION_STATUS.IMPLEMENTED,
    describe: "Fifteen separate readiness decisions. There is no overall verdict, by construction."
  },
  {
    kind: "extracted-tokens",
    filename: "analysis/extracted-tokens.json",
    producingModes: ["analyze", "recreate", "adapt", "extend", "improve"],
    requiredInputs: ["ir", "evidence"],
    sourceIR: "ir.json",
    sourceEvidence: "evidence-map.json",
    hashRequirements: [HASH_REQUIREMENT.IR, HASH_REQUIREMENT.EVIDENCE],
    humanReadable: false,
    machineReadable: true,
    requiredForModes: ["recreate", "adapt"],
    /* The load-bearing field on this entry. A token file is a set of
     * commitments; screenshot evidence cannot support one, and a file under
     * this name would be read as exact by anything that does not check
     * provenance for itself. */
    forbiddenSourceKinds: ["screenshots"],
    staleBehavior: STALE_BEHAVIOR.REGENERATE_SAFE,
    blockedBehavior: BLOCKED_BEHAVIOR.EMIT,
    owningProjection: "src/project/tokens.mjs#projectTokens",
    validationSchema: null,
    supportedStatuses: [ARTIFACT_STATUS.COMPLETE, ARTIFACT_STATUS.PARTIAL, ARTIFACT_STATUS.STALE, ARTIFACT_STATUS.SUPERSEDED],
    definitionStatus: DEFINITION_STATUS.IMPLEMENTED,
    describe: "Design tokens measured from the DOM and computed styles. Exact values only."
  },
  {
    kind: "estimated-tokens",
    filename: "analysis/estimated-tokens.json",
    producingModes: ["analyze", "improve"],
    requiredInputs: ["ir", "evidence"],
    sourceIR: "ir.json",
    sourceEvidence: "evidence-map.json",
    hashRequirements: [HASH_REQUIREMENT.IR, HASH_REQUIREMENT.EVIDENCE],
    humanReadable: false,
    machineReadable: true,
    requiredForModes: [],
    requiredSourceKinds: ["screenshots"],
    staleBehavior: STALE_BEHAVIOR.REGENERATE_SAFE,
    blockedBehavior: BLOCKED_BEHAVIOR.EMIT,
    owningProjection: "src/project/screenshot-report.mjs#projectEstimatedTokens",
    validationSchema: null,
    supportedStatuses: [ARTIFACT_STATUS.PARTIAL, ARTIFACT_STATUS.STALE, ARTIFACT_STATUS.SUPERSEDED],
    definitionStatus: DEFINITION_STATUS.IMPLEMENTED,
    describe: "Token values read from screenshots. A different file from extracted tokens, on purpose."
  },
  {
    kind: "component-inventory",
    filename: "analysis/component-inventory.json",
    producingModes: ["analyze", "recreate", "adapt", "extend", "improve"],
    requiredInputs: ["ir"],
    sourceIR: "ir.json",
    sourceEvidence: "evidence-map.json",
    hashRequirements: [HASH_REQUIREMENT.IR],
    humanReadable: false,
    machineReadable: true,
    requiredForModes: ["analyze", "recreate", "adapt", "extend", "improve"],
    staleBehavior: STALE_BEHAVIOR.REGENERATE_SAFE,
    blockedBehavior: BLOCKED_BEHAVIOR.EMIT,
    owningProjection: "src/project/components.mjs#projectComponents",
    validationSchema: null,
    supportedStatuses: [ARTIFACT_STATUS.COMPLETE, ARTIFACT_STATUS.PARTIAL, ARTIFACT_STATUS.BLOCKED, ARTIFACT_STATUS.STALE, ARTIFACT_STATUS.SUPERSEDED],
    definitionStatus: DEFINITION_STATUS.IMPLEMENTED,
    describe: "Every component found, with its anatomy, confidence and the evidence behind each part."
  },
  {
    kind: "evidence-map",
    filename: "analysis/evidence-map.json",
    producingModes: ["analyze", "recreate", "adapt", "extend", "improve"],
    requiredInputs: ["evidence"],
    sourceIR: null,
    sourceEvidence: "evidence records",
    hashRequirements: [HASH_REQUIREMENT.EVIDENCE],
    humanReadable: false,
    machineReadable: true,
    requiredForModes: ["analyze", "recreate", "adapt", "extend", "improve"],
    staleBehavior: STALE_BEHAVIOR.REGENERATE_SAFE,
    blockedBehavior: BLOCKED_BEHAVIOR.EMIT,
    owningProjection: "src/pipeline.mjs#runPipeline",
    validationSchema: "schemas/evidence.schema.json",
    supportedStatuses: [ARTIFACT_STATUS.COMPLETE, ARTIFACT_STATUS.PARTIAL, ARTIFACT_STATUS.BLOCKED, ARTIFACT_STATUS.STALE, ARTIFACT_STATUS.SUPERSEDED],
    definitionStatus: DEFINITION_STATUS.IMPLEMENTED,
    describe: "The evidence records every claim points at. Nothing may cite an id that is not in here."
  },
  {
    kind: "history-record",
    filename: "history/<iteration>/run.json",
    producingModes: ["analyze", "recreate", "adapt", "extend", "improve"],
    requiredInputs: [],
    sourceIR: null,
    sourceEvidence: null,
    hashRequirements: [],
    humanReadable: false,
    machineReadable: true,
    requiredForModes: [],
    /* Historical by nature. A history record that could be regenerated would
     * not be a history. */
    staleBehavior: STALE_BEHAVIOR.PRESERVE_ONLY,
    blockedBehavior: BLOCKED_BEHAVIOR.EMIT,
    owningProjection: "src/fidelity/history.mjs#FidelityHistory",
    validationSchema: "schemas/fidelity-run.schema.json",
    supportedStatuses: [ARTIFACT_STATUS.COMPLETE, ARTIFACT_STATUS.PARTIAL, ARTIFACT_STATUS.BLOCKED],
    definitionStatus: DEFINITION_STATUS.IMPLEMENTED,
    describe: "What one iteration did, with its hashes. Appended, never rewritten."
  },
  {
    kind: "recovery-record",
    filename: "history/<iteration>/recovery.json",
    producingModes: ["analyze", "recreate", "adapt", "extend", "improve"],
    requiredInputs: [],
    sourceIR: null,
    sourceEvidence: null,
    hashRequirements: [],
    humanReadable: false,
    machineReadable: true,
    requiredForModes: [],
    staleBehavior: STALE_BEHAVIOR.PRESERVE_ONLY,
    blockedBehavior: BLOCKED_BEHAVIOR.EMIT,
    owningProjection: "src/driver/interface.mjs#runOperation",
    validationSchema: "schemas/recovery-policy.schema.json",
    supportedStatuses: [ARTIFACT_STATUS.COMPLETE, ARTIFACT_STATUS.PARTIAL],
    definitionStatus: DEFINITION_STATUS.IMPLEMENTED,
    describe: "Every capture attempt, including the ones that failed and what was done about them."
  },

  {
    kind: "extraction-warnings",
    filename: "output/extraction-warnings.md",
    producingModes: ["analyze", "recreate", "adapt", "extend", "improve"],
    requiredInputs: ["ir"],
    sourceIR: "ir.json",
    sourceEvidence: "evidence-map.json",
    hashRequirements: [HASH_REQUIREMENT.IR],
    humanReadable: true,
    machineReadable: false,
    requiredForModes: ["analyze", "recreate", "adapt", "extend", "improve"],
    staleBehavior: STALE_BEHAVIOR.REGENERATE_SAFE,
    blockedBehavior: BLOCKED_BEHAVIOR.EMIT,
    owningProjection: "src/project/coverage-report.mjs#projectExtractionWarnings",
    validationSchema: null,
    requiredSections: [...HEADER_FIELDS],
    supportedStatuses: [ARTIFACT_STATUS.COMPLETE, ARTIFACT_STATUS.PARTIAL, ARTIFACT_STATUS.BLOCKED, ARTIFACT_STATUS.STALE, ARTIFACT_STATUS.SUPERSEDED],
    definitionStatus: DEFINITION_STATUS.IMPLEMENTED,
    describe: "What the extractor could not read, and why. Always written — a silent extraction failure looks identical to a page that had nothing there."
  },
  {
    kind: "mode-evaluation",
    filename: "output/mode-evaluation.md",
    producingModes: ["analyze", "recreate", "adapt", "extend", "improve"],
    requiredInputs: ["ir", "mode-requirements"],
    sourceIR: "ir.json",
    sourceEvidence: "evidence-map.json",
    hashRequirements: [HASH_REQUIREMENT.IR],
    humanReadable: true,
    machineReadable: false,
    requiredForModes: ["analyze", "recreate", "adapt", "extend", "improve"],
    staleBehavior: STALE_BEHAVIOR.REGENERATE_SAFE,
    blockedBehavior: BLOCKED_BEHAVIOR.EMIT,
    owningProjection: "src/project/mode-evaluation.mjs#projectModeEvaluation",
    validationSchema: "schemas/mode-requirements.schema.json",
    requiredSections: [...HEADER_FIELDS],
    supportedStatuses: [ARTIFACT_STATUS.COMPLETE, ARTIFACT_STATUS.PARTIAL, ARTIFACT_STATUS.BLOCKED, ARTIFACT_STATUS.STALE, ARTIFACT_STATUS.SUPERSEDED],
    definitionStatus: DEFINITION_STATUS.IMPLEMENTED,
    describe: "Whether the requested mode's requirements were met, requirement by requirement, with the remedy for each that was not."
  },
  {
    kind: "fidelity-checklist",
    filename: "output/fidelity-checklist.md",
    producingModes: ["recreate", "extend"],
    requiredInputs: ["ir"],
    sourceIR: "ir.json",
    sourceEvidence: "evidence-map.json",
    hashRequirements: [HASH_REQUIREMENT.IR],
    humanReadable: true,
    machineReadable: false,
    requiredForModes: ["recreate", "extend"],
    staleBehavior: STALE_BEHAVIOR.REGENERATE_NEEDS_REVIEW,
    blockedBehavior: BLOCKED_BEHAVIOR.PRUNE,
    owningProjection: "src/project/components.mjs#projectFidelityChecklist",
    validationSchema: null,
    requiredSections: [...HEADER_FIELDS],
    supportedStatuses: [ARTIFACT_STATUS.COMPLETE, ARTIFACT_STATUS.PARTIAL, ARTIFACT_STATUS.STALE, ARTIFACT_STATUS.SUPERSEDED],
    definitionStatus: DEFINITION_STATUS.IMPLEMENTED,
    describe: "What to check a build against, derived from what was measured. Withdrawn on a blocked run alongside the prompt it accompanies."
  },
  {
    kind: "screenshot-evidence-report",
    filename: "output/screenshot-evidence-report.md",
    producingModes: ["analyze", "improve"],
    requiredInputs: ["ir"],
    sourceIR: "ir.json",
    sourceEvidence: "evidence-map.json",
    hashRequirements: [HASH_REQUIREMENT.IR],
    humanReadable: true,
    machineReadable: false,
    requiredForModes: [],
    requiredSourceKinds: ["screenshots"],
    staleBehavior: STALE_BEHAVIOR.REGENERATE_SAFE,
    blockedBehavior: BLOCKED_BEHAVIOR.EMIT,
    owningProjection: "src/project/screenshot-report.mjs#projectScreenshotReport",
    validationSchema: null,
    requiredSections: [...HEADER_FIELDS],
    supportedStatuses: [ARTIFACT_STATUS.PARTIAL, ARTIFACT_STATUS.BLOCKED, ARTIFACT_STATUS.STALE, ARTIFACT_STATUS.SUPERSEDED],
    definitionStatus: DEFINITION_STATUS.IMPLEMENTED,
    describe: "What screenshot evidence could and could not establish, and the ceiling it caps every claim at."
  },
  {
    kind: "disagreement-report",
    filename: "output/disagreement-report.md",
    producingModes: ["analyze", "recreate", "adapt", "extend", "improve"],
    requiredInputs: ["ir"],
    sourceIR: "ir.json",
    sourceEvidence: "evidence-map.json",
    hashRequirements: [HASH_REQUIREMENT.IR],
    humanReadable: true,
    machineReadable: false,
    requiredForModes: [],
    staleBehavior: STALE_BEHAVIOR.REGENERATE_SAFE,
    blockedBehavior: BLOCKED_BEHAVIOR.EMIT,
    owningProjection: "src/project/disagreement-report.mjs#projectDisagreementReport",
    validationSchema: null,
    requiredSections: [...HEADER_FIELDS],
    supportedStatuses: [ARTIFACT_STATUS.COMPLETE, ARTIFACT_STATUS.PARTIAL, ARTIFACT_STATUS.BLOCKED, ARTIFACT_STATUS.STALE, ARTIFACT_STATUS.SUPERSEDED],
    definitionStatus: DEFINITION_STATUS.IMPLEMENTED,
    describe: "Where two sources disagreed, what each said, and which was preferred. Written whenever more than one source contributed."
  },

  /* ---- declared, not produced: these belong to the correction workflow ---- */

  {
    kind: "correction-tasks",
    filename: "output/correction-tasks.md",
    producingModes: ["recreate", "adapt", "extend", "improve"],
    requiredInputs: ["fidelity-comparison"],
    sourceIR: "ir.json",
    sourceEvidence: "fidelity-comparison.json",
    hashRequirements: [HASH_REQUIREMENT.IR, HASH_REQUIREMENT.CONFIGURATION],
    humanReadable: true,
    machineReadable: false,
    requiredForModes: [],
    staleBehavior: STALE_BEHAVIOR.REGENERATE_NEEDS_REVIEW,
    blockedBehavior: BLOCKED_BEHAVIOR.PRUNE,
    owningProjection: null,
    validationSchema: null,
    requiredSections: [...HEADER_FIELDS, "Tasks", "Acceptance"],
    supportedStatuses: [ARTIFACT_STATUS.COMPLETE, ARTIFACT_STATUS.PARTIAL, ARTIFACT_STATUS.STALE, ARTIFACT_STATUS.SUPERSEDED],
    definitionStatus: DEFINITION_STATUS.DECLARED,
    declaredFor: "Phase 5.7 — correction workflow",
    describe: "Manual tasks derived from a fidelity comparison. Every task is for a person; nothing is applied automatically."
  },
  {
    kind: "correction-log",
    filename: "corrections/correction-log.md",
    producingModes: ["recreate", "adapt", "extend", "improve"],
    requiredInputs: ["corrections"],
    sourceIR: null,
    sourceEvidence: "corrections/",
    hashRequirements: [],
    humanReadable: true,
    machineReadable: false,
    requiredForModes: [],
    staleBehavior: STALE_BEHAVIOR.PRESERVE_ONLY,
    blockedBehavior: BLOCKED_BEHAVIOR.EMIT,
    owningProjection: null,
    validationSchema: "schemas/correction.schema.json",
    requiredSections: ["Corrections"],
    supportedStatuses: [ARTIFACT_STATUS.COMPLETE, ARTIFACT_STATUS.PARTIAL],
    definitionStatus: DEFINITION_STATUS.DECLARED,
    declaredFor: "Phase 5.7 — correction workflow",
    describe: "Every correction a person filed, what it superseded, and whether a promotion followed."
  }
]);

/* --------------------------------------------------------------- lookups */

const BY_KIND = new Map(ARTIFACTS.map((a) => [a.kind, a]));

/**
 * Filenames, including the blocked-run alias.
 *
 * `output/partial-design-spec.md` is the design spec under the name a refused
 * run writes it as. It is the same registered artifact and must resolve to the
 * same definition — otherwise a blocked run produces a file the validator calls
 * unregistered and the pruner will not withdraw.
 */
const BY_FILENAME = new Map([
  ...ARTIFACTS.map((a) => [a.filename, a]),
  ...ARTIFACTS.filter((a) => a.blockedFilename).map((a) => [a.blockedFilename, a])
]);

export const artifactKinds = () => ARTIFACTS.map((a) => a.kind);

export function findArtifact(kindOrFilename) {
  return BY_KIND.get(kindOrFilename) ?? BY_FILENAME.get(kindOrFilename) ?? null;
}

/** Everything a mode may produce. Anything else from that mode is a defect. */
export function artifactsForMode(mode) {
  return ARTIFACTS.filter((a) => a.producingModes.includes(mode));
}

/**
 * The subset a mode MUST produce for the run to be complete.
 *
 * Requiredness is per-mode, not a property of the artifact. `extracted-tokens`
 * is mandatory for `recreate` and `adapt` — both stake instructions on exact
 * values — and merely useful for `analyze`. One boolean would have to pick one
 * of those and be wrong about the others.
 */
export function requiredArtifactsForMode(mode) {
  return artifactsForMode(mode).filter((a) => a.requiredForModes.includes(mode));
}

/** Whether a mode must produce a given artifact. */
export function isRequiredFor(kind, mode) {
  return findArtifact(kind)?.requiredForModes?.includes(mode) ?? false;
}

/**
 * Whether a mode may produce an artifact, with the reason when it may not.
 *
 * Returns a decision rather than a boolean because "no" is the interesting
 * answer and a bare `false` throws away the only useful part of it.
 */
export function mayProduce({ kind, mode, sourceKind = null, blocked = false }) {
  const def = findArtifact(kind);
  if (!def) {
    return { allowed: false, code: "unsupported-artifact-kind", why: `\`${kind}\` is not a registered artifact.` };
  }
  if (!def.producingModes.includes(mode)) {
    return {
      allowed: false,
      code: "wrong-mode",
      why: `\`${mode}\` does not produce ${def.kind}. It is produced by: ${def.producingModes.join(", ")}.`,
      remedy: `Run one of ${def.producingModes.join(", ")}, or drop the artifact from this run.`
    };
  }
  if (sourceKind && (def.forbiddenSourceKinds ?? []).includes(sourceKind)) {
    return {
      allowed: false,
      code: "wrong-source-kind",
      why: `${def.kind} cannot be produced from ${sourceKind} evidence.`,
      remedy: sourceKind === "screenshots"
        ? "Capture the reference as a live page. Screenshot evidence is estimated by construction and cannot support this artifact."
        : `Capture the reference as one of: ${SOURCE_KINDS.filter((k) => !(def.forbiddenSourceKinds ?? []).includes(k)).join(", ")}.`
    };
  }
  if (sourceKind && (def.requiredSourceKinds ?? []).length && !def.requiredSourceKinds.includes(sourceKind)) {
    return {
      allowed: false,
      code: "wrong-source-kind",
      why: `${def.kind} exists only for ${def.requiredSourceKinds.join(", ")} evidence; this run used ${sourceKind}.`,
      remedy: `Use ${ARTIFACTS.find((a) => a.kind === "extracted-tokens").filename} instead.`
    };
  }
  if (blocked && def.blockedBehavior === BLOCKED_BEHAVIOR.PRUNE) {
    return {
      allowed: false,
      code: "blocked-run",
      why: `${def.kind} is an implementation instruction, and this run was refused by the safety gate.`,
      remedy: "Read output/blocked-prompt.md for what would change the verdict."
    };
  }
  if (!blocked && def.blockedBehavior === BLOCKED_BEHAVIOR.EMIT_ONLY_WHEN_BLOCKED) {
    return {
      allowed: false,
      code: "not-blocked",
      why: `${def.kind} is written only when a run is refused, and this one was not.`
    };
  }
  if (def.definitionStatus === DEFINITION_STATUS.DECLARED) {
    return {
      allowed: false,
      code: "not-implemented",
      why: `${def.kind} is registered but has no producer yet (${def.declaredFor}).`,
      remedy: "Nothing to do. It is named here so it is governed when it arrives, not to imply it exists."
    };
  }
  return { allowed: true, definition: def };
}

/** Implementation instructions — the artifacts a blocked run must not leave behind. */
export const implementationPrompts = () => ARTIFACTS.filter((a) => a.isImplementationPrompt);

/** What a blocked run should remove from the current output. */
export const prunedWhenBlocked = () => ARTIFACTS.filter((a) => a.blockedBehavior === BLOCKED_BEHAVIOR.PRUNE);

/** What a blocked run must still write. */
export const emittedWhenBlocked = () => ARTIFACTS.filter((a) =>
  a.blockedBehavior === BLOCKED_BEHAVIOR.EMIT ||
  a.blockedBehavior === BLOCKED_BEHAVIOR.EMIT_AS_PARTIAL ||
  a.blockedBehavior === BLOCKED_BEHAVIOR.EMIT_ONLY_WHEN_BLOCKED);

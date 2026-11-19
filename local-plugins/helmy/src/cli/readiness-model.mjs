/**
 * The readiness presentation model.
 *
 * Everything this system knows about a run already exists somewhere: the mode
 * evaluation holds the requirements, the IR holds coverage and confidence, the
 * artifact registry holds what should exist, the linter holds what was refused,
 * the defect store holds the standing limitations. What has been missing is a
 * single shape that answers the question a person actually asks — *can I do
 * this, and if not, what do I do next* — without them opening five files.
 *
 * Three rules govern the whole model, and each is a rule about what NOT to do:
 *
 *   1. **No composite score.** Not readiness, not quality, not confidence. The
 *      decisions differ, and one number would have to hide the difference —
 *      which is the only thing it could accomplish.
 *   2. **Coverage and confidence stay apart.** They answer different questions:
 *      whether the right thing was read, and how well it was read. A confident
 *      reading of the wrong region and a hesitant reading of the right one are
 *      not the same situation, and multiplying them says they are.
 *   3. **Nothing is averaged across viewports or states.** A layout that holds
 *      at 1440 and breaks at 375 is not "half correct"; it is correct at one
 *      width and broken at another, and the mean describes neither.
 *
 * The model carries no rendering. `present.mjs` turns it into prose, and the
 * `--json` output is the model itself — so the two cannot drift, and anything
 * visible in the human output is addressable in the JSON.
 */

import { STATUS, READINESS } from "./result.mjs";
import { findArtifact, ARTIFACTS, DEFINITION_STATUS, mayProduce } from "../artifacts/registry.mjs";
import { checkFreshness, FRESHNESS } from "../artifacts/freshness.mjs";
import { readMetadata } from "../artifacts/metadata.mjs";
import { REMEDY } from "../modes/requirements.mjs";

/**
 * What a single mode requirement came to.
 *
 * `unknown` is its own status and is never promoted to `blocked` unless the
 * mode's own requirements say the evidence is mandatory. A gap the mode does
 * not need is a gap, not a failure — collapsing the two is how a report starts
 * refusing runs the evidence actually supports.
 */
export const REQUIREMENT_STATUS = Object.freeze({
  SATISFIED: "satisfied",
  WARNING: "warning",
  BLOCKED: "blocked",
  UNKNOWN: "unknown",
  NOT_APPLICABLE: "not-applicable",
  REQUIRES_USER_INPUT: "requires-user-input",
  UNSUPPORTED: "unsupported"
});

/** What happened to an artifact this run was expected to produce. */
export const ARTIFACT_STATE = Object.freeze({
  GENERATED: "generated",
  NOT_GENERATED: "not-generated",
  BLOCKED: "blocked",
  STALE: "stale",
  INVALID: "invalid",
  HISTORICAL: "historical",
  NOT_APPLICABLE: "not-applicable",
  NO_PRODUCER: "no-producer"
});

/**
 * Why something cannot be done — the distinction that decides what a user does
 * next, and the one most often lost.
 *
 * "Recapture and it will work" and "no capture of any kind will ever fix this"
 * are different answers. A report that gives neither sends the reader to try
 * the same thing again.
 */
export const LIMITATION_KIND = Object.freeze({
  /** The input kind cannot carry this evidence. Recapturing the same kind will not help. */
  INTRINSIC_TO_INPUT: "intrinsic-to-input",
  /** This build does not implement it. A different tool version might. */
  IMPLEMENTATION: "implementation",
  /** Refused by decision rather than by capability. */
  POLICY: "policy",
  /** The capture missed it. Recapturing may help. */
  COVERAGE: "coverage"
});

export const LIMITATION_MEANING = Object.freeze({
  [LIMITATION_KIND.INTRINSIC_TO_INPUT]: "No capture of this input kind will produce it. Change the input kind or use a mode this evidence supports.",
  [LIMITATION_KIND.IMPLEMENTATION]: "This build does not implement it. Nothing you capture will change that.",
  [LIMITATION_KIND.POLICY]: "Refused by decision, not by capability. It will not become available by trying harder.",
  [LIMITATION_KIND.COVERAGE]: "The capture did not reach it. Recapturing may help."
});

/* ------------------------------------------------------------ requirements */

/**
 * Turns one mode requirement into a presentable record.
 *
 * `recaptureHelps` is derived from the requirement's own remedy rather than
 * guessed, so a requirement whose remedy is `source` — the evidence is not in
 * this kind of input at all — cannot be presented as something to re-run.
 */
function presentRequirement(requirement, { satisfied, gap, sourceKind, confidence = null }) {
  const remedy = requirement.remedy ?? REMEDY.RECAPTURE;
  const recaptureHelps = remedy === REMEDY.RECAPTURE;

  let status = REQUIREMENT_STATUS.SATISFIED;
  if (!satisfied) {
    if (gap?.severity === "blocking") status = REQUIREMENT_STATUS.BLOCKED;
    else if (gap?.severity === "warning") status = REQUIREMENT_STATUS.WARNING;
    else status = REQUIREMENT_STATUS.UNKNOWN;
  }

  return {
    id: requirement.id,
    name: requirement.label ?? requirement.id,
    status,
    severity: gap?.severity ?? (satisfied ? null : "warning"),
    describe: requirement.description ?? null,
    evidenceAvailable: satisfied ? (gap?.detail ?? "present") : null,
    evidenceMissing: satisfied ? null : (gap?.detail ?? "not established"),
    sourceKind,
    confidence,
    behavior: gap?.severity === "blocking" ? "blocker" : satisfied ? "none" : "warning",
    remediation: remediationFor({ requirement, remedy, sourceKind, satisfied }),
    recaptureHelps: satisfied ? null : recaptureHelps,
    limitationKind: satisfied ? null : limitationKindFor({ remedy, sourceKind })
  };
}

function limitationKindFor({ remedy, sourceKind }) {
  if (remedy === REMEDY.SOURCE) return LIMITATION_KIND.INTRINSIC_TO_INPUT;
  if (remedy === REMEDY.NONE) return LIMITATION_KIND.IMPLEMENTATION;
  return LIMITATION_KIND.COVERAGE;
}

function remediationFor({ requirement, remedy, sourceKind, satisfied }) {
  if (satisfied) return null;
  if (remedy === REMEDY.SOURCE) {
    return sourceKind === "screenshots"
      ? "Capture the reference as a live page. Screenshot input cannot expose computed styles, so recapturing more screenshots will not produce this."
      : "This evidence is not available from the current input kind. Change the input rather than recapturing it.";
  }
  if (remedy === REMEDY.NONE) {
    return "Nothing to capture. This build does not establish this, and no run will.";
  }
  return `Recapture with wider coverage. ${requirement.description ?? "The capture did not reach this."}`;
}

/* -------------------------------------------------------- coverage/confidence */

/**
 * Coverage, broken out by the dimensions that matter, never rolled up.
 *
 * Each dimension answers a different question, and a reader chasing a specific
 * gap needs the dimension it lives in. `null` throughout means not measured —
 * never zero, which would claim nothing was reached.
 */
export function presentCoverage(ir) {
  const c = ir?.coverage ?? null;
  const byViewport = (ir?.responsive?.viewports ?? []).map((v) => ({
    viewport: v.viewport ?? v.width ?? null,
    contentReached: v.contentReached ?? null,
    coverageFactor: v.coverageFactor ?? null,
    note: v.note ?? null
  }));

  return {
    /* Reported as a set of factors rather than their product. The product is
     * how a reader loses which factor was the problem. */
    factors: c?.factors ? { ...c.factors } : null,
    contentReached: c?.contentReached ?? null,
    coverageFactor: c?.coverageFactor ?? null,
    visibleSampledPercent: c?.visibleSampledPercent ?? null,
    captureMethod: c?.captureMethod ?? null,
    /* Region verification records checks against an expected region rather than
     * a list of regions. Reporting the checks keeps the distinction between "we
     * looked at the wrong part of the page" and "we looked at the right part
     * and found little". */
    byRegion: (ir?.verification?.checks ?? []).map((check) => ({
      region: check.selector ?? check.name ?? check.check ?? "unnamed",
      reached: check.passed ?? check.ok ?? null,
      detail: check.detail ?? check.reason ?? null
    })),
    analysedRegion: ir?.verification?.analysedRegion ?? null,
    expectedRegion: ir?.verification?.expectedRegion ?? null,
    byViewport,
    /* `states` is keyed by state name, not a list. Each entry carries its own
     * status, and `unknown` means the state was never induced — which is a
     * coverage fact, not a finding about the component. */
    byState: (ir?.components ?? []).flatMap((component) =>
      Object.entries(component.states ?? {}).map(([name, state]) => ({
        component: component.id,
        state: name,
        induced: state?.status != null && state.status !== "unknown",
        status: state?.status ?? "unknown",
        reason: state?.reason ?? null
      }))),
    bySourceKind: (ir?.sourceKinds ?? []).map((kind) => ({ sourceKind: kind })),
    byComponent: (ir?.components ?? []).map((component) => ({
      component: component.id,
      role: component.role ?? null,
      confidence: component.confidence ?? null,
      anatomyParts: (component.anatomy ?? []).length || null
    })),
    /* Stated on the model rather than left to the renderer, so the JSON
     * carries the prohibition too. */
    note: "Coverage is reported per dimension and never rolled into one number. A capture that reached the right region at one viewport and missed it at another is not partially correct."
  };
}

/** Confidence, per category. Never multiplied by coverage, never averaged. */
export function presentConfidence(ir) {
  const measured = ir?.confidence?.byCategory ?? {};
  /* The categories a reader expects to see, plus whatever the IR actually
   * measured. The union rather than either alone: a fixed list would drop a
   * category the analysis produced, and the IR's own keys alone would hide
   * that an expected category was never measured. */
  const EXPECTED = [
    "layout", "typography", "spacing", "color", "components",
    "states", "responsive", "motion", "accessibility", "intrinsic"
  ];
  const names = [...new Set([...EXPECTED, ...Object.keys(measured)])];

  return {
    byCategory: Object.fromEntries(names.map((name) => [name, measured[name] ?? null])),
    expectedCategories: EXPECTED,
    measuredCategories: Object.keys(measured),
    provenance: ir?.confidence?.provenance ?? null,
    note: "Confidence is how well a claim was read. Coverage is whether the right thing was read. They are reported side by side and never multiplied — a confident reading of the wrong region earns no standing."
  };
}

/* ------------------------------------------------------------- artifacts */

/**
 * The state of every artifact this mode was expected to produce.
 *
 * A missing optional artifact is not a failure and must not read as one. A
 * blocked implementation prompt is not merely absent — it was withdrawn, and
 * saying only "not generated" hides that a decision was made.
 */
export function presentArtifacts({ mode, sourceKind, blocked = false, files = {}, pruned = [], lint = {}, current = {} }) {
  const out = [];

  for (const def of ARTIFACTS) {
    if (!def.producingModes.includes(mode)) {
      out.push(record(def, ARTIFACT_STATE.NOT_APPLICABLE,
        `\`${mode}\` does not produce it; it belongs to ${def.producingModes.join(", ")}.`));
      continue;
    }
    if (def.definitionStatus === DEFINITION_STATUS.DECLARED) {
      out.push(record(def, ARTIFACT_STATE.NO_PRODUCER,
        `Registered so it is governed when it arrives, but nothing writes it yet (${def.declaredFor}).`));
      continue;
    }
    if (def.staleBehavior === "preserve-only") {
      out.push(record(def, ARTIFACT_STATE.HISTORICAL,
        "A historical record. It describes the past and is never regenerated."));
      continue;
    }

    const filename = blocked && def.blockedFilename ? def.blockedFilename : def.filename;
    const content = files[filename] ?? files[def.filename] ?? null;
    const wasPruned = pruned.some((p) => (p.filename ?? p) === def.filename);
    const lintResult = lint[def.filename] ?? null;

    if (lintResult?.blocked) {
      out.push(record(def, ARTIFACT_STATE.BLOCKED,
        `Withdrawn by prompt lint: ${[...new Set(lintResult.blocking.map((f) => f.rule))].join(", ")}. It is not available as an implementation prompt.`,
        { lintRules: lintResult.blocking.map((f) => f.rule) }));
      continue;
    }
    if (wasPruned) {
      out.push(record(def, ARTIFACT_STATE.BLOCKED,
        "Withdrawn because the run was refused. Its removal is recorded in history and its content is preserved there."));
      continue;
    }
    if (!content) {
      const admissible = mayProduce({ kind: def.kind, mode, sourceKind, blocked });
      out.push(record(def,
        admissible.allowed ? ARTIFACT_STATE.NOT_GENERATED : ARTIFACT_STATE.NOT_APPLICABLE,
        admissible.allowed
          ? (def.requiredForModes.includes(mode)
              ? "Expected for this mode and not written. That is a gap in the run."
              : "Optional for this mode and not written. This is not a failure.")
          : admissible.why));
      continue;
    }

    const metadata = readMetadata(filename, content);
    const fresh = Object.keys(current).length ? checkFreshness(metadata, current) : null;
    if (fresh && (fresh.verdict === FRESHNESS.STALE || fresh.verdict === FRESHNESS.INCOMPATIBLE)) {
      out.push(record(def, ARTIFACT_STATE.STALE,
        `${fresh.summary} ${fresh.recommendation ?? ""}`.trim(),
        { freshness: fresh.verdict, reasons: fresh.reasons.map((r) => r.field) }));
      continue;
    }
    if (metadata?.$malformed) {
      out.push(record(def, ARTIFACT_STATE.INVALID,
        "The metadata block could not be parsed, which a generated file's never is. Regenerate it."));
      continue;
    }

    out.push(record(def, ARTIFACT_STATE.GENERATED, null, {
      lintFindings: lintResult ? lintResult.findings.length : 0
    }));
  }
  return out;
}

const record = (def, state, note, extra = {}) => ({
  kind: def.kind,
  filename: def.filename,
  state,
  required: null,
  humanReadable: def.humanReadable,
  note,
  ...extra
});

/* ---------------------------------------------------------------- defects */

/**
 * Open defects, filtered to those that actually bear on this run.
 *
 * An unrelated defect must never become a blocker. The filter is on the
 * capability the defect affects against what the run is doing — a defect in
 * cross-build component matching is irrelevant to an `analyze` run and would be
 * noise on its report.
 */
export function presentDefects({ defects = [], mode, sourceKind, operation }) {
  const relevant = [];
  for (const defect of defects) {
    const affects = affectedCapability(defect);
    if (!bearsOn(affects, { mode, sourceKind, operation })) continue;

    relevant.push({
      id: defect.id,
      severity: defect.severity,
      status: defect.promotionStatus,
      affectedCapability: affects,
      evidenceLimitation: defect.actual ?? null,
      /* An open defect is a standing limitation, not a gate. Nothing here
       * blocks a mode; the gates do that on evidence. */
      blocksRequestedMode: false,
      affectsFidelity: /fidelity|comparison|match/i.test(`${affects} ${defect.heuristic ?? ""}`),
      containment: defect.proposedRule ?? null,
      nextEvidenceNeeded: defect.regressionTest?.status === "passing"
        ? "None. A regression test holds it closed."
        : "A second independent witness, or a regression test that fails without the fix."
    });
  }
  return relevant;
}

/**
 * The capability a defect bears on, named for a reader rather than by module.
 *
 * A module path is where the code lives; a capability is what a person was
 * trying to do. "src/extract/extract.js" tells them nothing about whether it
 * affects the run in front of them.
 */
function affectedCapability(defect) {
  const module = String(defect.module ?? "");
  if (/deploy|match/.test(module)) return "cross-build component matching";
  if (/fidelity/.test(module)) return "fidelity comparison";
  if (/screenshot/.test(module)) return "screenshot evidence";
  if (/extract/.test(module)) return "evidence extraction";
  if (/driver|capture|live-smoke/.test(module)) return "capture";
  if (/prompt|project/.test(module)) return "prompt generation";
  if (/docs|\.md$/.test(module)) return "documentation";
  return module || "unspecified";
}

/**
 * Whether a defect bears on THIS run.
 *
 * An unrelated defect must never appear, and must never become a blocker. The
 * test is on what the run is doing: a defect in cross-build matching is
 * irrelevant to a single `analyze` capture and would be noise on its report,
 * where the same defect is the central caveat on a fidelity comparison.
 *
 * The default is to hide rather than show. A report that lists every open
 * defect regardless teaches the reader to skip the section, which costs them
 * the one that mattered.
 */
function bearsOn(capability, { mode, sourceKind, operation }) {
  switch (capability) {
    case "screenshot evidence":
      return sourceKind === "screenshots";
    case "cross-build component matching":
    case "fidelity comparison":
      return ["compare", "tasks", "verify"].includes(operation);
    case "prompt generation":
      return mode !== null && mode !== "analyze";
    case "evidence extraction":
    case "capture":
      /* Everything rests on the capture, so these are relevant whenever there
       * is a run to report on at all. */
      return mode !== null;
    case "documentation":
      /* A documentation defect changes nothing about what a run can do. */
      return false;
    default:
      return false;
  }
}

/* ------------------------------------------------------------- the model */

/**
 * Assembles the whole presentation model.
 *
 * Every field the phase brief names appears here, including the ones that are
 * `false` or empty on a given run — an absent field reads as an oversight,
 * where an explicit `browserLaunched: false` is a claim somebody can check.
 */
export function buildReadinessModel({
  command,
  status,
  mode = null,
  sourceKind = null,
  project = null,
  workspace = null,
  ir = null,
  modeEvaluation = null,
  blockers = [],
  warnings = [],
  lint = {},
  files = {},
  pruned = [],
  current = {},
  defects = [],
  recoveryHistory = [],
  userActions = [],
  browserLaunched = false,
  captureAttempted = false,
  staleArtifacts = []
} = {}) {
  const evaluation = modeEvaluation ?? ir?.modeEvaluation ?? null;
  const effectiveMode = mode ?? evaluation?.requestedMode ?? null;
  const effectiveSource = sourceKind ?? ir?.meta?.source?.kind ?? null;

  const satisfiedIds = new Set((evaluation?.availableEvidence ?? []).map((e) => e.id));
  const gapById = new Map([
    ...(evaluation?.blockingGaps ?? []).map((g) => [g.id, { ...g, severity: "blocking" }]),
    ...(evaluation?.warningGaps ?? []).map((g) => [g.id, { ...g, severity: "warning" }]),
    ...(evaluation?.informationalGaps ?? []).map((g) => [g.id, { ...g, severity: "informational" }])
  ]);

  const requirements = [
    ...(evaluation?.requiredEvidence ?? []),
    ...(evaluation?.optionalEvidence ?? [])
  ].map((requirement) => presentRequirement(requirement, {
    satisfied: satisfiedIds.has(requirement.id),
    gap: gapById.get(requirement.id),
    sourceKind: effectiveSource,
    confidence: ir?.confidence?.byCategory?.[requirement.id] ?? null
  }));

  const lintFindings = Object.entries(lint).flatMap(([filename, result]) =>
    (result.findings ?? []).map((f) => ({ artifact: filename, ...f })));

  return {
    modelVersion: "1",
    command,
    requestedMode: effectiveMode,
    sourceKind: effectiveSource,
    project,
    workspace,
    status,

    blockers,
    warnings,

    requirements,
    satisfiedRequirements: requirements.filter((r) => r.status === REQUIREMENT_STATUS.SATISFIED),
    missingRequirements: requirements.filter((r) => r.status !== REQUIREMENT_STATUS.SATISFIED),

    evidenceCoverage: presentCoverage(ir),
    confidenceByCategory: presentConfidence(ir),

    contestedClaims: (ir?.contestedClaims ?? []).map((c) => ({
      claim: c.claim ?? c.path ?? "unnamed",
      candidates: c.candidates ?? [],
      preferredSource: c.disagreement?.preferredSource ?? null,
      critical: c.critical ?? false,
      /* Contested is its own state. It is not a failure and not an unknown:
       * two sources produced values and they disagree, which is a finding. */
      resolution: "Not resolved. Neither candidate is presented as settled; decide which source you trust before building on one."
    })),

    unknowns: (ir?.unknowns ?? []).map((u) => ({
      claim: u.claim ?? String(u),
      reason: u.reason ?? null,
      /* An unknown stays unknown. Promoting it to a failure would refuse runs
       * whose mode never needed the evidence. */
      isFailure: false
    })),

    limitations: buildLimitations({ ir, evaluation, sourceKind: effectiveSource }),
    staleArtifacts,
    openDefects: presentDefects({ defects, mode: effectiveMode, sourceKind: effectiveSource, operation: command }),

    lintFindings,
    lintBlocked: Object.entries(lint).filter(([, r]) => r.blocked).map(([f]) => f),

    artifacts: presentArtifacts({
      mode: effectiveMode, sourceKind: effectiveSource,
      blocked: status === STATUS.BLOCKED, files, pruned, lint, current
    }),

    recoveryHistory,
    recommendedNextActions: recommendedActions({ status, blockers, evaluation, userActions, lint }),
    userInputRequired: userActions,

    browserLaunched,
    captureAttempted,

    /* Named so a reader cannot go looking for one. */
    compositeScore: null,
    compositeScoreNote: "No composite readiness score is produced. The decisions differ, and one number would have to hide the difference — which is the only thing it could accomplish."
  };
}

function buildLimitations({ ir, evaluation, sourceKind }) {
  const out = [];

  if (sourceKind === "screenshots") {
    out.push({
      kind: LIMITATION_KIND.INTRINSIC_TO_INPUT,
      what: "Every value came from screenshots and is estimated.",
      meaning: LIMITATION_MEANING[LIMITATION_KIND.INTRINSIC_TO_INPUT],
      recaptureHelps: false
    });
  }
  if (evaluation?.blockingGaps?.some((g) => g.remedy === REMEDY.SOURCE)) {
    out.push({
      kind: LIMITATION_KIND.INTRINSIC_TO_INPUT,
      what: "At least one requirement needs evidence this input kind cannot carry.",
      meaning: LIMITATION_MEANING[LIMITATION_KIND.INTRINSIC_TO_INPUT],
      recaptureHelps: false
    });
  }
  const coverage = ir?.coverage?.coverageFactor;
  if (typeof coverage === "number" && coverage < 1) {
    out.push({
      kind: LIMITATION_KIND.COVERAGE,
      what: `The capture reached ${(coverage * 100).toFixed(0)}% of what it tried to read.`,
      meaning: LIMITATION_MEANING[LIMITATION_KIND.COVERAGE],
      recaptureHelps: true
    });
  }
  out.push({
    kind: LIMITATION_KIND.POLICY,
    what: "No tolerance in this system is validated.",
    meaning: LIMITATION_MEANING[LIMITATION_KIND.POLICY],
    recaptureHelps: false
  });
  return out;
}

/**
 * What to do next, in the order a person would do it.
 *
 * Blockers first, because nothing below them can be acted on until they clear.
 * Never a bare "review the output".
 */
function recommendedActions({ status, blockers, evaluation, userActions, lint }) {
  const actions = [];

  for (const action of userActions) {
    actions.push({ priority: "required", what: action.what, how: action.how });
  }
  for (const blocker of blockers) {
    actions.push({
      priority: "blocking",
      what: blocker.message,
      how: blocker.recommendation ?? blocker.userAction ?? null,
      recaptureHelps: blocker.recaptureResolves ?? null,
      intrinsicToInput: blocker.impossibleForInputKind ?? null
    });
  }
  for (const [filename, result] of Object.entries(lint)) {
    if (!result.blocked) continue;
    actions.push({
      priority: "blocking",
      what: `${filename} was withdrawn by prompt lint (${[...new Set(result.blocking.map((f) => f.rule))].join(", ")}).`,
      how: result.blocking[0]?.remediation ?? "See docs/PROMPT-LINT.md."
    });
  }
  if (evaluation?.recommendedNextAction) {
    actions.push({ priority: "suggested", what: evaluation.recommendedNextAction, how: null });
  }
  if (!actions.length && status === STATUS.COMPLETED) {
    actions.push({
      priority: "suggested",
      what: "Read the evidence report before acting on the design spec.",
      how: "`output/evidence-report.md` groups every claim by how it came to be known."
    });
  }
  return actions;
}

export { STATUS, READINESS };

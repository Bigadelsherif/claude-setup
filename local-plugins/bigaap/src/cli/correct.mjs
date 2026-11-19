/**
 * The correction commands.
 *
 * `bigaap correct` proposes; `bigaap correction accept|reject|promote` decides.
 * The split is deliberate: proposing is cheap and reversible, and deciding is
 * the step that changes what the system says. Collapsing them into one command
 * with a `--yes` flag would make the review step something people learn to skip.
 *
 * Everything here returns a `cliResult` with the usual statuses, so a correction
 * that needs input returns `requires-user-input` (exit 6) exactly as a mode
 * workflow does, and a refused correction returns `blocked` (exit 3) rather
 * than borrowing `failed`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cliResult, STATUS, READINESS } from "./result.mjs";
import { workspaceContext } from "./context.mjs";
import {
  buildCorrection, validateCorrection, CORRECTION_CATEGORY, ALL_CATEGORIES,
  SCOPE, ALL_SCOPES, REVIEW_STATUS, REQUIRED_INPUTS
} from "../correct/record.mjs";
import {
  propose, accept as storeAccept, reject as storeReject, promote as storePromote,
  readCorrections, historyOf, readEvents, renderHistory, allocateId, activeCorrections, countWitnesses
} from "../correct/store.mjs";
import { guardCorrection } from "../correct/guard.mjs";
import { previewCorrection, renderPreview } from "../correct/preview.mjs";
import { applyCorrection } from "../correct/pipeline.mjs";
import { evaluatePromotion, renderPromotionDecision, buildGlobalRule } from "../correct/promotion.mjs";
import { Workspace } from "../workspace/workspace.mjs";
import { correctionEvent, EVENT_CLASS } from "../observe/record.mjs";

/** The questions a guided correction asks, in the order it asks them. */
export const CORRECTION_QUESTIONS = Object.freeze([
  { field: "claim", ask: "Which claim is wrong?", flag: "--claim" },
  { field: "category", ask: "What kind of correction is this?", flag: "--category", choices: ALL_CATEGORIES },
  { field: "correctedValue", ask: "What should it say?", flag: "--value" },
  { field: "scope", ask: "How far does this reach?", flag: "--scope", choices: ALL_SCOPES },
  { field: "reason", ask: "Why? (this is what makes it reviewable)", flag: "--reason" }
]);

/* ------------------------------------------------------------- helpers */

const missingInputResult = (operation, missing, workspace) => cliResult({
  operation,
  status: STATUS.REQUIRES_USER_INPUT,
  userActions: missing.map((m) => ({
    what: m.ask,
    how: `Pass ${m.flag}${m.choices ? ` (${m.choices.join(" / ")})` : ""}. ${m.why ?? ""}`.trim(),
    field: m.field
  })),
  summary: `a correction needs ${missing.length} field(s) that were not supplied`,
  readiness: READINESS.UNDETERMINED,
  readinessReason:
    "Waiting on input only you can supply. Nothing here invents a corrected value — a correction with an invented value would be indistinguishable from a measurement.",
  detail: {
    missingInputs: missing.map((m) => ({ field: m.field, flag: m.flag, choices: m.choices ?? null })),
    exampleCommand: `bigaap correct --workspace ${workspace ?? "<dir>"} ${missing.map((m) => `${m.flag} <value>`).join(" ")}`,
    browserLaunched: false
  }
});

const noWorkspace = (operation) => cliResult({
  operation,
  status: STATUS.REQUIRES_USER_INPUT,
  userActions: [{ what: "Say which workspace holds the run you are correcting.", how: "Pass --workspace <dir>.", field: "workspace" }],
  summary: "no workspace was given",
  readiness: READINESS.UNDETERMINED,
  readinessReason: "A correction is filed against a particular run's evidence. Without a workspace there is nothing to correct.",
  detail: { browserLaunched: false }
});

const notFound = (operation, id, known) => cliResult({
  operation,
  status: STATUS.FAILED,
  errors: [{
    code: "correction-not-found",
    message: `No correction \`${id}\` in this workspace.`,
    recommendation: known.length
      ? `Known corrections: ${known.map((c) => c.id).join(", ")}. Run \`bigaap correction history\` for the full record.`
      : "No correction has been filed here yet. `bigaap correct` files one."
  }],
  readiness: READINESS.UNDETERMINED,
  readinessReason: "Nothing was changed."
});

/* --------------------------------------------------------- bigaap correct */

/**
 * Proposes a correction and previews it. Nothing is applied.
 *
 * The preview runs as part of proposing rather than as a separate command,
 * because a proposal nobody previewed is a proposal nobody can review — and the
 * preview is what makes the accept step an informed one.
 */
export function cmdCorrect({
  workspace = null,
  claim = null,
  category = null,
  value = null,
  status = null,
  scope = SCOPE.REFERENCE,
  reason = null,
  author = null,
  evidence = [],
  interactive = false,
  isTTY = false
} = {}) {
  const operation = "correct";
  if (!workspace) return noWorkspace(operation);

  const context = workspaceContext(workspace);
  if (!context.present || !context.ir) {
    return cliResult({
      operation, status: STATUS.NOT_ATTEMPTED,
      warnings: [{
        code: "nothing-to-correct",
        message: `${workspace} holds no analysed run.`,
        recommendation: "Run an analysis first. A correction is filed against evidence, and there is none here."
      }],
      summary: "no analysed run in this workspace",
      readiness: READINESS.UNDETERMINED,
      readinessReason: "Nothing was changed."
    });
  }

  /* Non-interactive requires everything explicitly. Interactive collection is
   * the guided path and is not implemented as a prompt loop here — the fields
   * are few and the flags are the documented interface. */
  const supplied = { claim, category, correctedValue: value, scope, reason };
  const missing = CORRECTION_QUESTIONS
    .filter((q) => {
      const v = supplied[q.field];
      return v === null || v === undefined || v === "";
    })
    .map((q) => ({ ...q, why: REQUIRED_INPUTS.find((r) => r.field === q.field)?.why ?? "" }));

  if (missing.length) return missingInputResult(operation, missing, workspace);

  if (!ALL_CATEGORIES.includes(category)) {
    return cliResult({
      operation, status: STATUS.FAILED,
      errors: [{ code: "invalid-category", message: `\`${category}\` is not a correction category.`, recommendation: `Use one of: ${ALL_CATEGORIES.join(", ")}.` }],
      readiness: READINESS.UNDETERMINED, readinessReason: "Nothing was changed."
    });
  }
  if (!ALL_SCOPES.includes(scope)) {
    return cliResult({
      operation, status: STATUS.FAILED,
      errors: [{ code: "invalid-scope", message: `\`${scope}\` is not a scope.`, recommendation: `Use one of: ${ALL_SCOPES.join(", ")}.` }],
      readiness: READINESS.UNDETERMINED, readinessReason: "Nothing was changed."
    });
  }

  const existing = claimAt(context.ir, claim);
  const record = buildCorrection({
    id: allocateId(workspace),
    workspaceId: workspace,
    referenceId: context.ir?.meta?.source?.value ?? context.ir?.meta?.slug ?? "unknown",
    claim,
    category,
    scope,
    originalValue: existing?.value ?? null,
    correctedValue: coerce(value),
    originalStatus: existing?.status ?? null,
    correctedStatus: status ?? existing?.status ?? null,
    originalEvidenceIds: existing?.evidence ?? [],
    replacementEvidenceIds: evidence,
    sourceKind: context.sourceKind,
    reason,
    author
  });

  const structural = validateCorrection(record);
  if (!structural.valid) {
    return cliResult({
      operation, status: STATUS.FAILED,
      errors: structural.errors.map((e) => ({ code: "correction-invalid", message: e.message, recommendation: e.remedy })),
      readiness: READINESS.UNDETERMINED, readinessReason: "Nothing was changed."
    });
  }

  const guard = guardCorrection({ correction: record, ir: context.ir, sourceKind: context.sourceKind });
  if (!guard.allowed) {
    correctionEvent(observabilityRoot(workspace), record, {
      eventClass: EVENT_CLASS.CORRECTION_BLOCKED,
      command: "correct",
      automaticRefused: true,
      blockerCodes: guard.refusals.map((r) => r.code)
    });
    return cliResult({
      operation, status: STATUS.BLOCKED,
      mode: context.mode,
      blockers: guard.refusals.map((r) => ({
        code: r.code, stage: "correction-guard", severity: "blocking",
        message: `${r.what} ${r.why}`, recommendation: r.remedy,
        recaptureResolves: false, impossibleForInputKind: r.code.includes("ceiling") || r.code.includes("screenshot")
      })),
      summary: `the correction was refused by ${guard.refusals.length} guard(s)`,
      readiness: READINESS.NOT_USABLE,
      readinessReason: "Nothing was written. A correction that would launder evidence is refused before it is recorded, not after.",
      detail: { refusals: guard.refusals, browserLaunched: false }
    });
  }

  /* Preview first, then persist the proposal WITH what the preview found, so
   * the record carries its own impact and the promotion gate can read it. */
  const ws = new Workspace(workspace);
  const preview = previewCorrection({
    correction: record,
    raw: readRaw(ws, context),
    probe: readProbe(ws, context),
    existingCorrections: activeCorrections(workspace),
    meta: context.manifest ?? {},
    config: context.manifest?.config ?? {},
    currentIr: context.ir,
    currentFiles: context.files,
    allCorrections: readCorrections(workspace)
  });

  const enriched = {
    ...record,
    affectedProjections: preview.affectedProjections ?? [],
    affectedArtifacts: (preview.artifactsThatWillChange ?? []).map((a) => a.filename),
    previousIrHash: preview.hashes?.previousIrHash ?? null
  };
  const written = propose(workspace, enriched);

  /* Preview and apply are separate events on purpose: a correction that is
   * previewed and never accepted is a different signal from one that is
   * applied, and a single event covering both would hide the ratio. */
  correctionEvent(observabilityRoot(workspace), enriched, {
    eventClass: EVENT_CLASS.CORRECTION_PROPOSED,
    command: "correct",
    affectedArtifactCount: (preview.artifactsThatWillChange ?? []).length,
    automaticRefused: !guard.allowed || guard.automaticRefusals?.length > 0
  });

  return cliResult({
    operation, status: STATUS.COMPLETED,
    mode: context.mode,
    summary: `${record.id} proposed — ${preview.summary ?? "previewed"}`,
    readiness: READINESS.UNDETERMINED,
    readinessReason: "Proposed and previewed. Nothing has been applied; accepting is a separate, explicit step.",
    artifacts: [{ kind: "correction", path: written.file }],
    userActions: [{
      what: `Review the preview, then accept or reject ${record.id}.`,
      how: `bigaap correction accept ${record.id} --workspace ${workspace}  ·  bigaap correction reject ${record.id} --reason "<why>"`,
      field: "review"
    }],
    detail: {
      correction: enriched,
      preview,
      previewText: renderPreview(preview, record),
      mutated: false,
      browserLaunched: false
    }
  });
}

/* ------------------------------------------------- bigaap correction show */

export function cmdCorrectionShow({ workspace = null, id = null } = {}) {
  const operation = "correction-show";
  if (!workspace) return noWorkspace(operation);
  const all = readCorrections(workspace);
  const record = all.find((c) => c.id === id);
  if (!record) return notFound(operation, id, all);

  const events = historyOf(workspace, id);
  return cliResult({
    operation, status: STATUS.COMPLETED,
    summary: `${id} — ${record.reviewStatus}, ${record.scope}, ${events.length} event(s)`,
    readiness: READINESS.UNDETERMINED,
    readinessReason: "A record of a judgement. It licenses nothing on its own.",
    detail: { correction: record, events, historyText: renderHistory(events) }
  });
}

/* ----------------------------------------------- bigaap correction accept */

/**
 * Accepts and applies.
 *
 * Acceptance and application are one command because an accepted correction
 * that was not applied leaves the workspace disagreeing with its own history —
 * the record says accepted and the artifacts say otherwise.
 */
export function cmdCorrectionAccept({ workspace = null, id = null, allowEvidenceReduction = false, actor = null } = {}) {
  const operation = "correction-accept";
  if (!workspace) return noWorkspace(operation);

  const all = readCorrections(workspace);
  const record = all.find((c) => c.id === id);
  if (!record) return notFound(operation, id, all);

  const context = workspaceContext(workspace);
  const ws = new Workspace(workspace);

  const result = applyCorrection({
    correction: { ...record, reviewStatus: REVIEW_STATUS.ACCEPTED, acceptedAt: new Date().toISOString(), acceptedBy: actor },
    workspaceRoot: workspace,
    raw: readRaw(ws, context),
    probe: readProbe(ws, context),
    meta: context.manifest ?? {},
    config: context.manifest?.config ?? {},
    currentIr: context.ir,
    currentFiles: context.files,
    existingCorrections: activeCorrections(workspace).filter((c) => c.id !== id),
    write: (filename, content) => ws.writeText(filename, content),
    allowEvidenceReduction
  });

  if (!result.applied) {
    correctionEvent(observabilityRoot(workspace), record, {
      eventClass: EVENT_CLASS.CORRECTION_BLOCKED,
      command: "correction-accept",
      validationOutcome: result.reason,
      blockerCodes: [result.reason]
    });
    return cliResult({
      operation, status: STATUS.BLOCKED,
      mode: context.mode,
      blockers: [{
        code: result.reason, stage: "correction-apply", severity: "blocking",
        message: result.message, recommendation: result.remedy,
        recaptureResolves: false, impossibleForInputKind: false
      }],
      summary: result.summary,
      readiness: READINESS.NOT_USABLE,
      readinessReason: "Nothing was published. The previous artifacts are still the current ones and the correction is preserved as blocked.",
      detail: {
        steps: result.steps, failures: result.failures,
        previousArtifactsPreserved: true, nothingPublished: true,
        correctionPreserved: result.correctionPreserved, browserLaunched: false
      }
    });
  }

  correctionEvent(observabilityRoot(workspace), result.correction, {
    eventClass: EVENT_CLASS.CORRECTION_ACCEPTED,
    command: "correction-accept",
    validationOutcome: "passed",
    affectedArtifactCount: result.correction.affectedArtifacts.length
  });

  return cliResult({
    operation,
    status: result.promptsWithdrawn.length ? STATUS.COMPLETED_WITH_WARNINGS : STATUS.COMPLETED,
    mode: context.mode,
    warnings: result.promptsWithdrawn.map((p) => ({
      code: "prompt-withdrawn-by-lint",
      message: `${p.filename} was withdrawn after the correction (${p.rules.join(", ")}).`,
      recommendation: "Read output/blocked-prompt.md. The correction landed; the prompt it would have produced does not read honestly."
    })),
    hashes: { ir: result.correction.resultingIrHash },
    artifacts: result.correction.affectedArtifacts.map((path) => ({ kind: "artifact", path })),
    summary: result.summary,
    readiness: READINESS.USABLE_WITH_LIMITS,
    readinessReason: "The correction was applied and every regenerated artifact validated before anything was published.",
    detail: {
      steps: result.steps,
      modeDecision: result.modeDecision,
      previousIrHash: result.correction.previousIrHash,
      resultingIrHash: result.correction.resultingIrHash,
      previousArtifactHashes: result.correction.previousArtifactHashes,
      resultingArtifactHashes: result.correction.resultingArtifactHashes,
      browserLaunched: false
    }
  });
}

/* ----------------------------------------------- bigaap correction reject */

export function cmdCorrectionReject({ workspace = null, id = null, reason = null } = {}) {
  const operation = "correction-reject";
  if (!workspace) return noWorkspace(operation);
  if (!reason) {
    return missingInputResult(operation, [{
      field: "reason", ask: "Why are you rejecting it?", flag: "--reason",
      why: "A rejection with no reason cannot be reviewed, and the next person to notice the same thing will re-file it."
    }], workspace);
  }

  const all = readCorrections(workspace);
  const record = all.find((c) => c.id === id);
  if (!record) return notFound(operation, id, all);

  const written = storeReject(workspace, record, { reason });
  correctionEvent(observabilityRoot(workspace), written.record, {
    eventClass: EVENT_CLASS.CORRECTION_REJECTED,
    command: "correction-reject"
  });
  return cliResult({
    operation, status: STATUS.COMPLETED,
    summary: `${id} rejected`,
    readiness: READINESS.UNDETERMINED,
    readinessReason: "Nothing was applied. The record stays in history — a rejected correction is a decision, not a gap.",
    artifacts: [{ kind: "correction", path: written.file }],
    detail: { correction: written.record, historyPreserved: true, browserLaunched: false }
  });
}

/* ---------------------------------------------- bigaap correction promote */

export function cmdCorrectionPromote({ workspace = null, id = null, explicit = false, actor = null } = {}) {
  const operation = "correction-promote";
  if (!workspace) return noWorkspace(operation);

  const all = readCorrections(workspace);
  const record = all.find((c) => c.id === id);
  if (!record) return notFound(operation, id, all);

  const decision = evaluatePromotion({ correction: record, corrections: all, explicit, actor });

  if (!decision.promotable) {
    return cliResult({
      operation, status: STATUS.BLOCKED,
      blockers: decision.holds.map((h) => ({
        code: h.code, stage: "promotion-gate", severity: "blocking",
        message: h.why, recommendation: decision.whatWouldAllowIt ?? "See docs/PROMOTION.md.",
        recaptureResolves: false, impossibleForInputKind: false
      })),
      summary: `${id} is not promotable: ${decision.holds.map((h) => h.code).join(", ")}`,
      readiness: READINESS.NOT_USABLE,
      readinessReason: "The correction stays scoped to its own reference. Nothing was promoted and nothing was changed.",
      detail: {
        decision, decisionText: renderPromotionDecision(decision, record),
        sourceFactPreserved: true, browserLaunched: false
      }
    });
  }

  const rule = buildGlobalRule(record, { witnesses: decision.witnesses, promotedBy: actor });
  const written = storePromote(workspace, record, { by: actor, witnesses: decision.witnesses });

  return cliResult({
    operation, status: STATUS.COMPLETED,
    summary: `${id} promoted on ${decision.witnesses.independentReferences} independent reference(s)${explicit ? " and an explicit act" : ""}`,
    readiness: READINESS.USABLE_WITH_LIMITS,
    readinessReason: "A rule now cites this correction. The correction itself remains a fact about its own reference, and demoting the rule later leaves it untouched.",
    artifacts: [{ kind: "correction", path: written.file }],
    detail: { rule, decision, sourceFactPreserved: true, browserLaunched: false }
  });
}

/* ---------------------------------------------- bigaap correction history */

export function cmdCorrectionHistory({ workspace = null } = {}) {
  const operation = "correction-history";
  if (!workspace) return noWorkspace(operation);

  const events = readEvents(workspace);
  const corrections = readCorrections(workspace);
  const unreadable = events.filter((e) => e.$unreadable);

  return cliResult({
    operation,
    status: unreadable.length ? STATUS.COMPLETED_WITH_WARNINGS : STATUS.COMPLETED,
    warnings: unreadable.map((e) => ({
      code: "unreadable-history-event",
      message: `${e.$file} could not be parsed.`,
      recommendation: "A hole in an append-only history is worth investigating: the file is still there, so nothing was lost, but its contents cannot be read."
    })),
    summary: events.length
      ? `${corrections.length} correction(s), ${events.length} event(s)`
      : "no correction has been filed in this workspace",
    readiness: READINESS.UNDETERMINED,
    readinessReason: "A record of judgements. It licenses nothing on its own.",
    detail: {
      corrections, events, historyText: renderHistory(events),
      appendOnly: true, browserLaunched: false
    }
  });
}

/* -------------------------------------------------------------- helpers */

/**
 * Where correction events are written.
 *
 * The workspace's own store. A correction is filed against one workspace's
 * evidence, and its events belong beside that workspace rather than in whatever
 * directory the command happened to run from.
 */
const observabilityRoot = (workspace) => workspace ?? null;

function claimAt(ir, path) {
  if (!ir || !path) return null;
  return path.split(".").reduce((node, key) => {
    if (node == null) return null;
    const m = /^(\w+)\[(\d+)\]$/.exec(key);
    return m ? node[m[1]]?.[Number(m[2])] : node[key];
  }, ir);
}

/** Numbers arrive from argv as strings; a corrected `1200` must not be `"1200"`. */
function coerce(value) {
  if (typeof value !== "string") return value;
  if (/^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function readRaw(ws, context) {
  const name = context.manifest?.rawName ?? "extract-1440.json";
  return ws.exists("raw", name) ? ws.readJSON("raw", name) : null;
}
function readProbe(ws, context) {
  const name = context.manifest?.probeName ?? "probe-1440.json";
  return ws.exists("raw", name) ? ws.readJSON("raw", name) : null;
}

export { SCOPE, CORRECTION_CATEGORY, REVIEW_STATUS };

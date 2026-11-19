/**
 * The recording API commands use.
 *
 * Commands never build events by hand and never touch the store directly. They
 * call one of the helpers below, which build a well-formed event from data the
 * command already has — a `cliResult`, a correction record, a defect, a
 * recovery attempt.
 *
 * That indirection is what keeps the privacy boundary enforceable. A command
 * that cannot construct an arbitrary event cannot record an arbitrary value,
 * and the set of things that CAN be recorded is exactly the set of fields these
 * functions read.
 *
 * Every function is a no-op when observability is disabled, and every one
 * swallows its own errors. Diagnostics that can break the thing they are
 * diagnosing are worse than no diagnostics — a failed write must never turn a
 * completed analysis into a failed command.
 */

import { buildEvent, EVENT_CLASS, TIMEOUT_CATEGORY, bucketFor, TIMED_OPERATION } from "./event.mjs";
import { recordEvent, readConfig } from "./store.mjs";

/**
 * The modes an event may name.
 *
 * A field meant to be an enum must be clamped to that enum before it is
 * recorded. `mode` comes from `--for`, so an unrecognised value is whatever the
 * user typed — and `--for customer-list-page` would put a free-text string into
 * a field every reader treats as a fixed set. Anything outside the set is
 * recorded as `invalid`, which is the diagnosable part.
 */
const KNOWN_MODES = new Set(["analyze", "recreate", "adapt", "extend", "improve"]);
const safeMode = (mode) => (mode == null ? null : KNOWN_MODES.has(mode) ? mode : "invalid");

/**
 * Records an event, never throwing.
 *
 * The `try` is not defensive clutter. This runs alongside real work, and an
 * exception here would fail a command that had already succeeded — turning an
 * observability problem into an analysis problem, which is precisely backwards.
 */
export function safeRecord(root, event, options = {}) {
  if (!root) return { recorded: false, reason: "no observability root" };
  try {
    return recordEvent(root, event, options);
  } catch (error) {
    return { recorded: false, reason: `recording failed: ${error.message}`, threw: true };
  }
}

/** True when anything would be recorded at all. Cheap enough to call freely. */
export function isEnabled(root) {
  if (!root) return false;
  try { return readConfig(root).enabled === true; } catch { return false; }
}

/* ------------------------------------------------------------- commands */

/** A command beginning. Paired with `commandFinished` by the caller. */
export function commandStarted(root, { command, mode, projectId, workspaceId, sourceKind }, options = {}) {
  return safeRecord(root, buildEvent({
    eventClass: EVENT_CLASS.COMMAND_STARTED,
    command, mode: safeMode(mode), projectId, workspaceId, sourceKind
  }), options);
}

/**
 * A command ending, built from the result it already produced.
 *
 * Reads only codes, counts and ratios off the result. It never reads a message,
 * because a message can quote page content — a blocker's `code` is the
 * diagnosable part and its `message` is the part that might name a selector or
 * a heading.
 */
export function commandFinished(root, result, { command, projectId, workspaceId, durationMs = null, versions = {}, error = null, verboseErrors = false } = {}, options = {}) {
  const CLASS_FOR = {
    completed: EVENT_CLASS.COMMAND_COMPLETED,
    "completed-with-warnings": EVENT_CLASS.COMMAND_COMPLETED,
    blocked: EVENT_CLASS.COMMAND_BLOCKED,
    failed: EVENT_CLASS.COMMAND_FAILED,
    cancelled: EVENT_CLASS.COMMAND_CANCELLED,
    "not-attempted": EVENT_CLASS.COMMAND_COMPLETED,
    "requires-user-input": EVENT_CLASS.COMMAND_COMPLETED
  };

  const model = result?.detail?.readinessModel ?? null;
  return safeRecord(root, buildEvent({
    eventClass: CLASS_FOR[result?.status] ?? EVENT_CLASS.COMMAND_COMPLETED,
    command: command ?? result?.operation ?? null,
    mode: safeMode(result?.mode ?? null),
    projectId, workspaceId,
    sourceKind: model?.sourceKind ?? null,
    viewport: result?.viewport ?? null,
    state: result?.state ?? null,
    status: result?.status ?? null,
    durationMs,
    evidenceCoverage: model?.evidenceCoverage?.coverageFactor ?? null,
    confidenceSummary: summariseConfidence(model),
    /* Codes only, on every axis. A message can quote the page — a blocker
     * naming a selector, a warning naming a heading, an error echoing whatever
     * the driver said about the DOM. A code cannot. */
    blockerCodes: (result?.blockers ?? []).map((b) => b.code).filter(Boolean),
    warningCodes: (result?.warnings ?? []).map((w) => w.code).filter(Boolean),
    errorCodes: (result?.errors ?? []).map((e) => e.code).filter(Boolean),

    /* Only with `verboseErrors`, and even then: the exception's class and the
     * depth of its stack. Never the message, never a frame. */
    errorClass: verboseErrors && error ? (error.constructor?.name ?? "Error") : null,
    stackDepth: verboseErrors && error?.stack ? String(error.stack).split("\n").length : null,

    viewportCount: countOf(result, "viewports"),
    stateCount: countOf(result, "states"),
    artifactKinds: (result?.artifacts ?? []).map((a) => a.kind).filter(Boolean),
    artifactHashes: result?.hashes ?? {},
    ...versions
  }), options);
}

/**
 * How many viewports or states a run touched.
 *
 * A count, never the list: `[1440, 375]` is harmless, but the same field on a
 * different run could carry a state name derived from a selector.
 */
function countOf(result, key) {
  const model = result?.detail?.readinessModel ?? null;
  if (key === "viewports") {
    const byViewport = model?.evidenceCoverage?.byViewport ?? null;
    if (byViewport) return byViewport.length;
    return result?.viewport != null ? 1 : null;
  }
  const byState = model?.evidenceCoverage?.byState ?? null;
  return byState ? byState.length : null;
}

/**
 * Confidence as a shape rather than a table.
 *
 * Counts of measured and unmeasured categories plus a range. The per-category
 * numbers describe the analysis closely enough to be worth omitting: they are
 * a fingerprint of a specific page.
 */
function summariseConfidence(model) {
  const byCategory = model?.confidenceByCategory?.byCategory ?? null;
  if (!byCategory) return null;
  const values = Object.values(byCategory).filter((v) => typeof v === "number");
  if (!values.length) return { measuredCategories: 0, unmeasuredCategories: Object.keys(byCategory).length };
  return {
    measuredCategories: values.length,
    unmeasuredCategories: Object.keys(byCategory).length - values.length,
    min: Number(Math.min(...values).toFixed(2)),
    max: Number(Math.max(...values).toFixed(2))
  };
}

/* ---------------------------------------------------------- browser work */

export function browserOperationFailed(root, { command, operation, errorCategory, viewport, state, retryCount, timeoutCategory = TIMEOUT_CATEGORY.NONE, durationMs }, options = {}) {
  return safeRecord(root, buildEvent({
    eventClass: EVENT_CLASS.BROWSER_OPERATION_FAILED,
    command, operation, driverErrorCategory: errorCategory,
    viewport, state, retryCount, timeoutCategory, durationMs,
    status: "failed"
  }), options);
}

export function recoveryAttempted(root, { command, operation, attempt, status, errorCategory, retryCount, durationMs, viewport, state }, options = {}) {
  return safeRecord(root, buildEvent({
    eventClass: EVENT_CLASS.RECOVERY_ATTEMPTED,
    command, operation, status,
    driverErrorCategory: errorCategory,
    recoveryAttempts: attempt, retryCount, durationMs, viewport, state
  }), options);
}

/* ------------------------------------------------------------ artifacts */

export function artifactGenerated(root, { command, mode, kinds, hashes, workspaceId, durationMs }, options = {}) {
  return safeRecord(root, buildEvent({
    eventClass: EVENT_CLASS.ARTIFACT_GENERATED,
    command, mode: safeMode(mode), workspaceId,
    artifactKinds: kinds ?? [], artifactHashes: hashes ?? {},
    durationMs, operation: "projection", status: "completed"
  }), options);
}

export function artifactInvalidated(root, { command, kinds, reason, workspaceId }, options = {}) {
  return safeRecord(root, buildEvent({
    eventClass: EVENT_CLASS.ARTIFACT_INVALIDATED,
    command, workspaceId,
    artifactKinds: kinds ?? [],
    /* The reason is a code, not prose. */
    blockerCodes: reason ? [reason] : [],
    status: "invalidated"
  }), options);
}

/* ----------------------------------------------------------- corrections */

/**
 * A correction event, carrying its shape and none of its content.
 *
 * The claim path, the original value, the corrected value and the reason are
 * all omitted. What is recorded is the category, the scope, where it got to,
 * and what it cost — which is enough to see that source-classification
 * corrections are usually refused, and not enough to learn anything about a
 * page or a product.
 */
export function correctionEvent(root, correction, { eventClass, command, durationMs = null, validationOutcome = null, affectedArtifactCount = null, automaticRefused = null, blockerCodes = [] } = {}, options = {}) {
  return safeRecord(root, buildEvent({
    eventClass,
    command: command ?? "correction",
    workspaceId: correction?.workspaceId ?? null,
    sourceKind: correction?.sourceKind ?? null,
    correctionId: correction?.id ?? null,
    correctionCategory: correction?.category ?? null,
    correctionScope: correction?.scope ?? null,
    correctionReviewStatus: correction?.reviewStatus ?? null,
    correctionPromotionStatus: correction?.promotionStatus ?? null,
    automaticRefused,
    validationOutcome,
    affectedArtifactCount: affectedArtifactCount ?? (correction?.affectedArtifacts ?? []).length,
    beforeHash: correction?.previousIrHash ?? null,
    afterHash: correction?.resultingIrHash ?? null,
    durationMs,
    blockerCodes,
    status: correction?.reviewStatus ?? null
  }), options);
}

/* -------------------------------------------------------------- defects */

/**
 * A defect event.
 *
 * The module and severity are recorded; the observation and the reproducing
 * capture are not. Those are the fields that describe a real page or a real
 * failure in detail, and a defect record is the one place they legitimately
 * live — in the repository, not in a diagnostic export.
 */
export function defectDetected(root, defect, { command, readinessImpact = null } = {}, options = {}) {
  return safeRecord(root, buildEvent({
    eventClass: EVENT_CLASS.DEFECT_DETECTED,
    command,
    defectId: defect?.id ?? null,
    defectSeverity: defect?.severity ?? null,
    defectModule: defect?.module ?? null,
    defectStatus: defect?.promotionStatus ?? null,
    defectRecurrence: defect?.recurrenceCount ?? null,
    defectRegressionTest: defect?.regressionTest?.status ?? null,
    defectScope: defect?.scope ?? null,
    readinessImpact
  }), options);
}

export function readinessEvaluated(root, model, { command, durationMs = null } = {}, options = {}) {
  return safeRecord(root, buildEvent({
    eventClass: EVENT_CLASS.READINESS_EVALUATED,
    command: command ?? "readiness",
    mode: safeMode(model?.requestedMode ?? null),
    sourceKind: model?.sourceKind ?? null,
    status: model?.status ?? null,
    evidenceCoverage: model?.evidenceCoverage?.coverageFactor ?? null,
    confidenceSummary: summariseConfidence(model),
    blockerCodes: (model?.blockers ?? []).map((b) => b.code).filter(Boolean),
    warningCodes: (model?.warnings ?? []).map((w) => w.code).filter(Boolean),
    durationMs
  }), options);
}

/* --------------------------------------------------------------- timing */

/**
 * Times an operation and records the duration.
 *
 * Returns whatever the function returned. A timer that changed a caller's
 * return value would be a timer people work around rather than use.
 */
export function timed(root, operation, fn, { command = null, workspaceId = null } = {}, options = {}) {
  if (!TIMED_OPERATION.includes(operation)) {
    /* An unknown operation name is a typo, and a typo in a metric is a metric
     * that silently never appears. Better to notice at the call site. */
    throw new Error(`\`${operation}\` is not a timed operation; add it to TIMED_OPERATION if it should be`);
  }
  const started = Date.now();
  let status = "completed";
  try {
    return fn();
  } catch (error) {
    status = "failed";
    throw error;
  } finally {
    const durationMs = Date.now() - started;
    safeRecord(root, buildEvent({
      eventClass: status === "failed" ? EVENT_CLASS.COMMAND_FAILED : EVENT_CLASS.COMMAND_COMPLETED,
      command, workspaceId, operation, durationMs, status
    }), options);
  }
}

export { EVENT_CLASS, TIMEOUT_CATEGORY, bucketFor };

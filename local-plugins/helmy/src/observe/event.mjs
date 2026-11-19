/**
 * The local event model.
 *
 * Events exist to answer questions the maintainers cannot answer by reading the
 * code: which blockers actually fire, which driver errors actually happen,
 * whether recovery works, where the time goes, which corrections get refused.
 *
 * They are **local**. Nothing here uploads, and there is no code path that
 * could — the store writes files and the export command writes a file. That is
 * the whole surface.
 *
 * What an event carries is chosen by subtraction. Start from "what would make
 * this diagnosable", remove everything that describes the page rather than the
 * analysis, and what remains is shapes and counts: durations, coverage ratios,
 * blocker codes, error categories, artifact kinds, versions, hashes. An event
 * can tell you that captures against one origin time out twice as often as
 * another. It cannot tell you what either page said.
 */

import { randomUUID } from "node:crypto";
import { PRIVACY_CLASS } from "./redact.mjs";

/** Bumped when the event SHAPE changes. Migration reads this. */
export const EVENT_SCHEMA_VERSION = 1;

/** Every event class. Adding one is a deliberate act; the list is checked. */
export const EVENT_CLASS = Object.freeze({
  COMMAND_STARTED: "command-started",
  COMMAND_COMPLETED: "command-completed",
  COMMAND_BLOCKED: "command-blocked",
  COMMAND_FAILED: "command-failed",
  COMMAND_CANCELLED: "command-cancelled",
  BROWSER_OPERATION_FAILED: "browser-operation-failed",
  RECOVERY_ATTEMPTED: "recovery-attempted",
  ARTIFACT_GENERATED: "artifact-generated",
  ARTIFACT_INVALIDATED: "artifact-invalidated",
  CORRECTION_PROPOSED: "correction-proposed",
  CORRECTION_ACCEPTED: "correction-accepted",
  CORRECTION_REJECTED: "correction-rejected",
  CORRECTION_BLOCKED: "correction-blocked",
  DEFECT_DETECTED: "defect-detected",
  READINESS_EVALUATED: "readiness-evaluated"
});

export const ALL_EVENT_CLASSES = Object.freeze(Object.values(EVENT_CLASS));

/**
 * Which operations are timed.
 *
 * Durations are recorded as both a millisecond figure and a bucket. The bucket
 * is what makes a set of events comparable without the exact figure mattering,
 * and it is what an export keeps — a precise duration on a specific workspace
 * is closer to identifying than it looks.
 */
export const TIMED_OPERATION = Object.freeze([
  "preflight", "capture", "extraction", "evidence-building", "ir-derivation",
  "projection", "validation", "prompt-linting", "correction-preview",
  "correction-apply", "export"
]);

/** Duration buckets, in milliseconds. */
export const DURATION_BUCKETS = Object.freeze([
  { max: 50, label: "under-50ms" },
  { max: 250, label: "50-250ms" },
  { max: 1000, label: "250ms-1s" },
  { max: 5000, label: "1-5s" },
  { max: 30000, label: "5-30s" },
  { max: 120000, label: "30s-2m" },
  { max: Infinity, label: "over-2m" }
]);

export const bucketFor = (ms) =>
  typeof ms === "number" && Number.isFinite(ms)
    ? DURATION_BUCKETS.find((b) => ms < b.max).label
    : null;

/** Why an operation stopped waiting. */
export const TIMEOUT_CATEGORY = Object.freeze({
  NONE: "none",
  OPERATION: "operation-timeout",
  NAVIGATION: "navigation-timeout",
  SETTLE: "settle-timeout",
  OVERALL: "overall-timeout"
});

/**
 * Builds an event.
 *
 * Every field the phase names appears, and absent ones are `null` rather than
 * omitted: an event whose keys vary by call site cannot be queried, and the
 * whole point of writing them is to be able to ask questions later.
 *
 * Nothing here redacts. The store redacts on write, so there is exactly one
 * place where a value can escape and exactly one place to check.
 */
export function buildEvent({
  eventClass,
  command = null,
  mode = null,
  projectId = null,
  workspaceId = null,
  sourceKind = null,
  viewport = null,
  state = null,
  status = null,
  durationMs = null,
  operation = null,
  evidenceCoverage = null,
  confidenceSummary = null,
  blockerCodes = [],
  warningCodes = [],
  errorCodes = [],
  /* Set only when `verboseErrors` is on. The class name and the stack DEPTH —
   * never the message and never a frame. A message can quote page text and a
   * frame carries a filesystem path; a depth is a number. */
  errorClass = null,
  stackDepth = null,
  viewportCount = null,
  stateCount = null,
  driverErrorCategory = null,
  recoveryAttempts = null,
  retryCount = null,
  timeoutCategory = TIMEOUT_CATEGORY.NONE,
  artifactKinds = [],
  artifactHashes = {},
  correctionId = null,
  correctionCategory = null,
  correctionScope = null,
  correctionReviewStatus = null,
  correctionPromotionStatus = null,
  automaticRefused = null,
  validationOutcome = null,
  affectedArtifactCount = null,
  beforeHash = null,
  afterHash = null,
  defectId = null,
  defectSeverity = null,
  defectModule = null,
  defectStatus = null,
  defectRecurrence = null,
  defectRegressionTest = null,
  defectScope = null,
  readinessImpact = null,
  extractorVersion = null,
  driverVersion = null,
  toleranceVersion = null,
  policyVersion = null,
  at = new Date().toISOString()
} = {}) {
  return {
    schemaVersion: EVENT_SCHEMA_VERSION,
    eventId: randomUUID(),
    at,
    eventClass,

    command,
    mode,
    projectId,
    workspaceId,
    sourceKind,
    viewport,
    state,
    status,

    operation,
    durationMs,
    durationBucket: bucketFor(durationMs),
    timeoutCategory,
    retryCount,

    evidenceCoverage,
    confidenceSummary,
    blockerCodes: [...blockerCodes],
    warningCodes: [...warningCodes],
    errorCodes: [...errorCodes],
    errorClass,
    stackDepth,
    viewportCount,
    stateCount,
    driverErrorCategory,
    recoveryAttempts,

    artifactKinds: [...artifactKinds],
    artifactHashes: { ...artifactHashes },

    correctionId,
    correctionCategory,
    correctionScope,
    correctionReviewStatus,
    correctionPromotionStatus,
    automaticRefused,
    validationOutcome,
    affectedArtifactCount,
    beforeHash,
    afterHash,

    defectId,
    defectSeverity,
    defectModule,
    defectStatus,
    defectRecurrence,
    defectRegressionTest,
    defectScope,

    readinessImpact,

    extractorVersion,
    driverVersion,
    toleranceVersion,
    policyVersion,

    /* Set by the store after redaction, so an event on disk always says how
     * protected it is rather than leaving a reader to infer it. */
    privacyClassification: PRIVACY_CLASS.METADATA
  };
}

/**
 * Validates an event's shape.
 *
 * Structural only, and deliberately strict about the fields a query would
 * depend on. An event missing `eventClass` is not a slightly-worse event; it is
 * unqueryable and therefore worthless.
 */
export function validateEvent(event) {
  const errors = [];
  const add = (field, message) => errors.push({ field, message });

  if (!event || typeof event !== "object") {
    return { valid: false, errors: [{ field: null, message: "not an event object" }] };
  }
  if (event.schemaVersion !== EVENT_SCHEMA_VERSION) {
    add("schemaVersion", `expected ${EVENT_SCHEMA_VERSION}, got ${event.schemaVersion}`);
  }
  if (!event.eventId) add("eventId", "required");
  if (!event.at || Number.isNaN(Date.parse(event.at))) add("at", "must be an ISO timestamp");
  if (!ALL_EVENT_CLASSES.includes(event.eventClass)) {
    add("eventClass", `\`${event.eventClass}\` is not an event class`);
  }
  for (const field of ["blockerCodes", "warningCodes", "errorCodes", "artifactKinds"]) {
    if (!Array.isArray(event[field])) add(field, "must be an array");
  }
  if (event.evidenceCoverage != null && (event.evidenceCoverage < 0 || event.evidenceCoverage > 1)) {
    add("evidenceCoverage", "must be a ratio in [0,1] or null");
  }
  if (event.timeoutCategory && !Object.values(TIMEOUT_CATEGORY).includes(event.timeoutCategory)) {
    add("timeoutCategory", `\`${event.timeoutCategory}\` is not a timeout category`);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Migrates an event written under an older schema.
 *
 * Returns the migrated event and what was done. An event that cannot be
 * migrated is returned untouched with `migrated: false` — dropping it would be
 * the append-only store deleting history to tidy up, which is the one thing it
 * must not do.
 */
export function migrateEvent(event) {
  if (!event || typeof event !== "object") {
    return { event, migrated: false, reason: "not an event object" };
  }
  if (event.schemaVersion === EVENT_SCHEMA_VERSION) {
    return { event, migrated: false, reason: "already current" };
  }
  if (typeof event.schemaVersion !== "number" || event.schemaVersion > EVENT_SCHEMA_VERSION) {
    return {
      event,
      migrated: false,
      reason: `schema version ${event.schemaVersion} is newer than this build understands (${EVENT_SCHEMA_VERSION}); it is kept unchanged rather than downgraded`
    };
  }

  /* Version 0 predates `durationBucket`, `timeoutCategory` and the correction
   * fields. Filling them with nulls is lossless: the event never had them, and
   * null says exactly that. */
  const migrated = {
    ...buildEvent({ eventClass: event.eventClass ?? EVENT_CLASS.COMMAND_COMPLETED, at: event.at }),
    ...event,
    schemaVersion: EVENT_SCHEMA_VERSION,
    durationBucket: event.durationBucket ?? bucketFor(event.durationMs ?? null),
    timeoutCategory: event.timeoutCategory ?? TIMEOUT_CATEGORY.NONE,
    $migratedFrom: event.schemaVersion ?? "unversioned"
  };
  return { event: migrated, migrated: true, reason: `migrated from schema ${event.schemaVersion ?? "unversioned"}` };
}

export { PRIVACY_CLASS };

/**
 * The correction record.
 *
 * A correction is the one place a person's judgement enters a system that
 * otherwise only reports what it measured. That makes it the most dangerous
 * write in the codebase, and the shape below is built around a single
 * constraint: **a correction adds a claim, it never removes an observation.**
 *
 * Concretely, that means the record carries both sides of everything. The
 * original value and the corrected one. The original status and the corrected
 * one. The evidence that backed the original and the evidence offered for the
 * replacement. The IR hash before and the IR hash after. A record that carried
 * only the new value would be indistinguishable from a measurement, and the
 * whole point of a correction is that it is not one.
 *
 * Nothing here deletes. Superseding is how a correction retires an earlier one,
 * and a superseded record stays in history with a pointer to what replaced it —
 * so "why does this say 24px when the page says 22px" always has an answer, and
 * the answer includes who decided and why.
 */

import { createHash } from "node:crypto";

/** What kind of judgement is being recorded. */
export const CORRECTION_CATEGORY = Object.freeze({
  /** The measured value was wrong. */
  FACTUAL_CLAIM: "factual-claim",
  /** The measurement was right; what it was taken to mean was not. */
  EVIDENCE_INTERPRETATION: "evidence-interpretation",
  /** The evidence was attributed to the wrong kind of source. */
  SOURCE_CLASSIFICATION: "source-classification",
  /** Two things were treated as one component, or one as two. */
  COMPONENT_IDENTITY: "component-identity",
  /** A selector was classified as more or less stable than it is. */
  SELECTOR_CLASSIFICATION: "selector-classification",
  /** A token was assigned the wrong role. */
  TOKEN_ROLE: "token-role",
  /** The analysed region was not the intended one. */
  REGION: "region",
  /** The confidence attached to a claim does not match what backs it. */
  CONFIDENCE: "confidence",
  /** A standing choice for this reference, not a claim about it. */
  REFERENCE_PREFERENCE: "reference-scoped-preference",
  /** A standing choice for the project. */
  PROJECT_PREFERENCE: "project-preference",
  /** Offered as a rule that might hold beyond this reference. */
  GLOBAL_RULE_CANDIDATE: "global-rule-candidate"
});

export const ALL_CATEGORIES = Object.freeze(Object.values(CORRECTION_CATEGORY));

/**
 * How far a correction reaches.
 *
 * The ordering matters and it is deliberately hard to climb. A fact about one
 * page becoming a universal rule is the failure mode that turns a forensic tool
 * into a style guide with opinions, and it happens one reasonable-looking
 * promotion at a time.
 */
export const SCOPE = Object.freeze({
  REFERENCE: "reference",
  WORKSPACE: "workspace",
  PROJECT: "project",
  PREFERENCE: "preference",
  GLOBAL_CANDIDATE: "global-candidate"
});

export const ALL_SCOPES = Object.freeze(Object.values(SCOPE));

/** Where a correction stands. */
export const REVIEW_STATUS = Object.freeze({
  PROPOSED: "proposed",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  SUPERSEDED: "superseded",
  /** Re-derivation or validation failed; the record is kept, nothing published. */
  BLOCKED: "blocked"
});

export const ALL_REVIEW_STATUSES = Object.freeze(Object.values(REVIEW_STATUS));

/** How far a correction has travelled toward being a rule. */
export const PROMOTION_STATUS = Object.freeze({
  REFERENCE_SCOPED: "reference-scoped",
  PROJECT_SCOPED: "project-scoped",
  GLOBAL_CANDIDATE: "global-candidate",
  PROMOTED: "promoted",
  /** Was promoted, and has since been withdrawn. Never deleted. */
  DEMOTED: "demoted"
});

export const ALL_PROMOTION_STATUSES = Object.freeze(Object.values(PROMOTION_STATUS));

/** Two independent references before anything becomes a rule. */
export const PROMOTION_THRESHOLD = 2;

/**
 * The next id for a workspace, derived only from that workspace's own records.
 *
 * Deliberately NOT a module-level counter. A shared counter makes an id depend
 * on unrelated work done earlier in the same process, so the first correction
 * in a fresh workspace can come out as `corr_0007` — which is confusing on its
 * own and actively wrong when two workspaces are open at once, because the ids
 * interleave and neither is contiguous.
 *
 * Pure derivation costs a read and makes the id reproducible: the same
 * workspace always produces the same next id.
 */
export function nextCorrectionId(existing = []) {
  let max = 0;
  for (const record of existing) {
    const n = Number.parseInt(String(record?.id ?? "").replace("corr_", ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `corr_${String(max + 1).padStart(4, "0")}`;
}

/**
 * Builds a proposed correction.
 *
 * Everything optional defaults to `null` rather than being omitted. An absent
 * key reads as "the writer forgot"; an explicit null says "this does not apply
 * here", and for a record that exists to be audited later the difference is the
 * whole value of the field.
 */
export function buildCorrection({
  id,
  workspaceId,
  referenceId,
  claim,
  category,
  scope = SCOPE.REFERENCE,
  originalValue = null,
  correctedValue = null,
  originalStatus = null,
  correctedStatus = null,
  originalEvidenceIds = [],
  replacementEvidenceIds = [],
  sourceKind = null,
  reason,
  author = null,
  createdAt = new Date().toISOString(),
  previousIrHash = null,
  supersedes = null,
  correctionOfEarlierRecord = null
} = {}) {
  return {
    $schemaVersion: "2",
    id,
    createdAt,
    author,
    workspaceId,
    referenceId,
    claim,
    category,
    scope,

    /* Both sides of every pair. A record carrying only the new value would be
     * indistinguishable from a measurement. */
    original: { value: originalValue, status: originalStatus, evidence: [...originalEvidenceIds] },
    corrected: { value: correctedValue, status: correctedStatus, evidence: [...replacementEvidenceIds] },
    sourceKind,
    reason,

    recurrenceCount: 1,
    promotionStatus: scope === SCOPE.PROJECT ? PROMOTION_STATUS.PROJECT_SCOPED : PROMOTION_STATUS.REFERENCE_SCOPED,
    promotedAt: null,
    promotedBy: null,
    demotedAt: null,

    affectedProjections: [],
    affectedArtifacts: [],
    previousIrHash,
    resultingIrHash: null,
    previousArtifactHashes: {},
    resultingArtifactHashes: {},

    reviewStatus: REVIEW_STATUS.PROPOSED,
    acceptedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    blockedReason: null,

    supersedes,
    supersededBy: null,
    /* Set when a LATER record corrects this record's own diagnosis, as opposed
     * to superseding its value. The two are different: one says "the previous
     * fix was wrong about the page", the other says "the previous fix was wrong
     * about what was wrong". */
    correctionOfEarlierRecord
  };
}

/** A stable fingerprint of what a correction asserts, for recurrence counting. */
export function correctionFingerprint(correction) {
  const parts = [
    correction.claim,
    correction.category,
    JSON.stringify(correction.corrected?.value ?? null),
    correction.corrected?.status ?? null
  ].join("|");
  return createHash("sha256").update(parts).digest("hex").slice(0, 16);
}

/**
 * Marks a record superseded without removing anything.
 *
 * Returns a new object. The store is append-only, so the caller writes both the
 * updated predecessor and the successor — a record that changed in place would
 * leave no trace that it once said something else.
 */
export function supersede(record, bySuccessorId, at = new Date().toISOString()) {
  return {
    ...record,
    reviewStatus: REVIEW_STATUS.SUPERSEDED,
    supersededBy: bySuccessorId,
    supersededAt: at
  };
}

/** The fields a non-interactive correction must supply, with why each matters. */
export const REQUIRED_INPUTS = Object.freeze([
  { field: "claim", why: "Which claim is wrong. Without it there is nothing to correct." },
  { field: "category", why: "What kind of judgement this is. It decides which guards apply." },
  { field: "correctedValue", why: "What it should say. A correction with no corrected value is a complaint." },
  { field: "reason", why: "Why. A correction with no reason cannot be reviewed, and review is the whole point." }
]);

/**
 * Checks a proposed record on its own terms.
 *
 * Structural only. Whether the correction is SAFE is `guard.mjs`, and whether
 * it can be promoted is `promotion.mjs` — keeping them apart means an error
 * names one thing.
 */
export function validateCorrection(record) {
  const errors = [];
  const add = (field, message, remedy) => errors.push({ field, message, remedy });

  if (!record || typeof record !== "object") {
    return { valid: false, errors: [{ field: null, message: "not a correction record", remedy: "Build it with buildCorrection()." }] };
  }
  for (const { field, why } of REQUIRED_INPUTS) {
    const value = field === "correctedValue" ? record.corrected?.value : record[field];
    if (value === undefined || value === null || value === "") {
      add(field, `\`${field}\` is required.`, why);
    }
  }
  if (record.category && !ALL_CATEGORIES.includes(record.category)) {
    add("category", `\`${record.category}\` is not a correction category.`,
      `Use one of: ${ALL_CATEGORIES.join(", ")}.`);
  }
  if (record.scope && !ALL_SCOPES.includes(record.scope)) {
    add("scope", `\`${record.scope}\` is not a scope.`, `Use one of: ${ALL_SCOPES.join(", ")}.`);
  }
  if (record.reviewStatus && !ALL_REVIEW_STATUSES.includes(record.reviewStatus)) {
    add("reviewStatus", `\`${record.reviewStatus}\` is not a review status.`,
      `Use one of: ${ALL_REVIEW_STATUSES.join(", ")}.`);
  }
  if (record.promotionStatus && !ALL_PROMOTION_STATUSES.includes(record.promotionStatus)) {
    add("promotionStatus", `\`${record.promotionStatus}\` is not a promotion status.`,
      `Use one of: ${ALL_PROMOTION_STATUSES.join(", ")}.`);
  }
  /* The original side must be recorded even when it was empty: "there was no
   * value here" is itself the thing a reviewer needs to know. */
  if (!record.original || !("value" in record.original)) {
    add("original", "the original value was not recorded.",
      "A correction that does not say what it replaced cannot be reviewed, and cannot be undone.");
  }
  if (record.scope === SCOPE.GLOBAL_CANDIDATE && record.promotionStatus === PROMOTION_STATUS.PROMOTED) {
    add("promotionStatus", "a candidate cannot also be promoted.",
      "Promotion is a separate, explicit step. See docs/PROMOTION.md.");
  }
  return { valid: errors.length === 0, errors };
}

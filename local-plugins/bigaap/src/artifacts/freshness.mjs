/**
 * Artifact freshness — whether a file still describes the thing it was made from.
 *
 * The rule this module exists to enforce: **a stale artifact is never silently
 * regenerated.** Silent regeneration is attractive and wrong. It looks like
 * helpfulness and behaves like data loss — the reader asked why the prompt said
 * 16px, and the answer "it doesn't any more" tells them nothing about why it
 * ever did. Worse, regenerating an implementation prompt can change what
 * somebody is being told to build, without them having asked for that.
 *
 * So staleness is *reported*: what moved, whether re-deriving is safe, and the
 * original left untouched.
 *
 * Three hashes are tracked separately because they answer different questions,
 * and collapsing them would lose the answer:
 *
 *   - **IR** moved      → what we concluded about the page changed.
 *   - **evidence** moved → what we observed changed, which is more serious.
 *   - **configuration** moved → the same observations judged by different
 *     rules. The page did not change; the question did.
 */

import { createHash } from "node:crypto";
import { serializeStable } from "./serialize.mjs";
import { findArtifact, STALE_BEHAVIOR } from "./registry.mjs";

/** Why an artifact is out of date. */
export const STALENESS = Object.freeze({
  IR_HASH: "stale-ir-hash",
  EVIDENCE_HASH: "stale-evidence-hash",
  CONFIGURATION_HASH: "stale-configuration-hash",
  EXTRACTOR_VERSION: "incompatible-extractor-version",
  TOLERANCE_VERSION: "incompatible-tolerance-version"
});

export const FRESHNESS = Object.freeze({
  /** Everything it was made from is still current. */
  FRESH: "fresh",
  /** A source moved. Re-deriving is possible; whether it is wise depends. */
  STALE: "stale",
  /**
   * A version difference, not a content difference. Re-deriving would not
   * reconcile it, because the two were produced by tools that do not measure
   * the same things.
   */
  INCOMPATIBLE: "incompatible",
  /** Not enough metadata to tell. Distinct from fresh, and from stale. */
  UNDETERMINED: "undetermined"
});

/**
 * Content hash of anything, over deterministic JSON.
 *
 * Uses the stable serializer so key order cannot move a hash. A hash over
 * insertion order would report drift that is not there, which trains a reader
 * to ignore staleness reports — the worst outcome available here.
 */
export function contentHash(value) {
  if (value === null || value === undefined) return null;
  return createHash("sha256").update(serializeStable(value, { trailingNewline: false })).digest("hex").slice(0, 16);
}

/** The three hashes a run stamps onto everything it writes. */
export function hashSources({ ir = null, evidence = null, configuration = null } = {}) {
  return {
    irHash: contentHash(ir),
    evidenceHash: contentHash(evidence),
    configurationHash: contentHash(configuration)
  };
}

const REASON_TEXT = Object.freeze({
  [STALENESS.IR_HASH]: {
    what: "The IR this was projected from has changed.",
    means: "What the analysis concluded about the reference is different now."
  },
  [STALENESS.EVIDENCE_HASH]: {
    what: "The evidence map has changed.",
    means: "What was observed is different — a stronger reason to distrust this file than a changed conclusion."
  },
  [STALENESS.CONFIGURATION_HASH]: {
    what: "The resolved configuration has changed.",
    means: "The same observations are now being judged by different rules. The page did not move; the question did."
  },
  [STALENESS.EXTRACTOR_VERSION]: {
    what: "A different extractor version produced the current evidence.",
    means: "This is not staleness. The two runs do not measure the same things, so re-deriving would not reconcile them."
  },
  [STALENESS.TOLERANCE_VERSION]: {
    what: "A different tolerance table is in force.",
    means: "Comparisons made under the old table cannot be read beside ones made under the new."
  }
});

/**
 * Checks one artifact's metadata against what is current.
 *
 * `current` supplies whichever of the hashes and versions are known. A field
 * absent from `current` is not checked — it is not evidence of freshness, and
 * treating "we didn't look" as "it matches" is how a stale file gets used.
 */
export function checkFreshness(metadata, current = {}) {
  const def = metadata?.artifactKind ? findArtifact(metadata.artifactKind) : null;

  if (!metadata) {
    return {
      verdict: FRESHNESS.UNDETERMINED,
      reasons: [],
      safeToRegenerate: false,
      summary: "No metadata, so freshness cannot be established. That is not the same as fresh.",
      artifactKind: null
    };
  }

  const reasons = [];
  const compare = (field, currentKey, code) => {
    const was = metadata[field];
    const now = current[currentKey];
    if (was == null || now == null) return;
    if (was !== now) reasons.push({ code, field, was, now, ...REASON_TEXT[code] });
  };

  compare("irHash", "irHash", STALENESS.IR_HASH);
  compare("evidenceHash", "evidenceHash", STALENESS.EVIDENCE_HASH);
  compare("configurationHash", "configurationHash", STALENESS.CONFIGURATION_HASH);
  compare("extractorVersion", "extractorVersion", STALENESS.EXTRACTOR_VERSION);
  compare("toleranceVersion", "toleranceVersion", STALENESS.TOLERANCE_VERSION);

  /* Nothing to compare against is undetermined, not fresh. An artifact whose
   * required hashes were never stamped cannot be vouched for. */
  const checkable = ["irHash", "evidenceHash", "configurationHash", "extractorVersion", "toleranceVersion"]
    .some((f) => metadata[f] != null && current[f] != null);
  if (!reasons.length) {
    return checkable
      ? { verdict: FRESHNESS.FRESH, reasons: [], safeToRegenerate: true, summary: "Every source this was made from is still current.", artifactKind: metadata.artifactKind }
      : {
          verdict: FRESHNESS.UNDETERMINED,
          reasons: [],
          safeToRegenerate: false,
          summary: "Nothing could be compared: the artifact carries no hashes that the current run also has.",
          artifactKind: metadata.artifactKind
        };
  }

  const incompatible = reasons.some((r) =>
    r.code === STALENESS.EXTRACTOR_VERSION || r.code === STALENESS.TOLERANCE_VERSION);

  /* Whether regeneration is SAFE is a property of the artifact, not of how it
   * went stale. Re-deriving a coverage report changes a description; re-deriving
   * a build prompt changes what somebody is told to build. */
  const behavior = def?.staleBehavior ?? STALE_BEHAVIOR.REGENERATE_NEEDS_REVIEW;
  const safeToRegenerate = !incompatible && behavior === STALE_BEHAVIOR.REGENERATE_SAFE;

  return {
    verdict: incompatible ? FRESHNESS.INCOMPATIBLE : FRESHNESS.STALE,
    reasons,
    safeToRegenerate,
    staleBehavior: behavior,
    artifactKind: metadata.artifactKind,
    summary: incompatible
      ? `${metadata.artifactKind} was produced under a different tool version; it is not comparable, not merely old.`
      : `${metadata.artifactKind} is out of date: ${reasons.map((r) => r.field).join(", ")} moved.`,
    recommendation: recommendationFor({ behavior, incompatible, def })
  };
}

function recommendationFor({ behavior, incompatible, def }) {
  if (incompatible) {
    return "Re-run the capture with the current tool. Regenerating from the stored IR would produce a file that claims a version it was not made under.";
  }
  if (behavior === STALE_BEHAVIOR.PRESERVE_ONLY) {
    return "Nothing to do. This is a historical record; it is supposed to describe the past.";
  }
  if (behavior === STALE_BEHAVIOR.REGENERATE_SAFE) {
    return "Regenerating reproduces it from the current source. The existing file is preserved either way.";
  }
  return `Read the change before regenerating. ${def?.isImplementationPrompt ? "This artifact instructs someone to build something, and re-deriving it can change those instructions." : "Re-deriving may change conclusions this file states."}`;
}

/**
 * Given a source change, names every artifact affected by it.
 *
 * The question a person actually asks after a re-capture is not "is this one
 * file stale" but "what do I now have to look at". Answering it one file at a
 * time makes them do the join.
 */
export function affectedByChange({ artifacts = [], current = {} } = {}) {
  const affected = [];
  const fresh = [];
  const undetermined = [];

  for (const { filename, metadata } of artifacts) {
    const check = checkFreshness(metadata, current);
    const record = { filename, artifactKind: metadata?.artifactKind ?? null, ...check };
    if (check.verdict === FRESHNESS.FRESH) fresh.push(record);
    else if (check.verdict === FRESHNESS.UNDETERMINED) undetermined.push(record);
    else affected.push(record);
  }

  return {
    affected,
    fresh,
    undetermined,
    /* Split by what a reader can act on without thinking hard, versus what
     * needs a decision. */
    safeToRegenerate: affected.filter((a) => a.safeToRegenerate),
    needsReview: affected.filter((a) => !a.safeToRegenerate),
    summary: affected.length
      ? `${affected.length} artifact(s) affected; ${affected.filter((a) => a.safeToRegenerate).length} can be regenerated without review.`
      : "No artifact is affected by this change."
  };
}

/**
 * The gate in front of every workflow that CONSUMES an artifact.
 *
 * Reading a stale file is how a wrong value travels: into a correction task,
 * into a fidelity comparison, into another project. The check belongs at the
 * boundary where an artifact stops being output and becomes input.
 */
export const CONSUMER = Object.freeze({
  WORKFLOW_INPUT: "workflow-input",
  COPY_TO_PROJECT: "copy-to-project",
  CORRECTION_TASKS: "correction-tasks",
  FIDELITY_COMPARISON: "fidelity-comparison",
  EXPORT: "export"
});

export function assertUsable({ metadata, current = {}, consumer, filename = null }) {
  const check = checkFreshness(metadata, current);
  if (check.verdict === FRESHNESS.FRESH) return { usable: true, check };

  return {
    usable: false,
    check,
    refusal: {
      code: check.verdict === FRESHNESS.INCOMPATIBLE ? "artifact-incompatible" : `artifact-${check.verdict}`,
      consumer,
      filename,
      message: `${filename ?? metadata?.artifactKind ?? "artifact"} cannot be used as input to ${consumer}: ${check.summary}`,
      remedy: check.recommendation ?? "Establish what this file was made from before using it.",
      /* Named explicitly so a caller cannot read a refusal as permission to
       * fix the problem by overwriting the evidence of it. */
      preservesOriginal: true
    }
  };
}

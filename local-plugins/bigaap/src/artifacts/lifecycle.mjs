/**
 * Artifact lifecycle — what happens to a file between runs.
 *
 * The governing rule is asymmetric on purpose:
 *
 *   **Current output may be pruned. History may never be.**
 *
 * Pruning current output is sometimes mandatory. When a re-run is refused by
 * the safety gate, the rebuild prompt from the previous run is still sitting in
 * `output/`, and it is now the most dangerous file in the directory — it reads
 * exactly as authoritative as it did yesterday, sitting next to a report
 * explaining why this analysis was refused. Someone will open the prompt.
 *
 * But a removal that leaves no trace is indistinguishable from a file that was
 * never written, and that difference is the whole story: "we refused, and here
 * is what we withdrew" versus "there is nothing here". So every prune writes a
 * history record naming the file, its hash, why it went, and where its content
 * is preserved.
 *
 * Nothing in this module deletes a history record, under any circumstance.
 */

import { findArtifact, artifactsForMode, BLOCKED_BEHAVIOR, prunedWhenBlocked, mayProduce, DEFINITION_STATUS } from "./registry.mjs";
import { readStamp } from "../ir/hash.mjs";
import { readMetadata } from "./metadata.mjs";
import { serializeStable } from "./serialize.mjs";
import { contentHash } from "./freshness.mjs";

/** Everything that can happen to an artifact. */
export const LIFECYCLE = Object.freeze({
  GENERATED: "generated",
  REGENERATED: "regenerated",
  REPLACED: "replaced",
  PRUNED: "pruned",
  BLOCKED: "blocked",
  PRESERVED: "preserved",
  EXPORTED: "exported",
  GENERATION_FAILED: "generation-failed",
  GENERATION_CANCELLED: "generation-cancelled",
  MANUAL_EDIT_DETECTED: "manual-edit-detected"
});

/** Why an artifact was removed from current output. */
export const PRUNE_REASON = Object.freeze({
  SAFETY_GATE: "safety-gate-refused-run",
  MODE_CHANGED: "mode-no-longer-produces-it",
  SOURCE_KIND_CHANGED: "source-kind-no-longer-supports-it"
});

/**
 * Plans a run's output before anything is written.
 *
 * Returns what to write, what to remove, and what to leave alone — as data, so
 * the plan can be inspected, tested and reported without a filesystem. A
 * function that decides and writes in one step can only be tested by letting it
 * write.
 */
export function planGeneration({
  mode,
  sourceKind = "url",
  blocked = false,
  existing = [],
  requested = null
} = {}) {
  const eligible = artifactsForMode(mode)
    .filter((def) => def.definitionStatus === DEFINITION_STATUS.IMPLEMENTED)
    .filter((def) => mayProduce({ kind: def.kind, mode, sourceKind, blocked }).allowed);

  const write = eligible
    .filter((def) => (requested ? requested.includes(def.kind) || def.requiredForModes.includes(mode) : true))
    .map((def) => ({
      kind: def.kind,
      filename: blocked && def.blockedFilename ? def.blockedFilename : def.filename,
      required: def.requiredForModes.includes(mode),
      reason: blocked && def.blockedFilename
        ? "written under a name that cannot be mistaken for a complete artifact"
        : "produced by this mode from this kind of evidence"
    }));

  /* What is on disk that this run must not leave standing. Two causes, kept
   * apart because they mean different things to whoever reads the report. */
  const prune = [];
  const writtenNames = new Set(write.map((w) => w.filename));

  for (const file of existing) {
    const def = findArtifact(file.filename ?? file);
    const filename = file.filename ?? file;
    if (!def) continue;
    if (writtenNames.has(filename)) continue;

    if (blocked && def.blockedBehavior === BLOCKED_BEHAVIOR.PRUNE) {
      prune.push({
        kind: def.kind,
        filename,
        reason: PRUNE_REASON.SAFETY_GATE,
        why: `${def.kind} is an implementation instruction and this run was refused. Leaving it would put build instructions next to the explanation of why they are not supported.`
      });
      continue;
    }
    if (!def.producingModes.includes(mode)) {
      prune.push({
        kind: def.kind,
        filename,
        reason: PRUNE_REASON.MODE_CHANGED,
        why: `${def.kind} belongs to ${def.producingModes.join(", ")}, and this run is \`${mode}\`. It is from an earlier run under a different mode.`
      });
      continue;
    }
    if ((def.forbiddenSourceKinds ?? []).includes(sourceKind)) {
      prune.push({
        kind: def.kind,
        filename,
        reason: PRUNE_REASON.SOURCE_KIND_CHANGED,
        why: `${def.kind} cannot be supported by ${sourceKind} evidence, and this run used ${sourceKind}.`
      });
    }
  }

  const preserve = existing
    .map((f) => f.filename ?? f)
    .filter((f) => !prune.some((p) => p.filename === f) && !writtenNames.has(f));

  return {
    mode,
    sourceKind,
    blocked,
    write,
    prune,
    preserve,
    /* Stated rather than implied: a caller must be able to assert it. */
    historyPreserved: true,
    summary: [
      `${write.length} artifact(s) to write`,
      prune.length ? `${prune.length} to withdraw` : null,
      preserve.length ? `${preserve.length} left as-is` : null
    ].filter(Boolean).join(", ")
  };
}

/**
 * Turns a prune plan into history records.
 *
 * The record carries the content hash rather than the content: history holds
 * the previous iteration's copy of the file already, so duplicating the body
 * here would double every prompt in the run directory. The hash is what makes
 * the two provably the same file.
 */
export function recordPrune({ prune = [], iteration = null, at = new Date().toISOString(), contents = {} } = {}) {
  return prune.map((p) => ({
    event: LIFECYCLE.PRUNED,
    artifactKind: p.kind,
    filename: p.filename,
    reason: p.reason,
    why: p.why,
    iteration,
    at,
    contentHash: contents[p.filename] != null ? contentHash(contents[p.filename]) : null,
    /* Where the withdrawn content still lives. A prune that could not name this
     * would be a deletion wearing a different word. */
    preservedIn: iteration != null ? `history/${String(iteration).padStart(4, "0")}/` : "the previous iteration directory",
    recoverable: true
  }));
}

/**
 * Detects a hand-edited artifact.
 *
 * Generated files say so in their own header. An edit is not forbidden — people
 * have good reasons — but it silently breaks the guarantee the whole system
 * rests on, that everything in `output/` is derived from evidence. So it is
 * detected and reported rather than prevented, and regeneration is refused
 * until someone says what to do, because regenerating would destroy the edit.
 */
export function detectManualEdit({ filename, content, expectedIrHash = null }) {
  const isJson = String(filename).endsWith(".json");
  const metadata = readMetadata(filename, content);
  const stamp = isJson ? null : readStamp(content);

  if (!metadata && !stamp) {
    return {
      edited: null,
      event: null,
      reason: "no metadata and no hash stamp; this file cannot be checked, which is different from being unedited"
    };
  }
  if (expectedIrHash && stamp && stamp !== expectedIrHash) {
    return {
      edited: true,
      event: LIFECYCLE.MANUAL_EDIT_DETECTED,
      reason: `the hash stamp (${stamp}) does not match the IR this run derived (${expectedIrHash})`,
      remedy: "Either this file is from an earlier iteration, or it was edited. Compare it against history before regenerating — regenerating discards whatever the edit said.",
      regenerationBlocked: true
    };
  }
  if (metadata?.$malformed) {
    return {
      edited: true,
      event: LIFECYCLE.MANUAL_EDIT_DETECTED,
      reason: "the metadata block is not parseable, which a generated file's never is",
      remedy: "Recover what you need from the file by hand, then regenerate. A block that was edited cannot be trusted about the file it describes.",
      regenerationBlocked: true
    };
  }
  return { edited: false, event: null, reason: "the file matches what a generator would have written" };
}

/**
 * What to record when generation does not finish.
 *
 * Failed and cancelled are different outcomes and produce different records.
 * Both leave whatever was already on disk untouched: a half-written output
 * directory is worse than an old one, because the old one at least describes
 * a run that happened.
 */
export function recordIncomplete({ outcome, mode, at = new Date().toISOString(), written = [], reason = null, cancelledAt = null }) {
  const cancelled = outcome === "cancelled";
  return {
    event: cancelled ? LIFECYCLE.GENERATION_CANCELLED : LIFECYCLE.GENERATION_FAILED,
    mode,
    at,
    reason,
    cancelledAt: cancelled ? cancelledAt : null,
    /* Anything already written stays. It is named so a reader knows the
     * directory holds a partial run rather than a complete one. */
    partialArtifacts: written,
    priorArtifactsPreserved: true,
    prunedAnything: false,
    summary: cancelled
      ? `Generation was cancelled${cancelledAt ? ` at \`${cancelledAt}\`` : ""}. Nothing was withdrawn and nothing earlier was replaced.`
      : `Generation failed${reason ? `: ${reason}` : ""}. Nothing was withdrawn; the previous artifacts are still the current ones.`
  };
}

/** Appends lifecycle events to a run's history. Never rewrites, never removes. */
export function appendHistory(existingHistory, events) {
  const prior = Array.isArray(existingHistory) ? existingHistory : [];
  return [...prior, ...(Array.isArray(events) ? events : [events])];
}

/** Renders a lifecycle history for a person. */
export function renderHistory(history) {
  if (!history?.length) return "No lifecycle events recorded.";
  const lines = ["| When | Event | Artifact | Why |", "| --- | --- | --- | --- |"];
  for (const e of history) {
    lines.push(`| ${e.at ?? "—"} | ${e.event} | ${e.filename ?? e.artifactKind ?? "—"} | ${(e.why ?? e.reason ?? e.summary ?? "").replace(/\|/g, "\\|")} |`);
  }
  return lines.join("\n");
}

export { serializeStable };

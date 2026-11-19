/**
 * The correction store — append-only, by construction rather than by policy.
 *
 * Every state change writes a NEW file. Accepting `corr_0001` does not edit
 * `corr_0001.json`; it writes `corr_0001.accepted.json` alongside it, and the
 * current state of a correction is the newest event bearing its id. So the
 * history is not a log kept beside the truth — it *is* the truth, and losing it
 * would require deleting files rather than merely forgetting to write one.
 *
 * That shape costs a little on read and buys the property this whole phase
 * rests on: a correction cannot disappear, and neither can the reasoning that
 * led to it being accepted, rejected, superseded or blocked.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { serializeStable } from "../artifacts/serialize.mjs";
import {
  REVIEW_STATUS, PROMOTION_STATUS, SCOPE, PROMOTION_THRESHOLD,
  correctionFingerprint, nextCorrectionId, supersede
} from "./record.mjs";

/** Where corrections live inside a workspace. */
export const CORRECTIONS_DIR = join("feedback", "corrections");

/** One event in a correction's life. */
export const EVENT = Object.freeze({
  PROPOSED: "proposed",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  BLOCKED: "blocked",
  SUPERSEDED: "superseded",
  PROMOTED: "promoted",
  DEMOTED: "demoted"
});

const dirFor = (workspaceRoot) => join(workspaceRoot, CORRECTIONS_DIR);

/**
 * Reads every event, newest last.
 *
 * Sorted by filename, which sorts by correction id then by event sequence —
 * the numeric prefix is zero-padded for exactly this reason.
 */
export function readEvents(workspaceRoot) {
  const dir = dirFor(workspaceRoot);
  if (!existsSync(dir)) return [];
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort(); } catch { return []; }

  const events = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, file), "utf8"));
      events.push({ ...parsed, $file: file });
    } catch {
      /* An unreadable event is reported rather than skipped silently: a hole in
       * an append-only history is exactly the thing it exists to prevent. */
      events.push({ $file: file, $unreadable: true });
    }
  }
  return events;
}

/**
 * The current state of every correction, folded from its events.
 *
 * A correction's state is the newest event that names it. Nothing is computed
 * from anything but the events themselves, so a state that looks wrong can
 * always be traced to the event that produced it.
 */
export function readCorrections(workspaceRoot) {
  const byId = new Map();
  for (const event of readEvents(workspaceRoot)) {
    if (event.$unreadable || !event.id) continue;
    const existing = byId.get(event.id);
    byId.set(event.id, existing ? { ...existing, ...event } : event);
  }
  return [...byId.values()];
}

/** Everything that ever happened to one correction, oldest first. */
export function historyOf(workspaceRoot, id) {
  return readEvents(workspaceRoot).filter((e) => e.id === id);
}

/** Appends an event. Never overwrites; refuses to if asked. */
export function appendEvent(workspaceRoot, record, event) {
  const dir = dirFor(workspaceRoot);
  mkdirSync(dir, { recursive: true });

  const existing = readdirSync(dir).filter((f) => f.startsWith(`${record.id}.`));
  const sequence = String(existing.length).padStart(2, "0");
  const filename = `${record.id}.${sequence}.${event}.json`;
  const path = join(dir, filename);

  if (existsSync(path)) {
    throw new Error(`refusing to overwrite ${filename}: the correction store is append-only`);
  }

  const payload = { ...record, $event: event, $recordedAt: new Date().toISOString() };
  writeFileSync(path, serializeStable(payload), "utf8");
  return { file: filename, path, record: payload };
}

/** Writes a proposed correction. */
export function propose(workspaceRoot, record) {
  return appendEvent(workspaceRoot, { ...record, reviewStatus: REVIEW_STATUS.PROPOSED }, EVENT.PROPOSED);
}

/** Records acceptance, with the hashes the re-derivation produced. */
export function accept(workspaceRoot, record, { resultingIrHash = null, artifactHashes = {}, affectedArtifacts = [], at = new Date().toISOString() } = {}) {
  return appendEvent(workspaceRoot, {
    ...record,
    reviewStatus: REVIEW_STATUS.ACCEPTED,
    acceptedAt: at,
    resultingIrHash,
    resultingArtifactHashes: artifactHashes,
    affectedArtifacts
  }, EVENT.ACCEPTED);
}

/** Records rejection. The record stays; a rejected correction is history, not a gap. */
export function reject(workspaceRoot, record, { reason, at = new Date().toISOString() } = {}) {
  return appendEvent(workspaceRoot, {
    ...record,
    reviewStatus: REVIEW_STATUS.REJECTED,
    rejectedAt: at,
    rejectionReason: reason ?? null
  }, EVENT.REJECTED);
}

/**
 * Records that re-derivation or validation failed.
 *
 * The proposal survives. Nothing was published, and the reader needs both the
 * attempt and the reason it did not land — a correction that vanished on
 * failure would be re-proposed by the next person to notice the same problem.
 */
export function blocked(workspaceRoot, record, { reason, failures = [], at = new Date().toISOString() } = {}) {
  return appendEvent(workspaceRoot, {
    ...record,
    reviewStatus: REVIEW_STATUS.BLOCKED,
    blockedReason: reason ?? null,
    blockedAt: at,
    validationFailures: failures
  }, EVENT.BLOCKED);
}

/** Supersedes an earlier correction with a later one. Both records survive. */
export function supersedeWith(workspaceRoot, earlier, successor) {
  const updated = supersede(earlier, successor.id);
  appendEvent(workspaceRoot, updated, EVENT.SUPERSEDED);
  return appendEvent(workspaceRoot, { ...successor, supersedes: earlier.id }, EVENT.PROPOSED);
}

/**
 * Counts independent witnesses for what a correction asserts.
 *
 * Independence is by REFERENCE, not by record. The same correction filed twice
 * against one page is one witness that somebody felt strongly, not two
 * observations — and treating it as two is the easiest way to manufacture a
 * global rule from a single site.
 */
export function countWitnesses(corrections, correction) {
  const fingerprint = correctionFingerprint(correction);
  const references = new Set();
  let records = 0;

  for (const other of corrections) {
    if (other.reviewStatus === REVIEW_STATUS.REJECTED) continue;
    if (correctionFingerprint(other) !== fingerprint) continue;
    records += 1;
    if (other.referenceId) references.add(other.referenceId);
  }

  return {
    fingerprint,
    records,
    independentReferences: references.size,
    references: [...references],
    meetsThreshold: references.size >= PROMOTION_THRESHOLD
  };
}

/** Marks a correction promoted. Requires the caller to have passed the gate. */
export function promote(workspaceRoot, record, { by = null, witnesses = null, at = new Date().toISOString() } = {}) {
  return appendEvent(workspaceRoot, {
    ...record,
    promotionStatus: PROMOTION_STATUS.PROMOTED,
    promotedAt: at,
    promotedBy: by,
    promotionWitnesses: witnesses
  }, EVENT.PROMOTED);
}

/**
 * Withdraws a promotion.
 *
 * Demotion is a first-class event rather than a deletion, because a rule that
 * was once global and is no longer tells a reader something a rule that never
 * existed does not.
 */
export function demote(workspaceRoot, record, { reason, at = new Date().toISOString() } = {}) {
  return appendEvent(workspaceRoot, {
    ...record,
    promotionStatus: PROMOTION_STATUS.DEMOTED,
    demotedAt: at,
    demotionReason: reason ?? null
  }, EVENT.DEMOTED);
}

/** The next unused correction id in this workspace. */
export function allocateId(workspaceRoot) {
  return nextCorrectionId(readCorrections(workspaceRoot));
}

/** Corrections that currently apply — accepted, not superseded, not rejected. */
export function activeCorrections(workspaceRoot) {
  return readCorrections(workspaceRoot).filter((c) =>
    c.reviewStatus === REVIEW_STATUS.ACCEPTED && !c.supersededBy);
}

/** Renders the history for a person, newest last, nothing omitted. */
export function renderHistory(events) {
  if (!events.length) return "No correction has been filed in this workspace.";
  const lines = ["| When | Correction | Event | Claim | Scope | Why |", "| --- | --- | --- | --- | --- | --- |"];
  for (const e of events) {
    if (e.$unreadable) {
      lines.push(`| — | ${e.$file} | **unreadable** | — | — | This event could not be parsed. A hole in an append-only history is worth investigating. |`);
      continue;
    }
    const why = e.$event === EVENT.REJECTED ? (e.rejectionReason ?? "")
      : e.$event === EVENT.BLOCKED ? (e.blockedReason ?? "")
      : (e.reason ?? "");
    lines.push(`| ${e.$recordedAt ?? e.createdAt ?? "—"} | ${e.id} | ${e.$event} | ${e.claim ?? "—"} | ${e.scope ?? "—"} | ${String(why).replace(/\|/g, "\\|").slice(0, 90)} |`);
  }
  return lines.join("\n");
}

export { REVIEW_STATUS, PROMOTION_STATUS, SCOPE, PROMOTION_THRESHOLD };

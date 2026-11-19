/**
 * Corrections: recorded as structured data, applied to EVIDENCE, then
 * re-projected. Generated files are never touched directly.
 *
 * The promotion gate is the important part. A correction fixes this reference
 * immediately, but only becomes a global rule after it has recurred across at
 * least two references or been explicitly promoted. Otherwise one unusual site
 * quietly rewrites how every future analysis behaves.
 */

import { STATUS, METHOD, confidenceFor } from "../evidence/status.mjs";

export const PROMOTION_THRESHOLD = 2;

function nextEvidenceId(records) {
  let max = 0;
  for (const record of records) {
    const n = Number.parseInt(String(record.id).replace("ev_", ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `ev_${String(max + 1).padStart(4, "0")}`;
}

/**
 * The structure `applyCorrections` requires, checked before it is relied upon.
 *
 * Not a schema validation — that belongs at the boundary where a record enters
 * the system, and `bigaap correct --file` now does it there. This is the
 * narrower question of whether THIS function can read THIS record without
 * throwing, asked so that it can decline rather than crash.
 *
 * A workspace's correction records are history that arrived over months, from
 * the guided flow, from `--file`, and possibly from a person editing JSON. One
 * of them being malformed must not make the workspace un-analysable — which is
 * exactly what it did, because `correction.corrected.status` was read with no
 * guard while `record.mjs` guarded the identical access (def_0042).
 */
function structuralProblem(correction) {
  if (!correction || typeof correction !== "object") return "not an object";
  if (!correction.claim) return "no `claim`, so there is nothing to correct";
  if (correction.corrected == null) {
    return "no `corrected` object — a correction needs the value it should say, not only the claim it disputes";
  }
  if (typeof correction.corrected !== "object") return "`corrected` is not an object";
  if (correction.corrected.value === undefined) return "`corrected.value` is absent";
  return null;
}

/**
 * Applies corrections to an evidence map in place-ish (returns a new object).
 * Returns the mutated evidence plus a per-correction outcome report.
 *
 * A record this function cannot read is **skipped and reported**, never thrown
 * on. The reported outcome names the correction and the missing field, because
 * the user's problem is not that something went wrong — it is that they cannot
 * tell which of forty files on disk to fix.
 */
export function applyCorrections(evidence, corrections = []) {
  const records = evidence.records.map((r) => ({ ...r }));
  const claims = Object.fromEntries(
    Object.entries(evidence.claims ?? {}).map(([k, v]) => [k, { ...v }])
  );
  const outcomes = [];
  const refused = [];

  for (const correction of corrections) {
    const problem = structuralProblem(correction);
    if (problem) {
      refused.push({
        id: correction?.id ?? "(no id)",
        claim: correction?.claim ?? null,
        why: problem,
        file: correction?.id ? `feedback/corrections/${correction.id}.json` : null,
        userAction: "Fix or remove that record. Every other correction was applied and the analysis completed."
      });
      continue;
    }

    const claimPath = correction.claim;
    const existing = claims[claimPath];

    /* Supersede whatever currently backs this claim.
     *
     * Three sources, and the third is load-bearing: an evidence map does not
     * necessarily carry a `claims` index — the one the pipeline writes does
     * not — and relying on it alone means a correction supersedes nothing,
     * pushes its new record, and then loses to the original record at
     * derivation time. The correction appears to have been applied and the
     * value does not change, which is the worst of both outcomes. */
    const targets = new Set();
    if (correction.targetEvidenceId) targets.add(correction.targetEvidenceId);
    for (const id of existing?.evidence ?? []) targets.add(id);
    for (const record of records) {
      if (record.claim === claimPath && !record.supersededBy) targets.add(record.id);
    }

    let superseded = 0;
    for (const record of records) {
      if (!targets.has(record.id)) continue;
      if (record.supersededBy) continue;
      record.supersededBy = correction.id;
      superseded += 1;
    }

    const status = correction.corrected.status ?? STATUS.MEASURED;
    const id = nextEvidenceId(records);

    records.push({
      id,
      claim: claimPath,
      value: correction.corrected.value,
      normalized:
        typeof correction.corrected.value === "number"
          ? { px: correction.corrected.value }
          : null,
      status,
      method: METHOD.USER_CORRECTION,
      /* Without this the record has no source kind, and `ir.sourceKinds` —
       * derived as the distinct set across records — gains an `undefined`
       * entry. That reads downstream as a third unnamed source. */
      sourceKind: "user-correction",
      source: {
        selector: correction.affects?.heuristic ? null : null,
        element: null,
        domPath: null,
        viewport: null,
        state: "default",
        scheme: "light"
      },
      sampleSize: 1,
      agreement: 1,
      raw: [],
      confidence: correction.corrected.confidence ?? confidenceFor({ status, sampleSize: 1, agreement: 1 }),
      supersededBy: null,
      notes: `Correction ${correction.id}: ${correction.reason} Evidence: ${correction.evidence}`
    });

    claims[claimPath] = {
      value: correction.corrected.value,
      unit: existing?.unit ?? null,
      status,
      confidence: correction.corrected.confidence ?? confidenceFor({ status, sampleSize: 1, agreement: 1 }),
      evidence: [id]
    };

    outcomes.push({
      correction: correction.id,
      claim: claimPath,
      from: existing?.value ?? correction.original?.value ?? null,
      to: correction.corrected.value,
      supersededRecords: superseded,
      newEvidenceId: id,
      applied: true
    });
  }

  return {
    evidence: { ...evidence, records, claims },
    outcomes,
    /* Records this function could not read. Empty on every healthy workspace.
     * Returned rather than logged so a caller can surface it as a warning that
     * names the file — a crash three frames down told the user nothing about
     * which of their records was the problem (def_0042). */
    refused
  };
}

/**
 * Decides which corrections may become global rules.
 * Returns { promote, hold } — nothing is written to disk here.
 */
export function evaluatePromotions(corrections, { force = [] } = {}) {
  const promote = [];
  const hold = [];

  for (const correction of corrections) {
    if (correction.scope !== "global") {
      hold.push({ correction, reason: `scope is "${correction.scope}" — only global corrections become rules` });
      continue;
    }
    if (correction.promotionStatus === "promoted") {
      hold.push({ correction, reason: "already promoted" });
      continue;
    }
    if (correction.promotionStatus === "rejected") {
      hold.push({ correction, reason: "previously rejected" });
      continue;
    }
    if (force.includes(correction.id)) {
      promote.push({ correction, reason: "explicitly promoted by the user" });
      continue;
    }
    if ((correction.recurrenceCount ?? 1) >= PROMOTION_THRESHOLD) {
      promote.push({ correction, reason: `recurred across ${correction.recurrenceCount} references` });
      continue;
    }
    hold.push({
      correction,
      reason: `seen ${correction.recurrenceCount ?? 1}x; needs ${PROMOTION_THRESHOLD} or explicit promotion`
    });
  }

  return { promote, hold };
}

/** Renders promoted corrections as appendable rules for rules-learned.md. */
export function renderLearnedRules(promotions) {
  if (!promotions.length) return "";
  const lines = [];
  for (const { correction, reason } of promotions) {
    lines.push(`### ${correction.id} — ${correction.category}`);
    lines.push("");
    lines.push(`**Rule:** ${correction.ruleToAdd ?? "(no rule text supplied)"}`);
    lines.push("");
    lines.push(`- Claim: \`${correction.claim}\``);
    lines.push(`- Was: \`${correction.original?.value}\` → now: \`${correction.corrected?.value}\``);
    lines.push(`- Why the original was wrong: ${correction.reason}`);
    lines.push(`- Supporting evidence: ${correction.evidence}`);
    if (correction.affects?.heuristic) {
      lines.push(`- Affected heuristic: \`${correction.affects.heuristic}\` in \`${correction.affects.module ?? "unknown"}\``);
    }
    lines.push(`- Promoted because: ${reason}`);
    lines.push(`- First recorded: ${correction.createdAt ?? "unknown"} (reference \`${correction.referenceId}\`)`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Human-readable append for correction-log.md. */
export function renderCorrectionLog(corrections, outcomes) {
  const byId = new Map(outcomes.map((o) => [o.correction, o]));
  const lines = ["# Correction log", ""];
  lines.push("Append-only record. Every entry changed the evidence map and triggered a full re-projection.");
  lines.push("");

  for (const correction of corrections) {
    const outcome = byId.get(correction.id);
    lines.push(`## ${correction.id} — \`${correction.claim}\``);
    lines.push("");
    lines.push(`- **Category:** ${correction.category}`);
    lines.push(`- **Original claim:** \`${correction.original?.value}\` (${correction.original?.status ?? "unknown"})`);
    lines.push(`- **Corrected claim:** \`${correction.corrected?.value}\` (${correction.corrected?.status ?? "measured"})`);
    lines.push(`- **Why the original was wrong:** ${correction.reason}`);
    lines.push(`- **Evidence for the correction:** ${correction.evidence}`);
    if (correction.ruleToAdd) lines.push(`- **Rule that would prevent it:** ${correction.ruleToAdd}`);
    lines.push(`- **Scope:** ${correction.scope} · **recurrence:** ${correction.recurrenceCount} · **promotion:** ${correction.promotionStatus}`);
    if (correction.affects) {
      lines.push(`- **Affects:** extractor \`${correction.affects.extractor ?? "—"}\`, heuristic \`${correction.affects.heuristic ?? "—"}\`, module \`${correction.affects.module ?? "—"}\``);
    }
    if (outcome) {
      lines.push(`- **Applied:** superseded ${outcome.supersededRecords} evidence record(s); new record \`${outcome.newEvidenceId}\``);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Merging evidence from multiple sources.
 *
 * The ordering here is the whole point: records are kept SEPARATE, disagreement
 * analysis runs across them, and only then are claims assembled. Merging first
 * would collapse two sources into one value and destroy the very signal the
 * analysis exists to find.
 *
 * Nothing is dropped. A source that loses a preference keeps its record, its
 * id, and its place in the claim's candidate list.
 */

import { STATUS } from "./status.mjs";
import { detectDisagreements, contestClaim, isCriticalClaim } from "./disagreement.mjs";

/** Re-ids a record set so two builders' `ev_0001`s cannot collide. */
function reid(evidence, prefix) {
  const map = new Map();
  const records = evidence.records.map((record, i) => {
    const id = `${prefix}${String(i + 1).padStart(4, "0")}`;
    map.set(record.id, id);
    return { ...record, id };
  });

  // Re-point every internal reference at the new ids.
  for (const record of records) {
    if (record.contests?.length) record.contests = record.contests.map((id) => map.get(id) ?? id);
    if (record.supersededBy) record.supersededBy = map.get(record.supersededBy) ?? record.supersededBy;
  }

  const claims = Object.fromEntries(
    Object.entries(evidence.claims ?? {}).map(([path, claim]) => [
      path,
      { ...claim, evidence: (claim.evidence ?? []).map((id) => map.get(id) ?? id) }
    ])
  );

  return { records, claims, idMap: map };
}

/**
 * Merges a forensic evidence set with a screenshot evidence set.
 *
 * @param {object} primary   DOM/computed-style evidence — kept under `ev_`
 * @param {object} secondary screenshot evidence — re-ided under `sc_`
 */
export function mergeEvidence(primary, secondary, options = {}) {
  if (!secondary) return primary;
  if (!primary) return secondary;

  const a = reid(primary, "ev_");
  const b = reid(secondary, "sc_");

  /* 1. Records stay separate and complete. */
  const records = [...a.records, ...b.records];

  /* 2. Disagreement analysis runs BEFORE claims are assembled. */
  const disagreements = detectDisagreements(records);
  const byClaim = new Map();
  for (const disagreement of disagreements) {
    if (!byClaim.has(disagreement.claim)) byClaim.set(disagreement.claim, []);
    byClaim.get(disagreement.claim).push(disagreement);
  }

  /* 3. Claims are assembled last, and a contested claim carries both values. */
  const claims = {};
  const allPaths = new Set([...Object.keys(a.claims), ...Object.keys(b.claims)]);

  for (const path of allPaths) {
    const fromPrimary = a.claims[path];
    const fromSecondary = b.claims[path];
    const conflicts = byClaim.get(path) ?? [];

    if (!fromPrimary) {
      // Only the screenshot saw it. That is a legitimate contribution, not a
      // downgrade of anything.
      claims[path] = fromSecondary;
      continue;
    }
    if (!fromSecondary) {
      claims[path] = fromPrimary;
      continue;
    }

    if (!conflicts.length) {
      // Both sources agree exactly: corroboration, with the stronger status kept
      // and both evidence ids retained.
      claims[path] = {
        ...fromPrimary,
        corroborated: true,
        corroboratedBy: fromSecondary.evidence,
        evidence: [...new Set([...fromPrimary.evidence, ...fromSecondary.evidence])]
      };
      continue;
    }

    // Contested (or corroborated-within-tolerance): the disagreement record
    // decides how it renders, and both candidates survive on the claim.
    claims[path] = contestClaim(fromPrimary, conflicts[0]);
  }

  /* 4. Everything else is a union. */
  const unknowns = [];
  const seenUnknown = new Set();
  for (const unknown of [...(primary.unknowns ?? []), ...(secondary.unknowns ?? [])]) {
    // A claim one source could resolve is not unknown just because the other
    // could not — but a structurally unknowable claim stays unknown regardless.
    if (claims[unknown.claim] && claims[unknown.claim].status !== STATUS.UNKNOWN) continue;
    const key = `${unknown.claim}::${unknown.reason}`;
    if (seenUnknown.has(key)) continue;
    seenUnknown.add(key);
    unknowns.push(unknown);
  }

  const contested = Object.entries(claims)
    .filter(([, claim]) => claim.contested)
    .map(([path, claim]) => ({
      claim: path,
      critical: isCriticalClaim(path),
      disagreementId: claim.disagreement?.id ?? null,
      type: claim.disagreement?.type ?? null,
      resolutionStatus: claim.disagreement?.resolutionStatus ?? null,
      candidates: claim.candidates ?? []
    }));

  return {
    $schemaVersion: primary.$schemaVersion,
    referenceId: primary.referenceId,
    generatedAt: new Date().toISOString(),
    mode: "multi-source",
    sourceKinds: [...new Set(records.map((r) => r.sourceKind))],
    records,
    claims,
    unknowns,
    notes: [
      ...(primary.notes ?? []),
      ...(secondary.notes ?? []),
      `Merged ${a.records.length} forensic and ${b.records.length} screenshot record(s). ` +
        `${disagreements.length} cross-source comparison(s), of which ` +
        `${disagreements.filter((d) => !d.magnitude.withinTolerance).length} are genuine disagreements.`
    ],
    rejected: [...(primary.rejected ?? []), ...(secondary.rejected ?? [])],
    disagreements,
    contested,
    regions: secondary.regions ?? [],
    regionCoverage: secondary.regionCoverage ?? null,
    images: secondary.images ?? [],
    scaleKnown: secondary.scaleKnown ?? false,
    viewportKnown: secondary.viewportKnown ?? false
  };
}

/** Contested claims that would make a faithful rebuild impossible. */
export function criticalContested(evidence) {
  return (evidence.contested ?? []).filter(
    (c) => c.critical && c.resolutionStatus !== "resolved-by-correction"
  );
}

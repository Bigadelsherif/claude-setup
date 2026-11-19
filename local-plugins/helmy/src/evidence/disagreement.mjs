/**
 * Disagreement analysis across evidence sources.
 *
 * The governing rule:
 *
 *   Evidence sources may disagree, but the system must never silently replace
 *   one source with another.
 *
 * A preference is allowed only where it is claim-specific and justifiable —
 * computed style knows what a colour was declared as, pixels know what was
 * actually painted, and neither is a general-purpose winner. Where a preference
 * applies, it selects a value to display; it never deletes, hides, or supersedes
 * the competing record.
 *
 * Two values differing by less than the measurement tolerance are treated as
 * CORROBORATION rather than conflict. Antialiasing is not a finding.
 */

import { SOURCE, SOURCE_RANK } from "./status.mjs";
import { STATUS } from "./status.mjs";
import * as color from "../util/color.mjs";

export const DISAGREEMENT_TYPE = Object.freeze({
  NUMERIC: "numeric-mismatch",
  COLOR: "color-mismatch",
  HIERARCHY: "hierarchy-mismatch",
  COMPONENT_IDENTITY: "component-identity-mismatch",
  REGION: "region-mismatch",
  STATE: "state-mismatch",
  SOURCE_SCOPE: "source-scope-mismatch",
  SCALE: "scale-mismatch",
  TIMING: "timing-mismatch",
  UNKNOWN_VS_OBSERVED: "unknown-versus-observed"
});

export const RESOLUTION = Object.freeze({
  /** Within tolerance — the sources agree as well as their methods allow. */
  CORROBORATED: "corroborated",
  /** A claim-specific preference applies and is explained. */
  PREFERRED: "preferred-by-claim-type",
  /** Material, no preference justified: left open for a human. */
  OPEN: "open",
  /** Escalated for review because the gap is large. */
  REVIEW: "review-item",
  /** Settled by a user correction, which does not delete the losers. */
  RESOLVED: "resolved-by-correction"
});

/**
 * Measurement tolerances.
 *
 * A pixel measurement of an antialiased edge cannot be expected to match a
 * computed style exactly, and penalising it for that would make every honest
 * screenshot analysis look conflicted.
 */
export const TOLERANCE = Object.freeze({
  px: 1.5,
  ratio: 0.02,
  /** Perceptual distance below which two colours are the same colour. */
  colorDistance: 12,
  ms: 0
});

/* ---------------------------------------------------------- classification */

const isColorish = (v) => typeof v === "string" && !!color.parse(v);
const isNumeric = (v) => typeof v === "number" && Number.isFinite(v);

function classify(claimPath, a, b) {
  if (a?.status === STATUS.UNKNOWN || b?.status === STATUS.UNKNOWN) {
    return DISAGREEMENT_TYPE.UNKNOWN_VS_OBSERVED;
  }
  if (/selector|component\..*\.identity|componentIdentity/i.test(claimPath)) {
    return DISAGREEMENT_TYPE.COMPONENT_IDENTITY;
  }
  if (/region/i.test(claimPath)) return DISAGREEMENT_TYPE.REGION;
  if (/^states\.|state$/i.test(claimPath)) return DISAGREEMENT_TYPE.STATE;
  if (/hierarchy|order|priority|above|below/i.test(claimPath)) return DISAGREEMENT_TYPE.HIERARCHY;
  if (/duration|easing|timing|transition|animation/i.test(claimPath)) return DISAGREEMENT_TYPE.TIMING;
  if (isColorish(a?.value) && isColorish(b?.value)) return DISAGREEMENT_TYPE.COLOR;
  if (isNumeric(a?.value) && isNumeric(b?.value)) return DISAGREEMENT_TYPE.NUMERIC;
  return DISAGREEMENT_TYPE.SOURCE_SCOPE;
}

/** A consistent ratio between two numbers hints at a scale problem, not a value problem. */
function looksLikeScale(a, b) {
  if (!isNumeric(a) || !isNumeric(b) || a === 0 || b === 0) return null;
  const ratio = Math.max(a, b) / Math.min(a, b);
  for (const candidate of [1.25, 1.5, 2, 3]) {
    if (Math.abs(ratio - candidate) < 0.02) return candidate;
  }
  return null;
}

function compare(claimPath, recordA, recordB) {
  const a = recordA.value;
  const b = recordB.value;
  let type = classify(claimPath, recordA, recordB);

  if (type === DISAGREEMENT_TYPE.UNKNOWN_VS_OBSERVED) {
    return {
      type,
      delta: null,
      unit: null,
      withinTolerance: false,
      material: true,
      description: `one source reports a value (${a ?? b}), the other reports it as structurally unknown`
    };
  }

  if (isNumeric(a) && isNumeric(b)) {
    const delta = Math.round(Math.abs(a - b) * 1000) / 1000;
    const scaleFactor = looksLikeScale(a, b);
    if (scaleFactor && delta > TOLERANCE.px) type = DISAGREEMENT_TYPE.SCALE;

    const tolerance = type === DISAGREEMENT_TYPE.TIMING ? TOLERANCE.ms : TOLERANCE.px;
    const withinTolerance = delta <= tolerance;
    return {
      type,
      delta,
      unit: type === DISAGREEMENT_TYPE.TIMING ? "ms" : "px",
      tolerance,
      withinTolerance,
      material: !withinTolerance && delta > tolerance * 2,
      scaleFactor: scaleFactor ?? null,
      description: withinTolerance
        ? `${a} vs ${b} — within the ${tolerance}px measurement tolerance`
        : scaleFactor
          ? `${a} vs ${b} — differ by a factor of ~${scaleFactor}, which suggests a scale mismatch rather than a value mismatch`
          : `${a} vs ${b} (delta ${delta})`
    };
  }

  if (isColorish(a) && isColorish(b)) {
    const distance = color.distance(a, b);
    const rounded = distance == null ? null : Math.round(distance * 100) / 100;
    const withinTolerance = rounded != null && rounded <= TOLERANCE.colorDistance;
    return {
      type: DISAGREEMENT_TYPE.COLOR,
      delta: rounded,
      unit: "perceptual-distance",
      tolerance: TOLERANCE.colorDistance,
      withinTolerance,
      material: !withinTolerance && rounded != null && rounded > TOLERANCE.colorDistance * 3,
      description: withinTolerance
        ? `${a} vs ${b} — perceptually the same colour (distance ${rounded})`
        : `${a} vs ${b} — perceptual distance ${rounded}; a composited render can differ from an authored value`
    };
  }

  const same = String(a) === String(b);
  return {
    type,
    delta: same ? 0 : null,
    unit: null,
    withinTolerance: same,
    material: !same,
    description: same ? `${a} vs ${b} — identical` : `${a} vs ${b}`
  };
}

/* ------------------------------------------------------- source preference */

/**
 * Which source is more appropriate FOR THIS CLAIM.
 *
 * Deliberately not a global ranking. Each rule states what the preferred source
 * knows that the other cannot, so a preference is always answerable rather than
 * merely asserted. Where no rule applies the disagreement stays open, because
 * "one of these is probably right" is not an analysis.
 */
const PREFERENCE_RULES = [
  {
    match: (claim) => /^tokens\.(radius|spacing|border)|padding|margin|gap|maxWidth|minHeight/i.test(claim),
    source: SOURCE.COMPUTED_STYLE,
    rationale: "A declared length is exact. The same length read from pixels is bounded by edge detection and antialiasing."
  },
  {
    match: (claim) => /width|height|rect|dimension|instanceCount|columns/i.test(claim),
    source: SOURCE.DOM,
    rationale: "Element geometry comes from the layout engine, which is what actually computed it."
  },
  {
    match: (claim) => /background|boxShadow|painted|surface|borderRadius/i.test(claim),
    source: SOURCE.SCREENSHOT,
    rationale: "A painted boundary is what was rendered after compositing, which the declared value does not always predict.",
    onlyAgainst: [SOURCE.VISUAL_MODEL]
  },
  {
    match: (claim) => /^tokens\.color\./i.test(claim),
    source: SOURCE.COMPUTED_STYLE,
    rationale: "The authored colour is exact; a sampled pixel reflects compositing, opacity and compression."
  },
  {
    match: (claim) => /hierarchy|priority|composition|visualOrder|above|below/i.test(claim),
    source: SOURCE.SCREENSHOT,
    rationale: "Perceived hierarchy is what a viewer experiences. DOM order frequently differs from visual prominence."
  },
  {
    match: (claim) => /text|label|copy|heading|content/i.test(claim),
    source: SOURCE.SCREENSHOT,
    technique: "OCR",
    rationale: "Visible text is what the reader sees, including anything the DOM hides or replaces."
  },
  {
    match: (claim) => /selector|identity/i.test(claim),
    source: SOURCE.DOM,
    rationale: "Component identity needs a addressable node, which only the DOM provides."
  }
];

export function preferenceFor(claimPath, sourceA, sourceB) {
  for (const rule of PREFERENCE_RULES) {
    if (!rule.match(claimPath)) continue;
    if (rule.onlyAgainst && !rule.onlyAgainst.includes(sourceA) && !rule.onlyAgainst.includes(sourceB)) continue;
    if (rule.source !== sourceA && rule.source !== sourceB) continue;
    return { source: rule.source, rationale: rule.rationale, justified: true };
  }

  // A visual model may describe relationships but must not override a forensic
  // measurement — its confidence is not evidence.
  if (sourceA === SOURCE.VISUAL_MODEL || sourceB === SOURCE.VISUAL_MODEL) {
    const other = sourceA === SOURCE.VISUAL_MODEL ? sourceB : sourceA;
    return {
      source: other,
      rationale: "A visual model may describe relationships, but it does not override an exact forensic value.",
      justified: true
    };
  }

  return {
    source: null,
    rationale: "No claim-specific rule favours either source, so the disagreement stays open rather than being resolved by convenience.",
    justified: false
  };
}

/* ------------------------------------------------------------ the record */

let sequence = 0;
export const resetDisagreementIds = () => { sequence = 0; };

export function buildDisagreement(claimPath, recordA, recordB) {
  const comparison = compare(claimPath, recordA, recordB);
  const preference = preferenceFor(claimPath, recordA.sourceKind, recordB.sourceKind);

  const candidateFor = (r) => ({
    evidenceId: r.id,
    value: r.value,
    sourceKind: r.sourceKind,
    technique: r.technique,
    status: r.status,
    confidence: r.confidence
  });

  // Within tolerance the sources corroborate. Charging a penalty here would
  // punish two methods for agreeing as closely as their methods permit.
  const penalty = comparison.withinTolerance
    ? 1
    : comparison.material
      ? 0.55
      : 0.8;

  let resolutionStatus;
  if (comparison.withinTolerance) resolutionStatus = RESOLUTION.CORROBORATED;
  else if (preference.justified) resolutionStatus = RESOLUTION.PREFERRED;
  else if (comparison.material) resolutionStatus = RESOLUTION.REVIEW;
  else resolutionStatus = RESOLUTION.OPEN;

  const preferredRecord = preference.source
    ? [recordA, recordB].find((r) => r.sourceKind === preference.source)
    : [recordA, recordB].sort((x, y) => (SOURCE_RANK[x.sourceKind] ?? 9) - (SOURCE_RANK[y.sourceKind] ?? 9))[0];

  sequence += 1;
  return {
    id: `dis_${String(sequence).padStart(4, "0")}`,
    claim: claimPath,
    normalizedClaimKey: claimPath.replace(/\[\d+\]/g, "[]").toLowerCase(),
    evidenceIds: [recordA.id, recordB.id],
    candidateValues: [candidateFor(recordA), candidateFor(recordB)],
    sourceKinds: [recordA.sourceKind, recordB.sourceKind],
    techniques: [recordA.technique, recordB.technique],
    disagreementType: comparison.type,
    magnitude: {
      delta: comparison.delta,
      unit: comparison.unit,
      tolerance: comparison.tolerance ?? null,
      withinTolerance: comparison.withinTolerance,
      material: comparison.material,
      scaleFactor: comparison.scaleFactor ?? null
    },
    penaltyApplied: Math.round(penalty * 1000) / 1000,
    preferredSource: preference.justified ? preference.source : null,
    preferredEvidenceId: comparison.withinTolerance || preference.justified ? preferredRecord?.id ?? null : null,
    preferredValue: comparison.withinTolerance || preference.justified ? preferredRecord?.value ?? null : null,
    preferenceJustified: preference.justified,
    resolutionStatus,
    explanation: `${comparison.description}. ${preference.rationale}`,
    note: "Both candidates are retained. A preference selects what to display; it never deletes the competing record."
  };
}

/**
 * Finds claims backed by more than one SOURCE KIND and builds a disagreement
 * for each genuine conflict. Sources are compared as sources — records from the
 * same source kind are never treated as disagreeing with each other.
 */
export function detectDisagreements(records) {
  const byClaim = new Map();
  for (const record of records) {
    if (record.supersededBy) continue;
    if (!byClaim.has(record.claim)) byClaim.set(record.claim, []);
    byClaim.get(record.claim).push(record);
  }

  const disagreements = [];
  for (const [claimPath, group] of byClaim) {
    if (group.length < 2) continue;

    // One record per source kind: the strongest, so a source is represented by
    // its best evidence rather than by an arbitrary one.
    const bySource = new Map();
    for (const record of group) {
      const existing = bySource.get(record.sourceKind);
      if (!existing || record.confidence > existing.confidence) bySource.set(record.sourceKind, record);
    }
    if (bySource.size < 2) continue;

    const representatives = [...bySource.values()];
    for (let i = 0; i < representatives.length; i++) {
      for (let j = i + 1; j < representatives.length; j++) {
        const a = representatives[i];
        const b = representatives[j];
        if (String(a.value) === String(b.value)) continue;

        const disagreement = buildDisagreement(claimPath, a, b);
        disagreements.push(disagreement);
        a.contests = [...new Set([...(a.contests ?? []), b.id])];
        b.contests = [...new Set([...(b.contests ?? []), a.id])];
      }
    }
  }
  return disagreements;
}

/** Turns a disagreement into a contested claim node for the IR. */
export function contestClaim(claim, disagreement) {
  const preferred = disagreement.candidateValues.find(
    (c) => c.evidenceId === disagreement.preferredEvidenceId
  );

  return {
    ...claim,
    value: preferred?.value ?? claim.value,
    confidence: Math.round((claim.confidence ?? 0) * disagreement.penaltyApplied * 1000) / 1000,
    // Corroboration is agreement, not conflict, and must not mark a claim
    // contested — otherwise every honest screenshot cross-check would block.
    contested: !disagreement.magnitude.withinTolerance,
    corroborated: disagreement.magnitude.withinTolerance,
    candidates: disagreement.candidateValues.map((c) => ({
      value: c.value,
      source: c.sourceKind,
      technique: c.technique,
      status: c.status,
      confidence: c.confidence,
      evidence: [c.evidenceId]
    })),
    disagreement: {
      id: disagreement.id,
      type: disagreement.disagreementType,
      delta: disagreement.magnitude.delta,
      unit: disagreement.magnitude.unit,
      withinTolerance: disagreement.magnitude.withinTolerance,
      material: disagreement.magnitude.material,
      penaltyApplied: disagreement.penaltyApplied,
      preferredSource: disagreement.preferredSource,
      preferenceJustified: disagreement.preferenceJustified,
      resolutionStatus: disagreement.resolutionStatus,
      explanation: disagreement.explanation
    },
    evidence: [...new Set([...(claim.evidence ?? []), ...disagreement.evidenceIds])]
  };
}

/**
 * Claims whose contestation makes a faithful rebuild impossible.
 * A disagreement about a decorative colour is a note; one about the container
 * width is a different page.
 */
export const CRITICAL_CLAIM_PATTERNS = [
  /^layout\.container\./,
  /^layout\.grid\./,
  /^layout\.breakpoints/,
  /^scales\.spacing/,
  /^tokens\.typography\./,
  /^scales\.typeRamp/,
  /^component\..*\.(borderRadius|padding|background|selector)/,
  /^states\./
];

export const isCriticalClaim = (claimPath) =>
  CRITICAL_CLAIM_PATTERNS.some((pattern) => pattern.test(claimPath));

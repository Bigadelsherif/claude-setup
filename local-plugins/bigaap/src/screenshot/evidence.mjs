/**
 * Screenshot capture -> graded evidence.
 *
 * This is a VALIDATING INTAKE, not an analyser. It receives observations —
 * from pixel measurement, from a vision model, from OCR — and decides what each
 * is allowed to claim. It never produces an observation of its own, because a
 * layer that both invents values and judges them is not a check on anything.
 *
 * Three rules do the work:
 *   1. No region, no evidence. A measurement with no stated origin in the image
 *      cannot be reproduced or corrected.
 *   2. The ceiling is enforced on write (see ceilings.mjs).
 *   3. Unanswerable claims are refused, not downgraded. A low-confidence answer
 *      to a question the medium cannot answer is worse than an unknown.
 */

import { STATUS, SOURCE, confidenceFor } from "../evidence/status.mjs";
import {
  SCREENSHOT_TECHNIQUE, ALL_SCREENSHOT_TECHNIQUES,
  applyScreenshotCeiling, forbiddenReason, LIMITATIONS
} from "./ceilings.mjs";
import { buildRegionIndex, contentRegionCoverage, DETECTION_METHOD } from "./regions.mjs";
import { detectDisagreements } from "../evidence/disagreement.mjs";

const EVIDENCE_SCHEMA_VERSION = "0.1.0";

/** Confidence multipliers for the ways a screenshot observation can be weak. */
const CONFIDENCE_FACTORS = {
  unknownScale: 0.7,
  inferredRegion: 0.8,
  lowRegionConfidence: 0.9
};

export function buildScreenshotEvidence(capture, options = {}) {
  const referenceId = options.referenceId ?? "unknown";
  const records = [];
  const claims = {};
  const unknowns = [];
  const notes = [];
  const rejected = [];
  let seq = 0;
  const nextId = () => `ev_${String(++seq).padStart(4, "0")}`;

  const images = capture.meta?.images ?? [];
  const primaryImage = images[0] ?? null;
  const scaleKnown = !!capture.meta?.scaleKnown;
  const viewportKnown = images.some((i) => i.viewport != null);

  /* ------------------------------------------------------------- regions */

  const { index: regions, rejected: badRegions } = buildRegionIndex(capture.regions ?? [], primaryImage);
  for (const bad of badRegions) {
    rejected.push({ kind: "region", id: bad.region, errors: bad.errors });
    unknowns.push({
      claim: `region:${bad.region}`,
      reason: `Region rejected: ${bad.errors.join("; ")}.`
    });
  }

  if (!scaleKnown) {
    notes.push(
      "The image scale relative to CSS pixels is unknown, so every pixel measurement is capped at `estimated` regardless of how precisely it was measured."
    );
  }

  /* -------------------------------------------------------- observations */

  for (const observation of capture.observations ?? []) {
    const claimPath = observation.claim;

    // 1. Refuse the unanswerable.
    const forbidden = forbiddenReason(claimPath);
    if (forbidden) {
      unknowns.push({ claim: claimPath, reason: `Not derivable from a screenshot. ${forbidden}` });
      rejected.push({ kind: "observation", id: claimPath, errors: ["forbidden-claim"] });
      continue;
    }

    // 2. Refuse the unprovenanced.
    const region = observation.regionId ? regions.get(observation.regionId) : null;
    if (!region) {
      unknowns.push({
        claim: claimPath,
        reason: observation.regionId
          ? `Observation references region "${observation.regionId}", which is not a valid region.`
          : "Observation carries no source region. A screenshot measurement without a region is invalid."
      });
      rejected.push({ kind: "observation", id: claimPath, errors: ["missing-region"] });
      continue;
    }

    if (!ALL_SCREENSHOT_TECHNIQUES.includes(observation.technique)) {
      unknowns.push({
        claim: claimPath,
        reason: `Unknown technique "${observation.technique}". Expected one of ${ALL_SCREENSHOT_TECHNIQUES.join(", ")}.`
      });
      rejected.push({ kind: "observation", id: claimPath, errors: ["unknown-technique"] });
      continue;
    }

    // 3. Apply the ceiling.
    const proposed = observation.status ?? STATUS.OBSERVED;
    const status = applyScreenshotCeiling(proposed, {
      technique: observation.technique,
      scaleKnown,
      qualitative: observation.qualitative === true
    });

    /* --------------------------------------------------- limitations */

    const limitations = [LIMITATIONS.NO_DOM, LIMITATIONS.SINGLE_FRAME];
    if (!scaleKnown && observation.technique === SCREENSHOT_TECHNIQUE.PIXEL_MEASUREMENT) {
      limitations.push(LIMITATIONS.NO_SCALE);
    }
    if (observation.technique === SCREENSHOT_TECHNIQUE.PIXEL_MEASUREMENT) {
      limitations.push(LIMITATIONS.ANTIALIASING);
    }
    if (/color|background|border/i.test(claimPath)) limitations.push(LIMITATIONS.COMPRESSION);
    if (region.detectionMethod === DETECTION_METHOD.INFERRED) limitations.push(LIMITATIONS.INFERRED_REGION);
    if (observation.limitations?.length) limitations.push(...observation.limitations);

    /* --------------------------------------------------- confidence */

    let confidence = confidenceFor({
      status,
      sampleSize: observation.sampleSize ?? 1,
      agreement: observation.agreement ?? 1
    });
    if (!scaleKnown) confidence *= CONFIDENCE_FACTORS.unknownScale;
    if (region.detectionMethod === DETECTION_METHOD.INFERRED) confidence *= CONFIDENCE_FACTORS.inferredRegion;
    if (region.confidence < 0.8) confidence *= CONFIDENCE_FACTORS.lowRegionConfidence;
    confidence = Math.round(confidence * 1000) / 1000;

    const id = nextId();
    region.evidenceIds.push(id);

    records.push({
      id,
      claim: claimPath,
      value: observation.value,
      normalized: observation.normalized ?? null,
      unit: observation.unit ?? null,
      status,
      method: "vision",
      sourceKind: SOURCE.SCREENSHOT,
      technique: observation.technique,
      source: {
        selector: null,
        element: null,
        domPath: null,
        viewport: region.viewport ?? primaryImage?.viewport ?? null,
        state: observation.state ?? "default",
        scheme: "light",
        file: region.image ?? primaryImage?.file ?? null,
        captureDate: primaryImage?.captureDate ?? capture.meta?.capturedAt ?? null,
        region: {
          id: region.id,
          kind: region.kind,
          x: region.coordinates.x,
          y: region.coordinates.y,
          width: region.coordinates.width,
          height: region.coordinates.height,
          detectionMethod: region.detectionMethod,
          image: region.image ?? primaryImage?.file ?? null
        },
        coordinates: observation.coordinates ?? region.coordinates
      },
      sampleSize: observation.sampleSize ?? 1,
      agreement: observation.agreement ?? 1,
      raw: observation.raw ?? [],
      confidence,
      limitations: [...new Set(limitations)],
      contests: [],
      supersededBy: null,
      notes:
        status !== proposed
          ? `Status capped from "${proposed}" to "${status}": ${observation.technique} on a ${scaleKnown ? "known" : "unknown"}-scale image cannot support more.`
          : (observation.notes ?? "")
    });
  }

  /* ------------------------------------------------------ claim assembly */

  const byClaim = new Map();
  for (const record of records) {
    if (!byClaim.has(record.claim)) byClaim.set(record.claim, []);
    byClaim.get(record.claim).push(record);
  }

  for (const [path, group] of byClaim) {
    // Strongest first; ties broken by confidence.
    const ranked = [...group].sort((a, b) => b.confidence - a.confidence);
    const best = ranked[0];
    claims[path] = {
      value: best.value,
      unit: best.unit ?? null,
      status: best.status,
      confidence: best.confidence,
      evidence: group.map((r) => r.id)
    };
  }

  /* ------------------------------------------------- component identity
   *
   * A screenshot has no selectors. When component properties were observed, the
   * component is named by the REGION they came from — which is the only honest
   * identity an image can supply, and keeps the downstream IR shape intact
   * without inventing a CSS selector nobody could write.
   */
  const componentClaims = Object.keys(claims).filter((c) => c.startsWith("component.card."));
  if (componentClaims.length && !claims["component.card.selector"]) {
    const sourceRegion = records.find((r) => r.claim.startsWith("component.card."))?.source.region;
    if (sourceRegion) {
      const id = nextId();
      records.push({
        id,
        claim: "component.card.selector",
        value: `[screenshot-region:${sourceRegion.id}]`,
        status: STATUS.OBSERVED,
        method: "vision",
        sourceKind: SOURCE.SCREENSHOT,
        technique: SCREENSHOT_TECHNIQUE.REGION_COMPARISON,
        source: {
          selector: null, element: null, domPath: null,
          viewport: sourceRegion.viewport ?? null, state: "default", scheme: "light",
          file: sourceRegion.image, captureDate: capture.meta?.capturedAt ?? null,
          region: sourceRegion, coordinates: sourceRegion
        },
        sampleSize: 1,
        agreement: 1,
        raw: [],
        confidence: 0.6,
        limitations: [LIMITATIONS.NO_DOM, "Identified by image region; no CSS selector is derivable from a screenshot."],
        contests: [],
        supersededBy: null,
        notes: "Component identity from region, not selector."
      });
      claims["component.card.selector"] = {
        value: `[screenshot-region:${sourceRegion.id}]`,
        unit: null,
        status: STATUS.OBSERVED,
        confidence: 0.6,
        evidence: [id]
      };
    }
  }

  /* -------------------------------------------------------- disagreement */

  const disagreements = detectDisagreements(records);

  /* ------------------------------------------------- mandatory unknowns */

  for (const [claimPath, reason] of Object.entries(FORBIDDEN_SUMMARY)) {
    if (claims[claimPath]) continue;
    if (unknowns.some((u) => u.claim === claimPath)) continue;
    unknowns.push({ claim: claimPath, reason });
  }

  if (!viewportKnown) {
    unknowns.push({
      claim: "meta.viewport",
      reason: "No capture viewport was supplied with the image, so rendered widths cannot be tied to CSS widths."
    });
  }

  const coverage = contentRegionCoverage(regions);

  return {
    $schemaVersion: EVIDENCE_SCHEMA_VERSION,
    referenceId,
    generatedAt: new Date().toISOString(),
    mode: "screenshot-only",
    sourceKind: SOURCE.SCREENSHOT,
    records,
    claims,
    unknowns,
    notes,
    rejected,
    disagreements,
    regions: [...regions.values()],
    regionCoverage: coverage,
    images,
    scaleKnown,
    viewportKnown
  };
}

/**
 * The claims a screenshot analysis must actively report as unknown, whether or
 * not anyone tried to observe them. Their absence is a fact about the medium,
 * and leaving them merely missing would let a reader assume they were checked.
 */
const FORBIDDEN_SUMMARY = Object.freeze({
  "layout.breakpoints":
    "Not derivable from a screenshot: a media-query breakpoint is a rule about widths that were not rendered.",
  "tokens.motion.base.duration":
    "Not derivable from a screenshot: a still frame contains no time.",
  "tokens.motion.base.easing":
    "Not derivable from a screenshot: an easing curve is a function of time.",
  "tokens.typography.body.fontFamily":
    "Not derivable from a screenshot: rendered glyphs do not identify a font file or stack.",
  "layout.zLayers":
    "Not derivable from a screenshot: z-index integers are never visible.",
  "states.focusVisible":
    "Not derivable from a screenshot unless a frame captured a focused element."
});

export { FORBIDDEN_SUMMARY };

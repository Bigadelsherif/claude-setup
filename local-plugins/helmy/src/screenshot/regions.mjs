/**
 * Screenshot region model.
 *
 * A screenshot measurement without a source region is invalid — not weak, not
 * low-confidence, *invalid*. A number with no stated origin in the image cannot
 * be checked, reproduced, or corrected, which makes it indistinguishable from
 * something a model made up.
 */

export const REGION_KIND = Object.freeze({
  FULL_PAGE: "full-page",
  HEADER: "header",
  HERO: "hero",
  NAVIGATION: "navigation",
  MAIN_CONTENT: "main-content",
  CARD: "card",
  FORM: "form",
  FOOTER: "footer",
  INTERACTION_STATE: "interaction-state"
});

export const ALL_REGION_KINDS = Object.freeze(Object.values(REGION_KIND));

export const DETECTION_METHOD = Object.freeze({
  /** Supplied by the caller — bounds are given, not guessed. */
  EXPLICIT: "explicit",
  /** Found by the analyser — the bounds are themselves an inference. */
  INFERRED: "inferred"
});

const isFiniteNumber = (n) => typeof n === "number" && Number.isFinite(n);

/**
 * Validates a region. Returns { valid, errors }.
 * Coordinates must be inside the image, because a region that runs off the edge
 * is measuring pixels that do not exist.
 */
export function validateRegion(region, image = null) {
  const errors = [];

  if (!region || typeof region !== "object") {
    return { valid: false, errors: ["region is not an object"] };
  }
  if (!region.id) errors.push("region has no id");
  if (!ALL_REGION_KINDS.includes(region.kind)) {
    errors.push(`region kind "${region.kind}" is not one of ${ALL_REGION_KINDS.join(", ")}`);
  }
  if (!Object.values(DETECTION_METHOD).includes(region.detectionMethod)) {
    errors.push(`region detectionMethod "${region.detectionMethod}" is not explicit or inferred`);
  }

  const c = region.coordinates;
  if (!c || !isFiniteNumber(c.x) || !isFiniteNumber(c.y) || !isFiniteNumber(c.width) || !isFiniteNumber(c.height)) {
    errors.push("region has no complete {x, y, width, height} coordinates");
  } else {
    if (c.width <= 0 || c.height <= 0) errors.push("region has zero or negative area");
    if (c.x < 0 || c.y < 0) errors.push("region starts outside the image");
    if (image) {
      if (c.x + c.width > image.width + 0.5) errors.push(`region exceeds image width (${c.x + c.width} > ${image.width})`);
      if (c.y + c.height > image.height + 0.5) errors.push(`region exceeds image height (${c.y + c.height} > ${image.height})`);
    }
  }

  if (region.confidence != null && (region.confidence < 0 || region.confidence > 1)) {
    errors.push("region confidence is outside 0..1");
  }

  return { valid: errors.length === 0, errors };
}

/** Normalises a region, filling derived fields and defaulting confidence. */
export function normalizeRegion(region) {
  const c = region.coordinates;
  const inferred = region.detectionMethod === DETECTION_METHOD.INFERRED;
  return {
    id: region.id,
    name: region.name ?? region.kind,
    kind: region.kind,
    image: region.image ?? null,
    coordinates: { x: c.x, y: c.y, width: c.width, height: c.height },
    dimensions: { width: c.width, height: c.height },
    detectionMethod: region.detectionMethod,
    // A detected region is a guess about where something is, so it can never be
    // more certain than a region whose bounds were given.
    confidence: region.confidence ?? (inferred ? 0.6 : 0.95),
    viewport: region.viewport ?? null,
    evidenceIds: [],
    notes: region.notes ?? null
  };
}

export function buildRegionIndex(regions = [], image = null) {
  const index = new Map();
  const rejected = [];

  for (const region of regions) {
    const { valid, errors } = validateRegion(region, image);
    if (!valid) {
      rejected.push({ region: region?.id ?? "(unnamed)", errors });
      continue;
    }
    index.set(region.id, normalizeRegion(region));
  }
  return { index, rejected };
}

/**
 * Whether the analysed regions actually cover page content.
 *
 * A screenshot analysis that only looked at the header has the same problem the
 * Stripe run had, and coverage assessment needs to see it.
 */
export function contentRegionCoverage(regions) {
  const all = [...regions.values()];
  if (!all.length) return { reached: 0, contentRegions: 0, totalRegions: 0, reason: "No valid regions were supplied or detected." };

  const contentKinds = new Set([REGION_KIND.MAIN_CONTENT, REGION_KIND.CARD, REGION_KIND.HERO, REGION_KIND.FORM]);
  const contentRegions = all.filter((r) => contentKinds.has(r.kind));

  if (!contentRegions.length) {
    return {
      reached: 0,
      contentRegions: 0,
      totalRegions: all.length,
      reason: `${all.length} region(s) analysed but none covers page content (kinds: ${[...new Set(all.map((r) => r.kind))].join(", ")}).`
    };
  }

  // A full-page region is the canvas, not a competing region. Counting it in
  // the denominator would make content coverage fall as the analysis gets more
  // thorough, which inverts the meaning of the number.
  const scoped = all.filter((r) => r.kind !== REGION_KIND.FULL_PAGE);
  const pool = scoped.length ? scoped : all;

  const contentArea = contentRegions
    .filter((r) => r.kind !== REGION_KIND.FULL_PAGE)
    .reduce((sum, r) => sum + r.dimensions.width * r.dimensions.height, 0);
  const totalArea = pool.reduce((sum, r) => sum + r.dimensions.width * r.dimensions.height, 0);
  const share = totalArea > 0 ? contentArea / totalArea : 0;

  return {
    reached: Math.min(1, Math.round(share * 1000) / 1000),
    contentRegions: contentRegions.length,
    totalRegions: all.length,
    reason: `${contentRegions.length} of ${pool.length} scoped region(s) cover page content (${Math.round(share * 100)}% of analysed area, excluding the full-page canvas).`
  };
}

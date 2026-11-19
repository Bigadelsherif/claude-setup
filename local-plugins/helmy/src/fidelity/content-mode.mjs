/**
 * Content mode — explicit, never inferred.
 *
 * Phase 3.4 measured what happens when a comparative pixel diff is run between
 * a reference and an independent implementation: 42 clusters, every one of them
 * produced by the copy differing. Comparative diffing assumes equivalent
 * content; an independent implementation does not have it.
 *
 * So the mode is an input, not a guess. `equivalent-content` unlocks the
 * comparative channel and requires all six entry conditions; anything else runs
 * `independent-content`, where the comparative channel is DISABLED rather than
 * thresholded, and intrinsic single-render checks carry the visual load.
 */

export const CONTENT_MODE = Object.freeze({
  EQUIVALENT: "equivalent-content",
  INDEPENDENT: "independent-content"
});

export const CONTENT_STATUS = Object.freeze({
  VERIFIED: "verified",
  DECLARED: "declared",
  DECLARED_UNVERIFIED: "declared-unverified",
  NOT_APPLICABLE: "not-applicable",
  REFUSED: "refused"
});

/** The six entry conditions from the plan, §5.1. */
export const ENTRY_CONDITIONS = Object.freeze([
  "content-equivalent-or-identical",
  "content-relationship-recorded",
  "viewport-metadata-compatible",
  "device-pixel-ratio-compatible",
  "fonts-and-assets-loaded",
  "animations-frozen-and-dynamic-regions-handled"
]);

/**
 * Text equivalence between two captures' primary content regions.
 *
 * Compares normalised token multisets rather than exact strings: an
 * implementation may legitimately reorder attributes or whitespace without
 * changing a word. The RATIO is returned and the threshold is applied by the
 * caller, so the number is visible rather than buried in a boolean.
 *
 * The threshold is unvalidated and is reported as such wherever it is used.
 */
export function textEquivalence(referenceRaw, targetRaw) {
  const textOf = (raw) => {
    const region = raw?.primaryRegion ?? {};
    const pieces = [];
    if (typeof region.textSample === "string") pieces.push(region.textSample);
    for (const g of raw?.repeats ?? []) {
      if (g.coherence?.childTagSequenceDiversity?.dominantValue) {
        pieces.push(g.coherence.childTagSequenceDiversity.dominantValue);
      }
    }
    return pieces.join(" ");
  };

  const tokens = (s) =>
    String(s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);

  const a = tokens(textOf(referenceRaw));
  const b = tokens(textOf(targetRaw));

  if (!a.length && !b.length) {
    return { ratio: null, comparable: false, reason: "no comparable text was recorded on either side" };
  }
  if (!a.length || !b.length) {
    return { ratio: null, comparable: false, reason: "text was recorded on only one side" };
  }

  const countOf = (arr) => arr.reduce((m, t) => m.set(t, (m.get(t) ?? 0) + 1), new Map());
  const ca = countOf(a);
  const cb = countOf(b);
  let shared = 0;
  for (const [t, n] of ca) shared += Math.min(n, cb.get(t) ?? 0);
  const ratio = (2 * shared) / (a.length + b.length);

  return { ratio: Number(ratio.toFixed(3)), comparable: true, referenceTokens: a.length, targetTokens: b.length };
}

/**
 * Regions that differ between two captures of the SAME build are dynamic by
 * construction, so they are masked automatically rather than reported.
 */
export function stabilityMasks(captureA, captureB) {
  if (!captureA || !captureB) return { performed: false, masks: [], reason: "no second capture of the target was supplied" };

  const sigOf = (raw) => new Map((raw.repeats ?? []).map((g) => [g.signature, g.count]));
  const a = sigOf(captureA);
  const b = sigOf(captureB);

  const masks = [];
  for (const [sig, count] of a) {
    if (!b.has(sig)) {
      masks.push({ selector: sig, reason: "present in one capture of the same build and absent in the other", source: "stability-check" });
    } else if (b.get(sig) !== count) {
      masks.push({ selector: sig, reason: `instance count differed between two captures of the same build (${count} vs ${b.get(sig)})`, source: "stability-check" });
    }
  }
  for (const [sig] of b) {
    if (!a.has(sig)) {
      masks.push({ selector: sig, reason: "appeared only in the second capture of the same build", source: "stability-check" });
    }
  }
  return { performed: true, masks };
}

const DEFAULT_TEXT_THRESHOLD = 0.85;

/**
 * Resolves the content mode for one viewport.
 *
 * Returns the mode actually used, its status, whether the comparative pixel
 * channel is permitted, and — when it is not — exactly which conditions were
 * unmet. A caller that asked for equivalent-content and did not get it is told
 * why rather than silently downgraded.
 */
export function resolveContentMode({
  requested,
  declaredEquivalent = false,
  declaredRelationship = null,
  referenceRaw = null,
  targetRaw = null,
  targetSecondCapture = null,
  referenceCaptureMeta = null,
  targetCaptureMeta = null,
  maskedSelectors = [],
  textEquivalenceThreshold = DEFAULT_TEXT_THRESHOLD
} = {}) {
  if (requested !== CONTENT_MODE.EQUIVALENT && requested !== CONTENT_MODE.INDEPENDENT) {
    /* No default. A missing mode is an error, not an invitation to guess. */
    return {
      mode: CONTENT_MODE.INDEPENDENT,
      status: CONTENT_STATUS.REFUSED,
      comparativePixelAllowed: false,
      requested: requested ?? null,
      verificationMethod: [],
      unmetConditions: ["no content mode was requested"],
      maskedRegions: [],
      thresholdValidated: false,
      reason:
        "No content mode was declared. The comparative pixel channel stays off: choosing it implicitly is " +
        "how copy differences become reported as layout defects."
    };
  }

  if (requested === CONTENT_MODE.INDEPENDENT) {
    return {
      mode: CONTENT_MODE.INDEPENDENT,
      status: CONTENT_STATUS.NOT_APPLICABLE,
      comparativePixelAllowed: false,
      requested,
      verificationMethod: [],
      unmetConditions: [],
      maskedRegions: [],
      thresholdValidated: false,
      reason:
        "Independent-content mode. The comparative pixel channel is disabled — not thresholded — because " +
        "the two sides legitimately render different copy. Intrinsic single-render checks carry the visual load."
    };
  }

  /* Equivalent-content requested: every condition is checked and named. */
  const unmet = [];
  const verification = [];

  const equivalence = referenceRaw && targetRaw ? textEquivalence(referenceRaw, targetRaw) : null;
  let contentEstablished = false;

  if (equivalence?.comparable && equivalence.ratio >= textEquivalenceThreshold) {
    contentEstablished = true;
    verification.push(`text-equivalence ${equivalence.ratio} >= ${textEquivalenceThreshold} (threshold unvalidated)`);
  } else if (declaredEquivalent) {
    contentEstablished = true;
    verification.push("declared by the caller, not verified");
  } else {
    unmet.push(
      equivalence?.comparable
        ? `content-equivalent-or-identical: text equivalence ${equivalence.ratio} is below ${textEquivalenceThreshold} and equivalence was not declared`
        : "content-equivalent-or-identical: equivalence was neither verified nor declared"
    );
  }

  if (!declaredRelationship) unmet.push("content-relationship-recorded: no relationship was declared");

  const refW = referenceCaptureMeta?.viewportWidth ?? null;
  const tgtW = targetCaptureMeta?.viewportWidth ?? null;
  if (refW == null || tgtW == null || refW !== tgtW) {
    unmet.push(`viewport-metadata-compatible: reference ${refW} vs target ${tgtW}`);
  }

  const refDpr = referenceCaptureMeta?.devicePixelRatio ?? null;
  const tgtDpr = targetCaptureMeta?.devicePixelRatio ?? null;
  if (refDpr == null || tgtDpr == null || refDpr !== tgtDpr) {
    /* A 1x and a 2x screenshot are not comparable and are never rescaled to
     * make them so. */
    unmet.push(`device-pixel-ratio-compatible: reference ${refDpr} vs target ${tgtDpr}`);
  }

  const ready = (m) => m?.fontsReady === true && m?.networkIdle === true;
  if (!ready(referenceCaptureMeta) || !ready(targetCaptureMeta)) {
    unmet.push("fonts-and-assets-loaded: fonts or network did not settle on one or both sides");
  }

  if (referenceCaptureMeta?.animationsFrozen !== true || targetCaptureMeta?.animationsFrozen !== true) {
    unmet.push("animations-frozen-and-dynamic-regions-handled: animations were not frozen on one or both sides");
  }

  const stability = stabilityMasks(targetRaw, targetSecondCapture);
  const masks = [
    ...maskedSelectors.map((s) => ({ selector: s, reason: "declared by the caller", source: "declared" })),
    ...(stability.masks ?? [])
  ];
  if (stability.performed) verification.push("two-capture stability check");

  const allowed = unmet.length === 0;
  const status = !allowed
    ? CONTENT_STATUS.REFUSED
    : equivalence?.comparable && equivalence.ratio >= textEquivalenceThreshold
      ? CONTENT_STATUS.VERIFIED
      : CONTENT_STATUS.DECLARED_UNVERIFIED;

  return {
    /* A refused equivalent-content request falls back to independent-content —
     * which is safe — but the refusal and its reasons travel with the result so
     * nobody reads it as a clean independent run. */
    mode: allowed ? CONTENT_MODE.EQUIVALENT : CONTENT_MODE.INDEPENDENT,
    status,
    comparativePixelAllowed: allowed,
    requested,
    verificationMethod: verification,
    unmetConditions: unmet,
    maskedRegions: masks,
    textEquivalence: equivalence,
    textEquivalenceThreshold,
    thresholdValidated: false,
    reason: allowed
      ? `Equivalent-content mode: all ${ENTRY_CONDITIONS.length} entry conditions met (${status}).`
      : `Equivalent-content was requested and refused on ${unmet.length} unmet condition(s). ` +
        "Falling back to independent-content, with the comparative pixel channel disabled."
  };
}

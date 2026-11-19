/**
 * Visual regions: what a painted interior IS, and whether it may be cropped.
 *
 * A measured section can be geometrically perfect and still say nothing about
 * what fills it. This module names that gap and, where a crop is defensible,
 * plans one. It is deliberately pure — no DOM, no browser, no filesystem — so
 * every rule here can be tested against a record rather than against a page.
 *
 * The discipline that matters most is what this module refuses to do. A crop is
 * a picture of pixels, not an understanding of them. Nothing here reads a crop,
 * infers a component from it, or lets a screenshot stand in for structure the
 * capture never established. A visual whose type cannot be determined stays
 * `unresolved` with a stated reason; that is a finding, not a failure to try
 * harder.
 */

/**
 * What is doing the painting.
 *
 * These are ORIGIN categories, not appearance categories. `css-rendered-ui`
 * does not mean "looks like a UI panel" — it means the pixels come from CSS
 * paint rather than from an asset, and therefore have no source identity to
 * record. Nothing here is inferred from how a region looks.
 */
export const VISUAL_TYPE = Object.freeze({
  IMAGE_ASSET: "image-asset",
  INLINE_SVG: "inline-svg",
  CANVAS_WEBGL_VIDEO: "canvas-webgl-video",
  CSS_RENDERED_UI: "css-rendered-ui",
  ANIMATION_DEPENDENT: "animation-dependent",
  UNRESOLVED: "unresolved"
});

/**
 * Why a visual has no usable representation.
 *
 * Every `unresolved` visual carries one of these. "We do not know" is a
 * conclusion that has to name its own cause, or it degrades into a shrug that
 * later readers mistake for "there is nothing there".
 */
export const UNRESOLVED_REASON = Object.freeze({
  NOT_VISIBLE: "not-visible-at-any-observation",
  ZERO_AREA: "zero-or-negligible-painted-area",
  UNSUPPORTED_RENDERING: "rendering-surface-cannot-be-read",
  SOURCE_UNAVAILABLE: "source-identity-unavailable",
  UNSTABLE: "geometry-unstable-across-observations",
  TOO_LARGE: "region-exceeds-crop-budget",
  /* Distinct from TOO_LARGE: nothing is wrong with this region, there was
   * simply no budget left after the larger ones were served. Collapsing the two
   * would make a resourcing decision read as a property of the page. */
  BUDGET_EXHAUSTED: "crop-budget-exhausted-larger-regions-took-priority",
  CAPTURE_UNAVAILABLE: "no-capture-capability-supplied",
  CAPTURE_FAILED: "capture-attempted-and-failed"
});

/** What actually happened when a crop was attempted. */
export const VISUAL_CAPTURE_STATUS = Object.freeze({
  CAPTURED: "captured",
  ASSET_REFERENCE: "asset-reference",
  REFUSED: "refused",
  FAILED: "failed",
  NOT_ATTEMPTED: "not-attempted"
});

/** How visible a region was at the observation being considered. */
export const VISUAL_VISIBILITY = Object.freeze({
  VISIBLE: "visible",
  CLIPPED: "partially-in-viewport",
  OFFSCREEN: "outside-viewport",
  HIDDEN: "not-rendered"
});

export const VISUAL_BUDGET = Object.freeze({
  /* A visual smaller than this is an icon or a rule, not an interior. */
  minArea: 12000,
  minWidth: 80,
  minHeight: 60,
  /* Crops are bounded so one pathological region cannot fill a disk. */
  maxCropWidth: 2048,
  maxCropHeight: 2048,
  maxCropsPerViewport: 64,
  /* A region must be at least this fraction in-viewport to be worth cropping. */
  minVisibleRatio: 0.6
});

/**
 * Confidence in the TYPE assignment — never in the content.
 *
 * A crop of a canvas would be a perfectly sharp picture of something this tool
 * cannot describe, so a high number here must never be read as understanding.
 * The values are ordered evidence strength: a tag name is decisive, a computed
 * background-image is strong, and "something is painted here and nothing
 * explains it" is weak by construction.
 */
export const TYPE_CONFIDENCE = Object.freeze({
  TAG_DECISIVE: 1,
  SOURCE_ATTRIBUTE: 0.9,
  COMPUTED_STYLE: 0.75,
  PAINT_ONLY: 0.4
});

const num = (v) => (Number.isFinite(v) ? v : null);
const area = (g) => (g && num(g.width) && num(g.height) ? g.width * g.height : 0);

/**
 * Is this candidate a visual INTERIOR rather than an icon, rule or spacer?
 *
 * Size alone decides. Reading meaning out of a class name or an element's
 * position would be exactly the inference this module exists to avoid.
 */
export function isVisualInterior(candidate, budget = VISUAL_BUDGET) {
  const g = candidate?.geometry;
  if (!g) return false;
  if (!num(g.width) || !num(g.height)) return false;
  if (g.width < budget.minWidth || g.height < budget.minHeight) return false;
  return area(g) >= budget.minArea;
}

/**
 * Assign an origin type to a painted candidate.
 *
 * Order is evidence strength, strongest first. The candidate is a record
 * gathered in the page — this function never touches a DOM node.
 */
export function classifyVisual(candidate) {
  const tag = String(candidate?.tag ?? "").toLowerCase();
  const decided = (type, confidence, unresolvedReason = null) => ({ type, confidence, unresolvedReason });

  /* A rendering surface names itself. Its pixels are produced by a program, a
   * decoder or a GPU context that this tool has no way to read back, so it is
   * typed decisively and refused just as decisively. */
  if (tag === "canvas" || tag === "video" || tag === "iframe" || tag === "object" || tag === "embed") {
    return decided(VISUAL_TYPE.CANVAS_WEBGL_VIDEO, TYPE_CONFIDENCE.TAG_DECISIVE, UNRESOLVED_REASON.UNSUPPORTED_RENDERING);
  }

  if (tag === "svg") {
    /* Inline SVG is structure, not a file. When the survey could not read its
     * markup there is no identity to record and nothing to point a builder at. */
    return candidate.svgAvailable
      ? decided(VISUAL_TYPE.INLINE_SVG, TYPE_CONFIDENCE.TAG_DECISIVE)
      : decided(VISUAL_TYPE.INLINE_SVG, TYPE_CONFIDENCE.TAG_DECISIVE, UNRESOLVED_REASON.SOURCE_UNAVAILABLE);
  }

  if (tag === "img" || tag === "picture") {
    return candidate.sourceIdentity
      ? decided(VISUAL_TYPE.IMAGE_ASSET, TYPE_CONFIDENCE.SOURCE_ATTRIBUTE)
      : decided(VISUAL_TYPE.IMAGE_ASSET, TYPE_CONFIDENCE.SOURCE_ATTRIBUTE, UNRESOLVED_REASON.SOURCE_UNAVAILABLE);
  }

  /* A CSS background image is an asset reference like any other. */
  if (candidate.backgroundImageIdentity) {
    return decided(VISUAL_TYPE.IMAGE_ASSET, TYPE_CONFIDENCE.COMPUTED_STYLE);
  }

  /* Motion was actually observed on this element. Typed before the generic CSS
   * case because a moving panel's single frame is not the panel. */
  if (candidate.animated) {
    return decided(VISUAL_TYPE.ANIMATION_DEPENDENT, TYPE_CONFIDENCE.COMPUTED_STYLE);
  }

  /* Paint with no asset behind it: gradients, borders, shadows, colour. There
   * is no source to name, so a crop is the only representation available. */
  if (candidate.paints) {
    return decided(VISUAL_TYPE.CSS_RENDERED_UI, TYPE_CONFIDENCE.COMPUTED_STYLE);
  }

  return decided(VISUAL_TYPE.UNRESOLVED, TYPE_CONFIDENCE.PAINT_ONLY, UNRESOLVED_REASON.ZERO_AREA);
}

/**
 * How much of a region sits inside the viewport at a given scroll position.
 *
 * Returned as a ratio so the caller can apply its own threshold rather than
 * being handed a yes/no somebody else decided.
 */
export function visibilityOf(geometry, observation, budget = VISUAL_BUDGET) {
  const g = geometry;
  const total = area(g);
  if (!total) return { state: VISUAL_VISIBILITY.HIDDEN, ratio: 0, cropGeometry: null };

  const scrollY = observation?.scrollY ?? 0;
  const vh = observation?.viewportHeight ?? 0;
  const vw = observation?.viewportWidth ?? 0;
  if (!vh || !vw) return { state: VISUAL_VISIBILITY.HIDDEN, ratio: 0, cropGeometry: null };

  /* Document space -> viewport space. */
  const top = g.top - scrollY;
  const bottom = top + g.height;
  const left = g.left;
  const right = left + g.width;

  const visTop = Math.max(0, top);
  const visBottom = Math.min(vh, bottom);
  const visLeft = Math.max(0, left);
  const visRight = Math.min(vw, right);

  const h = visBottom - visTop;
  const w = visRight - visLeft;
  if (h <= 0 || w <= 0) return { state: VISUAL_VISIBILITY.OFFSCREEN, ratio: 0, cropGeometry: null };

  const ratio = Math.round(((w * h) / total) * 1000) / 1000;
  const cropGeometry = { x: Math.round(visLeft), y: Math.round(visTop), width: Math.round(w), height: Math.round(h) };

  if (ratio >= 0.999) return { state: VISUAL_VISIBILITY.VISIBLE, ratio, cropGeometry };
  return { state: VISUAL_VISIBILITY.CLIPPED, ratio, cropGeometry };
}

/**
 * Pick the single observation at which a visual is best represented.
 *
 * "Best" is the largest visible fraction, and ties go to the EARLIEST
 * observation so the choice is deterministic across runs. Observations are
 * never merged: a crop belongs to one scroll state at one viewport, and
 * blending two would manufacture a frame the page never showed.
 */
export function bestObservationFor(geometry, observations, budget = VISUAL_BUDGET) {
  let best = null;
  for (const obs of observations ?? []) {
    const v = visibilityOf(geometry, obs, budget);
    if (v.ratio <= 0) continue;
    if (!best) { best = { observation: obs, visibility: v }; continue; }
    if (v.ratio > best.visibility.ratio) { best = { observation: obs, visibility: v }; continue; }
    /* Ties are broken on the observation's own ordering, not on the order the
     * caller happened to pass them in. Two runs that gather the same
     * observations in a different sequence must still choose the same frame. */
    if (v.ratio === best.visibility.ratio) {
      const rank = (o) => [
        Number.isFinite(o?.scrollIndex) ? o.scrollIndex : Number.MAX_SAFE_INTEGER,
        Number.isFinite(o?.scrollY) ? o.scrollY : Number.MAX_SAFE_INTEGER,
        String(o?.observationId ?? "")
      ];
      const [ai, ay, aid] = rank(obs);
      const [bi, by, bid] = rank(best.observation);
      if (ai < bi || (ai === bi && (ay < by || (ay === by && aid < bid)))) {
        best = { observation: obs, visibility: v };
      }
    }
  }
  return best;
}

/**
 * Decide whether a crop may be taken, and say why when it may not.
 *
 * Every refusal names a reason from `UNRESOLVED_REASON`. A silent "no" would be
 * indistinguishable from "nothing was there".
 */
export function cropDecision({ candidate, geometry, observation, visibility, canCapture, budget = VISUAL_BUDGET }) {
  const refuse = (reason) => ({ allowed: false, status: VISUAL_CAPTURE_STATUS.REFUSED, unresolvedReason: reason });

  if (!canCapture) return { allowed: false, status: VISUAL_CAPTURE_STATUS.NOT_ATTEMPTED, unresolvedReason: UNRESOLVED_REASON.CAPTURE_UNAVAILABLE };
  if (!visibility || visibility.ratio <= 0) return refuse(UNRESOLVED_REASON.NOT_VISIBLE);
  if (visibility.ratio < budget.minVisibleRatio) return refuse(UNRESOLVED_REASON.NOT_VISIBLE);
  if (!isVisualInterior(candidate, budget)) return refuse(UNRESOLVED_REASON.ZERO_AREA);

  const c = visibility.cropGeometry;
  if (!c || c.width <= 0 || c.height <= 0) return refuse(UNRESOLVED_REASON.ZERO_AREA);
  if (c.width > budget.maxCropWidth || c.height > budget.maxCropHeight) return refuse(UNRESOLVED_REASON.TOO_LARGE);

  /* A rendering surface can be photographed, but the photograph would be
   * offered as if it described the surface. It does not, so it is refused and
   * the region stays explicitly unresolved. */
  const kind = classifyVisual(candidate);
  if (kind.type === VISUAL_TYPE.CANVAS_WEBGL_VIDEO) return refuse(UNRESOLVED_REASON.UNSUPPORTED_RENDERING);

  /* Geometry that moved between observations has no single frame to crop. */
  if (candidate.unstable) return refuse(UNRESOLVED_REASON.UNSTABLE);

  return { allowed: true, status: VISUAL_CAPTURE_STATUS.CAPTURED, unresolvedReason: null };
}

/**
 * Build the crop plan for one viewport.
 *
 * Deterministic in and out: candidates are ordered by document position, the
 * budget is applied in that order, and the same input always yields the same
 * plan. Callers execute the plan; this function performs nothing.
 */
export function planVisualCaptures({ candidates, observations, canCapture = false, budget = VISUAL_BUDGET }) {
  const plan = [];
  const ordered = [...(candidates ?? [])].sort((a, b) =>
    (a.geometry?.top ?? 0) - (b.geometry?.top ?? 0) ||
    (a.geometry?.left ?? 0) - (b.geometry?.left ?? 0) ||
    String(a.domPath).localeCompare(String(b.domPath)));

  /* When the budget cannot cover every croppable region, it goes to the LARGEST
   * ones first. The budget exists to bound work, and spending it on whatever
   * happens to sit at the top of the document would leave exactly the big
   * feature interiors — the regions a clone most visibly cannot show — unspent
   * for. Rank is by painted area, ties broken on DOM path so it is stable. */
  const rank = new Map(
    [...ordered]
      .sort((a, b) => area(b.geometry) - area(a.geometry) || String(a.domPath).localeCompare(String(b.domPath)))
      .map((c, i) => [c.domPath, i])
  );

  let allowed = 0;
  for (const candidate of ordered) {
    const kind = classifyVisual(candidate);
    const geometry = candidate.geometry;
    const best = bestObservationFor(geometry, observations, budget);
    const visibility = best?.visibility ?? { state: VISUAL_VISIBILITY.HIDDEN, ratio: 0, cropGeometry: null };
    const observation = best?.observation ?? null;

    let decision = cropDecision({ candidate, geometry, observation, visibility, canCapture, budget });

    /* The budget is a cap on WORK, not a judgement about the region, so a
     * region cut off by it is refused with its own reason rather than being
     * quietly dropped. */
    if (decision.allowed && (rank.get(candidate.domPath) ?? Infinity) >= budget.maxCropsPerViewport) {
      decision = { allowed: false, status: VISUAL_CAPTURE_STATUS.REFUSED, unresolvedReason: UNRESOLVED_REASON.BUDGET_EXHAUSTED };
    }
    if (decision.allowed) allowed++;

    /* An image with a real source needs no crop: the asset itself is better
     * evidence than a photograph of it, and it is already redaction-safe. */
    const assetReference = kind.type === VISUAL_TYPE.IMAGE_ASSET && candidate.sourceIdentity
      ? { identity: candidate.sourceIdentity, intrinsic: candidate.intrinsic ?? null }
      : null;

    plan.push({
      domPath: candidate.domPath,
      tag: candidate.tag,
      type: kind.type,
      confidence: kind.confidence,
      unresolvedReason: decision.allowed ? null : (decision.unresolvedReason ?? kind.unresolvedReason),
      geometry,
      renderDimensions: candidate.renderDimensions ?? (geometry ? { width: geometry.width, height: geometry.height } : null),
      cropGeometry: decision.allowed ? visibility.cropGeometry : null,
      visibilityState: visibility.state,
      visibleRatio: visibility.ratio,
      captureStatus: assetReference && !decision.allowed ? VISUAL_CAPTURE_STATUS.ASSET_REFERENCE : decision.status,
      assetReference,
      animation: candidate.animated
        ? { observed: true, note: candidate.animationNote ?? "computed style declares a transition or animation on this element" }
        : null,
      observation: observation
        ? {
            observationId: observation.observationId ?? null,
            kind: observation.kind ?? null,
            scrollState: observation.scrollState ?? null,
            scrollIndex: observation.scrollIndex ?? null,
            scrollStep: observation.scrollStep ?? null,
            scrollY: observation.scrollY ?? null,
            viewportWidth: observation.viewportWidth ?? null,
            viewportHeight: observation.viewportHeight ?? null,
            visibilityState: observation.visibilityState ?? null,
            url: observation.url ?? null
          }
        : null,
      sourceEvidenceIds: candidate.sourceEvidenceIds ?? []
    });
  }
  return plan;
}

/**
 * Collapse the visual candidates seen across a whole scroll sweep into one set.
 *
 * A panel sighted at four scroll positions is one candidate with four
 * sightings. Sightings that disagree about its geometry mark it `unstable`,
 * which `cropDecision` then refuses — a region that moved between looks has no
 * single frame that honestly represents it.
 *
 * Shared by the crop pass and by normalization so both agree on what a
 * candidate IS; two implementations of this rule would eventually disagree, and
 * the crop would then be filed against a candidate that no longer existed.
 */
export function candidatesFromObservations(observations) {
  const byPath = new Map();
  for (const obs of observations ?? []) {
    for (const region of obs.regions ?? []) {
      for (const candidate of region.visualCandidates ?? []) {
        const key = candidate.domPath;
        const seen = byPath.get(key);
        if (!seen) {
          byPath.set(key, { ...candidate, unstable: false, sightings: 1 });
          continue;
        }
        seen.sightings++;
        const a = seen.geometry ?? {};
        const b = candidate.geometry ?? {};
        if (a.top !== b.top || a.left !== b.left || a.width !== b.width || a.height !== b.height) seen.unstable = true;
        if (candidate.animated && !seen.animated) {
          seen.animated = true;
          seen.animationNote = candidate.animationNote ?? seen.animationNote;
        }
      }
    }
  }
  return [...byPath.values()];
}

/**
 * Stable id for a visual region within one viewport.
 *
 * Viewport-scoped by construction: `v-1440-000` can never be confused with
 * `v-375-000`, which keeps the "viewports stay separate" rule structural rather
 * than a thing callers must remember.
 */
export function visualIdFor(viewportWidth, index) {
  return `v-${viewportWidth}-${String(index).padStart(3, "0")}`;
}

/**
 * Turn an executed plan into the artifact record.
 *
 * `results` maps domPath -> { hash, bytes, artifactPath, error }. A planned
 * crop with no result becomes a failure WITH a reason rather than disappearing.
 */
export function visualEvidenceFrom({ viewportWidth, plan, results = new Map(), budget = VISUAL_BUDGET }) {
  const regions = plan.map((item, i) => {
    const result = results.get(item.domPath) ?? null;
    let captureStatus = item.captureStatus;
    let unresolvedReason = item.unresolvedReason;
    let hash = null;
    let artifact = null;

    if (item.captureStatus === VISUAL_CAPTURE_STATUS.CAPTURED) {
      if (result?.error) {
        captureStatus = VISUAL_CAPTURE_STATUS.FAILED;
        unresolvedReason = UNRESOLVED_REASON.CAPTURE_FAILED;
      } else if (result?.hash) {
        hash = result.hash;
        artifact = result.artifactPath ?? null;
      } else {
        captureStatus = VISUAL_CAPTURE_STATUS.FAILED;
        unresolvedReason = UNRESOLVED_REASON.CAPTURE_FAILED;
      }
    }

    return {
      visualId: visualIdFor(viewportWidth, i),
      domPath: item.domPath,
      tag: item.tag,
      type: item.type,
      confidence: item.confidence,
      unresolvedReason,
      resolved: captureStatus === VISUAL_CAPTURE_STATUS.CAPTURED || captureStatus === VISUAL_CAPTURE_STATUS.ASSET_REFERENCE,
      geometry: item.geometry,
      renderDimensions: item.renderDimensions,
      cropGeometry: item.cropGeometry,
      /* A crop of a partly-visible region covers less than its render box. Said
       * out loud because the failure it prevents is silent: a builder that
       * scales such a crop up to `renderDimensions` produces a stretched,
       * confidently wrong picture, and nothing downstream would flag it. */
      cropIsPartial: Boolean(item.cropGeometry) && item.visibleRatio < 0.999,
      cropCoversRatio: item.cropGeometry ? item.visibleRatio : null,
      visibilityState: item.visibilityState,
      visibleRatio: item.visibleRatio,
      captureStatus,
      source: item.assetReference,
      hash,
      artifact,
      animation: item.animation,
      provenance: item.observation,
      sourceEvidenceIds: item.sourceEvidenceIds,
      /* Said once, in the artifact, so no downstream reader has to infer it. */
      interpretation: "none: this record identifies and locates a painted region and, where permitted, stores a crop of it. The pixels are not interpreted and no component structure is derived from them."
    };
  });

  const counts = { total: regions.length, resolved: 0, unresolved: 0, byType: {}, byStatus: {} };
  for (const r of regions) {
    if (r.resolved) counts.resolved++; else counts.unresolved++;
    counts.byType[r.type] = (counts.byType[r.type] ?? 0) + 1;
    counts.byStatus[r.captureStatus] = (counts.byStatus[r.captureStatus] ?? 0) + 1;
  }

  return { viewportWidth, budget: { ...budget }, regions, counts };
}

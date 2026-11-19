/**
 * Coverage assessment — stage 3 of the pipeline.
 *
 * Phase 0 computed confidence purely from claim provenance, so a run that
 * measured 6.7% of the wrong page region scored 0.71 against 0.75 for a run
 * that measured 100% of the right one. Provenance answers "was this read
 * correctly"; coverage answers "was this read from the right place". Both are
 * required, and only their product is meaningful.
 *
 * Nothing here inspects claims. It reads the capture's own account of what it
 * reached and what it skipped.
 */

const clamp01 = (n) => Math.max(0, Math.min(1, n));
/**
 * A share, or `null` when there is no denominator to divide by.
 *
 * Returning `0` for both "measured, and it is zero" and "there was nothing to
 * measure against" is the same conflation the project refuses everywhere else:
 * `stripe.com/pricing` sampled 318 header and 156 footer nodes and reported 0%
 * coverage of both, because `regionAvailable` counted no landmark elements and
 * the division silently produced a number. A reader cannot tell an unsampled
 * region from an unmeasurable one, and the second is not evidence of absence.
 *
 * Callers that need a number for arithmetic coerce explicitly at the call site,
 * so the coercion is visible rather than hidden in here.
 */
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 1000 : null);
const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * How much of the page the walk could see at all — a separate axis from
 * coverage and from confidence. See the block that computes it for why.
 */
export const OBSERVABILITY = Object.freeze({
  FULL: "full",
  PARTIAL: "partial",
  LOW: "low",
  UNMEASURABLE: "unmeasurable"
});

/** Below this share of the DOM visible, the page was largely unobserved. */
const OBSERVABILITY_LOW = 0.25;
/** Below this, some of it was. */
const OBSERVABILITY_PARTIAL = 0.75;

/** Sampling share below which a region is considered unvisited. */
const CONTENT_SHARE_TARGET = 0.35;
/** Fraction of the content region's visible nodes we want to have sampled. */
const CONTENT_DEPTH_TARGET = 0.25;

export const COVERAGE_THRESHOLDS = Object.freeze({
  unsafe: 0.25,
  insufficient: 0.5,
  warn: 0.75
});

/**
 * contentReached: did the capture actually look at the page's content?
 *
 * Zero is a hard verdict, not a low score. It means the sampler never entered
 * the primary region, or entered it and found nothing that behaves like
 * content. A zero here must dominate everything downstream.
 */
function computeContentReached({ primaryRegion, coverage, repeatsInPrimary }) {
  if (!primaryRegion) return { value: 0, reason: "No primary region was identified." };
  if (!primaryRegion.visibleDescendants) {
    return { value: 0, reason: "The primary content region has no visible descendants." };
  }

  const sampledTotal = coverage.nodesSampled || 0;
  const sampledInPrimary = coverage.sampledInPrimary || 0;

  if (sampledInPrimary === 0) {
    return { value: 0, reason: "No sampled node fell inside the primary content region." };
  }
  if (repeatsInPrimary === 0 && (primaryRegion.textLength || 0) < 200) {
    return {
      value: 0,
      reason: "The primary region contains no repeated component groups and almost no text."
    };
  }

  /* Scores, not reports: these feed the arithmetic below, so an absent
   * denominator has to become a number here. It was already 0 before `pct`
   * learned to say `null`, and the meaning is unchanged — nothing to divide by
   * scores as no coverage. */
  const share = pct(sampledInPrimary, sampledTotal) ?? 0;
  const depth = pct(sampledInPrimary, primaryRegion.visibleDescendants) ?? 0;

  const shareScore = clamp01(share / CONTENT_SHARE_TARGET);
  const depthScore = clamp01(depth / CONTENT_DEPTH_TARGET);
  const value = round3(shareScore * depthScore);

  return {
    value,
    share,
    depth,
    reason:
      value >= 0.9
        ? "The content region was sampled thoroughly."
        : `Content sampling is partial (share ${(share * 100).toFixed(1)}%, depth ${(depth * 100).toFixed(1)}%).`
  };
}

/**
 * Coverage for a screenshot-only capture.
 *
 * The DOM-based metrics have no meaning here — there are no nodes to sample and
 * no stylesheets to reach. What matters instead is how much of the image was
 * actually analysed, whether any of it was content, and whether the scale is
 * known. The coverage factor is capped below 1 by construction: a screenshot
 * analysis is never complete evidence about a page, however thorough it is.
 */
export function assessScreenshotCoverage(capture, evidence) {
  const warnings = [];
  const regions = evidence.regions ?? [];
  const regionCoverage = evidence.regionCoverage ?? { reached: 0, reason: "No regions." };
  const inferredRegions = regions.filter((r) => r.detectionMethod === "inferred");

  const contentReached = regionCoverage.reached;

  if (contentReached === 0) {
    warnings.push({ code: "content-not-reached", severity: "critical", message: regionCoverage.reason });
  }
  if (!evidence.scaleKnown) {
    warnings.push({
      code: "unknown-image-scale",
      severity: "high",
      message: "The image scale relative to CSS pixels is unknown; every pixel measurement is capped at estimated."
    });
  }
  if (!evidence.viewportKnown) {
    warnings.push({
      code: "unknown-viewport",
      severity: "high",
      message: "No capture viewport was supplied, so rendered widths cannot be tied to CSS widths."
    });
  }
  if (inferredRegions.length) {
    warnings.push({
      code: "inferred-regions",
      severity: "medium",
      message: `${inferredRegions.length} of ${regions.length} region(s) were detected rather than supplied; their bounds are themselves inferences.`
    });
  }
  if (evidence.rejected?.length) {
    warnings.push({
      code: "rejected-observations",
      severity: "medium",
      message: `${evidence.rejected.length} observation(s) or region(s) were rejected as invalid.`
    });
  }
  warnings.push({
    code: "screenshot-only",
    severity: "high",
    message: "This analysis has no DOM evidence. Declared styles, breakpoints, motion and font sources are unknowable from the image."
  });

  const regionFactor = 0.5 + 0.5 * Math.min(1, regions.length / 4);
  const scaleFactor = evidence.scaleKnown ? 1 : 0.75;
  const contentFactor = 0.2 + 0.8 * contentReached;
  // A screenshot analysis is capped: it is never complete evidence about a page.
  const SCREENSHOT_CEILING = 0.7;
  const coverageFactor = round3(Math.min(SCREENSHOT_CEILING, regionFactor * scaleFactor * contentFactor));

  return {
    nodesTotal: 0,
    nodesVisible: 0,
    nodesSampled: 0,
    sampledPercent: 0,
    visibleSampledPercent: 0,
    repeatGroupsDetected: regions.filter((r) => r.kind === "card").length,
    repeatGroupsInMain: regions.filter((r) => r.kind === "card").length,

    /* Same fields as the DOM path so consumers need no branch. A screenshot has
     * no repeat serialisation to cap and no primary-region group count. */
    repeatGroupsSerialised: 0,
    repeatGroupsCap: null,
    repeatGroupsTruncated: false,
    repeatGroupsInPrimaryRegion: null,

    contentReached,
    contentReachedReason: regionCoverage.reason,
    contentShare: contentReached,
    contentDepth: contentReached,
    headerCoverage: regions.some((r) => r.kind === "header") ? 1 : 0,
    mainCoverage: contentReached,
    footerCoverage: regions.some((r) => r.kind === "footer") ? 1 : 0,

    /* Same fields as the DOM path so consumers need no branch. A screenshot has
     * no node walk to truncate and no DOM to enumerate media from — `null` is
     * "there is no such quantity here", which is what the screenshot ceilings
     * already say about every DOM-derived claim. */
    truncated: false,
    nodeCap: null,
    /* A screenshot has no DOM, so observability is not a quantity here. */
    observability: {
      status: OBSERVABILITY.UNMEASURABLE, domObservedPercent: null,
      hiddenSkipped: 0, hiddenSubtrees: 0, hiddenDominant: false,
      reason: "This is a screenshot analysis; there is no DOM whose observability could be measured."
    },
    regionSampled: { main: null, header: null, footer: null },
    regionAvailable: { main: null, header: null, footer: null },
    mediaInPrimaryRegion: null,

    hiddenSubtrees: 0,
    hiddenNodesSkipped: 0,
    hiddenByReason: {},
    stylesheets: { total: 0, accessible: 0, blocked: 0, accessibility: 0 },
    overlays: 0,
    overlayDetail: [],
    consentBanners: 0,
    consentBannerDetail: [],
    viewport: capture.meta?.images?.[0]?.viewport ?? null,
    captureMethod: "screenshot",
    evidenceCoverage: null,
    screenshot: {
      images: evidence.images?.length ?? 0,
      regions: regions.length,
      inferredRegions: inferredRegions.length,
      rejected: evidence.rejected?.length ?? 0,
      scaleKnown: evidence.scaleKnown,
      viewportKnown: evidence.viewportKnown,
      disagreements: evidence.disagreements?.length ?? 0
    },
    factors: { node: round3(regionFactor), stylesheet: round3(scaleFactor), content: round3(contentFactor) },
    coverageFactor,
    warnings
  };
}

export function assessCoverage(raw, { evidenceCategories = null } = {}) {
  const cov = raw.coverage ?? {};
  const primaryRegion = raw.primaryRegion ?? null;
  const repeats = raw.repeats ?? [];
  const warnings = [];

  const nodesTotal = cov.nodesTotal ?? 0;
  const nodesVisible = cov.nodesVisible ?? 0;
  const nodesSampled = cov.nodesSampled ?? 0;

  const repeatGroupsDetected = repeats.length;
  const repeatGroupsInMain = repeats.filter((r) => r.inPrimary || r.region === "main").length;
  const largestRepeat = repeats[0] ?? null;

  const content = computeContentReached({
    primaryRegion,
    coverage: cov,
    repeatsInPrimary: repeatGroupsInMain
  });

  const available = cov.regionAvailable ?? {};
  const sampledBy = cov.sampledByRegion ?? {};
  /* `null` here means the denominator was missing, not that the region was
   * empty. The sampled counts travel alongside so a reader can see that a
   * region reported as unmeasurable was in fact visited. */
  const regionCoverage = {
    main: pct(cov.sampledInPrimary ?? 0, primaryRegion?.visibleDescendants ?? available.main ?? 0),
    header: pct((sampledBy.header ?? 0) + (sampledBy.nav ?? 0), available.header ?? 0),
    footer: pct(sampledBy.footer ?? 0, available.footer ?? 0)
  };
  const regionSampled = {
    main: cov.sampledInPrimary ?? 0,
    header: (sampledBy.header ?? 0) + (sampledBy.nav ?? 0),
    footer: sampledBy.footer ?? 0
  };

  const sheetsTotal = cov.sheetsTotal ?? 0;
  const sheetsAccessible = cov.sheetsAccessible ?? 0;
  const sheetsBlocked = (cov.sheetsBlocked ?? []).length;
  /* Already guarded on the denominator, so `pct` cannot return null here. */
  const stylesheetAccessibility = sheetsTotal > 0 ? pct(sheetsAccessible, sheetsTotal) : 1;

  const sampledPercent = pct(nodesSampled, nodesTotal);
  const visibleSampledPercent = pct(nodesSampled, nodesVisible);

  const evidenceCoverage = evidenceCategories
    ? pct(evidenceCategories.populated, evidenceCategories.total)
    : null;

  /* --------------------------------------------------------- the factor */

  // Visible nodes are what could legitimately be sampled; total nodes include
  // hidden subtrees we deliberately skipped, so penalising against total would
  // punish the sampler for doing the right thing.
  const nodeFactor = 0.5 + 0.5 * clamp01(visibleSampledPercent ?? 0);
  const sheetFactor = 0.7 + 0.3 * stylesheetAccessibility;
  const contentFactor = 0.2 + 0.8 * content.value;

  const coverageFactor = round3(nodeFactor * sheetFactor * contentFactor);

  /* ------------------------------------------------------------ warnings */

  if (content.value === 0) {
    warnings.push({
      code: "content-not-reached",
      severity: "critical",
      message: content.reason
    });
  } else if (content.value < 0.5) {
    warnings.push({
      code: "content-partially-reached",
      severity: "high",
      message: content.reason
    });
  }

  if (cov.truncated) {
    warnings.push({
      code: "sampling-truncated",
      severity: "medium",
      message: `${nodesVisible} visible nodes exceeded the ${cov.nodeCap} node budget; sampling is stratified but incomplete.`
    });
  }

  if (sheetsBlocked > 0) {
    warnings.push({
      code: "stylesheets-blocked",
      severity: sheetsBlocked / Math.max(sheetsTotal, 1) > 0.25 ? "high" : "medium",
      message: `${sheetsBlocked} of ${sheetsTotal} stylesheets were unreachable (cross-origin); their rules are not represented.`
    });
  }

  if (largestRepeat && !largestRepeat.inPrimary) {
    warnings.push({
      code: "largest-repeat-outside-content",
      severity: "high",
      message: `The largest repeat group \`${largestRepeat.signature}\` (${largestRepeat.count}x) sits in the ${largestRepeat.region} region, not the content region.`
    });
  }

  if ((cov.consentBanners ?? []).length) {
    warnings.push({
      code: "consent-banner-present",
      severity: "medium",
      message: `${cov.consentBanners.length} consent/cookie element(s) present; they may obscure content and distort colour frequency.`
    });
  }

  if ((cov.overlays ?? []).length > 2) {
    warnings.push({
      code: "multiple-overlays",
      severity: "low",
      message: `${cov.overlays.length} fixed/sticky overlays detected above the content.`
    });
  }

  if (primaryRegion && !primaryRegion.exists) {
    warnings.push({
      code: "no-explicit-main",
      severity: "medium",
      message: `No <main> or [role=main] element; the content region was inferred (${primaryRegion.kind}).`
    });
  }

  const hiddenSkipped = cov.hiddenNodesSkipped ?? 0;
  const hiddenDominant = hiddenSkipped > 0 && hiddenSkipped > nodesVisible;
  if (hiddenDominant) {
    warnings.push({
      code: "hidden-dominant",
      severity: "medium",
      message: `${hiddenSkipped} nodes sit in hidden or collapsed subtrees, outnumbering the ${nodesVisible} visible ones.`
    });
  }

  /* ------------------------------------------------------- observability
   *
   * A THIRD axis, kept apart from coverage and from confidence because it
   * answers a different question: not "was the visible set sampled well" and
   * not "how good is the evidence", but "how much of the page could be seen at
   * all".
   *
   * `coverageFactor` derives from `visibleSampledPercent`, and that is right —
   * penalising the sampler for correctly skipping hidden decoration is the
   * mistake this design avoids on purpose. But on a page that hides itself the
   * two come apart completely: alethia.earth measured 3 of 1205 nodes, 1202 of
   * them inside 52 hidden or collapsed subtrees, and reported
   * `Coverage factor 1.00` — arithmetically true of the visible set, and read
   * by anyone as a statement about the page (def_0050).
   *
   * So the visible-node metrics are untouched and this sits beside them.
   */
  const domObservedPercent = pct(nodesVisible, nodesTotal);
  const observability = (() => {
    if (domObservedPercent === null) {
      return {
        status: OBSERVABILITY.UNMEASURABLE, domObservedPercent: null,
        hiddenSkipped, hiddenSubtrees: cov.hiddenSubtrees ?? 0, hiddenDominant,
        reason: "No total node count was recorded, so how much of the page was observable cannot be stated."
      };
    }
    const share = domObservedPercent;
    const status = hiddenDominant || share < OBSERVABILITY_LOW ? OBSERVABILITY.LOW
      : share < OBSERVABILITY_PARTIAL ? OBSERVABILITY.PARTIAL
      : OBSERVABILITY.FULL;
    const reason = status === OBSERVABILITY.FULL
      ? `${nodesVisible} of ${nodesTotal} node(s) were visible; nothing substantial was hidden from the walk.`
      : `${nodesVisible} of ${nodesTotal} node(s) were visible (${(share * 100).toFixed(1)}%). ` +
        `${hiddenSkipped} node(s) in ${cov.hiddenSubtrees ?? 0} hidden or collapsed subtree(s) were never examined` +
        (hiddenDominant ? ", outnumbering the visible ones" : "") +
        ". Absence of anything not listed is unknown rather than established.";
    return {
      status, domObservedPercent: share,
      hiddenSkipped, hiddenSubtrees: cov.hiddenSubtrees ?? 0, hiddenDominant, reason
    };
  })();

  if (observability.status === OBSERVABILITY.LOW) {
    warnings.push({
      code: "low-observability",
      severity: "high",
      message: observability.reason
    });
  }

  return {
    nodesTotal,
    nodesVisible,
    nodesSampled,
    sampledPercent,
    visibleSampledPercent,
    repeatGroupsDetected,
    repeatGroupsInMain,

    /* `repeatGroupsDetected` is the SERIALISED count and the extractor caps its
     * list at 15, so on a large page it is a sample rather than a total. It is
     * left exactly as it was for existing consumers, and the scope is stated
     * separately instead of renamed.
     *
     * `serialised` and `inPrimaryRegion` count DIFFERENT SETS and dividing one
     * by the other produces a false ratio: p30 serialises 8 while its primary
     * region holds 7, because a nav group is serialised and is not in the
     * primary region. */
    repeatGroupsSerialised: repeats.length,
    repeatGroupsCap: 15,
    repeatGroupsTruncated: repeats.length >= 15,
    repeatGroupsInPrimaryRegion: primaryRegion?.repeatGroups ?? null,

    contentReached: content.value,
    contentReachedReason: content.reason,
    contentShare: content.share ?? 0,
    contentDepth: content.depth ?? 0,
    headerCoverage: regionCoverage.header,
    mainCoverage: regionCoverage.main,
    footerCoverage: regionCoverage.footer,

    /* Facts the capture already recorded and nothing downstream could see.
     * Without `truncated` a reader cannot tell a complete walk from one that
     * stopped at the budget, and every page-wide count in a generated prompt
     * rested on that distinction being available. */
    truncated: cov.truncated === true,
    nodeCap: cov.nodeCap ?? null,
    /* A third axis, deliberately not folded into coverageFactor (def_0050). */
    observability,
    regionSampled,
    regionAvailable: {
      main: available.main ?? null,
      header: available.header ?? null,
      footer: available.footer ?? null
    },
    /* Media the extractor counted over the whole primary region, as opposed to
     * the media it enumerated inside the sampled-node walk. On a truncated
     * capture these differ by orders of magnitude and only the first is a
     * statement about the region. */
    mediaInPrimaryRegion: primaryRegion?.mediaCount ?? null,

    hiddenSubtrees: cov.hiddenSubtrees ?? 0,
    hiddenNodesSkipped: cov.hiddenNodesSkipped ?? 0,
    hiddenByReason: cov.hiddenByReason ?? {},
    stylesheets: {
      total: sheetsTotal,
      accessible: sheetsAccessible,
      blocked: sheetsBlocked,
      accessibility: stylesheetAccessibility
    },
    overlays: (cov.overlays ?? []).length,
    overlayDetail: cov.overlays ?? [],
    consentBanners: (cov.consentBanners ?? []).length,
    consentBannerDetail: cov.consentBanners ?? [],
    viewport: raw.meta?.viewport ?? null,
    captureMethod: cov.captureMethod ?? "unknown",
    evidenceCoverage,
    factors: {
      node: round3(nodeFactor),
      stylesheet: round3(sheetFactor),
      content: round3(contentFactor)
    },
    coverageFactor,
    warnings
  };
}

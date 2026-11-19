/**
 * evidence claims -> Intermediate Representation.
 *
 * This step is pure assembly and naming. All inference already happened in the
 * evidence layer, where it could be recorded with provenance. If you find
 * yourself wanting to compute a value here, it belongs upstream.
 */

import { STATUS } from "../evidence/status.mjs";
import { deriveStructure } from "./structure.mjs";
import { deriveRepeatedStructures } from "./repeated.mjs";
import { deriveComponentDiagnostics } from "./component-diagnostics.mjs";

const IR_SCHEMA_VERSION = "0.1.0";

const EMPTY_CLAIM = (reason) => ({
  value: null,
  unit: null,
  status: STATUS.UNKNOWN,
  confidence: 0,
  evidence: [],
  reason
});

function pick(claims, path) {
  return claims[path] ?? null;
}

/** Collects claims under a prefix, keyed by the remainder of the path. */
function collect(claims, prefix) {
  const out = {};
  for (const [path, claim] of Object.entries(claims)) {
    if (!path.startsWith(prefix)) continue;
    out[path.slice(prefix.length)] = claim;
  }
  return out;
}

/** Nests "h1.fontSize" style keys one level deep. */
function nestOneLevel(flat) {
  const out = {};
  for (const [key, claim] of Object.entries(flat)) {
    const dot = key.indexOf(".");
    if (dot === -1) {
      out[key] = claim;
      continue;
    }
    const head = key.slice(0, dot);
    const tail = key.slice(dot + 1);
    (out[head] ??= {})[tail] = claim;
  }
  return out;
}

/**
 * The mean confidence of a claim list, or `null` when there is no claim to
 * average.
 *
 * The empty case returns `null` rather than `0` because those are different
 * facts and a reader acts on them differently (def_0056). `elevation: 0` reads
 * as "every shadow we scored came out at the floor"; what it actually meant was
 * "no shadow was ever established". The rest of the codebase already encodes
 * that distinction — `src/cli/present.mjs` prints `not measured` for a null,
 * `src/observe/record.mjs` counts measured against unmeasured categories — and
 * this function was the reason those branches could never be reached.
 *
 * A category whose claims genuinely average zero still returns the number `0`.
 * That is a measurement and keeps saying so.
 */
function meanConfidence(claimList) {
  const values = claimList.filter(Boolean).map((c) => c.confidence ?? 0);
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 1000) / 1000;
}

/** Walks any nested claim container and returns the flat list of claim nodes. */
function flattenClaims(node, acc = []) {
  if (!node || typeof node !== "object") return acc;
  if (Object.hasOwn(node, "status") && Object.hasOwn(node, "confidence")) {
    acc.push(node);
    return acc;
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((v) => flattenClaims(v, acc));
    else flattenClaims(value, acc);
  }
  return acc;
}

/**
 * The repeat group a modelled component was built from.
 *
 * Matched on the most specific identifier available and never on a bare tag.
 * A signature like `div` or `img` normalises to nothing and would match several
 * groups at once — the same collision that makes the diagnostics `selected` flag
 * ambiguous on class-less pages — so the full DOM path is tried first and the
 * signature only as a fallback. No match returns null, and the caller reports
 * absent geometry rather than substituting a number.
 */
function repeatGroupFor(raw, selector, stableSelector) {
  const groups = raw?.repeats ?? [];
  if (!groups.length) return null;

  /* Most specific first: a full DOM path identifies one element. */
  if (stableSelector) {
    const byPath = groups.filter((g) => g.stableSelector === stableSelector);
    if (byPath.length === 1) return byPath[0];
  }
  if (!selector) return null;

  const exact = groups.filter((g) => g.signature === selector);
  if (exact.length === 1) return exact[0];

  /* A component's selector is class-only (`.card`) while a group's signature
   * carries the tag (`article.card`), so the tag is stripped for comparison.
   * Any tie returns null: two groups that reduce to the same key are the
   * bare-tag collision that makes this kind of matching unsafe, and an unknown
   * geometry refuses the mode rather than picking one of them. */
  const stripTag = (s) => String(s ?? "").replace(/^[A-Za-z][\w-]*/, "");
  const key = stripTag(selector) || selector;
  const loose = groups.filter((g) => stripTag(g.signature) === key);
  return loose.length === 1 ? loose[0] : null;
}

/**
 * The rendered box of the element a component was modelled from.
 *
 * Promoted onto the component so requirements can judge its structural scale
 * without reading `ir.componentDiagnostics`, which no deciding code may do
 * (def_0058). Every number here is a measurement the extractor already took;
 * nothing is inferred, and an unmatched group yields null rather than zero.
 */
function componentGeometry(raw, group) {
  if (!group) return null;
  const viewportWidth = raw?.layout?.viewportWidth ?? raw?.meta?.viewport?.width ?? null;
  return {
    area: typeof group.area === "number" ? group.area : null,
    width: typeof group.sampleRect?.width === "number" ? group.sampleRect.width : null,
    height: typeof group.sampleRect?.height === "number" ? group.sampleRect.height : null,
    viewportWidth: typeof viewportWidth === "number" ? viewportWidth : null,
    status: STATUS.MEASURED
  };
}

/** A component must earn its place in the design system. */
function componentAcceptance(component, { raw, claims }) {
  const reasons = [];

  if ((component.confidence ?? 0) === 0) reasons.push("zero confidence");

  /* Anatomy now includes non-surface structure, so an unpainted component can
   * satisfy this. What it must not do is satisfy it vacuously: a component with
   * no surface AND no identity evidence is a repeated <div>, and admitting one
   * would trade the old false negative for a false positive. */
  if (!component.anatomy.length) reasons.push("no resolvable anatomy");

  if (component.identity && !component.identity.sufficient) {
    reasons.push(
      component.identity.bases.length
        ? `identity evidence is insufficient (${component.identity.reasons?.join("; ") ?? `score ${component.identity.score}`})`
        : "no identity evidence beyond repetition"
    );
  }

  const selector = component.selectors[0];
  const repeat = (raw?.repeats ?? []).find(
    (r) => signatureMatchesSelector(r.signature, selector)
  );

  if (repeat) {
    if (!repeat.inPrimary && repeat.region !== "main") {
      reasons.push(`sits in the ${repeat.region} region, outside the content region`);
    }
    if (repeat.inNavContainer) reasons.push("is a navigation structure");
    if ((repeat.count ?? 0) < 3) reasons.push("has insufficient repeated evidence");
    // Painted area is deliberately NOT checked on the repeat root: a component's
    // root is frequently a transparent wrapper around the node that paints. The
    // anatomy check above already fails a component whose surface never
    // resolved, which is the condition that actually matters.
  }

  if (claims["component.card.contentMembership"] === undefined && !repeat) {
    // no repeat metadata available; fall back to anatomy/confidence checks only
  }

  return { accepted: reasons.length === 0, reasons };
}

function signatureMatchesSelector(signature, selector) {
  if (!signature || !selector) return false;
  const asSelector = signature.includes(".")
    ? `.${signature.split(".").slice(1).join(".")}`
    : signature;
  return asSelector === selector || signature === selector;
}

export function deriveIR({ raw, evidence, probe = null, meta = {}, coverage = null, verification = null, safety = null, motionArtifactState = null }) {
  const claims = evidence.claims ?? {};

  /* ---------------------------------------------------------------- tokens */

  const colorTokens = collect(claims, "tokens.color.");
  const typographyTokens = nestOneLevel(collect(claims, "tokens.typography."));
  const spacingTokens = collect(claims, "tokens.spacing.");
  const radiusTokens = collect(claims, "tokens.radius.");
  const elevationTokens = collect(claims, "tokens.elevation.");
  const borderTokens = collect(claims, "tokens.border.");
  const motionTokens = nestOneLevel(collect(claims, "tokens.motion."));

  // The primary component's radius is a token in its own right. Same evidence,
  // surfaced under the name an implementer will actually reach for.
  const cardRadius = pick(claims, "component.card.borderRadius");
  if (cardRadius && !radiusTokens.card) {
    radiusTokens.card = { ...cardRadius };
  }

  /* ---------------------------------------------------------------- scales */

  const scales = {
    spacingBaseUnit: pick(claims, "scales.spacingBaseUnit") ?? EMPTY_CLAIM("No base unit could be inferred."),
    spacingRamp: pick(claims, "scales.spacingRamp") ?? EMPTY_CLAIM("No spacing ramp could be inferred."),
    // Emitted when no base unit is decided. A claim the mode matrix accepts as a
    // fallback must be reachable on the IR, or the requirement is unsatisfiable.
    spacingObserved: pick(claims, "scales.spacingObserved") ?? EMPTY_CLAIM("No spacing values were observed."),
    typeRamp: pick(claims, "scales.typeRamp") ?? EMPTY_CLAIM("No type ramp could be inferred."),
    radiusLadder: pick(claims, "scales.radiusLadder") ?? EMPTY_CLAIM("No radius ladder could be inferred.")
  };

  /* ---------------------------------------------------------------- layout */

  const containerMaxWidth = pick(claims, "layout.container.maxWidth");
  const containerPaddingX = pick(claims, "layout.container.paddingX");
  const containers = containerMaxWidth
    ? [
        {
          role: "page",
          maxWidth: containerMaxWidth,
          paddingX: containerPaddingX ?? EMPTY_CLAIM("Container padding was not readable."),
          centered: {
            value: true,
            unit: null,
            status: STATUS.MEASURED,
            confidence: containerMaxWidth.confidence,
            evidence: containerMaxWidth.evidence
          }
        }
      ]
    : [];

  const gridColumns = pick(claims, "layout.grid.primary.columns");
  const gridGap = pick(claims, "layout.grid.primary.gap");
  const gridSelector = pick(claims, "layout.grid.primary.selector");
  const grids = gridColumns
    ? [
        {
          role: "primary",
          selector: gridSelector?.value ?? null,
          columns: gridColumns,
          gap: gridGap ?? EMPTY_CLAIM("Grid gap was not readable.")
        }
      ]
    : [];

  const layout = {
    containers,
    grids,
    breakpoints: pick(claims, "layout.breakpoints") ?? EMPTY_CLAIM("No media-query breakpoints were reachable."),
    breakpointDetail: pick(claims, "layout.breakpointDetail") ?? EMPTY_CLAIM("No breakpoint boundaries were resolved."),
    zLayers: pick(claims, "layout.zLayers") ?? EMPTY_CLAIM("No explicit z-index layers were observed.")
  };

  /* ------------------------------------------------------------ components */

  const components = [];
  const componentCandidates = [];

  const cardSelector = pick(claims, "component.card.selector");
  if (cardSelector) {
    const anatomy = [];
    const background = pick(claims, "component.card.background");
    const padding = pick(claims, "component.card.padding");

    const surfaceClassification = pick(claims, "component.card.surfaceClassification");
    const surfaceClaim = pick(claims, "component.card.surface");
    const paintedDescendant = pick(claims, "component.card.paintedDescendant");
    const wrapperClaim = pick(claims, "component.card.wrapper");
    const identityClaim = pick(claims, "component.card.identity");
    const nonSurfaceClaim = pick(claims, "component.card.nonSurfaceProperties");
    const anatomyVerdict = pick(claims, "component.card.anatomyVerdict");

    /* Surface anatomy is attributed to whichever node actually paints. When a
     * descendant paints, saying `part: "surface"` on the component would tell
     * an implementer to put the background on the wrong element (def_0025). */
    const surfacePart = paintedDescendant?.value ? "painted-descendant" : "surface";

    /* A component whose surface was measured and found absent carries no
     * surface anatomy. `resolveSurface` still reports the values it read —
     * `transparent`, `0px` — and pushing those produced a prompt that denied
     * having a surface and then listed one (def_0029). Transparent is not a
     * background and zero is not padding, the same principle def_0004 applied
     * to token emission. */
    const noSurface = surfaceClaim != null && surfaceClaim.value == null && surfaceClaim.status !== "unknown";
    const isNonValue = (c) => {
      const v = c?.value;
      return v == null || v === 0 || v === "transparent" || v === "none" ||
        (typeof v === "string" && /^(0px\s*)+$/.test(v.trim()));
    };
    const pushSurface = (property, claim) => {
      if (!claim || noSurface || isNonValue(claim)) return;
      anatomy.push({ part: surfacePart, property, claim });
    };

    pushSurface("background", background);
    pushSurface("padding", padding);
    pushSurface("borderRadius", cardRadius);
    pushSurface("boxShadow", elevationTokens.card);
    pushSurface("border", borderTokens.default);

    /* Non-surface anatomy. Without this an unpainted component has an empty
     * anatomy array and is rejected for having none (def_0023) — the rejection
     * was never a judgement about the evidence, only about what "anatomy" was
     * defined to mean. */
    for (const prop of nonSurfaceClaim?.value ?? []) {
      anatomy.push({
        part: "structure",
        property: prop.property,
        claim: {
          value: prop.detail,
          unit: null,
          status: nonSurfaceClaim.status,
          confidence: nonSurfaceClaim.confidence ?? 0.9,
          evidence: nonSurfaceClaim.evidence ?? []
        }
      });
    }

    const instanceCount = pick(claims, "component.card.instanceCount");

    const stableSelector = pick(claims, "component.card.stableSelector");
    const unusableReason = pick(claims, "component.card.selectorUnusableReason");

    const surfaceObserved = surfaceClaim?.status !== "unknown";
    const classification = surfaceClassification?.value ?? "unknown";

    const card = {
      id: "card.primary",
      stableSelector: stableSelector?.value ?? null,
      selectorUnusableReason: unusableReason?.value ?? null,
      /* What the repeated thing IS, kept apart from the evidence that it is one
       * thing, from what it paints, from the box it sits in, and from the node
       * inside it that paints. Five facts, five fields. */
      semanticUnit: {
        value: cardSelector.value,
        status: cardSelector.status,
        confidence: cardSelector.confidence ?? 0,
        evidence: cardSelector.evidence ?? []
      },
      identity: identityClaim
        ? {
            bases: identityClaim.value.bases,
            rejectedBases: identityClaim.value.rejected,
            score: identityClaim.value.score,
            sufficient: identityClaim.value.sufficient,
            reasons: identityClaim.value.reasons ?? [],
            incoherent: !!identityClaim.value.incoherent,
            isWrapper: !!identityClaim.value.isWrapper,
            status: identityClaim.status,
            confidence: identityClaim.confidence ?? 0,
            evidence: identityClaim.evidence ?? []
          }
        : null,
      /* Explicitly null when nothing paints. Omitting it would read as "not
       * measured"; null means "measured, and there is none". */
      surface: surfaceClaim ? (surfaceClaim.value ?? null) : null,
      surfaceClassification: classification,
      surfaceObserved,
      wrapper: wrapperClaim
        ? { value: wrapperClaim.value, status: wrapperClaim.status,
            confidence: wrapperClaim.confidence ?? 0, evidence: wrapperClaim.evidence ?? [] }
        : null,
      paintedDescendant: paintedDescendant
        ? { value: paintedDescendant.value, status: paintedDescendant.status,
            confidence: paintedDescendant.confidence ?? 0, evidence: paintedDescendant.evidence ?? [] }
        : null,
      nonSurfaceProperties: nonSurfaceClaim?.value ?? [],
      anatomyVerdict: anatomyVerdict?.value ?? null,
      role: "content-card",
      selectors: [cardSelector.value].filter(Boolean),
      /* The measured box of the element this was modelled from. Read by the
       * `primary-component-admissible` requirement, which must reach the same
       * conclusion as the diagnostics without reading them (def_0058). */
      geometry: componentGeometry(
        raw,
        repeatGroupFor(raw, cardSelector.value, stableSelector?.value)
      ),
      // Kept as a claim node, not a bare number, so the spec can render it with
      // its status and evidence like every other measurement.
      instanceCount: instanceCount ?? null,
      anatomy,
      variants: [],
      states: {
        default: { status: STATUS.OBSERVED },
        hover: { status: STATUS.UNKNOWN, reason: "Not induced in Phase 0." },
        focusVisible: { status: STATUS.UNKNOWN, reason: "Not induced in Phase 0." }
      },
      responsive: {},
      motion: {},
      a11y: {},
      tokensUsed: [
        cardRadius ? "radius.card" : null,
        elevationTokens.card ? "elevation.card" : null,
        borderTokens.default ? "border.default" : null
      ].filter(Boolean),
      repetition: instanceCount
        ? { value: instanceCount.value, status: instanceCount.status,
            confidence: instanceCount.confidence ?? 0, evidence: instanceCount.evidence ?? [] }
        : null,
      evidenceIds: [
        ...(cardSelector.evidence ?? []),
        ...(identityClaim?.evidence ?? []),
        ...(surfaceClassification?.evidence ?? []),
        ...(nonSurfaceClaim?.evidence ?? []),
        ...(instanceCount?.evidence ?? [])
      ],
      /* Confidence is the mean of what was actually evidenced. Averaging over
       * five surface claims put every unpainted component at zero — not because
       * the evidence was weak but because the wrong things were being averaged
       * (def_0023). Surface claims still count when they exist. */
      confidence: meanConfidence(
        [background, padding, cardRadius, elevationTokens.card, borderTokens.default,
         identityClaim, nonSurfaceClaim, instanceCount].filter(Boolean)
      )
    };

    // A zero-confidence, anatomy-less, or navigation-derived group is a
    // candidate, not a component. Presenting one as the primary component is
    // how a navigation menu becomes a design system.
    const verdict = componentAcceptance(card, { raw, claims });
    if (verdict.accepted) {
      components.push(card);
    } else {
      componentCandidates.push({
        id: card.id,
        role: card.role,
        selectors: card.selectors,
        instanceCount: card.instanceCount?.value ?? null,
        confidence: card.confidence,
        rejectedBecause: verdict.reasons
      });
    }
  }

  const buttonMinHeight = pick(claims, "component.button.minHeight");
  if (buttonMinHeight || radiusTokens.button) {
    const anatomy = [];
    if (radiusTokens.button) anatomy.push({ part: "root", property: "borderRadius", claim: radiusTokens.button });
    if (buttonMinHeight) anatomy.push({ part: "root", property: "minHeight", claim: buttonMinHeight });

    const button = {
      id: "button.primary",
      role: "action",
      selectors: ["button"],
      instanceCount: null,
      anatomy,
      variants: [],
      states: {
        default: { status: STATUS.OBSERVED },
        hover: { status: STATUS.UNKNOWN, reason: "Not induced in Phase 0." },
        focusVisible: { status: STATUS.UNKNOWN, reason: "Not induced in Phase 0." },
        disabled: { status: STATUS.UNKNOWN, reason: "Not induced in Phase 0." }
      },
      responsive: {},
      motion: {},
      a11y: {},
      tokensUsed: [radiusTokens.button ? "radius.button" : null].filter(Boolean),
      confidence: meanConfidence([radiusTokens.button, buttonMinHeight])
    };

    const buttonVerdict = componentAcceptance(button, { raw, claims });
    if (buttonVerdict.accepted) {
      components.push(button);
    } else {
      componentCandidates.push({
        id: button.id,
        role: button.role,
        selectors: button.selectors,
        instanceCount: null,
        confidence: button.confidence,
        rejectedBecause: buttonVerdict.reasons
      });
    }
  }

  /* ---------------------------------------------------------------- motion */

  /**
   * Regroups `motion.declared.<i>.<leaf>` into one object per element.
   *
   * Same shape as the assets regrouping, and for the same reason: the claim map
   * is flat so each fact carries its own status and evidence ids, and flattening
   * them into plain values here would strip the provenance that makes any of it
   * worth rendering.
   */
  const groupIndexed = (prefix) => {
    const byIndex = new Map();
    for (const [suffix, claim] of Object.entries(collect(claims, prefix))) {
      const dot = suffix.indexOf(".");
      if (dot < 0) continue;
      const index = Number(suffix.slice(0, dot));
      if (!Number.isInteger(index)) continue;
      if (!byIndex.has(index)) byIndex.set(index, {});
      byIndex.get(index)[suffix.slice(dot + 1)] = claim;
    }
    return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([index, facts]) => ({ index, ...facts }));
  };

  const motion = {
    transitions: motionTokens.base ? [{ role: "base", ...motionTokens.base }] : [],
    keyframes: pick(claims, "motion.keyframes") ?? EMPTY_CLAIM("No keyframe rules were reachable."),

    /* Per-element DECLARED motion. Declared is the ceiling: nothing here says
     * what triggers anything, and nothing downstream may infer it. */
    declared: groupIndexed("motion.declared."),
    declaredCount: pick(claims, "motion.declaredCount")
      ?? EMPTY_CLAIM("Declared motion was not enumerated in this capture."),

    /* Keyframe rule bodies, where the sheet was same-origin and readable. */
    keyframeDetail: groupIndexed("motion.keyframeDetail."),
    keyframeDetailSummary: pick(claims, "motion.keyframeDetail")
      ?? EMPTY_CLAIM("No keyframe rule body was readable."),

    /* What happened to be in flight at capture. A sample, not an inventory. */
    runningAtCapture: pick(claims, "motion.runningAtCapture")
      ?? EMPTY_CLAIM("What was running at capture was not sampled."),

    /**
     * Observed runtime motion, from the M2a pass (M2c).
     *
     * Structurally separate from everything above it, because everything above
     * is what stylesheets DECLARE and this is what the page was seen to DO.
     *
     * `triggers` is two lists rather than one with a status field. A consumer
     * iterating a single list and reading `classification` works right up until
     * somebody forgets to read it, and the failure mode there is rendering an
     * unverified causal claim as a fact — the one thing this whole milestone
     * exists to prevent.
     *
     * `artifact` is always present, even when nothing loaded, so the IR can say
     * WHY there is no observed motion. An absent capture, a refused source and
     * a malformed file are three different statements.
     */
    observed: {
      artifact: {
        present: !!motionArtifactState && motionArtifactState.state !== "absent",
        state: motionArtifactState?.state ?? "absent",
        contractVersion: motionArtifactState?.contractVersion ?? null,
        valid: motionArtifactState?.valid ?? false,
        reason: motionArtifactState?.reason ?? "No motion-observation artifact was present."
      },
      runtime: evidence.observedMotion?.runtime ?? [],
      triggers: {
        verified: evidence.observedMotion?.triggers?.verified ?? [],
        unverified: evidence.observedMotion?.triggers?.unverified ?? []
      },
      controls: evidence.observedMotion?.controls ?? [],
      cleanup: evidence.motionCleanup ?? {},
      limitations: evidence.motionLimitations ?? []
    }
  };

  /* ---------------------------------------------------------------- assets */

  /**
   * Media elements the capture measured.
   *
   * `assets.items.<i>.<leaf>` is flat in the claim map — one claim per fact, so
   * each carries its own status and evidence ids. Here it is regrouped by index
   * into one object per element, with the claim nodes left intact. Flattening
   * them into plain values would strip the provenance, which is the only reason
   * any of this is worth rendering.
   *
   * `count` is separate from `items.length` on purpose: a capture that found no
   * media records `count` as unknown, and an empty `items` array alongside it
   * says the same thing twice without asserting anything extra.
   */
  const assets = {
    /* The fallback says "not enumerated", never "none found".
     *
     * A capture that walked the document and found nothing records a MEASURED
     * zero above, so it never reaches this line. Anything that does reach it —
     * a screenshot, chiefly — did not enumerate media at all, and stating that
     * no media exists would assert a finding nobody made. */
    count: pick(claims, "assets.count")
      ?? EMPTY_CLAIM("Media elements were not enumerated in this capture, so the count is unknown rather than zero."),
    items: groupIndexed("assets.items.")
  };

  /* ----------------------------------------------------------- a11y (light) */

  const a11y = {};
  const pageBg = colorTokens["surface.page"];
  const textPrimary = colorTokens["text.primary"];
  if (pageBg?.value && textPrimary?.value) {
    a11y.contrastFindings = [
      {
        pair: "text.primary on surface.page",
        foreground: textPrimary.value,
        background: pageBg.value,
        // computed downstream in the projection layer where color utils live
        status: STATUS.MEASURED,
        evidence: [...(textPrimary.evidence ?? []), ...(pageBg.evidence ?? [])]
      }
    ];
  }

  /* ------------------------------------------------------------ confidence */

  const tokens = {
    color: colorTokens,
    typography: typographyTokens,
    spacing: spacingTokens,
    radius: radiusTokens,
    elevation: elevationTokens,
    border: borderTokens,
    motion: motionTokens
  };

  const byCategory = {
    color: meanConfidence(flattenClaims(colorTokens)),
    typography: meanConfidence(flattenClaims(typographyTokens)),
    spacing: meanConfidence(flattenClaims(spacingTokens)),
    radius: meanConfidence(flattenClaims(radiusTokens)),
    elevation: meanConfidence(flattenClaims(elevationTokens)),
    border: meanConfidence(flattenClaims(borderTokens)),
    motion: meanConfidence(flattenClaims(motionTokens)),
    layout: meanConfidence(flattenClaims(layout)),
    scales: meanConfidence(flattenClaims(scales)),
    components: meanConfidence(components.map((c) => ({ status: STATUS.OBSERVED, confidence: c.confidence })))
  };

  /* A category is populated when it holds claims, which is now exactly the
   * condition under which it carries a number. The old predicate was `v > 0`,
   * which agreed with this on every capture in the repository because no
   * category has ever held claims averaging exactly zero — but it answered
   * "did this score above the floor" while being named for "does this hold
   * anything", and once absence became `null` the honest test is the type. */
  const populated = Object.values(byCategory).filter((v) => typeof v === "number").length;

  // Provenance confidence answers "was this read correctly".
  // Coverage answers "was this read from the right place, and how much of it".
  // Only the product is meaningful — a perfectly-read measurement of the wrong
  // page region deserves no confidence at all.
  //
  // Unknown claims are excluded from the provenance mean deliberately. They are
  // already represented in coverage, and counting them twice punishes a source
  // for gaps that are structural rather than sloppy — a screenshot cannot show
  // a breakpoint, and averaging that zero into "how well did we read what we
  // read" answers a different question than the one provenance asks.
  const provenance = meanConfidence(
    flattenClaims({ tokens, scales, layout }).filter((c) => c.status !== STATUS.UNKNOWN)
  );
  const coverageFactor = coverage?.coverageFactor ?? 1;
  /* `provenance` is null only when nothing outside the unknowns was claimed at
   * all. Multiplying that would yield 0 — JavaScript reads null as zero in
   * arithmetic — and report the strongest possible negative verdict on the
   * strength of having measured nothing, which is the failure def_0056 is
   * about. No threshold moves either way: every gate compares with `>=`, and
   * both null and 0 fail every comparison. */
  const overall = provenance == null
    ? null
    : Math.round(provenance * coverageFactor * 1000) / 1000;

  return {
    $schemaVersion: IR_SCHEMA_VERSION,
    meta: {
      slug: meta.slug ?? evidence.referenceId ?? "unknown",
      source: meta.source ?? { kind: "url", value: raw?.meta?.url ?? "unknown" },
      capturedAt: raw?.meta?.capturedAt ?? new Date().toISOString(),
      viewports: [raw?.meta?.viewport?.width ?? null].filter((v) => v != null),
      tier: meta.tier ?? "mcp-browser",
      extractorVersion: raw?.$version ?? "unknown",
      coverage: {
        categoriesPopulated: populated,
        categoriesTotal: Object.keys(byCategory).length,
        nodesSampled: raw?.coverage?.nodesSampled ?? null,
        nodesTotal: raw?.coverage?.nodesTotal ?? null,
        sheetsBlocked: raw?.coverage?.sheetsBlocked ?? [],
        mode: evidence.mode ?? "full"
      }
    },
    coverage: coverage ?? null,
    verification: verification ?? null,
    safety: safety ?? null,
    tokens,
    scales,
    layout,
    responsive: {},
    components,
    componentCandidates,
    motion,
    assets,
    ux: {},
    /* Landmarks and section order, read from evidence the capture already
     * held. `null` when there is no DOM to read it from. */
    structure: deriveStructure(raw),
    /* Repeated element groups reported as themselves. Deliberately NOT in
     * `components`: the component gate reads that array, and a repeated
     * structure must be unable to satisfy it by construction rather than by
     * a check that could be forgotten. */
    repeatedStructures: deriveRepeatedStructures(raw, components),
    /* Explanatory only. Nothing that decides anything may read this — not
     * selection, not a gate, not coverage, not confidence, not a projection
     * that emits a prompt. `phase527` asserts that structurally. */
    componentDiagnostics: deriveComponentDiagnostics(raw, probe, components),
    a11y,
    brand: {
      assets: [],
      policy: "Brand identity assets are not reproduced. Placeholders are emitted in their place."
    },
    confidence: {
      byCategory,
      provenance,
      coverageFactor,
      overall
    },
    unknowns: evidence.unknowns ?? []
  };
}

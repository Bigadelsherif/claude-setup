/**
 * Category-level comparison — the load-bearing mechanism after Test 19.
 *
 * def_0030 established that component matching across implementations is
 * precise (1.000) and incomplete (recall 0.444). Comparison therefore runs per
 * category over claims that exist independently of component identity —
 * containers, grids, scales, tokens, motion, accessibility — and reports
 * component identity separately as resolved or unresolved.
 *
 * Every category reports score AND evidenceCoverage, never their product. A
 * perfect score over two of nine dimensions is not the claim a perfect score
 * over nine of nine makes, and collapsing them is the error def_0002 was filed
 * for.
 */

import * as color from "../util/color.mjs";
import {
  CATEGORY, SEVERITY, TOLERANCES, admissibility, severityFor, difference, skipped
} from "./compare.mjs";

const claim = (node) => (node && typeof node === "object" && "value" in node ? node : null);

/** Numeric comparison shared by most dimensions. */
function compareNumeric({ dimension, category, reference, target, tolerance, toleranceSource, unit = "px",
                          affects, correction, automatic = false, notAutomatic = null, contested, degradedOk = false }) {
  const adm = admissibility(reference, target, { supportsDegradedEvidence: degradedOk, contested });
  if (!adm.admissible) return { skipped: skipped(dimension, category, adm.reason) };

  const a = Number(reference.value);
  const b = Number(target.value);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { skipped: skipped(dimension, category, "value is not numeric on one side") };
  }

  const absolute = b - a;
  if (Math.abs(absolute) <= tolerance) return { agreed: dimension };

  const severity = severityFor({
    referenceStatus: reference.status, targetStatus: target.status,
    ratioOverTolerance: Math.abs(absolute) / Math.max(tolerance, 0.0001),
    degraded: adm.degraded
  });

  return {
    difference: difference({
      dimension, category, reference, target, absolute, unit, tolerance, toleranceSource,
      severity, affects,
      recommendedCorrection: correction(a, b),
      automaticallyActionable: automatic,
      notActionableBecause: automatic ? null : notAutomatic
    })
  };
}

function compareColor({ dimension, role, reference, target, contested }) {
  const adm = admissibility(reference, target, { contested });
  if (!adm.admissible) return { skipped: skipped(dimension, CATEGORY.COLOR, adm.reason) };

  const distance = color.distance?.(reference.value, target.value);
  if (distance == null) return { skipped: skipped(dimension, CATEGORY.COLOR, "colour distance unavailable") };
  if (distance <= TOLERANCES.colorDistance) return { agreed: dimension };

  return {
    difference: difference({
      dimension, category: CATEGORY.COLOR, reference, target,
      absolute: Number(distance.toFixed(2)), unit: "ΔE",
      tolerance: TOLERANCES.colorDistance, toleranceSource: "TOLERANCE.colorDistance",
      severity: severityFor({
        referenceStatus: reference.status, targetStatus: target.status,
        ratioOverTolerance: distance / TOLERANCES.colorDistance, degraded: adm.degraded
      }),
      affects: { kind: "token", id: `color.${role}` },
      recommendedCorrection: `Set the \`${role}\` colour token to \`${reference.value}\`; the target uses \`${target.value}\`.`,
      automaticallyActionable: true
    })
  };
}

/* ------------------------------------------------------------ categories */

function regionCoverage(ref, tgt) {
  const dims = [];
  const refReach = ref.coverage?.contentReached;
  const tgtReach = tgt.coverage?.contentReached;

  if (refReach == null || tgtReach == null) {
    dims.push({ skipped: skipped("coverage.contentReached", CATEGORY.REGION_COVERAGE, "not recorded on one side") });
  } else if (tgtReach >= refReach - 0.001) {
    dims.push({ agreed: "coverage.contentReached" });
  } else {
    dims.push({
      difference: difference({
        dimension: "coverage.contentReached", category: CATEGORY.REGION_COVERAGE,
        reference: { value: refReach, status: "measured", confidence: 1, evidence: [] },
        target: { value: tgtReach, status: "measured", confidence: 1, evidence: [] },
        absolute: tgtReach - refReach, unit: "ratio", tolerance: 0, toleranceSource: "exact",
        severity: SEVERITY.CRITICAL,
        affects: { kind: "region", id: "content" },
        recommendedCorrection: "The target's content region was not fully reached. Investigate before comparing anything else — every other category is measured over a smaller sample than the reference.",
        automaticallyActionable: false,
        notActionableBecause: ["a coverage shortfall is a capture or structure problem, not a value to set"]
      })
    });
  }
  return dims;
}

function layout(ref, tgt, contested) {
  const dims = [];
  const refPage = (ref.layout?.containers ?? []).find((c) => c.role === "page");
  const tgtPage = (tgt.layout?.containers ?? []).find((c) => c.role === "page");

  dims.push(compareNumeric({
    dimension: "layout.container.maxWidth", category: CATEGORY.LAYOUT,
    reference: claim(refPage?.maxWidth), target: claim(tgtPage?.maxWidth),
    tolerance: TOLERANCES.px, toleranceSource: "TOLERANCE.px",
    affects: { kind: "region", id: "content-container" },
    correction: (a) => `Set the primary content container max-width to ${a}px and preserve the horizontal padding below the max-width threshold.`,
    automatic: true, contested
  }));

  dims.push(compareNumeric({
    dimension: "layout.container.paddingX", category: CATEGORY.LAYOUT,
    reference: claim(refPage?.paddingX), target: claim(tgtPage?.paddingX),
    tolerance: TOLERANCES.px, toleranceSource: "TOLERANCE.px",
    affects: { kind: "region", id: "content-container" },
    correction: (a) => `Set the content container horizontal padding to ${a}px.`,
    automatic: true, contested
  }));

  const refGrid = (ref.layout?.grids ?? [])[0];
  const tgtGrid = (tgt.layout?.grids ?? [])[0];

  dims.push(compareNumeric({
    dimension: "layout.grid.columns", category: CATEGORY.LAYOUT,
    reference: claim(refGrid?.columns), target: claim(tgtGrid?.columns),
    tolerance: 0, toleranceSource: "exact", unit: "columns",
    affects: { kind: "region", id: "primary-grid" },
    correction: (a) => `Set the primary grid to ${a} columns at this viewport.`,
    automatic: true, contested
  }));

  dims.push(compareNumeric({
    dimension: "layout.grid.gap", category: CATEGORY.LAYOUT,
    reference: claim(refGrid?.gap), target: claim(tgtGrid?.gap),
    tolerance: TOLERANCES.px, toleranceSource: "TOLERANCE.px",
    affects: { kind: "region", id: "primary-grid" },
    correction: (a) => `Set the primary grid gap to ${a}px.`,
    automatic: true, contested
  }));

  return dims;
}

function typography(ref, tgt, contested) {
  const dims = [];
  const pairs = [
    ["tokens.typography.body.fontSize", ref.tokens?.typography?.body?.fontSize, tgt.tokens?.typography?.body?.fontSize, TOLERANCES.fontSizePx],
    ["tokens.typography.body.lineHeight", ref.tokens?.typography?.body?.lineHeight, tgt.tokens?.typography?.body?.lineHeight, TOLERANCES.fontSizePx]
  ];
  for (const [dimension, r, t, tol] of pairs) {
    dims.push(compareNumeric({
      dimension, category: CATEGORY.TYPOGRAPHY, reference: claim(r), target: claim(t),
      tolerance: tol, toleranceSource: "TOLERANCES.fontSizePx",
      affects: { kind: "token", id: dimension },
      correction: (a) => `Set ${dimension.split(".").slice(-2).join(" ")} to ${a}px.`,
      automatic: true, contested
    }));
  }

  /* The RAMP is compared as a shape, not value by value: a target built on the
   * same ladder is faithful even where one step is unused. */
  const refRamp = ref.scales?.typeRamp ?? null;
  const tgtRamp = tgt.scales?.typeRamp ?? null;
  if (!Array.isArray(refRamp) || !Array.isArray(tgtRamp)) {
    dims.push({ skipped: skipped("scales.typeRamp", CATEGORY.TYPOGRAPHY, "type ramp missing on one side") });
  } else {
    const missing = refRamp.filter((v) => !tgtRamp.some((w) => Math.abs(w - v) <= TOLERANCES.fontSizePx));
    if (!missing.length) dims.push({ agreed: "scales.typeRamp" });
    else {
      dims.push({
        difference: difference({
          dimension: "scales.typeRamp", category: CATEGORY.TYPOGRAPHY,
          reference: { value: refRamp.join(", "), status: "inferred", confidence: 0.8, evidence: [] },
          target: { value: tgtRamp.join(", "), status: "inferred", confidence: 0.8, evidence: [] },
          absolute: missing.length, unit: "steps",
          tolerance: 0, toleranceSource: "exact",
          severity: SEVERITY.MEDIUM,
          affects: { kind: "scale", id: "typeRamp" },
          recommendedCorrection: `The target's type ramp is missing ${missing.join(", ")}px. Add the missing steps or confirm they are genuinely unused.`,
          automaticallyActionable: false,
          notActionableBecause: ["a ramp step cannot be added without knowing which elements should use it — product judgement"]
        })
      });
    }
  }
  return dims;
}

function spacing(ref, tgt, contested) {
  /* The plan's "section spacing" dimension does not exist in the IR. What does
   * exist is the spacing SYSTEM, and comparing that is better founded: a target
   * on the same base with the same ramp is faithful even where one gap differs.
   * See docs/fidelity-plan-validation.md. */
  const dims = [];
  dims.push(compareNumeric({
    dimension: "scales.spacingBaseUnit", category: CATEGORY.SPACING,
    reference: claim(ref.scales?.spacingBaseUnit), target: claim(tgt.scales?.spacingBaseUnit),
    tolerance: 0, toleranceSource: "exact",
    affects: { kind: "scale", id: "spacingBaseUnit" },
    correction: (a) => `Rebuild spacing on a ${a}px base unit.`,
    automatic: false,
    notAutomatic: ["changing the spacing base rewrites every spacing value in the implementation"],
    contested
  }));

  const refRamp = ref.scales?.spacingRamp;
  const tgtRamp = tgt.scales?.spacingRamp;
  if (!Array.isArray(refRamp) || !Array.isArray(tgtRamp)) {
    dims.push({ skipped: skipped("scales.spacingRamp", CATEGORY.SPACING, "spacing ramp missing on one side") });
  } else {
    const missing = refRamp.filter((v) => !tgtRamp.includes(v));
    if (!missing.length) dims.push({ agreed: "scales.spacingRamp" });
    else dims.push({
      difference: difference({
        dimension: "scales.spacingRamp", category: CATEGORY.SPACING,
        reference: { value: refRamp.join(", "), status: "inferred", confidence: 0.8, evidence: [] },
        target: { value: tgtRamp.join(", "), status: "inferred", confidence: 0.8, evidence: [] },
        absolute: missing.length, unit: "steps", tolerance: 0, toleranceSource: "exact",
        severity: SEVERITY.LOW,
        affects: { kind: "scale", id: "spacingRamp" },
        recommendedCorrection: `The target does not use ${missing.join(", ")}px from the reference ramp. This is often legitimate — a ramp step is unused, not wrong.`,
        automaticallyActionable: false,
        notActionableBecause: ["an unused ramp step is not necessarily a defect"]
      })
    });
  }
  return dims;
}

function colors(ref, tgt, contested) {
  const roles = new Set([...Object.keys(ref.tokens?.color ?? {}), ...Object.keys(tgt.tokens?.color ?? {})]);
  return [...roles].map((role) => compareColor({
    dimension: `tokens.color.${role}`, role,
    reference: claim(ref.tokens?.color?.[role]), target: claim(tgt.tokens?.color?.[role]),
    contested
  }));
}

function components(ref, tgt, contested, matchReport) {
  const dims = [];
  const refCard = (ref.components ?? []).find((c) => c.id === "card.primary");
  const tgtCard = (tgt.components ?? []).find((c) => c.id === "card.primary");

  if (!refCard || !tgtCard) {
    dims.push({ skipped: skipped("components.card", CATEGORY.COMPONENTS,
      !refCard ? "no primary component in the reference" : "no primary component in the target") });
    return dims;
  }

  /* Instance count is compared with generous tolerance: content length varies
   * legitimately between a reference and an implementation. */
  const refCount = claim(refCard.instanceCount);
  const tgtCount = claim(tgtCard.instanceCount);
  if (refCount && tgtCount) {
    const hi = Math.max(refCount.value, tgtCount.value);
    const lo = Math.min(refCount.value, tgtCount.value);
    if (hi === 0 || lo / hi >= 1 - TOLERANCES.countRelative) dims.push({ agreed: "components.card.instanceCount" });
    else dims.push({
      difference: difference({
        dimension: "components.card.instanceCount", category: CATEGORY.COMPONENTS,
        reference: refCount, target: tgtCount,
        absolute: tgtCount.value - refCount.value, unit: "instances",
        tolerance: TOLERANCES.countRelative, toleranceSource: "TOLERANCES.countRelative",
        severity: SEVERITY.LOW,
        affects: { kind: "component", id: "card.primary" },
        recommendedCorrection: "Instance counts differ by more than content variation explains. Confirm the same set of items is being rendered.",
        automaticallyActionable: false,
        notActionableBecause: ["how many instances to render is a content decision"]
      })
    });
  } else {
    dims.push({ skipped: skipped("components.card.instanceCount", CATEGORY.COMPONENTS, "instance count unknown on one side") });
  }

  /* Surface classification, with the Phase 3.3 asymmetry. */
  dims.push(compareSurface(refCard, tgtCard));

  /* Component identity is REPORTED, never assumed. def_0030. */
  dims.push({
    identity: {
      dimension: "components.card.identity",
      resolved: matchReport?.resolved ?? false,
      detail: matchReport?.detail ?? "Component-level matching was not relied upon; see def_0030.",
      automaticCorrectionBlocked: true
    }
  });

  return dims;
}

/**
 * The unpainted asymmetry from Phase 3.3.
 *
 * A target that lacks a surface the reference also lacks is correct. A target
 * that INVENTS one is not, unless the brief asked for it.
 */
export function compareSurface(refCard, tgtCard, { briefRequestsSurface = false } = {}) {
  const dimension = "components.card.surfaceClassification";
  const refObserved = refCard.surfaceObserved === true;
  const tgtObserved = tgtCard.surfaceObserved === true;
  const refPaints = refObserved && refCard.surface != null;
  const tgtPaints = tgtObserved && tgtCard.surface != null;

  if (!refObserved || !tgtObserved) {
    return { skipped: skipped(dimension, CATEGORY.COMPONENTS,
      "surface was not observed on one side; `surface: unknown` is not comparable") };
  }

  if (!refPaints && !tgtPaints) return { agreed: dimension };

  if (!refPaints && tgtPaints) {
    return {
      difference: difference({
        dimension, category: CATEGORY.COMPONENTS,
        reference: { value: refCard.surfaceClassification, status: "observed", confidence: 0.95, evidence: refCard.evidenceIds ?? [] },
        target: { value: tgtCard.surfaceClassification, status: "observed", confidence: 0.95, evidence: tgtCard.evidenceIds ?? [] },
        absolute: 1, unit: "classification", tolerance: 0, toleranceSource: "exact",
        severity: briefRequestsSurface ? SEVERITY.INFORMATIONAL : SEVERITY.HIGH,
        affects: { kind: "component", id: "card.primary" },
        recommendedCorrection: briefRequestsSurface
          ? "The target adds a surface the reference does not have. The brief requested this, so it is a target decision, not a fidelity defect."
          : "The target paints a surface the reference does not have. Remove the background, border, radius and shadow; the reference separates instances by spacing and typography alone.",
        automaticallyActionable: false,
        notActionableBecause: ["removing a surface changes visual hierarchy and needs review"],
        note: briefRequestsSurface ? "Target decision, not reference evidence." : null
      })
    };
  }

  if (refPaints && !tgtPaints) {
    return {
      difference: difference({
        dimension, category: CATEGORY.COMPONENTS,
        reference: { value: refCard.surfaceClassification, status: "observed", confidence: 0.95, evidence: refCard.evidenceIds ?? [] },
        target: { value: tgtCard.surfaceClassification, status: "observed", confidence: 0.95, evidence: tgtCard.evidenceIds ?? [] },
        absolute: -1, unit: "classification", tolerance: 0, toleranceSource: "exact",
        severity: SEVERITY.HIGH,
        affects: { kind: "component", id: "card.primary" },
        recommendedCorrection: `The reference component has a ${refCard.surfaceClassification} surface and the target has none. Apply the reference's surface treatment.`,
        automaticallyActionable: false,
        notActionableBecause: ["no deploy-safe selector is guaranteed for the target component"]
      })
    };
  }

  /* Both paint. Right pixels on the wrong element is its own finding. */
  if (refCard.surfaceClassification !== tgtCard.surfaceClassification) {
    const wrongElement =
      (refCard.surfaceClassification === "descendant-painted") !== (tgtCard.surfaceClassification === "descendant-painted");
    return {
      difference: difference({
        dimension, category: CATEGORY.COMPONENTS,
        reference: { value: refCard.surfaceClassification, status: "observed", confidence: 0.95, evidence: [] },
        target: { value: tgtCard.surfaceClassification, status: "observed", confidence: 0.95, evidence: [] },
        absolute: 1, unit: "classification", tolerance: 0, toleranceSource: "exact",
        severity: wrongElement ? SEVERITY.MEDIUM : SEVERITY.INFORMATIONAL,
        affects: { kind: "component", id: "card.primary" },
        recommendedCorrection: wrongElement
          ? "The surface is painted on a different element than in the reference. The rendered result may match today and will diverge the moment the wrapper is restyled."
          : "Surface classifications differ in kind. The text-only/layout-only distinction turns on subtree text and is fragile.",
        automaticallyActionable: false,
        notActionableBecause: ["moving a surface between elements needs review"]
      })
    };
  }

  return { agreed: dimension };
}

function motion(ref, tgt, contested) {
  const refT = (ref.motion?.transitions ?? [])[0];
  const tgtT = (tgt.motion?.transitions ?? [])[0];
  const dims = [];
  dims.push(compareNumeric({
    dimension: "motion.transition.duration", category: CATEGORY.MOTION,
    reference: claim(refT?.duration), target: claim(tgtT?.duration),
    tolerance: TOLERANCES.ms, toleranceSource: "TOLERANCE.ms", unit: "ms",
    affects: { kind: "token", id: "motion.base.duration" },
    correction: (a) => `Set the base transition duration to ${a}ms.`,
    automatic: true, contested
  }));
  return dims;
}

function accessibility(ref, tgt) {
  const refFindings = ref.a11y?.contrastFindings ?? [];
  const tgtFindings = tgt.a11y?.contrastFindings ?? [];
  if (!refFindings.length || !tgtFindings.length) {
    return [{ skipped: skipped("a11y.contrast", CATEGORY.ACCESSIBILITY, "no contrast findings on one side") }];
  }
  const refRatio = color.contrast(refFindings[0].foreground, refFindings[0].background);
  const tgtRatio = color.contrast(tgtFindings[0].foreground, tgtFindings[0].background);
  if (refRatio == null || tgtRatio == null) {
    return [{ skipped: skipped("a11y.contrast", CATEGORY.ACCESSIBILITY, "contrast ratio unavailable") }];
  }
  if (Math.abs(refRatio - tgtRatio) <= TOLERANCES.contrastRatio) return [{ agreed: "a11y.contrast" }];
  return [{
    difference: difference({
      dimension: "a11y.contrast", category: CATEGORY.ACCESSIBILITY,
      reference: { value: refRatio, status: "measured", confidence: 1, evidence: refFindings[0].evidence ?? [] },
      target: { value: tgtRatio, status: "measured", confidence: 1, evidence: tgtFindings[0].evidence ?? [] },
      absolute: tgtRatio - refRatio, unit: "ratio",
      tolerance: TOLERANCES.contrastRatio, toleranceSource: "TOLERANCES.contrastRatio",
      severity: tgtRatio < 4.5 ? SEVERITY.HIGH : SEVERITY.LOW,
      affects: { kind: "token", id: "text.primary on surface.page" },
      recommendedCorrection: tgtRatio < 4.5
        ? `Body text contrast is ${tgtRatio}:1 in the target, below the 4.5:1 AA threshold. The reference measures ${refRatio}:1.`
        : `Body text contrast differs (${tgtRatio}:1 vs ${refRatio}:1); both clear AA.`,
      automaticallyActionable: false,
      notActionableBecause: ["changing a text or background colour to fix contrast is a design decision"]
    })
  }];
}

/* -------------------------------------------------------------- assembly */

function scoreCategory(category, dims, totalDimensions) {
  const differences = dims.filter((d) => d.difference).map((d) => d.difference);
  const agreed = dims.filter((d) => d.agreed).length;
  const skippedDims = dims.filter((d) => d.skipped).map((d) => d.skipped);
  const admissible = agreed + differences.length;

  const severityBreakdown = { critical: 0, high: 0, medium: 0, low: 0, informational: 0 };
  for (const d of differences) severityBreakdown[d.severity]++;

  const confidences = differences.map((d) => d.confidence).filter((c) => c > 0);

  return {
    category,
    /* null, not 0, when nothing was comparable. Zero would read as total
     * disagreement; null says the question was not asked. */
    score: admissible === 0 ? null : Number((agreed / admissible).toFixed(3)),
    evidenceCoverage: totalDimensions === 0 ? 0 : Number((admissible / totalDimensions).toFixed(3)),
    admissibleComparisons: admissible,
    totalDimensions,
    mismatches: differences.length,
    severityBreakdown,
    unresolvedClaims: skippedDims.map((s) => `${s.dimension} (${s.reason})`),
    confidence: confidences.length ? Number((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(3)) : null,
    differences
  };
}

/**
 * Compares two IRs and returns per-category scores and every difference.
 *
 * `matchReport` is optional and advisory only — component identity is reported,
 * never used to gate a correction (def_0030).
 */
export function compareIRs(referenceIR, targetIR, { matchReport = null, briefRequestsSurface = false } = {}) {
  const contested = new Set((referenceIR.contestedClaims ?? []).map((c) => c.claim ?? c));

  const groups = [
    [CATEGORY.REGION_COVERAGE, regionCoverage(referenceIR, targetIR), 1],
    [CATEGORY.LAYOUT, layout(referenceIR, targetIR, contested), 4],
    [CATEGORY.TYPOGRAPHY, typography(referenceIR, targetIR, contested), 3],
    [CATEGORY.SPACING, spacing(referenceIR, targetIR, contested), 2],
    [CATEGORY.COLOR, colors(referenceIR, targetIR, contested), Math.max(Object.keys(referenceIR.tokens?.color ?? {}).length, 1)],
    [CATEGORY.COMPONENTS, components(referenceIR, targetIR, contested, matchReport), 3],
    [CATEGORY.MOTION, motion(referenceIR, targetIR, contested), 1],
    [CATEGORY.ACCESSIBILITY, accessibility(referenceIR, targetIR), 1],
    /* Structurally unavailable at one viewport — see the plan validation. */
    [CATEGORY.STATES, [{ skipped: skipped("components.states", CATEGORY.STATES, "interaction states are `unknown` on both sides; not induced") }], 1],
    [CATEGORY.RESPONSIVE, [{ skipped: skipped("responsive.breakpoints", CATEGORY.RESPONSIVE, "single-viewport run; responsive evidence is empty") }], 1]
  ];

  const categories = groups.map(([name, dims, total]) => scoreCategory(name, dims, total));
  const identity = groups
    .flatMap(([, dims]) => dims)
    .filter((d) => d.identity)
    .map((d) => d.identity);

  return {
    categories,
    componentIdentity: identity,
    differences: categories.flatMap((c) => c.differences),
    compositeScore: null,
    compositeScoreNote:
      "No composite score is produced. Weighting the categories would require measured evidence that does not exist."
  };
}

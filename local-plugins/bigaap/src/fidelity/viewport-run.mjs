/**
 * Per-viewport fidelity run.
 *
 * Each viewport produces a complete, independent record. Nothing is averaged
 * across viewports and no composite is produced at any level — reporting one
 * number across four viewports would hide a broken 375px layout behind three
 * that work.
 *
 * This module also splits the Phase 3.4 `pixel-only` category in two:
 *
 *   intrinsic-visual              single-render target checks, always available
 *   comparative-pixel-residue     needs equivalent content, usually absent
 *
 * Merging them meant an independent-content run reported a `pixel-only` score
 * derived entirely from intrinsic checks while looking as though a comparative
 * diff had happened.
 */

import { compareIRs } from "./categories.mjs";
import { checkReference, checkTarget, blockedReport } from "./gates.mjs";
import { generateTasks, resetTaskIds } from "./tasks.mjs";
import { resetDiffIds, SEVERITY } from "./compare.mjs";
import {
  attributedRegions, classifyClusters, normalisationContract, pixelReport
} from "./pixel.mjs";
import { resolveContentMode, CONTENT_MODE } from "./content-mode.mjs";
import { compareState, scoreStates } from "./states.mjs";
import { componentIdentityReport, deriveTargetIR } from "./run.mjs";
import { shortHash } from "./history.mjs";

/**
 * Intrinsic findings, promoted to the new record shape.
 *
 * A rule the reference also exhibits is demoted to informational and marked
 * `reference-correlated`: a target reproducing the reference's condition is
 * reproducing the reference, not diverging from it.
 */
export function buildIntrinsicFindings({ targetChecks, referenceChecks, viewport }) {
  const referenceRules = new Set((referenceChecks?.findings ?? []).map((f) => f.rule));
  const findings = (targetChecks?.findings ?? []).map((f, i) => {
    const correlated = referenceRules.has(f.rule);
    return {
      id: `intrinsic_${viewport}_${String(i + 1).padStart(3, "0")}`,
      rule: f.rule,
      viewport,
      targetEvidence: {
        selector: f.selector ?? null,
        occludedBy: f.occludedBy ?? null,
        detail: f.detail ?? null
      },
      affectedRegion: f.box ?? null,
      detectionMethod: f.rule === "stacking-order-inverted" ? "hit-test" : "box-measurement",
      severity: correlated ? SEVERITY.INFORMATIONAL : SEVERITY.MEDIUM,
      confidence: 0.95,
      actionable: !correlated,
      correlation: correlated ? "reference-correlated" : "target-only",
      note: correlated
        ? "The reference exhibits the same condition, so this is not a divergence from it."
        : "An intrinsic property of the target's own render. No reference comparison was needed."
    };
  });

  return {
    findings,
    checkedElements: targetChecks?.checkedElements ?? 0,
    referenceCheckedElements: referenceChecks?.checkedElements ?? null,
    ran: !!targetChecks
  };
}

function intrinsicCategory(intrinsic) {
  if (!intrinsic.ran) {
    return {
      category: "intrinsic-visual",
      score: null, evidenceCoverage: 0, mismatchCount: 0,
      severityDistribution: { critical: 0, high: 0, medium: 0, low: 0, informational: 0 },
      unresolvedClaims: ["intrinsic checks did not run for this viewport"],
      confidence: null, blockers: [], limitations: []
    };
  }
  const actionable = intrinsic.findings.filter((f) => f.actionable);
  const distribution = { critical: 0, high: 0, medium: 0, low: 0, informational: 0 };
  for (const f of intrinsic.findings) distribution[f.severity]++;

  return {
    category: "intrinsic-visual",
    score: actionable.length === 0 ? 1 : 0,
    evidenceCoverage: 1,
    mismatchCount: actionable.length,
    severityDistribution: distribution,
    unresolvedClaims: [],
    confidence: 0.95,
    blockers: [],
    limitations: [
      "Three of the plan's thirteen checks are implemented: viewport overflow, text clipping and stacking inversion."
    ]
  };
}

function residueCategory(pixel, contentMode) {
  if (!contentMode.comparativePixelAllowed) {
    return {
      category: "comparative-pixel-residue",
      score: null, evidenceCoverage: 0, mismatchCount: 0,
      severityDistribution: { critical: 0, high: 0, medium: 0, low: 0, informational: 0 },
      unresolvedClaims: [
        contentMode.mode === CONTENT_MODE.INDEPENDENT && !contentMode.unmetConditions.length
          ? "comparative pixel residue is disabled in independent-content mode"
          : `comparative pixel residue refused: ${contentMode.unmetConditions.join("; ")}`
      ],
      confidence: null,
      blockers: contentMode.unmetConditions ?? [],
      limitations: ["Comparative diffing assumes equivalent content and is unavailable without it."]
    };
  }
  if (!pixel.ran) {
    return {
      category: "comparative-pixel-residue",
      score: null, evidenceCoverage: 0, mismatchCount: 0,
      severityDistribution: { critical: 0, high: 0, medium: 0, low: 0, informational: 0 },
      unresolvedClaims: [`comparative pixel diff did not run (${pixel.reason})`],
      confidence: null, blockers: [], limitations: []
    };
  }
  const distribution = { critical: 0, high: 0, medium: 0, low: 0, informational: 0 };
  for (const r of pixel.residue) distribution[r.severity]++;
  return {
    category: "comparative-pixel-residue",
    score: pixel.residue.length === 0 ? 1 : 0,
    evidenceCoverage: 1,
    mismatchCount: pixel.residue.length,
    severityDistribution: distribution,
    unresolvedClaims: [],
    confidence: null,
    blockers: [],
    limitations: ["Cluster tolerances are unvalidated."]
  };
}

/** Normalises the Phase 3.4 category shape onto the Phase 4 field names. */
function normaliseCategory(c) {
  return {
    category: c.category,
    score: c.score,
    evidenceCoverage: c.evidenceCoverage,
    mismatchCount: c.mismatches ?? c.mismatchCount ?? 0,
    severityDistribution: c.severityBreakdown ?? c.severityDistribution ??
      { critical: 0, high: 0, medium: 0, low: 0, informational: 0 },
    unresolvedClaims: c.unresolvedClaims ?? [],
    confidence: c.confidence ?? null,
    blockers: c.blockers ?? [],
    limitations: c.limitations ?? []
  };
}

/**
 * Readiness for one viewport. Never a score — a status, with its reason.
 */
function readinessFor({ categories, blockers, contentMode }) {
  if (blockers.length) return { readiness: "blocked", why: blockers.map((b) => b.gate ?? b).join("; ") };

  const scored = categories.filter((c) => c.score != null);
  if (!scored.length) {
    return { readiness: "not-ready", why: "no category produced a score at this viewport" };
  }
  const failing = scored.filter((c) => c.score < 1);
  const thinCoverage = scored.filter((c) => c.evidenceCoverage < 0.5).map((c) => c.category);

  if (failing.length === 0 && !thinCoverage.length) {
    return {
      readiness: contentMode.comparativePixelAllowed ? "ready" : "ready-with-warnings",
      why: contentMode.comparativePixelAllowed
        ? "every scored category agrees and coverage is adequate"
        : "every scored category agrees; the comparative pixel channel was unavailable"
    };
  }
  if (failing.length === 0) {
    return { readiness: "requires-additional-validation", why: `thin evidence coverage in: ${thinCoverage.join(", ")}` };
  }
  return {
    readiness: failing.some((c) => c.severityDistribution.critical > 0) ? "not-ready" : "ready-with-warnings",
    why: `${failing.length} categor${failing.length === 1 ? "y" : "ies"} report mismatches: ${failing.map((c) => c.category).join(", ")}`
  };
}

/**
 * Runs one viewport end to end.
 *
 * Returns a complete per-viewport record, or a blocked one. A blocked viewport
 * does not affect any other viewport — that independence is the point of the
 * multi-viewport model.
 */
export function runViewport({
  viewport,
  referenceIR, referenceRaw, referenceSlug, referenceCaptureMeta,
  target,
  contentMode: contentModeRequest = {},
  states = [],
  targetVisualChecks = null, referenceVisualChecks = null,
  pixelClusters = null,
  projectionsFresh = true, safetyIntegrity = true, appStarted = true, assetsStable = true,
  classify = null, targetSelectors = {}, minCoverage = 0.3
}) {
  resetDiffIds();
  resetTaskIds();

  const referenceChecks = checkReference(referenceIR, { projectionsFresh, safetyIntegrity });
  if (referenceChecks.some((c) => !c.passed)) {
    return {
      viewport: { width: viewport, height: null, devicePixelRatio: null },
      blocked: blockedReport(referenceChecks, { stage: "reference", referenceSlug, targetSlug: target?.slug ?? null }),
      /* The reference gates fire before the target is touched, so nothing was
       * started for this viewport. */
      targetStarted: false,
      categories: null,
      compositeScore: null,
      readiness: "blocked"
    };
  }

  const derived = deriveTargetIR(target);
  const targetIR = derived.ir;

  const targetChecks = checkTarget(targetIR, {
    referenceViewport: referenceIR.coverage?.viewport?.width ?? null,
    targetViewport: targetIR.coverage?.viewport?.width ?? null,
    appStarted, assetsStable,
    screenshotIrHash: target.captureMeta?.irHash ?? null,
    targetIrHash: target.captureMeta?.irHash ? shortHash(targetIR) : null,
    captureTruncated: targetIR.coverage?.truncated === true,
    minCoverage
  });
  if (targetChecks.some((c) => !c.passed)) {
    return {
      viewport: {
        width: viewport,
        height: target.captureMeta?.viewportHeight ?? null,
        devicePixelRatio: target.captureMeta?.devicePixelRatio ?? null
      },
      blocked: blockedReport([...referenceChecks, ...targetChecks], { stage: "target", referenceSlug, targetSlug: target.slug }),
      targetStarted: true,
      categories: null,
      compositeScore: null,
      readiness: "blocked"
    };
  }

  /* Content mode is resolved per viewport: DPR and viewport metadata are
   * viewport-specific, so equivalent-content can legitimately hold at one width
   * and be refused at another. */
  const contentMode = resolveContentMode({
    ...contentModeRequest,
    referenceRaw, targetRaw: target.raw,
    referenceCaptureMeta, targetCaptureMeta: target.captureMeta
  });

  const identity = componentIdentityReport(referenceRaw, target.raw);
  const comparison = compareIRs(referenceIR, targetIR, {
    matchReport: identity,
    briefRequestsSurface: contentModeRequest.briefRequestsSurface ?? false
  });

  /* Comparative residue: gated on content mode FIRST, then on the geometry
   * suppression rule from Phase 3.4. */
  const contract = normalisationContract(target.captureMeta);
  const attributed = attributedRegions(comparison.differences, {
    viewport: { width: viewport, height: target.captureMeta?.viewportHeight ?? 900 }
  });
  const suppressors = attributed.filter((a) => a.suppressesPixelComparison);
  const mayDiff = contentMode.comparativePixelAllowed && contract.satisfied && !suppressors.length && !!pixelClusters;
  const classified = mayDiff
    ? classifyClusters(pixelClusters, attributed, {
        viewport: { width: viewport, height: target.captureMeta?.viewportHeight ?? 900 },
        maskedSelectors: (contentMode.maskedRegions ?? []).map((m) => m.selector)
      })
    : null;
  const pixel = pixelReport({
    classified, contract, ran: !!classified,
    suppressedBy: suppressors.length ? suppressors : null
  });

  const intrinsic = buildIntrinsicFindings({ targetChecks: targetVisualChecks, referenceChecks: referenceVisualChecks, viewport });

  const stateResults = states.map((s) => compareState(s));
  const statesCat = scoreStates(stateResults);

  /* Assemble the twelve. The Phase 3.4 comparison already produces ten of them
   * (its own `states` placeholder is replaced here with the real result). */
  const irCategories = comparison.categories
    .filter((c) => c.category !== "states")
    .map(normaliseCategory);

  const categories = [
    ...irCategories,
    statesCat,
    intrinsicCategory(intrinsic),
    residueCategory(pixel, contentMode)
  ];

  const tasks = generateTasks(comparison, {
    componentIdentityResolved: false,
    contestedClaims: new Set((referenceIR.contestedClaims ?? []).map((c) => c.claim ?? c)),
    targetSelectors, classify,
    pixelAttributions: classified?.attributed ?? []
  }).map((t) => ({ ...t, viewportsAffected: [viewport], regressionRisk: regressionRiskFor(t) }));

  const { readiness, why } = readinessFor({ categories, blockers: [], contentMode });

  return {
    viewport: {
      width: viewport,
      height: target.captureMeta?.viewportHeight ?? null,
      devicePixelRatio: target.captureMeta?.devicePixelRatio ?? null
    },
    targetStarted: true,
    referenceCapture: {
      status: "complete",
      coverage: referenceIR.coverage?.coverageFactor ?? null,
      contentReached: referenceIR.coverage?.contentReached ?? null,
      irHash: shortHash(referenceIR)
    },
    targetCapture: {
      status: "complete",
      coverage: targetIR.coverage?.coverageFactor ?? null,
      contentReached: targetIR.coverage?.contentReached ?? null,
      irHash: shortHash(targetIR)
    },
    fontReadiness: { ready: target.captureMeta?.fontsReady === true, timedOut: target.captureMeta?.fontsReady === false },
    assetReadiness: { networkIdle: target.captureMeta?.networkIdle === true, failedRequests: target.captureMeta?.failedRequests ?? [] },
    contentMode,
    categories,
    differences: comparison.differences,
    intrinsicFindings: intrinsic.findings,
    states: stateResults,
    componentIdentity: identity,
    pixel,
    tasks,
    blockers: [],
    evidenceLimitations: categories.flatMap((c) => c.limitations ?? []),
    compositeScore: null,
    thresholdsValidated: false,
    readiness,
    readinessReason: why,
    targetIR
  };
}

/**
 * Regression risk for a task, stated before it is applied rather than
 * discovered after.
 */
export function regressionRiskFor(task) {
  if (/container|grid/.test(task.referenceEvidence?.claim ?? "")) {
    return {
      level: "high",
      categoriesAtRisk: ["layout", "spacing", "components", "comparative-pixel-residue", "intrinsic-visual"],
      why: "a container or grid geometry change relocates all content, so every geometry-dependent category can move"
    };
  }
  if (task.category === "color" || task.category === "typography") {
    return {
      level: "medium",
      categoriesAtRisk: [task.category, "accessibility"],
      why: "a token change propagates to every element using that role, including contrast pairings"
    };
  }
  return {
    level: "low",
    categoriesAtRisk: [task.category],
    why: "the change is scoped to one claim"
  };
}

/**
 * The fidelity run — reference/target loading, gates, comparison, tasks.
 *
 * Report-first and manual-first. Nothing here modifies an implementation; the
 * loop measures, prescribes and records. Applying a change is the caller's act,
 * and `dryRun` defaults to true so that stays true by default rather than by
 * convention.
 */

import { runPipeline } from "../pipeline.mjs";
import { compareIRs } from "./categories.mjs";
import { checkReference, checkTarget, blockedReport, REFERENCE_SIDE } from "./gates.mjs";
import { generateTasks, resetTaskIds } from "./tasks.mjs";
import { resetDiffIds } from "./compare.mjs";
import { attributedRegions, classifyClusters, normalisationContract, pixelReport, intrinsicFindings } from "./pixel.mjs";
import { FidelityHistory, shortHash } from "./history.mjs";
import { matchBuilds, MATCH_STATE, componentId } from "../deploy/match.mjs";

/**
 * Derives an IR from a raw capture using the SAME path as the reference.
 *
 * This is the design's load-bearing decision: two IRs produced by one pipeline
 * are comparable because their vocabularies are identical by construction.
 */
export function deriveTargetIR({ raw, probe, slug, mode = "analyze" }) {
  const result = runPipeline({
    raw, probe,
    meta: { slug, source: { kind: "url", value: slug }, tier: "fidelity-target" },
    config: { request: { mode } }
  });
  return result;
}

/**
 * Reports component identity without relying on it.
 *
 * Test 19 measured precision 1.000 and recall 0.444 across implementations
 * (def_0030). The matches that ARE made are trustworthy, so they are reported
 * as resolved and used for observation. None of them unlocks an automatic
 * correction.
 */
export function componentIdentityReport(referenceRaw, targetRaw) {
  const results = matchBuilds(referenceRaw.repeats ?? [], targetRaw.repeats ?? []);
  const sourced = results.filter((r) => r.sourceComponentId);
  const matched = sourced.filter((r) => r.matchState === MATCH_STATE.MATCHED);

  const refSig = new Map();
  (referenceRaw.repeats ?? []).forEach((g, i) => refSig.set(componentId(g, i), g.signature));
  const tgtSig = new Map();
  (targetRaw.repeats ?? []).forEach((g, i) => tgtSig.set(componentId(g, i), g.signature));

  return {
    resolved: matched.length > 0,
    resolvedCount: matched.length,
    attemptedCount: sourced.length,
    pairs: matched.map((r) => ({
      reference: refSig.get(r.sourceComponentId) ?? null,
      target: tgtSig.get(r.targetComponentId) ?? null,
      confidence: Number(r.confidence.toFixed(3)),
      evidenceUsed: r.evidenceUsed
    })),
    unresolved: sourced
      .filter((r) => r.matchState !== MATCH_STATE.MATCHED)
      .map((r) => ({ reference: refSig.get(r.sourceComponentId) ?? null, state: r.matchState, why: r.matchMethod })),
    automaticCorrectionBlocked: true,
    detail:
      `${matched.length} of ${sourced.length} reference components resolved to a target component. ` +
      "Component-level matching is precise but incomplete across implementations (def_0030), so it is reported " +
      "and never used to authorise an automatic correction.",
    reference: "def_0030"
  };
}

/**
 * One comparison. Returns either a blocked report or a full one.
 *
 * @param {object} opts.referenceIR    already-analysed reference
 * @param {object} opts.referenceRaw   the reference's raw capture, for identity reporting
 * @param {object} opts.target         { raw, probe, slug, captureMeta }
 */
export function compareOnce({
  referenceIR, referenceRaw, referenceSlug, target,
  pixelClusters = null, maskedSelectors = [], briefRequestsSurface = false,
  projectionsFresh = true, safetyIntegrity = true, appStarted = true, assetsStable = true,
  minCoverage = 0.3, classify = null, targetSelectors = {},
  targetVisualChecks = null, referenceVisualChecks = null
}) {
  resetDiffIds();
  resetTaskIds();

  /* Reference-side gates fire before the target is touched at all. */
  const referenceChecks = checkReference(referenceIR, { projectionsFresh, safetyIntegrity });
  if (referenceChecks.some((c) => !c.passed)) {
    return {
      blocked: blockedReport(referenceChecks, {
        stage: "reference", referenceSlug, targetSlug: target?.slug ?? null
      })
    };
  }

  const derived = deriveTargetIR(target);
  const targetIR = derived.ir;
  const targetIrHash = shortHash(targetIR);

  const targetChecks = checkTarget(targetIR, {
    /* `coverage.viewport` is `{ width, height }`. Only the width is compared:
     * height varies with document length and is not a capture parameter. */
    referenceViewport: referenceIR.coverage?.viewport?.width ?? null,
    targetViewport: targetIR.coverage?.viewport?.width ?? null,
    appStarted, assetsStable,
    screenshotIrHash: target.captureMeta?.irHash ?? null,
    targetIrHash: target.captureMeta?.irHash ? targetIrHash : null,
    captureTruncated: targetIR.coverage?.truncated === true,
    minCoverage
  });
  if (targetChecks.some((c) => !c.passed)) {
    return {
      blocked: blockedReport([...referenceChecks, ...targetChecks], {
        stage: "target", referenceSlug, targetSlug: target.slug
      }),
      targetIR
    };
  }

  const identity = componentIdentityReport(referenceRaw, target.raw);
  const comparison = compareIRs(referenceIR, targetIR, { matchReport: identity, briefRequestsSurface });

  /* Pixel runs last and only on residue. */
  const contract = normalisationContract(target.captureMeta);
  const attributed = attributedRegions(comparison.differences, {
    viewport: {
      width: target.captureMeta?.viewportWidth ?? 1440,
      height: target.captureMeta?.viewportHeight ?? 900
    }
  });
  const suppressors = attributed.filter((a) => a.suppressesPixelComparison);
  const classified = pixelClusters && contract.satisfied && !suppressors.length
    ? classifyClusters(pixelClusters, attributed, {
        viewport: {
          width: target.captureMeta?.viewportWidth ?? 1440,
          height: target.captureMeta?.viewportHeight ?? 900
        },
        maskedSelectors
      })
    : null;
  const pixel = pixelReport({
    classified, contract, ran: !!classified,
    suppressedBy: suppressors.length ? suppressors : null
  });

  /* Intrinsic visual checks run regardless of whether the comparative diff
   * could. They are single-render properties, so a layout difference does not
   * suppress them and differing content does not confound them. */
  const intrinsic = intrinsicFindings(targetVisualChecks, { referenceChecks: referenceVisualChecks });
  pixel.intrinsic = intrinsic;

  const tasks = generateTasks(comparison, {
    componentIdentityResolved: false,
    contestedClaims: new Set((referenceIR.contestedClaims ?? []).map((c) => c.claim ?? c)),
    targetSelectors, classify,
    pixelAttributions: classified?.attributed ?? []
  });

  /* Pixel residue is its own category, scored separately and never mixed into
   * an IR category. */
  const pixelCategory = {
    category: "pixel-only",
    /* Intrinsic checks alone are enough to score this category: they are
     * single-render properties and do not need the comparative diff. */
    score: intrinsic.checkedElements > 0
      ? (intrinsic.findings.length === 0 && pixel.residue.length === 0 ? 1 : 0)
      : (pixel.ran ? (pixel.residue.length === 0 ? 1 : 0) : null),
    evidenceCoverage: intrinsic.checkedElements > 0 || pixel.ran ? 1 : 0,
    admissibleComparisons: intrinsic.checkedElements > 0 || pixel.ran ? 1 : 0,
    totalDimensions: 1,
    mismatches: pixel.residue.length + intrinsic.findings.length,
    severityBreakdown: [...pixel.residue, ...intrinsic.findings].reduce((acc, r) => {
      acc[r.severity] = (acc[r.severity] ?? 0) + 1;
      return acc;
    }, { critical: 0, high: 0, medium: 0, low: 0, informational: 0 }),
    unresolvedClaims: pixel.ran ? [] : [`comparative pixel diff did not run (${pixel.reason})`],
    confidence: null,
    differences: []
  };

  return {
    comparisonPerformed: true,
    reference: referenceSlug,
    target: target.slug,
    referenceIrHash: shortHash(referenceIR),
    targetIrHash,
    categories: [...comparison.categories, pixelCategory],
    componentIdentity: identity,
    differences: comparison.differences,
    pixel,
    tasks,
    compositeScore: null,
    compositeScoreNote: comparison.compositeScoreNote,
    thresholdsValidated: false,
    gates: { reference: referenceChecks, target: targetChecks }
  };
}

export { FidelityHistory };

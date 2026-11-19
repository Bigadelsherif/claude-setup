/**
 * The safety gate — stage 6 of the pipeline, between the IR and any prompt.
 *
 * The governing principle, learned from stripe.com/pricing:
 *
 *   A valid IR is not automatically safe for prompt generation.
 *
 * Every claim in that run passed schema validation, carried evidence, and was
 * locally defensible. The analysis still described a navigation menu. Validity
 * is about whether claims are well-formed; safety is about whether they
 * describe what the user asked about.
 *
 * A blocked run is a successful outcome. Silently emitting a plausible prompt
 * from insufficient evidence is the failure this gate exists to prevent.
 */

import { COVERAGE_THRESHOLDS } from "./assess.mjs";

export const SAFETY = Object.freeze({
  USABLE: "usable",
  USABLE_WITH_WARNINGS: "usable-with-warnings",
  INSUFFICIENT_COVERAGE: "insufficient-coverage",
  UNSAFE: "unsafe-for-prompt-generation"
});

/** Statuses that permit rebuild-prompt.md to be written. */
const PROMPT_ALLOWED = new Set([SAFETY.USABLE, SAFETY.USABLE_WITH_WARNINGS]);

export function assessSafety({ coverage, verification, components = [], config = {}, modeEvaluation = null }) {
  const minCoverage = config.minCoverageFactor ?? COVERAGE_THRESHOLDS.insufficient;
  const blockers = [];
  const concerns = [];

  /* ------------------------------------------- mode requirements first
   *
   * The requested output decides what counts as a blocker. A missing component
   * anatomy is fatal to `recreate` and irrelevant to `analyze`, so the mode
   * evaluation runs ahead of the generic checks and its verdict is authoritative
   * for everything it covers.
   */
  if (modeEvaluation) {
    for (const gap of modeEvaluation.blockingGaps) {
      blockers.push({
        code: `mode:${gap.id}`,
        message: `${modeEvaluation.requestedMode} requires ${gap.label.toLowerCase()} — ${gap.detail}`,
        remedy:
          gap.remedy === "source"
            ? "Re-capturing will not help; this is a limit of the input kind. Supply a live capture or request a less demanding mode."
            : "Re-capture the page and retry."
      });
    }
    for (const gap of modeEvaluation.warningGaps) {
      concerns.push({
        code: `mode:${gap.id}`,
        severity: "medium",
        message: `${gap.label}: ${gap.detail}`
      });
    }
  }

  /* ------------------------------------------------- hard blockers */

  if ((coverage.contentReached ?? 0) === 0) {
    blockers.push({
      code: "content-not-reached",
      message: coverage.contentReachedReason ?? "The primary content region was never sampled.",
      remedy: "Re-capture with a larger node budget, or pass a selector hint naming the content region."
    });
  }

  if (!verification.passed) {
    blockers.push({
      code: "region-verification-failed",
      message: `Primary-region verification failed: ${verification.criticalFailures.join(", ")}.`,
      remedy: "Confirm the page rendered fully before capture, and that the content region is not behind an interaction."
    });
  }

  // A zero-confidence component is fatal to `recreate` and irrelevant to
  // `analyze`. When a mode evaluation is present it owns that judgement; the
  // blanket check only survives as a fallback for callers that request no mode.
  const primaryComponent = components.find((c) => c.role !== "action") ?? components[0] ?? null;
  if (!modeEvaluation && primaryComponent && (primaryComponent.confidence ?? 0) === 0) {
    blockers.push({
      code: "zero-confidence-primary-component",
      message: `The primary component \`${primaryComponent.id}\` resolved with zero confidence and no anatomy.`,
      remedy: "Probe the content region's repeated elements directly with a selector hint."
    });
  }

  if ((coverage.coverageFactor ?? 0) < COVERAGE_THRESHOLDS.unsafe) {
    blockers.push({
      code: "coverage-below-floor",
      message: `Coverage factor ${coverage.coverageFactor} is below the hard floor of ${COVERAGE_THRESHOLDS.unsafe}.`,
      remedy: "Re-capture at a viewport where more content is rendered, or raise the node budget."
    });
  }

  const navDominated = verification.checks.find((c) => c.id === "not-nav-dominated");
  if (navDominated && !navDominated.passed) {
    blockers.push({
      code: "nav-dominated",
      message: navDominated.detail,
      remedy: "The capture is dominated by navigation structure. Collapse the menu before capture or hint the content selector."
    });
  }

  /* ----------------------------------------------------- concerns */

  if ((coverage.coverageFactor ?? 0) < minCoverage) {
    concerns.push({
      code: "coverage-below-threshold",
      message: `Coverage factor ${coverage.coverageFactor} is below the configured threshold of ${minCoverage}.`
    });
  }

  for (const w of coverage.warnings ?? []) {
    if (w.severity === "critical") continue; // already a blocker
    concerns.push({ code: w.code, message: w.message, severity: w.severity });
  }

  for (const c of verification.checks) {
    if (c.passed || c.severity === "info" || c.severity === "critical") continue;
    concerns.push({ code: `verification:${c.id}`, message: c.detail, severity: c.severity });
  }

  /* ------------------------------------------------------- status */

  let status;
  if (blockers.length) {
    status =
      blockers.length === 1 && blockers[0].code === "coverage-below-floor"
        ? SAFETY.INSUFFICIENT_COVERAGE
        : SAFETY.UNSAFE;
  } else if ((coverage.coverageFactor ?? 0) < minCoverage) {
    status = SAFETY.INSUFFICIENT_COVERAGE;
  } else if (concerns.length) {
    status = SAFETY.USABLE_WITH_WARNINGS;
  } else {
    status = SAFETY.USABLE;
  }

  return {
    status,
    promptGenerationAllowed: PROMPT_ALLOWED.has(status),
    mode: modeEvaluation
      ? {
          requested: modeEvaluation.requestedMode,
          decision: modeEvaluation.decision,
          recommendedNextAction: modeEvaluation.recommendedNextAction,
          requiredArtifacts: modeEvaluation.requiredArtifacts
        }
      : null,
    blockers,
    concerns,
    coverageFactor: coverage.coverageFactor,
    contentReached: coverage.contentReached,
    summary: describe(status, blockers, concerns, modeEvaluation)
  };
}

function describe(status, blockers, concerns, modeEvaluation) {
  const mode = modeEvaluation ? ` for \`${modeEvaluation.requestedMode}\`` : "";
  switch (status) {
    case SAFETY.USABLE:
      return `Coverage and region verification both passed. Evidence is sufficient${mode}.`;
    case SAFETY.USABLE_WITH_WARNINGS:
      return `Evidence is sufficient${mode} with ${concerns.length} concern(s) recorded.`;
    case SAFETY.INSUFFICIENT_COVERAGE:
      return `Coverage is too low to support the requested output${mode}. A partial spec is available.`;
    case SAFETY.UNSAFE:
      return `Blocked${mode}: ${blockers.map((b) => b.code).join(", ")}.`;
    default:
      return "Unknown safety status.";
  }
}

/** Applies the coverage factor to a provenance-derived confidence. */
export function applyCoverage(confidence, coverageFactor) {
  return Math.round(confidence * coverageFactor * 1000) / 1000;
}

/**
 * Intrinsic visual findings: correlation, severity, tasks and mode behaviour.
 *
 * The checks themselves are single-render facts produced by
 * `tools/intrinsic-checks.mjs`. What a fact MEANS is decided here, and it turns
 * on two things the probe cannot know:
 *
 *   intent       a carousel that scrolls and a container that scrolls by
 *                accident are the same measurement and different findings
 *   correlation  a condition the reference also has is not a target defect
 *
 * Correlation has four outcomes, and only one of them makes the target
 * responsible.
 */

import { SEVERITY } from "./compare.mjs";
import { resolveTapTargetPolicy, policySummary } from "../policy/tap-target.mjs";

/** The thirteen checks. Each is independent and separately reported. */
export const INTRINSIC_CHECKS = Object.freeze([
  "content-overflow",
  "accidental-clipping",
  "occlusion",
  "stacking-order-inverted",
  "unexpected-horizontal-scrollbar",
  "unexpected-vertical-scrollbar",
  "viewport-overflow",
  "image-crop-mismatch",
  "object-fit-mismatch",
  "text-truncation",
  "focus-indicator-invisible",
  "tap-target-undersized",
  "fixed-sticky-collision"
]);

/** Recorded but never reported as defects. */
export const NON_DEFECT_CHECKS = Object.freeze([
  "intentional-clipping", "declared-scroll-container",
  "object-fit-observation", "focus-indicator-observation", "image-crop-unknown"
]);

export const CORRELATION = Object.freeze({
  TARGET_ONLY: "target-only",
  REFERENCE_CORRELATED: "reference-correlated",
  REFERENCE_ONLY: "reference-only",
  UNKNOWN: "unknown"
});

export const SOURCE_KIND = Object.freeze({
  DOM_GEOMETRY: "dom-geometry",
  COMPUTED_STYLE: "computed-style",
  HIT_TEST: "hit-test",
  NATURAL_SIZE: "natural-size"
});

const SOURCE_FOR = {
  "box-measurement": SOURCE_KIND.DOM_GEOMETRY,
  "computed-style": SOURCE_KIND.COMPUTED_STYLE,
  "hit-test": SOURCE_KIND.HIT_TEST,
  "natural-size": SOURCE_KIND.NATURAL_SIZE
};

/** Base severity per check, before correlation adjusts it. */
const BASE_SEVERITY = {
  "content-overflow": SEVERITY.MEDIUM,
  "accidental-clipping": SEVERITY.HIGH,
  "occlusion": SEVERITY.MEDIUM,
  "stacking-order-inverted": SEVERITY.MEDIUM,
  "unexpected-horizontal-scrollbar": SEVERITY.HIGH,
  "unexpected-vertical-scrollbar": SEVERITY.MEDIUM,
  "viewport-overflow": SEVERITY.HIGH,
  "image-crop-mismatch": SEVERITY.MEDIUM,
  "object-fit-mismatch": SEVERITY.MEDIUM,
  "text-truncation": SEVERITY.HIGH,
  "focus-indicator-invisible": SEVERITY.HIGH,
  "tap-target-undersized": SEVERITY.HIGH,
  "fixed-sticky-collision": SEVERITY.HIGH
};

/**
 * Compares object-fit observations to produce the mismatch check.
 *
 * Kept separate from the probe because it needs both sides: an object-fit value
 * is not wrong on its own, only different from the reference's.
 */
function objectFitMismatches(targetRun, referenceRun) {
  if (!referenceRun) return [];
  const refByKey = new Map(
    (referenceRun.findings ?? [])
      .filter((f) => f.check === "object-fit-observation")
      .map((f) => [f.selector, f])
  );
  const out = [];
  for (const t of (targetRun.findings ?? []).filter((f) => f.check === "object-fit-observation")) {
    const r = refByKey.get(t.selector);
    if (!r) continue;
    const fitDiffers = r.evidence.objectFit !== t.evidence.objectFit;
    const posDiffers = r.evidence.objectPosition !== t.evidence.objectPosition;
    if (!fitDiffers && !posDiffers) continue;

    /* A crop claim needs comparable content. If the two images are not the same
     * source, a different rendered crop may be the right crop for a different
     * picture, and the question is not answered. */
    const sameSource = r.evidence.src && t.evidence.src && r.evidence.src === t.evidence.src;
    out.push({
      check: "object-fit-mismatch",
      detectionMethod: "computed-style",
      selector: t.selector,
      box: t.box,
      intent: "accidental",
      evidence: {
        reference: { objectFit: r.evidence.objectFit, objectPosition: r.evidence.objectPosition },
        target: { objectFit: t.evidence.objectFit, objectPosition: t.evidence.objectPosition },
        sameSource
      },
      contentComparable: sameSource,
      detail: sameSource
        ? `${t.selector} renders object-fit ${t.evidence.objectFit} / ${t.evidence.objectPosition} where the reference uses ${r.evidence.objectFit} / ${r.evidence.objectPosition}.`
        : `${t.selector} differs in object-fit, but the two images are not the same source, so no crop equivalence is claimed.`
    });
  }
  return out;
}

/**
 * Correlates one target finding against the reference run.
 *
 * The identity of a finding is its check plus its selector. A selector absent
 * from the reference entirely means the reference has no evidence either way,
 * which is `unknown` — not absence of the condition.
 */
export function correlate(finding, referenceRun, { referenceSelectors = null } = {}) {
  if (!referenceRun) {
    return { correlation: CORRELATION.UNKNOWN, reason: "no reference run was supplied for this viewport and state" };
  }
  const sameCheck = (referenceRun.findings ?? []).filter((f) => f.check === finding.check);
  const exact = sameCheck.find((f) => f.selector === finding.selector);
  if (exact) {
    return { correlation: CORRELATION.REFERENCE_CORRELATED, reason: `the reference exhibits ${finding.check} on ${finding.selector} as well`, referenceFinding: exact };
  }

  /* The selector exists in the reference and does NOT have the condition:
   * a genuine target-only defect. */
  const known = referenceSelectors ?? new Set(
    (referenceRun.allSelectors ?? []).concat((referenceRun.findings ?? []).map((f) => f.selector))
  );
  if (known.has(finding.selector)) {
    return { correlation: CORRELATION.TARGET_ONLY, reason: `the reference has ${finding.selector} without ${finding.check}` };
  }

  return {
    correlation: CORRELATION.UNKNOWN,
    reason: `${finding.selector} has no counterpart in the reference, so the reference offers no evidence either way`
  };
}

/**
 * Reference-only conditions: present in the reference, absent from the target.
 *
 * Not automatically a target defect. It may be required design behaviour the
 * target dropped, or a reference defect the target avoided, and the evidence
 * here cannot tell which.
 */
export function referenceOnlyFindings(referenceRun, targetRun) {
  if (!referenceRun || !targetRun) return [];
  const targetKeys = new Set((targetRun.findings ?? []).map((f) => `${f.check}::${f.selector}`));
  return (referenceRun.findings ?? [])
    .filter((f) => INTRINSIC_CHECKS.includes(f.check))
    .filter((f) => !targetKeys.has(`${f.check}::${f.selector}`))
    .map((f) => ({
      check: f.check,
      selector: f.selector,
      correlation: CORRELATION.REFERENCE_ONLY,
      severity: SEVERITY.INFORMATIONAL,
      actionable: false,
      classification: "missing-reference-behaviour-or-unknown",
      detail:
        `The reference exhibits ${f.check} on ${f.selector} and the target does not. Whether that is required ` +
        "design behaviour the target dropped, or a reference defect the target avoided, is not decided from this evidence.",
      referenceEvidence: f.evidence ?? null
    }));
}

let seq = 0;
const nextId = () => `if_${String(++seq).padStart(4, "0")}`;
export const resetIntrinsicIds = () => { seq = 0; };

/**
 * Builds the finding records for one viewport and state.
 */
export function buildIntrinsicReport({
  targetRun, referenceRun = null, viewport, state = "default", tapTargetPolicy = null
}) {
  /* The tap-target minimum is a project policy, not a constant: WCAG 2.2 AA
   * says 24px with exceptions, Apple HIG 44, Material 48. Whichever is chosen
   * travels onto every finding and task, so a reader can see which standard a
   * 28px target was judged against (Phase 4.5, cand_03). */
  const policy = resolveTapTargetPolicy(tapTargetPolicy);
  const policyRecord = policySummary(policy);
  const findings = [];

  const raw = [
    ...(targetRun?.findings ?? []),
    ...objectFitMismatches(targetRun ?? { findings: [] }, referenceRun)
  ];

  const referenceSelectors = referenceRun
    ? new Set((referenceRun.findings ?? []).map((f) => f.selector))
    : null;

  for (const f of raw) {
    const reportable = INTRINSIC_CHECKS.includes(f.check) && f.reportable !== false;

    if (!reportable) {
      /* Recorded, never a defect: intentional clipping, declared scroll
       * containers, plain observations. Kept in the record so a reader can see
       * the check ran and what it saw. */
      findings.push({
        id: nextId(), check: f.check, viewport, state,
        targetEvidence: f.evidence ?? null,
        referenceEvidence: null,
        affectedRegion: f.box ?? null,
        selector: f.selector,
        detectionMethod: f.detectionMethod,
        sourceKind: SOURCE_FOR[f.detectionMethod] ?? null,
        intent: f.intent ?? "observation",
        severity: SEVERITY.INFORMATIONAL,
        confidence: 0.95,
        correlation: CORRELATION.UNKNOWN,
        correlationReason: "not a defect check; recorded as context",
        actionable: false,
        reportedAsDefect: false,
        limitations: [],
        detail: f.detail
      });
      continue;
    }

    const { correlation, reason, referenceFinding } = correlate(f, referenceRun, { referenceSelectors });

    /* Correlation decides responsibility, and severity follows from it. A
     * reference-correlated condition is demoted and generates no task; an
     * unknown correlation neither promotes nor demotes. */
    let severity = f.check === "tap-target-undersized"
      ? policy.severityBelowMinimum
      : (BASE_SEVERITY[f.check] ?? SEVERITY.MEDIUM);
    let actionable = true;
    const limitations = [];

    if (correlation === CORRELATION.REFERENCE_CORRELATED) {
      severity = SEVERITY.INFORMATIONAL;
      actionable = false;
    } else if (correlation === CORRELATION.UNKNOWN) {
      actionable = true;
      limitations.push(
        "Reference correlation is unknown, so severity was neither promoted nor demoted; " +
        "the target finding is preserved as measured."
      );
    }

    /* A crop claim on images that are not the same source is never actionable. */
    if (f.check === "object-fit-mismatch" && f.contentComparable === false) {
      actionable = false;
      severity = SEVERITY.INFORMATIONAL;
      limitations.push("The two images are not the same source, so no crop equivalence can be established.");
    }

    findings.push({
      id: nextId(),
      check: f.check,
      viewport,
      state,
      targetEvidence: f.evidence ?? null,
      referenceEvidence: referenceFinding?.evidence ?? null,
      affectedRegion: f.box ?? null,
      selector: f.selector,
      detectionMethod: f.detectionMethod,
      sourceKind: SOURCE_FOR[f.detectionMethod] ?? null,
      intent: f.intent ?? "accidental",
      severity,
      confidence: 0.95,
      correlation,
      correlationReason: reason,
      actionable,
      reportedAsDefect: actionable,
      classification: f.check === "tap-target-undersized" && viewport <= 768
        ? "responsive-accessibility-mismatch"
        : null,
      /* Present on every finding, not only the tap-target ones, so the report
       * can state which policy the run was judged under even when nothing
       * tripped it. */
      policy: f.check === "tap-target-undersized" ? policyRecord : null,
      limitations,
      detail: f.detail
    });
  }

  const referenceOnly = referenceOnlyFindings(referenceRun, targetRun).map((f) => ({
    id: nextId(), viewport, state, ...f,
    detectionMethod: null, sourceKind: null, targetEvidence: null,
    affectedRegion: null, confidence: 0.9, reportedAsDefect: false, limitations: []
  }));

  const all = [...findings, ...referenceOnly];
  const defects = all.filter((f) => f.reportedAsDefect);
  const byCheck = {};
  for (const f of all) {
    byCheck[f.check] ??= { total: 0, defects: 0, demoted: 0, unknown: 0 };
    byCheck[f.check].total++;
    if (f.reportedAsDefect) byCheck[f.check].defects++;
    if (f.correlation === CORRELATION.REFERENCE_CORRELATED) byCheck[f.check].demoted++;
    if (f.correlation === CORRELATION.UNKNOWN && INTRINSIC_CHECKS.includes(f.check)) byCheck[f.check].unknown++;
  }

  const severityDistribution = { critical: 0, high: 0, medium: 0, low: 0, informational: 0 };
  for (const f of all) severityDistribution[f.severity]++;

  return {
    viewport, state,
    tapTargetPolicy: policyRecord,
    findings: all,
    byCheck,
    checksRun: INTRINSIC_CHECKS.length,
    referenceAvailable: !!referenceRun,
    category: {
      category: "intrinsic-visual",
      score: all.length === 0 ? null : (defects.length === 0 ? 1 : 0),
      evidenceCoverage: targetRun ? 1 : 0,
      mismatchCount: defects.length,
      severityDistribution,
      unresolvedClaims: all
        .filter((f) => f.correlation === CORRELATION.UNKNOWN && INTRINSIC_CHECKS.includes(f.check))
        .map((f) => `${f.check} on ${f.selector} (reference correlation unknown)`),
      confidence: 0.95,
      blockers: [],
      limitations: [
        "Thirteen checks, each independent. Intent is read from declared markers; an undeclared but deliberate condition reads as accidental.",
        `Tap targets were judged against ${policyRecord.policyName} (${policyRecord.minimumTapTargetPx}px, ${policyRecord.policySource}). No minimum is universally required.`,
        referenceRun ? null : "No reference run was available, so every correlation is unknown."
      ].filter(Boolean)
    },
    compositeIntrinsicScore: null
  };
}

/** Correction tasks for actionable findings. */
export function intrinsicTasks(report) {
  const policyRecord = report.tapTargetPolicy ?? null;
  return report.findings
    .filter((f) => f.actionable && f.reportedAsDefect)
    .map((f, i) => ({
      id: `intrinsic_task_${String(i + 1).padStart(3, "0")}`,
      check: f.check,
      viewport: f.viewport,
      state: f.state,
      category: "intrinsic-visual",
      severity: f.severity,
      referenceEvidence: f.referenceEvidence ?? { note: "target-only finding; the reference does not exhibit it" },
      targetEvidence: f.targetEvidence,
      currentValue: f.targetEvidence,
      expectedValue: expectationFor(f),
      affectedRegion: f.affectedRegion,
      affectedSelector: f.selector,
      confidence: f.confidence,
      mode: "manual",
      notAutomaticBecause: [
        "an intrinsic visual defect is fixed by changing layout or styling rules, not by substituting a measured value",
        "component identity is unresolved across implementations (def_0030)"
      ],
      acceptanceCondition: `\`${f.check}\` no longer reports a finding for \`${f.selector}\` at ${f.viewport}px in the \`${f.state}\` state.`,
      classification: f.classification ?? null,
      policy: f.check === "tap-target-undersized" ? (f.policy ?? policyRecord) : null,
      limitations: f.limitations
    }));
}

function expectationFor(f) {
  switch (f.check) {
    case "tap-target-undersized":
      return `at least ${f.policy?.minimumTapTargetPx ?? f.targetEvidence?.minimum ?? "the policy minimum"}px in both dimensions, per ${f.policy?.policyName ?? "the configured policy"}`;
    case "focus-indicator-invisible": return "a visible focus indicator";
    case "viewport-overflow": return `no element extending past ${f.targetEvidence?.viewportWidth ?? "the viewport"}px`;
    case "unexpected-horizontal-scrollbar":
    case "unexpected-vertical-scrollbar": return "no scrollbar on a container that does not declare scrolling";
    case "text-truncation": return "the full text visible, or a declared and intentional clamp";
    case "accidental-clipping": return "content not clipped, or clipping declared as decorative";
    case "image-crop-mismatch": return "the reference's object-fit behaviour";
    case "object-fit-mismatch": return `object-fit ${f.targetEvidence?.reference?.objectFit ?? "as in the reference"}`;
    case "fixed-sticky-collision": return "no fixed or sticky layer covering an interactive target";
    case "stacking-order-inverted": return "the declared stacking order honoured";
    default: return "the condition resolved";
  }
}

/**
 * Mode behaviour for intrinsic findings.
 *
 * `recreate` blocks only when a finding prevents RELIABLE COMPARISON — not
 * merely because a defect exists. A page that overflows its viewport cannot be
 * compared meaningfully; a small tap target can.
 */
const COMPARISON_BLOCKING = new Set(["viewport-overflow", "unexpected-horizontal-scrollbar"]);

export function evaluateIntrinsicForMode({ mode, report, briefAllows = [] }) {
  const defects = report.findings.filter((f) => f.reportedAsDefect);
  const unknown = report.findings.filter(
    (f) => f.correlation === CORRELATION.UNKNOWN && INTRINSIC_CHECKS.includes(f.check));

  if (mode === "analyze") {
    return {
      mode, decision: "allowed",
      findings: report.findings.length,
      warnings: defects.map((f) => `${f.check} on ${f.selector} (${f.correlation})`),
      limitations: report.category.limitations,
      note: "Analyze reports every finding with its evidence and limitations. Target-only findings warn rather than block."
    };
  }

  if (mode === "recreate") {
    const blocking = defects.filter((f) => COMPARISON_BLOCKING.has(f.check));
    return {
      mode,
      decision: blocking.length ? "blocked" : "allowed-with-warnings",
      blockingFindings: blocking.map((f) => `${f.check} on ${f.selector}`),
      tasks: blocking.length ? [] : intrinsicTasks(report).map((t) => t.id),
      note: blocking.length
        ? "Blocked: the target overflows its viewport, so a comparison would measure the overflow rather than the design."
        : "Findings become correction tasks; an intrinsic defect that does not prevent comparison does not block."
    };
  }

  if (mode === "adapt") {
    return {
      mode, decision: "allowed",
      referenceBehaviour: report.findings
        .filter((f) => f.correlation === CORRELATION.REFERENCE_CORRELATED || f.correlation === CORRELATION.REFERENCE_ONLY)
        .map((f) => ({ check: f.check, selector: f.selector, source: "reference-evidence" })),
      targetRequirements: briefAllows.map((c) => ({
        check: c, source: "target-brief-requirement",
        note: "The brief intentionally changes this behaviour; it is a target decision, not a reference mismatch."
      })),
      mismatches: defects
        .filter((f) => !briefAllows.includes(f.check))
        .map((f) => ({ check: f.check, selector: f.selector, source: "target-mismatch" })),
      note: "Reference behaviour, target-brief requirements and target mismatches are listed separately."
    };
  }

  if (mode === "improve") {
    return {
      mode, decision: "allowed",
      observations: defects.map((f) => ({
        kind: "observation", check: f.check, selector: f.selector, detail: f.detail, observedInTarget: true
      })),
      proposals: defects.map((f) => ({
        kind: "proposal", check: f.check, selector: f.selector,
        detail: `**Proposed:** resolve \`${f.check}\` on \`${f.selector}\`. ${expectationFor(f)}.`,
        observedInReference: f.correlation === CORRELATION.REFERENCE_CORRELATED
      })),
      note: "Observed defects and proposed fixes are structurally separate. A proposal is never described as existing reference behaviour."
    };
  }

  return { mode, decision: "allowed", note: "No intrinsic-specific behaviour is defined for this mode." };
}

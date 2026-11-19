/**
 * Interaction-state comparison.
 *
 * Two rules govern everything here.
 *
 * 1. Compare a state only when BOTH sides have valid evidence for it. When a
 *    state is unavailable it is recorded with its reason and is NOT a mismatch —
 *    an absent measurement says nothing about the target.
 *
 * 2. Compare what the state DOES, not where its element sits. Absolute and
 *    viewport-relative geometry is excluded by construction: inducing a state
 *    scrolls its element into view, so a coordinate measures the scroll as much
 *    as the state, and layout already answers that question (def_0031). A layout
 *    difference belongs to the layout category and is never reported twice.
 */

import { SEVERITY } from "./compare.mjs";
import * as color from "../util/color.mjs";

export const STATE = Object.freeze({
  DEFAULT: "default", HOVER: "hover", FOCUS: "focus", ACTIVE: "active",
  SELECTED: "selected", EXPANDED: "expanded", LOADING: "loading",
  EMPTY: "empty", ERROR: "error"
});

export const ALL_STATES = Object.freeze(Object.values(STATE));

/** The six statuses a state comparison can end in. */
export const STATE_STATUS = Object.freeze({
  MATCHED: "matched",
  MISMATCHED: "mismatched",
  UNAVAILABLE: "unavailable",
  BLOCKED: "blocked",
  UNKNOWN: "unknown",
  NOT_APPLICABLE: "not-applicable"
});

/** Why a side has no evidence. Preserved verbatim onto the record. */
export const STATE_EVIDENCE = Object.freeze({
  PRESENT: "present",
  NOT_INDUCED: "not-induced",
  NO_INDUCTION_DECLARED: "no-induction-declared",
  INDUCTION_TIMED_OUT: "induction-timed-out",
  SELECTOR_NOT_FOUND: "selector-not-found",
  STATE_NOT_IMPLEMENTED: "state-not-implemented"
});

/** Where the evidence for both sides came from. */
export const OBSERVATION = Object.freeze({
  BOTH: "observed-in-both",
  REFERENCE_ONLY: "observed-only-in-reference",
  TARGET_ONLY: "observed-only-in-target",
  REQUESTED_UNAVAILABLE: "requested-but-unavailable",
  NOT_APPLICABLE: "not-applicable"
});

/**
 * Properties a state may legitimately change.
 *
 * An allowlist rather than a denylist: anything not named here cannot become a
 * state difference by accident. Geometry is limited to intrinsic width and
 * height — a state can grow a disclosure panel, and that is real, but nothing
 * viewport-relative is admitted at all.
 */
export const STATE_PROPERTIES = Object.freeze([
  "backgroundColor", "color", "borderTopColor", "borderTopWidth", "borderRadius",
  "boxShadow", "outlineStyle", "outlineWidth", "outlineColor", "outlineOffset",
  "transform", "scale", "opacity", "visibility", "display", "cursor",
  "textDecorationLine", "fontWeight",
  "ariaSelected", "ariaExpanded", "ariaDisabled", "disabled", "role",
  "textContent", "width", "height"
]);

/**
 * Properties that must never become a state difference.
 *
 * Named explicitly so the exclusion is testable rather than implied by the
 * allowlist's silence.
 */
export const EXCLUDED_PROPERTIES = Object.freeze([
  "top", "left", "right", "bottom", "x", "y",
  "scrollTop", "scrollY", "pageYOffset", "offsetTop", "clientTop"
]);

const PX_TOLERANCE = 1.5;
const COLOR_TOLERANCE = 12;

export function stateObservation({
  state, available, reason = null, trigger = null, selector = null,
  properties = null, atRest = null, changedFromDefault = null,
  changedFromDefaultMeasurable = null, viewport = null, animationsFrozen = null,
  screenshot = null, evidenceIds = []
}) {
  return {
    state,
    trigger,
    selector,
    viewport,
    evidence: available ? STATE_EVIDENCE.PRESENT : (reason ?? STATE_EVIDENCE.NOT_INDUCED),
    available: !!available,
    properties: properties ?? null,
    atRest: atRest ?? null,
    changedFromDefault,
    changedFromDefaultMeasurable,
    animationsFrozen,
    screenshot,
    evidenceIds,
    reason: available ? null : (reason ?? STATE_EVIDENCE.NOT_INDUCED)
  };
}

/** Builds an observation from a `capture-states.mjs` record. */
export function fromCapture(record, { viewport = null } = {}) {
  if (!record) return stateObservation({ state: "unknown", available: false, reason: STATE_EVIDENCE.NOT_INDUCED });
  return stateObservation({
    state: record.state,
    available: record.available,
    reason: record.reason,
    trigger: record.trigger,
    selector: record.selector,
    properties: record.properties,
    atRest: record.atRest,
    changedFromDefault: record.changedFromDefault,
    changedFromDefaultMeasurable: record.changedFromDefaultMeasurable ?? null,
    viewport: viewport ?? record.viewport ?? null,
    animationsFrozen: record.animationsFrozen ?? null
  });
}

/**
 * Compares one property pair.
 *
 * Numeric properties compare as a DELTA from rest wherever a rest reading
 * exists, so a state that lifts an element by 2px agrees with another that
 * lifts it by 2px regardless of where either sits (def_0031).
 */
function compareProperty(name, refValue, tgtValue, refRest = null, tgtRest = null) {
  if (EXCLUDED_PROPERTIES.includes(name)) return null;
  if (refValue == null || tgtValue == null) return null;

  if (/^#|rgb|hsl|oklab|oklch/.test(String(refValue))) {
    const d = color.distance(String(refValue), String(tgtValue));
    if (d == null || d <= COLOR_TOLERANCE) return null;
    return { property: name, referenceValue: refValue, targetValue: tgtValue, kind: "color", distance: Number(d.toFixed(2)) };
  }

  const refNum = typeof refValue === "number" ? refValue : parseFloat(refValue);
  const tgtNum = typeof tgtValue === "number" ? tgtValue : parseFloat(tgtValue);
  if (Number.isFinite(refNum) && Number.isFinite(tgtNum)) {
    const refRestNum = refRest == null ? null : parseFloat(refRest);
    const tgtRestNum = tgtRest == null ? null : parseFloat(tgtRest);
    if (Number.isFinite(refRestNum) && Number.isFinite(tgtRestNum)) {
      const refDelta = refNum - refRestNum;
      const tgtDelta = tgtNum - tgtRestNum;
      if (Math.abs(refDelta - tgtDelta) <= PX_TOLERANCE) return null;
      return {
        property: name, kind: "numeric-delta",
        referenceValue: `${refDelta >= 0 ? "+" : ""}${Number(refDelta.toFixed(2))} from rest`,
        targetValue: `${tgtDelta >= 0 ? "+" : ""}${Number(tgtDelta.toFixed(2))} from rest`
      };
    }
    if (Math.abs(refNum - tgtNum) <= PX_TOLERANCE) return null;
    return {
      property: name, referenceValue: refValue, targetValue: tgtValue, kind: "numeric-absolute",
      caveat: "no at-rest reading was available, so this compares absolute values"
    };
  }

  if (String(refValue) === String(tgtValue)) return null;
  return { property: name, referenceValue: refValue, targetValue: tgtValue, kind: "literal" };
}

/** How severe a given property's disagreement is. */
function severityForProperty(name) {
  if (["outlineStyle", "outlineWidth", "outlineColor"].includes(name)) return SEVERITY.HIGH;
  if (["visibility", "display", "ariaExpanded", "ariaSelected", "disabled"].includes(name)) return SEVERITY.HIGH;
  if (["textContent"].includes(name)) return SEVERITY.MEDIUM;
  return SEVERITY.MEDIUM;
}

/** Classifies where the evidence came from, independent of the verdict. */
export function observationClass(reference, target) {
  if (reference?.available && target?.available) return OBSERVATION.BOTH;
  if (reference?.available && !target?.available) return OBSERVATION.REFERENCE_ONLY;
  if (!reference?.available && target?.available) return OBSERVATION.TARGET_ONLY;
  return OBSERVATION.REQUESTED_UNAVAILABLE;
}

/**
 * Compares one state across both sides.
 *
 * `requiredByMode` marks a state the requested mode explicitly needs; only then
 * does an unavailable state block rather than sit unknown.
 */
export function compareState({
  state, reference, target, viewport = null,
  requiredByMode = false, applicable = true, targetBriefRequested = false
}) {
  const observation = observationClass(reference, target);
  const base = {
    state,
    viewport: viewport ?? reference?.viewport ?? target?.viewport ?? null,
    trigger: reference?.trigger ?? target?.trigger ?? null,
    selector: reference?.selector ?? target?.selector ?? null,
    requiredByMode,
    targetBriefRequested,
    observation,
    referenceEvidence: reference ?? null,
    targetEvidence: target ?? null,
    evidenceIds: [...(reference?.evidenceIds ?? []), ...(target?.evidenceIds ?? [])],
    animationsFrozen: (reference?.animationsFrozen ?? null) === false || (target?.animationsFrozen ?? null) === false
      ? false
      : (reference?.animationsFrozen ?? target?.animationsFrozen ?? null),
    limitations: []
  };

  if (!applicable) {
    return {
      ...base,
      status: STATE_STATUS.NOT_APPLICABLE,
      mismatch: false, differences: [], confidence: null,
      reason: "the state does not apply to this component",
      captureStatus: "not-attempted",
      note: `\`${state}\` does not apply here and was not compared.`
    };
  }

  if (observation !== OBSERVATION.BOTH) {
    const missing = [];
    if (!reference?.available) missing.push(`reference: ${reference?.reason ?? STATE_EVIDENCE.NOT_INDUCED}`);
    if (!target?.available) missing.push(`target: ${target?.reason ?? STATE_EVIDENCE.NOT_INDUCED}`);

    /* `unavailable` when the state was reached and found not to exist;
     * `unknown` when it could not be reached at all. The distinction matters:
     * one is a fact about the implementation, the other about the capture. */
    const notImplemented =
      reference?.reason === STATE_EVIDENCE.STATE_NOT_IMPLEMENTED ||
      target?.reason === STATE_EVIDENCE.STATE_NOT_IMPLEMENTED;

    const status = requiredByMode
      ? STATE_STATUS.BLOCKED
      : notImplemented ? STATE_STATUS.UNAVAILABLE : STATE_STATUS.UNKNOWN;

    return {
      ...base,
      status,
      /* Never a mismatch. Not even when the target does not implement it — that
       * is `unavailable`, and inventing the state would be worse. */
      mismatch: false,
      differences: [],
      confidence: null,
      reason: missing.join("; "),
      captureStatus: notImplemented ? "state-not-implemented" : "not-captured",
      blocksMode: requiredByMode,
      note: requiredByMode
        ? `The requested mode requires \`${state}\` and it is unavailable, so the comparison is blocked.`
        : notImplemented
          ? `\`${state}\` was reached and is not implemented on one side. Recorded as unavailable, not as a mismatch.`
          : `\`${state}\` could not be reached on at least one side. Recorded with its reason; not counted against the target.`
    };
  }

  const names = new Set([
    ...Object.keys(reference.properties ?? {}),
    ...Object.keys(target.properties ?? {})
  ].filter((n) => STATE_PROPERTIES.includes(n)));

  const differences = [];
  const unavailableProperties = [];
  for (const name of names) {
    const refV = reference.properties?.[name];
    const tgtV = target.properties?.[name];
    if (refV == null || tgtV == null) {
      unavailableProperties.push(`${name} (absent on ${refV == null ? "reference" : "target"})`);
      continue;
    }
    const diff = compareProperty(name, refV, tgtV, reference.atRest?.[name], target.atRest?.[name]);
    if (diff) differences.push({ ...diff, severity: severityForProperty(name) });
  }

  /* Whether the state does anything at all, compared only where both sides
   * could measure it. A route-induced state has no rest reading, so this is
   * skipped rather than guessed. */
  if (reference.changedFromDefaultMeasurable && target.changedFromDefaultMeasurable &&
      reference.changedFromDefault != null && target.changedFromDefault != null &&
      reference.changedFromDefault !== target.changedFromDefault) {
    differences.push({
      property: "state-has-effect",
      referenceValue: reference.changedFromDefault,
      targetValue: target.changedFromDefault,
      kind: "behaviour",
      severity: SEVERITY.HIGH
    });
  }

  const limitations = [];
  if (base.animationsFrozen === false) {
    limitations.push("Animation could not be frozen for this capture, so no timing claim is drawn from it.");
  }
  if (!reference.changedFromDefaultMeasurable || !target.changedFromDefaultMeasurable) {
    limitations.push("This state is reached by route or attribute, so whether it changes anything from rest was not measurable.");
  }

  return {
    ...base,
    limitations,
    status: differences.length ? STATE_STATUS.MISMATCHED : STATE_STATUS.MATCHED,
    mismatch: differences.length > 0,
    differences,
    comparedProperties: names.size - unavailableProperties.length,
    unavailableProperties,
    confidence: 0.95,
    captureStatus: "captured",
    blocksMode: false,
    reason: null,
    note: differences.length
      ? `Both sides had evidence for \`${state}\`; ${differences.length} propert${differences.length === 1 ? "y" : "ies"} differ.`
      : `Both sides had evidence for \`${state}\` and it agrees.`
  };
}

/**
 * Accessibility checks derived from state evidence.
 *
 * These are findings about the target's own behaviour, not comparisons, so they
 * survive a missing reference state. Where the reference exhibits the same
 * condition the finding is demoted rather than dropped.
 */
export function accessibilityStateFindings({ results, referenceResults = null, tapTargetMinimum = 44, viewport = null }) {
  const findings = [];
  const byState = new Map(results.map((r) => [r.state, r]));

  const focus = byState.get(STATE.FOCUS);
  if (focus?.status === STATE_STATUS.MISMATCHED || focus?.status === STATE_STATUS.MATCHED) {
    const tgt = focus.targetEvidence?.properties ?? {};
    const ref = focus.referenceEvidence?.properties ?? {};
    const invisible = (p) =>
      p.outlineStyle === "none" || parseFloat(p.outlineWidth ?? "0") === 0;

    if (invisible(tgt)) {
      findings.push({
        check: "visible-focus",
        state: STATE.FOCUS,
        viewport,
        severity: invisible(ref) ? SEVERITY.INFORMATIONAL : SEVERITY.HIGH,
        correlation: invisible(ref) ? "reference-correlated" : "target-only",
        targetEvidence: { outlineStyle: tgt.outlineStyle, outlineWidth: tgt.outlineWidth },
        referenceEvidence: { outlineStyle: ref.outlineStyle, outlineWidth: ref.outlineWidth },
        detail: invisible(ref)
          ? "Neither side renders a visible focus indicator. The target is not diverging from the reference, and both have the problem."
          : "The target renders no visible focus indicator where the reference does. Keyboard users cannot see what is focused.",
        actionable: !invisible(ref)
      });
    }

    /* Contrast of the indicator against what it sits on, where both are known. */
    if (!invisible(tgt) && tgt.outlineColor && tgt.backgroundColor) {
      const ratio = color.contrast(tgt.outlineColor, tgt.backgroundColor);
      if (ratio != null && ratio < 3) {
        findings.push({
          check: "focus-indicator-contrast",
          state: STATE.FOCUS, viewport,
          severity: SEVERITY.MEDIUM, correlation: "target-only",
          targetEvidence: { outlineColor: tgt.outlineColor, against: tgt.backgroundColor, ratio: Number(ratio.toFixed(2)) },
          detail: `The focus indicator measures ${ratio.toFixed(2)}:1 against its own background, below the 3:1 guideline.`,
          actionable: true
        });
      }
    }
  }

  /* A hover treatment with no keyboard equivalent. */
  const hover = byState.get(STATE.HOVER);
  if (hover?.status === STATE_STATUS.MATCHED || hover?.status === STATE_STATUS.MISMATCHED) {
    const hoverChanges = hover.targetEvidence?.changedFromDefault === true;
    const focusMissing = !focus || focus.status === STATE_STATUS.UNKNOWN ||
      focus.targetEvidence?.available === false ||
      focus.targetEvidence?.changedFromDefault === false;
    if (hoverChanges && focusMissing) {
      findings.push({
        check: "hover-only-behaviour",
        state: STATE.HOVER, viewport,
        severity: SEVERITY.HIGH, correlation: "target-only",
        targetEvidence: { hoverChangesSomething: true, focusEquivalent: false },
        detail: "The target changes on hover but has no equivalent focus treatment, so the behaviour is unreachable by keyboard or touch.",
        actionable: true
      });
    }
  }

  /* Selected, disabled, error and loading must be distinguishable. */
  const selected = byState.get(STATE.SELECTED);
  if (selected?.status === STATE_STATUS.MATCHED || selected?.status === STATE_STATUS.MISMATCHED) {
    const p = selected.targetEvidence?.properties ?? {};
    if (p.ariaSelected == null) {
      findings.push({
        check: "selected-state-distinction", state: STATE.SELECTED, viewport,
        severity: SEVERITY.MEDIUM, correlation: "target-only",
        targetEvidence: { ariaSelected: null },
        detail: "The selected state carries no `aria-selected`, so it is distinguished visually only.",
        actionable: true
      });
    }
  }

  const error = byState.get(STATE.ERROR);
  if (error?.status === STATE_STATUS.MATCHED || error?.status === STATE_STATUS.MISMATCHED) {
    const p = error.targetEvidence?.properties ?? {};
    if (p.role !== "alert" && !/error|could not|failed|try again/i.test(p.textContent ?? "")) {
      findings.push({
        check: "error-state-clarity", state: STATE.ERROR, viewport,
        severity: SEVERITY.MEDIUM, correlation: "target-only",
        targetEvidence: { role: p.role ?? null },
        detail: "The error state carries neither an alert role nor recognisable error text.",
        actionable: true
      });
    }
  }

  const loading = byState.get(STATE.LOADING);
  if (loading?.status === STATE_STATUS.UNAVAILABLE) {
    findings.push({
      check: "loading-state-communication", state: STATE.LOADING, viewport,
      severity: SEVERITY.MEDIUM, correlation: "target-only",
      targetEvidence: { implemented: false },
      detail: "The target does not implement a loading state, so a slow response communicates nothing.",
      actionable: true
    });
  }

  /* Tap targets. Preserved at full severity — never silently reduced. */
  const tapEvidence = results.find((r) => r.tapTarget)?.tapTarget ?? null;
  if (tapEvidence?.minHeight != null && tapEvidence.minHeight < tapTargetMinimum) {
    findings.push({
      check: "tap-target-dimensions", state: null, viewport,
      severity: SEVERITY.HIGH, correlation: "target-only",
      targetEvidence: { minHeight: tapEvidence.minHeight, minimum: tapTargetMinimum },
      detail: `The smallest interactive target measures ${tapEvidence.minHeight}px against a ${tapTargetMinimum}px minimum.`,
      actionable: true,
      classification: "responsive-accessibility-mismatch"
    });
  }

  return findings;
}

/**
 * Scores the states category.
 *
 * `unknown`, `unavailable`, `blocked` and `not-applicable` are all excluded from
 * the score and listed as unresolved: none of them is evidence of agreement, and
 * none is evidence of disagreement.
 */
export function scoreStates(results, { accessibilityFindings = [] } = {}) {
  const compared = results.filter((r) => r.status === STATE_STATUS.MATCHED || r.status === STATE_STATUS.MISMATCHED);
  const agreed = results.filter((r) => r.status === STATE_STATUS.MATCHED).length;
  const unresolved = results
    .filter((r) => !compared.includes(r))
    .map((r) => `${r.state} (${r.status}: ${r.reason ?? "no reason recorded"})`);

  const severityDistribution = { critical: 0, high: 0, medium: 0, low: 0, informational: 0 };
  for (const r of results) for (const d of r.differences ?? []) severityDistribution[d.severity]++;
  for (const f of accessibilityFindings) severityDistribution[f.severity]++;

  const limitations = [
    "States are induced one at a time and read as computed values; a state whose effect is purely compositional is not captured.",
    "Viewport-relative geometry is excluded from state comparison by construction; layout differences stay in the layout category."
  ];
  if (results.some((r) => r.animationsFrozen === false)) {
    limitations.push("Animation could not be frozen for at least one state, so no timing claim is drawn from those captures.");
  }

  return {
    category: "states",
    score: compared.length === 0 ? null : Number((agreed / compared.length).toFixed(3)),
    evidenceCoverage: results.length === 0 ? 0 : Number((compared.length / results.length).toFixed(3)),
    mismatchCount: results.filter((r) => r.mismatch).length + accessibilityFindings.filter((f) => f.actionable).length,
    severityDistribution,
    unresolvedClaims: unresolved,
    confidence: compared.length ? 0.95 : null,
    blockers: results.filter((r) => r.status === STATE_STATUS.BLOCKED).map((r) => `${r.state}: ${r.reason}`),
    limitations,
    accessibilityFindings
  };
}

/**
 * Mode behaviour.
 *
 * `analyze` proceeds on incomplete state evidence with warnings; `recreate`
 * blocks only on a REQUESTED CRITICAL state; `adapt` keeps target-brief
 * requirements separate from reference evidence; `improve` keeps proposals
 * structurally apart from observations.
 */
export function evaluateStatesForMode({ mode, results, criticalStates = [], briefRequestedStates = [] }) {
  const byState = new Map(results.map((r) => [r.state, r]));
  const unresolved = results.filter((r) =>
    r.status === STATE_STATUS.UNKNOWN || r.status === STATE_STATUS.UNAVAILABLE || r.status === STATE_STATUS.BLOCKED);

  if (mode === "analyze") {
    return {
      mode, decision: "allowed",
      warnings: unresolved.map((r) => `\`${r.state}\` is ${r.status}: ${r.reason}`),
      available: results.filter((r) => r.status === STATE_STATUS.MATCHED || r.status === STATE_STATUS.MISMATCHED).map((r) => r.state),
      unknown: unresolved.map((r) => r.state),
      note: "Analyze reports what was observed and preserves what was not. Incomplete state evidence warns rather than blocks."
    };
  }

  if (mode === "recreate") {
    const missingCritical = criticalStates.filter((s) => {
      const r = byState.get(s);
      return !r || (r.status !== STATE_STATUS.MATCHED && r.status !== STATE_STATUS.MISMATCHED);
    });
    const missingOptional = unresolved.filter((r) => !criticalStates.includes(r.state)).map((r) => r.state);
    return {
      mode,
      decision: missingCritical.length ? "blocked" : (missingOptional.length ? "allowed-with-warnings" : "allowed"),
      blockingStates: missingCritical,
      warnings: missingOptional.map((s) => `\`${s}\` is unavailable and was not requested as critical`),
      note: missingCritical.length
        ? `Blocked: the requested critical state(s) ${missingCritical.join(", ")} lack sufficient evidence.`
        : "An optional state being unavailable does not block recreate."
    };
  }

  if (mode === "adapt") {
    const observed = results
      .filter((r) => r.status === STATE_STATUS.MATCHED || r.status === STATE_STATUS.MISMATCHED)
      .map((r) => ({ state: r.state, source: "reference-evidence" }));
    const requested = briefRequestedStates.map((s) => ({
      state: s,
      source: "target-brief-requirement",
      referenceEvidence: byState.get(s)?.status === STATE_STATUS.MATCHED || byState.get(s)?.status === STATE_STATUS.MISMATCHED
        ? "available"
        : "none — this state is a target decision, not reference evidence"
    }));
    return {
      mode, decision: "allowed",
      observedStatePrinciples: observed,
      targetRequiredStates: requested,
      note: "Observed state principles and target-brief requirements are listed separately. A brief may request a state the reference does not have; that is a target decision and is labelled as one. Missing states are never invented."
    };
  }

  if (mode === "improve") {
    const observations = results
      .filter((r) => r.status === STATE_STATUS.MATCHED || r.status === STATE_STATUS.MISMATCHED)
      .map((r) => ({ kind: "observation", state: r.state, detail: r.note }));
    const proposals = unresolved.map((r) => ({
      kind: "proposal",
      state: r.state,
      detail: `**Proposed:** add a \`${r.state}\` state. The reference does not provide one — this is a proposal, not observed behaviour.`,
      observedInReference: false
    }));
    return {
      mode, decision: "allowed",
      observations, proposals,
      note: "Observations and proposals are structurally separate. A proposed focus, loading or error state is never described as existing in the reference."
    };
  }

  return { mode, decision: "allowed", note: "No state-specific behaviour is defined for this mode." };
}

/** Correction tasks for state mismatches. */
export function stateTasks({ results, accessibilityFindings = [], viewport = null }) {
  const tasks = [];
  let seq = 0;
  const nextId = () => `state_task_${String(++seq).padStart(3, "0")}`;

  for (const r of results.filter((x) => x.status === STATE_STATUS.MISMATCHED)) {
    for (const d of r.differences) {
      tasks.push({
        id: nextId(),
        state: r.state,
        viewport: r.viewport ?? viewport,
        category: "states",
        severity: d.severity,
        referenceEvidence: { state: r.state, property: d.property, value: d.referenceValue, trigger: r.trigger, selector: r.selector },
        targetEvidence: { state: r.state, property: d.property, value: d.targetValue, trigger: r.trigger, selector: r.selector },
        currentValue: d.targetValue,
        expectedValue: d.referenceValue,
        confidence: r.confidence,
        mode: "manual",
        notAutomaticBecause: [
          "a state treatment is applied through a selector, and no deploy-safe selector is guaranteed for the target",
          "component identity is unresolved across implementations (def_0030)"
        ],
        acceptanceCondition:
          `With \`${r.state}\` induced on the target, \`${d.property}\` reports ${JSON.stringify(d.referenceValue)}, ` +
          "and no other category score decreases."
      });
    }
  }

  for (const f of accessibilityFindings.filter((x) => x.actionable)) {
    tasks.push({
      id: nextId(),
      state: f.state,
      viewport: f.viewport ?? viewport,
      category: "states",
      severity: f.severity,
      referenceEvidence: f.referenceEvidence ?? { note: "target-only accessibility finding" },
      targetEvidence: f.targetEvidence,
      currentValue: f.targetEvidence,
      expectedValue: f.check === "visible-focus"
        ? "a visible focus indicator"
        : f.check === "tap-target-dimensions"
          ? `${f.targetEvidence?.minimum ?? 44}px minimum`
          : "the condition resolved",
      confidence: 0.95,
      mode: "manual",
      notAutomaticBecause: ["an accessibility treatment is a design decision, not a value substitution"],
      acceptanceCondition: `\`${f.check}\` no longer reports a finding at ${f.viewport ?? viewport}px.`,
      accessibilityCheck: f.check,
      classification: f.classification ?? null
    });
  }

  return tasks;
}

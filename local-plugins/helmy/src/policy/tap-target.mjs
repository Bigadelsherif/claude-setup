/**
 * Tap-target policy.
 *
 * Phase 4.5's `cand_03` recorded a real overstatement: the reports cited 44px as
 * *the* minimum when two published standards disagree. WCAG 2.2 AA specifies
 * 24×24 CSS pixels with named exceptions; Apple's HIG recommends 44×44 and
 * Material's guidance 48×48. None of them is "the" universal requirement.
 *
 * So the minimum is a project policy, not a constant. Whichever is chosen
 * travels with every finding, task, report and artifact, so a reader can see
 * which standard a finding was judged against rather than inferring it.
 */

export const TAP_TARGET_POLICIES = Object.freeze({
  "wcag-2.2-aa": {
    policyName: "wcag-2.2-aa",
    policySource: "WCAG 2.2 Success Criterion 2.5.8 Target Size (Minimum), Level AA",
    minimumTapTargetPx: 24,
    severityBelowMinimum: "high",
    exceptions: [
      "inline targets within a sentence or block of text",
      "targets whose size is determined by the user agent and not modified by the author",
      "an equivalent target of sufficient size is available on the same page",
      "the presentation of the target is essential to the information being conveyed"
    ],
    touchOnly: false,
    keyboardOnly: false
  },
  "apple-hig": {
    policyName: "apple-hig",
    policySource: "Apple Human Interface Guidelines — minimum tappable area",
    minimumTapTargetPx: 44,
    severityBelowMinimum: "high",
    exceptions: [],
    touchOnly: true,
    keyboardOnly: false
  },
  "material-3": {
    policyName: "material-3",
    policySource: "Material Design 3 — touch target accessibility",
    minimumTapTargetPx: 48,
    severityBelowMinimum: "high",
    exceptions: [],
    touchOnly: true,
    keyboardOnly: false
  }
});

/**
 * The default, stated rather than assumed.
 *
 * Apple HIG at 44px is kept as the default because it is what every prior phase
 * measured against, and silently loosening it to WCAG's 24px would retire
 * findings that Phases 4.2 and 4.3 deliberately preserved. The choice is
 * recorded here so it reads as a decision rather than as a fact about the web.
 */
export const DEFAULT_POLICY_NAME = "apple-hig";

export const DEFAULT_TAP_TARGET_POLICY = Object.freeze({
  ...TAP_TARGET_POLICIES[DEFAULT_POLICY_NAME],
  isDefault: true,
  defaultRationale:
    "Apple HIG's 44px is the default because every prior phase measured against it; changing it would " +
    "retire existing findings. WCAG 2.2 AA specifies 24px with exceptions, and Material 48px. No minimum " +
    "is universally required, so the selected policy travels with every finding."
});

/** Resolves a policy from a name, an inline object, or nothing. */
export function resolveTapTargetPolicy(input) {
  if (!input) return { ...DEFAULT_TAP_TARGET_POLICY, resolvedFrom: "default" };

  if (typeof input === "string") {
    const known = TAP_TARGET_POLICIES[input];
    if (!known) {
      return {
        ...DEFAULT_TAP_TARGET_POLICY,
        resolvedFrom: "default",
        warning: `Unknown tap-target policy \`${input}\`; the default was used and the request is recorded rather than silently honoured.`,
        requested: input
      };
    }
    return { ...known, isDefault: input === DEFAULT_POLICY_NAME, resolvedFrom: "named" };
  }

  /* An inline policy must still declare where its number comes from — an
   * undocumented minimum is the thing this module exists to prevent. */
  const base = TAP_TARGET_POLICIES[input.policyName] ?? DEFAULT_TAP_TARGET_POLICY;
  return {
    ...base,
    ...input,
    isDefault: false,
    resolvedFrom: "inline",
    policySource: input.policySource ?? `${base.policySource} (modified inline)`,
    undocumentedSource: !input.policySource
  };
}

/**
 * Evaluates one measured target against the policy.
 *
 * Returns `null` when the target meets the minimum or a declared exception
 * applies — the exception is named on the result so a reader can disagree with
 * it rather than wonder why nothing was reported.
 */
export function evaluateTapTarget({ width, height, policy, selector = null, exceptionsApplying = [] }) {
  const p = policy ?? DEFAULT_TAP_TARGET_POLICY;
  const smallest = Math.min(width ?? Infinity, height ?? Infinity);

  if (exceptionsApplying.length) {
    return {
      meetsPolicy: true,
      exempt: true,
      exceptionsApplied: exceptionsApplying,
      policy: policySummary(p),
      selector,
      detail: `Exempt under ${p.policyName}: ${exceptionsApplying.join("; ")}.`
    };
  }

  if (smallest >= p.minimumTapTargetPx) {
    return null;
  }

  return {
    meetsPolicy: false,
    exempt: false,
    measured: { width, height, smallest },
    minimum: p.minimumTapTargetPx,
    shortfall: Number((p.minimumTapTargetPx - smallest).toFixed(2)),
    severity: p.severityBelowMinimum,
    policy: policySummary(p),
    selector,
    detail:
      `${selector ?? "the target"} measures ${width}x${height}, smallest side ${smallest}px, against the ` +
      `${p.minimumTapTargetPx}px minimum of ${p.policyName} (${p.policySource}).`
  };
}

/** The compact form that travels onto findings, tasks, IR metadata and reports. */
export function policySummary(policy) {
  const p = policy ?? DEFAULT_TAP_TARGET_POLICY;
  return {
    policyName: p.policyName,
    policySource: p.policySource,
    minimumTapTargetPx: p.minimumTapTargetPx,
    severityBelowMinimum: p.severityBelowMinimum,
    touchOnly: p.touchOnly,
    keyboardOnly: p.keyboardOnly,
    exceptionCount: (p.exceptions ?? []).length,
    isDefault: p.isDefault === true
  };
}

/**
 * Confirms the policy reached everywhere it must.
 *
 * A policy that appears in the IR but not on the finding leaves a reader unable
 * to tell which standard a 28px target was judged against.
 */
export function verifyPolicyPropagation({ irMetadata, findings = [], tasks = [], reportText = "" }) {
  const wanted = irMetadata?.tapTargetPolicy?.policyName ?? null;
  const missing = [];

  if (!wanted) missing.push("ir-metadata");
  for (const f of findings) {
    if (f.check !== "tap-target-undersized") continue;
    if (f.policy?.policyName !== wanted) missing.push(`finding:${f.id ?? f.selector}`);
  }
  for (const t of tasks) {
    if (t.check !== "tap-target-undersized" && t.accessibilityCheck !== "tap-target-dimensions") continue;
    if (t.policy?.policyName !== wanted) missing.push(`task:${t.id}`);
  }
  if (reportText && wanted && !reportText.includes(wanted)) missing.push("report");

  return {
    policyName: wanted,
    propagated: missing.length === 0,
    missingFrom: missing,
    statement: missing.length === 0
      ? `The \`${wanted}\` policy appears in the IR metadata, every tap-target finding, every task and the report.`
      : `The policy is absent from: ${missing.join(", ")}. A finding without its policy cannot be read.`
  };
}

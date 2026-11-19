/**
 * Mode evaluation — runs BEFORE projection.
 *
 * Answers the Phase 2 question: is the evidence sufficient for the output that
 * was actually requested? A gap only blocks when the requested mode depends on
 * it. `analyze` does not need component anatomy; `recreate` cannot proceed
 * without it; neither cares about the same things.
 */

import { STATUS } from "../evidence/status.mjs";
import { displaySelector } from "../component/display-name.mjs";
import {
  DECISION, REMEDY, RESOLVER, DEFAULT_REQUEST,
  requirementsFor, isKnownMode
} from "./requirements.mjs";

const STATUS_RANK = {
  [STATUS.MEASURED]: 4,
  [STATUS.OBSERVED]: 3,
  [STATUS.INFERRED]: 2,
  [STATUS.ESTIMATED]: 1,
  [STATUS.UNKNOWN]: 0
};

/**
 * Claim paths are addressed by a stable alias rather than by walking the IR,
 * because the IR nests some claims inside arrays (containers[0], grids[0]) and
 * requirements should not have to know that.
 */
function resolveClaim(ir, path) {
  switch (path) {
    case "layout.container.maxWidth":
      return ir.layout?.containers?.[0]?.maxWidth ?? null;
    case "layout.container.paddingX":
      return ir.layout?.containers?.[0]?.paddingX ?? null;
    case "layout.grid.columns":
      return ir.layout?.grids?.[0]?.columns ?? null;
    case "layout.grid.gap":
      return ir.layout?.grids?.[0]?.gap ?? null;
    case "layout.breakpoints":
      return ir.layout?.breakpoints ?? null;
    default:
      break;
  }

  return path.split(".").reduce((node, key) => {
    if (node == null) return null;
    return node[key] ?? null;
  }, ir);
}

const isPresent = (claim, minStatus) => {
  if (!claim || claim.value == null) return false;
  if (claim.status === STATUS.UNKNOWN) return false;
  return STATUS_RANK[claim.status] >= STATUS_RANK[minStatus ?? STATUS.ESTIMATED];
};

const primaryComponent = (ir) =>
  ir.components?.find((c) => c.role !== "action") ?? ir.components?.[0] ?? null;

/* --------------------------------------------------------------- resolvers */

const RESOLVERS = {
  [RESOLVER.REGION]: (ir) => {
    const reached = (ir.coverage?.contentReached ?? 0) > 0;
    const verified = ir.verification?.passed !== false;
    return {
      satisfied: reached && verified,
      detail: reached
        ? verified
          ? `Content region reached (contentReached ${ir.coverage.contentReached.toFixed(2)}).`
          : "Content region sampled but region verification failed."
        : (ir.coverage?.contentReachedReason ?? "The content region was never reached.")
    };
  },

  [RESOLVER.CLAIM]: (ir, req) => {
    const found = req.claims.map((path) => ({ path, claim: resolveClaim(ir, path) }));
    const present = found.filter((f) => isPresent(f.claim, req.minStatus));
    const satisfied = req.match === "any" ? present.length > 0 : present.length === found.length;
    const missing = found.filter((f) => !isPresent(f.claim, req.minStatus)).map((f) => f.path);
    return {
      satisfied,
      detail: satisfied
        ? `${present.map((p) => `${p.path}=${p.claim.value}`).join(", ")}`
        : `missing or below "${req.minStatus}": ${missing.join(", ")}`,
      missingClaims: missing
    };
  },

  [RESOLVER.COMPONENT]: (ir, req) => {
    const component = primaryComponent(ir);
    if (!component) {
      const candidates = ir.componentCandidates ?? [];
      return {
        satisfied: false,
        detail: candidates.length
          ? `No component was modelled. ${candidates.length} candidate(s) rejected: ${candidates[0].rejectedBecause.join("; ")}.`
          : "No component was detected at all."
      };
    }
    /* The anatomy guard decides first.
     *
     * Counting `anatomy.length` stopped meaning what it used to the moment
     * non-surface structure was added to that array: an unpainted component
     * with one reliable property still carries several entries, because tag and
     * geometry live there too. The guard already reached the right conclusion
     * and was simply never consulted (def_0028). */
    const verdict = component.anatomyVerdict ?? null;
    if (verdict?.blocksRecreate && (req.minAnatomy ?? 0) > 0) {
      return {
        satisfied: false,
        detail:
          `\`${displaySelector(component)}\` cannot be rebuilt from what was observed. ${verdict.reason} ` +
          "This is a finding about the component, not a capture failure — recapturing will not add properties that are not there."
      };
    }

    /* Which anatomy entries count depends on whether the component paints.
     *
     * A component with a surface is characterised by that surface, and thin
     * surface evidence is exactly what the recreate gate was built to catch —
     * `stripe-pricing-1440` resolved a background and nothing else. Letting
     * `structure.tag` and `structure.spacing` make up the difference would
     * substitute structure for surface detail on a component that has one.
     * The phase brief permits that substitution only where there is no surface
     * at all, and the guard above already handles that case. */
    const entries = component.anatomy ?? [];
    const paints = component.surfaceObserved === true && component.surface != null;
    const counted = paints
      ? entries.filter((a) => a.part === "surface" || a.part === "painted-descendant")
      : entries;
    const anatomy = counted.length;
    const confidence = component.confidence ?? 0;
    const satisfied = anatomy >= req.minAnatomy && confidence >= (req.minConfidence ?? 0);
    const basis = paints ? "surface" : "structural";
    return {
      satisfied,
      detail: satisfied
        ? `\`${displaySelector(component)}\` with ${anatomy} ${basis} anatomy propert${anatomy === 1 ? "y" : "ies"} at confidence ${confidence.toFixed(2)}.`
        : `\`${displaySelector(component)}\` resolved only ${anatomy} ${basis} anatomy propert${anatomy === 1 ? "y" : "ies"} at confidence ${confidence.toFixed(2)}; ` +
          `${req.minAnatomy} and ${(req.minConfidence ?? 0).toFixed(2)} required.`
    };
  },

  [RESOLVER.COMPONENT_VARIANTS]: (ir, req) => {
    const withVariants = (ir.components ?? []).filter((c) => (c.variants?.length ?? 0) >= req.minVariants);
    return {
      satisfied: withVariants.length > 0,
      detail: withVariants.length
        ? `${withVariants.length} component(s) carry variants.`
        : "No component carries a recorded variant, so how the system flexes is unknown."
    };
  },

  [RESOLVER.TOKEN_GROUP]: (ir, req) => {
    const populated = req.groups.filter((g) => Object.keys(ir.tokens?.[g] ?? {}).length > 0);
    return {
      satisfied: populated.length >= (req.minGroups ?? 1),
      detail: populated.length
        ? `token families present: ${populated.join(", ")}.`
        : `none of ${req.groups.join(", ")} produced a token.`
    };
  },

  [RESOLVER.COLOR_ROLES]: (ir, req) => {
    const roles = Object.entries(ir.tokens?.color ?? {}).filter(
      ([, claim]) => claim?.value != null && claim.status !== STATUS.UNKNOWN
    );
    return {
      satisfied: roles.length >= req.minCount,
      detail: `${roles.length} colour role(s): ${roles.map(([k]) => k).join(", ") || "none"}.`
    };
  },

  [RESOLVER.VIEWPORTS]: (ir, req, request) => {
    const captured = ir.meta?.viewports ?? [];
    const requested = request.viewports ?? [];
    const missing = requested.filter((v) => !captured.includes(v));
    return {
      satisfied: missing.length === 0,
      detail: missing.length
        ? `requested ${requested.join(", ")}px but captured only ${captured.join(", ") || "none"}px.`
        : `all requested viewports captured (${captured.join(", ")}px).`
    };
  },

  [RESOLVER.STATES]: (ir, req) => {
    let determined = 0;
    for (const component of ir.components ?? []) {
      for (const [name, state] of Object.entries(component.states ?? {})) {
        if (name === "default") continue;
        if (state?.status && state.status !== STATUS.UNKNOWN) determined += 1;
      }
    }
    return {
      satisfied: determined >= (req.minDetermined ?? 1),
      detail: determined
        ? `${determined} non-default state(s) determined.`
        : "no hover, focus or disabled state was induced in this capture."
    };
  },

  [RESOLVER.IMAGERY]: (ir) => {
    // A page with no imagery satisfies this trivially — absence of media is
    // not absence of evidence about media.
    const hasImagery = (ir.tokens?.imagery && Object.keys(ir.tokens.imagery).length > 0) || false;
    const componentsWithMedia = (ir.components ?? []).some((c) =>
      (c.anatomy ?? []).some((a) => /media|image|aspect/i.test(a.property ?? ""))
    );
    return {
      satisfied: true,
      soft: !(hasImagery || componentsWithMedia),
      detail: hasImagery || componentsWithMedia
        ? "imagery behaviour recorded."
        : "no imagery behaviour recorded; the sampled region may use none."
    };
  },

  [RESOLVER.MOTION]: (ir) => {
    const transitions = ir.motion?.transitions ?? [];
    const usable = transitions.filter((t) => t.duration?.value != null);
    return {
      satisfied: usable.length > 0,
      detail: usable.length
        ? `${usable.length} transition definition(s) recorded.`
        : "no transition timing was observed."
    };
  },

  [RESOLVER.TARGET_BRIEF]: (ir, req, request) => {
    const brief = request.targetBrief ?? null;
    if (!brief) {
      return {
        satisfied: false,
        detail: "No target brief supplied. Place a validated target-brief.json in the workspace's input/ directory."
      };
    }
    if (brief.$invalid) {
      return { satisfied: false, detail: `Target brief failed validation: ${brief.$invalid}` };
    }
    return {
      satisfied: true,
      detail: `Brief for "${brief.product}" (${brief.productType}) targeting ${brief.targetPage?.name}.`
    };
  },

  [RESOLVER.UNCONTESTED]: (ir) => {
    const contested = (ir.contestedClaims ?? []).filter(
      (c) => c.critical && c.resolutionStatus !== "resolved-by-correction"
    );
    return {
      satisfied: contested.length === 0,
      detail: contested.length
        ? `${contested.length} critical claim(s) contested between sources: ` +
          contested.map((c) => `${c.claim} (${c.type})`).join(", ") + "."
        : "No critical claim is contested between sources."
    };
  },

  [RESOLVER.A11Y]: (ir) => {
    const findings = ir.a11y?.contrastFindings ?? [];
    return {
      satisfied: findings.length > 0,
      detail: findings.length
        ? `${findings.length} contrast finding(s) available.`
        : "no accessibility evidence was produced."
    };
  }
};

/* ------------------------------------------------------------ evaluation */

function evaluateRequirement(requirement, ir, request) {
  const resolver = RESOLVERS[requirement.resolver];
  if (!resolver) {
    return {
      ...summarise(requirement),
      satisfied: false,
      severity: "blocking",
      detail: `No resolver implemented for "${requirement.resolver}".`
    };
  }

  const result = resolver(ir, requirement, request);

  // A requirement can be promoted to blocking by the request itself — motion is
  // advisory unless motion recreation was asked for.
  let severity = requirement.severity;
  if (requirement.conditionalOn && request[requirement.conditionalOn]) {
    severity = requirement.conditionalSeverity ?? severity;
  }
  if (result.soft && severity === "blocking") severity = "warning";

  return {
    ...summarise(requirement),
    satisfied: result.satisfied,
    severity,
    detail: result.detail,
    missingClaims: result.missingClaims ?? []
  };
}

const summarise = (requirement) => ({
  id: requirement.id,
  label: requirement.label,
  resolver: requirement.resolver,
  remedy: requirement.remedy ?? REMEDY.RECAPTURE,
  description: requirement.description
});

/**
 * Evaluates the requested mode against an IR.
 *
 * @param {object} args.ir
 * @param {object} [args.evidence]  used to check source-kind admissibility
 * @param {object} [args.request]   { mode, viewports, includeMotion, includeStates }
 */
export function evaluateMode({ ir, evidence = null, request = {} }) {
  const req = { ...DEFAULT_REQUEST, ...request };
  const mode = req.mode;

  if (!isKnownMode(mode)) {
    return {
      requestedMode: mode,
      decision: DECISION.BLOCKED,
      confidence: 0,
      requiredEvidence: [],
      availableEvidence: [],
      missingEvidence: [],
      blockingGaps: [{ id: "unknown-mode", label: "Unknown mode", detail: `"${mode}" is not a supported mode.` }],
      warningGaps: [],
      recommendedNextAction: `Request one of: analyze, recreate, adapt, extend, improve.`,
      thresholds: {},
      request: req
    };
  }

  const spec = requirementsFor(mode);
  const requiredResults = spec.required.map((r) => evaluateRequirement(r, ir, req));
  const optionalResults = spec.optional.map((r) => evaluateRequirement(r, ir, req));

  const available = [...requiredResults, ...optionalResults].filter((e) => e.satisfied);
  const missing = [...requiredResults, ...optionalResults].filter((e) => !e.satisfied);

  const blockingGaps = requiredResults.filter((e) => !e.satisfied && e.severity === "blocking");

  // Only a REQUIRED item marked `warning` is a concern. An absent optional item
  // is expected — `analyze` explicitly does not need motion or anatomy, so
  // reporting their absence as a warning would make "fully allowed"
  // unreachable and drain the distinction of meaning.
  const warningGaps = requiredResults.filter((e) => !e.satisfied && e.severity !== "blocking");
  const informational = optionalResults.filter((e) => !e.satisfied);

  /* ------------------------------------------------ threshold checks */

  const t = spec.thresholds;
  const confidence = ir.confidence?.overall ?? 0;
  const contentReached = ir.coverage?.contentReached ?? 0;
  const coverageFactor = ir.coverage?.coverageFactor ?? 0;
  const component = primaryComponent(ir);

  const thresholdGaps = [];
  const check = (id, label, actual, minimum, remedy = REMEDY.RECAPTURE) => {
    if (actual >= minimum) return;
    thresholdGaps.push({
      id, label, resolver: "threshold", severity: "blocking", remedy,
      detail: `${actual.toFixed(2)} is below the ${mode} minimum of ${minimum.toFixed(2)}.`,
      description: `Mode-specific floor for ${label.toLowerCase()}.`
    });
  };

  check("min-confidence", "Overall confidence", confidence, t.minConfidence);
  check("min-content-reached", "Content reached", contentReached, t.minContentReached);
  check("min-coverage", "Coverage factor", coverageFactor, t.minCoverageFactor);
  if (t.minComponentConfidence > 0) {
    check("min-component-confidence", "Primary component confidence", component?.confidence ?? 0, t.minComponentConfidence);
  }

  /* ------------------------------------------- source-kind admissibility */

  const sourceGaps = [];
  if (evidence?.records?.length) {
    const used = new Set(evidence.records.filter((r) => !r.supersededBy).map((r) => r.sourceKind));
    const inadmissible = [...used].filter((s) => s && !spec.acceptableSourceKinds.includes(s));

    if (inadmissible.length) {
      sourceGaps.push({
        id: "inadmissible-source",
        label: "Evidence source not accepted by this mode",
        resolver: "source",
        severity: "blocking",
        // Re-capturing the same way cannot help: the input kind is the problem.
        remedy: REMEDY.SOURCE,
        detail: `${mode} accepts ${spec.acceptableSourceKinds.join(", ")}; this run relies on ${inadmissible.join(", ")}.`,
        description: "Some evidence came from a source this mode cannot build on."
      });
    }

    if (!spec.allowScreenshotEstimates) {
      const estimatedRequired = evidence.records.filter(
        (r) => !r.supersededBy && r.status === STATUS.ESTIMATED
      );
      if (estimatedRequired.length && !inadmissible.length) {
        sourceGaps.push({
          id: "estimated-critical-values",
          label: "Critical values are estimated",
          resolver: "source",
          severity: "blocking",
          remedy: REMEDY.SOURCE,
          detail: `${estimatedRequired.length} record(s) are estimates, which ${mode} does not accept.`,
          description: "This mode requires measured or observed evidence."
        });
      }
    }
  }

  const allBlocking = [...blockingGaps, ...thresholdGaps, ...sourceGaps];

  /* -------------------------------------------------------- the decision */

  let decision;
  if (allBlocking.length === 0) {
    decision = warningGaps.length ? DECISION.ALLOWED_WITH_WARNINGS : DECISION.ALLOWED;
  } else {
    // A block worth re-capturing for is materially different from one that no
    // amount of re-capturing can fix.
    const recapturable = allBlocking.every((g) => g.remedy === REMEDY.RECAPTURE);
    decision = recapturable ? DECISION.BLOCKED_WITH_RECAPTURE : DECISION.BLOCKED;
  }

  return {
    requestedMode: mode,
    request: req,
    intent: spec.intent,
    decision,
    confidence,
    thresholds: {
      ...t,
      actual: { confidence, contentReached, coverageFactor, componentConfidence: component?.confidence ?? null }
    },
    requiredEvidence: spec.required.map(summarise),
    optionalEvidence: spec.optional.map(summarise),
    availableEvidence: available.map((e) => ({ id: e.id, label: e.label, detail: e.detail })),
    missingEvidence: missing.map((e) => ({ id: e.id, label: e.label, severity: e.severity, detail: e.detail })),
    blockingGaps: allBlocking.map((g) => ({ id: g.id, label: g.label, remedy: g.remedy, detail: g.detail })),
    warningGaps: warningGaps.map((g) => ({ id: g.id, label: g.label, remedy: g.remedy, detail: g.detail })),
    informationalGaps: informational.map((g) => ({ id: g.id, label: g.label, detail: g.detail })),
    requiredArtifacts: spec.requiredArtifacts,
    acceptableSourceKinds: spec.acceptableSourceKinds,
    allowScreenshotEstimates: spec.allowScreenshotEstimates,
    recommendedNextAction: recommend(decision, allBlocking, warningGaps, mode),
    notes: spec.notes
  };
}

function recommend(decision, blocking, warnings, mode) {
  if (decision === DECISION.ALLOWED) {
    return `Proceed with ${mode}. All required evidence is present.`;
  }
  if (decision === DECISION.ALLOWED_WITH_WARNINGS) {
    return `Proceed with ${mode}, treating ${warnings.length} labelled gap(s) as decisions to make deliberately rather than facts about the reference.`;
  }
  if (decision === DECISION.BLOCKED_WITH_RECAPTURE) {
    const ids = blocking.map((g) => g.id).join(", ");
    return `Re-capture and retry: ${ids}. A better capture of the same page would supply what is missing.`;
  }
  const sourceBound = blocking.filter((g) => g.remedy === REMEDY.SOURCE);
  if (sourceBound.length) {
    return `Re-capturing will not help — ${sourceBound.map((g) => g.id).join(", ")} is a limit of the input kind. Supply a live URL capture, or request a mode this evidence can support (analyze or improve).`;
  }
  return `The reference does not contain the evidence ${mode} requires. Request a less demanding mode.`;
}

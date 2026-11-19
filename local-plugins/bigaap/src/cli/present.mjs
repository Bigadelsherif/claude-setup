/**
 * Human-readable rendering of the readiness model.
 *
 * One rule shapes every function here: **the decision comes first, and the next
 * action comes second.** Not a header, not a summary of what ran, not a count
 * of checks. A person running `bigaap readiness` wants to know whether they can
 * do the thing and what to do about it, and every line before that answer is a
 * line they read while still not knowing.
 *
 * The second rule is that a positive summary may never appear above a blocker.
 * "Ready — 3 blockers" is worse than no summary at all: the eye takes the first
 * word and the rest becomes detail. So when something blocks, the first line
 * says what blocked and why.
 *
 * The sections stay separate — blockers, warnings, unknowns, contested,
 * limitations, actions — because merging any two of them loses the distinction
 * that decides what the reader does. An unknown is not a warning. A contested
 * claim is not an unknown. A limitation intrinsic to the input kind is not a
 * coverage gap you can recapture your way out of.
 */

import { STATUS } from "./result.mjs";
import { REQUIREMENT_STATUS, ARTIFACT_STATE, LIMITATION_KIND } from "./readiness-model.mjs";

const bullet = (s) => `  - ${s}`;
const indent = (s) => `    ${s}`;

/** The one-line decision. Never optimistic when something blocks. */
export function decisionLine(model) {
  const mode = model.requestedMode ?? "this run";
  const blocking = model.blockers.length;
  const lintBlocked = model.lintBlocked.length;

  switch (model.status) {
    case STATUS.BLOCKED: {
      const first = model.blockers[0];
      return `${capitalize(mode)} is blocked: ${first?.message ?? "the evidence does not support it"}`;
    }
    case STATUS.REQUIRES_USER_INPUT: {
      const first = model.userInputRequired[0];
      return `${capitalize(mode)} needs something only you can supply: ${first?.what ?? "an input"}`;
    }
    case STATUS.FAILED:
      return `${capitalize(mode)} failed. Nothing here is a finding about the reference.`;
    case STATUS.CANCELLED:
      return `${capitalize(mode)} was cancelled. Nothing was captured and nothing was written.`;
    case STATUS.NOT_ATTEMPTED:
      return `${capitalize(mode)} was not attempted: there was nothing to do.`;
    case STATUS.COMPLETED_WITH_WARNINGS:
      return lintBlocked.length || blocking
        ? `${capitalize(mode)} completed, but ${lintBlocked ? `${lintBlocked} prompt(s) were withdrawn` : `${blocking} blocker(s) stand`}.`
        : `${capitalize(mode)} can continue with warnings.`;
    case STATUS.COMPLETED:
      return `${capitalize(mode)} completed.`;
    default:
      return `${capitalize(mode)}: ${model.status}`;
  }
}

/** The first thing to do. Empty only when there is genuinely nothing. */
export function nextActionLine(model) {
  const first = model.recommendedNextActions[0];
  if (!first) return null;
  return first.how ? `${first.what} ${first.how}` : first.what;
}

/**
 * The default view: decision, action, then each category that has content.
 *
 * A section with nothing in it is omitted rather than printed empty — except
 * the ones whose emptiness is itself the answer, which say so.
 */
export function renderReadiness(model, { verbose = false } = {}) {
  const out = [];
  const push = (l = "") => out.push(l);

  push(decisionLine(model));
  const next = nextActionLine(model);
  if (next) push(`→ ${next}`);
  push();

  push(`${model.command} · ${model.requestedMode ?? "no mode"} · ${model.sourceKind ?? "no source"}` +
    `${model.workspace ? ` · ${model.workspace}` : ""}`);
  push(`browser launched: ${model.browserLaunched} · capture attempted: ${model.captureAttempted}`);
  push();

  /* ---- blockers before warnings, always ---- */
  if (model.blockers.length) {
    push(`BLOCKERS (${model.blockers.length}) — nothing below these can proceed`);
    for (const b of model.blockers) {
      push(bullet(`${b.code ?? "blocked"}: ${b.message}`));
      if (b.recommendation ?? b.userAction) push(indent(b.recommendation ?? b.userAction));
      const recapture = b.recaptureResolves;
      if (recapture === true) push(indent("Recapturing may resolve this."));
      if (recapture === false) push(indent(b.impossibleForInputKind
        ? "Recapturing will NOT resolve this: no capture of this input kind can produce the evidence."
        : "Recapturing will not resolve this."));
    }
    push();
  }

  if (model.lintBlocked.length) {
    push(`WITHDRAWN BY PROMPT LINT (${model.lintBlocked.length})`);
    for (const filename of model.lintBlocked) {
      const findings = model.lintFindings.filter((f) => f.artifact === filename && f.blocks);
      push(bullet(`${filename} — ${[...new Set(findings.map((f) => f.rule))].join(", ")}`));
      for (const f of findings.slice(0, verbose ? 20 : 2)) {
        push(indent(`${f.rule} at ${f.where}: ${f.message}`));
        push(indent(`   ${f.remediation}`));
      }
      push(indent("This is not available as an implementation prompt."));
    }
    push();
  }

  if (model.warnings.length) {
    push(`WARNINGS (${model.warnings.length}) — the run continues; these change how far to trust it`);
    for (const w of model.warnings.slice(0, verbose ? 100 : 5)) {
      push(bullet(`${w.code ?? "warning"}: ${w.message ?? w.note ?? ""}`));
      if (w.recommendation) push(indent(w.recommendation));
    }
    if (!verbose && model.warnings.length > 5) push(indent(`… ${model.warnings.length - 5} more; --verbose to see them`));
    push();
  }

  /* ---- unknowns and contested are separate categories, never merged ---- */
  if (model.unknowns.length) {
    push(`UNKNOWN (${model.unknowns.length}) — looked for and not established`);
    push(indent("An unknown is not a failure. It is a decision the evidence does not make for you."));
    for (const u of model.unknowns.slice(0, verbose ? 100 : 5)) {
      push(bullet(`${u.claim}${u.reason ? ` — ${u.reason}` : ""}`));
    }
    if (!verbose && model.unknowns.length > 5) push(indent(`… ${model.unknowns.length - 5} more; --verbose to see them`));
    push();
  }

  if (model.contestedClaims.length) {
    push(`CONTESTED (${model.contestedClaims.length}) — two sources disagreed`);
    push(indent("Neither value is presented as settled. Choosing one silently is how a disagreement becomes a fact."));
    for (const c of model.contestedClaims) {
      const candidates = (c.candidates ?? []).map((x) => `${x.source}: ${x.value}`).join(" vs ");
      push(bullet(`${c.claim} — ${candidates}${c.critical ? "  [CRITICAL]" : ""}`));
      push(indent(c.preferredSource ? `preferring ${c.preferredSource}` : "no source preferred"));
    }
    push();
  }

  /* ---- limitations, grouped by whether recapture can help ---- */
  if (model.limitations.length) {
    push("LIMITATIONS");
    const intrinsic = model.limitations.filter((l) => l.kind === LIMITATION_KIND.INTRINSIC_TO_INPUT);
    const implementation = model.limitations.filter((l) => l.kind === LIMITATION_KIND.IMPLEMENTATION);
    const policy = model.limitations.filter((l) => l.kind === LIMITATION_KIND.POLICY);
    const coverage = model.limitations.filter((l) => l.kind === LIMITATION_KIND.COVERAGE);

    for (const [label, group] of [
      ["intrinsic to this input kind — recapturing will not help", intrinsic],
      ["not implemented in this build", implementation],
      ["refused by decision", policy],
      ["coverage — recapturing may help", coverage]
    ]) {
      if (!group.length) continue;
      push(bullet(label));
      for (const l of group) push(indent(l.what));
    }
    push();
  }

  if (model.openDefects.length) {
    push(`OPEN DEFECTS AFFECTING THIS RUN (${model.openDefects.length})`);
    for (const d of model.openDefects) {
      push(bullet(`${d.id} (${d.severity}) — ${d.affectedCapability}`));
      push(indent(`blocks this mode: ${d.blocksRequestedMode ? "yes" : "no"} · affects fidelity: ${d.affectsFidelity ? "yes" : "no"}`));
      if (verbose && d.containment) push(indent(`containment: ${d.containment.slice(0, 160)}`));
    }
    push();
  }

  /* ---- coverage and confidence, side by side and never merged ---- */
  if (verbose) {
    push(renderCoverage(model));
    push(renderConfidence(model));
    push(renderRequirements(model));
  } else {
    const missing = model.missingRequirements.length;
    push(`REQUIREMENTS: ${model.satisfiedRequirements.length} satisfied, ${missing} not` +
      `${missing ? " — --verbose for the requirement-by-requirement view" : ""}`);
    push();
  }

  push(renderArtifacts(model, { verbose }));

  if (model.recommendedNextActions.length > 1) {
    push("WHAT TO DO NEXT");
    for (const a of model.recommendedNextActions) {
      push(bullet(`[${a.priority}] ${a.what}`));
      if (a.how) push(indent(a.how));
    }
    push();
  }

  push(model.compositeScoreNote);
  return out.filter((l) => l !== undefined).join("\n");
}

/** Coverage, per dimension, with nothing rolled up. */
export function renderCoverage(model) {
  const c = model.evidenceCoverage;
  const out = ["COVERAGE — whether the right thing was read"];
  const num = (v) => (typeof v === "number" ? v.toFixed(2) : "not measured");

  out.push(bullet(`content reached: ${num(c.contentReached)} · coverage factor: ${num(c.coverageFactor)}`));
  if (c.factors) {
    out.push(indent(`factors: ${Object.entries(c.factors).map(([k, v]) => `${k} ${num(v)}`).join(" · ")}`));
    out.push(indent("Reported as factors rather than their product: the product hides which one was the problem."));
  }
  if (c.byViewport.length) {
    out.push(bullet("by viewport (never averaged)"));
    for (const v of c.byViewport) out.push(indent(`${v.viewport}px — reached ${num(v.contentReached)}`));
  }
  if (c.byRegion.length) {
    out.push(bullet(`by region: ${c.byRegion.filter((r) => r.reached).length}/${c.byRegion.length} reached`));
  }
  if (c.byState.length) {
    const induced = c.byState.filter((s) => s.induced).length;
    out.push(bullet(`by state (never averaged): ${induced}/${c.byState.length} induced`));
    for (const s of c.byState.filter((x) => !x.induced).slice(0, 5)) {
      out.push(indent(`${s.component}/${s.state} — not induced${s.reason ? `: ${s.reason}` : ""}`));
    }
  }
  if (c.byComponent.length) out.push(bullet(`by component: ${c.byComponent.length} found`));
  if (c.bySourceKind.length) out.push(bullet(`source kinds: ${c.bySourceKind.map((s) => s.sourceKind).join(", ")}`));
  out.push(indent(c.note));
  out.push("");
  return out.join("\n");
}

/** Confidence, per category, never multiplied by coverage. */
export function renderConfidence(model) {
  const c = model.confidenceByCategory;
  const out = ["CONFIDENCE — how well it was read"];
  for (const [name, value] of Object.entries(c.byCategory)) {
    out.push(bullet(`${name.padEnd(16)} ${value == null ? "not measured" : value.toFixed(2)}`));
  }
  out.push(indent(c.note));
  out.push("");
  return out.join("\n");
}

/** Every requirement, one line each, with what to do about the ones that failed. */
export function renderRequirements(model) {
  const out = [`REQUIREMENTS (${model.requirements.length})`];
  const order = [
    REQUIREMENT_STATUS.BLOCKED, REQUIREMENT_STATUS.REQUIRES_USER_INPUT,
    REQUIREMENT_STATUS.UNSUPPORTED, REQUIREMENT_STATUS.WARNING,
    REQUIREMENT_STATUS.UNKNOWN, REQUIREMENT_STATUS.NOT_APPLICABLE,
    REQUIREMENT_STATUS.SATISFIED
  ];

  for (const status of order) {
    const group = model.requirements.filter((r) => r.status === status);
    if (!group.length) continue;
    out.push(bullet(`${status} (${group.length})`));
    for (const r of group) {
      out.push(indent(`${r.name}`));
      if (r.status === REQUIREMENT_STATUS.SATISFIED) continue;
      if (r.evidenceMissing) out.push(indent(`   missing: ${r.evidenceMissing}`));
      if (r.remediation) out.push(indent(`   ${r.remediation}`));
      if (r.recaptureHelps === false) {
        out.push(indent("   Recapturing will not help."));
      }
    }
  }
  out.push("");
  return out.join("\n");
}

/** Artifact state, grouped so an optional absence never reads as a failure. */
export function renderArtifacts(model, { verbose = false } = {}) {
  const out = ["ARTIFACTS"];
  const groups = [
    [ARTIFACT_STATE.GENERATED, "written"],
    [ARTIFACT_STATE.BLOCKED, "withdrawn — a decision was made, not an omission"],
    [ARTIFACT_STATE.STALE, "stale — preserved, not trusted"],
    [ARTIFACT_STATE.INVALID, "invalid"],
    [ARTIFACT_STATE.NOT_GENERATED, "not written"],
    [ARTIFACT_STATE.NO_PRODUCER, "registered, no producer yet"],
    [ARTIFACT_STATE.HISTORICAL, "historical"],
    [ARTIFACT_STATE.NOT_APPLICABLE, "not produced by this mode"]
  ];

  for (const [state, label] of groups) {
    const group = model.artifacts.filter((a) => a.state === state);
    if (!group.length) continue;
    /* The uninteresting groups collapse to a count unless asked for. The
     * interesting ones always list, because "withdrawn" and "stale" are
     * decisions somebody needs to see. */
    const alwaysList = [ARTIFACT_STATE.BLOCKED, ARTIFACT_STATE.STALE, ARTIFACT_STATE.INVALID].includes(state);
    if (!verbose && !alwaysList) {
      out.push(bullet(`${label}: ${group.length}`));
      continue;
    }
    out.push(bullet(label));
    for (const a of group) {
      out.push(indent(a.filename));
      if (a.note) out.push(indent(`   ${a.note}`));
    }
  }
  out.push("");
  return out.join("\n");
}

/** Recovery attempts, one line each, with the distinction between failure kinds. */
export function renderRecovery(history, { verbose = false } = {}) {
  if (!history?.length) return "No capture attempt is recorded for this run.";
  const out = [`RECOVERY (${history.length} attempt(s))`];

  for (const attempt of history) {
    out.push(bullet(
      `#${attempt.attempt ?? "?"} ${attempt.operation ?? "operation"} — ${attempt.status ?? "unknown"}` +
      `${attempt.viewport ? ` @${attempt.viewport}px` : ""}${attempt.state && attempt.state !== "default" ? ` state ${attempt.state}` : ""}`
    ));
    if (attempt.errorCategory ?? attempt.code) {
      out.push(indent(`error: ${attempt.errorCategory ?? attempt.code}`));
    }
    if (attempt.retryDecision ?? attempt.policy) {
      out.push(indent(`retry: ${attempt.retryDecision ?? attempt.policy}${attempt.retryCount != null ? ` (${attempt.retryCount})` : ""}`));
    }
    if (attempt.durationMs != null) out.push(indent(`took ${attempt.durationMs}ms`));
    if (verbose && attempt.recommendation) out.push(indent(attempt.recommendation));
  }
  out.push("");
  return out.join("\n");
}

/**
 * Correction tasks, presented and explicitly not applicable.
 *
 * Every task says why it cannot be applied automatically, because the absence
 * of an apply command reads as an unfinished feature otherwise — where it is
 * actually a standing decision resting on an open permanent limitation.
 */
export function renderTasks(tasks, { verbose = false } = {}) {
  if (!tasks?.length) return "No correction task is recorded for this run.";
  const out = [`CORRECTION TASKS (${tasks.length})`];
  out.push(indent("Every task is for a person. Nothing here can be applied automatically, and this"));
  out.push(indent("phase implements no way to apply one."));

  for (const t of tasks) {
    out.push(bullet(`${t.id ?? "task"} [${t.severity ?? "unknown"}] ${t.category ?? t.dimension ?? ""}`));
    if (t.viewport) out.push(indent(`viewport ${t.viewport}px${t.state && t.state !== "default" ? ` · state ${t.state}` : ""}`));
    out.push(indent(`reference ${fmt(t.referenceValue)} → target ${fmt(t.targetValue)}`));
    const evidence = [...(t.referenceEvidence ?? []), ...(t.targetEvidence ?? [])];
    if (evidence.length) out.push(indent(`evidence: ${evidence.join(", ")}`));
    if (t.confidence != null) out.push(indent(`confidence ${Number(t.confidence).toFixed(2)}`));
    if (t.regressionRisk) out.push(indent(`regression risk: ${t.regressionRisk}`));
    if (t.acceptance) out.push(indent(`accept when: ${t.acceptance}`));
    out.push(indent(`manual: ${t.automatic === true ? "no" : "yes"} — ${t.whyManual ?? "component-level correction rests on cross-build matching, which is an open permanent limitation (def_0030)."}`));
    if (!verbose) continue;
  }
  out.push("");
  return out.join("\n");
}

const fmt = (v) => (v == null ? "*absent*" : Array.isArray(v) ? v.join(", ") : String(v));
const capitalize = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

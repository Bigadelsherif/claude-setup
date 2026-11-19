/**
 * The mode workflows, and the preflight command in front of them.
 *
 * Phase 5.1 implements the command SURFACE: registration, parsing, preflight,
 * the typed envelope and the exit code. The guided experience — prompting for
 * inputs, sequencing capture, pruning artifacts — is Phase 5.3, and the
 * commands here say so rather than pretending to be it.
 *
 * The rule from the plan holds: this layer may only call the CLI layer and the
 * pipeline entry points. It never reaches into evidence, IR derivation or the
 * driver, because those are where `blocked`/`failed`, hashes and attempt
 * history are decided, and a shortcut past them loses all three quietly.
 */

import { existsSync, copyFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { analyzeWorkspace, validateWorkspace } from "../pipeline.mjs";
import { Workspace } from "../workspace/workspace.mjs";
import { preflight, BLOCKER, SEVERITY } from "./blockers.mjs";
import { PROJECT_DIR, inspectProject, projectExists, CONFIG_STATUS } from "./project.mjs";
import { resolveInputs, describeResolution, SOURCE } from "./resolve.mjs";
import { collectInputs, exampleCommand, MODE_INPUTS, canPrompt, Cancelled } from "./guided.mjs";
import { findCommand } from "./catalog.mjs";
import { cliResult, STATUS, READINESS } from "./result.mjs";

/** Every workflow reports the same preflight shape, so a reader learns it once. */
const asBlockerRecords = (items) => items.map((b) => ({
  code: b.code,
  stage: "preflight",
  severity: b.severity,
  message: b.explanation,
  recommendation: b.userAction,
  recaptureResolves: b.recaptureResolves,
  impossibleForInputKind: b.impossibleForInputKind,
  affectedMode: b.affectedMode,
  affectedArtifact: b.affectedArtifact
}));

const asWarningRecords = (items) => items.map((b) => ({
  code: b.code,
  message: b.explanation,
  recommendation: b.userAction,
  affectedArtifact: b.affectedArtifact
}));

/* ------------------------------------------------------------- blockers */

/**
 * `helmy blockers` — the preflight command.
 *
 * Always `completed`, even when it finds blockers: reporting a blocker is this
 * command succeeding. Returning `blocked` would conflate "I found problems"
 * with "I could not look".
 */
export function cmdBlockers({ workspace, project = null, mode = "analyze", briefPath = null, viewport = null, state = null, stack = null, capabilities = [] }) {
  const operation = "blockers";

  const ws = workspace ? new Workspace(workspace) : null;
  let ir = null;
  if (ws?.exists("analysis", "ir.json")) {
    try { ir = ws.readJSON("analysis", "ir.json"); } catch { ir = null; }
  }

  const report = preflight({
    mode,
    workspaceRoot: workspace ?? null,
    projectRoot: project ?? null,
    ir,
    briefPath,
    viewport,
    state,
    stack,
    requestedCapabilities: capabilities
  });

  const status = report.blockers.length || report.warnings.length
    ? STATUS.COMPLETED_WITH_WARNINGS
    : STATUS.COMPLETED;

  return cliResult({
    operation,
    status,
    mode,
    viewport,
    state,
    /* Blockers found by a preflight are the command's FINDINGS, not its own
     * failure — so they travel as warnings on a completed result, with the
     * full records in `detail`. A `completed` carrying blockers would be
     * refused at construction, and rightly. */
    warnings: [...asWarningRecords(report.blockers), ...asWarningRecords(report.warnings)],
    summary: report.summary,
    readiness: report.feasible ? READINESS.USABLE_WITH_LIMITS : READINESS.NOT_USABLE,
    readinessReason: report.feasible
      ? `Nothing local blocks \`${mode}\`. Evidence gates still apply at run time.`
      : `\`${mode}\` cannot proceed until the blockers below are resolved.`,
    detail: {
      feasible: report.feasible,
      browserLaunched: report.browserLaunched,
      checksPerformed: report.checksPerformed,
      blockers: report.blockers,
      warningChecks: report.warnings,
      openLimitations: report.informational,
      requiresUserInput: report.requiresUserInput,
      invalidInput: report.invalidInput,
      resolvableByRecapture: report.resolvableByRecapture,
      impossibleForThisInput: report.impossibleForThisInput
    }
  });
}

/* --------------------------------------------------------- mode workflows */

/**
 * Runs one analysis mode.
 *
 * Order matters and is the point of the command: preflight first, so a run
 * that cannot succeed says so before anything expensive happens.
 */
/**
 * The execution half: preflight, then the pipeline.
 *
 * Split from the guided half so input collection and execution can be reasoned
 * about — and tested — separately. `runMode` below is the guided front of it.
 */
export function runPipelineForMode({ operation, mode, workspace, project = null, briefPath = null, stack = null, pipelineMode = null, strict = false, viewports = null, motion = false, states = false, resolution = null }) {
  if (!workspace) {
    return cliResult({
      operation, status: STATUS.REQUIRES_USER_INPUT, mode,
      userActions: [{
        what: "Say which workspace to analyse.",
        how: "Pass --workspace <dir>, or run `helmy init` to create one."
      }],
      summary: "no workspace was given",
      readiness: READINESS.UNDETERMINED,
      readinessReason: "Nothing was analysed."
    });
  }

  /* A brief supplied by path is ingested BEFORE preflight, so the preflight
   * sees the brief the run would actually use rather than the one on disk. */
  if (briefPath && existsSync(resolve(briefPath))) {
    try {
      const ws = new Workspace(workspace);
      mkdirSync(ws.path("input"), { recursive: true });
      copyFileSync(resolve(briefPath), ws.path("input", "target-brief.json"));
    } catch (e) {
      return cliResult({
        operation, status: STATUS.FAILED, mode,
        errors: [{ code: "brief-not-ingestable", message: `could not copy ${briefPath}: ${String(e.message).slice(0, 160)}` }],
        readiness: READINESS.NOT_USABLE,
        readinessReason: "The brief could not be placed in the workspace."
      });
    }
  }

  const ws = new Workspace(workspace);
  let ir = null;
  if (ws.exists("analysis", "ir.json")) {
    try { ir = ws.readJSON("analysis", "ir.json"); } catch { ir = null; }
  }

  const report = preflight({ mode, workspaceRoot: workspace, projectRoot: project, ir, briefPath: null, stack });

  /* Three different refusals, deliberately not collapsed:
   *
   *   failed               the input exists and is malformed. A validation error.
   *   requires-user-input  a person must write something. No capture helps.
   *   blocked              a gate refused on the evidence. Recapture may help.
   *
   * Malformed is checked FIRST. An input that exists and is wrong is a more
   * specific finding than one that is absent, and reporting "write a brief"
   * when a broken one is sitting there sends the user to create a second file
   * rather than fix the first. */
  if (report.invalidInput) {
    const b = report.blockers.find((x) => x.code === BLOCKER.BRIEF_INVALID);
    return cliResult({
      operation, status: STATUS.FAILED, mode,
      errors: [{ code: b.code, message: b.explanation, recommendation: b.userAction }],
      warnings: asWarningRecords(report.warnings),
      summary: "the target brief does not satisfy its schema",
      readiness: READINESS.NOT_USABLE,
      readinessReason: "A malformed brief is a validation failure, not a gate refusal — recapturing would not change it.",
      detail: { feasible: false, browserLaunched: false, blockers: report.blockers }
    });
  }

  if (report.requiresUserInput) {
    const b = report.blockers.find((x) => x.code === BLOCKER.BRIEF_MISSING)
      ?? report.blockers.find((x) => x.code === BLOCKER.BRIEF_INCOMPLETE);
    return cliResult({
      operation, status: STATUS.REQUIRES_USER_INPUT, mode,
      userActions: [{ what: b.explanation, how: b.userAction, artifact: b.affectedArtifact }],
      warnings: asWarningRecords(report.warnings),
      summary: b.code === BLOCKER.BRIEF_INCOMPLETE
        ? `\`${mode}\` needs a completed target brief; the project still holds the template`
        : `\`${mode}\` needs a target brief that does not exist yet`,
      readiness: READINESS.UNDETERMINED,
      readinessReason: "Waiting on input only you can supply. Nothing here will invent a brief.",
      detail: { feasible: false, browserLaunched: false, blockers: report.blockers }
    });
  }

  if (!report.feasible) {
    return cliResult({
      operation, status: STATUS.BLOCKED, mode,
      blockers: asBlockerRecords(report.blockers),
      warnings: asWarningRecords(report.warnings),
      summary: `${report.blockers.length} blocker(s) prevent \`${mode}\`; nothing was captured or written`,
      readiness: READINESS.NOT_USABLE,
      readinessReason:
        "Refused before doing the work, so no artifact was produced and none was invalidated. " +
        "Run `helmy blockers` for the full report.",
      detail: {
        feasible: false,
        browserLaunched: false,
        resolvableByRecapture: report.resolvableByRecapture,
        impossibleForThisInput: report.impossibleForThisInput,
        blockers: report.blockers
      }
    });
  }

  /* ---- preflight passed; run the pipeline ---- */
  let run;
  try {
    run = analyzeWorkspace(workspace, {
      mode: pipelineMode ?? undefined,
      stack: stack ?? undefined,
      config: {
        request: {
          mode,
          ...(viewports ? { viewports } : {}),
          ...(motion ? { includeMotion: true } : {}),
          ...(states ? { includeStates: true } : {})
        }
      }
    });
  } catch (e) {
    return cliResult({
      operation, status: STATUS.FAILED, mode,
      errors: [{ code: "pipeline-threw", message: String(e.message ?? e).slice(0, 300) }],
      readiness: READINESS.NOT_USABLE,
      readinessReason: "The analysis did not complete, so nothing it would have produced exists."
    });
  }

  const { ir: derived, coverage, safety, modeEvaluation, projection, pruned, refusedCorrections = [] } = run;
  const validation = validateWorkspace(workspace);

  /* Correction records the pipeline could not read.
   *
   * A warning rather than a blocker: the analysis completed and every readable
   * correction was applied. But it names the FILE, because the user's problem
   * when a record is malformed is not knowing which of forty on disk to fix —
   * previously this threw a TypeError from three frames down and named nothing
   * at all (def_0042). */
  const correctionWarnings = refusedCorrections.map((r) => ({
    code: "correction-record-unreadable",
    message: `${r.file ?? r.id}: ${r.why}`,
    recommendation: r.userAction
  }));

  /* The mode evaluator is the authority on whether the mode was satisfied. The
   * preflight is an early warning, not a substitute for the gate. */
  const gateBlocked = modeEvaluation.decision === "blocked" || !safety.promptGenerationAllowed;

  /* A requirement the mode declares advisory is still a finding about the
   * capture, and until now it reached no CLI surface at all: `states` was
   * either escalated to a blocker or silent. Now that it is advisory by
   * default (def_0046), the run must say so — a prompt generated without
   * induced states should not look identical to one generated with them. */
  const modeWarnings = (modeEvaluation.warningGaps ?? []).map((g) => ({
    code: `mode:${g.id}`,
    message: `${g.label ?? g.id}: ${g.detail ?? g.description ?? "not established in this capture"}`,
    recommendation: g.remedy === "recapture"
      ? "Re-capture with this requested to measure it; otherwise the prompt records it as not induced."
      : (g.remedy ?? null)
  }));

  const warnings = [
    ...asWarningRecords(report.warnings),
    ...(coverage.warnings ?? []).map((w) => ({ code: "coverage", message: typeof w === "string" ? w : (w.message ?? JSON.stringify(w)) })),
    ...validation.warnings.map((w) => ({ code: w.rule, message: w.message })),
    ...modeWarnings,
    ...correctionWarnings
  ];

  if (gateBlocked) {
    const gateBlockers = [
      ...safety.blockers.map((b) => ({
        code: b.code, stage: "safety-gate", severity: SEVERITY.BLOCKING, message: b.message,
        recommendation: b.remedy ?? "Resolve the gap the gate names, then re-run.",
        recaptureResolves: true, impossibleForInputKind: false, affectedMode: mode, affectedArtifact: null
      })),
      ...modeEvaluation.blockingGaps.map((g) => ({
        code: g.id ?? "mode-requirement-unmet", stage: "mode-requirement", severity: SEVERITY.BLOCKING,
        message: `${g.label ?? g.id}: ${g.description ?? "required evidence is absent"}`,
        recommendation: g.remedy ?? modeEvaluation.recommendedNextAction,
        recaptureResolves: g.remedy !== "correction", impossibleForInputKind: false,
        affectedMode: mode, affectedArtifact: null
      }))
    ];

    return cliResult({
      operation, status: STATUS.BLOCKED, mode,
      blockers: gateBlockers.length ? gateBlockers : [{
        code: "mode-blocked", stage: "mode-requirement", severity: SEVERITY.BLOCKING,
        message: `\`${mode}\` was refused: ${modeEvaluation.decision}`,
        recommendation: modeEvaluation.recommendedNextAction,
        recaptureResolves: true, impossibleForInputKind: false, affectedMode: mode, affectedArtifact: null
      }],
      warnings,
      hashes: { ir: projection.hash },
      artifacts: Object.keys(projection.files).map((rel) => ({ kind: rel, path: join(workspace, rel), bytes: null })),
      summary: `\`${mode}\` blocked · IR ${projection.hash} · no implementation prompt was emitted`,
      readiness: READINESS.NOT_USABLE,
      readinessReason:
        "The gate refused this mode. A partial-evidence spec and a blocked-prompt explaining the gap were written; " +
        "no implementation guidance was.",
      detail: {
        feasible: false,
        browserLaunched: false,
        resolvedConfiguration: resolution?.records ?? null,
        irHash: projection.hash,
        decision: modeEvaluation.decision,
        confidence: derived.confidence?.overall ?? null,
        coverage: {
          contentReached: coverage.contentReached ?? null,
          coverageFactor: coverage.coverageFactor ?? null,
          visibleSampledPercent: coverage.visibleSampledPercent ?? null
        },
        unknowns: (derived.unknowns ?? []).length,
        contestedClaims: (derived.contestedClaims ?? []).length,
        promptsEmitted: false,
        prunedArtifacts: pruned ?? [],
        nextAction: modeEvaluation.recommendedNextAction
      }
    });
  }

  const status = warnings.length || modeEvaluation.warningGaps.length
    ? STATUS.COMPLETED_WITH_WARNINGS
    : STATUS.COMPLETED;

  const result = cliResult({
    operation, status, mode,
    warnings,
    hashes: { ir: projection.hash },
    artifacts: Object.keys(projection.files).map((rel) => ({ kind: rel, path: join(workspace, rel), bytes: null })),
    summary:
      `\`${mode}\` ${modeEvaluation.decision} · IR ${projection.hash} · ` +
      `confidence ${(derived.confidence?.overall ?? 0).toFixed(2)} · ` +
      `${Object.keys(projection.files).length} artifact(s)` +
      ((pruned ?? []).length ? ` · ${pruned.length} stale pruned` : ""),
    readiness: READINESS.USABLE_WITH_LIMITS,
    readinessReason:
      "Artifacts were projected from this IR and carry its hash. What they license is bounded by the evidence " +
      "status on each claim, not by the fact that they were produced.",
    detail: {
      feasible: true,
      browserLaunched: false,
      resolvedConfiguration: resolution?.records ?? null,
      irHash: projection.hash,
      decision: modeEvaluation.decision,
      confidence: derived.confidence?.overall ?? null,
      provenance: derived.confidence?.provenance ?? null,
      coverage: {
        contentReached: coverage.contentReached ?? null,
        coverageFactor: coverage.coverageFactor ?? null,
        visibleSampledPercent: coverage.visibleSampledPercent ?? null
      },
      unknowns: (derived.unknowns ?? []).length,
      contestedClaims: (derived.contestedClaims ?? []).length,
      warningGaps: modeEvaluation.warningGaps.map((g) => g.id ?? g.label),
      promptsEmitted: true,
      prunedArtifacts: pruned ?? [],
      validation: { ok: validation.ok, errors: validation.errors.length, warnings: validation.warnings.length },
      refusedCorrections,
      nextAction: modeEvaluation.recommendedNextAction
    }
  });

  /* `--strict` turns validation warnings into a failure, which is a choice the
   * caller made rather than a judgement the tool imposes. */
  if (strict && validation.warnings.length) {
    return cliResult({
      operation, status: STATUS.FAILED, mode,
      errors: validation.warnings.map((w) => ({ code: w.rule, message: w.message })),
      hashes: result.hashes, artifacts: result.artifacts,
      summary: `--strict: ${validation.warnings.length} validation warning(s) treated as failures`,
      readiness: READINESS.NOT_USABLE,
      readinessReason: "The artifacts exist; --strict refuses to call the run clean while they carry warnings.",
      detail: result.detail
    });
  }

  return result;
}

/* ------------------------------------------- commands not yet implemented */

/**
 * A command that is registered, documented and honest about not existing yet.
 *
 * Registering it early is deliberate: the surface is what Phase 5.1 delivers,
 * and a user who runs `helmy init` should get "not yet, it arrives in 5.2"
 * rather than "unknown command", which reads as "you typed it wrong".
 */
export function notYetImplemented(name) {
  const spec = findCommand(name);
  return cliResult({
    operation: name,
    status: STATUS.NOT_ATTEMPTED,
    warnings: [{
      code: "not-yet-implemented",
      message: `\`helmy ${name}\` is registered and documented but not implemented. It arrives in Phase ${spec?.phase ?? "5.x"}.`,
      recommendation: spec?.describe ?? null
    }],
    summary: `\`${name}\` is not implemented yet (Phase ${spec?.phase ?? "5.x"}); nothing was attempted`,
    readiness: READINESS.UNDETERMINED,
    readinessReason: "A command that does not exist yet licenses nothing, and says so rather than failing obscurely.",
    detail: { phase: spec?.phase ?? null, plannedOutputs: spec?.outputs ?? [] }
  });
}

/* ==================================================== the guided workflow */

/**
 * Does this workspace already hold a capture, and of what kind?
 *
 * Returns the reference it was taken from when the manifest records one, so a
 * guided run can report where the evidence came from rather than asking.
 */
function existingCapture(workspaceRoot) {
  const rawDir = join(workspaceRoot, "raw");
  if (!existsSync(rawDir)) return null;
  let files = [];
  try { files = readdirSync(rawDir).filter((f) => f.endsWith(".json")); } catch { return null; }
  const extract = files.find((f) => f.startsWith("extract-"));
  const screenshot = files.find((f) => f.includes("screenshot"));
  if (!extract && !screenshot) return null;

  let url = null;
  let declaredKind = null;
  try {
    const manifestPath = join(workspaceRoot, "manifest.json");
    if (existsSync(manifestPath)) {
      const source = JSON.parse(readFileSync(manifestPath, "utf8"))?.source ?? {};
      url = source.value ?? null;
      declaredKind = source.kind ?? null;
    }
  } catch { /* a manifest we cannot read is not fatal; the capture still exists */ }

  /* The manifest is the authority on what was captured. A filename is not: a
   * screenshot capture written as `extract-1280.json` is still screenshot
   * evidence, and reading it as a URL capture would let a mode that forbids
   * screenshots run on screenshots. The filename is only the fallback. */
  const kind = declaredKind ?? (extract ? "url" : "screenshots");
  return { file: extract ?? screenshot, kind, url };
}

/** Reads a project's configuration files, tolerating absence at every step. */
function loadProjectConfig(projectRoot) {
  if (!projectRoot || !projectExists(projectRoot)) {
    return { project: null, preferences: null, fidelityPolicy: null, inspection: null };
  }
  const inspection = inspectProject(projectRoot);
  const pick = (name) => inspection.files.find((f) => f.file === name)?.data ?? null;
  return {
    project: pick("project.json"),
    preferences: pick("preferences.json"),
    fidelityPolicy: pick("fidelity-policy.json"),
    inspection
  };
}

/**
 * A guided mode workflow.
 *
 * The twelve steps, in order, and the order is the design: everything that can
 * refuse cheaply happens before anything that costs a browser.
 *
 *   1-2   load and validate the project, resolve its defaults
 *   3-4   parse arguments, let them override
 *   5-6   detect missing and invalid inputs
 *   7     explain blockers BEFORE capture
 *   8-9   ask when interactive; report `requires-user-input` when not
 *   10    run the pipeline only once preflight passes
 *   11-12 emit only what the mode supports, preserving hashes and history
 */
export async function runMode({
  operation, mode, workspace, project = null,
  args = {}, interactive = false, isTTY = undefined,
  ask = null, log = () => {},
  briefPath = null, stack = null, pipelineMode = null, strict = false,
  viewports = null, motion = false, states = false
} = {}) {
  /* ---- 1-2. project configuration and its defaults ---- */
  const { project: projectConfig, preferences, fidelityPolicy, inspection } = loadProjectConfig(project);

  /* A project that exists and cannot be read is a failure of input, not of
   * evidence: no capture would fix it, and running on half a configuration
   * would silently use defaults the user believed they had overridden. */
  if (inspection && inspection.invalidFiles.length) {
    return cliResult({
      operation, status: STATUS.FAILED, mode,
      errors: inspection.invalidFiles.map((f) => ({
        code: "project-config-invalid",
        message: `${f.file}: ${f.reason}`,
        recommendation: "Fix the file, or `helmy init --force` to replace it. Running on a half-read configuration would use defaults you believed you had overridden."
      })),
      summary: `${inspection.invalidFiles.length} project configuration file(s) could not be read`,
      readiness: READINESS.NOT_USABLE,
      readinessReason: "Nothing was analysed. Configuration is declared intent; an unreadable one cannot be guessed at."
    });
  }

  /* ---- 3-4. explicit arguments override everything below them ---- */
  const explicit = {};
  for (const [k, v] of Object.entries(args ?? {})) if (v !== undefined && v !== null) explicit[k] = v;
  if (briefPath) explicit.briefPath = briefPath;
  if (stack) explicit.stack = stack;
  if (viewports && viewports.length) explicit.viewports = viewports;
  if (states && states.length) explicit.states = states;

  /* A workspace that already holds a capture IS the reference.
   *
   * Asking for a URL in order to analyse a capture that is sitting on disk
   * would be asking where something came from in order to read it. The URL is
   * needed to TAKE a capture, not to analyse one — so an existing capture
   * satisfies the reference, and records the workspace as its source. */
  const capturedAlready = workspace ? existingCapture(workspace) : null;

  /* A brief already in the workspace IS the brief this run would use, for the
   * same reason an existing capture is the reference. Asking for a path to one
   * that is already in place would send the user to supply a second copy — and
   * would mask a malformed brief behind a missing one. */
  const workspaceBrief = workspace ? join(workspace, "input", "target-brief.json") : null;
  if (workspaceBrief && existsSync(workspaceBrief) && explicit.briefPath === undefined) {
    explicit.briefPath = workspaceBrief;
  }

  if (capturedAlready) {
    /* Which key the reference lands under follows the kind, because that is
     * the key the mode will look for. Recording a screenshot capture as `url`
     * would leave the run asking for a reference it is already holding. */
    const kind = explicit.inputType ?? capturedAlready.kind;
    const key = kind === "screenshots" ? "screenshots" : "url";
    if (explicit[key] === undefined) {
      explicit[key] = capturedAlready.url ?? `workspace:${capturedAlready.file}`;
    }
    explicit.inputType = kind;
  }

  const resolution = resolveInputs({ args: explicit, project: projectConfig, preferences, fidelityPolicy });
  if (capturedAlready && resolution.records.url) {
    /* Recorded honestly: this came from the workspace, not from an argument. */
    resolution.records.url.source = SOURCE.WORKSPACE_CONFIG;
    resolution.records.url.explicit = false;
    resolution.records.url.fromExistingCapture = true;
  }
  const modeSpec = MODE_INPUTS[mode];

  if (!modeSpec) {
    return cliResult({
      operation, status: STATUS.FAILED, mode,
      errors: [{
        code: "invalid-mode",
        message: `\`${mode}\` is not a mode.`,
        recommendation: `Use one of: ${Object.keys(MODE_INPUTS).join(", ")}.`
      }],
      readiness: READINESS.UNDETERMINED, readinessReason: "Nothing was analysed."
    });
  }

  /* ---- 5-6. what this mode forbids, before asking for anything ---- */
  for (const rule of modeSpec.forbids) {
    if (rule.when(resolution.values)) {
      return cliResult({
        operation, status: STATUS.BLOCKED, mode,
        blockers: [{
          code: "input-kind-inadmissible", stage: "mode-requirement", severity: SEVERITY.BLOCKING,
          message: rule.why, recommendation: rule.remedy,
          recaptureResolves: false, impossibleForInputKind: true,
          affectedMode: mode, affectedArtifact: null
        }],
        summary: `\`${mode}\` cannot be satisfied by this kind of input`,
        readiness: READINESS.NOT_USABLE,
        readinessReason: "Refused on the input kind, before anything was captured. No amount of recapturing this kind of source would change it.",
        detail: { feasible: false, browserLaunched: false, resolvedConfiguration: resolution.records }
      });
    }
  }

  /* ---- 8. collect what is missing, if someone is there to ask ---- */
  const collection = await collectInputs({ mode, resolution, interactive, isTTY, ask, log });

  /* Cancellation is not failure. It stops before capture, says what was and
   * was not done, and exits on its own code. */
  if (collection.cancelled) {
    return cliResult({
      operation, status: STATUS.CANCELLED, mode,
      summary: `cancelled at \`${collection.cancelledAt}\``,
      warnings: [{
        code: "cancelled-by-user",
        message: `Stopped while collecting \`${collection.cancelledAt}\`. Nothing was captured and nothing was written.`,
        recommendation: "Re-run when ready. Answers given before cancelling were not saved, so nothing is left half-configured."
      }],
      readiness: READINESS.UNDETERMINED,
      readinessReason: "Cancelled before any capture. This is not a failure, and nothing was left in a partial state.",
      detail: {
        cancelledAt: collection.cancelledAt,
        completed: ["project configuration loaded", "defaults resolved"],
        notAttempted: ["preflight", "capture", "analysis", "artifact generation"],
        browserLaunched: false,
        resolvedConfiguration: resolution.records
      }
    });
  }

  for (const [k, v] of Object.entries(collection.collected)) {
    if (v !== undefined && v !== null) resolution.values[k] = v;
  }

  /* ---- 9. non-interactive, and something required is absent ----
   *
   * The workspace joins the same report rather than being checked afterwards.
   * Reporting one missing input, then a second on the next run, makes a user
   * discover their situation one round trip at a time. */
  const missingInputs = [...collection.missing];
  if (!workspace) {
    missingInputs.push({
      field: "workspace",
      question: "Which workspace holds the capture to analyse?",
      reason: "no workspace was given",
      choices: null,
      flag: "--workspace"
    });
  }

  if (missingInputs.length) {
    return cliResult({
      operation, status: STATUS.REQUIRES_USER_INPUT, mode,
      userActions: missingInputs.map((m) => ({
        what: m.question,
        how: `Pass ${m.flag}${m.choices ? ` (${m.choices.join(" / ")})` : ""}. ${m.reason}.`,
        field: m.field
      })),
      summary: `\`${mode}\` needs ${missingInputs.length} input(s) that were not supplied`,
      readiness: READINESS.UNDETERMINED,
      readinessReason:
        "Waiting on input only you can supply. Nothing here invents a value — a placeholder would flow into output that reads exactly as confident as a real answer.",
      detail: {
        missingInputs,
        exampleCommand: exampleCommand({ mode, missing: missingInputs, workspace }),
        interactive: canPrompt({ interactive, isTTY }),
        browserLaunched: false,
        resolvedConfiguration: resolution.records
      }
    });
  }

  /* ---- 10-12. preflight, then the pipeline ---- */

  const outcome = runPipelineForMode({
    operation, mode, workspace, project,
    briefPath: resolution.values.briefPath ?? null,
    stack: resolution.values.stack ?? null,
    pipelineMode, strict,
    viewports: resolution.values.viewports ?? null,
    motion,
    /* `"default"` is the RESTING state — what a plain capture already holds —
     * so a list containing only it is a request for nothing extra. Testing the
     * list's LENGTH counted the tool-default `["default"]` as a request for
     * state recreation and escalated the advisory `states` requirement to
     * blocking on every run, which is what made the builder prompt unreachable
     * through this CLI (def_0046). Read what the list contains, not whether it
     * exists — the same test `present.mjs`, `result.mjs` and `run-store.mjs`
     * already use. */
    states: (resolution.values.states ?? []).some((s) => s !== "default"),
    resolution
  });

  /* Every guided result carries the resolution and a next action, whatever its
   * status — a blocked run needs both as much as a completed one does. */
  outcome.detail = {
    ...outcome.detail,
    resolvedConfiguration: resolution.records,
    resolutionSummary: describeResolution(resolution),
    inputSource: resolution.values.inputType ?? "url",
    interactive: canPrompt({ interactive, isTTY }),
    projectUsed: project ?? null,
    nextAction: outcome.detail?.nextAction ?? (outcome.status === STATUS.BLOCKED
      ? "Run `helmy blockers` for the full report."
      : "Read the artifacts, then `helmy verify` to confirm they still match the IR.")
  };
  return outcome;
}

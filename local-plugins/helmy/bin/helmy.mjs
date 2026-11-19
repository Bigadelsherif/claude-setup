#!/usr/bin/env node
/**
 * helmy — CLI for the UI forensics pipeline.
 *
 * Every command the agent runs is available here, which is what lets the tests
 * exercise the real pipeline rather than a parallel implementation of it.
 */

import { existsSync, copyFileSync, appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { analyzeWorkspace, validateWorkspace } from "../src/pipeline.mjs";
import { Workspace, slugFor, readJSON, writeJSON, paths, PLUGIN_ROOT } from "../src/workspace/workspace.mjs";
import { evaluatePromotions, renderLearnedRules } from "../src/correct/apply.mjs";
import { listDefects, openDefects, unverifiedFixes, renderDefectLog } from "../src/defects/store.mjs";
import * as fidelity from "../src/cli/commands.mjs";
import { emit, STATUS, EXIT_CODE, cliResult, READINESS } from "../src/cli/result.mjs";
import { validate } from "../src/validate/schema.mjs";
import { cmdBlockers as runBlockers, runMode, notYetImplemented } from "../src/cli/workflow.mjs";
import { cmdInit as runInit } from "../src/cli/init.mjs";
import {
  cmdCorrect as proposeCorrection, cmdCorrectionShow, cmdCorrectionAccept,
  cmdCorrectionReject, cmdCorrectionPromote, cmdCorrectionHistory
} from "../src/cli/correct.mjs";
import {
  cmdTelemetryStatus, cmdTelemetryEnable, cmdTelemetryDisable,
  cmdTelemetryInspect, cmdTelemetryClear, cmdTelemetryExport, cmdTelemetryRetention
} from "../src/cli/telemetry.mjs";
import {
  cmdVersion, cmdDoctor, cmdInstall, cmdUpgrade, cmdUninstall,
  cmdRepair, cmdMigrations, cmdPackage, cmdCompatibility
} from "../src/cli/install.mjs";
import { commandStarted, commandFinished, isEnabled } from "../src/observe/record.mjs";
import { readConfig as readObservabilityConfig } from "../src/observe/store.mjs";
import { COMMANDS, COMMAND_NAMES, findCommand, suggestCommand, renderHelp, renderCommandHelp, MODES } from "../src/cli/catalog.mjs";
/**
 * Whether a terminal is genuinely on both ends.
 *
 * Checked rather than assumed because the same binary runs in CI, in a pipe,
 * and under an agent. A prompt written to a pipe is a hang: nobody is there to
 * answer, and the run waits forever on a question it should instead have
 * reported as `requires-user-input`. The reading itself belongs to the guided
 * workflow; only this fact belongs to the process that was started.
 */
const promptIsPossible = () => process.stdin.isTTY === true && process.stdout.isTTY === true;

const args = process.argv.slice(2);
const command = args[0];

function flag(name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = args[i + 1];
  return next && !next.startsWith("--") ? next : true;
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(message);
}

/* ------------------------------------------------------------------ init */

function cmdInit() {
  const source = flag("source") ?? flag("url");
  if (!source) fail("init requires --source <url>");
  const root = flag("out") ?? join(process.cwd(), ".ui-analysis", slugFor(source));
  const slug = slugFor(source);

  Workspace.create(root, {
    slug,
    source: { kind: "url", value: String(source) },
    tier: flag("tier", "mcp-browser"),
    viewports: [Number(flag("viewport", 1440))],
    createdAt: new Date().toISOString()
  });

  ok(`workspace ready: ${root}`);
  ok("next: capture raw/extract-<viewport>.json and raw/probe-<viewport>.json, then run `helmy analyze`");
}

/* --------------------------------------------------------------- ingest */

function cmdIngest() {
  const ws = flag("workspace");
  const rawSrc = flag("raw");
  const probeSrc = flag("probe");
  if (!ws || !rawSrc) fail("ingest requires --workspace <dir> --raw <file> [--probe <file>]");

  const viewport = flag("viewport", "1440");
  const workspace = new Workspace(ws);
  mkdirSync(workspace.path("raw"), { recursive: true });

  const rawName = `extract-${viewport}.json`;
  copyFileSync(resolve(rawSrc), workspace.path("raw", rawName));
  let probeName = null;
  if (probeSrc && existsSync(resolve(probeSrc))) {
    probeName = `probe-${viewport}.json`;
    copyFileSync(resolve(probeSrc), workspace.path("raw", probeName));
  }

  const manifest = workspace.exists("manifest.json") ? workspace.readJSON("manifest.json") : {};
  workspace.writeJSON("manifest.json", { ...manifest, rawName, probeName });
  ok(`ingested ${rawName}${probeName ? ` and ${probeName}` : " (no probe — aggregate-only mode)"}`);
}

/* -------------------------------------------------------------- analyze */

function cmdAnalyze() {
  const ws = flag("workspace");
  if (!ws) fail("analyze requires --workspace <dir>");

  const viewportFlag = flag("viewports");
  const request = {
    mode: flag("for", "analyze"),
    viewports: viewportFlag && viewportFlag !== true
      ? String(viewportFlag).split(",").map((v) => Number(v.trim())).filter(Boolean)
      : undefined,
    includeMotion: flag("motion") === true,
    includeStates: flag("states") === true
  };
  for (const key of Object.keys(request)) if (request[key] === undefined) delete request[key];

  // A brief may be supplied by path; it is copied into the workspace so the run
  // is reproducible from the workspace alone.
  const briefFlag = flag("brief");
  if (briefFlag && briefFlag !== true) {
    const workspace = new Workspace(ws);
    mkdirSync(workspace.path("input"), { recursive: true });
    copyFileSync(resolve(briefFlag), workspace.path("input", "target-brief.json"));
    ok(`brief ingested from ${briefFlag}`);
  }

  const { ir, coverage, safety, modeEvaluation, projection, outcomes, pruned } = analyzeWorkspace(ws, {
    mode: flag("mode"),
    stack: flag("stack"),
    config: { request }
  });

  ok(`IR hash: ${projection.hash}`);
  ok(
    `confidence: ${ir.confidence.overall.toFixed(2)} ` +
      `(provenance ${ir.confidence.provenance.toFixed(2)} × coverage ${coverage.coverageFactor.toFixed(2)})`
  );
  ok(
    `coverage: ${(coverage.visibleSampledPercent * 100).toFixed(1)}% of visible nodes · ` +
      `contentReached ${coverage.contentReached.toFixed(2)} · ` +
      `${coverage.repeatGroupsInMain}/${coverage.repeatGroupsDetected} repeat groups in content`
  );
  ok(`unknowns: ${ir.unknowns.length} · warnings: ${coverage.warnings.length}`);

  ok(
    `MODE ${modeEvaluation.requestedMode}: ${modeEvaluation.decision} · ` +
      `${modeEvaluation.availableEvidence.length} requirement(s) met, ` +
      `${modeEvaluation.blockingGaps.length} blocking, ${modeEvaluation.warningGaps.length} warning`
  );
  ok(`   next: ${modeEvaluation.recommendedNextAction}`);

  const banner = safety.promptGenerationAllowed ? "SAFETY" : "SAFETY  ***BLOCKED***";
  ok(`${banner}: ${safety.status} — ${safety.summary}`);
  for (const b of safety.blockers) ok(`   blocker  ${b.code}: ${b.message}`);

  if (outcomes.length) ok(`corrections applied: ${outcomes.length}`);
  for (const rel of Object.keys(projection.files)) ok(`  wrote ${rel}`);
  for (const rel of pruned ?? []) ok(`  removed stale ${rel}`);

  const result = validateWorkspace(ws);
  reportValidation(result, flag("strict") === true);
}

function cmdDefects() {
  const defects = listDefects();
  if (!defects.length) {
    ok("no defect reports filed.");
    return;
  }
  const open = openDefects(defects);
  const unverified = unverifiedFixes(defects);

  ok(`${defects.length} defect(s) · ${open.length} open · ${unverified.length} fixed without a passing regression test`);
  for (const d of open) {
    ok(`  ${d.id}  [${d.severity}] ${d.category} — ${d.observation.slice(0, 80)}`);
    ok(`         module ${d.module} · test ${d.regressionTest?.status ?? "none"}`);
  }
  for (const d of unverified) {
    console.warn(`  ${d.id} is marked fixed but its regression test is "${d.regressionTest?.status ?? "none"}"`);
  }

  if (flag("write") === true) {
    const target = join(process.cwd(), "docs", "DEFECT-LOG.md");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, renderDefectLog(defects), "utf8");
    ok(`wrote ${target}`);
  }
}

/* ------------------------------------------------------------- validate */

function reportValidation(result, strict) {
  for (const f of result.errors) {
    console.error(`  [${f.rule}] ERROR ${f.where ? `${f.where}: ` : ""}${f.message}`);
  }
  for (const f of result.warnings) {
    console.warn(`  [${f.rule}] warn  ${f.where ? `${f.where}: ` : ""}${f.message}`);
  }
  ok(`validation: ${result.summary}`);
  if (!result.ok || (strict && result.warnings.length)) process.exit(1);
}

function cmdValidate() {
  const ws = flag("workspace");
  if (!ws) fail("validate requires --workspace <dir>");
  reportValidation(validateWorkspace(ws), flag("strict") === true);
}

/* -------------------------------------------------------------- correct */

function cmdCorrectFromFile() {
  const ws = flag("workspace");
  const file = flag("file");
  if (!ws || !file) fail("correct requires --workspace <dir> --file <correction.json>");

  const correction = readJSON(resolve(file));

  /* Validated BEFORE it is written, against the schema that has always existed
   * and was never called on this path.
   *
   * The ordering is the whole fix. Previously the record was written and then
   * read by the pipeline, so a malformed one was already on disk by the time it
   * caused a crash — and every later analysis of that workspace threw the same
   * TypeError with nothing naming the file responsible (def_0042). A record
   * that cannot be read must not be allowed to land. */
  const check = validate(readJSON(paths.schema("correction")), correction);
  if (!check.valid) {
    console.error(`error: ${resolve(file)} is not a valid correction record.`);
    for (const problem of check.errors.slice(0, 8)) {
      console.error(`  ${problem.path ?? problem.field ?? "(record)"}: ${problem.message}`);
    }
    console.error("");
    console.error("Nothing was written. A correction needs at least `claim` and a `corrected` object");
    console.error("carrying the value it should say — a record with only the disputed claim is a complaint.");
    process.exit(EXIT_CODE[STATUS.REQUIRES_USER_INPUT]);
  }

  const workspace = new Workspace(ws);
  const target = workspace.path("feedback", "corrections", `${correction.id}.json`);
  mkdirSync(dirname(target), { recursive: true });
  writeJSON(target, correction);
  ok(`filed ${correction.id} against \`${correction.claim}\``);

  const { ir, projection, outcomes } = analyzeWorkspace(ws, {});
  for (const outcome of outcomes) {
    ok(`  ${outcome.claim}: ${outcome.from} -> ${outcome.to} (superseded ${outcome.supersededRecords})`);
  }
  ok(`re-projected at IR hash ${projection.hash} · confidence ${ir.confidence.overall.toFixed(2)}`);

  reportValidation(validateWorkspace(ws), false);
}

/* ----------------------------------------------------------- regenerate */

function cmdRegenerate() {
  const ws = flag("workspace");
  if (!ws) fail("regenerate requires --workspace <dir>");
  const { projection } = analyzeWorkspace(ws, {});
  ok(`re-projected at IR hash ${projection.hash}`);
  reportValidation(validateWorkspace(ws), false);
}

/* -------------------------------------------------------------- promote */

function cmdPromote() {
  const ws = flag("workspace");
  if (!ws) fail("promote requires --workspace <dir> [--id corr_0001]");
  const workspace = new Workspace(ws);
  const corrections = workspace.corrections();
  const forceId = flag("id");

  const { promote, hold } = evaluatePromotions(corrections, {
    force: forceId && forceId !== true ? [forceId] : []
  });

  for (const { correction, reason } of hold) {
    ok(`  held  ${correction.id}: ${reason}`);
  }

  if (!promote.length) {
    ok("nothing promoted.");
    return;
  }

  const rulesPath = join(process.cwd(), ".helmy-analyzer", "rules", "rules-learned.md");
  mkdirSync(dirname(rulesPath), { recursive: true });
  if (!existsSync(rulesPath)) {
    appendFileSync(rulesPath, "# Learned rules\n\nPromoted corrections. Loaded at the start of every analysis.\n\n", "utf8");
  }
  appendFileSync(rulesPath, renderLearnedRules(promote), "utf8");

  for (const { correction, reason } of promote) {
    correction.promotionStatus = "promoted";
    correction.promotedAt = new Date().toISOString();
    writeJSON(workspace.path("feedback", "corrections", `${correction.id}.json`), correction);
    ok(`  promoted ${correction.id}: ${reason}`);
  }
  ok(`rules written to ${rulesPath}`);
}

/* ------------------------------------------------------- fidelity suite */

/**
 * The fidelity commands all return the typed CLI result and exit on its code.
 *
 * The exit code is taken from the result rather than chosen here, so `blocked`
 * and `failed` cannot be collapsed by a caller that forgot the difference —
 * and a CI job that retries on 1 does not retry a run a safety gate refused.
 */
/**
 * The observability root.
 *
 * The project when there is one, otherwise the working directory. Resolved once
 * per command so that two commands in the same project write to one store and
 * two projects never share one.
 */
const observabilityRoot = () => {
  const explicit = flag("observability-root");
  if (explicit && explicit !== true) return resolve(String(explicit));
  return projectFlag() ?? process.cwd();
};

/**
 * Every command passes through here, which is why the instrumentation lives
 * here rather than in twenty-three call sites.
 *
 * The ordering matters: `commandStarted` fires before the work, and
 * `commandFinished` fires after the result exists but before `process.exit`.
 * A finish event written after the exit would never be written at all.
 *
 * Nothing in this block can change `result`. That is the property the whole
 * integration rests on — an observability failure must not turn a completed
 * analysis into a failed command — and it is why every recorder call is
 * fire-and-forget and why they all swallow their own errors.
 */
const runFidelity = async (fn, argv) => {
  const json = flag("json") === true;
  const obsRoot = observabilityRoot();
  const observing = isEnabled(obsRoot);
  const started = Date.now();

  if (observing) {
    commandStarted(obsRoot, {
      command: argv.operation ?? "fidelity",
      mode: argv.mode ?? null,
      projectId: projectFlag(),
      workspaceId: workspaceFlag(),
      sourceKind: null
    });
  }

  let result;
  let thrown = null;
  try {
    result = await fn(argv);
  } catch (error) {
    thrown = error;
    /* An exception is `failed`, never `blocked`. A gate refusing is a decision;
     * a throw is a defect, and conflating them would hide one behind the other. */
    result = cliResult({
      operation: argv.operation ?? "fidelity",
      status: STATUS.FAILED,
      viewport: argv.viewport ?? null,
      errors: [{ code: "command-threw", message: String(error?.message ?? error).slice(0, 300) }],
      readiness: READINESS.NOT_USABLE,
      readinessReason: "The command did not complete, so nothing it would have produced exists."
    });
  }

  if (observing) {
    /* The thrown error is passed but only its CLASS and stack DEPTH are ever
     * recorded, and only when `verboseErrors` is on. The message stays here:
     * a driver error routinely quotes a selector or the text it was looking
     * for, which is page content. */
    commandFinished(obsRoot, result, {
      command: argv.operation ?? "fidelity",
      projectId: projectFlag(),
      workspaceId: workspaceFlag(),
      durationMs: Date.now() - started,
      error: thrown,
      verboseErrors: readObservabilityConfig(obsRoot).verboseErrors === true,
      versions: {
        extractorVersion: result?.detail?.readinessModel?.extractorVersion ?? null,
        driverVersion: result?.detail?.driverVersion ?? null,
        toleranceVersion: result?.detail?.toleranceVersion ?? null,
        policyVersion: result?.detail?.policyVersion ?? null
      }
    });
  }

  process.exit(emit(result, { json, verbose: flag("verbose") === true }));
};

const runRoot = () => resolve(flag("run") ?? join(process.cwd(), ".fidelity-run"));
const viewportArg = (fallback = 1440) => Number(flag("viewport", fallback));
const navTimeout = () => {
  const v = flag("nav-timeout");
  return v && v !== true ? Number(v) : null;
};
const viewportList = () => {
  const raw = flag("viewports");
  return raw && raw !== true ? String(raw).split(",").map((v) => Number(v.trim())).filter(Boolean) : null;
};

const cmdSession = () => runFidelity(fidelity.cmdSession, {
  operation: "session",
  root: runRoot(),
  referenceUrl: flag("reference"),
  targetUrl: flag("target"),
  viewports: viewportList(),
  tapPolicy: flag("tap-policy")
});

const cmdReference = () => runFidelity(fidelity.cmdReference, {
  operation: "reference", root: runRoot(), viewport: viewportArg(), navigationTimeoutMs: navTimeout()
});

const cmdCapture = () => runFidelity(fidelity.cmdCapture, {
  operation: "capture", root: runRoot(), viewports: viewportList(), navigationTimeoutMs: navTimeout()
});

const cmdCaptureViewport = () => runFidelity(fidelity.cmdCaptureViewport, {
  operation: "capture-viewport", root: runRoot(), viewport: viewportArg(), navigationTimeoutMs: navTimeout()
});

const cmdCaptureState = () => runFidelity(fidelity.cmdCaptureState, {
  operation: "capture-state", root: runRoot(), viewport: viewportArg(),
  state: flag("state", "hover"), selector: flag("selector"), side: flag("side", "target")
});

const cmdIntrinsic = () => runFidelity(fidelity.cmdIntrinsic, {
  operation: "intrinsic", root: runRoot(), viewport: viewportArg(),
  side: flag("side", "target"), state: flag("state", "default")
});

const cmdCompare = () => runFidelity(fidelity.cmdCompare, {
  operation: "compare", root: runRoot(), viewport: viewportArg(),
  contentMode: flag("content-mode", "independent-content"),
  declaredRelationship: flag("relationship")
});

/* Every readiness-family command takes a workspace, so it can describe a run
 * rather than only the session that started one. None of them launches a
 * browser: they read what is on disk and say what it means. */
const cmdHistory = () => runFidelity(fidelity.cmdHistory, {
  operation: "history", root: runRoot(), workspace: workspaceFlag()
});
const cmdRecovery = () => runFidelity(fidelity.cmdRecovery, {
  operation: "recovery", root: runRoot(), workspace: workspaceFlag()
});
const cmdFreshness = () => runFidelity(fidelity.cmdFreshness, {
  operation: "freshness", root: runRoot(), viewport: viewportArg(),
  workspace: workspaceFlag(),
  maxAgeMs: flag("max-age") && flag("max-age") !== true ? Number(flag("max-age")) : null
});
const cmdTasks = () => runFidelity(fidelity.cmdTasks, {
  operation: "tasks", root: runRoot(), workspace: workspaceFlag(),
  iteration: flag("iteration") && flag("iteration") !== true ? Number(flag("iteration")) : null
});
const cmdVerify = () => runFidelity(fidelity.cmdVerify, {
  operation: "verify", root: runRoot(), workspace: workspaceFlag()
});
const cmdReadiness = () => runFidelity(fidelity.cmdReadiness, {
  operation: "readiness",
  workspace: workspaceFlag(),
  project: projectFlag(),
  root: flag("run") ? runRoot() : (existsSync(join(process.cwd(), ".fidelity-run", "session.json")) ? runRoot() : null)
});

/* --------------------------------------------------------- corrections */

/**
 * `helmy correct` proposes and previews; `helmy correction …` decides.
 *
 * The split is deliberate. Proposing is cheap and reversible; deciding changes
 * what the system says. One command with a `--yes` flag would make review
 * something people learn to skip.
 */
const str = (name) => { const v = flag(name); return v && v !== true ? String(v) : null; };
const list = (name) => { const v = str(name); return v ? v.split(",").map((x) => x.trim()).filter(Boolean) : []; };

const cmdCorrectSurface = () => {
  /* The pre-existing `--file` path files a prepared record directly. It is kept
   * working: it predates this workflow, it is the only way to replay a
   * correction written elsewhere, and removing it silently would be a
   * regression dressed as a rewrite. */
  if (flag("file")) return cmdCorrectFromFile();
  return runFidelity(() => proposeCorrection({
  workspace: workspaceFlag(),
  claim: str("claim"),
  category: str("category"),
  value: str("value"),
  status: str("status"),
  scope: str("scope") ?? "reference",
  reason: str("reason"),
  author: str("author"),
  evidence: list("evidence"),
  interactive: flag("interactive") === true,
    isTTY: process.stdin.isTTY === true && process.stdout.isTTY === true
  }), { operation: "correct" });
};

/** `helmy correction <verb> <id>` — the verb is args[1], the id args[2]. */
const cmdCorrectionSurface = () => runFidelity(() => {
  const verb = args[1] && !args[1].startsWith("--") ? args[1] : null;
  const id = args[2] && !args[2].startsWith("--") ? args[2] : null;
  const workspace = workspaceFlag();

  switch (verb) {
    case "show":    return cmdCorrectionShow({ workspace, id });
    case "accept":  return cmdCorrectionAccept({
      workspace, id,
      allowEvidenceReduction: flag("allow-evidence-reduction") === true,
      actor: str("author")
    });
    case "reject":  return cmdCorrectionReject({ workspace, id, reason: str("reason") });
    case "promote": return cmdCorrectionPromote({
      workspace, id, explicit: flag("explicit") === true, actor: str("author")
    });
    case "history": return cmdCorrectionHistory({ workspace });
    default:
      return cliResult({
        operation: "correction",
        status: STATUS.FAILED,
        errors: [{
          code: "unknown-correction-verb",
          message: verb ? `\`${verb}\` is not a correction verb.` : "No correction verb was given.",
          recommendation: "Use one of: show, accept, reject, promote, history."
        }],
        readiness: READINESS.UNDETERMINED,
        readinessReason: "Nothing was changed."
      });
  }
}, { operation: "correction" });

/* ---------------------------------------------------------- telemetry */

/**
 * `helmy telemetry <verb>` — local diagnostics, and control over them.
 *
 * Named `telemetry` even though nothing transmits: that is the word people
 * search for when they want to know what a tool collects, and hiding local
 * recording behind a friendlier name makes it harder to audit.
 */
const cmdTelemetrySurface = () => runFidelity(() => {
  const verb = args[1] && !args[1].startsWith("--") ? args[1] : "status";
  const root = observabilityRoot();

  switch (verb) {
    case "status":    return cmdTelemetryStatus({ root });
    case "enable":    return cmdTelemetryEnable({
      root,
      redactionLevel: str("redaction"),
      recordUrlOrigins: flag("record-origins") === true,
      allowExport: flag("allow-export") === true
    });
    case "disable":   return cmdTelemetryDisable({ root });
    case "inspect":   return cmdTelemetryInspect({
      root, limit: flag("limit") && flag("limit") !== true ? Number(flag("limit")) : 20
    });
    case "clear":     return cmdTelemetryClear({ root, confirmed: flag("confirm") === true });
    case "export":    return cmdTelemetryExport({ root, to: str("to"), confirmed: flag("confirm") === true });
    case "retention": return cmdTelemetryRetention({ root });
    default:
      return cliResult({
        operation: "telemetry",
        status: STATUS.FAILED,
        errors: [{
          code: "unknown-telemetry-verb",
          message: `\`${verb}\` is not a telemetry verb.`,
          recommendation: "Use one of: status, enable, disable, inspect, clear, export, retention."
        }],
        readiness: READINESS.UNDETERMINED,
        readinessReason: "Nothing was changed."
      });
  }
}, { operation: "telemetry" });

/* ------------------------------------------------------- installation */

/**
 * The installation surface.
 *
 * Every one of these goes through `runFidelity` like everything else, so they
 * get the same typed result, the same exit codes and the same observability. An
 * installation command that reported success differently from an analysis
 * command would be one more thing for a script to special-case.
 *
 * All four mutating commands are **dry runs unless `--apply` is given**. That is
 * the default because an install, upgrade, repair or uninstall that surprises
 * you has already run.
 */
const backupFlag = () => { const b = flag("backup"); return b && b !== true ? resolve(String(b)) : null; };
const rootFlag = (fallback) => { const r = flag("root"); return r && r !== true ? resolve(String(r)) : fallback; };
const installModeFlag = (fallback) => { const m = flag("mode"); return m && m !== true ? String(m) : fallback; };

const cmdVersionSurface = () => runFidelity(() => {
  const check = str("check");
  return check ? cmdCompatibility({ kind: check, version: str("version") }) : cmdVersion();
}, { operation: "version" });

const cmdDoctorSurface = () => runFidelity(() => cmdDoctor({
  root: rootFlag(PLUGIN_ROOT),
  allowBrowserLaunch: flag("allow-browser-launch") === true
}), { operation: "doctor" });

const cmdInstallSurface = () => runFidelity(() => cmdInstall({
  mode: installModeFlag("repository"),
  projectRoot: str("project") ? resolve(str("project")) : process.cwd(),
  dryRun: flag("apply") !== true,
  force: flag("force") === true,
  backupDir: backupFlag()
}), { operation: "install" });

const cmdUpgradeSurface = () => runFidelity(() => cmdUpgrade({
  mode: installModeFlag("global"),
  projectRoot: str("project") ? resolve(str("project")) : process.cwd(),
  dryRun: flag("apply") !== true,
  force: flag("force") === true,
  backupDir: backupFlag(),
  migrate: flag("no-migrate") !== true
}), { operation: "upgrade" });

const cmdUninstallSurface = () => runFidelity(() => cmdUninstall({
  pluginRoot: rootFlag(PLUGIN_ROOT),
  projectRoot: str("project") ? resolve(str("project")) : process.cwd(),
  remove: list("remove").length ? list("remove") : ["plugin-code"],
  confirmed: list("confirm"),
  apply: flag("apply") === true
}), { operation: "uninstall" });

const cmdRepairSurface = () => runFidelity(() => cmdRepair({
  root: rootFlag(PLUGIN_ROOT),
  force: flag("force") === true,
  dryRun: flag("apply") !== true,
  backupDir: backupFlag()
}), { operation: "repair" });

const cmdMigrationsSurface = () => runFidelity(() => cmdMigrations({
  root: rootFlag(process.cwd()),
  apply: flag("apply") === true,
  backupDir: backupFlag(),
  list: flag("list") === true
}), { operation: "migrations" });

const cmdPackageSurface = () => runFidelity(() => cmdPackage({
  root: rootFlag(PLUGIN_ROOT),
  write: flag("write") === true,
  out: str("out"),
  verify: flag("verify") === true
}), { operation: "package" });

/* ----------------------------------------------------------------- help */

/**
 * Help is rendered from the catalog, never written by hand.
 *
 * A hand-written command reference drifts from behaviour within a month, and
 * the drift is invisible until someone follows it. `helmy help <command>`
 * prints that command's arguments, outputs, statuses and failure behaviour.
 */
function cmdHelp() {
  const topic = args[1] && !args[1].startsWith("--") ? args[1] : null;
  ok(topic ? renderCommandHelp(topic) : renderHelp());
  if (!topic) {
    ok("");
    ok("Legacy workspace commands (unchanged): ingest, validate, correct, regenerate, promote, defects,");
    ok("session, reference, capture-viewport, capture-state.");
    ok(`Plugin root: ${PLUGIN_ROOT}`);
  }
}

/* -------------------------------------------------- Phase 5.1 surface */

const modeFlag = () => {
  const raw = flag("for", "analyze");
  return raw === true ? "analyze" : String(raw);
};

const briefFlag = () => {
  const b = flag("brief");
  return b && b !== true ? String(b) : null;
};

const stackFlag = () => {
  const st = flag("stack");
  return st && st !== true ? String(st) : null;
};

const workspaceFlag = () => {
  const w = flag("workspace");
  return w && w !== true ? String(w) : null;
};

const capabilityFlags = () => {
  const caps = [];
  if (flag("authenticated") === true) caps.push("authenticated");
  if (flag("auto-correct") === true) caps.push("automatic-component-correction");
  if (flag("unattended") === true) caps.push("production-automation");
  const explicit = flag("capability");
  if (explicit && explicit !== true) caps.push(String(explicit));
  return caps;
};

/**
 * The project defaults to `.helmy-analyzer` beside the working directory, so a
 * user standing in a project does not have to say where it is.
 *
 * Auto-detection requires `project.json`, not merely the directory. The
 * directory name is also used by the plugin's own configuration, so treating
 * its presence as "there is a project here" reported `project-not-initialized`
 * to anyone running from a checkout that had one and no project. An explicit
 * `--project` still reports that, because then it is what was asked about.
 */
const projectFlag = () => {
  const p = flag("project");
  if (p && p !== true) return resolve(String(p));
  const local = join(process.cwd(), ".helmy-analyzer");
  return existsSync(join(local, "project.json")) ? local : null;
};

const cmdBlockersSurface = () => runFidelity(() => runBlockers({
  workspace: workspaceFlag(),
  project: projectFlag(),
  mode: modeFlag(),
  briefPath: briefFlag(),
  viewport: flag("viewport") && flag("viewport") !== true ? Number(flag("viewport")) : null,
  state: flag("state") && flag("state") !== true ? String(flag("state")) : null,
  stack: stackFlag(),
  capabilities: capabilityFlags()
}), { operation: "blockers" });

/**
 * A mode workflow. `analyze` takes --for; the others pin their own mode, which
 * is the whole reason they exist as separate commands.
 */
/**
 * A mode workflow. `analyze` takes --for; the others pin their own mode, which
 * is the whole reason they exist as separate commands.
 *
 * Interactive prompting is opt-in AND requires a terminal: `--interactive` in a
 * pipeline would otherwise wait for an answer nobody is there to give.
 */
const modeCommand = (operation, fixedMode) => () => runFidelity(async () => {
  const mode = fixedMode ?? modeFlag();
  if (!MODES.includes(mode)) {
    return cliResult({
      operation, status: STATUS.FAILED, mode,
      errors: [{
        code: "invalid-mode",
        message: `\`${mode}\` is not a mode. The modes are: ${MODES.join(", ")}.`,
        recommendation: `Re-run with --for <${MODES.join("|")}>.`
      }],
      readiness: READINESS.UNDETERMINED,
      readinessReason: "Nothing was analysed."
    });
  }

  const list = (name) => {
    const raw = flag(name);
    return raw && raw !== true ? String(raw).split(",").map((v) => v.trim()).filter(Boolean) : null;
  };
  const str = (name) => {
    const v = flag(name);
    return v && v !== true ? String(v) : undefined;
  };

  return runMode({
    operation,
    mode,
    workspace: workspaceFlag(),
    project: projectFlag(),
    interactive: flag("interactive") === true,
    /* Not derived inside the workflow: whether a terminal exists is a property
     * of how this process was started, and the workflow has no business
     * guessing at it. */
    isTTY: promptIsPossible(),
    log: (line) => process.stderr.write(`${line}
`),
    /* Explicit arguments. Only what was actually typed reaches this object —
     * an `undefined` here would outrank a project default, which is the
     * opposite of what a flag nobody passed should do. */
    args: {
      url: str("url"),
      screenshots: str("screenshots"),
      inputType: str("input-type") ?? (str("screenshots") ? "screenshots" : undefined),
      viewports: list("viewports") ? list("viewports").map(Number).filter(Boolean) : undefined,
      states: list("states"),
      briefPath: str("brief"),
      productName: str("product"),
      stack: str("stack"),
      contentMode: str("content-mode"),
      outputDir: str("out"),
      runFidelity: flag("fidelity") === true ? true : undefined
    },
    pipelineMode: str("mode") ?? null,
    strict: flag("strict") === true
  });
}, { operation, viewport: null });

const cmdInitSurface = () => runFidelity(() => runInit({
  dir: flag("dir") && flag("dir") !== true ? resolve(String(flag("dir"))) : process.cwd(),
  name: flag("name") && flag("name") !== true ? String(flag("name")) : null,
  reference: flag("reference") && flag("reference") !== true ? String(flag("reference")) : null,
  stack: flag("stack") && flag("stack") !== true ? String(flag("stack")) : "next-tailwind",
  force: flag("force") === true,
  nonInteractive: flag("non-interactive") === true
}), { operation: "init" });

/**
 * The dispatch table.
 *
 * Catalogued commands come first; the legacy workspace commands remain so
 * existing scripts keep working. Every catalogued name must have a handler —
 * a test asserts it, so a command cannot be documented and unreachable.
 */
const commands = {
  /* legacy workspace surface, unchanged */
  ingest: cmdIngest,
  validate: cmdValidate,
  regenerate: cmdRegenerate,
  promote: cmdPromote,
  defects: cmdDefects,
  session: cmdSession,
  reference: cmdReference,
  "capture-viewport": cmdCaptureViewport,
  "capture-state": cmdCaptureState,
  help: cmdHelp,

  /* Phase 5.1 catalogued surface */
  init: cmdInitSurface,
  analyze: modeCommand("analyze", null),
  recreate: modeCommand("recreate", "recreate"),
  adapt: modeCommand("adapt", "adapt"),
  extend: modeCommand("extend", "extend"),
  improve: modeCommand("improve", "improve"),
  blockers: cmdBlockersSurface,
  capture: cmdCapture,
  intrinsic: cmdIntrinsic,
  compare: cmdCompare,
  telemetry: cmdTelemetrySurface,
  correct: cmdCorrectSurface,
  correction: cmdCorrectionSurface,
  tasks: cmdTasks,
  history: cmdHistory,
  recovery: cmdRecovery,
  freshness: cmdFreshness,
  verify: cmdVerify,
  readiness: cmdReadiness,

  /* Phase 5.9 installation surface */
  version: cmdVersionSurface,
  doctor: cmdDoctorSurface,
  install: cmdInstallSurface,
  upgrade: cmdUpgradeSurface,
  uninstall: cmdUninstallSurface,
  repair: cmdRepairSurface,
  migrations: cmdMigrationsSurface,
  package: cmdPackageSurface
};

if (!command) {
  cmdHelp();
  process.exit(0);
}

if (!commands[command]) {
  /* An unknown command is a `failed` result with a suggestion, not a help dump.
   * Printing the whole catalog buries the one line the user needs. */
  const near = suggestCommand(command);
  const result = cliResult({
    operation: "unknown-command",
    status: STATUS.FAILED,
    errors: [{
      code: "unknown-command",
      message: `\`${command}\` is not a helmy command.`,
      recommendation: near.length
        ? `Did you mean: ${near.join(", ")}? Run \`helmy help\` for the full list.`
        : "Run `helmy help` for the full list."
    }],
    readiness: READINESS.UNDETERMINED,
    readinessReason: "Nothing was attempted."
  });
  process.exit(emit(result, { json: flag("json") === true, verbose: flag("verbose") === true }));
}

try {
  commands[command]();
} catch (error) {
  fail(error.message);
}

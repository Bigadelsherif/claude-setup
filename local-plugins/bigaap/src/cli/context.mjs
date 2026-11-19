/**
 * Everything a readiness-family command needs to describe a workspace.
 *
 * The seven commands — readiness, blockers, verify, freshness, tasks, recovery,
 * history — each answer a different question about the same run. Before this
 * they each reached for whatever they needed and reported it in whatever shape
 * they happened to build, so the same fact could be phrased three ways and a
 * reader could not tell whether the difference meant anything.
 *
 * This gathers the run once, tolerating absence at every step: a workspace with
 * no IR, no artifacts and no defect store is a legitimate state (nothing has
 * been captured yet), and it must produce an empty context rather than an
 * error. A command that cannot load a run has something to say about that;
 * throwing takes the opportunity away.
 *
 * Nothing here launches a browser, and nothing here writes.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Workspace } from "../workspace/workspace.mjs";
import { ARTIFACTS } from "../artifacts/registry.mjs";
import { readMetadata } from "../artifacts/metadata.mjs";
import { checkFreshness, hashSources, FRESHNESS } from "../artifacts/freshness.mjs";
/* The IR hash MUST come from `hashIR`, which is what stamped the artifacts.
 * `contentHash` is a different function over the same object, so using it here
 * makes every artifact in a perfectly fresh workspace report as stale — and a
 * staleness report that is always wrong is worse than none, because it trains
 * the reader to ignore the real ones. */
import { hashIR } from "../ir/hash.mjs";
import { lintPrompt } from "../prompts/lint.mjs";
import { isPrompt } from "../prompts/contract.mjs";
import { listDefects, openDefects } from "../defects/store.mjs";

/**
 * Reads a workspace without running anything.
 *
 * Returns `{ present: false }` rather than throwing when there is no workspace,
 * because "there is nothing here yet" is an answer a command should be able to
 * give in its own voice.
 */
export function workspaceContext(workspaceRoot, { includeDefects = true } = {}) {
  if (!workspaceRoot || !existsSync(workspaceRoot)) {
    return emptyContext(workspaceRoot);
  }

  const ws = new Workspace(workspaceRoot);
  const ir = safeJSON(() => ws.readJSON("analysis", "ir.json"));
  const evidence = safeJSON(() => ws.readJSON("analysis", "evidence-map.json"));
  const manifest = safeJSON(() => ws.readJSON("manifest.json")) ?? {};

  /* Everything the registry knows about, read off disk as it actually is. */
  const files = {};
  for (const def of ARTIFACTS) {
    for (const name of [def.filename, def.blockedFilename].filter(Boolean)) {
      if (ws.exists(name)) files[name] = ws.readText(name);
    }
  }

  /* The hashes a freshness check compares against. Derived from what is on
   * disk now, so a stale artifact is one whose source has since moved. */
  const current = ir
    ? {
        ...hashSources({ evidence, configuration: manifest.config ?? null }),
        irHash: hashIR(ir),
        extractorVersion: ir.meta?.extractorVersion ?? null,
        toleranceVersion: manifest.toleranceVersion ?? null
      }
    : {};

  const sourceKind = ir?.meta?.source?.kind ?? manifest.source?.kind ?? null;
  const mode = ir?.modeEvaluation?.requestedMode ?? manifest.mode ?? null;

  /* Prompts are re-linted from disk rather than trusted from the run that
   * wrote them. A prompt can be edited after generation, and a lint result
   * recorded at generation time would describe a file that no longer exists. */
  const lint = {};
  for (const [filename, content] of Object.entries(files)) {
    if (!isPrompt(filename)) continue;
    lint[filename] = lintPrompt({
      filename, content, mode, sourceKind, ir,
      targetBrief: ws.targetBrief?.() ?? null,
      current
    });
  }

  const stale = [];
  for (const [filename, content] of Object.entries(files)) {
    const metadata = readMetadata(filename, content);
    if (!metadata || metadata.$malformed) continue;
    const fresh = checkFreshness(metadata, current);
    if (fresh.verdict === FRESHNESS.STALE || fresh.verdict === FRESHNESS.INCOMPATIBLE) {
      stale.push({
        filename,
        verdict: fresh.verdict,
        reasons: fresh.reasons.map((r) => ({ field: r.field, was: r.was, now: r.now, means: r.means })),
        safeToRegenerate: fresh.safeToRegenerate,
        recommendation: fresh.recommendation
      });
    }
  }

  return {
    present: true,
    workspace: workspaceRoot,
    /* What the RUN came to, which is not what the reporting command came to.
     * `bigaap readiness` completing successfully says nothing about whether the
     * run it describes was refused. */
    runStatus: runStatusOf(ir),
    runBlockers: runBlockersOf(ir),
    ir,
    evidence,
    manifest,
    modeEvaluation: ir?.modeEvaluation ?? null,
    mode,
    sourceKind,
    files,
    lint,
    current,
    staleArtifacts: stale,
    defects: includeDefects ? safeDefects() : [],
    corrections: safeJSON(() => ws.corrections()) ?? []
  };
}

/**
 * The status of the run whose artifacts are on disk.
 *
 * Derived from the safety gate and the mode evaluation, because those are what
 * refused it. A reporting command must never present a refused run as
 * completed — that is the one summary that must not appear above a blocker.
 */
function runStatusOf(ir) {
  if (!ir) return null;
  if (ir.safety && ir.safety.promptGenerationAllowed === false) return "blocked";
  const decision = ir.modeEvaluation?.decision;
  if (decision === "blocked" || decision === "blocked-with-recapture") return "blocked";
  if ((ir.modeEvaluation?.warningGaps ?? []).length) return "completed-with-warnings";
  return "completed";
}

/** The gaps that refused the run, in blocker shape. */
function runBlockersOf(ir) {
  const gaps = ir?.modeEvaluation?.blockingGaps ?? [];
  const safety = ir?.safety;
  const out = gaps.map((gap) => ({
    code: gap.id,
    stage: "mode-requirement",
    message: `${gap.label}: ${gap.detail ?? "not established"}`,
    recommendation: gap.remedy === "source"
      ? "This evidence is not available from the current input kind. Recapturing will not produce it."
      : "Recapture with wider coverage, or use a mode this evidence supports.",
    recaptureResolves: gap.remedy === "recapture",
    impossibleForInputKind: gap.remedy === "source"
  }));
  if (safety && safety.promptGenerationAllowed === false && !out.length) {
    out.push({
      code: "safety-gate",
      stage: "safety",
      message: safety.summary ?? "The safety gate refused this run.",
      recommendation: "Read output/blocked-prompt.md for what would change the verdict.",
      recaptureResolves: null,
      impossibleForInputKind: null
    });
  }
  return out;
}

function emptyContext(workspaceRoot) {
  return {
    present: false,
    runStatus: null,
    runBlockers: [],
    workspace: workspaceRoot ?? null,
    ir: null,
    evidence: null,
    manifest: {},
    modeEvaluation: null,
    mode: null,
    sourceKind: null,
    files: {},
    lint: {},
    current: {},
    staleArtifacts: [],
    defects: [],
    corrections: []
  };
}

/** Open defects only. A fixed defect is history, not a limitation on this run. */
function safeDefects() {
  try {
    return openDefects(listDefects());
  } catch {
    return [];
  }
}

function safeJSON(read) {
  try {
    const value = read();
    return value ?? null;
  } catch {
    return null;
  }
}

/**
 * The recovery attempts recorded across a workspace's captures.
 *
 * Flattened into one list with the operation and viewport on each entry, so a
 * reader can see the whole run's attempt history in order rather than opening
 * one capture contract per viewport.
 */
export function recoveryAttempts(workspaceRoot) {
  if (!workspaceRoot || !existsSync(workspaceRoot)) return [];
  const rawDir = join(workspaceRoot, "raw");
  if (!existsSync(rawDir)) return [];

  const out = [];
  let files = [];
  try { files = readdirSync(rawDir).filter((f) => f.endsWith(".json")); } catch { return []; }

  for (const file of files.sort()) {
    let contract = null;
    try {
      const parsed = JSON.parse(readFileSync(join(rawDir, file), "utf8"));
      contract = parsed.capture ?? parsed.contract ?? null;
    } catch { continue; }
    if (!contract?.attemptHistory) continue;

    contract.attemptHistory.forEach((attempt, i) => {
      out.push({
        source: file,
        operation: attempt.operation ?? contract.captureMode ?? "capture",
        attempt: attempt.attempt ?? i + 1,
        status: attempt.status ?? (attempt.error ? "failed" : "completed"),
        errorCategory: attempt.error?.code ?? attempt.errorCategory ?? null,
        retryDecision: attempt.policy ?? attempt.retryDecision ?? null,
        retryCount: attempt.retryCount ?? null,
        durationMs: attempt.durationMs ?? attempt.elapsedMs ?? null,
        viewport: attempt.viewport ?? contract.viewport ?? null,
        state: attempt.state ?? "default",
        artifactResult: attempt.artifact ?? (attempt.status === "completed" ? "written" : "none"),
        recommendation: attempt.error?.recommendation ?? null
      });
    });
  }
  return out;
}

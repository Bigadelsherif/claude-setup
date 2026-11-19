/**
 * The pipeline: raw -> evidence -> (corrections) -> IR -> projections.
 *
 * `analyze` is a pure function of what is on disk in `raw/` plus any filed
 * corrections. That purity is deliberate: it means the entire system after the
 * browser step can be tested without a browser, which is what makes it
 * testable at all.
 */

import { buildEvidence } from "./evidence/build.mjs";
import { applyCorrections, renderCorrectionLog } from "./correct/apply.mjs";
import { deriveIR } from "./ir/derive.mjs";
import { assessCoverage, assessScreenshotCoverage } from "./coverage/assess.mjs";
import { verifyPrimaryRegion, verifyScreenshotRegions } from "./coverage/verify-region.mjs";
import { buildScreenshotEvidence } from "./screenshot/evidence.mjs";
import { mergeEvidence } from "./evidence/merge.mjs";
import { inspectMotionArtifact, ARTIFACT_STATE } from "./evidence/motion-observed.mjs";
import { assessSafety } from "./coverage/safety.mjs";
import { evaluateMode } from "./modes/evaluate.mjs";
import { projectAll } from "./project/index.mjs";
import { runAll } from "./validate/rules.mjs";
import { loadSchemas, Workspace } from "./workspace/workspace.mjs";

/**
 * Runs the whole chain in memory. Nothing is written.
 * Exposed separately so tests can assert on intermediate stages.
 */
export const isScreenshotCapture = (raw) => raw?.$extractor === "bigaap/screenshot";

export function runPipeline({
  raw,
  probe = null,
  screenshotCapture = null,
  motionArtifact = null,
  motionArtifactFile = null,
  corrections = [],
  mode,
  meta = {},
  config = {}
}) {
  const screenshotOnly = isScreenshotCapture(raw);

  /* The observation artifact is inspected BEFORE evidence is built, so a
   * refusal is a recorded state rather than an exception thrown mid-build.
   * Screenshot captures are refused on source alone — a frame has no time axis
   * to observe a change across. */
  const motionArtifactState = inspectMotionArtifact(motionArtifact, {
    sourceKind: screenshotOnly ? "screenshots" : (meta.source?.kind ?? "url")
  });

  /* 1–2. Capture is already on disk. Evidence, then corrections.
   *
   * A screenshot capture takes a different intake entirely: its evidence is
   * validated and ceiling-capped rather than extracted, and it has no DOM for
   * the forensic builder to read. */
  const forensic = screenshotOnly
    ? null
    : buildEvidence(raw, probe, {
        mode, referenceId: meta.slug ?? "unknown",
        motionArtifact, motionArtifactFile, motionArtifactState
      });

  const visual = screenshotOnly
    ? buildScreenshotEvidence(raw, { referenceId: meta.slug ?? "unknown" })
    : screenshotCapture
      ? buildScreenshotEvidence(screenshotCapture, { referenceId: meta.slug ?? "unknown" })
      : null;

  // Sources are merged only AFTER each has been built independently, so
  // disagreement analysis has two distinct accounts to compare rather than one
  // already-collapsed value.
  const built = forensic && visual ? mergeEvidence(forensic, visual) : (forensic ?? visual);
  const multiSource = !!(forensic && visual);

  /* `refusedCorrections` carries records `applyCorrections` could not read.
   * Surfaced all the way out rather than swallowed: a malformed record used to
   * throw from three frames down, and the user was told a TypeError rather than
   * which of their files to fix (def_0042). */
  const { evidence, outcomes, refused: refusedCorrections = [] } = corrections.length
    ? applyCorrections(built, corrections)
    : { evidence: built, outcomes: [], refused: [] };

  /* 3. Coverage assessment — how much, and of what. */
  const coverage = screenshotOnly ? assessScreenshotCoverage(raw, evidence) : assessCoverage(raw);

  /* 4. Region verification — did we look at the right thing at all. */
  const verification = screenshotOnly
    ? verifyScreenshotRegions(evidence, coverage)
    : verifyPrimaryRegion(raw, coverage);

  /* 5. IR, with coverage folded into confidence. */
  const ir = deriveIR({ raw, evidence, probe, meta, coverage, verification, motionArtifactState });

  // Contested claims and their disagreements ride on the IR, so no projection
  // can render a contested value without having been told it is contested.
  ir.disagreements = evidence.disagreements ?? [];
  ir.contestedClaims = evidence.contested ?? [];
  ir.sourceKinds = evidence.sourceKinds ?? [...new Set((evidence.records ?? []).map((r) => r.sourceKind))];
  ir.multiSource = multiSource;

  if (screenshotOnly || multiSource) {
    // Everything a reader needs to treat this analysis as degraded, carried on
    // the IR itself rather than left to the projection layer to remember.
    ir.screenshot = {
      images: evidence.images ?? [],
      regions: evidence.regions ?? [],
      regionCoverage: evidence.regionCoverage ?? null,
      rejected: evidence.rejected ?? [],
      scaleKnown: evidence.scaleKnown,
      viewportKnown: evidence.viewportKnown
    };
    if (screenshotOnly) {
      ir.meta.source = { kind: "screenshots", value: meta.source?.value ?? "screenshot capture" };
    }
  }

  /* 6a. Mode evaluation — what was ASKED FOR decides what counts as missing.
   *     The target brief travels with the request: it is a requirement about the
   *     product being built, never evidence about the reference. */
  const modeEvaluation = evaluateMode({
    ir,
    evidence,
    request: { ...(config.request ?? {}), targetBrief: config.targetBrief ?? null }
  });
  ir.modeEvaluation = modeEvaluation;

  /* 6b. Safety gate. Needs the derived components and the mode verdict, so it
   *     runs after the IR and is attached to it — the IR is not considered
   *     complete without it. */
  const safety = assessSafety({
    coverage,
    verification,
    components: [...ir.components, ...ir.componentCandidates],
    config,
    modeEvaluation
  });
  ir.safety = safety;

  /* 7. Projection, which honours the gate. */
  const projection = projectAll(ir, {
    ...meta,
    allowEstimatedTokens: config.allowEstimatedTokens === true,
    targetBrief: config.targetBrief ?? null
  });

  return { evidence, ir, coverage, verification, safety, modeEvaluation, projection, outcomes, refusedCorrections };
}

/**
 * Runs the chain against a workspace on disk and writes every artifact.
 *
 * Two different things are called "mode" here, and they are not
 * interchangeable:
 *
 *   - `options.mode` is the **capture** mode (`full`, `quick`) — how much of
 *     the page the extractor read. It reaches `buildEvidence`.
 *   - `options.config.request.mode` is the **analysis** mode (`analyze`,
 *     `recreate`, `adapt`, `extend`, `improve`) — what the run is for. It
 *     reaches `evaluateMode`, and it is what decides which artifacts exist.
 *
 * Passing an analysis mode as `options.mode` is silent: the run completes and
 * produces `analyze` artifacts, because the analysis mode was never set and
 * defaulted. Nothing errors, and the output looks correct.
 */
export function analyzeWorkspace(workspaceRoot, options = {}) {
  const ws = new Workspace(workspaceRoot);
  const manifest = ws.exists("manifest.json") ? ws.readJSON("manifest.json") : {};

  const rawName = options.rawName ?? manifest.rawName ?? "extract-1440.json";
  const probeName = options.probeName ?? manifest.probeName ?? "probe-1440.json";

  const raw = ws.readJSON("raw", rawName);
  const probe = ws.exists("raw", probeName) ? ws.readJSON("raw", probeName) : null;

  // A screenshot capture sitting alongside a DOM capture makes the run
  // multi-source: both are built independently, then compared.
  const screenshotName = options.screenshotName ?? manifest.screenshotName ?? "screenshot.capture.json";
  const screenshotCapture = ws.exists("raw", screenshotName) ? ws.readJSON("raw", screenshotName) : null;

  /* The M2a observation artifact, if the browser pass produced one.
   *
   * Read but never written here, and never regenerated: prompt generation does
   * not launch a browser. An unreadable file is left null and the inspection
   * downstream reports it as invalid rather than throwing — a malformed
   * artifact must not make a workspace un-analysable, which is exactly the
   * failure def_0042 was. */
  const viewportForMotion = options.viewport ?? raw?.meta?.viewport?.width ?? 1440;
  const motionName = options.motionName ?? manifest.motionName ?? `motion-${viewportForMotion}.json`;
  let motionArtifact = null;
  if (ws.exists("raw", motionName)) {
    try { motionArtifact = ws.readJSON("raw", motionName); }
    catch { motionArtifact = { $motionContract: "unreadable" }; }
  }

  const corrections = ws.corrections();

  const meta = {
    slug: manifest.slug ?? "unknown",
    source: manifest.source ?? { kind: "url", value: raw?.meta?.url ?? "unknown" },
    tier: manifest.tier ?? "mcp-browser",
    stack: options.stack ?? manifest.stack ?? "next-tailwind"
  };

  const { evidence, ir, coverage, verification, safety, modeEvaluation, projection, outcomes, refusedCorrections } = runPipeline({
    raw,
    motionArtifact,
    motionArtifactFile: motionArtifact ? `raw/${motionName}` : null,
    probe,
    screenshotCapture,
    corrections,
    mode: options.mode ?? manifest.mode,
    meta,
    // The brief is workspace input, so it is loaded here rather than passed in.
    config: { ...(options.config ?? manifest.config ?? {}), targetBrief: ws.targetBrief() }
  });

  ws.writeJSON("analysis/evidence-map.json", {
    $schemaVersion: evidence.$schemaVersion,
    referenceId: evidence.referenceId,
    generatedAt: evidence.generatedAt,
    records: evidence.records
  });
  ws.writeJSON("analysis/ir.json", ir);

  for (const [rel, content] of Object.entries(projection.files)) {
    ws.writeText(rel, content);
  }

  // A workspace that flips from safe to unsafe must not keep its old prompt.
  const pruned = ws.pruneArtifacts(Object.keys(projection.files));

  if (corrections.length) {
    ws.writeText("feedback/correction-log.md", renderCorrectionLog(corrections, outcomes));
  }

  ws.writeJSON("manifest.json", {
    ...manifest,
    slug: meta.slug,
    source: meta.source,
    rawName,
    probeName,
    mode: evidence.mode,
    irHash: projection.hash,
    safety: safety.status,
    mode: modeEvaluation.requestedMode,
    modeDecision: modeEvaluation.decision,
    promptGenerated: projection.promptGenerated,
    coverageFactor: coverage.coverageFactor,
    contentReached: coverage.contentReached,
    lastAnalyzedAt: new Date().toISOString(),
    correctionsApplied: corrections.map((c) => c.id)
  });

  return { ws, evidence, ir, coverage, verification, safety, modeEvaluation, projection, outcomes, pruned, refusedCorrections };
}

/** Runs V1–V7 against what is currently on disk. */
export function validateWorkspace(workspaceRoot) {
  const ws = new Workspace(workspaceRoot);
  const schemas = loadSchemas();

  const evidenceMap = ws.readJSON("analysis/evidence-map.json");
  const ir = ws.readJSON("analysis/ir.json");
  const tokens = ws.exists("analysis/extracted-tokens.json")
    ? ws.readJSON("analysis/extracted-tokens.json")
    : null;
  const artifacts = ws.artifacts();

  return runAll({
    schemas,
    evidence: evidenceMap,
    ir,
    tokens,
    corrections: ws.corrections(),
    // A blocked run's spec is written under a different name; V3 must still
    // hold it to the same annotation standard.
    specText: artifacts["output/design-spec.md"] ?? artifacts["output/partial-design-spec.md"],
    promptText: artifacts["output/rebuild-prompt.md"],
    adaptationText: artifacts["output/adaptation-prompt.md"],
    improvementText: artifacts["output/improvement-prompt.md"],
    artifacts
  });
}

/**
 * `bigaap inspect-page` — the shadow CLI path.
 *
 * Everything this command does is new plumbing between modules that already
 * existed and already had their own tests: `captureRegionObservations` drives
 * a real browser through the settle loop and the region survey;
 * `buildShadowViewportArtifacts` turns what it saw into normalized evidence
 * and a page model; `buildClonePrompt` turns validated per-viewport models
 * into a clone prompt or a refusal artifact. This file's only job is to wire
 * the three together, write what they produced, and report a result in the
 * shape every other command here already uses.
 *
 * WHAT THIS MUST NEVER DO:
 *   - touch `output/`, `.fidelity-run/`, `.bigaap-analyzer/`, or any file the
 *     existing `analyze`/`recreate` path reads or writes. This command's
 *     artifacts live under their own directory and nowhere else.
 *   - lower a gate, invent a section, or promote a hidden-dominant capture to
 *     a complete model. `capture.hiddenDominant` and `capture.truncated` are
 *     read off the real settle/observe reports and handed to
 *     `classifySupport` unchanged.
 *   - hand `buildClonePrompt` anything but the already-validated `{model,
 *     normalized, support}` triple `buildShadowViewportArtifacts` produced.
 *     Nothing here re-reads a page, a DOM, or a browser session to build a
 *     prompt — every fact in one came from the capture loop above it, once.
 */

import { join } from "node:path";
import { cliResult, STATUS, READINESS, writeArtifact } from "./result.mjs";
import { captureRegionObservations } from "../capture/inspect.mjs";
import { buildShadowViewportArtifacts, ShadowPipelineError } from "../page-model/shadow.mjs";
import { producesOutput, SUPPORT_DETAIL } from "../modes/support.mjs";
import { slugFor } from "../workspace/workspace.mjs";
import {
  buildViewportSummary, renderInspectReport, statusForSupport,
  buildClonePromptSummary
} from "./inspect-report.mjs";
import { buildClonePrompt, validateClonePrompt, ClonePromptError } from "../prompt/clone-prompt.mjs";
import { assessPromptCompleteness, renderCompletenessReport } from "../prompt/completeness.mjs";
import { interactionEvidenceFrom } from "../capture/interact.mjs";
import { runMotionPass } from "../capture/motion-pass.mjs";
import { MOTION_ARTIFACT_FILENAME } from "../capture/motion-stage.mjs";
import { runMediaPass, MEDIA_ARTIFACT_FILENAME, CANVAS_ARTIFACT_FILENAME } from "../capture/media-pass.mjs";

export const DEFAULT_INSPECT_VIEWPORTS = Object.freeze([1440, 768, 375]);

const warningsOf = (run) => (run?.metadata?.warnings ?? []).map((w) => ({ code: w.operation, message: w.note }));
const errorsOf = (run) => (run?.metadata?.errors ?? []).map((e) => ({
  code: e.code, operation: e.operation, message: e.message, recommendation: e.recommendation ?? null
}));
const historyOf = (run) => (run?.metadata?.attemptHistory ?? []).map((a) => ({
  name: a.name, attemptIndex: a.attemptIndex, status: a.status, errorCode: a.errorCode, durationMs: a.durationMs
}));
const blockersFromRun = (run) => (run?.metadata?.errors ?? []).map((e) => ({
  code: e.code, stage: "capture", operation: e.operation, message: e.message, recommendation: e.recommendation ?? null
}));

/**
 * Captures and models exactly one viewport, independently of every other.
 *
 * Nothing here reads or writes state from a sibling viewport's run: a fresh
 * browser is launched and closed inside `captureRegionObservations`, and the
 * pipeline below is a pure function of what that one viewport observed.
 */
async function inspectOneViewport({
  url, viewport, height, outDir, navigationTimeoutMs, driverFactory, sleep, onProgress, interactions = false,
  /* Off unless asked for. It costs a second page load per viewport, and a
   * caller who did not ask for motion should not pay for it. */
  motion = false,
  /* Media enumeration and asset capture. Another page load per viewport. */
  media = false
}) {
  const operation = "inspect-page-viewport";
  const viewportDir = join(outDir, String(viewport));

  const {
    run, settle, observed, diagnostics, visualResults = new Map(), visualCapable = false,
    interactionResults = new Map(), interactionPlan = []
  } = await captureRegionObservations({
    url, viewport, height, navigationTimeoutMs, driverFactory, sleep, onProgress,
    /* Crops live beside the viewport's other artifacts, under its own width, so
     * one viewport's visual evidence can never be read as another's. */
    visualDir: join(viewportDir, "visual"),
    interactions
  });

  /* The capture never reached a settled page at all. Whatever partial
   * diagnostics exist are still written — a refused capture is evidence too —
   * but there is no observation stream to normalize. */
  if (run.blocked || !observed) {
    const status = run.blocked ? STATUS.BLOCKED : STATUS.FAILED;
    const fallbackErrors = run.thrown
      ? [{ code: "capture-threw", message: run.thrown }]
      : errorsOf(run).length ? errorsOf(run)
      : [{ code: "no-observation", message: "The capture session ended without an observation and without a recorded error.", operation: "inspect-page-viewport" }];

    const blockers = run.blocked ? (blockersFromRun(run).length ? blockersFromRun(run) : [{
      code: "capture-blocked", stage: "capture", message: "The capture session was blocked before a page could be observed.", recommendation: null
    }]) : [];

    const result = cliResult({
      operation, status, reference: url, viewport,
      warnings: warningsOf(run),
      blockers,
      errors: run.blocked ? [] : fallbackErrors,
      recoveryHistory: historyOf(run),
      readiness: READINESS.NOT_USABLE,
      readinessReason: "No observation was collected, so nothing downstream may model this viewport.",
      detail: { url, viewport }
    });
    writeArtifact(result, {
      kind: `capture-diagnostics-${viewport}`,
      path: join(viewportDir, "capture-diagnostics.json"),
      content: diagnostics
    });
    result.summary = `${viewport}px produced no observation [${run.metadata.status}]`;
    result.detail.summary = buildViewportSummary({
      viewport, url, status: result.status,
      settle: null, observed: null, shadow: null, captureFacts: {},
      blockers: status === STATUS.FAILED ? fallbackErrors : blockers,
      artifacts: result.artifacts
    });
    return { result, shadow: null };
  }

  /* Facts the capture layer measured about itself, handed to the classifier
   * unchanged. Nothing here infers `authWall`/`antiAutomation`/
   * `interactionGated` — the region survey and settle loop do not detect
   * those yet, so they are recorded `false` rather than guessed, and a future
   * phase that adds that detection has exactly one place to wire it in. */
  const captureFacts = {
    hiddenDominant: settle?.hiddenDominant === true,
    /* The honest "we never saw this page" signal, measured during the scroll
     * rather than at rest. `hiddenDominant` stays reported — at a narrow
     * width it describes responsive design, not a failed capture — and it
     * now travels as a warning rather than as the refusal. */
    hiddenRatio: settle?.hiddenRatio ?? null,
    scrollRevealedNodes: settle?.scrollRevealedNodes ?? 0,
    neverVisibleRatio: settle?.neverVisibleRatio ?? null,
    peakVisibleDuringScroll: settle?.peakVisibleDuringScroll ?? null,
    truncated: observed.stoppedBy !== "plan-complete",
    authWall: false,
    antiAutomation: false,
    interactionGated: false,
    imagesUnresolved: settle?.imagesUnresolved === true
  };

  /* Interaction evidence for this viewport, built from the plan the safety gate
   * produced and the results the probe returned. Built even when discovery was
   * off: the record then says every dimension is unknown, which is the truth. */
  const interactionEvidence = interactionPlan.length
    ? interactionEvidenceFrom({ viewportWidth: viewport, plan: interactionPlan, results: interactionResults })
    : null;

  let shadow = null;
  let pipelineError = null;
  try {
    shadow = buildShadowViewportArtifacts(observed.observations, viewport, {
      height, captureFacts, visualResults, interactionEvidence,
      /* The capability flag says a crop COULD have been taken, not that one was.
       * Deriving it from the result count would relabel every honest refusal —
       * a panel too small to be worth cropping, a surface that cannot be read —
       * as "no capture capability", which is a different finding entirely. */
      canCaptureVisuals: visualCapable
    });
  } catch (err) {
    if (err instanceof ShadowPipelineError) pipelineError = err;
    else throw err;
  }

  const result = cliResult({
    operation,
    status: pipelineError
      ? STATUS.FAILED
      : statusForSupport(shadow.support.supportClass, shadow.support.warnings.length),
    reference: url,
    viewport,
    warnings: [
      ...warningsOf(run),
      ...(shadow?.support?.warnings ?? []).map((message) => ({ code: "support-warning", message }))
    ],
    blockers: !pipelineError && shadow && !producesOutput(shadow.support.supportClass)
      ? [{
          code: shadow.support.supportClass,
          stage: "support-classification",
          message: shadow.support.meaning,
          recommendation: shadow.support.remedy
        }]
      : [],
    errors: pipelineError
      ? [{ code: `shadow-${pipelineError.stage}`, message: pipelineError.message }]
      : [],
    recoveryHistory: historyOf(run),
    readiness: pipelineError ? READINESS.NOT_USABLE
      : producesOutput(shadow.support.supportClass) ? READINESS.USABLE_WITH_LIMITS
      : READINESS.NOT_USABLE,
    readinessReason: pipelineError
      ? "The observation stream did not validate, so no model was built from it."
      : producesOutput(shadow.support.supportClass)
        ? "A page model is evidence about one viewport. What it licenses for building is a later, separate decision."
        : `Classified as ${SUPPORT_DETAIL[shadow.support.supportClass]?.label ?? shadow.support.supportClass}. No model artifact is a substitute for the evidence this names as missing.`,
    detail: { url, viewport, supportClass: shadow?.support?.supportClass ?? null }
  });

  writeArtifact(result, {
    kind: `capture-diagnostics-${viewport}`,
    path: join(viewportDir, "capture-diagnostics.json"),
    content: diagnostics
  });
  writeArtifact(result, {
    kind: `raw-observations-${viewport}`,
    path: join(viewportDir, "raw-observations.json"),
    content: observed
  });

  if (shadow) {
    writeArtifact(result, {
      kind: `normalized-evidence-${viewport}`,
      path: join(viewportDir, "normalized-evidence.json"),
      content: shadow.normalized
    });
    writeArtifact(result, {
      kind: `page-model-${viewport}`,
      path: join(viewportDir, "page-model.json"),
      content: shadow.model
    });
    writeArtifact(result, {
      kind: `support-${viewport}`,
      path: join(viewportDir, "support.json"),
      content: { $supportClassification: "1", viewport, url, ...shadow.support, capture: captureFacts }
    });
  }

  /* The motion pass runs last and in its own session, so a failure here cannot
   * touch anything written above. Its artifact is always written when motion
   * was requested — including when the pass could not look — because the
   * absence of a file and a file saying "could not look" mean different things
   * to every reader downstream. */
  if (motion) {
    const { artifact } = await runMotionPass({
      url, viewport, height, outDir, navigationTimeoutMs, driverFactory, sleep, onProgress
    });
    writeArtifact(result, {
      kind: `motion-observation-${viewport}`,
      path: join(viewportDir, MOTION_ARTIFACT_FILENAME),
      content: artifact
    });
  }

  /* Media runs after settle and in its own context, so a lazily loaded image
   * that has not arrived yet is never mistaken for a missing asset. Like
   * motion, its artifacts are always written when asked for — including when
   * the pass could not look. */
  if (media) {
    const { media: mediaArtifact, canvas } = await runMediaPass({
      url, viewport, height, outDir, navigationTimeoutMs, driverFactory, sleep, onProgress
    });
    writeArtifact(result, {
      kind: `media-observation-${viewport}`,
      path: join(viewportDir, MEDIA_ARTIFACT_FILENAME),
      content: mediaArtifact
    });
    writeArtifact(result, {
      kind: `canvas-observation-${viewport}`,
      path: join(viewportDir, CANVAS_ARTIFACT_FILENAME),
      content: canvas
    });
  }

  result.summary = pipelineError
    ? `${viewport}px: ${pipelineError.message}`
    : `${viewport}px: ${shadow.model.counts.sections} section(s), ${shadow.model.counts.classified} classified — ${shadow.support.supportClass}`;

  result.detail.summary = buildViewportSummary({
    viewport, url, status: result.status,
    settle, observed, shadow: pipelineError ? null : shadow, captureFacts,
    blockers: result.blockers,
    artifacts: result.artifacts
  });

  return { result, shadow: pipelineError ? null : shadow };
}

/**
 * Decides and builds the clone-prompt-or-refusal artifact from every
 * viewport that produced a validated page model, regardless of its support
 * class — `buildClonePrompt` itself decides prompt vs. refusal from the
 * support classes it is handed, exactly as `support.mjs` already decided
 * them; this function's only job is to gather the already-validated
 * `{model, normalized, support}` triples and call it once, across all of
 * them, so responsive comparisons and excluded-viewport reasons are real.
 *
 * A viewport whose CAPTURE failed contributes nothing here — there is no
 * validated model to pass, so it is silently absent from `shadowEntries`,
 * not represented as some default. If NO viewport ever produced a model,
 * generation is not attempted at all: that is a different fact from a
 * viewport that was validly captured, classified, and refused.
 */
export function decideClonePrompt({ url, shadowEntries }) {
  if (!shadowEntries.length) {
    return { output: null, reason: "no viewport produced a validated page model", warnings: [] };
  }
  try {
    const output = buildClonePrompt({ url, viewports: shadowEntries });
    const check = validateClonePrompt(output, shadowEntries);
    if (!check.valid) {
      /* Should not happen if every input was validated upstream — caught
       * defensively so a defect here degrades to a warning and a skipped
       * artifact, never a written file that fails its own contract. */
      return {
        output: null,
        reason: "the generated clone prompt failed its own provenance validation",
        warnings: [{
          code: "clone-prompt-invalid",
          message: `clone-prompt output referenced evidence outside its source models — ${check.problems.map((p) => `${p.where}: ${p.message}`).join("; ")}`
        }]
      };
    }
    return { output, reason: null, warnings: [] };
  } catch (err) {
    if (!(err instanceof ClonePromptError)) throw err;
    return {
      output: null,
      reason: "clone-prompt generation failed",
      warnings: [{ code: `clone-prompt-${err.stage}`, message: err.message }]
    };
  }
}

/**
 * The shadow path's entry point: one URL, every viewport, independently,
 * plus one clone-prompt-or-refusal artifact built from all of them together.
 *
 * Nothing this writes is read by `analyze`/`recreate`, and nothing this reads
 * comes from a project or a fidelity run — the isolation is structural, not a
 * convention a future edit could quietly erode. Every existing per-viewport
 * artifact is written exactly as before; the clone prompt is additive, one
 * more file in the same output directory.
 */
export async function cmdInspectPage({
  url, viewports = DEFAULT_INSPECT_VIEWPORTS, height = 900,
  outDir = null, navigationTimeoutMs = null, driverFactory = null, sleep = null, onProgress = null,
  /* Off unless explicitly asked for — this is the only stage that touches the
   * page, so it is never enabled by inference or by default. */
  interactions = false,
  /* A second page load per viewport, spent looking at what the page does.
   * Without it motion can only ever be reported as unknown. */
  motion = false,
  /* Another page load per viewport, spent on what the page paints WITH:
   * videos, canvases, backgrounds and the question of whether their bytes can
   * be obtained at all. */
  media = false
} = {}) {
  const operation = "inspect-page";

  if (!url) {
    return cliResult({
      operation, status: STATUS.FAILED,
      errors: [{
        code: "missing-argument",
        message: "inspect-page requires a URL, supplied via --experimental-page-model <url>."
      }],
      readiness: READINESS.UNDETERMINED,
      readinessReason: "Nothing was attempted."
    });
  }

  const widths = viewports?.length ? viewports : DEFAULT_INSPECT_VIEWPORTS;
  const resolvedOut = outDir ?? join(process.cwd(), ".bigaap-inspect", slugFor(url));

  const perEntries = [];
  for (const viewport of widths) {
    perEntries.push(await inspectOneViewport({
      url, viewport, height, outDir: resolvedOut, navigationTimeoutMs, driverFactory, sleep, onProgress, interactions, motion, media
    }));
  }
  const per = perEntries.map((e) => e.result);

  /* Widest first, matching `buildClonePrompt`'s own determinism: the caller
   * order must not change the output, and sorting here rather than trusting
   * `widths` means a `--viewports 375,1440` run produces the same clone
   * prompt as `--viewports 1440,375`. */
  const shadowEntries = perEntries
    .filter((e) => e.shadow)
    .map((e) => ({ width: e.result.viewport, model: e.shadow.model, normalized: e.shadow.normalized, support: e.shadow.support }))
    .sort((a, b) => b.width - a.width);

  const blocked = per.filter((r) => r.status === STATUS.BLOCKED);
  const failed = per.filter((r) => r.status === STATUS.FAILED);
  const good = per.filter((r) => r.status === STATUS.COMPLETED || r.status === STATUS.COMPLETED_WITH_WARNINGS);

  const status = good.length === 0
    ? (blocked.length ? STATUS.BLOCKED : STATUS.FAILED)
    : (blocked.length || failed.length ? STATUS.COMPLETED_WITH_WARNINGS : STATUS.COMPLETED);

  /* A clone-prompt build or validation failure is folded in as a warning,
   * never an error — it never changes `status` or the exit code. The
   * per-viewport support classifications already decided what this run is
   * allowed to license; a defect in the strictly-additive prompt step must
   * not be able to turn a completed run into a failed one. */
  const clonePromptDecision = decideClonePrompt({ url, shadowEntries });

  const manifest = {
    $inspectManifest: "1",
    url, capturedAt: new Date().toISOString(),
    viewports: per.map((r) => ({
      viewport: r.viewport,
      status: r.status,
      supportClass: r.detail?.supportClass ?? null,
      artifacts: r.artifacts.map((a) => ({ kind: a.kind, path: a.path, hash: r.hashes[a.kind] ?? null }))
    }))
  };

  const result = cliResult({
    operation, status, reference: url, viewport: null,
    summary: `${good.length}/${widths.length} viewport(s) modelled` + (blocked.length ? `, ${blocked.length} classified without output` : "") + (failed.length ? `, ${failed.length} failed` : ""),
    artifacts: per.flatMap((r) => r.artifacts),
    hashes: Object.assign({}, ...per.map((r) => r.hashes)),
    warnings: [...per.flatMap((r) => r.warnings), ...clonePromptDecision.warnings],
    blockers: good.length === 0 ? per.flatMap((r) => r.blockers) : [],
    errors: good.length === 0 && failed.length ? per.flatMap((r) => r.errors) : [],
    recoveryHistory: per.flatMap((r) => r.recoveryHistory),
    readiness: good.length ? READINESS.USABLE_WITH_LIMITS : READINESS.NOT_USABLE,
    readinessReason: good.length
      ? "Experimental page models — and, where evidence allowed, a clone prompt or refusal — exist for at least one viewport. This licenses no build decision on its own."
      : "No viewport produced a page model.",
    detail: {
      experimental: true,
      viewports: per.map((r) => ({ viewport: r.viewport, status: r.status, supportClass: r.detail?.supportClass ?? null })),
      outDir: resolvedOut
    }
  });

  let clonePromptArtifactKind = null;
  let clonePromptArtifact = null;
  if (clonePromptDecision.output) {
    clonePromptArtifactKind = clonePromptDecision.output.kind === "prompt" ? "clone-prompt" : "clone-prompt-refusal";
    const filename = clonePromptDecision.output.kind === "prompt" ? "clone-prompt.json" : "clone-prompt-refusal.json";
    clonePromptArtifact = writeArtifact(result, {
      kind: clonePromptArtifactKind, path: join(resolvedOut, filename), content: clonePromptDecision.output
    });
  }

  /* Completeness is assessed on the artifact that was actually written, from
   * the same viewport entries the prompt was built from. Assessing the object
   * in memory rather than the written file would be assessing something no
   * builder will ever read. */
  let completeness = null;
  let completenessArtifact = null;
  if (clonePromptDecision.output) {
    completeness = assessPromptCompleteness({
      prompt: clonePromptDecision.output,
      viewports: shadowEntries
    });
    completenessArtifact = writeArtifact(result, {
      kind: "prompt-completeness",
      path: join(resolvedOut, "prompt-completeness.json"),
      content: completeness
    });
    /* An unresolved reference or a viewport leak is a correctness failure in
     * the artifact, not a gap in the page. It is surfaced as a warning here
     * rather than swallowed, so a caller reading only the result sees it. */
    for (const problem of completeness.blockingProblems) {
      result.warnings.push({ code: problem.code, message: problem.message });
    }
  }

  manifest.promptCompleteness = completeness
    ? {
        buildable: completeness.buildable,
        summary: completeness.summary,
        fabricatedReferences: completeness.fabricatedReferences,
        viewportsSeparated: completeness.viewportSeparation.separated,
        artifact: completenessArtifact
          ? { kind: "prompt-completeness", path: completenessArtifact.path, hash: completenessArtifact.hash }
          : null
      }
    : { kind: "not-attempted", reason: clonePromptDecision.reason };

  manifest.clonePrompt = clonePromptDecision.output
    ? {
        kind: clonePromptDecision.output.kind,
        supportClass: clonePromptDecision.output.kind === "prompt" ? clonePromptDecision.output.supportClass : null,
        excludedViewports: clonePromptDecision.output.kind === "prompt"
          ? clonePromptDecision.output.excludedViewports.map((v) => ({ width: v.width, supportClass: v.supportClass }))
          : clonePromptDecision.output.viewports.map((v) => ({ width: v.width, supportClass: v.supportClass })),
        artifact: clonePromptArtifact ? { kind: clonePromptArtifactKind, path: clonePromptArtifact.path, hash: clonePromptArtifact.hash } : null
      }
    : { kind: "not-attempted", reason: clonePromptDecision.reason };

  const manifestArtifact = writeArtifact(result, { kind: "inspect-manifest", path: join(resolvedOut, "manifest.json"), content: manifest });

  /* The terminal report and the `--json` `detail.summary` are built from the
   * exact same summary objects — one call, two presentations of one fact
   * set. Nothing here re-derives a count from a different source. */
  const viewportSummaries = per.map((r) => r.detail.summary);
  const clonePromptSummary = buildClonePromptSummary(
    clonePromptDecision.output,
    clonePromptArtifact ? { kind: clonePromptArtifactKind, path: clonePromptArtifact.path } : null,
    clonePromptDecision.reason
  );
  /* Every input the terminal report is built from lives HERE, in the summary
   * `--json` exposes. That is the invariant the browser smoke asserts: the
   * report can be re-rendered from the JSON byte-for-byte. A field kept beside
   * the summary rather than inside it would silently break that. */
  result.detail.summary = {
    viewports: viewportSummaries, clonePrompt: clonePromptSummary,
    completeness,
    outDir: resolvedOut, manifestPath: manifestArtifact.path
  };
  result.detail.statusText = renderInspectReport(
    { status: result.status, url, summary: result.summary },
    viewportSummaries,
    manifestArtifact.path,
    clonePromptSummary,
    completeness
  );

  return result;
}

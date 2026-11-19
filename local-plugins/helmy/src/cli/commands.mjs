/**
 * The fidelity CLI commands.
 *
 * Every one of these goes through the shared capture session, returns the typed
 * result contract, and preserves the capture metadata, the artifact hashes and
 * the attempt history on the way out. A command that skipped any of those would
 * be a second capture path with no recovery policy behind it, which is the
 * thing Phase 4.7 removed.
 *
 * Commands read their inputs back off disk rather than from each other. The CLI
 * is several processes; a command that relied on state its predecessor happened
 * to hold in memory would work only when run as a script.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { runPipeline } from "../pipeline.mjs";
import { captureExtraction } from "../capture/extraction.mjs";
import { withCaptureSession, stalenessRecord, CAPTURE_CONTRACT_VERSION, EXTRACTOR_VERSION, TOLERANCE_VERSION } from "../capture/session.mjs";
import { CHECKS, READ_STATE, IS_VISIBLE } from "../capture/probes.mjs";
import { resolveTapTargetPolicy, policySummary } from "../policy/tap-target.mjs";
import { PlaywrightDriver } from "../driver/playwright-driver.mjs";
import { runViewport } from "../fidelity/viewport-run.mjs";
import { FidelityHistory, shortHash } from "../fidelity/history.mjs";
import { stateObservation } from "../fidelity/states.mjs";
import { CONTENT_MODE } from "../fidelity/content-mode.mjs";
import { verifyFreshness, VERDICT } from "../fidelity/staleness.mjs";
import { TOLERANCES } from "../fidelity/compare.mjs";
import { RunStore } from "./run-store.mjs";
import { readinessReport } from "./readiness.mjs";
import { buildReadinessModel } from "./readiness-model.mjs";
import { workspaceContext, recoveryAttempts } from "./context.mjs";
import { readinessEvaluated, recoveryAttempted } from "../observe/record.mjs";
import {
  cliResult, STATUS, READINESS, statusFromCapture, blockersFromCapture, writeArtifact, sha256
} from "./result.mjs";

const DEFAULT_VIEWPORTS = [1440, 1024, 768, 375];

/** Attempt history, trimmed to what a reader of a CLI result needs. */
const historyOf = (run) => (run?.metadata?.attemptHistory ?? []).map((a) => ({
  name: a.name, attemptIndex: a.attemptIndex, status: a.status,
  errorCode: a.errorCode, durationMs: a.durationMs
}));

const warningsOf = (run) => (run?.metadata?.warnings ?? []).map((w) => ({ code: w.operation, message: w.note }));
const errorsOf = (run) => (run?.metadata?.errors ?? []).map((e) => ({
  code: e.code, operation: e.operation, message: e.message, recommendation: e.recommendation ?? null
}));

/**
 * The fidelity run store, or a result explaining its absence.
 *
 * `readinessModel` rides along on the absence result. A command asked about a
 * workspace should still describe that workspace even when no fidelity SESSION
 * exists — the two are different things, and answering "no session" while
 * having a whole analysed workspace in hand is a refusal to look at what the
 * user pointed at.
 */
const requireStore = (root, operation, { workspace = null } = {}) => {
  const store = new RunStore(root);
  if (!store.session()) {
    const context = workspaceContext(workspace);
    return {
      store: null,
      result: cliResult({
        operation, status: STATUS.NOT_ATTEMPTED,
        mode: context.mode,
        summary: context.present
          ? `no capture session at ${root}; reporting on the workspace instead`
          : `no capture session at ${root}`,
        blockers: [], errors: [],
        warnings: [{ code: "no-session", message: `Run \`helmy session --run ${root} --reference <url> --target <url>\` first. A command that invented a session would be reporting on work that never happened.` }],
        readiness: READINESS.UNDETERMINED,
        readinessReason: "There is no fidelity run to judge. A comparison needs a reference and a target; a workspace holds one side.",
        detail: context.present
          ? {
              readinessModel: buildReadinessModel({
                command: operation,
                status: context.runStatus ?? STATUS.NOT_ATTEMPTED,
                mode: context.mode,
                sourceKind: context.sourceKind,
                workspace,
                ir: context.ir,
                modeEvaluation: context.modeEvaluation,
                blockers: context.runBlockers,
                lint: context.lint,
                files: context.files,
                current: context.current,
                defects: context.defects,
                staleArtifacts: context.staleArtifacts,
                recoveryHistory: reportRecoveryAttempts(workspace),
                browserLaunched: false,
                captureAttempted: false
              })
            }
          : {}
      })
    };
  }
  return { store, result: null };
};

/* ------------------------------------------------------------- 1. session */

export function cmdSession({ root, referenceUrl, targetUrl, viewports, tapPolicy }) {
  const operation = "session";
  if (!referenceUrl) {
    return cliResult({
      operation, status: STATUS.FAILED,
      errors: [{ code: "missing-argument", message: "session requires --reference <url>" }],
      readiness: READINESS.UNDETERMINED
    });
  }

  const policy = resolveTapTargetPolicy(tapPolicy);
  const driver = new PlaywrightDriver();
  const session = {
    sessionVersion: "1",
    startedAt: new Date().toISOString(),
    reference: { url: referenceUrl, slug: "reference" },
    target: targetUrl ? { url: targetUrl, slug: "target" } : null,
    viewports: viewports?.length ? viewports : DEFAULT_VIEWPORTS,
    contractVersion: CAPTURE_CONTRACT_VERSION,
    extractorVersion: EXTRACTOR_VERSION,
    toleranceVersion: TOLERANCE_VERSION,
    tapTargetPolicy: policySummary(policy),
    driverName: driver.name,
    driverVersion: driver.version,
    /* Recorded on the session rather than asserted at use, so an artifact from
     * this run carries the fact that nothing here was validated. */
    tolerancesValidated: TOLERANCES.$validated === true,
    authenticatedCapture: false
  };

  const store = RunStore.create(root, session);
  const result = cliResult({
    operation, status: STATUS.COMPLETED,
    reference: referenceUrl, target: targetUrl ?? null,
    mode: null,
    summary: `session ready at ${root} · driver ${driver.name}@${driver.version} · tap policy ${policy.policyName} (${policy.minimumTapTargetPx}px)`,
    hashes: { session: sha256(JSON.stringify(session, null, 2) + "\n") },
    artifacts: [{ kind: "session", path: store.path("session.json"), bytes: null }],
    readiness: READINESS.USABLE,
    readinessReason: "A session records what will be captured and with what versions. It licenses nothing on its own.",
    detail: { viewports: session.viewports, tolerancesValidated: session.tolerancesValidated }
  });
  store.saveResult(result);
  return result;
}

/* -------------------------------------------- 2/3/4. extraction captures */

/**
 * One extraction capture into a run, for either side.
 *
 * `reference` additionally derives and pins the IR, because everything
 * downstream compares against a pinned reference and a reference that moved
 * mid-run is the failure `lockReference` exists to catch.
 */
async function captureSide({ root, side, viewport, operation, analyze, navigationTimeoutMs = null }) {
  const { store, result: missing } = requireStore(root, operation);
  if (missing) return missing;

  const session = store.session();
  const spec = side === "reference" ? session.reference : session.target;
  if (!spec?.url) {
    return cliResult({
      operation, status: STATUS.NOT_ATTEMPTED, viewport,
      warnings: [{ code: "no-target", message: `The session declares no ${side} URL, so there is nothing to capture.` }],
      readiness: READINESS.UNDETERMINED, readinessReason: `No ${side} was declared.`
    });
  }

  const { run, raw, probe, diagnostics } = await captureExtraction({
    url: spec.url, viewport, settleMs: 400,
    /* A stabilised screenshot is taken after the style read, so the
     * equivalent-content gate has an artifact whose `animationsFrozen` is
     * actually true of the pixels it would compare — rather than reading the
     * extraction's honest `false` and refusing on the wrong evidence. */
    screenshotPath: store.path(side, `screenshot-${viewport}.png`),
    ...(navigationTimeoutMs ? { navigationTimeoutMs } : {})
  });
  const status = raw ? statusFromCapture(run) : (run.blocked ? STATUS.BLOCKED : STATUS.FAILED);

  const result = cliResult({
    operation,
    status,
    reference: session.reference?.url ?? null,
    target: session.target?.url ?? null,
    viewport,
    state: "default",
    mode: null,
    warnings: warningsOf(run),
    blockers: blockersFromCapture(run),
    errors: run.blocked ? [] : errorsOf(run),
    recoveryHistory: historyOf(run),
    readiness: raw ? READINESS.USABLE_WITH_LIMITS : READINESS.NOT_USABLE,
    readinessReason: raw
      ? "A capture is evidence about one render at one width. What it licenses is decided by the gates, not here."
      : "No extraction was produced, so nothing downstream may use this viewport.",
    detail: { side, url: spec.url, captureStatus: run.metadata.status, attempts: run.metadata.attemptCount }
  });

  /* The diagnostics are written whatever happened: a capture that failed still
   * produced an attempt history, and that history is the evidence about why. */
  writeArtifact(result, { kind: `${side}-capture-${viewport}`, path: store.path(side, `capture-${viewport}.json`), content: diagnostics });

  if (raw) {
    writeArtifact(result, { kind: `${side}-raw-${viewport}`, path: store.path(side, "raw", `extract-${viewport}.json`), content: raw });
    if (probe) writeArtifact(result, { kind: `${side}-probe-${viewport}`, path: store.path(side, "raw", `probe-${viewport}.json`), content: probe });

    if (analyze) {
      const pipeline = runPipeline({
        raw, probe,
        meta: { slug: `${side}-${viewport}`, source: { kind: "url", value: spec.url }, tier: "driver" },
        config: { request: { mode: "analyze" } }
      });
      writeArtifact(result, { kind: `${side}-ir-${viewport}`, path: store.path(side, `ir-${viewport}.json`), content: pipeline.ir });
      result.detail.irHash = shortHash(pipeline.ir);
      result.detail.confidence = pipeline.ir.confidence?.overall ?? null;
      result.detail.contentReached = pipeline.ir.coverage?.contentReached ?? null;

      if (side === "reference") {
        const history = new FidelityHistory(store.root);
        const lock = history.lockReference(pipeline.ir, { slug: `reference-${viewport}` });
        if (!lock.ok) {
          result.status = STATUS.BLOCKED;
          result.exitCode = 3;
          result.blockers.push({ code: "reference-moved", stage: "reference-lock", message: lock.reason, recommendation: "Start a new run rather than comparing against a moved reference." });
          result.readiness = READINESS.NOT_USABLE;
        }
        result.detail.referenceLocked = lock.ok;
      }
    }
  }

  result.summary = raw
    ? `${side} @ ${viewport}px · ${raw.coverage.nodesSampled}/${raw.coverage.nodesTotal} nodes · ${run.metadata.attemptCount} attempt(s)`
    : `${side} @ ${viewport}px produced no extraction [${run.metadata.status}]`;

  store.saveResult(result);
  return result;
}

export const cmdReference = ({ root, viewport = 1440, navigationTimeoutMs = null }) =>
  captureSide({ root, side: "reference", viewport, operation: "reference", analyze: true, navigationTimeoutMs });

export const cmdCaptureViewport = ({ root, viewport = 1440, navigationTimeoutMs = null }) =>
  captureSide({ root, side: "target", viewport, operation: "capture-viewport", analyze: true, navigationTimeoutMs });

/** Captures the target at every viewport the session declared. */
export async function cmdCapture({ root, viewports = null, navigationTimeoutMs = null }) {
  const operation = "capture";
  const { store, result: missing } = requireStore(root, operation);
  if (missing) return missing;

  const session = store.session();
  const widths = viewports?.length ? viewports : session.viewports;
  const per = [];
  for (const width of widths) {
    per.push(await captureSide({ root, side: "target", viewport: width, operation: "capture-viewport", analyze: true, navigationTimeoutMs }));
  }

  /* One blocked viewport does not cancel the others — the recovery policy says
   * `otherViewportsMayContinue`, and a roll-up that reported the whole run as
   * blocked would be discarding the viewports that succeeded. */
  const blocked = per.filter((r) => r.status === STATUS.BLOCKED);
  const failed = per.filter((r) => r.status === STATUS.FAILED);
  const good = per.filter((r) => r.status === STATUS.COMPLETED || r.status === STATUS.COMPLETED_WITH_WARNINGS);
  const notAttempted = per.filter((r) => r.status === STATUS.NOT_ATTEMPTED);

  /* A viewport that was never attempted is not a failure, and rolling it up as
   * one destroyed the only useful thing about it.
   *
   * `session --reference <url>` declares a reference and leaves `target` null.
   * `capture` captures the TARGET, so every viewport returned `not-attempted`
   * with a `no-target` warning naming the remedy — and this roll-up saw zero
   * good and zero blocked, concluded `failed`, and emitted no errors, at which
   * point `cliResult` refused to build a failure with nothing in it. The user
   * saw `command-threw: capture returned failed with no error recorded`: the
   * least informative outcome available, in place of a warning that said
   * exactly what was missing.
   *
   * `requires-user-input` is the honest status: nothing broke, and no capture
   * can happen until a target is declared. */
  const status = good.length === 0
    ? (blocked.length ? STATUS.BLOCKED
      : failed.length ? STATUS.FAILED
      : notAttempted.length ? STATUS.REQUIRES_USER_INPUT
      : STATUS.FAILED)
    : (blocked.length || failed.length ? STATUS.COMPLETED_WITH_WARNINGS : STATUS.COMPLETED);

  /* Whatever the roll-up decides, a non-success must carry something a reader
   * can act on. Anything reaching here with an empty contract is a bug in this
   * function, not a condition of the run. */
  const rolledUpWarnings = notAttempted.flatMap((r) => r.warnings ?? []);

  const result = cliResult({
    operation, status,
    reference: session.reference?.url ?? null,
    target: session.target?.url ?? null,
    viewport: null,
    summary: status === STATUS.REQUIRES_USER_INPUT
      ? `no viewport was attempted: ${rolledUpWarnings[0]?.message ?? "the session declares no target"}`
      : `${good.length}/${widths.length} viewport(s) captured` + (blocked.length ? `, ${blocked.length} blocked` : ""),
    artifacts: per.flatMap((r) => r.artifacts),
    hashes: Object.assign({}, ...per.map((r) => r.hashes)),
    warnings: [
      ...per.flatMap((r) => r.warnings),
      ...(blocked.length && good.length
        ? [{ code: "partial-viewports", message: `${blocked.map((r) => r.viewport + "px").join(", ")} blocked; the remaining viewports are complete and are not averaged with them.` }]
        : [])
    ],
    /* Named so the reader knows which input is missing and how to supply it.
     * `requires-user-input` without an action is refused at construction, and
     * rightly: it would be a dead end the user could not even guess at. */
    userActions: status === STATUS.REQUIRES_USER_INPUT
      ? [{
          what: "Declare a target URL for the capture session.",
          how: `helmy session --run ${root} --reference <reference-url> --target <target-url>`
        }]
      : [],
    blockers: good.length === 0 ? per.flatMap((r) => r.blockers) : [],
    errors: good.length === 0 && !blocked.length ? per.flatMap((r) => r.errors) : [],
    recoveryHistory: per.flatMap((r) => r.recoveryHistory),
    readiness: good.length ? READINESS.USABLE_WITH_LIMITS
      : status === STATUS.REQUIRES_USER_INPUT ? READINESS.UNDETERMINED
      : READINESS.NOT_USABLE,
    readinessReason: good.length
      ? "Captured viewports may be compared. Blocked viewports produce no score, rather than a low one."
      : status === STATUS.REQUIRES_USER_INPUT
        ? "Nothing was attempted, so nothing succeeded and nothing failed. Supply the missing input and re-run."
        : "No viewport captured.",
    detail: {
      viewports: per.map((r) => ({ viewport: r.viewport, status: r.status, irHash: r.detail?.irHash ?? null })),
      blockedViewports: blocked.map((r) => r.viewport),
      partial: blocked.length > 0 && good.length > 0
    }
  });
  store.saveResult(result);
  return result;
}

/* ------------------------------------------------------ 5. capture-state */

export async function cmdCaptureState({ root, viewport = 1440, state = "hover", selector, side = "target" }) {
  const operation = "capture-state";
  const { store, result: missing } = requireStore(root, operation);
  if (missing) return missing;

  const session = store.session();
  const spec = side === "reference" ? session.reference : session.target;
  if (!spec?.url || !selector) {
    return cliResult({
      operation, status: STATUS.NOT_ATTEMPTED, viewport, state,
      warnings: [{ code: "missing-argument", message: "capture-state requires --selector, and a declared URL for the side being captured." }],
      readiness: READINESS.UNDETERMINED, readinessReason: "Nothing was captured."
    });
  }

  const run = await withCaptureSession({
    url: spec.url, viewport, state, sourceKind: "url", captureMode: "state-capture"
  }, async (s) => {
    const exists = await s.evaluate("selector-exists", (sel) => !!document.querySelector(sel), selector);
    if (exists.status !== "completed" || exists.result.value !== true) {
      return { state, selector, available: false, reason: "selector-not-found" };
    }
    const rest = await s.evaluate("read-at-rest", READ_STATE, selector);
    const atRest = rest.status === "completed" ? rest.result.value : null;

    if (!["hover", "focus", "active"].includes(state)) {
      return { state, selector, available: false, reason: "no-induction-declared", atRest };
    }
    const triggered = await s.triggerState({ state, selector });
    if (triggered.status !== "completed") {
      return { state, selector, available: false, reason: triggered.result?.errorCode ?? "state-trigger-failed", atRest };
    }
    const held = await s.evaluate("read-held", READ_STATE, selector);
    if (held.status !== "completed" || !atRest) {
      return { state, selector, available: false, reason: "induction-timed-out", atRest };
    }
    const properties = held.result.value;
    return {
      state, selector, available: true, properties, atRest,
      changedFromDefault: Object.keys(properties).some((k) => String(properties[k]) !== String(atRest[k]))
    };
  });

  /* A state that could not be induced is `unavailable` with its reason. It is
   * never a mismatch, and the run is not `failed` for it: the capture worked,
   * and what it found is that the state is not observable here. */
  const record = run.value ?? { state, selector, available: false, reason: run.metadata.errors[0]?.code ?? "unknown-driver-error" };
  record.viewport = viewport;
  record.url = spec.url;
  record.side = side;
  record.capture = run.metadata;

  const result = cliResult({
    operation,
    status: run.blocked ? STATUS.BLOCKED : statusFromCapture(run),
    reference: session.reference?.url ?? null,
    target: session.target?.url ?? null,
    viewport, state,
    warnings: warningsOf(run),
    blockers: blockersFromCapture(run),
    errors: run.blocked ? [] : errorsOf(run),
    recoveryHistory: historyOf(run),
    summary: record.available
      ? `${state} on \`${selector}\` induced; changed from rest: ${record.changedFromDefault}`
      : `${state} on \`${selector}\` unavailable: ${record.reason}`,
    readiness: record.available ? READINESS.USABLE_WITH_LIMITS : READINESS.UNDETERMINED,
    readinessReason: record.available
      ? "A state observed on one side is half the evidence; comparison needs both."
      : "The state could not be induced, so it stays unknown rather than being reported as absent by design.",
    detail: { available: record.available, reason: record.reason ?? null, changedFromDefault: record.changedFromDefault ?? null }
  });

  writeArtifact(result, {
    kind: `state-${state}-${viewport}`,
    path: store.path("target", "states", `${side}-${state}-${viewport}.json`),
    content: record
  });
  store.saveResult(result);
  return result;
}

/* --------------------------------------------------------- 6. intrinsic */

export async function cmdIntrinsic({ root, viewport = 1440, side = "target", state = "default" }) {
  const operation = "intrinsic";
  const { store, result: missing } = requireStore(root, operation);
  if (missing) return missing;

  const session = store.session();
  const spec = side === "reference" ? session.reference : session.target;
  if (!spec?.url) {
    return cliResult({
      operation, status: STATUS.NOT_ATTEMPTED, viewport,
      warnings: [{ code: "no-target", message: `The session declares no ${side} URL.` }],
      readiness: READINESS.UNDETERMINED, readinessReason: "Nothing was checked."
    });
  }

  const run = await withCaptureSession({
    url: spec.url, viewport, state, sourceKind: "url", captureMode: "intrinsic-checks",
    tapTargetPolicy: session.tapTargetPolicy?.policyName ?? null
  }, async (s) => {
    const outcome = await s.evaluate("intrinsic-checks", CHECKS, { tapMinimum: s.policy.minimumTapTargetPx });
    return outcome.status === "completed" ? outcome.result.value : null;
  });

  const checks = run.value ?? { findings: [], allSelectors: [], checkedElements: 0 };
  checks.url = spec.url;
  checks.viewport = viewport;
  checks.state = state;
  checks.tapTargetPolicy = run.metadata.tapTargetPolicy;
  checks.tapMinimum = run.metadata.tapTargetPolicy.minimumTapTargetPx;
  checks.capture = run.metadata;
  checks.$note = "Single-render facts. Whether a finding is a DEFECT depends on correlation against the reference and on declared intent, and neither is decided here.";

  const result = cliResult({
    operation,
    status: run.blocked ? STATUS.BLOCKED : (run.value ? statusFromCapture(run) : STATUS.FAILED),
    reference: session.reference?.url ?? null,
    target: session.target?.url ?? null,
    viewport, state,
    warnings: warningsOf(run),
    blockers: blockersFromCapture(run),
    errors: run.blocked ? [] : errorsOf(run),
    recoveryHistory: historyOf(run),
    summary: `${checks.findings.length} finding(s) over ${checks.checkedElements} element(s) · tap policy ${checks.tapTargetPolicy.policyName} (${checks.tapMinimum}px)`,
    readiness: run.value ? READINESS.USABLE_WITH_LIMITS : READINESS.NOT_USABLE,
    readinessReason: run.value
      ? "Intrinsic findings hold on this render alone. Correlation against the reference decides which are defects."
      : "No checks ran.",
    detail: {
      side, findings: checks.findings.length, checkedElements: checks.checkedElements,
      tapTargetPolicy: checks.tapTargetPolicy.policyName,
      byCheck: checks.findings.reduce((m, f) => { m[f.check] = (m[f.check] ?? 0) + 1; return m; }, {})
    }
  });

  writeArtifact(result, {
    kind: `intrinsic-${side}-${viewport}`,
    path: store.path(side, `intrinsic-${viewport}.json`),
    content: checks
  });
  store.saveResult(result);
  return result;
}

/* ----------------------------------------------------------- 7. compare */

export function cmdCompare({ root, viewport = 1440, contentMode = CONTENT_MODE.INDEPENDENT, declaredRelationship = null }) {
  const operation = "compare";
  const { store, result: missing } = requireStore(root, operation);
  if (missing) return missing;

  const session = store.session();
  const referenceIR = store.ir("reference", viewport);
  const referenceRaw = store.raw("reference", viewport);
  const targetRaw = store.raw("target", viewport);

  if (!referenceIR || !referenceRaw) {
    const r = cliResult({
      operation, status: STATUS.NOT_ATTEMPTED, viewport,
      reference: session.reference?.url ?? null, target: session.target?.url ?? null,
      warnings: [{ code: "no-reference", message: `No reference IR at ${viewport}px. Run \`helmy reference --viewport ${viewport}\` first.` }],
      readiness: READINESS.UNDETERMINED,
      readinessReason: "There is nothing to compare against, which is not the same as a comparison that found nothing."
    });
    store.saveResult(r);
    return r;
  }
  if (!targetRaw) {
    const r = cliResult({
      operation, status: STATUS.NOT_ATTEMPTED, viewport,
      reference: session.reference?.url ?? null, target: session.target?.url ?? null,
      warnings: [{ code: "no-target-capture", message: `No target capture at ${viewport}px. The reference evidence is untouched and remains valid.` }],
      readiness: READINESS.UNDETERMINED,
      readinessReason: "A missing target produces no score for the pair, rather than a score of zero."
    });
    store.saveResult(r);
    return r;
  }

  const refDiag = store.capture("reference", viewport);
  const tgtDiag = store.capture("target", viewport);
  const refCapture = refDiag?.capture ?? null;
  const tgtCapture = tgtDiag?.capture ?? null;

  /* `animationsFrozen` is read off the SCREENSHOT, not off the extraction.
   * The extraction is deliberately unfrozen so it can read transition values
   * (def_0032); the screenshot is frozen because that is what a pixel
   * comparison needs. Reading the extraction's flag here would refuse
   * equivalent-content on evidence about the wrong artifact. */
  const metaFor = (diag) => {
    const c = diag?.capture ?? null;
    return {
      viewportWidth: c?.viewport ?? viewport,
      viewportHeight: c?.viewportHeight ?? 900,
      devicePixelRatio: c?.devicePixelRatio ?? 1,
      fontsReady: c?.readiness?.fontsReady ?? false,
      networkIdle: c?.readiness?.networkIdle ?? false,
      animationsFrozen: diag?.screenshot?.animationsFrozen === true,
      failedRequests: c?.readiness?.failedRequests ?? []
    };
  };

  const stateRecords = store.states(viewport);
  const byState = new Map();
  for (const rec of stateRecords) {
    const entry = byState.get(rec.state) ?? {};
    entry[rec.side === "reference" ? "reference" : "target"] = stateObservation({
      state: rec.state, available: rec.available, reason: rec.reason,
      properties: rec.properties, atRest: rec.atRest, selector: rec.selector,
      changedFromDefault: rec.changedFromDefault
    });
    byState.set(rec.state, entry);
  }
  const states = [...byState.entries()]
    .filter(([, v]) => v.reference && v.target)
    .map(([state, v]) => ({ state, reference: v.reference, target: v.target }));

  const run = runViewport({
    viewport,
    referenceIR, referenceRaw,
    referenceSlug: `reference-${viewport}`,
    referenceCaptureMeta: metaFor(refDiag),
    target: {
      raw: targetRaw,
      probe: store.probe("target", viewport),
      slug: `target-${viewport}`,
      captureMeta: metaFor(tgtDiag)
    },
    contentMode: {
      requested: contentMode,
      declaredEquivalent: contentMode === CONTENT_MODE.EQUIVALENT,
      declaredRelationship
    },
    states,
    targetVisualChecks: store.readJSON("target", `intrinsic-${viewport}.json`),
    referenceVisualChecks: store.readJSON("reference", `intrinsic-${viewport}.json`),
    pixelClusters: null
  });

  const blocked = !!run.blocked;
  const history = new FidelityHistory(store.root);
  const n = history.nextIteration();
  const written = history.write(n, {
    targetRaw,
    targetProbe: store.probe("target", viewport),
    targetIR: run.targetIR ?? null,
    captureMeta: tgtCapture,
    comparison: blocked ? null : { differences: run.differences, contentMode: run.contentMode, componentIdentity: run.componentIdentity },
    categories: blocked ? null : run.categories,
    tasks: blocked ? null : run.tasks,
    pixel: blocked ? null : run.pixel,
    decisions: { readiness: run.readiness, readinessReason: run.readinessReason, thresholdsValidated: false },
    blocked: run.blocked ?? null,
    referenceIrHash: shortHash(referenceIR)
  });

  const result = cliResult({
    operation,
    status: blocked ? STATUS.BLOCKED : (run.categories.some((c) => c.score === null) ? STATUS.COMPLETED_WITH_WARNINGS : STATUS.COMPLETED),
    reference: session.reference?.url ?? null,
    target: session.target?.url ?? null,
    viewport,
    mode: blocked ? null : run.contentMode.mode,
    blockers: blocked
      ? run.blocked.failedGates.map((g) => ({
          code: g.gate, stage: run.blocked.stage, message: g.measured,
          recommendation: g.remedy ?? "The gate refused this comparison; the evidence it protects is intact."
        }))
      : [],
    warnings: blocked ? [] : run.categories.filter((c) => c.score === null).map((c) => ({
      code: "no-evidence", message: `${c.category} scored null: there is no evidence for it, which is not a score of zero.`
    })),
    errors: [],
    hashes: written.stamp.files,
    artifacts: Object.keys(written.stamp.files).map((rel) => ({ kind: rel, path: join(written.dir, rel), bytes: null })),
    readiness: blocked ? READINESS.NOT_USABLE : (run.readiness === "usable" ? READINESS.USABLE_WITH_LIMITS : READINESS.NOT_USABLE),
    readinessReason: blocked
      ? `Refused at the ${run.blocked.stage} gate; targetStarted=${run.targetStarted}. No implementation prompt is emitted from a blocked comparison.`
      : `${run.readinessReason} No threshold is validated, so a score is a measurement rather than a verdict.`,
    summary: blocked
      ? `blocked at ${run.blocked.stage} · ${run.blocked.failedGates.length} gate(s) failed · iteration ${n}`
      : `iteration ${n} · mode ${run.contentMode.mode} · ${run.categories.filter((c) => c.score !== null).length}/${run.categories.length} categories scored · ${run.tasks.length} task(s)`,
    detail: {
      iteration: n,
      targetStarted: run.targetStarted,
      compositeScore: null,
      thresholdsValidated: false,
      comparativePixelAllowed: blocked ? null : run.contentMode.comparativePixelAllowed,
      categories: blocked ? null : run.categories.map((c) => ({ category: c.category, score: c.score, coverage: c.evidenceCoverage, mismatches: c.mismatchCount })),
      taskCount: blocked ? 0 : run.tasks.length,
      promptsEmitted: !blocked
    }
  });
  store.saveResult(result);
  return result;
}

/* ----------------------------------------------------------- 8. history */

export function cmdHistory({ root, workspace = null } = {}) {
  /* The same presentation model every readiness-family command carries, so a
   * fact reported here reads identically wherever else it appears. */
  const context = workspaceContext(workspace);
  const readinessModel = buildReadinessModel({
    command: "history",
    status: context.runStatus ?? STATUS.NOT_ATTEMPTED,
    blockers: context.runBlockers,
    mode: context.mode,
    sourceKind: context.sourceKind,
    workspace,
    ir: context.ir,
    modeEvaluation: context.modeEvaluation,
    lint: context.lint,
    files: context.files,
    current: context.current,
    defects: context.defects,
    staleArtifacts: context.staleArtifacts,
    recoveryHistory: [],
    browserLaunched: false,
    captureAttempted: false
  });

  const operation = "history";
  const { store, result: missing } = requireStore(root, operation, { workspace });
  if (missing) return missing;

  const index = store.readJSON("history.json") ?? { iterations: [] };
  const history = new FidelityHistory(store.root);
  const iterations = index.iterations.map((entry) => {
    const verified = history.verify(entry.iteration);
    return { ...entry, hashesVerified: verified.ok, drift: verified.drift ?? [] };
  });

  const drifted = iterations.filter((i) => !i.hashesVerified);
  const result = cliResult({
    operation,
    status: iterations.length === 0
      ? STATUS.NOT_ATTEMPTED
      : (drifted.length ? STATUS.COMPLETED_WITH_WARNINGS : STATUS.COMPLETED),
    reference: store.session().reference?.url ?? null,
    target: store.session().target?.url ?? null,
    warnings: [
      ...(iterations.length === 0 ? [{ code: "no-iterations", message: "No comparison has been run in this workspace." }] : []),
      ...drifted.map((i) => ({ code: "hash-drift", message: `iteration ${i.iteration} no longer matches its recorded hashes` }))
    ],
    summary: `${iterations.length} iteration(s)` + (drifted.length ? `, ${drifted.length} with hash drift` : ""),
    readiness: drifted.length ? READINESS.NOT_USABLE : (iterations.length ? READINESS.USABLE : READINESS.UNDETERMINED),
    readinessReason: drifted.length
      ? "An iteration whose files no longer match their hashes is not evidence about the run that produced it."
      : "History is append-only; an existing iteration directory is never reused.",
    detail: { iterations, readinessModel }
  });
  store.saveResult(result);
  return result;
}

/* ---------------------------------------------------------- 9. recovery */

/**
 * Reads the recovery attempts and records each one.
 *
 * Recorded here rather than at capture time because the attempt history is
 * written to the capture contract by the driver, and reading it back is the
 * first moment the CLI sees it. Each attempt carries a typed error CATEGORY,
 * never the driver's message — a driver error routinely quotes the selector it
 * was looking for.
 */
function reportRecoveryAttempts(workspace) {
  const attempts = recoveryAttempts(workspace);
  for (const attempt of attempts) {
    recoveryAttempted(workspace, {
      command: "recovery",
      operation: attempt.operation,
      attempt: attempt.attempt,
      status: attempt.status,
      errorCategory: attempt.errorCategory,
      retryCount: attempt.retryCount,
      durationMs: attempt.durationMs,
      viewport: attempt.viewport,
      state: attempt.state
    });
  }
  return attempts;
}

export function cmdRecovery({ root, workspace = null } = {}) {
  const context = workspaceContext(workspace);

  const operation = "recovery";
  const { store, result: missing } = requireStore(root, operation, { workspace });
  if (missing) return missing;

  const captures = store.captures();
  const attempts = captures.flatMap(({ file, contract }) =>
    (contract.attemptHistory ?? []).map((a) => ({ file, ...a })));
  const failed = attempts.filter((a) => a.status === "failed");
  const recovered = failed.filter((f) =>
    attempts.some((a) => a.name === f.name && a.status === "ok" && a.attemptIndex > f.attemptIndex));

  const status = captures.length === 0
    ? STATUS.NOT_ATTEMPTED
    : (failed.length ? STATUS.COMPLETED_WITH_WARNINGS : STATUS.COMPLETED);

  /* Built AFTER the captures are read, from what they say.
   *
   * It used to be built first, with `status` taken from the analysis workspace
   * (absent here, so `not-attempted`) and `captureAttempted` hardcoded false.
   * The result contract was correct — 4 attempts across 1 capture, 2 failed,
   * `unknown-driver-error` twice — while the human rendering of that same
   * result read "This run was not attempted: there was nothing to do" and
   * "capture attempted: false". A reader was told the opposite of the record
   * they were looking at. */
  const readinessModel = buildReadinessModel({
    command: "recovery",
    status,
    blockers: context.runBlockers,
    mode: context.mode,
    sourceKind: context.sourceKind,
    workspace,
    ir: context.ir,
    modeEvaluation: context.modeEvaluation,
    lint: context.lint,
    files: context.files,
    current: context.current,
    defects: context.defects,
    staleArtifacts: context.staleArtifacts,
    recoveryHistory: attempts.length ? attempts : reportRecoveryAttempts(workspace),
    /* A recorded attempt means the browser was reached for; a recorded FAILURE
     * on `start` means it never opened. Both are facts about this run. */
    browserLaunched: attempts.some((a) => a.name === "start" && a.status === "ok"),
    captureAttempted: captures.length > 0
  });

  const result = cliResult({
    operation,
    status,
    reference: store.session().reference?.url ?? null,
    target: store.session().target?.url ?? null,
    warnings: captures.length === 0
      ? [{ code: "no-captures", message: "No capture has run in this workspace, so there is no attempt history." }]
      : failed.map((f) => ({ code: f.errorCode, message: `${f.name} attempt ${f.attemptIndex + 1} failed` })),
    recoveryHistory: attempts,
    summary: `${attempts.length} attempt(s) across ${captures.length} capture(s) · ${failed.length} failed · ${recovered.length} recovered`,
    readiness: READINESS.USABLE,
    readinessReason: "Attempt history is a record, not a claim. A retry never overwrote the attempt that failed.",
    detail: { readinessModel,
      captureCount: captures.length,
      attemptCount: attempts.length,
      failedCount: failed.length,
      recoveredCount: recovered.length,
      byCode: failed.reduce((m, f) => { m[f.errorCode] = (m[f.errorCode] ?? 0) + 1; return m; }, {})
    }
  });
  store.saveResult(result);
  return result;
}

/* --------------------------------------------------------- 10. freshness */

export function cmdFreshness({ root, viewport = 1440, maxAgeMs = null, workspace = null } = {}) {
  const context = workspaceContext(workspace);
  const readinessModel = buildReadinessModel({
    command: "freshness",
    status: context.runStatus ?? STATUS.NOT_ATTEMPTED,
    blockers: context.runBlockers,
    mode: context.mode,
    sourceKind: context.sourceKind,
    workspace,
    ir: context.ir,
    modeEvaluation: context.modeEvaluation,
    lint: context.lint,
    files: context.files,
    current: context.current,
    defects: context.defects,
    staleArtifacts: context.staleArtifacts,
    recoveryHistory: [],
    browserLaunched: false,
    captureAttempted: false
  });

  const operation = "freshness";
  const { store, result: missing } = requireStore(root, operation, { workspace });
  if (missing) return missing;

  const refCapture = store.capture("reference", viewport)?.capture ?? null;
  const tgtCapture = store.capture("target", viewport)?.capture ?? null;

  if (!refCapture || !tgtCapture) {
    const r = cliResult({
      operation, status: STATUS.NOT_ATTEMPTED, viewport,
      reference: store.session().reference?.url ?? null,
      target: store.session().target?.url ?? null,
      warnings: [{ code: "incomplete-pair", message: `Freshness compares two captures; ${!refCapture ? "reference" : "target"} at ${viewport}px is missing.` }],
      readiness: READINESS.UNDETERMINED,
      readinessReason: "A freshness verdict over one side would be a verdict about nothing."
    });
    store.saveResult(r);
    return r;
  }

  const refIR = store.ir("reference", viewport);
  const tgtIR = store.ir("target", viewport);
  const refHash = refIR ? shortHash(refIR) : null;
  const tgtHash = tgtIR ? shortHash(tgtIR) : null;

  const verdict = verifyFreshness({
    reference: stalenessRecord(refCapture, { irHash: refHash, screenshotIrHash: refHash }),
    target: stalenessRecord(tgtCapture, { irHash: tgtHash, screenshotIrHash: tgtHash }),
    expected: { referenceIrHash: refHash, targetIrHash: tgtHash },
    ...(maxAgeMs ? { maxAgeMs } : {})
  });

  /* Stale and incompatible both refuse, and they refuse differently: one asks
   * for a recapture, the other says the two artifacts measured different
   * things and a recapture of one side would not help. */
  const status = verdict.verdict === VERDICT.FRESH ? STATUS.COMPLETED : STATUS.BLOCKED;
  const result = cliResult({
    operation, status, viewport,
    reference: store.session().reference?.url ?? null,
    target: store.session().target?.url ?? null,
    blockers: verdict.verdict === VERDICT.FRESH ? [] : verdict.checks
      .filter((c) => c.verdict === VERDICT.STALE || c.verdict === VERDICT.INCOMPATIBLE)
      .map((c) => ({ code: c.check, stage: c.verdict, message: c.detail, recommendation: c.remedy ?? null })),
    warnings: verdict.unverifiable.map((c) => ({ code: c, message: "unverifiable — recorded rather than assumed to pass" })),
    summary: verdict.statement,
    readiness: verdict.verdict === VERDICT.FRESH ? READINESS.USABLE : READINESS.NOT_USABLE,
    readinessReason: verdict.verdict === VERDICT.INCOMPATIBLE
      ? "The two artifacts were produced by different versions and measured different things. Recapture both sides."
      : verdict.verdict === VERDICT.STALE
        ? "A stale artifact is rejected rather than compared."
        : "Both sides are comparable.",
    detail: { readinessModel, verdict: verdict.verdict, comparable: verdict.comparable, checks: verdict.checks }
  });
  store.saveResult(result);
  return result;
}

/* ------------------------------------------------------------- 11. tasks */

export function cmdTasks({ root, iteration = null, workspace = null } = {}) {
  const context = workspaceContext(workspace);
  const readinessModel = buildReadinessModel({
    command: "tasks",
    status: context.runStatus ?? STATUS.NOT_ATTEMPTED,
    blockers: context.runBlockers,
    mode: context.mode,
    sourceKind: context.sourceKind,
    workspace,
    ir: context.ir,
    modeEvaluation: context.modeEvaluation,
    lint: context.lint,
    files: context.files,
    current: context.current,
    defects: context.defects,
    staleArtifacts: context.staleArtifacts,
    recoveryHistory: [],
    browserLaunched: false,
    captureAttempted: false
  });

  const operation = "tasks";
  const { store, result: missing } = requireStore(root, operation, { workspace });
  if (missing) return missing;

  const index = store.readJSON("history.json") ?? { iterations: [] };
  if (!index.iterations.length) {
    const r = cliResult({
      operation, status: STATUS.NOT_ATTEMPTED,
      reference: store.session().reference?.url ?? null,
      warnings: [{ code: "no-iterations", message: "Tasks come from a comparison. None has run." }],
      readiness: READINESS.UNDETERMINED, readinessReason: "Nothing to generate tasks from."
    });
    store.saveResult(r);
    return r;
  }

  const n = iteration ?? index.iterations.at(-1).iteration;
  const history = new FidelityHistory(store.root);
  const entry = history.read(n);
  const tasks = entry?.tasks ?? [];

  /* A blocked comparison writes no tasks, and must not: a task is an
   * instruction derived from a comparison that was allowed to happen. */
  const wasBlocked = !!entry?.blocked;
  const result = cliResult({
    operation,
    status: wasBlocked ? STATUS.BLOCKED : (tasks.length ? STATUS.COMPLETED : STATUS.COMPLETED),
    reference: store.session().reference?.url ?? null,
    target: store.session().target?.url ?? null,
    blockers: wasBlocked
      ? [{ code: "comparison-blocked", stage: entry.blocked.stage, message: `Iteration ${n} was blocked, so it produced no tasks.`, recommendation: "Fix what the gate refused, then re-compare." }]
      : [],
    summary: wasBlocked
      ? `iteration ${n} was blocked; no tasks exist`
      : `${tasks.length} task(s) from iteration ${n} · every one is manual`,
    readiness: wasBlocked ? READINESS.NOT_USABLE : READINESS.USABLE_WITH_LIMITS,
    readinessReason: wasBlocked
      ? "No task is derived from a comparison that was refused."
      : "Every task is manual. They are instructions for a person to apply; nothing here applies them, and component-level automatic correction stays blocked while def_0030 is open.",
    detail: { readinessModel,
      iteration: n,
      automatic: false,
      tasks: tasks.map((t) => ({ id: t.id, mode: t.mode, dimension: t.dimension, category: t.category, regressionRisk: t.regressionRisk }))
    }
  });

  if (!wasBlocked) {
    writeArtifact(result, { kind: `tasks-${n}`, path: store.path("results", `tasks-iteration-${n}.json`), content: tasks });
  }
  store.saveResult(result);
  return result;
}

/* ------------------------------------------------------------ 12. verify */

export function cmdVerify({ root, workspace = null } = {}) {
  const operation = "verify";
  const { store, result: missing } = requireStore(root, operation, { workspace });
  if (missing) return missing;

  const index = store.readJSON("history.json") ?? { iterations: [] };
  const history = new FidelityHistory(store.root);
  const checks = [];

  for (const entry of index.iterations) {
    const v = history.verify(entry.iteration);
    checks.push({ what: `iteration ${entry.iteration}`, ok: v.ok, drift: v.drift ?? [] });
  }

  /* Every capture contract must carry a driver identity and a full attempt
   * history: an artifact that cannot say how it was produced cannot be judged
   * stale later, and would pass a freshness check by being unverifiable. */
  for (const { file, contract } of store.captures()) {
    const problems = [];
    if (!contract.driverName || !contract.driverVersion) problems.push("no driver identity");
    if (!contract.extractorVersion) problems.push("no extractor version");
    if (!Array.isArray(contract.attemptHistory) || !contract.attemptHistory.length) problems.push("no attempt history");
    if (contract.contractVersion !== CAPTURE_CONTRACT_VERSION) problems.push(`contract version ${contract.contractVersion}`);
    checks.push({ what: file, ok: problems.length === 0, drift: problems.map((p) => ({ reason: p })) });
  }

  const bad = checks.filter((c) => !c.ok);

  /* Prompt lint is part of verification, not a separate concern. An artifact
   * whose hash matches and whose prompt would instruct someone to do the wrong
   * thing has passed the integrity check and failed the one that matters. */
  const context = workspaceContext(workspace);
  const lintBlocked = Object.entries(context.lint).filter(([, r]) => r.blocked);
  for (const [filename, r] of lintBlocked) {
    checks.push({
      what: filename,
      ok: false,
      drift: r.blocking.map((f) => ({ reason: `${f.rule} ${f.message}` }))
    });
  }
  for (const stale of context.staleArtifacts) {
    checks.push({ what: stale.filename, ok: false, drift: [{ reason: stale.verdict }] });
  }

  const model = buildReadinessModel({
    command: operation,
    status: bad.length || lintBlocked.length ? STATUS.FAILED : (context.runStatus ?? STATUS.COMPLETED),
    blockers: context.runBlockers,
    mode: context.mode,
    sourceKind: context.sourceKind,
    workspace,
    ir: context.ir,
    modeEvaluation: context.modeEvaluation,
    lint: context.lint,
    files: context.files,
    current: context.current,
    defects: context.defects,
    staleArtifacts: context.staleArtifacts,
    browserLaunched: false,
    captureAttempted: false
  });

  const result = cliResult({
    operation,
    status: checks.length === 0 ? STATUS.NOT_ATTEMPTED : (checks.some((c) => !c.ok) ? STATUS.FAILED : STATUS.COMPLETED),
    reference: store.session().reference?.url ?? null,
    target: store.session().target?.url ?? null,
    errors: checks.filter((c) => !c.ok).map((c) => ({
      code: "artifact-invalid",
      message: `${c.what}: ${c.drift.map((d) => d.reason ?? d.file).join(", ")}`
    })),
    warnings: checks.length === 0 ? [{ code: "nothing-to-verify", message: "No artifacts exist in this workspace yet." }] : [],
    summary: `${checks.length - bad.length}/${checks.length} artifact check(s) passed`,
    readiness: checks.some((c) => !c.ok) ? READINESS.NOT_USABLE : (checks.length ? READINESS.USABLE : READINESS.UNDETERMINED),
    readinessReason: checks.some((c) => !c.ok)
      ? "An artifact that does not match its hash, cannot say how it was produced, or carries a blocking lint finding is not usable as evidence or as an instruction."
      : "Every artifact matches its recorded hash, carries its provenance, and passes prompt lint.",
    detail: { checks, readinessModel: model }
  });
  store.saveResult(result);
  return result;
}

/* --------------------------------------------------------- 13. readiness */

export function cmdReadiness({ root = null, workspace = null, project = null } = {}) {
  const operation = "readiness";
  const store = root && existsSync(join(root, "session.json")) ? new RunStore(root) : null;
  const report = readinessReport({ store });
  const context = workspaceContext(workspace);

  /* The standing decisions and this workspace's state are different questions
   * and are reported separately. Merging them would let a run's coverage gap
   * read as a change to a phase-level decision, which no run can make. */
  const model = buildReadinessModel({
    command: operation,
    /* The run's status, not this command's. `helmy readiness` completing says
     * nothing about whether the run it describes was refused, and presenting a
     * refused run as completed is the one summary that must never appear. */
    status: context.runStatus ?? STATUS.NOT_ATTEMPTED,
    mode: context.mode,
    sourceKind: context.sourceKind,
    project,
    workspace,
    ir: context.ir,
    modeEvaluation: context.modeEvaluation,
    blockers: context.runBlockers,
    warnings: context.present ? [] : [{
      code: "no-workspace",
      message: "No workspace was given, so the decisions below rest on the phase records alone.",
      recommendation: "Pass --workspace <dir> to see how a particular run stands against them."
    }],
    lint: context.lint,
    files: context.files,
    current: context.current,
    defects: context.defects,
    staleArtifacts: context.staleArtifacts,
    recoveryHistory: reportRecoveryAttempts(workspace),
    browserLaunched: false,
    captureAttempted: false
  });

  /* Readiness is evaluated, so it is recorded — the blocker and warning codes
   * on a readiness model are the highest-value diagnostic in the system, and
   * they are codes rather than messages. */
  readinessEvaluated(workspace, model, { command: operation });

  const result = cliResult({
    operation,
    status: context.present ? STATUS.COMPLETED : STATUS.COMPLETED_WITH_WARNINGS,
    reference: store?.session()?.reference?.url ?? context.ir?.meta?.source?.value ?? null,
    target: store?.session()?.target?.url ?? null,
    mode: context.mode,
    warnings: model.warnings,
    summary: `${report.decisions.length} separate decisions · ${Object.entries(report.counts).map(([k, v]) => `${v} ${k}`).join(", ")}`,
    readiness: READINESS.UNDETERMINED,
    readinessReason: report.note,
    detail: { ...report, readinessModel: model }
  });
  if (store) store.saveResult(result);
  return result;
}

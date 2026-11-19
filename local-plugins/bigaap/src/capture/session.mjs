/**
 * The shared capture session.
 *
 * Every capture tool goes through this. Before it existed, each tool launched
 * its own browser, wrote its own try/catch, chose its own timeouts and cleaned
 * up in its own `finally` — six copies of the same logic, none of which knew
 * about the recovery policies, and none of which recorded an attempt that
 * failed. The policies governed nothing that actually captured.
 *
 * A tool now supplies only what is specific to it: the page-side function it
 * wants to run, and what to do with the result. Launch, retry, backoff,
 * metadata, hashing, attempt history and cleanup live here and nowhere else.
 */

import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PlaywrightDriver } from "../driver/playwright-driver.mjs";
import { RecoveryManager, RUN_STATUS, policyFor } from "../driver/recovery.mjs";
import { RESULT_STATUS } from "../driver/interface.mjs";
import { DRIVER_ERROR } from "../driver/errors.mjs";
import { resolveTapTargetPolicy, policySummary } from "../policy/tap-target.mjs";

/** Bumped when the extractor's output shape changes in a way that breaks comparison. */
export const EXTRACTOR_VERSION = "0.2.0";
/** Bumped when a tolerance value changes. Phase 4.5 changed none, so this is 1. */
export const TOLERANCE_VERSION = "1";
export const CAPTURE_CONTRACT_VERSION = "1";

export const sha256 = (value) =>
  createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

/**
 * One capture session against one target.
 *
 * `driverFactory` is injectable so the whole migrated path can be exercised
 * against a stub — every failure the recovery policies name has to be reachable
 * on demand, and most cannot be provoked reliably against a live browser.
 */
export class CaptureSession {
  constructor({
    url, viewport = 1440, height = 900, devicePixelRatio = 1,
    state = "default", captureMode = "full", sourceKind = "url",
    tapTargetPolicy = null, driverFactory = null, sleep = null,
    injectScripts = []
  } = {}) {
    this.url = url;
    this.viewport = viewport;
    this.height = height;
    this.devicePixelRatio = devicePixelRatio;
    this.state = state;
    this.captureMode = captureMode;
    this.sourceKind = sourceKind;
    this.policy = resolveTapTargetPolicy(tapTargetPolicy);

    /* Scripts that must run before the page's own scripts do. They are held on
     * the session rather than injected once and forgotten: a context recreated
     * by the recovery policy would otherwise navigate without them, and the
     * capture would come back empty for a reason nothing recorded. */
    this.injectScripts = injectScripts;

    this.driverFactory = driverFactory ?? (() => new PlaywrightDriver());
    this.driver = null;
    this.pageId = null;

    this.recovery = new RecoveryManager({
      sleep: sleep ?? undefined,
      onNewContext: async () => { await this.#recreateContext(); }
    });

    this.attempts = [];
    this.artifacts = [];
    this.errors = [];
    this.warnings = [];
    this.evidenceIds = [];
    this.startedAt = new Date();
    this.completedAt = null;
    this.recreating = false;
    this.status = RUN_STATUS.NOT_ATTEMPTED;
  }

  /**
   * Runs one operation under its recovery policy, recording every attempt.
   *
   * The tools never call the driver directly, so a tool cannot accidentally
   * skip the policy or forget to record a failure.
   */
  async run(name, operation, { classifyAs = null } = {}) {
    const outcome = await this.recovery.run({
      name, viewport: this.viewport, state: this.state, classifyAs,
      operation: async (attempt) => {
        const result = await operation(this.driver, this.pageId, attempt);
        return { ...result, retryCount: attempt };
      }
    });

    /* Appended, never replaced — including the attempts that failed. */
    for (const h of outcome.history.slice(this.attempts.length)) this.attempts.push(h);

    if (outcome.result?.status === RESULT_STATUS.FAILED) {
      this.errors.push({
        operation: name, code: outcome.result.errorCode,
        message: outcome.result.error?.message ?? null,
        attempts: outcome.attempts, recovered: outcome.recovered,
        recommendation: outcome.recommendation ?? policyFor(outcome.result.errorCode).recommendation
      });
    } else if (outcome.recovered) {
      this.warnings.push({
        operation: name,
        note: `Succeeded on attempt ${outcome.attempts}; ${outcome.attempts - 1} failed attempt(s) are preserved in history.`
      });
    }

    return outcome;
  }

  /**
   * Rebuilds the page a recovery policy asked for.
   *
   * Re-entrant calls are refused rather than performed. Re-applying the init
   * scripts runs under a recovery policy of its own, and the policy for an
   * unclassified injection failure asks for a new context — so a session that
   * cannot accept its scripts would recreate, fail, recreate, forever, with no
   * I/O to time it out (def_0033). A repair that fails is a repair that ends.
   */
  async #recreateContext() {
    if (!this.driver) return;
    if (this.recreating) {
      this.warnings.push({
        operation: "recreateContext",
        note: "A new context was requested while one was already being created. The session could not be repaired, so the failing operation is left to its own policy rather than repaired again."
      });
      return;
    }
    this.recreating = true;
    try {
      await this.#recreateContextOnce();
    } finally {
      this.recreating = false;
    }
  }

  async #recreateContextOnce() {
    if (this.pageId) {
      /* Best effort: a context being recreated is already unhealthy, and a
       * failure to close it must not mask the failure that caused the retry. */
      const closed = await this.driver.closePage(this.pageId);
      if (closed.status === RESULT_STATUS.FAILED) {
        this.warnings.push({ operation: "closePage", note: "the unhealthy page could not be closed before recreating the context" });
      }
      this.pageId = null;
    }
    const opened = await this.driver.openPage({
      viewport: this.viewport, height: this.height, devicePixelRatio: this.devicePixelRatio
    });
    if (opened.status === RESULT_STATUS.OK) {
      this.pageId = opened.value.pageId;
      await this.#injectAll();
    }
  }

  /** Re-applies the init scripts to whatever page is current. */
  async #injectAll() {
    for (const spec of this.injectScripts) {
      await this.run(`injectScript:${spec.name ?? "script"}`, (driver, pageId) =>
        driver.injectScript(pageId, { path: spec.path ?? null, content: spec.content ?? null, onInit: spec.onInit !== false }));
    }
  }

  /** Starts the browser and opens the page, both under policy. */
  async open() {
    this.driver = this.driverFactory();

    const started = await this.run("start", (driver) => driver.start());
    if (started.status !== RUN_STATUS.COMPLETED) {
      this.status = RUN_STATUS.BLOCKED;
      return started;
    }

    const opened = await this.run("openPage", (driver) => driver.openPage({
      viewport: this.viewport, height: this.height, devicePixelRatio: this.devicePixelRatio
    }));
    if (opened.status !== RUN_STATUS.COMPLETED) {
      this.status = RUN_STATUS.BLOCKED;
      return opened;
    }
    this.pageId = opened.result.value.pageId;
    await this.#injectAll();
    return opened;
  }

  /** Diagnostics the page reported for itself, each under its own policy. */
  async diagnostics() {
    const con = await this.run("consoleErrors", (driver, pageId) => driver.consoleErrors(pageId));
    const pag = await this.run("pageErrors", (driver, pageId) => driver.pageErrors(pageId));
    const net = await this.run("networkFailures", (driver, pageId) => driver.networkFailures(pageId));
    return {
      consoleErrors: con.result?.value?.errors ?? [],
      pageErrors: pag.result?.value?.errors ?? [],
      networkFailures: net.result?.value?.failures ?? []
    };
  }

  /** Navigate, settle and stabilise. Each step carries its own policy. */
  async prepare({ waitFonts = true, waitAssets = true, freeze = true, reducedMotion = true, timeoutMs = 30000 } = {}) {
    const nav = await this.run("navigate", (driver, pageId) => driver.navigate(pageId, this.url, { timeoutMs }));
    if (nav.status !== RUN_STATUS.COMPLETED) { this.status = RUN_STATUS.BLOCKED; return nav; }

    /* Readiness failures degrade rather than block: the capture still holds, it
     * simply carries `fontsReady: false`, which the equivalent-content gate then
     * refuses. That is the honest degradation the policy describes. */
    let fontsReady = true;
    let networkIdle = true;
    let failedRequests = [];

    if (waitFonts) {
      const r = await this.run("waitForFonts", (driver, pageId) => driver.waitForFonts(pageId));
      fontsReady = r.status === RUN_STATUS.COMPLETED;
    }
    if (waitAssets) {
      const r = await this.run("waitForNetworkIdle", (driver, pageId) => driver.waitForNetworkIdle(pageId));
      networkIdle = r.status === RUN_STATUS.COMPLETED;
      failedRequests = r.result?.value?.failedRequests ?? [];
      const a = await this.run("waitForAssets", (driver, pageId) => driver.waitForAssets(pageId));
      if (a.status !== RUN_STATUS.COMPLETED) networkIdle = false;
    }

    let animationsFrozen = false;
    if (reducedMotion) await this.run("setReducedMotion", (driver, pageId) => driver.setReducedMotion(pageId, true));
    if (freeze) {
      const r = await this.run("freezeAnimation", (driver, pageId) => driver.freezeAnimation(pageId));
      animationsFrozen = r.status === RUN_STATUS.COMPLETED;
    }

    this.readiness = { fontsReady, networkIdle, animationsFrozen, failedRequests };
    return nav;
  }

  /** Runs a page-side function through the interface. */
  async evaluate(name, fn, arg) {
    return this.run(name, (driver, pageId) => driver.evaluate(pageId, fn, arg));
  }

  /** Full-page screenshot to a path, under the screenshot policy. */
  async screenshotFullPage(path) {
    return this.run("screenshotFullPage", (driver, pageId) => driver.screenshotFullPage(pageId, { path }));
  }

  /** Clipped screenshot of one region, under the same policy as a full page. */
  async screenshotRegion(path, clip) {
    return this.run("screenshotRegion", (driver, pageId) => driver.screenshotRegion(pageId, { clip, path }));
  }

  /** Induces a state. A missing selector is a finding, not a retry. */
  async triggerState({ state, selector }) {
    const outcome = await this.run(`triggerState:${state}`, (driver, pageId) =>
      driver.triggerState(pageId, { state, selector }));
    return outcome;
  }

  /**
   * Writes an artifact and records its hash and path.
   *
   * A retry writes a NEW path rather than overwriting: `raw.json`,
   * `raw.attempt-2.json`. A failed attempt's partial evidence is evidence.
   */
  writeArtifact({ kind, path, content, attempt = null }) {
    const body = typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n";
    const finalPath = attempt && attempt > 1
      ? path.replace(/(\.[^.]+)$/, `.attempt-${attempt}$1`)
      : path;
    mkdirSync(dirname(finalPath), { recursive: true });
    writeFileSync(finalPath, body, "utf8");
    const record = { kind, path: finalPath, hash: sha256(body), bytes: body.length, attempt: attempt ?? 1 };
    this.artifacts.push(record);
    return record;
  }

  /** Cleanup, recorded even when it fails — and never masking the primary failure. */
  async close() {
    const primaryFailures = this.errors.length;
    const outcome = await this.run("cleanup", (driver) => driver.cleanup());
    this.completedAt = new Date();

    if (outcome.status !== RUN_STATUS.COMPLETED) {
      this.warnings.push({
        operation: "cleanup",
        note: primaryFailures > 0
          ? "Cleanup failed after an earlier failure. The earlier failure is the primary one; this is recorded beside it, not in place of it."
          : "Cleanup failed. Results already captured remain valid."
      });
    }

    if (this.status === RUN_STATUS.NOT_ATTEMPTED) {
      this.status = this.errors.length ? RUN_STATUS.COMPLETED_WITH_WARNINGS : RUN_STATUS.COMPLETED;
    }
    return outcome;
  }

  /**
   * The shared capture contract every tool emits.
   *
   * One shape, so a downstream reader does not have to know which tool produced
   * an artifact to judge whether it is comparable.
   */
  metadata({ extraWarnings = [] } = {}) {
    const identity = this.driver?.identity?.() ?? { driverName: null, driverVersion: null };
    return {
      contractVersion: CAPTURE_CONTRACT_VERSION,
      url: this.url,
      sourceKind: this.sourceKind,
      viewport: this.viewport,
      viewportHeight: this.height,
      devicePixelRatio: this.devicePixelRatio,
      state: this.state,
      captureMode: this.captureMode,
      driverName: identity.driverName,
      driverVersion: identity.driverVersion,
      extractorVersion: EXTRACTOR_VERSION,
      toleranceVersion: TOLERANCE_VERSION,
      tapTargetPolicy: policySummary(this.policy),
      tapTargetPolicyVersion: this.policy.policyName,
      startedAt: this.startedAt.toISOString(),
      completedAt: (this.completedAt ?? new Date()).toISOString(),
      durationMs: (this.completedAt ?? new Date()).getTime() - this.startedAt.getTime(),
      attemptCount: this.attempts.length,
      retryCount: Math.max(0, this.attempts.length - new Set(this.attempts.map((a) => a.name)).size),
      status: this.status,
      readiness: this.readiness ?? null,
      artifacts: this.artifacts,
      artifactHashes: Object.fromEntries(this.artifacts.map((a) => [a.kind, a.hash])),
      errors: this.errors,
      warnings: [...this.warnings, ...extraWarnings],
      evidenceIds: this.evidenceIds,
      attemptHistory: this.attempts
    };
  }
}

/**
 * Translates a capture contract into what the staleness checks read.
 *
 * The two were written apart: `verifyFreshness` names `capturedAt`,
 * `sourceUrl` and `irHash`; the contract names `completedAt`, `url` and
 * carries no IR at all, because a capture happens before an IR exists. Without
 * this the checks ran on real captures and reported eight of ten unverifiable
 * — passing, while verifying nothing. `irHash` is supplied by the caller that
 * has one, and is left null rather than invented here.
 */
export function stalenessRecord(metadata, { irHash = null, screenshotIrHash = null } = {}) {
  if (!metadata) return null;
  return {
    irHash,
    screenshotIrHash,
    viewport: metadata.viewport ?? null,
    state: metadata.state ?? "default",
    capturedAt: metadata.completedAt ?? null,
    sourceUrl: metadata.url ?? null,
    driverVersion: metadata.driverVersion ?? null,
    extractorVersion: metadata.extractorVersion ?? null,
    toleranceVersion: metadata.toleranceVersion ?? null
  };
}

/**
 * The whole capture, start to finish, for one tool.
 *
 * `body` receives the session and returns whatever the tool produces. Whatever
 * happens inside it, `close()` runs and metadata is emitted — a tool cannot
 * leak a browser or return a capture with no provenance.
 */
export async function withCaptureSession(options, body) {
  const session = new CaptureSession(options);
  let value = null;
  let thrown = null;

  try {
    const opened = await session.open();
    if (opened.status === RUN_STATUS.BLOCKED) {
      await session.close();
      return { ok: false, blocked: true, value: null, metadata: session.metadata(), session };
    }
    const prepared = await session.prepare(options.prepare ?? {});
    if (prepared.status === RUN_STATUS.BLOCKED) {
      await session.close();
      return { ok: false, blocked: true, value: null, metadata: session.metadata(), session };
    }
    value = await body(session);
  } catch (err) {
    thrown = err;
    session.errors.push({
      operation: "tool-body", code: DRIVER_ERROR.UNKNOWN,
      message: String(err?.message ?? err).slice(0, 300),
      recommendation: "The tool's own logic threw. The capture session still cleaned up and its history is preserved."
    });
    session.status = RUN_STATUS.FAILED;
  } finally {
    await session.close();
  }

  return {
    ok: !thrown && session.errors.length === 0,
    blocked: false,
    value,
    metadata: session.metadata(),
    session,
    thrown: thrown ? String(thrown.message ?? thrown).slice(0, 300) : null
  };
}

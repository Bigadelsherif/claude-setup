/**
 * The browser-driver interface.
 *
 * The fidelity layer depends on this and never on Playwright. That separation
 * is the point: a driver is a source of evidence, and evidence has to carry its
 * own provenance — which operation produced it, against what URL, at what
 * viewport, in what state, when, and whether it succeeded.
 *
 * Every operation returns the same envelope, success or failure. A caller that
 * has to check `err instanceof SomeVendorError` is coupled to the vendor; a
 * caller that reads `result.status` and `result.error.code` is not.
 */

import { DriverError, DRIVER_ERROR } from "./errors.mjs";

/** Every operation the interface defines. Adapters must implement all of them. */
export const DRIVER_OPERATIONS = Object.freeze([
  "start", "stop",
  "openPage", "closePage", "navigate", "detectNavigationComplete",
  "setViewport", "setDevicePixelRatio",
  "waitForDomReady", "waitForNetworkIdle", "waitForFonts", "waitForAssets",
  "injectScript",
  "screenshot", "screenshotFullPage", "screenshotRegion",
  "queryElements", "computedStyle", "geometry", "evaluate",
  "triggerState", "focusElement", "hoverElement", "clickElement", "setAttribute",
  "freezeAnimation", "setReducedMotion",
  /* Motion observation (M2a). Scrolling had no operation at all before this,
   * which is why nothing could observe a scroll-triggered change. */
  "scrollTo", "scrollIntoView", "observeIntersections", "readIntersections",
  "consoleErrors", "pageErrors", "networkFailures",
  "cleanup"
]);

export const RESULT_STATUS = Object.freeze({
  OK: "ok",
  FAILED: "failed",
  SKIPPED: "skipped",
  UNSUPPORTED: "unsupported"
});

/**
 * The normalized result envelope.
 *
 * `durationMs` is computed rather than supplied, so a caller cannot report a
 * duration that does not match its own timestamps.
 */
export function driverResult({
  operation, status, value = null, error = null,
  targetUrl = null, viewport = null, state = null,
  startedAt, completedAt, retryCount = 0, evidenceIds = [], meta = {}
}) {
  const start = startedAt instanceof Date ? startedAt : new Date(startedAt);
  const end = completedAt instanceof Date ? completedAt : new Date(completedAt);
  return {
    operation,
    status,
    value,
    error: error ? (error.toJSON ? error.toJSON() : error) : null,
    errorCode: error ? (error.code ?? error.errorCode ?? DRIVER_ERROR.UNKNOWN) : null,
    targetUrl,
    viewport,
    state,
    startedAt: start.toISOString(),
    completedAt: end.toISOString(),
    durationMs: Math.max(0, end.getTime() - start.getTime()),
    retryCount,
    evidenceIds,
    meta
  };
}

/**
 * How long each operation may take before it is reported as not having finished.
 *
 * Bounds differ by an order of magnitude, so one number would be wrong twice: a
 * launch may legitimately take thirty seconds, a computed-style read may not.
 * `navigate` is absent because it takes its own timeout from the caller and
 * passes it to the underlying call.
 */
export const OPERATION_TIMEOUT_MS = Object.freeze({
  start: 60_000,
  stop: 30_000,
  cleanup: 30_000,
  openPage: 30_000,
  closePage: 15_000,
  navigate: 120_000,
  waitForNetworkIdle: 60_000,
  waitForFonts: 60_000,
  waitForAssets: 60_000,
  injectScript: 30_000,
  screenshot: 60_000,
  screenshotFullPage: 90_000,
  screenshotRegion: 60_000,
  evaluate: 120_000,
  triggerState: 30_000,
  default: 60_000
});

/**
 * The typed error an operation reports when it does not finish in time.
 *
 * Reusing each operation's existing error keeps the existing recovery policy in
 * charge. Inventing a `timed-out` category would have meant twenty policies
 * that knew nothing about it.
 */
const TIMEOUT_ERROR = Object.freeze({
  start: DRIVER_ERROR.STARTUP_FAILED,
  stop: DRIVER_ERROR.CLEANUP_FAILED,
  cleanup: DRIVER_ERROR.CLEANUP_FAILED,
  closePage: DRIVER_ERROR.CLEANUP_FAILED,
  openPage: DRIVER_ERROR.STARTUP_FAILED,
  navigate: DRIVER_ERROR.NAVIGATION_TIMEOUT,
  waitForNetworkIdle: DRIVER_ERROR.ASSET_TIMEOUT,
  waitForAssets: DRIVER_ERROR.ASSET_TIMEOUT,
  waitForFonts: DRIVER_ERROR.FONT_TIMEOUT,
  injectScript: DRIVER_ERROR.SCRIPT_INJECTION_FAILED,
  screenshot: DRIVER_ERROR.SCREENSHOT_FAILED,
  screenshotFullPage: DRIVER_ERROR.SCREENSHOT_FAILED,
  screenshotRegion: DRIVER_ERROR.SCREENSHOT_FAILED,
  triggerState: DRIVER_ERROR.STATE_TRIGGER_FAILED
});

/**
 * Races an operation against its bound.
 *
 * The race is deliberate rather than a cancellation: the underlying library
 * offers no way to abandon a call, so the honest statement is that it did not
 * complete in time. A call that completes afterwards is released by the next
 * cleanup — it is not awaited, and it is not reported as a result.
 */
function withBound(operation, fn, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return fn();
  let timer = null;
  const expiry = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new DriverError(
      TIMEOUT_ERROR[operation] ?? DRIVER_ERROR.UNKNOWN,
      `${operation} did not complete within ${timeoutMs}ms`,
      { operation, detail: { timedOut: true, timeoutMs } }
    )), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([fn(), expiry]).finally(() => { if (timer) clearTimeout(timer); });
}

/**
 * Wraps an operation so every call produces an envelope, including on throw.
 *
 * An adapter that forgets to catch still cannot leak a vendor error upward:
 * anything unclassified arrives as `unknown-driver-error` with the original
 * message preserved on `cause`.
 *
 * Every call is also bounded in time. Without that, an operation that neither
 * returned nor threw stopped the whole run: no attempt recorded, no contract
 * emitted, nothing to read afterwards about what had been tried (def_0035).
 * Hanging is not an outcome this envelope can express, so it must not be an
 * outcome an operation can produce.
 */
export async function runOperation({
  operation, fn, classify, targetUrl = null, viewport = null, state = null,
  retryCount = 0, evidenceIds = [], meta = {}, timeoutMs = null
}) {
  const bound = timeoutMs ?? OPERATION_TIMEOUT_MS[operation] ?? OPERATION_TIMEOUT_MS.default;
  const startedAt = new Date();
  try {
    const value = await withBound(operation, fn, bound);
    return driverResult({
      operation, status: RESULT_STATUS.OK, value,
      targetUrl, viewport, state, startedAt, completedAt: new Date(),
      retryCount, evidenceIds, meta
    });
  } catch (err) {
    const code = err instanceof DriverError ? err.code : (classify ? classify(err, operation) : DRIVER_ERROR.UNKNOWN);
    const wrapped = err instanceof DriverError
      ? err
      : new DriverError(code, String(err?.message ?? err).slice(0, 300), { cause: err, operation });
    return driverResult({
      operation, status: RESULT_STATUS.FAILED, error: wrapped,
      targetUrl, viewport, state, startedAt, completedAt: new Date(),
      retryCount, evidenceIds, meta
    });
  }
}

/**
 * The base a driver extends.
 *
 * Every operation throws `unsupported` by default rather than silently doing
 * nothing: a driver that cannot freeze animation must say so, because a caller
 * that believes animation was frozen will draw timing claims it should not.
 */
export class BrowserDriver {
  constructor({ name, version }) {
    this.name = name;
    this.version = version;
    this.capabilities = new Set();
  }

  supports(operation) {
    return this.capabilities.has(operation);
  }

  /** Declared for the record; adapters override. */
  async unsupported(operation) {
    return driverResult({
      operation, status: RESULT_STATUS.UNSUPPORTED,
      error: new DriverError(DRIVER_ERROR.UNKNOWN, `${this.name} does not implement ${operation}`, { operation }),
      startedAt: new Date(), completedAt: new Date()
    });
  }

  /** Identity travels onto every artifact so staleness can be judged later. */
  identity() {
    return { driverName: this.name, driverVersion: this.version, capabilities: [...this.capabilities].sort() };
  }
}

/** Confirms an adapter implements the whole interface before it is trusted. */
export function verifyAdapter(driver) {
  const missing = DRIVER_OPERATIONS.filter((op) => typeof driver[op] !== "function");
  return { complete: missing.length === 0, missing, identity: driver.identity?.() ?? null };
}

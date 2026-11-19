/**
 * Typed driver errors.
 *
 * Sixteen categories, deliberately not collapsed into one. The recovery policy
 * keys off the category, so "the browser would not start" and "the selector was
 * not found" have to be different things — one warrants a fresh context and a
 * retry, the other warrants neither and is not even a failure of the driver.
 */

export const DRIVER_ERROR = Object.freeze({
  STARTUP_FAILED: "startup-failed",
  BROWSER_UNAVAILABLE: "browser-unavailable",
  NAVIGATION_TIMEOUT: "navigation-timeout",
  NETWORK_FAILURE: "network-failure",
  PAGE_ERROR: "page-error",
  SCRIPT_INJECTION_FAILED: "script-injection-failed",
  SCREENSHOT_FAILED: "screenshot-failed",
  SELECTOR_NOT_FOUND: "selector-not-found",
  STATE_TRIGGER_FAILED: "state-trigger-failed",
  FONT_TIMEOUT: "font-timeout",
  ASSET_TIMEOUT: "asset-timeout",
  VIEWPORT_INVALID: "viewport-invalid",
  AUTHENTICATION_REQUIRED: "authentication-required",
  CONTENT_NOT_READY: "content-not-ready",
  CLEANUP_FAILED: "cleanup-failed",
  UNKNOWN: "unknown-driver-error"
});

export const ALL_DRIVER_ERRORS = Object.freeze(Object.values(DRIVER_ERROR));

/**
 * A driver error carries its category, not just a message.
 *
 * `cause` keeps the underlying implementation error so a Playwright message is
 * still readable, without letting its text become the thing recovery branches
 * on — that is what the category is for.
 */
export class DriverError extends Error {
  constructor(code, message, { cause = null, operation = null, detail = null } = {}) {
    super(message);
    this.name = "DriverError";
    this.code = ALL_DRIVER_ERRORS.includes(code) ? code : DRIVER_ERROR.UNKNOWN;
    this.declaredCode = code;
    this.cause = cause ? String(cause.message ?? cause).slice(0, 300) : null;
    this.operation = operation;
    this.detail = detail;
  }

  toJSON() {
    return {
      code: this.code, message: this.message, operation: this.operation,
      detail: this.detail, cause: this.cause
    };
  }
}

/**
 * Classifies an implementation error into a category.
 *
 * Adapter-specific, and the only place a Playwright message is read. Anything
 * unrecognised becomes `unknown-driver-error` rather than being forced into a
 * neighbouring category — a wrong category would route recovery wrongly, which
 * is worse than admitting the error is unclassified.
 */
export function classifyPlaywrightError(err, operation) {
  const m = String(err?.message ?? err ?? "").toLowerCase();

  /* The adapter's own package is missing, which is a startup failure and not an
   * unclassifiable one. A plugin installation ships no `node_modules`, so this
   * is the FIRST thing a user meets when they try to capture from an installed
   * copy — and it reached them as `unknown-driver-error` with the remedy
   * "classify it before deciding whether the result is usable", which is advice
   * for a maintainer, not for someone who needs to run `npm install`.
   *
   * No new category: "the browser would not start" is exactly what happened. */
  if (/cannot find (package|module) ['"]?playwright|err_module_not_found/.test(m)) {
    return DRIVER_ERROR.STARTUP_FAILED;
  }
  if (/executable doesn'?t exist|browsertype\.launch|failed to launch/.test(m)) return DRIVER_ERROR.STARTUP_FAILED;
  if (/browser has been closed|target page, context or browser has been closed/.test(m)) return DRIVER_ERROR.BROWSER_UNAVAILABLE;
  if (/timeout.*exceeded.*goto|navigation timeout|page\.goto: timeout/.test(m)) return DRIVER_ERROR.NAVIGATION_TIMEOUT;
  if (/net::err|econnrefused|enotfound|socket hang up/.test(m)) return DRIVER_ERROR.NETWORK_FAILURE;
  if (/page crashed|renderer process/.test(m)) return DRIVER_ERROR.PAGE_ERROR;
  if (/addscripttag|addinitscript|evaluate.*failed to inject/.test(m)) return DRIVER_ERROR.SCRIPT_INJECTION_FAILED;
  if (/screenshot/.test(m)) return DRIVER_ERROR.SCREENSHOT_FAILED;
  if (/waiting for (locator|selector)|no element matches/.test(m)) return DRIVER_ERROR.SELECTOR_NOT_FOUND;
  if (/document\.fonts|fonts\.ready/.test(m)) return DRIVER_ERROR.FONT_TIMEOUT;
  if (/networkidle/.test(m)) return DRIVER_ERROR.ASSET_TIMEOUT;
  if (/viewport/.test(m)) return DRIVER_ERROR.VIEWPORT_INVALID;
  if (/401|403|unauthor|login required/.test(m)) return DRIVER_ERROR.AUTHENTICATION_REQUIRED;
  if (/timeout/.test(m) && operation === "waitForDomReady") return DRIVER_ERROR.CONTENT_NOT_READY;

  return DRIVER_ERROR.UNKNOWN;
}

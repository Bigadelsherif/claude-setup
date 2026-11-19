/**
 * Recovery policy and manager.
 *
 * Fifteen named failures, each with its own answer to five questions: is it
 * worth retrying, how many times, with what backoff, does it need a fresh
 * browser context, and does the viewport stay blocked afterwards.
 *
 * The rule that shapes the implementation: **a retry never overwrites the
 * failed attempt.** Every attempt is appended, including the ones that failed,
 * because "it worked on the third try" and "it worked" are different facts and
 * only the first is true.
 */

import { DRIVER_ERROR } from "./errors.mjs";

export const RUN_STATUS = Object.freeze({
  COMPLETED: "completed",
  COMPLETED_WITH_WARNINGS: "completed-with-warnings",
  BLOCKED: "blocked",
  FAILED: "failed",
  NOT_ATTEMPTED: "not-attempted",
  CANCELLED: "cancelled"
});

/**
 * The recovery table.
 *
 * `viewportRemainsBlocked` is the field that decides whether a viewport's
 * results survive: a failure that leaves the page in an unknown state blocks it,
 * a failure that merely degrades one measurement does not.
 */
export const RECOVERY_POLICY = Object.freeze({
  [DRIVER_ERROR.STARTUP_FAILED]: {
    failure: "browser startup failure",
    retryable: true, maxRetries: 2, backoffMs: [1000, 4000],
    newContextRequired: true, viewportRemainsBlocked: true, otherViewportsMayContinue: false,
    artifact: "startup-failure.json",
    recommendation: "The browser could not be launched. Check the Playwright install and the executable path; no capture is possible until it starts."
  },
  [DRIVER_ERROR.BROWSER_UNAVAILABLE]: {
    failure: "browser or context closed unexpectedly",
    retryable: true, maxRetries: 1, backoffMs: [500],
    newContextRequired: true, viewportRemainsBlocked: false, otherViewportsMayContinue: true,
    artifact: "browser-unavailable.json",
    recommendation: "The browser closed mid-run. A fresh context is created; if it recurs, the host is likely under memory pressure."
  },
  [DRIVER_ERROR.NAVIGATION_TIMEOUT]: {
    failure: "navigation timeout",
    retryable: true, maxRetries: 2, backoffMs: [1000, 3000],
    newContextRequired: false, viewportRemainsBlocked: true, otherViewportsMayContinue: true,
    artifact: "navigation-timeout.json",
    recommendation: "The page did not finish loading. Raise the navigation timeout or confirm the target is serving; this viewport is blocked, the others are not."
  },
  [DRIVER_ERROR.NETWORK_FAILURE]: {
    failure: "network failure",
    retryable: true, maxRetries: 2, backoffMs: [1000, 3000],
    newContextRequired: false, viewportRemainsBlocked: true, otherViewportsMayContinue: true,
    artifact: "network-failure.json",
    recommendation: "The target was unreachable. Confirm it is running before re-running this viewport."
  },
  [DRIVER_ERROR.PAGE_ERROR]: {
    failure: "browser page crash",
    retryable: true, maxRetries: 1, backoffMs: [2000],
    newContextRequired: true, viewportRemainsBlocked: false, otherViewportsMayContinue: true,
    artifact: "page-crash.json",
    recommendation: "The renderer crashed. A fresh context is created; the crashed attempt stays in history because a page that crashes once may be the finding."
  },
  [DRIVER_ERROR.SCRIPT_INJECTION_FAILED]: {
    failure: "script injection failure",
    retryable: true, maxRetries: 1, backoffMs: [500],
    newContextRequired: true, viewportRemainsBlocked: true, otherViewportsMayContinue: true,
    artifact: "injection-failure.json",
    recommendation: "The extractor could not be injected, most often a Content-Security-Policy refusal. Retry through the CDP path; if it persists this target cannot be extracted from."
  },
  [DRIVER_ERROR.SCREENSHOT_FAILED]: {
    failure: "screenshot failure",
    retryable: true, maxRetries: 2, backoffMs: [500, 1500],
    newContextRequired: false, viewportRemainsBlocked: false, otherViewportsMayContinue: true,
    artifact: "screenshot-failure.json",
    recommendation: "The screenshot failed. IR comparison can still proceed; the comparative pixel channel is unavailable for this viewport."
  },
  [DRIVER_ERROR.SELECTOR_NOT_FOUND]: {
    failure: "state trigger target missing",
    retryable: false, maxRetries: 0, backoffMs: [],
    newContextRequired: false, viewportRemainsBlocked: false, otherViewportsMayContinue: true,
    artifact: "selector-not-found.json",
    recommendation: "The element does not exist on this page. This is a finding about the target, not a driver failure, and the state is recorded as unavailable rather than retried."
  },
  [DRIVER_ERROR.STATE_TRIGGER_FAILED]: {
    failure: "state trigger failure",
    retryable: true, maxRetries: 1, backoffMs: [500],
    newContextRequired: false, viewportRemainsBlocked: false, otherViewportsMayContinue: true,
    artifact: "state-trigger-failure.json",
    recommendation: "The state could not be induced. It is recorded as unknown with its reason; it is never recorded as a mismatch."
  },
  [DRIVER_ERROR.FONT_TIMEOUT]: {
    failure: "font readiness timeout",
    retryable: true, maxRetries: 1, backoffMs: [1000],
    newContextRequired: false, viewportRemainsBlocked: false, otherViewportsMayContinue: true,
    artifact: "font-timeout.json",
    recommendation: "Fonts did not settle. The capture continues with `fontsReady: false`, which the equivalent-content gate then refuses — the comparative pixel channel stays off."
  },
  [DRIVER_ERROR.ASSET_TIMEOUT]: {
    failure: "asset readiness timeout",
    retryable: true, maxRetries: 1, backoffMs: [1000],
    newContextRequired: false, viewportRemainsBlocked: false, otherViewportsMayContinue: true,
    artifact: "asset-timeout.json",
    recommendation: "Network did not go idle. Failed requests are listed; image-dependent checks carry a lowered confidence rather than a silent pass."
  },
  [DRIVER_ERROR.VIEWPORT_INVALID]: {
    failure: "invalid viewport",
    retryable: false, maxRetries: 0, backoffMs: [],
    newContextRequired: false, viewportRemainsBlocked: true, otherViewportsMayContinue: true,
    artifact: "viewport-invalid.json",
    recommendation: "The requested viewport is not usable. Correct the run manifest; retrying the same invalid value cannot succeed."
  },
  [DRIVER_ERROR.AUTHENTICATION_REQUIRED]: {
    failure: "authentication required",
    retryable: false, maxRetries: 0, backoffMs: [],
    newContextRequired: false, viewportRemainsBlocked: true, otherViewportsMayContinue: true,
    artifact: "authentication-required.json",
    recommendation: "The target requires authentication. Authenticated capture is not implemented, and credentials are never handled by the loop — capture must be performed in an already-authenticated context supplied by the user."
  },
  [DRIVER_ERROR.CONTENT_NOT_READY]: {
    failure: "content not ready",
    retryable: true, maxRetries: 2, backoffMs: [1000, 2000],
    newContextRequired: false, viewportRemainsBlocked: true, otherViewportsMayContinue: true,
    artifact: "content-not-ready.json",
    recommendation: "The document never reached a ready state. Increase the settle window before re-running this viewport."
  },
  [DRIVER_ERROR.CLEANUP_FAILED]: {
    failure: "cleanup failure",
    retryable: true, maxRetries: 1, backoffMs: [500],
    newContextRequired: false, viewportRemainsBlocked: false, otherViewportsMayContinue: true,
    artifact: "cleanup-failure.json",
    recommendation: "Resources could not be released. Results already captured remain valid; a leaked browser process may need killing by hand."
  },
  [DRIVER_ERROR.UNKNOWN]: {
    failure: "unclassified driver error",
    retryable: true, maxRetries: 1, backoffMs: [1000],
    newContextRequired: true, viewportRemainsBlocked: true, otherViewportsMayContinue: true,
    artifact: "unknown-driver-error.json",
    recommendation: "The failure could not be classified. The original message is preserved on `cause`; classify it before deciding whether the result is usable."
  }
});

/** Non-driver failures the runner handles, with the same shape. */
export const RUNNER_POLICY = Object.freeze({
  "interrupted-iteration": {
    failure: "interrupted iteration",
    retryable: false, maxRetries: 0, backoffMs: [],
    newContextRequired: true, viewportRemainsBlocked: true, otherViewportsMayContinue: true,
    artifact: "interrupted.json",
    recommendation: "The iteration was interrupted before comparison. It stays on disk marked incomplete; recovery starts a NEW iteration rather than resuming in place."
  },
  "target-process-failure": {
    failure: "target process failure",
    retryable: true, maxRetries: 1, backoffMs: [2000],
    newContextRequired: false, viewportRemainsBlocked: true, otherViewportsMayContinue: false,
    artifact: "target-process-failure.json",
    recommendation: "The target application stopped. Every viewport depends on it, so none may continue until it is running again."
  },
  "stale-capture": {
    failure: "stale capture",
    retryable: false, maxRetries: 0, backoffMs: [],
    newContextRequired: false, viewportRemainsBlocked: true, otherViewportsMayContinue: true,
    artifact: "stale-capture.json",
    recommendation: "The artifact does not match the run it is being compared in. Recapture; a stale artifact is rejected rather than compared."
  },
  "missing-reference-artifact": {
    failure: "missing reference artifact",
    retryable: false, maxRetries: 0, backoffMs: [],
    newContextRequired: false, viewportRemainsBlocked: true, otherViewportsMayContinue: true,
    artifact: "missing-reference.json",
    recommendation: "No reference exists for this viewport. The target is NOT started for it — there is nothing to compare against."
  },
  "missing-target-artifact": {
    failure: "missing target artifact",
    retryable: true, maxRetries: 1, backoffMs: [1000],
    newContextRequired: false, viewportRemainsBlocked: true, otherViewportsMayContinue: true,
    artifact: "missing-target.json",
    recommendation: "The target capture is absent. The reference result is preserved and the target is reported unavailable; no score is produced from the pair."
  }
});

export const policyFor = (code) => RECOVERY_POLICY[code] ?? RUNNER_POLICY[code] ?? RECOVERY_POLICY[DRIVER_ERROR.UNKNOWN];

/**
 * Runs an operation under its recovery policy.
 *
 * Every attempt — failed or not — is appended to `attempts`. The successful one
 * does not replace the failures that preceded it.
 */
export class RecoveryManager {
  constructor({ onNewContext = null, sleep = null } = {}) {
    this.attempts = [];
    this.onNewContext = onNewContext;
    this.sleep = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  history() {
    return this.attempts.map((a, i) => ({ attempt: i + 1, ...a }));
  }

  /**
   * @param {Function} operation  async () => driverResult envelope
   */
  async run({ name, operation, viewport = null, state = null, classifyAs = null }) {
    let attempt = 0;
    let last = null;

    for (;;) {
      const result = await operation(attempt);
      /* Appended, never replaced. */
      this.attempts.push({
        name, viewport, state, attemptIndex: attempt,
        status: result.status, errorCode: result.errorCode,
        startedAt: result.startedAt, completedAt: result.completedAt,
        durationMs: result.durationMs,
        error: result.error ?? null
      });
      last = result;

      if (result.status === "ok") {
        return {
          status: RUN_STATUS.COMPLETED, result,
          attempts: attempt + 1,
          recovered: attempt > 0,
          history: this.history(),
          note: attempt > 0
            ? `Succeeded on attempt ${attempt + 1}. The ${attempt} failed attempt(s) remain in history.`
            : "Succeeded on the first attempt."
        };
      }

      const code = classifyAs ?? result.errorCode;
      const policy = policyFor(code);

      if (!policy.retryable || attempt >= policy.maxRetries) {
        return {
          status: policy.viewportRemainsBlocked ? RUN_STATUS.BLOCKED : RUN_STATUS.COMPLETED_WITH_WARNINGS,
          result: last,
          attempts: attempt + 1,
          recovered: false,
          exhausted: policy.retryable,
          policy: { ...policy, code },
          history: this.history(),
          recommendation: policy.recommendation,
          note: policy.retryable
            ? `Retried ${policy.maxRetries} time(s) and still failed.`
            : "Not retryable; retrying could not succeed."
        };
      }

      const backoff = policy.backoffMs[attempt] ?? policy.backoffMs[policy.backoffMs.length - 1] ?? 0;
      if (policy.newContextRequired && this.onNewContext) await this.onNewContext();
      if (backoff) await this.sleep(backoff);
      attempt++;
    }
  }
}

/**
 * Rolls per-viewport outcomes into a run status without inventing one.
 *
 * A run with one blocked viewport and three good ones is
 * `completed-with-warnings` — not `failed`, which would discard three valid
 * records, and not `completed`, which would hide the blocked one.
 */
export function rollUpRunStatus(viewportOutcomes) {
  const statuses = viewportOutcomes.map((v) => v.status);
  if (!statuses.length) return { status: RUN_STATUS.NOT_ATTEMPTED, reason: "no viewport was attempted" };
  if (statuses.includes(RUN_STATUS.CANCELLED)) return { status: RUN_STATUS.CANCELLED, reason: "the user cancelled the run" };
  if (statuses.every((s) => s === RUN_STATUS.FAILED)) return { status: RUN_STATUS.FAILED, reason: "every viewport failed" };
  if (statuses.every((s) => s === RUN_STATUS.COMPLETED)) return { status: RUN_STATUS.COMPLETED, reason: "every viewport completed" };
  if (statuses.every((s) => s === RUN_STATUS.NOT_ATTEMPTED)) return { status: RUN_STATUS.NOT_ATTEMPTED, reason: "nothing was attempted" };

  const blocked = viewportOutcomes.filter((v) => v.status === RUN_STATUS.BLOCKED).map((v) => v.viewport);
  const completed = viewportOutcomes.filter((v) => v.status === RUN_STATUS.COMPLETED).map((v) => v.viewport);
  return {
    status: RUN_STATUS.COMPLETED_WITH_WARNINGS,
    reason: `${completed.length} viewport(s) completed; ${blocked.length} blocked (${blocked.join(", ")})`,
    completedViewports: completed,
    blockedViewports: blocked
  };
}

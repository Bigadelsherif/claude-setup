/**
 * `bigaap telemetry` — the operator's view of, and control over, local diagnostics.
 *
 * The name is `telemetry` deliberately, even though nothing here transmits.
 * That is the word people search for when they want to know what a tool is
 * collecting, and a tool that hides its local recording behind a friendlier
 * name has made itself harder to audit. `status` says "no remote upload" in as
 * many words, which is a stronger statement than an absent command.
 *
 * Every command answers the same underlying question — *what does this tool
 * know about me* — and the answers are meant to be checkable rather than
 * reassuring.
 */

import { cliResult, STATUS, READINESS } from "./result.mjs";
import {
  readConfig, writeConfig, describeStore, readEvents, clearStore, applyRetention
} from "../observe/store.mjs";
import {
  defaultObservabilityConfig, resolveObservabilityConfig, validateObservabilityConfig,
  REFUSED_SETTINGS, REDACTION_LEVEL
} from "../observe/config.mjs";
import { REDACTION_RULES, NEVER_RECORDED } from "../observe/redact.mjs";
import { EVENT_SCHEMA_VERSION, ALL_EVENT_CLASSES } from "../observe/event.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/* ----------------------------------------------------- telemetry status */

export function cmdTelemetryStatus({ root = process.cwd() } = {}) {
  const operation = "telemetry-status";
  const config = readConfig(root);
  const store = describeStore(root, { config });

  const lines = [
    store.enabled
      ? "Local observability is ON. Events are written to this machine and sent nowhere."
      : "Local observability is OFF. No events are being recorded.",
    "",
    `Storage:            ${store.directory}`,
    `Events:             ${store.events}${store.corruptLines ? ` (${store.corruptLines} unreadable line(s))` : ""}`,
    `Files:              ${store.files}`,
    `Size:               ${formatBytes(store.bytes)} of ${formatBytes(store.maxTotalBytes)}`,
    `Retention:          ${store.retentionDays} day(s)`,
    `Redaction:          ${store.redactionLevel}`,
    `URL origins:        ${store.recordUrlOrigins ? "recorded" : "not recorded"}`,
    `Diagnostic export:  ${store.diagnosticExportAllowed ? "allowed" : "not allowed"}`,
    `Remote upload:      never — this build has no upload path`,
    `Event schema:       v${store.schemaVersion}`,
    `Last event:         ${store.lastEvent ? `${store.lastEvent.at} · ${store.lastEvent.eventClass}` : "none"}`,
    "",
    "Never recorded, at any setting:",
    ...NEVER_RECORDED.slice(0, 8).map((r) => `  - ${r.field}`),
    `  … ${NEVER_RECORDED.length} categories in total; see docs/PRIVACY.md`
  ];

  return cliResult({
    operation, status: STATUS.COMPLETED,
    summary: store.enabled
      ? `local observability on · ${store.events} event(s) · ${formatBytes(store.bytes)} · no remote upload`
      : "local observability off",
    readiness: READINESS.UNDETERMINED,
    readinessReason: "A report about this tool's own recording. It licenses nothing about a run.",
    detail: {
      ...store,
      statusText: lines.join("\n"),
      neverRecorded: NEVER_RECORDED,
      refusedSettings: REFUSED_SETTINGS,
      browserLaunched: false
    }
  });
}

/* ----------------------------------------------- telemetry enable/disable */

export function cmdTelemetryEnable({ root = process.cwd(), redactionLevel = null, recordUrlOrigins = false, allowExport = false } = {}) {
  const operation = "telemetry-enable";
  const current = readConfig(root);

  const proposed = {
    ...current,
    enabled: true,
    redactionLevel: redactionLevel ?? current.redactionLevel ?? REDACTION_LEVEL.HIGH,
    recordUrlOrigins: recordUrlOrigins === true,
    diagnosticExportAllowed: allowExport === true
  };

  const check = validateObservabilityConfig(proposed);
  if (!check.valid) {
    return cliResult({
      operation, status: STATUS.FAILED,
      errors: check.errors.map((e) => ({ code: "invalid-observability-config", message: e.message, recommendation: e.remedy })),
      readiness: READINESS.UNDETERMINED, readinessReason: "Nothing was changed."
    });
  }

  const resolved = resolveObservabilityConfig(proposed);
  const path = writeConfig(root, resolved);

  return cliResult({
    operation, status: STATUS.COMPLETED,
    summary: `local observability enabled at redaction \`${resolved.redactionLevel}\``,
    readiness: READINESS.UNDETERMINED,
    readinessReason: "Events are written to this machine only. Nothing is transmitted, and export remains a separate, explicit act.",
    artifacts: [{ kind: "config", path }],
    userActions: recordUrlOrigins
      ? [{
          what: "URL origins will now be recorded.",
          how: "Origins identify which sites were analysed. Run `bigaap telemetry disable` or re-enable without --record-origins to stop.",
          field: "recordUrlOrigins"
        }]
      : [],
    detail: { config: resolved, remoteUpload: false, browserLaunched: false }
  });
}

export function cmdTelemetryDisable({ root = process.cwd() } = {}) {
  const operation = "telemetry-disable";
  const config = { ...readConfig(root), enabled: false };
  const path = writeConfig(root, config);
  const store = describeStore(root, { config });

  return cliResult({
    operation, status: STATUS.COMPLETED,
    summary: "local observability disabled",
    readiness: READINESS.UNDETERMINED,
    readinessReason: "No further events will be recorded. Existing events are left in place — disabling is not deleting.",
    artifacts: [{ kind: "config", path }],
    userActions: store.events
      ? [{
          what: `${store.events} event(s) remain on disk.`,
          how: "Run `bigaap telemetry clear --confirm` to remove them. Disabling stops new recording; it does not delete what was recorded.",
          field: "existingEvents"
        }]
      : [],
    detail: { config, eventsRemaining: store.events, browserLaunched: false }
  });
}

/* ---------------------------------------------------- telemetry inspect */

/**
 * Shows what is actually stored.
 *
 * The point is auditability: an operator should be able to read every byte this
 * tool kept about them without a JSON viewer or a trust exercise.
 */
export function cmdTelemetryInspect({ root = process.cwd(), limit = 20 } = {}) {
  const operation = "telemetry-inspect";
  const config = readConfig(root);
  const { events, corrupt } = readEvents(root, { config });
  const shown = events.slice(-limit);

  return cliResult({
    operation,
    status: corrupt.length ? STATUS.COMPLETED_WITH_WARNINGS : STATUS.COMPLETED,
    warnings: corrupt.map((c) => ({
      code: "unreadable-event-line",
      message: `${c.file} line ${c.line ?? "?"} could not be parsed.`,
      recommendation: "The rest of the store is unaffected: one bad line costs one line. The file is left in place rather than repaired, because a diagnostic store that rewrites itself is not a record."
    })),
    summary: events.length
      ? `${events.length} event(s); showing the last ${shown.length}`
      : "no events are stored",
    readiness: READINESS.UNDETERMINED,
    readinessReason: "A report about this tool's own recording.",
    detail: {
      total: events.length,
      shown: shown.length,
      events: shown,
      corrupt,
      redactionLevel: config.redactionLevel,
      /* Stated so an inspector can confirm rather than assume. */
      everyEventRedactedOnWrite: true,
      browserLaunched: false
    }
  });
}

/* ------------------------------------------------------ telemetry clear */

export function cmdTelemetryClear({ root = process.cwd(), confirmed = false } = {}) {
  const operation = "telemetry-clear";
  const config = readConfig(root);
  const result = clearStore(root, { config, confirmed });

  if (!result.cleared) {
    return cliResult({
      operation, status: STATUS.REQUIRES_USER_INPUT,
      userActions: [{
        what: `Clear ${result.wouldRemove.length} file(s) from the local event store?`,
        how: "Re-run with --confirm. This also removes the hashing salt, which makes every previously-exported hash permanently ungroupable.",
        field: "confirm"
      }],
      summary: "clearing needs confirmation",
      readiness: READINESS.UNDETERMINED,
      readinessReason: "Nothing was removed.",
      detail: { wouldRemove: result.wouldRemove, browserLaunched: false }
    });
  }

  return cliResult({
    operation, status: STATUS.COMPLETED,
    summary: `${result.removed.length} file(s) removed${result.saltRemoved ? ", including the salt" : ""}`,
    readiness: READINESS.UNDETERMINED,
    readinessReason: "The local store is empty. Removing the salt means hashes in any earlier export can no longer be grouped, by anyone.",
    detail: { ...result, browserLaunched: false }
  });
}

/* ----------------------------------------------------- telemetry export */

/**
 * Writes a redacted diagnostic bundle.
 *
 * Two gates, and both are deliberate. Export must be **permitted** in
 * configuration and **confirmed** at the call — because willingness to keep
 * local diagnostics is a different decision from willingness to hand them to
 * somebody, and conflating the two is how data leaves a machine that its owner
 * never meant to share.
 */
export function cmdTelemetryExport({ root = process.cwd(), to = null, confirmed = false } = {}) {
  const operation = "telemetry-export";
  const config = readConfig(root);

  if (!config.diagnosticExportAllowed) {
    return cliResult({
      operation, status: STATUS.BLOCKED,
      blockers: [{
        code: "export-not-permitted", stage: "privacy-policy", severity: "blocking",
        message: "Diagnostic export is not allowed by this project's observability configuration.",
        recommendation: "Enable it deliberately with `bigaap telemetry enable --allow-export`. Keeping local diagnostics and sharing them are separate decisions.",
        recaptureResolves: false, impossibleForInputKind: false
      }],
      summary: "export is not permitted",
      readiness: READINESS.NOT_USABLE,
      readinessReason: "Nothing was written and nothing left this machine.",
      detail: { browserLaunched: false }
    });
  }
  if (!to) {
    return cliResult({
      operation, status: STATUS.REQUIRES_USER_INPUT,
      userActions: [{ what: "Say where to write the bundle.", how: "Pass --to <path>.", field: "to" }],
      summary: "no destination was given",
      readiness: READINESS.UNDETERMINED, readinessReason: "Nothing was written.",
      detail: { browserLaunched: false }
    });
  }
  if (!confirmed) {
    const store = describeStore(root, { config });
    return cliResult({
      operation, status: STATUS.REQUIRES_USER_INPUT,
      userActions: [{
        what: `Export ${store.events} redacted event(s) to ${to}?`,
        how: "Re-run with --confirm. Every event was redacted when it was written; the bundle contains no URLs beyond what your redaction level kept, no page content, no prompts and no credentials.",
        field: "confirm"
      }],
      summary: `${store.events} event(s) ready to export`,
      readiness: READINESS.UNDETERMINED, readinessReason: "Nothing was written.",
      detail: { events: store.events, redactionLevel: store.redactionLevel, browserLaunched: false }
    });
  }

  const { events, corrupt } = readEvents(root, { config });
  const bundle = {
    $schemaVersion: EVENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    redactionLevel: config.redactionLevel,
    eventCount: events.length,
    corruptLinesSkipped: corrupt.length,
    /* Stated in the bundle itself, for whoever receives it. */
    contains: "Redacted local diagnostic events: durations, status codes, blocker and error categories, artifact kinds, versions and hashes.",
    doesNotContain: NEVER_RECORDED.map((r) => r.field),
    redactionRules: REDACTION_RULES,
    saltIsLocal: "Hashes are salted per project with a salt that never leaves the machine. Hashes in this bundle cannot be correlated with hashes from another project.",
    events
  };

  const path = resolve(to);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

  return cliResult({
    operation, status: STATUS.COMPLETED,
    summary: `${events.length} redacted event(s) written to ${path}`,
    readiness: READINESS.UNDETERMINED,
    readinessReason: "The bundle was written to a local path you chose. Nothing was transmitted; sharing it is your decision and your action.",
    artifacts: [{ kind: "diagnostic-bundle", path }],
    detail: {
      path, eventCount: events.length,
      redactionLevel: config.redactionLevel,
      containsOnlyRedactedEvents: true,
      transmitted: false,
      browserLaunched: false
    }
  });
}

/* -------------------------------------------------- telemetry retention */

export function cmdTelemetryRetention({ root = process.cwd() } = {}) {
  const operation = "telemetry-retention";
  const config = readConfig(root);
  const result = applyRetention(root, { config });

  return cliResult({
    operation, status: STATUS.COMPLETED,
    summary: result.removed.length
      ? `${result.removed.length} file(s) removed by retention`
      : "nothing was outside the retention limits",
    readiness: READINESS.UNDETERMINED,
    readinessReason: "Every removal is listed. Retention never removes anything silently.",
    detail: { ...result, browserLaunched: false }
  });
}

const formatBytes = (n) => {
  if (!Number.isFinite(n)) return "unbounded";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

export { ALL_EVENT_CLASSES, defaultObservabilityConfig };

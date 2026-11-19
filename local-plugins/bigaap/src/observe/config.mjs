/**
 * Observability configuration.
 *
 * Every default here answers the same question the same way: *if the operator
 * has not said, assume they would rather record less.*
 *
 * So observability is **off** until enabled, remote upload does not exist as a
 * setting, redaction starts at `high`, retention is bounded, and no
 * configuration value can turn on the recording of secrets or page content.
 * That last one is enforced rather than promised: the never-record list is not
 * reachable from configuration at all.
 */

import { REDACTION_LEVEL } from "./redact.mjs";
import { ALL_EVENT_CLASSES } from "./event.mjs";

export const CONFIG_VERSION = "1";

/** Where events live. Deliberately not inside the analysis workspace. */
export const OBSERVABILITY_DIR = ".bigaap-observability";

/**
 * The defaults.
 *
 * `enabled: false` is the important one. A tool that starts recording because
 * it was installed has made the decision for the operator, and the decision is
 * theirs.
 */
export function defaultObservabilityConfig() {
  return {
    schemaVersion: CONFIG_VERSION,

    /* Off until somebody says otherwise. */
    enabled: false,

    /* Not a setting. There is no remote endpoint in this build, and this field
     * exists so that `bigaap telemetry status` can state the fact rather than
     * leaving a reader to trust an absence. */
    remoteUpload: false,
    remoteEndpoint: null,

    directory: OBSERVABILITY_DIR,
    redactionLevel: REDACTION_LEVEL.HIGH,

    /* Bounded by default, in both time and space. An unbounded local log is a
     * disclosure risk that grows on its own. */
    retentionDays: 30,
    maxTotalBytes: 5 * 1024 * 1024,
    maxFileBytes: 512 * 1024,
    /* Enforced by `applyRetention`, oldest-first, alongside the age and size
     * limits. */
    maxFiles: 20,

    /* Off. Recording which origins were analysed is a real privacy decision and
     * belongs to the operator, not to a default. */
    recordUrlOrigins: false,

    /* Export is a separate permission from recording. Being willing to keep
     * local diagnostics is not the same as being willing to hand them over. */
    diagnosticExportAllowed: false,

    eventCategories: [...ALL_EVENT_CLASSES],

    /* Off by default. When on, an event gains the exception's CLASS and the
     * DEPTH of its stack — never the message and never a frame, because a
     * message can quote page text and a frame carries a filesystem path. That
     * is the whole of what this setting does; it cannot widen collection past
     * the boundary. */
    verboseErrors: false,

    $kind: "user-preference",
    $note:
      "Nothing here can enable the recording of secrets, credentials, page content, " +
      "screenshots, prompts or target briefs. Those are excluded structurally rather " +
      "than by setting, so no configuration mistake can turn them on."
  };
}

/**
 * Settings that do not exist, and why.
 *
 * Named explicitly so that a reader looking for them finds a decision rather
 * than an omission. A missing setting reads as an oversight; a refused one
 * reads as a boundary.
 */
export const REFUSED_SETTINGS = Object.freeze([
  { setting: "recordScreenshots", why: "An image of the page is the page. No redaction makes one safe to keep." },
  { setting: "recordPageContent", why: "Page copy is the user's or a third party's content." },
  { setting: "recordPrompts", why: "A prompt embeds measured values, brief requirements and product decisions at once." },
  { setting: "recordTargetBrief", why: "The brief describes an unreleased product; it is the most commercially sensitive input this tool takes." },
  { setting: "recordCredentials", why: "Never, at any setting, under any name." },
  { setting: "remoteEndpoint", why: "There is no upload path in this build. The field is reported as `false` rather than being configurable, so the absence is visible." }
]);

/**
 * Keys refused by NAME.
 *
 * `remoteEndpoint` is deliberately not among them: the default config carries
 * it as `null` so that `telemetry status` can report the absence of an upload
 * path as a stated fact rather than leaving a reader to trust a missing field.
 * Refusing the key outright made the default config fail its own validation.
 * It is refused by VALUE instead — present and null is a statement; present and
 * set is an attempt.
 */
const REFUSED = new Set(REFUSED_SETTINGS.map((r) => r.setting).filter((k) => k !== "remoteEndpoint"));

/**
 * Validates a configuration and refuses anything that would widen collection
 * beyond the boundary.
 *
 * A refused key is an error rather than a silently-ignored field: a config
 * that appears to enable screenshot recording and quietly does not is worse
 * than one that fails, because the operator believes something false.
 */
export function validateObservabilityConfig(config) {
  const errors = [];
  const add = (field, message, remedy) => errors.push({ field, message, remedy });

  if (!config || typeof config !== "object") {
    return { valid: false, errors: [{ field: null, message: "not a configuration object", remedy: "Start from defaultObservabilityConfig()." }] };
  }

  for (const key of Object.keys(config)) {
    if (REFUSED.has(key)) {
      const refusal = REFUSED_SETTINGS.find((r) => r.setting === key);
      add(key, `\`${key}\` is not a setting and cannot be enabled.`, refusal.why);
    }
  }
  if (config.remoteUpload === true || config.remoteEndpoint) {
    add("remoteUpload",
      "This build has no upload path.",
      "Nothing is sent anywhere. `bigaap telemetry export` writes a file you choose to share yourself.");
  }
  if (config.redactionLevel && !Object.values(REDACTION_LEVEL).includes(config.redactionLevel)) {
    add("redactionLevel", `\`${config.redactionLevel}\` is not a redaction level.`,
      `Use one of: ${Object.values(REDACTION_LEVEL).join(", ")}.`);
  }
  if (config.retentionDays != null && (!Number.isFinite(config.retentionDays) || config.retentionDays <= 0)) {
    add("retentionDays", "must be a positive number of days.",
      "Unbounded retention is a disclosure risk that grows on its own.");
  }
  if (config.maxTotalBytes != null && (!Number.isFinite(config.maxTotalBytes) || config.maxTotalBytes <= 0)) {
    add("maxTotalBytes", "must be a positive size.", "An unbounded local log fills a disk and keeps data nobody meant to keep.");
  }
  for (const category of config.eventCategories ?? []) {
    if (!ALL_EVENT_CLASSES.includes(category)) {
      add("eventCategories", `\`${category}\` is not an event class.`,
        `Use any of: ${ALL_EVENT_CLASSES.join(", ")}.`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Merges a user configuration over the defaults.
 *
 * Refused keys are dropped rather than merged, so a configuration that tries to
 * enable something impossible produces a valid config with that key absent —
 * and `validateObservabilityConfig` reports it separately. The two are kept
 * apart so a bad key cannot silently disable observability entirely.
 */
export function resolveObservabilityConfig(user = {}, { projectPolicyAllows = true } = {}) {
  const defaults = defaultObservabilityConfig();
  const merged = { ...defaults };

  for (const [key, value] of Object.entries(user ?? {})) {
    if (REFUSED.has(key)) continue;
    if (key === "remoteUpload" || key === "remoteEndpoint") continue;
    merged[key] = value;
  }

  /* Project policy can only ever narrow. A project that forbids observability
   * is not overridden by a user preference that wants it. */
  if (!projectPolicyAllows) {
    merged.enabled = false;
    merged.$disabledBy = "project policy";
  }
  merged.remoteUpload = false;
  merged.remoteEndpoint = null;
  return merged;
}

export { REDACTION_LEVEL };

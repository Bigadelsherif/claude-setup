/**
 * The local event store.
 *
 * Append-only JSONL, in a directory that is deliberately **not** inside the
 * analysis workspace. That separation is the point of the whole module: a
 * corrupt event file must not be able to damage evidence, and a workspace
 * copied or shared must not carry diagnostics with it.
 *
 * Three properties, each with a failure it exists to prevent:
 *
 *   - **Append-only.** Events are written with `appendFileSync` and nothing
 *     rewrites a line. A store that edited in place could silently lose the
 *     event that explained a failure.
 *   - **Line-isolated corruption.** One unparseable line costs that line. The
 *     reader reports it and keeps going, because a diagnostic store that
 *     becomes unreadable at the first bad byte is a diagnostic store that fails
 *     exactly when something has gone wrong.
 *   - **Nothing is deleted silently.** Rotation renames; retention reports what
 *     it removed and why. An event that vanishes without a trace is
 *     indistinguishable from one that was never written.
 */

import {
  appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync,
  readdirSync, statSync, renameSync, unlinkSync
} from "node:fs";
import { join } from "node:path";
import { EVENT_SCHEMA_VERSION, validateEvent, migrateEvent } from "./event.mjs";
import { redactEvent, newSalt, REDACTION_LEVEL, PRIVACY_CLASS } from "./redact.mjs";
import { defaultObservabilityConfig, OBSERVABILITY_DIR } from "./config.mjs";

const CURRENT_FILE = "events.jsonl";
const SALT_FILE = "salt";
const CONFIG_FILE = "config.json";

const dirFor = (root, config) => join(root, config?.directory ?? OBSERVABILITY_DIR);

/**
 * The per-project salt, created once.
 *
 * Stored beside the events so that `clear` removes both — which is what makes
 * clearing meaningful: without the salt, every previously-exported hash becomes
 * permanently ungroupable rather than merely deleted locally.
 */
export function readOrCreateSalt(root, config = defaultObservabilityConfig()) {
  const dir = dirFor(root, config);
  const path = join(dir, SALT_FILE);
  if (existsSync(path)) {
    try { return readFileSync(path, "utf8").trim(); } catch { /* fall through and re-create */ }
  }
  mkdirSync(dir, { recursive: true });
  const salt = newSalt();
  writeFileSync(path, `${salt}\n`, "utf8");
  return salt;
}

/** Reads the stored config, falling back to defaults. */
export function readConfig(root) {
  const path = join(root, OBSERVABILITY_DIR, CONFIG_FILE);
  if (!existsSync(path)) return defaultObservabilityConfig();
  try {
    return { ...defaultObservabilityConfig(), ...JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return defaultObservabilityConfig();
  }
}

export function writeConfig(root, config) {
  const dir = dirFor(root, config);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return join(dir, CONFIG_FILE);
}

/**
 * Records one event.
 *
 * Redaction happens **here**, on the way to disk, and nowhere else. One place
 * where a value can escape means one place to check, and it means a command
 * that forgets to redact cannot leak — because a command has no way to write an
 * event except through this function.
 */
export function recordEvent(root, event, { config = null, salt = null, projectRoot = null } = {}) {
  const settings = config ?? readConfig(root);

  if (!settings.enabled) {
    return { recorded: false, reason: "observability is disabled", enabled: false };
  }
  if (settings.eventCategories && !settings.eventCategories.includes(event.eventClass)) {
    return { recorded: false, reason: `\`${event.eventClass}\` is not an enabled category`, enabled: true };
  }

  const structural = validateEvent(event);
  if (!structural.valid) {
    return { recorded: false, reason: `invalid event: ${structural.errors.map((e) => e.field).join(", ")}`, errors: structural.errors };
  }

  const effectiveSalt = salt ?? readOrCreateSalt(root, settings);
  const level = settings.recordUrlOrigins && settings.redactionLevel === REDACTION_LEVEL.HIGH
    ? REDACTION_LEVEL.BALANCED
    : settings.redactionLevel;

  const { event: redacted, redactionApplied, omittedCount, omittedReasons } =
    redactEvent(event, { level, salt: effectiveSalt, projectRoot });

  const line = {
    ...redacted,
    privacyClassification: level === REDACTION_LEVEL.HIGH ? PRIVACY_CLASS.HASHED : PRIVACY_CLASS.ORIGIN_ONLY,
    redactionApplied,
    omittedCount,
    omittedReasons
  };

  const dir = dirFor(root, settings);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, CURRENT_FILE);

  appendFileSync(path, `${JSON.stringify(line)}\n`, "utf8");

  /* Rotation is checked after the write, so an event is never lost to a size
   * limit it was the one to cross. */
  const rotation = rotateIfNeeded(root, settings);
  return { recorded: true, path, event: line, rotation };
}

/**
 * Reads every event, reporting corruption rather than dying on it.
 *
 * A store that becomes unreadable at the first bad line fails exactly when
 * something has gone wrong — which is the only time anybody reads it.
 */
export function readEvents(root, { config = null, includeRotated = true } = {}) {
  const settings = config ?? readConfig(root);
  const dir = dirFor(root, settings);
  if (!existsSync(dir)) return { events: [], corrupt: [], files: [] };

  let files = [];
  try {
    files = readdirSync(dir)
      .filter((f) => f === CURRENT_FILE || (includeRotated && /^events\.\d+\.jsonl$/.test(f)))
      .sort();
  } catch {
    return { events: [], corrupt: [], files: [] };
  }

  const events = [];
  const corrupt = [];

  for (const file of files) {
    let text = "";
    try { text = readFileSync(join(dir, file), "utf8"); } catch (error) {
      corrupt.push({ file, line: null, why: `unreadable: ${error.message}` });
      continue;
    }
    text.split("\n").forEach((raw, index) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      try {
        const parsed = JSON.parse(trimmed);
        const { event, migrated, reason } = migrateEvent(parsed);
        events.push(migrated ? { ...event, $migrated: reason } : event);
      } catch {
        /* One bad line costs one line. */
        corrupt.push({ file, line: index + 1, why: "not parseable as JSON" });
      }
    });
  }
  return { events, corrupt, files };
}

/**
 * Rotates the current file when it exceeds the per-file limit.
 *
 * Rotation **renames**; it never truncates. The rotated file keeps every event
 * it held, and retention is the only thing that removes anything — separately,
 * and with a report.
 */
export function rotateIfNeeded(root, config = null) {
  const settings = config ?? readConfig(root);
  const dir = dirFor(root, settings);
  const path = join(dir, CURRENT_FILE);
  if (!existsSync(path)) return { rotated: false };

  let size = 0;
  try { size = statSync(path).size; } catch { return { rotated: false }; }
  if (size < (settings.maxFileBytes ?? Infinity)) return { rotated: false, size };

  const existing = readdirSync(dir).filter((f) => /^events\.\d+\.jsonl$/.test(f));
  const next = String(existing.length + 1).padStart(4, "0");
  const target = join(dir, `events.${next}.jsonl`);
  renameSync(path, target);

  return { rotated: true, from: CURRENT_FILE, to: `events.${next}.jsonl`, size };
}

/**
 * Applies retention, reporting every removal.
 *
 * Two limits, applied oldest-first: age and total size. Nothing is removed
 * without appearing in the returned report — a rotation that quietly dropped
 * the events explaining a failure would defeat the purpose of keeping any.
 */
export function applyRetention(root, { config = null, now = Date.now() } = {}) {
  const settings = config ?? readConfig(root);
  const dir = dirFor(root, settings);
  if (!existsSync(dir)) return { removed: [], kept: [], reason: "nothing stored" };

  const files = readdirSync(dir)
    .filter((f) => /^events(\.\d+)?\.jsonl$/.test(f) && f !== CURRENT_FILE)
    .map((f) => {
      const path = join(dir, f);
      let stat = null;
      try { stat = statSync(path); } catch { /* removed under us */ }
      return { file: f, path, size: stat?.size ?? 0, mtime: stat?.mtimeMs ?? 0 };
    })
    .sort((a, b) => a.mtime - b.mtime);

  const removed = [];
  const kept = [];
  const maxAge = (settings.retentionDays ?? 30) * 24 * 60 * 60 * 1000;

  for (const entry of files) {
    if (now - entry.mtime > maxAge) {
      try { unlinkSync(entry.path); removed.push({ ...entry, why: `older than ${settings.retentionDays} day(s)` }); }
      catch { kept.push({ ...entry, why: "could not be removed" }); }
    } else {
      kept.push(entry);
    }
  }

  /* Then count: more rotated files than `maxFiles` means the oldest go, oldest
   * first. Enforced rather than merely configured — a limit that is written
   * down and not applied is worse than no limit, because it is read as a
   * guarantee. */
  const maxFiles = settings.maxFiles ?? Infinity;
  const overCount = Math.max(0, kept.length - maxFiles);
  if (overCount > 0) {
    for (const entry of kept.slice(0, overCount)) {
      try {
        unlinkSync(entry.path);
        removed.push({ ...entry, why: `more than ${maxFiles} rotated file(s) were kept` });
      } catch { /* left in place; it will be reported as kept below */ }
    }
  }
  const afterCount = kept.filter((e) => !removed.some((r) => r.path === e.path));

  /* Then size, oldest first among what survived the age and count checks. */
  let total = afterCount.reduce((sum, e) => sum + e.size, 0);
  const currentPath = join(dir, CURRENT_FILE);
  if (existsSync(currentPath)) { try { total += statSync(currentPath).size; } catch { /* ignore */ } }

  const limit = settings.maxTotalBytes ?? Infinity;
  const stillKept = [];
  for (const entry of afterCount) {
    if (total > limit) {
      try { unlinkSync(entry.path); removed.push({ ...entry, why: `total size ${total} exceeded the ${limit}-byte limit` }); total -= entry.size; }
      catch { stillKept.push(entry); }
    } else {
      stillKept.push(entry);
    }
  }

  return {
    removed,
    kept: stillKept,
    totalBytes: total,
    limitBytes: limit,
    /* Stated rather than implied: a caller reporting retention needs to be able
     * to say that nothing went missing quietly. */
    everyRemovalReported: true
  };
}

/** What the store currently holds. */
export function describeStore(root, { config = null } = {}) {
  const settings = config ?? readConfig(root);
  const dir = dirFor(root, settings);
  const present = existsSync(dir);

  let files = [];
  let bytes = 0;
  if (present) {
    try {
      files = readdirSync(dir).filter((f) => /\.jsonl$/.test(f));
      for (const f of files) { try { bytes += statSync(join(dir, f)).size; } catch { /* ignore */ } }
    } catch { /* unreadable directory reports as empty rather than throwing */ }
  }

  const { events, corrupt } = present ? readEvents(root, { config: settings }) : { events: [], corrupt: [] };
  const last = events[events.length - 1] ?? null;

  return {
    enabled: settings.enabled,
    directory: dir,
    exists: present,
    files: files.length,
    events: events.length,
    corruptLines: corrupt.length,
    bytes,
    retentionDays: settings.retentionDays,
    maxTotalBytes: settings.maxTotalBytes,
    redactionLevel: settings.redactionLevel,
    recordUrlOrigins: settings.recordUrlOrigins,
    diagnosticExportAllowed: settings.diagnosticExportAllowed,
    remoteUpload: false,
    remoteEndpoint: null,
    schemaVersion: EVENT_SCHEMA_VERSION,
    lastEvent: last ? { at: last.at, eventClass: last.eventClass, command: last.command, status: last.status } : null
  };
}

/**
 * Removes every event and the salt.
 *
 * The salt going too is what makes this meaningful. Without it, hashes in any
 * previously-exported diagnostic become permanently ungroupable rather than
 * merely deleted from this machine.
 */
export function clearStore(root, { config = null, confirmed = false } = {}) {
  const settings = config ?? readConfig(root);
  const dir = dirFor(root, settings);

  if (!confirmed) {
    return {
      cleared: false,
      requiresConfirmation: true,
      reason: "Clearing is irreversible and removes the salt as well as the events.",
      wouldRemove: existsSync(dir) ? readdirSync(dir) : []
    };
  }
  if (!existsSync(dir)) return { cleared: true, removed: [], reason: "nothing was stored" };

  const removed = [];
  for (const file of readdirSync(dir)) {
    if (!/\.jsonl$/.test(file) && file !== SALT_FILE) continue;
    try { unlinkSync(join(dir, file)); removed.push(file); } catch { /* best effort */ }
  }
  return { cleared: true, removed, saltRemoved: removed.includes(SALT_FILE) };
}

export { CURRENT_FILE, SALT_FILE, CONFIG_FILE, OBSERVABILITY_DIR };

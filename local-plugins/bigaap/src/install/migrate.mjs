/**
 * Versioned migrations.
 *
 * A migration exists to make an older file readable by this build. That is its
 * entire remit, and the boundary is sharper than it sounds:
 *
 * **A migration may add. It may rename. It must never reinterpret.**
 *
 * Renaming a field is safe because the value survives unchanged. Reinterpreting
 * one is not: if an old build wrote `status: "ok"` meaning "the command
 * finished" and a new build reads `completed` as "the command finished AND
 * produced usable evidence", then migrating `ok` to `completed` silently
 * upgrades a claim nobody made. Every migration below either adds a field that
 * was absent or moves a value to a new name. None changes what a value means,
 * and the two that were tempting — correction status and evidence provenance —
 * are documented as deliberately absent at the bottom of this file.
 *
 * ## Correction records and evidence are special
 *
 * They are history. A correction record says what someone believed on a date;
 * an evidence entry says what was measured. Neither becomes false when the tool
 * changes, so neither is ever rewritten. Where an old correction record lacks a
 * field this build expects, the field is added with a value that says *this was
 * not recorded* — never with a value inferred from the rest of the record.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";

import { CONFIG_SCHEMA_VERSION } from "../cli/project.mjs";
import { CONFIG_VERSION as OBSERVABILITY_CONFIG_VERSION } from "../observe/config.mjs";
import { METADATA_VERSION } from "../artifacts/metadata.mjs";

/** What a migration touches. Used to group the report and to scope `--only`. */
export const MIGRATION_KIND = Object.freeze({
  PROJECT_CONFIG: "project-config",
  TARGET_BRIEF: "target-brief",
  OBSERVABILITY_CONFIG: "observability-config",
  CORRECTION_RECORD: "correction-record",
  ARTIFACT_METADATA: "artifact-metadata",
  COMMAND_CATALOG: "command-catalog",
  SCHEMA: "schema",
  STATUS_VOCABULARY: "status-vocabulary",
  CORRECTION_ID: "correction-id",
  OUTPUT_FORMAT: "output-format"
});

/**
 * The legacy status vocabulary.
 *
 * These are the words earlier builds used. The mapping is a **rename**, not a
 * reinterpretation: each old word had exactly one meaning and that meaning
 * survives. The two that do NOT appear here are the important ones —
 * `"error"` is absent because it was used for both `failed` and `blocked`
 * depending on the caller, and guessing which would fabricate the distinction
 * the whole result contract exists to preserve.
 */
export const LEGACY_STATUS = Object.freeze({
  ok: "completed",
  success: "completed",
  done: "completed",
  warn: "completed-with-warnings",
  warning: "completed-with-warnings",
  refused: "blocked",
  skipped: "not-attempted",
  aborted: "cancelled",
  needs_input: "requires-user-input",
  "needs-input": "requires-user-input"
});

/** Legacy statuses that are deliberately NOT migrated, and why. */
export const UNMIGRATABLE_STATUS = Object.freeze({
  error: "used for both `failed` and `blocked` by different callers; migrating it would invent a distinction that was never recorded",
  fail: "same ambiguity as `error`",
  incomplete: "used for both `cancelled` and `requires-user-input`; the two need opposite actions"
});

/**
 * One migration.
 *
 * `detect` decides whether it applies, `apply` returns the new data plus a list
 * of what changed. `reverse` is present only where the change is genuinely
 * invertible — an added field can be removed, but a rename whose old name was
 * ambiguous cannot be undone without guessing, and a reverse that guesses is
 * worse than no reverse.
 */
const migration = (spec) => Object.freeze({ reversible: false, reverse: null, ...spec });

export const MIGRATIONS = Object.freeze([
  migration({
    id: "m001-project-config-schema-version",
    kind: MIGRATION_KIND.PROJECT_CONFIG,
    from: null,
    to: CONFIG_SCHEMA_VERSION,
    describe: "Adds `schemaVersion` to a project.json written before the field existed.",
    detect: (d) => d != null && typeof d === "object" && d.schemaVersion == null && d.projectId != null,
    apply: (d) => ({
      data: { ...d, schemaVersion: CONFIG_SCHEMA_VERSION },
      changes: [`added schemaVersion: "${CONFIG_SCHEMA_VERSION}"`]
    }),
    reversible: true,
    reverse: (d) => { const { schemaVersion, ...rest } = d; return { data: rest, changes: ["removed schemaVersion"] }; }
  }),

  migration({
    id: "m002-project-config-bigaap-version-placeholder",
    kind: MIGRATION_KIND.PROJECT_CONFIG,
    from: null,
    to: CONFIG_SCHEMA_VERSION,
    describe: "Replaces the fabricated bigaapVersion `0.0.0` with null (def_0039).",
    /* `0.0.0` was never a released version. It is the value a swallowed
     * TypeError produced, so every project carrying it recorded a version that
     * does not exist. Null says "not recorded", which is the truth. This is a
     * rename of meaning-nothing to says-nothing, not a reinterpretation. */
    detect: (d) => d != null && typeof d === "object" && d.bigaapVersion === "0.0.0",
    apply: (d) => ({
      data: { ...d, bigaapVersion: null },
      changes: ["bigaapVersion \"0.0.0\" -> null (0.0.0 was never released; it was a swallowed read error)"]
    }),
    reversible: false
  }),

  migration({
    id: "m003-observability-config-version",
    kind: MIGRATION_KIND.OBSERVABILITY_CONFIG,
    from: null,
    to: OBSERVABILITY_CONFIG_VERSION,
    describe: "Adds `configVersion` to an observability config written before it was versioned.",
    detect: (d) => d != null && typeof d === "object" && d.configVersion == null && d.enabled !== undefined,
    apply: (d) => ({
      data: { ...d, configVersion: OBSERVABILITY_CONFIG_VERSION },
      changes: [`added configVersion: "${OBSERVABILITY_CONFIG_VERSION}"`]
    }),
    reversible: true,
    reverse: (d) => { const { configVersion, ...rest } = d; return { data: rest, changes: ["removed configVersion"] }; }
  }),

  migration({
    id: "m004-correction-record-schema-version",
    kind: MIGRATION_KIND.CORRECTION_RECORD,
    from: "0",
    to: "1",
    describe: "Marks an unversioned correction record as version 0 without altering a single other field.",
    /* Additive and nothing else. The record's claim, value, status, reason and
     * date are history — what someone asserted on a day — and this build has no
     * standing to restate any of it. */
    detect: (d) => d != null && typeof d === "object" && d.schemaVersion == null && d.claim != null,
    apply: (d) => ({
      data: { ...d, schemaVersion: "0", $migrationNote: "read as schema version 0; no field was altered" },
      changes: ["recorded schemaVersion: \"0\" — every other field is untouched"]
    }),
    reversible: true,
    reverse: (d) => {
      const { schemaVersion, $migrationNote, ...rest } = d;
      return { data: rest, changes: ["removed the version marker"] };
    }
  }),

  migration({
    id: "m005-correction-id-format",
    kind: MIGRATION_KIND.CORRECTION_ID,
    from: "numeric",
    to: "corr_NNNN",
    describe: "Records the canonical form of a bare-numeric correction id alongside the original.",
    /* The original id is KEPT. A correction is referenced by id from history,
     * from artifact metadata and from a user's notes; rewriting it would break
     * every one of those references to satisfy a formatting preference. The
     * canonical form is added next to it and the old one remains authoritative. */
    detect: (d) => d != null && typeof d === "object" && typeof d.id === "string" && /^\d+$/.test(d.id),
    apply: (d) => ({
      data: { ...d, canonicalId: `corr_${String(d.id).padStart(4, "0")}`, $originalId: d.id },
      changes: [`added canonicalId corr_${String(d.id).padStart(4, "0")}; \`id\` is unchanged and remains the reference`]
    }),
    reversible: true,
    reverse: (d) => {
      const { canonicalId, $originalId, ...rest } = d;
      return { data: rest, changes: ["removed the canonical-id annotation"] };
    }
  }),

  migration({
    id: "m006-artifact-metadata-version",
    kind: MIGRATION_KIND.ARTIFACT_METADATA,
    from: null,
    to: METADATA_VERSION,
    describe: "Adds `metadataVersion` to an artifact metadata block written before it was versioned.",
    detect: (d) => d != null && typeof d === "object" && d.metadataVersion == null && d.irHash != null,
    apply: (d) => ({
      data: { ...d, metadataVersion: METADATA_VERSION },
      changes: [`added metadataVersion: "${METADATA_VERSION}"`]
    }),
    reversible: true,
    reverse: (d) => { const { metadataVersion, ...rest } = d; return { data: rest, changes: ["removed metadataVersion"] }; }
  }),

  migration({
    id: "m007-legacy-status-vocabulary",
    kind: MIGRATION_KIND.STATUS_VOCABULARY,
    from: "legacy",
    to: "cli-result-1",
    describe: "Renames an unambiguous legacy status word to its current name. Ambiguous ones are refused.",
    detect: (d) => d != null && typeof d === "object" && typeof d.status === "string" &&
      (LEGACY_STATUS[d.status] != null || UNMIGRATABLE_STATUS[d.status] != null),
    apply: (d) => {
      if (UNMIGRATABLE_STATUS[d.status]) {
        return {
          data: d,
          changes: [],
          refused: `\`${d.status}\` is not migrated: ${UNMIGRATABLE_STATUS[d.status]}`
        };
      }
      const to = LEGACY_STATUS[d.status];
      return {
        data: { ...d, status: to, $legacyStatus: d.status },
        changes: [`status "${d.status}" -> "${to}" (a rename; the original is kept as $legacyStatus)`]
      };
    },
    reversible: true,
    reverse: (d) => {
      if (d.$legacyStatus == null) return { data: d, changes: [] };
      const { $legacyStatus, ...rest } = d;
      return { data: { ...rest, status: $legacyStatus }, changes: [`status restored to "${$legacyStatus}"`] };
    }
  }),

  migration({
    id: "m008-output-format-ir-hash-header",
    kind: MIGRATION_KIND.OUTPUT_FORMAT,
    from: "unstamped",
    to: "ir-hash-stamped",
    describe: "Reports a generated markdown artifact that predates the `bigaap:ir-hash` stamp.",
    /* Reports rather than rewrites. The stamp records which IR an artifact was
     * projected from, and this build cannot know that for a file written before
     * the stamp existed. Writing one would assert a provenance nobody can check
     * — the exact failure the stamp exists to prevent. */
    detect: (text) => typeof text === "string" && text.startsWith("#") && !text.includes("bigaap:ir-hash"),
    apply: (text) => ({
      data: text,
      changes: [],
      refused: "This artifact predates the IR-hash stamp. It is left as it is: the stamp records which IR the file was projected from, and inventing one would assert a provenance that cannot be checked. Re-run the analysis to regenerate it."
    }),
    reversible: false
  })
]);

export const MIGRATION_IDS = Object.freeze(MIGRATIONS.map((m) => m.id));

/**
 * Plans the migrations that apply to one piece of data.
 *
 * Planning is separate from applying so that `bigaap migrations` can report what
 * WOULD happen without touching anything — the dry run is the default because a
 * migration that surprises you has already run.
 */
export function planFor(data, { kinds = null } = {}) {
  const planned = [];
  for (const m of MIGRATIONS) {
    if (kinds && !kinds.includes(m.kind)) continue;
    let applies = false;
    try { applies = m.detect(data) === true; } catch { applies = false; }
    if (applies) planned.push(m);
  }
  return planned;
}

/**
 * Applies migrations to one piece of data, in registry order.
 *
 * Deterministic: the registry order is fixed, each migration is a pure function
 * of its input, and nothing consults a clock or the filesystem. Running this
 * twice over the same input produces the same output, and running it over its
 * own output is a no-op — every `detect` tests for the absence of what its
 * `apply` adds, so a migrated record no longer matches.
 */
export function applyMigrations(data, { kinds = null } = {}) {
  const log = [];
  const refusals = [];
  let current = data;

  for (const m of planFor(data, { kinds })) {
    let out;
    try { out = m.apply(current); }
    catch (error) {
      refusals.push({ id: m.id, kind: m.kind, why: `the migration threw: ${error.message}` });
      continue;
    }
    if (out.refused) {
      refusals.push({ id: m.id, kind: m.kind, why: out.refused });
      continue;
    }
    current = out.data;
    log.push({ id: m.id, kind: m.kind, describe: m.describe, changes: out.changes, reversible: m.reversible });
  }

  return { data: current, migrated: log.length > 0, log, refusals };
}

/** Reverses a migration by id, where it is reversible. */
export function reverseMigration(id, data) {
  const m = MIGRATIONS.find((x) => x.id === id);
  if (!m) return { ok: false, why: `\`${id}\` is not a migration`, data };
  if (!m.reversible || !m.reverse) {
    return { ok: false, why: `${id} is not reversible: ${m.describe} Reversing it would require guessing at what was there before.`, data };
  }
  const out = m.reverse(data);
  return { ok: true, data: out.data, changes: out.changes };
}

/* ------------------------------------------------------ file-level driver */

/**
 * Migrates a JSON file on disk, keeping a backup.
 *
 * The backup is written before the file is touched and its path is returned, so
 * a migration is undoable even where the migration itself is not reversible.
 * `dryRun` is the default at the CLI: nothing here is destructive, but a file
 * changing underneath a user who only asked what would happen is its own kind
 * of damage.
 */
export function migrateFile(path, { kinds = null, dryRun = true, backupDir = null } = {}) {
  if (!existsSync(path)) return { path, status: "missing", migrated: false, log: [], refusals: [] };

  let raw;
  try { raw = readFileSync(path, "utf8"); }
  catch (error) { return { path, status: "unreadable", migrated: false, log: [], refusals: [{ why: error.message }] }; }

  let data;
  try { data = JSON.parse(raw); }
  catch { return { path, status: "not-json", migrated: false, log: [], refusals: [{ why: "not parseable as JSON; left untouched" }] }; }

  const result = applyMigrations(data, { kinds });
  if (!result.migrated) {
    return { path, status: result.refusals.length ? "refused" : "current", migrated: false, log: [], refusals: result.refusals };
  }
  if (dryRun) {
    return { path, status: "would-migrate", migrated: false, log: result.log, refusals: result.refusals, backup: null };
  }

  let backup = null;
  if (backupDir) {
    backup = join(backupDir, `${Date.now()}-${path.replace(/[\\/:]/g, "_")}`);
    mkdirSync(dirname(backup), { recursive: true });
    copyFileSync(path, backup);
  }
  writeFileSync(path, JSON.stringify(result.data, null, 2) + "\n", "utf8");
  return { path, status: "migrated", migrated: true, log: result.log, refusals: result.refusals, backup };
}

/**
 * Migrates a whole project or workspace.
 *
 * Walks only the locations this build knows the shape of. It does not go
 * looking for JSON anywhere else: a migration that wandered into a directory
 * and rewrote whatever parsed would eventually rewrite something it did not
 * understand.
 */
export function migrateTree(root, { dryRun = true, backupDir = null } = {}) {
  const targets = [
    { rel: join(".bigaap-analyzer", "project.json"), kinds: [MIGRATION_KIND.PROJECT_CONFIG] },
    { rel: join(".bigaap-analyzer", "preferences.json"), kinds: [MIGRATION_KIND.PROJECT_CONFIG] },
    { rel: join(".bigaap-observability", "config.json"), kinds: [MIGRATION_KIND.OBSERVABILITY_CONFIG] }
  ];

  const results = [];
  for (const t of targets) results.push(migrateFile(join(root, t.rel), { kinds: t.kinds, dryRun, backupDir }));

  /* Correction records, wherever the workspace keeps them. */
  for (const dir of [join(root, "feedback", "corrections"), join(root, ".bigaap-analyzer", "corrections")]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
      results.push(migrateFile(join(dir, name), {
        kinds: [MIGRATION_KIND.CORRECTION_RECORD, MIGRATION_KIND.CORRECTION_ID, MIGRATION_KIND.STATUS_VOCABULARY],
        dryRun, backupDir
      }));
    }
  }

  return {
    root,
    dryRun,
    checked: results.length,
    migrated: results.filter((r) => r.migrated).length,
    wouldMigrate: results.filter((r) => r.status === "would-migrate").length,
    refused: results.filter((r) => r.refusals?.length).length,
    results
  };
}

/** Renders a migration report. */
export function renderMigrations(report) {
  const lines = [];
  lines.push(report.dryRun
    ? "Dry run. Nothing was written."
    : "Applied. Each migrated file was backed up first where a backup directory was given.", "");

  const interesting = report.results.filter((r) => r.log?.length || r.refusals?.length);
  if (!interesting.length) {
    lines.push(`  ${report.checked} file(s) checked, all current.`);
    return lines.join("\n");
  }

  for (const r of interesting) {
    lines.push(`  ${r.path}  [${r.status}]`);
    for (const entry of r.log ?? []) {
      lines.push(`      ${entry.id}${entry.reversible ? "" : "  (not reversible)"}`);
      for (const c of entry.changes) lines.push(`          ${c}`);
    }
    for (const ref of r.refusals ?? []) {
      lines.push(`      refused${ref.id ? ` ${ref.id}` : ""}: ${ref.why}`);
    }
    if (r.backup) lines.push(`      backup: ${r.backup}`);
  }
  return lines.join("\n");
}

/**
 * Migrations that deliberately do not exist.
 *
 * Recorded because an absent migration looks identical to a forgotten one, and
 * the next person to notice the gap should find the reasoning rather than fill
 * it in.
 */
export const DELIBERATELY_ABSENT = Object.freeze([
  {
    what: "evidence entries",
    why: "Evidence records what was measured. It does not become false when the tool changes, and a migration that touched it would be the tool restating a measurement it did not take."
  },
  {
    what: "correction record content",
    why: "A correction says what someone believed on a date. Only additive version markers are applied; no claim, value, status or reason is ever rewritten."
  },
  {
    what: "provenance status (measured/observed/inferred/estimated/unknown)",
    why: "Every mapping between these is a change of meaning, not of name. Promoting `inferred` to `observed` because a later build measures more would credit an old run with evidence it never had."
  },
  {
    what: "the `error` and `fail` legacy statuses",
    why: "Both were used for what are now `failed` and `blocked`, which need opposite actions. Choosing one would fabricate the distinction the result contract exists to preserve."
  },
  {
    what: "IR structure",
    why: "There is one IR schema version. When a second exists, its migration belongs here — and until then an empty slot is more honest than a no-op that implies coverage."
  }
]);

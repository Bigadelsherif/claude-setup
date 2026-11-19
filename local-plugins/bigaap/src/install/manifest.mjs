/**
 * The managed package boundary.
 *
 * Two questions, and they are not the same question:
 *
 * 1. **What is this plugin made of?** — the files an install places, an upgrade
 *    replaces, a repair verifies and an uninstall may remove.
 * 2. **What did the user make?** — analysis workspaces, briefs, corrections,
 *    events, outputs. None of it is ours and none of it ships.
 *
 * Everything in this file exists to keep those two sets from touching. The
 * include list is an allowlist of directories; the exclude list is a denylist
 * checked *after* it, so a path must be explicitly included AND not explicitly
 * excluded to be managed. Two gates in series, because either one alone fails
 * open: an allowlist alone ships a workspace someone created inside `src/`, and
 * a denylist alone ships anything nobody thought to name.
 *
 * ## The rule that matters
 *
 * A file is managed only if this build put it there. A file the user wrote is
 * never managed, whatever directory it is in, and the manifest records the
 * distinction rather than inferring it later — by the time an uninstall is
 * running, "is this ours?" must already be answered.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, lstatSync, existsSync } from "node:fs";
import { join, relative, sep, posix } from "node:path";

import { PLUGIN_ROOT } from "../workspace/workspace.mjs";
import { PLUGIN_VERSION, versionSet } from "./versions.mjs";

/** The manifest's own format version. Bumped when the manifest shape changes. */
export const MANIFEST_VERSION = "1";

/** Where a written manifest lives, relative to the plugin root. */
export const MANIFEST_FILE = "package-manifest.json";

/**
 * What a managed file IS, which decides how install, upgrade and repair treat it.
 *
 * `template` is the one that earns a separate kind. A template is placed once
 * and then belongs to the user — replacing it on upgrade would overwrite a
 * filled-in target brief with an empty one, which is the single most damaging
 * thing an upgrade of this tool could do.
 */
export const FILE_TYPE = Object.freeze({
  PLUGIN_METADATA: "plugin-metadata",
  COMMAND: "command",
  AGENT: "agent",
  SKILL: "skill",
  SOURCE: "source",
  EXECUTABLE: "executable",
  SCHEMA: "schema",
  TEMPLATE: "template",
  DOC: "doc",
  GENERATED_DOC: "generated-doc",
  MIGRATION: "migration",
  VERSION_METADATA: "version-metadata",
  PACKAGE_METADATA: "package-metadata"
});

/**
 * How each managed file behaves on upgrade.
 *
 * `replace` — ours, overwrite it.
 * `preserve` — placed once, never touched again.
 * `regenerate` — derived from source; rebuilt rather than copied.
 */
export const UPGRADE_BEHAVIOUR = Object.freeze({
  REPLACE: "replace",
  PRESERVE: "preserve",
  REGENERATE: "regenerate"
});

/**
 * The included set: directories and single files that make up the package.
 *
 * `tools/` is deliberately absent. Those are development harnesses — fixture
 * builders, calibration scripts, the smoke suites — and shipping them would
 * enlarge the package with things no installed user runs. `tests/` is absent
 * for the same reason. `fixtures/` is absent because it is large and only the
 * test suites read it.
 */
export const INCLUDED = Object.freeze([
  { path: ".claude-plugin", type: FILE_TYPE.PLUGIN_METADATA, upgrade: UPGRADE_BEHAVIOUR.REPLACE, match: /\.json$/ },
  { path: "commands", type: FILE_TYPE.COMMAND, upgrade: UPGRADE_BEHAVIOUR.REPLACE, match: /\.md$/ },
  { path: "agents", type: FILE_TYPE.AGENT, upgrade: UPGRADE_BEHAVIOUR.REPLACE, match: /\.md$/ },
  { path: "skills", type: FILE_TYPE.SKILL, upgrade: UPGRADE_BEHAVIOUR.REPLACE, match: /\.(md|json)$/ },
  /* `.js` as well as `.mjs`. `src/extract/extract.js` and `src/extract/probe.js`
   * are the scripts evaluated inside the page, written as plain scripts because
   * that is what a browser evaluates — and `src/deploy/class-kind.mjs` reads
   * extract.js off disk at import time to reuse its classifier. An `.mjs`-only
   * filter omitted both, and the installed plugin died on `ENOENT ...
   * extract.js` (def_0041, second occurrence). */
  { path: "src", type: FILE_TYPE.SOURCE, upgrade: UPGRADE_BEHAVIOUR.REPLACE, match: /\.(mjs|js)$/ },
  { path: "bin", type: FILE_TYPE.EXECUTABLE, upgrade: UPGRADE_BEHAVIOUR.REPLACE, match: /\.mjs$/, executable: true },
  { path: "schemas", type: FILE_TYPE.SCHEMA, upgrade: UPGRADE_BEHAVIOUR.REPLACE, match: /\.schema\.json$/ },
  { path: "docs", type: FILE_TYPE.DOC, upgrade: UPGRADE_BEHAVIOUR.REPLACE, match: /\.md$/ },
  { path: "package.json", type: FILE_TYPE.PACKAGE_METADATA, upgrade: UPGRADE_BEHAVIOUR.REPLACE, file: true },
  { path: "README.md", type: FILE_TYPE.DOC, upgrade: UPGRADE_BEHAVIOUR.REPLACE, file: true },
  { path: "ARCHITECTURE.md", type: FILE_TYPE.DOC, upgrade: UPGRADE_BEHAVIOUR.REPLACE, file: true }
]);

/**
 * Never packaged, at any setting.
 *
 * Each entry names a real thing that would be a disclosure if it shipped, and
 * the reason is recorded next to it — a denylist whose entries have no stated
 * reason gets pruned by whoever next finds it inconvenient.
 */
/**
 * A rule anchored at the path ROOT.
 *
 * Every user-data directory this tool creates, it creates at the root of a
 * project or workspace. Anchoring the rules there is not a narrowing for
 * convenience — it is what makes them mean what their `why` says.
 *
 * An unanchored segment match cost five source modules and produced an
 * installation that could not start (def_0041): `screenshots?` matched
 * `src/screenshot/`, and `defects` matched `src/defects/`, so the denylist
 * quietly vetoed product code the allowlist had included.
 */
const atRoot = (body) => new RegExp(`^(?:${body})(?:[\\\\/]|$)`);

/**
 * A rule matching a directory ANYWHERE, for names that only ever hold user
 * data wherever they appear.
 *
 * `raw/` and `corrections/` live inside a workspace, not at a project root, so
 * they must match nested — and neither name is used by any source directory.
 * That last clause is the whole justification, and it is checked: a test walks
 * `src/` and asserts no directory shares a name with one of these.
 */
const anywhere = (body) => new RegExp(`(^|[\\\\/])(?:${body})([\\\\/]|$)`);

export const EXCLUDED = Object.freeze([
  { pattern: anywhere("node_modules"), why: "dependencies are installed, never vendored into the package" },
  { pattern: anywhere("\\.git"), why: "repository internals" },
  { pattern: anywhere("\\.bigaap-analyzer"), why: "a user's project configuration, including their target brief" },
  { pattern: anywhere("\\.bigaap-observability"), why: "local diagnostic events" },
  { pattern: anywhere("\\.ui-analysis"), why: "analysis workspaces — captures, evidence, IR" },
  { pattern: anywhere("\\.fidelity-run"), why: "a fidelity run directory, including screenshots" },
  { pattern: anywhere("workspaces"), why: "analysis workspaces" },

  /* Anchored at the root. `src/output/` does not exist today, but the reason
   * these are anchored is that a future one must not silently vanish. */
  { pattern: atRoot("output"), why: "generated project outputs — projections of a user's IR" },
  { pattern: atRoot("outputs"), why: "generated project outputs" },
  { pattern: atRoot("feedback"), why: "correction history" },
  { pattern: atRoot("fixtures"), why: "test fixtures; large, and only the test suites read them" },
  { pattern: atRoot("tests?"), why: "test suites are not part of an installation" },
  { pattern: atRoot("tools"), why: "development harnesses — fixture builders, calibration, smoke suites" },
  { pattern: atRoot("dist"), why: "build output, regenerated rather than shipped" },

  /* The two that caused def_0041. `src/defects/` is the defect STORE — product
   * code — and `defects/` at the root is the register of filed reports, which
   * quote a user's captures. Same word, opposite things. */
  { pattern: atRoot("defects"), why: "the defect register; filed reports quote a user's captures" },
  { pattern: atRoot("screenshots?"), why: "screenshots of a reference page" },

  /* Nested, because these only ever appear inside a workspace and no source
   * directory bears either name. */
  { pattern: anywhere("corrections"), why: "correction records" },
  { pattern: anywhere("raw"), why: "raw extraction — DOM trees and CSS text" },

  { pattern: /target-brief\.json$/, why: "a user's product requirements" },
  { pattern: /\.(png|jpe?g|webp|gif|pdf)$/i, why: "images; a screenshot of a reference page could be any of these" },
  { pattern: /\.(env|pem|key|p12|pfx)$/i, why: "credentials" },
  { pattern: /(^|[\\/])\.env/, why: "credentials" },
  { pattern: /events(\.\d+)?\.jsonl$/, why: "observability events" },
  { pattern: anywhere("Default|Profile \\d+|User Data"), why: "a local browser profile" },
  { pattern: /\.log$/, why: "logs, which can quote anything" }
]);

/** Posix-style relative path, so a manifest written on Windows reads the same on Linux. */
const rel = (abs, root) => relative(root, abs).split(sep).join(posix.sep);

/** Whether a relative path is excluded, and by which rule. */
export function exclusionFor(relPath) {
  for (const e of EXCLUDED) if (e.pattern.test(relPath)) return e;
  return null;
}

export const isExcluded = (relPath) => exclusionFor(relPath) !== null;

export const hashFile = (abs) => "sha256:" + createHash("sha256").update(readFileSync(abs)).digest("hex");

/**
 * Walks one included entry and returns its managed files.
 *
 * Excluded paths are dropped here rather than filtered later, so a caller
 * cannot accidentally hold a list that includes them.
 */
function walkEntry(entry, root, vetoed = []) {
  const abs = join(root, entry.path);
  if (!existsSync(abs)) return [];

  const out = [];
  const visit = (p) => {
    const r = rel(p, root);

    /* A denylist hit inside an allowlisted directory is RECORDED, not silently
     * dropped. This is the whole remedy for def_0041: the two rules that
     * vetoed five source modules did so invisibly, and an install reported
     * success while producing a plugin that could not start. A veto that has
     * to appear in the manifest is a veto somebody will see. */
    const veto = exclusionFor(r);
    if (veto) {
      /* Directories are not reported individually — one entry for the
       * directory says it, and listing every file under `node_modules` would
       * bury the signal this exists to produce. */
      let isDir = false;
      try { isDir = lstatSync(p).isDirectory(); } catch { /* unreadable; report it */ }
      vetoed.push({ path: r, why: veto.why, pattern: String(veto.pattern), directory: isDir });
      return;
    }

    /* `lstatSync`, so a symlink is never followed out of the package. A link
     * pointing at /etc would otherwise be walked, hashed and copied. */
    let st;
    try { st = lstatSync(p); } catch { return; }
    if (st.isSymbolicLink()) {
      vetoed.push({ path: r, why: "a symbolic link; the package never follows one out of the source tree", pattern: "symlink", directory: false });
      return;
    }
    if (st.isDirectory()) {
      for (const child of readdirSync(p).sort()) visit(join(p, child));
      return;
    }
    if (entry.match && !entry.match.test(p)) return;
    out.push({ abs, path: r, size: st.size });
  };
  visit(abs);
  return out;
}

/**
 * Every source module on disk, whether or not the manifest claims it.
 *
 * Deliberately walks the filesystem rather than reading the manifest. A
 * completeness check that consults the manifest is a statement about the
 * manifest's internal consistency and says nothing at all about whether it is
 * complete — which is exactly how def_0041 passed every Phase 5.9 test.
 */
export function sourceModulesOnDisk(root = PLUGIN_ROOT) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries.sort()) {
      const p = join(dir, e);
      let st;
      try { st = lstatSync(p); } catch { continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) { walk(p); continue; }
      if (/\.(mjs|js)$/.test(e)) out.push(rel(p, root));
    }
  };
  walk(join(root, "src"));
  return out;
}

/**
 * Whether the manifest covers every module the product is made of.
 *
 * The check def_0041 needed and did not have. An install that omits a module
 * `bin/bigaap.mjs` imports produces a plugin that fails at import resolution
 * before any command runs — and reports success while doing it, because the
 * manifest is a record of what the manifest listed.
 */
export function checkCompleteness(manifest, { root = PLUGIN_ROOT } = {}) {
  const claimed = new Set((manifest.files ?? []).map((f) => f.path));
  const onDisk = sourceModulesOnDisk(root);
  const missing = onDisk.filter((p) => !claimed.has(p));

  const required = [".claude-plugin/plugin.json", "bin/bigaap.mjs", "package.json"];
  const missingRequired = required.filter((p) => !claimed.has(p));

  return {
    complete: missing.length === 0 && missingRequired.length === 0,
    sourceOnDisk: onDisk.length,
    sourceClaimed: onDisk.length - missing.length,
    missing,
    missingRequired,
    why: missing.length
      ? `${missing.length} source module(s) exist on disk but are not in the manifest, so an installation would omit them`
      : missingRequired.length
        ? `the manifest omits: ${missingRequired.join(", ")}`
        : null
  };
}

/**
 * Builds the package manifest.
 *
 * Every entry carries path, type, managed status, hash, version and ownership.
 * `managed: true` on all of them is not redundant: the manifest is also the
 * input to uninstall and repair, both of which compare it against what is
 * actually on disk, and an unmanaged file discovered there is recorded with
 * `managed: false` so the two can be told apart in one list.
 */
export function buildManifest({ root = PLUGIN_ROOT, generatedDocs = [] } = {}) {
  const files = [];
  const seen = new Set();
  const vetoed = [];

  for (const entry of INCLUDED) {
    for (const f of walkEntry(entry, root, vetoed)) {
      if (seen.has(f.path)) continue;
      seen.add(f.path);

      /* A generated doc is recorded as such so repair can rebuild it rather
       * than reporting it as modified. A hand-edited generated doc IS modified,
       * and saying so is the point — the edit will be lost at the next
       * regeneration and the user should hear that now. */
      const isGenerated = entry.type === FILE_TYPE.DOC && generatedDocs.includes(f.path);

      files.push({
        path: f.path,
        type: isGenerated ? FILE_TYPE.GENERATED_DOC : entry.type,
        managed: true,
        hash: hashFile(join(root, f.path)),
        size: f.size,
        version: PLUGIN_VERSION,
        upgrade: isGenerated ? UPGRADE_BEHAVIOUR.REGENERATE : entry.upgrade,
        executable: entry.executable === true,
        ownership: "bigaap-ui-forensics"
      });
    }
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  return {
    manifestVersion: MANIFEST_VERSION,
    pluginVersion: PLUGIN_VERSION,
    versions: versionSet(),
    generatedAt: new Date().toISOString(),
    fileCount: files.length,
    totalBytes: files.reduce((n, f) => n + f.size, 0),
    /* The exclusion rules travel with the manifest so a reader can check what
     * was kept out without having this source file to hand. */
    excluded: EXCLUDED.map((e) => ({ pattern: String(e.pattern), why: e.why })),
    /* Files the denylist removed from INSIDE an allowlisted directory.
     * Recorded because the silent version of this cost five source modules and
     * shipped an installation that could not start (def_0041). Usually empty,
     * and a non-empty entry naming something under `src/` is a defect. */
    vetoed,
    files
  };
}

/**
 * Verifies a manifest against what is on disk.
 *
 * Four outcomes per file, and they are different problems with different
 * remedies: `ok`, `modified` (hash differs — the user may have edited it),
 * `missing` (gone), and `unreadable` (there, but cannot be hashed).
 */
export function verifyManifest(manifest, { root = PLUGIN_ROOT } = {}) {
  const findings = [];

  for (const f of manifest.files ?? []) {
    const abs = join(root, f.path);
    if (!existsSync(abs)) {
      findings.push({ path: f.path, type: f.type, state: "missing", expected: f.hash, actual: null });
      continue;
    }
    let actual = null;
    try { actual = hashFile(abs); }
    catch (error) {
      findings.push({ path: f.path, type: f.type, state: "unreadable", expected: f.hash, actual: null, why: error.code ?? "unreadable" });
      continue;
    }
    findings.push({
      path: f.path, type: f.type,
      state: actual === f.hash ? "ok" : "modified",
      expected: f.hash, actual
    });
  }

  const by = (s) => findings.filter((f) => f.state === s);
  return {
    ok: by("ok").length === findings.length,
    checked: findings.length,
    okCount: by("ok").length,
    modified: by("modified"),
    missing: by("missing"),
    unreadable: by("unreadable"),
    findings
  };
}

/**
 * Raw control bytes in a managed file.
 *
 * Tab, LF and CR are text. Anything else below 0x20 is either a mistake or
 * something that should have been written as an escape — and inside a regex
 * literal it silently changes what the pattern matches, which is how a test
 * assertion in this repository became unable to fail (def_0038).
 */
export function controlByteFindings(manifest, { root = PLUGIN_ROOT } = {}) {
  const out = [];
  for (const f of manifest.files ?? []) {
    if (!/\.(mjs|json|md)$/.test(f.path)) continue;
    const abs = join(root, f.path);
    if (!existsSync(abs)) continue;
    let buf;
    try { buf = readFileSync(abs); } catch { continue; }
    for (let i = 0; i < buf.length; i++) {
      const c = buf[i];
      if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) {
        out.push({
          path: f.path,
          byte: "0x" + c.toString(16).padStart(2, "0"),
          offset: i,
          line: buf.subarray(0, i).toString("utf8").split("\n").length
        });
      }
    }
  }
  return out;
}

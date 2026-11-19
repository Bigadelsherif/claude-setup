import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { ARTIFACTS } from "../artifacts/registry.mjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../validate/schema.mjs";

export const PLUGIN_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));

export const paths = {
  schema: (name) => join(PLUGIN_ROOT, "schemas", `${name}.schema.json`),
  fixture: (...parts) => join(PLUGIN_ROOT, "fixtures", ...parts),
  config: (hostRoot) => join(hostRoot, ".bigaap-analyzer"),
  /* Anything inside the installed plugin. Two callers reached for `paths.root`
   * before it existed and both silently caught the resulting TypeError — see
   * def_0039. It is one member rather than an inlined PLUGIN_ROOT at each call
   * site so that a typo in it fails everywhere at once. */
  root: (...parts) => join(PLUGIN_ROOT, ...parts)
};

export function readJSON(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJSON(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function readText(path) {
  return readFileSync(path, "utf8");
}

export function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text.endsWith("\n") ? text : `${text}\n`, "utf8");
}

/**
 * Every artifact this workspace may hold, derived from the registry.
 *
 * `partial-design-spec.md` and `fidelity-checklist.md` are added explicitly:
 * the first is the blocked-run name of the design spec, and the second is
 * projected alongside a rebuild prompt without being a registered artifact in
 * its own right. Both must still be prunable, or a refused run would leave them
 * standing.
 */
const KNOWN_ARTIFACTS = Object.freeze([
  ...new Set([
    ...ARTIFACTS.filter((a) => a.filename.startsWith("output/")).map((a) => a.filename),
    ...ARTIFACTS.map((a) => a.blockedFilename).filter(Boolean),
    "output/fidelity-checklist.md",
    "output/screenshot-evidence-report.md"
  ])
]);

export function loadSchemas() {
  return {
    evidence: readJSON(paths.schema("evidence")),
    ir: readJSON(paths.schema("ir")),
    correction: readJSON(paths.schema("correction")),
    targetBrief: readJSON(paths.schema("target-brief"))
  };
}

/**
 * Loads and validates a target brief.
 *
 * An invalid brief is NOT silently ignored — it returns `{ $invalid }` so the
 * mode gate can block and say why. Falling back to "no brief" would let a
 * malformed file look like an absent one, and the adaptation would proceed
 * without the requirements its author thought they had supplied.
 */
export function loadTargetBrief(path) {
  if (!existsSync(path)) return null;

  let parsed;
  try {
    parsed = readJSON(path);
  } catch (error) {
    return { $invalid: `not valid JSON — ${error.message}`, $path: path };
  }

  const schema = readJSON(paths.schema("target-brief"));
  const result = validate(schema, parsed);
  if (!result.valid) {
    const detail = result.errors.slice(0, 4).map((e) => `${e.path} ${e.message}`).join("; ");
    return { $invalid: detail, $path: path };
  }
  return parsed;
}

/** A per-analysis workspace. All paths are relative to its root. */
export class Workspace {
  constructor(root) {
    this.root = resolve(root);
  }

  /** The workspace's target brief, validated. Null when none is supplied. */
  targetBrief() {
    return loadTargetBrief(this.path("input", "target-brief.json"));
  }

  static create(root, manifest) {
    const ws = new Workspace(root);
    mkdirSync(join(ws.root, "input"), { recursive: true });
    mkdirSync(join(ws.root, "raw"), { recursive: true });
    mkdirSync(join(ws.root, "analysis"), { recursive: true });
    mkdirSync(join(ws.root, "output"), { recursive: true });
    mkdirSync(join(ws.root, "feedback", "corrections"), { recursive: true });
    if (manifest) ws.writeJSON("manifest.json", manifest);
    return ws;
  }

  path(...parts) {
    return join(this.root, ...parts);
  }

  exists(...parts) {
    return existsSync(this.path(...parts));
  }

  readJSON(...parts) {
    return readJSON(this.path(...parts));
  }

  writeJSON(rel, data) {
    writeJSON(this.path(rel), data);
  }

  readText(...parts) {
    return readText(this.path(...parts));
  }

  writeText(rel, text) {
    writeText(this.path(rel), text);
  }

  /** Every correction record filed against this reference, in id order. */
  corrections() {
    const dir = this.path("feedback", "corrections");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => readJSON(join(dir, f)));
  }

  /** Written artifacts, for the freshness gate. */
  artifacts() {
    const out = {};
    for (const rel of KNOWN_ARTIFACTS) {
      if (this.exists(rel)) out[rel] = this.readText(rel);
    }
    return out;
  }

  /**
   * Removes artifacts from a previous run that the current run did not write.
   * Without this, a formerly-safe workspace keeps a stale rebuild-prompt.md
   * after becoming unsafe — the single most dangerous file to leave behind.
   */
  pruneArtifacts(written) {
        /* The list comes from the registry, not from a copy kept here. Two
     * hardcoded lists is how an artifact gets added to one and forgotten in the
     * other — and the one it gets forgotten in is the pruner, which is where a
     * stale build prompt survives a run that was refused. */
    const known = KNOWN_ARTIFACTS;
    const removed = [];
    for (const rel of known) {
      if (written.includes(rel)) continue;
      const abs = this.path(rel);
      if (existsSync(abs)) {
        rmSync(abs);
        removed.push(rel);
      }
    }
    return removed;
  }
}

export function slugFor(source, date = new Date()) {
  const base = String(source)
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 48);
  return `${base || "reference"}--${date.toISOString().slice(0, 10)}`;
}

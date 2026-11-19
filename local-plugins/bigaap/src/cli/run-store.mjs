/**
 * The on-disk layout of a fidelity run.
 *
 * One directory per run, and everything a later command needs is read back
 * from it rather than carried in memory between invocations — the CLI is
 * several processes, not one, and a command that depended on state its
 * predecessor happened to hold would work only when run as a script.
 *
 *   session.json                 the capture session record
 *   reference/raw/extract-<vp>.json, probe-<vp>.json, capture-<vp>.json, ir-<vp>.json
 *   target/  (same shape)
 *   target/states/<state>-<vp>.json
 *   target/intrinsic-<vp>.json
 *   reference.lock.json          pinned for the whole run
 *   iterations/NNNN/             written by FidelityHistory, append-only
 *   results/<operation>[-<vp>].json   the typed CLI result of each command
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { sha256 } from "./result.mjs";

export class RunStore {
  constructor(root) {
    this.root = root;
  }

  static create(root, session) {
    mkdirSync(join(root, "reference", "raw"), { recursive: true });
    mkdirSync(join(root, "target", "raw"), { recursive: true });
    mkdirSync(join(root, "target", "states"), { recursive: true });
    mkdirSync(join(root, "results"), { recursive: true });
    const store = new RunStore(root);
    store.writeJSON("session.json", session);
    return store;
  }

  path(...parts) { return join(this.root, ...parts); }
  has(...parts) { return existsSync(this.path(...parts)); }

  readJSON(...parts) {
    const p = this.path(...parts);
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  }

  writeJSON(rel, value) {
    const p = this.path(rel);
    mkdirSync(dirname(p), { recursive: true });
    const body = JSON.stringify(value, null, 2) + "\n";
    writeFileSync(p, body, "utf8");
    return { path: p, hash: sha256(body), bytes: body.length };
  }

  /** The session record, or null if this directory was never initialised. */
  session() { return this.readJSON("session.json"); }

  /** Every capture contract written into this run, in the order they appear. */
  captures() {
    const found = [];
    const walk = (dir) => {
      const abs = this.path(dir);
      if (!existsSync(abs)) return;
      for (const entry of readdirSync(abs, { withFileTypes: true })) {
        const rel = join(dir, entry.name);
        /* `withFileTypes` already reports a link as a link rather than as the
         * directory it points at, so the recursion cannot escape. The read can:
         * a symlink named `capture.json` would be followed and parsed as a
         * capture contract. Skipped explicitly, because a run directory is a
         * place the tool writes and nothing there should be a link. */
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) { walk(rel); continue; }
        if (!entry.name.endsWith(".json")) continue;
        const body = this.readJSON(rel);
        const contract = body?.capture ?? (body?.contractVersion ? body : null);
        if (contract?.contractVersion) found.push({ file: rel, contract });
      }
    };
    walk("reference");
    walk("target");
    return found;
  }

  /** Side-specific capture record for one viewport, or null. */
  capture(side, viewport) { return this.readJSON(side, `capture-${viewport}.json`); }

  raw(side, viewport) { return this.readJSON(side, "raw", `extract-${viewport}.json`); }
  probe(side, viewport) { return this.readJSON(side, "raw", `probe-${viewport}.json`); }
  ir(side, viewport) { return this.readJSON(side, `ir-${viewport}.json`); }

  /** Viewports for which a side has a completed extraction on disk. */
  viewportsCaptured(side) {
    const dir = this.path(side, "raw");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .map((f) => /^extract-(\d+)\.json$/.exec(f))
      .filter(Boolean)
      .map((m) => Number(m[1]))
      .sort((a, b) => b - a);
  }

  states(viewport) {
    const dir = this.path("target", "states");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(`-${viewport}.json`))
      .map((f) => this.readJSON("target", "states", f))
      .filter(Boolean);
  }

  /** Records a typed CLI result so a later command can read what happened. */
  saveResult(result) {
    const name = [result.operation, result.viewport, result.state && result.state !== "default" ? result.state : null]
      .filter(Boolean).join("-") + ".json";
    return this.writeJSON(join("results", name), result);
  }

  results() {
    const dir = this.path("results");
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith(".json"))
      .map((f) => this.readJSON("results", f))
      .filter(Boolean);
  }
}

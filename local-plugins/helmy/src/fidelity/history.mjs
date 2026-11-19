/**
 * Iteration history — append-only.
 *
 * Nothing is ever overwritten, including on failure: a failed iteration is
 * evidence. Every artifact carries the hash of the IR it derives from, matching
 * the existing `helmy:ir-hash` convention, so a later reader can prove which
 * measurement produced which report.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const sha256 = (value) =>
  createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

export const shortHash = (value) => sha256(value).slice(0, 16);

/** Iteration directories are zero-padded so they sort lexicographically. */
export const iterationDir = (n) => String(n).padStart(4, "0");

export class FidelityHistory {
  constructor(root) {
    this.root = root;
    this.iterationsRoot = join(root, "iterations");
    mkdirSync(this.iterationsRoot, { recursive: true });
  }

  /** The next iteration number. Existing directories are never reused. */
  nextIteration() {
    if (!existsSync(this.iterationsRoot)) return 1;
    const used = readdirSync(this.iterationsRoot)
      .filter((d) => /^\d{4}$/.test(d))
      .map((d) => Number(d));
    return used.length ? Math.max(...used) + 1 : 1;
  }

  /**
   * Pins the reference for the whole run.
   *
   * If the reference is re-analysed mid-run the loop must stop rather than
   * silently compare against a moved target — the same reasoning as V6
   * projection freshness.
   */
  lockReference(referenceIR, { slug }) {
    const lock = {
      slug,
      irHash: shortHash(referenceIR),
      safetyStatus: referenceIR.safety?.status ?? null,
      contentReached: referenceIR.coverage?.contentReached ?? null,
      lockedAt: new Date().toISOString()
    };
    const path = join(this.root, "reference.lock.json");
    if (existsSync(path)) {
      const existing = JSON.parse(readFileSync(path, "utf8"));
      if (existing.irHash !== lock.irHash) {
        return { ok: false, existing, attempted: lock,
          reason: "The reference IR changed during the run. Start a new run rather than comparing against a moved reference." };
      }
      return { ok: true, lock: existing, reused: true };
    }
    writeFileSync(path, JSON.stringify(lock, null, 2) + "\n", "utf8");
    return { ok: true, lock, reused: false };
  }

  /**
   * Writes one iteration. Refuses to touch a directory that already exists.
   */
  write(n, artifacts) {
    const dir = join(this.iterationsRoot, iterationDir(n));
    if (existsSync(dir)) {
      throw new Error(`iteration ${iterationDir(n)} already exists; history is append-only`);
    }
    mkdirSync(join(dir, "target", "raw"), { recursive: true });
    mkdirSync(join(dir, "pixel"), { recursive: true });

    const hashes = {};
    const put = (rel, value) => {
      if (value == null) return;
      const body = typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n";
      const path = join(dir, rel);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, body, "utf8");
      hashes[rel] = sha256(body);
    };

    put("target/raw/extract.json", artifacts.targetRaw);
    put("target/raw/probe.json", artifacts.targetProbe);
    put("target/ir.json", artifacts.targetIR);
    put("target/capture-meta.json", artifacts.captureMeta);
    put("comparison.json", artifacts.comparison);
    put("categories.json", artifacts.categories);
    put("tasks.json", artifacts.tasks);
    put("pixel/residue.json", artifacts.pixel);
    put("decisions.json", artifacts.decisions);
    put("blocked.json", artifacts.blocked);

    const stamp = {
      iteration: n,
      writtenAt: new Date().toISOString(),
      referenceIrHash: artifacts.referenceIrHash ?? null,
      targetIrHash: artifacts.targetIR ? shortHash(artifacts.targetIR) : null,
      files: hashes
    };
    writeFileSync(join(dir, "hashes.json"), JSON.stringify(stamp, null, 2) + "\n", "utf8");

    this.appendIndex(stamp);
    return { dir, stamp };
  }

  appendIndex(entry) {
    const path = join(this.root, "history.json");
    const existing = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { iterations: [] };
    existing.iterations.push({
      iteration: entry.iteration,
      writtenAt: entry.writtenAt,
      referenceIrHash: entry.referenceIrHash,
      targetIrHash: entry.targetIrHash,
      fileCount: Object.keys(entry.files).length
    });
    writeFileSync(path, JSON.stringify(existing, null, 2) + "\n", "utf8");
  }

  read(n) {
    const dir = join(this.iterationsRoot, iterationDir(n));
    if (!existsSync(dir)) return null;
    const readIf = (rel) => {
      const p = join(dir, rel);
      return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
    };
    return {
      dir,
      hashes: readIf("hashes.json"),
      categories: readIf("categories.json"),
      tasks: readIf("tasks.json"),
      comparison: readIf("comparison.json"),
      blocked: readIf("blocked.json")
    };
  }

  /** Verifies that a previously written iteration is byte-identical. */
  verify(n) {
    const dir = join(this.iterationsRoot, iterationDir(n));
    const stampPath = join(dir, "hashes.json");
    if (!existsSync(stampPath)) return { ok: false, reason: "no hash stamp" };
    const stamp = JSON.parse(readFileSync(stampPath, "utf8"));
    const drift = [];
    for (const [rel, expected] of Object.entries(stamp.files)) {
      const p = join(dir, rel);
      if (!existsSync(p)) { drift.push({ file: rel, reason: "missing" }); continue; }
      const actual = sha256(readFileSync(p, "utf8"));
      if (actual !== expected) drift.push({ file: rel, reason: "content changed", expected, actual });
    }
    return { ok: drift.length === 0, drift };
  }
}

/* ----------------------------------------------------------- stop rules */

export const STOP = Object.freeze({
  THRESHOLD_MET: "threshold-met",
  MAX_ITERATIONS: "max-iterations",
  NO_IMPROVEMENT: "no-improvement",
  REGRESSION: "regression",
  NEW_UNCERTAINTY: "new-uncertainty",
  CRITICAL_FAILURE: "critical-failure",
  USER_CANCELLED: "user-cancelled",
  BLOCKED: "blocked"
});

/**
 * Decides whether to continue.
 *
 * `stopOnNewUncertainty` is the subtle one: a change can raise a category score
 * by making the component harder to measure — fewer admissible comparisons,
 * higher apparent agreement. Improvement that costs evidence is not improvement.
 */
export function shouldStop(previous, current, config = {}) {
  const {
    maxIterations = 5, minImprovement = 0.02, stopOnRegression = true,
    stopOnNewUncertainty = true, stopOnCriticalFailure = true, targetCategory = null, iteration = 1
  } = config;

  const byName = (report) => Object.fromEntries((report?.categories ?? []).map((c) => [c.category, c]));
  const prev = byName(previous);
  const curr = byName(current);

  if (stopOnCriticalFailure) {
    const critical = (current?.differences ?? []).filter((d) => d.severity === "critical");
    if (critical.length) {
      return { stop: true, reason: STOP.CRITICAL_FAILURE,
        detail: `${critical.length} critical difference(s): ${critical.map((d) => d.dimension).join(", ")}` };
    }
  }

  if (!previous) return { stop: false, reason: null, detail: "first iteration" };

  if (stopOnRegression) {
    for (const [name, c] of Object.entries(curr)) {
      const p = prev[name];
      if (!p || p.score == null || c.score == null) continue;
      if (c.score < p.score - 1e-9) {
        return { stop: true, reason: STOP.REGRESSION,
          detail: `${name} fell from ${p.score} to ${c.score}` };
      }
    }
  }

  if (stopOnNewUncertainty) {
    for (const [name, c] of Object.entries(curr)) {
      const p = prev[name];
      if (!p) continue;
      if (c.evidenceCoverage < p.evidenceCoverage - 1e-9) {
        return { stop: true, reason: STOP.NEW_UNCERTAINTY,
          detail: `${name} evidence coverage fell from ${p.evidenceCoverage} to ${c.evidenceCoverage}` +
            (c.score != null && p.score != null && c.score > p.score
              ? `, while its score rose from ${p.score} to ${c.score} — the improvement cost evidence`
              : "") };
      }
      if ((c.unresolvedClaims?.length ?? 0) > (p.unresolvedClaims?.length ?? 0)) {
        return { stop: true, reason: STOP.NEW_UNCERTAINTY,
          detail: `${name} gained unresolved claims (${p.unresolvedClaims.length} → ${c.unresolvedClaims.length})` };
      }
    }
  }

  if (targetCategory) {
    const p = prev[targetCategory];
    const c = curr[targetCategory];
    if (p?.score != null && c?.score != null && c.score - p.score < minImprovement) {
      return { stop: true, reason: STOP.NO_IMPROVEMENT,
        detail: `${targetCategory} improved by ${(c.score - p.score).toFixed(3)}, below ${minImprovement}` };
    }
  }

  if (iteration >= maxIterations) {
    return { stop: true, reason: STOP.MAX_ITERATIONS, detail: `reached ${maxIterations} iterations` };
  }

  return { stop: false, reason: null, detail: null };
}

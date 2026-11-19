/**
 * Defect reports — the channel corrections cannot provide.
 *
 * A correction record fixes a wrong CLAIM about a site: "the card radius is 12,
 * not 16". The Stripe run produced a different failure mode entirely — every
 * claim was locally correct and the whole analysis described the wrong region.
 * No correction can express that, because nothing it asserted was false.
 *
 * Defect reports never patch evidence. They accumulate against the code and
 * carry a regression-test status, so a fix is only complete when a test proves
 * the defect cannot recur.
 */

import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readJSON, writeJSON, PLUGIN_ROOT } from "../workspace/workspace.mjs";

export const DEFECTS_DIR = join(PLUGIN_ROOT, "defects");

export const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

export function listDefects(dir = DEFECTS_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => readJSON(join(dir, f)));
}

export function saveDefect(defect, dir = DEFECTS_DIR) {
  writeJSON(join(dir, `${defect.id}.json`), defect);
  return defect;
}

export function nextDefectId(defects = listDefects()) {
  let max = 0;
  for (const d of defects) {
    const n = Number.parseInt(String(d.id).replace("def_", ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `def_${String(max + 1).padStart(4, "0")}`;
}

/**
 * Records a recurrence rather than filing a duplicate.
 * A defect seen on three sites is the same defect, with more weight.
 */
export function recordRecurrence(defect, dir = DEFECTS_DIR) {
  const updated = { ...defect, recurrenceCount: (defect.recurrenceCount ?? 1) + 1 };
  return saveDefect(updated, dir);
}

/** Open defects, most severe first, then most recurrent. */
/**
 * The statuses a defect can hold.
 *
 * `permanent-limitation` was added in Phase 4.9 for a defect that is neither
 * awaiting work nor fixed: the evidence says the capability does not work and
 * will not be made to, so the containment is the permanent answer. It is NOT
 * open — nobody is going to act on it — and it is emphatically not fixed.
 *
 * Without a third status such a defect would be filtered out of both groups in
 * the log and disappear, which is the one outcome a defect register exists to
 * prevent.
 */
export const PROMOTION_STATUS = Object.freeze({
  OPEN: "open",
  IN_PROGRESS: "in-progress",
  FIXED: "fixed",
  PERMANENT_LIMITATION: "permanent-limitation"
});

/** Defects awaiting work. A permanent limitation is not awaiting work. */
export function openDefects(defects = listDefects()) {
  return defects
    .filter((d) => d.promotionStatus === "open" || d.promotionStatus === "in-progress")
    .sort((a, b) => {
      const s = (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);
      if (s !== 0) return s;
      return (b.recurrenceCount ?? 1) - (a.recurrenceCount ?? 1);
    });
}

/**
 * A defect is only fixed when a regression test proves it stays fixed.
 * Marking one fixed without a passing test is how a defect quietly returns.
 */
export function unverifiedFixes(defects = listDefects()) {
  return defects.filter(
    (d) => d.promotionStatus === "fixed" && d.regressionTest?.status !== "passing"
  );
}

export function renderDefectLog(defects) {
  const lines = ["# Defect log", ""];
  lines.push(
    "Extractor and selection failures. These are code defects, not site facts — " +
      "a correction record cannot express them, because the claims they produced " +
      "were individually defensible."
  );
  lines.push("");

  const open = openDefects(defects);
  const fixed = defects.filter((d) => d.promotionStatus === PROMOTION_STATUS.FIXED);
  const permanent = defects.filter((d) => d.promotionStatus === PROMOTION_STATUS.PERMANENT_LIMITATION);

  lines.push(
    `**${open.length} open · ${fixed.length} fixed · ${permanent.length} permanent limitation` +
    `${permanent.length === 1 ? "" : "s"} · ${defects.length} total**`
  );
  lines.push("");

  if (permanent.length) {
    lines.push(
      "A permanent limitation is neither open nor fixed. The evidence says the capability does not " +
      "work and will not be made to, so the containment is the answer rather than a stopgap. It stays " +
      "in the register because a limitation that is forgotten becomes a surprise."
    );
    lines.push("");
  }

  for (const group of [
    { title: "Open", items: open },
    { title: "Permanent limitations", items: permanent },
    { title: "Fixed", items: fixed }
  ]) {
    if (!group.items.length) continue;
    lines.push(`## ${group.title}`);
    lines.push("");
    lines.push("| ID | Severity | Category | Module | Test | Observation |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const d of group.items) {
      lines.push(
        `| \`${d.id}\` | ${d.severity} | ${d.category} | \`${d.module}\` | ${d.regressionTest?.status ?? "none"} | ${d.observation.slice(0, 90)} |`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

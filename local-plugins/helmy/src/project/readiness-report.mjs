import { stampComment } from "../ir/hash.mjs";

/**
 * Readiness decisions -> readiness-report.md
 *
 * Fifteen separate decisions, rendered as fifteen separate decisions.
 *
 * The temptation this file exists to refuse is the summary line — "overall:
 * usable with limits" — which would be read instead of the table underneath it
 * every single time. The decisions genuinely differ: single-viewport comparison
 * on a local fixture is in a different position from automatic correction,
 * which is a permanent limitation. One number would have to hide that, and
 * hiding it is the only thing it could accomplish.
 *
 * The counts at the top are a navigation aid, not a verdict, and are labelled
 * as such where a reader will see it.
 */

const ORDER = ["not-usable", "undetermined", "usable-with-limits", "usable"];

export function projectReadinessReport(report, hash, options = {}) {
  const out = [];
  const push = (l = "") => out.push(l);
  const decisions = report?.decisions ?? [];

  push(hash ? stampComment(hash) : "<!-- helmy:readiness — derived from the defect store, not from an IR -->");
  push("# Readiness report");
  push();
  push(`**What was analyzed:** ${options.workspace ?? "this workspace"}  `);
  push(`**Requested mode:** ${options.mode ?? "not mode-specific"}  `);
  push(`**Source kind:** ${options.sourceKind ?? "not applicable"}  `);
  push(`**Evidence status:** these decisions rest on the defect store and the phase records, not on a capture  `);
  push(`**Generated:** ${options.generatedAt ?? "not recorded"}`);
  push();
  push("**Next:** find the decision covering what you are about to do, and read its basis.");
  push("A decision that does not name what it rests on is not usable as an answer.");
  push();

  /* ------------------------------------------------------ no verdict */

  push("## There is no overall verdict");
  push();
  push(report?.note ??
    "Fifteen separate decisions. There is deliberately no overall verdict: the decisions differ, and one summary would have to hide the difference.");
  push();
  if (report?.counts) {
    const parts = ORDER.filter((k) => report.counts[k]).map((k) => `${report.counts[k]} ${k}`);
    push(`For navigation only: ${parts.join(", ")}. This is a count of rows, not a judgement.`);
    push();
  }

  /* ------------------------------------------------------- decisions */

  push("## Decisions");
  push();
  if (!decisions.length) {
    push("No decision is recorded, which is not the same as everything being usable.");
    push();
    return out.join("\n");
  }

  for (const level of ORDER) {
    const group = decisions.filter((d) => d.decision === level);
    if (!group.length) continue;

    push(`### ${level}`);
    push();
    for (const d of group) {
      push(`**${d.id}**`);
      push();
      if (d.why) push(`${d.why}`);
      if (d.basis) {
        push();
        push(`*Rests on:* ${Array.isArray(d.basis) ? d.basis.join("; ") : d.basis}`);
      }
      if (d.observed) {
        push();
        push(`*Narrowed by this run:* ${d.observed}`);
      }
      push();
    }
  }

  /* ----------------------------------------------------- limitations */

  push("## Limitations");
  push();
  push("- A run can narrow a decision but never widen one. Observing that a comparison");
  push("  completed does not license anything the phase records did not already establish.");
  push("- `not-usable` here means the evidence does not support the use, not that the code");
  push("  crashes. Several of these are permanent limitations rather than unfinished work.");
  push("- No tolerance in this system is validated, which is why no decision in this table");
  push("  rests on one.");
  push();

  return out.join("\n");
}

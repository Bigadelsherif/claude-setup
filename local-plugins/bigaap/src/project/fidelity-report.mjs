import { stampComment } from "../ir/hash.mjs";

/**
 * Comparison -> fidelity-report.md
 *
 * Renders what a comparison found, category by category. Two rules govern
 * everything below, and both are load-bearing:
 *
 *   1. **No composite score.** The comparison itself refuses to produce one,
 *      and this report does not reconstruct it by averaging what it was given.
 *      Weighting twelve categories against each other needs evidence about
 *      which ones matter, and that evidence does not exist.
 *
 *   2. **`null` is not zero.** A category with nothing comparable in it scores
 *      null and is rendered as "not compared". Zero would read as total
 *      disagreement, which is a much stronger claim than "we could not look".
 *
 * The third rule is about tolerances: no tolerance in this system is validated,
 * so a category "passing" means it fell inside an unvalidated number. The
 * report says so rather than letting a green row imply otherwise.
 */

const pct = (n) => (n == null ? "—" : `${(n * 100).toFixed(0)}%`);

export function projectFidelityReport(comparison, hash, options = {}) {
  const out = [];
  const push = (l = "") => out.push(l);
  const categories = comparison?.categories ?? [];
  const differences = comparison?.differences ?? [];

  /* This report is projected from a comparison rather than from an IR, so it
   * never passes through `stampAll`/`markdownHeader` and stamps itself. That is
   * the exception to the single-owner rule established by def_0057, not a
   * second copy of the stamp: the IR-derived artifacts get theirs from the
   * header composer, and these two standalone reports have no composer to get
   * one from. `readiness-report.mjs` is the other. */
  push(stampComment(hash));
  push("# Fidelity report");
  push();
  push(`**What was compared:** \`${options.referenceSource ?? "the reference"}\` against \`${options.targetSource ?? "the target"}\`  `);
  push(`**Source kind:** ${options.sourceKind ?? "url"}  `);
  push(`**Requested mode:** ${options.mode ?? "recreate"}  `);
  push(`**Content mode:** ${options.contentMode ?? "independent-content"}  `);
  push(`**Viewport:** ${options.viewport ? `${options.viewport}px` : "not stated"}  `);
  push(`**Evidence status:** see \`output/evidence-report.md\` on both sides  `);
  push(`**Generated:** ${options.generatedAt ?? "not recorded"}`);
  push();
  push("**Next:** read the categories with the most mismatches first. Every difference names");
  push("its evidence on both sides, so a surprising row can be traced rather than argued about.");
  push();

  /* ------------------------------------------------- what was compared */

  push("## What was compared");
  push();
  if (!categories.length) {
    push("No category was compared. This is not a result of zero agreement — it means the");
    push("comparison did not run, or nothing in it was admissible.");
    push();
  } else {
    push("| Category | Score | Coverage | Comparable | Mismatches | Confidence |");
    push("| --- | --- | --- | --- | --- | --- |");
    for (const c of categories) {
      push(
        `| ${c.category} | ${c.score == null ? "*not compared*" : pct(c.score)} | ${pct(c.evidenceCoverage)} ` +
        `| ${c.admissibleComparisons}/${c.totalDimensions} | ${c.mismatches} | ${c.confidence == null ? "—" : c.confidence.toFixed(2)} |`
      );
    }
    push();
    push("*Not compared* means nothing in the category was admissible on both sides. It is not");
    push("a score of zero, and reading it as one would invent a disagreement nobody observed.");
    push();
  }

  /* ---------------------------------------------------- no composite */

  push("## There is no overall number");
  push();
  push(comparison?.compositeScoreNote ??
    "No composite score is produced. Weighting the categories against each other would require measured evidence about which ones matter, and that evidence does not exist.");
  push();

  /* ------------------------------------------------------ per category */

  push("## Per category");
  push();
  for (const c of categories) {
    push(`### ${c.category}`);
    push();
    if (c.score == null) {
      push(`Nothing in this category was comparable (${c.totalDimensions} dimension(s) examined, none admissible on both sides).`);
      if (c.unresolvedClaims?.length) {
        push();
        push("Why each was skipped:");
        for (const u of c.unresolvedClaims) push(`- ${u}`);
      }
      push();
      continue;
    }

    push(`${c.admissibleComparisons} of ${c.totalDimensions} dimension(s) were comparable; ${c.mismatches} differed.`);
    push();
    const sev = c.severityBreakdown ?? {};
    const present = Object.entries(sev).filter(([, n]) => n > 0);
    if (present.length) {
      push(`Severity: ${present.map(([k, n]) => `${n} ${k}`).join(", ")}`);
      push();
    }

    if (c.differences?.length) {
      push("| Dimension | Reference | Target | Severity | Evidence |");
      push("| --- | --- | --- | --- | --- |");
      for (const d of c.differences) {
        const refEv = (d.referenceEvidence ?? []).join(", ") || "—";
        const tgtEv = (d.targetEvidence ?? []).join(", ") || "—";
        push(
          `| ${d.dimension} | ${fmt(d.referenceValue)} *(${d.referenceStatus ?? "?"})* ` +
          `| ${fmt(d.targetValue)} *(${d.targetStatus ?? "?"})* | ${d.severity} | ref ${refEv} / tgt ${tgtEv} |`
        );
      }
      push();
    }

    if (c.unresolvedClaims?.length) {
      push("Not compared in this category:");
      for (const u of c.unresolvedClaims) push(`- ${u}`);
      push();
    }
  }

  /* ------------------------------------------ component identity */

  if (comparison?.componentIdentity) {
    push("## Component identity");
    push();
    push("Reported, never used to gate anything. Matching components across two builds is an");
    push("open limitation (`def_0030`), and a match here is advisory.");
    push();
    push("```json");
    push(JSON.stringify(comparison.componentIdentity, null, 2));
    push("```");
    push();
  }

  /* ------------------------------------------- what is not validated */

  push("## What is not validated");
  push();
  push("- **No tolerance in this system is validated.** A dimension inside tolerance fell");
  push("  inside a number nobody has certified. It is not a pass in any formal sense.");
  push("- **Screenshot-estimated evidence is informational.** Where either side was estimated,");
  push("  a difference is reported at informational severity, because an estimate could never");
  push("  have supported the assertion in the first place.");
  push("- **Contested claims are excluded**, not resolved. A claim two sources disagree about");
  push("  is not compared at all, rather than compared against whichever value won.");
  push(`- **${differences.length} difference(s)** are recorded in total. None of them was corrected`);
  push("  automatically; every correction in this system is a task for a person.");
  push();

  return out.join("\n");
}

function fmt(value) {
  if (value == null) return "*absent*";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

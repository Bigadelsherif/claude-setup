import { stampComment } from "../ir/hash.mjs";
import { standardHeader } from "./header.mjs";
import { isCriticalClaim } from "../evidence/disagreement.mjs";

/**
 * IR -> disagreement-report.md
 *
 * Written whenever more than one source contributed. It is the record that no
 * source was quietly discarded: every candidate appears, with its evidence id,
 * its technique, and the reason a preference was or was not justified.
 */
export function projectDisagreementReport(ir, hash) {
  const disagreements = ir.disagreements ?? [];
  const out = [];
  const push = (l = "") => out.push(l);

  push(stampComment(hash));
  push(standardHeader(ir, { title: `Disagreement report — ${ir.meta.slug}`, nextAction: "a contested claim is never rendered as a settled value anywhere. Decide which source you trust before building on one." }));
  push();
  push(`Sources present: ${(ir.sourceKinds ?? []).map((s) => `\`${s}\``).join(", ") || "one"}`);
  push();

  if (!disagreements.length) {
    push("No cross-source comparison produced a difference. Either only one source was available, or every shared claim matched exactly.");
    push();
    push("---");
    push();
    push("*Generated from `analysis/ir.json`. Do not edit — correct the evidence and regenerate.*");
    return out.join("\n");
  }

  const contested = disagreements.filter((d) => !d.magnitude.withinTolerance);
  const corroborated = disagreements.filter((d) => d.magnitude.withinTolerance);
  const critical = contested.filter((d) => isCriticalClaim(d.claim));

  push(
    `**${disagreements.length} cross-source comparison(s):** ${contested.length} genuine disagreement(s), ` +
      `${corroborated.length} corroboration(s) within tolerance, ${critical.length} on critical claims.`
  );
  push();
  push("> A preference selects which value to display. It never deletes the competing record, and it is only applied where a claim-specific rule justifies it.");
  push();

  /* ------------------------------------------------- source comparison */

  push("## Source comparison");
  push();
  push("| Claim | Type | Candidates | Delta | Within tolerance | Preferred | Resolution |");
  push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const d of disagreements) {
    const candidates = d.candidateValues
      .map((c) => `\`${c.sourceKind}\`=${JSON.stringify(c.value)}`)
      .join("<br>");
    push(
      `| \`${d.claim}\`${isCriticalClaim(d.claim) ? " **(critical)**" : ""} | ${d.disagreementType} | ${candidates} | ` +
        `${d.magnitude.delta ?? "—"}${d.magnitude.unit ? ` ${d.magnitude.unit}` : ""} | ` +
        `${d.magnitude.withinTolerance ? "yes" : "**no**"} | ` +
        `${d.preferredSource ? `\`${d.preferredSource}\`` : "— none justified"} | ${d.resolutionStatus} |`
    );
  }
  push();

  /* ------------------------------------------------- confidence impact */

  push("## Confidence impact");
  push();
  push("| Claim | Penalty | Effect |");
  push("| --- | --- | --- |");
  for (const d of disagreements) {
    const effect = d.penaltyApplied === 1
      ? "none — the sources agree within tolerance"
      : `confidence multiplied by ${d.penaltyApplied}`;
    push(`| \`${d.claim}\` | ${d.penaltyApplied} | ${effect} |`);
  }
  push();
  push("A measurement that differs only within tolerance carries no penalty. Charging one would punish two methods for agreeing as closely as their methods permit.");
  push();

  /* -------------------------------------------- per-disagreement detail */

  push("## Detail");
  push();
  for (const d of disagreements) {
    push(`### \`${d.id}\` — ${d.claim}${isCriticalClaim(d.claim) ? " *(critical)*" : ""}`);
    push();
    push(`**Type:** ${d.disagreementType} · **Resolution:** ${d.resolutionStatus}`);
    push();
    push("| Source | Technique | Value | Status | Confidence | Evidence |");
    push("| --- | --- | --- | --- | --- | --- |");
    for (const c of d.candidateValues) {
      push(
        `| \`${c.sourceKind}\` | ${c.technique ?? "—"} | ${JSON.stringify(c.value)} | ${c.status} | ` +
          `${(c.confidence ?? 0).toFixed(2)} | \`${c.evidenceId}\` |`
      );
    }
    push();
    push(d.explanation);
    push();
    if (d.preferredSource) {
      push(`**Preferred:** \`${d.preferredSource}\` — and the competing record \`${d.candidateValues.find((c) => c.evidenceId !== d.preferredEvidenceId)?.evidenceId}\` is retained in full.`);
    } else {
      push("**No preference applied.** No claim-specific rule favours either source, so the disagreement stays open rather than being resolved by convenience.");
    }
    push();
  }

  /* ------------------------------------------------------ consequences */

  if (critical.length) {
    push("## Consequences for output");
    push();
    push("These contested claims are critical: an output built on either value would match neither source.");
    push();
    for (const d of critical) {
      push(`- \`${d.claim}\` — ${d.candidateValues.map((c) => `${c.sourceKind} says ${JSON.stringify(c.value)}`).join(", ")}`);
    }
    push();
    push("`recreate` and `extend` block while these remain unresolved. `analyze` and `improve` may proceed, because describing a disagreement is legitimate where building on one is not.");
    push();
  }

  push("---");
  push();
  push("*Generated from `analysis/ir.json`. Do not edit — correct the evidence and regenerate.*");

  return out.join("\n");
}

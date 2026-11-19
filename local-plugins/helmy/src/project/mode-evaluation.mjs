import { stampComment } from "../ir/hash.mjs";
import { standardHeader } from "./header.mjs";

/**
 * IR -> mode-evaluation.md
 *
 * Always written. A reader must be able to see what the requested output
 * needed, what the capture supplied, and precisely which gap decided the
 * verdict — rather than inferring it from whether a prompt happens to exist.
 */
export function projectModeEvaluation(ir, hash) {
  const m = ir.modeEvaluation;
  const out = [];
  const push = (l = "") => out.push(l);

  push(stampComment(hash));
  push(standardHeader(ir, { title: `Mode evaluation — ${ir.meta.slug}`, nextAction: "each unmet requirement names its remedy. Recapture, or use a mode this evidence supports." }));
  push();

  if (!m) {
    push("> No mode evaluation is attached to this IR.");
    return out.join("\n");
  }

  push(`**Requested mode:** \`${m.requestedMode}\` — ${m.intent}`);
  push(`**Decision:** \`${m.decision}\``);
  push(`**Confidence:** ${m.confidence.toFixed(2)}`);
  push();
  push(`> ${m.recommendedNextAction}`);
  push();

  /* ------------------------------------------------------- thresholds */

  const t = m.thresholds;
  push("## Thresholds for this mode");
  push();
  push("Each mode carries its own floors. There is deliberately no single global threshold — `analyze` and `recreate` do not need the same evidence and should not answer to the same numbers.");
  push();
  push("| Signal | Required | Actual | |");
  push("| --- | --- | --- | --- |");
  const row = (label, min, actual) => {
    if (min == null || actual == null) return;
    push(`| ${label} | ${min.toFixed(2)} | ${actual.toFixed(2)} | ${actual >= min ? "pass" : "**fail**"} |`);
  };
  row("Overall confidence", t.minConfidence, t.actual.confidence);
  row("Content reached", t.minContentReached, t.actual.contentReached);
  row("Coverage factor", t.minCoverageFactor, t.actual.coverageFactor);
  if (t.minComponentConfidence > 0) row("Primary component confidence", t.minComponentConfidence, t.actual.componentConfidence);
  push();

  /* --------------------------------------------------------- evidence */

  push("## Required evidence");
  push();
  push("| Requirement | Status | Detail |");
  push("| --- | --- | --- |");
  const availableIds = new Set(m.availableEvidence.map((e) => e.id));
  for (const req of m.requiredEvidence) {
    const found = m.availableEvidence.find((e) => e.id === req.id);
    const gap = m.missingEvidence.find((e) => e.id === req.id);
    const state = availableIds.has(req.id) ? "present" : gap?.severity === "blocking" ? "**MISSING**" : "missing (warning)";
    push(`| ${req.label} | ${state} | ${(found ?? gap)?.detail ?? "—"} |`);
  }
  push();

  if (m.optionalEvidence?.length) {
    push("## Optional evidence");
    push();
    push("Absent optional evidence is reported, never fatal.");
    push();
    for (const req of m.optionalEvidence) {
      const found = m.availableEvidence.find((e) => e.id === req.id);
      const gap = m.missingEvidence.find((e) => e.id === req.id);
      push(`- ${availableIds.has(req.id) ? "present" : "absent"} — **${req.label}**: ${(found ?? gap)?.detail ?? "—"}`);
    }
    push();
  }

  /* ------------------------------------------------------------- gaps */

  if (m.blockingGaps.length) {
    push("## Blocking gaps");
    push();
    for (const gap of m.blockingGaps) {
      push(`### \`${gap.id}\` — ${gap.label}`);
      push();
      push(gap.detail);
      push();
      push(
        gap.remedy === "source"
          ? "**Remedy:** none by re-capture. This is a limit of the input kind."
          : gap.remedy === "none"
            ? "**Remedy:** the reference does not contain this."
            : "**Remedy:** re-capture the page."
      );
      push();
    }
  }

  if (m.warningGaps.length) {
    push("## Warning gaps");
    push();
    push("Present but incomplete, or absent without being fatal to this mode. Treat each as a decision to make deliberately, not as a fact about the reference.");
    push();
    for (const gap of m.warningGaps) {
      push(`- **${gap.label}** — ${gap.detail}`);
    }
    push();
  }

  /* -------------------------------------------------------- admissible */

  push("## Source admissibility");
  push();
  push(`Accepted sources: ${m.acceptableSourceKinds.map((s) => `\`${s}\``).join(", ")}`);
  push(`Screenshot estimates: ${m.allowScreenshotEstimates ? "permitted" : "**not permitted** for this mode"}`);
  push();

  push("## Artifacts this mode requires");
  push();
  for (const artifact of m.requiredArtifacts) push(`- \`${artifact}\``);
  push();

  if (m.notes) {
    push("---");
    push();
    push(`*${m.notes}*`);
    push();
  }

  push("---");
  push();
  push("*Generated from `analysis/ir.json`. Do not edit — correct the evidence and regenerate.*");

  return out.join("\n");
}

import { standardHeader } from "./header.mjs";
import { coveragePercent, confidenceText } from "./fmt.mjs";

/**
 * IR -> coverage-report.md
 *
 * Always written, whether or not the run is safe. A reader must be able to see
 * what was looked at before reading anything that was concluded.
 */
export function projectCoverageReport(ir, hash) {
  const c = ir.coverage;
  const v = ir.verification;
  const s = ir.safety;
  const out = [];
  const push = (l = "") => out.push(l);

  push(standardHeader(ir, { title: `Coverage report — ${ir.meta.slug}`, nextAction: "read `output/design-spec.md` for what was concluded from what this report says was reached." }));
  push();
  push(`**Safety status: \`${s?.status ?? "unknown"}\`**  `);
  push(`${s?.summary ?? ""}`);
  push();
  push(`Source: \`${ir.meta.source.value}\`  `);
  push(`Viewport: ${ir.meta.viewports.join(", ")}px · Capture method: ${c?.captureMethod ?? "unknown"}  `);
  push(`Captured: ${ir.meta.capturedAt}`);
  push();

  if (!c) {
    push("> No coverage assessment is attached to this IR.");
    return out.join("\n");
  }

  /* ---------------------------------------------------------- headline */

  push("## Confidence");
  push();
  push("| | Value |");
  push("| --- | --- |");
  push(`| Provenance confidence (how well claims were read) | ${confidenceText(ir.confidence.provenance)} |`);
  push(`| Coverage factor (whether the right region was read) | **${c.coverageFactor.toFixed(2)}** |`);
  /* Beside the factor, not below it. The observability status used to sit four
   * rows further down while the 1.00 stood alone at the top (def_0050). */
  if (c.observability) {
    push(`| DOM observability (how much of the page could be seen) | **${c.observability.status}**${c.observability.domObservedPercent != null ? ` — ${(c.observability.domObservedPercent * 100).toFixed(1)}% of nodes visible` : ""} |`);
  }
  push(`| **Overall confidence** | **${confidenceText(ir.confidence.overall)}** |`);
  push();
  if (c.observability && c.observability.status !== "full") {
    push();
    push(`**Observability: ${c.observability.status}.** ${c.observability.reason}`);
    push();
    push(
      "The coverage factor above describes how thoroughly the VISIBLE nodes were sampled. " +
        "It is a separate question from how much of the page was visible at all, and on this " +
        "capture the two answers differ."
    );
  }
  push();
  push(
    "Overall confidence is the product of the two. A perfectly-read measurement " +
      "of the wrong page region earns no confidence, which is the whole point of " +
      "the second factor."
  );
  push();
  push(`Coverage factor components: node ${c.factors.node} × stylesheet ${c.factors.stylesheet} × content ${c.factors.content}`);
  push();

  /* ------------------------------------------------------------ nodes */

  push("## What was sampled");
  push();
  push("| Metric | Value |");
  push("| --- | --- |");
  push(`| Total DOM nodes | ${c.nodesTotal} |`);
  push(`| Visible nodes | ${c.nodesVisible} |`);
  push(`| Sampled nodes | ${c.nodesSampled} |`);
  push(`| Sampled % of total | ${(c.sampledPercent * 100).toFixed(1)}% |`);
  push(`| Sampled % of visible | ${(c.visibleSampledPercent * 100).toFixed(1)}% |`);
  push(`| Hidden/collapsed subtrees skipped | ${c.hiddenSubtrees} (${c.hiddenNodesSkipped} nodes) |`);
  push();

  const reasons = Object.entries(c.hiddenByReason ?? {});
  if (reasons.length) {
    push("Skipped subtrees by reason:");
    push();
    for (const [reason, count] of reasons.sort((a, b) => b[1] - a[1])) {
      push(`- \`${reason}\` — ${count}`);
    }
    push();
  }

  /* ---------------------------------------------------------- regions */

  push("## Region coverage");
  push();
  push("| Region | Coverage |");
  push("| --- | --- |");
  push(`| Content (main) | ${coveragePercent(c.mainCoverage, c.regionSampled?.main)} |`);
  push(`| Header / nav | ${coveragePercent(c.headerCoverage, c.regionSampled?.header)} |`);
  push(`| Footer | ${coveragePercent(c.footerCoverage, c.regionSampled?.footer)} |`);
  push();
  if (c.truncated) {
    push(`The walk stopped at the ${c.nodeCap ?? "configured"}-node budget: ${c.nodesSampled} of ${c.nodesVisible} visible nodes were sampled. Absence of anything below is not evidence that it is absent from the page.`);
    push();
  }
  push(`**contentReached: ${c.contentReached.toFixed(2)}** — ${c.contentReachedReason}`);
  push();
  push(`Repeat groups detected: ${c.repeatGroupsDetected}, of which **${c.repeatGroupsInMain}** are inside the content region.`);
  push();

  /* ------------------------------------------------------ stylesheets */

  push("## Stylesheets");
  push();
  push(`${c.stylesheets.accessible} of ${c.stylesheets.total} accessible (${(c.stylesheets.accessibility * 100).toFixed(1)}%), ${c.stylesheets.blocked} blocked by cross-origin policy.`);
  push();
  if (c.stylesheets.blocked) {
    push("Blocked stylesheets contribute no rules. Every value that would have come from them is recorded as `unknown`, never estimated.");
    push();
  }

  /* --------------------------------------------------------- overlays */

  if (c.overlays || c.consentBanners) {
    push("## Overlays and banners");
    push();
    push(`Fixed/sticky overlays: ${c.overlays} · Consent/cookie elements: ${c.consentBanners}`);
    push();
    for (const o of (c.overlayDetail ?? []).slice(0, 6)) {
      push(`- \`${o.selector}\` — ${o.position}, z-index ${o.zIndex}, ${o.width}×${o.height} (${o.region})`);
    }
    for (const b of (c.consentBannerDetail ?? []).slice(0, 4)) {
      push(`- consent: \`${b.selector}\` — ${b.width}×${b.height}`);
    }
    push();
  }

  /* ----------------------------------------------------- verification */

  push("## Primary-region verification");
  push();
  push(`Result: **${v?.passed ? "passed" : "FAILED"}**`);
  push();
  push("| Check | Result | Detail |");
  push("| --- | --- | --- |");
  for (const check of v?.checks ?? []) {
    push(`| \`${check.id}\` | ${check.passed ? "pass" : check.severity === "info" ? "note" : "**fail**"} | ${check.detail} |`);
  }
  push();
  if (v?.expectedRegion) {
    push(`**Expected region:** \`${v.expectedRegion.selector}\` (${v.expectedRegion.kind}, ${v.expectedRegion.visibleDescendants} visible descendants)`);
  }
  if (v?.analysedRegion) {
    push(`**Largest group analysed:** \`${v.analysedRegion.signature}\` ×${v.analysedRegion.count} in the ${v.analysedRegion.region} region`);
  }
  push();

  /* -------------------------------------------------------- warnings */

  if (c.warnings?.length) {
    push("## Warnings");
    push();
    for (const w of c.warnings) {
      push(`- **${w.severity}** \`${w.code}\` — ${w.message}`);
    }
    push();
  }

  push("---");
  push();
  push("*Generated from `analysis/ir.json`. Do not edit — correct the evidence and regenerate.*");

  return out.join("\n");
}

/**
 * IR -> extraction-warnings.md
 * The operator-facing list: what the extractor itself flagged.
 */
export function projectExtractionWarnings(ir, hash) {
  const c = ir.coverage;
  const out = [];
  const push = (l = "") => out.push(l);

  push(standardHeader(ir, { title: `Extraction warnings — ${ir.meta.slug}`, nextAction: "a warning here means a value is absent, not that it is zero. Check the design spec for how each gap was reported." }));
  push();

  const warnings = c?.warnings ?? [];
  if (!warnings.length) {
    push("No extraction warnings were raised.");
    push();
  } else {
    push(`${warnings.length} warning(s), most severe first.`);
    push();
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    for (const w of [...warnings].sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9))) {
      push(`### \`${w.code}\` — ${w.severity}`);
      push();
      push(w.message);
      push();
    }
  }

  const rejected = ir.componentCandidates ?? [];
  if (rejected.length) {
    push("## Components rejected");
    push();
    push("These repeated groups were detected but did not qualify as components.");
    push();
    for (const candidate of rejected) {
      push(`- \`${candidate.selectors.join(", ")}\` (${candidate.id}, confidence ${candidate.confidence.toFixed(2)}) — ${candidate.rejectedBecause.join("; ")}`);
    }
    push();
  }

  if (ir.unknowns?.length) {
    push("## Unknowns");
    push();
    push(`${ir.unknowns.length} claim(s) could not be determined. Each carries a reason; none was estimated to fill the gap.`);
    push();
    const grouped = new Map();
    for (const u of ir.unknowns) {
      const key = u.reason;
      grouped.set(key, (grouped.get(key) ?? 0) + 1);
    }
    for (const [reason, count] of [...grouped.entries()].sort((a, b) => b[1] - a[1])) {
      push(`- ${count > 1 ? `**×${count}** ` : ""}${reason}`);
    }
    push();
  }

  push("---");
  push();
  push("*Generated from `analysis/ir.json`. Do not edit — correct the evidence and regenerate.*");

  return out.join("\n");
}

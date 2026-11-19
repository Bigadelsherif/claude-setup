import { claimLine, section, isUsable, confidenceText } from "./fmt.mjs";
import { standardHeader } from "./header.mjs";
import * as color from "../util/color.mjs";

/**
 * IR -> design-spec.md (the human-readable analysis).
 *
 * Every numeric claim carries a value, a status, and an evidence reference.
 * Gaps are printed, not omitted — a reader must be able to tell the difference
 * between "this is 12px" and "we never found out".
 */
export function projectDesignSpec(ir, hash, options = {}) {
  const out = [];
  const t = ir.tokens;
  const partial = options.partial === true;
  const cov = ir.coverage;
  const safety = ir.safety;

  out.push(standardHeader(ir, {
    title: `${partial ? "Partial design specification" : "Design specification"} — ${ir.meta.slug}`,
    nextAction: partial
      ? "read `output/blocked-prompt.md` first. This spec is partial because the run was refused, and it describes only what was established."
      : "read `output/evidence-report.md` to see how each value below came to be known.",
    limitations: partial
      ? ["This spec is partial. It is named that way so it cannot be mistaken for a complete one."]
      : []
  }));

  // Coverage leads. A reader must know what was looked at before reading a
  // single measurement — otherwise correct numbers about the wrong region read
  // exactly like correct numbers about the right one.
  if (safety) {
    out.push(
      `> **Safety status: \`${safety.status}\`** — ${safety.summary}\n` +
        (cov ? `> contentReached ${cov.contentReached.toFixed(2)} · coverage factor ${cov.coverageFactor.toFixed(2)} · ${(cov.visibleSampledPercent * 100).toFixed(1)}% of visible nodes sampled\n` : "") +
        `> See \`coverage-report.md\` before relying on anything below.\n`
    );
  }

  if (partial) {
    out.push(
      "> **This specification is partial.** Prompt generation was blocked for this " +
        "capture. The measurements below are real, but they may describe page " +
        "furniture rather than page content. See `blocked-prompt.md`.\n"
    );
  }

  out.push(
    `Source: \`${ir.meta.source.value}\`  \n` +
      `Captured: ${ir.meta.capturedAt}  \n` +
      `Viewport(s): ${ir.meta.viewports.join(", ") || "unknown"}px  \n` +
      `Extractor: ${ir.meta.extractorVersion} · mode ${ir.meta.coverage?.mode ?? "full"}  \n` +
      `Confidence: ${confidenceText(ir.confidence.overall)} (provenance ${confidenceText(ir.confidence.provenance)} × coverage ${(ir.confidence.coverageFactor ?? 1).toFixed(2)})\n`
  );

  out.push(
    "> Every claim below states its status. **measured** = read off rendered geometry; " +
      "**observed** = read from a declared style; **inferred** = pattern across samples; " +
      "**estimated** = reconstructed, not exact; **unknown** = not determined. " +
      "Bracketed `[ev_*]` ids resolve to `analysis/evidence-map.json`.\n"
  );

  /* ------------------------------------------------------------- layout */

  const container = ir.layout.containers[0];
  const grid = ir.layout.grids[0];
  out.push(
    section("Layout", [
      container ? claimLine("Container max-width", container.maxWidth) : null,
      container ? claimLine("Container horizontal padding", container.paddingX) : null,
      grid ? claimLine(`Primary grid columns (\`${grid.selector ?? "grid"}\`)`, grid.columns) : null,
      grid ? claimLine("Primary grid gap", grid.gap) : null,
      claimLine("Breakpoints", ir.layout.breakpoints),
      claimLine("Explicit z-index layers", ir.layout.zLayers)
    ])
  );

  /* --------------------------------------------------------- typography */

  const typeLines = [];
  const roleOrder = ["body", "h1", "h2", "h3"];
  for (const role of roleOrder) {
    const group = t.typography[role];
    if (!group) continue;
    typeLines.push(`\n**${role}**`);
    if (group.fontFamily) typeLines.push(claimLine("Font family", group.fontFamily, { indent: "  - " }));
    if (group.fontSize) typeLines.push(claimLine("Font size", group.fontSize, { indent: "  - " }));
    if (group.lineHeight) typeLines.push(claimLine("Line height", group.lineHeight, { indent: "  - " }));
    if (group.lineHeightRatio) typeLines.push(claimLine("Line-height ratio", group.lineHeightRatio, { indent: "  - " }));
    if (group.fontWeight) typeLines.push(claimLine("Font weight", group.fontWeight, { indent: "  - " }));
    if (group.letterSpacing) typeLines.push(claimLine("Letter spacing", group.letterSpacing, { indent: "  - " }));
  }
  typeLines.push("");
  typeLines.push(claimLine("Type ramp (all rendered sizes)", ir.scales.typeRamp));
  out.push(section("Typography", typeLines));

  /* -------------------------------------------------------------- colour */

  const colorLines = Object.entries(t.color)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, claim]) => claimLine(`\`${name}\``, claim));

  const pageBg = t.color["surface.page"];
  const textPrimary = t.color["text.primary"];
  if (isUsable(pageBg) && isUsable(textPrimary)) {
    const ratio = color.contrast(textPrimary.value, pageBg.value);
    if (ratio != null) {
      colorLines.push("");
      colorLines.push(
        `- Contrast, \`text.primary\` on \`surface.page\`: **${ratio}:1** — measured ` +
          `[${[...(textPrimary.evidence ?? []), ...(pageBg.evidence ?? [])].join(", ")}] ` +
          `(${ratio >= 4.5 ? "meets" : "fails"} WCAG AA for body text)`
      );
    }
  }
  out.push(section("Colour", colorLines));

  /* -------------------------------------------------------------- spacing */

  const spacingLines = [
    claimLine("Base unit", ir.scales.spacingBaseUnit),
    claimLine("Spacing ramp", ir.scales.spacingRamp)
  ];
  const spacingSteps = Object.entries(t.spacing).sort(([a], [b]) => Number(a) - Number(b));
  if (spacingSteps.length) {
    spacingLines.push("");
    spacingLines.push("Observed step frequencies:");
    for (const [step, claim] of spacingSteps) {
      spacingLines.push(claimLine(`\`space-${step}\``, claim, { indent: "  - " }));
    }
  }
  out.push(section("Spacing", spacingLines));

  /* ------------------------------------------------- radius and elevation */

  out.push(
    section("Radius and elevation", [
      claimLine("Radius ladder", ir.scales.radiusLadder),
      ...Object.entries(t.radius)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([name, claim]) => claimLine(`\`radius.${name}\``, claim)),
      ...Object.entries(t.elevation).map(([name, claim]) => claimLine(`\`elevation.${name}\``, claim)),
      ...Object.entries(t.border).map(([name, claim]) => claimLine(`\`border.${name}\``, claim))
    ])
  );

  /* --------------------------------------------------------------- motion */

  const motionLines = [];
  for (const transition of ir.motion.transitions) {
    motionLines.push(`\n**${transition.role}**`);
    if (transition.duration) motionLines.push(claimLine("Duration", transition.duration, { indent: "  - " }));
    if (transition.easing) motionLines.push(claimLine("Easing", transition.easing, { indent: "  - " }));
  }
  motionLines.push("");
  motionLines.push(claimLine("Declared keyframes", ir.motion.keyframes));
  out.push(section("Motion", motionLines));

  /* ----------------------------------------------------------- components */

  const componentLines = [];
  for (const component of ir.components) {
    componentLines.push(`\n### \`${component.id}\` (${component.role})`);
    componentLines.push("");
    /* When the class-based selector is unusable — build-generated, or made
     * only of utility classes that name presentation rather than identity — the
     * deploy-stable selector is the one a reader can act on. Printing the class
     * selector alone hands them `.group.relative` or `.module__oN_qsG__siteCard`
     * and calls it the component's selector (def_0018). */
    const classSelector = component.selectors.join(", ");
    if (component.stableSelector) {
      componentLines.push(`- Selector: \`${component.stableSelector}\``);
      if (classSelector) {
        const why =
          component.selectorUnusableReason === "presentational"
            ? "its classes name presentation, not identity, and are shared with unrelated elements"
            : component.selectorUnusableReason === "build-generated"
              ? "its classes are build-generated and change on the next deploy"
              : "its classes carry no identity";
        componentLines.push(
          `- Class selector in this capture: \`${classSelector}\` — not usable as written, because ` +
          `${why}. Use the selector above.`
        );
      }
    } else {
      componentLines.push(`- Selector: \`${classSelector || "unknown"}\``);
    }
    if (component.instanceCount) {
      componentLines.push(claimLine("Instances on page", component.instanceCount));
    }
    componentLines.push(`- Component confidence: ${component.confidence.toFixed(2)}`);
    if (component.anatomy.length) {
      componentLines.push("");
      componentLines.push("Anatomy:");
      for (const part of component.anatomy) {
        componentLines.push(claimLine(`${part.part} · ${part.property}`, part.claim, { indent: "  - " }));
      }
    }
    const unknownStates = Object.entries(component.states)
      .filter(([, s]) => s.status === "unknown")
      .map(([name]) => name);
    if (unknownStates.length) {
      componentLines.push("");
      componentLines.push(`- States not determined: ${unknownStates.map((s) => `\`${s}\``).join(", ")} — unknown (not induced in this capture)`);
    }
  }

  if (!ir.components.length) {
    componentLines.push("");
    componentLines.push("No repeated group qualified as a component in this capture.");
  }

  const candidates = ir.componentCandidates ?? [];
  if (candidates.length) {
    componentLines.push("");
    componentLines.push("### Rejected candidates");
    componentLines.push("");
    componentLines.push(
      "Detected as repeated structure but not modelled as components. Listing them " +
        "is deliberate: a rejected candidate is information, and silently dropping " +
        "one would look like it was never found."
    );
    componentLines.push("");
    for (const candidate of candidates) {
      componentLines.push(
        `- \`${candidate.selectors.join(", ")}\` (${candidate.id}, confidence ${candidate.confidence.toFixed(2)}) — rejected: ${candidate.rejectedBecause.join("; ")}`
      );
    }
  }
  out.push(section("Components", componentLines));

  /* ------------------------------------------------------------ contested */

  const contested = ir.contestedClaims ?? [];
  if (contested.length) {
    const lines = [
      "Two sources describe these differently. Both values are retained; neither has been discarded.",
      ""
    ];
    for (const entry of contested) {
      const candidates = entry.candidates
        .map((c) => `\`${c.source}\` says ${JSON.stringify(c.value)} (${c.status}, confidence ${(c.confidence ?? 0).toFixed(2)})`)
        .join(" — ");
      lines.push(
        `- \`${entry.claim}\`${entry.critical ? " (critical)" : ""} — contested via ${entry.type}: ` +
          `${candidates}. Resolution: ${entry.resolutionStatus}.`
      );
    }
    lines.push("");
    lines.push("See `disagreement-report.md` for the full comparison and the reasoning behind any preference.");
    out.push(section("Contested claims", lines));
  }

  /* ------------------------------------------------------------- unknowns */

  out.push(
    section(
      "Not determined",
      [
        "These are recorded gaps, not omissions. Nothing below was estimated to fill space.",
        "",
        ...ir.unknowns.map((u) => `- \`${u.claim}\` — ${u.reason}`)
      ]
    )
  );

  /* ----------------------------------------------------------- provenance */

  out.push(
    section("Coverage", [
      `- Nodes sampled: ${ir.meta.coverage?.nodesSampled ?? "unknown"} of ${ir.meta.coverage?.nodesTotal ?? "unknown"}`,
      `- Stylesheets unreachable: ${(ir.meta.coverage?.sheetsBlocked ?? []).length}`,
      `- Categories populated: ${ir.meta.coverage?.categoriesPopulated} of ${ir.meta.coverage?.categoriesTotal}`,
      "",
      /* `null` means the category holds no claims, and it says so rather than
       * printing 0.00 — which a reader would take for a measured verdict
       * (def_0056). This is the only byCategory consumer that formatted the
       * value without a null branch. */
      ...Object.entries(ir.confidence.byCategory).map(
        ([cat, value]) =>
          `- \`${cat}\` confidence: ${value == null ? "not measured — no claims in this category" : value.toFixed(2)}`
      )
    ])
  );

  out.push(
    "---\n\n" +
      "*This file is a projection of `analysis/ir.json`. Do not edit it. " +
      "To change a claim, correct the underlying evidence and regenerate.*\n"
  );

  return out.filter(Boolean).join("\n");
}

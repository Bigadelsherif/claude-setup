import { stampComment } from "../ir/hash.mjs";
import { standardHeader } from "./header.mjs";

/**
 * IR -> component-inventory.json.
 * A machine-readable component list carrying anatomy, states, and the evidence
 * behind each property. Consumed by the fidelity differ in a later phase.
 */
export function projectComponents(ir, hash) {
  return {
    $schemaVersion: "0.1.0",
    $extensions: { "helmy.dev": { irHash: hash, slug: ir.meta.slug } },
    generatedFrom: "analysis/ir.json",
    components: ir.components.map((component) => ({
      id: component.id,
      role: component.role,
      selectors: component.selectors,
      instanceCount: component.instanceCount?.value ?? null,
      confidence: component.confidence,
      anatomy: component.anatomy.map((part) => ({
        part: part.part,
        property: part.property,
        value: part.claim?.value ?? null,
        unit: part.claim?.unit ?? null,
        status: part.claim?.status ?? "unknown",
        evidence: part.claim?.evidence ?? []
      })),
      variants: component.variants,
      states: component.states,
      responsive: component.responsive,
      tokensUsed: component.tokensUsed
    })),
    candidatesNotModelled: {
      note: "Repeat groups detected but not modelled in this phase.",
      items: []
    }
  };
}

/**
 * IR -> fidelity-checklist.md.
 * Deliberately assertion-shaped: each line is a check the fidelity differ can
 * execute against a build, not prose for a human to interpret.
 */
export function projectFidelityChecklist(ir, hash) {
  const out = [];
  const push = (line = "") => out.push(line);
  const t = ir.tokens;
  const container = ir.layout.containers[0];
  const grid = ir.layout.grids[0];

  push(stampComment(hash));
  push(standardHeader(ir, { title: `Fidelity checklist — ${ir.meta.slug}`, nextAction: "check a build against each item. An item marked unknown is not a pass." }));
  push();
  push(
    "Each assertion below is machine-checkable: run the extractor against the build and " +
      "compare. An assertion derived from an `inferred` claim is marked as such — failing it " +
      "may mean the build is wrong, or that the inference was."
  );
  push();
  push("| # | Assertion | Expected | Provenance | Evidence |");
  push("| --- | --- | --- | --- | --- |");

  let n = 0;
  const row = (assertion, claim, unit = "") => {
    if (!claim || claim.value == null || claim.status === "unknown") return;
    n += 1;
    const value = Array.isArray(claim.value) ? claim.value.join(", ") : claim.value;
    push(
      `| ${n} | ${assertion} | \`${value}${unit}\` | ${claim.status} | ${(claim.evidence ?? []).join(", ") || "—"} |`
    );
  };

  row("Container `max-width`", container?.maxWidth, "px");
  row("Container horizontal padding", container?.paddingX, "px");
  row("Primary grid column count", grid?.columns);
  row("Primary grid gap", grid?.gap, "px");
  row("Breakpoints", ir.layout.breakpoints, "px");
  row("Spacing base unit", ir.scales.spacingBaseUnit, "px");
  row("Spacing ramp", ir.scales.spacingRamp, "px");

  for (const role of ["body", "h1", "h2", "h3"]) {
    const group = t.typography[role];
    if (!group) continue;
    row(`\`${role}\` font-size`, group.fontSize, "px");
    row(`\`${role}\` line-height`, group.lineHeightRatio ?? group.lineHeight);
    row(`\`${role}\` font-weight`, group.fontWeight);
    row(`\`${role}\` letter-spacing`, group.letterSpacing, "em");
  }

  for (const [name, claim] of Object.entries(t.color)) {
    row(`Colour \`${name}\``, claim);
  }
  for (const [name, claim] of Object.entries(t.radius)) {
    row(`Radius \`${name}\``, claim, "px");
  }
  for (const [name, claim] of Object.entries(t.elevation)) {
    row(`Elevation \`${name}\``, claim);
  }
  for (const [name, claim] of Object.entries(t.border)) {
    row(`Border \`${name}\``, claim);
  }
  const base = t.motion.base;
  if (base) {
    row("Base transition duration", base.duration, "ms");
    row("Base transition easing", base.easing);
  }

  push();
  push(`**${n} machine-checkable assertions.**`);
  push();

  if (ir.unknowns.length) {
    push("## Not assertable");
    push();
    push("These were not measured, so no assertion can be made. Passing or failing them is not evidence of fidelity.");
    push();
    for (const u of ir.unknowns) push(`- \`${u.claim}\` — ${u.reason}`);
    push();
  }

  push("---");
  push();
  push("*Generated from `analysis/ir.json`. Do not edit — correct the evidence and regenerate.*");

  return out.join("\n");
}

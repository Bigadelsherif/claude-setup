import { literal, isUsable, isSettled, confidenceText } from "./fmt.mjs";
import { standardHeader } from "./header.mjs";
import { STATUS } from "../evidence/status.mjs";

/**
 * IR + target brief -> adaptation-prompt.md
 *
 * Two inputs meet here and must never blend. Reference evidence is measured
 * fact about someone else's page; the brief is requirement about the product
 * being built. A sentence that mixes them silently converts an inference about
 * one product into an instruction for another.
 *
 * Every instruction is therefore rendered as a TRIAD:
 *
 *   Reference evidence   — what was measured, with its status
 *   Target requirement   — what the brief asks for, or "none stated"
 *   Adaptation instruction — how to carry the first into the second
 *
 * The triad is the point. "Use the reference style" is not an instruction; it
 * is an invitation to guess. Naming the measurement, naming the requirement,
 * and naming the operation between them leaves nothing to infer.
 *
 * Sections are machine-marked so V9 can verify the separation structurally
 * rather than trusting the wording.
 */

const SECTION = {
  REFERENCE: "reference-evidence",
  TARGET: "target-brief",
  DERIVED: "derived",
  FIXED: "fixed"
};

const open = (kind, id) => `<!-- bigaap:section kind="${kind}" id="${id}" -->`;
const close = "<!-- /bigaap:section -->";

/** Status suffix so exact, inferred, estimated and unknown never look alike. */
function labelled(claim, fallback = "not determined") {
  if (!isUsable(claim)) return `**${fallback}** *(unknown)*`;
  const value = literal(claim);
  switch (claim.status) {
    case STATUS.MEASURED:
    case STATUS.OBSERVED:
      return `\`${value}\``;
    case STATUS.INFERRED:
      return `\`${value}\` *(inferred)*`;
    case STATUS.ESTIMATED:
      return `approximately \`${value}\` *(estimated — not exact)*`;
    default:
      return `**${fallback}** *(unknown)*`;
  }
}

/**
 * The three-part instruction.
 * `requirement` is null when the brief says nothing — which is stated, never
 * filled in.
 */
function triad({ evidence, requirement, instruction }) {
  return [
    `- **Reference evidence:** ${evidence}`,
    `  **Target requirement:** ${requirement ?? "*none stated in the brief*"}`,
    `  **Adaptation instruction:** ${instruction}`,
    ""
  ].join("\n");
}

export function projectAdaptationPrompt(ir, hash, options = {}) {
  const brief = options.targetBrief ?? null;
  const t = ir.tokens;
  const container = ir.layout.containers[0];
  const grid = ir.layout.grids[0];
  const out = [];
  const push = (l = "") => out.push(l);

  push(standardHeader(ir, { title: `Adaptation prompt — ${brief?.product ?? "target product"}`, nextAction: "reference evidence and brief requirements are in separately-marked sections. Never merge them." }));
  push();
  push(`**Reference analysed:** \`${ir.meta.source.value}\``);
  push(`**Target product:** ${brief?.product ?? "*no brief supplied*"} — ${brief?.productType ?? "unknown type"}`);
  push(`**Mode:** adapt — apply the reference's measured design language to a different product's information architecture.`);
  push();
  push(
    "> This prompt has two sources and keeps them apart. Sections marked " +
      "**reference evidence** are measurements of the analysed page. Sections marked " +
      "**target brief** are requirements for the product being built. Instructions " +
      "state both and then the operation between them. Nothing in the brief was " +
      "inferred from the reference, and nothing measured is presented as a target requirement."
  );
  push();

  /* ------------------------------------------------- 1. reference evidence */

  push("## 0. Objective");
  push();
  push("Apply the design system measured on the reference to a different product, described");
  push("by the target brief in section 3. Two kinds of statement appear below and they are");
  push("marked separately throughout:");
  push();
  push("- **Reference evidence** — what was measured on someone else's page.");
  push("- **Target requirement** — what the brief asks for. Never a measurement.");
  push();
  push("Every mapping states both, then the operation between them. Where the brief says");
  push("nothing, that is stated too — \"none stated\" is information, and an instruction that");
  push("omitted the leg would look like it followed from the reference alone.");
  push();

  push(open(SECTION.REFERENCE, "reference-evidence"));
  push("## 1. Reference design system — measured evidence");
  push();
  push("Measured from the analysed page. Status is shown on every value: bare backticks are exact, `(inferred)` is a pattern across samples, `(estimated)` is not exact, `(unknown)` was never determined.");
  push();
  push("| Concern | Measured value |");
  push("| --- | --- |");
  push(`| Container width | ${labelled(container?.maxWidth)} |`);
  push(`| Container padding | ${labelled(container?.paddingX)} |`);
  push(`| Grid columns | ${labelled(grid?.columns)} |`);
  push(`| Grid gap | ${labelled(grid?.gap)} |`);
  push(`| Body type | ${labelled(t.typography.body?.fontSize)} / ${labelled(t.typography.body?.lineHeight)} |`);
  push(`| Type ramp | ${labelled(ir.scales.typeRamp)} |`);
  push(`| Spacing base | ${labelled(ir.scales.spacingBaseUnit)} |`);
  push(`| Spacing ramp | ${labelled(ir.scales.spacingRamp)} |`);
  for (const [name, claim] of Object.entries(t.color)) push(`| Colour \`${name}\` | ${labelled(claim)} |`);
  for (const [name, claim] of Object.entries(t.radius)) push(`| Radius \`${name}\` | ${labelled(claim)} |`);
  for (const [name, claim] of Object.entries(t.elevation)) push(`| Elevation \`${name}\` | ${labelled(claim)} |`);
  for (const [name, claim] of Object.entries(t.border)) push(`| Border \`${name}\` | ${labelled(claim)} |`);
  if (t.motion.base) {
    push(`| Motion | ${labelled(t.motion.base.duration)} on ${labelled(t.motion.base.easing)} |`);
  }
  push(`| Breakpoints | ${labelled(ir.layout.breakpoints)} |`);
  push();
  push(close);
  push();

  /* --------------------------------------------- 2. reference principles */

  push(open(SECTION.DERIVED, "reference-principles"));
  push("## 2. Reference design principles");
  push();
  push("Relationships rather than values — these are what survive a change of product.");
  push();
  const principles = [];
  if (isUsable(ir.scales.spacingBaseUnit)) {
    principles.push(`Spacing is built on a ${literal(ir.scales.spacingBaseUnit)} unit; every gap is a multiple of it.`);
  } else if (isUsable(ir.scales.spacingObserved)) {
    principles.push("Spacing has no single base unit; values are used ad hoc. Do not manufacture a grid the reference does not have.");
  }
  if (isUsable(container?.maxWidth)) {
    principles.push(`Content is bounded at ${literal(container.maxWidth)} and centred, so line lengths stay readable regardless of viewport.`);
  }
  if (Object.keys(t.radius).length) {
    const ladder = Object.entries(t.radius).map(([n, c]) => `${n} ${literal(c)}`).join(", ");
    principles.push(`Radius is a ladder rather than one value (${ladder}): larger surfaces carry larger radii.`);
  }
  if (Object.keys(t.elevation).length) {
    principles.push("Elevation separates a surface from its background rather than decorating it.");
  } else {
    principles.push("The reference uses no shadow: separation comes from colour and border alone.");
  }
  if (t.motion.base && isUsable(t.motion.base.duration)) {
    principles.push(`Interaction feedback is fast and uniform — ${literal(t.motion.base.duration)} on a single easing curve.`);
  }
  if (!principles.length) principles.push("Too little evidence was recovered to state a design principle.");
  for (const p of principles) push(`- ${p}`);
  push();
  push(close);
  push();

  /* ---------------------------------------------------- 3. target brief */

  push(open(SECTION.TARGET, "target-brief"));
  push("## 3. Target product brief");
  push();
  if (!brief) {
    push("**No target brief was supplied.** Without one there is no target product, and nothing below may be invented to stand in for one.");
  } else {
    push(`- **Product:** ${brief.product} (${brief.productType})`);
    if (brief.targetUsers?.length) push(`- **Users:** ${brief.targetUsers.join(", ")}`);
    if (brief.userGoals?.length) {
      push("- **User goals:**");
      for (const goal of brief.userGoals) push(`  - ${goal}`);
    }
    push(`- **Platform:** ${brief.platform}`);
    push(`- **Framework:** ${brief.framework.name}${brief.framework.styling ? ` with ${brief.framework.styling}` : ""}${brief.framework.componentLibrary ? `, ${brief.framework.componentLibrary}` : ""}`);
    if (brief.viewportRequirements?.length) push(`- **Viewports the target must support:** ${brief.viewportRequirements.join(", ")}px`);
  }
  push();
  push(close);
  push();

  /* ------------------------------------------- 4. target IA */

  push(open(SECTION.TARGET, "target-ia"));
  push("## 4. Target information architecture");
  push();
  if (!brief) {
    push("*No brief supplied — the target's structure is unknown and must not be assumed from the reference.*");
  } else {
    push(`**Page:** ${brief.targetPage.name}${brief.targetPage.route ? ` (\`${brief.targetPage.route}\`)` : ""}`);
    if (brief.targetPage.purpose) push(`**Purpose:** ${brief.targetPage.purpose}`);
    push();
    if (brief.contentModel?.length) {
      push("**Content model** — the target's own entities:");
      push();
      push("| Entity | Fields | Approx. count |");
      push("| --- | --- | --- |");
      for (const entity of brief.contentModel) {
        push(`| ${entity.entity} | ${(entity.fields ?? []).join(", ") || "—"} | ${entity.approximateCount ?? "—"} |`);
      }
      push();
    }
    push("The reference's page structure is **not** the target's. Build the structure above.");
  }
  push();
  push(close);
  push();

  /* ------------------------------------- 5. required functionality */

  push(open(SECTION.TARGET, "target-functionality"));
  push("## 5. Required target functionality");
  push();
  if (!brief?.requiredFunctionality?.length) {
    push("*None stated in the brief. Do not invent functionality — an unstated requirement is not a requirement.*");
  } else {
    push("| Priority | Requirement |");
    push("| --- | --- |");
    for (const f of brief.requiredFunctionality) {
      push(`| ${f.priority ?? "must"} | ${f.description} |`);
    }
  }
  push();
  push(close);
  push();

  /* --------------------------------------- 6. preserved rules (triads) */

  push(open(SECTION.DERIVED, "preserved-rules"));
  push("## 6. Preserved design principles");
  push();
  push("Each rule states the measurement, the target requirement it meets, and the operation between them.");
  push();

  if (isUsable(container?.maxWidth)) {
    push(triad({
      evidence: `The content container is bounded at ${labelled(container.maxWidth)}${isUsable(container.paddingX) ? ` with ${labelled(container.paddingX)} horizontal padding` : ""}.`,
      requirement: brief?.targetPage?.name ? `${brief.targetPage.name} must present ${brief.contentModel?.[0]?.entity ?? "the target's content"} at comfortable reading width.` : null,
      instruction: `Preserve the measured container width and padding exactly. Apply it to the target's own page structure, not to a copy of the reference's.`
    }));
  }

  if (isUsable(ir.scales.spacingBaseUnit)) {
    push(triad({
      evidence: `Spacing is built on a ${labelled(ir.scales.spacingBaseUnit)} base with the ramp ${labelled(ir.scales.spacingRamp)}.`,
      requirement: brief ? `${brief.product} needs a consistent rhythm across its own components.` : null,
      instruction: "Preserve the base unit and ramp. Use only ramp values for padding, margin and gap; a value off the ramp needs a reason."
    }));
  }

  const bodyType = t.typography.body;
  if (bodyType && isUsable(bodyType.fontSize)) {
    push(triad({
      evidence: `Body text is ${labelled(bodyType.fontSize)} with line height ${labelled(bodyType.lineHeight)}; the rendered ramp is ${labelled(ir.scales.typeRamp)}.`,
      requirement: brief ? `${brief.product} must carry the target's own copy at readable density.` : null,
      instruction: "Preserve the size relationships and line-height ratios. Re-map which ramp step each target element uses according to the target's own hierarchy."
    }));
  }

  const colorRoles = Object.entries(t.color).filter(([, c]) => isUsable(c));
  if (colorRoles.length) {
    push(triad({
      evidence: `Colour roles: ${colorRoles.map(([n, c]) => `\`${n}\` ${labelled(c)}`).join(", ")}.`,
      requirement: brief?.brandConstraints?.supplied
        ? `${brief.product} supplies its own palette${brief.brandConstraints.palette?.length ? `: ${brief.brandConstraints.palette.join(", ")}` : ""}.`
        : brief ? `${brief.product} has no palette of its own yet.` : null,
      instruction: brief?.brandConstraints?.supplied
        ? "Preserve the ROLE STRUCTURE — which surface is raised, which text is secondary, what contrast each pair carries — and substitute the target's palette into those roles. Do not carry the reference's hues across."
        : "Preserve the role structure and the measured contrast relationships. Use neutral placeholder hues until the target supplies a palette; do not adopt the reference's brand colour as the target's."
    }));
  }

  for (const [name, claim] of Object.entries(t.radius)) {
    if (!isSettled(claim)) continue;
    push(triad({
      evidence: `\`radius.${name}\` measures ${labelled(claim)}.`,
      requirement: brief?.requiredComponents?.length
        ? `The target's ${brief.requiredComponents.map((c) => c.name).join(", ")} need consistent corner treatment.`
        : null,
      instruction: `Preserve ${labelled(claim)} for equivalent surface sizes in the target.`
    }));
  }

  if (t.motion.base && isUsable(t.motion.base.duration)) {
    push(triad({
      evidence: `Interaction transitions run ${labelled(t.motion.base.duration)} on ${labelled(t.motion.base.easing)}.`,
      requirement: brief ? `${brief.product}'s interactive elements need feedback consistent with this language.` : null,
      instruction: "Preserve the duration and easing. Apply to colour, background, border and transform changes; never transition `all`. Neutralise under `prefers-reduced-motion`."
    }));
  }
  push(close);
  push();

  /* ------------------------------- 7. deliberately changed rules (triads) */

  push(open(SECTION.DERIVED, "changed-rules"));
  push("## 7. Changed content anatomy");
  push();
  push("Where the target's needs override the reference's treatment. These are changes, not omissions.");
  push();

  const referenceComponents = ir.components ?? [];
  const targetComponents = brief?.requiredComponents ?? [];

  if (targetComponents.length) {
    for (const target of targetComponents) {
      const mapped = referenceComponents.find((c) => c.id === target.mapsToReference);
      const anatomy = mapped
        ? mapped.anatomy.map((a) => `${a.property} ${labelled(a.claim)}`).join(", ")
        : null;

      /* An unpainted reference component must not be adapted by quietly giving
       * the target a surface. The brief may well want one — that is a target
       * decision and is labelled as such, so a reader can never mistake it for
       * something the reference did. */
      const referenceUnpainted = mapped && mapped.surfaceObserved === true && mapped.surface == null;
      const briefWantsSurface = /card|panel|tile|surface|elevated|raised/i.test(
        `${target.name ?? ""} ${target.purpose ?? ""}`
      );

      push(triad({
        evidence: !mapped
          ? "No reference component was mapped to this target component."
          : referenceUnpainted
            ? `Reference component \`${mapped.id}\` (${mapped.selectors[0]}) has **no painted surface** — ` +
              `\`surface: null\`, classified \`${mapped.surfaceClassification}\`. It is separated from its ` +
              "siblings by spacing and typography alone."
            : mapped.paintedDescendant?.value
              ? `Reference component \`${mapped.id}\` (${mapped.selectors[0]}) paints nothing itself; ` +
                `\`${mapped.paintedDescendant.value}\` inside it carries ${anatomy || "the surface"}.`
              : `Reference component \`${mapped.id}\` (${mapped.selectors[0]}) carries ${anatomy || "no resolved surface properties"}.`,
        requirement: `${target.name}${target.purpose ? ` — ${target.purpose}` : ""}.`,
        instruction: !mapped
          ? `Build ${target.name} using the preserved tokens and spacing rhythm above. No reference component maps to it, so its internal structure is the target's to define.`
          : referenceUnpainted
            ? (briefWantsSurface
                ? `Preserve the reference's spacing rhythm and content hierarchy. **Target decision, not reference evidence:** ` +
                  `the brief describes ${target.name} as a surface-bearing component, so introducing a background, border or ` +
                  "elevation is a deliberate departure from the reference. Take those values from the target's own token set " +
                  "and record the departure — the reference cannot supply them, because it has none."
                : `Preserve the absence of a surface: build ${target.name} with no background, border, radius or shadow, ` +
                  "separating instances by spacing and typography as the reference does. Redesign the content anatomy for " +
                  "the target. Do not add a surface unless the brief asks for one.")
            : `Preserve the measured surface treatment — ${anatomy || "as far as it resolved"} — and redesign the content anatomy entirely for ${target.name}. The reference's internal structure does not apply.`
      }));
    }
  } else {
    push(triad({
      evidence: referenceComponents.length
        ? `The reference models ${referenceComponents.map((c) => `\`${c.id}\``).join(", ")}.`
        : "No reference component resolved.",
      requirement: null,
      instruction: "The brief lists no target components, so no component mapping is asserted. Build what the target IA requires using the preserved rules."
    }));
  }

  push(triad({
    evidence: "The reference's page structure, section order and content hierarchy were measured.",
    requirement: brief?.targetPage?.name ? `${brief.targetPage.name} has its own purpose and information architecture.` : null,
    instruction: "Discard the reference's page structure. Section 4 defines what to build."
  }));
  push(close);
  push();

  /* -------------------------------------------- 8. brand and assets */

  push(open(SECTION.FIXED, "brand-replacement"));
  push("## 8. Brand and asset replacement rules");
  push();
  push("These apply regardless of what either source says.");
  push();
  push("Never carried over from the reference:");
  push();
  push("- Logos, wordmarks, and brand names");
  push("- Marketing copy and any product-specific wording");
  push("- Photography, illustration, and icon sets");
  push("- Licensed fonts the target has no rights to");
  push();
  if (brief) {
    push("Target replacements:");
    push();
    push(`- **Logo:** ${brief.assets?.logo ?? "not supplied — use a neutral placeholder mark"}`);
    push(`- **Imagery:** ${brief.assets?.imagery ?? "not supplied — use neutral placeholder blocks at the measured aspect ratios"}`);
    push(`- **Icons:** ${brief.assets?.icons ?? "not supplied — use a neutral open-licence set"}`);
    push(`- **Copy:** write for ${brief.product}. ${brief.brandConstraints?.voice ? `Voice: ${brief.brandConstraints.voice}.` : "No voice stated; keep copy plain."}`);
    if (brief.assets?.placeholderPolicy) push(`- **Placeholder policy:** ${brief.assets.placeholderPolicy}`);
    if (brief.explicitExclusions?.length) {
      push();
      push("Explicitly excluded by the brief:");
      push();
      for (const exclusion of brief.explicitExclusions) push(`- ${exclusion}`);
    }
  }
  push();
  push(close);
  push();

  /* ------------------------------------- 9. implementation requirements */

  push(open(SECTION.DERIVED, "implementation"));
  push("## 9. Implementation requirements");
  push();
  push(`**Stack:** ${brief ? `${brief.framework.name}${brief.framework.styling ? ` + ${brief.framework.styling}` : ""}` : "not stated in the brief"}`);
  push();
  push("Declare the preserved measurements as tokens:");
  push();
  push("```css");
  push(":root {");
  for (const [name, claim] of Object.entries(t.color)) {
    if (isSettled(claim)) push(`  --color-${name.replace(/\./g, "-")}: ${literal(claim)}; /* role preserved; substitute target hue */`);
  }
  for (const [step] of Object.entries(t.spacing)) push(`  --space-${step}: ${step}px;`);
  for (const [name, claim] of Object.entries(t.radius)) {
    if (isSettled(claim)) push(`  --radius-${name}: ${literal(claim)};`);
  }
  for (const [name, claim] of Object.entries(t.elevation)) {
    if (isSettled(claim)) push(`  --shadow-${name}: ${literal(claim)};`);
  }
  if (t.motion.base && isSettled(t.motion.base.duration)) push(`  --duration-base: ${literal(t.motion.base.duration)};`);
  if (t.motion.base && isSettled(t.motion.base.easing)) push(`  --easing-standard: ${literal(t.motion.base.easing)};`);
  if (isSettled(container?.maxWidth)) push(`  --container-max: ${literal(container.maxWidth)};`);
  push("}");
  push("```");
  push();
  push(close);
  push();

  /* ----------------------------------------------- 10. responsive */

  push(open(SECTION.DERIVED, "responsive"));
  push("## 10. Responsive behavior");
  push();
  if (isUsable(ir.layout.breakpoints)) {
    push(`Reference breakpoints: ${labelled(ir.layout.breakpoints)}.`);
  } else {
    push("The reference's breakpoints were not determined.");
  }
  if (brief?.viewportRequirements?.length) {
    push();
    push(`The target must support ${brief.viewportRequirements.join(", ")}px. Where these differ from the reference's, the target's requirement wins.`);
  }
  push();
  push(`Captured viewports: ${ir.meta.viewports.join(", ") || "unknown"}px. Behaviour at any other width was not observed and must be decided deliberately.`);
  push();
  push(close);
  push();

  /* --------------------------------------------- 11. accessibility */

  push(open(SECTION.DERIVED, "accessibility"));
  push("## 11. Accessibility requirements");
  push();
  if (brief?.accessibilityRequirements?.conformance) {
    push(`**Conformance target:** ${brief.accessibilityRequirements.conformance}`);
    for (const extra of brief.accessibilityRequirements.additional ?? []) push(`- ${extra}`);
    push();
  }
  push("- Body text must clear 4.5:1 against its background; large text 3:1.");
  push("- Every interactive control needs a visible `:focus-visible` style.");
  push("- Minimum interactive target 44×44px.");
  push("- Semantic landmarks and a single `h1`.");
  push("- Honour `prefers-reduced-motion`.");
  const contrast = ir.a11y?.contrastFindings ?? [];
  if (contrast.length) {
    push();
    push(`The reference's measured contrast was checked on ${contrast.length} pair(s). Preserving role structure preserves those ratios only if the target's palette has comparable luminance relationships — verify rather than assume.`);
  }
  push();
  push(close);
  push();

  /* ------------------------------------------- 12. acceptance criteria */

  push(open(SECTION.DERIVED, "acceptance"));
  push("## 12. Acceptance criteria");
  push();
  push("### Reference-derived — verified by measuring the build");
  push();
  let n = 0;
  const criterion = (text) => push(`${++n}. ${text}`);
  if (isSettled(container?.maxWidth)) criterion(`Container computes to \`max-width: ${literal(container.maxWidth)}\`.`);
  if (isSettled(container?.paddingX)) criterion(`Container horizontal padding computes to \`${literal(container.paddingX)}\`.`);
  if (isSettled(ir.scales.spacingBaseUnit)) criterion(`Every padding, margin and gap is a multiple of \`${literal(ir.scales.spacingBaseUnit)}\`.`);
  if (isSettled(bodyType?.fontSize)) criterion(`Body font-size computes to \`${literal(bodyType.fontSize)}\`.`);
  for (const [name, claim] of Object.entries(t.radius)) {
    if (isSettled(claim)) criterion(`\`radius.${name}\` surfaces compute to \`${literal(claim)}\`.`);
  }
  if (t.motion.base && isSettled(t.motion.base.duration)) criterion(`Interactive transitions run \`${literal(t.motion.base.duration)}\`.`);
  criterion("No reference brand asset, logo, wordmark or copy appears anywhere in the build.");
  push();

  push("### Target-derived — verified against the brief");
  push();
  n = 0;
  if (!brief) {
    push("*No brief supplied, so no target-side criteria can be stated.*");
  } else {
    criterion(`The page implements ${brief.targetPage.name}${brief.targetPage.route ? ` at \`${brief.targetPage.route}\`` : ""}.`);
    for (const f of brief.requiredFunctionality ?? []) criterion(`${f.description} (${f.priority ?? "must"}).`);
    for (const c of brief.requiredComponents ?? []) criterion(`\`${c.name}\` exists and serves ${c.purpose ?? "its stated purpose"}.`);
    for (const s of brief.successCriteria ?? []) criterion(s);
    if (brief.viewportRequirements?.length) criterion(`Renders correctly at ${brief.viewportRequirements.join(", ")}px.`);
  }
  push();
  push(close);
  push();

  /* -------------------------------------------- 13. evidence limits */

  push(open(SECTION.REFERENCE, "evidence-limitations"));
  push("## 13. Limitations");
  push();
  push("What the analysis could not establish. Each is a decision to make deliberately, not a fact about the reference.");
  push();
  for (const unknown of ir.unknowns ?? []) push(`- \`${unknown.claim}\` — ${unknown.reason}`);
  const contested = ir.contestedClaims ?? [];
  if (contested.length) {
    push();
    push("Contested between evidence sources:");
    push();
    for (const c of contested) {
      push(`- \`${c.claim}\` — ${c.candidates.map((x) => `${x.source} says ${JSON.stringify(x.value)}`).join(" vs ")}`);
    }
  }
  push();
  push(`Overall confidence ${confidenceText(ir.confidence.overall)} (provenance ${confidenceText(ir.confidence.provenance)} × coverage ${(ir.confidence.coverageFactor ?? 1).toFixed(2)}).`);
  push();
  push(close);
  push();

  push("---");
  push();
  push("*Generated from `analysis/ir.json` and the supplied target brief. Do not edit — correct the evidence or the brief and regenerate.*");

  return out.join("\n");
}

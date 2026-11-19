import { literal, isUsable, coveragePercent, provenanceSuffix } from "./fmt.mjs";
/* The contract renderer, not the spec one: it attaches the evidence ids, the
 * source kinds and the confidence that a prompt claim is required to carry, and
 * it refuses to backtick anything the evidence cannot support being copied. */
import { renderClaim, evidenceRefs } from "../prompts/render.mjs";

/** ` [ev_0001]` or nothing. A claim stating a value must be traceable to one. */
const refs = (claim) => { const r = evidenceRefs(claim); return r ? ` ${r}` : ""; };
import { stampComment } from "../ir/hash.mjs";
import { standardHeader } from "./header.mjs";

/**
 * IR -> rebuild-prompt.md, targeting Claude Code with Next.js + TypeScript +
 * Tailwind.
 *
 * The prompt carries literal values only. A builder reading it must never need
 * to see the reference: if a value is unknown it says so and instructs a
 * decision, rather than leaving an adjective for the model to interpret.
 */
export function projectRebuildPrompt(ir, hash, options = {}) {
  const stack = options.stack ?? "next-tailwind";
  const t = ir.tokens;
  const container = ir.layout.containers[0];
  const grid = ir.layout.grids[0];
  const card = ir.components.find((c) => c.id === "card.primary");
  const button = ir.components.find((c) => c.id === "button.primary");

  const out = [];
  const push = (line = "") => out.push(line);

  push(stampComment(hash));
  push(standardHeader(ir, { title: `Rebuild prompt — ${ir.meta.slug}`, nextAction: "build to the literal values below. Where a value says unknown, ask rather than choosing one." }));
  push();
  push(`**Target stack:** Next.js (App Router) · TypeScript · Tailwind CSS · CSS custom properties for tokens`);
  push(`**Mode:** recreate — reproduce the structural and visual system as measured.`);
  push(`**Derived from:** \`analysis/ir.json\` (${ir.meta.source.value}, viewport ${ir.meta.viewports.join("/")}px)`);
  push();
  push("---");
  push();

  /* ------------------------------------------------------------ the brief */

  push("## 1. Objective");
  push();
  push(
    "Build a page that reproduces the design system measured below. Work from the literal " +
      "values in this document — they are measurements from a real interface, not suggestions. " +
      "Where a value is marked `NOT DETERMINED`, make a deliberate choice and record it in a " +
      "`DECISIONS.md`; do not silently invent one and do not treat it as measured."
  );
  push();

  /* ------------------------------------------------- reference evidence */

  push("## 2. Reference evidence");
  push();
  push("Everything in sections 4 through 10 was read off a real page. What that means for");
  push("each value depends on how it was read, and every claim below states which:");
  push();
  push("| Status | What it means for you |");
  push("| --- | --- |");
  push("| `measured` | Read off rendered geometry. Build to it exactly. |");
  push("| `observed` | Read from a declared style. Build to it exactly. |");
  push("| *(inferred)* | Derived from other evidence. The derivation is sound; the value is a step removed from a measurement. |");
  push("| *(estimated)* | Reconstructed from a screenshot. Approximate — do not build to the digit. |");
  push("| **contested** | Two sources disagreed. Resolve it before building; do not pick one. |");
  push("| **not determined** | Looked for and not established. Decide it yourself and write the decision down. |");
  push();
  push(`Coverage for this capture was ${ir.coverage?.coverageFactor != null ? ir.coverage.coverageFactor.toFixed(2) : "not measured"}, `);
  push("meaning claims about anything the capture did not reach are absent rather than negative.");
  push("Bracketed `[ev_*]` ids resolve to `analysis/evidence-map.json`.");
  push();

  /* Observability, stated immediately after the coverage figure and never
   * folded into it.
   *
   * Coverage measures whether the visible set was sampled well. It read 1.00 on
   * a page where three of 1205 nodes were visible, because 3/3 is 1.00 — true of
   * the visible set, and read by anyone as a statement about the page
   * (def_0050). The number stays; what follows it is the scope it applies to. */
  const obs = ir.coverage?.observability ?? null;
  if (obs && obs.status !== "full") {
    const headline = obs.status === "low"
      ? "**This page was largely not observable.**"
      : obs.status === "partial"
        ? "**This page was only partly observable.**"
        : "**How much of this page was observable could not be measured.**";
    push(`${headline} ${obs.reason}`);
    push();
    push(
      "That figure above describes how thoroughly the **visible** nodes were sampled. It is not " +
        "a statement about the page. Treat every absence in this document as unknown rather than " +
        "as established, and do not read a short list as a complete one."
    );
    push();
  }

  /* ------------------------------------------------- what the walk reached
   *
   * One aggregate coverage number cannot tell you WHERE the evidence came
   * from, and a single figure hid the fact that a truncated walk was producing
   * page-wide counts. Regions and the budget are stated so a reader can see the
   * scope of every claim below rather than infer it. */
  const cov = ir.coverage ?? {};
  push("**What the walk reached.** Every claim below is scoped by this:");
  push();
  push("| Region | Sampled | Coverage |");
  push("| --- | --- | --- |");
  push(`| Content (main) | ${cov.regionSampled?.main ?? "—"} | ${coveragePercent(cov.mainCoverage, cov.regionSampled?.main)} |`);
  push(`| Header / nav | ${cov.regionSampled?.header ?? "—"} | ${coveragePercent(cov.headerCoverage, cov.regionSampled?.header)} |`);
  push(`| Footer | ${cov.regionSampled?.footer ?? "—"} | ${coveragePercent(cov.footerCoverage, cov.regionSampled?.footer)} |`);
  push();
  push(
    "A region marked *not measurable* was visited; what is missing is the total it " +
      "would be measured against. That is not the same as a region that is empty, and " +
      "neither is evidence that the region does not exist."
  );
  push();

  if (cov.truncated) {
    push(
      `**The node walk was truncated.** ${cov.nodesSampled ?? "?"} of ${cov.nodesVisible ?? "?"} visible ` +
        `nodes were sampled against a ${cov.nodeCap ?? "configured"}-node budget. **No count in this ` +
        "document is a page-wide census.** Anything not listed may exist in the part of the page the " +
        "walk never reached — treat every absence below as unknown rather than as none."
    );
  } else {
    push(
      `The node walk completed: ${cov.nodesSampled ?? "?"} of ${cov.nodesVisible ?? "?"} visible nodes ` +
        "were sampled with no budget truncation, so counts below cover everything visible at this viewport."
    );
  }
  push();

  /* --------------------------------------------------------- page structure */

  push("## 3. Page structure");
  push();
  const structure = ir.structure ?? null;

  if (!structure) {
    push("**No page structure was captured.** This capture has no DOM to read landmarks or");
    push("section order from. Build a conventional document outline — `header` / `nav` /");
    push("`main` / `footer` with a single `h1` — and record it as your decision rather than");
    push("as something measured.");
    push();
  } else {
    /* Landmark PRESENCE, one row per region, each carrying what licenses it.
     * Order between these rows is the order they are listed in, which is not
     * the order they appear on the page — a DOM path does not record sibling
     * order across different tag names, and nothing else measured it. The note
     * below says so, because a table reads as a sequence unless it denies it. */
    push("Read from the ancestry of sampled nodes. Each row says what licenses it:");
    push();
    push("| Landmark | State | Basis |");
    push("| --- | --- | --- |");
    for (const l of structure.landmarks ?? []) {
      const label = l.region === "main" ? "`<main>` / `role=main`" : `\`<${l.region}>\``;
      push(`| ${label} | ${l.state === "observed" ? "**observed**" : l.state} | ${l.basis} |`);
    }
    push();
    push(
      "**This list is not a page order.** Which landmark comes first was not measured — a " +
        "DOM path records nesting, not the order of siblings with different tag names. Lay " +
        "them out conventionally and record that as your decision."
    );
    push();

    if (structure.limits?.headerRoleAmbiguous &&
        (structure.landmarks ?? []).some((l) => l.region === "header" && l.state === "observed")) {
      push(
        "**`<header>` elements were observed. This capture does not establish that they form " +
          "a site-wide header.** HTML uses `<header>` for section headers as well as for a " +
          "page banner, and the capture records both the same way."
      );
      push();
    }

    /* Where the content lives, and whether the page said so or we worked it out. */
    const cr = structure.contentRegion ?? {};
    /* The basis strings are written lowercase so they can be embedded mid-
     * sentence in a table cell; starting a sentence with one needs the capital. */
    const sentence = (s) => (s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}` : "");
    const held = cr.visibleDescendants != null ? `, holding ${cr.visibleDescendants} visible descendants` : "";
    if (cr.state === "observed") {
      push(`The content region is **declared** by the page: \`${cr.selector}\`${held}. ${sentence(cr.basis)}.`);
    } else if (cr.state === "inferred") {
      push(`The content region is **inferred**, not declared: \`${cr.selector}\`${held}. ${sentence(cr.basis)}. Treat its bounds as a derivation rather than a measurement.`);
    } else {
      push("The content region could not be resolved for this capture.");
    }
    push();

    /* Section order, or the reason there is none. */
    const outline = structure.outline ?? {};
    if (outline.state === "observed" && (outline.sections ?? []).length) {
      push(`**Sections inside \`<${outline.rootTag}>\`, in document order** — ${outline.sections.length} found:`);
      push();
      for (const s of outline.sections) {
        const inside = (s.contains ?? []).map((c) => `\`${c}\``).join(", ");
        push(`${s.order}. \`<${s.tag}>\`${inside ? ` — contains ${inside}` : ""}`);
      }
      push();
      if (outline.partial) {
        push(
          "**The walk was truncated, so this is a sample of the sections, not all of them.** " +
            "The order shown is the order they appear in; sections past the budget are not listed."
        );
      } else {
        push(
          "The walk completed, so these are the container-bearing sections inside that element. " +
            "Element and selector names are the reference's own — **no purpose is claimed for any " +
            "section**, and you should not infer one from a name."
        );
      }
    } else {
      push("**No section order was established.**");
      if (outline.reason) push(`${outline.reason.charAt(0).toUpperCase()}${outline.reason.slice(1)}.`);
      push("Decide the section sequence yourself and record it as your decision.");
    }
    push();
  }
  push(`The reference reported ${(ir.components ?? []).length} component(s) and ${(ir.componentCandidates ?? []).length} candidate(s); section 7 lists them.`);
  push();

  /* --------------------------------------------------------------- tokens */

  push("## 4. Design tokens");
  push();
  push("Declare these as CSS custom properties on `:root` and expose them through the Tailwind theme.");
  push();
  push("```css");
  push(":root {");

  const colorEntries = Object.entries(t.color).filter(([, c]) => isUsable(c));
  if (colorEntries.length) {
    push("  /* colour */");
    for (const [name, claim] of colorEntries) {
      push(`  --color-${name.replace(/\./g, "-")}: ${literal(claim)};`);
    }
  }

  const spacingEntries = Object.entries(t.spacing)
    .filter(([, c]) => isUsable(c))
    .sort(([a], [b]) => Number(a) - Number(b));
  if (spacingEntries.length) {
    push("");
    push("  /* spacing */");
    for (const [step] of spacingEntries) {
      push(`  --space-${step}: ${step}px;`);
    }
  }

  const radiusEntries = Object.entries(t.radius).filter(([, c]) => isUsable(c));
  if (radiusEntries.length) {
    push("");
    push("  /* radius */");
    for (const [name, claim] of radiusEntries) {
      push(`  --radius-${name}: ${literal(claim)};`);
    }
  }

  const elevationEntries = Object.entries(t.elevation).filter(([, c]) => isUsable(c));
  if (elevationEntries.length) {
    push("");
    push("  /* elevation */");
    for (const [name, claim] of elevationEntries) {
      push(`  --shadow-${name}: ${literal(claim)};`);
    }
  }

  const borderEntries = Object.entries(t.border).filter(([, c]) => isUsable(c));
  if (borderEntries.length) {
    push("");
    push("  /* border */");
    for (const [name, claim] of borderEntries) {
      push(`  --border-${name}: ${literal(claim)};`);
    }
  }

  const base = t.motion.base;
  if (base) {
    push("");
    push("  /* motion */");
    if (isUsable(base.duration)) push(`  --duration-base: ${literal(base.duration)};`);
    if (isUsable(base.easing)) push(`  --easing-standard: ${literal(base.easing)};`);
  }

  if (isUsable(container?.maxWidth)) {
    push("");
    push("  /* layout */");
    push(`  --container-max: ${literal(container.maxWidth)};`);
    if (isUsable(container.paddingX)) push(`  --container-pad: ${literal(container.paddingX)};`);
  }

  push("}");
  push("```");
  push();

  /* ----------------------------------------------------------- typography */

  push("## 5. Typography");
  push();
  const body = t.typography.body;
  if (body?.fontFamily && isUsable(body.fontFamily)) {
    push(`- Font stack: \`${literal(body.fontFamily)}\`${refs(body.fontFamily)}`);
    push("  - Load only fonts you are licensed to use. If the reference stack includes a licensed family you do not have, substitute a metric-compatible fallback and record the substitution.");
  }
  push();
  push("| Role | Font size | Line height | Weight | Letter spacing |");
  push("| --- | --- | --- | --- | --- |");
  for (const role of ["body", "h1", "h2", "h3"]) {
    const group = t.typography[role];
    if (!group) continue;
    const lh = group.lineHeightRatio ?? group.lineHeight;
    push(
      `| \`${role}\` | ${literal(group.fontSize, "—")} | ${literal(lh, "—")} | ` +
        `${literal(group.fontWeight, "—")} | ${literal(group.letterSpacing, "0")} |`
    );
  }
  push();
  if (isUsable(ir.scales.typeRamp)) {
    push(
      `- Full set of rendered sizes: ${ir.scales.typeRamp.value.map((s) => `\`${s}px\``).join(", ")}. ` +
        `Sizes not named in the table above include user-agent defaults; do not turn every one of them into a named token.${provenanceSuffix(ir.scales.typeRamp)}${refs(ir.scales.typeRamp)}`
    );
  }
  push();

  /* --------------------------------------------------------------- layout */

  push("## 6. Layout and grid");
  push();
  if (isUsable(container?.maxWidth)) {
    push(`- Page container: \`max-width: ${literal(container.maxWidth)}\`, centred with \`margin-inline: auto\`.${refs(container.maxWidth)}`);
  } else {
    push("- Page container max-width: `NOT DETERMINED` — choose one and record it.");
  }
  if (isUsable(container?.paddingX)) {
    push(`- Container horizontal padding: \`${literal(container.paddingX)}\` on both sides.${refs(container.paddingX)}`);
  }
  if (isUsable(ir.layout.breakpoints)) {
    const bps = ir.layout.breakpoints.value;
    push(`- Breakpoints: ${bps.map((b) => `\`${b}px\``).join(", ")}. Configure Tailwind's screens to match exactly.${refs(ir.layout.breakpoints)}`);
  }
  if (grid && isUsable(grid.columns)) {
    push(
      `- Primary card grid: \`display: grid\` with ${literal(grid.columns)} columns` +
        (isUsable(grid.gap) ? ` and a \`${literal(grid.gap)}\` gap` : "") +
        ` at the ${ir.meta.viewports[0]}px capture width.${refs(grid.columns)}`
    );
    push(
      "  - Column counts at other breakpoints were not measured in this capture. " +
        "Collapse to a sensible single column on the smallest breakpoint and record the choice."
    );
  }
  if (isUsable(ir.layout.zLayers)) {
    push(`- Explicit z-index layers in use: ${ir.layout.zLayers.value.map((z) => `\`${z}\``).join(", ")}.${refs(ir.layout.zLayers)}`);
  }
  push();

  /* -------------------------------------------------------------- spacing */

  push("## 6b. Spacing");
  push();
  if (isUsable(ir.scales.spacingBaseUnit)) {
    push(`- Base unit: \`${literal(ir.scales.spacingBaseUnit)}\`.`);
  }
  if (isUsable(ir.scales.spacingRamp)) {
    /* The members are formatted individually, so `literal` never sees the claim
     * and cannot mark it. A derived ramp must still say it is derived. */
    push(`- Ramp: ${ir.scales.spacingRamp.value.map((s) => `\`${s}px\``).join(", ")}.${provenanceSuffix(ir.scales.spacingRamp)}`);
    push("- Use only ramp values for padding, margin and gap. Any value off the ramp needs a reason.");
  }
  push();

  /* ----------------------------------------------------------- components */

  push("## 7. Components");
  push();

  if (card) {
    const selectorForCard = card.stableSelector ?? card.selectors.join(", ");
    push(`### Card — \`${selectorForCard}\``);
    push();
    push(`Observed ${card.instanceCount?.value ?? "multiple"} instances in a grid.`);
    push();

    /* An unpainted component is the case this section used to get wrong: it
     * would print nothing and then instruct the reader to take the surface
     * treatment from the tokens, which for a component with no surface means
     * inventing one. The absence is now stated first, and what may not be
     * invented is named. */
    const paints = card.surfaceObserved === true && card.surface != null;
    const absenceKnown = card.surfaceObserved === true && card.surface == null;

    if (absenceKnown) {
      push(`**No painted surface was observed on this component** (\`surface: null\`, classified \`${card.surfaceClassification}\`).`);
      push();
      push("This is a measured finding, not a gap in the capture. The component is identified structurally and semantically, from the evidence below.");
      push();
    } else if (card.paintedDescendant?.value) {
      push(`**This component paints nothing itself.** \`${card.paintedDescendant.value}\` inside it carries the surface.`);
      push();
      push(`Put the background, border, radius and shadow on \`${card.paintedDescendant.value}\`, not on \`${selectorForCard}\`. ` +
        "The outer element is the component; the inner one is how it is painted.");
      push();
    } else if (!paints) {
      push("**Whether this component paints a surface could not be determined** (`surface: unknown`).");
      push();
      push("Do not assume either way. If a surface matters for your use, recapture with probe data before deciding.");
      push();
    }

    const surfaceParts = card.anatomy.filter((p) => p.part === "surface" || p.part === "painted-descendant");
    const structureParts = card.anatomy.filter((p) => p.part === "structure");

    if (surfaceParts.length) {
      push(card.paintedDescendant?.value ? `Surface, on \`${card.paintedDescendant.value}\`:` : "Surface:");
      push();
      for (const part of surfaceParts) push(`- ${part.property}: \`${literal(part.claim)}\``);
      push();
    }

    if (structureParts.length) {
      push("Evidenced without reference to any painted surface:");
      push();
      for (const part of structureParts) push(`- ${part.property}: ${part.claim.value}`);
      push();
    }

    if (absenceKnown) {
      push("**Do not invent** a background, border, border-radius, box-shadow or elevation for this component. " +
        "None was observed, and adding one would be your design decision presented as the reference's.");
      push();
      push("Unknown for this component: hover and focus treatment, and whether any surface appears in states that were not induced.");
      push();
      push("Acceptance criteria — the rebuilt component:");
      push();
      push("- renders with no background, border, radius or shadow of its own;");
      push(`- keeps the ${structureParts.length} structural propert${structureParts.length === 1 ? "y" : "ies"} listed above;`);
      push("- remains visually separable from its siblings by spacing and typography alone.");
      push();
    } else {
      push("Build it as a reusable component. Its surface treatment (background, radius, border, shadow) must come from the tokens above, not from inline values.");
      push();
    }
  }

  if (button) {
    push("### Button");
    push();
    for (const part of button.anatomy) {
      push(`- ${part.property}: \`${literal(part.claim)}\``);
    }
    push("- Provide `primary` and `secondary` variants. The reference distinguishes them by background and border; exact secondary treatment was not measured in this capture — choose and record.");
    push();
  }

  /* ------------------------------------------- other repeated structures
   *
   * Groups the repeat detector found and the component model never reported,
   * because it models one card and one button. Useful structural facts — how
   * often something repeats, how big it is, where it sits — and emphatically
   * not components: no surface was resolved for any of them, and none of them
   * was put anywhere the component gate can read. Omitted entirely when the
   * list is empty rather than rendered as an empty heading. */
  const repeated = ir.repeatedStructures ?? null;
  if (repeated && repeated.items?.length) {
    push("### Other repeated structures");
    push();
    push(
      "Repeated element groups with geometry but **no measured surface**. These are not " +
        "components and do not satisfy the component requirements — nothing here establishes " +
        "a background, border, radius or shadow for any of them."
    );
    push();
    push("| Selector | Instances | Region | Sample box |");
    push("| --- | --- | --- | --- |");
    for (const item of repeated.items) {
      const box = item.sample?.width != null && item.sample?.height != null
        ? `${item.sample.width}×${item.sample.height}`
        : "not measured";
      push(`| \`${item.signature}\` | ${item.instances ?? "—"} | ${item.region ?? "—"} | ${box} |`);
    }
    push();

    /* Scope. The two counts measure different sets, so they are stated as
     * separate facts and never divided into one another. */
    const s = repeated.scope ?? {};

    /* Two different kinds of note, and conflating them overstates the caveat.
     * Incompleteness is what licenses "this is a sample"; the set difference
     * below is a scope clarification that holds even on a complete walk, where
     * it exists only to stop someone dividing one count by the other. */
    const incomplete = [];
    if (s.capped) incomplete.push(`the capture records at most ${s.cap} repeat groups and hit that limit`);
    if (s.walkTruncated) incomplete.push("the node walk was truncated before it finished");

    push(
      incomplete.length
        ? `**${s.listed} listed**, drawn from ${s.serialised} recorded group(s) — ${incomplete.join(", and ")}.`
        : `**${s.listed} listed**, from ${s.serialised} repeat group(s) recorded on a completed, uncapped walk.`
    );
    push();

    if (typeof s.inPrimaryRegion === "number") {
      push(
        `For scope: the content region holds ${s.inPrimaryRegion} repeat group(s), which is a ` +
          `different set from the ${s.serialised} recorded here — a group can be recorded without ` +
          "sitting in the content region, and the reverse. **Do not read one as a fraction of the other.**"
      );
      push();
    }

    if (incomplete.length) {
      push(
        "**This is a sample, not a component inventory.** Structures absent from it may exist " +
          "in the part of the page that was never recorded."
      );
      push();
    }
    push(
      "Selector names are the reference's own and no purpose is claimed for any of them. " +
        (repeated.items.every((i) => i.selectorStability === "not-measured")
          ? "Whether these names are stable across builds was not measured — treat them as descriptions of what repeats, not as identifiers to code against."
          : "Check the stability note on each before coding against it.")
    );
    push();
  }

  /* --------------------------------------------------------------- motion */

  push("## 8. Component states");
  push();
  const stateful = (ir.components ?? []).filter((c) => (c.states ?? []).length);
  if (stateful.length) {
    for (const component of stateful) {
      push(`**\`${component.id}\`**`);
      push();
      for (const state of component.states ?? []) {
        push(renderClaim(state.name ?? "state", state.claim ?? state, { indent: "- " }));
      }
      push();
    }
  } else {
    push("**No interaction state was induced on this capture.** Hover, focus and active");
    push("treatments were not measured, so nothing here specifies them.");
    push();
    push("Implement `:hover`, `:focus-visible` and `:disabled` for every interactive control as");
    push("your own decision, and record it. Do not infer them from the default state — an");
    push("unmeasured state is a gap, and a plausible guess in its place is indistinguishable");
    push("from a measurement once it is in the code.");
  }
  push();

  /* ------------------------------------------------------------ responsive */

  push("## 9. Responsive behavior");
  push();
  const breakpoints = ir.layout?.breakpoints;
  if (isUsable(breakpoints)) {
    push(renderClaim("Breakpoints", breakpoints));
    push();
    push("Configure these as the project's breakpoints. Do not map them onto the framework's");
    push("defaults — the defaults are unlikely to match, and a near-miss reflows at a width");
    push("nobody measured.");
  } else {
    push("**No breakpoints were established.** This capture covers");
    push(`${ir.meta.viewports.join(", ")}px only.`);
    push();
    push("Anything about behaviour at other widths would be a guess. Choose breakpoints");
    push("deliberately and record them; do not derive them from this document.");
  }
  push();
  const perViewport = ir.responsive?.viewports ?? [];
  if (perViewport.length > 1) {
    push(`Measured at ${perViewport.length} viewports; differences between them are recorded in \`analysis/ir.json\` under \`responsive\`.`);
    push();
  }

  /* --------------------------------------------------------------- motion */

  push("## 10. Motion");
  push();
  if (base && isUsable(base.duration) && isUsable(base.easing)) {
    push(`- Base transition: \`${literal(base.duration)}\` with \`${literal(base.easing)}\`.${refs(base.duration)}`);
    push("- Apply it to colour, background, border-colour, box-shadow and transform changes. Do not transition `all`.");
  } else {
    push("- Transition timing: `NOT DETERMINED`.");
  }
  push("- Wrap every non-trivial animation in `@media (prefers-reduced-motion: reduce)` and neutralise it there.");
  push();

  /* ---- declared motion, per element.
   *
   * Everything below is what the stylesheets DECLARE. The heading says so, and
   * the closing note says what that excludes, because the gap between "this
   * element declares a 400ms fade" and "this element fades in when it scrolls
   * into view" is exactly where a builder would otherwise supply a mechanism
   * nobody measured. */
  const declaredMotion = ir.motion?.declared ?? [];
  const keyframeBodies = ir.motion?.keyframeDetail ?? [];

  const motionCell = (claim) => {
    if (!isUsable(claim)) return "—";
    const value = String(claim.value);
    if (claim.status === "measured" || claim.status === "observed") return `\`${value}\``;
    if (claim.status === "estimated") return `~${value} *(estimated)*`;
    return `${value} *(${claim.status})*`;
  };

  if (declaredMotion.length) {
    push("### Declared motion, by element");
    push();
    push("Read from computed style. **A declaration is not a behaviour** — see the note closing this section.");
    push();

    const animated = declaredMotion.filter((d) => isUsable(d.animationName));
    if (animated.length) {
      push("**Animations**");
      push();
      push("| # | Region | animation-name | duration | delay | easing | iterations | fill | direction |");
      push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
      for (const d of animated) {
        push(`| ${d.index + 1} | ${motionCell(d.region)} | ${motionCell(d.animationName)} | ${motionCell(d.animationDuration)} | ${motionCell(d.animationDelay)} | ${motionCell(d.animationTimingFunction)} | ${motionCell(d.animationIterationCount)} | ${motionCell(d.animationFillMode)} | ${motionCell(d.animationDirection)} |`);
      }
      push();
    }

    const transitioned = declaredMotion.filter((d) => isUsable(d.transitionDuration));
    if (transitioned.length) {
      push("**Transitions**");
      push();
      push("| # | Region | properties | duration | delay | easing |");
      push("| --- | --- | --- | --- | --- | --- |");
      for (const d of transitioned) {
        push(`| ${d.index + 1} | ${motionCell(d.region)} | ${motionCell(d.transitionProperty)} | ${motionCell(d.transitionDuration)} | ${motionCell(d.transitionDelay)} | ${motionCell(d.transitionTimingFunction)} |`);
      }
      push();
    }

    /* Compositing and glass. `backdrop-filter` in particular is the effect a
     * rebuild most often misses entirely. */
    const composited = declaredMotion.filter((d) =>
      isUsable(d.transform) || isUsable(d.willChange) || isUsable(d.filter) || isUsable(d.backdropFilter));
    if (composited.length) {
      push("**Transform, filter and glass**");
      push();
      push("| # | Region | transform | will-change | filter | backdrop-filter |");
      push("| --- | --- | --- | --- | --- | --- |");
      for (const d of composited) {
        push(`| ${d.index + 1} | ${motionCell(d.region)} | ${motionCell(d.transform)} | ${motionCell(d.willChange)} | ${motionCell(d.filter)} | ${motionCell(d.backdropFilter)} |`);
      }
      push();
      push("A `backdrop-filter` is a glass effect. Reproduce the declared value — a solid");
      push("approximation looks nothing like it over moving content.");
      push();
    }

    const declaredTotal = ir.motion?.declaredCount;
    if (isUsable(declaredTotal) && Number(declaredTotal.value) > declaredMotion.length) {
      push(`${declaredTotal.value} element(s) declare motion; the first ${declaredMotion.length} are listed. The rest`);
      push("were not captured, and their absence here is not evidence that they do not animate.");
      push();
    }
  }

  if (keyframeBodies.length) {
    push("### Keyframes");
    push();
    for (const k of keyframeBodies) {
      if (!isUsable(k.name)) continue;
      push(`**\`@keyframes ${k.name.value}\`**${refs(k.name)}`);
      if (isUsable(k.steps)) {
        push(`- Offsets: ${[].concat(k.steps.value).map((x) => `\`${x}\``).join(", ")}`);
      }
      if (isUsable(k.declarations)) {
        push("- Declarations:");
        for (const d of [].concat(k.declarations.value)) push(`  - \`${d}\``);
      }
      push();
    }
  } else if (isUsable(ir.motion?.keyframes)) {
    push("### Keyframes");
    push();
    push(renderClaim("Named keyframe rules", ir.motion.keyframes));
    push();
    push("**The rule bodies were not readable**, so what these animate is not recorded. The names");
    push("belong to the reference; do not guess the steps from them.");
    push();
  }

  /* ---- observed runtime motion (M2c).
   *
   * Everything above this point is DECLARED. Everything below was observed
   * happening. They are rendered under separate headings and never interleaved,
   * because a builder reading "opacity: 0 -> 1" needs to know whether that came
   * from a stylesheet or from watching the page. */
  const observed = ir.motion?.observed ?? null;
  const runtime = observed?.runtime ?? [];
  const verifiedTriggers = observed?.triggers?.verified ?? [];
  const unverifiedTriggers = observed?.triggers?.unverified ?? [];

  if (runtime.length) {
    push("### Observed runtime motion");
    push();
    push("Recorded by driving the page and sampling it before and after each action.");
    push("A change is **not** a cause — what produced it is stated separately below each entry.");
    push();

    for (const r of runtime) {
      const verified = verifiedTriggers.find((t) => t.observationId === r.observationId);
      const unverified = unverifiedTriggers.find((t) => t.observationId === r.observationId);

      push(`**\`${r.target ?? "(unnamed element)"}\`** — action: \`${r.action ?? "unknown"}\``);
      for (const prop of r.changedProperties) {
        const before = r.before?.[prop];
        const after = r.after?.[prop];
        push(`- \`${prop}\`: \`${before ?? "?"}\` → \`${after ?? "?"}\` *(${r.status})*` +
             `${r.evidence?.length ? ` [${r.evidence.join("], [")}]` : ""}` +
             `${r.confidence != null ? `, confidence ${r.confidence.toFixed(2)}` : ""}`);
      }
      if (r.measuredProperties?.length) {
        push(`- Sampled: ${r.measuredProperties.map((p) => `\`${p}\``).join(", ")}. Properties not listed as changed were sampled and did not change.`);
      }
      for (const u of r.unknowns ?? []) push(`- Unknown: ${typeof u === "string" ? u : JSON.stringify(u)}`);

      if (verified) {
        push(`- **Verified trigger** — \`${verified.action}\` caused ${verified.changedProperties.map((p) => `\`${p}\``).join(", ")} to change.`);
        push(`  - Control \`${verified.controlObservationId}\` result: \`${verified.controlResult}\` — the same elapsed time without the action produced no such change.`);
        if (verified.evidence?.length) push(`  - Evidence: [${verified.evidence.join("], [")}]`);
        if (verified.confidence != null) push(`  - Confidence: ${verified.confidence.toFixed(2)}`);
      } else if (unverified) {
        /* Rendered as a refusal, never as a weak trigger. */
        push(`- **Trigger unverified.** The change above was observed and stands; what caused it was not established.`);
        push(`  - Reason: ${unverified.reason}`);
        push(`  - Control \`${unverified.controlObservationId ?? "(none)"}\` result: \`${unverified.controlResult ?? "absent"}\``);
        push(`  - **Do not claim \`${unverified.action ?? "the action"}\` caused this.**`);
      } else {
        push("- **No trigger claim.** No control observation accompanies this change, so nothing licenses attributing it to the action.");
      }
      push();
    }

    if (observed?.controls?.length) {
      push(`${observed.controls.length} control observation(s) were taken — the same elapsed time with the action withheld. They are what makes any trigger above verifiable rather than assumed.`);
      push();
    }
  } else if (observed && observed.artifact?.state !== "valid") {
    /* Absent, refused or malformed. Each says something different, and the
     * reason is carried verbatim from the inspection rather than summarised. */
    push("### Observed runtime motion");
    push();
    push("**Not available for this capture.**");
    push();
    push(`- ${observed.artifact.reason}`);
    push("- No causal trigger claim is available. Nothing below the declared motion above was observed running.");
    push();
  }

  /* The boundary, stated once and plainly. */
  if (declaredMotion.length || keyframeBodies.length) {
    push("### What this section does not tell you");
    push();
    push("Every value above is **declared** in a stylesheet. A single capture cannot observe:");
    push();
    push("- **What triggers anything.** A declared animation may run on load, on a class toggle, on");
    push("  scroll, or never. Nothing here distinguishes those.");
    push("- **Stagger.** Different delays on different elements may be one sequence or unrelated");
    push("  rules. That difference is intent, and intent is not a CSS property.");
    push("- **Scroll-linked behaviour.** Computed style is identical whether or not a scroll driver");
    push("  exists.");
    push();
    push("Choose the trigger and the sequencing yourself, and record the choice as yours.");
    push();
  }

  /* -------------------------------------------------------- accessibility */

  push("## 11. Accessibility");
  push();
  push("- Every interactive control needs a visible `:focus-visible` style. The reference's focus treatment was not captured, so implement a 2px outline at 2px offset in the brand colour and record it as your decision.");
  push("- Minimum interactive target: 44×44px.");
  push("- Body text must clear 4.5:1 against its background; large text 3:1.");
  push("- Use semantic landmarks (`header`, `nav`, `main`, `footer`) and a single `h1`.");
  push();

  /* ------------------------------------------------------------ non-goals */

  push("## 12. Assets and brand boundaries");
  push();

  /* Measured facts first, prohibitions after.
   *
   * The order is the whole point of this section's rewrite. Before it, this was
   * five lines of prohibition and nothing else, while the capture had been
   * collecting media geometry the entire time and dropping it at derivation. A
   * builder was told what not to copy and given nothing to build instead.
   *
   * What is emitted here is the SHAPE of the media — box, ratio, fit — never its
   * content. No URL, no filename, no alt text. Those are the reference's; the
   * geometry is a fact about the layout. */
  const assets = ir.assets ?? null;
  const items = assets?.items ?? [];

  const truncatedWalk = ir.coverage?.truncated === true;

  if (items.length) {
    /* The count is a true count of what the SAMPLED walk enumerated. On a
     * truncated capture that is not the page's media count and must not be
     * offered as one: stripe.com/pricing enumerated 2 while the extractor
     * counted 526 in the primary region alone. Both numbers are real; only one
     * of them answers "how much media does this page have", and the capture
     * cannot answer it. */
    if (truncatedWalk) {
      const inRegion = ir.coverage?.mediaInPrimaryRegion;
      /* Still a claim, with its status and evidence id intact — the count was
       * measured and stays measured. Only the LABEL changes, because what it
       * counts is the sampled walk rather than the page. */
      push(renderClaim("Media enumerated in the sampled walk", assets.count));
      push();
      if (typeof inRegion === "number" && inRegion > items.length) {
        push(`The extractor counted **${inRegion}** media elements in the primary region alone.`);
      }
      push();
      push("**The walk was truncated, so this is not a page-wide count.** The elements below were");
      push("measured and are reported exactly; treat them as a sample of the page's media, not as");
      push("its inventory, and do not conclude that anything absent from this table is absent from");
      push("the page.");
    } else {
      push(renderClaim("Media elements found", assets.count));
    }
    push();
    push("| # | Element | Region | Rendered | Intrinsic | Aspect ratio | object-fit | alt |");
    push("| --- | --- | --- | --- | --- | --- | --- | --- |");

    for (const item of items) {
      /* `cell` keeps the status marker on any value that is not exact. A bare
       * number in a table reads as measured whatever the prose around it says,
       * so an estimated value carries its label into the cell itself. */
      const cell = (claim, format = (v) => String(v)) => {
        if (!isUsable(claim)) return "—";
        const value = format(claim.value);
        if (claim.status === "measured" || claim.status === "observed") return `\`${value}\``;
        if (claim.status === "estimated") return `~${value} *(estimated)*`;
        return `${value} *(${claim.status})*`;
      };

      const size = (w, h) =>
        isUsable(w) && isUsable(h) ? cell(w, () => `${w.value}×${h.value}`) : "not measured";

      push([
        "",
        String(item.index + 1),
        cell(item.tag),
        cell(item.region),
        size(item.renderedWidth, item.renderedHeight),
        size(item.intrinsicWidth, item.intrinsicHeight),
        cell(item.aspectRatio),
        cell(item.objectFit),
        isUsable(item.hasAlt) ? (item.hasAlt.value ? "present" : "**absent**") : "—",
        ""
      ].join(" | ").replace(/^ \| /, "| ").replace(/ \| $/, " |"));
    }
    push();

    /* An absent alt is an accessibility finding, so it is stated rather than
     * left for the reader to spot in a table cell. */
    const missingAlt = items.filter((i) => isUsable(i.hasAlt) && i.hasAlt.value === false);
    if (missingAlt.length) {
      push(`**${missingAlt.length} image(s) on the reference carry no \`alt\` attribute.** Do not copy that. Give every meaningful image alt text you write yourself, and mark decorative ones \`alt=""\`.`);
      push();
    }

    const noIntrinsic = items.filter((i) => !isUsable(i.intrinsicWidth));
    if (noIntrinsic.length) {
      push(`Intrinsic dimensions were not available for ${noIntrinsic.length} of ${items.length} element(s). The rendered box is not a substitute — an image scaled into a larger box would be recorded at the box's size. Set explicit \`width\`/\`height\` from your own assets to reserve layout space.`);
      push();
    }

    push("Reproduce the **geometry** — box size, aspect ratio and `object-fit`. Supply your own media.");
    push();
  } else {
    /* Two different statements, and the evidence distinguishes them: a measured
     * zero means the document was walked and held no media; an unusable count
     * means nothing was enumerated. Telling a builder "there are no images"
     * when nobody looked would be inventing a finding. */
    if (isUsable(assets?.count) && !truncatedWalk) {
      push(renderClaim("Media elements found", assets.count));
      push();
      push("The document was walked and no `img`, `picture` or `video` element was found. That is a");
      push("finding about the reference, not a gap in the capture — build without media unless your");
      push("own brief calls for it.");
    } else if (isUsable(assets?.count) && truncatedWalk) {
      /* A zero from an incomplete walk is the one reading that must never be
       * offered: "nobody found any" and "there are none" are the same sentence
       * until you know whether the looking finished. */
      push(renderClaim("Media enumerated in the sampled walk", assets.count));
      push();
      push("**The walk was truncated, so whether this page uses media is unknown.** None was found");
      push("in the part that was sampled. That is not a finding that the page has none — decide for");
      push("yourself whether your build needs media, and record the decision.");
    } else {
      push("**Media was not enumerated in this capture.** Nothing here specifies image or video");
      push("geometry; anything you add is your own decision, and should be recorded as such.");
    }
    push();
  }

  push("Do not reproduce any of the following from the reference:");
  push();
  push("- Logos, wordmarks, or brand names — use a neutral placeholder mark.");
  push("- Marketing copy — write your own placeholder text.");
  push("- Photography, illustration, or icon sets — use neutral placeholder blocks.");
  push("- Licensed fonts you do not have rights to.");
  push();
  push("The design *system* — spacing, type scale, colour roles, layout logic, interaction patterns — is what you are reproducing. The brand identity is not.");
  push();

  /* -------------------------------------------------- acceptance criteria */

  push("## 13. Technical implementation");
  push();
  push("**Stack:** Next.js (App Router) · React · TypeScript · Tailwind CSS.");
  push();
  push("- Declare the measured tokens as CSS custom properties on `:root` and expose them");
  push("  through the Tailwind theme, so one change updates every use.");
  push("- Where a measured value does not land on a Tailwind scale step, use an arbitrary");
  push("  value (`p-[13px]`) rather than the nearest step. A silent substitution loses the");
  push("  measurement and nothing downstream records that it happened.");
  push("- Configure the measured breakpoints; do not map them onto `sm`/`md`/`lg`.");
  push("- Use `focus-visible:` rather than `focus:` unless the reference was measured otherwise.");
  push("- Motion: use CSS transitions for simple property changes. Reach for GSAP only where");
  push("  section 10 records a sequence the platform cannot express. Where no motion was");
  push("  measured, add none.");
  push();
  push("See `output/implementation-notes.md` for the full stack mapping. Those notes contain");
  push("no findings about the reference — everything measured is in this file.");
  push();

  /* -------------------------------------------------- acceptance criteria */

  push("## 14. Acceptance criteria");
  push();
  push("The build is complete when all of the following hold, verified by measurement rather than by eye:");
  push();

  const criteria = [];
  if (isUsable(container?.maxWidth)) criteria.push(`Page container computes to \`max-width: ${literal(container.maxWidth)}\`.`);
  if (isUsable(container?.paddingX)) criteria.push(`Container horizontal padding computes to \`${literal(container.paddingX)}\`.`);
  if (grid && isUsable(grid.columns)) criteria.push(`Card grid renders ${literal(grid.columns)} columns at ${ir.meta.viewports[0]}px.`);
  if (grid && isUsable(grid.gap)) criteria.push(`Card grid gap computes to \`${literal(grid.gap)}\`.`);
  if (t.radius.card && isUsable(t.radius.card)) criteria.push(`Card border-radius computes to \`${literal(t.radius.card)}\`.`);
  if (t.radius.button && isUsable(t.radius.button)) criteria.push(`Button border-radius computes to \`${literal(t.radius.button)}\`.`);
  if (t.elevation.card && isUsable(t.elevation.card)) criteria.push(`Card box-shadow computes to \`${literal(t.elevation.card)}\`.`);
  if (t.border.default && isUsable(t.border.default)) criteria.push(`Card border computes to \`${literal(t.border.default)}\`.`);
  if (body?.fontSize && isUsable(body.fontSize)) criteria.push(`Body font-size computes to \`${literal(body.fontSize)}\` with line-height \`${literal(body.lineHeight)}\`.`);
  for (const role of ["h1", "h2", "h3"]) {
    const group = t.typography[role];
    if (group?.fontSize && isUsable(group.fontSize)) {
      criteria.push(`\`${role}\` font-size computes to \`${literal(group.fontSize)}\`${group.letterSpacing ? ` with letter-spacing \`${literal(group.letterSpacing)}\`` : ""}.`);
    }
  }
  if (base && isUsable(base.duration)) criteria.push(`Interactive transitions run for \`${literal(base.duration)}\` on \`${literal(base.easing)}\`.`);
  if (isUsable(ir.layout.breakpoints)) criteria.push(`Tailwind screens match \`${ir.layout.breakpoints.value.join("px, ")}px\`.`);
  criteria.push("Every interactive element has a visible focus indicator.");
  criteria.push("No brand asset from the reference appears anywhere in the build.");

  criteria.forEach((c, i) => push(`${i + 1}. ${c}`));
  push();

  /* Criterion 10 asks for a focus indicator, which is a build requirement and
   * not a measurement of the reference. Without this note a reader can take the
   * whole list as verified against the page, so the gap is stated where the
   * checking happens rather than only in section 8. Same evidence condition:
   * this is about what the capture induced, not about what a gate decided. */
  if (!stateful.length) {
    push(
      "**Interactive states were not induced for this capture; do not assume hover, focus, " +
        "active, expanded, carousel, accordion, or tooltip behavior.** Criteria above that " +
        "concern interaction are requirements on your build, not measurements of the reference."
    );
    push();
  }

  /* ------------------------------------------------------------ contested */

  const contested = ir.contestedClaims ?? [];
  if (contested.length) {
    push("### Contested values — resolve these before building");
    push();
    push(
      "Two evidence sources disagree about the following. Any value above marked " +
        "`CONTESTED` or `approximate` comes from here. Treat each as a decision to make " +
        "deliberately, and record which you chose."
    );
    push();
    for (const entry of contested) {
      push(`### \`${entry.claim}\`${entry.critical ? " — critical" : ""}`);
      push();
      for (const candidate of entry.candidates) {
        push(`- \`${candidate.source}\` (${candidate.technique ?? "—"}) says **${JSON.stringify(candidate.value)}** — ${candidate.status}, confidence ${(candidate.confidence ?? 0).toFixed(2)}`);
      }
      push();
      push(`Disagreement type: ${entry.type} · resolution: ${entry.resolutionStatus}`);
      push();
    }
    push("Neither value has been discarded. See `disagreement-report.md` for the full comparison.");
    push();
  }

  /* ------------------------------------------------------------- unknowns */

  /* Unconditional. A prompt that omits its limitations section when there
   * happen to be no unknowns teaches a reader that the section's absence means
   * nothing — and then its absence on a run that DID have gaps reads the same
   * way. The section always appears; what changes is what it says. */
  push("## 15. Evidence limitations");
  push();
  if (ir.unknowns.length) {
    push("These were looked for and not established. Decide each deliberately and record the");
    push("choice — do not present any of them as matching the reference.");
    push();
    for (const u of ir.unknowns) {
      push(`- \`${u.claim}\` — ${u.reason}`);
    }
    push();
  } else {
    push("No claim in this analysis was left undetermined.");
    push();
  }
  push(`Coverage was ${ir.coverage?.coverageFactor != null ? ir.coverage.coverageFactor.toFixed(2) : "not measured"} — anything the capture did not reach is absent from this prompt rather than reported as absent from the page.`);
  push();
  push("No tolerance in this system is validated. The acceptance criteria in section 14 are");
  push("stated targets, not certified thresholds.");
  push();

  /* ------------------------------------------------- forbidden assumptions */

  push("## 16. Forbidden assumptions");
  push();
  push("Where this document is silent, it is silent because nothing was measured. Do not fill");
  push("the gap plausibly — a plausible value is indistinguishable from a measured one once it");
  push("is in the code, and nobody downstream can tell which is which.");
  push();
  push("Specifically, do not assume:");
  push();
  push("- **That an unstated value matches a framework default.** The reference was not built");
  push("  in your stack, and the defaults are unlikely to coincide.");
  push("- **That an unmeasured interaction state resembles the default state.** Section 8 says");
  push("  what was and was not induced.");
  push("- **That a contested value can be settled by picking the more plausible candidate.**");
  push("  Two sources disagreed; that disagreement is the finding.");
  push("- **That coverage gaps are empty regions.** A region the capture did not reach is");
  push("  unmeasured, not blank.");
  push("- **That the reference's brand identity is available to reuse.** Section 12 is a");
  push("  boundary, not a suggestion.");
  push("- **That anything here has been validated against a certified tolerance.** Nothing has.");
  push();

  push("---");
  push();
  push("*Generated from `analysis/ir.json`. Do not edit — correct the evidence and regenerate.*");

  return out.join("\n");
}

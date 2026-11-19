import { literal, isUsable, isSettled, confidenceText } from "./fmt.mjs";
import { standardHeader } from "./header.mjs";
import { STATUS } from "../evidence/status.mjs";
import * as color from "../util/color.mjs";

/**
 * IR -> improvement-prompt.md
 *
 * The hazard in this mode is specific and severe: **a proposal that reads like
 * an observation.** A reader who cannot tell "the reference does this" from
 * "the reference should do this" will implement a critique as though it were a
 * measurement, and the reference will be blamed for it.
 *
 * Wording discipline is not enough, so the separation is structural. Every
 * section is machine-marked with its kind — observation, critique, proposal,
 * constraint, unknown — and V9 verifies that no proposal section asserts
 * something about the reference without evidence backing it.
 *
 * Every proposal line is additionally prefixed, so the distinction survives
 * being copied out of the document.
 */

const KIND = {
  OBSERVATION: "observation",
  CRITIQUE: "critique",
  PROPOSAL: "proposal",
  CONSTRAINT: "constraint",
  UNKNOWN: "unknown"
};

const open = (kind, id) => `<!-- bigaap:section kind="${kind}" id="${id}" -->`;
const close = "<!-- /bigaap:section -->";

/** Every proposal line carries its own marker, not just its section's. */
const PROPOSE = "**Proposed:**";

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

const evidenceRef = (claim) => ((claim?.evidence ?? []).length ? ` [${claim.evidence.join(", ")}]` : "");

export function projectImprovementPrompt(ir, hash) {
  const t = ir.tokens;
  const container = ir.layout.containers[0];
  const grid = ir.layout.grids[0];
  const out = [];
  const push = (l = "") => out.push(l);

  /* Findings are computed once, then rendered into the right kind of section. */
  const strengths = [];
  const weaknesses = [];
  const proposals = [];

  const record = (weakness, proposal) => {
    weaknesses.push(weakness);
    proposals.push(proposal);
  };

  /* ------------------------------------------- derive findings from evidence */

  const contrast = ir.a11y?.contrastFindings ?? [];
  for (const finding of contrast) {
    const ratio = color.contrast(finding.foreground, finding.background);
    if (ratio == null) continue;
    if (ratio >= 4.5) {
      strengths.push({
        text: `Body text on the page background measures ${ratio}:1, clearing WCAG AA for body copy.`,
        evidence: finding.evidence ?? []
      });
    } else {
      record(
        {
          text: `Body text on the page background measures ${ratio}:1, below the 4.5:1 WCAG AA threshold for body copy.`,
          evidence: finding.evidence ?? [],
          severity: "high"
        },
        {
          text: `Darken the text role or lighten the surface until the pair reaches at least 4.5:1. A ${ratio}:1 pair fails for readers with low vision, and the fix is a token change rather than a redesign.`,
          measurable: "Text/background contrast ≥ 4.5:1 for body copy, ≥ 3:1 for text 24px or larger.",
          severity: "high"
        }
      );
    }
  }

  const statesUnknown = (ir.components ?? []).some((c) =>
    Object.entries(c.states ?? {}).some(([name, s]) => name !== "default" && s?.status === STATUS.UNKNOWN)
  );
  if (statesUnknown) {
    record(
      {
        text: "No hover, focus or disabled state was observed for any component in this capture.",
        evidence: [],
        severity: "medium",
        note: "This is a gap in the capture, not necessarily a gap in the reference."
      },
      {
        text: "Give every interactive control an explicit and visible `:focus-visible` treatment, and verify it is not the browser default suppressed by a reset.",
        measurable: "Every focusable control shows a focus indicator with ≥ 3:1 contrast against its adjacent background.",
        severity: "medium"
      }
    );
  }

  if (isUsable(ir.scales.spacingBaseUnit)) {
    strengths.push({
      text: `Spacing follows a consistent ${literal(ir.scales.spacingBaseUnit)} base unit, giving the layout a predictable rhythm.`,
      evidence: ir.scales.spacingBaseUnit.evidence ?? []
    });
  } else if (isUsable(ir.scales.spacingObserved)) {
    record(
      {
        text: `No consistent spacing base unit could be established; ${ir.scales.spacingObserved.value.length} distinct values are in use.`,
        evidence: ir.scales.spacingObserved.evidence ?? [],
        severity: "medium"
      },
      {
        text: "Adopt a single base unit and snap existing values to it. Inconsistent spacing is rarely noticed individually but reads as imprecision in aggregate.",
        measurable: "Every padding, margin and gap is a multiple of one declared base unit.",
        severity: "medium"
      }
    );
  }

  const typeRamp = ir.scales.typeRamp;
  if (isUsable(typeRamp) && Array.isArray(typeRamp.value) && typeRamp.value.length > 8) {
    record(
      {
        text: `${typeRamp.value.length} distinct font sizes are rendered: ${typeRamp.value.join(", ")}px.`,
        evidence: typeRamp.evidence ?? [],
        severity: "low"
      },
      {
        text: "Reduce the type ramp to a smaller named set. A long ramp usually indicates sizes chosen per-instance rather than from a scale, which makes hierarchy harder to read and harder to maintain.",
        measurable: "No more than 7 named type steps, each used more than once.",
        severity: "low"
      }
    );
  } else if (isUsable(typeRamp)) {
    strengths.push({
      text: `The type ramp is compact — ${typeRamp.value.length} sizes — which keeps hierarchy legible.`,
      evidence: typeRamp.evidence ?? []
    });
  }

  const buttons = (ir.components ?? []).find((c) => c.role === "action");
  const minHeight = buttons?.anatomy?.find((a) => a.property === "minHeight")?.claim;
  if (isUsable(minHeight)) {
    if (minHeight.value >= 44) {
      strengths.push({ text: `Interactive controls are at least ${literal(minHeight)} tall, meeting the 44px minimum target size.`, evidence: minHeight.evidence ?? [] });
    } else {
      record(
        { text: `Interactive controls measure ${literal(minHeight)} tall, below the 44px minimum target size.`, evidence: minHeight.evidence ?? [], severity: "high" },
        { text: "Raise the minimum control height to 44px. Small targets disproportionately affect touch users and anyone with reduced motor precision.", measurable: "Every interactive control has a hit area of at least 44×44px.", severity: "high" }
      );
    }
  }

  if (!isUsable(ir.layout.breakpoints)) {
    record(
      { text: "No width-based breakpoints were reachable in this capture.", evidence: [], severity: "medium", note: "Stylesheets may have been cross-origin blocked." },
      { text: "Declare explicit breakpoints and verify the layout at each. Responsive behaviour that exists only implicitly is difficult to maintain deliberately.", measurable: "Named breakpoints, with the layout verified at each.", severity: "medium" }
    );
  }

  /* ============================ 1. what the reference currently does ===== */

  push(standardHeader(ir, { title: `Improvement prompt — ${ir.meta.slug}`, nextAction: "read the observations before the proposals. The two are separated because only one of them was measured." }));
  push();
  push(`**Reference analysed:** \`${ir.meta.source.value}\``);
  push(`**Mode:** improve — identify UX weaknesses and propose an improved version that retains the measured design language.`);
  push();
  push(
    "> **Read the section kinds.** This document contains four different things and " +
      "keeps them apart: what the reference *does* (measured), what is *assessed* about " +
      "it (judgement), what is *proposed* (does not exist in the reference), and what is " +
      "*unknown*. Every proposal line is prefixed **Proposed:**. Nothing marked proposed " +
      "is a description of the reference."
  );
  push();

  push(open(KIND.OBSERVATION, "current-behaviour"));
  push("## 1. Observed reference behavior");
  push();
  push("Measured behaviour only. Every line carries its evidence.");
  push();
  if (isUsable(container?.maxWidth)) push(`- Content is bounded at ${labelled(container.maxWidth)} and centred${evidenceRef(container.maxWidth)}`);
  if (isUsable(container?.paddingX)) push(`- Container carries ${labelled(container.paddingX)} horizontal padding${evidenceRef(container.paddingX)}`);
  if (isUsable(grid?.columns)) push(`- Primary grid renders ${labelled(grid.columns)} columns${isUsable(grid.gap) ? ` with ${labelled(grid.gap)} gap` : ""}${evidenceRef(grid.columns)}`);
  if (isUsable(t.typography.body?.fontSize)) push(`- Body text is ${labelled(t.typography.body.fontSize)} with line height ${labelled(t.typography.body.lineHeight)}${evidenceRef(t.typography.body.fontSize)}`);
  if (isUsable(ir.scales.spacingBaseUnit)) push(`- Spacing uses a ${labelled(ir.scales.spacingBaseUnit)} base unit${evidenceRef(ir.scales.spacingBaseUnit)}`);
  for (const [name, claim] of Object.entries(t.color)) {
    if (isUsable(claim)) push(`- Colour role \`${name}\` is ${labelled(claim)}${evidenceRef(claim)}`);
  }
  for (const [name, claim] of Object.entries(t.radius)) {
    if (isUsable(claim)) push(`- \`radius.${name}\` is ${labelled(claim)}${evidenceRef(claim)}`);
  }
  if (t.motion.base && isUsable(t.motion.base.duration)) {
    push(`- Transitions run ${labelled(t.motion.base.duration)} on ${labelled(t.motion.base.easing)}${evidenceRef(t.motion.base.duration)}`);
  }
  for (const component of ir.components ?? []) {
    push(`- Component \`${component.id}\` (\`${component.selectors[0]}\`) appears ${component.instanceCount?.value ?? "multiple"} time(s) with ${component.anatomy.length} resolved propert(ies)${evidenceRef(component.instanceCount)}`);

    /* The absence of a surface is an OBSERVATION and belongs here, in the
     * observed section, stated flatly. Anything about adding one is a proposal
     * and lives in the proposal section under its own marker — the whole point
     * of this mode's structure is that a reader can never mistake the second
     * for the first. */
    if (component.surfaceObserved === true && component.surface == null) {
      push(`- Component \`${component.id}\` has no painted surface: \`surface: null\`, classified \`${component.surfaceClassification}\`. ` +
        `It is separated from its siblings by spacing and typography${evidenceRef(component.instanceCount)}`);
    } else if (component.paintedDescendant?.value) {
      push(`- Component \`${component.id}\` paints nothing itself; \`${component.paintedDescendant.value}\` inside it carries the surface${evidenceRef(component.paintedDescendant)}`);
    } else if (component.surfaceObserved === false) {
      push(`- Whether component \`${component.id}\` paints a surface was not determined: \`surface: unknown\``);
    }
  }
  push();
  push(close);
  push();

  /* ================================ 2. evidence for current behaviour ==== */

  push(open(KIND.OBSERVATION, "evidence"));
  push("## 2. Evidence supporting the observation");
  push();
  push(`Coverage: ${((ir.coverage?.visibleSampledPercent ?? 0) * 100).toFixed(1)}% of visible nodes sampled · contentReached ${(ir.coverage?.contentReached ?? 0).toFixed(2)} · confidence ${confidenceText(ir.confidence.overall)}.`);
  push();
  push("Status of every value above: bare backticks are exact readings, `(inferred)` is a pattern across samples, `(estimated)` is not exact, `(unknown)` was never determined. Bracketed `[ev_*]` ids resolve to `analysis/evidence-map.json`.");
  push();
  push(close);
  push();

  /* ==================================================== 3. UX strengths == */

  push(open(KIND.CRITIQUE, "strengths"));
  push("## 3. UX strengths");
  push();
  push("*Assessment of the measured behaviour above — judgement, not measurement.*");
  push();
  if (!strengths.length) {
    push("- Too little evidence was recovered to identify a strength with confidence.");
  } else {
    for (const s of strengths) push(`- ${s.text}${s.evidence.length ? ` [${s.evidence.join(", ")}]` : ""}`);
  }
  push();
  push(close);
  push();

  /* ============================================ 4. weaknesses and risks == */

  push(open(KIND.CRITIQUE, "weaknesses"));
  push("## 4. UX critique");
  push();
  push("*Assessment, not measurement. Each is tied to the evidence it rests on.*");
  push();
  if (!weaknesses.length) {
    push("- No weakness was identified from the available evidence. That is not the same as none existing — see section 11.");
  } else {
    for (const w of weaknesses) {
      push(`- **${w.severity}** — ${w.text}${w.evidence.length ? ` [${w.evidence.join(", ")}]` : ""}`);
      if (w.note) push(`  - ${w.note}`);
    }
  }
  push();
  push(close);
  push();

  /* ============================================= 5. proposed improvements */

  push(open(KIND.PROPOSAL, "proposals"));
  push("## 5. Proposed improvements");
  push();
  push("> **None of the following exists in the reference.** Every line below is a change to make, not a description of what was measured.");
  push();
  if (!proposals.length) {
    push(`${PROPOSE} No change. The available evidence did not support a specific improvement.`);
  } else {
    proposals.forEach((p, i) => {
      push(`### ${i + 1}. ${p.severity} priority`);
      push();
      push(`${PROPOSE} ${p.text}`);
      push();
    });
  }
  push(close);
  push();

  /* ================================================ 6. reasoning ======== */

  push(open(KIND.PROPOSAL, "reasoning"));
  push("## 6. Reasoning for proposals");
  push();
  push("> Each entry restates the assessment it answers, then the change. The change does not exist in the reference.");
  push();
  if (!proposals.length) {
    push("*No proposals were made.*");
  } else {
    proposals.forEach((p, i) => {
      const w = weaknesses[i];
      push(`**${i + 1}.** The assessment in section 4 — *${w.text}* — rests on the measurement cited there. ${PROPOSE} ${p.text}`);
      push();
    });
  }
  push(close);
  push();

  /* ============================================ 7. must remain unchanged  */

  push(open(KIND.CONSTRAINT, "preserve"));
  push("## 7. What must remain unchanged");
  push();
  push("The design language is not the subject of the critique. Preserve these exactly:");
  push();
  for (const [name, claim] of Object.entries(t.color)) {
    if (isSettled(claim)) push(`- Colour role \`${name}\` at ${labelled(claim)}${evidenceRef(claim)} — unless a proposal above names it explicitly`);
  }
  if (isSettled(ir.scales.spacingBaseUnit)) push(`- The ${literal(ir.scales.spacingBaseUnit)} spacing base unit${evidenceRef(ir.scales.spacingBaseUnit)}`);
  for (const [name, claim] of Object.entries(t.radius)) {
    if (isSettled(claim)) push(`- \`radius.${name}\` at ${literal(claim)}${evidenceRef(claim)}`);
  }
  if (isSettled(container?.maxWidth)) push(`- Container width ${literal(container.maxWidth)}${evidenceRef(container.maxWidth)}`);
  if (t.motion.base && isSettled(t.motion.base.duration)) push(`- Transition timing ${literal(t.motion.base.duration)} on ${literal(t.motion.base.easing)}${evidenceRef(t.motion.base.duration)}`);
  push("- The reference's brand identity is out of scope entirely: this mode changes behaviour, not identity.");
  push();
  push(close);
  push();

  /* ==================================== 8. implementation requirements === */

  push(open(KIND.PROPOSAL, "implementation"));
  push("## 8. Implementation requirements");
  push();
  push("> Requirements for the improved version. None describes the reference.");
  push();
  if (!proposals.length) {
    push("*No proposals, so no implementation requirements.*");
  } else {
    proposals.forEach((p, i) => {
      push(`${i + 1}. ${PROPOSE} ${p.measurable}`);
    });
  }
  push();
  push(close);
  push();

  /* ========================================= 9. accessibility ============ */

  push(open(KIND.PROPOSAL, "accessibility"));
  push("## 9. Accessibility requirements");
  push();
  push("> Requirements for the improved version.");
  push();
  push(`${PROPOSE} Body text clears 4.5:1 against its background; text 24px and larger clears 3:1.`);
  push(`${PROPOSE} Every interactive control has a visible \`:focus-visible\` indicator at ≥ 3:1 against its adjacent background.`);
  push(`${PROPOSE} Every interactive control has a hit area of at least 44×44px.`);
  push(`${PROPOSE} Semantic landmarks are used, with exactly one \`h1\`.`);
  push(`${PROPOSE} All non-trivial motion is neutralised under \`prefers-reduced-motion: reduce\`.`);
  push();
  push(close);
  push();

  /* ======================================== 10. acceptance criteria ===== */

  push(open(KIND.PROPOSAL, "acceptance"));
  push("## 10. Acceptance criteria");
  push();
  push("> The improved version is complete when all of the following hold, verified by measurement.");
  push();
  let n = 0;
  const criterion = (text) => push(`${++n}. ${PROPOSE} ${text}`);
  for (const p of proposals) criterion(p.measurable);
  criterion("Every value listed in section 7 is unchanged from its measured value.");
  criterion("No reference brand asset, logo, wordmark or copy is introduced or altered.");
  criterion("Every change traces to a numbered proposal in section 5.");
  push();
  push(close);
  push();

  /* ============================================ 11. unknowns ============ */

  push(open(KIND.UNKNOWN, "unknowns"));
  push("## 11. Unknowns");
  push();
  push("What the analysis could not establish. These bound the critique: a weakness cannot be ruled out in an area that was never observed.");
  push();
  for (const unknown of ir.unknowns ?? []) push(`- \`${unknown.claim}\` — ${unknown.reason}`);
  if (!(ir.unknowns ?? []).length) push("- None recorded.");
  push();
  const contested = ir.contestedClaims ?? [];
  if (contested.length) {
    push("Contested between evidence sources — the critique does not rest on these:");
    push();
    for (const c of contested) push(`- \`${c.claim}\` — ${c.candidates.map((x) => `${x.source} says ${JSON.stringify(x.value)}`).join(" vs ")}`);
    push();
  }
  push(`Confidence ${confidenceText(ir.confidence.overall)} · coverage factor ${(ir.confidence.coverageFactor ?? 1).toFixed(2)}. A low figure means the critique covers less of the page than it appears to.`);
  push();
  push(close);
  push();

  push("---");
  push();
  push("*Generated from `analysis/ir.json`. Do not edit — correct the evidence and regenerate.*");

  return out.join("\n");
}

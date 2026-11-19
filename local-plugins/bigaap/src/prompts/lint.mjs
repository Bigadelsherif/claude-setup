/**
 * Prompt linting.
 *
 * Eighteen rules, each with an id, a severity, a location, the evidence that
 * triggered it, a remediation, and — the field that matters most — whether it
 * blocks generation.
 *
 * That last field is why this is a linter and not a validator. Some findings
 * mean the prompt is worse than it should be; a handful mean the prompt is
 * actively dangerous to act on, and those must stop it being written at all. A
 * flat list of errors would leave the caller to decide which, and the caller
 * does not have the information to decide.
 *
 * The blocking set is deliberately small:
 *
 *   - a contested critical value rendered as settled
 *   - an estimate rendered as a measurement
 *   - a target requirement rendered as reference evidence
 *   - a proposal rendered as an observation
 *   - a build-generated selector offered as an implementation hook
 *   - copied brand identity
 *   - foreign stack syntax
 *   - a stale or wrong-mode prompt
 *
 * Every one of those produces a prompt that reads correctly and instructs
 * someone to do the wrong thing. Missing sections and unsupported adjectives
 * are bad, and they are visible to whoever reads the prompt. These are not.
 */

import { contractFor, VAGUE_TERMS, VAGUE_PHRASES, prohibitionReason, SECTION_KIND } from "./contract.mjs";
import { PROPOSAL_MARKER } from "./render.mjs";
import { findForeignSyntax, isSupportedStack } from "./stack-adapter.mjs";
import { classifySelector, SELECTOR_CLASS } from "../deploy/selector-class.mjs";
/* Without a classifier, `classifySelector` calls every generated selector
 * `unknown` — silently, and for exactly the selectors this rule exists to
 * catch. This is the extractor's own heuristic, not a copy of it. */
import { classifyClassName } from "../deploy/class-kind.mjs";
import { readMetadata } from "../artifacts/metadata.mjs";
import { checkFreshness, FRESHNESS } from "../artifacts/freshness.mjs";
import { readSections } from "../artifacts/validate.mjs";

export const SEVERITY = Object.freeze({
  /** Blocks generation. The prompt would instruct someone to do the wrong thing. */
  BLOCKING: "blocking",
  /** The prompt is usable but weaker than the evidence allows. */
  WARNING: "warning",
  /** Worth knowing; changes nothing about whether to act on the prompt. */
  ADVISORY: "advisory"
});

/**
 * The rule table. Declared as data so the linter, the report and the generated
 * documentation cannot disagree about what a rule means.
 */
export const LINT_RULES = Object.freeze([
  { id: "PL01", severity: SEVERITY.WARNING,  blocks: false, label: "Missing required section" },
  { id: "PL02", severity: SEVERITY.BLOCKING, blocks: true,  label: "Missing prompt metadata" },
  { id: "PL03", severity: SEVERITY.WARNING,  blocks: false, label: "Claim with no evidence reference" },
  { id: "PL04", severity: SEVERITY.BLOCKING, blocks: true,  label: "Exact value the evidence does not support" },
  { id: "PL05", severity: SEVERITY.WARNING,  blocks: false, label: "Vague adjective with no measurement" },
  { id: "PL06", severity: SEVERITY.BLOCKING, blocks: true,  label: "Contested critical value rendered as settled" },
  { id: "PL07", severity: SEVERITY.BLOCKING, blocks: true,  label: "Estimate rendered as a measurement" },
  { id: "PL08", severity: SEVERITY.BLOCKING, blocks: true,  label: "Proposal rendered as an observation" },
  { id: "PL09", severity: SEVERITY.BLOCKING, blocks: true,  label: "Target requirement rendered as reference evidence" },
  { id: "PL10", severity: SEVERITY.BLOCKING, blocks: true,  label: "Build-generated selector offered as an implementation hook" },
  { id: "PL11", severity: SEVERITY.BLOCKING, blocks: true,  label: "Syntax from a stack with no adapter" },
  { id: "PL12", severity: SEVERITY.BLOCKING, blocks: true,  label: "Copied brand identity" },
  { id: "PL13", severity: SEVERITY.BLOCKING, blocks: true,  label: "Missing acceptance criteria" },
  { id: "PL14", severity: SEVERITY.BLOCKING, blocks: true,  label: "Missing limitations" },
  { id: "PL15", severity: SEVERITY.BLOCKING, blocks: true,  label: "Missing forbidden assumptions" },
  { id: "PL16", severity: SEVERITY.BLOCKING, blocks: true,  label: "Stale artifact hash" },
  { id: "PL17", severity: SEVERITY.BLOCKING, blocks: true,  label: "Wrong mode" },
  { id: "PL18", severity: SEVERITY.BLOCKING, blocks: true,  label: "Wrong source kind" },
  { id: "PL19", severity: SEVERITY.WARNING,  blocks: false, label: "Incomplete adaptation triad" },
  { id: "PL20", severity: SEVERITY.WARNING,  blocks: false, label: "Unknown value replaced by a default" },
  { id: "PL21", severity: SEVERITY.WARNING,  blocks: false, label: "Reference claim in implementation notes" },
  { id: "PL22", severity: SEVERITY.WARNING,  blocks: false, label: "Measured assets absent from the prompt" },
  { id: "PL23", severity: SEVERITY.WARNING,  blocks: false, label: "Declared motion absent from the prompt" },
  /* A warning, not a blocker.
   *
   * The failure it catches is real — a prompt asserting that something animates
   * on scroll, when nothing observed a trigger, is exactly the fabrication this
   * milestone's boundary forbids. But the primary defence is structural: no
   * trigger is recorded in evidence, derived into the IR, or rendered by the
   * projector, so there is nothing for a prompt to carry one from.
   *
   * This is the second line, and a second line that can block on a false
   * positive is worse than one that warns. The section's own boundary note
   * contains the phrase "on scroll" while explaining that scroll-linkage is
   * NOT known — a rule strict enough to be worth blocking on would have to
   * distinguish that from an assertion, and it does not. */
  { id: "PL24", severity: SEVERITY.WARNING,  blocks: false, label: "Motion trigger asserted without evidence" },
  { id: "PL25", severity: SEVERITY.WARNING,  blocks: false, label: "Runtime motion claim with no control" },
  { id: "PL26", severity: SEVERITY.WARNING,  blocks: false, label: "Trigger stated for an unverified classification" }
]);

const RULE = Object.fromEntries(LINT_RULES.map((r) => [r.id, r]));

/** One finding. `blocked` is on the finding, not inferred by the caller. */
function finding(id, { where, message, evidence = null, remediation }) {
  const rule = RULE[id];
  return {
    rule: id,
    label: rule.label,
    severity: rule.severity,
    blocks: rule.blocks,
    where,
    message,
    evidenceContext: evidence,
    remediation
  };
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Splits into headed sections so a finding can name where it lives. */
function headings(text) {
  const out = [];
  const lines = String(text ?? "").split("\n");
  lines.forEach((line, i) => {
    const m = /^#{2,}\s+(?:\d+\.\s*)?(.+?)\s*$/.exec(line);
    if (m) out.push({ title: m[1], line: i + 1, index: i });
  });
  return out.map((h, i) => ({
    ...h,
    body: lines.slice(h.index + 1, out[i + 1]?.index ?? lines.length).join("\n"),
    startLine: h.line
  }));
}

/** Lines outside code fences, with their numbers. */
function proseLines(text) {
  const out = [];
  let inFence = false;
  String(text ?? "").split("\n").forEach((line, i) => {
    if (line.trim().startsWith("```")) { inFence = !inFence; return; }
    if (!inFence) out.push({ number: i + 1, text: line });
  });
  return out;
}

/* ------------------------------------------------------------- the rules */

function pl01_sections(text, contract) {
  const out = [];
  const heads = headings(text);
  const found = heads.map((h) => h.title.toLowerCase());
  const required = contract.sections.filter((s) => s.required);

  /* Order is part of the contract, not a matter of taste. A prompt stating its
   * acceptance criteria before its evidence limitations front-loads what to do
   * and buries what not to trust. */
  const positions = [];
  for (const section of required) {
    const at = found.findIndex((t) => t.includes(section.title.toLowerCase()));
    if (at !== -1) positions.push({ title: section.title, at });
  }
  for (let i = 1; i < positions.length; i++) {
    if (positions[i].at >= positions[i - 1].at) continue;
    out.push(finding("PL01", {
      where: positions[i].title,
      message: `"${positions[i].title}" appears before "${positions[i - 1].title}", which the contract puts first.`,
      remediation: `${contract.artifactKind} declares its sections in a fixed order. Reorder them so what not to trust is not buried below what to do.`
    }));
    break;
  }

  for (const section of required) {
    const present = found.some((t) => t.includes(section.title.toLowerCase()));
    if (!present) {
      out.push(finding("PL01", {
        where: section.title,
        message: `required section "${section.title}" is missing.`,
        remediation: `Add it. ${contract.artifactKind} declares ${contract.sections.filter((s) => s.required).length} required sections, and a prompt missing one has dropped a whole category of instruction rather than shortened it.`
      }));
    }
  }
  return out;
}

function pl02_metadata(filename, content) {
  const metadata = readMetadata(filename, content);
  if (!metadata || metadata.$malformed) {
    return [finding("PL02", {
      where: filename,
      message: `${filename} carries no readable metadata block.`,
      remediation: "Regenerate it. A prompt is the artifact most likely to be copied out of its directory, and the metadata is the only thing that survives the copy."
    })];
  }
  return [];
}

function pl03_evidenceRefs(text, contract) {
  const out = [];
  /* A line stating a backticked literal in a reference section is asserting a
   * measurement, and a measurement with no citation cannot be checked. */
  for (const h of headings(text)) {
    const section = contract.sections.find((s) => h.title.toLowerCase().includes(s.title.toLowerCase()));
    if (!section || section.kind !== SECTION_KIND.REFERENCE) continue;
    /* An evidence-limitations section lists what was NOT established. Asking it
     * to cite evidence for an absence is asking for a record that cannot exist. */
    if (/limitation|unknown/i.test(h.title)) continue;
    for (const line of h.body.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("-") && !t.startsWith("*")) continue;
      /* A backticked token is not automatically a claim. "Do not transition
       * `all`" is a directive; "`states.hover` — not captured" is a gap report.
       * Only a value-shaped literal asserts something about the reference, and
       * only an assertion needs a citation. */
      const ticks = [...t.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim());
      const statesValue = ticks.some((v) => VALUE_SHAPE.test(v) || /^[\d.]+\s*(px|rem|em|%|ms|s)\b/.test(v));
      if (!statesValue) continue;
      if (/\b(ev|sc)_\d{4,}\b/.test(t)) continue;
      if (/not determined|contested|unknown|not (?:captured|observed|induced|measured)/i.test(t)) continue;
      out.push(finding("PL03", {
        where: h.title,
        message: `a value is stated with no evidence reference: "${t.slice(0, 90)}"`,
        evidence: t.slice(0, 140),
        remediation: "Render it through `renderClaim()` in src/prompts/render.mjs, which attaches the evidence ids. A value nobody can trace is one nobody can check."
      }));
    }
  }
  return out;
}

function pl05_vague(text) {
  const out = [];
  for (const { number, text: line } of proseLines(text)) {
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      const phrase = VAGUE_PHRASES.find((p) => new RegExp(`\\b${escapeRe(p)}\\b`, "i").test(sentence));
      const term = phrase ?? VAGUE_TERMS.find((t) => new RegExp(`\\b${t}\\b`, "i").test(sentence));
      if (!term) continue;
      /* Supported = a number, an evidence citation, a backticked literal, or an
       * explicit interpretation label. The adjective may stay; it may not stand
       * alone. */
      const supported = /\d/.test(sentence) ||
        /\b(ev|sc)_\d{4,}\b/.test(sentence) ||
        /`[^`\n]+`/.test(sentence) ||
        /\*\((?:inferred|estimated|interpretation|proposed)/i.test(sentence);
      if (supported) continue;
      out.push(finding("PL05", {
        where: `line ${number}`,
        message: `"${term}" with nothing measurable beside it: "${sentence.trim().slice(0, 90)}"`,
        evidence: sentence.trim().slice(0, 140),
        remediation: `Pair it with the measurement. "${term}" alone is the only instruction on this line, and every reader resolves it differently.`
      }));
    }
  }
  return out;
}

function pl04_pl06_pl07_values(text, ir, contract) {
  const out = [];
  if (!ir) return out;
  const claims = collectClaims(ir);

  for (const claim of claims) {
    const critical = isCritical(claim.path);

    if (claim.contested) {
      for (const candidate of claim.candidates ?? []) {
        const value = fmtValue(candidate.value, claim.unit);
        if (!value) continue;
        const asSettled = new RegExp(`(\`${escapeRe(value)}\`|\\*\\*${escapeRe(value)}\\*\\*)`);
        const line = proseLines(text).find((l) => asSettled.test(l.text));
        if (!line) continue;
        if (/contested/i.test(line.text)) continue;
        out.push(finding(critical ? "PL06" : "PL04", {
          where: `line ${line.number}`,
          message: `\`${claim.path}\` is contested (${(claim.candidates ?? []).map((c) => `${c.source}: ${c.value}`).join(" vs ")}) but ${value} appears as a settled value.`,
          evidence: line.text.trim().slice(0, 140),
          remediation: prohibitionReason("contested-as-exact") + " Render it through `renderClaim()`, which shows both candidates."
        }));
        break;
      }
      continue;
    }

    if (claim.status === "estimated" && claim.value != null) {
      const value = fmtValue(claim.value, claim.unit);
      if (!value) continue;
      /* Backticked is the dangerous rendering: an agent copies it. A bare
       * mention that also says "estimated" is fine. */
      const backticked = new RegExp(`\`${escapeRe(value)}\``);
      const line = proseLines(text).find((l) => backticked.test(l.text));
      if (line && !/estimated/i.test(line.text)) {
        out.push(finding("PL07", {
          where: `line ${line.number}`,
          message: `\`${claim.path}\` is estimated, but ${value} is rendered as an exact literal: "${line.text.trim().slice(0, 90)}"`,
          evidence: line.text.trim().slice(0, 140),
          remediation: prohibitionReason("estimate-as-measurement") + " Use the `~value *(estimated …)*` rendering, which is deliberately not copyable."
        }));
      }
    }
  }
  return out;
}

function pl08_proposals(text, contract) {
  if (!contract.requiresProposalMarking) return [];
  const out = [];
  const proposalWords = /\b(should|could|recommend|propose|consider|suggest|would improve|instead of|better to)\b/i;
  const observationHeadings = /observed reference|what the reference|current(ly)? does|evidence supporting/i;

  for (const h of headings(text)) {
    if (!observationHeadings.test(h.title)) continue;
    for (const line of h.body.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#") || t.startsWith("<!--")) continue;
      if (t.startsWith(PROPOSAL_MARKER)) continue;
      if (!proposalWords.test(t)) continue;
      out.push(finding("PL08", {
        where: h.title,
        message: `a proposal appears under "${h.title}", which describes the reference: "${t.slice(0, 90)}"`,
        evidence: t.slice(0, 140),
        remediation: `Move it to "Proposed improvements" and open it with ${PROPOSAL_MARKER}. A suggestion in an observations section reads as something the reference already does.`
      }));
      break;
    }
  }

  /* And the mirror: every line in a proposal section carries the marker. */
  for (const h of headings(text)) {
    if (!/proposed improvements/i.test(h.title)) continue;
    const bullets = h.body.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("-") || l.startsWith("*"));
    const unmarked = bullets.filter((b) => !b.includes(PROPOSAL_MARKER));
    for (const b of unmarked.slice(0, 3)) {
      out.push(finding("PL08", {
        where: h.title,
        message: `an unmarked item in the proposals section: "${b.slice(0, 90)}"`,
        evidence: b.slice(0, 140),
        remediation: `Open it with ${PROPOSAL_MARKER}. The marker goes first: a trailing "(proposed)" is read after the sentence has already landed as a statement of fact.`
      }));
    }
  }
  return out;
}

function pl09_briefSeparation(text, targetBrief, contract) {
  if (!targetBrief || !contract.requiresTargetBrief) return [];
  const out = [];
  const values = [targetBrief.product, targetBrief.productType, targetBrief.platform, targetBrief.framework?.name]
    .filter((v) => typeof v === "string" && v.length > 2);

  for (const section of readSections(text).filter((s) => s.kind === SECTION_KIND.REFERENCE)) {
    for (const value of values) {
      if (!new RegExp(`\\b${escapeRe(value)}\\b`, "i").test(section.body)) continue;
      out.push(finding("PL09", {
        where: section.id,
        message: `"${value}" comes from the target brief but appears inside the reference-evidence section \`${section.id}\`.`,
        evidence: value,
        remediation: "Move it into a target-brief section. Reference sections state what was measured on someone else's page; a requirement there reads as a finding."
      }));
      break;
    }
  }
  return out;
}

function pl10_selectors(text) {
  const out = [];
  /* Backticked selectors in an implementation context. A selector shown as
   * evidence of what was found is fine; one offered as a hook to wire to is
   * not, when it will not survive the reference's next deploy. */
  for (const { number, text: line } of proseLines(text)) {
    if (!/\b(selector|target|query|hook|wire|attach)\b/i.test(line)) continue;
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      const candidate = m[1];
      if (!/[.#\[]/.test(candidate) || candidate.length > 120) continue;
      const classification = classifySelector(candidate, { classify: classifyClassName });
      if (classification.class !== SELECTOR_CLASS.GENERATED) continue;
      out.push(finding("PL10", {
        where: `line ${number}`,
        message: `\`${candidate}\` is a build-generated selector offered as an implementation hook.`,
        evidence: classification.reasons?.join("; ") ?? null,
        remediation: prohibitionReason("generated-selector") + " Use a semantic or author-controlled selector, or describe the element by role."
      }));
    }
  }
  return out;
}

function pl11_stackSyntax(text, stack) {
  const out = [];
  for (const hit of findForeignSyntax(text, { stack })) {
    out.push(finding("PL11", {
      where: `line ${hit.line}`,
      message: hit.why,
      evidence: hit.text,
      remediation: isSupportedStack(stack)
        ? `Remove it. This prompt targets \`${stack}\`; ${hit.label} syntax here would be copied by a builder writing for a framework nobody chose.`
        : `Remove it. \`${stack}\` has no adapter, so no stack-specific syntax may be emitted — inventing some implies an adapter exists.`
    }));
  }
  return out;
}

function pl12_brand(text, ir) {
  const out = [];
  const brand = ir?.brand ?? null;
  if (!brand) return out;

  const names = [brand.name, brand.productName].filter((n) => typeof n === "string" && n.length > 2);
  const assets = (brand.assets ?? []).map((a) => a?.src).filter(Boolean);

  for (const { number, text: line } of proseLines(text)) {
    /* A brand name inside an instruction rather than inside the boundary
     * section that explains it must be replaced. */
    if (/replace|do not copy|boundary|must not/i.test(line)) continue;
    for (const name of names) {
      if (!new RegExp(`\\b${escapeRe(name)}\\b`).test(line)) continue;
      out.push(finding("PL12", {
        where: `line ${number}`,
        message: `the reference's brand name "${name}" appears in an instruction: "${line.trim().slice(0, 90)}"`,
        evidence: line.trim().slice(0, 140),
        remediation: prohibitionReason("brand-asset") + " Refer to it by role, or state the replacement requirement."
      }));
      break;
    }
    for (const asset of assets) {
      if (!line.includes(asset)) continue;
      out.push(finding("PL12", {
        where: `line ${number}`,
        message: `a reference brand asset (\`${asset}\`) is referenced directly.`,
        evidence: line.trim().slice(0, 140),
        remediation: "Name the slot the asset occupies and its measured dimensions. The asset itself belongs to the reference."
      }));
      break;
    }
  }
  return out;
}

function pl13_pl14_pl15_required(text, contract) {
  const out = [];
  const titles = headings(text).map((h) => h.title.toLowerCase());
  const has = (re) => titles.some((t) => re.test(t));

  const needsAcceptance = contract.sections.some((s) => s.id === "acceptance");
  if (needsAcceptance && !has(/acceptance criteria/)) {
    out.push(finding("PL13", {
      where: "Acceptance criteria",
      message: "the prompt states no acceptance criteria.",
      remediation: "Add them. Without criteria there is nothing to check a build against, and the prompt cannot be wrong — which is not the same as being right."
    }));
  }

  const needsLimitations = contract.sections.some((s) => /limitation/i.test(s.title));
  if (needsLimitations && !has(/limitation/)) {
    out.push(finding("PL14", {
      where: "Limitations",
      message: "the prompt states no limitations.",
      remediation: "Add them. A prompt with the caveats removed reads as more certain than the evidence behind it, which is the failure this whole system exists to prevent."
    }));
  }

  const needsForbidden = contract.sections.some((s) => s.id === "forbidden-assumptions");
  if (needsForbidden && !has(/forbidden assumption/)) {
    out.push(finding("PL15", {
      where: "Forbidden assumptions",
      message: "the prompt does not state what must not be assumed.",
      remediation: "Add the section. Where the evidence is silent, an agent will fill the gap plausibly unless told not to."
    }));
  }
  return out;
}

function pl16_pl17_pl18_identity(filename, content, { mode, sourceKind, current, contract }) {
  const out = [];
  const metadata = readMetadata(filename, content);
  if (!metadata || metadata.$malformed) return out;

  const effectiveMode = mode ?? metadata.mode;
  if (effectiveMode && !contract.modes.includes(effectiveMode)) {
    out.push(finding("PL17", {
      where: filename,
      message: `${contract.artifactKind} was produced under mode \`${effectiveMode}\`, which does not produce it.`,
      remediation: `It is produced by: ${contract.modes.join(", ")}. A prompt from the wrong mode makes a claim the mode's requirements were never checked against.`
    }));
  }

  const effectiveSource = sourceKind ?? metadata.sourceKind;
  if (effectiveSource && (contract.forbiddenSourceKinds ?? []).includes(effectiveSource)) {
    out.push(finding("PL18", {
      where: filename,
      message: `${contract.artifactKind} cannot be produced from ${effectiveSource} evidence.`,
      remediation: effectiveSource === "screenshots"
        ? "Capture the reference as a live page. Screenshot evidence is estimated by construction and cannot support build instructions."
        : `Use one of the supported source kinds.`
    }));
  }

  if (current && Object.keys(current).length) {
    const fresh = checkFreshness(metadata, current);
    if (fresh.verdict === FRESHNESS.STALE || fresh.verdict === FRESHNESS.INCOMPATIBLE) {
      out.push(finding("PL16", {
        where: filename,
        message: fresh.summary,
        evidence: fresh.reasons.map((r) => `${r.field}: ${r.was} → ${r.now}`).join("; "),
        remediation: fresh.recommendation ?? "Regenerate it and read what changed before acting on it."
      }));
    }
  }
  return out;
}

function pl19_triad(text, contract) {
  if (!contract.requiresTriad) return [];
  const out = [];
  /* A mapping is triad-complete when all three legs appear in its block. The
   * check runs per-block, because a document containing all three labels
   * somewhere proves nothing about any individual mapping. */
  const blocks = String(text ?? "").split(/\n(?=\*\*[^*\n]+\*\*\s*$)/m);
  for (const block of blocks) {
    if (!/Adaptation instruction:/i.test(block)) continue;
    const missing = contract.triad
      .filter((leg) => !new RegExp(`${escapeRe(leg.label)}\\s*:`, "i").test(block))
      .map((leg) => leg.label);
    if (!missing.length) continue;
    const label = /\*\*([^*\n]+)\*\*/.exec(block)?.[1] ?? "a mapping";
    out.push(finding("PL19", {
      where: label,
      message: `the mapping "${label}" is missing ${missing.join(" and ")}.`,
      evidence: block.trim().slice(0, 140),
      remediation: `Every mapping states all three legs, including when the brief says nothing — "none stated" is information. A mapping missing a leg is a claim with no stated origin.`
    }));
  }
  return out;
}

function pl20_unknownDefaults(text, ir) {
  const out = [];
  if (!ir) return out;
  const unknowns = (ir.unknowns ?? []).map((u) => u.claim ?? u).filter((c) => typeof c === "string");

  for (const claimPath of unknowns) {
    const leaf = claimPath.split(".").pop();
    if (!leaf || leaf.length < 3) continue;
    for (const { number, text: line } of proseLines(text)) {
      if (!new RegExp(`\\b${escapeRe(leaf)}\\b`, "i").test(line)) continue;
      /* A value being stated for something the analysis recorded as unknown.
       *
       * Naming the claim is not stating a value for it: `states.hover` in
       * backticks is the path, and a line that only names the path is
       * reporting the gap rather than filling it. So the backticked content
       * must be something OTHER than the claim path. */
      const ticks = [...line.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
      /* A backtick alone is not a value. `states.hover` is the claim path,
       * `:hover` is a CSS selector and `hover:` is a Tailwind variant — all
       * three NAME the thing that is unknown rather than supplying it. Only
       * something value-shaped counts as filling the gap. */
      const statesAValue = ticks.some((t) => VALUE_SHAPE.test(t.trim()));
      if (!statesAValue) continue;
      if (/not determined|unknown|decide this yourself|never induced|not captured|only\b/i.test(line)) continue;
      out.push(finding("PL20", {
        where: `line ${number}`,
        message: `\`${claimPath}\` is unknown in the analysis, but the prompt states a value: "${line.trim().slice(0, 90)}"`,
        evidence: line.trim().slice(0, 140),
        remediation: prohibitionReason("unknown-as-default") + " Render it as not determined and say the decision is the reader's."
      }));
      break;
    }
  }
  return out;
}

function pl21_notesClaims(text, contract) {
  if (!contract.forbidsReferenceClaims) return [];
  const out = [];
  /* `the reference is` also matches the file's own disclaimer ("everything
   * measured about the reference is in the prompt"), so the grammar alone is
   * not enough. An assertion has to carry a VALUE: a sentence with no literal
   * in it is talking ABOUT the reference rather than making a claim about it. */
  const asserting = /\bthe reference (?:uses|has|carries|shows|applies|sets)\b|\bwas measured (?:at|as)\b|\bmeasured at\b/i;
  for (const { number, text: line } of proseLines(text)) {
    if (!asserting.test(line)) continue;
    /* A blockquote is commentary about the document, not an instruction in it. */
    if (line.trim().startsWith(">")) continue;
    if (!/`[^`\n]+`|\b\d+(px|ms|rem|em|%)\b/.test(line)) continue;
    out.push(finding("PL21", {
      where: `line ${number}`,
      message: `implementation notes assert something about the reference: "${line.trim().slice(0, 90)}"`,
      evidence: line.trim().slice(0, 140),
      remediation: "Move it to the prompt. These notes describe how the stack expresses values measured elsewhere; a finding here is a finding in a file nothing validates as evidence."
    }));
  }
  return out;
}

/**
 * PL22 — the IR measured media, and the prompt does not mention it.
 *
 * A warning rather than a blocker, and the asymmetry is deliberate. A prompt
 * missing a measured value is worse than one that never had it, because the
 * reader has no way to tell the difference — but assets are not a safety
 * property, and blocking a prompt over a table would be out of proportion.
 *
 * Silent regression is the failure this exists to catch. The whole reason this
 * rule was written is that the extractor collected media geometry for months
 * while the derivation dropped it and every prompt rendered prohibitions with
 * no facts, and nothing anywhere noticed.
 *
 * It cannot fire on a capture that genuinely had no media: a measured count of
 * zero is not a missing fact, it is a finding, and the section says so.
 */
/**
 * The assets section's body, or null when it cannot be located.
 *
 * Matched on the section TITLE rather than its number, because the numbering has
 * shifted between phases and a rule keyed to "## 12." would silently stop
 * finding anything the next time a section is inserted above it.
 */
function assetsSection(text) {
  const start = text.search(/^##\s*[\d.]*\s*Assets and brand boundaries/mi);
  if (start < 0) return null;
  const rest = text.slice(start);
  const nextHeading = rest.slice(1).search(/^##\s/m);
  return nextHeading < 0 ? rest : rest.slice(0, nextHeading + 1);
}

function pl22_assets(text, ir, contract) {
  if (!ir || contract?.artifactKind !== "rebuild-prompt") return [];

  const items = ir.assets?.items ?? [];
  if (!items.length) return [];

  /* Scoped to the assets section, and keyed on DISTINCTIVE values.
   *
   * Both halves of that were learned by getting it wrong. Searching the whole
   * document finds `object-fit` values like `fill` and `cover`, and tag names
   * like `picture` and `img`, in ordinary prose elsewhere — the first version of
   * this rule could not fire at all, because "Photography, illustration, or icon
   * sets" contains none of those but "use neutral placeholder blocks" and the
   * technical section between them do.
   *
   * Geometry is what makes an assets section specific, and a number like
   * `834.3` appears nowhere by accident. */
  const section = assetsSection(text);
  const haystack = section ?? text;

  const numeric = [];
  const other = [];
  for (const item of items) {
    for (const leaf of ["renderedWidth", "renderedHeight", "intrinsicWidth", "intrinsicHeight", "aspectRatio"]) {
      const claim = item[leaf];
      if (claim?.value === null || claim?.value === undefined) continue;
      const v = String(claim.value);
      (/\d/.test(v) ? numeric : other).push(v);
    }
  }

  /* Prefer the distinctive set; fall back only if there is genuinely nothing
   * numeric to look for. */
  const values = numeric.length ? numeric : other;
  if (!values.length) return [];
  if (values.some((v) => haystack.includes(v))) return [];

  return [finding("PL22", {
    where: "assets section",
    message: `the IR carries ${items.length} measured media element(s) and none of their values appears in the prompt`,
    evidence: values.slice(0, 4).join(", "),
    remediation: "Render the measured geometry — box size, aspect ratio, object-fit — before the brand prohibitions. A prohibition with no facts beside it tells a builder what not to copy and nothing about what to build."
  })];
}

/**
 * The motion section's body, or null.
 *
 * Same title-matching as `assetsSection`, for the same reason: numbering has
 * shifted between phases, and a rule keyed to "## 10." would silently stop
 * matching the next time a section is inserted above it.
 */
function motionSection(text) {
  const start = text.search(/^##\s*[\d.]*\s*Motion\s*$/mi);
  if (start < 0) return null;
  const rest = text.slice(start);
  const next = rest.slice(1).search(/^##\s(?!#)/m);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

/**
 * PL23 — the IR carries declared motion and the prompt does not mention it.
 *
 * The assets counterpart of this rule exists because a section rendered its
 * title and nothing else for months while the data sat in the capture. Motion
 * is the same shape of risk and gets the same check.
 */
function pl23_motion(text, ir, contract) {
  if (!ir || contract?.artifactKind !== "rebuild-prompt") return [];

  const declared = ir.motion?.declared ?? [];
  if (!declared.length) return [];

  const section = motionSection(text) ?? text;

  /* Distinctive values only — durations, delays, easings and animation names.
   * A bare word like `ease` or `none` appears throughout ordinary prose, and
   * PL22 shipped broken for exactly that reason. */
  const values = [];
  for (const d of declared) {
    for (const leaf of [
      "animationName", "animationDuration", "animationDelay", "animationTimingFunction",
      "transitionDuration", "transitionDelay", "backdropFilter", "transform"
    ]) {
      const claim = d[leaf];
      if (claim?.value === null || claim?.value === undefined) continue;
      const v = String(claim.value);
      /* Something specific enough not to collide with prose: a number, a
       * function call, or a hyphenated identifier. */
      if (/\d/.test(v) || /\(/.test(v) || /-/.test(v)) values.push(v);
    }
  }
  if (!values.length) return [];
  if (values.some((v) => section.includes(v))) return [];

  return [finding("PL23", {
    where: "motion section",
    message: `the IR carries declared motion on ${declared.length} element(s) and none of it appears in the prompt`,
    evidence: values.slice(0, 4).join(", "),
    remediation: "Render the declared animation and transition longhands. A motion section reading `NOT DETERMINED` over a capture that measured motion is worse than one that never had it — the reader cannot tell the difference."
  })];
}

/**
 * PL24 — the prompt asserts what triggers motion.
 *
 * Nothing upstream can supply a trigger: it is not recorded in evidence, not
 * derived into the IR, and not rendered. So a trigger appearing in a prompt was
 * written rather than measured, and that is the one thing this milestone's
 * boundary forbids.
 *
 * Scoped to the motion section, and phrased to catch an ASSERTION rather than a
 * mention. The section's own boundary note explains that scroll-linkage is
 * unknown, and says "on scroll" while doing it — a rule that fired on the word
 * would fire on the disclaimer.
 */
function pl24_motionTrigger(text, ir, contract) {
  if (contract?.artifactKind !== "rebuild-prompt") return [];
  const section = motionSection(text);
  if (!section) return [];

  const ASSERTIONS = [
    [/\b(?:animates?|fades?|slides?|reveals?|appears?|triggers?)\s+(?:in\s+|out\s+)?(?:on|when)\s+scroll/i, "asserts a scroll trigger"],
    [/\bscroll-(?:linked|driven|triggered)\b/i, "asserts scroll-linked motion"],
    [/\bon\s+(?:scroll\s+into\s+view|entering\s+the\s+viewport)\b/i, "asserts a viewport-entry trigger"],
    [/\bstagger(?:ed|ing)?\s+by\b|\bwith\s+a\s+\d+\s*ms\s+stagger\b/i, "asserts a stagger"],
    [/\bintersection\s*observer\b/i, "names a scroll mechanism the capture cannot see"]
  ];

  const out = [];
  for (const line of section.split("\n")) {
    /* The boundary note is commentary ABOUT what is unknown. It is written as a
     * bullet under a "does not tell you" heading and says so; skipping lines
     * that carry an explicit negation keeps the rule off its own disclaimer. */
    if (/\bnot\b|\bcannot\b|\bnothing\b|\bunknown\b|\bmay run\b|\bwould\b/i.test(line)) continue;
    for (const [re, why] of ASSERTIONS) {
      if (!re.test(line)) continue;
      out.push(finding("PL24", {
        where: "motion section",
        message: `${why}: "${line.trim().slice(0, 90)}"`,
        evidence: line.trim().slice(0, 140),
        remediation: "A capture reads declared style; it cannot observe what starts an animation. State the declaration and leave the trigger to whoever builds it."
      }));
      break;
    }
  }
  return out;
}

/**
 * PL25 — an observed-runtime claim reached the prompt without a control.
 *
 * The control is what separates "opacity changed after scrolling" from
 * "scrolling caused it". A runtime observation with no control is still a fact
 * worth stating — but it can never license a causal reading, and a prompt that
 * carries one without the control is a prompt whose reader cannot tell.
 */
function pl25_runtimeWithoutControl(text, ir, contract) {
  if (!ir || contract?.artifactKind !== "rebuild-prompt") return [];
  /* Reads the IR shape M2c actually builds. The first version of this rule was
   * written against a proposed shape (`observed.observations`) that the
   * integration did not adopt, so it could never have fired — a rule matching a
   * field that does not exist is a rule that passes on every input. */
  const observed = ir.motion?.observed?.runtime ?? [];
  if (!observed.length) return [];

  const orphans = observed.filter(
    (o) => (o.changedProperties?.length ?? 0) > 0 && !o.controlObservationId
  );
  if (!orphans.length) return [];

  return [finding("PL25", {
    where: "motion section",
    message: `${orphans.length} runtime motion observation(s) carry no control, so nothing licenses reading them as caused by the action`,
    evidence: orphans.slice(0, 3).map((o) => `${o.target ?? "?"} (${o.action ?? "?"})`).join(", "),
    remediation: "Take a control observation over comparable elapsed time with the action withheld, or state the change without attributing it."
  })];
}

/**
 * PL26 — the prompt states a trigger the evidence classified as unverified.
 *
 * The projector does not render unverified triggers, so this catches a prompt
 * that acquired one some other way. Same reasoning as PL24: the structural
 * defence is that the value is never rendered, and this is the second line.
 */
function pl26_unverifiedTriggerStated(text, ir, contract) {
  if (!ir || contract?.artifactKind !== "rebuild-prompt") return [];
  const unverified = ir.motion?.observed?.triggers?.unverified ?? [];
  if (!unverified.length) return [];

  const section = motionSection(text);
  if (!section) return [];

  const out = [];
  for (const o of unverified) {
    const sel = o.target;
    if (!sel) continue;
    for (const line of section.split("\n")) {
      if (!line.includes(sel)) continue;
      /* A line naming the selector AND asserting causation. A line that merely
       * lists the selector in a table is the normal, correct rendering. */
      if (!/\b(?:caused?|because|triggers?|on scroll|when scrolled)\b/i.test(line)) continue;
      if (/\bnot\b|\bunverified\b|\bcannot\b|\bunknown\b/i.test(line)) continue;
      out.push(finding("PL26", {
        where: "motion section",
        message: `a trigger is stated for ${sel}, whose classification is unverified (${o.controlResult})`,
        evidence: line.trim().slice(0, 140),
        remediation: o.reason ?? "State the observed change without attributing a cause."
      }));
      break;
    }
  }
  return out;
}

/* -------------------------------------------------------------- helpers */

const CRITICAL_PATHS = [
  "layout.container", "layout.grid", "layout.breakpoints",
  "typography.body", "tokens.color", "scales.spacingBaseUnit"
];
const isCritical = (path) => CRITICAL_PATHS.some((c) => String(path).includes(c));

/** What a stated VALUE looks like, as opposed to a name for one. */
const VALUE_SHAPE = /^-?\d+(\.\d+)?(px|rem|em|%|ms|s|fr|vh|vw)?$|^#[0-9a-fA-F]{3,8}$|^(rgba?|hsla?|oklch)\(|^\d+(\.\d+)?\s*\/\s*\d/;

function fmtValue(value, unit) {
  if (value == null || Array.isArray(value)) return null;
  if (typeof value === "number") return unit === "px" ? `${value}px` : String(value);
  return String(value);
}

function collectClaims(node, path = "", out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectClaims(v, `${path}[${i}]`, out));
    return out;
  }
  if ("status" in node && ("value" in node || "candidates" in node)) {
    out.push({ ...node, path: path || "$" });
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === "meta" || k === "safety") continue;
    collectClaims(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}

/* ---------------------------------------------------------- the entry point */

/**
 * Lints one prompt.
 *
 * Returns findings plus `blocked` — whether any finding is severe enough that
 * the prompt should not be written. The caller does not compute that; a caller
 * deciding severity for itself is how a blocking rule becomes advisory.
 */
export function lintPrompt({
  filename,
  content,
  artifactKind = null,
  mode = null,
  sourceKind = null,
  stack = "next-tailwind",
  ir = null,
  targetBrief = null,
  current = {}
} = {}) {
  const contract = contractFor(artifactKind ?? filename);
  if (!contract) {
    return {
      linted: false,
      findings: [],
      blocked: false,
      summary: `${filename} is not governed by a prompt contract.`,
      rulesRun: []
    };
  }

  const text = String(content ?? "");
  const findings = [
    ...pl01_sections(text, contract),
    ...pl02_metadata(filename, content),
    ...pl03_evidenceRefs(text, contract),
    ...pl04_pl06_pl07_values(text, ir, contract),
    ...pl05_vague(text),
    ...pl08_proposals(text, contract),
    ...pl09_briefSeparation(text, targetBrief, contract),
    ...pl10_selectors(text),
    ...pl11_stackSyntax(text, stack),
    ...pl12_brand(text, ir),
    ...pl13_pl14_pl15_required(text, contract),
    ...pl16_pl17_pl18_identity(filename, content, { mode, sourceKind, current, contract }),
    ...pl19_triad(text, contract),
    ...pl20_unknownDefaults(text, ir),
    ...pl21_notesClaims(text, contract),
    ...pl22_assets(text, ir, contract),
    ...pl23_motion(text, ir, contract),
    ...pl24_motionTrigger(text, ir, contract),
    ...pl25_runtimeWithoutControl(text, ir, contract),
    ...pl26_unverifiedTriggerStated(text, ir, contract)
  ];

  const blocking = findings.filter((f) => f.blocks);
  return {
    linted: true,
    artifactKind: contract.artifactKind,
    findings,
    blocking,
    blocked: blocking.length > 0,
    counts: {
      blocking: blocking.length,
      warning: findings.filter((f) => f.severity === SEVERITY.WARNING).length,
      advisory: findings.filter((f) => f.severity === SEVERITY.ADVISORY).length
    },
    rulesRun: LINT_RULES.map((r) => r.id),
    summary: blocking.length
      ? `${filename} is blocked by ${blocking.length} finding(s): ${[...new Set(blocking.map((f) => f.rule))].join(", ")}.`
      : findings.length
        ? `${filename} passes with ${findings.length} non-blocking finding(s).`
        : `${filename} passes with no findings.`
  };
}

/**
 * Renders a lint report.
 *
 * Blocking findings first, and separated by a heading rather than only by a
 * severity column — a reader scanning twenty rows should not have to compare a
 * column to learn which two stop the run.
 */
export function renderLintReport(result, { filename = null } = {}) {
  if (!result.linted) return `${filename ?? "artifact"} is not a prompt; nothing to lint.`;
  const lines = [];
  lines.push(`# Prompt lint — ${filename ?? result.artifactKind}`);
  lines.push("");
  lines.push(result.summary);
  lines.push("");

  const groups = [
    ["Blocking — generation is refused", result.findings.filter((f) => f.blocks)],
    ["Warnings — the prompt is usable but weaker than the evidence allows", result.findings.filter((f) => !f.blocks && f.severity === SEVERITY.WARNING)],
    ["Advisory", result.findings.filter((f) => f.severity === SEVERITY.ADVISORY)]
  ];

  for (const [title, group] of groups) {
    if (!group.length) continue;
    lines.push(`## ${title}`);
    lines.push("");
    lines.push("| Rule | Where | Finding | What to do |");
    lines.push("| --- | --- | --- | --- |");
    for (const f of group) {
      lines.push(`| \`${f.rule}\` | ${f.where} | ${f.message.replace(/\|/g, "\\|")} | ${f.remediation.replace(/\|/g, "\\|")} |`);
    }
    lines.push("");
  }

  if (!result.findings.length) {
    lines.push("No findings. Every rule ran; see PROMPT-LINT.md for what each one checks.");
    lines.push("");
  }
  return lines.join("\n");
}

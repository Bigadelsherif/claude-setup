/**
 * Validation gates V1–V7.
 *
 * These exist so the project's central rule — no claim without evidence — is
 * mechanically enforced rather than merely instructed. An instruction to be
 * precise is a suggestion; a gate that refuses to ship an unannotated claim is
 * a guarantee.
 */

import { readFileSync } from "node:fs";
import { validate } from "./schema.mjs";
import { hashIR, readStamp } from "../ir/hash.mjs";
import { STATUS } from "../evidence/status.mjs";

export const LEVEL = { ERROR: "error", WARN: "warn" };

import { contractFor, requiredSectionTitles } from "../prompts/contract.mjs";

/** Escapes a section title for use inside a heading pattern. */
const escapeForRegex = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Advisory only. The real gate is V3; this is a nudge on top of it. */
const VAGUE_ADJECTIVES = [
  "modern", "clean", "generous", "subtle", "soft", "sleek", "elegant",
  "minimal", "spacious", "rounded", "smooth", "polished", "premium",
  "large", "bold", "crisp", "airy", "refined"
];

const finding = (rule, level, message, where = null) => ({ rule, level, message, where });

/* ------------------------------------------------------------------ V1 */

export function v1_schemas({ schemas, evidence, ir, corrections = [] }) {
  const out = [];

  if (schemas.evidence && evidence) {
    const r = validate(schemas.evidence, evidence);
    for (const e of r.errors) out.push(finding("V1", LEVEL.ERROR, `evidence-map: ${e.path} ${e.message}`));
  }
  if (schemas.ir && ir) {
    const r = validate(schemas.ir, ir);
    for (const e of r.errors) out.push(finding("V1", LEVEL.ERROR, `ir: ${e.path} ${e.message}`));
  }
  if (schemas.correction) {
    for (const correction of corrections) {
      const r = validate(schemas.correction, correction);
      for (const e of r.errors) {
        out.push(finding("V1", LEVEL.ERROR, `correction ${correction.id}: ${e.path} ${e.message}`));
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ V2 */

export function v2_evidenceIntegrity({ evidence, ir }) {
  const out = [];
  if (!evidence || !ir) return out;

  const live = new Map();
  for (const record of evidence.records) {
    if (!record.supersededBy) live.set(record.id, record);
  }
  const known = new Set(evidence.records.map((r) => r.id));

  const visit = (node, path) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, `${path}[${i}]`));
      return;
    }
    if (Array.isArray(node.evidence) && Object.hasOwn(node, "status")) {
      for (const id of node.evidence) {
        if (!known.has(id)) {
          out.push(finding("V2", LEVEL.ERROR, `claim references unknown evidence ${id}`, path));
        } else if (!live.has(id)) {
          out.push(finding("V2", LEVEL.ERROR, `claim references superseded evidence ${id}`, path));
        }
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "evidence") continue;
      visit(value, `${path}.${key}`);
    }
  };

  visit(ir, "ir");
  return out;
}

/* ------------------------------------------------------------------ V3 */

/**
 * Annotations that satisfy V3.
 *
 * `contested` is included because it is a stronger statement than any single
 * status, not a weaker one: it says two sources disagree and names both. A
 * contested line that also carried one source's status would be misleading.
 */
const STATUS_WORDS = [
  "measured", "observed", "inferred", "estimated", "unknown",
  "contested", "user-corrected"
];

/**
 * Every claim line in the spec must carry a value AND a status; measured and
 * observed claims must additionally resolve to evidence.
 * A "claim line" is a list item containing a bolded value.
 */
export function v3_claimAnnotation({ specText }) {
  const out = [];
  if (!specText) return out;

  const lines = specText.split("\n");
  let inFence = false;

  lines.forEach((line, i) => {
    if (line.trim().startsWith("```")) inFence = !inFence;
    if (inFence) return;

    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) return;
    if (!trimmed.includes("**")) return;

    const where = `design-spec.md:${i + 1}`;

    // The annotation normally follows the marker ("**12px** — measured"), but a
    // contested claim puts it IN the bolded slot ("**contested** — a vs b"),
    // because there is no single value to bold.
    const bolded = trimmed.match(/\*\*([^*]+)\*\*/)?.[1]?.trim();
    const status =
      STATUS_WORDS.find((s) => trimmed.includes(`— ${s}`) || trimmed.includes(`— ${s} `)) ??
      (STATUS_WORDS.includes(bolded) ? bolded : null);

    if (!status) {
      out.push(finding("V3", LEVEL.ERROR, `claim line carries a value but no status: "${trimmed.slice(0, 90)}"`, where));
      return;
    }

    if ((status === "measured" || status === "observed" || status === "inferred") && !/\[ev_\d+/.test(trimmed)) {
      out.push(finding("V3", LEVEL.ERROR, `"${status}" claim carries no evidence reference: "${trimmed.slice(0, 90)}"`, where));
    }
  });

  return out;
}

/* ------------------------------------------------------------------ V4 */

/**
 * Estimated and unknown values must never render as exact measurements, and
 * must never enter the token file. This is the rule that stops a screenshot
 * guess from being read as a measurement three documents downstream.
 */
export function v4_statusHonesty({ specText, tokens, ir }) {
  const out = [];

  if (specText) {
    const lines = specText.split("\n");
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (!trimmed.includes("— unknown")) return;
      // An unknown claim must not also assert a bolded numeric value.
      const bold = trimmed.match(/\*\*([^*]+)\*\*/);
      if (bold && /\d/.test(bold[1]) && !/not determined/i.test(bold[1])) {
        out.push(finding("V4", LEVEL.ERROR,
          `claim marked unknown but renders a numeric value: "${trimmed.slice(0, 90)}"`,
          `design-spec.md:${i + 1}`));
      }
    });

    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (!trimmed.includes("— estimated")) return;
      if (!/approximately/i.test(trimmed)) {
        out.push(finding("V4", LEVEL.ERROR,
          `estimated claim rendered without hedging: "${trimmed.slice(0, 90)}"`,
          `design-spec.md:${i + 1}`));
      }
    });
  }

  if (tokens) {
    const walk = (node, path) => {
      if (!node || typeof node !== "object") return;
      if (node.$value !== undefined) {
        const status = node.$extensions?.["helmy.dev"]?.status;
        if (status === STATUS.ESTIMATED || status === STATUS.UNKNOWN) {
          out.push(finding("V4", LEVEL.ERROR, `token "${path}" has status "${status}" and must not be emitted`, "extracted-tokens.json"));
        }
        return;
      }
      for (const [key, value] of Object.entries(node)) {
        if (key.startsWith("$")) continue;
        walk(value, path ? `${path}.${key}` : key);
      }
    };
    walk(tokens, "");
  }

  if (ir) {
    for (const unknown of ir.unknowns ?? []) {
      if (!unknown.reason || !unknown.reason.trim()) {
        out.push(finding("V4", LEVEL.ERROR, `unknown "${unknown.claim}" recorded without a reason`, "ir.json"));
      }
    }
  }

  return out;
}

/* ------------------------------------------------------------------ V5 */

export function v5_vagueLanguage({ specText, promptText }) {
  const out = [];
  const check = (text, label) => {
    if (!text) return;
    let inFence = false;
    text.split("\n").forEach((line, i) => {
      if (line.trim().startsWith("```")) inFence = !inFence;
      if (inFence) return;
      for (const sentence of line.split(/(?<=[.!?])\s+/)) {
        const hit = VAGUE_ADJECTIVES.find((adj) => new RegExp(`\\b${adj}\\b`, "i").test(sentence));
        if (!hit) continue;
        const supported = /\d/.test(sentence) || /\[ev_\d+/.test(sentence) || /`[^`]*`/.test(sentence);
        if (!supported) {
          out.push(finding("V5", LEVEL.WARN,
            `unsupported adjective "${hit}" with no measurement nearby: "${sentence.trim().slice(0, 90)}"`,
            `${label}:${i + 1}`));
        }
      }
    });
  };
  check(specText, "design-spec.md");
  check(promptText, "rebuild-prompt.md");
  return out;
}

/* ------------------------------------------------------------------ V6 */

/**
 * The stamp check. This is what makes "outputs are derived, never hand-edited"
 * enforceable: an edited or stale artifact no longer matches the IR hash.
 */
export function v6_projectionFreshness({ ir, artifacts }) {
  const out = [];
  if (!ir) return out;
  const expected = hashIR(ir);

  for (const [name, text] of Object.entries(artifacts ?? {})) {
    const stamp = readStamp(text);
    if (!stamp) {
      out.push(finding("V6", LEVEL.ERROR, "artifact carries no IR hash stamp", name));
      continue;
    }
    if (stamp !== expected) {
      out.push(finding("V6", LEVEL.ERROR,
        `artifact stamp ${stamp} does not match current IR hash ${expected} — it is stale or was edited by hand`,
        name));
    }
  }
  return out;
}

/* ------------------------------------------------------------------ V7 */

export function v7_promptExecutability({ promptText, minLiterals = 25 }) {
  const out = [];
  if (!promptText) {
    out.push(finding("V7", LEVEL.ERROR, "rebuild-prompt.md is missing"));
    return out;
  }

  const literals = promptText.match(/\b\d+(\.\d+)?(px|ms|em|rem|%|:1)?\b/g) ?? [];
  if (literals.length < minLiterals) {
    out.push(finding("V7", LEVEL.ERROR,
      `rebuild prompt contains ${literals.length} literal values, below the minimum of ${minLiterals}`,
      "rebuild-prompt.md"));
  }
  /* The section list comes from the prompt contract rather than from two names
   * hardcoded here. Two places describing the same required structure is how
   * they drift — and this pair had already drifted: V7 still demanded
   * "Non-goals" after the contract split that section into "Assets and brand
   * boundaries" and "Forbidden assumptions". */
  for (const section of requiredSectionTitles(contractFor("rebuild-prompt"))) {
    const heading = new RegExp(`^#{2,}.*${escapeForRegex(section)}`, "im");
    if (!heading.test(promptText)) {
      out.push(finding("V7", LEVEL.ERROR,
        `rebuild prompt has no "${section}" section`, "rebuild-prompt.md"));
    }
  }
  return out;
}

/* ------------------------------------------------------------- run them all */

/* ------------------------------------------------------------------ V8 */

/**
 * The gate's own integrity check.
 *
 * A blocked run must not leave a rebuild prompt on disk, and a safe run must
 * actually produce one. This catches the failure where a workspace flips from
 * safe to unsafe and the old prompt survives — the most dangerous stale file
 * the system can leave behind.
 */
export function v8_safetyGate({ ir, artifacts = {} }) {
  const out = [];
  if (!ir) return out;

  const safety = ir.safety;
  if (!safety) {
    out.push(finding("V8", LEVEL.ERROR, "IR carries no safety verdict; the gate did not run", "ir.json"));
    return out;
  }

  const hasBlocked = Object.hasOwn(artifacts, "output/blocked-prompt.md");

  // Which prompt this mode owes depends on the mode; `analyze` owes none.
  const required = ir.modeEvaluation?.requiredArtifacts ?? ["output/rebuild-prompt.md"];
  const promptArtifacts = required.filter((a) => /prompt\.md$/.test(a));
  const hasPrompt = promptArtifacts.some((a) => Object.hasOwn(artifacts, a));

  // A blocked run must leave NO implementation prompt of any kind behind.
  if (!safety.promptGenerationAllowed) {
    for (const stale of ["output/rebuild-prompt.md", "output/adaptation-prompt.md", "output/improvement-prompt.md", "output/fidelity-checklist.md"]) {
      if (Object.hasOwn(artifacts, stale)) {
        out.push(finding("V8", LEVEL.ERROR,
          `safety status is "${safety.status}" but ${stale} exists — a blocked run must never leave an implementation artifact on disk`,
          stale));
      }
    }
  }

  if (!safety.promptGenerationAllowed && !hasBlocked) {
    out.push(finding("V8", LEVEL.ERROR,
      `safety status is "${safety.status}" but no blocked-prompt.md explains why`,
      "output/"));
  }
  // Whether a prompt is expected depends on the requested mode: `analyze`
  // explains a reference and must not emit build instructions, so its absence
  // is correct rather than a failure.
  if (safety.promptGenerationAllowed && promptArtifacts.length && !hasPrompt && Object.keys(artifacts).length) {
    out.push(finding("V8", LEVEL.ERROR,
      `safety status is "${safety.status}" and mode "${ir.modeEvaluation?.requestedMode}" requires ${promptArtifacts.join(", ")}, but none was produced`,
      "output/"));
  }
  if (safety.promptGenerationAllowed && !promptArtifacts.length) {
    for (const unexpected of ["output/rebuild-prompt.md", "output/adaptation-prompt.md", "output/improvement-prompt.md"]) {
      if (Object.hasOwn(artifacts, unexpected)) {
        out.push(finding("V8", LEVEL.ERROR,
          `mode "${ir.modeEvaluation?.requestedMode}" produces no build instructions, but ${unexpected} exists`,
          unexpected));
      }
    }
  }
  if (!safety.promptGenerationAllowed && !safety.blockers?.length) {
    out.push(finding("V8", LEVEL.ERROR,
      "prompt generation is disallowed but no blocker was recorded", "ir.json"));
  }

  return out;
}

/* ------------------------------------------------------------------ V9 */

/**
 * Prompt section integrity.
 *
 * Two prompts carry two sources each, and the danger in both is the same: a
 * statement about one source read as a statement about the other. In the
 * improvement prompt a proposal read as an observation blames the reference for
 * a change it never made; in the adaptation prompt a target requirement read as
 * reference evidence invents a measurement.
 *
 * The check is structural. Sections declare their kind in a machine-readable
 * marker, and this rule verifies the content matches the declaration — rather
 * than trusting that the wording came out right.
 */

/** Phrases that assert something IS true of the reference. */
const REFERENCE_ASSERTING = [
  /\bthe reference (?:uses|has|is|does|carries|shows|applies|sets)\b/i,
  /\bcurrently\b/i,
  /\bas measured\b/i,
  /\bexisting\b/i,
  /\btoday the\b/i,
  /\bthe page (?:uses|has|is|does)\b/i,
  /\bwas measured\b/i,
  /\bobserved (?:value|behaviour|behavior)\b/i
];

const SECTION_OPEN = /<!--\s*helmy:section\s+kind="([^"]+)"\s+id="([^"]+)"\s*-->/;
const SECTION_CLOSE = /<!--\s*\/helmy:section\s*-->/;

/** Splits a marked document into its declared sections. */
export function parseSections(text) {
  if (!text) return [];
  const sections = [];
  let current = null;

  for (const [i, line] of text.split("\n").entries()) {
    const opened = line.match(SECTION_OPEN);
    if (opened) {
      current = { kind: opened[1], id: opened[2], startLine: i + 1, lines: [] };
      continue;
    }
    if (SECTION_CLOSE.test(line)) {
      if (current) sections.push(current);
      current = null;
      continue;
    }
    if (current) current.lines.push({ number: i + 1, text: line });
  }
  return sections;
}

export function v9_promptSectionIntegrity({ improvementText, adaptationText }) {
  const out = [];

  /* ------------------------------------------------ improvement prompt */

  if (improvementText) {
    const sections = parseSections(improvementText);
    const where = "improvement-prompt.md";

    if (!sections.length) {
      out.push(finding("V9", LEVEL.ERROR,
        "improvement prompt carries no section markers, so observation and proposal cannot be told apart",
        where));
    }

    const kinds = new Set(sections.map((s) => s.kind));
    for (const required of ["observation", "critique", "proposal", "unknown"]) {
      if (!kinds.has(required)) {
        out.push(finding("V9", LEVEL.ERROR,
          `improvement prompt has no "${required}" section; all four kinds are required so the reader can tell them apart`,
          where));
      }
    }

    for (const section of sections) {
      if (section.kind !== "proposal") continue;

      // A proposal section must announce itself.
      const hasBanner = section.lines.some((l) => /^>\s/.test(l.text.trim()));
      if (!hasBanner) {
        out.push(finding("V9", LEVEL.ERROR,
          `proposal section "${section.id}" carries no banner stating that its contents do not exist in the reference`,
          `${where}:${section.startLine}`));
      }

      for (const line of section.lines) {
        const trimmed = line.text.trim();
        if (!trimmed || trimmed.startsWith("<!--") || trimmed.startsWith("#")) continue;
        // The banner is the section's own disclaimer about the reference, so it
        // necessarily talks about the reference. Exempting it is not a loophole:
        // it is the one line whose job is to make the distinction.
        if (trimmed.startsWith(">")) continue;

        const asserts = REFERENCE_ASSERTING.find((pattern) => pattern.test(trimmed));
        if (!asserts) continue;

        // Reference-asserting language is allowed inside a proposal only when
        // it is evidence-backed — a restatement of something measured — and not
        // when it is dressing a proposal as a fact.
        const grounded = /\[ev_[0-9]+/.test(trimmed);
        const markedProposal = trimmed.includes("**Proposed:**");

        if (!grounded && !markedProposal) {
          out.push(finding("V9", LEVEL.ERROR,
            `proposal section "${section.id}" asserts something about the reference without evidence or a proposal marker: "${trimmed.slice(0, 90)}"`,
            `${where}:${line.number}`));
        }
      }
    }

    // Observation sections must not smuggle proposals in.
    for (const section of sections) {
      if (section.kind !== "observation") continue;
      for (const line of section.lines) {
        if (line.text.includes("**Proposed:**")) {
          out.push(finding("V9", LEVEL.ERROR,
            `observation section "${section.id}" contains a proposal marker; a proposal must not appear where measurements are reported`,
            `${where}:${line.number}`));
        }
      }
    }
  }

  /* ------------------------------------------------ adaptation prompt */

  if (adaptationText) {
    const sections = parseSections(adaptationText);
    const where = "adaptation-prompt.md";

    if (!sections.length) {
      out.push(finding("V9", LEVEL.ERROR,
        "adaptation prompt carries no section markers, so reference evidence and target requirements cannot be told apart",
        where));
    }

    const kinds = new Set(sections.map((s) => s.kind));
    for (const required of ["reference-evidence", "target-brief"]) {
      if (!kinds.has(required)) {
        out.push(finding("V9", LEVEL.ERROR,
          `adaptation prompt has no "${required}" section; the two sources must each be labelled`,
          where));
      }
    }

    // A reference-evidence section must not carry target requirements, and a
    // target-brief section must not carry measurements.
    for (const section of sections) {
      if (section.kind === "reference-evidence") {
        for (const line of section.lines) {
          if (/\*\*Target requirement:\*\*/.test(line.text)) {
            out.push(finding("V9", LEVEL.ERROR,
              `reference-evidence section "${section.id}" contains a target requirement; the two sources must not be blended`,
              `${where}:${line.number}`));
          }
        }
      }
      if (section.kind === "target-brief") {
        for (const line of section.lines) {
          if (/\[ev_[0-9]+/.test(line.text)) {
            out.push(finding("V9", LEVEL.ERROR,
              `target-brief section "${section.id}" cites reference evidence; a brief states requirements, never measurements`,
              `${where}:${line.number}`));
          }
        }
      }
    }

    // Every triad must be complete: a half-stated triad is the blending this
    // rule exists to prevent.
    const lines = adaptationText.split("\n");
    lines.forEach((line, i) => {
      if (!line.includes("**Reference evidence:**")) return;
      const next = `${lines[i + 1] ?? ""}\n${lines[i + 2] ?? ""}`;
      if (!next.includes("**Target requirement:**") || !next.includes("**Adaptation instruction:**")) {
        out.push(finding("V9", LEVEL.ERROR,
          "an adaptation triad is incomplete: every reference evidence line must be followed by a target requirement and an adaptation instruction",
          `${where}:${i + 1}`));
      }
    });
  }

  return out;
}

export function runAll(context) {
  const promptAllowed = context.ir?.safety?.promptGenerationAllowed !== false;
  // V7 asserts a rebuild prompt is executable. Modes that produce no build
  // instructions have none to assert anything about, and demanding one would
  // make `analyze` and `improve` permanently invalid.
  const promptExpected = (context.ir?.modeEvaluation?.requiredArtifacts ?? ["output/rebuild-prompt.md"])
    .includes("output/rebuild-prompt.md");

  const findings = [
    ...v1_schemas(context),
    ...v2_evidenceIntegrity(context),
    ...v3_claimAnnotation(context),
    ...v4_statusHonesty(context),
    ...v5_vagueLanguage(context),
    ...v6_projectionFreshness(context),
    // A blocked run has no prompt to assert anything about, and demanding one
    // would invert the gate.
    ...(promptAllowed && promptExpected ? v7_promptExecutability(context) : []),
    ...v8_safetyGate(context),
    ...v9_promptSectionIntegrity(context)
  ];

  const errors = findings.filter((f) => f.level === LEVEL.ERROR);
  const warnings = findings.filter((f) => f.level === LEVEL.WARN);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    findings,
    summary: `${errors.length} error(s), ${warnings.length} warning(s)`
  };
}

export function loadJSON(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

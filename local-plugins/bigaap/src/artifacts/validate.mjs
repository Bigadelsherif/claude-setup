/**
 * Artifact validation.
 *
 * The existing gates V1–V8 check the pipeline's own output as it is produced.
 * This checks an artifact as a FILE — one that may have been copied, edited,
 * inherited from an older run, or handed over by someone else. It assumes
 * nothing about where the file came from, which is the only useful assumption
 * once a file can leave the directory that explained it.
 *
 * Every finding carries a remedy. A validator that reports "invalid metadata"
 * and stops has told the reader that something is wrong and left them to guess
 * what to do, which is barely better than silence.
 *
 * The checks fall into four groups:
 *
 *   1. **Identity** — is this a registered artifact, and was this mode and this
 *      kind of evidence allowed to produce it?
 *   2. **Integrity** — is the metadata present, well-formed and internally
 *      consistent; is the JSON parseable; is anything undefined?
 *   3. **Freshness** — do its hashes still match what is current?
 *   4. **Honesty** — this is the group that matters. Does an estimate appear as
 *      a measurement? Does a contested value appear as a settled one? Does a
 *      proposal appear as an observation? Does a requirement from the target
 *      brief appear as a fact about the reference? Each of those is a claim the
 *      evidence does not support, wearing the costume of one that is.
 */

import { readMetadata, validateMetadata } from "./metadata.mjs";
import { checkFreshness, FRESHNESS } from "./freshness.mjs";
import { findArtifact, mayProduce, ARTIFACT_STATUS } from "./registry.mjs";
import { findUndefined } from "./serialize.mjs";
import { validate as validateSchema } from "../validate/schema.mjs";

export const ARTIFACT_ERROR = Object.freeze({
  METADATA_MISSING: "metadata-missing",
  METADATA_MALFORMED: "metadata-malformed",
  METADATA_INVALID: "metadata-invalid",
  UNSUPPORTED_KIND: "unsupported-artifact-kind",
  WRONG_MODE: "wrong-mode",
  WRONG_SOURCE_KIND: "wrong-source-kind",
  MALFORMED_JSON: "malformed-json",
  UNDEFINED_VALUE: "undefined-value",
  MISSING_SECTION: "missing-required-section",
  MISSING_EVIDENCE_REF: "missing-evidence-reference",
  CONTESTED_AS_EXACT: "contested-value-emitted-as-exact",
  ESTIMATED_AS_MEASURED: "estimated-value-emitted-as-measured",
  SCREENSHOT_AS_FORENSIC: "screenshot-value-emitted-as-forensic-token",
  PROPOSAL_AS_OBSERVATION: "proposal-emitted-as-reference-observation",
  BRIEF_AS_EVIDENCE: "target-brief-emitted-as-reference-evidence",
  STALE: "stale-artifact",
  INCOMPATIBLE: "incompatible-artifact",
  SCHEMA_INVALID: "schema-invalid"
});

const finding = (code, message, remedy, where = null) => ({ code, message, remedy, where });

/* ---------------------------------------------------- section machinery */

const SECTION_OPEN = /<!--\s*bigaap:section\s+kind="([^"]+)"\s+id="([^"]+)"\s*-->/g;
const SECTION_CLOSE = "<!-- /bigaap:section -->";

/**
 * Splits a document into its labelled sections.
 *
 * The markers already existed for the adaptation prompt, which is what makes
 * the separation checks possible at all: without a machine-readable boundary
 * between "what we measured" and "what you asked for", the two can only be told
 * apart by reading, and by then a prompt has already been handed to someone.
 */
export function readSections(text) {
  const source = String(text ?? "");
  const sections = [];
  SECTION_OPEN.lastIndex = 0;
  let match;
  while ((match = SECTION_OPEN.exec(source)) !== null) {
    const bodyStart = match.index + match[0].length;
    const closeAt = source.indexOf(SECTION_CLOSE, bodyStart);
    sections.push({
      kind: match[1],
      id: match[2],
      body: source.slice(bodyStart, closeAt === -1 ? source.length : closeAt)
    });
  }
  return sections;
}

/* ------------------------------------------------------- honesty checks */

/** Values rendered as exact: backticked literals and bolded measurements. */
const EXACT_RENDERINGS = /`[^`\n]+`|\*\*[0-9][^*\n]*\*\*/g;

/**
 * A contested claim must never render as one number.
 *
 * Showing a single value where two sources disagree is the exact substitution
 * the disagreement machinery exists to prevent, and it is invisible downstream:
 * nothing in a prompt says "by the way, this was contested".
 */
function checkContestedNotExact({ text, ir, def }) {
  const out = [];
  if (!ir || !def?.isImplementationPrompt) return out;

  const contested = collectClaims(ir).filter((c) => c.contested);
  for (const claim of contested) {
    for (const candidate of claim.candidates ?? []) {
      const literal = renderCandidate(candidate.value, claim.unit);
      if (!literal) continue;
      /* Backticked or bolded: the renderings a reader takes as settled. The
       * contested rendering puts both candidates on one line with the word
       * "contested", which does not match either pattern. */
      const asExact = new RegExp(`(\`${escapeRe(literal)}\`|\\*\\*${escapeRe(literal)}\\*\\*)`);
      if (asExact.test(text)) {
        out.push(finding(
          ARTIFACT_ERROR.CONTESTED_AS_EXACT,
          `\`${claim.path}\` is contested (${(claim.candidates ?? []).map((c) => `${c.source}: ${c.value}`).join(" vs ")}) but ${literal} appears as a settled value.`,
          "Render it through claimLine() in src/project/fmt.mjs, which shows every candidate and names the preferred source. A contested claim that reads as exact tells the builder there is nothing to decide.",
          claim.path
        ));
        break;
      }
    }
  }
  return out;
}

/** An estimate must never be rendered the way a measurement is. */
function checkEstimatedNotMeasured({ text, ir }) {
  const out = [];
  if (!ir) return out;

  for (const claim of collectClaims(ir)) {
    if (claim.status !== "estimated" || claim.value == null) continue;
    const literal = renderCandidate(claim.value, claim.unit);
    if (!literal) continue;
    const line = lineContaining(text, literal);
    if (!line) continue;
    /* The rendering is only dishonest if the line does not also carry the
     * status. `16px — estimated` is fine; a bare `16px` is not. */
    if (!/estimated|approximate|about|~/i.test(line)) {
      out.push(finding(
        ARTIFACT_ERROR.ESTIMATED_AS_MEASURED,
        `\`${claim.path}\` is estimated, but ${literal} appears without saying so: "${line.trim().slice(0, 100)}"`,
        "Render it through claimLine(), which appends the status. An estimate that reads as a measurement will be built to the wrong tolerance.",
        claim.path
      ));
    }
  }
  return out;
}

/**
 * Screenshot evidence must not appear in a forensic token file.
 *
 * Enforced on the file as well as at generation, because the file can be copied
 * into a project where nothing knows how it was made. A token file is a set of
 * commitments; screenshots cannot support one.
 */
function checkScreenshotTokens({ filename, payload, metadata, def }) {
  const out = [];
  const isForensicTokenFile = def?.kind === "extracted-tokens";
  if (!isForensicTokenFile) return out;

  if (metadata?.sourceKind === "screenshots") {
    out.push(finding(
      ARTIFACT_ERROR.SCREENSHOT_AS_FORENSIC,
      `${filename} is a forensic token file, but its metadata says the evidence came from screenshots.`,
      "Screenshot values belong in analysis/estimated-tokens.json, which is a different file on purpose. Anything reading a file called extracted-tokens.json will treat its values as exact.",
      filename
    ));
  }

  /* And the values themselves: a token carrying `sc_` provenance is screenshot
   * evidence whatever the metadata claims. */
  const offenders = [];
  walk(payload, (value, path) => {
    if (typeof value === "string" && /^sc_[0-9]{4,}$/.test(value)) offenders.push(path);
    if (value && typeof value === "object" && !Array.isArray(value) &&
        (value.status === "estimated" || value.source === "screenshot")) {
      offenders.push(path);
    }
  });
  for (const path of offenders.slice(0, 10)) {
    out.push(finding(
      ARTIFACT_ERROR.SCREENSHOT_AS_FORENSIC,
      `${filename} carries screenshot-derived evidence at \`${path}\`.`,
      "Move it to estimated-tokens.json. Mixing estimated values into a forensic file makes provenance unreadable for every value in it, not just this one.",
      path
    ));
  }
  return out;
}

/**
 * A proposal must not appear inside a section describing the reference.
 *
 * `improve` is the mode where this matters: it says what is there AND what
 * could be better, and a suggestion that drifts into the observations section
 * becomes a claim that the reference already does it.
 */
function checkProposalSeparation({ text, def }) {
  const out = [];
  if (!(def?.separatedSections ?? []).length) return out;

  const headings = [...String(text).matchAll(/^##+\s+(?:\d+\.\s*)?(.+)$/gm)].map((m) => ({
    title: m[1].trim(),
    at: m.index
  }));
  if (!headings.length) return out;

  const proposalWords = /\b(should|could|recommend|propose|consider|suggest|would improve|instead)\b/i;
  const observationHeadings = /what the reference|current(ly)? does|observation|evidence for current/i;

  for (let i = 0; i < headings.length; i++) {
    if (!observationHeadings.test(headings[i].title)) continue;
    const body = text.slice(headings[i].at, headings[i + 1]?.at ?? text.length);
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("<!--")) continue;
      if (proposalWords.test(trimmed)) {
        out.push(finding(
          ARTIFACT_ERROR.PROPOSAL_AS_OBSERVATION,
          `a proposal appears under "${headings[i].title}", which describes the reference: "${trimmed.slice(0, 100)}"`,
          `Move it under one of: ${def.separatedSections.filter((s) => /propos|critique/i.test(s)).join(", ")}. A suggestion in an observations section reads as something the reference already does.`,
          headings[i].title
        ));
        break;
      }
    }
  }
  return out;
}

/**
 * Target-brief requirements must not appear as reference evidence.
 *
 * The brief describes the product being built. The reference describes someone
 * else's page. An instruction that mixes them without saying which is which
 * produces a build that treats a requirement as a measurement — and the
 * measurement it displaces is the one that was actually checked.
 */
function checkBriefSeparation({ text, targetBrief, def }) {
  const out = [];
  if (!targetBrief || !def?.isImplementationPrompt) return out;

  const sections = readSections(text);
  const referenceSections = sections.filter((s) => s.kind === "reference-evidence");
  if (!referenceSections.length) return out;

  const briefValues = [targetBrief.product, targetBrief.productType, targetBrief.platform, targetBrief.framework?.name]
    .filter((v) => typeof v === "string" && v.length > 2);

  for (const section of referenceSections) {
    for (const value of briefValues) {
      if (new RegExp(`\\b${escapeRe(value)}\\b`, "i").test(section.body)) {
        out.push(finding(
          ARTIFACT_ERROR.BRIEF_AS_EVIDENCE,
          `"${value}" comes from the target brief but appears inside the reference-evidence section \`${section.id}\`.`,
          "Move it into a target-brief section. The reference sections state what was measured on someone else's page; a requirement there reads as a finding.",
          section.id
        ));
        break;
      }
    }
  }
  return out;
}

/** Every cited evidence id must exist. */
function checkEvidenceReferences({ text, evidence, def }) {
  const out = [];
  if (!evidence || !def?.humanReadable) return out;

  const known = new Set((evidence.records ?? []).map((r) => r.id));
  if (!known.size) return out;

  const cited = new Set();
  for (const m of String(text).matchAll(/\b((?:ev|sc)_[0-9]{4,})\b/g)) cited.add(m[1]);

  for (const id of cited) {
    if (!known.has(id)) {
      out.push(finding(
        ARTIFACT_ERROR.MISSING_EVIDENCE_REF,
        `cites evidence \`${id}\`, which is not in the evidence map.`,
        "Regenerate from the current evidence. A citation to a record that does not exist cannot be checked, which makes every other citation in the file worth less.",
        id
      ));
    }
  }
  return out;
}

/* ----------------------------------------------------------- structural */

function checkRequiredSections({ text, def }) {
  const out = [];
  for (const section of def?.requiredSections ?? []) {
    if (!new RegExp(escapeRe(section), "i").test(text)) {
      out.push(finding(
        ARTIFACT_ERROR.MISSING_SECTION,
        `required section "${section}" is missing.`,
        `${def.kind} must carry it. ${def.isImplementationPrompt ? "An implementation prompt without its limitations or acceptance criteria is a set of instructions with the caveats removed." : "The section is part of what makes this artifact readable without the IR."}`,
        section
      ));
    }
  }
  return out;
}

/* -------------------------------------------------------------- helpers */

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function renderCandidate(value, unit) {
  if (value == null) return null;
  if (Array.isArray(value)) return null;
  if (typeof value === "number") return unit === "px" ? `${value}px` : String(value);
  return String(value);
}

function lineContaining(text, literal) {
  for (const line of String(text).split("\n")) {
    if (line.includes(literal)) return line;
  }
  return null;
}

/**
 * Walks an IR gathering anything shaped like a claim.
 *
 * `seen` tracks the ancestors on the current path, not every node visited:
 * an IR legitimately shares objects between claims, and treating a shared
 * reference as a cycle would silently drop real claims. A node that is its own
 * ancestor is the only true cycle, and the depth cap catches a structure that
 * is finite but pathological — either way the validator reports what it found
 * rather than dying on the input it was asked to check.
 */
const MAX_CLAIM_DEPTH = 64;

function collectClaims(ir, node = ir, path = "", out = [], seen = new Set(), depth = 0) {
  if (!node || typeof node !== "object") return out;
  if (seen.has(node)) return out;
  if (depth > MAX_CLAIM_DEPTH) return out;

  const ancestors = new Set(seen);
  ancestors.add(node);

  if (Array.isArray(node)) {
    node.forEach((v, i) => collectClaims(ir, v, `${path}[${i}]`, out, ancestors, depth + 1));
    return out;
  }
  if ("status" in node && ("value" in node || "candidates" in node)) {
    out.push({ ...node, path: path || "$" });
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === "meta" || k === "safety") continue;
    collectClaims(ir, v, path ? `${path}.${k}` : k, out, ancestors, depth + 1);
  }
  return out;
}

function walk(node, visit, path = "$") {
  if (node === null || typeof node !== "object") { visit(node, path); return; }
  visit(node, path);
  if (Array.isArray(node)) { node.forEach((v, i) => walk(v, visit, `${path}[${i}]`)); return; }
  for (const [k, v] of Object.entries(node)) walk(v, visit, `${path}.${k}`);
}

/* --------------------------------------------------------- the entry point */

/**
 * Validates one artifact.
 *
 * Everything in `context` is optional. A check whose inputs are absent does not
 * run and does not pass — it is simply not among the findings, and
 * `checksRun` says which ones were actually performed. Reporting a check as
 * passed when it never executed is how a validator becomes decoration.
 */
export function validateArtifact({
  filename,
  content,
  mode = null,
  sourceKind = null,
  blocked = false,
  current = {},
  ir = null,
  evidence = null,
  targetBrief = null,
  schemas = {}
} = {}) {
  const errors = [];
  const warnings = [];
  const checksRun = [];
  const isJson = String(filename).endsWith(".json");

  /* ---- parse ---- */
  let payload = null;
  let text = "";
  if (isJson) {
    checksRun.push("malformed-json");
    if (typeof content === "string") {
      try {
        payload = JSON.parse(content);
      } catch (e) {
        errors.push(finding(
          ARTIFACT_ERROR.MALFORMED_JSON,
          `${filename} is not valid JSON: ${e.message}`,
          "Regenerate it. Do not hand-repair a machine-readable artifact; whatever truncated it may have truncated a value rather than only the syntax.",
          filename
        ));
        return { valid: false, errors, warnings, checksRun, artifactKind: null };
      }
    } else {
      payload = content;
    }
    text = JSON.stringify(payload);
  } else {
    text = String(content ?? "");
  }

  /* ---- identity ---- */
  const metadata = readMetadata(filename, isJson ? payload : text);
  checksRun.push("metadata");
  const metaCheck = validateMetadata(metadata, { filename });
  errors.push(...metaCheck.errors.map((e) => ({ ...e, where: e.field ?? filename })));

  const kind = metadata?.artifactKind ?? findArtifact(filename)?.kind ?? null;
  const def = kind ? findArtifact(kind) : null;

  if (!def) {
    if (kind) {
      /* Already reported by validateMetadata as unsupported-artifact-kind; not
       * repeated here. Without a definition every remaining check has no rules
       * to check against, so this is where it stops. */
    } else {
      errors.push(finding(
        ARTIFACT_ERROR.UNSUPPORTED_KIND,
        `${filename} is not a registered artifact and its metadata does not name a kind.`,
        "Register it in src/artifacts/registry.mjs if it is meant to be produced, or delete it. An unregistered file in an output directory has no rules and no owner.",
        filename
      ));
    }
    return { valid: false, errors, warnings, checksRun, artifactKind: kind };
  }

  /* ---- mode and source-kind admissibility ---- */
  const effectiveMode = mode ?? metadata?.mode ?? null;
  const effectiveSource = sourceKind ?? metadata?.sourceKind ?? null;
  if (effectiveMode) {
    checksRun.push("mode-matrix");
    const decision = mayProduce({ kind: def.kind, mode: effectiveMode, sourceKind: effectiveSource, blocked });
    if (!decision.allowed && decision.code !== "not-blocked") {
      errors.push(finding(
        decision.code === "wrong-source-kind" ? ARTIFACT_ERROR.WRONG_SOURCE_KIND
          : decision.code === "wrong-mode" ? ARTIFACT_ERROR.WRONG_MODE
          : decision.code,
        decision.why,
        decision.remedy ?? "See src/artifacts/registry.mjs for what this mode may produce.",
        filename
      ));
    }
  }

  /* ---- integrity ---- */
  if (isJson) {
    checksRun.push("undefined-values");
    for (const path of findUndefined(payload)) {
      errors.push(finding(
        ARTIFACT_ERROR.UNDEFINED_VALUE,
        `undefined at \`${path}\`.`,
        "Write null instead. JSON.stringify deletes undefined properties, so the key would vanish from the file without anything reporting it.",
        path
      ));
    }
    if (def.validationSchema && schemas[def.validationSchema]) {
      checksRun.push("schema");
      const result = validateSchema(schemas[def.validationSchema], payload);
      for (const e of result.errors ?? []) {
        errors.push(finding(
          ARTIFACT_ERROR.SCHEMA_INVALID,
          `${e.path} ${e.message}`,
          `Regenerate from the current IR. The file no longer matches ${def.validationSchema}.`,
          e.path
        ));
      }
    }
  }

  /* ---- freshness ---- */
  if (metadata && Object.keys(current).length) {
    checksRun.push("freshness");
    const fresh = checkFreshness(metadata, current);
    if (fresh.verdict === FRESHNESS.STALE || fresh.verdict === FRESHNESS.INCOMPATIBLE) {
      const code = fresh.verdict === FRESHNESS.INCOMPATIBLE ? ARTIFACT_ERROR.INCOMPATIBLE : ARTIFACT_ERROR.STALE;
      for (const reason of fresh.reasons) {
        errors.push(finding(
          reason.code,
          `${reason.what} (was ${reason.was}, now ${reason.now}) — ${reason.means}`,
          fresh.recommendation,
          reason.field
        ));
      }
      errors.push(finding(
        code,
        fresh.summary,
        fresh.safeToRegenerate
          ? "Regenerating reproduces it from the current source; the existing file is preserved either way."
          : fresh.recommendation,
        filename
      ));
    }
  }

  /* ---- honesty ---- */
  if (!isJson) {
    checksRun.push("required-sections");
    errors.push(...checkRequiredSections({ text, def }));

    if (evidence) { checksRun.push("evidence-references"); errors.push(...checkEvidenceReferences({ text, evidence, def })); }
    if (ir) {
      checksRun.push("contested-not-exact");
      errors.push(...checkContestedNotExact({ text, ir, def }));
      checksRun.push("estimated-not-measured");
      errors.push(...checkEstimatedNotMeasured({ text, ir }));
    }
    if ((def.separatedSections ?? []).length) {
      checksRun.push("proposal-separation");
      errors.push(...checkProposalSeparation({ text, def }));
    }
    if (targetBrief) {
      checksRun.push("brief-separation");
      errors.push(...checkBriefSeparation({ text, targetBrief, def }));
    }
  } else {
    checksRun.push("screenshot-token-protection");
    errors.push(...checkScreenshotTokens({ filename, payload, metadata, def }));
  }

  /* A blocked artifact that says so is correct, not broken. */
  if (metadata?.status === ARTIFACT_STATUS.BLOCKED && def.blockedBehavior === "prune") {
    errors.push(finding(
      ARTIFACT_ERROR.WRONG_MODE,
      `${filename} is an implementation prompt carrying status \`blocked\`.`,
      "It should have been pruned, not written with a blocked status. See output/blocked-prompt.md, which is the artifact a refused run produces instead.",
      filename
    ));
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    checksRun,
    artifactKind: def.kind,
    metadata
  };
}

/** Validates a whole directory's worth, returning one report. */
export function validateArtifacts(artifacts, context = {}) {
  const reports = artifacts.map((a) => ({
    filename: a.filename,
    ...validateArtifact({ ...context, ...a })
  }));
  const failed = reports.filter((r) => !r.valid);
  return {
    valid: failed.length === 0,
    reports,
    failed,
    errorCount: reports.reduce((n, r) => n + r.errors.length, 0),
    summary: failed.length
      ? `${failed.length} of ${reports.length} artifact(s) failed validation.`
      : `${reports.length} artifact(s) validated.`
  };
}

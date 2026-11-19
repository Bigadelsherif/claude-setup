/**
 * Artifact metadata — what every generated file says about itself.
 *
 * Before this, an artifact's identity lived in its path: `output/rebuild-prompt.md`
 * under a run directory meant "a rebuild prompt, for whatever that run was
 * about". That is enough right up until a file is copied somewhere, and then it
 * is nothing at all — a prompt in a downloads folder has no directory to
 * explain it, and no way to tell you it was generated from screenshots of a
 * different page three weeks ago.
 *
 * So the metadata travels inside the file. Markdown carries it in an HTML
 * comment block; JSON carries it under a reserved `$bigaap` property. Both are
 * machine-readable, both survive a copy, and both are validated against a
 * schema rather than being trusted because they parse.
 *
 * The existing `bigaap:ir-hash` stamp is kept alongside it. It predates this
 * module, `readStamp` and validation gate V6 both depend on it, and removing a
 * working integrity check to tidy up a header would be a poor trade.
 */

import { STAMP_PREFIX, stampComment } from "../ir/hash.mjs";
import { serializeStable } from "./serialize.mjs";
import { findArtifact, ALL_ARTIFACT_STATUSES } from "./registry.mjs";

/** The reserved property on every machine-readable artifact. */
export const METADATA_KEY = "$bigaap";

/** The Markdown block delimiters. */
export const METADATA_OPEN = "<!-- bigaap:metadata";
export const METADATA_CLOSE = "-->";

/** Bumped when the SHAPE of the metadata changes, not when an artifact does. */
export const METADATA_VERSION = "1";

/**
 * Every field, and whether it must be present.
 *
 * Declared as data because three things read it: the builder, the validator,
 * and the generated documentation. A field described in one place and enforced
 * in another drifts.
 */
export const METADATA_FIELDS = Object.freeze([
  { field: "metadataVersion", required: true, describe: "Shape of this block, not of the artifact." },
  { field: "artifactKind", required: true, describe: "Which registered artifact this is." },
  { field: "mode", required: true, describe: "The analysis mode that produced it." },
  { field: "projectId", required: false, describe: "The project, when the run belonged to one." },
  { field: "workspaceId", required: true, describe: "The workspace the run wrote into." },
  { field: "sourceKind", required: true, describe: "`url` or `screenshots`." },
  { field: "source", required: true, describe: "The reference URL, or the screenshot path." },
  { field: "irHash", required: false, describe: "Content hash of the IR it was projected from." },
  { field: "evidenceHash", required: false, describe: "Content hash of the evidence map." },
  { field: "configurationHash", required: false, describe: "Content hash of the resolved configuration." },
  { field: "extractorVersion", required: true, describe: "Which extractor read the page." },
  { field: "driverVersion", required: false, describe: "Which browser driver, where one was involved." },
  { field: "toleranceVersion", required: false, describe: "Which tolerance table, where one applied." },
  { field: "policyVersion", required: false, describe: "Accessibility and tap-target policy in force." },
  { field: "generatedAt", required: true, describe: "When this file was written." },
  { field: "generatorVersion", required: true, describe: "Which version of the tool wrote it." },
  { field: "status", required: true, describe: "complete / partial / blocked / stale / superseded." },
  { field: "confidence", required: false, describe: "Where one applies. Never merged with coverage." },
  { field: "coverage", required: false, describe: "Where one applies. Never merged with confidence." }
]);

const REQUIRED_FIELDS = METADATA_FIELDS.filter((f) => f.required).map((f) => f.field);
const KNOWN_FIELDS = new Set(METADATA_FIELDS.map((f) => f.field));

/**
 * Builds a metadata record.
 *
 * Absent optional values are written as `null`, never omitted. An absent key
 * and a key set to null read differently to anything consuming this: absent
 * invites "the writer forgot", null says "this does not apply here". The
 * difference decides whether a reader goes looking for a bug.
 */
export function buildMetadata({
  artifactKind,
  mode,
  projectId = null,
  workspaceId,
  sourceKind,
  source,
  irHash = null,
  evidenceHash = null,
  configurationHash = null,
  extractorVersion,
  driverVersion = null,
  toleranceVersion = null,
  policyVersion = null,
  generatedAt = new Date().toISOString(),
  generatorVersion,
  status,
  confidence = null,
  coverage = null
} = {}) {
  return {
    metadataVersion: METADATA_VERSION,
    artifactKind: artifactKind ?? null,
    mode: mode ?? null,
    projectId,
    workspaceId: workspaceId ?? null,
    sourceKind: sourceKind ?? null,
    source: source ?? null,
    irHash,
    evidenceHash,
    configurationHash,
    extractorVersion: extractorVersion ?? null,
    driverVersion,
    toleranceVersion,
    policyVersion,
    generatedAt,
    generatorVersion: generatorVersion ?? null,
    status: status ?? null,
    confidence,
    coverage
  };
}

/* ------------------------------------------------------------- markdown */

/**
 * The header every human-readable artifact begins with.
 *
 * Order matters. The metadata block comes first so a machine reading the file
 * does not have to parse prose to find it, and the hash stamp stays where V6
 * has always looked for it.
 */
export function markdownHeader(metadata, { irHash = null } = {}) {
  const block = [
    METADATA_OPEN,
    serializeStable(metadata, { trailingNewline: false }),
    METADATA_CLOSE
  ].join("\n");
  const stamp = irHash ?? metadata.irHash;
  return stamp ? `${block}\n${stampComment(stamp)}` : block;
}

/** Reads the metadata block back out. Returns null when there is not one. */
export function readMarkdownMetadata(text) {
  const source = String(text ?? "");
  const start = source.indexOf(METADATA_OPEN);
  if (start === -1) return null;
  const end = source.indexOf(METADATA_CLOSE, start + METADATA_OPEN.length);
  if (end === -1) return null;
  const body = source.slice(start + METADATA_OPEN.length, end).trim();
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    /* Present but unparseable is NOT the same as absent, and the validator
     * needs to tell them apart: one is a missing step, the other is corruption.
     * The marker object says which. */
    return { $malformed: true, $raw: body.slice(0, 200) };
  }
}

/* ----------------------------------------------------------------- json */

/** Attaches metadata to a machine-readable artifact under the reserved key. */
export function withMetadata(payload, metadata) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    /* An array or scalar has nowhere to put a reserved property without
     * changing its type. Wrapping it silently would break every reader. */
    throw new Error(`cannot attach metadata to ${Array.isArray(payload) ? "an array" : typeof payload}; the artifact must be a JSON object`);
  }
  return { [METADATA_KEY]: metadata, ...payload };
}

/** Reads it back. Returns null when absent. */
export function readJsonMetadata(payloadOrText) {
  let value = payloadOrText;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return { $malformed: true, $raw: String(payloadOrText).slice(0, 200) }; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value[METADATA_KEY] ?? null;
}

/** Reads metadata from either form, choosing by filename. */
export function readMetadata(filename, content) {
  return String(filename).endsWith(".json")
    ? readJsonMetadata(content)
    : readMarkdownMetadata(content);
}

/* ----------------------------------------------------------- validation */

/**
 * Checks a metadata record on its own terms.
 *
 * Structural only — whether it is INTERNALLY sound. Whether its hashes still
 * match the current IR is a freshness question and lives in `freshness.mjs`;
 * whether the artifact was legal for its mode lives in `validate.mjs`. Keeping
 * them apart means an error names one thing.
 */
export function validateMetadata(metadata, { filename = null } = {}) {
  const errors = [];
  const add = (code, message, remedy) => errors.push({ code, message, remedy, field: null });

  if (metadata === null || metadata === undefined) {
    add("metadata-missing",
      `${filename ?? "the artifact"} carries no metadata block.`,
      "Regenerate it. Metadata is written by the projection, so a file without one was either hand-made or produced before metadata existed.");
    return { valid: false, errors };
  }
  if (metadata.$malformed) {
    add("metadata-malformed",
      `${filename ?? "the artifact"} has a metadata block that is not valid JSON: ${metadata.$raw}`,
      "Do not hand-repair it. Regenerate the artifact; a block that was edited by hand cannot be trusted about the file it describes.");
    return { valid: false, errors };
  }

  for (const field of REQUIRED_FIELDS) {
    if (metadata[field] === undefined || metadata[field] === null || metadata[field] === "") {
      errors.push({
        code: "metadata-invalid",
        field,
        message: `required metadata field \`${field}\` is ${metadata[field] === undefined ? "absent" : "empty"}.`,
        remedy: `Regenerate the artifact. \`${field}\` is set by the projection; an artifact missing it cannot be checked for freshness or mode-correctness.`
      });
    }
  }

  for (const key of Object.keys(metadata)) {
    if (!KNOWN_FIELDS.has(key)) {
      errors.push({
        code: "metadata-invalid",
        field: key,
        message: `unknown metadata field \`${key}\`.`,
        remedy: "Remove it, or add it to METADATA_FIELDS in src/artifacts/metadata.mjs if it is meant to be part of the contract."
      });
    }
  }

  if (metadata.status && !ALL_ARTIFACT_STATUSES.includes(metadata.status)) {
    errors.push({
      code: "metadata-invalid",
      field: "status",
      message: `\`${metadata.status}\` is not an artifact status.`,
      remedy: `Use one of: ${ALL_ARTIFACT_STATUSES.join(", ")}.`
    });
  }

  const def = metadata.artifactKind ? findArtifact(metadata.artifactKind) : null;
  if (metadata.artifactKind && !def) {
    errors.push({
      code: "unsupported-artifact-kind",
      field: "artifactKind",
      message: `\`${metadata.artifactKind}\` is not a registered artifact kind.`,
      remedy: "Register it in src/artifacts/registry.mjs, or correct the kind. An unregistered artifact has no rules, which means nothing can check it."
    });
  }
  if (def && metadata.status && !def.supportedStatuses.includes(metadata.status)) {
    errors.push({
      code: "metadata-invalid",
      field: "status",
      message: `${def.kind} does not support status \`${metadata.status}\`.`,
      remedy: `${def.kind} supports: ${def.supportedStatuses.join(", ")}.`
    });
  }

  /* Confidence and coverage are reported as a pair and never multiplied into
   * one number. A record carrying one as a fraction outside [0,1] is not a
   * rounding problem — it means something computed a score where it should have
   * computed a ratio. */
  for (const field of ["confidence", "coverage"]) {
    const v = metadata[field];
    if (v !== null && v !== undefined && (typeof v !== "number" || v < 0 || v > 1)) {
      errors.push({
        code: "metadata-invalid",
        field,
        message: `\`${field}\` must be null or a number in [0,1]; got ${JSON.stringify(v)}.`,
        remedy: "Report the ratio, or null when it does not apply. Never a percentage and never a composite."
      });
    }
  }

  if (metadata.generatedAt && Number.isNaN(Date.parse(metadata.generatedAt))) {
    errors.push({
      code: "metadata-invalid",
      field: "generatedAt",
      message: `\`generatedAt\` is not a parseable timestamp: ${JSON.stringify(metadata.generatedAt)}.`,
      remedy: "Use an ISO 8601 timestamp."
    });
  }

  return { valid: errors.length === 0, errors };
}

export { STAMP_PREFIX };

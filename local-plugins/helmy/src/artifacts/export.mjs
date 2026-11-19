/**
 * Export — handing an artifact to something outside the run that made it.
 *
 * Export is the moment an artifact loses its context. Inside a run directory a
 * prompt sits beside the coverage report that qualifies it, the blocked-prompt
 * that may contradict it, and the history that dates it. Copied into a product
 * repository it has none of that, and it reads as a specification.
 *
 * Two refusals therefore have no override:
 *
 *   - **Stale implementation prompts.** The values in the file are no longer
 *     what the analysis concluded. Exporting one hands somebody instructions to
 *     build the wrong thing, and nothing at the destination can detect it.
 *   - **Blocked implementation prompts.** The safety gate already refused to
 *     stand behind these instructions. Exporting them routes around the gate.
 *
 * Everything else may be exported, and everything exported carries its metadata
 * and its limitations with it — the point is not to make export hard but to
 * make it impossible for the exported file to be read as more certain than the
 * evidence behind it.
 */

import { findArtifact } from "./registry.mjs";
import { readMetadata } from "./metadata.mjs";
import { checkFreshness, FRESHNESS } from "./freshness.mjs";
import { serializeStable } from "./serialize.mjs";

export const EXPORT_REFUSAL = Object.freeze({
  STALE_PROMPT: "stale-implementation-prompt",
  BLOCKED_PROMPT: "blocked-implementation-prompt",
  NO_METADATA: "export-without-metadata",
  UNKNOWN_ARTIFACT: "unknown-artifact",
  INCOMPATIBLE: "incompatible-artifact"
});

/** What every exported file carries, whatever its kind. */
export const EXPORT_HEADER_FIELDS = Object.freeze([
  "artifactKind", "mode", "sourceKind", "source", "irHash", "generatedAt", "limitations"
]);

/**
 * Decides whether one artifact may be exported.
 *
 * Returns a decision object rather than throwing, because a caller exporting
 * six files needs all six answers, not the first refusal.
 */
export function canExport({ filename, content, current = {}, limitations = [] } = {}) {
  const def = findArtifact(filename);
  const metadata = readMetadata(filename, content);

  if (!def) {
    return refuse(EXPORT_REFUSAL.UNKNOWN_ARTIFACT, filename,
      `${filename} is not a registered artifact.`,
      "Only registered artifacts can be exported: an unregistered file has no rules, so nothing can say whether exporting it is safe.");
  }
  if (!metadata || metadata.$malformed) {
    return refuse(EXPORT_REFUSAL.NO_METADATA, filename,
      `${filename} carries no readable metadata.`,
      "Regenerate it first. An exported file is separated from everything that explained it, so the metadata is the only thing left that can.");
  }

  if (metadata.status === "blocked" && def.isImplementationPrompt) {
    return refuse(EXPORT_REFUSAL.BLOCKED_PROMPT, filename,
      `${filename} is an implementation prompt from a run the safety gate refused.`,
      "Nothing to fix here. The gate declined to stand behind these instructions; exporting them would route around it. Read output/blocked-prompt.md for what would change the verdict.");
  }

  const fresh = checkFreshness(metadata, current);
  if (def.isImplementationPrompt && fresh.verdict === FRESHNESS.STALE) {
    return refuse(EXPORT_REFUSAL.STALE_PROMPT, filename,
      `${filename} is out of date: ${fresh.summary}`,
      "Regenerate it, read what changed, then export. The values in this file are no longer what the analysis concluded, and nothing at the destination could detect that.");
  }
  if (def.isImplementationPrompt && fresh.verdict === FRESHNESS.INCOMPATIBLE) {
    return refuse(EXPORT_REFUSAL.INCOMPATIBLE, filename,
      `${filename} was produced under a different tool version.`,
      "Re-capture with the current tool. Regenerating from the stored IR would produce a file claiming a version it was not made under.");
  }

  /* A stale NON-prompt is exportable, with the staleness stated. A coverage
   * report describing an earlier capture is still a true account of that
   * capture; a build instruction describing an earlier capture is not still a
   * true instruction. */
  const warnings = [];
  if (fresh.verdict === FRESHNESS.STALE) {
    warnings.push({
      code: "exported-stale-report",
      message: `${filename} is out of date (${fresh.reasons.map((r) => r.field).join(", ")} moved), and is exported with that recorded in its header.`,
      why: "It remains a true account of the run that produced it. It is not a description of the current one."
    });
  }
  if (fresh.verdict === FRESHNESS.UNDETERMINED) {
    warnings.push({
      code: "exported-unverified",
      message: `${filename} could not be checked for freshness; nothing current was available to compare against.`,
      why: "Undetermined is not fresh. The export header says so."
    });
  }

  return {
    allowed: true,
    filename,
    artifactKind: def.kind,
    metadata,
    warnings,
    header: exportHeader({ metadata, def, limitations, freshness: fresh })
  };
}

function refuse(code, filename, message, remedy) {
  return { allowed: false, filename, refusal: { code, message, remedy }, warnings: [] };
}

/**
 * The block prepended to every exported file.
 *
 * Deliberately not the same as the generation metadata: this one is written for
 * whoever opens the file at the destination, who has no run directory and
 * probably no idea this tool exists.
 */
export function exportHeader({ metadata, def, limitations = [], freshness = null }) {
  return {
    exportedAt: new Date().toISOString(),
    artifactKind: metadata.artifactKind,
    mode: metadata.mode,
    sourceKind: metadata.sourceKind,
    source: metadata.source,
    irHash: metadata.irHash,
    generatedAt: metadata.generatedAt,
    generatorVersion: metadata.generatorVersion,
    status: metadata.status,
    freshnessAtExport: freshness?.verdict ?? "undetermined",
    limitations: [
      ...limitations,
      ...(metadata.sourceKind === "screenshots"
        ? ["Every value here was read from screenshots and is estimated. None of it is a measurement."]
        : []),
      ...(def?.isImplementationPrompt
        ? ["No tolerance in this system is validated. Acceptance criteria are stated targets, not certified thresholds."]
        : [])
    ],
    /* Named in the header because the destination has no other way to learn it. */
    regenerateWith: `helmy ${metadata.mode} --workspace <the workspace this came from>`
  };
}

/** Renders the header for a Markdown export. */
export function renderExportHeader(header) {
  const lines = [
    "<!-- helmy:export",
    serializeStable(header, { trailingNewline: false }),
    "-->",
    "",
    `> **Exported artifact.** Generated by helmy \`${header.generatorVersion}\` on ${header.generatedAt}`,
    `> from ${header.sourceKind === "screenshots" ? "screenshots of" : ""} \`${header.source}\` in \`${header.mode}\` mode.`,
    ">",
    "> This file was separated from the analysis that produced it. Its limitations:",
    ...header.limitations.map((l) => `> - ${l}`),
    ""
  ];
  return lines.join("\n");
}

/**
 * Plans an export of several artifacts.
 *
 * Refusals are returned alongside approvals rather than aborting the export.
 * Someone exporting a spec, a token file and a prompt should get the two that
 * are safe plus a clear account of the one that is not — not nothing.
 */
export function planExport({ artifacts = [], current = {}, limitations = [] } = {}) {
  const decisions = artifacts.map((a) => canExport({ ...a, current, limitations }));
  const allowed = decisions.filter((d) => d.allowed);
  const refused = decisions.filter((d) => !d.allowed);

  return {
    allowed,
    refused,
    warnings: allowed.flatMap((d) => d.warnings),
    complete: refused.length === 0,
    summary: refused.length
      ? `${allowed.length} of ${decisions.length} artifact(s) can be exported; ${refused.length} refused.`
      : `${decisions.length} artifact(s) ready to export.`,
    /* So a caller reporting this cannot accidentally describe a partial export
     * as a complete one. */
    refusalsAreFinal: refused.some((r) =>
      r.refusal.code === EXPORT_REFUSAL.BLOCKED_PROMPT)
  };
}

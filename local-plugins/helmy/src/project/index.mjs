import { hashIR } from "../ir/hash.mjs";
import { projectDesignSpec } from "./design-spec.mjs";
import { projectRebuildPrompt } from "./rebuild-prompt.mjs";
import { projectTokens } from "./tokens.mjs";
import { projectComponents, projectFidelityChecklist } from "./components.mjs";
import { projectCoverageReport, projectExtractionWarnings } from "./coverage-report.mjs";
import { projectBlockedPrompt } from "./blocked-prompt.mjs";
import { projectModeEvaluation } from "./mode-evaluation.mjs";
import { projectScreenshotReport, projectEstimatedTokens } from "./screenshot-report.mjs";
import { projectDisagreementReport } from "./disagreement-report.mjs";
import { projectAdaptationPrompt } from "./adaptation-prompt.mjs";
import { projectImprovementPrompt } from "./improvement-prompt.mjs";
import { projectEvidenceReport } from "./evidence-report.mjs";
import { projectImplementationNotes } from "./implementation-notes.mjs";
import { buildMetadata, markdownHeader, withMetadata } from "../artifacts/metadata.mjs";
import { serializeStable } from "../artifacts/serialize.mjs";
import { findArtifact, ARTIFACT_STATUS } from "../artifacts/registry.mjs";
import { lintPrompt } from "../prompts/lint.mjs";
import { isPrompt } from "../prompts/contract.mjs";

/**
 * Projects every artifact from one IR, in one pass, sharing one hash.
 *
 * The safety gate lives here, at the last possible moment: everything upstream
 * records what it found, and this is where the system decides what it is
 * willing to say. A blocked run still produces a full account of itself — it
 * simply refuses to produce an instruction to build something.
 */
export function projectAll(ir, options = {}) {
  const hash = hashIR(ir);
  const safety = ir.safety ?? { promptGenerationAllowed: true, status: "usable", blockers: [] };
  const allowed = safety.promptGenerationAllowed;
  const screenshotOnly = !!ir.screenshot;

  const files = {
    /* Always written. A reader must see what was looked at, and what the
     * requested output needed, before reading anything that was concluded. */
    "output/coverage-report.md": projectCoverageReport(ir, hash),
    "output/extraction-warnings.md": projectExtractionWarnings(ir, hash),
    "output/mode-evaluation.md": projectModeEvaluation(ir, hash),
    "output/evidence-report.md": projectEvidenceReport(ir, hash),
    "analysis/component-inventory.json": JSON.stringify(projectComponents(ir, hash), null, 2)
  };

  // Written whenever more than one source contributed — it is the record that
  // no source was quietly discarded.
  if ((ir.disagreements ?? []).length || (ir.sourceKinds ?? []).length > 1) {
    files["output/disagreement-report.md"] = projectDisagreementReport(ir, hash);
  }

  if (screenshotOnly) {
    files["output/screenshot-evidence-report.md"] = projectScreenshotReport(ir, hash);

    // No extracted-tokens.json, ever, by default. A token file is a set of
    // commitments; an estimate is not one, and a file with that name would be
    // read as exact by anything downstream that does not check provenance.
    if (options.allowEstimatedTokens) {
      files["analysis/estimated-tokens.json"] = JSON.stringify(projectEstimatedTokens(ir, hash), null, 2);
    }
  } else {
    files["analysis/extracted-tokens.json"] = JSON.stringify(projectTokens(ir, hash), null, 2);
  }

  // The requested mode decides which artifacts belong to the run. `analyze`
  // explains a reference and must not emit a rebuild prompt, however good the
  // evidence is — producing build instructions nobody asked for is its own kind
  // of overclaiming.
  const required = new Set(ir.modeEvaluation?.requiredArtifacts ?? [
    "output/design-spec.md",
    "output/rebuild-prompt.md",
    "output/fidelity-checklist.md"
  ]);

  if (allowed) {
    files["output/design-spec.md"] = projectDesignSpec(ir, hash);
    if (required.has("output/rebuild-prompt.md")) {
      files["output/rebuild-prompt.md"] = projectRebuildPrompt(ir, hash, options);
      files["output/fidelity-checklist.md"] = projectFidelityChecklist(ir, hash);
    }
    if (required.has("output/adaptation-prompt.md")) {
      files["output/adaptation-prompt.md"] = projectAdaptationPrompt(ir, hash, options);
    }
    if (required.has("output/improvement-prompt.md")) {
      files["output/improvement-prompt.md"] = projectImprovementPrompt(ir, hash);
    }
    /* Notes accompany an implementation prompt and never replace one. They make
     * no claims about the reference — see the file's own header — so they are
     * written whenever a prompt was, and never on their own. */
    if (required.has("output/rebuild-prompt.md") || required.has("output/adaptation-prompt.md")) {
      files["output/implementation-notes.md"] = projectImplementationNotes(ir, hash, options);
    }
  } else {
    // The spec is still emitted, under a name that cannot be mistaken for a
    // complete one, and the prompt is replaced by an explanation.
    files["output/partial-design-spec.md"] = projectDesignSpec(ir, hash, { partial: true });
    files["output/blocked-prompt.md"] = projectBlockedPrompt(ir, hash);
  }

  /* Every artifact says what it is, inside itself. A file identified only by
   * its path stops being identifiable the moment somebody copies it. */
  const stamped = stampAll(files, {
    ir, hash, allowed, screenshotOnly, options
  });

  /* The lint gate. It runs AFTER stamping, because half the rules read the
   * metadata block, and it runs before anything is returned, because a prompt
   * with a blocking finding must not exist — not exist-with-a-warning. A linter
   * whose findings are advisory is a linter nobody acts on. */
  const lint = {};
  for (const [filename, content] of Object.entries(stamped)) {
    if (!isPrompt(filename)) continue;
    const result = lintPrompt({
      filename,
      content,
      mode: ir.modeEvaluation?.requestedMode ?? options.mode ?? null,
      sourceKind: screenshotOnly ? "screenshots" : (ir.meta?.source?.kind ?? "url"),
      stack: options.stack ?? "next-tailwind",
      ir,
      targetBrief: options.targetBrief ?? null
    });
    lint[filename] = result;

    if (result.blocked) {
      /* Withdrawn and replaced by an explanation, exactly as the safety gate
       * does. The difference from a safety block is what it says: the evidence
       * may have been fine, and the rendering of it was not. */
      delete stamped[filename];
      const explanation = renderBlockedByLint(filename, result, hash);
      const def = findArtifact("blocked-prompt");
      const metadata = metadataFor({
        ir, hash, allowed: false, screenshotOnly, options,
        artifactKind: def?.kind ?? "blocked-prompt"
      });
      stamped["output/blocked-prompt.md"] =
        `${markdownHeader(metadata, { irHash: hash })}
${explanation}`;
    }
  }

  const blockedByLint = Object.entries(lint).filter(([, r]) => r.blocked).map(([f]) => f);

  return {
    hash,
    files: stamped,
    lint,
    blockedByLint,
    metadata: metadataFor({ ir, hash, allowed, screenshotOnly, options, artifactKind: null }),
    safety: safety.status,
    promptGenerated: allowed,
    screenshotOnly,
    estimatedTokensEmitted: screenshotOnly && !!options.allowEstimatedTokens
  };
}


/* --------------------------------------------------------------- metadata */

/**
 * The metadata one artifact carries.
 *
 * Built per-file rather than once per run, because `artifactKind` and `status`
 * differ between them: a partial design spec beside a complete coverage report
 * is the normal state of a blocked run, and one shared record would have to
 * lie about one of them.
 */
function metadataFor({ ir, hash, allowed, screenshotOnly, options, artifactKind, filename = null }) {
  const def = artifactKind ? findArtifact(artifactKind) : null;
  const partial = !allowed || (ir.unknowns ?? []).length > 0;

  /* The strongest status this artifact supports, given the run. A blocked
   * status on an artifact whose definition does not list it would be caught by
   * the validator, so the choice is narrowed to what is admissible here. */
  let status = ARTIFACT_STATUS.COMPLETE;
  if (!allowed && def?.supportedStatuses?.includes(ARTIFACT_STATUS.BLOCKED)) status = ARTIFACT_STATUS.BLOCKED;
  else if (partial && def?.supportedStatuses?.includes(ARTIFACT_STATUS.PARTIAL)) status = ARTIFACT_STATUS.PARTIAL;
  else if (def && !def.supportedStatuses.includes(status)) status = def.supportedStatuses[0];

  return buildMetadata({
    artifactKind: artifactKind ?? "design-spec",
    /* `requestedMode` is the evaluator's field. Reading `mode` here stamped
     * every artifact "analyze" regardless of the workflow that made it, so a
     * recreate run's own metadata contradicted it (def_0046). */
    mode: ir.modeEvaluation?.requestedMode ?? options.mode ?? "analyze",
    projectId: options.projectId ?? null,
    workspaceId: options.workspaceId ?? ir.meta?.slug ?? "unknown",
    sourceKind: screenshotOnly ? "screenshots" : (ir.meta?.source?.kind ?? "url"),
    source: ir.meta?.source?.value ?? "unknown",
    irHash: hash,
    evidenceHash: options.evidenceHash ?? null,
    configurationHash: options.configurationHash ?? null,
    extractorVersion: options.extractorVersion ?? ir.meta?.extractorVersion ?? "unknown",
    driverVersion: options.driverVersion ?? null,
    toleranceVersion: options.toleranceVersion ?? null,
    policyVersion: options.policyVersion ?? null,
    generatorVersion: options.generatorVersion ?? "0.1.0",
    /* From the run, not from the clock. Projection is a pure function of the
     * IR: the same IR must project to the same bytes, or the hash of an
     * artifact would change every time it was re-derived from an unchanged
     * source, and every freshness check would report drift that is not there. */
    generatedAt: options.generatedAt ?? ir.meta?.capturedAt ?? "1970-01-01T00:00:00.000Z",
    status,
    confidence: ir.confidence?.provenance ?? null,
    coverage: ir.coverage?.coverageFactor ?? null
  });
}

/** Attaches metadata to every projected file, by the form its type requires. */
function stampAll(files, context) {
  const out = {};
  for (const [filename, content] of Object.entries(files)) {
    const def = findArtifact(filename);
    const metadata = metadataFor({ ...context, artifactKind: def?.kind ?? null, filename });

    if (filename.endsWith(".json")) {
      /* Re-serialized through the stable serializer so key order cannot move a
       * hash, and so an `undefined` anywhere in the payload is a thrown error
       * rather than a key that silently disappears. */
      const payload = typeof content === "string" ? JSON.parse(content) : content;
      out[filename] = serializeStable(withMetadata(payload, metadata));
    } else {
      out[filename] = `${markdownHeader(metadata, { irHash: context.hash })}
${content}`;
    }
  }
  return out;
}


/**
 * What replaces a prompt the linter refused.
 *
 * Names every blocking finding and what to do about it. A bare "generation was
 * blocked" would leave the reader unable to tell a fixable rendering problem
 * from a fundamental evidence gap, and those need different responses.
 */
function renderBlockedByLint(filename, result, hash) {
  const lines = [];
  lines.push(`# ${filename} was not generated`);
  lines.push("");
  lines.push("The evidence may well support this prompt. The rendering of it did not:");
  lines.push("prompt linting found statements that would instruct a builder to do the wrong");
  lines.push("thing, so the prompt was withdrawn rather than written with a warning attached.");
  lines.push("");
  lines.push("## What was found");
  lines.push("");
  lines.push("| Rule | Where | Finding | What to do |");
  lines.push("| --- | --- | --- | --- |");
  for (const f of result.blocking) {
    lines.push(`| \`${f.rule}\` | ${f.where} | ${f.message.replace(/\|/g, "\|")} | ${f.remediation.replace(/\|/g, "\|")} |`);
  }
  lines.push("");
  lines.push("## What still exists");
  lines.push("");
  lines.push("Every analysis artifact was written normally. The design spec, the coverage");
  lines.push("report and the evidence report all describe what was found; only the");
  lines.push("instruction to build from it was refused.");
  lines.push("");
  lines.push("See `docs/PROMPT-LINT.md` for what each rule checks and why it blocks.");
  lines.push("");
  return lines.join("\n");
}

export { hashIR };

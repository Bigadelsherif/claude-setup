/**
 * Applying an accepted correction.
 *
 * Seventeen steps, and the order carries the whole safety argument: everything
 * that can refuse runs before anything is published, and publication is the
 * last act rather than the first.
 *
 * The failure mode this is built against is subtle and expensive. A correction
 * is applied, the IR re-derives, the artifacts re-project — and one of them is
 * now invalid, or a prompt now lints as dishonest, or the mode that was
 * satisfiable no longer is. If the artifacts were written as they were
 * produced, the workspace now holds a mixture: some files from the corrected
 * derivation, some from the previous one, and no way to tell which is which.
 *
 * So nothing is written until everything validates. The new artifacts are held
 * in memory, checked as a set, and published together or not at all. A failure
 * leaves the previous artifacts exactly where they were and records a blocked
 * correction explaining what stopped it — the proposal survives, because a
 * correction that vanished on failure would be re-proposed by the next person
 * to notice the same problem.
 */

import { runPipeline } from "../pipeline.mjs";
import { hashIR } from "../ir/hash.mjs";
import { validateArtifact } from "../artifacts/validate.mjs";
import { lintPrompt } from "../prompts/lint.mjs";
import { isPrompt } from "../prompts/contract.mjs";
import { checkFreshness, hashSources, FRESHNESS } from "../artifacts/freshness.mjs";
import { readMetadata } from "../artifacts/metadata.mjs";
import { guardCorrection } from "./guard.mjs";
import { previewCorrection } from "./preview.mjs";
import { validateCorrection, REVIEW_STATUS } from "./record.mjs";
import { accept as recordAccept, blocked as recordBlocked, activeCorrections } from "./store.mjs";
import { serializeStable } from "../artifacts/serialize.mjs";

/** Why an application stopped. */
export const STOP_REASON = Object.freeze({
  GUARD_REFUSED: "guard-refused",
  INVALID_RECORD: "correction-record-invalid",
  STALE_ARTIFACTS: "current-artifacts-are-stale",
  NOT_ACCEPTED: "not-accepted",
  VALIDATION_FAILED: "regenerated-artifacts-failed-validation",
  LINT_BLOCKED: "regenerated-prompt-blocked-by-lint",
  EVIDENCE_REDUCED: "correction-reduces-measurable-evidence"
});

/**
 * Applies an accepted correction.
 *
 * `write` is injected so the whole pipeline can be exercised without a
 * filesystem, and so the tests can prove that a failing run performs no writes
 * at all rather than trusting that it does not.
 */
export function applyCorrection({
  correction,
  workspaceRoot,
  raw,
  probe = null,
  screenshotCapture = null,
  meta = {},
  config = {},
  currentIr = null,
  currentFiles = {},
  existingCorrections = null,
  write = null,
  store = { accept: recordAccept, blocked: recordBlocked },
  allowEvidenceReduction = false,
  stopOnNewUncertainty = true
} = {}) {
  const steps = [];
  const note = (step, ok, detail = null) => { steps.push({ step, ok, detail }); return ok; };

  /* ---- 1. load the target ---- */
  const priorCorrections = existingCorrections ?? (workspaceRoot ? activeCorrections(workspaceRoot) : []);
  note("load-correction-target", true, `${priorCorrections.length} correction(s) already active`);

  /* ---- 2. current artifacts must be fresh ---- */
  const currentHashes = currentIr
    ? { ...hashSources({ evidence: null, configuration: config ?? null }), irHash: hashIR(currentIr), extractorVersion: currentIr.meta?.extractorVersion ?? null }
    : {};
  const stale = [];
  for (const [filename, content] of Object.entries(currentFiles)) {
    const metadata = readMetadata(filename, content);
    if (!metadata || metadata.$malformed) continue;
    const fresh = checkFreshness(metadata, currentHashes);
    if (fresh.verdict === FRESHNESS.STALE || fresh.verdict === FRESHNESS.INCOMPATIBLE) stale.push({ filename, verdict: fresh.verdict });
  }
  if (stale.length) {
    /* Correcting on top of stale artifacts would produce a workspace whose
     * history says the correction caused changes it did not cause. */
    note("validate-current-freshness", false, `${stale.length} artifact(s) are already stale`);
    return stop({
      correction, workspaceRoot, store, steps,
      reason: STOP_REASON.STALE_ARTIFACTS,
      message: `${stale.length} artifact(s) in this workspace are already out of date: ${stale.map((s) => s.filename).join(", ")}.`,
      remedy: "Re-derive the workspace first. Correcting on top of stale artifacts would attribute their staleness to this correction.",
      failures: stale
    });
  }
  note("validate-current-freshness", true, "every current artifact is fresh");

  /* ---- 3-4. the record itself ---- */
  const structural = validateCorrection(correction);
  if (!structural.valid) {
    note("validate-correction-input", false);
    return stop({
      correction, workspaceRoot, store, steps,
      reason: STOP_REASON.INVALID_RECORD,
      message: `The correction record is incomplete: ${structural.errors.map((e) => e.field).join(", ")}.`,
      remedy: structural.errors.map((e) => e.remedy).join(" "),
      failures: structural.errors
    });
  }
  note("validate-correction-input", true);

  const guard = guardCorrection({ correction, ir: currentIr, sourceKind: correction.sourceKind, automatic: false });
  if (!guard.allowed) {
    note("guard", false, guard.refusals.map((r) => r.code).join(", "));
    return stop({
      correction, workspaceRoot, store, steps,
      reason: STOP_REASON.GUARD_REFUSED,
      message: guard.refusals.map((r) => r.what).join(" "),
      remedy: guard.refusals.map((r) => r.remedy).join(" "),
      failures: guard.refusals
    });
  }
  note("guard", true);

  /* ---- 5. acceptance is required before anything is applied ---- */
  if (correction.reviewStatus !== REVIEW_STATUS.ACCEPTED) {
    note("require-acceptance", false, `review status is \`${correction.reviewStatus}\``);
    return stop({
      correction, workspaceRoot, store, steps,
      reason: STOP_REASON.NOT_ACCEPTED,
      message: `${correction.id} has not been accepted (it is \`${correction.reviewStatus}\`).`,
      remedy: `Read the preview, then \`bigaap correction accept ${correction.id}\`. Applying without acceptance would make the review step decorative.`,
      failures: []
    });
  }
  note("require-acceptance", true);

  /* ---- 6-10. re-derive, in memory ---- */
  const derived = runPipeline({
    raw, probe, screenshotCapture,
    corrections: [...priorCorrections, correction],
    meta, config
  });
  const newIr = derived.ir;
  const newFiles = derived.projection?.files ?? {};
  note("re-derive-ir", true, `IR ${hashIR(currentIr ?? newIr)} → ${hashIR(newIr)}`);
  note("re-project-artifacts", true, `${Object.keys(newFiles).length} artifact(s) produced`);

  /* ---- 11. the evidence must not have shrunk ---- */
  const beforeUnknowns = new Set((currentIr?.unknowns ?? []).map((u) => u.claim ?? String(u)));
  const newlyUnknown = (newIr?.unknowns ?? [])
    .map((u) => u.claim ?? String(u))
    .filter((u) => !beforeUnknowns.has(u));
  const coverageFell = (currentIr?.coverage?.coverageFactor ?? null) != null &&
    (newIr?.coverage?.coverageFactor ?? null) != null &&
    newIr.coverage.coverageFactor < currentIr.coverage.coverageFactor;

  if (stopOnNewUncertainty && !allowEvidenceReduction && (newlyUnknown.length || coverageFell)) {
    note("stop-on-new-uncertainty", false);
    return stop({
      correction, workspaceRoot, store, steps,
      reason: STOP_REASON.EVIDENCE_REDUCED,
      message: newlyUnknown.length
        ? `The correction makes ${newlyUnknown.length} claim(s) unknown that were established before: ${newlyUnknown.slice(0, 5).join(", ")}.`
        : `Coverage falls from ${currentIr.coverage.coverageFactor} to ${newIr.coverage.coverageFactor}.`,
      remedy: "A run can look better by measuring less; that is not an improvement. Re-run with `--allow-evidence-reduction` only if losing this evidence is the point of the correction, and say so in the reason.",
      failures: newlyUnknown.map((claim) => ({ claim, became: "unknown" }))
    });
  }
  note("stop-on-new-uncertainty", true);

  /* ---- 12. every regenerated artifact must validate ---- */
  const validationFailures = [];
  for (const [filename, content] of Object.entries(newFiles)) {
    const report = validateArtifact({
      filename, content,
      mode: newIr?.modeEvaluation?.requestedMode ?? null,
      sourceKind: newIr?.meta?.source?.kind ?? null,
      ir: newIr, evidence: derived.evidence
    });
    if (!report.valid) validationFailures.push({ filename, errors: report.errors.map((e) => `${e.code}: ${e.message}`) });
  }
  if (validationFailures.length) {
    note("validate-regenerated-artifacts", false, `${validationFailures.length} failed`);
    return stop({
      correction, workspaceRoot, store, steps,
      reason: STOP_REASON.VALIDATION_FAILED,
      message: `${validationFailures.length} regenerated artifact(s) failed validation. Nothing was published.`,
      remedy: "The previous artifacts are still the current ones. Read the failures, fix the correction, and re-apply.",
      failures: validationFailures
    });
  }
  note("validate-regenerated-artifacts", true, `${Object.keys(newFiles).length} validated`);

  /* ---- 13. prompt lint ---- */
  const lintResults = {};
  const lintBlocked = [];
  for (const [filename, content] of Object.entries(newFiles)) {
    if (!isPrompt(filename)) continue;
    const result = lintPrompt({
      filename, content,
      mode: newIr?.modeEvaluation?.requestedMode ?? null,
      sourceKind: newIr?.meta?.source?.kind ?? null,
      ir: newIr
    });
    lintResults[filename] = result;
    if (result.blocked) lintBlocked.push({ filename, rules: [...new Set(result.blocking.map((f) => f.rule))] });
  }
  /* A blocked prompt does not stop the correction: the projection layer already
   * withdraws it and writes an explanation, which is the designed behaviour.
   * It is recorded so the acceptance history says the prompt went away. */
  note("prompt-lint", true, lintBlocked.length ? `${lintBlocked.length} prompt(s) withdrawn by lint` : "no prompt was withdrawn");

  /* ---- 14. mode re-evaluation ---- */
  const modeBefore = currentIr?.modeEvaluation?.decision ?? null;
  const modeAfter = newIr?.modeEvaluation?.decision ?? null;
  note("re-evaluate-mode", true, `${modeBefore} → ${modeAfter}`);

  /* ---- 15-17. publish, together, last ---- */
  const previousHashes = Object.fromEntries(
    Object.keys(currentFiles).map((f) => [f, hashOf(currentFiles[f])]));
  const resultingHashes = Object.fromEntries(
    Object.entries(newFiles).map(([f, c]) => [f, hashOf(c)]));

  const written = [];
  if (write) {
    /* The derived layers publish too, and they publish FIRST. `analysis/ir.json`
     * and `analysis/evidence-map.json` are what every later read re-derives
     * from — a run that wrote only the projections would leave the workspace
     * showing corrected prose over an uncorrected IR, and the next command to
     * open it would quietly undo the correction. */
    write("analysis/ir.json", `${JSON.stringify(newIr, null, 2)}
`);
    written.push("analysis/ir.json");
    if (derived.evidence) {
      write("analysis/evidence-map.json", `${JSON.stringify(derived.evidence, null, 2)}
`);
      written.push("analysis/evidence-map.json");
    }
    for (const [filename, content] of Object.entries(newFiles)) {
      write(filename, content);
      written.push(filename);
    }
  }
  note("publish", true, `${written.length} file(s) written, IR and evidence first`);

  const accepted = workspaceRoot && store?.accept
    ? store.accept(workspaceRoot, correction, {
        resultingIrHash: hashIR(newIr),
        artifactHashes: resultingHashes,
        affectedArtifacts: Object.keys(newFiles)
      })
    : null;
  note("record-history", true, accepted ? accepted.file : "not persisted");

  return {
    applied: true,
    blocked: false,
    steps,
    correction: {
      ...correction,
      previousIrHash: currentIr ? hashIR(currentIr) : null,
      resultingIrHash: hashIR(newIr),
      previousArtifactHashes: previousHashes,
      resultingArtifactHashes: resultingHashes,
      affectedArtifacts: Object.keys(newFiles)
    },
    ir: newIr,
    files: newFiles,
    lint: lintResults,
    promptsWithdrawn: lintBlocked,
    modeDecision: { from: modeBefore, to: modeAfter },
    previousArtifactsPreserved: true,
    summary: `${correction.id} applied. ${Object.keys(newFiles).length} artifact(s) re-derived and validated${lintBlocked.length ? `, ${lintBlocked.length} prompt(s) withdrawn by lint` : ""}.`
  };
}

/**
 * Stops without publishing.
 *
 * Every early return goes through here, so "nothing was written" is one code
 * path rather than a promise repeated at seven call sites.
 */
function stop({ correction, workspaceRoot, store, steps, reason, message, remedy, failures }) {
  const recorded = workspaceRoot && store?.blocked
    ? store.blocked(workspaceRoot, correction, { reason: message, failures })
    : null;

  return {
    applied: false,
    blocked: true,
    reason,
    message,
    remedy,
    failures,
    steps,
    /* The three guarantees a caller needs, stated rather than implied. */
    previousArtifactsPreserved: true,
    nothingPublished: true,
    correctionPreserved: recorded !== null,
    recordedAs: recorded?.file ?? null,
    summary: `${correction.id} was not applied: ${reason}. The previous artifacts are still the current ones, and the correction is preserved.`
  };
}

const hashOf = (content) => {
  const text = typeof content === "string" ? content : serializeStable(content);
  return hashIR({ content: text });
};

export { REVIEW_STATUS };

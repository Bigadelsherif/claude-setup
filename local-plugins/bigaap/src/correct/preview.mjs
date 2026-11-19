/**
 * Correction preview — what would change, computed without changing anything.
 *
 * The preview is the review step, and its one hard guarantee is that running it
 * leaves the workspace byte-identical. Everything below works on copies and
 * returns a description; nothing here writes, and nothing here is passed a
 * writable handle to the workspace.
 *
 * What the preview is for is deciding, and deciding needs more than a diff of
 * one value. A correction that fixes a number can also: remove a claim from a
 * mode's satisfied requirements, withdraw an implementation prompt, change what
 * a prompt lints as, move an artifact from fresh to stale, and shift readiness
 * from blocked to allowed — or the other way. All of that is shown before
 * anyone accepts.
 *
 * The last of those is the one worth stating plainly: **a correction that makes
 * a run look better by reducing what was measured is not an improvement.** The
 * preview reports evidence lost as prominently as evidence gained, on the same
 * principle as `stopOnNewUncertainty` in the fidelity loop.
 */

import { hashIR } from "../ir/hash.mjs";
import { applyCorrections } from "./apply.mjs";
import { runPipeline } from "../pipeline.mjs";
import { findArtifact, ARTIFACTS } from "../artifacts/registry.mjs";
import { lintPrompt } from "../prompts/lint.mjs";
import { isPrompt } from "../prompts/contract.mjs";
import { buildReadinessModel } from "../cli/readiness-model.mjs";
import { guardCorrection } from "./guard.mjs";
import { evaluatePromotion } from "./promotion.mjs";
import { STATUS as EVIDENCE_STATUS } from "../evidence/status.mjs";

/**
 * Builds the preview.
 *
 * `raw`, `probe` and the rest are the inputs the workspace already holds; they
 * are re-run through the pipeline with the correction applied, in memory. The
 * cost is one extra derivation, and the return is that the preview describes
 * what would actually happen rather than what somebody expects would happen.
 */
export function previewCorrection({
  correction,
  raw,
  probe = null,
  screenshotCapture = null,
  existingCorrections = [],
  meta = {},
  config = {},
  currentIr = null,
  currentFiles = {},
  allCorrections = []
} = {}) {
  const before = currentIr ?? runPipeline({
    raw, probe, screenshotCapture, corrections: existingCorrections, meta, config
  }).ir;

  /* The guard runs first. A preview of a correction that will be refused is a
   * preview of nothing, and showing the diff first invites the reader to
   * discover the refusal after they have decided. */
  const guard = guardCorrection({
    correction, ir: before,
    sourceKind: correction.sourceKind ?? before?.meta?.source?.kind ?? null,
    automatic: false
  });
  if (!guard.allowed) {
    return {
      previewed: false,
      refused: true,
      guard,
      summary: `The correction was refused before any preview was computed: ${guard.refusals.map((r) => r.code).join(", ")}.`,
      mutated: false
    };
  }

  /* The re-derivation, on copies. `runPipeline` builds fresh objects from the
   * raw capture every time, so nothing the caller holds is touched. */
  const withCorrection = runPipeline({
    raw, probe, screenshotCapture,
    corrections: [...existingCorrections, correction],
    meta, config
  });
  const after = withCorrection.ir;

  const beforeHash = hashIR(before);
  const afterHash = hashIR(after);

  return {
    previewed: true,
    refused: false,
    mutated: false,
    guard,

    claim: {
      path: correction.claim,
      originalValue: correction.original?.value ?? null,
      correctedValue: correction.corrected?.value ?? null,
      originalStatus: correction.original?.status ?? null,
      correctedStatus: correction.corrected?.status ?? null,
      originalEvidence: correction.original?.evidence ?? [],
      replacementEvidence: correction.corrected?.evidence ?? []
    },

    statusChange: statusDelta(before, after, correction.claim),
    confidenceChange: confidenceDelta(before, after),
    affectedIrPaths: changedPaths(before, after),
    affectedProjections: affectedProjections(before, after),
    artifactsThatWillChange: artifactsAffected(before, after, currentFiles),
    artifactsThatWillBePruned: artifactsPruned(before, after),

    modeImpact: modeDelta(before, after),
    readinessImpact: readinessDelta({ before, after, currentFiles }),
    lintImpact: lintDelta({ before, after, files: withCorrection.projection?.files ?? {}, correction }),

    evidenceDelta: evidenceDelta(before, after),
    globalPromotionImpact: evaluatePromotion({
      correction: { ...correction, affectedProjections: affectedProjections(before, after) },
      corrections: allCorrections
    }),

    hashes: { previousIrHash: beforeHash, resultingIrHash: afterHash },
    risks: risksOf({ before, after, correction }),
    summary: summarise({ correction, before, after })
  };
}

/* ---------------------------------------------------------------- deltas */

function claimAt(ir, path) {
  if (!ir || !path) return null;
  return path.split(".").reduce((node, key) => (node == null ? null : node[key]), ir);
}

function statusDelta(before, after, path) {
  const b = claimAt(before, path);
  const a = claimAt(after, path);
  return {
    from: b?.status ?? null,
    to: a?.status ?? null,
    changed: (b?.status ?? null) !== (a?.status ?? null),
    /* A status that WEAKENS is fine and often correct. A status that
     * strengthens is the direction the guards care about, and it is called out
     * here so the reviewer sees it even when the guard allowed it. */
    strengthened: rank(a?.status) > rank(b?.status)
  };
}

const RANK = { unknown: 0, estimated: 1, inferred: 2, observed: 3, measured: 4 };
const rank = (s) => RANK[s] ?? -1;

function confidenceDelta(before, after) {
  const b = before?.confidence?.byCategory ?? {};
  const a = after?.confidence?.byCategory ?? {};
  const categories = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return categories
    .map((name) => ({ category: name, from: b[name] ?? null, to: a[name] ?? null }))
    .filter((d) => d.from !== d.to);
}

/**
 * Evidence gained and lost.
 *
 * Lost evidence is reported first and never netted against gains. A correction
 * that raises a score by making something unmeasurable has not improved
 * anything, and a single net number would hide exactly that.
 */
function evidenceDelta(before, after) {
  const beforeUnknowns = new Set((before?.unknowns ?? []).map((u) => u.claim ?? String(u)));
  const afterUnknowns = new Set((after?.unknowns ?? []).map((u) => u.claim ?? String(u)));

  const newlyUnknown = [...afterUnknowns].filter((u) => !beforeUnknowns.has(u));
  const nowKnown = [...beforeUnknowns].filter((u) => !afterUnknowns.has(u));

  const beforeCoverage = before?.coverage?.coverageFactor ?? null;
  const afterCoverage = after?.coverage?.coverageFactor ?? null;

  return {
    newlyUnknown,
    nowKnown,
    coverageFrom: beforeCoverage,
    coverageTo: afterCoverage,
    coverageFell: beforeCoverage != null && afterCoverage != null && afterCoverage < beforeCoverage,
    /* The `stopOnNewUncertainty` principle, applied to corrections. */
    reducesMeasurableEvidence: newlyUnknown.length > 0 ||
      (beforeCoverage != null && afterCoverage != null && afterCoverage < beforeCoverage),
    note: "Evidence lost is reported separately from evidence gained and never netted against it. A correction that raises a score by making something unmeasurable has not improved anything."
  };
}

function changedPaths(before, after, path = "", out = []) {
  if (before === after) return out;
  const bothObjects = before && after && typeof before === "object" && typeof after === "object";
  if (!bothObjects) {
    if (JSON.stringify(before) !== JSON.stringify(after)) out.push(path || "$");
    return out;
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (key === "meta" || key === "modeEvaluation") continue;
    changedPaths(before[key], after[key], path ? `${path}.${key}` : key, out);
  }
  return out;
}

/** Which projections read the paths that changed. */
function affectedProjections(before, after) {
  const changed = changedPaths(before, after);
  const projections = new Set();
  for (const path of changed) {
    const root = path.split(".")[0].split("[")[0];
    for (const def of ARTIFACTS) {
      if (!def.owningProjection) continue;
      /* Everything projected from the IR is affected by an IR change; the
       * mapping is coarse on purpose, because claiming a projection is
       * unaffected when it might be is the expensive direction to be wrong. */
      if (def.sourceIR) projections.add(def.owningProjection);
    }
    if (root) projections.add(`ir.${root}`);
  }
  return [...projections];
}

function artifactsAffected(before, after, currentFiles) {
  if (!changedPaths(before, after).length) return [];
  return Object.keys(currentFiles)
    .filter((filename) => findArtifact(filename)?.sourceIR)
    .map((filename) => ({
      filename,
      kind: findArtifact(filename)?.kind ?? null,
      why: "Projected from the IR, which this correction changes."
    }));
}

function artifactsPruned(before, after) {
  const wasAllowed = before?.safety?.promptGenerationAllowed !== false;
  const nowAllowed = after?.safety?.promptGenerationAllowed !== false;
  if (wasAllowed && !nowAllowed) {
    return ARTIFACTS.filter((a) => a.blockedBehavior === "prune").map((a) => ({
      filename: a.filename,
      kind: a.kind,
      why: "The correction moves this run to blocked, and an implementation prompt from a refused run must not be left standing."
    }));
  }
  return [];
}

function modeDelta(before, after) {
  const b = before?.modeEvaluation ?? null;
  const a = after?.modeEvaluation ?? null;
  return {
    decisionFrom: b?.decision ?? null,
    decisionTo: a?.decision ?? null,
    changed: (b?.decision ?? null) !== (a?.decision ?? null),
    blockingGapsFrom: (b?.blockingGaps ?? []).map((g) => g.id),
    blockingGapsTo: (a?.blockingGaps ?? []).map((g) => g.id),
    gapsResolved: (b?.blockingGaps ?? []).filter((g) => !(a?.blockingGaps ?? []).some((x) => x.id === g.id)).map((g) => g.id),
    gapsIntroduced: (a?.blockingGaps ?? []).filter((g) => !(b?.blockingGaps ?? []).some((x) => x.id === g.id)).map((g) => g.id)
  };
}

function readinessDelta({ before, after, currentFiles }) {
  const model = (ir) => buildReadinessModel({
    command: "correct",
    status: ir?.safety?.promptGenerationAllowed === false ? "blocked" : "completed",
    mode: ir?.modeEvaluation?.requestedMode ?? null,
    sourceKind: ir?.meta?.source?.kind ?? null,
    ir,
    modeEvaluation: ir?.modeEvaluation ?? null,
    files: currentFiles
  });
  const b = model(before);
  const a = model(after);

  return {
    statusFrom: b.status,
    statusTo: a.status,
    requirementsSatisfiedFrom: b.satisfiedRequirements.length,
    requirementsSatisfiedTo: a.satisfiedRequirements.length,
    changedRequirements: a.requirements
      .map((req) => {
        const was = b.requirements.find((x) => x.id === req.id);
        return was && was.status !== req.status ? { id: req.id, from: was.status, to: req.status } : null;
      })
      .filter(Boolean),
    blockersFrom: b.blockers.length,
    blockersTo: a.blockers.length,
    warningsFrom: b.warnings.length,
    warningsTo: a.warnings.length,
    unknownsFrom: b.unknowns.length,
    unknownsTo: a.unknowns.length,
    contestedFrom: b.contestedClaims.length,
    contestedTo: a.contestedClaims.length
  };
}

function lintDelta({ before, after, files, correction }) {
  const results = {};
  for (const [filename, content] of Object.entries(files)) {
    if (!isPrompt(filename)) continue;
    results[filename] = lintPrompt({
      filename, content,
      mode: after?.modeEvaluation?.requestedMode ?? null,
      sourceKind: after?.meta?.source?.kind ?? null,
      ir: after
    });
  }
  return {
    byArtifact: Object.fromEntries(Object.entries(results).map(([f, r]) => [f, {
      blocked: r.blocked,
      findings: r.findings.length,
      rules: [...new Set(r.findings.map((x) => x.rule))]
    }])),
    anyBlocked: Object.values(results).some((r) => r.blocked),
    note: "Lint is re-run against the corrected IR. A correction that fixes a value can still produce a prompt that reads dishonestly."
  };
}

function risksOf({ before, after, correction }) {
  const risks = [];
  const delta = evidenceDelta(before, after);

  if (delta.reducesMeasurableEvidence) {
    risks.push({
      risk: "This correction reduces measurable evidence.",
      detail: delta.newlyUnknown.length
        ? `${delta.newlyUnknown.length} claim(s) become unknown: ${delta.newlyUnknown.slice(0, 5).join(", ")}.`
        : `Coverage falls from ${delta.coverageFrom} to ${delta.coverageTo}.`,
      why: "A run can look better by measuring less. That is not an improvement, and it is the failure `stopOnNewUncertainty` exists to catch in the fidelity loop."
    });
  }
  const status = statusDelta(before, after, correction.claim);
  if (status.strengthened) {
    risks.push({
      risk: `The claim's status strengthens from \`${status.from}\` to \`${status.to}\`.`,
      detail: "Anything downstream will treat it as better established than it was.",
      why: "The guards permit this only where the source kind supports it. It is surfaced anyway, because permitted is not the same as unremarkable."
    });
  }
  if (correction.sourceKind === "screenshots") {
    risks.push({
      risk: "The evidence on this side is screenshot-only.",
      detail: "Nothing in the run can corroborate or contradict the correction.",
      why: "A correction here is one person's reading replacing another, with no third opinion available."
    });
  }
  const mode = modeDelta(before, after);
  if (mode.gapsIntroduced.length) {
    risks.push({
      risk: `The correction introduces ${mode.gapsIntroduced.length} new blocking gap(s).`,
      detail: mode.gapsIntroduced.join(", "),
      why: "The mode was satisfiable before this correction and is not after."
    });
  }
  return risks;
}

function summarise({ correction, before, after }) {
  const mode = modeDelta(before, after);
  const parts = [
    `\`${correction.claim}\`: ${JSON.stringify(correction.original?.value ?? null)} → ${JSON.stringify(correction.corrected?.value ?? null)}`
  ];
  if (mode.changed) parts.push(`mode decision ${mode.decisionFrom} → ${mode.decisionTo}`);
  if (mode.gapsResolved.length) parts.push(`resolves ${mode.gapsResolved.length} gap(s)`);
  if (mode.gapsIntroduced.length) parts.push(`introduces ${mode.gapsIntroduced.length} gap(s)`);
  return parts.join(" · ");
}

/** Renders a preview for a person, decision-relevant parts first. */
export function renderPreview(preview, correction) {
  if (preview.refused) {
    const lines = [`The correction was refused. Nothing was previewed and nothing was changed.`, ""];
    for (const r of preview.guard.refusals) {
      lines.push(`  ${r.code}`);
      lines.push(`    ${r.what}`);
      lines.push(`    ${r.why}`);
      lines.push(`    → ${r.remedy}`);
      lines.push("");
    }
    return lines.join("\n");
  }

  const l = [];
  l.push(`Preview of ${correction.id} — nothing has been changed.`);
  l.push("");
  l.push(`Claim: ${preview.claim.path}`);
  l.push(`  from: ${JSON.stringify(preview.claim.originalValue)} (${preview.claim.originalStatus ?? "no status"})`);
  l.push(`  to:   ${JSON.stringify(preview.claim.correctedValue)} (${preview.claim.correctedStatus ?? "no status"})`);
  l.push(`  original evidence:    ${preview.claim.originalEvidence.join(", ") || "none recorded"}`);
  l.push(`  replacement evidence: ${preview.claim.replacementEvidence.join(", ") || "none supplied"}`);
  l.push("");

  if (preview.risks.length) {
    l.push("RISKS");
    for (const r of preview.risks) {
      l.push(`  - ${r.risk}`);
      l.push(`    ${r.detail}`);
      l.push(`    ${r.why}`);
    }
    l.push("");
  }

  const rd = preview.readinessImpact;
  l.push("READINESS");
  l.push(`  status:       ${rd.statusFrom} → ${rd.statusTo}`);
  l.push(`  requirements: ${rd.requirementsSatisfiedFrom} → ${rd.requirementsSatisfiedTo} satisfied`);
  l.push(`  blockers:     ${rd.blockersFrom} → ${rd.blockersTo}`);
  l.push(`  unknowns:     ${rd.unknownsFrom} → ${rd.unknownsTo}`);
  l.push(`  contested:    ${rd.contestedFrom} → ${rd.contestedTo}`);
  for (const change of rd.changedRequirements) {
    l.push(`  - ${change.id}: ${change.from} → ${change.to}`);
  }
  l.push("");

  const ed = preview.evidenceDelta;
  if (ed.newlyUnknown.length || ed.nowKnown.length) {
    l.push("EVIDENCE");
    if (ed.nowKnown.length) l.push(`  now known:     ${ed.nowKnown.join(", ")}`);
    if (ed.newlyUnknown.length) l.push(`  newly unknown: ${ed.newlyUnknown.join(", ")}`);
    l.push(`  ${ed.note}`);
    l.push("");
  }

  l.push("ARTIFACTS");
  l.push(`  will change: ${preview.artifactsThatWillChange.length}`);
  for (const a of preview.artifactsThatWillChange.slice(0, 8)) l.push(`    ${a.filename}`);
  if (preview.artifactsThatWillBePruned.length) {
    l.push(`  will be WITHDRAWN: ${preview.artifactsThatWillBePruned.length}`);
    for (const a of preview.artifactsThatWillBePruned) l.push(`    ${a.filename} — ${a.why}`);
  }
  l.push("");

  l.push("PROMOTION");
  const p = preview.globalPromotionImpact;
  l.push(`  promotable now: ${p.promotable ? "yes" : "no"}`);
  l.push(`  independent references: ${p.witnesses.independentReferences} (threshold ${p.threshold})`);
  if (!p.promotable) l.push(`  ${p.whatWouldAllowIt}`);
  l.push("");

  l.push(`IR hash: ${preview.hashes.previousIrHash} → ${preview.hashes.resultingIrHash}`);
  l.push("");
  l.push("Nothing above has been applied. Accept it with `bigaap correction accept " + correction.id + "`.");
  return l.join("\n");
}

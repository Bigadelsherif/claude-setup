/**
 * Deterministic reporting for the shadow CLI path.
 *
 * `inspect-page.mjs` decides what happened; this file only decides how it is
 * shown, in text and in `--json`, from exactly the same data. That is the
 * whole point of this split: a report built by re-deriving numbers from two
 * different places can drift, and a reader who trusts the prose over the
 * JSON (or the reverse) has no way to notice. Every field a human reads here
 * is a field the JSON also carries, under the same name, and the text is a
 * pure function of the summary object — nothing here re-measures anything.
 *
 * WHAT THIS MUST NEVER WRITE, because it reports refusals as often as
 * successes and a refusal is exactly where the temptation to "help" is
 * strongest: no fenced code block, no CSS, no "design tokens" section, and
 * no build or implementation instruction. A remedy names what evidence is
 * missing or what the user must do outside this tool (sign in, wait, re-run
 * with a bigger budget) — never how to build anything from what little
 * evidence exists. `phase536`'s R-series tests scan the rendered text for
 * exactly these shapes.
 */

import { producesOutput, SUPPORT_DETAIL } from "../modes/support.mjs";
import { STATUS } from "./result.mjs";

export const INSPECT_REPORT_VERSION = "1";

/**
 * The one place a support class becomes a CLI status.
 *
 * Stated once and imported everywhere it matters, rather than written as a
 * ternary at each call site: two call sites with the same intent but a typo
 * in one of them is exactly the kind of drift a "stable exit code" promise
 * cannot survive. Every one of the eight `SUPPORT_CLASS` values maps here —
 * `producesOutput` decides `blocked` vs. not, and warnings decide `completed`
 * vs. `completed-with-warnings` among the ones that produce output.
 */
export function statusForSupport(supportClass, warningsCount = 0) {
  if (!producesOutput(supportClass)) return STATUS.BLOCKED;
  return warningsCount > 0 ? STATUS.COMPLETED_WITH_WARNINGS : STATUS.COMPLETED;
}

/** Every viewport that never produced a shadow model reports these as `null`, not omitted — an absent key and a null one should not be told apart by guessing. */
const EMPTY_CAPTURE = null;
const EMPTY_DISCOVERY = null;
const EMPTY_COUNTS = null;

const pluralize = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Every asset any section observed, counted once per sighting. */
const countAssets = (shadow) =>
  shadow.model.sections.reduce((n, s) => {
    const v = s.properties?.assets?.value;
    return n + (Array.isArray(v) ? v.length : 0);
  }, 0);

/** Every interactive control any section observed: links, buttons, forms, lists, list items, media and form fields. */
const countControls = (shadow) =>
  shadow.model.sections.reduce((n, s) => {
    const c = s.properties?.controls?.value;
    if (!c || typeof c !== "object") return n;
    return n + (c.links ?? 0) + (c.buttons ?? 0) + (c.forms ?? 0) + (c.lists ?? 0)
      + (c.listItems ?? 0) + (c.media ?? 0) + (Array.isArray(c.fields) ? c.fields.length : 0);
  }, 0);

/**
 * Builds the structured, viewport-level summary both the terminal report and
 * `--json` are drawn from.
 *
 * @param {object} args
 * @param {number} args.viewport
 * @param {string} args.url
 * @param {string} args.status          a `STATUS` value
 * @param {object|null} args.settle      the settle report, or null if capture never ran
 * @param {object|null} args.observed    the `collectObservations` output, or null
 * @param {object|null} args.shadow      `buildShadowViewportArtifacts`'s return, or null
 * @param {object} [args.captureFacts]   the facts handed to the classifier
 * @param {object[]} [args.blockers]     this viewport's `cliResult` blockers
 * @param {object[]} [args.artifacts]    this viewport's written artifact records
 */
export function buildViewportSummary({
  viewport, url, status, settle = null, observed = null, shadow = null,
  captureFacts = {}, blockers = [], artifacts = []
}) {
  const supportClass = shadow?.support?.supportClass ?? null;
  const detail = supportClass ? SUPPORT_DETAIL[supportClass] ?? null : null;

  return {
    viewport,
    url,
    status,
    supportClass,
    label: detail?.label ?? null,
    producesOutput: supportClass ? producesOutput(supportClass) : null,
    blockers: blockers.map((b) => ({
      code: b.code ?? null, message: b.message ?? null, remedy: b.recommendation ?? null
    })),
    capture: settle ? {
      settleOutcome: settle.outcome,
      settleEndedBy: settle.endedBy,
      hiddenDominant: settle.hiddenDominant === true,
      hiddenRatio: settle.hiddenRatio ?? null,
      imagesUnresolved: settle.imagesUnresolved === true,
      passCount: settle.passCount ?? null,
      elapsedMs: settle.elapsedMs ?? null
    } : EMPTY_CAPTURE,
    discovery: observed ? {
      stoppedBy: observed.stoppedBy ?? null,
      truncated: captureFacts.truncated === true,
      observations: observed.counts?.observations ?? 0,
      regionsObserved: observed.counts?.regions ?? 0,
      scrollRevealed: observed.counts?.scrollRevealed ?? 0,
      unstableObservations: observed.counts?.unstable ?? 0
    } : EMPTY_DISCOVERY,
    counts: shadow ? {
      regions: shadow.normalized.regions.length,
      sections: shadow.model.counts.sections,
      classified: shadow.model.counts.classified,
      unknownSections: shadow.model.counts.unknownSections,
      repeatedGroups: shadow.model.counts.repeatedGroups,
      unstableSections: shadow.model.counts.unstable,
      unsupported: shadow.model.counts.unsupported,
      scrollRevealedOnly: shadow.model.counts.scrollRevealedOnly,
      assets: countAssets(shadow),
      controls: countControls(shadow),
      unknownProperties: shadow.normalized.counts.unknownProperties
    } : EMPTY_COUNTS,
    artifacts: artifacts.map((a) => ({ kind: a.kind, path: a.path }))
  };
}

/** One viewport's report, as plain text lines. No markdown, no code fences. */
export function renderViewportSummary(summary) {
  const lines = [];
  const header = summary.supportClass
    ? `${summary.viewport}px — ${summary.supportClass}${summary.producesOutput ? "" : " (blocked; no output)"}`
    : `${summary.viewport}px — capture ${summary.status}`;
  lines.push(header);

  if (summary.label) lines.push(`  support: ${summary.label}`);

  for (const b of summary.blockers) {
    lines.push(`  blocker: ${b.code}${b.message ? ` — ${b.message}` : ""}`);
    if (b.remedy) lines.push(`    remedy: ${b.remedy}`);
  }

  if (summary.capture) {
    const c = summary.capture;
    const parts = [
      `settle ${c.settleOutcome} (${c.settleEndedBy})`,
      `${pluralize(c.passCount ?? 0, "pass")}`,
      c.hiddenRatio != null ? `hidden ratio ${c.hiddenRatio}` : null,
      c.imagesUnresolved ? "images unresolved" : null
    ].filter(Boolean);
    lines.push(`  capture: ${parts.join(", ")}`);
  }

  if (summary.discovery) {
    const d = summary.discovery;
    lines.push(`  discovery: stopped by ${d.stoppedBy}, ${pluralize(d.observations, "observation")}, `
      + `${pluralize(d.regionsObserved, "region")} observed`
      + (d.unstableObservations ? ` (${pluralize(d.unstableObservations, "unstable observation")})` : ""));
  }

  if (summary.counts) {
    const n = summary.counts;
    lines.push(`  counts: ${pluralize(n.regions, "region")} -> ${pluralize(n.sections, "section")} `
      + `(${n.classified} classified, ${n.unknownSections} unknown), `
      + `${pluralize(n.repeatedGroups, "repeated group")}, ${pluralize(n.assets, "asset")}, ${pluralize(n.controls, "control")}`);
    lines.push(`  unknown/conflict: ${pluralize(n.unstableSections, "unstable section")}, `
      + `${pluralize(n.unknownProperties, "unknown property", "unknown properties")}`
      + (n.unsupported ? `, ${pluralize(n.unsupported, "unsupported surface")}` : ""));
  }

  if (summary.artifacts.length) {
    lines.push("  artifacts:");
    for (const a of summary.artifacts) lines.push(`    ${a.kind.padEnd(28)} ${a.path}`);
  }

  return lines.join("\n");
}

/**
 * Builds the structured clone-prompt-or-refusal summary, from exactly the
 * `buildClonePrompt` output and the artifact it was written to — nothing
 * here re-derives a fact `clone-prompt.mjs` already decided.
 *
 * @param {object|null} output    `buildClonePrompt`'s return, or null if generation was never attempted
 * @param {{kind:string, path:string}|null} artifact  the artifact it was written to, or null
 * @param {string|null} [notAttemptedReason]  why generation was skipped, when `output` is null
 */
export function buildClonePromptSummary(output, artifact = null, notAttemptedReason = null) {
  if (!output) {
    return { attempted: false, kind: null, reason: notAttemptedReason ?? "clone-prompt generation was not attempted" };
  }
  const artifactRef = artifact ? { kind: artifact.kind, path: artifact.path } : null;
  if (output.kind === "refusal") {
    return {
      attempted: true,
      kind: "refusal",
      viewports: output.viewports.map((v) => ({ width: v.width, supportClass: v.supportClass, label: v.label })),
      artifact: artifactRef
    };
  }
  return {
    attempted: true,
    kind: "prompt",
    supportClass: output.supportClass,
    sections: output.sections.length,
    repeatedGroups: output.repeatedGroups.length,
    excludedViewports: output.excludedViewports.map((v) => ({ width: v.width, supportClass: v.supportClass })),
    artifact: artifactRef
  };
}

/** The clone-prompt outcome, as plain text lines. No markdown, no code fences — same discipline `renderViewportSummary` follows. */
export function renderClonePromptSummary(summary) {
  if (!summary.attempted) return `clone prompt: not attempted — ${summary.reason}`;

  if (summary.kind === "refusal") {
    const lines = [`clone prompt: refusal (${pluralize(summary.viewports.length, "viewport")} refused)`];
    for (const v of summary.viewports) lines.push(`  ${v.width}px — ${v.supportClass} (${v.label})`);
    if (summary.artifact) lines.push(`  artifact: ${summary.artifact.path}`);
    return lines.join("\n");
  }

  const lines = [`clone prompt: ${summary.supportClass} (${pluralize(summary.sections, "section")}, `
    + `${pluralize(summary.repeatedGroups, "repeated group")})`];
  if (summary.excludedViewports.length) {
    lines.push(`  excluded: ${summary.excludedViewports.map((v) => `${v.width}px (${v.supportClass})`).join(", ")}`);
  }
  if (summary.artifact) lines.push(`  artifact: ${summary.artifact.path}`);
  return lines.join("\n");
}

/**
 * The whole report: an overall line, every viewport in ascending width
 * order, the clone-prompt outcome, then the manifest path.
 * `viewportSummaries` must already be in the order to display — this
 * function does not sort, so a caller cannot get a different order from the
 * text than from the JSON by accident.
 *
 * @param {object|null} [clonePromptSummary] `buildClonePromptSummary`'s return; omitted entirely when null, so a caller that never attempted generation gets exactly the report this command produced before that capability existed.
 */
/**
 * The completeness line-up, rendered beside the prompt summary.
 *
 * Deliberately compact: the full per-dimension detail lives in
 * `prompt-completeness.json`. What belongs on a terminal is the shape of the
 * answer — how many dimensions are backed, how many are partial, and whether
 * anything blocks the prompt from being handed to a builder at all.
 */
export function renderCompletenessSummary(completeness) {
  if (!completeness) return "";
  const s = completeness.summary ?? {};
  const order = [
    ["observed-and-supported", "supported"],
    ["observed-but-incomplete", "incomplete"],
    ["inferred", "inferred"],
    ["unknown", "unknown"],
    ["refused", "refused"]
  ];
  const counts = order.filter(([k]) => (s[k] ?? 0) > 0).map(([k, label]) => `${s[k]} ${label}`).join(", ");
  const lines = [`prompt completeness: ${completeness.buildable ? "buildable" : "NOT buildable"} — ${counts || "nothing graded"}`];

  /* Only the dimensions a reader would act on. A fully supported dimension
   * needs no line; the artifact records it either way. */
  for (const d of completeness.dimensions ?? []) {
    if (d.status === "observed-and-supported") continue;
    const ratio = d.ratio === null ? "" : ` (${Math.round(d.ratio * 100)}%)`;
    lines.push(`  ${d.dimension}: ${d.status}${ratio} — ${d.detail}`);
  }
  for (const p of completeness.blockingProblems ?? []) {
    lines.push(`  BLOCKING ${p.code}: ${p.message}`);
  }
  return lines.join("\n");
}

export function renderInspectReport(overall, viewportSummaries, manifestPath = null, clonePromptSummary = null, completeness = null) {
  const lines = [`inspect-page: ${overall.status}  [${overall.url}]`, `  ${overall.summary}`, ""];
  for (const v of viewportSummaries) {
    lines.push(...renderViewportSummary(v).split("\n").map((l) => `  ${l}`));
    lines.push("");
  }
  if (clonePromptSummary) {
    lines.push(...renderClonePromptSummary(clonePromptSummary).split("\n"));
    lines.push("");
  }
  if (completeness) {
    lines.push(...renderCompletenessSummary(completeness).split("\n"));
    lines.push("");
  }
  if (manifestPath) lines.push(`manifest: ${manifestPath}`);
  return lines.join("\n").replace(/\n+$/, "\n");
}

/**
 * Evidence rendering for prompts.
 *
 * One function turns a claim into prompt text. That is the whole design: if
 * there are two places a measurement can become an instruction, one of them
 * will eventually render an estimate as a fact, and nothing will notice because
 * both outputs look the same.
 *
 * Each status gets a rendering that a reader — and an agent acting literally —
 * cannot mistake for a stronger one:
 *
 *   measured   `24px`                    exact, backticked, safe to build to
 *   observed   `flex`                    exact, but read from a declaration
 *   inferred   24px *(inferred …)*       plain, labelled, reasoning stated
 *   estimated  ~24px *(estimated …)*     tilde AND label; never backticked
 *   contested  **contested** — a vs b    both candidates, no single value
 *   unknown    **not determined**        a gap, stated as a gap
 *   proposed   **Proposed:** …           marked before the content, not after
 *
 * The backtick is doing real work. An agent reading a prompt treats a
 * backticked token as a literal to copy; the estimated rendering deliberately
 * never produces one, so a value that could not support being copied exactly
 * cannot be copied exactly by accident.
 */

import { STATUS } from "../evidence/status.mjs";

/** The statuses a prompt may render. `proposed` is not an evidence status. */
export const RENDER_STATUS = Object.freeze({
  MEASURED: "measured",
  OBSERVED: "observed",
  INFERRED: "inferred",
  ESTIMATED: "estimated",
  CONTESTED: "contested",
  UNKNOWN: "unknown",
  PROPOSED: "proposed"
});

export const ALL_RENDER_STATUSES = Object.freeze(Object.values(RENDER_STATUS));

/**
 * What each status is allowed to look like in a prompt.
 *
 * `exact` decides whether the value may be backticked. Only measured and
 * observed values may be, because only those were read rather than reasoned.
 */
export const RENDER_RULES = Object.freeze({
  [RENDER_STATUS.MEASURED]: {
    exact: true,
    label: null,
    describe: "Read off rendered geometry. May be emitted as an exact literal and built to precisely."
  },
  [RENDER_STATUS.OBSERVED]: {
    exact: true,
    label: null,
    describe: "Read from a declared style. May be emitted as an exact literal describing visible behavior."
  },
  [RENDER_STATUS.INFERRED]: {
    exact: false,
    label: "inferred",
    describe: "Derived from other evidence rather than read. Stays labelled so a builder knows the derivation, not the page, is the source."
  },
  [RENDER_STATUS.ESTIMATED]: {
    exact: false,
    label: "estimated",
    describe: "Reconstructed from a screenshot or partial signal. Never backticked — a value that cannot support being copied exactly must not look copyable."
  },
  [RENDER_STATUS.CONTESTED]: {
    exact: false,
    label: "contested",
    describe: "Two sources disagreed. Rendered as both candidates with neither settled; never as one number."
  },
  [RENDER_STATUS.UNKNOWN]: {
    exact: false,
    label: "unknown",
    describe: "Looked for and not established. Rendered as a gap with its reason, never replaced by a default."
  },
  [RENDER_STATUS.PROPOSED]: {
    exact: false,
    label: "proposed",
    describe: "A suggestion. Marked before its content so it cannot be read as a description of the reference."
  }
});

/** The marker that opens every proposal. Checked by the linter. */
export const PROPOSAL_MARKER = "**Proposed:**";

/** Formats a raw value with its unit. Arrays keep their order. */
export function literal(value, unit) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map((v) => literal(v, unit)).join(", ");
  if (typeof value === "number") {
    if (unit === "px") return `${value}px`;
    if (unit === "ms") return `${value}ms`;
    if (unit === "em") return `${value}em`;
    if (unit === "rem") return `${value}rem`;
    if (unit === "%") return `${value}%`;
  }
  return String(value);
}

/** `[ev_0001, ev_0002]`, or nothing when a claim cites nothing. */
export function evidenceRefs(claim) {
  const ids = claim?.evidence ?? [];
  return ids.length ? `[${ids.join(", ")}]` : null;
}

/**
 * The source kinds behind a claim, named rather than left implicit.
 *
 * A reader deciding how much to trust a value wants to know it came from the
 * DOM rather than from a screenshot, and the evidence id alone does not say so
 * without a lookup.
 */
export function sourceKinds(claim, evidence = null) {
  if (claim?.sourceKinds?.length) return claim.sourceKinds;
  if (claim?.source) return [claim.source];
  if (!evidence?.records) return [];
  const ids = new Set(claim?.evidence ?? []);
  return [...new Set(evidence.records.filter((r) => ids.has(r.id)).map((r) => r.source).filter(Boolean))];
}

/**
 * Renders one claim as a prompt line.
 *
 * Every rendering carries the six things the contract requires: the value where
 * one is supported, the status, the evidence ids, the source kinds, the
 * confidence, and a limitation where one applies. They are all on one line
 * because a caveat on a different line from its claim gets separated the first
 * time anybody quotes the prompt.
 */
export function renderClaim(label, claim, { evidence = null, indent = "- ", critical = false } = {}) {
  if (!claim || claim.value == null && !claim.contested) {
    const reason = claim?.reason ? ` — ${claim.reason}` : "";
    return `${indent}${label}: **not determined** *(unknown${reason})* — decide this yourself; nothing here supplies a default.`;
  }

  const refs = evidenceRefs(claim);
  const kinds = sourceKinds(claim, evidence);
  const kindText = kinds.length ? ` via ${kinds.join(" + ")}` : "";
  const conf = typeof claim.confidence === "number" ? `, confidence ${claim.confidence.toFixed(2)}` : "";
  const trail = `${refs ? ` ${refs}` : ""}${kindText}${conf}`;

  if (claim.contested) {
    const candidates = (claim.candidates ?? [])
      .map((c) => `${c.source}: ${literal(c.value, claim.unit)}`)
      .join(" vs ");
    const preferred = claim.disagreement?.preferredSource
      ? `preferring \`${claim.disagreement.preferredSource}\``
      : "no source preferred";
    const consequence = critical
      ? " **This value is critical and contested — do not build to either candidate until it is resolved.**"
      : "";
    return `${indent}${label}: **contested** — ${candidates}, ${preferred}${trail}.${consequence}`;
  }

  const rule = RENDER_RULES[claim.status] ?? RENDER_RULES[RENDER_STATUS.INFERRED];
  const value = literal(claim.value, claim.unit);

  if (rule.exact) {
    return `${indent}${label}: \`${value}\` *(${claim.status})*${trail}`;
  }
  if (claim.status === STATUS.ESTIMATED || claim.status === RENDER_STATUS.ESTIMATED) {
    return `${indent}${label}: ~${value} *(estimated — read from a screenshot, not measured; treat as approximate)*${trail}`;
  }
  return `${indent}${label}: ${value} *(${rule.label ?? claim.status}${claim.reason ? ` — ${claim.reason}` : ""})*${trail}`;
}

/**
 * Renders a proposal.
 *
 * The marker comes first. A trailing "(proposed)" is read after the sentence
 * has already been absorbed as a statement of fact, which is exactly the
 * failure this is preventing.
 */
export function renderProposal(text, { rationale = null, evidence = null } = {}) {
  const refs = Array.isArray(evidence) && evidence.length ? ` [${evidence.join(", ")}]` : "";
  const why = rationale ? ` *Why:* ${rationale}` : "";
  return `${PROPOSAL_MARKER} ${text}${refs}${why}`;
}

/**
 * Renders one leg-complete adaptation triad.
 *
 * All three legs always appear, including when the brief says nothing — "none
 * stated" is information. Omitting the leg would leave the instruction looking
 * like it followed from the reference alone.
 */
export function renderTriad({ label, referenceClaim, requirement, instruction, evidence = null }) {
  const lines = [];
  lines.push(`**${label}**`);
  lines.push("");
  lines.push(renderClaim("Reference evidence", referenceClaim, { evidence, indent: "- " }));
  lines.push(`- Target requirement: ${requirement ?? "*none stated in the brief*"}`);
  lines.push(`- Adaptation instruction: ${instruction}`);
  return lines.join("\n");
}

/**
 * Whether a claim may be turned into an acceptance criterion.
 *
 * Criteria are checked against a build, so a criterion built on a value nobody
 * established is a test that fails for reasons unrelated to the build. Unknown
 * and contested-critical claims are excluded, and the exclusion is reported
 * rather than silent.
 */
export function acceptanceEligibility(claim, { critical = false } = {}) {
  if (!claim || claim.value == null && !claim.contested) {
    return { eligible: false, why: "the value is unknown; a criterion here would test a number nobody established" };
  }
  if (claim.contested && critical) {
    return { eligible: false, why: "the value is critical and contested; a criterion would assert whichever candidate happened to be chosen" };
  }
  if (claim.status === STATUS.ESTIMATED) {
    return {
      eligible: true,
      degraded: true,
      why: "the value is estimated, so the criterion states a tolerance rather than an exact match"
    };
  }
  return { eligible: true, degraded: false, why: null };
}

/** Renders an acceptance criterion, degrading where the evidence requires it. */
export function renderCriterion(label, claim, { evidence = null, critical = false } = {}) {
  const check = acceptanceEligibility(claim, { critical });
  if (!check.eligible) {
    return `- [ ] ${label}: **no criterion** — ${check.why}.`;
  }
  const value = literal(claim.value, claim.unit);
  const refs = evidenceRefs(claim);
  if (check.degraded) {
    return `- [ ] ${label} is approximately ${value} *(estimated — verify by eye, not by pixel)* ${refs ?? ""}`.trimEnd();
  }
  return `- [ ] ${label} is \`${value}\` ${refs ?? ""}`.trimEnd();
}

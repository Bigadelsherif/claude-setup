/**
 * Shared claim rendering.
 *
 * Every projected claim goes through here, which is what makes validation rule
 * V3 (annotation coverage) and V4 (status honesty) enforceable: there is
 * exactly one place where a measurement becomes prose, so an unannotated or
 * dishonestly-exact claim cannot be written by accident.
 */

import { STATUS, STATUS_LABEL, isExact } from "../evidence/status.mjs";

export const CLAIM_MARKER = "—";

export function formatValue(claim) {
  if (!claim) return "not determined";
  const { value, unit } = claim;
  if (value == null) return "not determined";
  if (Array.isArray(value)) {
    return value.map((v) => (unit === "px" ? `${v}px` : String(v))).join(", ");
  }
  if (typeof value === "number") {
    if (unit === "px") return `${value}px`;
    if (unit === "ms") return `${value}ms`;
    if (unit === "em") return `${value}em`;
    if (unit === "ratio") return String(value);
    return String(value);
  }
  return String(value);
}

function evidenceRefs(claim) {
  const ids = claim?.evidence ?? [];
  return ids.length ? ` [${ids.join(", ")}]` : "";
}

/**
 * Renders one claim as an annotated line.
 * Estimated and unknown values never render as an exact measurement — they are
 * reported as undetermined with their reason, which is what V4 checks.
 */
export function claimLine(label, claim, { indent = "- " } = {}) {
  if (!claim || claim.status === STATUS.UNKNOWN || claim.value == null) {
    const reason = claim?.reason ? ` (${claim.reason})` : "";
    return `${indent}${label}: **not determined** ${CLAIM_MARKER} unknown${reason}`;
  }

  // A contested claim never renders as a bare value. Showing one number when
  // two sources disagree is exactly the silent substitution the disagreement
  // machinery exists to prevent.
  if (claim.contested) {
    const candidates = (claim.candidates ?? [])
      .map((c) => `${c.source}: ${formatValue({ value: c.value, unit: claim.unit })}`)
      .join(" vs ");
    const preferred = claim.disagreement?.preferredSource
      ? `, preferring \`${claim.disagreement.preferredSource}\``
      : ", no source preferred";
    return (
      `${indent}${label}: **contested** ${CLAIM_MARKER} ${candidates}${preferred} ` +
      `(${claim.disagreement?.type}, penalty ${claim.disagreement?.penaltyApplied})${evidenceRefs(claim)}`
    );
  }

  if (claim.corroborated) {
    const confidence = claim.confidence != null ? `, confidence ${claim.confidence.toFixed(2)}` : "";
    return (
      `${indent}${label}: **${formatValue(claim)}** ${CLAIM_MARKER} ${STATUS_LABEL[claim.status]}, ` +
      `corroborated across sources${confidence}${evidenceRefs(claim)}`
    );
  }

  if (claim.userCorrected) {
    return (
      `${indent}${label}: **${formatValue(claim)}** ${CLAIM_MARKER} user-corrected` +
      `${claim.confidence != null ? `, confidence ${claim.confidence.toFixed(2)}` : ""}${evidenceRefs(claim)}`
    );
  }

  if (claim.status === STATUS.ESTIMATED) {
    return `${indent}${label}: approximately **${formatValue(claim)}** ${CLAIM_MARKER} ${STATUS_LABEL[claim.status]}${evidenceRefs(claim)}`;
  }

  const confidence = claim.confidence != null ? `, confidence ${claim.confidence.toFixed(2)}` : "";
  const hedge = isExact(claim.status) ? "" : "";
  return `${indent}${label}: **${hedge}${formatValue(claim)}** ${CLAIM_MARKER} ${STATUS_LABEL[claim.status]}${confidence}${evidenceRefs(claim)}`;
}

/**
 * Bare literal for prompt contexts, where prose annotation would be noise.
 *
 * A contested value is never emitted bare: a prompt is an instruction, and an
 * instruction carrying one of two disputed numbers as though it were settled is
 * the most damaging thing this system could produce.
 */
/**
 * The inline provenance marker a value must carry, or "".
 *
 * `measured` and `observed` are the two statuses a prompt may state as exact,
 * so they carry nothing — the value IS the annotation. `inferred` and
 * `estimated` are a step and two steps removed from a measurement, and the
 * release boundary says plainly that anything other than measured or observed
 * "is deliberately hedged, and the hedge is information".
 *
 * It was not. Installed-copy verification found four inferred colours rendered
 * into a `:root` block beside two observed ones, formatted identically, with
 * `*(inferred)*` appearing only in the legend at the top of the document. A
 * builder pasting that block could not tell which four were derived. The legend
 * promised "every claim below states which"; the tokens did not.
 *
 * The comment form is deliberate: it is valid CSS, so it survives inside the
 * token block a builder copies, and it matches how a contested value has always
 * been marked here.
 */
function provenanceMarker(claim) {
  if (claim?.status === STATUS.INFERRED) return " /* inferred */";
  if (claim?.status === STATUS.ESTIMATED) return " /* estimated */";
  return "";
}

export function literal(claim, fallback = "UNSPECIFIED") {
  if (!claim || claim.value == null || claim.status === STATUS.UNKNOWN) return fallback;
  if (claim.contested) return `${formatValue(claim)} /* CONTESTED — see implementation notes */`;
  return `${formatValue(claim)}${provenanceMarker(claim)}`;
}

/** Literal for a non-critical contested value: labelled approximate. */
export function approximateLiteral(claim, fallback = "UNSPECIFIED") {
  if (!claim || claim.value == null || claim.status === STATUS.UNKNOWN) return fallback;
  if (claim.contested) return `${formatValue(claim)} /* approximate: sources disagree */`;
  return `${formatValue(claim)}${provenanceMarker(claim)}`;
}

/**
 * The marker for a value rendered without going through `literal` — a ramp
 * whose members are formatted individually, for instance.
 */
export function provenanceSuffix(claim) {
  const marker = provenanceMarker(claim);
  return marker ? ` *(${marker.replace(/[ \/*]/g, "").trim()})*` : "";
}

export function isUsable(claim) {
  return !!claim && claim.value != null && claim.status !== STATUS.UNKNOWN;
}

/** Usable AND uncontested — what a prompt may state as fact. */
export function isSettled(claim) {
  return isUsable(claim) && !claim.contested;
}

/** Claims safe to emit as design tokens: exact provenance only. */
export function isTokenable(claim) {
  return isUsable(claim) && (isExact(claim.status) || claim.status === STATUS.INFERRED);
}

export function section(title, lines) {
  const body = lines.filter(Boolean);
  if (!body.length) return "";
  return `## ${title}\n\n${body.join("\n")}\n`;
}

export function tableRow(cells) {
  return `| ${cells.join(" | ")} |`;
}

/**
 * A region's coverage as a percentage, or why there is no percentage.
 *
 * `null` from `assess.mjs` means no denominator was available, which is not the
 * same as no coverage. Rendering it as `0.0%` told readers a sampled region was
 * untouched — `stripe.com/pricing` visited 609 header and nav nodes and its
 * prompt reported 0%. Where the sampled count is known it is stated, because
 * "not measurable" alone invites the same wrong conclusion.
 */
export function coveragePercent(value, sampled = null) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${(value * 100).toFixed(1)}%`;
  }
  if (typeof sampled === "number" && sampled > 0) {
    return `not measurable — ${sampled} node(s) sampled, no denominator recorded`;
  }
  return "not measurable — no denominator recorded";
}

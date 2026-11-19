/**
 * Why the primary component is the one it is, and what the alternatives look like.
 *
 * Purely explanatory. Nothing that decides anything may read this field: not
 * `selectPrimaryRepeat`, not `evaluateMode`, not a gate, not coverage, not
 * confidence, not a projection that emits an implementation prompt. A structural
 * test asserts that, because the value of these numbers depends entirely on
 * their not being acted upon.
 *
 * The reason for that severity is measured rather than assumed. On the two
 * captures where a lower-ranked candidate resolves MORE surface properties than
 * the selected one, that candidate is structurally the wrong element both times:
 * a 810x1670 page section on stripe-pricing, a 129x37 text chip on
 * produx.design. Those are precisely the two failures the scorer was built to
 * prevent — def_0008 capped area to stop section wrappers winning, def_0053
 * damped count to stop decoration winning. Selecting on evidence quality would
 * have undone both at once. So the disagreement is reported and never resolved
 * here; see docs/COMPONENT-SELECTION.md.
 */

import { SCALE, classifyScale } from "../component/scale.mjs";

/** Surface properties the anatomy requirement counts. */
const SURFACE_PROPERTIES = Object.freeze([
  "backgroundColor", "borderRadius", "boxShadow", "borderWidth", "padding"
]);

/** The thresholds the requirement itself uses. Mirrored, never redefined. */
const ANATOMY_MIN_PROPERTIES = 3;
const ANATOMY_MIN_CONFIDENCE = 0.5;

/**
 * The geometry bands now live in `src/component/scale.mjs`, because the
 * `primary-component-admissible` requirement needs the same definition and a
 * gate must not read this module (def_0058). Re-exported under the original
 * name so the schema enum, the IR field and every existing reader are unchanged.
 */
export const STRUCTURAL_NOTE = SCALE;

export const RESOLVED_FROM = Object.freeze({
  PROBE: "probe",
  NOT_PROBED: "not-probed"
});

/** A value that is present and is not an absence. Zero radius is an absence. */
function isResolved(property, value) {
  if (value == null || value === "none" || value === "transparent") return false;
  const text = String(value).trim();
  if (property === "borderRadius" || property === "borderWidth") return !/^0(px)?$/.test(text);
  if (property === "padding") return !/^(0px\s*)+$/.test(text);
  return text.length > 0;
}

/** Signature with its leading tag removed, without splitting on dots. */
const withoutTag = (signature) =>
  String(signature ?? "").replace(/^[A-Za-z][\w-]*/, "");

/** Escapes stripped, for comparing a signature against a probe selector. */
const comparable = (value) => withoutTag(String(value ?? "").split("\\").join(""));

/**
 * Geometry band for one group.
 *
 * A section resolves three properties because sections have a background and
 * padding; a chip resolves three because chips have a background, a radius and
 * padding. Neither fact makes them a component, and this note is what lets a
 * reader see that at a glance beside `wouldSatisfyAnatomy`.
 */
function structuralNote(group, viewportWidth) {
  return classifyScale({
    area: group?.area,
    width: group?.sampleRect?.width,
    viewportWidth
  });
}

/**
 * Whether a candidate would clear the anatomy requirement.
 *
 * Tri-state on purpose. `false` is a finding: the probe ran and resolved too
 * few. `null` is the absence of one, and it has two causes that are stated
 * rather than merged — nothing was probed, or nothing computed a confidence for
 * this candidate. Only the selected component carries a confidence, because it
 * is the only one the evidence builder ran over; asserting a number for the
 * others would be inventing the very thing this field is asked to report.
 */
function anatomyOutlook({ resolvedProperties, confidence }) {
  if (resolvedProperties == null) {
    return { wouldSatisfyAnatomy: null, basis: "not probed, so the surface is unknown rather than insufficient" };
  }
  if (resolvedProperties < ANATOMY_MIN_PROPERTIES) {
    return {
      wouldSatisfyAnatomy: false,
      basis: `${resolvedProperties} resolved of ${ANATOMY_MIN_PROPERTIES} required`
    };
  }
  if (typeof confidence !== "number") {
    return {
      wouldSatisfyAnatomy: null,
      basis:
        `${resolvedProperties} properties resolved, which meets the count, but no confidence was ` +
        `computed for this candidate — only the selected component is evaluated, so the ` +
        `${ANATOMY_MIN_CONFIDENCE.toFixed(2)} confidence floor cannot be checked`
    };
  }
  return confidence >= ANATOMY_MIN_CONFIDENCE
    ? { wouldSatisfyAnatomy: true, basis: `${resolvedProperties} properties at confidence ${confidence.toFixed(2)}` }
    : { wouldSatisfyAnatomy: false, basis: `confidence ${confidence.toFixed(2)} below ${ANATOMY_MIN_CONFIDENCE.toFixed(2)}` };
}

/**
 * @param {object}   raw         extractor output
 * @param {object}   probe       pass-2 output, or null
 * @param {object[]} components  accepted components, for the selected entry
 * @returns {object|null}
 */
export function deriveComponentDiagnostics(raw, probe, components = []) {
  const groups = raw?.repeats ?? [];
  if (!groups.length) return null;

  const viewportWidth = raw?.layout?.viewportWidth ?? raw?.meta?.viewport?.width ?? 0;
  const probeRows = probe?.results ?? [];
  const probeAvailable = probeRows.length > 0;

  const rowFor = (signature) => {
    const key = comparable(signature);
    return probeRows.find((row) => comparable(row.selector) === key) ?? null;
  };

  const primary = components.find((c) => c.id === "card.primary") ?? null;
  const primaryKey = primary ? comparable(primary.selectors?.[0]) : null;

  /* Deterministic order: the score order the extractor already produced, with
   * the signature breaking ties so two groups of equal score never swap between
   * runs. Sorted on a copy — the repeats array belongs to the caller. */
  const ranked = groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => {
      const byScore = (b.group.score ?? 0) - (a.group.score ?? 0);
      if (byScore !== 0) return byScore;
      return String(a.group.signature ?? "").localeCompare(String(b.group.signature ?? ""));
    });

  let probed = 0;
  const candidates = ranked.map(({ group }, rank) => {
    const row = rowFor(group.signature);
    const surface = row?.samples?.[0]?.paintedSurface ?? null;

    /* `null` where nothing was read; a count only where a surface was returned.
     * A probe row that matched and resolved nothing is a measured zero and says
     * so, which is a different fact from never having looked. */
    const resolvedProperties = surface
      ? SURFACE_PROPERTIES.filter((p) => isResolved(p, surface[p])).length
      : null;
    if (surface) probed++;

    const isSelected = primaryKey != null && comparable(group.signature) === primaryKey;
    const confidence = isSelected && typeof primary?.confidence === "number"
      ? primary.confidence
      : null;

    const outlook = anatomyOutlook({ resolvedProperties, confidence });

    return {
      rank,
      selected: isSelected,
      signature: group.signature ?? null,
      stableSelector: group.stableSelector ?? null,
      score: group.score ?? null,
      instances: group.count ?? null,
      area: group.area ?? null,
      sample: group.sampleRect
        ? { width: group.sampleRect.width ?? null, height: group.sampleRect.height ?? null }
        : null,
      region: group.region ?? null,
      inPrimaryRegion: group.inPrimary === true,
      paintedMembers: group.paintedCount ?? 0,
      resolvedFrom: surface ? RESOLVED_FROM.PROBE : RESOLVED_FROM.NOT_PROBED,
      resolvedProperties,
      confidence,
      wouldSatisfyAnatomy: outlook.wouldSatisfyAnatomy,
      wouldSatisfyBasis: outlook.basis,
      structuralNote: structuralNote(group, viewportWidth)
    };
  });

  const selected = candidates.find((c) => c.selected) ?? null;

  return {
    /* Repeated at the top so a reader does not have to search the list. */
    selected: selected
      ? {
          rank: selected.rank,
          signature: selected.signature,
          stableSelector: selected.stableSelector,
          resolvedProperties: selected.resolvedProperties,
          confidence: selected.confidence,
          wouldSatisfyAnatomy: selected.wouldSatisfyAnatomy,
          wouldSatisfyBasis: selected.wouldSatisfyBasis,
          structuralNote: selected.structuralNote
        }
      : null,
    candidates,
    /* Stated because 15 of 112 groups probed does not license "no better
     * candidate exists". An unprobed candidate has not been ruled out. */
    probeCoverage: {
      candidates: candidates.length,
      probed,
      unprobed: candidates.length - probed,
      probeRan: probeAvailable,
      note: probeAvailable
        ? "Candidates outside the probe budget have an unknown surface. They were not disproven."
        : "No probe pass ran, so no candidate's surface was read. Nothing here is a finding about any of them."
    },
    thresholds: {
      minProperties: ANATOMY_MIN_PROPERTIES,
      minConfidence: ANATOMY_MIN_CONFIDENCE,
      note: "Mirrored from the recreate requirement for reading only. Diagnostics change no verdict."
    },
    limits: {
      explanatoryOnly: true,
      note:
        "Selection is structural and sufficiency is evidential, and where they disagree the run is " +
        "refused rather than re-selected. A candidate marked `wouldSatisfyAnatomy: true` was still " +
        "not chosen, and its `structuralNote` says why."
    }
  };
}

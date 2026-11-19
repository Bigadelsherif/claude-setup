/**
 * Surface classification.
 *
 * Until Phase 3.3 the system had only ever been shown components that paint, so
 * every heuristic reaching for a background found one. Nine of ten controlled
 * unpainted fixtures produced no component at all, rejected for `no resolvable
 * anatomy` — because anatomy was defined as surface (def_0023).
 *
 * The correction is not to lower a threshold. It is to say what a surface IS,
 * separately from whether a component exists, and to make the absence of one a
 * recorded finding rather than a missing measurement.
 *
 * The distinction that carries the most weight here:
 *
 *   surface: null with classification `text-only`  — we looked, nothing paints
 *   surface: null with classification `unknown`    — we could not look
 *
 * The first licenses a prompt to say "this component has no background". The
 * second licenses nothing at all.
 */

export const SURFACE = {
  /** Paints a background colour. */
  PAINTED_BACKGROUND: "painted-background",
  /** Paints a border and no background — a divider, a rule, a left accent. */
  PAINTED_BORDER: "painted-border",
  /** Paints a shadow and no background or border. */
  PAINTED_SHADOW: "painted-shadow",
  /** Paints via background-image or gradient rather than a colour. */
  IMAGE_PAINTED: "image-painted",
  /** Carries text and nothing else. Its visual presence IS its typography. */
  TEXT_ONLY: "text-only",
  /** Contributes layout — spacing, grid participation — and no paint or text of its own. */
  LAYOUT_ONLY: "layout-only",
  /** Visually sits on a surface painted by an ancestor, not by itself. */
  INHERITED_SURFACE: "inherited-surface",
  /** Does not paint; a descendant inside it does. The component is still the outer node. */
  DESCENDANT_PAINTED: "descendant-painted",
  /** Nothing paints, here or below, and the node bears no text either. */
  NONE: "none",
  /** The question could not be answered from the evidence available. */
  UNKNOWN: "unknown"
};

/** The classifications that mean "we looked and there is no paint on this node". */
const OBSERVED_ABSENCE = new Set([
  SURFACE.TEXT_ONLY, SURFACE.LAYOUT_ONLY, SURFACE.NONE,
  SURFACE.INHERITED_SURFACE, SURFACE.DESCENDANT_PAINTED
]);

/** The classifications that mean "this node paints something itself". */
const SELF_PAINTED = new Set([
  SURFACE.PAINTED_BACKGROUND, SURFACE.PAINTED_BORDER,
  SURFACE.PAINTED_SHADOW, SURFACE.IMAGE_PAINTED
]);

export const isObservedAbsence = (c) => OBSERVED_ABSENCE.has(c);
export const isSelfPainted = (c) => SELF_PAINTED.has(c);

const isTransparent = (v) =>
  v == null || v === "" || v === "transparent" ||
  /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/.test(v) ||
  /,\s*0\s*\)$/.test(v);

const hasShadow = (v) => !!v && v !== "none";
const hasBorder = (w, c) => (w ?? 0) > 0 && !isTransparent(c);

/**
 * Classifies the surface of a repeat group.
 *
 * `resolved` is what resolveSurface produced; `repeat` is the group itself.
 * Returns the classification, an explicit `surface` value that is `null`
 * whenever nothing is painted on the component itself, and the evidence the
 * decision rested on.
 */
export function classifySurface({ resolved, repeat, probeSample = null } = {}) {
  const evidence = [];
  const unknown = (reason) => ({
    classification: SURFACE.UNKNOWN,
    surface: null,
    surfaceObserved: false,
    paintedBy: null,
    reason,
    evidence
  });

  if (!repeat) return unknown("No repeat group was resolved.");
  if (!resolved) return unknown("Surface resolution produced no result for this group.");

  /* Without probe data the only thing read is the repeat root's own computed
   * style, and a transparent wrapper above the painting node is invisible.
   * Saying `none` on that basis would be asserting an absence that was never
   * measured, so aggregate-only mode yields `unknown` unless the aggregate
   * itself found paint. */
  const aggregateOnly = resolved.mode === "aggregate";

  const background = resolved.background ?? null;
  const shadow = resolved.boxShadow ?? null;
  const borderWidth = resolved.borderWidth ?? null;
  const borderColor = resolved.borderColor ?? null;
  const paintsBackground = !isTransparent(background);
  const paintsShadow = hasShadow(shadow);
  const paintsBorder = hasBorder(borderWidth, borderColor);

  const paintedVia = probeSample?.paintedVia ?? resolved.paintedVia ?? null;
  const rootPaints = resolved.rootPaints ?? null;
  const paintedIsRoot = resolved.isRoot !== false;

  if (paintsBackground || paintsShadow || paintsBorder || paintedVia === "image") {
    /* Something paints. The remaining question is WHERE — on the component or
     * on a descendant — because an implementer needs to know which element to
     * put the background on (def_0025). */
    if (!paintedIsRoot) {
      evidence.push(`painted by descendant ${resolved.selector}`);
      return {
        classification: SURFACE.DESCENDANT_PAINTED,
        surface: {
          ownedBy: resolved.selector,
          background: paintsBackground ? background : null,
          border: paintsBorder ? `${borderWidth}px solid ${borderColor}` : null,
          borderRadius: resolved.borderRadius ?? null,
          boxShadow: paintsShadow ? shadow : null,
          padding: resolved.padding ?? null
        },
        surfaceObserved: true,
        paintedBy: resolved.selector,
        reason: `The component itself paints nothing; ${resolved.selector} inside it does.`,
        evidence
      };
    }

    const classification =
      paintedVia === "image" ? SURFACE.IMAGE_PAINTED
        : paintsBackground ? SURFACE.PAINTED_BACKGROUND
          : paintsBorder ? SURFACE.PAINTED_BORDER
            : SURFACE.PAINTED_SHADOW;

    evidence.push(`self-painted: ${classification}`);
    return {
      classification,
      surface: {
        ownedBy: resolved.rootSelector ?? resolved.selector,
        background: paintsBackground ? background : null,
        border: paintsBorder ? `${borderWidth}px solid ${borderColor}` : null,
        borderRadius: resolved.borderRadius ?? null,
        boxShadow: paintsShadow ? shadow : null,
        padding: resolved.padding ?? null
      },
      surfaceObserved: true,
      paintedBy: resolved.rootSelector ?? resolved.selector,
      reason: `The component paints its own ${classification.replace("painted-", "")}.`,
      evidence
    };
  }

  if (aggregateOnly && rootPaints == null && !resolved.paintsNothing) {
    return unknown(
      "Aggregate-only capture: only the repeat root's own style was read, so a transparent " +
      "wrapper above a painting node would be invisible. Absence of paint was not established."
    );
  }

  /* Nothing paints. Now distinguish the kinds of not-painting, because they
   * mean different things to an implementer. */
  /* `textBearing` counts DIRECT text nodes, so a component whose text sits in
   * child elements — which is most of them — measures zero. The probe records
   * the element's full textContent, which is the right question here: whether
   * this component's visual presence IS its typography does not depend on which
   * descendant the characters are attached to. */
  const subtreeText = (probeSample?.text ?? "").trim();
  const textBearing = (repeat.textBearing ?? 0) > 0 || subtreeText.length > 0;
  const paintedDescendants = (repeat.paintedCount ?? 0) > 0;

  if (paintedDescendants && !paintedIsRoot) {
    evidence.push("group reports painted members but resolution named no painting node");
    return unknown("The group reports painted members, but no painting node could be resolved.");
  }

  if (textBearing) {
    evidence.push("bears text, paints nothing");
    return {
      classification: SURFACE.TEXT_ONLY,
      surface: null,
      surfaceObserved: true,
      paintedBy: null,
      reason: "No background, border, shadow or image was observed. The component's visual presence is its typography.",
      evidence
    };
  }

  const participatesInLayout =
    (repeat.count ?? 0) > 1 && (repeat.area ?? 0) > 0;

  if (participatesInLayout) {
    evidence.push("occupies layout, paints nothing, bears no direct text");
    return {
      classification: SURFACE.LAYOUT_ONLY,
      surface: null,
      surfaceObserved: true,
      paintedBy: null,
      reason: "No paint of any kind was observed. The component contributes structure and spacing; its children carry the content.",
      evidence
    };
  }

  evidence.push("no paint, no text, no measurable box");
  return {
    classification: SURFACE.NONE,
    surface: null,
    surfaceObserved: true,
    paintedBy: null,
    reason: "Nothing paints and nothing was measurable on this node.",
    evidence
  };
}

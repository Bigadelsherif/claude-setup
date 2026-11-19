/**
 * Structural scale of a repeated element, measured against the captured viewport.
 *
 * One definition, two readers, and deliberately no coupling between them.
 * `src/ir/component-diagnostics.mjs` uses it to explain why the primary
 * component is the one it is; the `primary-component-admissible` requirement
 * uses it to refuse a mode. Neither reads the other — the gate does not consult
 * `ir.componentDiagnostics`, and a structural test asserts that. Both compute the
 * same fact from the same geometry because they import the same function, which
 * is the only kind of agreement worth relying on.
 *
 * Why the scale matters at all (def_0058). Selection scores on repetition and
 * occupied area; sufficiency counts resolved surface properties. Both work, and
 * the gap between them is where a page section or a text chip can become the
 * "primary component": a section resolves three properties because sections have
 * a background and padding, and a chip resolves three because chips have a
 * background, a radius and padding. Neither fact makes them the page's
 * component, and a prompt built from one describes the wrong element with
 * complete confidence.
 *
 * The failure has a viewport axis, which is what made it hard to see. Score is
 * driven by area, so a layout-scale component shrinks as the viewport narrows
 * while text-scale decoration barely moves. Measured on one page across three
 * widths: the component's area fell 177282 -> 79676 while a chip's held at
 * 4744 -> 3225, and the chip climbed from rank 14 to rank 2. At some width it
 * wins. This module is the check that does not care which width that is.
 *
 * The bands are geometry, never names. Nothing here reads a class, a tag or a
 * selector: a `div.card` that renders 40px tall is a chip, and an element called
 * `.chip` that fills a 900px column is not.
 */

export const SCALE = Object.freeze({
  /** Wider and larger than a component: a section wrapper or a page band. */
  SECTION: "section-scale",
  /** Smaller than a component: a pill, tag, label or icon affordance. */
  CHIP: "chip-scale",
  /** The band a page's primary component occupies. */
  COMPONENT: "within-component-scale",
  /** Geometry was not available, so no band was established. */
  UNKNOWN: "scale-unknown"
});

/**
 * Band edges. Deliberately absolute pixel areas rather than viewport fractions,
 * because a chip is a chip at every width — this is what keeps the check free of
 * viewport-specific exceptions. The section test is the exception that needs a
 * ratio, because "spans most of the width" is inherently relative.
 */
export const CHIP_MAX_AREA = 5000;
export const SECTION_MIN_AREA = 500000;
export const SECTION_MIN_WIDTH_SHARE = 0.5;

const usable = (n) => typeof n === "number" && Number.isFinite(n);

/**
 * The band one element's geometry falls in.
 *
 * Identical in behaviour to the classification `component-diagnostics.mjs`
 * carried before this module existed, so `structuralNote` values do not move.
 * A large element whose width is unknown lands in `COMPONENT` here, because the
 * section test cannot be evaluated without a width — admissibility handles that
 * case separately and more strictly, via `geometryComplete`.
 *
 * @param {{area?: number, width?: number, viewportWidth?: number}} geometry
 * @returns {string} one of SCALE
 */
export function classifyScale({ area, width, viewportWidth } = {}) {
  if (!usable(area)) return SCALE.UNKNOWN;
  if (area < CHIP_MAX_AREA) return SCALE.CHIP;

  const share = usable(width) && usable(viewportWidth) && viewportWidth > 0
    ? width / viewportWidth
    : null;
  if (area >= SECTION_MIN_AREA && share != null && share >= SECTION_MIN_WIDTH_SHARE) {
    return SCALE.SECTION;
  }
  return SCALE.COMPONENT;
}

/**
 * Whether every number the bands rest on was actually measured.
 *
 * Separate from `classifyScale` on purpose. Classification answers "which band",
 * and answers `COMPONENT` for a large element of unknown width because that is
 * the honest reading of what the bands can distinguish. Admissibility asks a
 * stricter question — "do we know enough to let this license a prompt" — and an
 * absent measurement is not a pass. Absence is not zero and is not admissible.
 */
export function geometryComplete({ area, width, viewportWidth } = {}) {
  return usable(area) && usable(width) && usable(viewportWidth) && viewportWidth > 0;
}

/**
 * Whether a band may be a page's primary component.
 *
 * Only `COMPONENT` may. `UNKNOWN` may not, because an unestablished scale is not
 * an established one.
 */
export function isAdmissiblePrimary(scale) {
  return scale === SCALE.COMPONENT;
}

/**
 * The admissibility verdict for one element's geometry, with the reason it holds.
 *
 * Returns a band even when it refuses, so a reader is told which way the element
 * was wrong — too small or too large are different findings with different
 * responses, and collapsing them into "inadmissible" would lose that.
 */
export function admitPrimary(geometry = {}) {
  const complete = geometryComplete(geometry);
  const scale = classifyScale(geometry);

  if (!complete) {
    return {
      admissible: false,
      scale: SCALE.UNKNOWN,
      measuredScale: scale,
      geometryComplete: false,
      reason:
        "the selected component's rendered geometry was not available, so its structural scale " +
        "could not be established. An unmeasured scale is not a small one and not a large one; " +
        "it is unknown, and unknown does not license an implementation prompt."
    };
  }

  if (scale === SCALE.CHIP) {
    return {
      admissible: false, scale, measuredScale: scale, geometryComplete: true,
      reason:
        `the selected component occupies ${Math.round(geometry.area)}px2, below the ` +
        `${CHIP_MAX_AREA}px2 floor for a component. An element this small is a pill, tag, label ` +
        "or icon affordance rather than a page's primary component. It resolves surface " +
        "properties readily — chips have a background, a radius and padding — so counting those " +
        "properties cannot tell it apart from a component, and this check exists because that " +
        "count already passed."
    };
  }

  if (scale === SCALE.SECTION) {
    const share = geometry.width / geometry.viewportWidth;
    return {
      admissible: false, scale, measuredScale: scale, geometryComplete: true,
      reason:
        `the selected component occupies ${Math.round(geometry.area)}px2 and spans ` +
        `${(share * 100).toFixed(0)}% of the viewport width, at or above the ` +
        `${SECTION_MIN_AREA}px2 and ${(SECTION_MIN_WIDTH_SHARE * 100).toFixed(0)}% thresholds ` +
        "for a section. An element this large is a section wrapper or page band rather than a " +
        "component, and a prompt describing it as one would have the whole page rebuilt as a card."
    };
  }

  return {
    admissible: true, scale, measuredScale: scale, geometryComplete: true,
    reason:
      `the selected component occupies ${Math.round(geometry.area)}px2 at ` +
      `${Math.round(geometry.width)}px wide, within the band a primary component occupies.`
  };
}

/**
 * Screenshot status ceilings.
 *
 * A screenshot is a legitimate input and a categorically weaker one. The
 * weakness is not uniform, which is why a single blanket "everything is
 * estimated" rule would be both too harsh and too generous:
 *
 *   - A pixel measured against a KNOWN viewport scale is genuinely observed.
 *     The image says the card is 320px wide, and at 1:1 scale that is a fact.
 *   - The same measurement at an unknown scale is an estimate, because the
 *     number has no unit until the scale is known.
 *   - "The heading sits above the body text" is observed regardless of scale —
 *     a qualitative relationship survives any rescaling.
 *   - Nothing read from an image is ever `measured`. That status is reserved
 *     for geometry read off a live layout engine.
 *
 * Some claims cannot be made from an image at ALL. Those are not downgraded —
 * they are refused, because a low-confidence answer to an unanswerable question
 * is worse than no answer.
 */

import { STATUS } from "../evidence/status.mjs";

export const SCREENSHOT_TECHNIQUE = Object.freeze({
  VISUAL_OBSERVATION: "visual-observation",
  PIXEL_MEASUREMENT: "pixel-measurement",
  OCR: "OCR",
  REGION_COMPARISON: "region-comparison"
});

export const ALL_SCREENSHOT_TECHNIQUES = Object.freeze(Object.values(SCREENSHOT_TECHNIQUE));

/**
 * Claims an image cannot support, at any confidence, ever.
 *
 * Each is unanswerable for a structural reason rather than a quality one: no
 * amount of resolution reveals a CSS custom property, and no single frame
 * contains a duration.
 */
export const FORBIDDEN_CLAIMS = Object.freeze({
  "tokens.customProperties": "CSS custom properties are declarations, not pixels. An image cannot show that a colour came from a token rather than a literal.",
  "layout.breakpoints": "A media-query breakpoint is a rule about widths that were not rendered. A frame shows one width.",
  "layout.zLayers": "Stacking order is only visible where elements overlap, and the z-index integer is never visible at all.",
  "tokens.typography.body.fontFamily": "Rendered glyphs do not identify a font file, family name, or fallback stack.",
  "tokens.motion.base.duration": "A still frame contains no time.",
  "tokens.motion.base.easing": "An easing curve is a function of time, which a frame does not have.",
  "motion.keyframes": "Keyframe definitions are stylesheet rules.",
  "dom.hierarchy": "An image shows paint order and adjacency, not parentage.",
  "states.hidden": "An element that is not rendered leaves no trace in the image.",
  "states.focusVisible": "Focus styling can only be observed in a frame that captured a focused element.",

  /* Media facts an image cannot yield.
   *
   * A frame can show that something picture-shaped occupies a region, and its
   * rendered box is measurable off the pixels like any other box — so
   * `renderedWidth`, `renderedHeight` and `aspectRatio` are NOT here. They are
   * capped to `estimated` by the ordinary screenshot ceiling.
   *
   * These four are different in kind. Each names something that exists in the
   * document rather than in the paint. */
  "assets.count": "A frame shows painted regions, not elements. A background-image, an inline SVG and an <img> are indistinguishable once rendered, so no count of media ELEMENTS can be read from one.",
  "dom.mediaTag": "Whether a region was painted by an img, a picture, a video or a CSS background is a document fact, not a visual one."
});

/** Claim prefixes that are forbidden regardless of the specific leaf. */
const FORBIDDEN_PREFIXES = [
  ["tokens.motion.", "A still frame contains no timing information."],
  ["source.customProperty", "CSS custom properties are declarations, not pixels."],

  /* Declared motion, in full.
   *
   * `tokens.motion.` was already here; `motion.` was not, so the per-element
   * claims added for declared-motion extraction would have escaped the ceiling
   * entirely and a screenshot could have reported an `animation-delay`. Every
   * one of these is a stylesheet declaration — an animation name, a duration, a
   * fill mode — and a frame contains none of them. It does not even contain the
   * time an animation would need to occupy. */
  ["motion.", "Declared motion lives in stylesheet rules and unfolds over time. A still frame has neither: it cannot show that an element declares an animation, and it cannot show how long one lasts."],
  /* Observed runtime motion (M2a) is strictly further out of reach than
   * declared motion. A declaration is at least written down somewhere; a
   * runtime change exists only as the difference between two instants, and a
   * single frame is one instant. A causal claim needs a third thing — a
   * control — which a screenshot cannot supply either. */
  ["motion.observed", "A runtime change is the difference between two instants. A frame is one instant, so it contains neither the change nor the control that would attribute it to anything."]
];

/**
 * Claim SUFFIXES that are forbidden wherever they appear.
 *
 * Separate from the prefix list because these are per-element leaves under an
 * indexed path — `assets.items.3.objectFit` — and no fixed prefix reaches them
 * without also catching the geometry leaves beside them, which a frame CAN
 * support at `estimated`.
 *
 * Every entry names something that exists in the document rather than in the
 * paint, which is the same test the prefix list applies.
 */
const FORBIDDEN_SUFFIXES = [
  [".objectFit", "`object-fit` describes how a source image was fitted into its box. A frame shows the result, not the rule that produced it — a pre-cropped photo and a cover-fitted one are identical once painted."],
  [".hasAlt", "An alt attribute is markup. It has no visual representation at all."],
  [".intrinsicWidth", "The intrinsic size is the source file's own dimensions. A frame shows the rendered box, which is what the layout did to it."],
  [".intrinsicHeight", "The intrinsic size is the source file's own dimensions. A frame shows the rendered box, which is what the layout did to it."],
  [".tag", "An element's tag name is markup, not paint."]
];

export function forbiddenReason(claim) {
  if (FORBIDDEN_CLAIMS[claim]) return FORBIDDEN_CLAIMS[claim];
  for (const [prefix, reason] of FORBIDDEN_PREFIXES) {
    if (claim.startsWith(prefix)) return reason;
  }
  for (const [suffix, reason] of FORBIDDEN_SUFFIXES) {
    if (claim.endsWith(suffix)) return reason;
  }
  return null;
}

export const isForbiddenClaim = (claim) => forbiddenReason(claim) !== null;

/**
 * The ceiling for one screenshot observation.
 *
 * @param {string}  technique   one of SCREENSHOT_TECHNIQUE
 * @param {boolean} scaleKnown  is the image's pixel-to-CSS-pixel scale known
 * @param {boolean} qualitative is the claim a relationship rather than a quantity
 */
export function screenshotCeiling({ technique, scaleKnown = false, qualitative = false }) {
  switch (technique) {
    case SCREENSHOT_TECHNIQUE.PIXEL_MEASUREMENT:
      // A number without a scale is a number without a unit.
      return scaleKnown ? STATUS.OBSERVED : STATUS.ESTIMATED;

    case SCREENSHOT_TECHNIQUE.VISUAL_OBSERVATION:
      // Relationships survive rescaling; quantities do not.
      return qualitative ? STATUS.OBSERVED : STATUS.ESTIMATED;

    case SCREENSHOT_TECHNIQUE.OCR:
      // Transcribed text is what it is; anything geometric derived from it is not.
      return qualitative ? STATUS.OBSERVED : STATUS.ESTIMATED;

    case SCREENSHOT_TECHNIQUE.REGION_COMPARISON:
      // Comparing two regions of the same image is scale-independent.
      return qualitative ? STATUS.OBSERVED : scaleKnown ? STATUS.OBSERVED : STATUS.ESTIMATED;

    default:
      return STATUS.ESTIMATED;
  }
}

const RANK = {
  [STATUS.MEASURED]: 4,
  [STATUS.OBSERVED]: 3,
  [STATUS.INFERRED]: 2,
  [STATUS.ESTIMATED]: 1,
  [STATUS.UNKNOWN]: 0
};

/**
 * Applies the ceiling to a proposed status.
 *
 * `measured` is unreachable by construction: no branch above returns it, and
 * the clamp can only lower. An inference stays an inference — the ceiling caps
 * how strong a claim may be, it never promotes a weak one.
 */
export function applyScreenshotCeiling(proposedStatus, context) {
  if (proposedStatus === STATUS.UNKNOWN) return STATUS.UNKNOWN;
  if (proposedStatus === STATUS.INFERRED) return STATUS.INFERRED;
  if (proposedStatus === STATUS.ESTIMATED) return STATUS.ESTIMATED;

  const ceiling = screenshotCeiling(context);
  return RANK[proposedStatus] > RANK[ceiling] ? ceiling : proposedStatus;
}

/** Standard limitation notes attached to screenshot evidence. */
export const LIMITATIONS = Object.freeze({
  NO_SCALE: "The image's scale relative to CSS pixels is unknown, so this value has no verified unit.",
  SINGLE_FRAME: "Derived from a single frame; anything time-dependent is outside what the image can show.",
  NO_DOM: "No DOM was available, so this describes rendered appearance rather than declared style.",
  ANTIALIASING: "Edge position is subject to antialiasing and may be off by a pixel.",
  COMPRESSION: "Colour values may be affected by image compression.",
  OCCLUSION: "Overlapping elements may hide part of the measured region.",
  INFERRED_REGION: "The region was detected rather than supplied, so its bounds are themselves an inference."
});

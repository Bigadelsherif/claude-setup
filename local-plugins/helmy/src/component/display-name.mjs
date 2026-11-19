/**
 * Which selector a person should be shown for a component.
 *
 * Presentation only. Nothing here decides anything about the evidence: the
 * judgement of whether a class selector is worth reading was already made in the
 * evidence layer, which emits `component.card.stableSelector` precisely when the
 * class-based one carries too little identity (def_0054). This module reads that
 * decision rather than repeating it, so the two can never disagree.
 *
 * The raw class selector remains the component's machine-readable identity and
 * stays first in `ir.components[].selectors`. It is what a fidelity comparison
 * matches on and what a correction addresses. What changes is only the string a
 * blocker message puts in front of someone: `div.testimonials-spacer > div >
 * section.testimonials-section > div.testimonial-carousel > div >
 * div.testimonial-card` instead of 326 characters of escaped Tailwind.
 */

/**
 * @param {object} component  an IR component, or anything carrying
 *                            `stableSelector` and `selectors`
 * @returns {string|null} the selector to show a reader
 */
export function displaySelector(component) {
  if (!component) return null;
  const stable = component.stableSelector;
  if (typeof stable === "string" && stable.length) return stable;
  const raw = component.selectors?.[0] ?? component.selector ?? null;
  return typeof raw === "string" && raw.length ? raw : null;
}

/**
 * The same choice, plus whether it differs from the machine identity.
 *
 * A caller that wants to say "shown as X, matched as Y" needs to know that the
 * two are different without comparing strings itself.
 */
export function selectorForDisplay(component) {
  const raw = component?.selectors?.[0] ?? component?.selector ?? null;
  const shown = displaySelector(component);
  return {
    shown,
    raw,
    substituted: !!shown && !!raw && shown !== raw
  };
}

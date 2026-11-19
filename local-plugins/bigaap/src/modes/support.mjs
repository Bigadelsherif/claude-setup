/**
 * What kind of answer a page can support, and why.
 *
 * The gate this sits beside answers one question — may a prompt be generated —
 * and answers it with a boolean. That was right while the only output was a
 * single-component prompt, and it is wrong for the product goal: "not enough
 * evidence for a card's border-radius" and "the page is behind a login" and
 * "the page is a WebGL canvas" are three completely different situations that a
 * boolean renders identically, and a reader who cannot tell them apart cannot
 * tell whether to retry, log in, or give up.
 *
 * So refusal becomes a classification. Two of the eight classes permit output;
 * six explain why there is none, each naming what would change the answer.
 *
 * This module CLASSIFIES. It does not gate, does not set thresholds, and does
 * not decide what a prompt contains — the existing requirements and safety gates
 * keep doing that, unchanged. What it adds is the vocabulary those decisions are
 * reported in.
 */

export const SUPPORT_CLASS = Object.freeze({
  /** Enough evidence for a clone prompt that can be relied on. */
  ANALYZABLE: "analyzable",
  /** A useful prompt, with limitations that must travel with it. */
  ANALYZABLE_WITH_WARNINGS: "analyzable-with-warnings",
  /** Bounded discovery ran out before the page stopped changing. */
  CAPTURE_INCOMPLETE: "capture-incomplete",
  /** The content needs an action this tool will not take on its own. */
  INTERACTION_REQUIRED: "interaction-required",
  /** Behind a login. The user must authenticate; this tool never will. */
  AUTHENTICATION_REQUIRED: "authentication-required",
  /** A bot check stands in front of the page. Never to be defeated. */
  ANTI_AUTOMATION_BLOCKED: "anti-automation-blocked",
  /** Rendered by a surface this tool cannot read: canvas, video, WebGL. */
  UNSUPPORTED_RENDERING: "unsupported-rendering",
  /** Observed fine, and what was there is not enough to build from. */
  INSUFFICIENT_EVIDENCE: "insufficient-evidence"
});

/** The two classes under which output may be produced at all. */
export const PRODUCES_OUTPUT = Object.freeze([
  SUPPORT_CLASS.ANALYZABLE,
  SUPPORT_CLASS.ANALYZABLE_WITH_WARNINGS
]);

export const producesOutput = (cls) => PRODUCES_OUTPUT.includes(cls);

/**
 * What each class means and what would change it. Carried as data so the CLI,
 * the artifacts and the docs all say the same thing about a given class.
 */
export const SUPPORT_DETAIL = Object.freeze({
  [SUPPORT_CLASS.ANALYZABLE]: {
    label: "Analyzable",
    meaning: "The evidence supports a clone prompt that can be relied on.",
    remedy: null
  },
  [SUPPORT_CLASS.ANALYZABLE_WITH_WARNINGS]: {
    label: "Analyzable with warnings",
    meaning: "A useful prompt is possible; named gaps travel with it and must not be filled in.",
    remedy: "Read the limitations before building. Each names what was not established."
  },
  [SUPPORT_CLASS.CAPTURE_INCOMPLETE]: {
    label: "Capture incomplete",
    meaning: "Discovery hit its budget while the page was still changing, so what was seen is a prefix of the page.",
    remedy: "Re-run with a larger discovery budget, or accept a prompt for the part that settled."
  },
  [SUPPORT_CLASS.INTERACTION_REQUIRED]: {
    label: "Interaction required",
    meaning: "The content is behind an action — a menu, a dialog, a step — that was not safe to induce automatically.",
    remedy: "Drive the page to the state you want, then capture it."
  },
  [SUPPORT_CLASS.AUTHENTICATION_REQUIRED]: {
    label: "Authentication required",
    meaning: "The page is behind a login.",
    remedy: "Sign in yourself in your own browser session. This tool never handles credentials."
  },
  [SUPPORT_CLASS.ANTI_AUTOMATION_BLOCKED]: {
    label: "Anti-automation blocked",
    meaning: "A bot check or challenge stands in front of the page.",
    remedy: "Nothing here will bypass it, by policy. Capture a page you are permitted to automate."
  },
  [SUPPORT_CLASS.UNSUPPORTED_RENDERING]: {
    label: "Unsupported rendering",
    meaning: "The page draws itself with a surface this tool cannot read — canvas, video or WebGL — so there is no DOM to measure.",
    remedy: "None available. A pixel-only surface carries no style evidence to extract."
  },
  [SUPPORT_CLASS.INSUFFICIENT_EVIDENCE]: {
    label: "Insufficient evidence",
    meaning: "The page was observed successfully and what it contains is not enough to build from.",
    remedy: "This is a finding about the page, not the capture. Re-capturing will not add what is not there."
  }
});

/**
 * Classifies one viewport's run.
 *
 * Ordered by what a reader can act on. A login wall makes every downstream
 * measurement meaningless, so it is reported ahead of a thin component; a
 * truncated sweep is reported ahead of "not enough evidence", because the
 * evidence may well exist in the part never reached. The last two are the
 * genuine judgements about content, and they come last so they are never used
 * to explain a capture that did not happen.
 *
 * Every input is a fact recorded elsewhere. This function measures nothing and
 * infers nothing; it orders findings that already exist.
 *
 * @param {object} signals
 * @param {boolean} [signals.authWall]         a sign-in wall was detected
 * @param {boolean} [signals.antiAutomation]   a challenge or bot check was detected
 * @param {boolean} [signals.unsupportedSurface] canvas/video/WebGL dominates the page
 * @param {boolean} [signals.captureTruncated] discovery stopped on budget
 * @param {boolean} [signals.interactionGated] content sits behind an un-induced action
 * @param {boolean} [signals.evidenceSufficient] the mode requirements were satisfied
 * @param {string[]} [signals.warnings]        named limitations to carry
 */
export function classifySupport(signals = {}) {
  const {
    authWall = false,
    antiAutomation = false,
    unsupportedSurface = false,
    captureTruncated = false,
    interactionGated = false,
    evidenceSufficient = false,
    warnings = []
  } = signals;

  const decide = () => {
    if (antiAutomation) return SUPPORT_CLASS.ANTI_AUTOMATION_BLOCKED;
    if (authWall) return SUPPORT_CLASS.AUTHENTICATION_REQUIRED;
    if (unsupportedSurface) return SUPPORT_CLASS.UNSUPPORTED_RENDERING;
    if (captureTruncated) return SUPPORT_CLASS.CAPTURE_INCOMPLETE;
    if (interactionGated) return SUPPORT_CLASS.INTERACTION_REQUIRED;
    if (!evidenceSufficient) return SUPPORT_CLASS.INSUFFICIENT_EVIDENCE;
    return warnings.length > 0
      ? SUPPORT_CLASS.ANALYZABLE_WITH_WARNINGS
      : SUPPORT_CLASS.ANALYZABLE;
  };

  const supportClass = decide();
  return {
    supportClass,
    producesOutput: producesOutput(supportClass),
    ...SUPPORT_DETAIL[supportClass],
    warnings: [...warnings]
  };
}

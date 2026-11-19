/**
 * Moved to `src/evidence/disagreement.mjs`.
 *
 * Disagreement analysis started here because screenshots were the first second
 * source, but it is not a screenshot concern — it compares any two evidence
 * sources, including DOM against computed style, or either against a user
 * correction. Keeping it under `screenshot/` would have implied otherwise.
 *
 * This re-export exists so existing imports keep working; new code should
 * import from the canonical location.
 */
export {
  DISAGREEMENT_TYPE,
  RESOLUTION,
  TOLERANCE,
  preferenceFor,
  buildDisagreement,
  detectDisagreements,
  contestClaim,
  resetDisagreementIds,
  isCriticalClaim,
  CRITICAL_CLAIM_PATTERNS
} from "../evidence/disagreement.mjs";

export { preferenceFor as appropriateSourceFor } from "../evidence/disagreement.mjs";

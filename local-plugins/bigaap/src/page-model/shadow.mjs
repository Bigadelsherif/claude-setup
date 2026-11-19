/**
 * The shadow pipeline's pure middle: observations in, a page model and its
 * support classification out.
 *
 * Everything in this file is deterministic and browser-free — a caller
 * supplies the observation stream `collectObservations` already produced (or
 * a synthetic one built the same way in a test) and the facts the capture
 * layer recorded about itself (`hiddenDominant`, `truncated`, and so on), and
 * gets back exactly what `normalize.buildEvidence` and `model.buildPageModel`
 * would produce from them. Separating this from `src/capture/inspect.mjs`
 * means the CLI's decision logic — what counts as insufficient evidence, what
 * a malformed observation looks like — is testable without a browser, the
 * same split `observe.mjs`/`settle.mjs` already draw between algorithm and
 * driver.
 *
 * This module decides nothing new. It calls `normalize.buildEvidence` and
 * `model.buildPageModel` exactly as documented and validates what they return;
 * it does not gate, does not lower a threshold, and does not generate a
 * prompt of any kind.
 */

import { buildEvidence, validateNormalizedEvidence } from "../evidence/normalize.mjs";
import { buildPageModel, validatePageModel } from "./model.mjs";

export const SHADOW_ARTIFACT_VERSION = "1";

/** Properties worth recording as explicitly `unknown` when nothing carried them. */
const DEFAULT_EXPECTED_PROPERTIES = ["assets", "controls"];

/**
 * A precise, structured failure — never a bare thrown string.
 *
 * The CLI catches this and reports it as a `failed` result naming exactly
 * which observation and field was malformed; a caller that only wants the
 * pipeline can let it propagate.
 */
export class ShadowPipelineError extends Error {
  constructor(stage, problems) {
    const detail = problems.map((p) => `${p.where}: ${p.message}`).join("; ");
    super(`shadow page-model pipeline failed at ${stage} — ${detail}`);
    this.name = "ShadowPipelineError";
    this.stage = stage;
    this.problems = problems;
  }
}

/**
 * Builds one viewport's normalized evidence and page model from an
 * observation stream.
 *
 * @param {object[]} observations        the `observations` array from `collectObservations`
 * @param {number} viewport              the viewport width these observations belong to
 * @param {object} [options]
 * @param {number} [options.height]      the viewport height, if known
 * @param {string[]} [options.expectedProperties]
 * @param {{hiddenDominant?:boolean, truncated?:boolean, authWall?:boolean,
 *          antiAutomation?:boolean, interactionGated?:boolean}} [options.captureFacts]
 *        facts the capture layer recorded about itself — never inferred here
 * @param {string|null} [options.title]
 */
export function buildShadowViewportArtifacts(observations, viewport, options = {}) {
  const {
    height = null,
    expectedProperties = DEFAULT_EXPECTED_PROPERTIES,
    captureFacts = {},
    title = null,
    /* Crop results, keyed by DOM path, from the capture pass. Absent means no
     * visual capture was run — every visual is then reported as not-attempted
     * rather than silently missing. */
    visualResults = new Map(),
    canCaptureVisuals = false,
    /* Observed interaction states for this viewport, or null when discovery did
     * not run. Null and empty mean different things and are kept apart. */
    interactionEvidence = null
  } = options;

  let normalized;
  try {
    normalized = buildEvidence(observations, { width: viewport, height }, { expectedProperties, visualResults, canCaptureVisuals });
  } catch (err) {
    /* `buildEvidence` already validated its input and threw with the precise
     * complaint; this only re-shapes it into the same `{stage, problems}`
     * contract every other failure in this module uses, rather than letting
     * one stage's error read differently from another's. */
    throw new ShadowPipelineError("normalize", [{ where: "observations", message: String(err.message ?? err) }]);
  }

  const normCheck = validateNormalizedEvidence(normalized);
  if (!normCheck.valid) throw new ShadowPipelineError("normalize-validate", normCheck.problems);

  const model = buildPageModel(normalized, { capture: captureFacts, title, interactionEvidence });

  const modelCheck = validatePageModel(model, normalized);
  if (!modelCheck.valid) throw new ShadowPipelineError("page-model-validate", modelCheck.problems);

  return {
    $shadowArtifact: SHADOW_ARTIFACT_VERSION,
    viewport: { width: viewport, height },
    normalized,
    model,
    support: model.support
  };
}

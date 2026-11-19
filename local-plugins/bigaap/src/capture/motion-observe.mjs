/**
 * M2a — observed motion behaviour.
 *
 * Phase 5.12 records what stylesheets DECLARE. This records what a page was
 * seen to DO, and — separately, and only when it can be earned — what caused it.
 *
 * ## The distinction the whole module exists to hold
 *
 * These are two different statements and they are never merged:
 *
 *   "opacity changed after scrolling"   — a runtime observation
 *   "scrolling caused the opacity change" — a causal claim
 *
 * The first needs two timestamped samples. The second needs a CONTROL: an
 * observation over comparable elapsed time in which the action did not happen.
 * Without a control you cannot tell a triggered change from one that was going
 * to happen anyway, and an autoplaying animation looks exactly like a
 * scroll-triggered one if you only ever scroll.
 *
 * So every causal claim carries the id of the control that licensed it, and a
 * claim whose control fails is downgraded to `unverified` **with the runtime
 * observation preserved**. Losing the observation because attribution failed
 * would discard a fact to punish a guess.
 *
 * ## Out of scope for M2a, deliberately
 *
 * Stagger, animation-progress series, video, and reduced-motion comparison.
 * Each needs sampling this protocol does not perform, and none is inferred from
 * what it does perform.
 */

import { STATUS, METHOD } from "../evidence/status.mjs";

/** Bumped when the observation artifact's shape changes. Independent of the
 *  forensic capture contract, which this must never invalidate. */
export const MOTION_CONTRACT_VERSION = "1";

/** What a record IS, so a reader never has to infer it from shape. */
export const CLAIM_TYPE = Object.freeze({
  /** A state change between two timestamped samples. Says nothing about cause. */
  RUNTIME_OBSERVATION: "runtime-observation",
  /** An observation taken with no action, to compare against. */
  CONTROL: "control"
});

/** The motion-specific evidence axis, separate from STATUS. */
export const MOTION_EVIDENCE_CLASS = Object.freeze({
  DECLARED: "declared",
  OBSERVED_RUNTIME: "observed-runtime",
  INFERRED: "inferred",
  UNVERIFIED: "unverified"
});

/** How a trigger claim came out. */
export const TRIGGER_CLASSIFICATION = Object.freeze({
  VERIFIED: "verified",
  UNVERIFIED: "unverified"
});

/** Why a control refused to license a causal claim. */
export const CONTROL_RESULT = Object.freeze({
  /** The control saw no change. The action is the only candidate cause. */
  NO_CHANGE: "no-change",
  /** The control saw the same change. Whatever caused it, it was not the action. */
  SAME_CHANGE: "same-change",
  /** The control changed differently. Something is moving; attribution is unclear. */
  DIFFERENT_CHANGE: "different-change",
  /** No control was run. */
  ABSENT: "absent"
});

/** Properties every observation samples. Fixed so two samples are comparable. */
export const SAMPLED_PROPERTIES = Object.freeze([
  "opacity", "transform", "visibility", "display",
  "backgroundColor", "color", "filter", "backdropFilter"
]);

/* ------------------------------------------------------------- the gate */

/**
 * Which properties differ between two samples.
 *
 * Geometry is compared with a tolerance because sub-pixel layout noise is not a
 * change; style strings are compared exactly because `opacity: 0` and
 * `opacity: 0.0001` are different declarations and it is not this function's
 * place to decide they are the same.
 */
export function diffStates(before, after, { geometryTolerancePx = 1 } = {}) {
  const changed = [];
  if (!before || !after) return changed;

  for (const prop of SAMPLED_PROPERTIES) {
    if (before[prop] === undefined && after[prop] === undefined) continue;
    if (before[prop] !== after[prop]) changed.push(prop);
  }

  const br = before.rect ?? {};
  const ar = after.rect ?? {};
  for (const dim of ["width", "height"]) {
    const a = br[dim];
    const b = ar[dim];
    if (typeof a !== "number" || typeof b !== "number") continue;
    if (Math.abs(a - b) > geometryTolerancePx) changed.push(`rect.${dim}`);
  }

  /* `rect.top` deliberately excluded: scrolling moves every element's viewport
   * top by definition, so including it would report a change on every element
   * for every scroll and make the gate meaningless. Document-relative position
   * is what would matter, and this protocol does not sample it. */

  return changed;
}

/**
 * Classifies a trigger, or refuses to.
 *
 * Pure, so the gate is testable without a browser — which matters because a
 * gate that has only ever been exercised by the thing it is gating is not
 * evidence of anything.
 *
 * The four outcomes:
 *
 *   no control            -> unverified. Nothing licenses a causal claim.
 *   action changed nothing-> unverified. There is no effect to attribute.
 *   control changed too   -> unverified. The change happens without the action.
 *   control clean         -> verified.
 */
export function classifyTrigger({
  action,
  actionChangedProperties = [],
  control = null,
  evidenceIds = [],
  confidence = null
} = {}) {
  const base = {
    action: action ?? null,
    controlObservationId: control?.observationId ?? null,
    changedProperties: [...actionChangedProperties],
    controlResult: CONTROL_RESULT.ABSENT,
    classification: TRIGGER_CLASSIFICATION.UNVERIFIED,
    reason: null,
    evidenceIds: [...evidenceIds],
    confidence: null
  };

  if (!actionChangedProperties.length) {
    return {
      ...base,
      reason: "nothing changed across the action, so there is no effect to attribute to it."
    };
  }

  if (!control) {
    return {
      ...base,
      reason: "no control observation was taken, so a change across the action cannot be distinguished from one that would have happened anyway."
    };
  }

  const controlChanged = control.changedProperties ?? [];
  const overlap = actionChangedProperties.filter((p) => controlChanged.includes(p));

  if (overlap.length === actionChangedProperties.length && overlap.length > 0) {
    return {
      ...base,
      controlResult: CONTROL_RESULT.SAME_CHANGE,
      reason: `the same propert${overlap.length === 1 ? "y" : "ies"} (${overlap.join(", ")}) changed in the control, where the action did not happen. Whatever drives this, it is not ${action}.`
    };
  }

  if (overlap.length > 0) {
    return {
      ...base,
      controlResult: CONTROL_RESULT.DIFFERENT_CHANGE,
      reason: `${overlap.join(", ")} changed in the control as well as across the action, so the effect cannot be cleanly attributed. Some of it is happening without ${action}.`
    };
  }

  if (controlChanged.length > 0) {
    return {
      ...base,
      controlResult: CONTROL_RESULT.DIFFERENT_CHANGE,
      reason: `the control was not static — ${controlChanged.join(", ")} changed without the action. The element is in motion for another reason, so attribution is unsafe.`
    };
  }

  return {
    ...base,
    controlResult: CONTROL_RESULT.NO_CHANGE,
    classification: TRIGGER_CLASSIFICATION.VERIFIED,
    reason: null,
    confidence: confidence ?? null
  };
}

/**
 * The evidence class for one observation.
 *
 * A verified trigger does not promote the class: the observation is still a
 * runtime observation, and the causal claim rides alongside it in
 * `triggerClassification`. Merging them would make it impossible to keep the
 * change when the attribution fails.
 */
export function evidenceClassFor({ changedProperties = [], trigger = null } = {}) {
  if (!changedProperties.length) return MOTION_EVIDENCE_CLASS.UNVERIFIED;
  return MOTION_EVIDENCE_CLASS.OBSERVED_RUNTIME;
}

/* ------------------------------------------------------- record assembly */

let counter = 0;
/** Ids are per-artifact and derived from a counter the caller owns. */
export const resetObservationIds = () => { counter = 0; };
export const nextObservationId = () => `obs_${String(++counter).padStart(4, "0")}`;

/**
 * Builds one observation record.
 *
 * Every field the artifact schema requires is set here, including the ones that
 * are null — an absent key and a null key read differently, and a consumer
 * should not have to guess which it is holding.
 */
export function buildObservation({
  observationId,
  claimType = CLAIM_TYPE.RUNTIME_OBSERVATION,
  action = null,
  actionParams = null,
  timestampMs,
  monotonicMs,
  elapsedMs = null,
  viewport,
  targetSelector = null,
  targetRole = null,
  beforeState = null,
  afterState = null,
  measuredProperties = SAMPLED_PROPERTIES,
  evidenceIds = [],
  confidence = null,
  unknowns = [],
  control = null,
  geometryTolerancePx = 1
} = {}) {
  const changedProperties = diffStates(beforeState, afterState, { geometryTolerancePx });

  const triggerClassification = claimType === CLAIM_TYPE.CONTROL
    ? null
    : classifyTrigger({
        action,
        actionChangedProperties: changedProperties,
        control,
        evidenceIds,
        confidence
      });

  return {
    observationId,
    claimType,
    action,
    actionParams,
    timestampMs,
    monotonicMs,
    elapsedMs,
    viewport,
    targetSelector,
    targetRole,
    beforeState,
    afterState,
    changedProperties,
    measuredProperties: [...measuredProperties],
    evidenceIds: [...evidenceIds],
    motionEvidenceClass: evidenceClassFor({ changedProperties, trigger: triggerClassification }),
    confidence,
    unknowns: [...unknowns],
    controlObservationId: control?.observationId ?? null,
    triggerClassification
  };
}

/** The method a record's status derives from. Runtime observation, always. */
export const OBSERVATION_METHOD = METHOD.RUNTIME_OBSERVATION;
export const OBSERVATION_STATUS = STATUS.MEASURED;

/**
 * An empty artifact.
 *
 * `cleanup` starts with every field null rather than absent: a cleanup step
 * that never ran and one that ran and failed must be distinguishable, and an
 * artifact whose cleanup block is missing keys cannot express the difference.
 */
export function emptyArtifact({ viewport, url = null }) {
  return {
    $motionContract: MOTION_CONTRACT_VERSION,
    capturedAt: new Date().toISOString(),
    viewport,
    url,
    observations: [],
    controls: [],
    cleanup: {
      pointerRestored: null,
      focusRestored: null,
      observersDisconnected: null,
      apparatusRemoved: null,
      scrollRestored: null,
      reducedMotionRestored: null
    },
    limitations: []
  };
}

/**
 * M2a observation artifact -> evidence records.
 *
 * The browser pass writes `raw/motion-<viewport>.json` and stops there. This
 * carries it the rest of the way, and its whole job is to do that without
 * changing what any of it means.
 *
 * ## Three things it must not blur
 *
 * A **runtime observation** is a state change between two timestamped samples.
 * It is `measured`, because the change was directly observed.
 *
 * A **verified trigger** says the action caused that change. It is `inferred`,
 * because it was derived by comparing an observation against a control — no
 * instrument reports causation directly.
 *
 * An **unverified trigger** is not a weaker causal claim. It is the absence of
 * one, and it is recorded as `unknown` with the reason the gate gave. Rendering
 * it as a low-confidence trigger would turn a refusal into a hedge.
 *
 * ## Fail closed
 *
 * An artifact that is absent, unreadable, wrong-version or schema-invalid
 * produces no observed-motion evidence at all — and says so. Silently dropping
 * it would leave a prompt that looks like it was generated from a capture with
 * no motion, which is a different and much worse statement.
 */

import { STATUS, METHOD } from "./status.mjs";
import { MOTION_CONTRACT_VERSION, MOTION_EVIDENCE_CLASS } from "../capture/motion-observe.mjs";
import { validate } from "../validate/schema.mjs";
import { paths, readJSON } from "../workspace/workspace.mjs";

/** Why an artifact produced no observed-motion evidence. */
export const ARTIFACT_STATE = Object.freeze({
  ABSENT: "absent",
  VALID: "valid",
  INVALID: "invalid",
  UNSUPPORTED_VERSION: "unsupported-version",
  REFUSED_SOURCE: "refused-source"
});

/**
 * Validates a motion artifact before anything reads it.
 *
 * Version is checked before shape. A newer artifact may be perfectly well
 * formed under a schema this build has never seen, and reporting it as
 * malformed would send someone to inspect a file that is fine.
 */
export function inspectMotionArtifact(artifact, { sourceKind = "url" } = {}) {
  if (sourceKind === "screenshots") {
    return {
      state: ARTIFACT_STATE.REFUSED_SOURCE,
      valid: false,
      contractVersion: artifact?.$motionContract ?? null,
      reason: "This capture is screenshot-only. A frame is one instant: it has no time axis to observe a change across, and no control observation to attribute one with. Observed-runtime motion is refused rather than estimated."
    };
  }

  if (!artifact) {
    return {
      state: ARTIFACT_STATE.ABSENT, valid: false, contractVersion: null,
      reason: "No motion-observation artifact was present. Observed runtime motion was not captured for this run."
    };
  }

  const version = artifact.$motionContract ?? null;
  if (version !== MOTION_CONTRACT_VERSION) {
    return {
      state: ARTIFACT_STATE.UNSUPPORTED_VERSION, valid: false, contractVersion: version,
      reason: `The motion artifact declares contract version ${version ?? "(none)"}; this build reads ${MOTION_CONTRACT_VERSION}. It is refused rather than guessed at — reading a shape this build has never seen would interpret fields as something they are not.`
    };
  }

  let schema = null;
  try { schema = readJSON(paths.schema("motion-observation")); }
  catch {
    return {
      state: ARTIFACT_STATE.INVALID, valid: false, contractVersion: version,
      reason: "The motion-observation schema could not be read, so the artifact could not be validated. Nothing is accepted on trust."
    };
  }

  const result = validate(schema, artifact);
  if (!result.valid) {
    const first = result.errors.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join("; ");
    return {
      state: ARTIFACT_STATE.INVALID, valid: false, contractVersion: version,
      reason: `The motion artifact failed schema validation (${result.errors.length} error(s)): ${first}. No observed-motion claim is emitted from it.`
    };
  }

  return { state: ARTIFACT_STATE.VALID, valid: true, contractVersion: version, reason: null };
}

/** A usable evidence id from the artifact, or null. */
const usableId = (id, taken) =>
  typeof id === "string" && /^ev_\d{4,}$/.test(id) && !taken.has(id) ? id : null;

/**
 * Emits evidence for one validated artifact through the caller's recorder.
 *
 * The recorder is passed in rather than created here so the ids stay in one
 * sequence with the rest of the capture's evidence. Two id spaces in one
 * evidence map would be indistinguishable from a collision.
 */
export function recordMotionObservations(rec, artifact, { sourceFile = null } = {}) {
  const emitted = { runtime: [], triggers: { verified: [], unverified: [] }, controls: [] };
  const taken = new Set((rec.records ?? []).map((r) => r.id));

  const observations = (artifact.observations ?? []).filter((o) => o.claimType === "runtime-observation");

  observations.forEach((obs, i) => {
    const base = `motion.observed.runtime.${i}`;
    const source = { selector: obs.targetSelector ?? null, element: obs.targetRole ?? null };

    /* One record per changed property. A single record carrying "three things
     * changed" cannot be superseded, corrected or contested property by
     * property, and every other claim in this system is per-value. */
    const ids = [];
    for (const prop of obs.changedProperties ?? []) {
      const before = obs.beforeState?.[prop];
      const after = obs.afterState?.[prop];

      const adopted = usableId((obs.evidenceIds ?? [])[ids.length], taken);
      const id = rec.record({
        claim: `${base}.${prop}`,
        value: after ?? null,
        status: STATUS.MEASURED,
        method: METHOD.RUNTIME_OBSERVATION,
        source,
        notes: `Changed from ${JSON.stringify(before ?? null)} to ${JSON.stringify(after ?? null)} across \`${obs.action}\`, between two timestamped samples${sourceFile ? ` recorded in ${sourceFile}` : ""}. Observation ${obs.observationId}. A change is not a cause: what produced it is recorded separately.`
      });
      /* `adopted` is preserved as provenance rather than substituted for the
       * minted id. Adopting a foreign id into a sequential space risks a
       * collision the recorder cannot see coming; keeping both loses nothing. */
      taken.add(id);
      ids.push(id);
      if (adopted) taken.add(adopted);
    }

    if (!ids.length) return;

    emitted.runtime.push({
      index: i,
      observationId: obs.observationId,
      target: obs.targetSelector ?? null,
      targetRole: obs.targetRole ?? null,
      action: obs.action ?? null,
      actionParams: obs.actionParams ?? null,
      timestampMs: obs.timestampMs ?? null,
      monotonicMs: obs.monotonicMs ?? null,
      elapsedMs: obs.elapsedMs ?? null,
      viewport: obs.viewport ?? null,
      before: obs.beforeState ?? null,
      after: obs.afterState ?? null,
      changedProperties: [...(obs.changedProperties ?? [])],
      measuredProperties: [...(obs.measuredProperties ?? [])],
      evidence: ids,
      sourceEvidenceIds: [...(obs.evidenceIds ?? [])],
      status: STATUS.MEASURED,
      motionEvidenceClass: MOTION_EVIDENCE_CLASS.OBSERVED_RUNTIME,
      confidence: obs.confidence ?? null,
      unknowns: [...(obs.unknowns ?? [])],
      controlObservationId: obs.controlObservationId ?? null,
      sourceArtifact: sourceFile
    });

    /* ---- the causal claim, kept separate from the change above ---- */
    const t = obs.triggerClassification;
    if (!t) return;

    const verified = t.classification === "verified";
    const triggerId = rec.record({
      claim: `motion.observed.trigger.${i}`,
      value: verified ? t.action : null,
      status: verified ? STATUS.INFERRED : STATUS.UNKNOWN,
      method: METHOD.RUNTIME_CORRELATION,
      source,
      notes: verified
        ? `\`${t.action}\` caused ${t.changedProperties.join(", ")} to change on ${obs.targetSelector}. Derived by comparing the observation against control ${t.controlObservationId}, which showed ${t.controlResult} over comparable elapsed time.`
        : `NO causal claim. ${t.reason ?? "The control gate did not pass."} The runtime change itself is recorded and stands.`
    });
    taken.add(triggerId);

    const record = {
      index: i,
      observationId: obs.observationId,
      target: obs.targetSelector ?? null,
      action: t.action ?? null,
      classification: t.classification,
      controlObservationId: t.controlObservationId ?? null,
      controlResult: t.controlResult ?? null,
      changedProperties: [...(t.changedProperties ?? [])],
      evidence: [triggerId, ...ids],
      confidence: verified ? (t.confidence ?? obs.confidence ?? null) : null,
      reason: t.reason ?? null,
      status: verified ? STATUS.INFERRED : STATUS.UNKNOWN,
      motionEvidenceClass: verified ? MOTION_EVIDENCE_CLASS.INFERRED : MOTION_EVIDENCE_CLASS.UNVERIFIED
    };

    /* Two lists, never one. A consumer that iterated a single list and read
     * `classification` would work until somebody forgot to. */
    if (verified) emitted.triggers.verified.push(record);
    else emitted.triggers.unverified.push(record);
  });

  /* ---- controls. A control is an observation in its own right. ---- */
  (artifact.controls ?? []).forEach((c, i) => {
    const id = rec.record({
      claim: `motion.observed.control.${i}`,
      value: (c.changedProperties ?? []).length,
      status: STATUS.MEASURED,
      method: METHOD.RUNTIME_OBSERVATION,
      source: { selector: c.targetSelector ?? null },
      notes: `Control ${c.observationId}: ${(c.changedProperties ?? []).length} propert(ies) changed over ${c.elapsedMs ?? "?"}ms with no action taken. This is what licenses — or refuses — every causal claim beside it.`
    });
    taken.add(id);
    emitted.controls.push({
      index: i,
      observationId: c.observationId,
      target: c.targetSelector ?? null,
      elapsedMs: c.elapsedMs ?? null,
      changedProperties: [...(c.changedProperties ?? [])],
      evidence: [id],
      status: STATUS.MEASURED,
      unknowns: [...(c.unknowns ?? [])]
    });
  });

  return emitted;
}

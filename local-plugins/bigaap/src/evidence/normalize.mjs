/**
 * Normalized evidence: observations turned into an addressable, provenance-
 * carrying model, one viewport at a time.
 *
 * `observe.mjs` produces a stream of sightings — "at scrollY 2700, on this URL,
 * these regions were in view". That is the right shape for discovery and the
 * wrong shape for analysis, which needs to ask "what do we know about this
 * region, and what is that knowledge allowed to support". This layer performs
 * exactly that transformation and nothing else.
 *
 * NAME HAZARD, stated because it is easy to walk into: `src/evidence/build.mjs`
 * also exports `buildEvidence`, and it is a different function doing a different
 * job — it turns one settled extraction into claims. This one turns many
 * observations into normalized regions. They take different arguments, return
 * different shapes, and neither is a drop-in for the other. Import from the
 * module you mean, never from a bare name. `N15` pins that they stay
 * distinguishable.
 *
 * THE PROVENANCE RULES ARE THE POINT. Everything else here is bookkeeping. A
 * value seen only after scrolling is part of the page at rest and is NOT part of
 * what a visitor sees on arrival; a value seen only after an interaction is
 * neither. Those two sentences are enforced structurally rather than by
 * convention, because the moment a scroll-revealed measurement is allowed to
 * answer an above-fold question, the resulting prompt describes a page nobody
 * ever loaded.
 *
 * WHAT THIS LAYER REFUSES TO DO:
 *   - It never averages. Two disagreeing sightings stay two sightings with a
 *     recorded conflict; a mean would be a number no observation supports.
 *   - It never fills in. A property nobody read is `unknown` with a reason, not
 *     a default.
 *   - It never merges viewports. 1440, 768 and 375 are three separate models,
 *     and region ids carry their width so they cannot be confused even by
 *     accident.
 *   - It decides nothing. No gate, no threshold, no sufficiency judgement.
 */

import { OBSERVATION_KIND, CLAIM_SCOPE, claimSupportedBy, identityOf } from "../capture/observe.mjs";
import { planVisualCaptures, visualEvidenceFrom, VISUAL_BUDGET } from "../capture/visual.mjs";

/** Bumped when the SHAPE changes, never when an observation does. */
export const NORMALIZED_EVIDENCE_VERSION = "1";

/**
 * Where in the document an observation was taken from.
 *
 * Derived from recorded numbers, never guessed: it is a label for `scrollY`
 * against the reachable range, kept so a reader can group evidence without
 * re-deriving the arithmetic.
 */
export const SCROLL_POSITION = Object.freeze({
  TOP: "top",
  UPPER: "upper",
  MIDDLE: "middle",
  LOWER: "lower",
  FOOT: "foot"
});

/** What is known about one property on one region. */
export const PROPERTY_STATUS = Object.freeze({
  /** Read directly from at least one observation. */
  OBSERVED: "observed",
  /** Observations disagree. Both values are kept; neither is chosen. */
  CONFLICTED: "conflicted",
  /** Looked for and not present in any observation. Never a default. */
  UNKNOWN: "unknown"
});

export const scrollPositionOf = (scrollY, maxScrollY) => {
  const y = Number(scrollY) || 0;
  if (y <= 0) return SCROLL_POSITION.TOP;
  const max = Number(maxScrollY) || 0;
  if (max <= 0) return SCROLL_POSITION.TOP;
  const ratio = y / max;
  if (ratio >= 0.999) return SCROLL_POSITION.FOOT;
  if (ratio < 0.25) return SCROLL_POSITION.UPPER;
  if (ratio < 0.75) return SCROLL_POSITION.MIDDLE;
  return SCROLL_POSITION.LOWER;
};

/**
 * Observation ids are positional, not temporal.
 *
 * A timestamp would make two identical runs produce two different documents,
 * and the determinism check exists precisely to catch that. Sequence is stable;
 * the clock is not.
 */
const observationId = (viewportWidth, sequence) => `obs-${viewportWidth}-${String(sequence).padStart(3, "0")}`;

/**
 * Region ids carry the viewport width.
 *
 * Not decoration: it makes cross-viewport merging impossible by construction
 * rather than by discipline. Two models can be concatenated by a careless caller
 * and still not collide.
 */
const regionId = (viewportWidth, ordinal) => `r-${viewportWidth}-${String(ordinal).padStart(3, "0")}`;

/** A precise complaint about one malformed input, with where it was found. */
const problem = (where, message) => ({ where, message });

/**
 * Checks the input before anything is built from it.
 *
 * Rejects rather than repairs. An observation missing its scrollY cannot be
 * placed, and guessing zero would silently attribute foot-of-page evidence to
 * the top — which is the exact confusion this layer exists to prevent.
 */
export function validateObservations(observations, viewport) {
  const problems = [];
  if (!Array.isArray(observations)) {
    problems.push(problem("observations", "expected an array of observations"));
    return { valid: false, problems };
  }
  if (observations.length === 0) {
    problems.push(problem("observations", "expected at least one observation; an empty capture is not an empty page"));
  }
  const width = typeof viewport === "number" ? viewport : viewport?.width;
  if (!Number.isFinite(width) || width <= 0) {
    problems.push(problem("viewport", `viewport width must be a positive number, received ${JSON.stringify(viewport)}`));
  }

  observations.forEach((obs, i) => {
    const at = `observations[${i}]`;
    if (!obs || typeof obs !== "object") { problems.push(problem(at, "observation must be an object")); return; }
    if (!Object.values(OBSERVATION_KIND).includes(obs.kind)) {
      problems.push(problem(`${at}.kind`, `unknown observation kind ${JSON.stringify(obs.kind)}`));
    }
    if (!Number.isFinite(obs.scrollY)) {
      problems.push(problem(`${at}.scrollY`, "scrollY must be a number; an unplaced observation cannot be attributed"));
    }
    if (typeof obs.url !== "string" || obs.url.length === 0) {
      problems.push(problem(`${at}.url`, "url is required — evidence must name the document it came from"));
    }
    if (!Array.isArray(obs.regions)) {
      problems.push(problem(`${at}.regions`, "regions must be an array"));
      return;
    }
    obs.regions.forEach((region, j) => {
      const rat = `${at}.regions[${j}]`;
      if (!region || typeof region !== "object") { problems.push(problem(rat, "region must be an object")); return; }
      if (typeof region.domPath !== "string" || !region.domPath) {
        problems.push(problem(`${rat}.domPath`, "domPath is required — it is half of the region's identity"));
      }
      for (const key of ["top", "left", "width", "height"]) {
        if (!Number.isFinite(region[key])) {
          problems.push(problem(`${rat}.${key}`, `${key} must be a number; geometry cannot be partially known`));
        }
      }
    });
  });

  return { valid: problems.length === 0, problems };
}

/** Defence in depth: the survey already bounds text, and this layer does not trust that it did. */
export const TEXT_CAP = 240;

/**
 * Bounded, sanitized region text.
 *
 * Two things are stripped before anything is stored, because a normalized
 * document outlives the run that produced it and gets copied around:
 *
 *   - **URL query strings and fragments inside the copy.** A token, session id
 *     or signed URL pasted into body text is still a secret when it arrives
 *     here as text rather than as an `href`. Origin and path describe the
 *     surface; the rest is removed, the same rule `REGION_SURVEY.safeUrl`
 *     already applies to asset sources and the page URL.
 *   - **Length.** `REGION_SURVEY` caps at 240 and this re-caps at 240 anyway:
 *     a caller handing this layer an unbounded string is a caller this layer
 *     should not be able to be broken by.
 *
 * Form field VALUES cannot appear here at all — `textContent` never includes
 * them, and the survey reads only a field's type and whether it is populated.
 * That is a structural property rather than a filter, and `phase539` asserts
 * it rather than assuming it.
 */
export function sanitizeText(raw) {
  if (typeof raw !== "string") return null;
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  const stripped = collapsed.replace(/(https?:\/\/[^\s]+?)[?#][^\s]*/gi, "$1");
  return stripped.length > TEXT_CAP ? `${stripped.slice(0, TEXT_CAP)}…` : stripped;
}

/**
 * Property values carried on a region observation, if the survey collected any.
 *
 * `assets` and `controls` are folded in here rather than kept as separate
 * region fields, so they get exactly the same treatment `color` or `fontSize`
 * gets: `observed` on the first sighting, `conflicted` when a later sighting
 * disagrees, `unknown` when nothing ever carried them. A region survey that
 * later learns to collect one more list-shaped fact needs no new machinery —
 * it needs one more line here.
 */
const propertiesOf = (region) => {
  const props = region && typeof region.properties === "object" && region.properties
    ? { ...region.properties } : {};
  if (region && Array.isArray(region.assets) && region.assets.length > 0) {
    props.assets = region.assets;
  }
  if (region && region.controls && typeof region.controls === "object") {
    props.controls = region.controls;
  }
  /* `observe.mjs`'s `layoutOf()` has always computed this — display, flex and
   * grid detail, sticky/fixed, scroll-container, width-share-of-parent — and
   * this layer never carried it past normalization, so every page model's
   * `layout` roll-up read `unknown` regardless of what the survey saw. Same
   * fix as `assets` and `controls`, and for the same reason: the fact existed
   * upstream and had nowhere to go. */
  if (region && region.layout && typeof region.layout === "object" && Object.keys(region.layout).length > 0) {
    props.layout = region.layout;
  }
  /* Text rides the same property machinery, which is what gives it conflict
   * tracking and per-observation ids for free. A region observed twice with
   * different copy becomes `conflicted` with both strings kept, exactly as a
   * region observed with two different background colours does. An
   * observation with no `text` field adds no key at all, so evidence captured
   * before the survey collected text still normalizes unchanged. */
  const text = sanitizeText(region?.text);
  if (text !== null) props.text = text;
  return props;
};

/**
 * What is known about one region's copy, and what that knowledge may support.
 *
 * The `supports` block here is deliberately NOT the region's own — it is
 * recomputed from the kinds of the observations that actually carried text.
 * A region seen both above the fold and again after scrolling supports an
 * above-fold claim; if its TEXT only ever appeared in the scroll-revealed
 * sighting, the text does not. Copying the region's flags would quietly let
 * scroll-revealed copy answer an above-fold question, which is the precise
 * confusion this whole pipeline exists to prevent.
 */
function textEvidenceFor(properties, provenance, kindByObservationId) {
  const prop = properties?.text;
  if (!prop || prop.status === PROPERTY_STATUS.UNKNOWN) {
    return {
      status: PROPERTY_STATUS.UNKNOWN,
      value: null,
      observationIds: [],
      conflicts: [],
      provenance: [],
      kinds: [],
      supports: {
        [CLAIM_SCOPE.ABOVE_FOLD]: false,
        [CLAIM_SCOPE.RESTING_PAGE]: false,
        [CLAIM_SCOPE.INTERACTED]: false
      },
      reason: "no observation carried text for this region; absence is unknown, not a finding that the region is empty"
    };
  }

  const carrying = new Set(prop.observationIds ?? []);
  const records = provenance.filter((p) => carrying.has(p.observationId));
  const kinds = [...new Set(records.map((p) => p.kind))];

  return {
    status: prop.status,
    value: prop.value,
    observationIds: [...(prop.observationIds ?? [])],
    conflicts: prop.conflicts ?? [],
    provenance: records,
    kinds,
    supports: {
      [CLAIM_SCOPE.ABOVE_FOLD]: kinds.some((k) => claimSupportedBy(k, CLAIM_SCOPE.ABOVE_FOLD)),
      [CLAIM_SCOPE.RESTING_PAGE]: kinds.some((k) => claimSupportedBy(k, CLAIM_SCOPE.RESTING_PAGE)),
      [CLAIM_SCOPE.INTERACTED]: kinds.some((k) => claimSupportedBy(k, CLAIM_SCOPE.INTERACTED))
    }
  };
}

/**
 * Normalizes one viewport's observations.
 *
 * @param {object[]} observations  the `observations` array from `collectObservations`
 * @param {number|{width:number,height:number}} viewport
 * @param {object} [options]
 * @param {string[]} [options.expectedProperties] properties to report as `unknown`
 *        when no observation carried them — absence recorded rather than implied
 */
/**
 * Fold one observation's visual candidates into a region's running set.
 *
 * A panel sighted at several scroll positions is ONE candidate with several
 * sightings. When those sightings disagree about its geometry the candidate is
 * marked `unstable` — which downstream refuses to crop, because a region that
 * moved between looks has no single frame that represents it.
 */
function collectVisualCandidates(entry, region, observationId) {
  for (const candidate of region.visualCandidates ?? []) {
    const key = candidate.domPath;
    const seen = entry.visualCandidates.get(key);
    if (!seen) {
      entry.visualCandidates.set(key, {
        ...candidate,
        observationIds: [observationId],
        unstable: false
      });
      continue;
    }
    seen.observationIds.push(observationId);
    const a = seen.geometry ?? {};
    const b = candidate.geometry ?? {};
    if (a.width !== b.width || a.height !== b.height || a.top !== b.top || a.left !== b.left) {
      seen.unstable = true;
    }
    /* Animation is a property of the element, not of one sighting: seeing it
     * animate once is enough to make every frame of it a partial account. */
    if (candidate.animated && !seen.animated) {
      seen.animated = true;
      seen.animationNote = candidate.animationNote ?? seen.animationNote;
    }
  }
}

export function buildEvidence(observations, viewport, options = {}) {
  const check = validateObservations(observations, viewport);
  if (!check.valid) {
    const detail = check.problems.map((p) => `${p.where}: ${p.message}`).join("; ");
    throw new TypeError(`normalize.buildEvidence received malformed input — ${detail}`);
  }

  const width = typeof viewport === "number" ? viewport : viewport.width;
  const height = typeof viewport === "number"
    ? (observations[0]?.viewportHeight ?? null)
    : (viewport.height ?? observations[0]?.viewportHeight ?? null);

  const maxScrollY = observations.reduce((m, o) => Math.max(m, Number(o.scrollY) || 0), 0);

  /* Observations first, so every provenance entry below can point at an id that
   * already exists. `N14` asserts no provenance ever references a missing one. */
  const normalizedObservations = observations.map((obs, i) => ({
    id: observationId(width, i),
    sequence: i,
    kind: obs.kind,
    scrollState: obs.scrollState ?? null,
    scrollIndex: obs.scrollIndex ?? null,
    scrollStep: obs.scrollStep ?? null,
    scrollY: obs.scrollY,
    scrollPosition: scrollPositionOf(obs.scrollY, maxScrollY),
    viewportWidth: obs.viewportWidth ?? width,
    viewportHeight: obs.viewportHeight ?? height,
    url: obs.url,
    visibilityState: obs.visibilityState ?? null,
    observedAt: obs.observedAt ?? null,
    state: obs.state ?? null,
    regionCount: (obs.regions ?? []).length
  }));

  /* Deduplicate on the identity `observe.mjs` computes, so the two layers agree
   * about what one region is by sharing the function rather than by each having
   * an opinion. */
  const byIdentity = new Map();

  observations.forEach((obs, i) => {
    const oid = normalizedObservations[i].id;
    for (const region of obs.regions ?? []) {
      const identity = identityOf(region);
      const provenance = {
        observationId: oid,
        kind: obs.kind,
        /* Where the page physically was, kept beside what the evidence may
         * support. `scrollPosition` below is a label for the OFFSET; this is
         * the STATE the page was in, and a geometry read at `during-scroll`
         * may not be compared with one read at `initial` as if the difference
         * were responsive reflow. */
        scrollState: obs.scrollState ?? null,
        scrollIndex: obs.scrollIndex ?? null,
        scrollStep: obs.scrollStep ?? null,
        scrollY: obs.scrollY,
        scrollPosition: normalizedObservations[i].scrollPosition,
        viewportWidth: normalizedObservations[i].viewportWidth,
        viewportHeight: normalizedObservations[i].viewportHeight,
        url: obs.url,
        visibilityState: obs.visibilityState ?? null,
        observedAt: obs.observedAt ?? null,
        state: obs.state ?? null
      };

      /* Viewport-relative geometry is DERIVED from the document-relative value
       * and the scroll position it was read at — both recorded — rather than
       * measured separately. It is a restatement of facts, not a new one. */
      const viewportGeometry = {
        observationId: oid,
        /* Stamped with the state and offset it was derived at, so a consumer
         * can never line two of these up without knowing they came from
         * different physical states of the page. */
        scrollState: obs.scrollState ?? null,
        scrollIndex: obs.scrollIndex ?? null,
        scrollY: obs.scrollY,
        viewportWidth: normalizedObservations[i].viewportWidth,
        viewportHeight: normalizedObservations[i].viewportHeight,
        visibilityState: obs.visibilityState ?? null,
        top: region.top - (Number(obs.scrollY) || 0),
        left: region.left,
        width: region.width,
        height: region.height
      };

      const existing = byIdentity.get(identity);
      if (!existing) {
        byIdentity.set(identity, {
          identity,
          domPath: region.domPath,
          tag: region.tag ?? null,
          role: region.role ?? null,
          semanticHints: {
            tag: region.tag ?? null,
            role: region.role ?? null,
            childCount: region.childCount ?? null,
            textLength: region.textLength ?? null,
            /* First sighting wins, exactly like `childCount` above: this is a
             * structural fact about the region, not a property with its own
             * conflict tracking. `page-model/model.mjs` already reads this
             * field — it predates the region survey collecting headings and
             * was written ready for the day it did. */
            headings: Array.isArray(region.headings) ? region.headings : []
          },
          documentGeometry: { top: region.top, left: region.left, width: region.width, height: region.height },
          viewportGeometry: [viewportGeometry],
          properties: cloneProperties(propertiesOf(region), oid),
          provenance: [provenance],
          kinds: [obs.kind],
          unstable: false,
          conflicts: [],
          /* Painted interiors seen inside this region, keyed by DOM path so the
           * same panel sighted at three scroll positions stays one candidate. */
          visualCandidates: new Map()
        });
        collectVisualCandidates(byIdentity.get(identity), region, oid);
        continue;
      }

      existing.provenance.push(provenance);
      existing.viewportGeometry.push(viewportGeometry);
      if (!existing.kinds.includes(obs.kind)) existing.kinds.push(obs.kind);
      mergeProperties(existing.properties, propertiesOf(region), oid);
      collectVisualCandidates(existing, region, oid);

      const moved =
        region.top !== existing.documentGeometry.top ||
        region.left !== existing.documentGeometry.left ||
        region.width !== existing.documentGeometry.width ||
        region.height !== existing.documentGeometry.height;
      if (moved) {
        existing.unstable = true;
        /* Both readings are kept, and the record says whether they came from
         * different scroll states. A sticky header measured at the top and
         * again mid-scroll legitimately disagrees; that is state-dependent
         * geometry, not noise, and it is never averaged into one number. */
        const firstState = existing.provenance[0]?.scrollState ?? null;
        existing.conflicts.push({
          observationId: oid,
          kind: obs.kind,
          scrollState: obs.scrollState ?? null,
          scrollIndex: obs.scrollIndex ?? null,
          scrollY: obs.scrollY,
          geometry: { top: region.top, left: region.left, width: region.width, height: region.height },
          stateDependent: firstState !== null && (obs.scrollState ?? null) !== firstState
        });
      }
    }
  });

  /* Deterministic order: document position, then identity as the tiebreak. Two
   * runs over the same observations must produce byte-identical output, which
   * `N7` checks. */
  const ordered = [...byIdentity.values()].sort((a, b) =>
    a.documentGeometry.top - b.documentGeometry.top ||
    a.documentGeometry.left - b.documentGeometry.left ||
    a.identity.localeCompare(b.identity));

  const kindByObservationId = new Map(normalizedObservations.map((o) => [o.id, o.kind]));

  const expected = options.expectedProperties ?? [];
  const regions = ordered.map((region, ordinal) => {
    for (const name of expected) {
      if (!(name in region.properties)) {
        region.properties[name] = {
          status: PROPERTY_STATUS.UNKNOWN,
          value: null,
          observationIds: [],
          reason: "no observation carried this property; absence is unknown, not a default"
        };
      }
    }

    /* Provenance decides scope. Computed from the kinds actually recorded, so a
     * region cannot claim support it has no sighting for. */
    const supportsAboveFold = region.kinds.some((k) => claimSupportedBy(k, CLAIM_SCOPE.ABOVE_FOLD));
    const supportsRestingPage = region.kinds.some((k) => claimSupportedBy(k, CLAIM_SCOPE.RESTING_PAGE));
    const supportsInteracted = region.kinds.some((k) => claimSupportedBy(k, CLAIM_SCOPE.INTERACTED));

    return {
      regionId: regionId(width, ordinal),
      identity: region.identity,
      domPath: region.domPath,
      tag: region.tag,
      role: region.role,
      semanticHints: region.semanticHints,
      /* Copy, with its own provenance and its own support flags. Kept beside
       * `properties.text` rather than instead of it: the property carries the
       * conflict machinery, this carries the answer to "what may this copy be
       * used to claim". */
      text: textEvidenceFor(region.properties, region.provenance, kindByObservationId),
      geometry: {
        document: region.documentGeometry,
        viewport: region.viewportGeometry
      },
      properties: sortKeys(region.properties),
      provenance: region.provenance,
      sourceObservationIds: region.provenance.map((p) => p.observationId),
      kinds: region.kinds,
      supports: {
        [CLAIM_SCOPE.ABOVE_FOLD]: supportsAboveFold,
        [CLAIM_SCOPE.RESTING_PAGE]: supportsRestingPage,
        [CLAIM_SCOPE.INTERACTED]: supportsInteracted
      },
      unstable: region.unstable,
      conflicts: region.conflicts,
      /* Which physical states this region was seen in, and whether its
       * geometry depended on which one. `reHidesAtTop` is the animated-reveal
       * signature: seen while scrolling, gone again once the page was back at
       * the top, and never present in the initial look. */
      scrollStates: (() => {
        const states = [...new Set(region.provenance.map((p) => p.scrollState).filter(Boolean))];
        return {
          seenIn: states,
          stateDependentGeometry: (region.conflicts ?? []).some((c) => c.stateDependent),
          reHidesAtTop: states.includes("during-scroll")
            && !states.includes("after-return") && !states.includes("initial")
        };
      })(),
      /* The evidential status of the region as a whole. A region whose geometry
       * disagrees between sightings is `conflicted`; nothing here resolves it. */
      status: region.unstable ? PROPERTY_STATUS.CONFLICTED : PROPERTY_STATUS.OBSERVED
    };
  });

  /* Visual regions, planned once for the whole viewport.
   *
   * Planned here rather than per region because "which observation shows this
   * panel best" is a question about the whole scroll sweep, and because the
   * crop budget is a per-viewport budget. Nothing is captured at this layer —
   * `buildEvidence` is pure. The caller executes the plan and hands the results
   * back through `options.visualResults`. */
  const visualCandidates = [];
  for (let i = 0; i < ordered.length; i++) {
    const region = ordered[i];
    const rid = regionId(width, i);
    for (const candidate of (region.visualCandidates?.values?.() ?? [])) {
      visualCandidates.push({
        ...candidate,
        sourceEvidenceIds: [rid, ...(candidate.observationIds ?? [])]
      });
    }
  }
  const visualPlan = planVisualCaptures({
    candidates: visualCandidates,
    observations: normalizedObservations,
    canCapture: Boolean(options.canCaptureVisuals),
    budget: options.visualBudget ?? VISUAL_BUDGET
  });
  const visual = visualEvidenceFrom({
    viewportWidth: width,
    plan: visualPlan,
    results: options.visualResults ?? new Map(),
    budget: options.visualBudget ?? VISUAL_BUDGET
  });

  return {
    $normalizedEvidence: NORMALIZED_EVIDENCE_VERSION,
    viewport: { width, height },
    url: observations[0]?.url ?? null,
    maxScrollY,
    observations: normalizedObservations,
    regions,
    visualRegions: visual.regions,
    counts: {
      observations: normalizedObservations.length,
      regions: regions.length,
      aboveFold: regions.filter((r) => r.supports[CLAIM_SCOPE.ABOVE_FOLD]).length,
      scrollRevealedOnly: regions.filter((r) =>
        !r.supports[CLAIM_SCOPE.ABOVE_FOLD] && r.kinds.includes(OBSERVATION_KIND.SCROLL_REVEALED)).length,
      interactionOnly: regions.filter((r) =>
        r.kinds.length === 1 && r.kinds[0] === OBSERVATION_KIND.INTERACTION).length,
      unstable: regions.filter((r) => r.unstable).length,
      unknownProperties: regions.reduce((n, r) =>
        n + Object.values(r.properties).filter((p) => p.status === PROPERTY_STATUS.UNKNOWN).length, 0),
      withText: regions.filter((r) => r.text.status !== PROPERTY_STATUS.UNKNOWN).length,
      conflictedText: regions.filter((r) => r.text.status === PROPERTY_STATUS.CONFLICTED).length,
      stateDependentGeometry: regions.filter((r) => r.scrollStates.stateDependentGeometry).length,
      reHidesAtTop: regions.filter((r) => r.scrollStates.reHidesAtTop).length,
      observationsByScrollState: normalizedObservations.reduce((acc, o) => {
        if (o.scrollState) acc[o.scrollState] = (acc[o.scrollState] ?? 0) + 1;
        return acc;
      }, {}),
      visualRegions: visual.counts.total,
      visualResolved: visual.counts.resolved,
      visualUnresolved: visual.counts.unresolved,
      visualByType: visual.counts.byType,
      visualByStatus: visual.counts.byStatus
    }
  };
}

/** First sighting of a property set. */
function cloneProperties(props, observationId) {
  const out = {};
  for (const [name, value] of Object.entries(props)) {
    out[name] = {
      status: PROPERTY_STATUS.OBSERVED,
      value,
      observationIds: [observationId],
      conflicts: []
    };
  }
  return out;
}

/**
 * Whether two property values are the same value, not merely the same
 * reference.
 *
 * `Object.is` alone is correct for the scalar CSS values this was written
 * for and wrong for `assets`/`controls`, which are arrays and objects: two
 * observations of an unchanged image list would build two different array
 * instances with identical content, and reference equality would call that a
 * conflict every single time a region is seen twice. A region that was
 * genuinely re-observed identically is not a finding.
 */
const sameValue = (a, b) => {
  if (Object.is(a, b)) return true;
  if (a && b && typeof a === "object" && typeof b === "object") {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
  }
  return false;
};

/** A later sighting: agreement adds provenance, disagreement adds a conflict. */
function mergeProperties(target, props, observationId) {
  for (const [name, value] of Object.entries(props)) {
    const existing = target[name];
    if (!existing || existing.status === PROPERTY_STATUS.UNKNOWN) {
      target[name] = {
        status: PROPERTY_STATUS.OBSERVED, value,
        observationIds: [observationId], conflicts: []
      };
      continue;
    }
    existing.observationIds.push(observationId);
    if (!sameValue(existing.value, value)) {
      /* Kept side by side. A property observed as two different values is a
       * finding about the page, and choosing one would erase it. */
      existing.status = PROPERTY_STATUS.CONFLICTED;
      existing.conflicts.push({ observationId, value });
    }
  }
}

const sortKeys = (obj) =>
  Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));

/**
 * Validates a normalized document against the shape this module promises.
 *
 * The load-bearing check is the last one: every provenance entry must name an
 * observation that exists in the same document. A claim whose provenance points
 * nowhere is worse than a claim with none, because it reads as supported.
 */
export function validateNormalizedEvidence(doc) {
  const problems = [];
  if (!doc || typeof doc !== "object") {
    return { valid: false, problems: [problem("$", "expected an object")] };
  }
  if (doc.$normalizedEvidence !== NORMALIZED_EVIDENCE_VERSION) {
    problems.push(problem("$normalizedEvidence",
      `expected version ${NORMALIZED_EVIDENCE_VERSION}, found ${JSON.stringify(doc.$normalizedEvidence)}`));
  }
  if (!Number.isFinite(doc.viewport?.width)) {
    problems.push(problem("viewport.width", "a normalized model must state the width it belongs to"));
  }
  if (!Array.isArray(doc.observations)) problems.push(problem("observations", "expected an array"));
  if (!Array.isArray(doc.regions)) problems.push(problem("regions", "expected an array"));
  if (problems.length) return { valid: false, problems };

  const known = new Set(doc.observations.map((o) => o.id));
  const seenRegionIds = new Set();

  doc.regions.forEach((region, i) => {
    const at = `regions[${i}]`;
    if (seenRegionIds.has(region.regionId)) {
      problems.push(problem(`${at}.regionId`, `duplicate region id ${region.regionId}`));
    }
    seenRegionIds.add(region.regionId);

    if (!String(region.regionId ?? "").startsWith(`r-${doc.viewport.width}-`)) {
      problems.push(problem(`${at}.regionId`,
        `region id ${region.regionId} does not carry viewport ${doc.viewport.width}; models must not be mergeable`));
    }
    if (!Array.isArray(region.provenance) || region.provenance.length === 0) {
      problems.push(problem(`${at}.provenance`, "every region must carry at least one provenance record"));
    }
    for (const p of region.provenance ?? []) {
      if (!known.has(p.observationId)) {
        problems.push(problem(`${at}.provenance`,
          `references observation ${p.observationId}, which is not in this document`));
      }
    }
    if (region.supports?.[CLAIM_SCOPE.ABOVE_FOLD] && !region.kinds?.includes(OBSERVATION_KIND.INITIAL)) {
      problems.push(problem(`${at}.supports`,
        "claims above-fold support without an initial-state sighting"));
    }
    if (region.supports?.[CLAIM_SCOPE.RESTING_PAGE] &&
        region.kinds?.every((k) => k === OBSERVATION_KIND.INTERACTION)) {
      problems.push(problem(`${at}.supports`,
        "interaction-derived evidence must not be promoted to resting-page evidence"));
    }
  });

  return { valid: problems.length === 0, problems };
}

/** Stable JSON. Key order is fixed by construction, so two runs match byte for byte. */
export const serialize = (doc) => JSON.stringify(doc, null, 2) + "\n";

/** Parses and validates in one step; a document that will not validate is not returned. */
export function deserialize(json) {
  const doc = JSON.parse(json);
  const check = validateNormalizedEvidence(doc);
  if (!check.valid) {
    throw new TypeError(
      `normalized evidence failed validation — ${check.problems.map((p) => `${p.where}: ${p.message}`).join("; ")}`
    );
  }
  return doc;
}

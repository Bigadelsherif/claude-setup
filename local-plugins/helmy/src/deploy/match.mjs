/**
 * Cross-build component matching.
 *
 * The question is whether a component in build A is the same component in
 * build B, established WITHOUT using anything the build chose to name. If a
 * match needs the class name, it proves nothing about a redeployment, because
 * the class name is exactly what a redeployment changes.
 *
 * Generated names may stay in the raw evidence — they are facts about the
 * capture — but no match may depend on one. That is enforced structurally:
 * the signal extractor below never reads a class name at all.
 *
 * Ambiguity is preserved rather than resolved. Two candidates that score
 * identically are reported as `ambiguous`, not decided by tie-break, because a
 * tie-break would be inventing evidence the captures do not contain.
 */

export const MATCH_STATE = {
  MATCHED: "matched",
  UNMATCHED_SOURCE: "unmatched-source",
  UNMATCHED_TARGET: "unmatched-target",
  AMBIGUOUS: "ambiguous",
  CHANGED_STRUCTURE: "changed-structure",
  INSUFFICIENT_EVIDENCE: "insufficient-evidence"
};

/**
 * The signals a match may use. Every one is a property of the rendered result
 * or the document's meaning; none is a build identifier.
 *
 * `weight` is how much agreement on that signal contributes. The weights are
 * not tuned against an outcome — they encode how hard each signal is to
 * coincide on. Two elements sharing a child-tag sequence and a style
 * fingerprint is a much stronger coincidence than two elements sharing a tag.
 */
export const SIGNALS = [
  { key: "tag", weight: 1, label: "element tag" },
  { key: "childTagSequence", weight: 3, label: "child-tag sequence" },
  { key: "semanticRole", weight: 2, label: "semantic role" },
  { key: "parentRegion", weight: 2, label: "parent region" },
  { key: "repeatMembership", weight: 2, label: "repeated-group membership" },
  { key: "styleFingerprint", weight: 3, label: "style fingerprint" },
  { key: "geometryClass", weight: 2, label: "geometry class" },
  { key: "paintedClass", weight: 1, label: "painted-surface class" },
  { key: "contentRole", weight: 1, label: "content role" },
  { key: "dataAttribute", weight: 3, label: "stable data attribute" },
  { key: "accessibleName", weight: 1, label: "accessible name" },
  { key: "parentChildShape", weight: 2, label: "relative parent-child relationship" }
];

const TOTAL_WEIGHT = SIGNALS.reduce((n, s) => n + s.weight, 0);

/**
 * Reduces a repeat group to matchable signals.
 *
 * Deliberately reads no class name, no id and no selector. If a signal cannot
 * be derived it is left `null`, and a null never contributes to a score in
 * either direction — a missing signal is missing evidence, not disagreement.
 */
export function signalsOf(group, context = {}) {
  const c = group.coherence ?? {};
  const tag = group.signature ? group.signature.split(".")[0] : null;

  /* A signal is used only when the group actually agrees on it. A dominant
   * value drawn from a group that is itself split would be comparing one
   * build's majority against another's, which is not the same claim. */
  const settled = (d, threshold = 0.6) =>
    d && d.dominantShare >= threshold && d.dominantValue != null ? d.dominantValue : null;

  return {
    tag,
    /* Taken from the coherence block, which records the members' shapes and is
     * derived from the DOM rather than from names. */
    childTagSequence: settled(c.childTagSequenceDiversity),
    childSequenceDistinct: c.childTagSequenceDiversity?.distinct ?? null,
    semanticRole: settled(c.semanticRoleDiversity, 0.85),
    parentRegion: group.region ?? null,
    repeatMembership: group.count ?? null,
    styleFingerprint: settled(c.styleFingerprintDiversity, 0.85),
    geometryClass: settled(c.geometryClassDiversity, 0.85),
    paintedClass: group.paintedCount != null && group.count
      ? (group.paintedCount === 0 ? "none" : group.paintedCount === group.count ? "all" : "partial")
      : null,
    contentRole: group.textBearing != null && group.count
      ? (group.textBearing === 0 ? "container" : group.textBearing === group.count ? "text" : "mixed")
      : null,
    dataAttribute: dataAttributeOf(group.stableSelector),
    accessibleName: context.accessibleName ?? null,
    parentChildShape: parentShapeOf(group),
    areaMedian: c.areaMedian ?? null,
    /* Recorded for reporting only; never scored. */
    _capturedSelector: group.stableSelector ?? null,
    _capturedSignature: group.signature ?? null
  };
}

/**
 * A data attribute in a selector is author-controlled, so it may be used —
 * unless it is a framework marker, which identifies a renderer and would match
 * every component the framework rendered.
 */
function dataAttributeOf(selector) {
  if (!selector) return null;
  const m = selector.match(/\[(data-[\w-]+)(?:=('[^']*'|"[^"]*"))?\]/);
  if (!m) return null;
  if (/^data-(nimg|astro-cid|reactroot|svelte|v-[0-9a-f]+|n-head)/.test(m[1])) return null;
  return m[2] ? `${m[1]}=${m[2]}` : m[1];
}

/**
 * The shape of the group's position relative to its parent, expressed without
 * naming either. `parentSelector` carries class names, so only its tag and
 * depth are used.
 */
function parentShapeOf(group) {
  if (!group.parentSelector) return null;
  const parentTag = group.parentSelector.split(/[.#[\s>]/)[0] || null;
  const depth = group.stableSelector ? group.stableSelector.split(">").length : null;
  return parentTag ? `${parentTag}@${depth ?? "?"}` : null;
}

/** Compares two signal sets, returning the evidence used and a score. */
export function compareSignals(a, b) {
  const agreed = [];
  const disagreed = [];
  const unavailable = [];
  let scored = 0;
  let possible = 0;

  for (const signal of SIGNALS) {
    const va = a[signal.key];
    const vb = b[signal.key];
    if (va == null || vb == null) { unavailable.push(signal.key); continue; }
    possible += signal.weight;

    let same;
    if (signal.key === "repeatMembership") {
      /* Instance counts vary with content, not with identity: a template list
       * may render six cards in one build and seven in the next. Agreement
       * within a tolerance counts; an exact match is not required. */
      const hi = Math.max(va, vb);
      const lo = Math.min(va, vb);
      same = hi === 0 ? true : lo / hi >= 0.6;
    } else {
      same = String(va) === String(vb);
    }

    if (same) { agreed.push(signal.key); scored += signal.weight; }
    else disagreed.push(signal.key);
  }

  return {
    agreed,
    disagreed,
    unavailable,
    score: possible ? scored / possible : 0,
    weightAvailable: possible,
    weightTotal: TOTAL_WEIGHT,
    /* How much of the evidence model was actually usable. A perfect score over
     * two available signals is not the same claim as a perfect score over ten. */
    coverage: TOTAL_WEIGHT ? possible / TOTAL_WEIGHT : 0
  };
}

const DEFAULTS = {
  /* A match must agree on most of the available evidence... */
  minScore: 0.75,
  /* ...over enough of the evidence model to mean something... */
  minCoverage: 0.4,
  /* ...and must beat its runner-up by a clear margin, or it is ambiguous. */
  minMargin: 0.12,
  /* Structural disagreement is disqualifying however well the rest scores:
   * a different internal anatomy is a different component. */
  structuralSignals: ["childTagSequence", "parentChildShape"]
};

/**
 * Matches every source group against every target group.
 *
 * Produces one record per source and per unmatched target, with the full
 * evidence trail. No match is forced: a tie is reported as a tie.
 */
export function matchBuilds(sourceGroups, targetGroups, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const sourceSignals = sourceGroups.map((g) => ({ group: g, signals: signalsOf(g) }));
  const targetSignals = targetGroups.map((g) => ({ group: g, signals: signalsOf(g) }));

  const results = [];
  const claimedTargets = new Set();

  sourceSignals.forEach((src, si) => {
    const scored = targetSignals
      .map((tgt, ti) => ({ ti, tgt, cmp: compareSignals(src.signals, tgt.signals) }))
      .sort((x, y) => y.cmp.score - x.cmp.score);

    const best = scored[0];
    const runnerUp = scored[1];

    const record = {
      sourceComponentId: componentId(src.group, si),
      targetComponentId: null,
      matchState: null,
      matchMethod: null,
      evidenceUsed: [],
      evidenceUnavailable: [],
      confidence: 0,
      selectorBefore: src.group.stableSelector ?? null,
      selectorAfter: null,
      selectorChanged: null,
      componentIdentityChanged: null,
      deploySafe: false,
      unresolvedConflicts: []
    };

    if (!best) {
      record.matchState = MATCH_STATE.UNMATCHED_SOURCE;
      record.matchMethod = "no target groups";
      results.push(record);
      return;
    }

    record.evidenceUsed = best.cmp.agreed;
    record.evidenceUnavailable = best.cmp.unavailable;

    if (best.cmp.coverage < opts.minCoverage) {
      record.matchState = MATCH_STATE.INSUFFICIENT_EVIDENCE;
      record.matchMethod = `only ${(best.cmp.coverage * 100).toFixed(0)}% of the evidence model was available`;
      record.confidence = 0;
      results.push(record);
      return;
    }

    const structuralDisagreement = opts.structuralSignals.filter((s) => best.cmp.disagreed.includes(s));
    if (structuralDisagreement.length && best.cmp.score >= opts.minScore) {
      /* Scores well on everything except what makes it the same component.
       * Reported as a structural change rather than a match, because calling
       * it a match would hide the only difference that matters. */
      record.matchState = MATCH_STATE.CHANGED_STRUCTURE;
      record.targetComponentId = componentId(best.tgt.group, best.ti);
      record.matchMethod = `non-structural signals agree, structure does not: ${structuralDisagreement.join(", ")}`;
      record.confidence = best.cmp.score;
      record.selectorAfter = best.tgt.group.stableSelector ?? null;
      record.selectorChanged = record.selectorBefore !== record.selectorAfter;
      record.componentIdentityChanged = true;
      record.unresolvedConflicts = best.cmp.disagreed;
      results.push(record);
      return;
    }

    if (best.cmp.score < opts.minScore) {
      record.matchState = MATCH_STATE.UNMATCHED_SOURCE;
      record.matchMethod = `best candidate scored ${best.cmp.score.toFixed(2)}, below ${opts.minScore}`;
      record.confidence = best.cmp.score;
      record.unresolvedConflicts = best.cmp.disagreed;
      results.push(record);
      return;
    }

    const margin = runnerUp ? best.cmp.score - runnerUp.cmp.score : 1;
    if (margin < opts.minMargin) {
      /* Two targets fit equally well. Choosing one would be inventing evidence. */
      record.matchState = MATCH_STATE.AMBIGUOUS;
      record.matchMethod =
        `two candidates within ${margin.toFixed(3)} of each other (${best.cmp.score.toFixed(2)} vs ` +
        `${runnerUp.cmp.score.toFixed(2)}); not resolved`;
      record.confidence = best.cmp.score;
      record.targetComponentId = null;
      record.unresolvedConflicts = [
        `candidate: ${componentId(best.tgt.group, best.ti)}`,
        `candidate: ${componentId(runnerUp.tgt.group, runnerUp.ti)}`
      ];
      results.push(record);
      return;
    }

    record.matchState = MATCH_STATE.MATCHED;
    record.targetComponentId = componentId(best.tgt.group, best.ti);
    record.matchMethod = `agreement on ${best.cmp.agreed.length} non-generated signals`;
    record.confidence = best.cmp.score;
    record.selectorAfter = best.tgt.group.stableSelector ?? null;
    record.selectorChanged = record.selectorBefore !== record.selectorAfter;
    record.componentIdentityChanged = false;
    record.unresolvedConflicts = best.cmp.disagreed;
    claimedTargets.add(best.ti);
    results.push(record);
  });

  targetSignals.forEach((tgt, ti) => {
    if (claimedTargets.has(ti)) return;
    results.push({
      sourceComponentId: null,
      targetComponentId: componentId(tgt.group, ti),
      matchState: MATCH_STATE.UNMATCHED_TARGET,
      matchMethod: "no source group claimed this target",
      evidenceUsed: [],
      evidenceUnavailable: [],
      confidence: 0,
      selectorBefore: null,
      selectorAfter: tgt.group.stableSelector ?? null,
      selectorChanged: null,
      componentIdentityChanged: null,
      deploySafe: false,
      unresolvedConflicts: []
    });
  });

  return results;
}

/**
 * A stable handle for a group that does not use its class name.
 *
 * Index is included because two groups can be structurally indistinguishable,
 * and an id that collides would silently merge them in a report.
 */
export function componentId(group, index) {
  const tag = group.signature ? group.signature.split(".")[0] : "?";
  const region = group.region ?? "other";
  return `${region}/${tag}[${index}]x${group.count ?? "?"}`;
}

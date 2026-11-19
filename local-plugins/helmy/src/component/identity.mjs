/**
 * Component identity and anatomy, independent of paint.
 *
 * Five things were previously one thing:
 *
 *   1. semantic unit      what the repeated thing IS
 *   2. identity           the evidence that it is one thing
 *   3. surface            what, if anything, it paints
 *   4. wrapper            the layout container it sits in
 *   5. painted descendant the node inside it that paints, if any
 *
 * Collapsing these is what made an unpainted component unrepresentable: a
 * component with no surface had no anatomy, and a component with no anatomy was
 * rejected (def_0023). A wrapper with a painted child was reported as a
 * component that paints (def_0025).
 */

/**
 * Identity bases, in the order the phase brief lists them.
 *
 * `sufficient` marks a basis that can carry identity on its own. `disqualifying`
 * marks one that must never do so however strong it looks: a shared utility
 * class describes presentation and is worn by unrelated elements, and DOM
 * position describes where a thing sits rather than what it is.
 */
export const IDENTITY_BASIS = {
  REPEATED_STRUCTURE: { key: "repeated-structure", weight: 3, sufficient: false },
  SEMANTIC_ROLE: { key: "semantic-role", weight: 3, sufficient: true },
  TAG_AND_CHILD_SEQUENCE: { key: "tag-and-child-sequence", weight: 3, sufficient: false },
  PARENT_REGION: { key: "parent-region", weight: 1, sufficient: false },
  GEOMETRY: { key: "geometry", weight: 1, sufficient: false },
  SPACING_RELATIONSHIP: { key: "spacing-relationship", weight: 1, sufficient: false },
  TEXT_ICON_PATTERN: { key: "text-icon-pattern", weight: 2, sufficient: false },
  ACCESSIBILITY_ATTRIBUTES: { key: "accessibility-attributes", weight: 3, sufficient: true },
  REPEATED_CONTENT_ROLE: { key: "repeated-content-role", weight: 2, sufficient: false },
  STYLE_FINGERPRINT: { key: "style-fingerprint", weight: 2, sufficient: false },
  PROJECT_HOOK: { key: "project-hook", weight: 3, sufficient: true },

  /* Present in the evidence, never permitted to establish identity. */
  UTILITY_CLASS: { key: "utility-class", weight: 0, sufficient: false, disqualifying: true },
  DOM_POSITION: { key: "dom-position", weight: 0, sufficient: false, disqualifying: true }
};

/** Non-surface properties that count toward the anatomy guard. */
export const NON_SURFACE_PROPERTIES = [
  "semantic-role", "tag", "child-structure", "typography", "spacing",
  "alignment", "icon-relationship", "content-hierarchy", "interaction-state",
  "responsive-behavior", "repeated-geometry"
];

/**
 * Gathers identity evidence for a repeat group.
 *
 * Reads the group and its coherence signals. Deliberately does not consult the
 * surface: identity must be establishable without paint, or the model has not
 * actually been separated.
 */
export function gatherIdentity(repeat, { classifyClassName = null, coherence = null } = {}) {
  const c = coherence ?? repeat?.coherence ?? {};
  const bases = [];
  const rejected = [];
  const add = (basis, detail) => bases.push({ basis: basis.key, weight: basis.weight, sufficient: !!basis.sufficient, detail });

  if (!repeat) return { bases: [], rejected: [], score: 0, sufficient: false, assessable: true, reasons: ["no repeat group"] };

  /* Captures taken before the coherence instrumentation existed carry no
   * structural signals at all. Identity cannot be ASSESSED from them — which is
   * not the same as failing. Treating a missing signal as evidence against
   * would reject every historical golden capture in the repository, and would
   * be the exact error this project keeps guarding against: unknown is not
   * false. Such a group is passed through to the acceptance rules that predate
   * this one. */
  if (!coherence && !repeat.coherence) {
    return {
      bases: [],
      rejected: [],
      score: 0,
      sufficient: true,
      assessable: false,
      reasons: ["this capture predates coherence instrumentation, so identity could not be assessed; it is neither established nor refuted"]
    };
  }

  if ((repeat.count ?? 0) >= 3) {
    add(IDENTITY_BASIS.REPEATED_STRUCTURE, `${repeat.count} instances share a structure`);
  }

  const role = c.semanticRoleDiversity;
  if (role?.distinct === 1 && role.dominantValue && role.dominantValue !== "generic" && role.dominantValue !== "") {
    add(IDENTITY_BASIS.SEMANTIC_ROLE, `every instance carries the role \`${role.dominantValue}\``);
  }

  const childSeq = c.childTagSequenceDiversity;
  if (childSeq?.dominantShare >= 0.8 && childSeq.dominantValue) {
    add(IDENTITY_BASIS.TAG_AND_CHILD_SEQUENCE, `child sequence \`${childSeq.dominantValue}\` on ${Math.round(childSeq.dominantShare * 100)}% of instances`);
  }

  if (repeat.inPrimary || repeat.region === "main") {
    add(IDENTITY_BASIS.PARENT_REGION, `sits in the ${repeat.region} region`);
  }

  const geo = c.geometryClassDiversity;
  if (geo?.distinct === 1 && geo.dominantValue) {
    add(IDENTITY_BASIS.GEOMETRY, `every instance shares the geometry class \`${geo.dominantValue}\``);
  }

  const spread = c.areaSpread;
  if (spread && spread.ratio != null && spread.ratio <= 2 && (repeat.count ?? 0) >= 3) {
    add(IDENTITY_BASIS.SPACING_RELATIONSHIP, `instances occupy a consistent box (p90/p10 area ratio ${spread.ratio})`);
  }

  if (childSeq?.dominantValue && /svg/i.test(childSeq.dominantValue) && (repeat.textBearing ?? 0) > 0) {
    add(IDENTITY_BASIS.TEXT_ICON_PATTERN, "every instance pairs an icon with text");
  }

  const style = c.styleFingerprintDiversity;
  if (style?.distinct === 1 && style.dominantValue) {
    add(IDENTITY_BASIS.STYLE_FINGERPRINT, "every instance shares a computed-style fingerprint");
  }

  const content = c.textBearingProportion;
  if (content === 1 || content === 0) {
    add(IDENTITY_BASIS.REPEATED_CONTENT_ROLE, content === 1 ? "every instance carries text" : "no instance carries direct text");
  }

  /* Project hooks and accessibility attributes come from the stable selector,
   * which is the only place the extractor records them. */
  const sel = repeat.stableSelector ?? "";
  if (/\[(data-testid|data-test|data-component|data-qa)\b/.test(sel)) {
    add(IDENTITY_BASIS.PROJECT_HOOK, "an author-controlled test hook identifies it");
  }
  if (/\[(role|aria-label)=/.test(sel)) {
    add(IDENTITY_BASIS.ACCESSIBILITY_ATTRIBUTES, "an accessibility attribute identifies it");
  }

  /* Bases that are present but must never carry identity. Recorded so the
   * report can show they were seen and refused, rather than silently dropped. */
  const profile = repeat.classProfile ?? {};
  if ((profile.utility ?? 0) > 0) {
    rejected.push({
      basis: IDENTITY_BASIS.UTILITY_CLASS.key,
      detail: `${profile.utility} utility class(es) present; utility names are shared by unrelated elements and cannot establish identity`
    });
  }
  if (/:nth-(of-type|child)\(/.test(sel)) {
    rejected.push({
      basis: IDENTITY_BASIS.DOM_POSITION.key,
      detail: "the selector counts siblings; position describes where a thing sits, not what it is"
    });
  }

  const score = bases.reduce((n, b) => n + b.weight, 0);
  const hasSufficient = bases.some((b) => b.sufficient);
  const reasons = [];

  /* A group whose own members disagree is not one component, however much
   * evidence can be piled onto the average. Phase 3.1's coherence signals are
   * consulted here rather than re-derived: two independent families disagreeing
   * is the same threshold used there. Without this the incoherent control is
   * admitted as a component, which would trade the def_0023 false negative for
   * a false positive. */
  if (c.potentiallyIncoherent) {
    const families = (c.disagreements ?? []).map((d) => d.family).join(", ");
    return {
      bases,
      rejected: [...rejected, { basis: "group-coherence", detail: `members disagree on ${families}` }],
      score,
      sufficient: false,
      incoherent: true,
      reasons: [`the repeated group is not internally coherent: members disagree on ${families}`]
    };
  }

  /* A layout wrapper repeats like a component and contains one. What separates
   * them is that a wrapper's instances hold DIFFERENT things: two components
   * sharing a grid cell produce one group whose child sequences disagree. A
   * component's instances hold the same thing. */
  const childShare = c.childTagSequenceDiversity?.dominantShare;
  const childDistinct = c.childTagSequenceDiversity?.distinct ?? 0;
  if (childDistinct > 1 && childShare != null && childShare < 0.75 && (repeat.textBearing ?? 0) === 0) {
    return {
      bases,
      rejected: [...rejected, {
        basis: "layout-wrapper",
        detail: `instances contain ${childDistinct} different child structures (most common on only ${Math.round(childShare * 100)}%), and the node itself bears no text`
      }],
      score,
      sufficient: false,
      isWrapper: true,
      reasons: ["this repeats like a container, not like a component: its instances hold different things"]
    };
  }

  /* Identity is established either by one sufficient basis, or by enough
   * independent weak ones. The threshold of 6 is two strong bases or three
   * moderate ones — deliberately not tuned against an outcome. */
  const sufficient = hasSufficient || score >= 6;
  if (!sufficient) {
    reasons.push(
      bases.length
        ? `identity evidence totals ${score}, below the threshold of 6 and with no single sufficient basis`
        : "no identity evidence at all"
    );
  }
  if (bases.length === 0 && rejected.length > 0) {
    reasons.push("the only available signals were ones that may never establish identity");
  }

  return { bases, rejected, score, sufficient, reasons };
}

/**
 * Counts the reliable non-surface properties a component has evidence for.
 *
 * This is what the anatomy guard consumes. A property counts only when it was
 * actually evidenced — the point of the guard is to stop `recreate` proceeding
 * on a component nobody could rebuild, and inflating the count would defeat it.
 */
export function gatherNonSurfaceProperties(repeat, { coherence = null, typography = null, spacing = null } = {}) {
  const c = coherence ?? repeat?.coherence ?? {};
  const props = [];
  const add = (name, detail, evidence = []) => props.push({ property: name, detail, evidence });

  if (!repeat) return props;

  const role = c.semanticRoleDiversity;
  if (role?.distinct === 1 && role.dominantValue && role.dominantValue !== "generic") {
    add("semantic-role", `role \`${role.dominantValue}\``);
  }

  const tag = repeat.signature ? repeat.signature.split(".")[0] : null;
  if (tag) add("tag", `<${tag}>`);

  const childSeq = c.childTagSequenceDiversity;
  if (childSeq?.dominantShare >= 0.8 && childSeq.dominantValue) {
    add("child-structure", `\`${childSeq.dominantValue}\``);
  }

  /* Every element has a computed font-size, so recording one says nothing about
   * THIS component. It counts only when it departs from the page default —
   * that is a decision someone made about the component, and a rebuilder needs
   * to know it. Matching the body text is the absence of a decision. */
  const differsFromBody =
    typography &&
    ((typography.fontSize != null && typography.pageFontSize != null && typography.fontSize !== typography.pageFontSize) ||
     (typography.lineHeight != null && typography.pageLineHeight != null && typography.lineHeight !== typography.pageLineHeight));
  if (differsFromBody) {
    add("typography", [
      typography.fontSize != null ? `${typography.fontSize}px` : null,
      typography.lineHeight != null ? `${typography.lineHeight}px line-height` : null
    ].filter(Boolean).join(" / ") + " (differs from body text)");
  }

  if (spacing?.gap != null || spacing?.marginBetween != null) {
    add("spacing", spacing.gap != null ? `${spacing.gap}px gap` : `${spacing.marginBetween}px between instances`);
  }

  const geo = c.geometryClassDiversity;
  if (geo?.distinct === 1 && geo.dominantValue) {
    add("repeated-geometry", `geometry class \`${geo.dominantValue}\``);
    if (/row|inline/.test(String(geo.dominantValue))) add("alignment", "instances share a horizontal rhythm");
  }

  if (childSeq?.dominantValue && /svg/i.test(childSeq.dominantValue)) {
    add("icon-relationship", "an icon sits alongside the label in every instance");
  }

  /* "Carries text" is not a hierarchy. It is true of most elements and would
   * hand every component a free property. Content hierarchy means an ordered
   * arrangement someone designed — a heading leading body copy, or several
   * distinct child roles in a consistent order. */
  const seq = childSeq?.dominantValue ?? "";
  if (/h[1-6]/.test(seq)) {
    add("content-hierarchy", `heading-led content structure \`${seq}\``);
  } else if (seq && seq.split(/[,>\s]+/).filter(Boolean).length >= 3) {
    add("content-hierarchy", `a consistent ${seq.split(/[,>\s]+/).filter(Boolean).length}-part arrangement \`${seq}\``);
  }

  return props;
}

/**
 * The anatomy guard.
 *
 * The rule from the phase brief, implemented literally: with no surface, fewer
 * than three reliable non-surface properties blocks `recreate`; three or more
 * may satisfy anatomy if the mode's own requirements permit it.
 *
 * The guard exists because an unpainted component is easy to under-describe. A
 * feature row with a role, a tag and a child sequence can be rebuilt. A bare
 * `<div>` repeated six times cannot, and no amount of saying "surface: null"
 * changes that.
 */
export function evaluateAnatomy({ surfaceObserved, surfaceClassification, nonSurfaceProperties = [], mode = "recreate" }) {
  const count = nonSurfaceProperties.length;
  const hasSurface = surfaceObserved && surfaceClassification && surfaceClassification !== "unknown" &&
    !["text-only", "layout-only", "none"].includes(surfaceClassification);

  const result = {
    nonSurfacePropertyCount: count,
    properties: nonSurfaceProperties.map((p) => p.property),
    hasSurface,
    surfaceClassification: surfaceClassification ?? "unknown",
    blocksRecreate: false,
    reason: null
  };

  if (hasSurface) {
    result.reason = `A surface was observed (${surfaceClassification}), so anatomy does not rest on non-surface evidence alone.`;
    return result;
  }

  if (surfaceClassification === "unknown") {
    result.blocksRecreate = mode === "recreate";
    result.reason =
      "The surface question could not be answered, which is not the same as answering it with `none`. " +
      "Rebuilding would require guessing whether a background exists.";
    return result;
  }

  if (count < 3) {
    result.blocksRecreate = mode === "recreate";
    result.reason =
      `No painted surface and only ${count} reliable non-surface propert${count === 1 ? "y" : "ies"} ` +
      `(${result.properties.join(", ") || "none"}). Fewer than three is not enough to rebuild the component ` +
      "without inventing it.";
    return result;
  }

  result.reason =
    `No painted surface, but ${count} reliable non-surface properties were evidenced ` +
    `(${result.properties.join(", ")}). That is sufficient anatomy for an unpainted component.`;
  return result;
}

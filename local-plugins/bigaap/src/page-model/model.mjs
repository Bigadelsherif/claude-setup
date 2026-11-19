/**
 * The page model: one whole page, at one viewport, built from normalized evidence.
 *
 * Everything before this describes fragments — observations, then regions with
 * provenance. This assembles them into the thing a builder would actually need:
 * an ordered page with a header, sections, repeated groups and a footer, each
 * still carrying the evidence it rests on. It is the layer at which "analyze a
 * site" stops meaning "measure a card".
 *
 * THREE RULES SHAPE EVERY DECISION HERE.
 *
 * 1. **Absence is never evidence.** A page without a detected header does not
 *    get one invented, and does not get "no header" asserted either. It gets a
 *    header slot marked `unknown` with the reasons the classifier could not
 *    decide. The distinction between "there is no header" and "we could not tell"
 *    is the whole difference between a spec and a guess.
 *
 * 2. **A tag is not a classification.** `<section>` and `<article>` are
 *    structural tags that any page uses for anything; `<header>`, `<nav>`,
 *    `<main>`, `<footer>` and `<aside>` are ARIA landmarks and mean something.
 *    The first kind needs corroboration before it is called a hero or a content
 *    section. The second kind is evidence on its own, which is what a landmark
 *    is for. `observe.mjs` records both under one `role` field, so the split is
 *    re-established here rather than trusted from upstream.
 *
 * 3. **Provenance survives or the claim does not exist.** Every section, group
 *    and property in this model names the normalized regions and observations it
 *    came from, and `validatePageModel` refuses a model where any of those
 *    references dangle. A claim that cannot say where it came from reads exactly
 *    like one that can.
 *
 * WHAT THIS LAYER STILL DOES NOT DO: it does not generate a prompt, does not
 * touch a safety gate, and does not merge viewports. 1440, 768 and 375 produce
 * three models whose ids cannot collide, and comparing them is a later,
 * read-only concern.
 */

import { OBSERVATION_KIND, CLAIM_SCOPE } from "../capture/observe.mjs";
import { PROPERTY_STATUS } from "../evidence/normalize.mjs";
import { SUPPORT_CLASS, classifySupport } from "../modes/support.mjs";

export const PAGE_MODEL_VERSION = "1";

/** What a region was determined to be. `UNKNOWN_SECTION` is a real answer. */
export const SECTION_KIND = Object.freeze({
  HEADER: "header",
  NAVIGATION: "navigation",
  HERO: "hero",
  CONTENT: "content-section",
  CARD_GROUP: "card-group",
  LIST: "list",
  GRID: "grid",
  FORM: "form",
  FOOTER: "footer",
  ASIDE: "aside",
  MAIN: "main",
  UNSUPPORTED: "unsupported-surface",
  UNKNOWN: "unknown-section"
});

/**
 * Evidence a classification may rest on, and what each is worth.
 *
 * A landmark decides on its own. Everything else must corroborate: two
 * independent weak signals, or one medium plus one weak. The thresholds are
 * stated here rather than buried in the branch that uses them, so a reader can
 * see what "enough evidence to call this a hero" actually means.
 */
export const SIGNAL = Object.freeze({
  LANDMARK: "landmark-role",
  EXPLICIT_ROLE: "explicit-aria-role",
  HEADING: "heading-content",
  REPETITION: "repeated-structure",
  POSITION: "document-position",
  GEOMETRY: "geometry",
  ELEMENT_KIND: "element-kind"
});

const SIGNAL_WEIGHT = Object.freeze({
  [SIGNAL.LANDMARK]: 3,
  [SIGNAL.EXPLICIT_ROLE]: 3,
  [SIGNAL.ELEMENT_KIND]: 3,
  [SIGNAL.HEADING]: 2,
  [SIGNAL.REPETITION]: 2,
  [SIGNAL.GEOMETRY]: 1,
  [SIGNAL.POSITION]: 1
});

/** A classification needs this much evidence before it is made at all. */
export const CLASSIFY_THRESHOLD = 3;

/** Tags that are ARIA landmarks. A landmark is evidence; a `<div>` is not. */
const LANDMARK_ROLE = Object.freeze({
  header: SECTION_KIND.HEADER,
  banner: SECTION_KIND.HEADER,
  nav: SECTION_KIND.NAVIGATION,
  navigation: SECTION_KIND.NAVIGATION,
  footer: SECTION_KIND.FOOTER,
  contentinfo: SECTION_KIND.FOOTER,
  main: SECTION_KIND.MAIN,
  aside: SECTION_KIND.ASIDE,
  complementary: SECTION_KIND.ASIDE,
  form: SECTION_KIND.FORM,
  search: SECTION_KIND.FORM
});

/** Structural tags that describe nothing on their own. */
const WEAK_ROLE = new Set(["section", "article", "div", "span", null, undefined]);

/** Surfaces whose content cannot be read as DOM, however they are laid out. */
const UNSUPPORTED_TAG = new Set(["canvas", "video", "iframe", "object", "embed"]);

/** Minimum members before repetition is called a group — the project's `inferred` bar. */
export const REPEAT_MIN_MEMBERS = 3;

const claim = (value, { status, sourceEvidenceIds = [], provenance = [], reason = null, conflicts = [] }) => ({
  value,
  status,
  sourceEvidenceIds,
  provenance,
  ...(reason ? { reason } : {}),
  ...(conflicts.length ? { conflicts } : {})
});

/** An explicitly absent claim. Never a default, never an assertion of absence. */
const unknownClaim = (reason) =>
  claim(null, { status: PROPERTY_STATUS.UNKNOWN, reason });

/**
 * Decides what one region is, from the evidence available about it.
 *
 * Returns the reasons when it cannot decide, because "unknown-section, because
 * the only signal was a `<section>` tag" is actionable and "unknown" alone is
 * not.
 */
export function classifyRegion(region, context = {}) {
  const signals = [];
  const reasons = [];
  const role = region.role ?? null;
  const tag = region.tag ?? null;

  if (UNSUPPORTED_TAG.has(tag)) {
    return {
      kind: SECTION_KIND.UNSUPPORTED,
      confidence: 1,
      basis: [{ signal: SIGNAL.ELEMENT_KIND, detail: `<${tag}> renders content this tool cannot read as DOM` }],
      reasons: []
    };
  }

  const landmark = LANDMARK_ROLE[role];
  if (landmark) {
    signals.push({ signal: SIGNAL.LANDMARK, detail: `landmark role \`${role}\``, kind: landmark });
  } else if (WEAK_ROLE.has(role)) {
    reasons.push(role
      ? `\`${role}\` is a structural tag, not a landmark, and cannot classify on its own`
      : "no landmark role or explicit ARIA role was observed");
  }

  /* Headings are strong evidence for a content section. The region survey
   * collects them; this is a per-region fact, not a capability gap — a
   * region genuinely without a heading is exactly as informative as one
   * with, and the reason below says which one this is rather than blaming
   * the survey for something it now does. */
  const headings = region.semanticHints?.headings ?? null;
  if (Array.isArray(headings) && headings.length > 0) {
    signals.push({ signal: SIGNAL.HEADING, detail: `${headings.length} heading(s) observed` });
  } else {
    reasons.push("no heading was observed in this region");
  }

  if (context.repeatedGroupId) {
    signals.push({ signal: SIGNAL.REPETITION, detail: `member of repeated group ${context.repeatedGroupId}` });
  }

  const geo = region.geometry?.document ?? {};
  const viewportWidth = context.viewportWidth ?? null;
  const viewportHeight = context.viewportHeight ?? null;
  const fullWidth = viewportWidth && geo.width >= viewportWidth * 0.9;
  const tall = viewportHeight && geo.height >= viewportHeight * 0.5;

  if (fullWidth) signals.push({ signal: SIGNAL.GEOMETRY, detail: `spans ${Math.round((geo.width / viewportWidth) * 100)}% of the viewport width` });
  if (context.isFirst) signals.push({ signal: SIGNAL.POSITION, detail: "first region in document order" });
  if (context.isLast) signals.push({ signal: SIGNAL.POSITION, detail: "last region in document order" });

  const score = signals.reduce((n, s) => n + (SIGNAL_WEIGHT[s.signal] ?? 0), 0);

  /* A hero is a specific claim and needs specific evidence: at the top, full
   * width, and at least half the viewport tall. Two of three is not a hero. */
  const heroEvidence = context.isFirst && fullWidth && tall && region.supports?.[CLAIM_SCOPE.ABOVE_FOLD];
  if (heroEvidence && !landmark) {
    return {
      kind: SECTION_KIND.HERO,
      confidence: 0.6,
      basis: [
        { signal: SIGNAL.POSITION, detail: "first region, visible above the fold" },
        { signal: SIGNAL.GEOMETRY, detail: `full width and ${Math.round((geo.height / viewportHeight) * 100)}% of viewport height` }
      ],
      reasons: ["classified from position and geometry; no landmark or heading evidence corroborates it"]
    };
  }

  if (landmark && score >= CLASSIFY_THRESHOLD) {
    return { kind: landmark, confidence: Math.min(1, score / 5), basis: signals, reasons: [] };
  }

  if (context.repeatedGroupId && score >= CLASSIFY_THRESHOLD) {
    return { kind: SECTION_KIND.CARD_GROUP, confidence: Math.min(1, score / 5), basis: signals, reasons: [] };
  }

  if (score >= CLASSIFY_THRESHOLD) {
    return { kind: SECTION_KIND.CONTENT, confidence: Math.min(1, score / 5), basis: signals, reasons: [] };
  }

  return {
    kind: SECTION_KIND.UNKNOWN,
    confidence: 0,
    basis: signals,
    reasons: reasons.length ? reasons : [`evidence score ${score} is below the threshold of ${CLASSIFY_THRESHOLD}`]
  };
}

/**
 * Finds repeated structures among regions.
 *
 * Grouped on shared parent path and comparable geometry, requiring at least
 * three members — the same bar the rest of the project uses before calling
 * something a pattern rather than a coincidence. Members that differ materially
 * in size are NOT collapsed together: two cards of visibly different heights are
 * two things, and merging them would produce a component spec matching neither.
 */
export function detectRepeatedGroups(regions, { minMembers = REPEAT_MIN_MEMBERS } = {}) {
  const buckets = new Map();

  for (const region of regions) {
    const parent = String(region.domPath ?? "").split(">").slice(0, -1).join(">");
    const geo = region.geometry?.document ?? {};
    /* Width and height bucketed coarsely: members of one group vary a little,
     * and members of different groups vary a lot. */
    const key = [parent, region.tag ?? "", Math.round((geo.width ?? 0) / 32), Math.round((geo.height ?? 0) / 32)].join("|");
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(region);
  }

  const groups = [];
  let ordinal = 0;
  for (const [key, members] of [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (members.length < minMembers) continue;
    const ordered = [...members].sort((a, b) =>
      a.geometry.document.top - b.geometry.document.top || a.regionId.localeCompare(b.regionId));
    const viewportWidth = ordered[0].provenance?.[0]?.viewportWidth ?? "x";
    groups.push({
      groupId: `g-${viewportWidth}-${String(ordinal++).padStart(2, "0")}`,
      basisKey: key,
      memberCount: ordered.length,
      memberRegionIds: ordered.map((m) => m.regionId),
      /* Each member keeps its own provenance. A group is a statement about
       * several regions, not a replacement for them. */
      members: ordered.map((m) => ({
        regionId: m.regionId,
        domPath: m.domPath,
        geometry: m.geometry.document,
        provenance: m.provenance,
        sourceEvidenceIds: m.sourceObservationIds,
        unstable: m.unstable,
        conflicts: m.conflicts
      })),
      status: PROPERTY_STATUS.OBSERVED,
      evidence: {
        signal: SIGNAL.REPETITION,
        detail: `${ordered.length} regions share a parent path and comparable geometry`,
        minMembers
      }
    });
  }
  return groups;
}

/**
 * Who contains whom, from DOM paths alone.
 *
 * Measured, never guessed: region B is inside region A exactly when B's DOM
 * path starts with A's path plus a separator. No geometry, no overlap
 * heuristic, no threshold — containment is a fact the path already states,
 * and reading it from anywhere else would invent a hierarchy.
 *
 * WHY THIS EXISTS. Measured on a real site, a bounded region survey returns a
 * CONTAINMENT CHAIN, not a page outline: the outermost `<div>` wrapping the
 * whole document is observed as one region, the wrapper inside it as another,
 * and every genuine section as a third — 33 regions of which the first was the
 * entire 10,898px page. Emitted as a flat list, that reads as "33 sections in
 * document order", and a builder following it would nest the whole page inside
 * its own first section. The flat list is still correct as a list of observed
 * regions; what was missing was the fact that most of them are ancestors of
 * the others, so this records it rather than flattening or dropping anything.
 */
export function detectContainment(sections) {
  const byId = new Map();
  const isInside = (inner, outer) =>
    outer.domPath && inner.domPath && inner.domPath !== outer.domPath &&
    inner.domPath.startsWith(`${outer.domPath}>`);

  for (const section of sections) {
    /* The NEAREST ancestor is the one with the longest matching path — the
     * immediate container rather than the outermost one. */
    let parent = null;
    for (const candidate of sections) {
      if (!isInside(section, candidate)) continue;
      if (!parent || candidate.domPath.length > parent.domPath.length) parent = candidate;
    }
    byId.set(section.sectionId, {
      parentSectionId: parent ? parent.sectionId : null,
      parentRegionId: parent ? parent.regionId : null,
      depth: 0,
      childSectionIds: [],
      containsSectionIds: [],
      isTopLevel: parent === null
    });
  }

  for (const section of sections) {
    const entry = byId.get(section.sectionId);
    if (entry.parentSectionId) byId.get(entry.parentSectionId).childSectionIds.push(section.sectionId);
    for (const other of sections) {
      if (isInside(other, section)) entry.containsSectionIds.push(other.sectionId);
    }
    let depth = 0;
    let cursor = entry.parentSectionId;
    while (cursor && depth < 64) { depth++; cursor = byId.get(cursor)?.parentSectionId ?? null; }
    entry.depth = depth;
  }

  return byId;
}

/**
 * Heading records carried onto a section, with the provenance that saw them.
 *
 * `classifyRegion` already reads these to decide what a region is; until now
 * they stopped there, so a downstream consumer could see that a heading
 * INFLUENCED a classification but never what the heading said. Level and text
 * are copied verbatim from the survey; nothing here rewrites, truncates
 * further, or synthesises a heading for a region that had none.
 */
function headingsFor(region) {
  const headings = region.semanticHints?.headings;
  if (!Array.isArray(headings) || headings.length === 0) {
    return {
      status: PROPERTY_STATUS.UNKNOWN,
      items: [],
      reason: "no heading was observed in this region"
    };
  }
  return {
    status: PROPERTY_STATUS.OBSERVED,
    items: headings.map((h) => ({ level: h.level ?? null, text: h.text ?? null })),
    observationIds: region.sourceObservationIds ?? [],
    provenance: region.provenance ?? [],
    supports: region.supports
  };
}

/**
 * Builds the page model for one viewport.
 *
 * @param {object} normalized   output of `normalize.buildEvidence`
 * @param {object} [options]
 * @param {{hiddenDominant?:boolean, truncated?:boolean, authWall?:boolean,
 *          antiAutomation?:boolean, interactionGated?:boolean,
 *          imagesUnresolved?:boolean}} [options.capture]
 *        capture-level facts recorded elsewhere; passed in rather than guessed
 * @param {string|null} [options.title]  observed document title, if any
 */
export function buildPageModel(normalized, options = {}) {
  if (!normalized || normalized.$normalizedEvidence == null) {
    throw new TypeError("buildPageModel requires normalized evidence from normalize.buildEvidence");
  }

  const viewport = normalized.viewport ?? {};
  const width = viewport.width;
  const regions = [...(normalized.regions ?? [])].sort((a, b) =>
    a.geometry.document.top - b.geometry.document.top ||
    a.geometry.document.left - b.geometry.document.left ||
    a.regionId.localeCompare(b.regionId));

  const groups = detectRepeatedGroups(regions);
  const groupOf = new Map();
  for (const g of groups) for (const id of g.memberRegionIds) groupOf.set(id, g.groupId);

  /**
   * The visual regions belonging to one measured region.
   *
   * Membership is by DOM path prefix — the same containment rule the section
   * tree itself uses — with the region's own path counting as a member so a
   * section that IS the painted surface still owns its visual. Geometry is not
   * used: two boxes can overlap without one containing the other, and a visual
   * assigned by overlap would be attached to whichever section happened to sit
   * behind it.
   */
  const visualRegionsFor = (region, visualRegions) => {
    const own = region.domPath;
    if (!own) return [];
    return visualRegions.filter((v) => v.domPath === own || String(v.domPath).startsWith(own + ">"));
  };

  const sections = regions.map((region, i) => {
    const classification = classifyRegion(region, {
      isFirst: i === 0,
      isLast: i === regions.length - 1,
      viewportWidth: width,
      viewportHeight: viewport.height,
      repeatedGroupId: groupOf.get(region.regionId) ?? null
    });

    return {
      sectionId: `s-${width}-${String(i).padStart(3, "0")}`,
      order: i,
      kind: classification.kind,
      classification: {
        confidence: classification.confidence,
        basis: classification.basis,
        reasons: classification.reasons
      },
      regionId: region.regionId,
      identity: region.identity,
      domPath: region.domPath,
      tag: region.tag,
      role: region.role,
      geometry: region.geometry.document,
      viewportGeometry: region.geometry.viewport,
      repeatedGroupId: groupOf.get(region.regionId) ?? null,
      /* The support flags come straight from normalization; nothing here widens
       * them. A scroll-revealed section describes the resting page and never the
       * fold, whatever it was classified as. */
      supports: region.supports,
      kinds: region.kinds,
      state: region.provenance.find((p) => p.state)?.state ?? null,
      provenance: region.provenance,
      sourceEvidenceIds: [region.regionId, ...region.sourceObservationIds],
      status: region.status,
      unstable: region.unstable,
      conflicts: region.conflicts,
      properties: region.properties,
      /* Copy and headings, carried verbatim with their own provenance. NOTE
       * what is deliberately absent: neither is a classification SIGNAL. Text
       * says what a region contains, not what a region IS — a `<div>` full of
       * prose is still a `<div>`, and letting copy vote on section-hood would
       * turn every text node on a modern site into a page section. */
      text: region.text ?? { status: PROPERTY_STATUS.UNKNOWN, value: null, reason: "this evidence predates text propagation" },
      headings: headingsFor(region),
      /* Painted interiors that sit inside this section's box, attached by
       * containment rather than re-derived. A section's visual regions say what
       * FILLS it; nothing here says what any of them depict. */
      visualRegions: visualRegionsFor(region, normalized.visualRegions ?? [])
    };
  });

  /* Containment is computed after every section has an id, and attached in
   * place — a second pass rather than a nested loop inside the first, so a
   * section can name siblings that had not been built yet when it was. */
  const containment = detectContainment(sections);
  for (const section of sections) {
    const c = containment.get(section.sectionId);
    section.containment = {
      parentSectionId: c.parentSectionId,
      parentRegionId: c.parentRegionId,
      depth: c.depth,
      childSectionIds: c.childSectionIds,
      containsSectionIds: c.containsSectionIds,
      isTopLevel: c.isTopLevel,
      isContainer: c.containsSectionIds.length > 0
    };
    /* A region that wraps other observed regions is a container. Recorded on
     * the classification's REASONS, never on its `kind`: this phase changes
     * no threshold, so a wrapper that met the hero bar is still classified a
     * hero — it now says, in the same breath, that it contains N other
     * observed sections and therefore is not a leaf section a builder should
     * emit as one. */
    if (section.containment.isContainer) {
      section.classification.reasons = [
        ...section.classification.reasons,
        `this region contains ${section.containment.containsSectionIds.length} other observed section(s); `
          + "it is a container in the observed hierarchy, not a leaf section"
      ];
    }
  }

  const topLevelSections = sections.filter((s) => s.containment.isTopLevel).map((s) => s.sectionId);

  const firstOfKind = (kind) => sections.find((s) => s.kind === kind) ?? null;
  const slot = (kind, missingReason) => {
    const found = firstOfKind(kind);
    if (!found) return unknownClaim(missingReason);
    const c = claim(found.sectionId, {
      status: PROPERTY_STATUS.OBSERVED,
      sourceEvidenceIds: found.sourceEvidenceIds,
      provenance: found.provenance
    });
    /* A landmark slot filled by a container says so. The claim stays
     * `observed` — the landmark WAS observed — but a consumer that would
     * otherwise build this slot as a single leaf element can now see that the
     * observed region wraps others, without this layer having moved a
     * threshold to tell it. */
    if (found.containment.isContainer) {
      c.wrapper = true;
      c.containsSectionIds = found.containment.containsSectionIds;
      c.wrapperNote = `\`${found.sectionId}\` contains ${found.containment.containsSectionIds.length} other observed section(s); `
        + "it is the container the landmark was observed on, not a complete leaf element.";
    }
    return c;
  };

  const unsupported = sections
    .filter((s) => s.kind === SECTION_KIND.UNSUPPORTED)
    .map((s) => ({
      sectionId: s.sectionId,
      regionId: s.regionId,
      tag: s.tag,
      reason: `<${s.tag}> draws its content on a surface with no readable DOM; it is recorded, not reverse-engineered`,
      sourceEvidenceIds: s.sourceEvidenceIds
    }));

  /* Property roll-ups. Every one of these is unknown unless an observation
   * actually carried it, and the region survey does not yet collect styles — so
   * on live captures they are unknown and say why. */
  const collectProperty = (name, label) => {
    const carriers = sections.filter((s) => s.properties?.[name]?.status === PROPERTY_STATUS.OBSERVED);
    if (carriers.length === 0) {
      return unknownClaim(`no observation carried ${label}; absence here is unknown, not a finding that the page has none`);
    }
    const conflicted = carriers.filter((s) => s.properties[name].status === PROPERTY_STATUS.CONFLICTED);
    return claim(carriers.map((s) => ({ sectionId: s.sectionId, value: s.properties[name].value })), {
      status: conflicted.length ? PROPERTY_STATUS.CONFLICTED : PROPERTY_STATUS.OBSERVED,
      sourceEvidenceIds: carriers.flatMap((s) => s.sourceEvidenceIds),
      provenance: carriers.flatMap((s) => s.provenance)
    });
  };

  const pageHeight = regions.length
    ? claim(Math.max(...regions.map((r) => r.geometry.document.top + r.geometry.document.height)), {
        status: PROPERTY_STATUS.OBSERVED,
        sourceEvidenceIds: regions.map((r) => r.regionId),
        provenance: regions.flatMap((r) => r.provenance).slice(0, 4)
      })
    : unknownClaim("no region was observed, so the page extent is unknown");

  const capture = options.capture ?? {};
  const hiddenDominant = capture.hiddenDominant === true;

  /* ── why a hidden-DOM ratio no longer decides sufficiency ───────────────
   *
   * Measured on one 4019-node document at three widths: 47% hidden at 1440,
   * 53% at 768, 81% at 375. The 375 capture — refused under the old rule —
   * had observed a complete page: header, nav, hero, five sections with
   * headings and copy, a call to action and a footer, 13 of 16 regions
   * classified, every DOM path shared with the 1440 model. The hiding was
   * 233 `display:none` subtrees, which is what working responsive CSS looks
   * like.
   *
   * A ratio cannot tell that from a page that never rendered, because in
   * BOTH cases most nodes are never visible. The quantity that does tell them
   * apart is what discovery actually produced, so that is what decides:
   * enough classified sections AND some real page evidence — a landmark or a
   * heading. That is STRICTER than the old rule in the failure case (a blank
   * or unmounted page has neither) and stops punishing a responsive one.
   *
   * `hiddenDominant`, `neverVisibleRatio` and `scrollRevealedNodes` are all
   * still measured and still reported; they became warnings rather than the
   * verdict. */
  const classifiedSections = sections.filter((s) => s.kind !== SECTION_KIND.UNKNOWN);
  const landmarkSections = sections.filter((s) => LANDMARK_ROLE[s.role]);
  const headingSections = sections.filter((s) => s.headings?.status === PROPERTY_STATUS.OBSERVED);
  const copySections = sections.filter((s) => s.text?.status === PROPERTY_STATUS.OBSERVED
    || s.text?.status === PROPERTY_STATUS.CONFLICTED);

  const hasStructure = classifiedSections.length >= 2;
  const hasPageEvidence = landmarkSections.length > 0 || headingSections.length > 0;
  const hasCopy = copySections.length > 0;
  const hasGeometry = sections.length > 0 && sections.every((s) =>
    Number.isFinite(s.geometry?.width) && s.geometry.width > 0 &&
    Number.isFinite(s.geometry?.height) && s.geometry.height > 0);
  const hasDomIdentity = sections.length > 0 && sections.every((s) => typeof s.domPath === "string" && s.domPath.length > 0);

  const baseSufficient = hasStructure && hasPageEvidence && hasGeometry && hasDomIdentity;
  /* A hidden-dominant viewport carries the extra burden of proof: the visible
   * remainder must also carry COPY before it counts as a page. That is what
   * separates "the design hides its desktop markup here" from "almost nothing
   * rendered and the little that did happens to include a landmark". */
  const evidenceSufficient = hiddenDominant ? (baseSufficient && hasCopy) : baseSufficient;

  /**
   * Which of the four situations this viewport is in.
   *
   * Reported alongside the support class rather than as a new class: the
   * taxonomy is exactly eight values and `phase536`'s R10 pins that. This
   * says WHY a class was reached, which is the thing a reader could not
   * previously tell — a page refused for never rendering and a page refused
   * for being thin both read `insufficient-evidence`.
   */
  const evidenceReason = capture.truncated === true ? "truncated-capture"
    : !hasGeometry || !hasDomIdentity ? "never-rendered"
    : !hasStructure || !hasPageEvidence ? "blank-or-thin-page"
    : hiddenDominant && !hasCopy ? "hidden-dominant-without-copy"
    : hiddenDominant ? "responsive-hidden-dominant"
    : "observed";

  const evidenceBasis = {
    reason: evidenceReason,
    sufficient: evidenceSufficient,
    signals: {
      classifiedSections: classifiedSections.length,
      landmarks: landmarkSections.length,
      headings: headingSections.length,
      sectionsWithCopy: copySections.length,
      validGeometry: hasGeometry,
      domIdentity: hasDomIdentity,
      hiddenDominant,
      hiddenRatio: capture.hiddenRatio ?? null,
      scrollRevealedNodes: capture.scrollRevealedNodes ?? 0
    },
    note: evidenceReason === "responsive-hidden-dominant"
      ? "Most of the document is hidden at rest at this viewport, and the visible remainder is a complete page with landmarks or headings, copy and valid geometry. That is responsive markup being removed at this width, not content that failed to render."
      : evidenceReason === "never-rendered"
        ? "No region carried valid geometry or a DOM identity, so nothing about this viewport was observed."
        : evidenceReason === "blank-or-thin-page"
          ? "What was observed does not establish a page: fewer than two classified sections, or no landmark and no heading."
          : evidenceReason === "hidden-dominant-without-copy"
            ? "Most of the document is hidden at rest and the visible remainder carries no copy, so it cannot be told apart from a page that did not render."
            : evidenceReason === "truncated-capture"
              ? "Discovery stopped on budget while the page was still changing."
              : "The page was observed and what was seen establishes it."
  };
  /* A page with almost nothing visible must not be promoted to a complete
   * model. The taxonomy already has the vocabulary; this supplies the facts. */
  const support = classifySupport({
    authWall: capture.authWall === true,
    antiAutomation: capture.antiAutomation === true,
    unsupportedSurface: unsupported.length > 0 && unsupported.length >= sections.length,
    captureTruncated: capture.truncated === true,
    interactionGated: capture.interactionGated === true,
    evidenceSufficient,
    warnings: [
      /* Reported, not refused. At a narrow viewport a high at-rest hidden
       * ratio is what responsive CSS looks like; what it costs the reader is
       * that anything not listed here is unknown rather than absent, and
       * that is exactly what a warning is for. */
      ...(hiddenDominant
        ? [`${Math.round((capture.hiddenRatio ?? 0) * 100)}% of the document is hidden at rest at this viewport. `
           + "On a responsive page that is the design removing markup at this width, not a failed capture — but it "
           + "means content not listed in this model is unknown here, never established as absent."]
        : []),
      ...(capture.scrollRevealedNodes > 0
        ? [`${capture.scrollRevealedNodes} node(s) were hidden at the top and became visible while scrolling; `
           + "their evidence describes the resting page, never the fold."]
        : []),
      /* Recorded as a warning, not folded into `evidenceSufficient`: the
       * settle loop already separates "content never mounted" from "images
       * never finished loading" (def_0032's whole point), and a page that is
       * otherwise fully observed should not be refused over a slow image —
       * it should say so and stay analyzable. */
      ...(capture.imagesUnresolved === true
        ? ["images were still pending when discovery finished; layout that depends on them may not be final"]
        : []),
      ...(sections.some((s) => s.unstable) ? ["one or more regions moved between observations"] : []),
      ...(unsupported.length ? [`${unsupported.length} unreadable surface(s) recorded`] : [])
    ]
  });

  const unknowns = [
    ...sections.filter((s) => s.kind === SECTION_KIND.UNKNOWN)
      .map((s) => ({ what: s.sectionId, why: s.classification.reasons })),
    ...["typography", "colors", "spacing", "assets"].map((k) => null).filter(Boolean)
  ];

  return {
    $pageModel: PAGE_MODEL_VERSION,
    viewport: { width, height: viewport.height ?? null },
    url: normalized.url ?? null,
    title: options.title
      ? claim(options.title, { status: PROPERTY_STATUS.OBSERVED, sourceEvidenceIds: [] })
      : unknownClaim("no document title was observed by the region survey"),
    pageHeight,

    /* Every observed region survives, in document order, whether or not it could
     * be classified. Dropping the unclassifiable ones would make the model look
     * tidier and describe less of the page. */
    sections,

    /* Painted interiors for this viewport, listed once at the top level as well
     * as attached to their sections. The summary is what makes "the clone still
     * cannot show this part of the page" a number somebody can track down
     * rather than an impression. */
    visualRegions: normalized.visualRegions ?? [],
    visualCoverage: (() => {
      const all = normalized.visualRegions ?? [];
      const byReason = {};
      for (const v of all) if (!v.resolved && v.unresolvedReason) byReason[v.unresolvedReason] = (byReason[v.unresolvedReason] ?? 0) + 1;
      return {
        total: all.length,
        resolved: all.filter((v) => v.resolved).length,
        unresolved: all.filter((v) => !v.resolved).length,
        byType: all.reduce((acc, v) => { acc[v.type] = (acc[v.type] ?? 0) + 1; return acc; }, {}),
        unresolvedByReason: byReason,
        sectionsWithVisuals: sections.filter((s) => (s.visualRegions ?? []).length > 0).length,
        note: "counts painted regions that were located. Nothing here describes what any of them depict."
      };
    })(),

    /* The observed hierarchy, stated rather than flattened.
     *
     * `sections` remains every observed region in document order — nothing is
     * dropped. This says which of them are outermost, so a consumer can build
     * the page from `topLevelSections` and treat the rest as their contents,
     * instead of reading a containment chain as a list of siblings. */
    outline: {
      topLevelSections,
      containerSections: sections.filter((s) => s.containment.isContainer).map((s) => s.sectionId),
      maxDepth: sections.reduce((n, s) => Math.max(n, s.containment.depth), 0),
      note: "`sections` is every observed region in document order. `topLevelSections` are those with no observed ancestor; every other section is contained by one of them and must not be emitted as its sibling."
    },

    header: slot(SECTION_KIND.HEADER, "no landmark header was observed; a header is not assumed from position alone"),
    navigation: slot(SECTION_KIND.NAVIGATION, "no navigation landmark was observed"),
    hero: slot(SECTION_KIND.HERO, "no region met the hero evidence bar (first, full width, half viewport tall, above the fold)"),
    main: slot(SECTION_KIND.MAIN, "no main landmark was observed"),
    footer: slot(SECTION_KIND.FOOTER, "no landmark footer was observed; a footer is not assumed from being last"),

    contentSections: sections.filter((s) => s.kind === SECTION_KIND.CONTENT).map((s) => s.sectionId),
    forms: sections.filter((s) => s.kind === SECTION_KIND.FORM).map((s) => s.sectionId),
    repeatedGroups: groups,

    assets: collectProperty("assets", "asset dimensions"),
    typography: collectProperty("typography", "typography roles"),
    colors: collectProperty("colors", "colour roles"),
    spacing: collectProperty("spacing", "spacing evidence"),
    layout: collectProperty("layout", "container or grid evidence"),

    accessibility: {
      landmarksObserved: sections.filter((s) => LANDMARK_ROLE[s.role]).map((s) => s.sectionId),
      note: "Landmark presence is observed. Anything not listed is unknown rather than absent."
    },

    responsive: unknownClaim(
      "responsive behaviour is not established by a single viewport; breakpoints require evidence this model does not hold"
    ),

    scrollReveal: {
      scrollRevealedSections: sections
        .filter((s) => !s.supports[CLAIM_SCOPE.ABOVE_FOLD] && s.kinds.includes(OBSERVATION_KIND.SCROLL_REVEALED))
        .map((s) => s.sectionId),
      note: "These sections exist on the resting page and were revealed by scrolling. They are not above-fold evidence."
    },
    /* Observed interaction states.
     *
     * When discovery ran, these are its records verbatim — action, target,
     * before/after provenance, restoration, and the reason for anything
     * refused. When it did not run this is an EMPTY array, and every
     * interaction dimension downstream reports `unknown` rather than treating
     * emptiness as "this page has no interactions".
     *
     * Sections that were only ever seen in an interaction state are listed
     * beside them, so a reader can find the regions a transition affected
     * without the states themselves having to describe the page. */
    /* UNCHANGED MEANING. Sections that were only ever seen in an interaction
     * state — the field `phase533`'s P5 pins. The interaction records added in
     * phase 545 are a different thing and live under their own name below;
     * reusing this one would have silently redefined a tested guarantee. */
    interactionStates: sections
      .filter((s) => s.kinds.includes(OBSERVATION_KIND.INTERACTION))
      .map((s) => ({ sectionId: s.sectionId, state: s.state })),

    /* Observed interaction transitions, verbatim from discovery: action,
     * target, before/after provenance, restoration, and the reason for anything
     * refused. An EMPTY array when discovery did not run — and `discovery.ran`
     * is what tells the two apart, so emptiness is never read as "this page has
     * no interactions". */
    observedInteractions: options.interactionEvidence?.states ?? [],
    interactionDiscovery: options.interactionEvidence
      ? {
          ran: true,
          candidates: options.interactionEvidence.counts.candidates,
          completed: options.interactionEvidence.counts.completed,
          refused: options.interactionEvidence.counts.refused,
          captureCompromised: options.interactionEvidence.captureCompromised
        }
      : { ran: false, note: "interaction discovery was not run for this viewport; every interaction behaviour is unknown rather than absent" },

    unsupported,
    unknowns,
    conflicts: sections.filter((s) => s.unstable)
      .map((s) => ({ sectionId: s.sectionId, conflicts: s.conflicts })),

    /* Why the support class above was reached — the four situations kept
     * apart, so a reader can tell a page that never rendered from one that is
     * merely responsive. */
    evidenceBasis,
    support: { ...support, evidenceReason, evidenceBasis },
    counts: {
      sections: sections.length,
      classified: sections.filter((s) => s.kind !== SECTION_KIND.UNKNOWN).length,
      unknownSections: sections.filter((s) => s.kind === SECTION_KIND.UNKNOWN).length,
      repeatedGroups: groups.length,
      scrollRevealedOnly: sections.filter((s) => !s.supports[CLAIM_SCOPE.ABOVE_FOLD]).length,
      unstable: sections.filter((s) => s.unstable).length,
      unsupported: unsupported.length,
      topLevel: topLevelSections.length,
      containers: sections.filter((s) => s.containment.isContainer).length,
      withText: sections.filter((s) => s.text?.status === PROPERTY_STATUS.OBSERVED).length,
      withHeadings: sections.filter((s) => s.headings?.status === PROPERTY_STATUS.OBSERVED).length
    }
  };
}

/**
 * Validates a page model, with the provenance check as the load-bearing part.
 *
 * A section citing a region or observation that is not in the source evidence is
 * the failure this exists to catch: it reads as supported and is not.
 */
export function validatePageModel(model, normalized) {
  const problems = [];
  const at = (where, message) => problems.push({ where, message });

  if (!model || typeof model !== "object") return { valid: false, problems: [{ where: "$", message: "expected an object" }] };
  if (model.$pageModel !== PAGE_MODEL_VERSION) {
    at("$pageModel", `expected version ${PAGE_MODEL_VERSION}, found ${JSON.stringify(model.$pageModel)}`);
  }
  if (!Number.isFinite(model.viewport?.width)) at("viewport.width", "a page model must state its viewport width");
  if (!Array.isArray(model.sections)) { at("sections", "expected an array"); return { valid: false, problems }; }

  const knownRegions = new Set((normalized?.regions ?? []).map((r) => r.regionId));
  const knownObservations = new Set((normalized?.observations ?? []).map((o) => o.id));
  const seen = new Set();

  model.sections.forEach((s, i) => {
    const where = `sections[${i}]`;
    if (seen.has(s.sectionId)) at(`${where}.sectionId`, `duplicate section id ${s.sectionId}`);
    seen.add(s.sectionId);

    if (!String(s.sectionId ?? "").startsWith(`s-${model.viewport.width}-`)) {
      at(`${where}.sectionId`, `${s.sectionId} does not carry viewport ${model.viewport.width}; models must not be mergeable`);
    }
    if (!Object.values(SECTION_KIND).includes(s.kind)) at(`${where}.kind`, `unknown kind ${JSON.stringify(s.kind)}`);
    if (!Array.isArray(s.provenance) || s.provenance.length === 0) {
      at(`${where}.provenance`, "every section must carry provenance");
    }
    if (normalized && !knownRegions.has(s.regionId)) {
      at(`${where}.regionId`, `${s.regionId} is not present in the source evidence`);
    }
    for (const id of s.sourceEvidenceIds ?? []) {
      if (normalized && !knownRegions.has(id) && !knownObservations.has(id)) {
        at(`${where}.sourceEvidenceIds`, `${id} is present in neither the regions nor the observations of the source evidence`);
      }
    }
    if (s.supports?.[CLAIM_SCOPE.ABOVE_FOLD] && !s.kinds?.includes(OBSERVATION_KIND.INITIAL)) {
      at(`${where}.supports`, "claims above-fold support without an initial-state sighting");
    }
    if (s.kinds?.length && s.kinds.every((k) => k === OBSERVATION_KIND.INTERACTION) &&
        s.supports?.[CLAIM_SCOPE.RESTING_PAGE]) {
      at(`${where}.supports`, "interaction-derived evidence must not be promoted to resting-page evidence");
    }
  });

  for (const g of model.repeatedGroups ?? []) {
    if ((g.memberRegionIds ?? []).length < REPEAT_MIN_MEMBERS) {
      at(`repeatedGroups.${g.groupId}`, `a group needs at least ${REPEAT_MIN_MEMBERS} members`);
    }
    for (const m of g.members ?? []) {
      if (!Array.isArray(m.provenance) || m.provenance.length === 0) {
        at(`repeatedGroups.${g.groupId}`, `member ${m.regionId} lost its provenance`);
      }
    }
  }

  return { valid: problems.length === 0, problems };
}

export const serializeModel = (model) => JSON.stringify(model, null, 2) + "\n";

export function deserializeModel(json, normalized = null) {
  const model = JSON.parse(json);
  const check = validatePageModel(model, normalized);
  if (!check.valid) {
    throw new TypeError(
      `page model failed validation — ${check.problems.map((p) => `${p.where}: ${p.message}`).join("; ")}`
    );
  }
  return model;
}

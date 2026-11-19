/**
 * The clone-prompt generator: validated page models in, an implementation
 * prompt or a refusal artifact out. Nothing else.
 *
 * THE THREE INPUTS ARE THE WHOLE CONTRACT.
 *
 *   - a per-viewport page model, already built by `page-model/model.mjs` and
 *     already validated by `validatePageModel`;
 *   - the normalized evidence that model was built from, already validated
 *     by `validateNormalizedEvidence`;
 *   - the support classification that model carries (`model.support`).
 *
 * This module reads exactly those three things, for one or more viewports of
 * one URL, and nothing else. It does not import a driver, does not import
 * `observe.mjs`'s `REGION_SURVEY`, and does not accept a DOM, a page handle,
 * or a browser session anywhere in its call signature. If a future caller
 * wants this to read live browser state, that is a different module calling
 * this one with fresher input — never this module reaching backward for it.
 *
 * WHAT DECIDES PROMPT VS. REFUSAL. Exactly `support.mjs`'s `producesOutput`,
 * applied per viewport, unchanged. A viewport whose support class does not
 * produce output contributes NOTHING to the prompt's sections, styles,
 * layout or assets — it is listed, by class and remedy, in the refusal (if
 * no viewport is usable) or in `excludedViewports` (if at least one other
 * viewport is). Nothing here lowers that gate, retries around it, or invents
 * structure for a viewport whose evidence was insufficient. `phase537`'s
 * hidden-dominant and truncated-capture tests exist to catch a regression
 * that tries.
 *
 * WHAT A CLAIM IS ALLOWED TO SAY. Every fact in the prompt — a color, a
 * font, a layout detail, a section's existence — carries the region,
 * section, observation or group id(s) it came from, copied verbatim from the
 * input models. `validateClonePrompt` walks the whole output and refuses one
 * where any of those ids does not resolve in the source evidence, the same
 * discipline `validatePageModel` already enforces one layer down. Nothing is
 * grouped, rounded, guessed, or filled in where evidence is silent — silence
 * becomes an explicit `unknown` entry, never a default.
 *
 * WHAT THE REFUSAL PATH NEVER WRITES. No fenced code block, no CSS, no
 * "design tokens" section, no numbered build step. A refusal names the
 * support class, what it means, and what would change it — it is a report
 * about the evidence, not a degraded attempt at a prompt.
 */

import { CLAIM_SCOPE } from "../capture/observe.mjs";
import { producesOutput, SUPPORT_CLASS, SUPPORT_DETAIL } from "../modes/support.mjs";

export const CLONE_PROMPT_VERSION = "1";

const TYPOGRAPHY_PROPERTIES = Object.freeze(["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing"]);
const COLOR_PROPERTIES = Object.freeze(["color", "backgroundColor", "borderColor"]);
const SPACING_PROPERTIES = Object.freeze(["margin", "padding", "gap", "borderRadius", "borderWidth"]);
const LAYOUT_SCALAR_PROPERTIES = Object.freeze(["display", "position", "zIndex"]);

/** A precise, structured failure. The CLI layer (not built yet) reports its `.problems`; a test asserts on them directly. */
export class ClonePromptError extends Error {
  constructor(stage, problems) {
    const detail = problems.map((p) => `${p.where}: ${p.message}`).join("; ");
    super(`clone-prompt generation failed at ${stage} — ${detail}`);
    this.name = "ClonePromptError";
    this.stage = stage;
    this.problems = problems;
  }
}

const problem = (where, message) => ({ where, message });

/**
 * Checks the three inputs before anything is built from them.
 *
 * Rejects rather than repairs, exactly like `normalize.validateObservations`
 * and `model.validatePageModel` do one layer down: an entry missing its
 * model or normalized evidence cannot be reasoned about, and guessing would
 * silently attribute a claim to evidence that was never checked.
 */
function validateInputViewports(viewports) {
  const problems = [];
  if (!Array.isArray(viewports) || viewports.length === 0) {
    problems.push(problem("viewports", "expected a non-empty array of {width, model, normalized, support}"));
    return problems;
  }
  viewports.forEach((v, i) => {
    const at = `viewports[${i}]`;
    if (!v || typeof v !== "object") { problems.push(problem(at, "must be an object")); return; }
    if (!Number.isFinite(v.width) || v.width <= 0) problems.push(problem(`${at}.width`, "must be a positive number"));
    if (!v.model || v.model.$pageModel == null) problems.push(problem(`${at}.model`, "must be a validated page model (from page-model/model.mjs)"));
    if (!v.normalized || v.normalized.$normalizedEvidence == null) problems.push(problem(`${at}.normalized`, "must be validated normalized evidence (from evidence/normalize.mjs)"));
    if (!v.support || typeof v.support.supportClass !== "string") problems.push(problem(`${at}.support`, "must be a support classification (from modes/support.mjs)"));
    if (v.model?.viewport && Number.isFinite(v.width) && v.model.viewport.width !== v.width) {
      problems.push(problem(`${at}.width`, `entry declares width ${v.width} but its model belongs to viewport ${v.model.viewport.width}`));
    }
  });
  return problems;
}

/* ------------------------------------------------------------- style facts */

/** One property's distinct observed values across a set of sections, deduplicated, each tagged with where it came from. */
function collectPropertyFacts(sections, propertyNames) {
  const byName = {};
  for (const name of propertyNames) byName[name] = new Map();

  const upsert = (map, value, sectionId, observationIds, conflicted) => {
    const key = JSON.stringify(value);
    if (!map.has(key)) map.set(key, { value, sectionIds: [], observationIds: new Set(), conflicted: false });
    const entry = map.get(key);
    if (!entry.sectionIds.includes(sectionId)) entry.sectionIds.push(sectionId);
    for (const id of observationIds ?? []) entry.observationIds.add(id);
    if (conflicted) entry.conflicted = true;
  };

  for (const section of sections) {
    for (const name of propertyNames) {
      const prop = section.properties?.[name];
      if (!prop || prop.status === "unknown") continue;
      const conflicted = prop.status === "conflicted";
      upsert(byName[name], prop.value, section.sectionId, prop.observationIds, conflicted);
      /* A conflicted property's alternate value lives in `.conflicts`, not in
       * `.value` — normalize.mjs keeps the first sighting as `value` and
       * appends every disagreement rather than overwriting it. Visiting only
       * `.value` would silently drop every value but the first one, which is
       * exactly the "averaging by omission" this whole pipeline exists to
       * refuse. Both sides of a disagreement must reach the prompt. */
      if (conflicted) {
        for (const c of prop.conflicts ?? []) {
          upsert(byName[name], c.value, section.sectionId, c.observationId ? [c.observationId] : [], true);
        }
      }
    }
  }

  const out = {};
  for (const name of propertyNames) {
    out[name] = [...byName[name].values()]
      .map((e) => ({
        value: e.value,
        sectionIds: [...e.sectionIds].sort(),
        observationIds: [...e.observationIds].sort(),
        conflicted: e.conflicted
      }))
      .sort((a, b) => JSON.stringify(a.value).localeCompare(JSON.stringify(b.value)));
  }
  return out;
}

/** A style category (typography, colors, spacing): `unknown` when nothing observed, `observed` with per-property facts otherwise. */
function styleCategory(sections, propertyNames) {
  const facts = collectPropertyFacts(sections, propertyNames);
  const carried = propertyNames.filter((n) => facts[n].length > 0);
  if (carried.length === 0) {
    return {
      status: "unknown",
      reason: `no section carried a value for any of: ${propertyNames.join(", ")}`,
      properties: {}
    };
  }
  return { status: "observed", properties: facts };
}

/** Layout detail is per-section (a container's own arrangement), not deduplicated across sections the way a color is. */
function layoutFactFor(section) {
  const prop = section.properties?.layout;
  const scalars = {};
  for (const name of LAYOUT_SCALAR_PROPERTIES) {
    const p = section.properties?.[name];
    if (p && p.status !== "unknown") scalars[name] = { value: p.value, observationIds: p.observationIds ?? [] };
  }
  if (!prop || prop.status === "unknown") {
    return Object.keys(scalars).length
      ? { status: "observed", detail: null, scalars }
      : { status: "unknown", reason: "no layout evidence was carried for this section", detail: null, scalars: {} };
  }
  return {
    status: prop.status,
    detail: prop.value,
    observationIds: prop.observationIds ?? [],
    scalars
  };
}

/** Every distinct asset a set of sections observed, deduplicated by kind+identity+rendered size. */
function collectAssetFacts(sections) {
  const seen = new Map();
  for (const section of sections) {
    const prop = section.properties?.assets;
    if (!prop || prop.status === "unknown" || !Array.isArray(prop.value)) continue;
    for (const asset of prop.value) {
      const key = `${asset.kind}|${asset.identity}|${asset.rendered?.width ?? "?"}x${asset.rendered?.height ?? "?"}`;
      if (!seen.has(key)) {
        seen.set(key, { ...asset, sectionIds: [], observationIds: new Set() });
      }
      const entry = seen.get(key);
      if (!entry.sectionIds.includes(section.sectionId)) entry.sectionIds.push(section.sectionId);
      for (const id of prop.observationIds ?? []) entry.observationIds.add(id);
    }
  }
  const items = [...seen.values()]
    .map((e) => ({ ...e, sectionIds: [...e.sectionIds].sort(), observationIds: [...e.observationIds].sort() }))
    .sort((a, b) => (a.sectionIds[0] ?? "").localeCompare(b.sectionIds[0] ?? "") || a.identity?.localeCompare(b.identity ?? "") || 0);
  return items.length
    ? { status: "observed", items }
    : { status: "unknown", reason: "no section carried an observed asset", items: [] };
}

/* --------------------------------------------------------- responsive diff */

/**
 * Compares one primary-viewport section against the matching section (by
 * DOM path — the one identity signal that is expected to survive a resize)
 * in every other usable viewport.
 *
 * A section with no match at another viewport is reported as
 * `observed: false` there — a fact about what this run captured, not a claim
 * that the section is absent at that width. The section survey is bounded
 * and scroll-driven; a missing match can mean genuinely different markup,
 * or simply that discovery did not reach it, and this function does not
 * guess which.
 */
function compareSectionAcrossViewports(primary, primaryWidth, others) {
  const perViewport = [];
  for (const other of others) {
    const match = other.model.sections.find((s) => s.domPath === primary.domPath);
    if (!match) {
      perViewport.push({ width: other.width, observed: false });
      continue;
    }

    const differences = [];
    const pLayout = primary.properties?.layout?.value ?? null;
    const mLayout = match.properties?.layout?.value ?? null;
    if (pLayout || mLayout) {
      for (const key of ["display", "flexDirection", "isScrollContainer", "columnCount"]) {
        const pv = pLayout?.[key] ?? null;
        const mv = mLayout?.[key] ?? null;
        if (pv !== mv) {
          differences.push({
            property: `layout.${key}`,
            primary: { width: primaryWidth, value: pv },
            compared: { width: other.width, value: mv }
          });
        }
      }
    }
    if (primary.geometry.width !== match.geometry.width) {
      differences.push({
        property: "geometry.width",
        primary: { width: primaryWidth, value: primary.geometry.width },
        compared: { width: other.width, value: match.geometry.width }
      });
    }
    if (primary.kind !== match.kind) {
      differences.push({
        property: "kind",
        primary: { width: primaryWidth, value: primary.kind },
        compared: { width: other.width, value: match.kind }
      });
    }

    perViewport.push({
      width: other.width, observed: true, sectionId: match.sectionId,
      differences, sourceEvidenceIds: match.sourceEvidenceIds
    });
  }
  return perViewport;
}

/* ------------------------------------------------------------- one section */

/**
 * The copy a section was observed to contain, or an explicit unknown.
 *
 * Serialized only when provenance supports it: the text block arrives from
 * normalization already carrying the observation ids that saw it and its own
 * support flags, and both are copied through untouched. A section whose text
 * was never observed gets `status: "unknown"` and the reason — never a
 * placeholder, never a summary, never copy written here. There is no branch
 * in this function that can produce a string the survey did not read off the
 * page.
 */
function textFactFor(section) {
  const t = section.text;
  if (!t || t.status === "unknown") {
    return {
      status: "unknown",
      value: null,
      reason: t?.reason ?? "no observation carried text for this section",
      sourceEvidenceIds: [],
      observationIds: []
    };
  }
  return {
    status: t.status,
    value: t.value,
    conflicts: t.conflicts ?? [],
    supports: t.supports,
    kinds: t.kinds ?? [],
    sourceEvidenceIds: [section.sectionId],
    observationIds: [...(t.observationIds ?? [])].sort(),
    provenance: t.provenance ?? []
  };
}

/** Heading records, verbatim, with the ids that saw them — or an explicit unknown. */
function headingFactFor(section) {
  const h = section.headings;
  if (!h || h.status === "unknown") {
    return {
      status: "unknown",
      items: [],
      reason: h?.reason ?? "no heading was observed in this section",
      sourceEvidenceIds: [],
      observationIds: []
    };
  }
  return {
    status: h.status,
    items: h.items,
    supports: h.supports,
    sourceEvidenceIds: [section.sectionId],
    observationIds: [...(h.observationIds ?? [])].sort(),
    provenance: h.provenance ?? []
  };
}

function buildSectionEntry(section, primaryWidth, others) {
  return {
    sectionId: section.sectionId,
    order: section.order,
    kind: section.kind,
    classification: section.classification,
    domPath: section.domPath,
    tag: section.tag,
    role: section.role,
    geometry: section.geometry,
    viewportGeometry: section.viewportGeometry,
    repeatedGroupId: section.repeatedGroupId,
    kinds: section.kinds,
    supports: section.supports,
    status: section.status,
    unstable: section.unstable,
    conflicts: section.conflicts,
    /* Copy and headings, and the observed hierarchy this section sits in. */
    text: textFactFor(section),
    headings: headingFactFor(section),
    containment: section.containment ?? null,
    typography: styleCategory([section], TYPOGRAPHY_PROPERTIES),
    colors: styleCategory([section], COLOR_PROPERTIES),
    spacing: styleCategory([section], SPACING_PROPERTIES),
    layout: layoutFactFor(section),
    assets: collectAssetFacts([section]),
    visuals: visualFactsFor(section, primaryWidth, others),
    responsive: compareSectionAcrossViewports(section, primaryWidth, others),
    provenance: section.provenance,
    sourceEvidenceIds: section.sourceEvidenceIds
  };
}

/**
 * The painted interiors of one section, as instructions a builder can act on.
 *
 * Each entry says WHERE the visual sits, AT WHICH viewport and scroll state it
 * was seen, and what may be used to represent it — an asset URL, a stored crop,
 * or nothing at all. What no entry ever says is what the visual depicts. A crop
 * is offered as a picture to place, never as a description to build from, and
 * `doNot` states that in the artifact rather than leaving it to convention.
 */
function visualFactsFor(section, primaryWidth, others) {
  const own = section.visualRegions ?? [];
  if (!own.length) return { status: "unknown", items: [], reason: "no painted interior was located in this section" };

  const items = own.map((v) => {
    /* The same panel measured at the other viewports, matched by DOM identity.
     * Matching on anything looser would let a 1440 crop be offered as the 375
     * appearance of a region that reflowed into something else. */
    const variants = [];
    for (const other of others) {
      const match = (other.model?.visualRegions ?? []).find((o) => o.domPath === v.domPath);
      if (!match) {
        variants.push({ width: other.width, observed: false, reason: "this visual was not located at this viewport" });
        continue;
      }
      variants.push({
        width: other.width,
        observed: true,
        visualId: match.visualId,
        type: match.type,
        captureStatus: match.captureStatus,
        resolved: match.resolved,
        /* The variant's OWN measured box at that viewport. Without it a builder
         * could only place the visual where the primary viewport saw it, which
         * is precisely the cross-viewport smearing this record exists to
         * prevent. */
        geometry: match.geometry,
        renderDimensions: match.renderDimensions,
        cropIsPartial: match.cropIsPartial ?? false,
        cropGeometry: match.cropGeometry,
        artifact: match.artifact,
        hash: match.hash,
        source: match.source,
        unresolvedReason: match.unresolvedReason,
        provenance: match.provenance
      });
    }

    return {
      visualId: v.visualId,
      domPath: v.domPath,
      tag: v.tag,
      type: v.type,
      confidence: v.confidence,
      resolved: v.resolved,
      unresolvedReason: v.unresolvedReason,
      /* Placement: document-space box at the primary viewport, and the crop's
       * own viewport-space rectangle at the observation it was taken from. */
      cropIsPartial: v.cropIsPartial ?? false,
      cropCoversRatio: v.cropCoversRatio ?? null,
      placement: {
        viewportWidth: primaryWidth,
        geometry: v.geometry,
        renderDimensions: v.renderDimensions,
        cropGeometry: v.cropGeometry,
        scrollState: v.provenance?.scrollState ?? null,
        scrollY: v.provenance?.scrollY ?? null,
        observationId: v.provenance?.observationId ?? null,
        visibilityState: v.visibilityState
      },
      source: v.source,
      artifact: v.artifact,
      hash: v.hash,
      captureStatus: v.captureStatus,
      animation: v.animation,
      responsive: variants,
      sourceEvidenceIds: v.sourceEvidenceIds,
      doNot: "Do not infer components, copy, layout or structure from this visual. It is a located region and, where one exists, a stored picture of it. Nothing in this record describes its contents."
    };
  });

  const resolved = items.filter((i) => i.resolved).length;
  return {
    status: resolved > 0 ? "observed" : "unknown",
    items,
    resolved,
    unresolved: items.length - resolved,
    reason: resolved > 0 ? null : "every painted interior in this section is unresolved; see each item's unresolvedReason"
  };
}

/* ---------------------------------------------------------- landmark slots */

function landmarkFor(claim) {
  if (!claim) return { status: "unknown", value: null, reason: "no claim recorded" };
  return {
    status: claim.status,
    value: claim.value,
    reason: claim.reason ?? null,
    sourceEvidenceIds: claim.sourceEvidenceIds ?? [],
    provenance: claim.provenance ?? []
  };
}

/* -------------------------------------------------- acceptance criteria etc */

function buildAcceptanceCriteria({ primary, sections, excludedViewports }) {
  const criteria = [];
  const add = (claim, sourceEvidenceIds) => criteria.push({ claim, sourceEvidenceIds: [...new Set(sourceEvidenceIds)] });

  const topLevel = sections.filter((s) => s.containment?.isTopLevel !== false);
  add(`The page has ${sections.length} observed region(s) in document order, of which ${topLevel.length} are top-level `
    + "sections and the rest are contained within them.", sections.map((s) => s.sectionId));

  const withText = sections.filter((s) => s.text?.status !== "unknown");
  if (withText.length) {
    add(`${withText.length} section(s) carry observed copy, reproduced verbatim in their \`text\` field.`,
      withText.map((s) => s.sectionId));
  }
  const withHeadings = sections.filter((s) => s.headings?.status !== "unknown");
  if (withHeadings.length) {
    add(`${withHeadings.length} section(s) carry observed heading(s), reproduced with their level in \`headings.items\`.`,
      withHeadings.map((s) => s.sectionId));
  }

  for (const [name, claim] of [["header", primary.model.header], ["navigation", primary.model.navigation],
    ["hero", primary.model.hero], ["main", primary.model.main], ["footer", primary.model.footer]]) {
    if (claim.status === "observed") {
      add(`A \`${name}\` landmark is present, sourced from section \`${claim.value}\`.`, claim.sourceEvidenceIds);
    }
  }

  for (const group of primary.model.repeatedGroups) {
    add(`A repeated group of ${group.memberCount} member(s) exists (group \`${group.groupId}\`, ${group.evidence.detail}).`,
      group.members.flatMap((m) => m.sourceEvidenceIds));
  }

  for (const section of sections) {
    for (const perViewport of section.responsive) {
      if (perViewport.observed && perViewport.differences.length) {
        for (const d of perViewport.differences) {
          add(`At ${perViewport.width}px, \`${section.sectionId}\`'s ${d.property} differs from ${d.primary.width}px `
            + `(${JSON.stringify(d.primary.value)} vs ${JSON.stringify(d.compared.value)}).`,
            [...section.sourceEvidenceIds, ...perViewport.sourceEvidenceIds]);
        }
      }
    }
  }

  const scrollRevealed = primary.model.scrollReveal.scrollRevealedSections;
  if (scrollRevealed.length) {
    add(`${scrollRevealed.length} section(s) exist on the resting page and are revealed only by scrolling `
      + `(${scrollRevealed.join(", ")}); they must not be treated as above-the-fold.`, scrollRevealed);
  }

  for (const u of primary.model.unsupported) {
    add(`\`${u.tag}\` at \`${u.sectionId}\` cannot be read as DOM; it is excluded from style and structure claims.`, u.sourceEvidenceIds);
  }

  if (excludedViewports.length) {
    add(`${excludedViewports.length} viewport(s) (${excludedViewports.map((v) => `${v.width}px`).join(", ")}) `
      + `produced no usable evidence and are excluded from every claim above; see \`excludedViewports\` for why.`,
      []);
  }

  return criteria;
}

function buildImplementationRequirements({ sections, primary, usableCount }) {
  const requirements = [];
  const add = (requirement, sourceEvidenceIds) => requirements.push({ requirement, sourceEvidenceIds: [...new Set(sourceEvidenceIds)] });

  /* Top-level first, and the nested ones named as nested.
   *
   * The previous wording — "build N sections in document order" — was true of
   * a flat six-section fixture and badly wrong on a real site, where most of
   * the N are ancestors of the rest. Following it there nests the whole page
   * inside its own first section. The count a builder acts on is now the
   * top-level count, with containment stated rather than implied. */
  const topLevel = sections.filter((s) => s.containment?.isTopLevel !== false);
  const nested = sections.filter((s) => s.containment?.isTopLevel === false);

  add(`Build ${topLevel.length} top-level section(s) in the observed document order; do not reorder or omit any.`,
    topLevel.map((s) => s.sectionId));

  if (nested.length) {
    add(`${nested.length} further observed region(s) are CONTAINED WITHIN those top-level sections — see each section's `
      + "`containment.parentSectionId`. Build them inside their parent; do not emit them as siblings or as additional page sections.",
      nested.map((s) => s.sectionId));
  }

  const withText = sections.filter((s) => s.text?.status !== "unknown");
  if (withText.length) {
    add(`Use the observed copy in each section's \`text\` field verbatim. ${sections.length - withText.length} section(s) `
      + "carry no observed text and are marked `unknown`; leave their content empty rather than writing replacement copy.",
      withText.map((s) => s.sectionId));
  }

  const groups = primary.model.repeatedGroups;
  for (const group of groups) {
    add(`Implement a reusable component for the ${group.memberCount}-member repeated group \`${group.groupId}\`; `
      + "do not hand-author each member separately.", group.members.flatMap((m) => m.sourceEvidenceIds));
  }

  /* "No difference was observed" is a CONCLUSION, and it needs two viewports
   * to compare. With one usable viewport there was nothing to compare against
   * — saying no difference was found reads as "this page does not respond",
   * when the truth is that the question was never asked. Measured on a real
   * site where 768 and 375 both refused, the old wording claimed a responsive
   * finding drawn from a single 1440 capture. */
  const responsiveSections = sections.filter((s) => s.responsive.some((r) => r.observed && r.differences.length));
  if (usableCount < 2) {
    add(`Responsive comparison was unavailable: only ${usableCount} usable viewport model `
      + `${usableCount === 1 ? "was" : "were"} available, and a difference needs two to compare. `
      + "Nothing here states whether this page responds to viewport width; do not invent breakpoint behaviour.", []);
  } else if (responsiveSections.length) {
    add(`Implement viewport-dependent layout for ${responsiveSections.length} section(s) where a real difference `
      + "was observed between viewports; do not apply a breakpoint change where none was observed.",
      responsiveSections.map((s) => s.sectionId));
  } else {
    add(`No responsive layout difference was observed between the ${usableCount} captured viewports; `
      + "do not invent breakpoint behaviour.", []);
  }

  /* Interaction requirements.
   *
   * The rule: a requirement is generated ONLY for a transition where a change
   * was actually measured, and it states the change rather than what the change
   * means. A control being activated is not evidence that a menu opens — the
   * attribute that moved is. `no-observable-change` produces a limitation, not
   * a requirement, because the honest finding is that pressing it did nothing
   * this tool could see.
   */
  const observed = primary.model.observedInteractions ?? [];
  const discovery = primary.model.interactionDiscovery ?? { ran: false };
  const CHANGED = new Set([
    "changed-state-observed", "changed-content-observed",
    "changed-geometry-observed", "changed-visual-observed"
  ]);

  if (!discovery.ran) {
    add("No interaction was attempted, so every interaction behaviour on this page is UNKNOWN rather than absent. "
      + "Do not add hover, focus, expanded or open styling, and do not assume this page has none.", []);
  } else {
    for (const state of observed) {
      if (!CHANGED.has(state.resultClass)) continue;

      /* Focus-only transitions never become resting-page requirements. */
      const focusOnly = state.resultClass === "changed-visual-observed"
        && state.focus?.changed === true && (state.changeCounts?.total ?? 0) === 0;
      if (focusOnly) continue;

      const parts = [];
      for (const c of (state.changes?.state ?? []).slice(0, 6)) {
        parts.push(`\`${c.attribute}\` on \`${c.domPath}\` from ${JSON.stringify(c.from)} to ${JSON.stringify(c.to)}`);
      }
      for (const c of (state.changes?.content ?? []).slice(0, 4)) {
        parts.push(`\`${c.property}\` on \`${c.domPath}\` from ${JSON.stringify(c.from)} to ${JSON.stringify(c.to)}`);
      }
      for (const c of (state.changes?.structure ?? []).slice(0, 4)) {
        parts.push(`\`${c.domPath}\` ${c.change}`);
      }
      if (!parts.length) continue;

      add(`When \`${state.target?.accessibleName ?? state.target?.domPath}\` is activated, the page changed as follows, `
        + `measured at ${state.viewportWidth}px: ${parts.join("; ")}. `
        + `Reproduce these exact changes. This is state-specific evidence and describes the page only while that control is activated — `
        + `it is not resting-page behaviour, and nothing here says what the control is for.`,
        [state.interactionId, ...(state.before ? [] : [])].filter(Boolean));
    }

    const noop = observed.filter((s) => s.resultClass === "no-observable-change");
    if (noop.length) {
      add(`${noop.length} control(s) were safely activated and produced no change this tool could measure. `
        + `Do not implement a behaviour for them: whether they do nothing, or do something outside the observed subtree, is unknown.`,
        noop.map((s) => s.interactionId));
    }

    const refused = observed.filter((s) => s.status === "refused");
    if (refused.length) {
      add(`${refused.length} control(s) were never activated, on safety grounds. Their behaviour is unknown and must not be implemented from guesswork.`,
        refused.map((s) => s.interactionId));
    }

    if (!observed.some((s) => CHANGED.has(s.resultClass))) {
      add("Interaction discovery ran and measured no change on any control it could safely activate; "
        + "do not add interaction styling that was not evidenced.", []);
    }
  }

  return requirements;
}

/* ------------------------------------------------------------------ notes */

function buildEvidenceNotes({ allViewports, sections }) {
  const notes = [];

  for (const v of allViewports) {
    for (const u of v.model.unknowns ?? []) {
      notes.push({ kind: "unknown", width: v.width, what: u.what, why: u.why });
    }
    for (const c of v.model.conflicts ?? []) {
      notes.push({ kind: "conflict", width: v.width, sectionId: c.sectionId, conflicts: c.conflicts });
    }
  }

  for (const section of sections) {
    for (const category of ["typography", "colors", "spacing"]) {
      const cat = section[category];
      if (cat.status === "observed") {
        for (const [prop, facts] of Object.entries(cat.properties)) {
          for (const f of facts) {
            if (f.conflicted) notes.push({ kind: "conflict", sectionId: section.sectionId, property: `${category}.${prop}`, value: f.value });
          }
        }
      }
    }
    if (section.unstable) notes.push({ kind: "unstable-geometry", sectionId: section.sectionId, conflicts: section.conflicts });
  }

  return notes;
}

/* --------------------------------------------------------------- refusal */

function buildRefusal(url, viewports) {
  return {
    $clonePrompt: CLONE_PROMPT_VERSION,
    kind: "refusal",
    url,
    viewports: viewports.map((v) => ({
      width: v.width,
      supportClass: v.support.supportClass,
      label: SUPPORT_DETAIL[v.support.supportClass]?.label ?? v.support.supportClass,
      meaning: v.support.meaning,
      remedy: v.support.remedy,
      warnings: v.support.warnings ?? [],
      ...(v.support.supportClass === SUPPORT_CLASS.UNSUPPORTED_RENDERING
        ? { unsupportedSurfaces: (v.model.unsupported ?? []).map((u) => ({ sectionId: u.sectionId, tag: u.tag, reason: u.reason })) }
        : {})
    })),
    evidenceLimitations: viewports.flatMap((v) =>
      (v.model.unknowns ?? []).map((u) => ({ width: v.width, what: u.what, why: u.why })))
  };
}

/* ------------------------------------------------------------------ prompt */

function buildPrompt(url, usable, excluded, all) {
  const primary = usable[0];
  const others = usable.slice(1);

  const primarySections = primary.model.sections
    .filter((s) => s.status !== undefined) // every section qualifies; explicit for readability
    .map((s) => buildSectionEntry(s, primary.width, others));

  const primaryDomPaths = new Set(primary.model.sections.map((s) => s.domPath));
  const onlyAtOtherViewports = [];
  for (const v of others) {
    for (const s of v.model.sections) {
      if (!primaryDomPaths.has(s.domPath)) {
        onlyAtOtherViewports.push({
          width: v.width, sectionId: s.sectionId, domPath: s.domPath, kind: s.kind,
          sourceEvidenceIds: s.sourceEvidenceIds
        });
      }
    }
  }

  const overallClass = usable.every((v) => v.support.supportClass === SUPPORT_CLASS.ANALYZABLE) && excluded.length === 0
    ? SUPPORT_CLASS.ANALYZABLE
    : SUPPORT_CLASS.ANALYZABLE_WITH_WARNINGS;

  return {
    $clonePrompt: CLONE_PROMPT_VERSION,
    kind: "prompt",
    url,
    supportClass: overallClass,
    label: SUPPORT_DETAIL[overallClass].label,

    route: {
      path: url,
      note: "One route was captured. This tool does not crawl; a multi-route app needs one capture per route."
    },

    viewportsUsed: usable.map((v) => ({ width: v.width, supportClass: v.support.supportClass })),
    excludedViewports: excluded.map((v) => ({
      width: v.width, supportClass: v.support.supportClass,
      label: SUPPORT_DETAIL[v.support.supportClass]?.label ?? v.support.supportClass,
      meaning: v.support.meaning, remedy: v.support.remedy
    })),

    sections: primarySections,
    /* The observed hierarchy, forwarded from the page model. A consumer builds
     * from `topLevelSections`; everything else is contained by one of them. */
    outline: primary.model.outline ?? null,
    sectionsObservedOnlyAtOtherViewports: onlyAtOtherViewports,

    repeatedGroups: primary.model.repeatedGroups,

    header: landmarkFor(primary.model.header),
    navigation: landmarkFor(primary.model.navigation),
    hero: landmarkFor(primary.model.hero),
    main: landmarkFor(primary.model.main),
    footer: landmarkFor(primary.model.footer),

    scrollRevealedSections: primary.model.scrollReveal.scrollRevealedSections,
    /* The prompt's `interactionStates` are the observed TRANSITIONS, which is
     * what a builder can act on. The model's same-named field means something
     * narrower (sections only ever seen mid-interaction) and is carried
     * separately so neither meaning is lost. */
    interactionStates: primary.model.observedInteractions ?? [],
    interactionDiscovery: primary.model.interactionDiscovery
      ?? { ran: false, note: "interaction discovery was not run; every interaction behaviour is unknown rather than absent" },
    sectionsSeenOnlyWhenInteracted: primary.model.interactionStates ?? [],

    acceptanceCriteria: buildAcceptanceCriteria({ primary, sections: primarySections, excludedViewports: excluded }),
    implementationRequirements: buildImplementationRequirements({ sections: primarySections, primary, usableCount: usable.length }),
    evidenceNotes: buildEvidenceNotes({ allViewports: all, sections: primarySections })
  };
}

/**
 * Builds a clone prompt (or a refusal) from validated per-viewport evidence.
 *
 * @param {object} args
 * @param {string} args.url
 * @param {{width:number, model:object, normalized:object, support:object}[]} args.viewports
 */
export function buildClonePrompt({ url, viewports } = {}) {
  const problems = validateInputViewports(viewports);
  if (typeof url !== "string" || url.length === 0) problems.push(problem("url", "must be a non-empty string"));
  if (problems.length) throw new ClonePromptError("validate-input", problems);

  /* Widest first, always — determinism independent of caller order, and a
   * desktop-first primary matches how the rest of this project already
   * treats 1440 as the default viewport. */
  const sorted = [...viewports].sort((a, b) => b.width - a.width);

  const usable = sorted.filter((v) => producesOutput(v.support.supportClass));
  const excluded = sorted.filter((v) => !producesOutput(v.support.supportClass));

  return usable.length === 0
    ? buildRefusal(url, sorted)
    : buildPrompt(url, usable, excluded, sorted);
}

/* ------------------------------------------------------------ validation */

/** Every id referenced by `sourceEvidenceIds`/`observationIds` must exist in the source evidence it claims to come from. */
function knownIdsFor(viewports) {
  const regionAndSectionIds = new Set();
  const observationIds = new Set();
  const groupIds = new Set();
  for (const v of viewports) {
    for (const r of v.normalized?.regions ?? []) regionAndSectionIds.add(r.regionId);
    for (const o of v.normalized?.observations ?? []) observationIds.add(o.id);
    for (const s of v.model?.sections ?? []) regionAndSectionIds.add(s.sectionId);
    for (const g of v.model?.repeatedGroups ?? []) groupIds.add(g.groupId);
    /* Interaction ids are citable evidence too: a requirement about a
     * transition must be traceable to the transition record that measured it. */
    for (const i of v.model?.observedInteractions ?? []) regionAndSectionIds.add(i.interactionId);
    for (const vr of v.model?.visualRegions ?? []) regionAndSectionIds.add(vr.visualId);
  }
  return { regionAndSectionIds, observationIds, groupIds };
}

/** Recursively walks an object, calling `visit(key, value, path)` for every own property. */
function walk(node, path, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((item, i) => walk(item, `${path}[${i}]`, visit));
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    visit(key, value, path);
    walk(value, `${path}.${key}`, visit);
  }
}

/**
 * Validates a clone-prompt (or refusal) object against the evidence it was
 * built from.
 *
 * The load-bearing check: every `sourceEvidenceIds` entry resolves to a real
 * region or section id, and every `observationIds` entry resolves to a real
 * observation id, in the SAME viewports this output claims to be built from.
 * A claim whose provenance points nowhere reads as supported and is worse
 * than one with no provenance at all — the exact failure `validatePageModel`
 * already exists to catch one layer down.
 */
export function validateClonePrompt(output, viewports) {
  const problems = [];
  if (!output || typeof output !== "object") return { valid: false, problems: [problem("$", "expected an object")] };
  if (output.$clonePrompt !== CLONE_PROMPT_VERSION) {
    problems.push(problem("$clonePrompt", `expected version ${CLONE_PROMPT_VERSION}, found ${JSON.stringify(output.$clonePrompt)}`));
  }
  if (!["prompt", "refusal"].includes(output.kind)) {
    problems.push(problem("kind", `expected "prompt" or "refusal", found ${JSON.stringify(output.kind)}`));
  }

  const PROMPT_ONLY_KEYS = ["sections", "repeatedGroups", "header", "navigation", "hero", "main", "footer",
    "acceptanceCriteria", "implementationRequirements", "route"];
  const REFUSAL_ONLY_KEYS = ["evidenceLimitations"];
  if (output.kind === "refusal") {
    for (const key of PROMPT_ONLY_KEYS) {
      if (key in output) problems.push(problem(key, `a refusal must not carry \`${key}\` — that is prompt-shaped content`));
    }
    if (!Array.isArray(output.viewports) || output.viewports.length === 0) {
      problems.push(problem("viewports", "a refusal must name every viewport it refused"));
    }
  }
  if (output.kind === "prompt") {
    for (const key of REFUSAL_ONLY_KEYS) {
      if (key in output) problems.push(problem(key, `a prompt must not carry \`${key}\` — that is refusal-shaped content`));
    }
    if (!Array.isArray(output.sections)) problems.push(problem("sections", "a prompt must carry its section list"));
  }

  if (problems.length) return { valid: false, problems };

  const { regionAndSectionIds, observationIds, groupIds } = knownIdsFor(viewports ?? []);

  walk(output, "$", (key, value, path) => {
    if (key === "sourceEvidenceIds" && Array.isArray(value)) {
      /* `model.mjs` already mixes a region/section id with observation ids in
       * this exact field (`[region.regionId, ...region.sourceObservationIds]`)
       * — this validator has to accept the same mixture it was handed, not a
       * narrower one of its own invention. */
      for (const id of value) {
        if (!regionAndSectionIds.has(id) && !groupIds.has(id) && !observationIds.has(id)) {
          problems.push(problem(`${path}.sourceEvidenceIds`, `references ${id}, which is not a region, section, group or observation id in the source evidence`));
        }
      }
    }
    if (key === "observationIds" && Array.isArray(value)) {
      for (const id of value) {
        if (!observationIds.has(id)) {
          problems.push(problem(`${path}.observationIds`, `references ${id}, which is not an observation id in the source evidence`));
        }
      }
    }
    if (key === "provenance" && Array.isArray(value)) {
      for (const p of value) {
        if (p?.observationId && !observationIds.has(p.observationId)) {
          problems.push(problem(`${path}.provenance`, `references observation ${p.observationId}, which is not in the source evidence`));
        }
      }
    }
    if (key === "memberRegionIds" && Array.isArray(value)) {
      for (const id of value) {
        if (!regionAndSectionIds.has(id)) {
          problems.push(problem(`${path}.memberRegionIds`, `references ${id}, which is not a region id in the source evidence`));
        }
      }
    }
  });

  return { valid: problems.length === 0, problems };
}

export const serializeClonePrompt = (output) => JSON.stringify(output, null, 2) + "\n";

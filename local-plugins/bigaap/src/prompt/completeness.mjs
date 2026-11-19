/**
 * Prompt completeness: how much of a page a clone prompt can actually account
 * for, and — more importantly — what it cannot.
 *
 * `validateClonePrompt` already answers "is this artifact well-formed and are
 * its evidence references real". That is a different question from "is this
 * enough to build from". A prompt can be perfectly valid and still describe a
 * page whose interiors were never captured, whose copy was truncated, and whose
 * responsive behaviour rests on a single viewport. A builder handed that prompt
 * deserves to know before they start, not after.
 *
 * The output grades every dimension on one scale, and the scale is the point:
 *
 *   observed-and-supported  the evidence is there and it backs the claim
 *   observed-but-incomplete something was seen, but not all of it
 *   inferred               the prompt states a choice rather than a measurement
 *   unknown                nothing was observed; the prompt says so
 *   unknown is NOT zero    a dimension with no evidence scores `null`, never 0%
 *   refused                the support gate stopped this from being claimed
 *
 * The distinction this module exists to protect is between "we looked and found
 * nothing" and "we never looked". Both leave a gap in the prompt; only one is a
 * fact about the page. Every dimension below reports which it is.
 *
 * PURE. No DOM, no browser, no filesystem, no clock. Given the same prompt and
 * the same source viewports it returns the same report, so the report can be
 * hashed, diffed across runs, and asserted on in tests.
 */

import { producesOutput } from "../modes/support.mjs";

export const COMPLETENESS_VERSION = "1";

/**
 * The five gradings, and the one rule that governs them.
 *
 * A dimension is only `observed-and-supported` when the evidence exists AND the
 * support classification permits a claim from it. Evidence that exists but sits
 * behind a refused viewport is `refused`, not `observed` — otherwise a coverage
 * number would quietly count material the prompt is forbidden to use.
 */
export const COVERAGE = Object.freeze({
  OBSERVED_SUPPORTED: "observed-and-supported",
  OBSERVED_INCOMPLETE: "observed-but-incomplete",
  INFERRED: "inferred",
  UNKNOWN: "unknown",
  REFUSED: "refused"
});

/** Every dimension the report grades, in the order it reports them. */
export const DIMENSIONS = Object.freeze([
  "pageStructure",
  "structuralResolution",
  "sections",
  "textAndHeadings",
  "layout",
  "typographyColorSpacing",
  "assets",
  "visualRegions",
  "controlsObserved",
  "interactionStatesObserved",
  "stateRestoration",
  "interactionProvenance",
  "unsupportedInteractions",
  "responsive",
  "scrollReveal",
  "unresolvedEvidence",
  "unsupportedRendering",
  "references"
]);

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 1000 : null);

/**
 * Grade a simple "n of m carried it" dimension.
 *
 * Nothing observed is `unknown`, never 0%: a page with no images has not failed
 * asset coverage, and a percentage would read as though it had. That single
 * check also covers an empty population, since nothing can be observed out of
 * nothing — the dimensions that need to SAY "there was nothing of this kind
 * here" return `unknown` themselves, with a sentence explaining it.
 */
function grade({ observed, total, refused = 0, incompleteWhenPartial = true }) {
  if (refused > 0 && observed === 0) return COVERAGE.REFUSED;
  if (observed === 0) return COVERAGE.UNKNOWN;
  if (observed < total && incompleteWhenPartial) return COVERAGE.OBSERVED_INCOMPLETE;
  return COVERAGE.OBSERVED_SUPPORTED;
}

const dimension = (name, status, observed, total, detail, gaps = []) => ({
  dimension: name,
  status,
  observed,
  total,
  ratio: pct(observed, total),
  detail,
  gaps
});

const isObserved = (field) => Boolean(field && field.status === "observed");
const sectionsOf = (prompt) => (Array.isArray(prompt?.sections) ? prompt.sections : []);

/* ------------------------------------------------------------- references */

/**
 * Every id the prompt cites, checked against the evidence it came from.
 *
 * An id that resolves nowhere is the most dangerous defect this system can
 * ship: it is a claim wearing a citation. Reported separately from coverage
 * because it is a correctness failure, not a gap.
 */
function assessReferences(prompt, viewports) {
  const known = new Set();
  for (const v of viewports ?? []) {
    for (const r of v.normalized?.regions ?? []) known.add(r.regionId);
    for (const o of v.normalized?.observations ?? []) known.add(o.id);
    for (const s of v.model?.sections ?? []) known.add(s.sectionId);
    for (const g of v.model?.repeatedGroups ?? []) known.add(g.groupId);
    for (const vr of v.model?.visualRegions ?? []) known.add(vr.visualId);
    for (const i of v.model?.observedInteractions ?? []) known.add(i.interactionId);
  }

  const unresolved = [];
  let cited = 0;
  const walk = (node, path) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach((n, i) => walk(n, `${path}[${i}]`)); return; }
    for (const [key, value] of Object.entries(node)) {
      if ((key === "sourceEvidenceIds" || key === "observationIds") && Array.isArray(value)) {
        for (const id of value) {
          cited++;
          if (!known.has(id)) unresolved.push({ where: `${path}.${key}`, id });
        }
      }
      walk(value, `${path}.${key}`);
    }
  };
  walk(prompt, "$");

  return {
    ...dimension("references", unresolved.length === 0 ? COVERAGE.OBSERVED_SUPPORTED : COVERAGE.UNKNOWN,
      cited - unresolved.length, cited,
      unresolved.length === 0
        ? `all ${cited} evidence reference(s) resolve in the source evidence`
        : `${unresolved.length} of ${cited} evidence reference(s) resolve nowhere`,
      unresolved.slice(0, 20)),
    /* Named separately so a caller can refuse on this alone. */
    fabricated: unresolved.length
  };
}

/**
 * No viewport's evidence may appear under another viewport's claim.
 *
 * Ids are viewport-scoped by construction (`s-1440-…`, `v-375-…`), so a leak is
 * detectable structurally rather than by trusting the code that built the
 * prompt not to have mixed them.
 */
function assessViewportSeparation(prompt) {
  const widths = (prompt.viewportsUsed ?? []).map((v) => v.width).filter(Boolean);
  const primary = widths[0] ?? null;
  const leaks = [];
  const idWidth = (id) => {
    const m = /^[a-z]+-(\d{2,5})-/.exec(String(id));
    return m ? Number(m[1]) : null;
  };

  for (const s of sectionsOf(prompt)) {
    const own = idWidth(s.sectionId);
    for (const id of s.sourceEvidenceIds ?? []) {
      const w = idWidth(id);
      if (w !== null && own !== null && w !== own) leaks.push({ sectionId: s.sectionId, id, expected: own, found: w });
    }
    /* A responsive comparison legitimately names another viewport's section —
     * that is the whole point of it — so those are checked for the OPPOSITE
     * property: the compared id must belong to the width it claims. */
    for (const cmp of Array.isArray(s.responsive) ? s.responsive : []) {
      if (!cmp.observed || !cmp.sectionId) continue;
      const w = idWidth(cmp.sectionId);
      if (w !== null && w !== cmp.width) {
        leaks.push({ sectionId: s.sectionId, id: cmp.sectionId, expected: cmp.width, found: w });
      }
    }
  }
  return { primary, widths, leaks, separated: leaks.length === 0 };
}

/* ------------------------------------------------------------- dimensions */

function assessPageStructure(prompt) {
  const outline = prompt.outline ?? {};
  const sections = sectionsOf(prompt);
  const top = (outline.topLevelSections ?? []).length;
  const withContainment = sections.filter((s) => s.containment).length;
  const landmarks = ["header", "navigation", "hero", "main", "footer"]
    .filter((k) => isObserved(prompt[k]));

  const status = sections.length === 0
    ? COVERAGE.UNKNOWN
    : (top > 0 && withContainment === sections.length)
      ? COVERAGE.OBSERVED_SUPPORTED
      : COVERAGE.OBSERVED_INCOMPLETE;

  return dimension("pageStructure", status, withContainment, sections.length,
    `${top} top-level section(s), ${withContainment}/${sections.length} placed in the observed hierarchy, `
    + `${landmarks.length}/5 landmark slot(s) observed (${landmarks.join(", ") || "none"})`,
    sections.filter((s) => !s.containment).map((s) => ({ sectionId: s.sectionId, missing: "containment" })).slice(0, 20));
}

/**
 * Did the survey actually take the page apart, or did it find one big box?
 *
 * This dimension exists because of a real miss. A page modelled as a single
 * region scores 100% on structure, layout, typography and colour — because the
 * one region it found genuinely has all of those. Every other dimension is a
 * ratio over the sections that were found, so none of them can see the
 * sections that were NOT found. Coverage over a bad decomposition is a
 * confident number about the wrong thing.
 *
 * The signal is deliberately narrow and evidential: a section that carries more
 * copy than the storage cap can hold AND has no child sections is a region the
 * survey could not break down. Its copy is truncated, and there is nothing
 * beneath it to carry the rest. That is measurable without guessing what the
 * page "should" have contained.
 */
function assessStructuralResolution(prompt) {
  const sections = sectionsOf(prompt);
  if (sections.length === 0) {
    return dimension("structuralResolution", COVERAGE.UNKNOWN, 0, 0, "no section was modelled at all", []);
  }

  const areaOf = (s) => (s?.geometry?.width ?? 0) * (s?.geometry?.height ?? 0);
  const childArea = new Map();
  for (const s of sections) {
    const parent = s.containment?.parentSectionId;
    if (!parent) continue;
    childArea.set(parent, (childArea.get(parent) ?? 0) + areaOf(s));
  }

  /* Having *a* child is not the same as being decomposed. Hacker News models
   * as a <center> carrying the whole page's copy with one 21px search form
   * beneath it — one child covering 1.5% of its area, and every story row
   * unaccounted for. So the test is how much of the region its children
   * actually cover, not whether any exist. */
  const DECOMPOSED_AT = 0.5;
  const coarse = sections.filter((s) => {
    if (!isObserved(s.text) || typeof s.text.value !== "string" || !s.text.value.endsWith("…")) return false;
    const own = areaOf(s);
    if (own <= 0) return false;
    return (childArea.get(s.sectionId) ?? 0) / own < DECOMPOSED_AT;
  });

  /* The LARGEST undecomposed region, not the sum of them: these regions nest
   * and overlap, so adding their areas produces figures over 100% of the page
   * and means nothing. One region's own size against the page is a fact. */
  const pageArea = sections.reduce((max, s) => Math.max(max, areaOf(s)), 0);
  const worst = coarse.reduce((w, s) => (areaOf(s) > areaOf(w) ? s : w), coarse[0] ?? null);
  const worstShare = worst && pageArea > 0 ? Math.round((areaOf(worst) / pageArea) * 1000) / 1000 : 0;

  const resolved = sections.length - coarse.length;
  const status = coarse.length === 0
    ? COVERAGE.OBSERVED_SUPPORTED
    : COVERAGE.OBSERVED_INCOMPLETE;

  return dimension("structuralResolution", status, resolved, sections.length,
    coarse.length === 0
      ? `${sections.length} section(s), each either fully within the copy cap or broken down by its children`
      : `${coarse.length} of ${sections.length} section(s) carry more copy than the storage cap while their child sections `
        + `cover under half their area — the survey located these regions but could not take them apart. `
        + `The largest is ${worst.sectionId} <${worst.tag}> at ${worst.geometry?.width}x${worst.geometry?.height}, `
        + `${Math.round(worstShare * 100)}% of the page`,
    coarse.map((s) => ({
      sectionId: s.sectionId,
      tag: s.tag,
      geometry: s.geometry,
      childAreaShare: areaOf(s) > 0 ? Math.round(((childArea.get(s.sectionId) ?? 0) / areaOf(s)) * 1000) / 1000 : null,
      gap: "copy exceeds the storage cap and the section's children cover under half its area"
    })).slice(0, 20));
}

function assessSections(prompt) {
  const sections = sectionsOf(prompt);
  const classified = sections.filter((s) => s.kind && s.kind !== "unknown-section");
  const unstable = sections.filter((s) => s.unstable);
  return dimension("sections",
    grade({ observed: classified.length, total: sections.length }),
    classified.length, sections.length,
    `${classified.length}/${sections.length} classified, ${sections.length - classified.length} unknown-section, ${unstable.length} with unstable geometry`,
    sections.filter((s) => s.kind === "unknown-section")
      .map((s) => ({ sectionId: s.sectionId, reason: s.classification?.reasons?.[0] ?? "not classified" })).slice(0, 20));
}

function assessTextAndHeadings(prompt) {
  const sections = sectionsOf(prompt);
  const withText = sections.filter((s) => isObserved(s.text));
  const truncated = withText.filter((s) => typeof s.text.value === "string" && s.text.value.endsWith("…"));
  const withHeadings = sections.filter((s) => isObserved(s.headings) && (s.headings.items ?? []).length);
  const headingItems = withHeadings.reduce((n, s) => n + s.headings.items.length, 0);
  const truncatedHeadings = withHeadings.reduce((n, s) =>
    n + s.headings.items.filter((i) => String(i.text).endsWith("…")).length, 0);

  const status = withText.length === 0
    ? COVERAGE.UNKNOWN
    : truncated.length > 0 || truncatedHeadings > 0
      ? COVERAGE.OBSERVED_INCOMPLETE
      : grade({ observed: withText.length, total: sections.length });

  return dimension("textAndHeadings", status, withText.length, sections.length,
    `${withText.length}/${sections.length} section(s) carry copy (${truncated.length} truncated at the storage cap); `
    + `${headingItems} heading item(s) across ${withHeadings.length} section(s) (${truncatedHeadings} truncated)`,
    [
      ...truncated.map((s) => ({ sectionId: s.sectionId, gap: "copy truncated at the 240-character storage cap" })),
      ...sections.filter((s) => !isObserved(s.text)).map((s) => ({ sectionId: s.sectionId, gap: "no observed copy" }))
    ].slice(0, 20));
}

function assessLayout(prompt) {
  const sections = sectionsOf(prompt);
  const withLayout = sections.filter((s) => isObserved(s.layout));
  const withGeometry = sections.filter((s) =>
    Number.isFinite(s.geometry?.width) && Number.isFinite(s.geometry?.height));
  return dimension("layout",
    grade({ observed: withGeometry.length, total: sections.length }),
    withGeometry.length, sections.length,
    `${withGeometry.length}/${sections.length} section(s) carry measured geometry, ${withLayout.length} carry observed layout detail`,
    sections.filter((s) => !Number.isFinite(s.geometry?.width))
      .map((s) => ({ sectionId: s.sectionId, gap: "no measured geometry" })).slice(0, 20));
}

function assessStyle(prompt) {
  const sections = sectionsOf(prompt);
  const cats = ["typography", "colors", "spacing"];
  const per = {};
  let observedTotal = 0;
  for (const c of cats) {
    const n = sections.filter((s) => isObserved(s[c])).length;
    per[c] = n;
    observedTotal += n;
  }
  const possible = sections.length * cats.length;
  return dimension("typographyColorSpacing",
    grade({ observed: observedTotal, total: possible }),
    observedTotal, possible,
    `typography ${per.typography}/${sections.length}, colors ${per.colors}/${sections.length}, spacing ${per.spacing}/${sections.length}`,
    cats.filter((c) => per[c] < sections.length).map((c) => ({ category: c, missing: sections.length - per[c] })));
}

function assessAssets(prompt) {
  const sections = sectionsOf(prompt);
  const items = sections.flatMap((s) => s.assets?.items ?? []);
  if (items.length === 0) {
    return dimension("assets", COVERAGE.UNKNOWN, 0, 0, "no asset was observed anywhere on the page", []);
  }
  const resolved = items.filter((a) => a.status === "observed" && a.identity && a.identity !== "inline-svg");
  const pending = items.filter((a) => a.status === "pending");
  const failed = items.filter((a) => a.status === "failed");
  const inlineSvg = items.filter((a) => a.identity === "inline-svg");
  return dimension("assets",
    grade({ observed: resolved.length, total: items.length }),
    resolved.length, items.length,
    `${resolved.length} resolved, ${pending.length} never finished loading, ${failed.length} failed, ${inlineSvg.length} inline SVG with no captured markup`,
    [
      ...(pending.length ? [{ gap: "pending", count: pending.length }] : []),
      ...(failed.length ? [{ gap: "failed", count: failed.length }] : []),
      ...(inlineSvg.length ? [{ gap: "inline-svg markup not captured", count: inlineSvg.length }] : [])
    ]);
}

function assessVisualRegions(prompt) {
  const sections = sectionsOf(prompt);
  const seen = new Map();
  for (const s of sections) for (const v of s.visuals?.items ?? []) if (!seen.has(v.visualId)) seen.set(v.visualId, v);
  const items = [...seen.values()];
  if (items.length === 0) {
    return dimension("visualRegions", COVERAGE.UNKNOWN, 0, 0,
      "no painted interior was located; this build may predate visual-region capture", []);
  }
  const resolved = items.filter((v) => v.resolved);
  /* A resolved crop must carry BOTH a hash and placement provenance, or it is
   * a picture nobody can verify or position. */
  const verifiable = resolved.filter((v) =>
    (v.hash || v.source?.identity) && v.placement && v.placement.scrollState !== undefined);
  const byReason = {};
  for (const v of items) if (!v.resolved && v.unresolvedReason) byReason[v.unresolvedReason] = (byReason[v.unresolvedReason] ?? 0) + 1;

  const status = resolved.length === 0
    ? COVERAGE.UNKNOWN
    : verifiable.length < resolved.length
      ? COVERAGE.OBSERVED_INCOMPLETE
      : grade({ observed: resolved.length, total: items.length });

  return dimension("visualRegions", status, resolved.length, items.length,
    `${resolved.length}/${items.length} resolved, ${verifiable.length} of those carry both a hash/source and placement provenance`,
    Object.entries(byReason).map(([reason, count]) => ({ reason, count })));
}

/**
 * The five interaction dimensions.
 *
 * The rule that shapes all of them: **a page nobody interacted with must never
 * score well on interaction.** Completeness is about what the prompt can
 * account for, and "we did not try" accounts for nothing. Equally, "we tried
 * and this page has no menus" is a real finding and must not read as a gap —
 * so the two are given different words, not different numbers.
 */
function assessInteractionDimensions(prompt) {
  const states = prompt.interactionStates ?? [];
  const attempted = states.filter((s) =>
    s.status === "completed" || s.status === "completed-no-observable-change" || s.status === "failed");
  const completed = states.filter((s) => s.status === "completed");
  const refused = states.filter((s) => s.status === "refused");
  const withAction = states.filter((s) => s.action);

  /* ---- 1. controls: did we find anything that affords an interaction? ---- */
  const controls = states.length === 0
    ? dimension("controlsObserved", COVERAGE.UNKNOWN, 0, 0,
      "no interaction discovery ran, so whether this page has controls is unestablished — this is not a finding that it has none", [])
    : withAction.length === 0
      ? dimension("controlsObserved", COVERAGE.OBSERVED_SUPPORTED, 0, states.length,
        `${states.length} candidate(s) examined and none afforded a recognised interaction — an observed absence, not an untried one`, [])
      : dimension("controlsObserved", COVERAGE.OBSERVED_SUPPORTED, withAction.length, states.length,
        `${withAction.length} of ${states.length} candidate(s) afford a recognised interaction`, []);

  /* ---- 2. states: how many transitions were actually observed? ---- */
  const byRefusal = {};
  for (const s of refused) if (s.refusalReason) byRefusal[s.refusalReason] = (byRefusal[s.refusalReason] ?? 0) + 1;

  const stateDim = states.length === 0
    ? dimension("interactionStatesObserved", COVERAGE.UNKNOWN, 0, 0,
      "no interaction was attempted; every interaction behaviour on this page is unknown", [])
    : attempted.length === 0
      ? dimension("interactionStatesObserved", COVERAGE.UNKNOWN, 0, withAction.length,
        `${withAction.length} control(s) afford an interaction and none was attempted — all were refused or cut by budget`,
        Object.entries(byRefusal).map(([reason, count]) => ({ reason, count })))
      : dimension("interactionStatesObserved",
        grade({ observed: completed.length, total: withAction.length }),
        completed.length, withAction.length,
        `${completed.length} observed transition(s) of ${withAction.length} control(s) that afford one; `
        + `${attempted.length - completed.length} attempted without an observable change or failed; ${refused.length} refused`,
        Object.entries(byRefusal).map(([reason, count]) => ({ reason, count })));

  /* ---- 3. restoration: was the page put back? ---- */
  const needed = states.filter((s) => s.restoration === "restored" || s.restoration === "restoration-failed");
  const restored = states.filter((s) => s.restoration === "restored");
  const restoration = needed.length === 0
    ? dimension("stateRestoration", states.length === 0 ? COVERAGE.UNKNOWN : COVERAGE.OBSERVED_SUPPORTED, 0, 0,
      states.length === 0
        ? "no interaction ran, so nothing needed restoring"
        : "no interaction changed the page in a way that needed restoring", [])
    : dimension("stateRestoration",
      restored.length === needed.length ? COVERAGE.OBSERVED_SUPPORTED : COVERAGE.OBSERVED_INCOMPLETE,
      restored.length, needed.length,
      `${restored.length} of ${needed.length} changed state(s) were restored`
      + (restored.length < needed.length ? " — the remaining evidence was gathered on a page that had drifted from its resting state" : ""),
      needed.filter((s) => s.restoration !== "restored")
        .map((s) => ({ interactionId: s.interactionId, action: s.action, gap: "state could not be restored" })));

  /* ---- 4. provenance: does every claim carry both sides? ---- */
  const claimsTransition = states.filter((s) => s.status === "completed");
  const withBoth = claimsTransition.filter((s) =>
    Array.isArray(s.before) && s.before.length && Array.isArray(s.after) && s.after.length);
  const provenance = claimsTransition.length === 0
    ? dimension("interactionProvenance", states.length === 0 ? COVERAGE.UNKNOWN : COVERAGE.OBSERVED_SUPPORTED, 0, 0,
      states.length === 0
        ? "no interaction ran, so there is no transition to evidence"
        : "no transition was observed, so there is no before/after pair to carry", [])
    : dimension("interactionProvenance",
      withBoth.length === claimsTransition.length ? COVERAGE.OBSERVED_SUPPORTED : COVERAGE.OBSERVED_INCOMPLETE,
      withBoth.length, claimsTransition.length,
      `${withBoth.length} of ${claimsTransition.length} observed transition(s) carry both before and after observation ids`,
      claimsTransition.filter((s) => !(s.before?.length && s.after?.length))
        .map((s) => ({ interactionId: s.interactionId, gap: "a transition claim without both sides is a claim about one moment" })));

  /* ---- 5. unsupported: what did we decline to touch, and why? ---- */
  const unsupported = refused.length === 0
    ? dimension("unsupportedInteractions", states.length === 0 ? COVERAGE.UNKNOWN : COVERAGE.OBSERVED_SUPPORTED, 0, 0,
      states.length === 0
        ? "no interaction discovery ran, so nothing was declined"
        : "nothing was declined on safety grounds", [])
    : dimension("unsupportedInteractions", COVERAGE.REFUSED, 0, refused.length,
      `${refused.length} control(s) were declined rather than activated — a refusal is a safety decision about this tool, not a statement about the page`,
      Object.entries(byRefusal).map(([reason, count]) => ({ reason, count })));

  return [controls, stateDim, restoration, provenance, unsupported];
}

function assessResponsive(prompt) {
  const sections = sectionsOf(prompt);
  const used = (prompt.viewportsUsed ?? []).length;
  if (used < 2) {
    return dimension("responsive", COVERAGE.UNKNOWN, 0, sections.length,
      `only ${used} viewport produced a usable model, so no responsive difference can be evidenced`, []);
  }
  /* A responsive claim is only supported when the section was MATCHED at the
   * other viewport by DOM identity and both sides carry geometry. A difference
   * asserted without both is a comparison between a measurement and a guess. */
  let matched = 0, withDifference = 0, unmatched = 0;
  for (const s of sections) {
    const cmps = Array.isArray(s.responsive) ? s.responsive : [];
    if (!cmps.length) continue;
    const obs = cmps.filter((c) => c.observed && c.sectionId);
    if (obs.length) matched++; else unmatched++;
    if (obs.some((c) => (c.differences ?? []).length)) withDifference++;
  }
  return dimension("responsive",
    grade({ observed: matched, total: sections.length }),
    matched, sections.length,
    `${matched}/${sections.length} section(s) matched by DOM identity at another viewport; `
    + `${withDifference} carry an observed difference; ${unmatched} could not be matched`,
    []);
}

function assessScrollReveal(prompt) {
  const revealed = prompt.scrollRevealedSections ?? [];
  const sections = sectionsOf(prompt);
  if (revealed.length === 0) {
    return dimension("scrollReveal", COVERAGE.UNKNOWN, 0, 0,
      "no section was observed appearing during scroll", []);
  }
  /* Every scroll-revealed claim needs scroll-state provenance behind it. */
  const ids = new Set(revealed.map((r) => (typeof r === "string" ? r : r.sectionId)).filter(Boolean));
  let withProvenance = 0;
  for (const s of sections) {
    if (!ids.has(s.sectionId)) continue;
    const prov = s.provenance ?? [];
    if (prov.some((p) => typeof p.scrollState === "string" && p.scrollState.length)) withProvenance++;
  }
  return dimension("scrollReveal",
    withProvenance === ids.size ? COVERAGE.OBSERVED_SUPPORTED : COVERAGE.OBSERVED_INCOMPLETE,
    withProvenance, ids.size,
    `${ids.size} scroll-revealed section(s), ${withProvenance} carrying scroll-state provenance`,
    []);
}

function assessUnresolved(prompt) {
  const sections = sectionsOf(prompt);
  const seen = new Map();
  for (const s of sections) for (const v of s.visuals?.items ?? []) if (!seen.has(v.visualId)) seen.set(v.visualId, v);
  const unresolvedVisuals = [...seen.values()].filter((v) => !v.resolved);
  const unknownText = sections.filter((s) => !isObserved(s.text));
  const notes = prompt.evidenceNotes ?? [];
  const total = unresolvedVisuals.length + unknownText.length;
  /* This dimension COUNTS gaps rather than measuring coverage, so it carries no
   * ratio. Reporting `total/total` here would print a confident 100% next to
   * the word "unresolved", which is precisely the wrong impression. */
  return {
    ...dimension("unresolvedEvidence",
      total === 0 ? COVERAGE.OBSERVED_SUPPORTED : COVERAGE.OBSERVED_INCOMPLETE,
      total, null,
      `${unresolvedVisuals.length} unresolved visual region(s), ${unknownText.length} section(s) without observed copy, ${notes.length} evidence note(s)`,
      unresolvedVisuals.map((v) => ({ visualId: v.visualId, reason: v.unresolvedReason })).slice(0, 20)),
    countsGaps: true
  };
}

function assessUnsupportedRendering(prompt) {
  const sections = sectionsOf(prompt);
  const seen = new Map();
  for (const s of sections) for (const v of s.visuals?.items ?? []) if (!seen.has(v.visualId)) seen.set(v.visualId, v);
  const surfaces = [...seen.values()].filter((v) => v.type === "canvas-webgl-video");
  if (surfaces.length === 0) {
    return dimension("unsupportedRendering", COVERAGE.OBSERVED_SUPPORTED, 0, 0,
      "no canvas, video or embedded rendering surface was found", []);
  }
  return dimension("unsupportedRendering", COVERAGE.REFUSED, 0, surfaces.length,
    `${surfaces.length} rendering surface(s) whose pixels cannot be read back and are refused rather than photographed`,
    surfaces.map((v) => ({ visualId: v.visualId, tag: v.tag, reason: v.unresolvedReason })).slice(0, 20));
}

/* ------------------------------------------------------------------ report */

/**
 * Assess one clone prompt against the viewports it was built from.
 *
 * A refusal artifact is graded too, and grades as `refused` throughout — a
 * refusal is a complete answer to "what can be built from this", it is simply
 * the answer "nothing, and here is why".
 */
export function assessPromptCompleteness({ prompt, viewports = [] } = {}) {
  if (!prompt || typeof prompt !== "object") {
    throw new TypeError("assessPromptCompleteness requires a clone prompt object");
  }

  if (prompt.kind === "refusal") {
    const refusedWidths = (prompt.viewports ?? []).map((v) => v.width);
    return {
      $promptCompleteness: COMPLETENESS_VERSION,
      kind: "refusal",
      url: prompt.url ?? null,
      supportClass: (prompt.viewports ?? [])[0]?.supportClass ?? null,
      buildable: false,
      dimensions: DIMENSIONS.map((d) => dimension(d, COVERAGE.REFUSED, 0, 0,
        "the support gate refused every viewport, so nothing may be claimed from this capture", [])),
      viewportSeparation: { primary: null, widths: refusedWidths, leaks: [], separated: true },
      fabricatedReferences: 0,
      summary: {
        [COVERAGE.OBSERVED_SUPPORTED]: 0,
        [COVERAGE.OBSERVED_INCOMPLETE]: 0,
        [COVERAGE.INFERRED]: 0,
        [COVERAGE.UNKNOWN]: 0,
        [COVERAGE.REFUSED]: DIMENSIONS.length
      },
      blockingProblems: []
    };
  }

  const references = assessReferences(prompt, viewports);
  const dims = [
    assessPageStructure(prompt),
    assessStructuralResolution(prompt),
    assessSections(prompt),
    assessTextAndHeadings(prompt),
    assessLayout(prompt),
    assessStyle(prompt),
    assessAssets(prompt),
    assessVisualRegions(prompt),
    ...assessInteractionDimensions(prompt),
    assessResponsive(prompt),
    assessScrollReveal(prompt),
    assessUnresolved(prompt),
    assessUnsupportedRendering(prompt),
    references
  ];

  const separation = assessViewportSeparation(prompt);

  const summary = {
    [COVERAGE.OBSERVED_SUPPORTED]: 0,
    [COVERAGE.OBSERVED_INCOMPLETE]: 0,
    [COVERAGE.INFERRED]: 0,
    [COVERAGE.UNKNOWN]: 0,
    [COVERAGE.REFUSED]: 0
  };
  for (const d of dims) summary[d.status] = (summary[d.status] ?? 0) + 1;

  /* Problems that make the prompt unsafe to hand to a builder, as opposed to
   * merely incomplete. Incompleteness is normal and is reported; these are not. */
  const blockingProblems = [];
  if (references.fabricated > 0) {
    blockingProblems.push({
      code: "unresolved-references",
      message: `${references.fabricated} evidence reference(s) resolve to nothing in the source evidence`
    });
  }
  if (!separation.separated) {
    blockingProblems.push({
      code: "viewport-leak",
      message: `${separation.leaks.length} claim(s) cite evidence from a viewport other than the one they belong to`
    });
  }
  const excluded = prompt.excludedViewports ?? [];
  for (const ex of excluded) {
    if (ex.supportClass && producesOutput(ex.supportClass)) {
      blockingProblems.push({
        code: "excluded-usable-viewport",
        message: `viewport ${ex.width} was excluded although its support class ${ex.supportClass} produces output`
      });
    }
  }

  return {
    $promptCompleteness: COMPLETENESS_VERSION,
    kind: "prompt",
    url: prompt.url ?? null,
    supportClass: prompt.supportClass ?? null,
    buildable: blockingProblems.length === 0,
    dimensions: dims,
    viewportSeparation: separation,
    fabricatedReferences: references.fabricated,
    summary,
    blockingProblems
  };
}

/**
 * A deterministic, human-readable rendering of a completeness report.
 *
 * Written as a table because the whole value of this report is comparison —
 * between dimensions, and between runs of the same page over time.
 */
export function renderCompletenessReport(report) {
  const lines = [];
  lines.push(`prompt completeness — ${report.url ?? "(no url)"} · ${report.kind} · ${report.supportClass ?? "(no class)"}`);
  lines.push("");
  const w = Math.max(...report.dimensions.map((d) => d.dimension.length));
  for (const d of report.dimensions) {
    const ratio = d.ratio === null ? "   —  " : `${String(Math.round(d.ratio * 100)).padStart(3)}% `;
    lines.push(`  ${d.dimension.padEnd(w)}  ${ratio}  ${d.status.padEnd(22)}  ${d.detail}`);
  }
  lines.push("");
  lines.push(`  buildable: ${report.buildable ? "yes" : "no"}`
    + ` · viewports ${report.viewportSeparation.widths.join(", ") || "(none)"}`
    + ` · separated: ${report.viewportSeparation.separated ? "yes" : "NO"}`
    + ` · unresolved references: ${report.fabricatedReferences}`);
  for (const p of report.blockingProblems) lines.push(`  BLOCKING ${p.code}: ${p.message}`);
  return lines.join("\n");
}

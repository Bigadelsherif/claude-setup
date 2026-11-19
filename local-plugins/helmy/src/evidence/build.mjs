/**
 * raw extract (+ optional probe) -> graded evidence records + claim map.
 *
 * Inference and evidence-minting happen together, deliberately. If they were
 * separate passes the inference logic would exist twice and the evidence trail
 * would be reconstructed rather than recorded — which is how provenance quietly
 * becomes fiction.
 *
 * Nothing here invents a value. When a claim cannot be supported it goes into
 * `unknowns` with a reason.
 */

import {
  STATUS, METHOD, confidenceFor,
  capStatusForSource, sourceForMethod, techniqueForMethod
} from "./status.mjs";
import * as css from "../util/css.mjs";
import * as color from "../util/color.mjs";
import { inferSpacingBase, rampForBase, describeRamp, observedValues } from "./spacing.mjs";
import { classifySurface, SURFACE } from "../component/surface.mjs";
import { recordMotionObservations } from "./motion-observed.mjs";
import { gatherIdentity, gatherNonSurfaceProperties, evaluateAnatomy } from "../component/identity.mjs";

const EVIDENCE_SCHEMA_VERSION = "0.1.0";

class Recorder {
  constructor(referenceId, viewport) {
    this.referenceId = referenceId;
    this.viewport = viewport;
    this.records = [];
    this.claims = {};
    this.unknowns = [];
    this.notes = [];
    this._seq = 0;
  }

  nextId() {
    this._seq += 1;
    return `ev_${String(this._seq).padStart(4, "0")}`;
  }

  /**
   * Mint an evidence record. Returns its id.
   *
   * `source` and `technique` are derived from `method` when not given, so
   * existing call sites keep working while new ones can be explicit. The
   * status is capped to what the source can support — a screenshot-derived
   * value cannot be recorded as `observed` no matter what the caller passes.
   */
  record({
    claim,
    value,
    normalized = null,
    status,
    method,
    origin = null,
    technique = null,
    region = null,
    source = {},
    sampleSize = 1,
    agreement = 1,
    raw = [],
    notes = ""
  }) {
    const id = this.nextId();
    const resolvedOrigin = origin ?? sourceForMethod(method);
    const resolvedTechnique = technique ?? techniqueForMethod(method);
    const cappedStatus = capStatusForSource(status, resolvedOrigin);

    this.records.push({
      id,
      claim,
      value,
      normalized,
      status: cappedStatus,
      method,
      sourceKind: resolvedOrigin,
      technique: resolvedTechnique,
      source: {
        selector: source.selector ?? null,
        element: source.element ?? null,
        domPath: source.domPath ?? null,
        viewport: source.viewport ?? this.viewport,
        state: source.state ?? "default",
        scheme: source.scheme ?? "light",
        // Screenshot evidence is inadmissible without the pixels it came from.
        region: region ?? source.region ?? null
      },
      sampleSize,
      agreement: Math.round(agreement * 1000) / 1000,
      raw: raw.slice(0, 10),
      confidence: confidenceFor({ status: cappedStatus, sampleSize, agreement }),
      contests: [],
      supersededBy: null,
      notes:
        cappedStatus !== status
          ? `${notes}${notes ? " " : ""}Status capped from "${status}" to "${cappedStatus}": a ${resolvedOrigin} source cannot support more.`
          : notes
    });
    return id;
  }

  /** Attach a claim node (what the IR consumes) to one or more evidence ids. */
  claim(path, { value, unit = null, status, evidence, sampleSize = 1, agreement = 1 }) {
    this.claims[path] = {
      value,
      unit,
      status,
      confidence: confidenceFor({ status, sampleSize, agreement }),
      evidence: Array.isArray(evidence) ? evidence : [evidence]
    };
    return this.claims[path];
  }

  /** Record a value and its claim in one motion — the common case. */
  observe(path, opts) {
    const id = this.record({ claim: path, ...opts });
    this.claim(path, {
      value: opts.normalized?.primary ?? opts.value,
      unit: opts.unit ?? null,
      status: opts.status,
      evidence: [id],
      sampleSize: opts.sampleSize ?? 1,
      agreement: opts.agreement ?? 1
    });
    return id;
  }

  unknown(claim, reason) {
    this.unknowns.push({ claim, reason });
  }

  note(text) {
    this.notes.push(text);
  }
}

/* -------------------------------------------------------------- helpers */

const total = (entries) => entries.reduce((sum, e) => sum + e.count, 0);

function topEntry(entries) {
  return entries && entries.length ? entries[0] : null;
}

function agreementOf(entry, entries) {
  const t = total(entries);
  return t ? entry.count / t : 0;
}

function buildProbeIndex(probe) {
  const index = new Map();
  if (!probe?.results) return index;
  for (const result of probe.results) {
    if (result.samples?.length) index.set(result.selector, result);
  }
  return index;
}

/** First probed sample for any of the given selectors. */
function firstSample(index, selectors) {
  for (const sel of selectors) {
    const hit = index.get(sel);
    if (hit?.samples?.length) return { selector: sel, sample: hit.samples[0], matches: hit.matches };
  }
  return null;
}

/* --------------------------------------------------------- inference bits */

/* Spacing inference lives in ./spacing.mjs — it grew its own thresholds,
 * ranking, and an explicit "I cannot tell" outcome, which is too much policy to
 * keep inline next to the extraction plumbing. */

function inferTypeRamp(fontSizeEntries) {
  const values = fontSizeEntries
    .map((e) => css.px(e.value))
    .filter((v) => v != null && v > 0);
  return [...new Set(values)].sort((a, b) => a - b);
}

/**
 * The painted surface of a repeat group.
 *
 * With probe data this is MEASURED: we know which descendant actually paints.
 * Without it we fall back to the repeat root, which is a real and defensible
 * heuristic but is wrong whenever a transparent wrapper sits on top — so it is
 * recorded as INFERRED with the caveat attached, never as fact.
 */
function resolveSurface({ repeat, probeIndex, radiusEntries }) {
  if (!repeat) return null;

  const rootSelector = signatureToSelector(repeat.signature);
  /* One lookup key, from the helper. The second candidate used to be the same
   * selector rebuilt by splitting on `.`, which produced a different and
   * broken string for any class containing a dot (def_0052). */
  const probed = firstSample(probeIndex, [rootSelector]);

  if (probed?.sample?.paintedSurface) {
    const painted = probed.sample.paintedSurface;
    return {
      mode: "probe",
      status: painted.isRoot ? STATUS.OBSERVED : STATUS.MEASURED,
      method: painted.isRoot ? METHOD.COMPUTED_STYLE : METHOD.LAYOUT_RECT,
      selector: painted.selector,
      domPath: painted.domPath,
      isRoot: painted.isRoot,
      borderRadius: css.px(painted.borderRadius),
      background: painted.backgroundColor,
      borderWidth: css.px(painted.borderWidth),
      borderColor: painted.borderColor,
      boxShadow: painted.boxShadow,
      padding: painted.padding,
      rootSelector,
      rootPaints: probed.sample.paints,
      matches: probed.matches
    };
  }

  /* The probe ran against this component and found nothing painting.
   *
   * That is an answer, not a missing one. Falling through to the aggregate
   * branch here discarded it and reported `unknown`, which under the anatomy
   * guard blocks recreate for a reason that does not apply (def_0026). The
   * computed values the probe actually read are carried through so the
   * classification rests on measurements rather than on their absence. */
  if (probed?.sample && probed.sample.paints === false) {
    const computed = probed.sample.computed ?? {};
    const box = probed.sample.box ?? {};

    /* `paints()` asks only about backgrounds, so a border- or shadow-only
     * component arrives here looking unpainted. The border and shadow it does
     * carry are read from the computed subset rather than by widening
     * `paints()`, whose result feeds repeat scoring and component selection
     * across every capture (def_0027). */
    const EDGES = ["Top", "Right", "Bottom", "Left"];
    let borderWidth = 0;
    let borderColor = null;
    for (const edge of EDGES) {
      const w = css.px(computed[`border${edge}Width`]);
      const c = computed[`border${edge}Color`];
      if ((w ?? 0) > 0 && c) { borderWidth = w; borderColor = c; break; }
    }

    return {
      mode: "probe",
      paintsNothing: true,
      status: STATUS.MEASURED,
      method: METHOD.COMPUTED_STYLE,
      selector: probed.sample.selector ?? rootSelector,
      domPath: probed.sample.domPath ?? repeat.sampleDomPath ?? null,
      isRoot: true,
      borderRadius: css.px(computed.borderTopLeftRadius) ?? null,
      background: computed.backgroundColor ?? null,
      borderWidth,
      borderColor,
      boxShadow: computed.boxShadow ?? null,
      padding: Array.isArray(box.padding) ? box.padding.join(" ") : null,
      rootSelector,
      rootPaints: false,
      matches: probed.matches ?? repeat.count
    };
  }

  // Aggregate-only fallback: attribute the radius whose samples name this
  // repeat. Histogram samples carry the full `tag.class` form, so match against
  // the signature as well as the bare class selector.
  const entry = radiusEntries.find((e) =>
    e.samples?.some((s) => s === rootSelector || s === repeat.signature)
  );
  return {
    mode: "aggregate",
    status: STATUS.INFERRED,
    method: METHOD.STRUCTURAL_INFERENCE,
    selector: rootSelector,
    domPath: repeat.sampleDomPath ?? null,
    isRoot: true,
    borderRadius: entry ? css.px(entry.value) : null,
    background: null,
    borderWidth: null,
    borderColor: null,
    boxShadow: null,
    padding: null,
    rootSelector,
    rootPaints: null,
    matches: repeat.count,
    caveat:
      "Resolved from the repeat-group root without probe data. If a transparent wrapper sits above the painted surface, this value belongs to the wrapper."
  };
}

/**
 * A repeat-group signature with its leading tag removed.
 *
 * Splitting on `.` and rejoining looks equivalent and is not. A Tailwind class
 * carries literal dots (`aspect-[0.95/1]`) and, once escaped for use as a
 * selector, backslash-dot pairs (`aspect-\[0\.95\/1\]`) — either way the split
 * cuts inside a single class token and the rejoin produces a selector that
 * matches nothing (def_0052). The tag is the leading run of name characters
 * before the first dot, so removing exactly that is both simpler and correct.
 */
function signatureToSelector(signature) {
  if (!signature) return null;
  const withoutTag = String(signature).replace(/^[A-Za-z][\w-]*/, "");
  return withoutTag.startsWith(".") ? withoutTag : String(signature);
}

/**
 * Collapses breakpoint rules into boundaries, preserving direction.
 *
 * `max-width: 599px` and `min-width: 600px` describe ONE transition. Phase 0
 * discarded direction and emitted both edges as separate breakpoints, which
 * turned three boundaries into seven on a real site.
 */
export function normalizeBreakpoints(rules = []) {
  const sorted = [...rules].sort((a, b) => a.value - b.value);
  const boundaries = [];
  const consumed = new Set();

  for (let i = 0; i < sorted.length; i++) {
    if (consumed.has(i)) continue;
    const rule = sorted[i];

    if (rule.direction === "max") {
      // Look for a min-width one pixel above: the other half of the same edge.
      const partnerIndex = sorted.findIndex(
        (r, j) => !consumed.has(j) && j !== i && r.direction === "min" && Math.abs(r.value - (rule.value + 1)) < 0.51
      );
      if (partnerIndex !== -1) {
        consumed.add(i);
        consumed.add(partnerIndex);
        boundaries.push({
          value: sorted[partnerIndex].value,
          relationship: "range-boundary",
          below: { direction: "max", value: rule.value },
          above: { direction: "min", value: sorted[partnerIndex].value },
          source: [rule.condition, sorted[partnerIndex].condition]
        });
        continue;
      }
    }

    consumed.add(i);
    boundaries.push({
      value: rule.value,
      relationship: rule.direction === "min" ? "min-width" : "max-width",
      [rule.direction === "min" ? "above" : "below"]: { direction: rule.direction, value: rule.value },
      source: [rule.condition]
    });
  }

  const seen = new Map();
  for (const b of boundaries) {
    const existing = seen.get(b.value);
    if (!existing || b.relationship === "range-boundary") seen.set(b.value, b);
  }
  return [...seen.values()].sort((a, b) => a.value - b.value);
}

/**
 * Chooses the repeat group that best represents the page's primary component.
 *
 * Ordering is by the extractor's own score, which already down-ranks navigation
 * and unpainted scaffolding — but content membership is applied as a hard
 * preference here, because a nav group that happens to score well must never
 * outrank a genuine content group.
 */
function selectPrimaryRepeat(repeats = []) {
  if (!repeats.length) return null;

  const inContent = repeats.filter(
    (r) => (r.inPrimary || r.region === "main") && !r.inNavContainer && (r.paintedCount ?? 0) > 0
  );

  let chosen;
  let quality;
  if (inContent.length) {
    chosen = inContent[0];
    quality = "content";
  } else {
    const anyContent = repeats.filter((r) => r.inPrimary || r.region === "main");
    if (anyContent.length) {
      chosen = anyContent[0];
      quality = "content-unpainted";
    } else {
      chosen = repeats[0];
      quality = "outside-content";
    }
  }

  return { repeat: outermostOfSameComponent(chosen, repeats), quality };
}

/**
 * Resolves a component's identity to its outermost node.
 *
 * A card and the painted div inside it are ONE component observed at two
 * depths, and they repeat exactly as often as each other. Scoring prefers the
 * painted inner node, which is right for reading the surface and wrong for
 * naming the component — an implementer needs the element that IS the card,
 * not the element that paints it.
 *
 * Walking up is bounded by equal instance count: a true wrapper of the same
 * component repeats the same number of times. A section that merely contains
 * the group repeats fewer times and is therefore never selected.
 */
function outermostOfSameComponent(chosen, repeats) {
  const isAncestorPath = (a, b) => !!a && !!b && b !== a && b.startsWith(`${a}>`);

  let current = chosen;
  let moved = true;
  let guard = 0;

  while (moved && guard++ < 8) {
    moved = false;
    for (const candidate of repeats) {
      if (candidate === current) continue;
      if (!isAncestorPath(candidate.sampleDomPath, current.sampleDomPath)) continue;

      /* Equal instance count is the usual signal that two groups are one
       * component seen at two depths. It breaks for cells inside rows: 24 `td`
       * sit inside 6 `tr`, so the row is never reached and the cell is reported
       * as the component. An exact integer multiple with a consistent
       * per-instance fan-out is the same relationship — n children per parent —
       * and is accepted as such. Non-integer ratios are not: they mean the
       * grouping is uneven and the two are genuinely different things. */
      const sameCount = candidate.count === current.count;
      const fanOut = candidate.count > 0 ? current.count / candidate.count : 0;
      const evenFanOut =
        !sameCount &&
        Number.isInteger(fanOut) &&
        fanOut > 1 && fanOut <= 12 &&
        (candidate.paintedCount ?? 0) === 0 && (current.paintedCount ?? 0) === 0;
      if (!sameCount && !evenFanOut) continue;
      if (evenFanOut) {
        current = candidate;
        moved = true;
        break;
      }
      // Only ascend when the child substantially FILLS the ancestor. A card and
      // the div that paints it share a box; a feature row and the small price
      // cell inside it do not, and treating the row as "the same component"
      // would throw away the surface we actually resolved.
      //
      // The gate exists to stop a small PAINTED cell claiming an unpainted
      // parent. When neither node paints there is no such risk, and the gate
      // instead prevents the semantic unit from ever being reached: a heading
      // fills a fraction of the feature row that contains it, so `.feature__title`
      // was reported as the component in five of ten unpainted fixtures
      // (def_0024). Where neither paints, ascend on structural grounds instead —
      // same instance count, ancestor relationship, and an ancestor that
      // contributes child structure the candidate does not have.
      const neitherPaints = (current.paintedCount ?? 0) === 0 && (candidate.paintedCount ?? 0) === 0;
      if (!neitherPaints && (current.area ?? 0) < (candidate.area ?? 0) * 0.9) continue;
      if (neitherPaints) {
        const ancestorChildren = candidate.coherence?.childTagSequenceDiversity?.dominantValue ?? "";
        const currentChildren = current.coherence?.childTagSequenceDiversity?.dominantValue ?? "";
        // A genuine parent has internal structure; a transparent duplicate of
        // the same node does not, and ascending to it would gain nothing.
        if (!ancestorChildren || ancestorChildren === currentChildren) continue;
      }
      current = candidate;
      moved = true;
      break;
    }
  }
  return current;
}

/* ============================================================ main entry */

export function buildEvidence(raw, probe = null, options = {}) {
  const mode = options.mode ?? (probe ? "full" : "aggregate-only");
  const viewport = raw?.meta?.viewport?.width ?? options.viewport ?? null;
  const referenceId = options.referenceId ?? "unknown";
  const rec = new Recorder(referenceId, viewport);
  const probeIndex = mode === "aggregate-only" ? new Map() : buildProbeIndex(probe);
  const h = raw.histograms ?? {};

  if (mode === "aggregate-only") {
    rec.note("Built in aggregate-only mode: pass-2 probe data was not used. Component surface claims are inferred rather than measured.");
  }

  /* ---------------------------------------------------------- page anchors */

  const page = raw.page ?? null;
  if (page?.background) {
    rec.observe("tokens.color.surface.page", {
      value: page.background,
      status: STATUS.OBSERVED,
      method: METHOD.COMPUTED_STYLE,
      source: { selector: "body", element: "body" },
      notes: "Read directly from the body element rather than inferred from frequency."
    });
  } else {
    rec.unknown("tokens.color.surface.page", "No page-level background could be read.");
  }

  if (page?.color) {
    rec.observe("tokens.color.text.primary", {
      value: page.color,
      status: STATUS.OBSERVED,
      method: METHOD.COMPUTED_STYLE,
      source: { selector: "body", element: "body" }
    });
  } else {
    rec.unknown("tokens.color.text.primary", "No page-level text colour could be read.");
  }

  /* ------------------------------------------------------- custom properties
   * When a site declares its own token system, that is the most authoritative
   * source available and outranks anything we could infer. */

  const customProps = raw.customProperties ?? [];
  for (const prop of customProps) {
    const value = prop.resolved || prop.value;
    if (!value) continue;
    rec.record({
      claim: `source.customProperty${prop.name}`,
      value,
      status: STATUS.OBSERVED,
      method: METHOD.CSS_CUSTOM_PROPERTY,
      source: { selector: prop.scope, element: null },
      notes: prop.media ? `declared under ${prop.media}` : ""
    });
  }
  if (customProps.length) {
    rec.note(`${customProps.length} CSS custom properties declared by the source — an authored token system is present.`);
  }

  /* ------------------------------------------------------------- colour map */

  const colorEntries = h.color ?? [];
  const backgrounds = colorEntries.filter((e) => e.roles?.background);
  const texts = colorEntries.filter((e) => e.roles?.text);

  // Role binding is resolved BEFORE any role is assigned, because the roles are
  // mutually exclusive. On stripe.com/pricing the brand colour was bound to
  // brand.primary AND text.secondary AND surface.raised simultaneously —
  // frequency alone cannot tell a link colour from secondary body text, nor a
  // brand-filled hero band from the surface cards sit on.
  const boundColors = new Set([page?.background, page?.color].filter(Boolean));

  const saturatedEarly = colorEntries.filter(
    (e) => e.value.startsWith("#") && !color.isNeutral(e.value) && e.value !== page?.background
  );
  const brandCandidate = topEntry(saturatedEarly);
  if (brandCandidate) boundColors.add(brandCandidate.value);

  const raisedCandidate = backgrounds.find(
    (e) =>
      e.value !== page?.background &&
      e.value !== "transparent" &&
      // A raised surface must not be the brand colour: a brand-filled hero band
      // is a section treatment, not the surface cards sit on.
      e.value !== brandCandidate?.value
  );
  if (raisedCandidate) {
    const id = rec.record({
      claim: "tokens.color.surface.raised",
      value: raisedCandidate.value,
      status: STATUS.INFERRED,
      method: METHOD.FREQUENCY_INFERENCE,
      source: { selector: raisedCandidate.samples?.[0] ?? null },
      sampleSize: raisedCandidate.roles.background,
      agreement: agreementOf(raisedCandidate, backgrounds),
      raw: raisedCandidate.samples,
      notes: "Most frequent background colour that is neither the page background nor transparent."
    });
    rec.claim("tokens.color.surface.raised", {
      value: raisedCandidate.value,
      status: STATUS.INFERRED,
      evidence: [id],
      sampleSize: raisedCandidate.roles.background,
      agreement: agreementOf(raisedCandidate, backgrounds)
    });
  } else {
    rec.unknown("tokens.color.surface.raised", "No background colour distinct from the page background was observed.");
  }

  if (raisedCandidate) boundColors.add(raisedCandidate.value);

  const secondaryText = texts.find((e) => e.value !== page?.color && !boundColors.has(e.value));
  if (secondaryText) {
    const id = rec.record({
      claim: "tokens.color.text.secondary",
      value: secondaryText.value,
      status: STATUS.INFERRED,
      method: METHOD.FREQUENCY_INFERENCE,
      source: { selector: secondaryText.samples?.[0] ?? null },
      sampleSize: secondaryText.roles.text,
      agreement: agreementOf(secondaryText, texts),
      raw: secondaryText.samples,
      notes: "Most frequent text colour other than the body default."
    });
    rec.claim("tokens.color.text.secondary", {
      value: secondaryText.value,
      status: STATUS.INFERRED,
      evidence: [id],
      sampleSize: secondaryText.roles.text,
      agreement: agreementOf(secondaryText, texts)
    });
  } else {
    rec.unknown(
      "tokens.color.text.secondary",
      "No text colour was observed that is not already bound to the body or brand role."
    );
  }

  // Brand colour: the most-used saturated colour. Genuinely ambiguous from
  // frequency alone, so it is inferred and expected to attract corrections.
  const saturated = saturatedEarly;
  const brand = brandCandidate;
  if (brand) {
    const id = rec.record({
      claim: "tokens.color.brand.primary",
      value: brand.value,
      status: STATUS.INFERRED,
      method: METHOD.FREQUENCY_INFERENCE,
      source: { selector: brand.samples?.[0] ?? null },
      sampleSize: brand.count,
      agreement: agreementOf(brand, saturated),
      raw: brand.samples,
      notes: "Most frequent non-neutral colour. Role assignment cannot be established from frequency alone."
    });
    rec.claim("tokens.color.brand.primary", {
      value: brand.value,
      status: STATUS.INFERRED,
      evidence: [id],
      sampleSize: brand.count,
      agreement: agreementOf(brand, saturated)
    });
  } else {
    rec.unknown("tokens.color.brand.primary", "No non-neutral colour was observed.");
  }

  // CSS borders default to `currentColor`, so any element with a border width
  // contributes its own text colour to this histogram. The extractor tags each
  // entry as authored vs currentColor; only authored ones may become a token.
  const borderEntries = h.borderColor ?? [];
  const authoredBorders = borderEntries.filter(
    (e) => (e.roles?.authored ?? 0) > 0 && !boundColors.has(e.value) && e.value !== page?.color
  );
  const borderColorEntry = topEntry(authoredBorders);

  if (borderColorEntry) {
    const id = rec.record({
      claim: "tokens.color.border.default",
      value: borderColorEntry.value,
      status: STATUS.INFERRED,
      method: METHOD.FREQUENCY_INFERENCE,
      source: { selector: borderColorEntry.samples?.[0] ?? null },
      sampleSize: borderColorEntry.roles.authored,
      agreement: agreementOf(borderColorEntry, authoredBorders),
      raw: borderColorEntry.samples,
      notes: "Observed on an element with an explicit border-style and a colour distinct from its own text colour."
    });
    rec.claim("tokens.color.border.default", {
      value: borderColorEntry.value,
      status: STATUS.INFERRED,
      evidence: [id],
      sampleSize: borderColorEntry.roles.authored,
      agreement: agreementOf(borderColorEntry, authoredBorders)
    });
  } else if (borderEntries.length) {
    rec.unknown(
      "tokens.color.border.default",
      `Every observed border colour resolved to currentColor or a colour already bound to another role (${borderEntries.length} candidate(s) rejected).`
    );
  } else {
    rec.unknown("tokens.color.border.default", "No bordered element was sampled.");
  }

  /* -------------------------------------------------------------- typography */

  if (page?.fontFamily) {
    rec.observe("tokens.typography.body.fontFamily", {
      value: page.fontFamily,
      normalized: { stack: css.fontFamilyStack(page.fontFamily) },
      status: STATUS.OBSERVED,
      method: METHOD.COMPUTED_STYLE,
      source: { selector: "body", element: "body" }
    });
  }

  if (page?.fontSize && page?.lineHeight) {
    const size = css.px(page.fontSize);
    rec.observe("tokens.typography.body.fontSize", {
      value: size,
      unit: "px",
      status: STATUS.OBSERVED,
      method: METHOD.COMPUTED_STYLE,
      source: { selector: "body", element: "body" }
    });
    const lh = css.lineHeight(page.lineHeight, size);
    rec.observe("tokens.typography.body.lineHeight", {
      value: lh.px ?? lh.ratio,
      unit: lh.kind === "length" ? "px" : "ratio",
      status: STATUS.OBSERVED,
      method: METHOD.COMPUTED_STYLE,
      source: { selector: "body", element: "body" }
    });
    rec.observe("tokens.typography.body.fontWeight", {
      value: css.num(page.fontWeight),
      status: STATUS.OBSERVED,
      method: METHOD.COMPUTED_STYLE,
      source: { selector: "body", element: "body" }
    });
  }

  for (const tag of ["h1", "h2", "h3"]) {
    const hit = firstSample(probeIndex, [tag]);
    if (!hit) {
      rec.unknown(`tokens.typography.${tag}`, `No probe sample for <${tag}>.`);
      continue;
    }
    const c = hit.sample.computed ?? {};
    const size = css.px(c.fontSize);
    if (size == null) {
      rec.unknown(`tokens.typography.${tag}.fontSize`, `Font size unreadable for <${tag}>.`);
      continue;
    }
    const source = { selector: hit.sample.selector, element: tag, domPath: hit.sample.domPath };

    rec.observe(`tokens.typography.${tag}.fontSize`, {
      value: size, unit: "px", status: STATUS.OBSERVED, method: METHOD.COMPUTED_STYLE, source
    });

    const lh = css.lineHeight(c.lineHeight, size);
    if (lh.kind !== "unknown") {
      rec.observe(`tokens.typography.${tag}.lineHeight`, {
        value: lh.kind === "ratio" ? lh.ratio : lh.px,
        unit: lh.kind === "ratio" ? "ratio" : "px",
        status: STATUS.OBSERVED, method: METHOD.COMPUTED_STYLE, source
      });
      rec.observe(`tokens.typography.${tag}.lineHeightRatio`, {
        value: lh.ratio, unit: "ratio", status: STATUS.OBSERVED, method: METHOD.COMPUTED_STYLE, source
      });
    }

    const weight = css.num(c.fontWeight);
    if (weight != null) {
      rec.observe(`tokens.typography.${tag}.fontWeight`, {
        value: weight, status: STATUS.OBSERVED, method: METHOD.COMPUTED_STYLE, source
      });
    }

    const ls = css.letterSpacingEm(c.letterSpacing, size);
    if (ls != null) {
      rec.observe(`tokens.typography.${tag}.letterSpacing`, {
        value: ls, unit: "em", status: STATUS.OBSERVED, method: METHOD.COMPUTED_STYLE, source
      });
    }
  }

  const typeRamp = inferTypeRamp(h.fontSize ?? []);
  if (typeRamp.length) {
    const id = rec.record({
      claim: "scales.typeRamp",
      value: typeRamp,
      status: STATUS.INFERRED,
      method: METHOD.FREQUENCY_INFERENCE,
      sampleSize: typeRamp.length,
      agreement: 1,
      notes: "Distinct rendered font sizes, ascending. Includes user-agent defaults, not only authored steps."
    });
    rec.claim("scales.typeRamp", {
      value: typeRamp, unit: "px", status: STATUS.INFERRED, evidence: [id], sampleSize: typeRamp.length
    });
  }

  /* ----------------------------------------------------------------- spacing */

  const spacingEntries = (h.spacing ?? []).map((e) => ({
    ...e,
    value: css.px(e.value) ?? Number.parseFloat(e.value)
  }));

  const verdict = inferSpacingBase(spacingEntries);

  if (!verdict.decided) {
    // Declining to answer is the correct outcome for a page with no rhythm.
    // The observed values are still real and are reported as observations with
    // no scale claim attached to them.
    rec.unknown("scales.spacingBaseUnit", verdict.reason);

    const observed = observedValues(spacingEntries);
    if (observed.length) {
      const id = rec.record({
        claim: "scales.spacingObserved",
        value: observed,
        status: STATUS.OBSERVED,
        method: METHOD.COMPUTED_STYLE,
        sampleSize: observed.length,
        notes:
          "Distinct spacing values as rendered. No base unit was claimed, so these are observations rather than a scale. " +
          (verdict.alternatives?.length
            ? `Best candidates considered: ${verdict.alternatives.map((a) => `${a.base}px@${Math.round(a.coverage * 100)}%`).join(", ")}.`
            : "")
      });
      rec.claim("scales.spacingObserved", {
        value: observed, unit: "px", status: STATUS.OBSERVED, evidence: [id], sampleSize: observed.length
      });
    }
    rec.unknown(
      "scales.spacingRamp",
      "No base unit was established, so no ramp can be derived. See `scales.spacingObserved` for the raw values."
    );
  } else {
    const baseInfo = verdict;
    const id = rec.record({
      claim: "scales.spacingBaseUnit",
      value: baseInfo.base,
      normalized: { px: baseInfo.base, alternatives: baseInfo.alternatives },
      status: STATUS.INFERRED,
      method: METHOD.FREQUENCY_INFERENCE,
      sampleSize: baseInfo.sampleSize,
      agreement: baseInfo.coverage * baseInfo.confidenceFactor,
      raw: spacingEntries.slice(0, 8).map((e) => `${e.value}px`),
      notes:
        `${baseInfo.reason} Alternatives considered: ` +
        `${baseInfo.alternatives.map((a) => `${a.base}px@${Math.round(a.coverage * 100)}%`).join(", ")}.`
    });
    rec.claim("scales.spacingBaseUnit", {
      value: baseInfo.base, unit: "px", status: STATUS.INFERRED, evidence: [id],
      sampleSize: baseInfo.sampleSize, agreement: baseInfo.coverage * baseInfo.confidenceFactor
    });

    const ramp = rampForBase(spacingEntries, baseInfo.base);
    const { onBase, halfSteps } = describeRamp(ramp, baseInfo.base);
    const rampId = rec.record({
      claim: "scales.spacingRamp",
      value: ramp,
      normalized: { onBase, halfSteps },
      status: STATUS.INFERRED,
      method: METHOD.FREQUENCY_INFERENCE,
      sampleSize: ramp.length,
      agreement: baseInfo.coverage,
      notes:
        `${onBase.length} value(s) on the ${baseInfo.base}px base unit` +
        (halfSteps.length ? `, plus ${halfSteps.length} half-step value(s): ${halfSteps.join(", ")}px.` : ".")
    });
    rec.claim("scales.spacingRamp", {
      value: ramp, unit: "px", status: STATUS.INFERRED, evidence: [rampId], sampleSize: ramp.length
    });

    for (const step of ramp) {
      const entry = spacingEntries.find((e) => e.value === step);
      if (!entry) continue;
      const sid = rec.record({
        claim: `tokens.spacing.${step}`,
        value: step,
        normalized: { px: step },
        status: STATUS.OBSERVED,
        method: METHOD.COMPUTED_STYLE,
        source: { selector: entry.samples?.[0] ?? null },
        sampleSize: entry.count,
        agreement: 1,
        raw: entry.samples
      });
      rec.claim(`tokens.spacing.${step}`, {
        value: step, unit: "px", status: STATUS.OBSERVED, evidence: [sid], sampleSize: entry.count
      });
    }
  }

  /* ------------------------------------------------------------------ layout */

  const containers = raw.layout?.containers ?? [];
  const byMaxWidth = new Map();
  for (const c of containers) {
    if (c.maxWidth == null) continue;
    if (!byMaxWidth.has(c.maxWidth)) byMaxWidth.set(c.maxWidth, []);
    byMaxWidth.get(c.maxWidth).push(c);
  }
  // A max-width reused across elements is the strongest container signal, and
  // stays the first choice. But requiring reuse discards the container on any
  // page whose layout width happens to be unique — so a single-occurrence
  // max-width is accepted when the element looks structurally like a container:
  // inside the content region, centred, padded, and not a text-level element.
  const TEXT_LEVEL = /^(p|h[1-6]|span|li|a|blockquote|figcaption|label)\b/;
  const looksStructural = (c) =>
    c.inPrimary &&
    c.centered &&
    (c.paddingLeft ?? 0) > 0 &&
    !TEXT_LEVEL.test(c.selector ?? "");

  const reused = [...byMaxWidth.entries()]
    .filter(([, list]) => list.length >= 2)
    .sort((a, b) => b[0] - a[0]);

  const singles = [...byMaxWidth.entries()]
    .filter(([, list]) => list.length === 1 && looksStructural(list[0]))
    .sort((a, b) => b[0] - a[0]);

  const containerCandidates = reused.length ? reused : singles;

  if (containerCandidates.length) {
    const [maxWidth, list] = containerCandidates[0];
    const sample = list[0];
    const id = rec.record({
      claim: "layout.container.maxWidth",
      value: maxWidth,
      normalized: { px: maxWidth },
      status: STATUS.MEASURED,
      method: METHOD.LAYOUT_RECT,
      source: { selector: sample.selector, domPath: sample.domPath },
      sampleSize: list.length,
      agreement: 1,
      raw: list.map((c) => `${c.selector}@${c.measuredWidth}px`)
    });
    rec.claim("layout.container.maxWidth", {
      value: maxWidth, unit: "px", status: STATUS.MEASURED, evidence: [id], sampleSize: list.length
    });

    const padL = sample.paddingLeft;
    const padR = sample.paddingRight;
    if (padL != null && padL === padR) {
      const pid = rec.record({
        claim: "layout.container.paddingX",
        value: padL,
        normalized: { px: padL },
        status: STATUS.OBSERVED,
        method: METHOD.COMPUTED_STYLE,
        source: { selector: sample.selector, domPath: sample.domPath },
        sampleSize: list.length
      });
      rec.claim("layout.container.paddingX", {
        value: padL, unit: "px", status: STATUS.OBSERVED, evidence: [pid], sampleSize: list.length
      });
    } else {
      rec.unknown("layout.container.paddingX", "Container horizontal padding is asymmetric or unreadable.");
    }
  } else {
    rec.unknown("layout.container.maxWidth", "No max-width was reused across more than one element.");
  }

  const grids = raw.layout?.grids ?? [];
  const primaryGrid = grids
    .slice()
    .sort((a, b) => (b.childCount ?? 0) - (a.childCount ?? 0) || (b.columns ?? 0) - (a.columns ?? 0))[0];
  if (primaryGrid) {
    const cols = primaryGrid.columns ?? css.gridColumnCount(primaryGrid.template);
    if (cols != null) {
      const id = rec.record({
        claim: "layout.grid.primary.columns",
        value: cols,
        status: STATUS.OBSERVED,
        method: METHOD.COMPUTED_STYLE,
        source: { selector: primaryGrid.selector, domPath: primaryGrid.domPath },
        raw: [primaryGrid.template]
      });
      rec.claim("layout.grid.primary.columns", {
        value: cols, status: STATUS.OBSERVED, evidence: [id]
      });
    }
    if (primaryGrid.columnGap != null) {
      const id = rec.record({
        claim: "layout.grid.primary.gap",
        value: primaryGrid.columnGap,
        normalized: { px: primaryGrid.columnGap },
        status: STATUS.OBSERVED,
        method: METHOD.COMPUTED_STYLE,
        source: { selector: primaryGrid.selector, domPath: primaryGrid.domPath }
      });
      rec.claim("layout.grid.primary.gap", {
        value: primaryGrid.columnGap, unit: "px", status: STATUS.OBSERVED, evidence: [id]
      });
    }
    rec.claim("layout.grid.primary.selector", {
      value: primaryGrid.selector, status: STATUS.OBSERVED,
      evidence: [rec.record({
        claim: "layout.grid.primary.selector",
        value: primaryGrid.selector,
        status: STATUS.OBSERVED,
        method: METHOD.STRUCTURAL_INFERENCE,
        source: { selector: primaryGrid.selector }
      })]
    });
  }

  const breakpointRules = raw.breakpointRules ?? [];
  const boundaries = normalizeBreakpoints(breakpointRules);
  if (boundaries.length) {
    const values = boundaries.map((b) => b.value);
    const collapsed = breakpointRules.length - boundaries.length;
    const id = rec.record({
      claim: "layout.breakpoints",
      value: values,
      normalized: { boundaries },
      status: STATUS.OBSERVED,
      method: METHOD.MEDIA_QUERY,
      sampleSize: boundaries.length,
      raw: (raw.mediaQueries ?? []).slice(0, 10),
      notes:
        `Parsed from ${breakpointRules.length} width feature(s) and normalised to ${boundaries.length} boundary/boundaries` +
        (collapsed > 0 ? `; ${collapsed} adjacent max/min pair(s) collapsed into single transitions.` : ".")
    });
    rec.claim("layout.breakpoints", {
      value: values, unit: "px", status: STATUS.OBSERVED, evidence: [id], sampleSize: boundaries.length
    });
    rec.claim("layout.breakpointDetail", {
      value: boundaries, status: STATUS.OBSERVED, evidence: [id], sampleSize: boundaries.length
    });
  } else {
    rec.unknown("layout.breakpoints", "No width-based media queries were reachable.");
  }

  const zEntries = h.zIndex ?? [];
  if (zEntries.length) {
    const layers = [...new Set(zEntries.map((e) => css.num(e.value)).filter((v) => v != null))].sort((a, b) => a - b);
    const id = rec.record({
      claim: "layout.zLayers", value: layers, status: STATUS.OBSERVED,
      method: METHOD.COMPUTED_STYLE, sampleSize: layers.length
    });
    rec.claim("layout.zLayers", { value: layers, status: STATUS.OBSERVED, evidence: [id] });
  }

  /* -------------------------------------------------------- radius & surface */

  const radiusEntries = h.radius ?? [];
  const paintedRadii = radiusEntries.filter((e) => (e.roles?.painted ?? 0) > 0);

  const pill = paintedRadii.find((e) => (css.px(e.value) ?? 0) >= 500);
  if (pill) {
    const id = rec.record({
      claim: "tokens.radius.pill",
      value: css.px(pill.value),
      normalized: { px: css.px(pill.value) },
      status: STATUS.OBSERVED,
      method: METHOD.COMPUTED_STYLE,
      source: { selector: pill.samples?.[0] ?? null },
      sampleSize: pill.count,
      notes: "Radius at or above 500px is a fully-rounded pill rather than a distinct ladder step."
    });
    rec.claim("tokens.radius.pill", {
      value: css.px(pill.value), unit: "px", status: STATUS.OBSERVED, evidence: [id], sampleSize: pill.count
    });
  }

  const ladder = [...new Set(paintedRadii.map((e) => css.px(e.value)).filter((v) => v != null && v < 500))].sort((a, b) => a - b);
  if (ladder.length) {
    const id = rec.record({
      claim: "scales.radiusLadder",
      value: ladder,
      status: STATUS.INFERRED,
      method: METHOD.FREQUENCY_INFERENCE,
      sampleSize: ladder.length,
      notes: "Distinct radii on elements that actually paint a background. Radii on transparent wrappers are excluded."
    });
    rec.claim("scales.radiusLadder", {
      value: ladder, unit: "px", status: STATUS.INFERRED, evidence: [id], sampleSize: ladder.length
    });
  }

  const buttonProbe = firstSample(probeIndex, ["button", ".button"]);
  if (buttonProbe) {
    const r = css.px(buttonProbe.sample.box?.radius?.[0]);
    // A zero radius is the ABSENCE of a radius, not a design decision. Emitting
    // `--radius-button: 0px` instructs an implementer to deliberately square
    // every button on the strength of one sample.
    if (r != null && r > 0) {
      const id = rec.record({
        claim: "tokens.radius.button",
        value: r, normalized: { px: r },
        status: STATUS.OBSERVED, method: METHOD.COMPUTED_STYLE,
        source: { selector: buttonProbe.sample.selector, element: "button", domPath: buttonProbe.sample.domPath },
        sampleSize: buttonProbe.matches
      });
      rec.claim("tokens.radius.button", {
        value: r, unit: "px", status: STATUS.OBSERVED, evidence: [id], sampleSize: buttonProbe.matches
      });
    } else if (r === 0) {
      rec.unknown(
        "tokens.radius.button",
        "The probed button measured 0px radius. Zero is the absence of a radius and is not emitted as a token from a single sample."
      );
    }
    const minH = css.px(buttonProbe.sample.computed?.minHeight) ?? buttonProbe.sample.rect?.height;
    if (minH != null) {
      const id = rec.record({
        claim: "component.button.minHeight",
        value: minH, normalized: { px: minH },
        status: STATUS.MEASURED, method: METHOD.LAYOUT_RECT,
        source: { selector: buttonProbe.sample.selector, element: "button" },
        sampleSize: buttonProbe.matches
      });
      rec.claim("component.button.minHeight", {
        value: minH, unit: "px", status: STATUS.MEASURED, evidence: [id], sampleSize: buttonProbe.matches
      });
    }
  } else {
    rec.unknown("tokens.radius.button", "No button element was probed.");
  }

  /* ------------------------------------------------------- primary component */

  const repeats = raw.repeats ?? [];
  const selection = selectPrimaryRepeat(repeats);
  const primaryRepeat = selection?.repeat ?? null;

  if (selection && selection.quality === "outside-content") {
    rec.note(
      `The primary repeat group \`${primaryRepeat.signature}\` sits in the ${primaryRepeat.region} region, outside the content region. Component claims describe page furniture, not content.`
    );
    rec.unknown(
      "component.card.contentMembership",
      `No repeated component group was found inside the primary content region; \`${primaryRepeat.signature}\` was selected from the ${primaryRepeat.region} region instead.`
    );
  }

  const surface = resolveSurface({ repeat: primaryRepeat, probeIndex, radiusEntries });

  /* ------------------------------------------- the five separated concepts
   *
   * Emitted for every primary repeat, painted or not. Before Phase 3.3 these
   * were one thing — a component was whatever had a surface — so nine of ten
   * unpainted fixtures produced no component at all (def_0023), and a wrapper
   * with a painted child was reported as painting it itself (def_0025).
   *
   * Each is a claim in its own right, with its own evidence, so a reader can
   * see which of the five is weak rather than being handed one number.
   */
  if (primaryRepeat) {
    const probedRoot = firstSample(probeIndex, [
      signatureToSelector(primaryRepeat.signature),
      primaryRepeat.signature
    ]);
    const classified = classifySurface({
      resolved: surface,
      repeat: primaryRepeat,
      probeSample: probedRoot?.sample ?? null
    });

    /* Typography must be read from the COMPONENT, not from the page. Falling
     * back to the page's body font would give every component a typography
     * property for free, and the anatomy guard counts these — a guard that
     * counts a fact about the page as evidence about the component is not a
     * guard. Same for spacing: only a gap the component actually declares. */
    const rootComputed = probedRoot?.sample?.computed ?? {};
    const ownSize = css.px(rootComputed.fontSize ?? null);
    const ownLine = css.px(rootComputed.lineHeight ?? null);
    const ownGap = css.px(rootComputed.gap ?? rootComputed.rowGap ?? null);

    const identity = gatherIdentity(primaryRepeat);
    const nonSurface = gatherNonSurfaceProperties(primaryRepeat, {
      typography: ownSize != null || ownLine != null
        ? {
            fontSize: ownSize,
            lineHeight: ownLine,
            pageFontSize: css.px(raw.page?.fontSize ?? null),
            pageLineHeight: css.px(raw.page?.lineHeight ?? null)
          }
        : null,
      spacing: ownGap != null ? { gap: ownGap } : null
    });

    const surfaceEvidenceId = rec.record({
      claim: "component.card.surfaceClassification",
      value: classified.classification,
      status: classified.classification === SURFACE.UNKNOWN ? STATUS.UNKNOWN
        : surface?.mode === "probe" ? STATUS.MEASURED : STATUS.INFERRED,
      method: surface?.mode === "probe" ? METHOD.COMPUTED_STYLE : METHOD.STRUCTURAL_INFERENCE,
      source: { selector: surface?.selector ?? null, domPath: primaryRepeat.sampleDomPath },
      sampleSize: primaryRepeat.count,
      notes: classified.reason
    });
    rec.claim("component.card.surfaceClassification", {
      value: classified.classification,
      status: classified.classification === SURFACE.UNKNOWN ? STATUS.UNKNOWN : STATUS.OBSERVED,
      evidence: [surfaceEvidenceId],
      sampleSize: primaryRepeat.count
    });

    /* Explicit, and explicitly null when nothing paints. An omitted field reads
     * as "not measured"; `null` here means "measured, and there is none". */
    rec.claim("component.card.surface", {
      value: classified.surface,
      status: classified.surfaceObserved ? STATUS.OBSERVED : STATUS.UNKNOWN,
      evidence: [surfaceEvidenceId],
      sampleSize: primaryRepeat.count
    });

    if (classified.paintedBy && classified.classification === SURFACE.DESCENDANT_PAINTED) {
      const pid = rec.record({
        claim: "component.card.paintedDescendant",
        value: classified.paintedBy,
        status: STATUS.MEASURED,
        method: METHOD.LAYOUT_RECT,
        source: { selector: classified.paintedBy, domPath: surface?.domPath ?? null },
        sampleSize: primaryRepeat.count,
        notes:
          `The component is \`${signatureToSelector(primaryRepeat.signature)}\` and paints nothing itself. ` +
          `\`${classified.paintedBy}\` inside it carries the background, border, radius and shadow. ` +
          "An implementer must put those on the descendant, not on the component."
      });
      rec.claim("component.card.paintedDescendant", {
        value: classified.paintedBy, status: STATUS.MEASURED, evidence: [pid], sampleSize: primaryRepeat.count
      });
    }

    const wrapper = primaryRepeat.parentSelector ?? null;
    if (wrapper) {
      const wid = rec.record({
        claim: "component.card.wrapper",
        value: wrapper,
        status: STATUS.OBSERVED,
        method: METHOD.STRUCTURAL_INFERENCE,
        source: { selector: wrapper, domPath: primaryRepeat.sampleDomPath },
        sampleSize: primaryRepeat.count,
        notes: "The layout container the instances sit in. It is not the component: it occurs once, they occur many times."
      });
      rec.claim("component.card.wrapper", {
        value: wrapper, status: STATUS.OBSERVED, evidence: [wid], sampleSize: primaryRepeat.count
      });
    }

    const iid = rec.record({
      claim: "component.card.identity",
      value: identity.bases.map((b) => b.basis).join(", ") || "none",
      status: identity.sufficient ? STATUS.OBSERVED : STATUS.UNKNOWN,
      method: METHOD.STRUCTURAL_INFERENCE,
      source: { selector: signatureToSelector(primaryRepeat.signature), domPath: primaryRepeat.sampleDomPath },
      sampleSize: primaryRepeat.count,
      notes: identity.sufficient
        ? `Identity established without reference to any painted surface: ${identity.bases.map((b) => b.detail).join("; ")}.`
        : identity.reasons.join("; ")
    });
    rec.claim("component.card.identity", {
      value: {
        bases: identity.bases, rejected: identity.rejected, score: identity.score,
        sufficient: identity.sufficient, reasons: identity.reasons, assessable: identity.assessable !== false,
        incoherent: !!identity.incoherent, isWrapper: !!identity.isWrapper
      },
      status: identity.sufficient ? STATUS.OBSERVED : STATUS.UNKNOWN,
      evidence: [iid],
      sampleSize: primaryRepeat.count
    });

    const nsid = rec.record({
      claim: "component.card.nonSurfaceProperties",
      value: nonSurface.map((p) => p.property).join(", ") || "none",
      status: nonSurface.length ? STATUS.OBSERVED : STATUS.UNKNOWN,
      method: METHOD.STRUCTURAL_INFERENCE,
      source: { selector: signatureToSelector(primaryRepeat.signature), domPath: primaryRepeat.sampleDomPath },
      sampleSize: primaryRepeat.count,
      notes: nonSurface.map((p) => `${p.property}: ${p.detail}`).join("; ") || "No non-surface property could be evidenced."
    });
    rec.claim("component.card.nonSurfaceProperties", {
      value: nonSurface,
      status: nonSurface.length ? STATUS.OBSERVED : STATUS.UNKNOWN,
      evidence: [nsid],
      sampleSize: primaryRepeat.count
    });

    const anatomyVerdict = evaluateAnatomy({
      surfaceObserved: classified.surfaceObserved,
      surfaceClassification: classified.classification,
      nonSurfaceProperties: nonSurface,
      mode: "recreate"
    });
    rec.claim("component.card.anatomyVerdict", {
      value: anatomyVerdict,
      status: STATUS.OBSERVED,
      evidence: [nsid, surfaceEvidenceId],
      sampleSize: primaryRepeat.count
    });

    if (!classified.surfaceObserved) {
      rec.note(
        `No painted surface was observed on \`${signatureToSelector(primaryRepeat.signature)}\`. ` +
        "This is a finding, not a gap: prompts must state the absence and must not invent a background, border, radius or shadow."
      );
    }
  }

  if (surface) {
    const source = { selector: surface.selector, domPath: surface.domPath };
    const sampleSize = surface.matches ?? primaryRepeat.count;

    if (surface.borderRadius === 0) {
      rec.unknown(
        "component.card.borderRadius",
        "The primary component's painted surface measured a 0px radius. Zero is the absence of a radius and is not emitted as a token."
      );
    } else if (surface.borderRadius != null) {
      const id = rec.record({
        claim: "component.card.borderRadius",
        value: surface.borderRadius,
        normalized: { px: surface.borderRadius },
        status: surface.status,
        method: surface.method,
        source,
        sampleSize,
        agreement: 1,
        notes: surface.caveat ??
          (surface.isRoot
            ? "The repeat root paints its own background; radius read from it directly."
            : `Radius read from ${surface.selector}, the innermost descendant that paints a background. The repeat root ${surface.rootSelector} is transparent.`)
      });
      rec.claim("component.card.borderRadius", {
        value: surface.borderRadius, unit: "px", status: surface.status, evidence: [id], sampleSize
      });
    } else {
      rec.unknown("component.card.borderRadius", "No border radius could be attributed to the primary repeat group.");
    }

    if (surface.padding) {
      const pads = surface.padding.split(/\s+/).map((p) => css.px(p)).filter((p) => p != null);
      const uniform = pads.length === 4 && pads.every((p) => p === pads[0]);
      if (uniform) {
        const id = rec.record({
          claim: "component.card.padding",
          value: pads[0], normalized: { px: pads[0] },
          status: surface.status, method: surface.method, source, sampleSize
        });
        rec.claim("component.card.padding", {
          value: pads[0], unit: "px", status: surface.status, evidence: [id], sampleSize
        });
      } else if (pads.length === 4) {
        /* A four-sided padding is as measured as a uniform one; it simply does
         * not fit in a single number. Until now the `uniform` test had no else
         * branch, so `16px 24px 16px 24px` was read off the page and then
         * dropped without even an `unknown` to mark its passing — unlike the
         * radius above, which records why it could not be attributed. The
         * primary component of stripe.com/pricing lost a property that way.
         *
         * Emitted as the collapsed CSS shorthand rather than an object: the
         * value is pasteable as-is, and `formatValue` renders any object as
         * "[object Object]". The four sides travel in `normalized` for anything
         * that needs them separately. */
        const [top, right, bottom, left] = pads;
        const shorthand =
          top === bottom && right === left ? `${top}px ${right}px`
          : right === left ? `${top}px ${right}px ${bottom}px`
          : `${top}px ${right}px ${bottom}px ${left}px`;

        const id = rec.record({
          claim: "component.card.padding",
          value: shorthand,
          normalized: { top, right, bottom, left },
          status: surface.status, method: surface.method, source, sampleSize
        });
        rec.claim("component.card.padding", {
          value: shorthand, unit: null, status: surface.status, evidence: [id], sampleSize
        });
      } else {
        rec.unknown(
          "component.card.padding",
          `The primary component's padding read as "${surface.padding}", which did not resolve to four sides.`
        );
      }
    }

    if (surface.background) {
      const id = rec.record({
        claim: "component.card.background",
        value: surface.background, status: surface.status, method: surface.method, source, sampleSize
      });
      rec.claim("component.card.background", {
        value: surface.background, status: surface.status, evidence: [id], sampleSize
      });
    }

    if (surface.boxShadow) {
      const parsed = css.shadow(surface.boxShadow);
      const canonical = css.shadowToCss(parsed);
      const id = rec.record({
        claim: "tokens.elevation.card",
        value: canonical, normalized: parsed,
        status: surface.status, method: surface.method, source, sampleSize,
        raw: [surface.boxShadow]
      });
      rec.claim("tokens.elevation.card", {
        value: canonical, status: surface.status, evidence: [id], sampleSize
      });
    }

    // A zero-width border is no border. Emitting `0px solid <colour>` as a
    // token propagates a border that does not exist.
    if (surface.borderWidth != null && surface.borderWidth > 0 && surface.borderColor) {
      const value = `${surface.borderWidth}px solid ${surface.borderColor}`;
      const id = rec.record({
        claim: "tokens.border.default",
        value, normalized: { width: surface.borderWidth, color: surface.borderColor },
        status: surface.status, method: surface.method, source, sampleSize
      });
      rec.claim("tokens.border.default", { value, status: surface.status, evidence: [id], sampleSize });
    } else if (surface.borderWidth === 0) {
      rec.unknown(
        "tokens.border.default",
        "The primary component's surface has a zero-width border. Zero is the absence of a border and is not emitted as a token."
      );
    }

    const cid = rec.record({
      claim: "component.card.instanceCount",
      value: primaryRepeat.count,
      status: STATUS.MEASURED, method: METHOD.LAYOUT_RECT,
      source: { selector: surface.rootSelector, domPath: primaryRepeat.sampleDomPath },
      sampleSize: primaryRepeat.count
    });
    rec.claim("component.card.instanceCount", {
      value: primaryRepeat.count, status: STATUS.MEASURED, evidence: [cid], sampleSize: primaryRepeat.count
    });

    rec.claim("component.card.selector", {
      value: surface.rootSelector, status: STATUS.OBSERVED,
      evidence: [rec.record({
        claim: "component.card.selector", value: surface.rootSelector,
        status: STATUS.OBSERVED, method: METHOD.STRUCTURAL_INFERENCE,
        source: { selector: surface.rootSelector }
      })]
    });

    // A class selector with no identity-bearing name in it is unusable, for one
    // of two reasons. Build-generated names are true today and gone after the
    // next deploy. Utility names survive deploys but describe presentation, so
    // they are shared by unrelated elements and change whenever the design does.
    // The note must say which, because the two call for different advice
    // (def_0018); saying "build-generated" of `.group.relative` is simply wrong.
    const profile = primaryRepeat.classProfile ?? { hashed: 0, utility: 0, total: 0 };
    const unusableReason =
      profile.hashed > profile.utility
        ? {
            kind: "build-generated",
            detail:
              `${profile.hashed} of ${profile.total} classes on this element are build-generated. ` +
              "This structural selector is stable across deploys; the class selector is not."
          }
        : {
            kind: "presentational",
            detail:
              `${profile.utility} of ${profile.total} classes on this element are utility classes. ` +
              "They name spacing, colour and layout rather than identity, are shared with unrelated " +
              "elements, and change whenever the design changes. This structural selector does not."
          };

    /* Emitted when the class selector carries too little identity to be worth
     * reading, whatever the reason for that.
     *
     * The condition used to be `namesAreGenerated`, which is true only when NO
     * class is readable — right for hashed build output and wrong for a
     * utility-first site, where every class reads fine in isolation and the
     * nineteen of them joined together do not. produx.design's card scored
     * `{ total: 19, readable: 1, utility: 18, hashed: 0 }`, so the claim was
     * skipped and every human-facing surface fell back to 326 escaped
     * characters while a 122-character structural selector sat unused on the
     * repeat group (def_0054).
     *
     * Counting instead: identity-bearing names outnumbered by names that
     * describe presentation or come from a build. `div.card__inner` has
     * `readable: 1, utility: 0, hashed: 0` and keeps its class selector; a
     * hashed name has `readable: 0` and loses it. A capture predating
     * `classProfile` leaves these undefined, the comparison is false, and
     * nothing changes for it. */
    const identityBearing = profile.readable ?? 0;
    const nonIdentity = (profile.utility ?? 0) + (profile.hashed ?? 0);
    const classSelectorUnusable = nonIdentity > 0 && identityBearing < nonIdentity;

    if (classSelectorUnusable && primaryRepeat.stableSelector) {
      const sid = rec.record({
        claim: "component.card.stableSelector",
        value: primaryRepeat.stableSelector,
        status: STATUS.OBSERVED,
        method: METHOD.STRUCTURAL_INFERENCE,
        source: { selector: surface.rootSelector, domPath: primaryRepeat.sampleDomPath },
        notes: unusableReason.detail
      });
      rec.claim("component.card.stableSelector", {
        value: primaryRepeat.stableSelector, status: STATUS.OBSERVED, evidence: [sid]
      });
      rec.claim("component.card.selectorUnusableReason", {
        value: unusableReason.kind, status: STATUS.OBSERVED, evidence: [sid]
      });
      rec.note(
        `Class names on \`${surface.rootSelector}\` are ${unusableReason.kind}. ` +
        "Prompts must use the structural selector, not the class."
      );
    }

    if (surface.mode === "aggregate") {
      rec.note(`Component surface for ${surface.rootSelector} resolved without probe data; treat surface claims as inferred.`);
    }
  } else {
    rec.unknown("component.card", "No repeat group with three or more instances was detected.");
  }

  /* ------------------------------------------------------------------ motion */

  const durEntry = topEntry(h.transitionDuration ?? []);
  if (durEntry) {
    const ms = css.durationMs(durEntry.value);
    if (ms != null) {
      const id = rec.record({
        claim: "tokens.motion.base.duration",
        value: ms, normalized: { ms },
        status: STATUS.OBSERVED, method: METHOD.COMPUTED_STYLE,
        source: { selector: durEntry.samples?.[0] ?? null },
        sampleSize: durEntry.count,
        agreement: agreementOf(durEntry, h.transitionDuration),
        raw: durEntry.samples
      });
      rec.claim("tokens.motion.base.duration", {
        value: ms, unit: "ms", status: STATUS.OBSERVED, evidence: [id],
        sampleSize: durEntry.count, agreement: agreementOf(durEntry, h.transitionDuration)
      });
    }
  } else {
    rec.unknown("tokens.motion.base.duration", "No non-zero transition durations were observed.");
  }

  const easeEntry = topEntry(h.transitionEasing ?? []);
  if (easeEntry) {
    const id = rec.record({
      claim: "tokens.motion.base.easing",
      value: easeEntry.value,
      status: STATUS.OBSERVED, method: METHOD.COMPUTED_STYLE,
      source: { selector: easeEntry.samples?.[0] ?? null },
      sampleSize: easeEntry.count,
      agreement: agreementOf(easeEntry, h.transitionEasing),
      raw: easeEntry.samples
    });
    rec.claim("tokens.motion.base.easing", {
      value: easeEntry.value, status: STATUS.OBSERVED, evidence: [id],
      sampleSize: easeEntry.count, agreement: agreementOf(easeEntry, h.transitionEasing)
    });
  }

  if (raw.keyframes?.length) {
    const id = rec.record({
      claim: "motion.keyframes", value: raw.keyframes,
      status: STATUS.OBSERVED, method: METHOD.STYLESHEET_RULE, sampleSize: raw.keyframes.length
    });
    rec.claim("motion.keyframes", { value: raw.keyframes, status: STATUS.OBSERVED, evidence: [id] });
  }

  /* -------------------------------------------------- declared motion (M1) */

  /**
   * Motion as the stylesheets DECLARE it.
   *
   * Everything recorded here is `observed`: read from a declared style, not
   * measured off geometry and not derived from a pattern. That is the whole of
   * what a single capture can support.
   *
   * What is deliberately never recorded, because a capture cannot see it:
   *
   *   - what TRIGGERS an animation. A declaration says an element has one, not
   *     that anything ever starts it.
   *   - STAGGER. Two elements with different delays may be a staggered sequence
   *     or two unrelated rules; the difference is intent, and intent is not a
   *     CSS property.
   *   - SCROLL-LINKAGE. Nothing in computed style distinguishes an animation
   *     driven by scroll from one driven by a class toggle.
   *
   * Each of those needs multi-sample capture to earn, and none is guessed here.
   */
  const declaredMotion = Array.isArray(raw.motion?.declared) ? raw.motion.declared : [];

  if (raw.motion) {
    rec.claim("motion.declaredCount", {
      value: raw.motion.declaredTotal ?? declaredMotion.length, unit: null, status: STATUS.OBSERVED,
      evidence: [rec.record({
        claim: "motion.declaredCount",
        value: raw.motion.declaredTotal ?? declaredMotion.length,
        status: STATUS.OBSERVED, method: METHOD.COMPUTED_STYLE,
        source: { selector: "*" },
        notes: raw.motion.truncated
          ? `${raw.motion.declaredTotal} element(s) declare motion; the first ${declaredMotion.length} were recorded.`
          : "Every element declaring motion was recorded."
      })]
    });

    if (raw.motion.truncated) {
      rec.unknown("motion.declared.complete",
        `${raw.motion.declaredTotal} elements declare motion and the capture kept the first ${declaredMotion.length}. The list is a sample, not the whole of it.`);
    }
  }

  declaredMotion.forEach((m, i) => {
    const base = `motion.declared.${i}`;
    const source = { selector: m.selector };

    const put = (leaf, value, notes) => {
      if (value === null || value === undefined || value === "") return;
      rec.observe(`${base}.${leaf}`, {
        value, status: STATUS.OBSERVED, method: METHOD.COMPUTED_STYLE, source, notes
      });
    };

    put("region", m.region, "Which page region the element sits in.");

    put("animationName", m.animationName,
      "A declared animation name. It does NOT mean the animation runs, and says nothing about what would start it.");
    put("animationDuration", m.animationDuration, "Declared duration.");
    put("animationDelay", m.animationDelay,
      "Declared delay. A delay is not a stagger — that would require knowing these elements form one sequence, which a stylesheet does not say.");
    put("animationTimingFunction", m.animationTimingFunction, "Declared easing.");
    put("animationIterationCount", m.animationIterationCount, "Declared iteration count.");
    put("animationFillMode", m.animationFillMode, "Declared fill mode.");
    put("animationDirection", m.animationDirection, "Declared direction.");
    put("animationPlayState", m.animationPlayState, "Declared play state at capture time.");

    put("transitionProperty", m.transitionProperty, "Which properties are declared to transition.");
    put("transitionDuration", m.transitionDuration, "Declared transition duration.");
    put("transitionDelay", m.transitionDelay, "Declared transition delay.");
    put("transitionTimingFunction", m.transitionTimingFunction, "Declared transition easing.");

    put("transform", m.transform,
      "The transform in effect at capture. A static transform is a layout fact; it is not evidence that anything animates it.");
    put("willChange", m.willChange, "A compositing hint the author declared.");
    put("filter", m.filter, "A declared filter.");
    put("backdropFilter", m.backdropFilter, "A declared backdrop filter — the glass effect a rebuild reproduces.");
  });

  /* ------------------------------------------------------- keyframe bodies */

  const keyframeDetail = Array.isArray(raw.keyframeDetail) ? raw.keyframeDetail : [];
  const readable = keyframeDetail.filter((k) => k.readable && k.steps?.length);

  if (readable.length) {
    rec.claim("motion.keyframeDetail", {
      value: readable.map((k) => k.name), unit: null, status: STATUS.OBSERVED,
      evidence: [rec.record({
        claim: "motion.keyframeDetail",
        value: readable.map((k) => `${k.name} (${k.steps.length} step(s))`),
        status: STATUS.OBSERVED, method: METHOD.STYLESHEET_RULE,
        sampleSize: readable.length,
        notes: "Keyframe rule bodies read from same-origin stylesheets."
      })]
    });

    readable.forEach((k, i) => {
      rec.observe(`motion.keyframeDetail.${i}.name`, {
        value: k.name, status: STATUS.OBSERVED, method: METHOD.STYLESHEET_RULE,
        source: { selector: `@keyframes ${k.name}` }
      });
      rec.observe(`motion.keyframeDetail.${i}.steps`, {
        value: k.steps.map((s) => s.offset).filter(Boolean),
        status: STATUS.OBSERVED, method: METHOD.STYLESHEET_RULE,
        source: { selector: `@keyframes ${k.name}` },
        notes: "The offsets each step declares."
      });
      /* The declarations, flattened to `property: value` strings so the claim
       * value stays a scalar-or-array as the schema requires. */
      const declarations = k.steps.flatMap((s) =>
        Object.entries(s.declarations ?? {}).map(([prop, value]) => `${s.offset ?? "?"} ${prop}: ${value}`));
      if (declarations.length) {
        rec.observe(`motion.keyframeDetail.${i}.declarations`, {
          value: declarations, status: STATUS.OBSERVED, method: METHOD.STYLESHEET_RULE,
          source: { selector: `@keyframes ${k.name}` }
        });
      }
    });
  } else if (raw.keyframes?.length) {
    rec.unknown("motion.keyframeDetail",
      `${raw.keyframes.length} keyframe rule(s) were named but no rule body was readable. The names are known; what they animate is not.`);
  }

  /* --------------------------------------------- unreadable stylesheets */

  /* A blocked sheet is the reason motion evidence is incomplete far more often
   * than an absence of motion is. Recorded against motion specifically, because
   * the general coverage note does not tell a reader that the animation section
   * is thin BECAUSE the sheets that declare it could not be opened. */
  const blocked = raw.coverage?.sheetsBlocked ?? [];
  if (blocked.length) {
    rec.unknown("motion.declared.completeness",
      `${blocked.length} stylesheet(s) could not be read (cross-origin or blocked by policy). Any animation or transition they declare is absent from this capture, and its absence here is not evidence that it does not exist.`);
  }

  /* ------------------------------------------------------- runtime sample */

  const running = raw.motion?.running;
  if (Array.isArray(running) && running.length) {
    rec.claim("motion.runningAtCapture", {
      value: running.length, unit: null, status: STATUS.OBSERVED,
      evidence: [rec.record({
        claim: "motion.runningAtCapture", value: running.length,
        status: STATUS.OBSERVED, method: METHOD.COMPUTED_STYLE,
        source: { selector: "document.getAnimations()" },
        sampleSize: running.length,
        notes: "Animations in flight at the instant of capture. A sample: one that finished earlier is invisible, and one that is running says nothing about what started it."
      })]
    });
  } else if (running === null) {
    rec.unknown("motion.runningAtCapture",
      "The browser did not expose document.getAnimations(), so what was running at capture is unknown.");
  }

  /* ------------------------------------- observed runtime motion (M2c) */

  /**
   * The M2a artifact, carried into evidence.
   *
   * Kept strictly after declared motion and strictly separate from it: what a
   * stylesheet SAYS and what a page was seen to DO are different claims with
   * different provenance, and merging them here would make them
   * indistinguishable everywhere downstream.
   *
   * `motionArtifactState` always exists, even when nothing was loaded, so the
   * IR can say WHY there is no observed motion rather than leaving a reader to
   * infer it from an empty list. An absent capture and a refused one are not
   * the same statement.
   */
  const motionState = options.motionArtifactState ?? null;
  const motionArtifact = options.motionArtifact ?? null;

  let observedMotion = { runtime: [], triggers: { verified: [], unverified: [] }, controls: [] };
  if (motionState?.valid && motionArtifact) {
    observedMotion = recordMotionObservations(rec, motionArtifact, {
      sourceFile: options.motionArtifactFile ?? null
    });
  } else if (motionState && motionState.state !== "absent") {
    /* Refused or invalid. Recorded as a gap so it reaches the prompt's
     * limitations rather than vanishing. */
    rec.unknown("motion.observed", motionState.reason);
  }

  /* ------------------------------------------------------------------ assets */

  /**
   * Media elements, as measured.
   *
   * The extractor has always collected these and nothing downstream read them,
   * so every prompt's assets section was prohibition text with no facts in it.
   * They are ordinary claims: one record per fact, per element, each carrying
   * the status its source can support.
   *
   * The status split is the point:
   *
   *   - the rendered box is `measured`     — read off layout geometry
   *   - `objectFit` is `observed`          — read from a declared style
   *   - alt PRESENCE is `observed`         — an attribute that is there or not
   *   - intrinsic size is `measured` when the element exposed it, and `unknown`
   *     when it did not. It is never back-filled from the rendered box: those
   *     are different quantities, and an image scaled to 200px in a 400px box
   *     would otherwise be recorded as being 400px wide.
   *
   * Alt TEXT is deliberately never recorded — only whether the attribute
   * exists. The text is page content and belongs to the reference's author.
   */
  /* `enumerated` and `media.length` answer different questions, and the section
   * that renders this says different things about them.
   *
   * A DOM capture always carries an `images` array, so a zero-length one is a
   * MEASUREMENT of zero — the extractor walked the document and found no media.
   * That is a fact about the reference. A capture with no array at all never
   * enumerated anything, and the count is genuinely unknown.
   *
   * Recording the first case as unknown would have made "this page has no
   * images" indistinguishable from "nobody looked", which is the distinction
   * the whole evidence model exists to preserve. Zero here is a reading, not
   * an absence of one. */
  const enumerated = Array.isArray(raw.images);
  const media = enumerated ? raw.images : [];

  if (enumerated) {
    rec.claim("assets.count", {
      value: media.length, unit: null, status: STATUS.MEASURED,
      evidence: [rec.record({
        claim: "assets.count", value: media.length, status: STATUS.MEASURED,
        method: METHOD.LAYOUT_RECT, source: { selector: "img,picture,video" },
        notes: media.length
          ? "Count of media elements found in the capture."
          : "The document was walked and no img, picture or video element was found. Zero is the reading, not a gap."
      })]
    });
  }

  if (media.length) {
    media.forEach((img, i) => {
      const base = `assets.items.${i}`;
      const source = { selector: img.selector, element: img.tag };

      const put = (leaf, value, status, method, notes) => {
        if (value === null || value === undefined || value === "") return;
        rec.observe(`${base}.${leaf}`, { value, status, method, source, notes });
      };

      put("tag", img.tag, STATUS.OBSERVED, METHOD.COMPUTED_STYLE,
        "The element's own tag name.");
      put("region", img.region, STATUS.OBSERVED, METHOD.STRUCTURAL_INFERENCE,
        "Which page region the element was found in.");
      put("renderedWidth", img.width, STATUS.MEASURED, METHOD.LAYOUT_RECT,
        "Rendered box width, from the layout rect.");
      put("renderedHeight", img.height, STATUS.MEASURED, METHOD.LAYOUT_RECT,
        "Rendered box height, from the layout rect.");
      put("aspectRatio", img.aspectRatio, STATUS.MEASURED, METHOD.LAYOUT_RECT,
        "Declared aspect-ratio where set, otherwise the rendered ratio.");
      put("objectFit", img.objectFit, STATUS.OBSERVED, METHOD.COMPUTED_STYLE,
        "How the media fills its box.");

      /* Intrinsic size: recorded when the element exposed it, reported as a gap
       * when it did not. A capture taken before the extractor collected these
       * fields lands here, which is correct — it did not measure them. */
      if (img.naturalWidth && img.naturalHeight) {
        put("intrinsicWidth", img.naturalWidth, STATUS.MEASURED, METHOD.LAYOUT_RECT,
          "The media's own pixel width, from the element.");
        put("intrinsicHeight", img.naturalHeight, STATUS.MEASURED, METHOD.LAYOUT_RECT,
          "The media's own pixel height, from the element.");
      } else {
        rec.unknown(`${base}.intrinsicWidth`,
          `${img.selector}: the element did not expose an intrinsic size. It is not inferred from the rendered box — those are different quantities.`);
      }

      /* Presence, never the text. */
      if (img.hasAlt !== null && img.hasAlt !== undefined) {
        put("hasAlt", img.hasAlt, STATUS.OBSERVED, METHOD.COMPUTED_STYLE,
          "Whether an alt attribute is present. Its text is not recorded — that is the reference's content.");
      } else if (img.tag === "img") {
        rec.unknown(`${base}.hasAlt`, `${img.selector}: alt presence was not determined.`);
      }
    });
  } else if (!enumerated) {
    /* Only when nothing was enumerated. A capture that walked the document and
     * found nothing already recorded that as a measured zero above. */
    rec.unknown("assets.count",
      "This capture did not enumerate media elements, so the count is unknown rather than zero.");
  }

  /* --------------------------------------------------- honest gap reporting */

  rec.unknown("states.hover", "Phase 0 captures the default state only; hover effects are declared but not observed.");
  rec.unknown("states.focusVisible", "Focus-visible styles are declared in CSS but were not induced or captured.");
  rec.unknown("responsive.behaviour", "Phase 0 captures a single viewport; per-breakpoint behaviour is not measured.");

  for (const blocked of raw.coverage?.sheetsBlocked ?? []) {
    rec.unknown(`source.stylesheet:${blocked}`, "Stylesheet was unreachable (cross-origin); its rules are not represented.");
  }

  return {
    $schemaVersion: EVIDENCE_SCHEMA_VERSION,
    referenceId,
    generatedAt: new Date().toISOString(),
    mode,
    records: rec.records,
    claims: rec.claims,
    unknowns: rec.unknowns,
    notes: rec.notes,
    /* Carried beside the claims rather than inside them: these are grouped
     * views over records that already exist, and duplicating them as claims
     * would give the same fact two homes. */
    observedMotion,
    motionArtifactState: motionState
  };
}


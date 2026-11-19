/**
 * Provenance-aware observation: many looks at one page, each knowing where and
 * when it looked.
 *
 * Everything before this stage assumed one settled viewport was the page. That
 * assumption is what limits the tool to describing a single component: a page
 * whose sections mount on scroll is, to a single-settled capture, a page with
 * one section. Measured on a real site, the whole document below the fold was
 * either absent or hidden at the moment of extraction, and the analysis honestly
 * reported almost nothing — because almost nothing had been looked at.
 *
 * So an observation stops being "the page" and becomes "what was visible at
 * scrollY 2700, at this viewport, at this instant, on this URL". A property read
 * from one of those may support only the claims that provenance can carry.
 *
 * THREE AXES, KEPT APART. The project already separates how well a value was
 * read (`STATUS`) from how much of the page was reachable (coverage) from how
 * much was visible at all (observability). Provenance is a fourth and it is
 * orthogonal to all three: a `measured` value can be scroll-revealed, and a
 * scroll-revealed value can be perfectly measured. Collapsing them would lose
 * exactly the distinction this stage exists to record.
 *
 * WHAT THIS STAGE MUST NOT DO. It does not decide sufficiency, does not gate,
 * and does not merge anything across viewports — 1440, 768 and 375 are three
 * separate pages as far as this module is concerned, and a caller that combined
 * them would be inventing a page nobody rendered.
 */

/**
 * Where an observation came from. A claim may only rest on provenance that can
 * support it, which `claimSupportedBy` below makes checkable rather than
 * customary.
 */
export const OBSERVATION_KIND = Object.freeze({
  /** Visible without any interaction, at the top of the page, after settling. */
  INITIAL: "initial-state",
  /** Became visible because the page was scrolled. Not absent — revealed. */
  SCROLL_REVEALED: "scroll-revealed",
  /** Required an interaction that was safe to induce (hover, expand, open). */
  INTERACTION: "interaction-state"
});

/**
 * What a claim needs from the observation that supports it.
 *
 * The rule this encodes: a value seen only after scrolling cannot support a
 * claim about what a visitor sees on arrival, and a value seen only after an
 * interaction cannot support a claim about the resting state. Both are true
 * observations; neither is true of the thing the claim describes.
 */
export const CLAIM_SCOPE = Object.freeze({
  /** "What the page looks like on arrival." */
  ABOVE_FOLD: "above-fold",
  /** "What the page contains anywhere, at rest." */
  RESTING_PAGE: "resting-page",
  /** "How the page behaves when acted upon." */
  INTERACTED: "interacted"
});

const SUPPORTS = Object.freeze({
  [CLAIM_SCOPE.ABOVE_FOLD]: [OBSERVATION_KIND.INITIAL],
  [CLAIM_SCOPE.RESTING_PAGE]: [OBSERVATION_KIND.INITIAL, OBSERVATION_KIND.SCROLL_REVEALED],
  [CLAIM_SCOPE.INTERACTED]: [OBSERVATION_KIND.INTERACTION]
});

/** Whether an observation's provenance can carry a claim of this scope. */
export function claimSupportedBy(kind, scope) {
  return (SUPPORTS[scope] ?? []).includes(kind);
}

/**
 * WHERE THE PAGE WAS when an observation was taken — a separate axis from
 * `OBSERVATION_KIND`.
 *
 * `kind` answers "may this evidence support an above-fold claim". This answers
 * "what physical state was the page in", and the two are not the same question:
 * a region seen at the top BEFORE any scrolling and the same region seen at the
 * top AFTER the sweep are both at scrollY 0, and only the first describes what
 * a visitor meets on arrival. A page whose sections animate in on scroll and
 * animate back out at the top produces different geometry in those two states,
 * and averaging them would invent a layout that never rendered.
 */
export const SCROLL_STATE = Object.freeze({
  /** At the top, before the sweep began. The only state that can carry the fold. */
  INITIAL: "initial",
  /** Held at a scroll offset during the sweep. */
  DURING_SCROLL: "during-scroll",
  /** Back at the top after the sweep, with whatever the scroll left behind. */
  AFTER_RETURN: "after-return"
});

/** Bounds. Discovery is bounded in time, distance and states, never open-ended. */
export const OBSERVE_BUDGET = Object.freeze({
  maxObservations: 24,
  maxScrollDistanceCss: 60_000,
  maxMs: 45_000,
  maxStates: 8,
  /**
   * Fraction of the viewport each step re-covers.
   *
   * Without overlap a section straddling a step boundary is never wholly
   * visible in any single observation, and its geometry is measured from two
   * partial views that agree about nothing. A quarter-viewport overlap costs
   * one extra step per three and removes that class of error.
   */
  overlapRatio: 0.25,
  dwellMs: 140
});

/**
 * The scroll positions to observe from.
 *
 * Viewport-sized steps reduced by the overlap, always including 0, always
 * including the last reachable position so the foot of the page is observed
 * whole rather than clipped. Distance is capped: an infinite-scroll page must
 * terminate, and it terminates by budget rather than by hope.
 */
export function scrollPlan({
  documentHeight, viewportHeight,
  overlapRatio = OBSERVE_BUDGET.overlapRatio,
  maxScrollDistanceCss = OBSERVE_BUDGET.maxScrollDistanceCss,
  maxObservations = OBSERVE_BUDGET.maxObservations
} = {}) {
  const vh = Math.max(1, Number(viewportHeight) || 0);
  const doc = Math.max(0, Number(documentHeight) || 0);
  const maxY = Math.max(0, Math.min(doc - vh, maxScrollDistanceCss));
  const step = Math.max(1, Math.round(vh * (1 - Math.min(0.9, Math.max(0, overlapRatio)))));

  const positions = [];
  for (let y = 0; y <= maxY && positions.length < maxObservations; y += step) positions.push(Math.round(y));
  if (maxY > 0 && positions.at(-1) !== maxY && positions.length < maxObservations) positions.push(Math.round(maxY));

  return {
    positions,
    step,
    maxY,
    /* Stated so a reader can tell "the page ended" from "the budget ended" —
     * the difference between a complete sweep and a truncated one. */
    truncated: doc - vh > maxScrollDistanceCss || positions.length >= maxObservations
  };
}

/**
 * The page-side region survey.
 *
 * Records what a region IS, what it LOOKS LIKE, and where it SITS, from computed
 * style and rendered geometry only. Nothing here reads authored CSS, guesses a
 * value, or fills a gap: a property that could not be read is absent from the
 * record, and absence is resolved to `unknown` one layer up rather than to a
 * default here.
 *
 * FOUR CONSTRAINTS SHAPE IT.
 *
 * 1. **It never descends past a hidden ancestor.** A flat scan judges each node
 *    alone, and `opacity: 0` or `content-visibility: hidden` on a wrapper leaves
 *    every descendant's own style innocent and its rect non-zero — which is how
 *    an earlier version of the mount snapshot reported 699 visible nodes where
 *    the extractor saw 3. The ancestor walk is the fix, and it is why this is not
 *    a `querySelectorAll` filter.
 *
 * 2. **It leaks nothing.** The recorded URL is stripped of query, fragment and
 *    userinfo before it is written, asset sources are reduced to origin and path,
 *    and form field VALUES are never read at all — only the field's type and
 *    whether it is populated. A capture artifact is a file that gets copied
 *    around; anything sensitive in it stays sensitive forever.
 *
 * 3. **It is bounded.** Text is truncated, headings and assets are capped per
 *    region. An unbounded survey of a large page produces an artifact nobody can
 *    open, which is a different way of learning nothing.
 *
 * 4. **A failure to read is recorded, not thrown and not invented.** Cross-origin
 *    frames, detached nodes and exotic style objects all fail in the middle of a
 *    survey; each becomes a diagnostic against the region it happened on.
 */
export const REGION_SURVEY = () => {
  const TEXT_CAP = 240;
  const HEADING_CAP = 12;
  const ASSET_CAP = 12;
  const NAME_CAP = 120;
  /* Visual candidates are bounded per region for the same reason assets are:
   * one pathological section must not be able to grow the artifact without
   * limit. Higher than ASSET_CAP because a feature section legitimately holds
   * several painted interiors. */
  const VISUAL_CAP = 16;
  /* How many elements the painted-panel walk may look at per region. Paint can
   * only be found by reading computed style, so this bounds that cost. */
  const VISUAL_NODE_BUDGET = 400;

  const diagnostics = [];
  const note = (where, what, reason) => {
    if (diagnostics.length < 40) diagnostics.push({ where, what, reason: String(reason).slice(0, 160) });
  };

  const bounded = (value, cap) => {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > cap ? `${text.slice(0, cap)}…` : text;
  };

  /**
   * Elements whose `textContent` is code or inert markup, never rendered copy.
   *
   * `textContent` on a wrapper concatenates EVERY descendant text node,
   * including the body of an inline `<script>`. Measured on a real site, the
   * outermost region's recorded "copy" began
   * `((e,t,n,r,i,a,o,s)=>{let c=document.documentElement…` — a theme-switcher
   * script, captured as if a visitor could read it. A `<template>` is parsed
   * but never rendered; a `<noscript>` is rendered only when scripting is off,
   * which is not the state this capture observed.
   */
  const NON_RENDERED_TAGS = ["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME", "OBJECT", "EMBED"];

  /** Displays that flow inline, so adjacent text joins without a separator. */
  const INLINE_DISPLAYS = ["inline", "inline-block", "inline-flex", "inline-grid", "contents", "ruby", "ruby-text"];

  /** Bounded like every other walk in this module: a wrapper can hold a whole document. */
  const TEXT_NODE_BUDGET = 800;

  /**
   * Whether an element contributes no rendered text — decided without a rect.
   *
   * Deliberately cheaper than `hiddenReason`: this runs per descendant during
   * a text walk, where a `getBoundingClientRect` per node would dominate the
   * capture. Display, visibility, `aria-hidden`, `hidden`, `inert` and
   * `content-visibility` are the ways responsive duplicate markup is actually
   * suppressed, and they are all readable from computed style alone.
   */
  const hiddenForText = (el, cs) => {
    if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return true;
    if (el.hasAttribute && (el.hasAttribute("hidden") || el.hasAttribute("inert"))) return true;
    if (!cs) return false;
    if (cs.display === "none") return true;
    if (cs.visibility === "hidden" || cs.visibility === "collapse") return true;
    if (cs.contentVisibility === "hidden") return true;
    return false;
  };

  /**
   * The text a visitor would actually read inside an element.
   *
   * Three things this does that `textContent` does not:
   *
   * 1. **Skips code.** `NON_RENDERED_TAGS` are not descended into at all.
   * 2. **Skips what is not rendered.** A hidden subtree contributes nothing —
   *    which is also what stops a responsive site's duplicate markup from
   *    being concatenated into an unreadable string. Measured on a real site,
   *    one `<h1>` held three breakpoint variants of the same sentence and
   *    `textContent` returned all three run together; only one is displayed at
   *    any width, and only that one is recorded.
   * 3. **Separates block boundaries.** A block-level child starts and ends on
   *    its own line when rendered, so its text is separated from its siblings
   *    by a single space. Inline children join without one, exactly as they
   *    render. The separator is whitespace only — no punctuation is invented,
   *    and no word is added, removed or reordered.
   *
   * Whitespace is then collapsed deterministically, so two runs over one DOM
   * produce one string.
   */
  const visibleTextOf = (root, where) => {
    const parts = [];
    const budget = { nodes: 0, truncated: false };
    /* An in-band marker for "a block boundary sat here". Never emitted: the
     * join below turns it into a space or drops it. */
    const BREAK = null;

    const walk = (node) => {
      const kids = node && node.childNodes;
      if (!kids) return;
      for (let i = 0; i < kids.length; i++) {
        if (budget.nodes++ >= TEXT_NODE_BUDGET) { budget.truncated = true; return; }
        const child = kids[i];
        if (!child) continue;
        if (child.nodeType === 3) {
          const value = String(child.nodeValue == null ? "" : child.nodeValue);
          if (value.trim()) parts.push(value);
          continue;
        }
        if (child.nodeType !== 1) continue;
        if (NON_RENDERED_TAGS.indexOf(child.tagName) !== -1) continue;
        let cs = null;
        try { cs = getComputedStyle(child); }
        catch (e) { note(where, "text-style", e && e.message); }
        if (hiddenForText(child, cs)) continue;
        const block = !cs || INLINE_DISPLAYS.indexOf(cs.display) === -1;
        if (block) parts.push(BREAK);
        walk(child);
        if (block) parts.push(BREAK);
      }
    };

    try { walk(root); }
    catch (e) { note(where, "text-walk", e && e.message); }

    let joined = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part === BREAK) {
        if (joined && !/\s$/.test(joined)) joined += " ";
        continue;
      }
      joined += part;
    }
    return { text: joined.replace(/\s+/g, " ").trim(), truncated: budget.truncated };
  };

  /**
   * Origin and path only.
   *
   * A query string is where tokens, session ids and signed URLs live. Keeping
   * the parameter NAMES would still describe the surface; keeping the values
   * would put credentials in a file that outlives the run, so neither is kept
   * and the count is recorded instead.
   */
  const safeUrl = (raw) => {
    try {
      const u = new URL(raw, location.href);
      const paramCount = [...u.searchParams.keys()].length;
      u.search = "";
      u.hash = "";
      u.username = "";
      u.password = "";
      return { url: u.toString(), queryParamsRemoved: paramCount, fragmentRemoved: /#/.test(String(raw)) };
    } catch (e) {
      return { url: null, queryParamsRemoved: 0, fragmentRemoved: false };
    }
  };

  const path = (el) => {
    const parts = [];
    let node = el;
    while (node && node !== document.body && parts.length < 12) {
      const parent = node.parentElement;
      const index = parent ? [...parent.children].indexOf(node) + 1 : 1;
      parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
      node = parent;
    }
    return parts.join(">");
  };

  const LANDMARK_TAGS = ["header", "nav", "main", "footer", "aside", "section", "article", "form"];
  const roleOf = (el) => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    return LANDMARK_TAGS.includes(tag) ? tag : null;
  };

  /** Why an element is not rendered, in the vocabulary the extractor uses. */
  const hiddenReason = (el, cs, rect) => {
    if (!cs) return "no-computed-style";
    if (cs.display === "none") return "display-none";
    if (cs.visibility === "hidden" || cs.visibility === "collapse") return "visibility-hidden";
    if (el.getAttribute("aria-hidden") === "true") return "aria-hidden";
    if (el.hasAttribute && el.hasAttribute("inert")) return "inert";
    if (el.hasAttribute && el.hasAttribute("hidden")) return "hidden-attr";
    if (cs.opacity !== "" && parseFloat(cs.opacity) === 0) return "opacity-zero";
    if (cs.contentVisibility === "hidden") return "content-visibility-hidden";
    if (!rect || rect.width <= 0 || rect.height <= 0) return "zero-area";
    return null;
  };

  const styleOf = (el, where) => {
    try { return getComputedStyle(el); }
    catch (e) { note(where, "computed-style", e && e.message); return null; }
  };

  const rectOf = (el, where) => {
    try { return el.getBoundingClientRect(); }
    catch (e) { note(where, "bounding-rect", e && e.message); return null; }
  };

  /** Walks up; a hidden ancestor makes the descendant unrendered whatever it says. */
  const hiddenAncestor = (el) => {
    let node = el.parentElement;
    let guard = 0;
    while (node && node !== document.body && guard++ < 30) {
      const cs = styleOf(node, path(node));
      const why = hiddenReason(node, cs, rectOf(node, path(node)));
      if (why) return why;
      node = node.parentElement;
    }
    return null;
  };

  /** Accessible name, from the cheap and safe sources only. */
  const accessibleName = (el, where) => {
    try {
      const label = el.getAttribute("aria-label");
      if (label) return bounded(label, NAME_CAP);
      const ref = el.getAttribute("aria-labelledby");
      if (ref) {
        const target = document.getElementById(ref.split(/\s+/)[0]);
        if (target) return bounded(target.textContent, NAME_CAP);
      }
      const title = el.getAttribute("title");
      if (title) return bounded(title, NAME_CAP);
      const heading = el.querySelector("h1,h2,h3,h4,h5,h6");
      if (heading) return bounded(visibleTextOf(heading, where).text, NAME_CAP);
      return null;
    } catch (e) { note(where, "accessible-name", e && e.message); return null; }
  };

  const headingsIn = (el, where) => {
    try {
      return [...el.querySelectorAll("h1,h2,h3,h4,h5,h6")]
        .slice(0, HEADING_CAP)
        /* Same reader as the region's own copy: a heading holding three
         * hidden breakpoint variants of one sentence records the one that is
         * displayed, not all three run together. */
        .map((h) => ({ level: Number(h.tagName.slice(1)), text: bounded(visibleTextOf(h, where).text, NAME_CAP) }));
    } catch (e) { note(where, "headings", e && e.message); return []; }
  };

  const px = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  };

  /**
   * Computed visual properties. Only what was read; a property the engine does
   * not expose is simply not a key, never a zero.
   */
  const visualProperties = (cs, rect) => {
    if (!cs) return {};
    const p = {};
    const put = (key, value) => { if (value !== undefined && value !== null && value !== "") p[key] = value; };

    put("display", cs.display);
    put("visibility", cs.visibility);
    put("opacity", cs.opacity);
    put("color", cs.color);
    put("backgroundColor", cs.backgroundColor);
    put("fontFamily", cs.fontFamily);
    put("fontSize", cs.fontSize);
    put("fontWeight", cs.fontWeight);
    put("lineHeight", cs.lineHeight);
    put("letterSpacing", cs.letterSpacing);
    put("margin", [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft].join(" "));
    put("padding", [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(" "));
    put("gap", cs.gap);
    put("borderWidth", [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].join(" "));
    put("borderStyle", cs.borderTopStyle);
    put("borderColor", cs.borderTopColor);
    put("borderRadius", cs.borderRadius);
    put("boxShadow", cs.boxShadow);
    put("minWidth", cs.minWidth);
    put("maxWidth", cs.maxWidth);
    put("minHeight", cs.minHeight);
    put("maxHeight", cs.maxHeight);
    put("position", cs.position);
    if (cs.zIndex && cs.zIndex !== "auto") put("zIndex", cs.zIndex);
    put("objectFit", cs.objectFit);
    if (rect) {
      put("renderedWidth", Math.round(rect.width));
      put("renderedHeight", Math.round(rect.height));
    }
    return p;
  };

  /** Layout evidence: how this element arranges what is inside it. */
  const layoutOf = (el, cs, rect) => {
    if (!cs) return {};
    const isFlex = /flex/.test(cs.display);
    const isGrid = /grid/.test(cs.display);
    const scrolls = /(auto|scroll)/.test(`${cs.overflowX} ${cs.overflowY}`);
    const out = {
      display: cs.display,
      position: cs.position,
      sticky: cs.position === "sticky",
      fixed: cs.position === "fixed",
      isScrollContainer: scrolls,
      maxWidthCandidate: cs.maxWidth && cs.maxWidth !== "none" ? cs.maxWidth : null
    };
    if (isFlex) {
      out.flexDirection = cs.flexDirection;
      out.flexWrap = cs.flexWrap;
      out.alignItems = cs.alignItems;
      out.justifyContent = cs.justifyContent;
      out.gap = cs.gap;
    }
    if (isGrid) {
      out.gridTemplateColumns = cs.gridTemplateColumns;
      out.gridTemplateRows = cs.gridTemplateRows;
      out.columnCount = String(cs.gridTemplateColumns || "").split(/\s+/).filter(Boolean).length || null;
      out.alignItems = cs.alignItems;
      out.justifyContent = cs.justifyContent;
      out.gap = cs.gap;
    }
    if (rect && el.parentElement) {
      const parentRect = rectOf(el.parentElement, path(el));
      if (parentRect && parentRect.width > 0) {
        out.widthShareOfParent = Math.round((rect.width / parentRect.width) * 100) / 100;
      }
    }
    return out;
  };

  /** Assets inside a region, deduplicated, with sources reduced to origin+path. */
  const assetsIn = (el, where) => {
    const seen = new Map();
    let images = [];
    try { images = [...el.querySelectorAll("img,svg,video,picture source")].slice(0, ASSET_CAP * 2); }
    catch (e) { note(where, "assets", e && e.message); return []; }

    for (const node of images) {
      if (seen.size >= ASSET_CAP) break;
      const tag = node.tagName.toLowerCase();
      const rect = rectOf(node, where);
      let identity = null;
      let status = "observed";
      let intrinsic = null;

      if (tag === "svg") {
        identity = "inline-svg";
      } else {
        const raw = node.getAttribute("src") || node.getAttribute("srcset") || "";
        const first = String(raw).split(",")[0].trim().split(/\s+/)[0];
        const safe = safeUrl(first);
        identity = safe.url;
        if (!identity) status = "unresolvable-source";
      }

      if (tag === "img") {
        const nw = node.naturalWidth;
        const nh = node.naturalHeight;
        if (node.complete && nw > 0) intrinsic = { width: nw, height: nh };
        else if (node.complete && nw === 0) status = "failed";
        else status = "pending";
      }

      const key = `${tag}|${identity}|${Math.round(rect ? rect.width : 0)}x${Math.round(rect ? rect.height : 0)}`;
      if (seen.has(key)) continue;
      seen.set(key, true);

      const record = {
        kind: tag === "svg" ? "icon-or-vector" : tag,
        identity,
        status,
        rendered: rect ? { width: Math.round(rect.width), height: Math.round(rect.height) } : null,
        intrinsic,
        alt: tag === "img" ? bounded(node.getAttribute("alt") ?? "", NAME_CAP) : null,
        altPresent: tag === "img" ? node.hasAttribute("alt") : null
      };
      seen.set(key, record);
    }
    return [...seen.values()].filter((v) => v !== true);
  };

  /**
   * Painted visual candidates inside a region.
   *
   * This finds WHERE something is painted and what is doing the painting. It
   * does not look at the paint. Classification happens in `visual.mjs` against
   * these records, so the rules stay testable without a browser.
   *
   * Sources are sanitized here, at the point of reading, for the same reason
   * every other URL in this survey is: a background-image can carry a signed
   * query string, and a value that is never gathered cannot later leak.
   */
  const visualCandidatesIn = (el, where) => {
    const out = [];
    let nodes = [];
    try {
      /* Two passes, because the two kinds of visual announce themselves
       * differently. A rendering surface or an image is identified by its TAG,
       * so a selector finds it exactly. A CSS-painted panel has no such tag and
       * usually no inline style either — it is painted by a stylesheet — so the
       * only way to find it is to look at what is actually rendered. The walk
       * is bounded by a node budget so that cost stays proportional. */
      const tagged = el.querySelectorAll("canvas,video,iframe,object,embed,svg,img,picture");
      const walked = el.querySelectorAll("*");
      nodes = [el, ...tagged, ...[...walked].slice(0, VISUAL_NODE_BUDGET)];
    } catch (e) { note(where, "visual-candidates", e && e.message); return []; }

    const seenPaths = new Set();

    for (const node of nodes) {
      if (out.length >= VISUAL_CAP) break;
      const rect = rectOf(node, where);
      if (!rect || rect.width < 80 || rect.height < 60) continue;

      let cs;
      try { cs = getComputedStyle(node); } catch (e) { note(where, "visual-style", e && e.message); continue; }
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;

      const tag = node.tagName.toLowerCase();

      /* A background-image URL is an asset reference; anything else in that
       * property (gradients, `none`) is paint without a source. */
      let backgroundImageIdentity = null;
      const bg = cs.backgroundImage || "none";
      const urlMatch = /url\((['"]?)([^'")]+)\1\)/.exec(bg);
      if (urlMatch) backgroundImageIdentity = safeUrl(urlMatch[2]).url;

      const paints = Boolean(
        backgroundImageIdentity ||
        /gradient/i.test(bg) ||
        (cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent") ||
        (cs.boxShadow && cs.boxShadow !== "none")
      );

      const animated = Boolean(
        (cs.animationName && cs.animationName !== "none") ||
        (cs.transitionDuration && !/^0s(,\s*0s)*$/.test(cs.transitionDuration))
      );

      /* Inline SVG is only usable if its markup can actually be read back. */
      let svgAvailable = null;
      if (tag === "svg") {
        try {
          const markup = node.outerHTML;
          svgAvailable = Boolean(markup && markup.length > 0 && node.querySelector("path,rect,circle,ellipse,polygon,polyline,line,text,use,image"));
        } catch (e) { svgAvailable = false; }
      }

      let sourceIdentity = null;
      let intrinsic = null;
      if (tag === "img") {
        const raw = node.getAttribute("src") || node.getAttribute("srcset") || "";
        const first = String(raw).split(",")[0].trim().split(/\s+/)[0];
        sourceIdentity = safeUrl(first).url;
        if (node.complete && node.naturalWidth > 0) intrinsic = { width: node.naturalWidth, height: node.naturalHeight };
      } else if (backgroundImageIdentity) {
        sourceIdentity = backgroundImageIdentity;
      }

      /* Only interiors: an element that merely wraps a real visual would be
       * recorded as a second, redundant candidate over the same pixels. */
      const isSurface = tag === "canvas" || tag === "video" || tag === "iframe" || tag === "object" || tag === "embed";
      if (!isSurface && tag !== "svg" && tag !== "img" && tag !== "picture" && !paints) continue;

      /* The two passes overlap on tagged nodes; the first sighting wins. */
      const domPath = node === el ? where : path(node);
      if (seenPaths.has(domPath)) continue;
      seenPaths.add(domPath);

      out.push({
        domPath,
        tag,
        geometry: {
          top: Math.round(rect.top + window.scrollY),
          left: Math.round(rect.left + window.scrollX),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        renderDimensions: { width: Math.round(rect.width), height: Math.round(rect.height) },
        sourceIdentity,
        backgroundImageIdentity,
        intrinsic,
        svgAvailable,
        animated,
        animationNote: animated
          ? bounded(`animation-name ${cs.animationName}; transition-duration ${cs.transitionDuration}`, NAME_CAP)
          : null,
        paints
      });
    }
    return out;
  };

  /**
   * Interactive content, counted and typed — never valued.
   *
   * Field values are the one thing a survey must not read. A populated password
   * or card field would be written verbatim into an artifact that gets copied
   * around, so only the type and whether something has been entered are kept.
   */
  const controlsIn = (el, where) => {
    try {
      const inputs = [...el.querySelectorAll("input,select,textarea")].slice(0, 24);
      return {
        links: el.querySelectorAll("a[href]").length,
        buttons: el.querySelectorAll("button,[role=button],input[type=submit]").length,
        forms: el.querySelectorAll("form").length,
        lists: el.querySelectorAll("ul,ol,dl").length,
        listItems: el.querySelectorAll("li").length,
        media: el.querySelectorAll("video,audio,canvas,iframe").length,
        fields: inputs.map((f) => ({
          type: (f.getAttribute("type") || f.tagName.toLowerCase()).slice(0, 24),
          required: f.hasAttribute("required"),
          hasValue: Boolean(f.value && String(f.value).length > 0),
          labelled: Boolean(f.getAttribute("aria-label") || f.getAttribute("aria-labelledby") || f.id)
        }))
      };
    } catch (e) {
      note(where, "controls", e && e.message);
      return { links: 0, buttons: 0, forms: 0, lists: 0, listItems: 0, media: 0, fields: [] };
    }
  };

  const inViewport = (rect) => rect && rect.bottom > 0 && rect.top < window.innerHeight;

  const regions = [];
  let candidates = [];
  try {
    candidates = [...document.querySelectorAll(
      "body > *, main > *, header, nav, footer, aside, section, article, form, [role]"
    )];
  } catch (e) { note("document", "candidate-query", e && e.message); }

  for (const el of candidates) {
    const where = path(el);
    const cs = styleOf(el, where);
    const rect = rectOf(el, where);

    const own = hiddenReason(el, cs, rect);
    if (own) continue;
    /* The ancestor walk. Without it a descendant of an `opacity: 0` wrapper
     * looks perfectly visible when judged on its own. */
    if (hiddenAncestor(el)) continue;
    if (!inViewport(rect)) continue;

    /* Read once, used for both `text` and `textLength`. */
    const visible = visibleTextOf(el, where);

    regions.push({
      domPath: where,
      tag: el.tagName.toLowerCase(),
      role: roleOf(el),
      explicitRole: el.getAttribute("role"),
      accessibleName: accessibleName(el, where),
      top: Math.round(rect.top + window.scrollY),
      left: Math.round(rect.left + window.scrollX),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      childCount: el.children.length,
      /* Both derived from the SAME rendered-text read, so `textLength` can
       * never describe a string `text` is not a prefix of. When the walk hits
       * its node budget `textBounded` says so, and `textLength` is then a
       * floor rather than a total — stated rather than silently wrong. */
      textLength: visible.text.length,
      text: bounded(visible.text, TEXT_CAP),
      textBounded: visible.truncated,
      headings: headingsIn(el, where),
      controls: controlsIn(el, where),
      properties: visualProperties(cs, rect),
      layout: layoutOf(el, cs, rect),
      assets: assetsIn(el, where),
      visualCandidates: visualCandidatesIn(el, where)
    });
  }

  const here = safeUrl(location.href);
  return {
    scrollY: Math.round(window.scrollY),
    documentHeight: document.body ? document.body.scrollHeight : 0,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
    /* Sanitized before it is recorded, not after. */
    url: here.url,
    urlSanitization: { queryParamsRemoved: here.queryParamsRemoved, fragmentRemoved: here.fragmentRemoved },
    visibilityState: document.visibilityState,
    regions,
    diagnostics
  };
};
/**
 * Geometry bucketed so sub-pixel reflow does not read as a different region.
 *
 * KNOWN LIMIT, measured rather than assumed: bucketing by rounding means any
 * value can sit beside a boundary, and a jitter that crosses one mints a second
 * identity — 600 and 603 bucket together, 600 and 605 do not. The consequence is
 * a duplicated region in the model, never two distinct sections merged into one,
 * so the error runs in the direction that over-reports rather than deletes.
 * Nearest-neighbour matching would remove it and is deferred; `O7b` pins the
 * current behaviour so the deferral stays visible.
 */
const bucket = (n, size = 8) => Math.round(Number(n ?? 0) / size) * size;

/**
 * The identity of an observed region.
 *
 * Four parts on purpose. A DOM path alone breaks when a framework re-keys a
 * list; a role alone is far too coarse; a selector alone collides; geometry
 * alone merges two identical cards. Together they identify a region across
 * observations without merging genuinely distinct ones.
 */
export function identityOf(region) {
  return [
    region?.domPath ?? "",
    region?.role ?? region?.tag ?? "",
    bucket(region?.top),
    bucket(region?.left),
    bucket(region?.width),
    bucket(region?.height)
  ].join("|");
}

/**
 * Collapses repeated sightings of one region into a single record that keeps
 * every provenance it was seen under.
 *
 * The first sighting wins for geometry — it is the one whose measurement was
 * taken while the region was in view. Later sightings contribute provenance and
 * nothing else, except that a disagreement is recorded rather than resolved:
 * a region whose height changes between observations is unstable, and saying so
 * is more useful than picking one of the two numbers.
 */
export function dedupeObservations(observations) {
  const byIdentity = new Map();

  for (const obs of observations) {
    for (const region of obs.regions ?? []) {
      const id = identityOf(region);
      const provenance = {
        kind: obs.kind,
        scrollState: obs.scrollState ?? null,
        scrollIndex: obs.scrollIndex ?? null,
        scrollStep: obs.scrollStep ?? null,
        scrollY: obs.scrollY,
        viewportWidth: obs.viewportWidth,
        viewportHeight: obs.viewportHeight,
        url: obs.url,
        visibilityState: obs.visibilityState,
        observedAt: obs.observedAt,
        state: obs.state ?? null
      };

      const existing = byIdentity.get(id);
      if (!existing) {
        byIdentity.set(id, {
          identity: id,
          domPath: region.domPath,
          tag: region.tag,
          role: region.role,
          geometry: { top: region.top, left: region.left, width: region.width, height: region.height },
          childCount: region.childCount,
          textLength: region.textLength,
          provenance: [provenance],
          kinds: [obs.kind],
          unstable: false,
          conflicts: []
        });
        continue;
      }

      existing.provenance.push(provenance);
      if (!existing.kinds.includes(obs.kind)) existing.kinds.push(obs.kind);

      /* An observation that disagrees with the first is a finding. Averaging
       * would manufacture a number nobody measured; discarding would hide that
       * the page moved under the capture. */
      const moved =
        region.width !== existing.geometry.width ||
        region.height !== existing.geometry.height ||
        region.top !== existing.geometry.top;
      if (moved) {
        existing.unstable = true;
        /* A disagreement between two DIFFERENT scroll states is a fact about
         * the page reacting to scroll — a sticky header re-anchoring, a
         * section animating in. A disagreement WITHIN one state is instability.
         * Recorded apart because only the second is noise, and neither may be
         * averaged away. */
        const firstState = existing.provenance[0]?.scrollState ?? null;
        existing.conflicts.push({
          at: { scrollY: obs.scrollY, kind: obs.kind, scrollState: obs.scrollState ?? null, scrollIndex: obs.scrollIndex ?? null },
          geometry: { top: region.top, left: region.left, width: region.width, height: region.height },
          stateDependent: firstState !== null && (obs.scrollState ?? null) !== firstState
        });
      }
    }
  }

  return [...byIdentity.values()];
}

/**
 * Runs bounded discovery over one viewport and returns every region it saw,
 * with the provenance of each sighting.
 *
 * The caller supplies the page-side operations, so this is testable against
 * scripted pages. `scrollTo` must actually move the page; `survey` must read it
 * where it now stands. Top-relative geometry is NOT measured here — the caller
 * returns to the top and measures afterwards, because a rect read mid-scroll is
 * relative to a position no downstream consumer knows about.
 *
 * @returns {{observations: object[], regions: object[], budget: object, stoppedBy: string}}
 */
export async function collectObservations({
  survey, scrollTo, sleep, now = () => Date.now(),
  viewportWidth, budget = OBSERVE_BUDGET, onProgress = null
} = {}) {
  const b = { ...OBSERVE_BUDGET, ...budget };
  const startedAt = now();
  const say = (m) => onProgress?.(m);

  const first = await survey();
  const observations = [{
    kind: OBSERVATION_KIND.INITIAL,
    scrollState: SCROLL_STATE.INITIAL,
    scrollIndex: 0,
    scrollStep: null,
    observedAt: now() - startedAt,
    scrollY: first.scrollY ?? 0,
    viewportWidth: viewportWidth ?? first.viewportWidth,
    viewportHeight: first.viewportHeight,
    url: first.url,
    visibilityState: first.visibilityState,
    regions: first.regions ?? []
  }];

  const plan = scrollPlan({
    documentHeight: first.documentHeight,
    viewportHeight: first.viewportHeight,
    overlapRatio: b.overlapRatio,
    maxScrollDistanceCss: b.maxScrollDistanceCss,
    maxObservations: b.maxObservations
  });

  let stoppedBy = "plan-complete";
  let scrollIndex = 0;
  for (const y of plan.positions) {
    if (y === 0) continue;
    scrollIndex++;
    /* One slot is RESERVED for the after-return look, so the sweep stops one
     * short of the budget rather than spending it all and then exceeding it.
     * The reserved look is worth the slot: it is the only observation that can
     * tell an animated reveal which persists from one which slides back out,
     * and it is most needed on exactly the long pages that would otherwise
     * consume the whole budget scrolling. */
    if (observations.length >= b.maxObservations - 1) { stoppedBy = "observation-budget"; break; }
    if (now() - startedAt > b.maxMs) { stoppedBy = "time-budget"; break; }

    await scrollTo(y);
    await sleep(b.dwellMs);
    const s = await survey();
    say(`observed scrollY ${s.scrollY} (${(s.regions ?? []).length} region(s) in view)`);

    observations.push({
      kind: OBSERVATION_KIND.SCROLL_REVEALED,
      scrollState: SCROLL_STATE.DURING_SCROLL,
      scrollIndex,
      scrollStep: plan.step,
      observedAt: now() - startedAt,
      scrollY: s.scrollY,
      viewportWidth: viewportWidth ?? s.viewportWidth,
      viewportHeight: s.viewportHeight,
      url: s.url,
      visibilityState: s.visibilityState,
      regions: s.regions ?? []
    });
  }
  if (plan.truncated && stoppedBy === "plan-complete") stoppedBy = "distance-budget";

  /* Back to the top. Every top-relative measurement downstream depends on it,
   * and the caller measures geometry only after this returns. */
  await scrollTo(0);
  await sleep(b.dwellMs);

  /* One more look, from the top, AFTER the sweep.
   *
   * This is what tells a section that animated in and stayed from one that
   * animated in and slid back out — both are invisible in the initial survey
   * and visible mid-scroll, and only this observation distinguishes them. It
   * is recorded as SCROLL_REVEALED rather than INITIAL on purpose: the page
   * has been scrolled, so whatever it shows is no longer what a visitor meets
   * on arrival, and the fold must keep resting on the one true initial look. */
  let afterReturn = null;
  try {
    afterReturn = await survey();
  } catch (e) {
    say(`after-return survey failed: ${e && e.message}`);
  }
  if (afterReturn) {
    observations.push({
      kind: OBSERVATION_KIND.SCROLL_REVEALED,
      scrollState: SCROLL_STATE.AFTER_RETURN,
      scrollIndex: scrollIndex + 1,
      scrollStep: plan.step,
      observedAt: now() - startedAt,
      scrollY: afterReturn.scrollY ?? 0,
      viewportWidth: viewportWidth ?? afterReturn.viewportWidth,
      viewportHeight: afterReturn.viewportHeight,
      url: afterReturn.url,
      visibilityState: afterReturn.visibilityState,
      regions: afterReturn.regions ?? []
    });
    say(`observed after return to top (${(afterReturn.regions ?? []).length} region(s) in view)`);
  }

  const regions = dedupeObservations(observations);

  return {
    $observeContract: "1",
    observations,
    regions,
    plan,
    stoppedBy,
    elapsedMs: now() - startedAt,
    budget: b,
    counts: {
      observations: observations.length,
      regions: regions.length,
      initialOnly: regions.filter((r) => r.kinds.length === 1 && r.kinds[0] === OBSERVATION_KIND.INITIAL).length,
      scrollRevealed: regions.filter((r) => r.kinds.includes(OBSERVATION_KIND.SCROLL_REVEALED)).length,
      unstable: regions.filter((r) => r.unstable).length,
      /* Seen mid-scroll and gone again by the time the page was back at the
       * top — an animated reveal that re-hides, not content that persists. */
      reHidesAtTop: regions.filter((r) => {
        const states = new Set(r.provenance.map((p) => p.scrollState));
        return states.has(SCROLL_STATE.DURING_SCROLL) && !states.has(SCROLL_STATE.AFTER_RETURN)
          && !states.has(SCROLL_STATE.INITIAL);
      }).length,
      stateDependentConflicts: regions.filter((r) => (r.conflicts ?? []).some((c) => c.stateDependent)).length
    }
  };
}

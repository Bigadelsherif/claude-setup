/**
 * The page-side probes, kept in one place.
 *
 * These run inside the browser, serialised across the driver boundary. They
 * live here rather than in the tool that first needed them because the CLI now
 * runs the same checks: two copies of a measurement heuristic is two
 * heuristics, and they drift silently — the artifacts still look well-formed.
 *
 * Nothing here decides anything. A finding is a fact about one render; whether
 * it is a DEFECT depends on correlation against the reference and on declared
 * intent, and both are decided in src/fidelity/.
 */

export const CHECKS = ({ tapMinimum }) => {
  const findings = [];
  let id = 0;
  const nextId = () => `ic_${String(++id).padStart(4, "0")}`;

  const selectorOf = (el) => {
    if (!el || el.nodeType !== 1) return null;
    if (el.id) return `#${el.id}`;
    const cls = (typeof el.className === "string" ? el.className : "").trim().split(/\s+/).filter(Boolean);
    return el.tagName.toLowerCase() + (cls.length ? "." + cls[0] : "");
  };
  const boxOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top + window.scrollY),
             width: Math.round(r.width), height: Math.round(r.height) };
  };
  const add = (o) => findings.push({ id: nextId(), ...o });

  const visible = Array.prototype.slice.call(document.querySelectorAll("body *")).filter((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });

  /* Intent markers. A container that declares itself scrollable, or an element
   * marked decorative, is doing what it was told to do. Reporting either as a
   * defect without supporting evidence is the false positive these checks are
   * most prone to. */
  const declaresScroll = (el) =>
    el.hasAttribute("data-scrollable") ||
    el.getAttribute("role") === "region" && el.hasAttribute("aria-label") ||
    /(^|[-_])(carousel|scroller|slider|marquee|overflow|track|rail)([-_]|$)/i.test(
      typeof el.className === "string" ? el.className : "");
  const declaresDecorative = (el) =>
    el.hasAttribute("data-decorative") ||
    el.getAttribute("aria-hidden") === "true" ||
    el.getAttribute("role") === "presentation" ||
    /(^|[-_])(mask|clip|avatar|thumb|decor)([-_]|$)/i.test(
      typeof el.className === "string" ? el.className : "");

  const docWidth = document.documentElement.clientWidth;

  /* ---------------------------------------------- 1  content overflow */
  for (const el of visible) {
    const cs = getComputedStyle(el);
    if (cs.overflow !== "visible" && cs.overflowX !== "visible") continue;
    const parent = el.parentElement;
    if (!parent || parent === document.body) continue;
    const pr = parent.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.width <= pr.width + 1) continue;
    if (declaresScroll(parent) || declaresDecorative(parent)) continue;
    add({
      check: "content-overflow", detectionMethod: "box-measurement",
      selector: selectorOf(el), box: boxOf(el),
      evidence: { childWidth: Math.round(r.width), containerWidth: Math.round(pr.width), container: selectorOf(parent) },
      intent: "accidental",
      detail: `${selectorOf(el)} is ${Math.round(r.width)}px inside a ${Math.round(pr.width)}px container that does not declare scrolling.`
    });
  }

  /* ------------------------------------------------------ 2  clipping */
  for (const el of visible) {
    const cs = getComputedStyle(el);
    const clips = cs.overflow === "hidden" || cs.overflowY === "hidden" || cs.overflowX === "hidden";
    if (!clips) continue;
    const clipped = el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
    if (!clipped) continue;
    const intentional = declaresDecorative(el) || declaresScroll(el);
    add({
      check: intentional ? "intentional-clipping" : "accidental-clipping",
      detectionMethod: "box-measurement",
      selector: selectorOf(el), box: boxOf(el),
      evidence: { scroll: { w: el.scrollWidth, h: el.scrollHeight }, client: { w: el.clientWidth, h: el.clientHeight },
                  declaredDecorative: declaresDecorative(el), declaredScrollable: declaresScroll(el) },
      intent: intentional ? "intentional" : "accidental",
      reportable: !intentional,
      detail: intentional
        ? `${selectorOf(el)} clips its content and declares itself decorative or scrollable; recorded, not reported as a defect.`
        : `${selectorOf(el)} clips content ${el.scrollHeight}px tall inside ${el.clientHeight}px with no declared intent.`
    });
  }

  /* ----------------------------------------------------- 3  occlusion */
  for (const el of visible) {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    if (r.top < 0 || r.bottom > window.innerHeight) continue;
    const cs = getComputedStyle(el);
    if (cs.position === "fixed" || cs.position === "sticky") continue;

    /* A sample grid rather than the centre alone, so a partial cover is seen. */
    const points = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.75]];
    let covered = 0;
    let by = null;
    for (const [fx, fy] of points) {
      const hit = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
      if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue;
      const hr = hit.getBoundingClientRect();
      if (hr.left < r.right && hr.right > r.left && hr.top < r.bottom && hr.bottom > r.top) {
        covered++;
        by = by ?? hit;
      }
    }
    if (!covered) continue;

    const byFixed = by && ["fixed", "sticky"].includes(getComputedStyle(by).position);
    add({
      check: byFixed ? "fixed-sticky-collision" : "occlusion",
      detectionMethod: "hit-test",
      selector: selectorOf(el), box: boxOf(el),
      evidence: { occludedBy: selectorOf(by), pointsCovered: covered, of: points.length,
                  occluderPosition: by ? getComputedStyle(by).position : null,
                  zIndex: cs.zIndex, occluderZIndex: by ? getComputedStyle(by).zIndex : null },
      intent: "accidental",
      detail: `${selectorOf(el)} is covered at ${covered} of ${points.length} sample points by ${selectorOf(by)}.`
    });

    /* Stacking inversion is the subset where the covered element declares a
     * HIGHER z-index than the thing covering it, or comes later in the DOM. */
    if (by && !byFixed) {
      const z = parseInt(cs.zIndex, 10);
      const bz = parseInt(getComputedStyle(by).zIndex, 10);
      const laterInDom = el.compareDocumentPosition(by) & Node.DOCUMENT_POSITION_PRECEDING;
      if ((Number.isFinite(z) && Number.isFinite(bz) && z > bz) || laterInDom) {
        add({
          check: "stacking-order-inverted", detectionMethod: "hit-test",
          selector: selectorOf(el), box: boxOf(el),
          evidence: { occludedBy: selectorOf(by), zIndex: cs.zIndex, occluderZIndex: getComputedStyle(by).zIndex,
                      occluderPrecedesInDom: !!laterInDom },
          intent: "accidental",
          detail: `${selectorOf(el)} sits beneath ${selectorOf(by)} despite z-index ${cs.zIndex} against ${getComputedStyle(by).zIndex}.`
        });
      }
    }
  }

  /* ------------------------------ 5 / 6  unexpected scrollbars, separately */
  const docScrollsX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
  if (docScrollsX) {
    add({
      check: "unexpected-horizontal-scrollbar", detectionMethod: "box-measurement",
      selector: "document", box: null,
      evidence: { scrollWidth: document.documentElement.scrollWidth, clientWidth: docWidth },
      intent: "accidental",
      detail: `The document scrolls horizontally: ${document.documentElement.scrollWidth}px of content in ${docWidth}px.`
    });
  }

  for (const el of visible) {
    const cs = getComputedStyle(el);
    const scrollsY = el.scrollHeight > el.clientHeight + 1 &&
      ["auto", "scroll"].includes(cs.overflowY);
    const scrollsX = el.scrollWidth > el.clientWidth + 1 &&
      ["auto", "scroll"].includes(cs.overflowX);
    if (!scrollsY && !scrollsX) continue;
    if (declaresScroll(el)) {
      add({
        check: "declared-scroll-container", detectionMethod: "computed-style",
        selector: selectorOf(el), box: boxOf(el),
        evidence: { axis: scrollsX ? "x" : "y", declared: true },
        intent: "intentional", reportable: false,
        detail: `${selectorOf(el)} scrolls and declares itself scrollable; recorded, not reported.`
      });
      continue;
    }
    if (scrollsY) {
      add({
        check: "unexpected-vertical-scrollbar", detectionMethod: "computed-style",
        selector: selectorOf(el), box: boxOf(el),
        evidence: { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, overflowY: cs.overflowY },
        intent: "accidental",
        detail: `${selectorOf(el)} gained a vertical scrollbar it does not declare: ${el.scrollHeight}px inside ${el.clientHeight}px.`
      });
    }
    if (scrollsX) {
      add({
        check: "unexpected-horizontal-scrollbar", detectionMethod: "computed-style",
        selector: selectorOf(el), box: boxOf(el),
        evidence: { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, overflowX: cs.overflowX },
        intent: "accidental",
        detail: `${selectorOf(el)} gained a horizontal scrollbar it does not declare.`
      });
    }
  }

  /* ------------------------------------------------ 7  viewport overflow */
  for (const el of visible) {
    const r = el.getBoundingClientRect();
    if (r.right <= docWidth + 1) continue;
    if (r.width > docWidth * 2) continue;
    let inScroller = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (declaresScroll(p)) { inScroller = true; break; }
    }
    if (inScroller) continue;
    add({
      check: "viewport-overflow", detectionMethod: "box-measurement",
      selector: selectorOf(el), box: boxOf(el),
      evidence: { right: Math.round(r.right), viewportWidth: docWidth },
      intent: "accidental",
      detail: `${selectorOf(el)} extends to ${Math.round(r.right)}px against a ${docWidth}px viewport.`
    });
  }

  /* --------------------------------- 8 / 9  image crop and object-fit */
  for (const img of Array.prototype.slice.call(document.querySelectorAll("img"))) {
    const r = img.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const cs = getComputedStyle(img);
    const natural = img.naturalWidth && img.naturalHeight
      ? img.naturalWidth / img.naturalHeight : null;
    const rendered = r.width / r.height;

    add({
      check: "object-fit-observation", detectionMethod: "computed-style",
      selector: selectorOf(img), box: boxOf(img),
      evidence: {
        objectFit: cs.objectFit, objectPosition: cs.objectPosition,
        naturalAspect: natural == null ? null : Number(natural.toFixed(3)),
        renderedAspect: Number(rendered.toFixed(3)),
        naturalSize: natural == null ? null : { w: img.naturalWidth, h: img.naturalHeight },
        src: (img.getAttribute("src") || "").slice(0, 60)
      },
      intent: "observation", reportable: false,
      detail: `${selectorOf(img)} renders at ${rendered.toFixed(2)} with object-fit ${cs.objectFit}.`
    });

    /* A crop claim needs the natural aspect. Without it, the question is not
     * answered rather than answered badly. */
    if (natural == null) {
      add({
        check: "image-crop-unknown", detectionMethod: "natural-size",
        selector: selectorOf(img), box: boxOf(img),
        evidence: { reason: "natural dimensions unavailable" },
        intent: "unknown", reportable: false,
        detail: `${selectorOf(img)} has no readable natural size, so no crop claim is made.`
      });
      continue;
    }

    const distorts = cs.objectFit === "fill" && Math.abs(rendered - natural) / natural > 0.02;
    if (distorts) {
      add({
        check: "image-crop-mismatch", detectionMethod: "natural-size",
        selector: selectorOf(img), box: boxOf(img),
        evidence: { objectFit: cs.objectFit, naturalAspect: Number(natural.toFixed(3)),
                    renderedAspect: Number(rendered.toFixed(3)) },
        intent: "accidental",
        detail: `${selectorOf(img)} is stretched: object-fit fill renders ${rendered.toFixed(2)} against a natural ${natural.toFixed(2)}.`
      });
    }
  }

  /* ------------------------------------------------- 10  text truncation */
  for (const el of visible) {
    const text = (el.textContent || "").trim();
    if (!text) continue;
    if (el.children.length > 2) continue;
    const cs = getComputedStyle(el);
    const clamped = cs.webkitLineClamp && cs.webkitLineClamp !== "none";
    const ellipsis = cs.textOverflow === "ellipsis";
    const overflowing = el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
    const hidden = cs.overflow === "hidden" || cs.overflowY === "hidden" || cs.overflowX === "hidden";
    if (!overflowing || !hidden) continue;
    if (declaresDecorative(el)) continue;
    add({
      check: "text-truncation", detectionMethod: "box-measurement",
      selector: selectorOf(el), box: boxOf(el),
      evidence: { lineClamp: clamped ? cs.webkitLineClamp : null, textOverflow: ellipsis ? "ellipsis" : null,
                  scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
                  characters: text.length },
      intent: "accidental",
      detail: clamped
        ? `${selectorOf(el)} is clamped to ${cs.webkitLineClamp} line(s); ${el.scrollHeight}px of text sits in ${el.clientHeight}px.`
        : `${selectorOf(el)} truncates text: ${el.scrollHeight}px of content inside ${el.clientHeight}px with overflow hidden.`
    });
  }

  /* ---------------------------------------- 11  focus indicator visibility */
  const focusable = Array.prototype.slice.call(
    document.querySelectorAll("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])")
  ).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !el.hasAttribute("disabled");
  }).slice(0, 12);

  for (const el of focusable) {
    const before = getComputedStyle(el);
    const beforeOutline = { style: before.outlineStyle, width: before.outlineWidth, color: before.outlineColor,
                            boxShadow: before.boxShadow };
    el.focus({ preventScroll: true });
    const after = getComputedStyle(el);
    const gainedOutline = after.outlineStyle !== "none" && parseFloat(after.outlineWidth) > 0;
    const gainedShadow = after.boxShadow !== beforeOutline.boxShadow && after.boxShadow !== "none";
    const r = el.getBoundingClientRect();
    const withinViewport = r.top >= 0 && r.bottom <= window.innerHeight + 1;

    if (!gainedOutline && !gainedShadow) {
      add({
        check: "focus-indicator-invisible", detectionMethod: "computed-style",
        selector: selectorOf(el), box: boxOf(el),
        evidence: { outlineStyle: after.outlineStyle, outlineWidth: after.outlineWidth,
                    boxShadowChanged: gainedShadow },
        intent: "accidental",
        detail: `${selectorOf(el)} gains no visible indicator when focused.`
      });
    } else {
      /* A ring that exists but is clipped by an ancestor is no better. */
      let clipped = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const pcs = getComputedStyle(p);
        if (pcs.overflow === "hidden" || pcs.overflowY === "hidden") {
          const pr = p.getBoundingClientRect();
          const offset = parseFloat(after.outlineOffset) || 0;
          const ow = parseFloat(after.outlineWidth) || 0;
          if (r.top - offset - ow < pr.top - 1 || r.bottom + offset + ow > pr.bottom + 1) { clipped = true; break; }
        }
      }
      if (clipped) {
        add({
          check: "focus-indicator-clipped", detectionMethod: "box-measurement",
          selector: selectorOf(el), box: boxOf(el),
          evidence: { outlineWidth: after.outlineWidth, outlineOffset: after.outlineOffset },
          intent: "accidental",
          detail: `${selectorOf(el)} has a focus indicator that an ancestor with overflow hidden cuts off.`
        });
      }
      if (!withinViewport) {
        add({
          check: "focus-target-offscreen", detectionMethod: "box-measurement",
          selector: selectorOf(el), box: boxOf(el),
          evidence: { top: Math.round(r.top), bottom: Math.round(r.bottom), viewportHeight: window.innerHeight },
          intent: "accidental",
          detail: `${selectorOf(el)} does not scroll into view when focused.`
        });
      }
      add({
        check: "focus-indicator-observation", detectionMethod: "computed-style",
        selector: selectorOf(el), box: boxOf(el),
        evidence: { outlineStyle: after.outlineStyle, outlineWidth: after.outlineWidth,
                    outlineColor: after.outlineColor, background: after.backgroundColor },
        intent: "observation", reportable: false,
        detail: `${selectorOf(el)} shows a focus indicator.`
      });
    }
    el.blur();
  }

  /* ------------------------------------------------------ 12  tap targets */
  const interactive = Array.prototype.slice.call(
    document.querySelectorAll("a[href], button, input, select, textarea, [role='button'], [role='option']")
  ).filter((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
  });
  for (const el of interactive) {
    const r = el.getBoundingClientRect();
    if (r.height >= tapMinimum && r.width >= tapMinimum) continue;
    add({
      check: "tap-target-undersized", detectionMethod: "box-measurement",
      selector: selectorOf(el), box: boxOf(el),
      evidence: { width: Math.round(r.width), height: Math.round(r.height), minimum: tapMinimum,
                  shortfall: Math.round(Math.max(0, tapMinimum - Math.min(r.width, r.height))) },
      intent: "accidental",
      detail: `${selectorOf(el)} measures ${Math.round(r.width)}x${Math.round(r.height)} against a ${tapMinimum}px minimum.`
    });
  }

  /* ------------------------- 13  fixed and sticky collisions, by geometry */
  const layers = visible.filter((el) => ["fixed", "sticky"].includes(getComputedStyle(el).position));
  for (const layer of layers) {
    const lr = layer.getBoundingClientRect();
    if (lr.width < 4 || lr.height < 4) continue;

    for (const other of interactive) {
      if (other === layer || layer.contains(other) || other.contains(layer)) continue;
      const or = other.getBoundingClientRect();
      const overlaps = lr.left < or.right && lr.right > or.left && lr.top < or.bottom && lr.bottom > or.top;
      if (!overlaps) continue;
      const hit = document.elementFromPoint(or.left + or.width / 2, or.top + or.height / 2);
      const actuallyCovered = hit && hit !== other && !other.contains(hit);
      if (!actuallyCovered) continue;
      add({
        check: "fixed-sticky-collision", detectionMethod: "hit-test",
        selector: selectorOf(other), box: boxOf(other),
        evidence: { layer: selectorOf(layer), layerPosition: getComputedStyle(layer).position,
                    coveredTarget: selectorOf(other), hitInstead: selectorOf(hit) },
        intent: "accidental",
        detail: `${selectorOf(layer)} (${getComputedStyle(layer).position}) covers the interactive ${selectorOf(other)}.`
      });
    }

    /* Two fixed layers overlapping each other. */
    for (const other of layers) {
      if (other === layer) continue;
      const or = other.getBoundingClientRect();
      if (!(lr.left < or.right && lr.right > or.left && lr.top < or.bottom && lr.bottom > or.top)) continue;
      if (layer.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_PRECEDING) continue;
      add({
        check: "fixed-sticky-collision", detectionMethod: "box-measurement",
        selector: selectorOf(layer), box: boxOf(layer),
        evidence: { collidesWith: selectorOf(other), layers: 2 },
        intent: "accidental",
        detail: `Two ${getComputedStyle(layer).position}/${getComputedStyle(other).position} layers overlap: ${selectorOf(layer)} and ${selectorOf(other)}.`
      });
    }
  }

  /* Every selector the probe SAW, so correlation can tell "the reference has
   * this element without the condition" from "the reference has no such
   * element at all". Without it the two collapse and a target-only defect
   * would read as unknown. */
  const allSelectors = [...new Set(visible.map(selectorOf).filter(Boolean))];

  return { findings, allSelectors, checkedElements: visible.length,
           viewportWidth: docWidth, viewportHeight: window.innerHeight };
};


/* ------------------------------------------------ interaction states */

export const STATE_SPECS = [
  { state: "default",   trigger: "none",           selector: "#region",           route: null },
  { state: "hover",     trigger: "pointer",        selector: "#primary",          route: null },
  { state: "focus",     trigger: "keyboard",       selector: "#primary",          route: null },
  { state: "active",    trigger: "pointer-down",   selector: "#primary",          route: null },
  { state: "selected",  trigger: "attribute",      selector: "#opt-b",            route: null },
  { state: "expanded",  trigger: "declared-route", selector: "#disclosure-panel", route: "?expanded=true" },
  { state: "loading",   trigger: "declared-route", selector: "#region",           route: "?state=loading",
    requires: { selector: ".region__loading", visible: true } },
  { state: "empty",     trigger: "declared-route", selector: "#region",           route: "?state=empty",
    requires: { selector: ".region__empty", visible: true } },
  { state: "error",     trigger: "declared-route", selector: "#region",           route: "?state=error",
    requires: { selector: ".region__error", visible: true } },
  /* Declared with no induction, so it must come back unknown. */
  { state: "hover", variant: "untriggerable", trigger: null, selector: "#no-trigger", route: null },
  /* Far down the page: inducing it scrolls, which must not read as a change. */
  { state: "hover", variant: "deep-scroll", trigger: "pointer", selector: "#deep", route: null }
];

export const READ_STATE = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return {
    backgroundColor: cs.backgroundColor,
    color: cs.color,
    borderTopColor: cs.borderTopColor,
    borderTopWidth: cs.borderTopWidth,
    borderRadius: cs.borderTopLeftRadius,
    boxShadow: cs.boxShadow,
    outlineStyle: cs.outlineStyle,
    outlineWidth: cs.outlineWidth,
    outlineColor: cs.outlineColor,
    outlineOffset: cs.outlineOffset,
    transform: cs.transform,
    scale: cs.scale,
    opacity: cs.opacity,
    visibility: cs.visibility,
    display: cs.display,
    cursor: cs.cursor,
    textDecorationLine: cs.textDecorationLine,
    fontWeight: cs.fontWeight,
    ariaSelected: el.getAttribute("aria-selected"),
    ariaExpanded: el.getAttribute("aria-expanded"),
    ariaDisabled: el.getAttribute("aria-disabled"),
    disabled: el.hasAttribute("disabled") ? "true" : "false",
    role: el.getAttribute("role"),
    /* Interaction-specific content: what the state SAYS. */
    textContent: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 160),
    /* Intrinsic size only — never `top`, never anything viewport-relative. */
    width: Number(rect.width.toFixed(2)),
    height: Number(rect.height.toFixed(2))
  };
};

export const IS_VISIBLE = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0;
};

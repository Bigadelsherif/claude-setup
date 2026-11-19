/* ============================================================================
 * Bigaap UI Forensics — probe.js (browser-side, pass 2: TARGETED)
 * ----------------------------------------------------------------------------
 * Given selectors nominated by pass 1, returns full detail per match: box
 * model, computed subset, direct children, pseudo-elements, ARIA, and the
 * innermost background-painting descendant.
 *
 * That last one exists because "the repeated node" and "the node that paints
 * the surface" are frequently different elements. Measuring the wrapper is a
 * real and common extraction failure; recording both lets the evidence layer
 * be corrected with a citation rather than a guess.
 *
 * Usage:  __BIGAAP_PROBE__(["\.card", "button"], { maxMatches: 4 })
 * ==========================================================================*/

(function () {
  "use strict";

  var PROBE_VERSION = "0.1.0";
  var DEFAULT_MAX_MATCHES = 4;
  var MAX_CHILDREN = 8;

  var COMPUTED_KEYS = [
    "display", "position", "top", "left", "zIndex", "overflow",
    "flexDirection", "alignItems", "justifyContent", "flexWrap", "gap", "rowGap", "columnGap",
    "gridTemplateColumns", "gridTemplateRows", "gridAutoFlow",
    "width", "height", "minHeight", "maxWidth", "aspectRatio",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "marginTop", "marginRight", "marginBottom", "marginLeft",
    "backgroundColor", "backgroundImage", "color",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
    // All four edge colours, not just the top one: a component whose surface is
    // a single bottom rule reads its colour from `borderBottomColor`, and with
    // only the top edge recorded it was indistinguishable from unpainted
    // (def_0027).
    "borderTopStyle", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
    "borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius",
    "boxShadow", "opacity", "outlineWidth", "outlineStyle", "outlineColor", "outlineOffset",
    "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "textTransform", "textAlign",
    "transitionProperty", "transitionDuration", "transitionTimingFunction", "transitionDelay",
    /* The full animation longhand set. The shorthand is not read: a computed
     * `animation` recombines the longhands in an order the spec allows to vary,
     * and parsing it back apart would be reconstructing what is already here. */
    "animationName", "animationDuration", "animationDelay", "animationTimingFunction",
    "animationIterationCount", "animationFillMode", "animationDirection", "animationPlayState",
    /* What motion moves, and the compositing hints around it. */
    "transform", "willChange", "filter", "backdropFilter",
    "objectFit", "cursor"
  ];

  function safe(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }

  function round(n, dp) {
    var f = Math.pow(10, dp == null ? 2 : dp);
    return Math.round(n * f) / f;
  }

  function normColor(v) {
    if (!v || typeof v !== "string") return null;
    var s = v.trim();
    if (s === "transparent" || s === "rgba(0, 0, 0, 0)") return "transparent";
    var m = s.match(/^rgba?\(([^)]+)\)$/);
    if (!m) return s;
    var p = m[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
    if (p.length < 3 || p.some(isNaN)) return s;
    var a = p.length > 3 ? p[3] : 1;
    if (a < 1) return "rgba(" + p[0] + ", " + p[1] + ", " + p[2] + ", " + round(a, 3) + ")";
    return "#" + p.slice(0, 3).map(function (n) {
      var h = Math.max(0, Math.min(255, Math.round(n))).toString(16);
      return h.length === 1 ? "0" + h : h;
    }).join("");
  }

  function selectorFor(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.id) return "#" + el.id;
    var tag = el.tagName.toLowerCase();
    var cls = safe(function () {
      return (typeof el.className === "string" ? el.className : "").trim().split(/\s+/).filter(Boolean);
    }, []);
    return cls.length ? tag + "." + cls.join(".") : tag;
  }

  function domPathFor(el) {
    var parts = [], node = el, guard = 0;
    while (node && node.nodeType === 1 && node !== document.documentElement && guard++ < 40) {
      var tag = node.tagName.toLowerCase();
      var parent = node.parentElement;
      if (parent) {
        var same = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === node.tagName; });
        if (same.length > 1) tag += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
      }
      parts.unshift(tag);
      node = node.parentElement;
    }
    return "html>" + parts.join(">");
  }

  function paints(cs) {
    if (!cs) return false;
    var bg = normColor(cs.backgroundColor);
    var hasBg = bg && bg !== "transparent";
    var hasImg = cs.backgroundImage && cs.backgroundImage !== "none";
    return !!(hasBg || hasImg);
  }

  /**
   * Walks down from `el` to the innermost descendant that paints a background
   * AND still occupies essentially the same box. That node — not the wrapper —
   * is what a viewer perceives as "the card".
   */
  function paintedSurfaceOf(el) {
    var rootRect = safe(function () { return el.getBoundingClientRect(); }, null);
    if (!rootRect) return null;

    var best = null;
    var node = el;
    var guard = 0;

    while (node && guard++ < 12) {
      var cs = safe(function () { return getComputedStyle(node); }, null);
      var rect = safe(function () { return node.getBoundingClientRect(); }, null);
      if (cs && rect && paints(cs)) {
        var coversWidth = rect.width >= rootRect.width * 0.9;
        var coversHeight = rect.height >= rootRect.height * 0.9;
        if (coversWidth && coversHeight) {
          var bgColor = normColor(cs.backgroundColor);
          var bgImage = cs.backgroundImage && cs.backgroundImage !== "none" ? cs.backgroundImage : null;
          var hasColor = !!(bgColor && bgColor !== "transparent");
          best = {
            selector: selectorFor(node),
            domPath: domPathFor(node),
            isRoot: node === el,
            depthFromRoot: guard - 1,
            backgroundColor: bgColor,
            // A surface can paint via image alone. Reporting only the colour
            // makes a gradient-filled panel look empty downstream.
            backgroundImage: bgImage,
            paintedVia: hasColor && bgImage ? "both" : bgImage ? "image" : "color",
            backgroundSize: bgImage ? cs.backgroundSize : null,
            backgroundPosition: bgImage ? cs.backgroundPosition : null,
            borderRadius: cs.borderTopLeftRadius,
            boxShadow: cs.boxShadow !== "none" ? cs.boxShadow : null,
            borderWidth: cs.borderTopWidth,
            borderColor: normColor(cs.borderTopColor),
            padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(" ")
          };
        }
      }
      // descend through single-child-ish wrappers only
      var next = null;
      var kids = node.children;
      if (kids && kids.length >= 1) {
        for (var i = 0; i < kids.length; i++) {
          var kr = safe(function () { return kids[i].getBoundingClientRect(); }, null);
          if (kr && kr.width >= rootRect.width * 0.9 && kr.height >= rootRect.height * 0.9) {
            next = kids[i];
            break;
          }
        }
      }
      if (!next) break;
      node = next;
    }
    return best;
  }

  function computedSubset(cs) {
    var out = {};
    COMPUTED_KEYS.forEach(function (k) {
      var v = safe(function () { return cs[k]; }, null);
      if (v == null || v === "" || v === "normal" || v === "none" || v === "auto" || v === "0px" || v === "0s") return;
      if (k.toLowerCase().indexOf("color") > -1) v = normColor(v);
      out[k] = v;
    });
    return out;
  }

  function pseudoOf(el, which) {
    var cs = safe(function () { return getComputedStyle(el, which); }, null);
    if (!cs) return null;
    var content = safe(function () { return cs.content; }, "none");
    if (!content || content === "none" || content === "normal") return null;
    return {
      content: content,
      backgroundColor: normColor(cs.backgroundColor),
      width: cs.width,
      height: cs.height,
      position: cs.position,
      borderRadius: cs.borderTopLeftRadius
    };
  }

  function describe(el, opts) {
    var cs = safe(function () { return getComputedStyle(el); }, null);
    var rect = safe(function () { return el.getBoundingClientRect(); }, null);
    if (!cs || !rect) return null;

    var children = [];
    var kids = Array.prototype.slice.call(el.children).slice(0, MAX_CHILDREN);
    kids.forEach(function (child) {
      var ccs = safe(function () { return getComputedStyle(child); }, null);
      var crect = safe(function () { return child.getBoundingClientRect(); }, null);
      if (!ccs || !crect) return;
      children.push({
        selector: selectorFor(child),
        tag: child.tagName.toLowerCase(),
        rect: { width: round(crect.width), height: round(crect.height) },
        role: ccs.display,
        fontSize: ccs.fontSize,
        lineHeight: ccs.lineHeight,
        fontWeight: ccs.fontWeight,
        color: normColor(ccs.color),
        backgroundColor: normColor(ccs.backgroundColor),
        borderRadius: ccs.borderTopLeftRadius,
        marginBottom: ccs.marginBottom
      });
    });

    var aria = {};
    safe(function () {
      Array.prototype.forEach.call(el.attributes, function (a) {
        if (a.name === "role" || a.name.indexOf("aria-") === 0 || a.name === "alt" || a.name === "tabindex") {
          aria[a.name] = a.value;
        }
      });
    }, null);

    return {
      selector: selectorFor(el),
      domPath: domPathFor(el),
      tag: el.tagName.toLowerCase(),
      rect: {
        width: round(rect.width),
        height: round(rect.height),
        top: round(rect.top),
        left: round(rect.left)
      },
      box: {
        padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft],
        margin: [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft],
        border: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth],
        radius: [
          cs.borderTopLeftRadius, cs.borderTopRightRadius,
          cs.borderBottomRightRadius, cs.borderBottomLeftRadius
        ]
      },
      paints: paints(cs),
      paintedSurface: paintedSurfaceOf(el),
      computed: computedSubset(cs),
      children: children,
      pseudo: {
        before: pseudoOf(el, "::before"),
        after: pseudoOf(el, "::after")
      },
      aria: Object.keys(aria).length ? aria : null,
      text: safe(function () {
        var t = (el.textContent || "").trim().replace(/\s+/g, " ");
        return t.length > 120 ? t.slice(0, 120) + "…" : t;
      }, null)
    };
  }

  function probe(selectors, options) {
    var opts = options || {};
    var maxMatches = opts.maxMatches || DEFAULT_MAX_MATCHES;
    var results = [];

    (selectors || []).forEach(function (sel) {
      var nodes = safe(function () {
        return Array.prototype.slice.call(document.querySelectorAll(sel));
      }, null);

      if (nodes === null) {
        results.push({ selector: sel, error: "invalid-selector", matches: 0, samples: [] });
        return;
      }
      if (!nodes.length) {
        results.push({ selector: sel, error: "no-match", matches: 0, samples: [] });
        return;
      }

      var samples = [];
      nodes.slice(0, maxMatches).forEach(function (el) {
        var d = describe(el, opts);
        if (d) samples.push(d);
      });
      results.push({ selector: sel, matches: nodes.length, samples: samples });
    });

    return {
      $extractor: "bigaap/probe",
      $version: PROBE_VERSION,
      capturedAt: new Date().toISOString(),
      viewport: safe(function () { return window.innerWidth; }, null),
      results: results
    };
  }

  if (typeof window !== "undefined") {
    window.__BIGAAP_PROBE__ = probe;
    window.__BIGAAP_PROBE_VERSION__ = PROBE_VERSION;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { probe: probe };
  }
})();

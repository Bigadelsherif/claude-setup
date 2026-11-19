/* ============================================================================
 * Helmy UI Forensics — extract.js (browser-side, pass 1: AGGREGATE)
 * ----------------------------------------------------------------------------
 * Runs inside the target page. Returns a COMPACT aggregate model, never a
 * per-node dump.
 *
 * Phase 1 rewrite. The Phase 0 sampler filled its budget in DOM order, so a
 * page whose header contains a large collapsed mega-menu (stripe.com/pricing:
 * 5804 nodes, ~800 of them hidden menu contents) spent the entire budget before
 * reaching main. Every downstream claim was then locally defensible and
 * globally wrong.
 *
 * The sampler is now STRATIFIED by region and ranked by visible importance, and
 * it reports what it skipped so coverage can be assessed rather than assumed.
 *
 * Contract:
 *   - Never throws. Unreachable things are REPORTED, not silently omitted.
 *   - Deterministic ordering, so two captures diff cleanly.
 *   - Emits no interpretation. Frequencies, geometry, and region facts only.
 *
 * Usage:  __HELMY_EXTRACT__()  ->  raw extract object
 * ==========================================================================*/

(function () {
  "use strict";

  var EXTRACTOR_VERSION = "0.2.0";
  var NODE_CAP = 2500;
  var HISTOGRAM_CAP = 40;
  var SAMPLES_PER_ENTRY = 3;

  /* Stratified sampling budget. DOM order is not content importance. */
  var STRATA = [
    { name: "main", share: 0.5 },
    { name: "header", share: 0.15 },
    { name: "footer", share: 0.1 },
    { name: "repeats", share: 0.15 },
    { name: "random", share: 0.1 }
  ];

  var CONSENT_PATTERN = /consent|cookie|gdpr|ccpa|privacy-banner|onetrust|truste|cmp|didomi|quantcast|usercentrics/i;
  var NAV_CONTAINER_PATTERN = /(^|[-_])(nav|menu|drawer|flyout|megamenu|mega-menu|dropdown)([-_]|$)/i;

  /**
   * Class names are classified, not trusted.
   *
   * A build-generated name is stable within one deploy and meaningless across
   * deploys, so it may label a component but must never be handed to an
   * implementer as a selector to write. A utility name is shared by unrelated
   * elements and says nothing about identity at all.
   */
  /* Names that ARE a utility on their own, or that start one and are followed
   * by a separator. `flex` is a utility; `flexible-grid` is not.
   *
   * `container` is deliberately absent. It is a Tailwind utility and also one
   * of the commonest hand-written layout class names — on the BEM control it
   * was the single name misfiled as a utility out of 28. Excluding it costs
   * nothing on utility sites, since a container is not component identity
   * either way, and stops a hand-written site losing its layout class. */
  var UTILITY_WORD =
    /^(?:flex|grid|gap|rounded|border|outline|shadow|table|contents|isolate|block|inline|hidden|absolute|relative|fixed|sticky|static|overflow|transition|blur|truncate|uppercase|lowercase|capitalize|italic|underline|antialiased|grow|shrink|group|peer|sr-only|transform|invisible|tabular-nums|subpixel-antialiased)(?:$|[-\/])/;

  /* Prefixes that only ever begin a utility, and which carry their own
   * separator — no trailing delimiter must be required after them, or
   * `bg-gray-950` stops matching `bg-`. */
  var UTILITY_PREFIX =
    /^(?:[mp][trblxy]?-(?:\d|auto|px|full|screen)|w-|h-|min-[wh]-|max-[wh]-|size-|aspect-|text-|bg-|from-|via-|to-|fill-|stroke-|col-|row-|order-|basis-|items-|justify-|place-|self-|content-|space-[xy]-|divide-|ring-|opacity-|font-|leading-|tracking-|whitespace-|inset-|top-|right-|bottom-|left-|z-|object-|list-|cursor-|select-|pointer-events-|duration-|delay-|ease-|animate-|translate-|scale-|rotate-|skew-|origin-|backdrop-|brightness-|contrast-|saturate-|line-clamp-|snap-|perspective-|scheme-|will-change-|appearance-|accent-|caret-|decoration-|indent-|columns-|hyphens-)/;


  /**
   * Strips Tailwind-style variant prefixes, which are colon-separated at the
   * top level. Colons inside brackets belong to the value (`[--h:2px]`,
   * `data-[open=true]:flex`) and must not be treated as separators.
   */
  function stripVariants(name) {
    var depth = 0;
    var last = 0;
    for (var i = 0; i < name.length; i++) {
      var ch = name.charAt(i);
      if (ch === "[") depth++;
      else if (ch === "]") depth--;
      else if (ch === ":" && depth === 0) last = i + 1;
    }
    return name.slice(last);
  }

  /**
   * Is this a utility class?
   *
   * Recognising a fixed list of leading words was the whole of the previous
   * test, so it saw only bare, unprefixed utilities. Every variant-prefixed
   * name (`dark:bg-gray-950`, `group-hover:opacity-75`, `@4xl:grid-cols-3`),
   * every arbitrary value (`w-[42px]`, `[--height:32px]`) and every descendant
   * variant (`[&>*]:p-6`, `**:[code]:pr-4`) fell through to hash detection,
   * where a vowel-poor fragment such as `xl:nth` reads as a build hash. On
   * tailwindcss.com that put 140 of 151 supposedly-hashed names in the wrong
   * bucket (def_0016).
   *
   * Utility frameworks are recognised by SYNTAX rather than vocabulary: an
   * unescaped colon, a bracketed arbitrary value, or a `*`/`@` variant marker
   * appears in no hand-written or bundler-generated class name.
   */
  function isUtilityClass(name) {
    if (!name) return false;
    // `!important` markers, written as a prefix in v3 and a suffix in v4.
    name = name.replace(/^!/, "").replace(/!$/, "");
    if (!name) return false;
    // Arbitrary values and custom-property references: `w-[42px]`,
    // `[--height:32px]`, `-left-(--gutter-width)`.
    if (/\[[^\]]*\]/.test(name) || /\(--[^)]*\)/.test(name)) return true;
    if (/^\*+:/.test(name) || name.charAt(0) === "@") return true;
    var base = stripVariants(name);
    if (base !== name) return true;
    // Negative utilities carry a leading minus that is part of the value.
    var bare = base.charAt(0) === "-" ? base.slice(1) : base;
    // An opacity or line-height modifier (`bg-black/5`, `text-3xl/12`) is
    // utility syntax, but only after a utility stem — a bare slash proves
    // nothing, so the stem is still required below.
    return UTILITY_WORD.test(bare) || UTILITY_PREFIX.test(bare);
  }

  /**
   * Is a single SEGMENT a build hash?
   *
   * Detecting whole-name patterns fails on every real bundler, because they
   * wrap a hash in readable text: `navbar-module-scss-module__nDHFQq__root`,
   * `ImRUSq_root`, `_5l06ia_content`. What identifies the hash is the segment
   * itself — mixed case with no word structure, or letters interleaved with
   * digits, and no vowels where a word would have them.
   */
  function isHashSegment(segment) {
    // Three characters, not four. CSS-modules hashes split into short segments
    // on `-` and `_`: `showcase-sites-module__oN_qsG__siteCard` yields `qsG`,
    // and linear.app yields `gUa` and `9La`. A four-character floor called all
    // of them readable and let them into selectors advertised as deploy-stable
    // (def_0019). Two-character fragments are still left alone.
    if (!segment || segment.length < 3) return false;
    if (/^\d+$/.test(segment)) return false;

    // A word does not begin with a digit. `0anzlac`, `3f9xk`, `5l06ia` are
    // bundler output; no hand-written class segment starts this way. Caught here
    // rather than by the randomness tests below, which a lowercase tail with an
    // ordinary vowel distribution passes cleanly (def_0021).
    if (/^\d/.test(segment) && /[a-z]/i.test(segment)) return true;

    var hasUpper = /[A-Z]/.test(segment);
    var hasLower = /[a-z]/.test(segment);
    var hasDigit = /\d/.test(segment);
    var vowels = (segment.match(/[aeiou]/gi) || []).length;
    var vowelRatio = vowels / segment.length;

    // Mixed case inside one segment is not how words are written, and applies
    // from four characters up — real hashes are often short (`mUeq`, `KOGVz`).
    // PascalCase is excluded, since `Root` and `Header` are words.
    if (hasUpper && hasLower && !/^[A-Z][a-z]+$/.test(segment)) return true;

    if (segment.length < 5) return false;
    // Letters and digits interleaved, rather than a trailing count like `col2`.
    if (hasDigit && /[a-z].*\d.*[a-z]|\d.*[a-z].*\d/i.test(segment)) return true;
    // Long enough to be a word, but with far too few vowels to be one.
    if (segment.length >= 6 && vowelRatio < 0.2) return true;

    return false;
  }

  /**
   * Bundler prefixes that identify a generated name by convention, whatever its
   * tail looks like.
   *
   * `jsx-tuhaukv` reads as a word — seven lowercase letters, three vowels — and
   * passes every randomness test, so it was classified readable and used as a
   * selector anchor across nine selectors in one build (def_0021). What
   * identifies it is the prefix, which is the styled-jsx convention and is not
   * something a person writes at the front of a hand-authored class name.
   *
   * `styles-` and `mod-` are deliberately absent: both are plausible
   * hand-written prefixes (`styles-dark`, `mod-compact`), and the cost of a
   * false positive on a hand-written site is higher than the cost of missing
   * one generated name that the randomness tests may still catch.
   */
  var BUNDLER_PREFIX = /^(?:css|jsx|emotion|sc)-[A-Za-z0-9]{4,}$/;

  function classifyClassName(name) {
    if (!name) return "unknown";
    if (isUtilityClass(name)) return "utility";
    if (BUNDLER_PREFIX.test(name)) return "hashed";

    // A leading underscore is a bundler convention, not part of a word.
    var segments = name.replace(/^[-_]+/, "").split(/[-_]+/).filter(Boolean);
    for (var i = 0; i < segments.length; i++) {
      if (isHashSegment(segments[i])) return "hashed";
    }
    // A bare name with no separators that still looks like noise.
    if (segments.length === 1 && isHashSegment(name.replace(/^[-_]+/, ""))) return "hashed";

    if (/^[a-z][a-z0-9]*(?:[-_]{1,2}[a-z0-9]+)*$/i.test(name) && !/\d{3,}/.test(name)) return "readable";
    return "unknown";
  }

  /**
   * Does any class in this selector make it unsafe to hand to an implementer?
   *
   * Two ways to fail, for two different reasons. A build hash is stable within
   * one deploy and gone in the next. A utility class survives deploys but names
   * presentation rather than identity: it is shared by unrelated elements, and
   * it changes the moment the design changes — `a.place-content-center` says
   * where a thing is aligned, not what it is (def_0017).
   */
  function selectorHasUnsafeClass(selector) {
    if (!selector) return false;
    // Utility syntax reaches well past `[A-Za-z0-9_-]`: `dark:bg-white/10`,
    // `[&>*]:p-6`, `w-(--gutter)`. A selector class runs to the next combinator.
    var classes = selector.match(/\.[^\s.>+~,[\]()]+(?:\([^)]*\)|\[[^\]]*\])?/g) || [];
    for (var i = 0; i < classes.length; i++) {
      var kind = classifyClassName(classes[i].slice(1));
      if (kind === "hashed" || kind === "utility") return true;
    }
    return false;
  }

  /** Retained for the hash-only question, which the class profile still asks. */
  function selectorHasGeneratedClass(selector) {
    if (!selector) return false;
    var classes = selector.match(/\.[A-Za-z0-9_-]+/g) || [];
    for (var i = 0; i < classes.length; i++) {
      if (classifyClassName(classes[i].slice(1)) === "hashed") return true;
    }
    return false;
  }

  function classProfile(el) {
    var classes = safe(function () {
      return (el.className && typeof el.className === "string" ? el.className : "")
        .trim().split(/\s+/).filter(Boolean);
    }, []);
    var profile = { total: classes.length, hashed: 0, readable: 0, utility: 0, unknown: 0 };
    for (var i = 0; i < classes.length; i++) profile[classifyClassName(classes[i])]++;
    return profile;
  }

  /**
   * A selector an implementer can actually write.
   *
   * Prefers stable anchors — id, data-* attributes, ARIA role, semantic tag —
   * and falls back to a structural nth-of-type path. Never emits a hashed
   * class, because `.jsx-t6yy8g0` is true today and meaningless after the next
   * deploy.
   */
  function stableSelectorFor(el) {
    if (!el || el.nodeType !== 1) return null;

    var parts = [];
    var node = el;
    var guard = 0;

    while (node && node.nodeType === 1 && node.tagName !== "BODY" && guard++ < 6) {
      var segment = node.tagName.toLowerCase();

      var dataAttr = safe(function () {
        for (var i = 0; i < node.attributes.length; i++) {
          var a = node.attributes[i];
          if (a.name.indexOf("data-") === 0 && a.value && a.value.length < 40) return a;
        }
        return null;
      }, null);

      if (node.id && classifyClassName(node.id) !== "hashed") {
        parts.unshift("#" + node.id);
        break;
      }
      if (dataAttr) {
        segment += "[" + dataAttr.name + "='" + dataAttr.value + "']";
        parts.unshift(segment);
        break;
      }

      var role = safe(function () { return node.getAttribute("role"); }, null);
      if (role) segment += "[role='" + role + "']";

      // A readable class is a legitimate anchor; a hashed one is not.
      var readable = safe(function () {
        return (typeof node.className === "string" ? node.className : "")
          .trim().split(/\s+/).filter(function (c) { return classifyClassName(c) === "readable"; });
      }, []);
      if (readable.length) {
        segment += "." + readable[0];
      } else {
        var parent = node.parentElement;
        if (parent) {
          var same = Array.prototype.filter.call(parent.children, function (c) {
            return c.tagName === node.tagName;
          });
          if (same.length > 1) segment += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
        }
      }

      parts.unshift(segment);
      node = node.parentElement;
    }

    var selector = parts.join(" > ");

    // Verify the finished selector rather than trusting the per-class decisions
    // that built it. A stable selector that still carries a build hash or a
    // utility class is worse than none, because it looks safe.
    if (selectorHasUnsafeClass(selector)) {
      var structural = [];
      var n = el;
      var g = 0;
      while (n && n.nodeType === 1 && n.tagName !== "BODY" && g++ < 6) {
        var seg = n.tagName.toLowerCase();
        var r = safe(function () { return n.getAttribute("role"); }, null);
        if (r) seg += "[role='" + r + "']";
        var p = n.parentElement;
        if (p) {
          var sib = Array.prototype.filter.call(p.children, function (c) { return c.tagName === n.tagName; });
          if (sib.length > 1) seg += ":nth-of-type(" + (sib.indexOf(n) + 1) + ")";
        }
        structural.unshift(seg);
        n = n.parentElement;
      }
      return structural.join(" > ");
    }

    return selector;
  }

  /* ---------------------------------------------------------------- utils */

  function safe(fn, fallback) {
    try {
      return fn();
    } catch (e) {
      return fallback;
    }
  }

  function round(n, dp) {
    var f = Math.pow(10, dp == null ? 2 : dp);
    return Math.round(n * f) / f;
  }

  function pxNum(v) {
    if (typeof v !== "string") return null;
    var m = v.match(/^(-?[\d.]+)px$/);
    return m ? round(parseFloat(m[1]), 3) : null;
  }

  function normColor(v) {
    if (!v || typeof v !== "string") return null;
    var s = v.trim();
    if (s === "transparent" || s === "rgba(0, 0, 0, 0)") return "transparent";
    var m = s.match(/^rgba?\(([^)]+)\)$/);
    if (!m) return s;
    var parts = m[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
    if (parts.length < 3 || parts.some(isNaN)) return s;
    var a = parts.length > 3 ? parts[3] : 1;
    if (a < 1) {
      return "rgba(" + parts[0] + ", " + parts[1] + ", " + parts[2] + ", " + round(a, 3) + ")";
    }
    return (
      "#" +
      parts
        .slice(0, 3)
        .map(function (n) {
          var h = Math.max(0, Math.min(255, Math.round(n))).toString(16);
          return h.length === 1 ? "0" + h : h;
        })
        .join("")
    );
  }

  /**
   * Escapes one identifier for use in a selector.
   *
   * A class name is not a selector fragment. Tailwind writes
   * `max-lg:px-[2.9vw]` into `class`, and the rule it generates escapes it as
   * `.max-lg\:px-\[2\.9vw\]`; joined raw, the same token reads as class
   * `.max-lg` followed by the pseudo-class `:px-[2.9vw]`, and `aspect-[0.95/1]`
   * opens an attribute selector. Pass 2 rejected 13 of 32 selectors on
   * produx.design for exactly this, and the primary component's surface came
   * back `unknown` on a page that had already been measured painting
   * `#d4cccc` (def_0052).
   *
   * `CSS.escape` is the browser's own answer and is used where present. The
   * fallback covers the same character class for any context without it.
   */
  function escapeIdent(token) {
    return safe(function () {
      if (typeof CSS !== "undefined" && CSS && typeof CSS.escape === "function") {
        return CSS.escape(token);
      }
      throw new Error("no CSS.escape");
    }, token.replace(/[^\w-]/g, function (ch) { return "\\" + ch; }));
  }

  function selectorFor(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.id) return "#" + escapeIdent(el.id);
    var tag = el.tagName.toLowerCase();
    var cls = safe(function () {
      return (el.className && typeof el.className === "string" ? el.className : "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    }, []);
    if (!cls.length) return tag;
    var escaped = [];
    for (var i = 0; i < cls.length; i++) escaped.push(escapeIdent(cls[i]));
    return tag + "." + escaped.join(".");
  }

  function domPathFor(el) {
    var parts = [];
    var node = el;
    var guard = 0;
    while (node && node.nodeType === 1 && node !== document.documentElement && guard++ < 40) {
      var tag = node.tagName.toLowerCase();
      var parent = node.parentElement;
      if (parent) {
        var same = Array.prototype.filter.call(parent.children, function (c) {
          return c.tagName === node.tagName;
        });
        if (same.length > 1) tag += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
      }
      parts.unshift(tag);
      node = node.parentElement;
    }
    return "html>" + parts.join(">");
  }

  /**
   * The grouping key for a repeat group — and, downstream, the selector pass 2
   * queries with, which is why every token is escaped here too.
   *
   * `selectorFor` was not the only place a selector got composed from raw class
   * names. This one feeds `significantSelectors`, so on produx.design the probe
   * received `.aspect-[0.95/1]...max-lg:px-[2.9vw]` — an attribute selector and
   * a pseudo-class as far as CSS is concerned — and rejected it, leaving the
   * primary component's surface `unknown` on a page whose background had already
   * been measured (def_0052). Escaping in one builder and not the other fixed
   * five of thirteen failures and none of the ones that mattered.
   */
  function signatureFor(el) {
    var cls = safe(function () {
      var tokens = (el.className && typeof el.className === "string" ? el.className : "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .sort();
      var escaped = [];
      for (var i = 0; i < tokens.length; i++) escaped.push(escapeIdent(tokens[i]));
      return escaped.join(".");
    }, "");
    return el.tagName.toLowerCase() + (cls ? "." + cls : "");
  }

  /* ------------------------------------------------- visibility judgement */

  /**
   * Why an element (and its subtree) should not be sampled.
   * Returning a reason lets coverage report WHAT was skipped, not just how much.
   */
  function hiddenReason(el, cs, rect, viewport) {
    if (!cs) return "no-computed-style";
    if (cs.display === "none") return "display-none";
    if (cs.visibility === "hidden" || cs.visibility === "collapse") return "visibility-hidden";
    if (safe(function () { return el.getAttribute("aria-hidden"); }, null) === "true") return "aria-hidden";
    if (safe(function () { return el.hasAttribute("inert"); }, false)) return "inert";
    if (safe(function () { return el.hasAttribute("hidden"); }, false)) return "hidden-attr";
    if (cs.opacity !== "" && parseFloat(cs.opacity) === 0) return "opacity-zero";

    // Checked before the generic zero-area test: a collapsed drawer and an
    // incidentally empty div are both zero-height, but only one of them is a
    // region of the page deliberately hidden from view. The coverage report is
    // far more useful when it can tell them apart.
    if (pxNum(cs.maxHeight) === 0) return "collapsed-max-height";
    if (cs.overflow === "hidden" && rect && rect.height <= 1 && el.children.length > 0) return "collapsed";

    if (!rect || rect.width <= 0 || rect.height <= 0) return "zero-area";
    if (cs.contentVisibility === "hidden") return "content-visibility-hidden";

    // Off-screen: entirely outside the document box in either axis.
    if (rect.bottom < 0 || rect.right < 0) return "off-screen";
    if (rect.left > viewport.docWidth + 1) return "off-screen";

    return null;
  }

  /* ------------------------------------------------- coherence signals ---
   *
   * Instrumentation, not grouping. These describe what a repeat group's
   * members have in common, so a group formed on shared class strings can be
   * checked against structure, geometry and role. Adding them must not change
   * which groups form.
   */

  /** Direct child tags in order — a component's internal shape. */
  function childTagSequence(el) {
    return safe(function () {
      return Array.prototype.map.call(el.children, function (c) { return c.tagName.toLowerCase(); })
        .slice(0, 8).join(",");
    }, "");
  }

  /** Coarse size band plus aspect shape. Very different sizes are rarely one component. */
  function geometryClass(rect) {
    if (!rect || rect.width <= 0 || rect.height <= 0) return "empty";
    var area = rect.width * rect.height;
    var band = Math.round(Math.log2(Math.max(area, 1)));
    var ratio = rect.width / rect.height;
    var shape = ratio > 3 ? "wide" : ratio < 0.4 ? "tall" : "block";
    return band + ":" + shape;
  }

  /** What a thing IS, as far as computed style describes it. */
  function styleFingerprint(cs) {
    if (!cs) return "";
    var bg = normColor(cs.backgroundColor);
    return [
      cs.display,
      cs.position,
      cs.flexDirection || "-",
      (cs.gridTemplateColumns && cs.gridTemplateColumns !== "none") ? "grid" : "-",
      pxNum(cs.borderTopLeftRadius) > 0 ? "r" : "-",
      (bg && bg !== "transparent") ? "bg" : "-",
      (cs.boxShadow && cs.boxShadow !== "none") ? "sh" : "-",
      pxNum(cs.paddingTop) > 0 ? "p" : "-",
      cs.fontSize,
      cs.fontWeight
    ].join("|");
  }

  var IMPLICIT_ROLE = {
    A: "link", BUTTON: "button", NAV: "navigation", MAIN: "main", HEADER: "banner",
    FOOTER: "contentinfo", ARTICLE: "article", SECTION: "region", LI: "listitem",
    UL: "list", OL: "list", TABLE: "table", TR: "row", TD: "cell", TH: "columnheader",
    IMG: "img", FORM: "form", INPUT: "textbox", H1: "heading", H2: "heading",
    H3: "heading", H4: "heading", P: "paragraph", SPAN: "generic", DIV: "generic"
  };

  function semanticRole(el) {
    var explicit = safe(function () { return el.getAttribute("role"); }, null);
    if (explicit) return explicit;
    return IMPLICIT_ROLE[el.tagName] || "generic";
  }

  /** Tags that behave alike for coherence purposes. */
  var TAG_FAMILY = {
    DIV: "container", SECTION: "container", ARTICLE: "container", ASIDE: "container",
    MAIN: "container", HEADER: "container", FOOTER: "container", NAV: "container",
    LI: "listitem", UL: "list", OL: "list",
    A: "interactive", BUTTON: "interactive", INPUT: "interactive", SELECT: "interactive",
    P: "text", SPAN: "text", H1: "text", H2: "text", H3: "text", H4: "text", H5: "text",
    H6: "text", LABEL: "text", STRONG: "text", EM: "text",
    IMG: "media", PICTURE: "media", VIDEO: "media", CANVAS: "media"
  };

  function tagFamily(tag) {
    return TAG_FAMILY[tag] || "other";
  }

  function paints(cs) {
    if (!cs) return false;
    var bg = normColor(cs.backgroundColor);
    var hasBg = bg && bg !== "transparent";
    var hasImg = cs.backgroundImage && cs.backgroundImage !== "none";
    return !!(hasBg || hasImg);
  }

  /* ------------------------------------------------------------- regions */

  var SEMANTIC_TAGS = {
    ARTICLE: 3, SECTION: 2, LI: 2, TABLE: 3, FORM: 3, FIGURE: 2,
    H1: 3, H2: 3, H3: 2, H4: 2, H5: 1, H6: 1,
    P: 2, IMG: 2, PICTURE: 2, VIDEO: 2, BUTTON: 2, A: 1, INPUT: 2, LABEL: 1
  };

  function regionOf(el) {
    var node = el;
    var guard = 0;
    while (node && node.nodeType === 1 && guard++ < 60) {
      var tag = node.tagName;
      if (tag === "MAIN") return "main";
      if (tag === "HEADER") return "header";
      if (tag === "FOOTER") return "footer";
      if (tag === "NAV") return "nav";
      if (tag === "ASIDE") return "aside";
      var role = safe(function () { return node.getAttribute("role"); }, null);
      if (role === "main") return "main";
      if (role === "banner") return "header";
      if (role === "contentinfo") return "footer";
      if (role === "navigation") return "nav";
      node = node.parentElement;
    }
    return "other";
  }

  /**
   * The page's primary content region.
   * Prefers <main>/[role=main]; otherwise the largest visible block that is not
   * inside a header, footer or nav — because a page without <main> still has
   * content, and refusing to look for it would be its own kind of blindness.
   */
  function findPrimaryRegion(viewport) {
    var explicit = safe(function () {
      return document.querySelector("main, [role='main']");
    }, null);
    if (explicit) {
      return { el: explicit, kind: "explicit-main", selector: selectorFor(explicit) };
    }

    var best = null;
    var candidates = safe(function () {
      return Array.prototype.slice.call(document.querySelectorAll("body > *, body > * > *"));
    }, []);

    candidates.forEach(function (el) {
      var cs = safe(function () { return getComputedStyle(el); }, null);
      var rect = safe(function () { return el.getBoundingClientRect(); }, null);
      if (hiddenReason(el, cs, rect, viewport)) return;
      var region = regionOf(el);
      if (region === "header" || region === "footer" || region === "nav") return;
      var area = rect.width * rect.height;
      var textLen = safe(function () { return (el.innerText || "").trim().length; }, 0);
      var score = area * (1 + Math.min(textLen, 4000) / 4000);
      if (!best || score > best.score) {
        best = { el: el, score: score, selector: selectorFor(el) };
      }
    });

    if (best) return { el: best.el, kind: "inferred-largest-block", selector: best.selector };
    return { el: document.body, kind: "fallback-body", selector: "body" };
  }

  /* ----------------------------------------------------------- histograms */

  function Histogram() {
    this.map = Object.create(null);
  }
  Histogram.prototype.add = function (value, selector, meta) {
    if (value == null || value === "" || value === "none" || value === "normal") return;
    var key = String(value);
    var entry = this.map[key];
    if (!entry) {
      entry = this.map[key] = { value: key, count: 0, samples: [], meta: Object.create(null) };
    }
    entry.count++;
    if (entry.samples.length < SAMPLES_PER_ENTRY && selector && entry.samples.indexOf(selector) === -1) {
      entry.samples.push(selector);
    }
    if (meta) {
      for (var k in meta) {
        if (!Object.prototype.hasOwnProperty.call(meta, k)) continue;
        if (!meta[k]) continue;
        entry.meta[k] = (entry.meta[k] || 0) + meta[k];
      }
    }
    return entry;
  };
  Histogram.prototype.toArray = function () {
    var out = [];
    for (var k in this.map) out.push(this.map[k]);
    out.sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
    });
    return out.slice(0, HISTOGRAM_CAP).map(function (e) {
      var meta = Object.keys(e.meta).length ? e.meta : undefined;
      return { value: e.value, count: e.count, samples: e.samples, roles: meta };
    });
  };

  /* ------------------------------------------------------ stylesheet pass */

  function harvestStylesheets() {
    var out = {
      total: 0,
      accessible: 0,
      blocked: [],
      customProperties: [],
      fontFaces: [],
      keyframes: [],
      keyframeDetail: [],
      mediaQueries: [],
      breakpointRules: []
    };
    var seenRule = Object.create(null);
    var seenProp = Object.create(null);

    /* A stylesheet the capture apparatus injected is not one of the page's own.
     * Counting it inflates the sheet total that coverage is computed from, so
     * the capture would report confidence in evidence about itself (def_0032). */
    var sheets = safe(function () {
      return Array.prototype.slice.call(document.styleSheets).filter(function (s) {
        var node = s.ownerNode;
        return !(node && node.getAttribute && node.getAttribute("data-helmy-apparatus"));
      });
    }, []);
    out.total = sheets.length;

    function walk(rules, mediaContext) {
      for (var i = 0; i < rules.length; i++) {
        var rule = rules[i];
        var type = rule.type;

        if (type === 1 && rule.style) {
          for (var j = 0; j < rule.style.length; j++) {
            var prop = rule.style[j];
            if (prop && prop.indexOf("--") === 0) {
              var key = rule.selectorText + "|" + prop;
              if (seenProp[key]) continue;
              seenProp[key] = 1;
              out.customProperties.push({
                name: prop,
                value: safe(function () {
                  return rule.style.getPropertyValue(prop).trim();
                }, ""),
                scope: rule.selectorText,
                media: mediaContext || null
              });
            }
          }
        } else if (type === 4 && rule.media) {
          var cond = safe(function () {
            return rule.conditionText || rule.media.mediaText;
          }, "");
          if (cond && out.mediaQueries.indexOf(cond) === -1) out.mediaQueries.push(cond);

          // Direction is preserved: `max-width: 599px` and `min-width: 600px`
          // describe ONE boundary, and collapsing them requires knowing which
          // side each came from.
          var featureRe = /(min|max)-width\s*:\s*([\d.]+)(px|rem|em)/g;
          var m;
          while ((m = featureRe.exec(cond)) !== null) {
            var n = parseFloat(m[2]);
            if (m[3] !== "px") n = n * 16;
            var ruleKey = m[1] + ":" + n;
            if (seenRule[ruleKey]) continue;
            seenRule[ruleKey] = 1;
            out.breakpointRules.push({
              value: round(n, 2),
              direction: m[1],
              unit: m[3],
              condition: cond
            });
          }
          walk(safe(function () { return rule.cssRules; }, []) || [], cond);
        } else if (type === 5) {
          out.fontFaces.push({
            family: safe(function () { return rule.style.getPropertyValue("font-family").trim(); }, ""),
            src: safe(function () { return rule.style.getPropertyValue("src").trim(); }, ""),
            weight: safe(function () { return rule.style.getPropertyValue("font-weight").trim(); }, ""),
            display: safe(function () { return rule.style.getPropertyValue("font-display").trim(); }, "")
          });
        } else if (type === 7 && rule.name) {
          if (out.keyframes.indexOf(rule.name) === -1) out.keyframes.push(rule.name);

          /* The STEPS, not only the name.
           *
           * A name tells a builder that something called `fade-up` exists. The
           * offsets and the properties each step sets are what makes it
           * reproducible, and they are ordinary stylesheet rules — no less
           * readable than the custom properties collected above.
           *
           * Capped per rule: a keyframe animation with hundreds of steps is
           * generated rather than authored, and the whole of it would not help
           * anyone. */
          if (!out.keyframeDetail.some(function (k) { return k.name === rule.name; })) {
            var steps = [];
            var kfRules = safe(function () { return rule.cssRules; }, null);
            if (kfRules) {
              for (var s = 0; s < kfRules.length && steps.length < 12; s++) {
                var step = kfRules[s];
                var declared = {};
                var declCount = 0;
                var stepStyle = safe(function () { return step.style; }, null);
                if (stepStyle) {
                  for (var d = 0; d < stepStyle.length && declCount < 12; d++) {
                    var dprop = stepStyle[d];
                    declared[dprop] = safe(function () {
                      return stepStyle.getPropertyValue(dprop).trim();
                    }, "");
                    declCount++;
                  }
                }
                steps.push({
                  offset: safe(function () { return step.keyText; }, null),
                  declarations: declared
                });
              }
            }
            out.keyframeDetail.push({
              name: rule.name,
              steps: steps,
              /* Whether the rule body was reachable at all. A cross-origin sheet
               * throws before this point, but a rule with no readable body is a
               * different condition and reads the same from the outside. */
              readable: kfRules !== null
            });
          }
        } else if (rule.cssRules) {
          walk(safe(function () { return rule.cssRules; }, []) || [], mediaContext);
        }
      }
    }

    sheets.forEach(function (sheet) {
      var rules = null;
      try {
        rules = sheet.cssRules;
      } catch (e) {
        out.blocked.push(safe(function () { return sheet.href; }, "unknown") || "inline");
        return;
      }
      if (!rules) {
        out.blocked.push(safe(function () { return sheet.href; }, "unknown") || "inline");
        return;
      }
      out.accessible++;
      safe(function () { walk(rules, null); }, null);
    });

    out.breakpointRules.sort(function (a, b) {
      if (a.value !== b.value) return a.value - b.value;
      return a.direction < b.direction ? -1 : 1;
    });

    var rootCs = safe(function () { return getComputedStyle(document.documentElement); }, null);
    if (rootCs) {
      out.customProperties.forEach(function (p) {
        p.resolved = safe(function () { return rootCs.getPropertyValue(p.name).trim(); }, "");
      });
    }
    return out;
  }

  /* ------------------------------------------------------- the tree walk */

  /**
   * Walks the document, skipping hidden SUBTREES entirely rather than paying
   * for their descendants. Records every node it declined to enter and why.
   */
  function surveyDocument(viewport, primaryEl) {
    var visible = [];
    var hidden = { subtrees: 0, nodesSkipped: 0, byReason: Object.create(null), roots: [] };
    var overlays = [];
    var consentBanners = [];
    var totalNodes = safe(function () { return document.querySelectorAll("body *").length; }, 0);

    var stack = [];
    var body = document.body;
    if (body) {
      for (var i = body.children.length - 1; i >= 0; i--) stack.push(body.children[i]);
    }

    var guard = 0;
    while (stack.length && guard++ < 40000) {
      var el = stack.pop();
      var cs = safe(function () { return getComputedStyle(el); }, null);
      var rect = safe(function () { return el.getBoundingClientRect(); }, null);
      var reason = hiddenReason(el, cs, rect, viewport);

      if (reason) {
        hidden.subtrees++;
        hidden.byReason[reason] = (hidden.byReason[reason] || 0) + 1;
        var subtreeSize = safe(function () { return el.querySelectorAll("*").length + 1; }, 1);
        hidden.nodesSkipped += subtreeSize;
        // The root's identity is recorded — not its descendants — so that a
        // repeat group can report how many siblings sharing its signature were
        // never visible. Without this the visible/hidden signal is unmeasurable,
        // since hidden subtrees are skipped wholesale.
        if (COHERENCE_ENABLED && hidden.roots.length < 400) {
          hidden.roots.push({
            parentSelector: el.parentElement ? selectorFor(el.parentElement) : null,
            signature: signatureFor(el),
            reason: reason
          });
        }
        continue; // do not descend
      }

      var region = regionOf(el);
      var area = round(rect.width * rect.height, 0);
      var sel = selectorFor(el);
      var zIndex = cs.zIndex && cs.zIndex !== "auto" ? parseInt(cs.zIndex, 10) : null;

      // Overlays and consent banners are recorded as page facts, then
      // down-ranked: they sit above content but are not content.
      var isFixed = cs.position === "fixed" || cs.position === "sticky";
      if (isFixed && zIndex !== null && zIndex >= 10 && rect.width > 200 && rect.height > 40) {
        overlays.push({
          selector: sel, zIndex: zIndex, position: cs.position,
          width: round(rect.width), height: round(rect.height), region: region
        });
      }
      var idClass = (el.id || "") + " " + (typeof el.className === "string" ? el.className : "");
      var ariaLabel = safe(function () { return el.getAttribute("aria-label") || ""; }, "");
      if (CONSENT_PATTERN.test(idClass + " " + ariaLabel) && rect.width > 100 && rect.height > 30) {
        consentBanners.push({
          selector: sel, width: round(rect.width), height: round(rect.height), region: region
        });
      }

      var textLen = 0;
      safe(function () {
        for (var n = 0; n < el.childNodes.length; n++) {
          if (el.childNodes[n].nodeType === 3) textLen += el.childNodes[n].nodeValue.trim().length;
        }
      }, null);

      visible.push({
        el: el,
        cs: cs,
        rect: rect,
        selector: sel,
        region: region,
        area: area,
        paints: paints(cs),
        paintsImage: !!(cs.backgroundImage && cs.backgroundImage !== "none"),
        aboveFold: rect.top < viewport.height,
        semantic: SEMANTIC_TAGS[el.tagName] || 0,
        ownText: textLen,
        inPrimary: primaryEl ? safe(function () { return primaryEl.contains(el); }, false) : false,
        isOverlay: isFixed && zIndex !== null && zIndex >= 10,
        inNavContainer: NAV_CONTAINER_PATTERN.test(idClass),
        signature: signatureFor(el),
        parentSelector: el.parentElement ? selectorFor(el.parentElement) : null,
        /* coherence signals — measurement only */
        tag: COHERENCE_ENABLED ? el.tagName : null,
        tagFamily: COHERENCE_ENABLED ? tagFamily(el.tagName) : null,
        childTags: COHERENCE_ENABLED ? childTagSequence(el) : null,
        geometryClass: COHERENCE_ENABLED ? geometryClass(rect) : null,
        styleFingerprint: COHERENCE_ENABLED ? styleFingerprint(cs) : null,
        semanticRole: COHERENCE_ENABLED ? semanticRole(el) : null
      });

      for (var c = el.children.length - 1; c >= 0; c--) stack.push(el.children[c]);
    }

    return {
      visible: visible,
      hidden: hidden,
      overlays: overlays.slice(0, 20),
      consentBanners: consentBanners.slice(0, 10),
      totalNodes: totalNodes
    };
  }

  /* --------------------------------------------------- group coherence ---
   *
   * A repeat group is formed on `parentSelector + signature`. On a BEM site the
   * signature names the component. On a utility-class site it may name nothing
   * at all — `div.flex.items-center.gap-2` describes a hundred unrelated
   * things. These signals measure whether the members of a group actually
   * resemble each other, so that a group formed on a weak name can be checked
   * against structure, geometry, role and region.
   *
   * This is measurement. It records what a group looks like; it does not change
   * which groups are formed, and nothing here feeds the score.
   */

  /* Every field this section adds is gated on one flag, so that "instrumentation
   * does not change grouping" is testable by capturing the same page twice
   * rather than asserted by reading the code. */
  var COHERENCE_ENABLED = safe(function () { return !window.__HELMY_NO_COHERENCE__; }, true);

  function tally(values) {
    var counts = Object.create(null);
    for (var i = 0; i < values.length; i++) {
      var v = values[i] == null ? "" : String(values[i]);
      counts[v] = (counts[v] || 0) + 1;
    }
    var keys = Object.keys(counts);
    var dominant = 0;
    var dominantValue = null;
    for (var j = 0; j < keys.length; j++) {
      if (counts[keys[j]] > dominant) { dominant = counts[keys[j]]; dominantValue = keys[j]; }
    }
    return {
      distinct: keys.length,
      dominantShare: values.length ? round(dominant / values.length, 3) : 0,
      // The value itself, not just how concentrated it is. Cross-build matching
      // needs to compare "what shape is this" across two captures, and a share
      // without a value says only that the group agrees with itself.
      dominantValue: dominantValue,
      counts: counts
    };
  }

  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    var idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
    return sorted[idx];
  }

  function coherenceOf(bucket, hiddenRoots) {
    var members = bucket.members;
    var n = members.length;
    if (!n) return null;

    var areas = members.map(function (m) { return m.area; }).sort(function (a, b) { return a - b; });
    var p10 = percentile(areas, 0.1);
    var p90 = percentile(areas, 0.9);

    var tagFam = tally(members.map(function (m) { return m.tagFamily; }));
    var tags = tally(members.map(function (m) { return m.tag; }));
    var regions = tally(members.map(function (m) { return m.region; }));
    var childSeq = tally(members.map(function (m) { return m.childTags; }));
    var geo = tally(members.map(function (m) { return m.geometryClass; }));
    var style = tally(members.map(function (m) { return m.styleFingerprint; }));
    var roles = tally(members.map(function (m) { return m.semanticRole; }));

    var textBearing = 0;
    for (var i = 0; i < n; i++) if (members[i].ownText > 0) textBearing++;
    var textProportion = round(textBearing / n, 3);

    var hiddenMatches = 0;
    var key = bucket.parentSelector + " >> " + bucket.signature;
    for (var h = 0; h < hiddenRoots.length; h++) {
      if (hiddenRoots[h].parentSelector + " >> " + hiddenRoots[h].signature === key) hiddenMatches++;
    }

    var signals = {
      matchCount: bucket.count,
      membersSampled: n,
      /* `distinct` is 1 by construction, because the signature a group is keyed
       * on begins with the tag name. It is recorded as an invariant, not as a
       * live signal: if it ever exceeds 1 the grouping key has changed and the
       * rest of these numbers describe something other than what they claim.
       * Identity disagreement is therefore carried by semanticRole, which can
       * vary within one tag through an explicit `role` attribute. */
      tagDiversity: { distinct: tags.distinct, familyDistinct: tagFam.distinct, dominantShare: tagFam.dominantShare, invariant: tags.distinct === 1 },
      parentRegionDiversity: { distinct: regions.distinct, dominantShare: regions.dominantShare },
      childTagSequenceDiversity: {
        distinct: childSeq.distinct,
        dominantShare: childSeq.dominantShare,
        dominantValue: childSeq.dominantValue,
        distinctRatio: round(childSeq.distinct / n, 3)
      },
      textBearingProportion: textProportion,
      areaMedian: round(percentile(areas, 0.5), 0),
      areaSpread: { p10: round(p10, 0), p90: round(p90, 0), ratio: round(p90 / Math.max(p10, 1), 2) },
      geometryClassDiversity: { distinct: geo.distinct, dominantShare: geo.dominantShare, dominantValue: geo.dominantValue },
      styleFingerprintDiversity: { distinct: style.distinct, dominantShare: style.dominantShare, dominantValue: style.dominantValue },
      semanticRoleDiversity: { distinct: roles.distinct, dominantShare: roles.dominantShare, dominantValue: roles.dominantValue },
      contentRegionDistribution: regions.counts,
      visibleHiddenDistribution: { visible: bucket.count, hiddenSiblingSubtrees: hiddenMatches }
    };

    /* Which signals disagree materially.
     *
     * Grouped into independent families, because tag and role measure the same
     * underlying thing, as do area spread and geometry class, and as do the two
     * region views. Counting them separately would let one disagreement present
     * itself as three. */
    var disagreements = [];

    if (roles.dominantShare < 0.85) {
      disagreements.push({
        family: "identity",
        detail: "members disagree on semantic role",
        roleDominantShare: roles.dominantShare
      });
    }
    if (regions.distinct > 1 && regions.dominantShare < 0.9) {
      disagreements.push({
        family: "region",
        detail: "members occupy more than one page region",
        distinct: regions.distinct,
        dominantShare: regions.dominantShare
      });
    }
    if (n >= 4 && childSeq.distinct >= 4 && childSeq.distinct / n > 0.5) {
      disagreements.push({
        family: "structure",
        detail: "members have unrelated internal child structure",
        distinctRatio: round(childSeq.distinct / n, 3)
      });
    }
    if (signals.areaSpread.ratio > 8 || geo.dominantShare < 0.5) {
      disagreements.push({
        family: "geometry",
        detail: "members differ by size band or aspect shape",
        areaRatio: signals.areaSpread.ratio,
        geometryDominantShare: geo.dominantShare
      });
    }
    if (style.dominantShare < 0.6) {
      disagreements.push({
        family: "style",
        detail: "members do not share a computed-style fingerprint",
        dominantShare: style.dominantShare
      });
    }
    if (textProportion > 0.15 && textProportion < 0.85) {
      disagreements.push({
        family: "content",
        detail: "some members carry text and some do not",
        textBearingProportion: textProportion
      });
    }

    signals.disagreements = disagreements;
    signals.disagreementFamilies = disagreements.length;
    signals.potentiallyIncoherent = disagreements.length >= 2;
    return signals;
  }

  /* ------------------------------------------------------ repeat grouping */

  function detectRepeats(visible, viewport, hiddenRoots) {
    var buckets = Object.create(null);
    visible.forEach(function (v) {
      if (!v.parentSelector) return;
      var key = v.parentSelector + " >> " + v.signature;
      var b = buckets[key];
      if (!b) {
        b = buckets[key] = {
          signature: v.signature,
          parentSelector: v.parentSelector,
          count: 0,
          area: 0,
          totalArea: 0,
          region: v.region,
          inPrimary: v.inPrimary,
          inNavContainer: v.inNavContainer,
          paintedCount: 0,
          textBearing: 0,
          fullBleedCount: 0,
          semantic: v.semantic,
          classProfile: classProfile(v.el),
          stableSelector: stableSelectorFor(v.el),
          sampleRect: { width: v.rect.width, height: v.rect.height },
          sampleDomPath: null,
          members: []
        };
      }
      b.count++;
      b.area = Math.max(b.area, v.area);
      b.totalArea += v.area;
      if (v.paints) b.paintedCount++;
      if (v.ownText > 0) b.textBearing++;
      if (v.rect.width >= viewport.width * 0.95) b.fullBleedCount++;
      if (b.members.length < 60) b.members.push(v);
      if (!b.sampleDomPath) b.sampleDomPath = domPathFor(v.el);
    });

    var out = [];
    for (var k in buckets) {
      var b = buckets[k];
      if (b.count < 3) continue;

      // Area is capped and full-bleed groups are penalised, because otherwise a
      // handful of full-width section backgrounds outscore dozens of real
      // components: sqrt(viewport-sized area) swamps any plausible instance
      // count. A component repeats often and occupies a bounded box; a section
      // wrapper repeats rarely and spans the viewport.
      var AREA_CAP = 200000;
      var fullBleedRatio = b.fullBleedCount / b.count;

      /* Count is damped exactly as area is.
       *
       * Capping area (above) fixed section backgrounds outscoring components,
       * and left the opposite door open: count stayed linear and unbounded, so
       * `div.shrink-0.tick-bar` — 250 decorative ticks whose largest instance is
       * 44 square pixels — outscored a testimonial card of 177,282 at three
       * instances, and became the primary component of produx.design
       * (def_0053). A 4000-fold difference in area lost to an 83-fold
       * difference in count.
       *
       * Square-rooting both makes them commensurate: four times the repetition
       * counts for twice the significance, exactly as four times the area does.
       * Measured against every capture in this repository before adopting —
       * selection is unchanged on p30, mega-menu, stripe-pricing and the
       * controlled fixture, whose serialised ordering is also unchanged, so the
       * forensic golden is untouched. */
      b.score =
        Math.sqrt(b.count) *
        Math.sqrt(Math.min(Math.max(b.area, 1), AREA_CAP)) *
        (b.inPrimary ? 4 : 1) *
        (b.region === "main" ? 3 : b.region === "nav" || b.region === "header" ? 0.25 : 1) *
        (b.inNavContainer ? 0.25 : 1) *
        (b.paintedCount > 0 ? 1.5 : 0.6) *
        (fullBleedRatio > 0.5 ? 0.25 : 1) *
        (b.textBearing > 0 ? 1.3 : 1) *
        (1 + b.semantic / 3);

      // Attached after scoring, and deliberately not an input to it: this pass
      // must describe the grouping, never steer it.
      b.coherence = COHERENCE_ENABLED ? coherenceOf(b, hiddenRoots || []) : null;
      out.push(b);
    }
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }

  /* -------------------------------------------------- stratified sampling */

  function rankFor(v) {
    // Visible importance: painted area, above the fold, semantic weight, text.
    return (
      Math.sqrt(Math.max(v.area, 1)) *
      (v.paints ? 1.5 : 1) *
      (v.aboveFold ? 1.4 : 1) *
      (1 + v.semantic / 2) *
      (1 + Math.min(v.ownText, 400) / 400) *
      (v.isOverlay ? 0.15 : 1) *
      (v.inNavContainer ? 0.3 : 1)
    );
  }

  function stratifiedSample(visible, repeats, cap) {
    var byRegion = { main: [], header: [], footer: [], other: [] };
    visible.forEach(function (v) {
      if (v.inPrimary || v.region === "main") byRegion.main.push(v);
      else if (v.region === "header" || v.region === "nav") byRegion.header.push(v);
      else if (v.region === "footer") byRegion.footer.push(v);
      else byRegion.other.push(v);
    });

    Object.keys(byRegion).forEach(function (k) {
      byRegion[k].sort(function (a, b) { return rankFor(b) - rankFor(a); });
    });

    var chosen = [];
    var seen = new Set ? new Set() : null;
    var seenFallback = [];
    function take(v) {
      if (seen) {
        if (seen.has(v.el)) return false;
        seen.add(v.el);
      } else {
        if (seenFallback.indexOf(v.el) !== -1) return false;
        seenFallback.push(v.el);
      }
      chosen.push(v);
      return true;
    }

    var strataFill = {};
    var budgets = {};
    STRATA.forEach(function (s) { budgets[s.name] = Math.floor(cap * s.share); });

    // repeat-group stratum first: these are the component candidates
    var repeatFilled = 0;
    for (var r = 0; r < repeats.length && repeatFilled < budgets.repeats; r++) {
      var members = repeats[r].members;
      for (var m = 0; m < members.length && repeatFilled < budgets.repeats; m++) {
        if (take(members[m])) repeatFilled++;
      }
    }
    strataFill.repeats = { budget: budgets.repeats, filled: repeatFilled };

    ["main", "header", "footer"].forEach(function (name) {
      var pool = byRegion[name];
      var budget = budgets[name];
      var filled = 0;
      for (var i = 0; i < pool.length && filled < budget; i++) {
        if (take(pool[i])) filled++;
      }
      strataFill[name] = { budget: budget, filled: filled, available: pool.length };
    });

    // random stratum: deterministic stride over the remainder
    var remainder = byRegion.other.concat(byRegion.main, byRegion.header, byRegion.footer);
    var randomBudget = budgets.random;
    var randomFilled = 0;
    var stride = Math.max(1, Math.floor(remainder.length / Math.max(randomBudget, 1)));
    for (var i2 = 0; i2 < remainder.length && randomFilled < randomBudget; i2 += stride) {
      if (take(remainder[i2])) randomFilled++;
    }
    strataFill.random = { budget: randomBudget, filled: randomFilled };

    // Spend any unfilled budget on the highest-ranked unsampled content.
    if (chosen.length < cap) {
      var spillover = byRegion.main.concat(byRegion.other, byRegion.footer, byRegion.header);
      for (var s2 = 0; s2 < spillover.length && chosen.length < cap; s2++) take(spillover[s2]);
    }
    strataFill.spillover = { filled: chosen.length - (repeatFilled + strataFill.main.filled + strataFill.header.filled + strataFill.footer.filled + randomFilled) };

    return { chosen: chosen, strata: strataFill, byRegion: byRegion };
  }

  /* ============================================================== extract */

  function extract() {
    var started = Date.now();
    var viewport = {
      width: safe(function () { return window.innerWidth; }, null),
      height: safe(function () { return window.innerHeight; }, 900),
      docWidth: safe(function () { return document.documentElement.scrollWidth; }, 0)
    };

    var primary = findPrimaryRegion(viewport);
    var survey = surveyDocument(viewport, primary.el);
    var repeats = detectRepeats(survey.visible, viewport, survey.hidden.roots);
    var sample = stratifiedSample(survey.visible, repeats, NODE_CAP);
    var nodes = sample.chosen;

    var hist = {
      color: new Histogram(),
      fontFamily: new Histogram(),
      fontSize: new Histogram(),
      fontWeight: new Histogram(),
      lineHeight: new Histogram(),
      letterSpacing: new Histogram(),
      textTransform: new Histogram(),
      spacing: new Histogram(),
      gap: new Histogram(),
      radius: new Histogram(),
      shadow: new Histogram(),
      borderWidth: new Histogram(),
      borderColor: new Histogram(),
      zIndex: new Histogram(),
      opacity: new Histogram(),
      transitionDuration: new Histogram(),
      transitionEasing: new Histogram(),
      transitionProperty: new Histogram(),
      animationName: new Histogram(),
      animationDuration: new Histogram(),
      animationEasing: new Histogram()
    };

    var containers = [];
    var grids = [];
    var sticky = [];
    var fixedEls = [];
    var images = [];
    var sampledByRegion = { main: 0, header: 0, footer: 0, nav: 0, aside: 0, other: 0 };
    var sampledInPrimary = 0;

    /* Per-element DECLARED motion.
     *
     * Declared is the whole scope. Every value here is read from computed style
     * — what the stylesheet says about this element — and none of it says when,
     * why, or whether anything ever runs. An `animation-name` is a declaration;
     * whether it fires on load, on scroll, or never is not visible from here and
     * is not inferred anywhere downstream.
     *
     * Capped, because unlike images a page can declare a transition on
     * thousands of elements and this array would then dominate the capture. The
     * cap is recorded next to the list so truncation is a reported fact rather
     * than a silent one. */
    var MOTION_CAP = 200;
    var motion = [];
    var motionSeen = 0;

    nodes.forEach(function (v) {
      var el = v.el;
      var cs = v.cs;
      var rect = v.rect;
      var sel = v.selector;

      sampledByRegion[v.region] = (sampledByRegion[v.region] || 0) + 1;
      if (v.inPrimary) sampledInPrimary++;

      var bg = normColor(cs.backgroundColor);
      if (bg && bg !== "transparent") hist.color.add(bg, sel, { background: 1 });
      var fg = normColor(cs.color);
      if (fg) hist.color.add(fg, sel, { text: 1 });

      hist.fontFamily.add(cs.fontFamily, sel);
      hist.fontSize.add(cs.fontSize, sel);
      hist.fontWeight.add(cs.fontWeight, sel);
      hist.lineHeight.add(cs.lineHeight, sel);
      if (cs.letterSpacing && cs.letterSpacing !== "normal") hist.letterSpacing.add(cs.letterSpacing, sel);
      if (cs.textTransform && cs.textTransform !== "none") hist.textTransform.add(cs.textTransform, sel);

      var elMaxW = pxNum(cs.maxWidth);
      var autoCentred =
        !!elMaxW && cs.marginLeft === cs.marginRight && (pxNum(cs.marginLeft) || 0) > 0;

      ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
       "marginTop", "marginRight", "marginBottom", "marginLeft"].forEach(function (p) {
        if (autoCentred && (p === "marginLeft" || p === "marginRight")) return;
        var n = pxNum(cs[p]);
        if (!n || n <= 0) return;
        var isPadding = p.indexOf("padding") === 0;
        hist.spacing.add(n + "px", sel, isPadding ? { padding: 1 } : { margin: 1 });
      });
      ["rowGap", "columnGap"].forEach(function (p) {
        var n = pxNum(cs[p]);
        if (n && n > 0) {
          hist.gap.add(n + "px", sel);
          hist.spacing.add(n + "px", sel, { gap: 1 });
        }
      });

      var radii = [cs.borderTopLeftRadius, cs.borderTopRightRadius,
                   cs.borderBottomRightRadius, cs.borderBottomLeftRadius];
      var uniform = radii.every(function (r) { return r === radii[0]; });
      if (uniform) {
        var rn = pxNum(radii[0]);
        if (rn && rn > 0) hist.radius.add(radii[0], sel, { painted: v.paints ? 1 : 0 });
      } else {
        hist.radius.add(radii.join(" "), sel);
      }

      if (cs.boxShadow && cs.boxShadow !== "none") hist.shadow.add(cs.boxShadow, sel);

      ["borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"].forEach(function (p) {
        var n = pxNum(cs[p]);
        if (n && n > 0) hist.borderWidth.add(n + "px", sel);
      });

      // A border colour equal to the element's own text colour is almost always
      // the CSS `currentColor` default, not an authored border. Tag it so the
      // evidence layer can refuse to promote it to a token.
      if (pxNum(cs.borderTopWidth) > 0 || pxNum(cs.borderLeftWidth) > 0) {
        var bc = normColor(cs.borderTopColor) || normColor(cs.borderLeftColor);
        var style = cs.borderTopStyle && cs.borderTopStyle !== "none" ? cs.borderTopStyle : null;
        if (bc && bc !== "transparent" && style) {
          hist.borderColor.add(bc, sel, {
            authored: bc !== fg ? 1 : 0,
            currentColor: bc === fg ? 1 : 0
          });
        }
      }

      if (cs.zIndex && cs.zIndex !== "auto") hist.zIndex.add(cs.zIndex, sel);
      if (cs.opacity && cs.opacity !== "1") hist.opacity.add(cs.opacity, sel);

      if (cs.transitionDuration && cs.transitionDuration !== "0s") {
        cs.transitionDuration.split(",").forEach(function (d) { hist.transitionDuration.add(d.trim(), sel); });
        if (cs.transitionTimingFunction) {
          cs.transitionTimingFunction.split(/,(?![^(]*\))/).forEach(function (e) {
            hist.transitionEasing.add(e.trim(), sel);
          });
        }
        if (cs.transitionProperty) {
          cs.transitionProperty.split(",").forEach(function (p) { hist.transitionProperty.add(p.trim(), sel); });
        }
      }

      /* ----- per-element declared motion, and the visual properties motion
       * usually drives.
       *
       * An element qualifies when it declares a named animation, a non-zero
       * transition, or one of the compositing properties. `none`/`normal`/`0s`
       * are the CSS initial values and mean "not declared" — recording them
       * would fill the capture with elements that declare no motion at all. */
      var animName = cs.animationName && cs.animationName !== "none" ? cs.animationName : null;
      var hasTransition = cs.transitionDuration && cs.transitionDuration !== "0s";
      var transform = cs.transform && cs.transform !== "none" ? cs.transform : null;
      var willChange = cs.willChange && cs.willChange !== "auto" ? cs.willChange : null;
      var filterVal = cs.filter && cs.filter !== "none" ? cs.filter : null;
      var backdrop = cs.backdropFilter && cs.backdropFilter !== "none" ? cs.backdropFilter : null;

      if (animName) {
        hist.animationName.add(animName, sel);
        if (cs.animationDuration) hist.animationDuration.add(cs.animationDuration.trim(), sel);
        if (cs.animationTimingFunction) hist.animationEasing.add(cs.animationTimingFunction.trim(), sel);
      }

      if (animName || hasTransition || transform || willChange || filterVal || backdrop) {
        motionSeen++;
        if (motion.length < MOTION_CAP) {
          motion.push({
            selector: sel,
            region: v.region,
            /* Animation longhands. Null when no animation is named, rather than
             * the initial values the cascade reports regardless — `1s` on an
             * element with `animation-name: none` describes nothing. */
            animationName: animName,
            animationDuration: animName ? cs.animationDuration || null : null,
            animationDelay: animName ? cs.animationDelay || null : null,
            animationTimingFunction: animName ? cs.animationTimingFunction || null : null,
            animationIterationCount: animName ? cs.animationIterationCount || null : null,
            animationFillMode: animName ? cs.animationFillMode || null : null,
            animationDirection: animName ? cs.animationDirection || null : null,
            animationPlayState: animName ? cs.animationPlayState || null : null,
            /* Transition longhands, on the same rule. */
            transitionProperty: hasTransition ? cs.transitionProperty || null : null,
            transitionDuration: hasTransition ? cs.transitionDuration || null : null,
            transitionDelay: hasTransition ? cs.transitionDelay || null : null,
            transitionTimingFunction: hasTransition ? cs.transitionTimingFunction || null : null,
            /* What motion usually moves. Recorded whether or not motion is
             * declared: a static transform is a layout fact, and a backdrop
             * filter is the glass effect a rebuild has to reproduce. */
            transform: transform,
            willChange: willChange,
            filter: filterVal,
            backdropFilter: backdrop
          });
        }
      }

      var maxW = pxNum(cs.maxWidth);
      if (maxW && cs.marginLeft === cs.marginRight && rect.width > 320) {
        containers.push({
          selector: sel,
          domPath: domPathFor(el),
          maxWidth: maxW,
          measuredWidth: round(rect.width, 2),
          paddingLeft: pxNum(cs.paddingLeft),
          paddingRight: pxNum(cs.paddingRight),
          centered: cs.marginLeft === "auto" || cs.marginLeft === cs.marginRight,
          region: v.region,
          inPrimary: v.inPrimary
        });
      }

      if (cs.display === "grid" || cs.display === "inline-grid") {
        var tracks = (cs.gridTemplateColumns || "").trim();
        grids.push({
          selector: sel,
          domPath: domPathFor(el),
          template: tracks,
          columns: tracks && tracks !== "none" ? tracks.split(/\s+(?![^(]*\))/).length : null,
          columnGap: pxNum(cs.columnGap),
          rowGap: pxNum(cs.rowGap),
          childCount: el.children.length,
          region: v.region,
          inPrimary: v.inPrimary
        });
      }

      if (cs.position === "sticky") {
        sticky.push({ selector: sel, top: cs.top, zIndex: cs.zIndex, region: v.region });
      } else if (cs.position === "fixed") {
        fixedEls.push({ selector: sel, zIndex: cs.zIndex, region: v.region });
      }

      if (el.tagName === "IMG" || el.tagName === "PICTURE" || el.tagName === "VIDEO") {
        /* Intrinsic size, where the element exposes it.
         *
         * `naturalWidth` is an IMG property and `videoWidth` a VIDEO one; a
         * PICTURE has neither — it is a wrapper whose intrinsic size belongs to
         * the IMG inside it. Absent stays `null` rather than falling back to the
         * rendered box: the rendered box is what the layout produced, and
         * copying it into an intrinsic field would assert the image's own
         * dimensions were read when they were not.
         *
         * A capture taken before this field existed also has it absent, and the
         * evidence builder records that as `unknown` for the same reason. */
        var natural = safe(function () {
          if (el.tagName === "IMG" && el.naturalWidth) {
            return { w: el.naturalWidth, h: el.naturalHeight };
          }
          if (el.tagName === "VIDEO" && el.videoWidth) {
            return { w: el.videoWidth, h: el.videoHeight };
          }
          return null;
        }, null);

        images.push({
          selector: sel,
          tag: el.tagName.toLowerCase(),
          width: round(rect.width, 2),
          height: round(rect.height, 2),
          naturalWidth: natural ? natural.w : null,
          naturalHeight: natural ? natural.h : null,
          aspectRatio: cs.aspectRatio && cs.aspectRatio !== "auto" ? cs.aspectRatio : round(rect.width / (rect.height || 1), 3),
          objectFit: cs.objectFit,
          hasAlt: el.tagName === "IMG" ? el.hasAttribute("alt") : null,
          region: v.region
        });
      }
    });

    /* ----- primary region facts, for verification downstream ----- */

    var primaryRect = safe(function () { return primary.el.getBoundingClientRect(); }, null);
    var primaryVisible = survey.visible.filter(function (v) { return v.inPrimary; });
    var primaryText = safe(function () { return (primary.el.innerText || "").trim().length; }, 0);
    var primaryMedia = safe(function () {
      return primary.el.querySelectorAll("img,picture,video,svg,canvas").length;
    }, 0);
    var repeatsInPrimary = repeats.filter(function (r) { return r.inPrimary; });

    var primaryRegion = {
      kind: primary.kind,
      selector: primary.selector,
      exists: primary.kind === "explicit-main",
      rect: primaryRect ? {
        width: round(primaryRect.width, 2),
        height: round(primaryRect.height, 2),
        top: round(primaryRect.top, 2)
      } : null,
      visibleDescendants: primaryVisible.length,
      sampledDescendants: sampledInPrimary,
      textLength: primaryText,
      mediaCount: primaryMedia,
      repeatGroups: repeatsInPrimary.length,
      largestRepeatInPrimary: repeatsInPrimary.length
        ? { signature: repeatsInPrimary[0].signature, count: repeatsInPrimary[0].count }
        : null
    };

    /* ----- serialise repeats without element handles ----- */

    var repeatsOut = repeats.slice(0, 15).map(function (r) {
      return {
        signature: r.signature,
        parentSelector: r.parentSelector,
        count: r.count,
        area: r.area,
        totalArea: r.totalArea,
        region: r.region,
        inPrimary: r.inPrimary,
        inNavContainer: r.inNavContainer,
        paintedCount: r.paintedCount,
        textBearing: r.textBearing,
        fullBleedCount: r.fullBleedCount,
        classProfile: r.classProfile,
        stableSelector: r.stableSelector,
        // A group whose classes are all build-generated cannot be addressed by
        // class name in any output an implementer will use.
        namesAreGenerated: !!(r.classProfile && r.classProfile.total > 0 && r.classProfile.readable === 0),
        score: round(r.score, 1),
        coherence: r.coherence,
        sampleRect: { width: round(r.sampleRect.width, 2), height: round(r.sampleRect.height, 2) },
        sampleDomPath: r.sampleDomPath
      };
    });

    /* ----- page-level grouping quality -----
     *
     * Computed over every qualifying group, not just the fifteen emitted, so
     * the rate is a property of the page rather than of the cut-off. A group is
     * counted as potentially incoherent only when two independent signal
     * families disagree; one disagreement is normal variation. */
    var coherenceSummary = !COHERENCE_ENABLED ? null : (function () {
      var withSignals = repeats.filter(function (r) { return r.coherence; });
      if (!withSignals.length) {
        return { groupsAssessed: 0, potentiallyIncoherent: 0, falseGroupingRate: null, byFamily: {}, note: "no repeat groups qualified" };
      }
      var incoherent = 0;
      var byFamily = Object.create(null);
      var familyHistogram = Object.create(null);
      withSignals.forEach(function (r) {
        var c = r.coherence;
        if (c.potentiallyIncoherent) incoherent++;
        familyHistogram[c.disagreementFamilies] = (familyHistogram[c.disagreementFamilies] || 0) + 1;
        c.disagreements.forEach(function (d) { byFamily[d.family] = (byFamily[d.family] || 0) + 1; });
      });
      return {
        groupsAssessed: withSignals.length,
        potentiallyIncoherent: incoherent,
        falseGroupingRate: round(incoherent / withSignals.length, 3),
        byFamily: byFamily,
        disagreementFamilyHistogram: familyHistogram,
        membersCappedAt: 60
      };
    })();

    /* ----- significant selectors ----- */

    var significant = [];
    function pushSig(sel, why) {
      if (!sel) return;
      for (var i = 0; i < significant.length; i++) if (significant[i].selector === sel) return;
      significant.push({ selector: sel, why: why });
    }
    repeatsOut.forEach(function (r) {
      pushSig(
        /* Strip the leading tag only. Splitting on "." cuts inside a class
         * token that contains one — every Tailwind arbitrary value does, and
         * so does every escaped token (def_0052). */
        (function () {
          var withoutTag = r.signature.replace(/^[A-Za-z][\w-]*/, "");
          return withoutTag.charAt(0) === "." ? withoutTag : r.signature;
        })(),
        r.inPrimary ? "repeat-group-primary" : "repeat-group"
      );
    });
    ["main", "h1", "h2", "h3", "button", "input", "a", "header", "nav", "footer", "form"].forEach(function (t) {
      if (safe(function () { return document.querySelector(t); }, null)) pushSig(t, "landmark-or-control");
    });
    containers
      .slice()
      .sort(function (a, b) { return (b.inPrimary - a.inPrimary) || (b.measuredWidth - a.measuredWidth); })
      .slice(0, 3)
      .forEach(function (c) { pushSig(c.selector, "container"); });
    grids
      .slice()
      .sort(function (a, b) { return (b.inPrimary - a.inPrimary) || (b.childCount - a.childCount); })
      .slice(0, 3)
      .forEach(function (g) { pushSig(g.selector, "grid"); });

    // Surfaces painted by background-image are design elements in their own
    // right — gradient panels, hero bands, promo banners. They frequently
    // appear once, so no repeat group nominates them, and a probe that never
    // sees them reports the page as having no such surface at all.
    survey.visible
      .filter(function (v) { return v.paintsImage && v.area > 5000; })
      .sort(function (a, b) { return b.area - a.area; })
      .slice(0, 3)
      .forEach(function (v) { pushSig(v.selector, "image-painted-surface"); });

    significant = significant.slice(0, 32);

    var sheets = harvestStylesheets();

    var bodyCs = safe(function () { return getComputedStyle(document.body); }, null);
    var page = bodyCs
      ? {
          background: normColor(bodyCs.backgroundColor),
          color: normColor(bodyCs.color),
          fontFamily: bodyCs.fontFamily,
          fontSize: bodyCs.fontSize,
          lineHeight: bodyCs.lineHeight,
          fontWeight: bodyCs.fontWeight,
          rootFontSize: safe(function () {
            return getComputedStyle(document.documentElement).fontSize;
          }, null)
        }
      : null;

    return {
      $extractor: "helmy/extract",
      $version: EXTRACTOR_VERSION,
      meta: {
        url: safe(function () { return location.href; }, null),
        title: safe(function () { return document.title; }, null),
        capturedAt: new Date().toISOString(),
        viewport: { width: viewport.width, height: viewport.height },
        devicePixelRatio: safe(function () { return window.devicePixelRatio; }, 1),
        scheme: safe(function () {
          return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        }, "light"),
        documentWidth: viewport.docWidth,
        documentHeight: safe(function () { return document.body.scrollHeight; }, null),
        durationMs: Date.now() - started
      },
      coverage: {
        nodesTotal: survey.totalNodes,
        nodesVisible: survey.visible.length,
        nodesSampled: nodes.length,
        nodeCap: NODE_CAP,
        truncated: survey.visible.length > NODE_CAP,
        hiddenSubtrees: survey.hidden.subtrees,
        hiddenNodesSkipped: survey.hidden.nodesSkipped,
        hiddenByReason: survey.hidden.byReason,
        repeatCoherence: coherenceSummary,
        sampledByRegion: sampledByRegion,
        sampledInPrimary: sampledInPrimary,
        strata: sample.strata,
        regionAvailable: {
          main: sample.byRegion.main.length,
          header: sample.byRegion.header.length,
          footer: sample.byRegion.footer.length,
          other: sample.byRegion.other.length
        },
        sheetsTotal: sheets.total,
        sheetsAccessible: sheets.accessible,
        sheetsBlocked: sheets.blocked,
        overlays: survey.overlays,
        consentBanners: survey.consentBanners,
        captureMethod: safe(function () { return window.__HELMY_CAPTURE_METHOD__; }, null) || "unknown"
      },
      primaryRegion: primaryRegion,
      classNaming: (function () {
        var totals = { total: 0, hashed: 0, readable: 0, utility: 0, unknown: 0 };
        survey.visible.forEach(function (v) {
          var p = classProfile(v.el);
          totals.total += p.total;
          totals.hashed += p.hashed;
          totals.readable += p.readable;
          totals.utility += p.utility;
          totals.unknown += p.unknown;
        });
        var generatedShare = totals.total ? round(totals.hashed / totals.total, 3) : 0;
        return {
          counts: totals,
          generatedShare: generatedShare,
          // Above this share, class names carry no meaning worth emitting into
          // a rebuild prompt.
          dominantlyGenerated: generatedShare >= 0.5
        };
      })(),
      page: page,
      customProperties: sheets.customProperties,
      fontFaces: sheets.fontFaces,
      keyframes: sheets.keyframes,
      keyframeDetail: sheets.keyframeDetail,
      mediaQueries: sheets.mediaQueries,
      breakpointRules: sheets.breakpointRules,
      histograms: {
        color: hist.color.toArray(),
        fontFamily: hist.fontFamily.toArray(),
        fontSize: hist.fontSize.toArray(),
        fontWeight: hist.fontWeight.toArray(),
        lineHeight: hist.lineHeight.toArray(),
        letterSpacing: hist.letterSpacing.toArray(),
        textTransform: hist.textTransform.toArray(),
        spacing: hist.spacing.toArray(),
        gap: hist.gap.toArray(),
        radius: hist.radius.toArray(),
        shadow: hist.shadow.toArray(),
        borderWidth: hist.borderWidth.toArray(),
        borderColor: hist.borderColor.toArray(),
        zIndex: hist.zIndex.toArray(),
        opacity: hist.opacity.toArray(),
        transitionDuration: hist.transitionDuration.toArray(),
        transitionEasing: hist.transitionEasing.toArray(),
        transitionProperty: hist.transitionProperty.toArray(),
        animationName: hist.animationName.toArray(),
        animationDuration: hist.animationDuration.toArray(),
        animationEasing: hist.animationEasing.toArray()
      },
      layout: {
        viewportWidth: viewport.width,
        documentWidth: viewport.docWidth,
        containers: containers,
        grids: grids,
        sticky: sticky,
        fixed: fixedEls
      },
      repeats: repeatsOut,
      images: images,
      motion: {
        declared: motion,
        declaredTotal: motionSeen,
        cap: MOTION_CAP,
        /* True when the page declared motion on more elements than the cap
         * keeps. Reported rather than hidden: a list that silently stops at 200
         * looks like a complete list of 200. */
        truncated: motionSeen > motion.length,
        /* What was actually running when the capture read the page.
         *
         * A sample, and time-dependent in a way nothing else here is: an
         * animation that finished a moment earlier is invisible, and one that is
         * running says nothing about what started it. Recorded because "this was
         * in flight at capture" is a real observation, and labelled so that
         * nothing downstream reads it as a trigger. */
        running: safe(function () {
          if (typeof document.getAnimations !== "function") return null;
          return document.getAnimations().slice(0, 50).map(function (a) {
            return {
              /* The animation's own name where it has one — a CSS animation
               * reports `animationName`, a Web Animations API one may not. */
              animationName: safe(function () { return a.animationName || null; }, null),
              transitionProperty: safe(function () { return a.transitionProperty || null; }, null),
              playState: safe(function () { return a.playState || null; }, null),
              /* Timing as the engine resolved it, which is not necessarily what
               * any single stylesheet declared. */
              duration: safe(function () { return a.effect.getTiming().duration; }, null),
              delay: safe(function () { return a.effect.getTiming().delay; }, null),
              easing: safe(function () { return a.effect.getTiming().easing; }, null),
              iterations: safe(function () { return a.effect.getTiming().iterations; }, null),
              target: safe(function () {
                return a.effect && a.effect.target ? selectorFor(a.effect.target) : null;
              }, null)
            };
          });
        }, null)
      },
      significantSelectors: significant
    };
  }

  /* Exposed so the classifier can be audited against a real page's class list
   * without re-implementing it in the test harness — a second implementation
   * would agree with itself and prove nothing (def_0012). */
  var internals = {
    classifyClassName: classifyClassName,
    isHashSegment: isHashSegment,
    selectorHasGeneratedClass: selectorHasGeneratedClass
  };

  if (typeof window !== "undefined") {
    window.__HELMY_EXTRACT__ = extract;
    window.__HELMY_EXTRACT_VERSION__ = EXTRACTOR_VERSION;
    window.__HELMY_INTERNALS__ = internals;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { extract: extract, internals: internals };
  }
})();

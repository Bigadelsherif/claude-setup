/**
 * Media discovery — every surface that paints something the DOM cannot describe.
 *
 * The region survey already records what elements look like. It does not record
 * what a `<video>` is DOING, whether a `<canvas>` can be read back, or whether a
 * background image is an image at all rather than a gradient. Those are the
 * facts a rebuild needs most and the ones most often invented when missing, so
 * they get their own pass and their own artifact.
 *
 * ## Absence is eight different things
 *
 * "Asset missing" is the single most damaging thing this pass could report,
 * because every one of these is a different instruction to whoever rebuilds:
 *
 *   captured            – we have the bytes
 *   present-unreadable  – it is there, the pixels are not legible to us
 *   present-blocked     – a policy stopped us (CORS, CSP, auth)
 *   present-cross-origin– readable in principle, another origin owns it
 *   present-not-downloaded – we saw the URL, we did not fetch it
 *   present-generated   – it exists only at runtime (blob:, MSE, data:)
 *   unavailable         – it was referenced and is genuinely not there
 *   not-established     – we could not tell, and say so
 *
 * A rebuild told "missing" invents a replacement. A rebuild told
 * "present-cross-origin" fetches it from the origin that owns it. Collapsing
 * the two costs the user a wrong asset and a plausible story about why.
 *
 * ## What this pass will not do
 *
 * It does not download anything protected, does not bypass an access control,
 * and does not claim a rendering technology it did not identify. A canvas whose
 * pixels cannot be read is reported as a measured rectangle with unreadable
 * contents — never as a particle system.
 */

const isPresent = (v) => v !== null && v !== undefined && v !== "";

/** The eight availability states. */
export const AVAILABILITY = Object.freeze({
  CAPTURED: "captured",
  PRESENT_UNREADABLE: "present-unreadable",
  PRESENT_BLOCKED: "present-blocked",
  PRESENT_CROSS_ORIGIN: "present-cross-origin",
  PRESENT_NOT_DOWNLOADED: "present-not-downloaded",
  PRESENT_GENERATED: "present-generated",
  UNAVAILABLE: "unavailable",
  NOT_ESTABLISHED: "not-established"
});

/** Surface kinds this pass enumerates. */
export const SURFACE = Object.freeze({
  IMG: "img", PICTURE: "picture", VIDEO: "video", AUDIO: "audio",
  CANVAS: "canvas", SVG: "svg", IFRAME: "iframe", EMBED: "embed",
  CSS_BACKGROUND: "css-background", CSS_MASK: "css-mask", POSTER: "poster"
});

export const MEDIA_CONTRACT_VERSION = "1";

/* ────────────────────────── the in-page enumerator ──────────────────────── */

/**
 * Runs inside the page. Enumerates every media surface it can see.
 *
 * Serialised to the browser, so it closes over nothing. Every risky read —
 * `toDataURL` on a tainted canvas, `getContext` on a surface that may already
 * hold an incompatible one — is wrapped, and the failure is recorded as the
 * answer rather than thrown away.
 */
export function mediaDiscoverySource({ maxItems = 400, probeCanvasContext = true } = {}) {
  return `(() => {
  var MAX = ${maxItems};
  var PROBE_CTX = ${probeCanvasContext ? "true" : "false"};
  var out = [];
  var limits = [];

  function domPath(el) {
    var parts = [], node = el;
    while (node && node.nodeType === 1 && parts.length < 14) {
      var parent = node.parentElement;
      if (!parent) break;
      var idx = Array.prototype.indexOf.call(parent.children, node) + 1;
      parts.unshift(node.tagName.toLowerCase() + ":nth-child(" + idx + ")");
      node = parent;
    }
    return parts.join(">");
  }

  function absolute(u) {
    if (!u) return null;
    try { return new URL(u, location.href).href; } catch (e) { return null; }
  }
  function originOf(u) {
    if (!u) return null;
    try { return new URL(u, location.href).origin; } catch (e) { return null; }
  }
  function scheme(u) {
    if (!u) return null;
    var i = u.indexOf(":");
    return i === -1 ? null : u.slice(0, i).toLowerCase();
  }

  /* Resource Timing gives transfer size and, on browsers that expose it, the
   * response status. It is read rather than a fetch being issued: issuing one
   * would be a second request the page never made. */
  var resources = {};
  try {
    var entries = performance.getEntriesByType("resource") || [];
    for (var r = 0; r < entries.length; r++) {
      resources[entries[r].name] = {
        transferSize: typeof entries[r].transferSize === "number" ? entries[r].transferSize : null,
        encodedBodySize: typeof entries[r].encodedBodySize === "number" ? entries[r].encodedBodySize : null,
        decodedBodySize: typeof entries[r].decodedBodySize === "number" ? entries[r].decodedBodySize : null,
        initiatorType: entries[r].initiatorType || null,
        responseStatus: typeof entries[r].responseStatus === "number" ? entries[r].responseStatus : null,
        contentType: entries[r].contentType || null,
        duration: Math.round(entries[r].duration || 0)
      };
    }
  } catch (e) { limits.push("resource timing was unavailable: " + (e && e.message)); }

  function geometry(el) {
    try {
      var b = el.getBoundingClientRect();
      var cs = getComputedStyle(el);
      return {
        boundingBox: {
          x: Math.round((b.x + (window.scrollX || 0)) * 10) / 10,
          y: Math.round((b.y + (window.scrollY || 0)) * 10) / 10,
          width: Math.round(b.width * 10) / 10,
          height: Math.round(b.height * 10) / 10
        },
        aspectRatio: b.height > 0 ? Math.round((b.width / b.height) * 1000) / 1000 : null,
        objectFit: cs.objectFit || null,
        objectPosition: cs.objectPosition || null,
        visibility: cs.visibility || null,
        display: cs.display || null,
        opacity: cs.opacity || null,
        zIndex: cs.zIndex || null
      };
    } catch (e) { return null; }
  }

  function base(el, surface) {
    var g = geometry(el) || {};
    return {
      domPath: domPath(el),
      surface: surface,
      tag: el.tagName ? el.tagName.toLowerCase() : null,
      geometry: g.boundingBox || null,
      aspectRatio: g.aspectRatio === undefined ? null : g.aspectRatio,
      objectFit: g.objectFit || null,
      objectPosition: g.objectPosition || null,
      visibility: g.visibility || null,
      display: g.display || null,
      opacity: g.opacity || null,
      sourceUrl: null, resolvedUrl: null, sourceOrigin: null, scheme: null,
      crossOrigin: null, httpStatus: null, mimeType: null, transferSize: null,
      intrinsicWidth: null, intrinsicHeight: null,
      altPresent: null, alt: null,
      loading: null, decoding: null,
      readback: null, limitations: []
    };
  }

  function attachResource(rec) {
    var key = rec.resolvedUrl;
    if (!key || !resources[key]) return;
    var r = resources[key];
    rec.transferSize = r.transferSize;
    rec.httpStatus = r.responseStatus;
    rec.mimeType = r.contentType;
    rec.encodedBodySize = r.encodedBodySize;
    rec.decodedBodySize = r.decodedBodySize;
    rec.initiatorType = r.initiatorType;
  }

  function finishUrl(rec, raw) {
    rec.sourceUrl = raw || null;
    rec.resolvedUrl = absolute(raw);
    rec.sourceOrigin = originOf(raw);
    rec.scheme = scheme(rec.resolvedUrl || raw);
    rec.crossOrigin = rec.sourceOrigin ? (rec.sourceOrigin !== location.origin) : null;
    attachResource(rec);
  }

  /* ---------------------------------------------------------------- img */
  var imgs = document.querySelectorAll("img");
  for (var i = 0; i < imgs.length && out.length < MAX; i++) {
    var im = imgs[i];
    var rec = base(im, "img");
    finishUrl(rec, im.currentSrc || im.getAttribute("src"));
    rec.intrinsicWidth = im.naturalWidth || null;
    rec.intrinsicHeight = im.naturalHeight || null;
    rec.altPresent = im.hasAttribute("alt");
    rec.alt = im.hasAttribute("alt") ? im.getAttribute("alt") : null;
    rec.loading = im.getAttribute("loading");
    rec.decoding = im.getAttribute("decoding");
    rec.srcset = im.getAttribute("srcset") || null;
    rec.sizes = im.getAttribute("sizes") || null;
    rec.complete = im.complete === true;
    /* naturalWidth of 0 on a complete image means it failed to decode. */
    rec.decodeFailed = im.complete === true && !im.naturalWidth;
    var pic = im.parentElement && im.parentElement.tagName === "PICTURE" ? im.parentElement : null;
    if (pic) {
      rec.pictureSources = [];
      var srcs = pic.querySelectorAll("source");
      for (var s = 0; s < srcs.length; s++) {
        rec.pictureSources.push({
          srcset: srcs[s].getAttribute("srcset"),
          type: srcs[s].getAttribute("type"),
          media: srcs[s].getAttribute("media")
        });
      }
    }
    out.push(rec);
  }

  /* ------------------------------------------------------ video + audio */
  var medias = document.querySelectorAll("video, audio");
  for (var v = 0; v < medias.length && out.length < MAX; v++) {
    var md = medias[v];
    var rec2 = base(md, md.tagName.toLowerCase());
    finishUrl(rec2, md.currentSrc || md.getAttribute("src"));
    rec2.intrinsicWidth = md.videoWidth || null;
    rec2.intrinsicHeight = md.videoHeight || null;
    rec2.poster = md.getAttribute("poster") || null;
    rec2.posterResolved = absolute(rec2.poster);
    rec2.autoplay = md.autoplay === true;
    rec2.muted = md.muted === true;
    rec2.loop = md.loop === true;
    rec2.controls = md.controls === true;
    rec2.preload = md.getAttribute("preload");
    rec2.playsInline = md.hasAttribute("playsinline");
    rec2.paused = md.paused === true;
    rec2.ended = md.ended === true;
    rec2.readyState = md.readyState;
    rec2.networkState = md.networkState;
    rec2.currentTime = typeof md.currentTime === "number" ? Math.round(md.currentTime * 1000) / 1000 : null;
    rec2.duration = (typeof md.duration === "number" && isFinite(md.duration)) ? Math.round(md.duration * 1000) / 1000 : null;
    rec2.durationInfinite = typeof md.duration === "number" && !isFinite(md.duration);
    rec2.sourceElements = [];
    var vsrc = md.querySelectorAll("source");
    for (var q = 0; q < vsrc.length; q++) {
      rec2.sourceElements.push({ src: vsrc[q].getAttribute("src"), resolved: absolute(vsrc[q].getAttribute("src")), type: vsrc[q].getAttribute("type"), media: vsrc[q].getAttribute("media") });
    }
    rec2.fallbackText = (md.textContent || "").trim().slice(0, 200) || null;
    /* blob: and MSE mean the bytes exist only in this page's runtime. */
    rec2.deliveryKind = rec2.scheme === "blob" ? "blob-or-mse"
      : rec2.scheme === "data" ? "data-uri"
      : (rec2.resolvedUrl ? "direct" : "unresolved");
    out.push(rec2);
  }

  /* --------------------------------------------------------------- canvas */
  var canvases = document.querySelectorAll("canvas");
  for (var c = 0; c < canvases.length && out.length < MAX; c++) {
    var cv = canvases[c];
    var rec3 = base(cv, "canvas");
    rec3.attributeWidth = cv.width || null;
    rec3.attributeHeight = cv.height || null;
    rec3.devicePixelRatio = window.devicePixelRatio || 1;
    rec3.devicePixelWidth = cv.width ? cv.width : null;
    rec3.devicePixelHeight = cv.height ? cv.height : null;
    try {
      var ccs = getComputedStyle(cv);
      rec3.cssWidth = ccs.width; rec3.cssHeight = ccs.height;
    } catch (e) { /* recorded as null */ }

    /* Readback. A tainted canvas throws SecurityError; that is the answer, and
     * it is a different answer from "the canvas is blank". */
    rec3.readback = { readable: null, reason: null, bytes: null, sample: null };
    try {
      var url = cv.toDataURL("image/png");
      rec3.readback.readable = true;
      rec3.readback.bytes = url.length;
      rec3.readback.sample = url.slice(0, 64);
      rec3.readback.blank = url.length < 200;
    } catch (e) {
      rec3.readback.readable = false;
      rec3.readback.reason = (e && e.name === "SecurityError")
        ? "the canvas is tainted by cross-origin content, so its pixels cannot be read"
        : "toDataURL failed: " + (e && e.message ? e.message : String(e));
    }

    /* Context identification. Probing can CREATE a context on a canvas that has
     * none, which is a mutation, so it is opt-in and recorded when it runs. */
    rec3.contextProbed = PROBE_CTX;
    rec3.contextType = null;
    rec3.webgl = null;
    if (PROBE_CTX) {
      try {
        var types = ["webgl2", "webgl", "experimental-webgl", "2d", "bitmaprenderer"];
        for (var t = 0; t < types.length; t++) {
          var ctx = null;
          try { ctx = cv.getContext(types[t]); } catch (e2) { ctx = null; }
          if (ctx) {
            rec3.contextType = types[t];
            if (types[t].indexOf("webgl") === 0) {
              rec3.webgl = { vendor: null, renderer: null, version: null, exposed: false };
              try {
                var dbg = ctx.getExtension("WEBGL_debug_renderer_info");
                if (dbg) {
                  rec3.webgl.vendor = ctx.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || null;
                  rec3.webgl.renderer = ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || null;
                  rec3.webgl.exposed = true;
                }
                rec3.webgl.version = ctx.getParameter(ctx.VERSION) || null;
              } catch (e3) { rec3.limitations.push("webgl parameters were not exposed"); }
            }
            break;
          }
        }
      } catch (e) { rec3.limitations.push("context probing failed: " + (e && e.message)); }
    }
    out.push(rec3);
  }

  /* ------------------------------------------------------------------ svg */
  var svgs = document.querySelectorAll("svg");
  for (var g2 = 0; g2 < svgs.length && out.length < MAX; g2++) {
    var sv = svgs[g2];
    var rec4 = base(sv, "svg");
    rec4.inline = true;
    rec4.viewBox = sv.getAttribute("viewBox");
    rec4.markupLength = (sv.outerHTML || "").length;
    rec4.hasSmil = sv.querySelectorAll("animate, animateTransform, animateMotion").length;
    rec4.useHrefs = [];
    var uses = sv.querySelectorAll("use");
    for (var u = 0; u < uses.length && u < 10; u++) {
      rec4.useHrefs.push(uses[u].getAttribute("href") || uses[u].getAttribute("xlink:href"));
    }
    out.push(rec4);
  }

  /* ------------------------------------------------- iframe / embed / object */
  var frames = document.querySelectorAll("iframe, embed, object");
  for (var f = 0; f < frames.length && out.length < MAX; f++) {
    var fr = frames[f];
    var rec5 = base(fr, fr.tagName === "IFRAME" ? "iframe" : "embed");
    finishUrl(rec5, fr.getAttribute("src") || fr.getAttribute("data"));
    rec5.title = fr.getAttribute("title") || null;
    rec5.allow = fr.getAttribute("allow") || null;
    rec5.loading = fr.getAttribute("loading");
    rec5.contentAccessible = null;
    try { rec5.contentAccessible = Boolean(fr.contentDocument); }
    catch (e) { rec5.contentAccessible = false; rec5.limitations.push("the frame document is cross-origin and cannot be inspected"); }
    out.push(rec5);
  }

  /* ------------------------------------------- CSS backgrounds and masks */
  var cssSeen = 0;
  var all = document.querySelectorAll("body *");
  for (var e4 = 0; e4 < all.length && out.length < MAX && cssSeen < 200; e4++) {
    var node = all[e4];
    var s2;
    try { s2 = getComputedStyle(node); } catch (err) { continue; }

    var bg = s2.backgroundImage;
    var mask = s2.maskImage || s2.webkitMaskImage;
    var interesting = (bg && bg !== "none") || (mask && mask !== "none");
    if (!interesting) continue;
    cssSeen++;

    var rec6 = base(node, (bg && bg !== "none") ? "css-background" : "css-mask");
    rec6.rawValue = (bg && bg !== "none") ? bg : mask;
    /* A gradient is not an asset. Reporting it as a missing image sends
     * somebody hunting for a file that never existed. */
    rec6.isGradient = /gradient\\(/i.test(rec6.rawValue);
    rec6.urls = [];
    var re = /url\\((['"]?)([^'")]+)\\1\\)/gi, m;
    while ((m = re.exec(rec6.rawValue)) !== null) {
      rec6.urls.push({ raw: m[2], resolved: absolute(m[2]), origin: originOf(m[2]), scheme: scheme(m[2]) });
    }
    if (rec6.urls.length) {
      finishUrl(rec6, rec6.urls[0].raw);
      rec6.imageSet = /image-set\\(/i.test(rec6.rawValue);
    }
    rec6.backgroundSize = s2.backgroundSize;
    rec6.backgroundPosition = s2.backgroundPosition;
    rec6.backgroundRepeat = s2.backgroundRepeat;
    rec6.clipPath = s2.clipPath !== "none" ? s2.clipPath : null;
    rec6.filter = s2.filter !== "none" ? s2.filter : null;
    rec6.backdropFilter = (s2.backdropFilter && s2.backdropFilter !== "none") ? s2.backdropFilter : null;
    out.push(rec6);
  }

  if (out.length >= MAX) limits.push("the media record was capped at " + MAX + " surfaces; anything beyond that was not enumerated");

  return {
    contract: "${MEDIA_CONTRACT_VERSION}",
    capturedAt: Date.now(),
    pageOrigin: location.origin,
    pageUrl: location.href,
    devicePixelRatio: window.devicePixelRatio || 1,
    items: out,
    limitations: limits
  };
})()`;
}

/* ───────────────────────────── classification ───────────────────────────── */

/**
 * Decide which of the eight availability states an item is in.
 *
 * `captured` is not decided here — it depends on whether bytes were saved to
 * the run directory, which this pure function cannot know. The pass sets it
 * afterwards, and this returns the best state reachable from the page alone.
 */
export function classifyAvailability(item) {
  if (!item) return { state: AVAILABILITY.NOT_ESTABLISHED, why: "no record" };

  /* Surfaces with nothing to fetch: their content is the DOM itself. */
  if (item.surface === SURFACE.SVG) {
    return { state: AVAILABILITY.CAPTURED, why: "inline SVG markup is part of the document and was read directly" };
  }
  if (item.surface === SURFACE.CSS_BACKGROUND || item.surface === SURFACE.CSS_MASK) {
    if (item.isGradient && !(item.urls ?? []).length) {
      return { state: AVAILABILITY.CAPTURED, why: "a CSS gradient is generated by the stylesheet; there is no asset to fetch" };
    }
  }

  if (item.surface === SURFACE.CANVAS) {
    if (item.readback?.readable === true) {
      return { state: AVAILABILITY.CAPTURED, why: "canvas pixels were readable" };
    }
    if (item.readback?.readable === false) {
      const tainted = /tainted/i.test(item.readback.reason ?? "");
      return {
        state: tainted ? AVAILABILITY.PRESENT_BLOCKED : AVAILABILITY.PRESENT_UNREADABLE,
        why: item.readback.reason ?? "the canvas pixels could not be read"
      };
    }
    return { state: AVAILABILITY.NOT_ESTABLISHED, why: "canvas readability was not tested" };
  }

  if (!isPresent(item.resolvedUrl)) {
    if (item.surface === SURFACE.IFRAME || item.surface === SURFACE.EMBED) {
      return { state: AVAILABILITY.NOT_ESTABLISHED, why: "the frame declared no source" };
    }
    if (item.decodeFailed) {
      return { state: AVAILABILITY.UNAVAILABLE, why: "the element reported itself complete with no intrinsic size, so the source failed to load" };
    }
    return { state: AVAILABILITY.NOT_ESTABLISHED, why: "no source URL was readable from this element" };
  }

  if (item.scheme === "blob") {
    return { state: AVAILABILITY.PRESENT_GENERATED, why: "the source is a blob URL, so the bytes exist only inside the page's runtime and cannot be fetched from outside it" };
  }
  if (item.scheme === "data") {
    return { state: AVAILABILITY.PRESENT_GENERATED, why: "the source is a data URI embedded in the document" };
  }
  if (item.deliveryKind === "blob-or-mse") {
    return { state: AVAILABILITY.PRESENT_GENERATED, why: "the stream is assembled at runtime through Media Source Extensions" };
  }

  if (isPresent(item.httpStatus) && item.httpStatus >= 400) {
    return { state: AVAILABILITY.UNAVAILABLE, why: "the request for this source returned HTTP " + item.httpStatus };
  }
  if (item.decodeFailed) {
    return { state: AVAILABILITY.UNAVAILABLE, why: "the image reported itself complete with no intrinsic size, so it failed to decode" };
  }

  if (item.crossOrigin === true) {
    return {
      state: AVAILABILITY.PRESENT_CROSS_ORIGIN,
      why: "the source is served from " + (item.sourceOrigin ?? "another origin") + ", which owns it; it is reachable but was not fetched by this pass"
    };
  }

  return {
    state: AVAILABILITY.PRESENT_NOT_DOWNLOADED,
    why: "the source URL was read from the page but this pass did not fetch the bytes"
  };
}

/** Build the artifact from a discovery payload. */
export function deriveMediaObservation({ payload, viewport, url = null } = {}) {
  if (!payload || typeof payload !== "object") {
    return {
      $mediaContract: MEDIA_CONTRACT_VERSION,
      viewport, url, capturedAt: new Date().toISOString(),
      status: "failed",
      reason: "the media discovery script produced no payload",
      items: [], counts: {}, limitations: []
    };
  }

  const items = (payload.items ?? []).map((raw, i) => {
    const availability = classifyAvailability(raw);
    return {
      ...raw,
      mediaId: "md_" + String(i + 1).padStart(4, "0"),
      viewport,
      availability: availability.state,
      availabilityReason: availability.why,
      evidenceGrade: gradeFor(raw, availability.state)
    };
  });

  const counts = {};
  for (const it of items) {
    counts[it.surface] = (counts[it.surface] ?? 0) + 1;
  }
  const byAvailability = {};
  for (const it of items) byAvailability[it.availability] = (byAvailability[it.availability] ?? 0) + 1;

  return {
    $mediaContract: MEDIA_CONTRACT_VERSION,
    viewport,
    url: url ?? payload.pageUrl ?? null,
    pageOrigin: payload.pageOrigin ?? null,
    devicePixelRatio: payload.devicePixelRatio ?? null,
    capturedAt: new Date().toISOString(),
    status: "completed",
    reason: null,
    items,
    counts,
    byAvailability,
    limitations: payload.limitations ?? []
  };
}

/**
 * How well a media fact is evidenced.
 *
 * Geometry is measured — it was read off the rendered page. Everything that
 * depends on a URL we did not fetch is observed at best.
 */
function gradeFor(raw, state) {
  if (state === AVAILABILITY.NOT_ESTABLISHED) return "unknown";
  if (state === AVAILABILITY.PRESENT_UNREADABLE || state === AVAILABILITY.PRESENT_BLOCKED) return "unsupported";
  if (state === AVAILABILITY.CAPTURED) return "measured";
  return "observed";
}

/**
 * The media pass — enumerate, then try honestly to get the pixels.
 *
 * Runs after the page has settled, in its own context, so it never disturbs the
 * forensic survey or the cold-load motion window.
 *
 * ## Two ways to get a canvas, and they are not the same
 *
 * `toDataURL` reads the canvas's own backing store. It throws on a canvas
 * tainted by cross-origin content — which is common and says nothing about
 * whether the pixels are visible. A browser-level screenshot of the same
 * rectangle captures what was actually composited, tainted or not.
 *
 * So an unreadable canvas is not a canvas we cannot see. The pass tries the
 * script read first, falls back to a region screenshot, and records WHICH
 * produced the evidence — because a screenshot is the composited result
 * including anything painted over it, and a reader deserves to know that is
 * what they are looking at.
 *
 * ## What it will not do
 *
 * It does not fetch protected media, does not bypass an access control, and
 * does not seek a video it cannot read frames from. Every refusal is recorded
 * with its reason; none is silently converted into "no media".
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PlaywrightDriver } from "../driver/playwright-driver.mjs";
import {
  mediaDiscoverySource, deriveMediaObservation, AVAILABILITY, SURFACE, MEDIA_CONTRACT_VERSION
} from "./media-discovery.mjs";

export const MEDIA_ARTIFACT_FILENAME = "media-observation.json";
export const CANVAS_ARTIFACT_FILENAME = "canvas-observation.json";
export const CANVAS_CONTRACT_VERSION = "1";

/**
 * When to read a canvas while looking for change.
 *
 * Spread deliberately across two orders of magnitude. A canvas that redraws on
 * a three-second timer matches itself under any evenly spaced pair, which is
 * how the previous two-samples-a-second-apart check called moving canvases
 * static.
 */
export const CANVAS_SAMPLE_OFFSETS = Object.freeze([100, 500, 1000, 2500, 5000]);

export const DEFAULT_MEDIA_BUDGET = Object.freeze({
  maxItems: 400,
  maxVideoFrames: 5,
  maxVideosSampled: 4,
  maxCanvasesRastered: 6,
  maxCanvasesSampled: 6,
  canvasSampleOffsets: CANVAS_SAMPLE_OFFSETS,
  scrollCheckpoints: 3,
  scrollSettleMs: 600,
  settleMs: 2500,
  seekTimeoutMs: 4000,
  navigationTimeoutMs: 30000,
  probeCanvasContext: true,
  reducedMotionVideo: true
});

/** The five sampling points, as fractions of duration. */
export const FRAME_FRACTIONS = Object.freeze([0, 0.25, 0.5, 0.75, 1]);

const ok = (r) => r?.status === "ok";
const value = (r) => (r && "value" in r ? r.value : null);
/** A driver that declines an operation reports it, rather than failing. */
const unsupported = (r) => r?.status === "unsupported";
const failureOf = (r) => r?.error?.message ?? r?.errorCode ?? "the driver reported " + (r?.status ?? "no status");
const wait = (sleep, ms) => (sleep ? sleep(ms) : new Promise((r) => setTimeout(r, ms)));

/** Write a `data:` URL to disk. Returns bytes written, or null. */
function writeDataUrl(dir, name, dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const comma = dataUrl.indexOf(",");
  if (comma === -1 || !/;base64/i.test(dataUrl.slice(0, comma))) return null;
  const bytes = Buffer.from(dataUrl.slice(comma + 1), "base64");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), bytes);
  return bytes.length;
}

/* ─────────────────────────────── video frames ───────────────────────────── */

/**
 * Sample frames from one video.
 *
 * Seeking is a mutation of the page, so the original `currentTime` and paused
 * state are restored afterwards. A cross-origin video without permissive CORS
 * taints the draw canvas and the read throws — that is recorded as the reason,
 * not as an absent video.
 */
async function sampleVideoFrames({ driver, pageId, item, budget, dir, sleep }) {
  const frames = [];
  const result = { sampled: false, reason: null, frames, method: null };

  if (!isFiniteNumber(item.duration) || item.duration <= 0) {
    result.reason = item.durationInfinite
      ? "the video reports an infinite duration, which is a live or unbounded stream; there is no timeline to sample at fixed fractions"
      : "the video reported no readable duration, so no sampling points could be computed";
    return result;
  }

  for (const fraction of FRAME_FRACTIONS.slice(0, budget.maxVideoFrames)) {
    const target = Math.min(item.duration * fraction, Math.max(0, item.duration - 0.05));
    const shot = await driver.evaluate(pageId, async (args) => {
      const el = document.querySelector(args.selector) ?? Array.from(document.querySelectorAll("video")).find((v) => v.currentSrc === args.url);
      if (!el) return { ok: false, reason: "the video element could not be located again" };
      const originalTime = el.currentTime;
      const originalPaused = el.paused;
      try {
        el.pause();
        await new Promise((resolve) => {
          let done = false;
          const finish = () => { if (!done) { done = true; resolve(); } };
          el.addEventListener("seeked", finish, { once: true });
          setTimeout(finish, args.timeoutMs);
          try { el.currentTime = args.target; } catch (e) { finish(); }
        });
        const c = document.createElement("canvas");
        c.width = el.videoWidth || 640;
        c.height = el.videoHeight || 360;
        const ctx = c.getContext("2d");
        ctx.drawImage(el, 0, 0, c.width, c.height);
        let url;
        try { url = c.toDataURL("image/png"); }
        catch (e) {
          return {
            ok: false,
            reason: e && e.name === "SecurityError"
              ? "drawing this video tainted the canvas, so the frame cannot be read; the video is cross-origin without permissive CORS headers"
              : "the frame could not be encoded: " + (e && e.message)
          };
        }
        return { ok: true, dataUrl: url, width: c.width, height: c.height, atSeconds: el.currentTime };
      } finally {
        try { el.currentTime = originalTime; if (!originalPaused) el.play().catch(() => {}); } catch (e) { /* restored best effort */ }
      }
    }, { selector: cssEscapePath(item.domPath), url: item.resolvedUrl, target, timeoutMs: budget.seekTimeoutMs });

    const v = value(shot);
    if (!ok(shot) || !v) { result.reason = "the frame sampler did not run: " + failureOf(shot); break; }
    if (!v.ok) { result.reason = v.reason; break; }

    const name = `${item.mediaId}-${Math.round(fraction * 100)}pct.png`;
    const bytes = writeDataUrl(dir, name, v.dataUrl);
    frames.push({
      fraction, atSeconds: v.atSeconds ?? target,
      width: v.width, height: v.height,
      relativePath: `media/frames/${name}`, bytes
    });
  }

  result.sampled = frames.length > 0;
  result.method = frames.length ? "canvas-drawimage" : null;
  if (frames.length && !result.reason) result.reason = null;
  return result;
}

const isFiniteNumber = (n) => typeof n === "number" && Number.isFinite(n);

/**
 * A DOM path is nth-child chained with `>`; it is already a valid selector.
 * Returned unchanged, with the join normalised.
 */
function cssEscapePath(domPath) {
  return String(domPath ?? "").split(">").join(" > ");
}

/* ────────────────────────────── canvas raster ───────────────────────────── */

async function rasterCanvas({ driver, pageId, item, dir, sleep }) {
  const out = { method: null, relativePath: null, bytes: null, reason: null, pixelChange: null };

  /* 1. The script read, when the canvas is not tainted. */
  if (item.readback?.readable === true) {
    const got = await driver.evaluate(pageId, (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      try { return el.toDataURL("image/png"); } catch (e) { return null; }
    }, cssEscapePath(item.domPath));
    const dataUrl = value(got);
    if (dataUrl) {
      const name = `${item.mediaId}-canvas.png`;
      out.bytes = writeDataUrl(dir, name, dataUrl);
      out.method = "toDataURL";
      out.relativePath = `media/canvas/${name}`;
      return out;
    }
  }

  /* 2. A composited screenshot. This works on a tainted canvas, because the
   *    browser is capturing what it painted rather than reading the backing
   *    store — but it also captures anything drawn OVER the canvas, so the
   *    method is recorded alongside the file. */
  const g = item.geometry;
  if (!g || g.width < 2 || g.height < 2) {
    out.reason = "the canvas has no usable rendered geometry, so no region could be captured";
    return out;
  }
  const name = `${item.mediaId}-canvas-composited.png`;
  mkdirSync(dir, { recursive: true });
  const shot = await driver.screenshotRegion(pageId, {
    clip: { x: g.x, y: g.y, width: g.width, height: g.height },
    path: join(dir, name)
  });
  if (ok(shot)) {
    out.method = "region-screenshot";
    out.relativePath = `media/canvas/${name}`;
    out.reason = item.readback?.reason ?? null;
    return out;
  }
  out.reason = "neither a script read nor a region screenshot produced pixels: " + failureOf(shot);
  return out;
}

/**
 * One canvas read, reduced to a signature.
 *
 * A hash rather than a length: two different frames of the same animation
 * frequently encode to the same number of bytes, so comparing lengths reports
 * "unchanged" for a canvas that is visibly moving. The hash is computed in the
 * page so the data URL never crosses the bridge.
 *
 * Backing store ONLY. A composited screenshot is a different measurement and is
 * never mixed into this series — it would show changes caused by things painted
 * over the canvas and attribute them to the canvas.
 */
async function canvasSignature({ driver, pageId, domPath }) {
  return value(await driver.evaluate(pageId, (selector) => {
    const el = document.querySelector(selector);
    if (!el) return { readable: false, reason: "the canvas element could not be located" };
    let url;
    try { url = el.toDataURL("image/png"); }
    catch (e) {
      return {
        readable: false,
        reason: e && e.name === "SecurityError"
          ? "the canvas is tainted by cross-origin content, so its backing store cannot be read"
          : "toDataURL failed: " + (e && e.message ? e.message : String(e))
      };
    }
    /* FNV-1a over the encoded image. */
    let h = 2166136261;
    for (let i = 0; i < url.length; i++) { h ^= url.charCodeAt(i); h = Math.imul(h, 16777619); }
    return { readable: true, signature: (h >>> 0).toString(16), bytes: url.length, reason: null };
  }, cssEscapePath(domPath)));
}

/**
 * Sample a canvas over a spread of intervals.
 *
 * Two reads a second apart was the old test, and it is the wrong test: a canvas
 * that redraws every three seconds, or eases over five, matches itself at that
 * spacing and gets called static. Spreading the samples from 100ms to 5s covers
 * fast redraws and slow ones with the same series, and the whole series is
 * recorded so a reader can see what "static" was concluded from.
 *
 * Three outcomes, and `unresolved` is not a synonym for static: a canvas whose
 * backing store cannot be read may be animating vigorously.
 */
async function canvasTimeSeries({ driver, pageId, item, budget, sleep }) {
  const offsets = budget.canvasSampleOffsets ?? CANVAS_SAMPLE_OFFSETS;
  const samples = [];
  let previousAt = 0;

  for (const at of offsets) {
    await wait(sleep, Math.max(0, at - previousAt));
    previousAt = at;
    const s = await canvasSignature({ driver, pageId, domPath: item.domPath });
    if (!s) return { tested: false, classification: "unresolved", changed: null, samples, offsets, reason: "the sampler did not run" };
    if (!s.readable) {
      return {
        tested: false, classification: "unresolved", changed: null, samples, offsets,
        reason: s.reason ?? "the canvas backing store could not be read, so change over time was not testable by script"
      };
    }
    samples.push({ atMs: at, signature: s.signature, bytes: s.bytes });
  }

  const distinct = new Set(samples.map((s) => s.signature));
  return {
    tested: true,
    samples,
    offsets,
    distinctSignatures: distinct.size,
    changed: distinct.size > 1,
    /* `animated` is this artifact's word for "changing"; it predates this pass
     * and every consumer already reads it. */
    classification: distinct.size > 1 ? "animated" : "static",
    reason: distinct.size > 1
      ? null
      : "identical across " + samples.length + " samples spanning " + offsets[offsets.length - 1] + "ms"
  };
}

/**
 * Read every canvas before scrolling and again at each checkpoint.
 *
 * Kept apart from the at-rest time series: a canvas that redraws on scroll and
 * one that redraws on a timer are different behaviours, and merging the samples
 * would make them indistinguishable.
 */
async function canvasScrollSampling({ driver, pageId, canvasItems, budget, sleep }) {
  const result = new Map();
  if (!canvasItems.length) return result;

  for (const item of canvasItems) {
    const before = await canvasSignature({ driver, pageId, domPath: item.domPath });
    result.set(item.mediaId, {
      readable: before?.readable === true,
      before: before?.readable ? before.signature : null,
      reason: before?.readable ? null : (before?.reason ?? "the canvas could not be read before scrolling"),
      checkpoints: [],
      changed: before?.readable ? false : null
    });
  }

  const pageHeight = value(await driver.evaluate(pageId, () => document.documentElement.scrollHeight)) ?? 0;
  const viewportHeight = value(await driver.evaluate(pageId, () => window.innerHeight)) ?? 900;
  const steps = budget.scrollCheckpoints ?? 3;

  for (let i = 1; i <= steps; i++) {
    const y = Math.round(Math.max(0, pageHeight - viewportHeight) * (i / (steps + 1)));
    await driver.evaluate(pageId, (yy) => window.scrollTo(0, yy), y);
    await wait(sleep, budget.scrollSettleMs ?? 600);

    for (const item of canvasItems) {
      const rec = result.get(item.mediaId);
      if (!rec || rec.readable !== true) continue;
      const s = await canvasSignature({ driver, pageId, domPath: item.domPath });
      const readable = s?.readable === true;
      rec.checkpoints.push({
        scrollY: y,
        readable,
        signature: readable ? s.signature : null,
        changedFromBefore: readable ? s.signature !== rec.before : null,
        reason: readable ? null : (s?.reason ?? "the read failed at this checkpoint")
      });
      if (readable && s.signature !== rec.before) rec.changed = true;
    }
  }

  /* Leave the page where it started, so anything after this sees a top-of-page
   * document rather than one this pass scrolled. Written in the same
   * argument-passing form as the checkpoints above so the restore is visible to
   * a caller inspecting what the pass did, rather than hidden in a literal. */
  await driver.evaluate(pageId, (yy) => window.scrollTo(0, yy), 0);
  await wait(sleep, 200);
  return result;
}

/**
 * A second, reduced-motion visit, purely to see what the videos do differently.
 *
 * Its own fresh context with the emulation applied BEFORE navigation: applied
 * afterwards it would describe a load that already happened under the other
 * setting. Nothing here is inferred — a field that could not be read comes back
 * null and is reported as unknown rather than as "unchanged".
 */
async function reducedMotionVideo({ driver, url, viewport, height, budget, sleep, normalVideos }) {
  if (!normalVideos.length) return { status: "not-attempted", reason: "the page has no video elements", videos: [] };

  let pageId = null;
  try {
    const opened = await driver.openPage({ viewport, height });
    pageId = value(opened)?.pageId ?? null;
    if (!pageId) return { status: "failed", reason: "a fresh reduced-motion context could not be opened: " + failureOf(opened), videos: [] };

    const set = await driver.setReducedMotion(pageId, true);
    if (unsupported(set)) {
      return { status: "unsupported", reason: "the driver does not support reduced-motion emulation, so no comparison could be made", videos: [] };
    }

    const nav = await driver.navigate(pageId, url, { waitUntil: "networkidle", timeoutMs: budget.navigationTimeoutMs });
    if (!ok(nav)) return { status: "failed", reason: "the reduced-motion navigation did not complete: " + failureOf(nav), videos: [] };
    await wait(sleep, budget.settleMs);

    const states = value(await driver.evaluate(pageId, (paths) => {
      const path = (el) => {
        const parts = []; let node = el;
        while (node && node.nodeType === 1 && parts.length < 14) {
          const parent = node.parentElement; if (!parent) break;
          parts.unshift(node.tagName.toLowerCase() + ":nth-child(" + (Array.prototype.indexOf.call(parent.children, node) + 1) + ")");
          node = parent;
        }
        return parts.join(">");
      };
      const byPath = {};
      for (const el of document.querySelectorAll("video")) byPath[path(el)] = el;
      const out = {};
      for (const p of paths) {
        const el = byPath[p];
        if (!el) { out[p] = { found: false }; continue; }
        const cs = getComputedStyle(el);
        out[p] = {
          found: true,
          paused: el.paused === true,
          muted: el.muted === true,
          autoplayAttribute: el.autoplay === true,
          currentTime: typeof el.currentTime === "number" ? Math.round(el.currentTime * 1000) / 1000 : null,
          readyState: el.readyState,
          posterAttribute: el.getAttribute("poster") || null,
          /* A video showing its poster has not begun painting frames. There is
           * no direct signal for it, so the two observable proxies are recorded
           * and the conclusion is left to the reader. */
          hasPlayed: typeof el.currentTime === "number" && el.currentTime > 0,
          display: cs.display, visibility: cs.visibility, opacity: cs.opacity
        };
      }
      return out;
    }, normalVideos.map((v) => v.domPath)));

    const videos = normalVideos.map((v) => {
      const r = states?.[v.domPath];
      if (!r || r.found === false) {
        return {
          mediaId: v.mediaId, domPath: v.domPath, status: "unknown",
          reason: "the video element was not present under reduced motion, so its behaviour could not be compared",
          paused: null, autoplayPrevented: null, muted: null, posterShown: null, changed: null
        };
      }
      const autoplayPrevented = v.autoplay === true && r.paused === true && r.hasPlayed === false;
      const posterShown = isPresent(r.posterAttribute) && r.hasPlayed === false;
      const changed = (v.paused !== r.paused) || (v.muted !== r.muted) || autoplayPrevented;
      return {
        mediaId: v.mediaId, domPath: v.domPath, status: "measured", reason: null,
        paused: r.paused, muted: r.muted,
        autoplayPrevented,
        posterShown,
        currentTime: r.currentTime,
        readyState: r.readyState,
        normal: { paused: v.paused ?? null, muted: v.muted ?? null, autoplay: v.autoplay ?? null },
        changed
      };
    });

    return { status: "compared", reason: null, videos };
  } catch (e) {
    return { status: "failed", reason: "the reduced-motion video pass threw: " + String(e?.message ?? e), videos: [] };
  } finally {
    if (pageId) { try { await driver.closePage(pageId); } catch { /* going away */ } }
  }
}

const isPresent = (v) => v !== null && v !== undefined && v !== "";

/* ───────────────────────────────── the pass ─────────────────────────────── */

export async function runMediaPass({
  url, viewport, height = 900, outDir = null,
  navigationTimeoutMs = null, driverFactory = null, sleep = null,
  budget = DEFAULT_MEDIA_BUDGET, onProgress = null
} = {}) {
  const b = { ...DEFAULT_MEDIA_BUDGET, ...budget, ...(navigationTimeoutMs ? { navigationTimeoutMs } : {}) };
  const say = (m) => onProgress?.(m);
  const viewportDir = outDir ? join(outDir, String(viewport)) : null;
  const framesDir = viewportDir ? join(viewportDir, "media", "frames") : null;
  const canvasDir = viewportDir ? join(viewportDir, "media", "canvas") : null;

  const driver = (driverFactory ?? (() => new PlaywrightDriver()))();
  let started = false;
  let pageId = null;
  let media = null;
  const canvasObservation = {
    $canvasContract: CANVAS_CONTRACT_VERSION,
    viewport, url, capturedAt: new Date().toISOString(), items: [], limitations: []
  };

  try {
    const start = await driver.start();
    if (!ok(start)) return failed({ viewport, url, reason: "the browser driver could not start: " + failureOf(start) });
    started = true;

    const opened = await driver.openPage({ viewport, height });
    pageId = value(opened)?.pageId ?? null;
    if (!pageId) return failed({ viewport, url, reason: "a fresh page context could not be opened: " + failureOf(opened) });

    const nav = await driver.navigate(pageId, url, { waitUntil: "networkidle", timeoutMs: b.navigationTimeoutMs });
    if (!ok(nav)) return failed({ viewport, url, reason: "navigation did not complete: " + failureOf(nav) });

    /* Media is enumerated AFTER settling, unlike motion: a lazily loaded image
     * that has not arrived yet is not evidence of a missing asset. */
    await wait(sleep, b.settleMs);

    /* The enumerator is handed over as a source STRING, which `page.evaluate`
     * accepts as an expression and compiles inside the page.
     *
     * It is not built with `new Function` and not run through `eval` here. This
     * process must contain no dynamic evaluation of its own — an invariant the
     * release tests enforce, and rightly: a tool whose whole job is to visit
     * arbitrary websites has no business compiling code in its own runtime.
     * Handing a string to the browser keeps the compilation where the untrusted
     * content already lives. */
    const discovered = await driver.evaluate(
      pageId,
      mediaDiscoverySource({ maxItems: b.maxItems, probeCanvasContext: b.probeCanvasContext })
    );
    const payload = value(discovered);

    media = deriveMediaObservation({ payload, viewport, url });
    if (media.status !== "completed") return { media, canvas: canvasObservation, relativePaths: paths(viewport) };

    /* Videos. */
    let sampled = 0;
    for (const item of media.items) {
      if (item.surface !== SURFACE.VIDEO) continue;
      if (sampled >= b.maxVideosSampled) { item.frameSampling = { sampled: false, reason: "the per-run video sampling budget was reached", frames: [] }; continue; }
      sampled++;
      if (!framesDir) { item.frameSampling = { sampled: false, reason: "no output directory was supplied", frames: [] }; continue; }
      item.frameSampling = await sampleVideoFrames({ driver, pageId, item, budget: b, dir: framesDir, sleep });
      if (item.frameSampling.frames.length) {
        item.availability = AVAILABILITY.CAPTURED;
        item.availabilityReason = "frames were sampled from the playing element and saved under the run directory";
        item.evidenceGrade = "measured";
      }
    }

    /* Canvases.
     *
     * Three separate measurements, in an order that matters: the at-rest time
     * series runs BEFORE anything scrolls, so a redraw caused by scrolling
     * cannot be recorded as a timer-driven one. */
    const canvasItems = media.items.filter((i) => i.surface === SURFACE.CANVAS);
    const sampledCanvases = canvasItems.slice(0, b.maxCanvasesSampled);

    const timeSeries = new Map();
    for (const item of sampledCanvases) {
      timeSeries.set(item.mediaId, await canvasTimeSeries({ driver, pageId, item, budget: b, sleep }));
    }
    for (const item of canvasItems.slice(b.maxCanvasesSampled)) {
      timeSeries.set(item.mediaId, {
        tested: false, classification: "unresolved", changed: null, samples: [], offsets: b.canvasSampleOffsets,
        reason: "the per-run canvas sampling budget was reached before this canvas"
      });
    }

    const scrollSamples = await canvasScrollSampling({ driver, pageId, canvasItems: sampledCanvases, budget: b, sleep });

    let rastered = 0;
    for (const item of media.items) {
      if (item.surface !== SURFACE.CANVAS) continue;
      const record = {
        mediaId: item.mediaId, domPath: item.domPath,
        attributeWidth: item.attributeWidth, attributeHeight: item.attributeHeight,
        cssWidth: item.cssWidth ?? null, cssHeight: item.cssHeight ?? null,
        devicePixelWidth: item.devicePixelWidth, devicePixelHeight: item.devicePixelHeight,
        devicePixelRatio: item.devicePixelRatio ?? null,
        renderedBounds: item.geometry,
        readable: item.readback?.readable ?? null,
        readbackReason: item.readback?.reason ?? null,
        contextType: item.contextType ?? null,
        contextProbed: item.contextProbed === true,
        webgl: item.webgl ?? null,
        raster: null, pixelChange: null,
        classification: null
      };

      const series = timeSeries.get(item.mediaId) ?? null;
      const scroll = scrollSamples.get(item.mediaId) ?? null;
      record.timeSeries = series;
      record.scrollSampling = scroll;

      /* `pixelChange` is kept, with the same shape every existing consumer
       * reads. It now summarises the whole series rather than two reads. */
      record.pixelChange = series
        ? { tested: series.tested, changed: series.changed, reason: series.reason }
        : { tested: false, changed: null, reason: "no sampling was performed for this canvas" };

      if (rastered < b.maxCanvasesRastered && canvasDir) {
        rastered++;
        record.raster = await rasterCanvas({ driver, pageId, item, dir: canvasDir, sleep });
        if (record.raster?.relativePath) {
          item.availability = AVAILABILITY.CAPTURED;
          item.availabilityReason = record.raster.method === "toDataURL"
            ? "canvas pixels were read directly and saved under the run directory"
            : "the canvas backing store was not readable, but a composited region screenshot was saved under the run directory";
          item.evidenceGrade = record.raster.method === "toDataURL" ? "measured" : "observed";
        }
      } else if (canvasDir) {
        record.raster = { method: null, relativePath: null, bytes: null, reason: "the per-run canvas raster budget was reached", pixelChange: null };
      }

      /* Static, animated (changing), or unresolved — never "a particle system".
       *
       * Scroll evidence can promote a static verdict to animated: a canvas that
       * held still on a timer and redrew when the page moved IS changing, just
       * not on its own. It can never demote one — a canvas seen to change at
       * rest does not become static because scrolling changed nothing. */
      const scrollChanged = scroll?.changed === true;
      record.classification = series?.tested
        ? ((series.changed || scrollChanged) ? "animated" : "static")
        : (scrollChanged ? "animated" : "unresolved");
      record.changeSource = series?.changed
        ? (scrollChanged ? "at-rest and on scroll" : "at rest")
        : scrollChanged ? "on scroll only" : null;

      canvasObservation.items.push(record);
    }

    /* Reduced motion, last, in its own fresh context. */
    if (b.reducedMotionVideo) {
      const videos = media.items.filter((i) => i.surface === SURFACE.VIDEO);
      const rm = await reducedMotionVideo({ driver, url, viewport, height, budget: b, sleep, normalVideos: videos });
      media.reducedMotion = rm;
      for (const v of rm.videos ?? []) {
        const item = media.items.find((i) => i.mediaId === v.mediaId);
        if (item) item.reducedMotion = v;
      }
      for (const item of videos) {
        if (item.reducedMotion) continue;
        item.reducedMotion = {
          mediaId: item.mediaId, domPath: item.domPath, status: "unknown",
          reason: rm.reason ?? "no reduced-motion comparison was made for this video",
          paused: null, autoplayPrevented: null, muted: null, posterShown: null, changed: null
        };
      }
    }

    say(`media: ${media.items.length} surface(s), ${sampled} video(s) sampled, ${canvasObservation.items.length} canvas(es)`);
  } catch (e) {
    return failed({ viewport, url, reason: "the media pass threw: " + String(e?.message ?? e) });
  } finally {
    if (pageId) { try { await driver.closePage(pageId); } catch { /* going away */ } }
    if (started) { try { await driver.stop(); } catch { /* nothing left */ } }
  }

  return { media, canvas: canvasObservation, relativePaths: paths(viewport) };
}

function failed({ viewport, url, reason }) {
  return {
    media: {
      $mediaContract: MEDIA_CONTRACT_VERSION, viewport, url,
      capturedAt: new Date().toISOString(), status: "failed", reason,
      items: [], counts: {}, byAvailability: {}, limitations: [reason]
    },
    canvas: { $canvasContract: CANVAS_CONTRACT_VERSION, viewport, url, capturedAt: new Date().toISOString(), items: [], limitations: [reason] },
    relativePaths: paths(viewport)
  };
}

const paths = (viewport) => ({
  media: `${viewport}\\${MEDIA_ARTIFACT_FILENAME}`,
  canvas: `${viewport}\\${CANVAS_ARTIFACT_FILENAME}`
});

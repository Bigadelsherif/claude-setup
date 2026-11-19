/**
 * The full extraction capture, as one callable.
 *
 * `tools/capture-playwright.mjs` and the CLI both need it, and a second copy
 * of the injection order, the settle loop and the two extraction passes would
 * be a second capture method — producing artifacts that look interchangeable
 * and are not.
 *
 * The extractor sources are loaded verbatim from src/extract/. Nothing here
 * alters an extraction heuristic; it only transports them.
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { withCaptureSession } from "./session.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const EXTRACT_JS = join(ROOT, "src", "extract", "extract.js");
const PROBE_JS = join(ROOT, "src", "extract", "probe.js");

/** Pre-capture diagnostics: things the extractor does not itself report. */
export const DIAGNOSTICS = () => {
  const consentHints = /consent|cookie|gdpr|privacy-banner|onetrust|truste|cmp/i;
  const consent = [];
  const overlays = [];

  document.querySelectorAll("body *").forEach((el) => {
    const id = el.id || "";
    const cls = typeof el.className === "string" ? el.className : "";
    const label = `${el.getAttribute("aria-label") || ""} ${el.getAttribute("role") || ""}`;
    const r = el.getBoundingClientRect();

    if (consentHints.test(`${id} ${cls} ${label}`) && r.width > 100 && r.height > 30) {
      consent.push({ tag: el.tagName.toLowerCase(), id, cls: String(cls).slice(0, 80), w: Math.round(r.width), h: Math.round(r.height) });
    }

    const cs = getComputedStyle(el);
    const z = parseInt(cs.zIndex, 10);
    if ((cs.position === "fixed" || cs.position === "sticky") && z >= 10 && r.width > 200 && r.height > 40) {
      overlays.push({
        selector: el.tagName.toLowerCase() + (typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : ""),
        zIndex: z, position: cs.position, w: Math.round(r.width), h: Math.round(r.height)
      });
    }
  });

  let accessible = 0;
  const blocked = [];
  for (const s of document.styleSheets) {
    try { void s.cssRules.length; accessible++; }
    catch { blocked.push(s.href || "inline"); }
  }

  const classes = [...document.querySelectorAll("body *")]
    .slice(0, 600)
    .flatMap((e) => (typeof e.className === "string" ? e.className.trim().split(/\s+/) : []))
    .filter(Boolean);
  // A hashed classname is a content hash, not a BEM modifier: a trailing
  // segment of mixed-case/base36 noise with no vowel-ish word shape.
  const hashed = classes.filter((c) => /(^|[_-])[a-z0-9]{6,}$/i.test(c) && !/[_-]{2}/.test(c) && /\d/.test(c));

  return {
    nodes: document.querySelectorAll("body *").length,
    documentHeight: document.body.scrollHeight,
    consentElements: consent.slice(0, 8),
    overlays: overlays.slice(0, 8),
    stylesheets: { total: document.styleSheets.length, accessible, blocked: blocked.length, blockedSample: blocked.slice(0, 5) },
    classNames: { sampled: classes.length, hashedLooking: hashed.length, examples: [...new Set(classes)].slice(0, 15) }
  };
};

/**
 * Captures one page: two extraction passes plus before/after diagnostics.
 *
 * Returns the capture run alongside what it produced. `raw` is null when the
 * extraction did not complete — the caller decides what that means, and the
 * contract on `run.metadata` says why.
 */
export async function captureExtraction({
  url, viewport = 1440, height = 900, settleMs = 1500,
  noCoherence = false, onProgress = null, driverFactory = null, sleep = null,
  screenshotPath = null, navigationTimeoutMs = 90_000
}) {
  const say = (m) => onProgress?.(m);

  /* The extractor and probe must run in the main world before the page's own
   * scripts, and must not be subject to the page's CSP. `onInit` is the
   * driver's name for that guarantee; how an adapter delivers it is the
   * adapter's business, not this module's. */
  const injectScripts = [
    ...(noCoherence ? [{ name: "no-coherence", content: "window.__HELMY_NO_COHERENCE__ = true;", onInit: true }] : []),
    { name: "extract", path: EXTRACT_JS, onInit: true },
    { name: "probe", path: PROBE_JS, onInit: true }
  ];

  const run = await withCaptureSession({
    url, viewport, height, sourceKind: "url", captureMode: "full-extract",
    injectScripts,
    ...(driverFactory ? { driverFactory } : {}),
    ...(sleep ? { sleep } : {}),
    /* A third-party page is not a fixture: fonts may never settle and the
     * network may never idle. Those degrade the capture, they do not abort it.
     *
     * Animation is deliberately NOT frozen. Freezing is right for a capture
     * that measures pixels and wrong for one that measures declared style:
     * this pass reads transition duration, property and easing off computed
     * style and emits them as motion tokens, and a freeze sets all three to
     * zero. The session's defaults were chosen for the screenshot callers;
     * this caller makes its own choice rather than inheriting theirs
     * (def_0032). */
    prepare: { timeoutMs: navigationTimeoutMs, freeze: false, reducedMotion: false }
  }, async (session) => {
    const before = await session.evaluate("diagnostics-before", DIAGNOSTICS);

    /* Settle lazy content: sections never scrolled into view are not in the DOM. */
    await session.evaluate("settle-scroll", async () => {
      const nap = (ms) => new Promise((r) => setTimeout(r, ms));
      const h = document.body.scrollHeight;
      for (let y = 0; y <= h; y += 800) { window.scrollTo(0, y); await nap(120); }
      window.scrollTo(0, 0);
    });
    await new Promise((r) => setTimeout(r, settleMs));

    const after = await session.evaluate("diagnostics-after", DIAGNOSTICS);

    say("running pass 1 (aggregate)");
    const rawOutcome = await session.evaluate("extract", () => window.__HELMY_EXTRACT__());
    if (rawOutcome.status !== "completed") {
      return { raw: null, probe: null, before: before.result?.value ?? null, after: after.result?.value ?? null,
               pageDiagnostics: await session.diagnostics() };
    }
    const raw = rawOutcome.result.value;

    say(`running pass 2 (probe, ${raw.significantSelectors.length} selectors)`);
    const probeOutcome = await session.evaluate(
      "probe",
      (sels) => window.__HELMY_PROBE__(sels, { maxMatches: 3 }),
      raw.significantSelectors.map((s) => s.selector)
    );

    /* The stabilised screenshot comes AFTER both extraction passes, and only
     * if one was asked for.
     *
     * Two correct requirements collide here, and the resolution is that they
     * describe different captures. A style read must not be stabilised, or the
     * freeze zeroes the transition values it exists to collect (def_0032). A
     * pixel comparison must be stabilised, or two mid-animation frames diff
     * into clusters that are not defects. So the page is read first and frozen
     * second, and `stabilised` is recorded against the SCREENSHOT rather than
     * against the extraction — the flag has to say which artifact it is true
     * of, or the equivalent-content gate reads one capture's honesty as the
     * other's. */
    let screenshot = null;
    if (screenshotPath) {
      const frozen = await session.run("freezeAnimation", (d, pageId) => d.freezeAnimation(pageId));
      const reduced = await session.run("setReducedMotion", (d, pageId) => d.setReducedMotion(pageId, true));
      const shot = await session.screenshotFullPage(screenshotPath);
      screenshot = {
        path: screenshotPath,
        taken: shot.status === "completed",
        animationsFrozen: frozen.status === "completed",
        reducedMotion: reduced.status === "completed",
        bytes: shot.result?.value?.bytes ?? null,
        note: "Taken after the style read and after freezing. `animationsFrozen` describes this image, not the extraction above it."
      };
    }

    return {
      raw,
      probe: probeOutcome.status === "completed" ? probeOutcome.result.value : null,
      before: before.result?.value ?? null,
      after: after.result?.value ?? null,
      screenshot,
      pageDiagnostics: await session.diagnostics()
    };
  });

  const { raw = null, probe = null, before = null, after = null, screenshot = null, pageDiagnostics = null } = run.value ?? {};

  const diagnostics = {
    url, viewport, capturedAt: run.metadata.completedAt,
    beforeSettle: before,
    afterSettle: after,
    dynamicContent: before && after ? {
      nodesAdded: after.nodes - before.nodes,
      stylesheetsAdded: after.stylesheets.total - before.stylesheets.total,
      documentHeight: after.documentHeight
    } : null,
    screenshot,
    consoleErrors: (pageDiagnostics?.consoleErrors ?? []).slice(0, 20),
    pageErrors: (pageDiagnostics?.pageErrors ?? []).slice(0, 20),
    networkFailures: (pageDiagnostics?.networkFailures ?? []).slice(0, 20),
    capture: run.metadata
  };

  return { run, raw, probe, diagnostics };
}

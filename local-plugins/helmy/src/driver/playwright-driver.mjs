/**
 * The Playwright adapter.
 *
 * The only file in the project that may import Playwright. Everything above it
 * talks to `BrowserDriver` and reads normalized envelopes, so replacing this
 * file replaces the browser without touching the fidelity layer.
 *
 * Playwright itself is imported lazily, so the interface, the recovery manager
 * and every test that exercises them can run in an environment where no browser
 * is installed at all.
 */

import { BrowserDriver, runOperation, RESULT_STATUS, driverResult } from "./interface.mjs";
import { DriverError, DRIVER_ERROR, classifyPlaywrightError } from "./errors.mjs";

const DRIVER_VERSION = "0.1.0";

export class PlaywrightDriver extends BrowserDriver {
  constructor({ launcher = null, startTimeoutMs = 60_000, launchOptions = null } = {}) {
    super({ name: "playwright-chromium", version: DRIVER_VERSION });
    /* Injectable so the adapter itself is testable without a browser. */
    this.launcher = launcher;
    /* Launch options the caller wants forwarded to the real browser. Carried
     * here so a caller never has to import the vendor package to set one. */
    this.launchOptions = launchOptions;
    /* Long enough that a slow-but-working launch is never cut off, short enough
     * that a hung one is reported rather than waited on (def_0035). */
    this.startTimeoutMs = startTimeoutMs;
    this.browser = null;
    this.pages = new Map();
    this.nextPageId = 1;

    for (const op of [
      "start", "stop", "openPage", "closePage", "navigate", "detectNavigationComplete",
      "setViewport", "waitForDomReady", "waitForNetworkIdle", "waitForFonts", "waitForAssets",
      "injectScript", "screenshot", "screenshotFullPage", "screenshotRegion",
      "queryElements", "computedStyle", "geometry", "evaluate", "triggerState", "focusElement",
      "hoverElement", "clickElement", "setAttribute", "freezeAnimation", "setReducedMotion",
      "consoleErrors", "pageErrors", "networkFailures", "cleanup"
    ]) this.capabilities.add(op);
    /* Declared unsupported rather than silently ignored: Chromium sets device
     * scale at context creation, so it cannot be changed on a live page. */
    this.deviceScaleIsContextLevel = true;
  }

  #op(operation, fn, ctx = {}) {
    return runOperation({ operation, fn, classify: classifyPlaywrightError, ...ctx });
  }

  #page(pageId) {
    const entry = this.pages.get(pageId);
    if (!entry) throw new DriverError(DRIVER_ERROR.BROWSER_UNAVAILABLE, `no open page ${pageId}`, { operation: "page-lookup" });
    return entry;
  }

  /**
   * Starts the browser.
   *
   * The wall-clock bound lives in `runOperation`, which applies one to every
   * operation rather than to the one where a hang happened to be seen first
   * (def_0035). `startTimeoutMs` overrides this operation's share of it.
   */
  async start(options = {}) {
    return this.#op("start", async () => {
      const launch = this.launcher ?? (async () => {
        const { chromium } = await import("playwright");
        return chromium.launch(options.launch ?? this.launchOptions ?? {});
      });
      this.browser = await launch();
      if (!this.browser) throw new DriverError(DRIVER_ERROR.STARTUP_FAILED, "the launcher returned no browser", { operation: "start" });
      return this.identity();
    }, { timeoutMs: options.startTimeoutMs ?? this.startTimeoutMs });
  }

  async stop() {
    return this.#op("stop", async () => {
      if (this.browser) await this.browser.close();
      this.browser = null;
      this.pages.clear();
      return { stopped: true };
    });
  }

  async openPage({ viewport = 1440, height = 900, devicePixelRatio = 1 } = {}) {
    return this.#op("openPage", async () => {
      if (!this.browser) throw new DriverError(DRIVER_ERROR.BROWSER_UNAVAILABLE, "start() has not been called", { operation: "openPage" });
      if (!Number.isFinite(viewport) || viewport < 240 || viewport > 4096) {
        throw new DriverError(DRIVER_ERROR.VIEWPORT_INVALID, `viewport ${viewport} is outside the usable range`, { operation: "openPage" });
      }
      const context = await this.browser.newContext({
        viewport: { width: viewport, height }, deviceScaleFactor: devicePixelRatio
      });
      const page = await context.newPage();
      const id = `page_${this.nextPageId++}`;
      const record = { page, context, viewport, height, devicePixelRatio, console: [], errors: [], network: [] };

      page.on("console", (m) => { if (m.type() === "error") record.console.push(m.text().slice(0, 300)); });
      page.on("pageerror", (e) => record.errors.push(String(e.message).slice(0, 300)));
      page.on("requestfailed", (r) => record.network.push({ url: r.url().slice(0, 200), failure: r.failure()?.errorText ?? null }));

      this.pages.set(id, record);
      return { pageId: id, viewport, height, devicePixelRatio };
    }, { viewport });
  }

  async closePage(pageId) {
    return this.#op("closePage", async () => {
      const entry = this.pages.get(pageId);
      if (!entry) return { closed: false, reason: "no such page" };
      await entry.page.close();
      await entry.context.close();
      this.pages.delete(pageId);
      return { closed: true };
    });
  }

  async navigate(pageId, url, { waitUntil = "networkidle", timeoutMs = 30000 } = {}) {
    return this.#op("navigate", async () => {
      const { page } = this.#page(pageId);
      const response = await page.goto(url, { waitUntil, timeout: timeoutMs });
      return { url, status: response?.status() ?? null, ok: response?.ok() ?? null };
    }, { targetUrl: url });
  }

  async detectNavigationComplete(pageId) {
    return this.#op("detectNavigationComplete", async () => {
      const { page } = this.#page(pageId);
      const state = await page.evaluate(() => document.readyState);
      return { readyState: state, complete: state === "complete" };
    });
  }

  async setViewport(pageId, { width, height = 900 }) {
    return this.#op("setViewport", async () => {
      if (!Number.isFinite(width) || width < 240 || width > 4096) {
        throw new DriverError(DRIVER_ERROR.VIEWPORT_INVALID, `viewport ${width} is outside the usable range`, { operation: "setViewport" });
      }
      const entry = this.#page(pageId);
      await entry.page.setViewportSize({ width, height });
      entry.viewport = width;
      return { width, height };
    }, { viewport: width });
  }

  async setDevicePixelRatio(pageId, ratio) {
    /* Chromium fixes device scale at context creation. Declared unsupported so a
     * caller cannot believe a 2x capture was taken when it was not. */
    return driverResult({
      operation: "setDevicePixelRatio", status: RESULT_STATUS.UNSUPPORTED,
      value: { requested: ratio, reason: "device scale is set when the context is created and cannot be changed on a live page" },
      startedAt: new Date(), completedAt: new Date()
    });
  }

  async waitForDomReady(pageId, { timeoutMs = 15000 } = {}) {
    return this.#op("waitForDomReady", async () => {
      const { page } = this.#page(pageId);
      await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs });
      return { ready: true };
    });
  }

  async waitForNetworkIdle(pageId, { timeoutMs = 15000 } = {}) {
    return this.#op("waitForNetworkIdle", async () => {
      const entry = this.#page(pageId);
      try {
        await entry.page.waitForLoadState("networkidle", { timeout: timeoutMs });
      } catch (e) {
        throw new DriverError(DRIVER_ERROR.ASSET_TIMEOUT, "network did not go idle", { cause: e, operation: "waitForNetworkIdle" });
      }
      return { idle: true, failedRequests: entry.network.slice(0, 20) };
    });
  }

  async waitForFonts(pageId, { timeoutMs = 10000 } = {}) {
    return this.#op("waitForFonts", async () => {
      const { page } = this.#page(pageId);
      try {
        await page.evaluate(() => document.fonts.ready);
        await page.waitForFunction(() => document.fonts.status === "loaded", null, { timeout: timeoutMs });
      } catch (e) {
        throw new DriverError(DRIVER_ERROR.FONT_TIMEOUT, "fonts did not settle", { cause: e, operation: "waitForFonts" });
      }
      return { ready: true };
    });
  }

  async waitForAssets(pageId, { timeoutMs = 15000 } = {}) {
    return this.#op("waitForAssets", async () => {
      const { page } = this.#page(pageId);
      try {
        await page.waitForFunction(
          () => Array.from(document.images).every((i) => i.complete),
          null, { timeout: timeoutMs });
      } catch (e) {
        throw new DriverError(DRIVER_ERROR.ASSET_TIMEOUT, "images did not finish loading", { cause: e, operation: "waitForAssets" });
      }
      return { imagesComplete: true };
    });
  }

  async injectScript(pageId, { path = null, content = null, onInit = false } = {}) {
    return this.#op("injectScript", async () => {
      const { page, context } = this.#page(pageId);
      try {
        if (onInit) await context.addInitScript(path ? { path } : { content });
        else await page.addScriptTag(path ? { path } : { content });
      } catch (e) {
        throw new DriverError(DRIVER_ERROR.SCRIPT_INJECTION_FAILED, "the script could not be injected", { cause: e, operation: "injectScript" });
      }
      return { injected: true, onInit };
    });
  }

  async screenshot(pageId, { path = null } = {}) {
    return this.#op("screenshot", async () => {
      const { page } = this.#page(pageId);
      const buffer = await page.screenshot(path ? { path } : {});
      return { bytes: buffer?.length ?? null, path };
    });
  }

  async screenshotFullPage(pageId, { path = null } = {}) {
    return this.#op("screenshotFullPage", async () => {
      const { page } = this.#page(pageId);
      const buffer = await page.screenshot({ fullPage: true, ...(path ? { path } : {}) });
      return { bytes: buffer?.length ?? null, path, fullPage: true };
    });
  }

  async screenshotRegion(pageId, { clip, path = null }) {
    return this.#op("screenshotRegion", async () => {
      const { page } = this.#page(pageId);
      const buffer = await page.screenshot({ clip, ...(path ? { path } : {}) });
      return { bytes: buffer?.length ?? null, path, clip };
    });
  }

  /**
   * Runs a function in the page.
   *
   * The capture tools need this: their page-side extractors are functions, not
   * property reads, and without it every tool would reach past the interface to
   * a raw Playwright page — which is the coupling this phase exists to remove.
   */
  async evaluate(pageId, fn, arg = undefined) {
    return this.#op("evaluate", async () => {
      const { page } = this.#page(pageId);
      return arg === undefined ? page.evaluate(fn) : page.evaluate(fn, arg);
    });
  }

  async queryElements(pageId, selector) {
    return this.#op("queryElements", async () => {
      const { page } = this.#page(pageId);
      return { selector, count: await page.evaluate((s) => document.querySelectorAll(s).length, selector) };
    });
  }

  async computedStyle(pageId, selector, properties) {
    return this.#op("computedStyle", async () => {
      const { page } = this.#page(pageId);
      const value = await page.evaluate(([s, props]) => {
        const el = document.querySelector(s);
        if (!el) return null;
        const cs = getComputedStyle(el);
        return Object.fromEntries(props.map((p) => [p, cs[p]]));
      }, [selector, properties]);
      if (value === null) throw new DriverError(DRIVER_ERROR.SELECTOR_NOT_FOUND, `no element matches ${selector}`, { operation: "computedStyle" });
      return value;
    });
  }

  async geometry(pageId, selector) {
    return this.#op("geometry", async () => {
      const { page } = this.#page(pageId);
      const value = await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { width: r.width, height: r.height, x: r.left, y: r.top + window.scrollY };
      }, selector);
      if (value === null) throw new DriverError(DRIVER_ERROR.SELECTOR_NOT_FOUND, `no element matches ${selector}`, { operation: "geometry" });
      return value;
    });
  }

  /* ------------------------------------------------ motion observation (M2a) */

  /**
   * Scrolls to an absolute position and waits until the page reports it.
   *
   * Bounded polling on an observable condition rather than a fixed sleep: the
   * question "has the scroll landed" has an answer the page can give, and a
   * sleep long enough to be safe on a slow machine is wasted on every fast one.
   *
   * A page that scroll-jacks may never reach the requested position. That is
   * reported as `settled: false` with the position actually reached — the
   * caller downgrades the observation rather than this pretending it worked.
   */
  async scrollTo(pageId, { x = 0, y = 0, timeoutMs = 3000, tolerancePx = 2 } = {}) {
    return this.#op("scrollTo", async () => {
      const { page } = this.#page(pageId);
      const reached = await page.evaluate(async ([tx, ty, deadlineMs, tol]) => {
        window.scrollTo(tx, ty);
        const started = performance.now();
        let last = -1;
        let stableFor = 0;
        while (performance.now() - started < deadlineMs) {
          const now = window.scrollY;
          /* Settled means: at the target, and not still moving. Smooth-scroll
           * behaviour makes the first read arrive early. */
          if (Math.abs(now - ty) <= tol && now === last) {
            stableFor += 1;
            if (stableFor >= 2) break;
          } else {
            stableFor = 0;
          }
          last = now;
          await new Promise((r) => requestAnimationFrame(() => r()));
        }
        return { x: window.scrollX, y: window.scrollY, elapsedMs: performance.now() - started };
      }, [x, y, timeoutMs, tolerancePx]);

      return {
        requested: { x, y },
        reached: { x: reached.x, y: reached.y },
        settled: Math.abs(reached.y - y) <= tolerancePx,
        elapsedMs: reached.elapsedMs
      };
    });
  }

  /** Scrolls an element into view and reports where it landed. */
  async scrollIntoView(pageId, selector, { block = "center", timeoutMs = 3000 } = {}) {
    return this.#op("scrollIntoView", async () => {
      const { page } = this.#page(pageId);
      const found = await page.evaluate((s) => !!document.querySelector(s), selector);
      if (!found) throw new DriverError(DRIVER_ERROR.SELECTOR_NOT_FOUND, `no element matches ${selector}`, { operation: "scrollIntoView" });

      const result = await page.evaluate(async ([s, blk, deadlineMs]) => {
        const el = document.querySelector(s);
        el.scrollIntoView({ block: blk, inline: "nearest", behavior: "auto" });
        const started = performance.now();
        let last = -1;
        let stableFor = 0;
        while (performance.now() - started < deadlineMs) {
          const now = window.scrollY;
          if (now === last) { stableFor += 1; if (stableFor >= 2) break; } else { stableFor = 0; }
          last = now;
          await new Promise((r) => requestAnimationFrame(() => r()));
        }
        const r = el.getBoundingClientRect();
        return {
          scrollY: window.scrollY,
          rect: { top: r.top, bottom: r.bottom, height: r.height },
          inViewport: r.bottom > 0 && r.top < window.innerHeight,
          elapsedMs: performance.now() - started
        };
      }, [selector, block, timeoutMs]);

      return { selector, ...result };
    });
  }

  /**
   * Installs an IntersectionObserver over a selector set.
   *
   * The apparatus is marked so the extractor excludes it (def_0032) and so
   * cleanup can assert it is gone. Entries accumulate on `window` and are
   * drained by `readIntersections` — the observer must keep running across the
   * scroll actions between the two calls.
   */
  async observeIntersections(pageId, selectors, { threshold = 0 } = {}) {
    return this.#op("observeIntersections", async () => {
      const { page } = this.#page(pageId);
      const installed = await page.evaluate(([sels, th]) => {
        window.__HELMY_IO__ = window.__HELMY_IO__ || { entries: [], observer: null };
        if (window.__HELMY_IO__.observer) window.__HELMY_IO__.observer.disconnect();
        window.__HELMY_IO__.entries = [];
        const seen = [];
        const obs = new IntersectionObserver((records) => {
          for (const r of records) {
            window.__HELMY_IO__.entries.push({
              selector: r.target.getAttribute("data-helmy-io") || null,
              isIntersecting: r.isIntersecting,
              intersectionRatio: r.intersectionRatio,
              timestampMs: Date.now(),
              monotonicMs: performance.now()
            });
          }
        }, { threshold: th });
        for (const s of sels) {
          const el = document.querySelector(s);
          if (!el) continue;
          /* Tagged so an entry can name the selector it came from — the
           * observer callback receives the element, not the query. */
          el.setAttribute("data-helmy-io", s);
          obs.observe(el);
          seen.push(s);
        }
        window.__HELMY_IO__.observer = obs;
        return { observing: seen };
      }, [selectors, threshold]);
      return { observing: installed.observing, threshold };
    });
  }

  /** Drains accumulated intersection entries. `disconnect` also tears down. */
  async readIntersections(pageId, { disconnect = false } = {}) {
    return this.#op("readIntersections", async () => {
      const { page } = this.#page(pageId);
      return page.evaluate((tearDown) => {
        const state = window.__HELMY_IO__;
        if (!state) return { entries: [], disconnected: false, present: false };
        const entries = state.entries.slice();
        if (tearDown) {
          if (state.observer) state.observer.disconnect();
          for (const el of document.querySelectorAll("[data-helmy-io]")) el.removeAttribute("data-helmy-io");
          delete window.__HELMY_IO__;
        }
        return { entries, disconnected: tearDown, present: true };
      }, disconnect);
    });
  }

  async triggerState(pageId, { state, selector, timeoutMs = 5000 }) {
    return this.#op("triggerState", async () => {
      const { page } = this.#page(pageId);
      const exists = await page.evaluate((s) => !!document.querySelector(s), selector);
      if (!exists) throw new DriverError(DRIVER_ERROR.SELECTOR_NOT_FOUND, `no element matches ${selector}`, { operation: "triggerState" });
      try {
        if (state === "hover") await page.hover(selector, { timeout: timeoutMs });
        else if (state === "focus") await page.focus(selector, { timeout: timeoutMs });
        else if (state === "active") {
          const box = await page.locator(selector).first().boundingBox();
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
        } else {
          throw new DriverError(DRIVER_ERROR.STATE_TRIGGER_FAILED, `no induction is defined for \`${state}\``, { operation: "triggerState" });
        }
      } catch (e) {
        if (e instanceof DriverError) throw e;
        throw new DriverError(DRIVER_ERROR.STATE_TRIGGER_FAILED, `could not induce \`${state}\``, { cause: e, operation: "triggerState" });
      }
      return { state, selector, induced: true };
    }, { state });
  }

  async focusElement(pageId, selector) { return this.triggerState(pageId, { state: "focus", selector }); }
  async hoverElement(pageId, selector) { return this.triggerState(pageId, { state: "hover", selector }); }

  async clickElement(pageId, selector, { timeoutMs = 5000 } = {}) {
    return this.#op("clickElement", async () => {
      const { page } = this.#page(pageId);
      await page.click(selector, { timeout: timeoutMs });
      return { selector, clicked: true };
    });
  }

  async setAttribute(pageId, { selector, name, value }) {
    return this.#op("setAttribute", async () => {
      const { page } = this.#page(pageId);
      const ok = await page.evaluate(([s, n, v]) => {
        const el = document.querySelector(s);
        if (!el) return false;
        el.setAttribute(n, v);
        return true;
      }, [selector, name, value]);
      if (!ok) throw new DriverError(DRIVER_ERROR.SELECTOR_NOT_FOUND, `no element matches ${selector}`, { operation: "setAttribute" });
      return { selector, name, value };
    });
  }

  async freezeAnimation(pageId) {
    return this.#op("freezeAnimation", async () => {
      const { page } = this.#page(pageId);
      /* Marked so the extractor can exclude it. A stylesheet the apparatus adds
       * is not one of the page's own, and counting it inflates the sheet total
       * that coverage — and therefore confidence — is computed from (def_0032). */
      await page.addStyleTag({
        content: "*,*::before,*::after{animation-play-state:paused!important;animation:none!important;transition:none!important}"
      });
      await page.evaluate(() => {
        const tags = document.querySelectorAll("style:not([data-helmy-apparatus])");
        const last = tags[tags.length - 1];
        if (last) last.setAttribute("data-helmy-apparatus", "freeze-animation");
      });
      return { frozen: true };
    });
  }

  async setReducedMotion(pageId, enabled = true) {
    return this.#op("setReducedMotion", async () => {
      const { page } = this.#page(pageId);
      await page.emulateMedia({ reducedMotion: enabled ? "reduce" : "no-preference" });
      return { reducedMotion: enabled };
    });
  }

  async consoleErrors(pageId) {
    return this.#op("consoleErrors", async () => ({ errors: this.#page(pageId).console.slice(0, 50) }));
  }

  async pageErrors(pageId) {
    return this.#op("pageErrors", async () => ({ errors: this.#page(pageId).errors.slice(0, 50) }));
  }

  async networkFailures(pageId) {
    return this.#op("networkFailures", async () => ({ failures: this.#page(pageId).network.slice(0, 50) }));
  }

  async cleanup() {
    return this.#op("cleanup", async () => {
      /* Only what closed is forgotten. Clearing the map unconditionally made
       * the policy's retry find nothing to do and report success, so a browser
       * still running was recorded as released — every time (def_0034). */
      const failures = [];
      for (const [id, entry] of [...this.pages]) {
        try {
          await entry.page.close();
          await entry.context.close();
          this.pages.delete(id);
        } catch (e) {
          failures.push({ pageId: id, message: String(e.message).slice(0, 160) });
        }
      }
      try {
        if (this.browser) { await this.browser.close(); this.browser = null; }
      } catch (e) {
        failures.push({ browser: true, message: String(e.message).slice(0, 160) });
      }

      if (failures.length) {
        throw new DriverError(DRIVER_ERROR.CLEANUP_FAILED, `${failures.length} resource(s) could not be released`,
          { operation: "cleanup", detail: failures });
      }
      return { released: true };
    });
  }
}

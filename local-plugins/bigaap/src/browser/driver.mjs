/**
 * The capture seam.
 *
 * Nothing downstream of capture imports from this module. That is the whole
 * point: the IR and every projection are defined against extractor OUTPUT, not
 * against how the browser was driven. Playwright can arrive in Phase 5 as one
 * more implementation of this interface without touching anything else.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_ROOT } from "../workspace/workspace.mjs";

export class CaptureDriver {
  /** @param {string} url */
  async open(url) { throw new Error("not implemented"); }
  async setViewport(width, height) { throw new Error("not implemented"); }
  /** @returns {Promise<unknown>} JSON-serialisable result */
  async evaluate(source, args) { throw new Error("not implemented"); }
  async screenshot(options) { throw new Error("not implemented"); }
  async close() {}
}

/**
 * Phase 0 driver: the agent performs the MCP browser calls itself.
 *
 * This class does not drive anything — it produces the exact call sequence and
 * the injectable script sources, so the capture step is reproducible and
 * reviewable rather than improvised each run.
 */
export class McpBrowserDriver extends CaptureDriver {
  constructor({ viewport = 1440 } = {}) {
    super();
    this.viewport = viewport;
  }

  static scriptSource(name) {
    return readFileSync(join(PLUGIN_ROOT, "src", "extract", name), "utf8");
  }

  /** The injectable expression for a same-origin target that serves /__bigaap/. */
  static sameOriginInjection() {
    return `(async () => {
  const load = async (f) => (0, eval)(await fetch('/__bigaap/' + f).then(r => r.text()));
  await load('extract.js');
  await load('probe.js');
  const raw = window.__BIGAAP_EXTRACT__();
  const probe = window.__BIGAAP_PROBE__(raw.significantSelectors.map(s => s.selector));
  const save = (name, obj) =>
    fetch('/__bigaap/save?name=' + name, { method: 'POST', body: JSON.stringify(obj, null, 2) }).then(r => r.json());
  return { raw: await save('extract-${"$"}{innerWidth}', raw), probe: await save('probe-${"$"}{innerWidth}', probe) };
})()`;
  }

  /**
   * For third-party targets, where /__bigaap/ is not reachable: the sources are
   * inlined into the evaluated expression instead of fetched.
   */
  static inlineInjection() {
    return [
      McpBrowserDriver.scriptSource("extract.js"),
      McpBrowserDriver.scriptSource("probe.js"),
      `JSON.stringify({
         raw: window.__BIGAAP_EXTRACT__(),
         probe: window.__BIGAAP_PROBE__(window.__BIGAAP_EXTRACT__().significantSelectors.map(s => s.selector))
       })`
    ].join("\n;\n");
  }

  /** The documented call sequence, for the agent to execute in order. */
  plan(url) {
    return [
      { tool: "mcp__Claude_Browser__navigate", args: { url } },
      { tool: "mcp__Claude_Browser__resize_window", args: { width: this.viewport, height: 900 } },
      { note: "scroll to settle lazy content, then return to top" },
      { note: "decline non-essential cookies if a consent banner is present" },
      { tool: "mcp__Claude_Browser__javascript_tool", args: { action: "javascript_exec", text: "<injection>" } },
      { note: "write raw/extract-<viewport>.json and raw/probe-<viewport>.json to disk" }
    ];
  }
}

/** Phase 5. Same interface, real automation, disk-written screenshots. */
export class PlaywrightDriver extends CaptureDriver {
  constructor() {
    super();
    throw new Error(
      "PlaywrightDriver arrives in Phase 5. Phase 0 uses McpBrowserDriver; the IR and projections are unaffected by the choice."
    );
  }
}

export function createDriver(tier, options) {
  switch (tier) {
    case "mcp-browser":
      return new McpBrowserDriver(options);
    case "playwright":
      return new PlaywrightDriver(options);
    default:
      throw new Error(`unknown capture tier: ${tier}`);
  }
}

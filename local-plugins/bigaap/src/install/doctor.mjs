/**
 * Installation and environment checks.
 *
 * `bigaap doctor` answers one question — *can this build do the work?* — without
 * doing any of it. That constraint is the whole design: **no check here launches
 * a browser** unless the caller explicitly asks, because the most common reason
 * to run doctor is that something is already wrong, and a diagnostic that starts
 * a browser to tell you the browser is missing hangs precisely when you needed
 * an answer.
 *
 * Browser presence is therefore a filesystem question, answered by the same
 * `browserLikelyInstalled` the preflight uses. It has three outcomes and the
 * third is load-bearing: `true`, `false`, and `null` for *could not determine*.
 * Reporting `null` as `false` would send users to reinstall a browser they
 * already have.
 */

import { existsSync, readdirSync, readFileSync, accessSync, constants, statSync } from "node:fs";
import { join } from "node:path";

import { PLUGIN_ROOT } from "../workspace/workspace.mjs";
import { browserLikelyInstalled } from "../cli/blockers.mjs";
import { PLUGIN_VERSION, PLUGIN_MANIFEST_VERSION, NODE_REQUIREMENT, nodeSatisfied, versionSet } from "./versions.mjs";
import { INCLUDED } from "./manifest.mjs";

/**
 * What a single check can conclude.
 *
 * `unknown` is not a failure. A check that could not determine its answer must
 * say so, because the alternative — guessing — produces confident wrong advice,
 * and confident wrong advice in a diagnostic is worse than silence.
 */
export const CHECK = Object.freeze({
  OK: "ok",
  WARNING: "warning",
  BLOCKING: "blocking",
  UNKNOWN: "unknown"
});

const check = (id, state, summary, { userAction = null, detail = null } = {}) =>
  ({ id, state, summary, userAction, detail });

/**
 * Runs every check.
 *
 * `env` and `root` are injected so the whole thing is testable without touching
 * a real installation — a doctor that can only be tested by breaking the
 * developer's machine does not get tested.
 */
export function runDoctor({
  root = PLUGIN_ROOT,
  env = process.env,
  nodeVersion = process.versions.node,
  allowBrowserLaunch = false,
  packageJson = undefined
} = {}) {
  const checks = [];
  /* Recorded and returned so a caller can assert it. The claim "doctor does not
   * launch a browser" is worth more when the result carries the evidence. */
  let browserLaunched = false;

  /* ------------------------------------------------------------ runtime */
  const node = nodeSatisfied(nodeVersion, NODE_REQUIREMENT);
  checks.push(node.ok
    ? check("runtime-node", CHECK.OK, `Node ${nodeVersion} satisfies ${NODE_REQUIREMENT}.`)
    : check("runtime-node", node.parsed ? CHECK.BLOCKING : CHECK.UNKNOWN, node.reason, {
        userAction: node.parsed
          ? `Install Node ${NODE_REQUIREMENT.replace(">=", "")} or newer. No Docker is required; a normal Node installation is enough.`
          : "Report this: the version string could not be parsed, which is a defect in the check rather than in your runtime."
      }));

  /* ------------------------------------------------ the build's own version */
  if (PLUGIN_VERSION == null) {
    checks.push(check("version-readable", CHECK.BLOCKING,
      "This build cannot read its own version from package.json.", {
        userAction: "Run `bigaap repair`. Nothing can be checked for compatibility against a version that cannot be read."
      }));
  } else if (PLUGIN_MANIFEST_VERSION && PLUGIN_MANIFEST_VERSION !== PLUGIN_VERSION) {
    checks.push(check("version-readable", CHECK.WARNING,
      `package.json says ${PLUGIN_VERSION} and .claude-plugin/plugin.json says ${PLUGIN_MANIFEST_VERSION}.`, {
        userAction: "Set both to the same value. Neither is preferred here, because preferring one silently would make the other permanently wrong."
      }));
  } else {
    checks.push(check("version-readable", CHECK.OK, `bigaap ${PLUGIN_VERSION}.`));
  }

  /* ------------------------------------------------------ required layout */
  const missingDirs = INCLUDED
    .filter((e) => !e.file)
    .map((e) => e.path)
    .filter((p) => !existsSync(join(root, p)));
  checks.push(missingDirs.length === 0
    ? check("layout", CHECK.OK, `All ${INCLUDED.filter((e) => !e.file).length} managed directories are present.`)
    : check("layout", CHECK.BLOCKING, `Missing: ${missingDirs.join(", ")}.`, {
        userAction: "Run `bigaap repair`, or reinstall. A missing source directory means this is a partial installation."
      }));

  /* ------------------------------------------------------ plugin metadata */
  const pluginJson = join(root, ".claude-plugin", "plugin.json");
  if (!existsSync(pluginJson)) {
    checks.push(check("plugin-metadata", CHECK.BLOCKING, "`.claude-plugin/plugin.json` is missing.", {
      userAction: "Claude Code discovers the plugin through this file. Without it the commands and skill will not load. Run `bigaap repair`."
    }));
  } else {
    /* Checked against the shapes the REAL loader accepts, established by
     * running `claude plugin validate` rather than by reading documentation.
     *
     * This check exists because the manifest shipped for two phases in a form
     * the loader rejects outright — `author` as a string, `agents` as a
     * directory — and was labelled `unverified` the whole time. `unverified`
     * must mean *could not be checked*, never *was not checked* (def_0043). */
    const problems = [];
    let manifest = null;
    try {
      manifest = JSON.parse(readFileSync(pluginJson, "utf8"));
    } catch (error) {
      /* Narrowed deliberately. A `SyntaxError` means the file really is bad
       * JSON; anything else is a fault in THIS code, and reporting it as a
       * malformed manifest sends the reader to inspect a file that is fine.
       * That is the def_0039 failure mode, and it happened here too — a
       * missing import surfaced as "it is not readable as JSON
       * (readFileSync is not defined)". */
      if (error instanceof SyntaxError) {
        problems.push(`it is not valid JSON (${error.message.slice(0, 60)})`);
      } else {
        throw error;
      }
    }

    if (manifest) {
      const raw = readFileSync(pluginJson);
      if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
        problems.push("it begins with a UTF-8 BOM, which the loader's JSON parser rejects");
      }
      if (manifest.author != null && typeof manifest.author !== "object") {
        problems.push("`author` is a string; the loader requires an object such as {\"name\": \"…\"}");
      }
      /* An `agents` array passes validation and then suppresses discovery —
       * the loader reported Agents (0) with it present and Agents (1) without.
       * A directory string fails validation outright. Absent is the only form
       * that works. */
      if (manifest.agents !== undefined) {
        problems.push(
          Array.isArray(manifest.agents)
            ? "`agents` is an array; it validates but suppresses agent discovery. Remove the key and let ./agents/ be found by convention"
            : "`agents` is a directory string, which the loader rejects. Remove the key entirely"
        );
      }
    }

    checks.push(problems.length
      ? check("plugin-metadata", CHECK.BLOCKING,
          `.claude-plugin/plugin.json will not load: ${problems.join("; ")}.`, {
            userAction: "Fix the manifest, then confirm with `claude plugin validate .` if the Claude Code CLI is available."
          })
      : check("plugin-metadata", CHECK.OK,
          "`.claude-plugin/plugin.json` matches the shapes the Claude Code loader accepts.", {
            detail: "Checked structurally. Run `claude plugin validate .` to confirm against the loader itself."
          }));

    /* The marketplace manifest the real installation mechanism needs. */
    const marketplace = join(root, ".claude-plugin", "marketplace.json");
    checks.push(existsSync(marketplace)
      ? check("plugin-marketplace", CHECK.OK, "`.claude-plugin/marketplace.json` is present.")
      : check("plugin-marketplace", CHECK.WARNING, "`.claude-plugin/marketplace.json` is missing.", {
          userAction: "A Claude Code plugin is installed from a marketplace, not by copying a directory. Without this file `claude plugin marketplace add` cannot use this repository."
        }));
  }

  /* ------------------------------------------------------------ entrypoint */
  const entry = join(root, "bin", "bigaap.mjs");
  if (!existsSync(entry)) {
    checks.push(check("entrypoint", CHECK.BLOCKING, "`bin/bigaap.mjs` is missing.", { userAction: "Reinstall." }));
  } else {
    /* Readability, not the executable bit. On Windows the bit does not exist,
     * and on POSIX the file is invoked through `node` by the package `bin`
     * shim, so a missing +x is not what would break it. Checking a permission
     * that does not govern the behaviour would produce a warning nobody can
     * act on. */
    let readable = true;
    try { accessSync(entry, constants.R_OK); } catch { readable = false; }
    checks.push(readable
      ? check("entrypoint", CHECK.OK, "`bin/bigaap.mjs` is present and readable.")
      : check("entrypoint", CHECK.BLOCKING, "`bin/bigaap.mjs` cannot be read.", {
          userAction: "Check file permissions on the installation directory."
        }));
  }

  /* -------------------------------------------------------- playwright pkg */
  const playwrightDir = join(root, "node_modules", "playwright");
  const playwrightPresent = existsSync(playwrightDir);
  checks.push(playwrightPresent
    ? check("playwright-package", CHECK.OK, "The `playwright` package is installed.")
    : check("playwright-package", CHECK.WARNING, "The `playwright` package is not installed.", {
        userAction: "Run `npm install` in the plugin directory. Everything except live capture works without it — analysis from existing captures, validation, prompts, corrections and readiness all run with no browser at all."
      }));

  /* ------------------------------------------------------- browser binary */
  if (allowBrowserLaunch) {
    /* Even asked for, this build does not launch one. The flag exists so the
     * refusal is explicit and reportable rather than a silent omission — and
     * so a future phase that adds a launch has a place to put it. */
    checks.push(check("browser-binary", CHECK.UNKNOWN,
      "A launch was requested. This build does not implement a launch-based check.", {
        userAction: "Run `bigaap capture --viewport 1440` against a page you control if you need to confirm a browser actually starts."
      }));
  } else {
    const installed = browserLikelyInstalled(env);
    checks.push(
      installed === true
        ? check("browser-binary", CHECK.OK, "A Chromium build was found where Playwright installs one.", {
            detail: "Found by looking on disk. No browser was started."
          })
        : installed === false
          ? check("browser-binary", CHECK.WARNING, "No Chromium was found where Playwright installs one.", {
              userAction: "Run `npx playwright install chromium`. It downloads a browser (a few hundred MB), so it is never run for you — see docs/INSTALLATION.md."
            })
          : check("browser-binary", CHECK.UNKNOWN, "Whether a browser is installed could not be determined.", {
              userAction: "This is not the same as `no`. If capture fails to start, run `npx playwright install chromium`."
            })
    );
  }

  /* ------------------------------------------------------ generated docs */
  const docsDir = join(root, "docs");
  checks.push(existsSync(docsDir) && readdirSync(docsDir).some((f) => f.endsWith(".md"))
    ? check("documentation", CHECK.OK, `${readdirSync(docsDir).filter((f) => f.endsWith(".md")).length} documents present.`)
    : check("documentation", CHECK.WARNING, "`docs/` is missing or empty.", {
        userAction: "Run `node tools/generate-command-docs.mjs` from a repository checkout."
      }));

  /* ---------------------------------------------------------- writability */
  let writable = true;
  try { accessSync(root, constants.W_OK); } catch { writable = false; }
  checks.push(writable
    ? check("writable", CHECK.OK, "The installation directory is writable.")
    : check("writable", CHECK.WARNING, "The installation directory is not writable.", {
        userAction: "Reading and analysing still work. `bigaap repair` and `bigaap upgrade` will report a permission failure rather than half-writing."
      }));

  /* ------------------------------------------------------------- package */
  if (packageJson !== undefined) {
    checks.push(packageJson == null
      ? check("package-json", CHECK.BLOCKING, "package.json could not be read.", { userAction: "Reinstall." })
      : check("package-json", CHECK.OK, "package.json is readable."));
  }

  const worst = checks.some((c) => c.state === CHECK.BLOCKING) ? CHECK.BLOCKING
    : checks.some((c) => c.state === CHECK.WARNING) ? CHECK.WARNING
      : checks.some((c) => c.state === CHECK.UNKNOWN) ? CHECK.UNKNOWN
        : CHECK.OK;

  return {
    state: worst,
    browserLaunched,
    checks,
    blocking: checks.filter((c) => c.state === CHECK.BLOCKING),
    warnings: checks.filter((c) => c.state === CHECK.WARNING),
    unknown: checks.filter((c) => c.state === CHECK.UNKNOWN),
    versions: versionSet(),
    /* What still works when something is wrong. Stated positively and
     * specifically, because "some features may be unavailable" tells a blocked
     * user nothing they can act on. */
    stillWorks: checks.some((c) => c.id === "browser-binary" && c.state !== CHECK.OK)
      ? ["analysis from existing captures", "validation", "prompt generation", "corrections", "readiness", "packaging"]
      : null
  };
}

/** Renders the doctor report. Blocking first, then warnings, then what passed. */
export function renderDoctor(report) {
  const lines = [];
  const label = { ok: "ok     ", warning: "warn   ", blocking: "BLOCK  ", unknown: "unknown" };

  lines.push(
    report.state === CHECK.OK ? "Everything this build needs is present."
      : report.state === CHECK.BLOCKING ? "Something is missing that this build cannot work without."
        : report.state === CHECK.WARNING ? "Usable, with limits."
          : "Usable. One or more checks could not determine an answer.",
    ""
  );

  for (const c of [...report.blocking, ...report.warnings, ...report.unknown]) {
    lines.push(`  ${label[c.state]} ${c.id.padEnd(20)} ${c.summary}`);
    if (c.userAction) lines.push(`          ${c.userAction}`);
  }
  const passed = report.checks.filter((c) => c.state === CHECK.OK);
  if (passed.length) {
    lines.push("", `  ${passed.length} check(s) passed: ${passed.map((c) => c.id).join(", ")}`);
  }

  if (report.stillWorks) {
    lines.push("", `Still works without a browser: ${report.stillWorks.join(", ")}.`);
  }
  lines.push("", "No browser was launched by this command.", "Docker is not required, and none of this needs it.");
  return lines.join("\n");
}

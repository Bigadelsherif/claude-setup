/**
 * The class-name classifier, made importable from Node.
 *
 * `classifyClassName` lives in `src/extract/extract.js` because it runs inside
 * the page, where it decides whether a class is a utility, a build hash, or a
 * readable name. It is a genuinely tricky heuristic — the comments in that file
 * record a version that misclassified 140 of 151 names on one real site — and
 * duplicating it here to make it importable would guarantee the copy drifts
 * from the original.
 *
 * So this loads the real one. The extractor already publishes its internals
 * for exactly this reason, and the cross-deployment tests have been loading
 * them this way since Phase 2.
 *
 * Without it, `classifySelector` falls back to `() => "unknown"` and every
 * build-generated selector classifies as `unknown` rather than `generated` —
 * which is silent, and which is precisely the case the deploy-safety machinery
 * exists to catch.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const EXTRACTOR = fileURLToPath(new URL("../extract/extract.js", import.meta.url));

function loadInternals() {
  const source = readFileSync(EXTRACTOR, "utf8");
  const module = { exports: {} };
  /* `window` is undefined: the extractor guards its browser entry points, and
   * only the pure helpers are wanted here. */
  new Function("module", "window", source)(module, undefined);
  return module.exports.internals ?? {};
}

const internals = loadInternals();

export const classifyClassName = internals.classifyClassName ?? (() => "unknown");
export const isHashSegment = internals.isHashSegment ?? (() => false);

/** True when the extractor considers this class build-generated. */
export const isGeneratedClass = (name) => classifyClassName(name) === "hashed";

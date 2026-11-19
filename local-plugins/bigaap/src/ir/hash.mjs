import { createHash } from "node:crypto";

/**
 * Content hash of an IR, stamped into every generated file.
 *
 * This is what makes "outputs are derived, never hand-edited" mechanically
 * enforceable: validation rule V6 compares the stamp in each artifact against
 * the current IR. A stale projection or an edited output fails the gate.
 *
 * `meta.capturedAt` is excluded so that re-deriving from the same capture is
 * stable — the hash tracks the CONTENT of the analysis, not when it ran.
 */
export function hashIR(ir) {
  const stable = JSON.stringify(ir, (key, value) => {
    if (key === "capturedAt" || key === "generatedAt") return undefined;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return value;
  });
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

export const STAMP_PREFIX = "bigaap:ir-hash";

export function stampComment(hash) {
  return `<!-- ${STAMP_PREFIX} sha256:${hash} — generated file, do not edit. Correct the evidence and regenerate. -->`;
}

export function readStamp(text) {
  const m = String(text).match(new RegExp(`${STAMP_PREFIX}\\s+sha256:([0-9a-f]{8,64})`));
  return m ? m[1] : null;
}

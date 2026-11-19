/**
 * Deterministic JSON serialization.
 *
 * Two independent reasons, and they pull in the same direction:
 *
 *   1. **Hashing.** A hash over JSON whose key order depends on insertion
 *      order is a hash over an implementation detail. The same analysis would
 *      produce two different hashes depending on which branch happened to set a
 *      field first, and freshness checking would report drift that is not there.
 *
 *   2. **Reading a diff.** When an artifact is regenerated, the only changes a
 *      reader should have to look at are the ones that mean something. Key
 *      reordering buries a single changed value in a hundred moved lines.
 *
 * What is NOT normalised: arrays keep their order, because for evidence lists
 * and candidate lists the order carries meaning — it is priority, or the order
 * things were observed. Sorting them would destroy information to make a diff
 * prettier.
 */

/**
 * `undefined` is not representable in JSON, and `JSON.stringify` deletes object
 * properties that hold it. That silent deletion is exactly the failure this
 * module exists to prevent, so it is a thrown error rather than a quiet drop.
 * A value that is genuinely absent must say so as `null`.
 */
export class UndefinedValueError extends Error {
  constructor(path) {
    super(`undefined at \`${path}\` — JSON cannot represent it, and stringify would drop the key silently. Use null for "no value".`);
    this.name = "UndefinedValueError";
    this.path = path;
  }
}

/** Recursively orders object keys, leaving arrays alone. */
function normalize(value, path = "$", seen = new WeakSet()) {
  if (value === undefined) throw new UndefinedValueError(path);
  if (value === null) return null;
  if (typeof value !== "object") return value;

  if (seen.has(value)) throw new Error(`circular reference at \`${path}\``);
  seen.add(value);

  if (Array.isArray(value)) {
    /* Order is preserved. For evidence ids and contested candidates it IS the
     * information — sorting would say something the analysis never said. */
    return value.map((v, i) => normalize(v, `${path}[${i}]`, seen));
  }

  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = normalize(value[key], `${path}.${key}`, seen);
  }
  return out;
}

/**
 * Serializes an object to stable JSON.
 *
 * `null` survives. That matters more here than anywhere else in the codebase:
 * a `null` score means "no evidence", and dropping it would turn "we did not
 * look" into "this field does not exist", which reads as though the question
 * was never worth asking.
 */
export function serializeStable(value, { indent = 2, trailingNewline = true } = {}) {
  const text = JSON.stringify(normalize(value), null, indent);
  return trailingNewline ? `${text}\n` : text;
}

/** True when two values serialize identically. Used by the regeneration check. */
export const serializesIdentically = (a, b) => {
  try { return serializeStable(a) === serializeStable(b); } catch { return false; }
};

/**
 * Finds every `undefined` rather than throwing on the first.
 *
 * A validator reporting one problem per run makes fixing ten of them a
 * ten-round conversation.
 */
export function findUndefined(value, path = "$", found = []) {
  if (value === undefined) { found.push(path); return found; }
  if (value === null || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    value.forEach((v, i) => findUndefined(v, `${path}[${i}]`, found));
    return found;
  }
  for (const [k, v] of Object.entries(value)) findUndefined(v, `${path}.${k}`, found);
  /* `Object.entries` skips nothing that stringify would drop, but a key set to
   * undefined explicitly still appears there, which is what we want to catch. */
  return found;
}

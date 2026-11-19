/**
 * The redaction layer.
 *
 * One module, and no command implements its own. That is the entire design
 * decision: a redaction rule applied in eleven places is a rule that is wrong in
 * at least one of them, and the one where it is wrong is the one that leaks.
 *
 * The default is **omission**, not masking. A field that is not needed for
 * diagnosis is absent from the event rather than present as `"[redacted]"` —
 * because a masked field still tells a reader that something existed there, and
 * because the only reliable way not to leak a value is not to hold it.
 *
 * What survives redaction is deliberately dull: shapes, counts, categories,
 * durations, versions and hashes. Enough to see that captures against one origin
 * fail more often than against another; never enough to reconstruct the page,
 * the brief, the prompt, or who was looking at what.
 *
 * ## The hashing strategy, stated plainly
 *
 * - **Algorithm:** SHA-256, truncated to 16 hex characters.
 * - **Salt:** a per-project random salt, generated on first use and stored in
 *   the project's observability directory. It never leaves the machine.
 * - **Stable across projects?** No, deliberately. The same URL hashed in two
 *   projects produces two different values, so exported diagnostics from two
 *   projects cannot be correlated to show that both looked at the same site.
 * - **Reversible?** Not by inversion. A hash of a *known candidate* can always
 *   be confirmed by re-hashing it — that is true of every hash, and it is why
 *   hashing is used for grouping rather than as a secrecy mechanism. Nothing
 *   secret is ever hashed; secrets are omitted.
 * - **Retention:** the salt is deleted by `helmy telemetry clear`, which makes
 *   every previously-written hash permanently ungroupable.
 */

import { createHash, randomBytes } from "node:crypto";

/** How much a value is protected. Recorded on every event. */
export const PRIVACY_CLASS = Object.freeze({
  /** Safe to record as-is: versions, counts, durations, enum codes. */
  METADATA: "metadata",
  /** Recorded only as a one-way hash. */
  HASHED: "hashed",
  /** Recorded only at origin level, and only when opted in. */
  ORIGIN_ONLY: "origin-only",
  /** Never recorded at any setting. */
  NEVER: "never"
});

/** How aggressively to redact. */
export const REDACTION_LEVEL = Object.freeze({
  /** The default. URLs hashed, paths reduced, nothing content-bearing kept. */
  HIGH: "high",
  /** URLs kept at origin level. Everything else as `high`. */
  BALANCED: "balanced",
  /** Full URLs kept. Still no content, no secrets, no page text. */
  MINIMAL: "minimal"
});

/**
 * The complete list of what is never recorded, at any redaction level.
 *
 * Declared as data because three things read it: the redactor, the tests, and
 * the generated privacy documentation. A promise made in prose and enforced in
 * code drifts; this is the same list doing both jobs.
 */
export const NEVER_RECORDED = Object.freeze([
  { field: "screenshot", why: "An image of the page is the page. There is no redaction that makes one safe to keep." },
  { field: "html", why: "The DOM is the content. Storing it would store everything the privacy boundary exists to exclude." },
  { field: "dom", why: "Same as HTML: structure plus text is the page." },
  { field: "css", why: "Stylesheet text carries brand identity, custom property names, and often comments with internal detail." },
  { field: "pageText", why: "Page copy is the user's or a third party's content, and often the most sensitive thing on the page." },
  { field: "targetBrief", why: "The brief describes an unreleased product. It is the single most commercially sensitive input this tool takes." },
  { field: "prompt", why: "A generated prompt embeds measured values, brief requirements and product decisions. Recording one records all three." },
  { field: "generatedCode", why: "Same reasoning as prompts, plus it may include a user's own source." },
  { field: "logo", why: "Brand assets belong to the reference. This tool does not copy them into outputs and does not record them either." },
  { field: "cookie", why: "A session cookie is a credential: anyone holding it can act as the user who owned it." },
  { field: "token", why: "A token is a credential, and one that often outlives the session that created it." },
  { field: "authorization", why: "An authorization header is a credential, and it is the one most often logged by accident." },
  { field: "password", why: "Never, under any configuration, however the field is named or wherever it appears." },
  { field: "browserProfile", why: "A profile path identifies a person and often contains their entire browsing history." },
  { field: "environmentValue", why: "Environment variables routinely carry secrets. The names may be useful; the values never are." },
  { field: "evidenceValue", why: "A measured value is a fact about somebody's page. Coverage and counts describe the analysis; values describe the site." }
]);

const NEVER_KEYS = new Set(NEVER_RECORDED.map((r) => r.field.toLowerCase()));

/**
 * Key patterns that mark a value as secret wherever it appears.
 *
 * Matched against the KEY, not the value, and matched loosely on purpose: a
 * false positive costs a redacted field nobody needed, and a false negative
 * costs a leaked credential.
 */
const SECRET_KEY = /(?:^|[_\-.])(?:secret|token|key|password|passwd|pwd|auth|authorization|credential|session|cookie|bearer|apikey|api_key|private)(?:$|[_\-.])|^(?:secret|token|key|password|auth|cookie|apikey)$/i;

/** Value shapes that look like credentials regardless of their key. */
const SECRET_VALUE = [
  { name: "bearer token", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
  { name: "aws key id", pattern: /\bAKIA[0-9A-Z]{12,}\b/ },
  { name: "github token", pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/ },
  { name: "private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "generic long secret", pattern: /\b[A-Za-z0-9_-]{40,}\b/ }
];

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/**
 * Screenshot filenames that suggest sensitive content.
 *
 * A filename is metadata, but people name files after what is in them —
 * `admin-dashboard-with-customer-list.png` describes content the event must not
 * carry even by implication.
 */
const SENSITIVE_NAME = /(?:admin|internal|private|confidential|secret|customer|patient|invoice|salary|payroll|password|prod(?:uction)?[-_]?data|pii|ssn)/i;

/* ------------------------------------------------------------- the salt */

/**
 * A per-project salt, so hashes cannot be correlated between projects.
 *
 * Generated once and held by the caller. This module never touches the
 * filesystem — the store owns persistence, and keeping the redactor pure means
 * it can be tested exhaustively without one.
 */
export const newSalt = () => randomBytes(16).toString("hex");

/** SHA-256, salted, truncated. Documented at the top of this file. */
export function hashValue(value, salt) {
  if (value == null) return null;
  return createHash("sha256").update(`${salt ?? ""}:${String(value)}`).digest("hex").slice(0, 16);
}

/* ---------------------------------------------------------------- URLs */

/**
 * Reduces a URL to what a diagnostic actually needs.
 *
 * Query strings and fragments go at every level: a query parameter is the
 * commonest place for a session id, a search term, or a customer identifier to
 * appear, and a fragment routinely carries application state.
 */
export function redactUrl(url, { level = REDACTION_LEVEL.HIGH, salt = null } = {}) {
  if (!url || typeof url !== "string") return null;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    /* Not parseable as a URL. It might be a path, a template, or free text —
     * none of which is safe to record whole. */
    return { form: "unparseable", hash: hashValue(url, salt), privacy: PRIVACY_CLASS.HASHED };
  }

  const origin = `${parsed.protocol}//${parsed.host}`;

  if (level === REDACTION_LEVEL.MINIMAL) {
    /* Even here the query and fragment are dropped. "Minimal redaction" means
     * the operator accepts recording which pages were analysed; it has never
     * meant recording the parameters they were analysed with. */
    return {
      form: "path",
      origin,
      path: parsed.pathname,
      queryParamCount: [...parsed.searchParams.keys()].length,
      hadFragment: parsed.hash.length > 0,
      privacy: PRIVACY_CLASS.ORIGIN_ONLY
    };
  }
  if (level === REDACTION_LEVEL.BALANCED) {
    return {
      form: "origin",
      origin,
      pathDepth: parsed.pathname.split("/").filter(Boolean).length,
      queryParamCount: [...parsed.searchParams.keys()].length,
      hadFragment: parsed.hash.length > 0,
      privacy: PRIVACY_CLASS.ORIGIN_ONLY
    };
  }

  /* HIGH, the default: nothing but a stable grouping key and a shape. */
  return {
    form: "hash",
    hash: hashValue(origin, salt),
    scheme: parsed.protocol.replace(":", ""),
    pathDepth: parsed.pathname.split("/").filter(Boolean).length,
    queryParamCount: [...parsed.searchParams.keys()].length,
    hadFragment: parsed.hash.length > 0,
    privacy: PRIVACY_CLASS.HASHED
  };
}

/* --------------------------------------------------------------- paths */

/**
 * Reduces a filesystem path to a project-relative one, or to nothing.
 *
 * A path outside the project root leaks the machine's layout and often the
 * user's name (`/Users/jane/...`, `C:\Users\jane\...`). Inside the project it
 * is useful and safe, so the rule is positional rather than pattern-based.
 */
export function redactPath(path, { projectRoot = null, salt = null } = {}) {
  if (!path || typeof path !== "string") return null;

  const normalise = (p) => String(p).replace(/\\/g, "/").replace(/\/+$/, "");
  const value = normalise(path);
  const root = projectRoot ? normalise(projectRoot) : null;

  if (root && value.startsWith(`${root}/`)) {
    return { form: "project-relative", path: value.slice(root.length + 1), privacy: PRIVACY_CLASS.METADATA };
  }
  if (root && value === root) {
    return { form: "project-relative", path: ".", privacy: PRIVACY_CLASS.METADATA };
  }

  /* Outside the project. Keep the extension and the depth — enough to tell a
   * missing fixture from a missing config — and nothing that identifies the
   * machine or the person. */
  const segments = value.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  const extension = last.includes(".") ? last.slice(last.lastIndexOf(".")) : null;

  return {
    form: "outside-project",
    depth: segments.length,
    extension,
    hash: hashValue(value, salt),
    privacy: PRIVACY_CLASS.HASHED
  };
}

/** A screenshot filename, kept only when it suggests nothing about content. */
export function redactFilename(name, { salt = null } = {}) {
  if (!name || typeof name !== "string") return null;
  if (SENSITIVE_NAME.test(name)) {
    return { form: "withheld", reason: "the filename suggests sensitive content", hash: hashValue(name, salt), privacy: PRIVACY_CLASS.HASHED };
  }
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")) : null;
  return { form: "name", name: name.slice(0, 64), extension, privacy: PRIVACY_CLASS.METADATA };
}

/* -------------------------------------------------------------- scalars */

/** True when a key names something that must never be recorded. */
export const isNeverRecorded = (key) =>
  NEVER_KEYS.has(String(key).toLowerCase()) || SECRET_KEY.test(String(key));

/** True when a value looks like a credential whatever its key is called. */
export function looksSecret(value) {
  if (typeof value !== "string") return false;
  return SECRET_VALUE.some(({ pattern }) => pattern.test(value));
}

/** Strips emails from any string that survives to be recorded. */
export const stripEmails = (text) =>
  typeof text === "string" ? text.replace(EMAIL, "[email]") : text;

/* ------------------------------------------------------- the whole event */

/**
 * Redacts an arbitrary object into something safe to write.
 *
 * Walks every key. Anything matching the never-record list, the secret-key
 * pattern or the secret-value shapes is **omitted** — not masked — and the
 * omission is counted so a reader can see that redaction happened without
 * seeing what it happened to.
 */
export function redactEvent(event, { level = REDACTION_LEVEL.HIGH, salt = null, projectRoot = null } = {}) {
  const omitted = [];

  const walk = (node, path = "") => {
    if (node === null || node === undefined) return node;
    if (Array.isArray(node)) return node.map((v, i) => walk(v, `${path}[${i}]`));
    if (typeof node !== "object") {
      if (looksSecret(node)) { omitted.push({ path, why: "value matches a credential shape" }); return undefined; }
      return typeof node === "string" ? stripEmails(node).slice(0, 500) : node;
    }

    const out = {};
    for (const [key, value] of Object.entries(node)) {
      const here = path ? `${path}.${key}` : key;

      if (isNeverRecorded(key)) {
        omitted.push({ path: here, why: "the field name is on the never-record list" });
        continue;
      }
      if (looksSecret(value)) {
        omitted.push({ path: here, why: "value matches a credential shape" });
        continue;
      }

      /* Typed fields get their own reducers rather than the generic walk. */
      if (/^(url|href|source|reference|target)$/i.test(key) && typeof value === "string") {
        out[key] = redactUrl(value, { level, salt });
        continue;
      }
      /* `projectId` and `workspaceId` are paths in this codebase, and they do
       * not end in any of the words above — which is exactly how an absolute
       * path carrying the user's home directory reached an event during the
       * Phase 5.8 integration. Matched by name as well as by suffix. */
      if ((/(?:path|dir|directory|root|file|workspace)$/i.test(key) ||
           /^(?:projectId|workspaceId|observabilityRoot|runRoot|outputDir)$/i.test(key)) &&
          typeof value === "string") {
        out[key] = redactPath(value, { projectRoot, salt });
        continue;
      }
      if (/^(screenshotName|filename|imageName)$/i.test(key) && typeof value === "string") {
        out[key] = redactFilename(value, { salt });
        continue;
      }

      const walked = walk(value, here);
      if (walked !== undefined) out[key] = walked;
    }
    return out;
  };

  const redacted = walk(event);
  return {
    event: redacted,
    /* Counted, never itemised with values. A reader learns that four fields
     * were dropped and why each category applied — not what was in them. */
    redactionApplied: omitted.length > 0,
    omittedCount: omitted.length,
    omittedReasons: [...new Set(omitted.map((o) => o.why))],
    level
  };
}

/** The rules, rendered for the generated privacy documentation. */
export const REDACTION_RULES = Object.freeze([
  { rule: "URLs", behaviour: "Hashed at `high` (default); origin-only at `balanced`; path kept at `minimal`. Query strings and fragments are dropped at every level.", why: "A query parameter is the commonest place for a session id, a search term or a customer identifier to appear." },
  { rule: "Paths inside the project", behaviour: "Kept, project-relative.", why: "Useful for diagnosis and identifies nothing outside the project." },
  { rule: "`projectId` and `workspaceId`", behaviour: "Treated as paths and reduced accordingly.", why: "They ARE paths in this codebase, and they do not end in any of the path-suffix words — which is how an absolute path carrying a home directory reached an event during the Phase 5.8 integration." },
  { rule: "Paths outside the project", behaviour: "Reduced to depth, extension and a hash.", why: "An absolute path leaks the machine's layout and usually the user's name." },
  { rule: "Query parameters", behaviour: "Dropped at every level; only the count is kept.", why: "The count distinguishes a bare URL from a parameterised one without recording either." },
  { rule: "Fragments", behaviour: "Dropped; only a boolean is kept.", why: "Fragments routinely carry application state." },
  { rule: "Email addresses", behaviour: "Replaced with `[email]` in any surviving string.", why: "Personal data that serves no diagnostic purpose." },
  { rule: "Keys matching the secret pattern", behaviour: "Omitted entirely.", why: "Matched loosely on purpose: a false positive costs a field nobody needed; a false negative costs a credential." },
  { rule: "Values matching a credential shape", behaviour: "Omitted entirely, whatever the key is called.", why: "A token stored under a harmless key is still a token." },
  { rule: "Screenshot filenames", behaviour: "Withheld and hashed when the name suggests sensitive content.", why: "People name files after what is in them." },
  { rule: "Everything on the never-record list", behaviour: "Omitted at every configuration.", why: "See the list itself; each entry carries its own reason." }
]);

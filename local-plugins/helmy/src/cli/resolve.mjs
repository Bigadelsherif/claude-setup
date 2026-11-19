/**
 * Input resolution, with provenance on every value.
 *
 * Five sources, in a fixed order. The order is the easy part; the part that
 * matters is that every resolved value carries WHERE it came from. A workflow
 * that reports `viewports: [1440]` without saying whether you asked for that,
 * your project asked for it, or the tool guessed, gives you no way to tell a
 * decision from a default.
 *
 * The other half is a prohibition. Configuration resolves INPUTS — what to
 * analyse, at which widths, in which mode. It may never resolve a FACT. Every
 * key below is an input; the guarded list is checked at resolution time so a
 * future key cannot quietly become a way to set a measurement from a file.
 */

/** Sources, strongest first. Index is precedence. */
export const SOURCE = Object.freeze({
  ARGUMENT: "argument",
  WORKSPACE_CONFIG: "workspace-config",
  PROJECT_CONFIG: "project-config",
  PREFERENCES: "preferences",
  TOOL_DEFAULT: "tool-default"
});

export const SOURCE_ORDER = Object.freeze([
  SOURCE.ARGUMENT,
  SOURCE.WORKSPACE_CONFIG,
  SOURCE.PROJECT_CONFIG,
  SOURCE.PREFERENCES,
  SOURCE.TOOL_DEFAULT
]);

/**
 * Things configuration may never resolve.
 *
 * Not a list of key names to avoid typing — a list of CATEGORIES that belong to
 * evidence rather than to intent. If a future key would let a config file set
 * one of these, the resolver refuses it by name, so the reason is legible
 * rather than surfacing as a strange downstream disagreement.
 */
export const NEVER_CONFIGURABLE = Object.freeze([
  { key: "evidenceStatus", why: "A claim's status is how it came to exist. Setting it from a file would make a guess indistinguishable from a measurement." },
  { key: "safetyGate", why: "A gate exists to refuse output the evidence does not support. A configurable gate is not a gate." },
  { key: "defectStatus", why: "A defect is closed by evidence and a regression test, never by a project deciding it is closed." },
  { key: "unsupportedCapability", why: "Authenticated capture and component-level correction are unavailable by decision. Configuration records the request and refuses it." },
  { key: "irFact", why: "The IR is derived from evidence. A configuration value that entered it would be indistinguishable from something measured." },
  { key: "referenceMeasurement", why: "A measurement belongs to the reference. To disagree with one, file a correction — that path keeps the original reading." }
]);

const NEVER_KEYS = new Set(NEVER_CONFIGURABLE.map((n) => n.key));

/**
 * One resolved value and its provenance.
 *
 * `overridden` lists what was displaced, so a reader can see that their project
 * default was superseded rather than ignored.
 */
function resolved({ key, value, source, candidates }) {
  const beaten = candidates
    .filter((c) => c.source !== source && c.value !== undefined)
    .map((c) => ({ source: c.source, value: c.value }));
  return {
    key,
    /* `null` rather than `undefined` for an absent value: `JSON.stringify`
     * drops undefined properties, so a record carrying one would not survive
     * the round trip into `--json`, and the emitted contract would silently
     * differ from the object it claims to be. `present` carries the
     * distinction that matters. */
    value: value === undefined ? null : value,
    source,
    explicit: source === SOURCE.ARGUMENT,
    defaulted: source === SOURCE.TOOL_DEFAULT,
    overridden: beaten.length > 0,
    overrode: beaten,
    /* Absent everywhere is different from present-and-defaulted. A workflow
     * asking for a required input needs to tell them apart. */
    present: value !== undefined && value !== null
  };
}

/**
 * Resolves one key across the five layers.
 *
 * `layers` is a map of source → object. A key absent from a layer is skipped;
 * a key present with `undefined` is treated as absent, so a caller may pass a
 * whole parsed argv without filtering it first.
 */
export function resolveKey(key, layers, { toolDefault = undefined } = {}) {
  if (NEVER_KEYS.has(key)) {
    const rule = NEVER_CONFIGURABLE.find((n) => n.key === key);
    throw new Error(`\`${key}\` is not resolvable from configuration: ${rule.why}`);
  }

  const candidates = SOURCE_ORDER.map((source) => ({
    source,
    value: source === SOURCE.TOOL_DEFAULT ? toolDefault : layers[source]?.[key]
  }));

  const winner = candidates.find((c) => c.value !== undefined && c.value !== null);
  if (!winner) return resolved({ key, value: null, source: null, candidates });
  return resolved({ key, value: winner.value, source: winner.source, candidates });
}

/**
 * The inputs a workflow resolves, and where each one's tool default lives.
 *
 * Declared as data so the resolution table can be rendered, tested and
 * documented without restating it three times.
 */
export const INPUT_KEYS = Object.freeze([
  { key: "mode", describe: "Which analysis mode to satisfy.", toolDefault: "analyze" },
  { key: "inputType", describe: "Whether the reference is a live URL or a set of screenshots.", toolDefault: "url" },
  { key: "url", describe: "The reference URL.", toolDefault: undefined },
  { key: "screenshots", describe: "Directory or files holding reference screenshots.", toolDefault: undefined },
  { key: "viewports", describe: "Widths to analyse.", toolDefault: [1440] },
  { key: "states", describe: "Interaction states to consider.", toolDefault: ["default"] },
  { key: "briefPath", describe: "Target brief to use for adapt and extend.", toolDefault: undefined },
  { key: "productName", describe: "The name of YOUR product, for adapt and extend.", toolDefault: undefined },
  { key: "stack", describe: "Stack adapter for prompt output.", toolDefault: "next-tailwind" },
  { key: "contentMode", describe: "Content relationship for a fidelity comparison.", toolDefault: "independent-content" },
  { key: "outputDir", describe: "Where generated artifacts are written.", toolDefault: "output" },
  { key: "accessibilityPolicy", describe: "Which published standard findings are judged against.", toolDefault: "apple-hig" },
  { key: "runFidelity", describe: "Whether to run a fidelity comparison after analysing.", toolDefault: false }
]);

/**
 * Builds the five layers from what a caller actually has.
 *
 * `project` and `preferences` are the parsed config files; the mapping from
 * their field names to input keys lives here rather than being spread through
 * the workflows, so a rename touches one place.
 */
export function buildLayers({ args = {}, workspaceConfig = null, project = null, preferences = null } = {}) {
  const fromProject = project ? {
    mode: project.defaults?.mode,
    url: project.reference?.url,
    inputType: project.reference?.kind,
    stack: project.defaults?.stackAdapter,
    accessibilityPolicy: project.defaults?.accessibilityPolicy
  } : {};

  const fromPreferences = preferences ? {
    mode: preferences.defaultMode,
    viewports: preferences.defaultViewports,
    runFidelity: preferences.runOptionalFidelityChecks
  } : {};

  return {
    [SOURCE.ARGUMENT]: args ?? {},
    [SOURCE.WORKSPACE_CONFIG]: workspaceConfig ?? {},
    [SOURCE.PROJECT_CONFIG]: fromProject,
    [SOURCE.PREFERENCES]: fromPreferences,
    [SOURCE.TOOL_DEFAULT]: {}
  };
}

/**
 * Resolves the whole input set.
 *
 * Returns a map of key → resolved record, plus a flat `values` view for
 * callers that only need the answers. Both are returned because a workflow
 * needs the values to run and the records to report.
 */
export function resolveInputs({ args = {}, workspaceConfig = null, project = null, preferences = null, fidelityPolicy = null } = {}) {
  const layers = buildLayers({ args, workspaceConfig, project, preferences });

  /* The fidelity policy contributes at project-config strength: it is a
   * project requirement, not a user preference. */
  if (fidelityPolicy) {
    const p = layers[SOURCE.PROJECT_CONFIG];
    if (p.viewports === undefined) p.viewports = fidelityPolicy.enabledViewports;
    if (p.states === undefined) p.states = fidelityPolicy.enabledStates;
    if (p.contentMode === undefined) p.contentMode = fidelityPolicy.contentMode;
  }

  const records = {};
  for (const spec of INPUT_KEYS) {
    records[spec.key] = { ...resolveKey(spec.key, layers, { toolDefault: spec.toolDefault }), describe: spec.describe };
  }

  const values = Object.fromEntries(Object.entries(records).map(([k, r]) => [k, r.value]));

  return {
    records,
    values,
    /* A compact view for a human summary: only what was not a tool default,
     * because listing thirteen defaults is noise. */
    decided: Object.values(records).filter((r) => r.present && r.source !== SOURCE.TOOL_DEFAULT),
    precedence: SOURCE_ORDER,
    neverConfigurable: NEVER_CONFIGURABLE
  };
}

/** Renders the resolution for a human, one line per decided value. */
export function describeResolution(resolution) {
  return resolution.decided.map((r) => {
    const from = r.explicit ? "you asked" : `from ${r.source}`;
    const over = r.overridden ? ` (overrides ${r.overrode.map((o) => o.source).join(", ")})` : "";
    return `${r.key} = ${JSON.stringify(r.value)} — ${from}${over}`;
  });
}

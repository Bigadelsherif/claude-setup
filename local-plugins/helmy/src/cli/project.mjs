/**
 * The project-local configuration model.
 *
 * A project is a directory of declared intent: what to analyse, against which
 * policies, in which stack. It is emphatically NOT a place to record what was
 * measured — that lives in the workspace, in evidence, and in the IR.
 *
 * The separation is the load-bearing idea here. A configuration value that
 * could overwrite a measured claim would let a preference masquerade as a fact,
 * and every downstream reader would be unable to tell which it was holding. So
 * every value carries a `kind`, `reference-fact` is not a kind configuration
 * may use, and the validator rejects a file that tries.
 */

import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { createHash } from "node:crypto";
import { validate } from "../validate/schema.mjs";
import { readJSON, paths } from "../workspace/workspace.mjs";
import { DEFAULT_TAP_TARGET_POLICY, DEFAULT_POLICY_NAME } from "../policy/tap-target.mjs";

export const PROJECT_DIR = ".helmy-analyzer";

/** Bumped when a config file's shape changes in a way that breaks reading it. */
export const CONFIG_SCHEMA_VERSION = "1";

/**
 * Read from package.json so the recorded tool version cannot drift from the tool.
 *
 * `null` when package.json cannot be read, and deliberately not a fallback
 * version string. The previous fallback was `"0.0.0"`, which is indistinguishable
 * from a real reading — so when `paths.root` turned out not to exist, every
 * project recorded a version that had never been released and nothing could tell
 * that the read had failed at all (def_0039). A null is inconvenient exactly
 * where it should be: a caller has to decide what an unknown version means.
 */
export const HELMY_VERSION = (() => {
  try {
    const v = JSON.parse(readFileSync(paths.root("package.json"), "utf8")).version;
    return typeof v === "string" && v.trim() !== "" ? v : null;
  } catch { return null; }
})();

/**
 * The five states a configuration file can be in.
 *
 * `incomplete` is the one that earns its place: a target-brief template is not
 * absent, and it is not valid either. Collapsing it into either would be a lie
 * in a different direction — "you have no brief" sends the user to create one
 * that already exists, and "you have a brief" lets a template through as if a
 * person had filled it in.
 */
export const CONFIG_STATUS = Object.freeze({
  ABSENT: "absent",
  INCOMPLETE: "incomplete",
  VALID: "valid",
  INVALID: "invalid",
  UNSUPPORTED: "unsupported"
});

/**
 * Where a configuration value comes from.
 *
 * `reference-fact` is listed and is NOT usable in configuration: it exists so
 * the vocabulary is complete and so a file that claims it can be refused by
 * name rather than by a generic error.
 */
export const VALUE_KIND = Object.freeze({
  USER_PREFERENCE: "user-preference",
  PROJECT_REQUIREMENT: "project-requirement",
  REFERENCE_FACT: "reference-fact",
  TARGET_BRIEF_REQUIREMENT: "target-brief-requirement",
  TOOL_DEFAULT: "tool-default",
  UNSUPPORTED_REQUEST: "unsupported-request"
});

/** Kinds configuration is allowed to declare. */
export const CONFIGURABLE_KINDS = Object.freeze([
  VALUE_KIND.USER_PREFERENCE,
  VALUE_KIND.PROJECT_REQUIREMENT,
  VALUE_KIND.TARGET_BRIEF_REQUIREMENT,
  VALUE_KIND.TOOL_DEFAULT,
  VALUE_KIND.UNSUPPORTED_REQUEST
]);

/** The files a project is made of, and what each is for. */
export const PROJECT_FILES = Object.freeze([
  { name: "project.json", schema: "project-config", required: true, describe: "Identity, versions and the defaults every command inherits." },
  { name: "preferences.json", schema: "preferences", required: true, describe: "How output is presented. Never changes what is measured." },
  { name: "accessibility-policy.json", schema: "tap-target-policy", required: true, describe: "Which published standard findings are judged against." },
  { name: "fidelity-policy.json", schema: "fidelity-policy", required: true, describe: "Which viewports, states and content mode a comparison uses." },
  { name: "stack-adapter.json", schema: "stack-adapter", required: true, describe: "How the stack-agnostic IR is rendered into implementation prompts." },
  { name: "target-brief.json", schema: "target-brief", required: false, describe: "What YOUR product must do. A template until you fill it in." }
]);

export const PROJECT_DIRS = Object.freeze([
  { name: "workspaces", describe: "One analysis workspace per reference. Captures, evidence and IR live here." },
  { name: "history", describe: "Fidelity iterations, append-only." },
  { name: "corrections", describe: "Correction records filed against claims." },
  { name: "defects", describe: "Defect reports raised against the tool from this project." },
  { name: "outputs", describe: "Generated artifacts. Projections of an IR, never sources." }
]);

const nowISO = () => new Date().toISOString();

/** A stable project id: derived from name and creation time, never from a path. */
export const makeProjectId = (name, createdAt) =>
  "prj_" + createHash("sha256").update(`${name}|${createdAt}`).digest("hex").slice(0, 16);

/**
 * A project name must be usable as a display name and safe on a filesystem.
 * Refused rather than sanitised — silently renaming a user's project is worse
 * than telling them the name will not do.
 */
export function validateProjectName(name) {
  if (name == null || String(name).trim() === "") return { ok: false, reason: "a project name cannot be empty" };
  const s = String(name);
  if (s.length > 64) return { ok: false, reason: `a project name must be 64 characters or fewer (got ${s.length})` };
  if (/[\u0000-\u001f]/.test(s)) return { ok: false, reason: "a project name cannot contain control characters" };
  if (/[<>:"/\\|?*]/.test(s)) return { ok: false, reason: "a project name cannot contain < > : \" / \\ | ? *" };
  if (/^\.+$/.test(s)) return { ok: false, reason: "a project name cannot be only dots" };
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s)) return { ok: false, reason: `\`${s}\` is a reserved device name on Windows` };
  if (s !== s.trim()) return { ok: false, reason: "a project name cannot begin or end with whitespace" };
  return { ok: true };
}

/* ------------------------------------------------------------- defaults */

export function defaultProject({ name, reference = null, stack = "next-tailwind", createdAt = nowISO() }) {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    helmyVersion: HELMY_VERSION,
    projectId: makeProjectId(name, createdAt),
    projectName: name,
    createdAt,
    updatedAt: createdAt,
    workspaceRoot: "workspaces",
    reference: reference ? { url: reference, kind: "url" } : null,
    defaults: {
      mode: "analyze",
      stackAdapter: stack,
      accessibilityPolicy: DEFAULT_POLICY_NAME,
      fidelityPolicy: "fidelity-policy.json"
    },
    configurationStatus: reference ? CONFIG_STATUS.VALID : CONFIG_STATUS.INCOMPLETE,
    $note:
      "Declared intent, not measured evidence. Nothing in this file may set a reference fact; " +
      "to change a measured claim, file a correction against the evidence."
  };
}

export function defaultPreferences() {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    outputLanguage: "en",
    detailLevel: "standard",
    defaultViewports: [1440, 1024, 768, 375],
    defaultMode: "analyze",
    promptStyle: "instructional",
    includeImplementationNotes: true,
    runOptionalFidelityChecks: false,
    confirmBeforeOverwrite: true,
    confirmBeforeCapture: false,
    $kind: VALUE_KIND.USER_PREFERENCE,
    $note:
      "Presentation only. A preference never alters measured evidence, a safety gate, a mode " +
      "requirement or a tolerance — if one appears to, that is a defect rather than a feature."
  };
}

export function defaultAccessibilityPolicy() {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    ...DEFAULT_TAP_TARGET_POLICY,
    resolvedFrom: "default",
    $kind: VALUE_KIND.PROJECT_REQUIREMENT,
    $note:
      "The default is unchanged from the tool's: Apple HIG at 44px, because every prior phase measured " +
      "against it. Change `policyName` to `wcag-2.2-aa` (24px) or `material-3` (48px) and the chosen " +
      "policy travels with every finding, so a reader can see which standard produced it."
  };
}

export function defaultFidelityPolicy() {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    enabledViewports: [1440, 768],
    /* The resting state only.
     *
     * Naming a non-resting state here is an EXPLICIT request for it, which makes
     * its absence blocking — that is the Phase 5.15 contract and it is correct.
     * But this is a template nobody chose, and listing `hover` and `focus` in it
     * meant every freshly initialised project demanded interactive evidence that
     * a first capture cannot produce, so `recreate` refused before the user had
     * asked for anything. Installed-copy verification hit exactly that.
     *
     * Add `"hover"`, `"focus"` here (or pass `--states hover,focus`) when you
     * want those states recreated and want their absence to stop the run. */
    enabledStates: ["default"],
    contentMode: "independent-content",
    maxIterations: 3,
    stopOnRegression: true,
    stopOnNewUncertainty: true,
    pixelComparison: "equivalent-content-only",
    thresholdProfile: "unvalidated-defaults",
    allowAutomaticGlobalValueCorrection: false,
    allowAutomaticComponentCorrection: false,
    $kind: VALUE_KIND.PROJECT_REQUIREMENT,
    $note:
      "Nothing unsupported is enabled by default. `contentMode` starts at `independent-content` because " +
      "equivalent-content has six entry conditions that must be established rather than assumed. " +
      "`thresholdProfile` is `unvalidated-defaults` because no measured tolerance is validated, and the " +
      "name says so rather than implying a calibrated profile exists. Component-level automatic correction " +
      "is a permanent limitation (def_0030) and cannot be enabled here or anywhere."
  };
}

export function defaultStackAdapter(stack = "next-tailwind") {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    adapter: stack,
    status: stack === "next-tailwind" ? CONFIG_STATUS.VALID : CONFIG_STATUS.UNSUPPORTED,
    framework: "next",
    router: "app",
    language: "typescript",
    styling: "tailwind",
    tokenSource: "css-custom-properties",
    motion: "native-css",
    motionAlternatives: ["gsap"],
    $kind: VALUE_KIND.PROJECT_REQUIREMENT,
    $note:
      "This describes how the IR is RENDERED, never how it is measured. The analysis core is " +
      "stack-agnostic and an audit invariant keeps it that way. `next-tailwind` is the only implemented " +
      "adapter; naming another one here is recorded as unsupported rather than silently substituted."
  };
}

/**
 * The target-brief template.
 *
 * Deliberately NOT schema-valid. A template that validated would let a run
 * proceed on placeholder text, and `adapt` would describe a product nobody
 * described. Every field carries the marker, and `$status` says plainly what
 * this file is.
 */
export function targetBriefTemplate() {
  const NEEDED = "REQUIRED — replace this text. Nothing here will invent it for you.";
  return {
    $schemaTemplate: true,
    $status: CONFIG_STATUS.INCOMPLETE,
    $requiresUserInput: true,
    $note:
      "A TEMPLATE, not a brief. It is deliberately not schema-valid, so a run cannot proceed on " +
      "placeholder text. `helmy adapt` reports `requires-user-input` until you replace every REQUIRED " +
      "field below. The tool will not write your product's intent for you, and would be wrong if it did.",
    $howToComplete: [
      "Replace every REQUIRED value with a description of YOUR product.",
      "Delete the $schemaTemplate, $status and $requiresUserInput markers when done.",
      "Run `helmy blockers --for adapt` to check it before analysing."
    ],
    product: NEEDED,
    productType: NEEDED,
    targetPage: NEEDED,
    platform: NEEDED,
    audience: NEEDED,
    primaryAction: NEEDED,
    constraints: [],
    mustNotCopy: [
      "logos", "brand names", "proprietary copy", "distinctive illustrations",
      "copyrighted photography", "unique brand marks"
    ]
  };
}

/* ---------------------------------------------------------- inspection */

/** Reads a JSON file, distinguishing absent from unparseable. */
function readConfig(path) {
  if (!existsSync(path)) return { status: CONFIG_STATUS.ABSENT, data: null, reason: "the file does not exist" };
  let raw;
  try { raw = readFileSync(path, "utf8"); }
  catch (e) { return { status: CONFIG_STATUS.INVALID, data: null, reason: `unreadable — ${String(e.message).slice(0, 120)}` }; }
  try { return { status: null, data: JSON.parse(raw), reason: null }; }
  catch (e) { return { status: CONFIG_STATUS.INVALID, data: null, reason: `not valid JSON — ${String(e.message).slice(0, 120)}` }; }
}

/** Loads a schema by name, tolerating one that has not been written yet. */
function loadSchema(name) {
  try { return readJSON(paths.schema(name)); } catch { return null; }
}

/**
 * Classifies one configuration file into the five states.
 *
 * The order matters: a file that declares a `reference-fact` is `invalid`
 * before anything else is considered, because that is a category error rather
 * than a missing field.
 */
export function inspectConfigFile(projectRoot, spec) {
  const path = join(projectRoot, spec.name);
  const read = readConfig(path);
  if (read.status) return { file: spec.name, path, status: read.status, reason: read.reason, data: null };

  const data = read.data;

  /* Configuration may never claim to be evidence. */
  if (data && data.$kind === VALUE_KIND.REFERENCE_FACT) {
    return {
      file: spec.name, path, status: CONFIG_STATUS.INVALID, data,
      reason: "declares `$kind: reference-fact`. Configuration states intent; only evidence states facts. " +
              "To change a measured claim, file a correction."
    };
  }
  if (data && data.$kind && !CONFIGURABLE_KINDS.includes(data.$kind)) {
    return { file: spec.name, path, status: CONFIG_STATUS.INVALID, data, reason: `\`$kind: ${data.$kind}\` is not a kind configuration may declare` };
  }

  /* A template announces itself, and is incomplete by construction. */
  if (data && (data.$schemaTemplate === true || data.$requiresUserInput === true || data.$status === CONFIG_STATUS.INCOMPLETE)) {
    return { file: spec.name, path, status: CONFIG_STATUS.INCOMPLETE, data,
             reason: "a template awaiting the values only you can supply" };
  }

  if (data && data.status === CONFIG_STATUS.UNSUPPORTED) {
    return { file: spec.name, path, status: CONFIG_STATUS.UNSUPPORTED, data,
             reason: `\`${data.adapter ?? "this configuration"}\` is recorded but not implemented` };
  }

  const schema = loadSchema(spec.schema);
  if (!schema) return { file: spec.name, path, status: CONFIG_STATUS.VALID, data, reason: "no schema is published for this file; shape unchecked" };

  const result = validate(schema, data);
  if (!result.valid) {
    const detail = result.errors.slice(0, 4).map((e) => `${e.path} ${e.message}`).join("; ");
    /* Missing required fields on an otherwise well-formed file is
     * `incomplete`; a type error or a forbidden value is `invalid`. The remedy
     * differs, so the status must too. */
    const onlyMissing = result.errors.every((e) => /required property missing/i.test(e.message));
    return {
      file: spec.name, path, data,
      status: onlyMissing ? CONFIG_STATUS.INCOMPLETE : CONFIG_STATUS.INVALID,
      reason: detail
    };
  }

  /* A schema version this build cannot read is unsupported, not invalid: the
   * file may be perfectly good and simply newer. */
  if (data.schemaVersion && String(data.schemaVersion) !== CONFIG_SCHEMA_VERSION) {
    const newer = Number(data.schemaVersion) > Number(CONFIG_SCHEMA_VERSION);
    return {
      file: spec.name, path, data, status: CONFIG_STATUS.UNSUPPORTED,
      reason: newer
        ? `schema version ${data.schemaVersion} is newer than this build reads (${CONFIG_SCHEMA_VERSION}). Upgrade helmy.`
        : `schema version ${data.schemaVersion} predates this build (${CONFIG_SCHEMA_VERSION}). Run \`helmy init\` to add what is missing.`
    };
  }

  return { file: spec.name, path, status: CONFIG_STATUS.VALID, data, reason: null };
}

/** Whether a directory looks like a helmy project at all. */
export const projectExists = (projectRoot) => existsSync(join(projectRoot, "project.json"));

/**
 * Inspects a whole project.
 *
 * Returns a status per file and a roll-up. The roll-up takes the WORST status
 * among REQUIRED files — a project with one invalid config is not partly valid.
 *
 * The target brief is deliberately outside it. A brief is required by `adapt`
 * and `extend` and by nothing else, so folding a template into the roll-up
 * would report a project as incomplete for `analyze`, which it is not.
 * `targetBriefStatus` is returned beside it and is what the brief-dependent
 * modes read.
 */
export function inspectProject(projectRoot) {
  const files = PROJECT_FILES.map((spec) => ({ ...inspectConfigFile(projectRoot, spec), required: spec.required, describe: spec.describe }));
  const dirs = PROJECT_DIRS.map((d) => ({
    name: d.name,
    path: join(projectRoot, d.name),
    present: existsSync(join(projectRoot, d.name)),
    describe: d.describe
  }));

  const required = files.filter((f) => f.required);
  const RANK = {
    [CONFIG_STATUS.ABSENT]: 0,
    [CONFIG_STATUS.INVALID]: 1,
    [CONFIG_STATUS.UNSUPPORTED]: 2,
    [CONFIG_STATUS.INCOMPLETE]: 3,
    [CONFIG_STATUS.VALID]: 4
  };
  const worst = required.reduce((acc, f) => (RANK[f.status] < RANK[acc] ? f.status : acc), CONFIG_STATUS.VALID);

  return {
    root: projectRoot,
    exists: projectExists(projectRoot),
    /* What `status` covers, stated rather than inferred from the field name. */
    statusCovers: "required configuration files only; the target brief is reported separately",
    files,
    directories: dirs,
    status: required.length === 0 ? CONFIG_STATUS.ABSENT : worst,
    missingFiles: files.filter((f) => f.status === CONFIG_STATUS.ABSENT).map((f) => f.name),
    missingDirectories: dirs.filter((d) => !d.present).map((d) => d.name),
    invalidFiles: files.filter((f) => f.status === CONFIG_STATUS.INVALID).map((f) => ({ file: f.file, reason: f.reason })),
    incompleteFiles: files.filter((f) => f.status === CONFIG_STATUS.INCOMPLETE).map((f) => ({ file: f.file, reason: f.reason })),
    unsupportedFiles: files.filter((f) => f.status === CONFIG_STATUS.UNSUPPORTED).map((f) => ({ file: f.file, reason: f.reason })),
    /* A brief that is a template is not a brief. Recorded separately because it
     * is the single most common reason `adapt` cannot run. */
    targetBriefStatus: files.find((f) => f.file === "target-brief.json")?.status ?? CONFIG_STATUS.ABSENT
  };
}

/** The README written into a new project. Explains the layout rather than the tool. */
export function projectReadme(project) {
  const l = [];
  l.push(`# ${project.projectName}`);
  l.push("");
  l.push("A helmy analysis project. Everything here is either **declared intent** (configuration)");
  l.push("or **recorded evidence** (workspaces, history, corrections). The two never mix:");
  l.push("configuration cannot set a measured fact, and a generated artifact is never a source.");
  l.push("");
  l.push("## Configuration");
  l.push("");
  l.push("| File | Purpose |");
  l.push("| --- | --- |");
  for (const f of PROJECT_FILES) l.push(`| \`${f.name}\` | ${f.describe} |`);
  l.push("");
  l.push("## Directories");
  l.push("");
  l.push("| Directory | Holds |");
  l.push("| --- | --- |");
  for (const d of PROJECT_DIRS) l.push(`| \`${d.name}/\` | ${d.describe} |`);
  l.push("");
  l.push("## Before you analyse");
  l.push("");
  l.push("`target-brief.json` is a **template**, not a brief. It is deliberately not schema-valid,");
  l.push("so `helmy adapt` reports `requires-user-input` until you fill it in. The tool will not");
  l.push("write your product's intent for you.");
  l.push("");
  l.push("```bash");
  l.push("helmy blockers --for analyze    # what would stop a run, without capturing anything");
  l.push("```");
  l.push("");
  l.push("## What this project cannot do");
  l.push("");
  l.push("- Capture authenticated pages. No command accepts credentials.");
  l.push("- Correct your components automatically. A permanent limitation (`def_0030`).");
  l.push("- Run unattended. This directory is not concurrency-safe.");
  l.push("");
  return l.join("\n");
}

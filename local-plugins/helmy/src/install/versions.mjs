/**
 * Every version this build declares, in one place.
 *
 * Before this module the versions existed — `EXTRACTOR_VERSION` in the capture
 * session, `CONFIG_SCHEMA_VERSION` in the project model, `EVENT_SCHEMA_VERSION`
 * in the event model, and five more — but no single thing could enumerate them.
 * `helmy version` needs that enumeration, and so does every compatibility check:
 * a build that cannot list what it speaks cannot say what it refuses.
 *
 * Nothing here declares a NEW version. Each field re-exports the constant its
 * own module already owns, so a version cannot be bumped in two places and
 * disagree with itself. The one exception is `PLUGIN_VERSION`, which is read
 * from `package.json` because that is where a package's version lives.
 *
 * ## Two kinds of version, deliberately not merged
 *
 * A **schema** version describes a file this build writes. Bumping it says
 * "files written from now on have a different shape". A **compatibility** range
 * describes files this build will READ. They are separate because a build must
 * usually read more than it writes: a tool that only reads its own current
 * output cannot upgrade anybody.
 */

import { readFileSync } from "node:fs";

import { paths } from "../workspace/workspace.mjs";
import { CONFIG_SCHEMA_VERSION } from "../cli/project.mjs";
import { EXTRACTOR_VERSION, TOLERANCE_VERSION, CAPTURE_CONTRACT_VERSION } from "../capture/session.mjs";
import { EVENT_SCHEMA_VERSION } from "../observe/event.mjs";
import { CONFIG_VERSION as OBSERVABILITY_CONFIG_VERSION } from "../observe/config.mjs";
import { METADATA_VERSION } from "../artifacts/metadata.mjs";
import { CLI_RESULT_VERSION } from "../cli/result.mjs";

/**
 * Read from package.json so the reported version cannot drift from the package.
 *
 * `null` rather than a fallback string when it cannot be read. A build that
 * cannot state its own version must say so — `helmy doctor` reports it as a
 * blocker, because nothing can be checked for compatibility against a version
 * that was invented by a catch block (def_0039).
 */
export const PLUGIN_VERSION = (() => {
  try {
    const v = JSON.parse(readFileSync(paths.root("package.json"), "utf8")).version;
    return typeof v === "string" && v.trim() !== "" ? v : null;
  } catch { return null; }
})();

/**
 * The plugin manifest's own version.
 *
 * Read separately from `package.json` rather than assumed equal, because they
 * are two files and two files drift. `helmy doctor` reports it when they
 * disagree instead of picking one — a silent preference here would make the
 * other file's value unreachable and therefore permanently wrong.
 */
export const PLUGIN_MANIFEST_VERSION = (() => {
  try { return JSON.parse(readFileSync(paths.root(".claude-plugin", "plugin.json"), "utf8")).version ?? null; }
  catch { return null; }
})();

/** The IR schema version. Owned by `src/ir/derive.mjs`, which does not export it. */
export const IR_SCHEMA_VERSION = "0.1.0";

/** The evidence schema version. Owned by `src/evidence/build.mjs`, which does not export it. */
export const EVIDENCE_SCHEMA_VERSION = "0.1.0";

/** The browser driver version, as the driver reports it. */
export const DRIVER_VERSION = "0.1.0";

/**
 * The full version set, as every command reports it.
 *
 * Ordered by what a reader looks for first. `helmy version --json` emits this
 * object verbatim, so adding a field here is how a new version becomes visible
 * everywhere at once.
 */
export function versionSet() {
  return {
    helmy: PLUGIN_VERSION,
    plugin: PLUGIN_MANIFEST_VERSION,
    schemas: {
      config: CONFIG_SCHEMA_VERSION,
      ir: IR_SCHEMA_VERSION,
      evidence: EVIDENCE_SCHEMA_VERSION,
      artifactMetadata: METADATA_VERSION,
      observabilityEvent: String(EVENT_SCHEMA_VERSION),
      observabilityConfig: OBSERVABILITY_CONFIG_VERSION,
      captureContract: CAPTURE_CONTRACT_VERSION,
      cliResult: CLI_RESULT_VERSION
    },
    extractor: EXTRACTOR_VERSION,
    driver: DRIVER_VERSION,
    tolerance: TOLERANCE_VERSION,
    policy: CONFIG_SCHEMA_VERSION,
    runtime: {
      node: process.versions.node,
      required: NODE_REQUIREMENT,
      satisfied: nodeSatisfied().ok
    }
  };
}

/* ------------------------------------------------------------- runtime */

/** Kept in step with `engines.node` in package.json, and asserted equal by a test. */
export const NODE_REQUIREMENT = ">=18.17";

/**
 * Whether the running Node satisfies the requirement.
 *
 * Deliberately a hand-rolled comparison rather than a semver dependency. This
 * package has zero runtime dependencies and adding one to answer "is 18.17
 * less than 20.11" would be a poor trade — the range this tool declares is a
 * single `>=`, and that is the only form parsed. A different form is reported
 * as unparseable rather than guessed at.
 */
export function nodeSatisfied(actual = process.versions.node, requirement = NODE_REQUIREMENT) {
  const m = /^>=\s*(\d+)\.(\d+)(?:\.(\d+))?$/.exec(String(requirement).trim());
  if (!m) return { ok: false, reason: `requirement \`${requirement}\` is not a form this build parses`, parsed: false };

  const want = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  const got = String(actual).split(".").map((n) => Number.parseInt(n, 10));
  if (got.some((n) => !Number.isFinite(n)) || got.length < 2) {
    return { ok: false, reason: `\`${actual}\` is not a version this build parses`, parsed: false };
  }
  while (got.length < 3) got.push(0);

  for (let i = 0; i < 3; i++) {
    if (got[i] > want[i]) return { ok: true, parsed: true };
    if (got[i] < want[i]) {
      return { ok: false, parsed: true, reason: `Node ${actual} is older than the required ${requirement}` };
    }
  }
  return { ok: true, parsed: true };
}

/* ------------------------------------------------------- compatibility */

/**
 * What this build will READ, per artifact kind.
 *
 * `read` lists every version that can be opened. `write` is the one this build
 * produces. `migratesFrom` lists versions a migration exists for — a version in
 * `read` but not `migratesFrom` is readable as-is and needs no migration, which
 * is the common and preferable case.
 *
 * A version outside `read` is refused by name and with the required action,
 * never with a parse error. "Unexpected token" tells a user their file is
 * broken; it is not, it is simply newer or older than this build.
 */
export const COMPATIBILITY = Object.freeze({
  "project-config": {
    write: CONFIG_SCHEMA_VERSION,
    read: ["1"],
    migratesFrom: [],
    describe: ".helmy-analyzer/*.json — project configuration and policies"
  },
  "target-brief": {
    write: CONFIG_SCHEMA_VERSION,
    read: ["1"],
    migratesFrom: [],
    describe: ".helmy-analyzer/target-brief.json"
  },
  "observability-config": {
    write: OBSERVABILITY_CONFIG_VERSION,
    read: ["1"],
    migratesFrom: [],
    describe: ".helmy-observability/config.json"
  },
  "observability-event": {
    write: String(EVENT_SCHEMA_VERSION),
    read: ["0", "1"],
    migratesFrom: ["0"],
    describe: ".helmy-observability/events*.jsonl — migrated on read, never rewritten on disk"
  },
  "correction-record": {
    write: "1",
    read: ["0", "1"],
    migratesFrom: [],
    describe: "feedback/corrections/*.json — an unversioned record is read as version 0"
  },
  "artifact-metadata": {
    write: METADATA_VERSION,
    read: ["1"],
    migratesFrom: [],
    describe: "the $helmy block on every generated artifact"
  },
  ir: {
    write: IR_SCHEMA_VERSION,
    read: ["0.1.0"],
    migratesFrom: [],
    describe: "analysis/ir.json"
  },
  evidence: {
    write: EVIDENCE_SCHEMA_VERSION,
    read: ["0.1.0"],
    migratesFrom: [],
    describe: "analysis/evidence-map.json"
  }
});

export const COMPATIBILITY_KINDS = Object.freeze(Object.keys(COMPATIBILITY));

/**
 * Whether this build can read a given version of a given kind.
 *
 * The three outcomes are deliberately distinct:
 *
 * - `compatible` — open it.
 * - `migratable` — readable, but a migration should run first.
 * - `unsupported` — refused, with `direction` saying which way. "Newer than
 *   this build" and "older than this build" need opposite actions (upgrade the
 *   tool vs. migrate the file), and a single "incompatible" would leave the
 *   user to guess which.
 */
export function checkCompatibility(kind, version) {
  const spec = COMPATIBILITY[kind];
  if (!spec) {
    return {
      kind, version, status: "unknown-kind", direction: null,
      message: `\`${kind}\` is not a versioned artifact kind this build knows.`,
      userAction: `Known kinds: ${COMPATIBILITY_KINDS.join(", ")}.`
    };
  }

  /* An absent version is read as the earliest readable one rather than
   * refused. Files predating versioning exist, and refusing them would strand
   * exactly the records this phase exists to preserve. */
  const v = version == null ? spec.read[0] : String(version);

  if (spec.migratesFrom.includes(v)) {
    return {
      kind, version: v, status: "migratable", direction: "older",
      message: `${kind} version ${v} predates this build's ${spec.write}.`,
      userAction: `Run \`helmy migrations --apply\` to migrate it, or read it as-is — this build migrates ${kind} on read.`
    };
  }
  if (spec.read.includes(v)) {
    return { kind, version: v, status: "compatible", direction: null, message: `${kind} version ${v} is readable.`, userAction: null };
  }

  const newer = compareLoose(v, spec.write) > 0;
  return {
    kind,
    version: v,
    status: "unsupported",
    direction: newer ? "newer" : "older",
    message: newer
      ? `${kind} version ${v} is newer than this build writes (${spec.write}) and is not in its readable set (${spec.read.join(", ")}).`
      : `${kind} version ${v} is older than anything this build reads (${spec.read.join(", ")}).`,
    userAction: newer
      ? "Upgrade helmy. This build must not guess at a shape it has never seen — doing so would read a field as something it is not."
      : `No migration exists from ${v}. Re-create the file with \`helmy init\`, which preserves the existing one and reports the conflict.`
  };
}

/**
 * Compares two dotted versions, tolerating differing lengths and non-numerics.
 *
 * "Loose" because the versions here are not all semver: schema versions are
 * plain integers as strings, and the extractor's is semver. A comparison that
 * demanded one form would have to reject the other.
 */
export function compareLoose(a, b) {
  const pa = String(a).split(".");
  const pb = String(b).split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number.parseInt(pa[i] ?? "0", 10);
    const nb = Number.parseInt(pb[i] ?? "0", 10);
    if (Number.isFinite(na) && Number.isFinite(nb)) {
      if (na !== nb) return na < nb ? -1 : 1;
      continue;
    }
    const sa = pa[i] ?? "";
    const sb = pb[i] ?? "";
    if (sa !== sb) return sa < sb ? -1 : 1;
  }
  return 0;
}

/** Renders the version set as the human-readable block `helmy version` prints. */
export function renderVersions(set = versionSet()) {
  const lines = [
    `helmy ${set.helmy}`,
    `plugin ${set.plugin ?? "(no plugin manifest)"}`,
    "",
    "Schemas",
    `  project config       ${set.schemas.config}`,
    `  IR                   ${set.schemas.ir}`,
    `  evidence             ${set.schemas.evidence}`,
    `  artifact metadata    ${set.schemas.artifactMetadata}`,
    `  observability event  ${set.schemas.observabilityEvent}`,
    `  observability config ${set.schemas.observabilityConfig}`,
    `  capture contract     ${set.schemas.captureContract}`,
    `  CLI result           ${set.schemas.cliResult}`,
    "",
    "Components",
    `  extractor  ${set.extractor}`,
    `  driver     ${set.driver}`,
    `  tolerance  ${set.tolerance}`,
    `  policy     ${set.policy}`,
    "",
    "Runtime",
    `  node ${set.runtime.node} (requires ${set.runtime.required}) — ${set.runtime.satisfied ? "ok" : "TOO OLD"}`
  ];

  if (set.plugin && set.plugin !== set.helmy) {
    lines.push(
      "",
      `warning: package.json says ${set.helmy} and .claude-plugin/plugin.json says ${set.plugin}.`,
      "Neither is preferred over the other here, because preferring one silently would make the other permanently wrong."
    );
  }
  return lines.join("\n");
}

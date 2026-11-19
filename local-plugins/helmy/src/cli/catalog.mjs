/**
 * The command catalog.
 *
 * One declaration per command, and it is the only one. Dispatch reads it, help
 * is rendered from it, `docs/COMMANDS.md` is generated from it, and the
 * discovery tests assert against it. A hand-written command reference drifts
 * from behaviour within a month; a generated one cannot.
 *
 * **A command name may never imply a capability that does not exist.** There is
 * no `fix`, no `apply`, no `login`, and no `deploy` — not because they are
 * unimplemented, but because a user who sees them in `--help` reasonably infers
 * the tool can do those things.
 */

import { STATUS } from "./result.mjs";

/** Argument kinds, so validation can be declared rather than written per command. */
export const ARG = Object.freeze({
  STRING: "string",
  NUMBER: "number",
  BOOLEAN: "boolean",
  ENUM: "enum",
  LIST: "list",
  PATH: "path",
  URL: "url"
});

/** The five analysis modes, and the two content modes. Kept here so a typo is caught at parse time. */
export const MODES = Object.freeze(["analyze", "recreate", "adapt", "extend", "improve"]);
export const CONTENT_MODES = Object.freeze(["equivalent-content", "independent-content"]);

const S = STATUS;

/** Options every command accepts. Declared once rather than repeated sixteen times. */
export const GLOBAL_OPTIONS = Object.freeze([
  { name: "json", kind: ARG.BOOLEAN, describe: "Emit the machine-readable result contract instead of the human summary." },
  { name: "workspace", kind: ARG.PATH, describe: "Analysis workspace directory. Defaults to the configured project workspace." },
  { name: "run", kind: ARG.PATH, describe: "Fidelity run directory. Defaults to ./.fidelity-run." },
  { name: "verbose", kind: ARG.BOOLEAN, describe: "Show the requirement-by-requirement view, per-dimension coverage, per-category confidence, and every artifact by name. The default output names what blocks and what to do; this names everything." }
]);

/**
 * The catalog.
 *
 * `statuses` lists every status the command can return — used by the help
 * output and asserted by tests, so a command cannot quietly gain a status
 * nobody documented.
 *
 * `phase` records which phase delivers the behaviour. `implemented` records
 * whether it exists yet. They are separate fields because they answer separate
 * questions: a command can be registered and documented before it works, and a
 * user who runs one then should get an honest "not yet, Phase 5.3" rather than
 * "unknown command", which reads as "you typed it wrong".
 */
export const COMMANDS = Object.freeze([
  /* ------------------------------------------------------- project setup */
  {
    name: "init",
    group: "project",
    phase: "5.2",
    implemented: true,
    summary: "Initialize a project.",
    describe:
      "Creates `.helmy-analyzer/` with configuration, a target-brief template and the project directories. " +
      "Launches no browser and analyses nothing. Re-running is safe: it adds what is missing and preserves what exists, " +
      "and never replaces a file without --force. The target-brief template is deliberately NOT schema-valid, so a run " +
      "cannot proceed on placeholder text.",
    args: [],
    options: [
      { name: "name", kind: ARG.STRING, describe: "Project name. Defaults to the directory name. Refused rather than sanitised if unusable." },
      { name: "reference", kind: ARG.URL, describe: "The reference URL to configure. Without one the project is `incomplete` rather than ready." },
      { name: "stack", kind: ARG.STRING, default: "next-tailwind", describe: "Target stack adapter. `next-tailwind` is the only implemented one; another name is refused, never substituted." },
      { name: "force", kind: ARG.BOOLEAN, describe: "Replace existing configuration. Without it, existing files are preserved and reported as conflicts." },
      { name: "non-interactive", kind: ARG.BOOLEAN, describe: "Fail rather than prompt. Every answer must be supplied as a flag." },
      { name: "dir", kind: ARG.PATH, describe: "Where to create the project. Defaults to the working directory. Parent directories are never created." }
    ],
    statuses: [S.COMPLETED, S.REQUIRES_USER_INPUT, S.FAILED, S.NOT_ATTEMPTED],
    outputs: [
      ".helmy-analyzer/project.json", ".helmy-analyzer/preferences.json",
      ".helmy-analyzer/accessibility-policy.json", ".helmy-analyzer/fidelity-policy.json",
      ".helmy-analyzer/stack-adapter.json", ".helmy-analyzer/target-brief.json",
      ".helmy-analyzer/README.md", ".helmy-analyzer/{workspaces,history,corrections,defects,outputs}/"
    ],
    failure: "An invalid project name, an unsupported stack, a missing parent directory or an unwritable path is `failed`. Existing configuration is preserved and reported as a conflict rather than overwritten.",
    examples: [
      "helmy init --reference https://example.com",
      "helmy init --dir ./my-project --name storefront --reference https://example.com",
      "helmy init --force"
    ],
    modes: null
  },

  /* ------------------------------------------------------ mode workflows */
  {
    name: "analyze",
    group: "workflow",
    phase: "5.1",
    implemented: true,
    summary: "Analyze a reference and project its artifacts.",
    describe:
      "Runs the pipeline over a captured workspace, derives the IR, and writes the artifacts the requested mode supports. " +
      "Blockers are reported before any work that would be wasted.",
    args: [],
    options: [
      { name: "for", kind: ARG.ENUM, values: MODES, default: "analyze", describe: "The mode to satisfy." },
      { name: "viewports", kind: ARG.LIST, describe: "Comma-separated widths, e.g. 1440,768,375." },
      { name: "brief", kind: ARG.PATH, describe: "Target brief to ingest before analysing." },
      { name: "mode", kind: ARG.STRING, describe: "Pipeline mode, e.g. `aggregate-only` when no probe exists." },
      { name: "stack", kind: ARG.STRING, describe: "Stack adapter for prompt output." },
      { name: "motion", kind: ARG.BOOLEAN, describe: "Request motion evidence." },
      { name: "states", kind: ARG.BOOLEAN, describe: "Request interaction-state evidence." },
      { name: "strict", kind: ARG.BOOLEAN, describe: "Treat validation warnings as failures." }
    ],
    statuses: [S.COMPLETED, S.COMPLETED_WITH_WARNINGS, S.BLOCKED, S.FAILED, S.REQUIRES_USER_INPUT, S.NOT_ATTEMPTED],
    outputs: ["output/design-spec.md", "output/coverage-report.md", "output/mode-evaluation.md", "analysis/*.json"],
    failure: "Insufficient evidence for the requested mode is `blocked` with the unmet requirements named. A missing brief for a mode that needs one is `requires-user-input`.",
    examples: ["helmy analyze --workspace ./ws", "helmy analyze --workspace ./ws --for adapt --brief ./brief.json"],
    modes: MODES
  },
  {
    name: "recreate",
    group: "workflow",
    phase: "5.1",
    implemented: true,
    summary: "Analyze for the `recreate` mode and emit a conditional rebuild prompt.",
    describe:
      "Shorthand for `analyze --for recreate`. A rebuild prompt always carries its conditions; when the evidence does not " +
      "support one, `blocked-prompt.md` is written instead and contains no implementation instructions.",
    args: [],
    options: [
      { name: "stack", kind: ARG.STRING, describe: "Stack adapter for prompt output." },
      {
        name: "states", kind: ARG.STRING,
        describe:
          "Interaction states to recreate, comma-separated. `default` is the resting state and asks for nothing " +
          "extra — absent hover/focus stays a warning and an explicit prompt limitation. Naming any other state " +
          "(hover, focus, active) makes that state a BLOCKING requirement, so the run is refused rather than " +
          "guessed at when the capture never induced it."
      }
    ],
    statuses: [S.COMPLETED, S.COMPLETED_WITH_WARNINGS, S.BLOCKED, S.FAILED, S.NOT_ATTEMPTED],
    outputs: ["output/rebuild-prompt.md", "output/fidelity-checklist.md", "output/blocked-prompt.md"],
    failure: "Blocked emits `blocked-prompt.md` and no implementation content.",
    examples: ["helmy recreate --workspace ./ws"],
    modes: ["recreate"]
  },
  {
    name: "adapt",
    group: "workflow",
    phase: "5.1",
    implemented: true,
    summary: "Analyze for the `adapt` mode against a target brief.",
    describe: "Shorthand for `analyze --for adapt`. Requires a valid target brief and refuses without one.",
    args: [],
    options: [
      { name: "brief", kind: ARG.PATH, describe: "Target brief to ingest before analysing." },
      { name: "stack", kind: ARG.STRING, describe: "Stack adapter for prompt output." }
    ],
    statuses: [S.COMPLETED, S.COMPLETED_WITH_WARNINGS, S.BLOCKED, S.FAILED, S.REQUIRES_USER_INPUT, S.NOT_ATTEMPTED],
    outputs: ["output/adaptation-prompt.md", "output/design-spec.md"],
    failure: "No brief is `requires-user-input` naming the file to create. A malformed brief is `failed` with each schema violation.",
    examples: ["helmy adapt --workspace ./ws --brief ./target-brief.json"],
    modes: ["adapt"]
  },
  {
    name: "extend",
    group: "workflow",
    phase: "5.1",
    implemented: true,
    summary: "Analyze for the `extend` mode against a target brief.",
    describe: "Shorthand for `analyze --for extend`. Requires a valid target brief.",
    args: [],
    options: [
      { name: "brief", kind: ARG.PATH, describe: "Target brief to ingest before analysing." },
      { name: "stack", kind: ARG.STRING, describe: "Stack adapter for prompt output." }
    ],
    statuses: [S.COMPLETED, S.COMPLETED_WITH_WARNINGS, S.BLOCKED, S.FAILED, S.REQUIRES_USER_INPUT, S.NOT_ATTEMPTED],
    outputs: ["output/design-spec.md"],
    failure: "As `adapt`.",
    examples: ["helmy extend --workspace ./ws --brief ./target-brief.json"],
    modes: ["extend"]
  },
  {
    name: "improve",
    group: "workflow",
    phase: "5.1",
    implemented: true,
    summary: "Analyze for the `improve` mode and emit an improvement prompt.",
    describe: "Shorthand for `analyze --for improve`. No target brief is required.",
    args: [],
    options: [{ name: "stack", kind: ARG.STRING, describe: "Stack adapter for prompt output." }],
    statuses: [S.COMPLETED, S.COMPLETED_WITH_WARNINGS, S.BLOCKED, S.FAILED, S.NOT_ATTEMPTED],
    outputs: ["output/improvement-prompt.md"],
    failure: "Insufficient evidence is `blocked` with the unmet requirements named.",
    examples: ["helmy improve --workspace ./ws"],
    modes: ["improve"]
  },

  /* ---------------------------------------------------------- preflight */
  {
    name: "blockers",
    group: "preflight",
    phase: "5.1",
    implemented: true,
    summary: "Report what would block a mode, without running it.",
    describe:
      "Inspects inputs, evidence, configuration and artifacts and reports every blocker it can determine locally. " +
      "It does NOT launch a browser to discover a blocker it can already predict — the point is to answer " +
      "\"why can't I get a rebuild prompt?\" without spending a capture to find out.",
    args: [],
    options: [
      { name: "for", kind: ARG.ENUM, values: MODES, default: "analyze", describe: "The mode to check feasibility for." },
      { name: "brief", kind: ARG.PATH, describe: "Target brief to check instead of the workspace's." },
      { name: "viewport", kind: ARG.NUMBER, describe: "Check that this viewport's evidence is present." },
      { name: "state", kind: ARG.STRING, describe: "Check that this interaction state's evidence is present." },
      { name: "allow-capture", kind: ARG.BOOLEAN, describe: "Permit checks that need a browser. Off by default." }
    ],
    statuses: [S.COMPLETED, S.COMPLETED_WITH_WARNINGS, S.NOT_ATTEMPTED],
    outputs: [],
    failure: "None. This command reports; it never executes the work it is reporting on.",
    examples: ["helmy blockers --workspace ./ws --for recreate", "helmy blockers --workspace ./ws --for adapt --json"],
    modes: MODES
  },

  /* ------------------------------------------------------------ capture */
  {
    name: "capture",
    group: "capture",
    phase: "5.1",
    implemented: true,
    summary: "Capture the target at every configured viewport.",
    describe: "Runs the shared capture session for each declared viewport. One blocked viewport does not cancel the others.",
    args: [],
    options: [
      { name: "viewports", kind: ARG.LIST, describe: "Comma-separated widths." },
      { name: "nav-timeout", kind: ARG.NUMBER, describe: "Navigation bound in milliseconds." }
    ],
    statuses: [S.COMPLETED, S.COMPLETED_WITH_WARNINGS, S.BLOCKED, S.FAILED, S.NOT_ATTEMPTED],
    outputs: ["target/raw/extract-<vp>.json", "target/capture-<vp>.json"],
    failure: "A capture refused before it began is `blocked` with the driver's typed code and its recommendation.",
    examples: ["helmy capture --run ./.fidelity-run --viewports 1440,375"],
    modes: null
  },
  {
    name: "intrinsic",
    group: "capture",
    phase: "5.1",
    implemented: true,
    summary: "Run the thirteen intrinsic visual checks on one side.",
    describe: "Single-render checks that hold on the target alone. A finding is a fact about one render, not a defect.",
    args: [],
    options: [
      { name: "viewport", kind: ARG.NUMBER, default: 1440, describe: "Viewport width." },
      { name: "side", kind: ARG.ENUM, values: ["reference", "target"], default: "target", describe: "Which side to check." },
      { name: "state", kind: ARG.STRING, default: "default", describe: "Interaction state to check in." }
    ],
    statuses: [S.COMPLETED, S.COMPLETED_WITH_WARNINGS, S.BLOCKED, S.FAILED, S.NOT_ATTEMPTED],
    outputs: ["<side>/intrinsic-<vp>.json"],
    failure: "A capture that cannot run is `blocked`.",
    examples: ["helmy intrinsic --run ./.fidelity-run --side target"],
    modes: null
  },

  /* ----------------------------------------------------------- fidelity */
  {
    name: "compare",
    group: "fidelity",
    phase: "5.1",
    implemented: true,
    summary: "Run a fidelity comparison and write an iteration.",
    describe:
      "Compares a captured target against the pinned reference across twelve categories. Scores are measurements, " +
      "not verdicts: no threshold is validated, and a category with no evidence scores null rather than zero.",
    args: [],
    options: [
      { name: "viewport", kind: ARG.NUMBER, default: 1440, describe: "Viewport width." },
      { name: "content-mode", kind: ARG.ENUM, values: CONTENT_MODES, default: "independent-content", describe: "Content relationship between the two sides." },
      { name: "relationship", kind: ARG.STRING, describe: "Declared relationship, required for equivalent-content." }
    ],
    statuses: [S.COMPLETED, S.COMPLETED_WITH_WARNINGS, S.BLOCKED, S.NOT_ATTEMPTED],
    outputs: ["iterations/NNNN/", "categories.json", "tasks.json"],
    failure: "A gate refusal is `blocked` and emits no category scores and no tasks.",
    examples: ["helmy compare --run ./.fidelity-run --viewport 1440"],
    modes: CONTENT_MODES
  },
  {
    name: "telemetry",
    group: "inspect",
    phase: "5.8",
    implemented: true,
    summary: "Inspect and control local diagnostics. Nothing is ever transmitted.",
    describe: "Local observability: events written to this machine and sent nowhere. Off by default. Named `telemetry` deliberately — that is the word people search for when they want to know what a tool collects, and hiding local recording behind a friendlier name makes it harder to audit.",
    args: [
      { name: "verb", required: false, describe: "status (default) | enable | disable | inspect | clear | export | retention" }
    ],
    options: [
      { name: "redaction", kind: ARG.ENUM, values: ["high", "balanced", "minimal"], describe: "How aggressively to redact. Default `high`: URLs hashed, no origins kept.", default: "high" },
      { name: "record-origins", kind: ARG.BOOLEAN, describe: "Record which origins were analysed. Off by default; this is a real privacy decision and belongs to you." },
      { name: "allow-export", kind: ARG.BOOLEAN, describe: "Permit diagnostic export. Separate from recording: keeping local diagnostics and sharing them are different decisions." },
      { name: "confirm", kind: ARG.BOOLEAN, describe: "Required by `clear` and `export`." },
      { name: "to", kind: ARG.PATH, describe: "Where `export` writes the redacted bundle." },
      { name: "limit", kind: ARG.NUMBER, describe: "How many events `inspect` shows. Default 20." }
    ],
    statuses: [S.COMPLETED, S.COMPLETED_WITH_WARNINGS, S.BLOCKED, S.FAILED, S.REQUIRES_USER_INPUT],
    outputs: [".helmy-observability/events.jsonl", ".helmy-observability/config.json"],
    failure: "Export without permission is `blocked` (exit 3). Clearing or exporting without `--confirm` is `requires-user-input` (exit 6). A recording failure never fails the command being observed.",
    examples: [
      "helmy telemetry status",
      "helmy telemetry enable --redaction high",
      "helmy telemetry inspect --limit 50",
      "helmy telemetry export --to ./diagnostics.json --confirm",
      "helmy telemetry clear --confirm"
    ],
    modes: null
  },
  {
    name: "correct",
    group: "inspect",
    phase: "5.7",
    implemented: true,
    summary: "Propose a correction and preview what it would change.",
    describe: "Files a correction against a claim and shows its whole impact — the value, the status, the affected artifacts, the readiness change and the promotion position — without changing anything. Accepting is a separate, explicit step, because a proposal nobody previewed is a proposal nobody can review.",
    args: [],
    options: [
      { name: "claim", kind: ARG.STRING, describe: "The claim id to correct, as it appears in the evidence map." },
      { name: "category", kind: ARG.ENUM, values: ["factual-claim", "evidence-interpretation", "source-classification", "component-identity", "selector-classification", "token-role", "region", "confidence", "reference-scoped-preference", "project-preference", "global-rule-candidate"], describe: "What kind of judgement this is. It decides which guards apply." },
      { name: "value", kind: ARG.STRING, describe: "What the claim should say." },
      { name: "status", kind: ARG.STRING, describe: "The corrected evidence status. Never above what the source kind supports." },
      { name: "scope", kind: ARG.ENUM, values: ["reference", "workspace", "project", "preference", "global-candidate"], describe: "How far it reaches. Default `reference`.", default: "reference" },
      { name: "reason", kind: ARG.STRING, describe: "Why. A correction with no reason cannot be reviewed." },
      { name: "author", kind: ARG.STRING, describe: "Who filed it." },
      { name: "file", kind: ARG.PATH, describe: "A prepared correction record to file directly, bypassing the guided flow." }
    ],
    statuses: [S.COMPLETED, S.BLOCKED, S.FAILED, S.REQUIRES_USER_INPUT, S.NOT_ATTEMPTED],
    outputs: ["feedback/corrections/<id>.<n>.proposed.json"],
    failure: "A correction that would launder evidence is `blocked` before it is recorded. Missing fields are `requires-user-input`; nothing is invented.",
    examples: [
      "helmy correct --workspace ./ws --claim layout.container.maxWidth --category factual-claim --value 1200 --reason \"the capture measured a child\""
    ],
    modes: null
  },
  {
    name: "correction",
    group: "inspect",
    phase: "5.7",
    implemented: true,
    summary: "Show, accept, reject, promote or list corrections.",
    describe: "The decision half of the correction workflow. `accept` re-derives the IR, re-projects every artifact, validates them as a set, and publishes only if all of it passes — otherwise nothing is written and the previous artifacts stand. History is append-only: nothing here deletes a record.",
    args: [
      { name: "verb", required: true, describe: "show | accept | reject | promote | history" },
      { name: "id", required: false, describe: "The correction id, for every verb except history." }
    ],
    options: [
      { name: "reason", kind: ARG.STRING, describe: "Required by `reject`. A rejection with no reason will be re-filed by the next person to notice the same thing." },
      { name: "explicit", kind: ARG.BOOLEAN, describe: "For `promote`: assert that the pattern generalises, clearing the two-witness requirement and nothing else." },
      { name: "allow-evidence-reduction", kind: ARG.BOOLEAN, describe: "For `accept`: permit a correction that makes something unmeasurable. Refused by default — a run can look better by measuring less, and that is not an improvement." },
      { name: "author", kind: ARG.STRING, describe: "Who is deciding." }
    ],
    statuses: [S.COMPLETED, S.COMPLETED_WITH_WARNINGS, S.BLOCKED, S.FAILED, S.REQUIRES_USER_INPUT],
    outputs: ["feedback/corrections/<id>.<n>.<event>.json", "analysis/ir.json", "output/*"],
    failure: "A refused promotion, a failed re-derivation and a guard refusal are all `blocked` (exit 3): each is a decision, not a crash. Nothing is published unless every regenerated artifact validates.",
    examples: [
      "helmy correction show corr_0001 --workspace ./ws",
      "helmy correction accept corr_0001 --workspace ./ws",
      "helmy correction reject corr_0001 --reason \"measured again; the original was right\"",
      "helmy correction promote corr_0001 --explicit",
      "helmy correction history --workspace ./ws"
    ],
    modes: null
  },
  {
    name: "tasks",
    group: "fidelity",
    phase: "5.1",
    implemented: true,
    summary: "List the correction tasks from an iteration.",
    describe: "Every task is manual. Nothing applies them, and component-level automatic correction is a permanent limitation.",
    args: [],
    options: [{ name: "iteration", kind: ARG.NUMBER, describe: "Iteration number. Defaults to the latest." }],
    statuses: [S.COMPLETED, S.BLOCKED, S.NOT_ATTEMPTED],
    outputs: ["results/tasks-iteration-<n>.json"],
    failure: "A blocked comparison produced no tasks, and this reports `blocked` rather than an empty list.",
    examples: ["helmy tasks --run ./.fidelity-run"],
    modes: null
  },

  /* -------------------------------------------------------- inspection */
  {
    name: "history",
    group: "inspect",
    phase: "5.1",
    implemented: true,
    summary: "List fidelity iterations and re-verify their hashes.",
    describe: "History is append-only. Iteration numbers are not contiguous after an interruption, and the listing says so.",
    args: [],
    options: [],
    statuses: [S.COMPLETED, S.COMPLETED_WITH_WARNINGS, S.NOT_ATTEMPTED],
    outputs: [],
    failure: "Hash drift is `completed-with-warnings` naming the drifted files.",
    examples: ["helmy history --run ./.fidelity-run"],
    modes: null
  },
  {
    name: "recovery",
    group: "inspect",
    phase: "5.1",
    implemented: true,
    summary: "Show the driver attempt history across every capture in a run.",
    describe: "A retry never overwrites the attempt that failed. This reads the record; it makes no claim about it.",
    args: [],
    options: [],
    statuses: [S.COMPLETED, S.COMPLETED_WITH_WARNINGS, S.NOT_ATTEMPTED],
    outputs: [],
    failure: "None. Reading a record cannot fail on the record's contents; an unreadable run is `not-attempted`.",
    examples: ["helmy recovery --run ./.fidelity-run"],
    modes: null
  },
  {
    name: "freshness",
    group: "inspect",
    phase: "5.1",
    implemented: true,
    summary: "Run the ten staleness checks over a capture pair.",
    describe:
      "A stale pair is refused rather than compared. `incompatible` and `stale` are kept apart: one asks for a recapture, " +
      "the other says the two artifacts measured different things.",
    args: [],
    options: [
      { name: "viewport", kind: ARG.NUMBER, default: 1440, describe: "Viewport width." },
      { name: "max-age", kind: ARG.NUMBER, describe: "Freshness window in milliseconds." }
    ],
    statuses: [S.COMPLETED, S.BLOCKED, S.NOT_ATTEMPTED],
    outputs: [],
    failure: "A non-fresh verdict is `blocked` with each failing check and its remedy.",
    examples: ["helmy freshness --run ./.fidelity-run --viewport 1440"],
    modes: null
  },
  {
    name: "verify",
    group: "inspect",
    phase: "5.1",
    implemented: true,
    summary: "Validate every artifact against its hash and provenance.",
    describe: "An artifact is a projection, never a source. A hand-edited one is detectable and fails validation.",
    args: [],
    options: [],
    statuses: [S.COMPLETED, S.FAILED, S.NOT_ATTEMPTED],
    outputs: [],
    failure: "A changed or unprovenanced artifact is `failed`, naming the file and the mismatch.",
    examples: ["helmy verify --run ./.fidelity-run"],
    modes: null
  },
  {
    name: "readiness",
    group: "inspect",
    phase: "5.1",
    implemented: true,
    summary: "Print the separate readiness decisions.",
    describe: "Fifteen decisions, deliberately with no overall verdict. The decisions differ and one summary would hide the difference.",
    args: [],
    options: [],
    statuses: [S.COMPLETED, S.COMPLETED_WITH_WARNINGS],
    outputs: ["output/readiness-report.md"],
    failure: "None. The decisions are standing facts about the system; a run can narrow one but never removes it. Without --workspace it reports the standing decisions alone and says so.",
    examples: ["helmy readiness", "helmy readiness --workspace ./ws --verbose", "helmy readiness --workspace ./ws --json"],
    modes: null
  },

  /* --------------------------------------------------------- installation */
  {
    name: "version",
    group: "installation",
    phase: "5.9",
    implemented: true,
    summary: "Report every version this build declares.",
    describe:
      "The tool version, the plugin manifest version, eight schema versions, and the extractor, driver, tolerance and " +
      "policy versions — plus the running Node and whether it satisfies the requirement. Launches nothing and reads " +
      "no project. When package.json and .claude-plugin/plugin.json disagree it reports both rather than choosing: " +
      "preferring one silently would make the other permanently wrong.",
    args: [],
    options: [{ name: "check", kind: ARG.STRING, describe: "Check one artifact kind's version for readability, e.g. --check correction-record --version 0." },
              { name: "version", kind: ARG.STRING, describe: "The version to check, with --check." }],
    statuses: [S.COMPLETED, S.BLOCKED, S.FAILED],
    outputs: [],
    failure: "`failed` only when this build cannot read its own version — a damaged installation. `blocked` when --check names a version this build cannot read.",
    examples: ["helmy version", "helmy version --json", "helmy version --check observability-event --version 0"],
    modes: null
  },
  {
    name: "doctor",
    group: "installation",
    phase: "5.9",
    implemented: true,
    summary: "Check whether this build can do the work.",
    describe:
      "Nine checks: runtime, this build's own version, the managed directory layout, plugin metadata, the entrypoint, " +
      "the Playwright package, a browser binary, documentation and writability. **No browser is launched.** Browser " +
      "presence is a filesystem question, and it has three answers — yes, no, and could-not-determine — because " +
      "reporting the third as `no` sends people to reinstall a browser they already have.",
    args: [],
    options: [
      { name: "allow-browser-launch", kind: ARG.BOOLEAN, describe: "Permit a launch-based check. This build implements none, and says so rather than silently doing nothing." },
      { name: "root", kind: ARG.PATH, describe: "The installation to check. Defaults to this one." }
    ],
    statuses: [S.COMPLETED, S.COMPLETED_WITH_WARNINGS, S.BLOCKED],
    outputs: [],
    failure: "`blocked` when something is missing that the tool cannot work without. A missing browser is a warning, not a blocker — analysis from existing captures, validation, prompts, corrections and readiness all work without one.",
    examples: ["helmy doctor", "helmy doctor --json"],
    modes: null
  },
  {
    name: "install",
    group: "installation",
    phase: "5.9",
    implemented: true,
    summary: "Install the plugin. Dry run by default.",
    describe:
      "Three modes: `repository` (a checkout IS the installation — nothing is copied), `global` (~/.claude/plugins) and " +
      "`project` (./.claude/plugins). Idempotent: a file already identical is skipped, so a second run reports " +
      "everything current rather than rewriting identical bytes. **Never overwrites a file it did not write.** A " +
      "destination file whose hash differs from the manifest is a conflict: it is named, preserved, and the run is " +
      "`blocked` until you decide. Requires no Docker.",
    args: [],
    options: [
      { name: "mode", kind: ARG.ENUM, values: ["repository", "global", "project"], default: "repository", describe: "Where to install." },
      { name: "apply", kind: ARG.BOOLEAN, describe: "Perform it. Without this the command is a dry run and writes nothing." },
      { name: "force", kind: ARG.BOOLEAN, describe: "Replace conflicting files. Each is backed up first." },
      { name: "backup", kind: ARG.PATH, describe: "Where to put backups of replaced files." },
      { name: "project", kind: ARG.PATH, describe: "Project root, for --mode project." }
    ],
    statuses: [S.COMPLETED, S.BLOCKED, S.FAILED, S.NOT_ATTEMPTED],
    outputs: ["package-manifest.json"],
    failure: "`blocked` on a conflict — the files are intact and re-running unchanged refuses identically. `failed` on a permission error, and then NO manifest is written, so the installation is marked incomplete rather than looking finished.",
    examples: ["helmy install", "helmy install --mode global", "helmy install --mode global --apply"],
    modes: null
  },
  {
    name: "upgrade",
    group: "installation",
    phase: "5.9",
    implemented: true,
    summary: "Upgrade an existing installation. Dry run by default.",
    describe:
      "Replaces managed files, preserves everything placed once, and runs configuration migrations. A target brief you " +
      "filled in is never replaced. Refuses to install older code over a newer installation unless forced, because " +
      "that leaves files the older build cannot read. Refuses to adopt files it has no record of installing.",
    args: [],
    options: [
      { name: "mode", kind: ARG.ENUM, values: ["repository", "global", "project"], default: "global", describe: "Which installation to upgrade." },
      { name: "apply", kind: ARG.BOOLEAN, describe: "Perform it." },
      { name: "force", kind: ARG.BOOLEAN, describe: "Replace conflicting files, and permit a downgrade. Each replaced file is backed up." },
      { name: "backup", kind: ARG.PATH, describe: "Where to put backups." },
      { name: "no-migrate", kind: ARG.BOOLEAN, describe: "Skip configuration migrations." }
    ],
    statuses: [S.COMPLETED, S.BLOCKED, S.FAILED, S.REQUIRES_USER_INPUT, S.NOT_ATTEMPTED],
    outputs: ["package-manifest.json"],
    failure: "`requires-user-input` when there is nothing installed to upgrade. `blocked` on a conflict or an attempted downgrade.",
    examples: ["helmy upgrade --mode global", "helmy upgrade --mode global --apply --backup ./backup"],
    modes: null
  },
  {
    name: "uninstall",
    group: "installation",
    phase: "5.9",
    implemented: true,
    summary: "Remove the plugin. Preserves your data by default. Dry run by default.",
    describe:
      "Six separately-selectable categories: plugin code, project configuration, generated outputs, analysis evidence, " +
      "correction history and observability events. **Only plugin code is removed by default.** Every irreversible " +
      "category must be confirmed by name — a blanket --confirm is refused, because saying yes to removing code is not " +
      "consent to losing a correction history. The dry run reports what would go, what would stay, what is unmanaged, " +
      "the size of each, and which operations cannot be undone.",
    args: [],
    options: [
      { name: "remove", kind: ARG.LIST, default: "plugin-code", describe: "Categories to remove, comma-separated." },
      { name: "confirm", kind: ARG.LIST, describe: "Irreversible categories you are confirming, by name." },
      { name: "apply", kind: ARG.BOOLEAN, describe: "Perform it." },
      { name: "project", kind: ARG.PATH, describe: "Project root holding the data categories." }
    ],
    statuses: [S.COMPLETED, S.COMPLETED_WITH_WARNINGS, S.REQUIRES_USER_INPUT, S.FAILED],
    outputs: [],
    failure: "`requires-user-input` when an irreversible category was selected but not confirmed by name. Unmanaged files are always left in place and reported.",
    examples: ["helmy uninstall", "helmy uninstall --apply", "helmy uninstall --remove plugin-code,observability-events --apply --confirm observability-events"],
    modes: null
  },
  {
    name: "repair",
    group: "installation",
    phase: "5.9",
    implemented: true,
    summary: "Verify the installation and restore what is missing.",
    describe:
      "Hashes every managed file against the manifest and reports four states: ok, modified, missing and unreadable. " +
      "Restores missing files. **Never overwrites a modified file without --force**, because this build cannot tell a " +
      "deliberate edit from a corruption. Also reports raw control bytes in managed sources — inside a regex literal one " +
      "silently changes what the pattern matches, which is how a test assertion here became unable to fail (def_0038).",
    args: [],
    options: [
      { name: "apply", kind: ARG.BOOLEAN, describe: "Restore missing files." },
      { name: "force", kind: ARG.BOOLEAN, describe: "Also restore modified files. Each is backed up first." },
      { name: "backup", kind: ARG.PATH, describe: "Where to put backups." },
      { name: "root", kind: ARG.PATH, describe: "The installation to repair. Defaults to this one." }
    ],
    statuses: [S.COMPLETED, S.COMPLETED_WITH_WARNINGS, S.REQUIRES_USER_INPUT],
    outputs: [],
    failure: "`requires-user-input` when managed files were modified — nothing refused them on the evidence; the tool is waiting for a person to say whether their edit should survive.",
    examples: ["helmy repair", "helmy repair --apply", "helmy repair --apply --force --backup ./backup"],
    modes: null
  },
  {
    name: "migrations",
    group: "installation",
    phase: "5.9",
    implemented: true,
    summary: "Report and apply configuration migrations. Dry run by default.",
    describe:
      "Migrations may add a field or rename one. They never reinterpret a value. Evidence and correction-record content " +
      "are never rewritten — a correction says what someone believed on a date, and that does not become false when the " +
      "tool changes. An ambiguous legacy status is refused by name rather than guessed: `error` meant both `failed` and " +
      "`blocked` depending on the caller, and choosing one would fabricate a distinction nobody recorded.",
    args: [],
    options: [
      { name: "list", kind: ARG.BOOLEAN, describe: "List every migration, including the ones that deliberately do not exist and why." },
      { name: "apply", kind: ARG.BOOLEAN, describe: "Perform them." },
      { name: "backup", kind: ARG.PATH, describe: "Back up each file before migrating it." },
      { name: "root", kind: ARG.PATH, describe: "Project root to migrate. Defaults to the working directory." }
    ],
    statuses: [S.COMPLETED, S.COMPLETED_WITH_WARNINGS, S.NOT_ATTEMPTED],
    outputs: [],
    failure: "None. A migration that cannot be made without guessing is refused and reported as a warning; the file is left exactly as it is.",
    examples: ["helmy migrations", "helmy migrations --list", "helmy migrations --apply --backup ./backup"],
    modes: null
  },
  {
    name: "package",
    group: "installation",
    phase: "5.9",
    implemented: true,
    summary: "Build or verify the package manifest.",
    describe:
      "Enumerates every managed file with its path, type, managed status, hash, version, upgrade behaviour and ownership. " +
      "The exclusion rules travel with the manifest so a reader can see what was kept out. A workspace, screenshot, " +
      "target brief, correction record, observability event or credential file reaching the manifest is `blocked`, not " +
      "warned about: the manifest is what an install copies, so a leak here is a leak onto somebody's disk.",
    args: [],
    options: [
      { name: "write", kind: ARG.BOOLEAN, describe: "Write package-manifest.json." },
      { name: "out", kind: ARG.PATH, describe: "Write it somewhere else." },
      { name: "verify", kind: ARG.BOOLEAN, describe: "Check the files on disk against an existing manifest." },
      { name: "root", kind: ARG.PATH, describe: "The installation to describe. Defaults to this one." }
    ],
    statuses: [S.COMPLETED, S.COMPLETED_WITH_WARNINGS, S.BLOCKED, S.FAILED, S.NOT_ATTEMPTED],
    outputs: ["package-manifest.json"],
    failure: "`blocked` when an excluded file reached the manifest — that is a defect in the exclusion rules and the manifest must not ship.",
    examples: ["helmy package", "helmy package --write", "helmy package --verify"],
    modes: null
  }
]);

export const COMMAND_NAMES = Object.freeze(COMMANDS.map((c) => c.name));

const BY_NAME = new Map(COMMANDS.map((c) => [c.name, c]));

/** Look up a command. Returns null for an unknown name rather than throwing. */
export const findCommand = (name) => BY_NAME.get(name) ?? null;

/**
 * Names close enough to a mistyped one to be worth suggesting.
 *
 * Levenshtein at distance 2, which catches a transposition or a dropped letter
 * without suggesting something unrelated. A suggestion that is merely
 * plausible-looking is worse than none.
 */
export function suggestCommand(name) {
  const distance = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 0; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[a.length][b.length];
  };
  return COMMAND_NAMES
    .map((n) => ({ n, d: distance(String(name).toLowerCase(), n) }))
    .filter((x) => x.d <= 2)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.n);
}

export const GROUPS = Object.freeze({
  project: "Project",
  workflow: "Analysis workflows",
  preflight: "Preflight",
  capture: "Capture",
  fidelity: "Fidelity",
  inspect: "Inspection",
  installation: "Installation"
});

/** Renders the full help text from the catalog. */
export function renderHelp() {
  const lines = [
    "helmy — evidence-first UI analysis for Claude Code",
    "",
    "  helmy <command> [options]",
    "",
    "Every command returns a typed result and exits on its own code:",
    "  0  completed / completed-with-warnings",
    "  1  failed              the work broke",
    "  3  blocked             a gate refused it; the evidence is intact",
    "  4  cancelled           stopped deliberately",
    "  5  not-attempted       there was nothing to do",
    "  6  requires-user-input waiting on something only you can supply",
    "",
    "Add --json to any command to emit the result contract instead of this summary.",
    ""
  ];

  for (const [group, title] of Object.entries(GROUPS)) {
    const items = COMMANDS.filter((c) => c.group === group);
    if (!items.length) continue;
    lines.push(`${title}`);
    for (const c of items) {
      const pending = c.implemented === false ? `  (not yet implemented — Phase ${c.phase})` : "";
      lines.push(`  ${c.name.padEnd(12)} ${c.summary}${pending}`);
    }
    lines.push("");
  }

  lines.push("Run `helmy help <command>` for arguments, options, outputs and examples.");
  lines.push("");
  lines.push("Not available, and not planned for this release: authenticated capture,");
  lines.push("automatic component-level correction, production automation. See docs/KNOWN-LIMITATIONS.md.");
  return lines.join("\n");
}

/** Renders help for one command. */
export function renderCommandHelp(name) {
  const c = findCommand(name);
  if (!c) {
    const near = suggestCommand(name);
    return `unknown command \`${name}\`` + (near.length ? `\n\nDid you mean: ${near.join(", ")}?` : "") +
      `\n\nRun \`helmy help\` for the full list.`;
  }

  const lines = [`helmy ${c.name} — ${c.summary}`, ""];
  if (c.implemented === false) {
    lines.push(`NOT YET IMPLEMENTED. Arrives in Phase ${c.phase}; running it reports \`not-attempted\` and says so.`, "");
  }
  lines.push(c.describe, "");

  if (c.options.length || GLOBAL_OPTIONS.length) {
    lines.push("Options");
    for (const o of [...c.options, ...GLOBAL_OPTIONS]) {
      const val = o.kind === ARG.BOOLEAN ? "" :
        o.kind === ARG.ENUM ? ` <${o.values.join("|")}>` : ` <${o.kind}>`;
      const dflt = o.default !== undefined ? `  (default ${o.default})` : "";
      lines.push(`  --${o.name}${val}`.padEnd(42) + `${o.describe}${dflt}`);
    }
    lines.push("");
  }

  if (c.modes) lines.push(`Modes: ${c.modes.join(", ")}`, "");
  if (c.outputs.length) lines.push("Outputs", ...c.outputs.map((o) => `  ${o}`), "");
  lines.push(`Statuses: ${c.statuses.join(", ")}`, "");
  lines.push("Failure behaviour", `  ${c.failure}`, "");
  lines.push("Examples", ...c.examples.map((e) => `  ${e}`));
  return lines.join("\n");
}

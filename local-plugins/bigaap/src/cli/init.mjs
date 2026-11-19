/**
 * `bigaap init` — create a project without capturing anything.
 *
 * Initialization is deliberately inert: no browser, no network, no analysis. It
 * writes declared intent and nothing else, so a project can be created, read,
 * reviewed and committed before a single page is fetched.
 *
 * Two rules shape everything below.
 *
 * **Never overwrite without permission.** Configuration is a user's work. A
 * re-run adds what is missing and preserves what exists; replacing a file
 * requires `--force`, and the result says exactly which files it would have
 * touched.
 *
 * **Never fabricate.** No analysis artifacts, no plausible-looking target
 * brief. The brief template is deliberately schema-INVALID so a run cannot
 * proceed on placeholder text — a template that validated would let `adapt`
 * describe a product nobody described.
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import {
  PROJECT_DIR, PROJECT_FILES, PROJECT_DIRS, CONFIG_STATUS, CONFIG_SCHEMA_VERSION, BIGAAP_VERSION,
  defaultProject, defaultPreferences, defaultAccessibilityPolicy, defaultFidelityPolicy,
  defaultStackAdapter, targetBriefTemplate, projectReadme,
  inspectProject, projectExists, validateProjectName
} from "./project.mjs";
import { cliResult, STATUS, READINESS, sha256 } from "./result.mjs";

const SUPPORTED_STACKS = ["next-tailwind"];

/** The file set a fresh project gets, as a name → content map. */
function freshContents({ name, reference, stack }) {
  const project = defaultProject({ name, reference, stack });
  return new Map([
    ["project.json", project],
    ["preferences.json", defaultPreferences()],
    ["accessibility-policy.json", defaultAccessibilityPolicy()],
    ["fidelity-policy.json", defaultFidelityPolicy()],
    ["stack-adapter.json", defaultStackAdapter(stack)],
    ["target-brief.json", targetBriefTemplate()],
    ["README.md", projectReadme(project)]
  ]);
}

const serialise = (name, content) =>
  name.endsWith(".md") ? content : JSON.stringify(content, null, 2) + "\n";

/**
 * Initializes or repairs a project.
 *
 * `confirm` is the caller's explicit yes to a destructive change; `force` is
 * the flag form of the same thing. Neither is inferred from anything.
 */
export function cmdInit({
  dir = process.cwd(),
  name = null,
  reference = null,
  stack = "next-tailwind",
  force = false,
  confirm = false,
  nonInteractive = false
} = {}) {
  const operation = "init";

  /* ------------------------------------------------ 1. validate the inputs */

  const targetDir = resolve(dir);
  const projectName = name ?? basename(targetDir) ?? "bigaap-project";

  const nameCheck = validateProjectName(projectName);
  if (!nameCheck.ok) {
    return cliResult({
      operation, status: STATUS.FAILED,
      errors: [{
        code: "invalid-project-name",
        message: `\`${projectName}\` cannot be a project name: ${nameCheck.reason}.`,
        recommendation: "Pass --name with a usable name. It is refused rather than sanitised, because silently renaming your project is worse than telling you."
      }],
      readiness: READINESS.NOT_USABLE,
      readinessReason: "Nothing was created.",
      detail: { projectPath: null, filesCreated: [], filesPreserved: [], filesSkipped: [], conflicts: [] }
    });
  }

  if (!SUPPORTED_STACKS.includes(stack)) {
    /* Recorded and refused, never substituted. A prompt written for the wrong
     * stack is worse than no prompt. */
    return cliResult({
      operation, status: STATUS.FAILED,
      errors: [{
        code: "unsupported-stack",
        message: `\`${stack}\` is not an implemented stack adapter. Implemented: ${SUPPORTED_STACKS.join(", ")}.`,
        recommendation: `Use --stack ${SUPPORTED_STACKS[0]}. The analysis itself is stack-agnostic; only the prompt output is not.`
      }],
      readiness: READINESS.NOT_USABLE,
      readinessReason: "Nothing was created. The requested adapter would have produced prompts for a stack that has no renderer.",
      detail: { projectPath: null, requestedStack: stack, supportedStacks: SUPPORTED_STACKS }
    });
  }

  /* -------------------------------------------- 2. reachable, writable path */

  const projectRoot = join(targetDir, PROJECT_DIR);

  if (!existsSync(targetDir)) {
    /* A missing parent is a user error with an obvious remedy; creating it
     * silently would scatter projects into mistyped paths. */
    return cliResult({
      operation, status: STATUS.FAILED,
      errors: [{
        code: "path-not-found",
        message: `${targetDir} does not exist.`,
        recommendation: "Create the directory first, or pass --dir at one that exists. `init` does not create parent directories, so a mistyped path fails loudly rather than quietly making one."
      }],
      readiness: READINESS.NOT_USABLE,
      readinessReason: "Nothing was created."
    });
  }
  if (!statSync(targetDir).isDirectory()) {
    return cliResult({
      operation, status: STATUS.FAILED,
      errors: [{ code: "path-not-a-directory", message: `${targetDir} is a file, not a directory.`, recommendation: "Pass --dir at a directory." }],
      readiness: READINESS.NOT_USABLE, readinessReason: "Nothing was created."
    });
  }

  /* ------------------------------- 3. inspect what is already there */

  const existed = existsSync(projectRoot);
  const before = existed ? inspectProject(projectRoot) : null;

  /* Unrelated files in the target directory are none of our business. They are
   * reported so the user knows we saw them, and otherwise left alone. */
  let unrelated = [];
  try {
    unrelated = readdirSync(targetDir).filter((f) => f !== PROJECT_DIR).slice(0, 12);
  } catch { /* unreadable listing is not fatal; the writes below will report */ }

  const contents = freshContents({ name: projectName, reference, stack });

  const created = [];
  const preserved = [];
  const skipped = [];
  const conflicts = [];
  const warnings = [];

  /* --------------------------------- 4. decide, per file, before writing */

  for (const [fileName, content] of contents) {
    const path = join(projectRoot, fileName);
    if (!existsSync(path)) { created.push(fileName); continue; }

    const inspected = before?.files.find((f) => f.file === fileName) ?? null;
    const status = fileName === "README.md" ? CONFIG_STATUS.VALID : (inspected?.status ?? CONFIG_STATUS.VALID);

    if (force) {
      conflicts.push({
        file: fileName, existingStatus: status, action: "overwritten",
        reason: "--force was given, so the existing file was replaced."
      });
      continue;
    }

    /* An INVALID or UNSUPPORTED file is a conflict a user must decide about.
     * Repairing it automatically would discard whatever they meant by it. */
    if (status === CONFIG_STATUS.INVALID || status === CONFIG_STATUS.UNSUPPORTED) {
      conflicts.push({
        file: fileName, existingStatus: status, action: "preserved",
        reason: inspected?.reason ?? "the existing file could not be read as valid",
        resolution: `Fix it, or re-run with --force to replace it with a default. \`init\` will not overwrite your configuration on its own.`
      });
      preserved.push(fileName);
      continue;
    }

    /* Valid or incomplete: leave it. A template the user is part-way through
     * filling in is exactly the thing not to clobber. */
    preserved.push(fileName);
    skipped.push({ file: fileName, reason: status === CONFIG_STATUS.INCOMPLETE ? "already present and awaiting your input" : "already present and valid" });
  }

  /* ---------------- 5. destructive changes need permission, not inference */

  const destructive = conflicts.filter((c) => c.action === "overwritten");
  if (destructive.length && !force) {
    /* Unreachable in practice — `action: overwritten` is only set under
     * `force` — and kept as a guard so a future edit cannot make overwriting
     * the default without tripping it. */
    return cliResult({
      operation, status: STATUS.REQUIRES_USER_INPUT,
      userActions: [{
        what: `${destructive.length} existing file(s) would be replaced.`,
        how: "Re-run with --force if that is what you want. Your configuration is not overwritten on inference."
      }],
      summary: "initialization would overwrite existing configuration",
      readiness: READINESS.UNDETERMINED,
      readinessReason: "Nothing was written.",
      detail: { projectPath: projectRoot, conflicts: destructive }
    });
  }

  /* ------------------------------------------------------- 6. write */

  const written = [];
  const hashes = {};
  try {
    mkdirSync(projectRoot, { recursive: true });
    for (const d of PROJECT_DIRS) mkdirSync(join(projectRoot, d.name), { recursive: true });

    for (const fileName of created) {
      const body = serialise(fileName, contents.get(fileName));
      writeFileSync(join(projectRoot, fileName), body, "utf8");
      written.push(fileName);
      hashes[fileName] = sha256(body);
    }
    if (force) {
      for (const c of destructive) {
        const body = serialise(c.file, contents.get(c.file));
        writeFileSync(join(projectRoot, c.file), body, "utf8");
        written.push(c.file);
        hashes[c.file] = sha256(body);
      }
    }
  } catch (e) {
    /* A permission failure is reported with what had already been written, so a
     * partially-created project is visible rather than a mystery. */
    return cliResult({
      operation, status: STATUS.FAILED,
      errors: [{
        code: "filesystem-error",
        message: `could not write the project: ${String(e.message).slice(0, 200)}`,
        recommendation: "Check the directory is writable, then re-run. `init` is idempotent: it will add whatever is still missing."
      }],
      summary: `initialization failed after writing ${written.length} file(s)`,
      readiness: READINESS.NOT_USABLE,
      readinessReason: "The project is incomplete. Re-running will add what is missing rather than starting over.",
      detail: { projectPath: projectRoot, filesCreated: written, filesPreserved: preserved, conflicts, partial: true }
    });
  }

  /* ------------------------------------- 7. re-inspect and report honestly */

  const after = inspectProject(projectRoot);

  if (unrelated.length) {
    warnings.push({
      code: "unrelated-files-present",
      message: `${unrelated.length} unrelated entr${unrelated.length === 1 ? "y" : "ies"} in ${targetDir}: ${unrelated.join(", ")}. Untouched.`,
      recommendation: "None needed. Reported so you know they were seen and left alone."
    });
  }
  for (const c of conflicts.filter((x) => x.action === "preserved")) {
    warnings.push({ code: "config-conflict", message: `${c.file} is ${c.existingStatus} and was preserved: ${c.reason}`, recommendation: c.resolution });
  }
  if (after.targetBriefStatus === CONFIG_STATUS.INCOMPLETE) {
    warnings.push({
      code: "target-brief-incomplete",
      message: "target-brief.json is a template and is deliberately not schema-valid.",
      recommendation: "Fill it in before running `adapt` or `extend`. Until then those modes report `requires-user-input`."
    });
  }
  if (!reference) {
    warnings.push({
      code: "no-reference-configured",
      message: "No reference URL was configured, so the project is `incomplete` rather than ready.",
      recommendation: "Re-run with --reference <url>, or edit project.json. Nothing was guessed."
    });
  }

  /**
   * What was created inside the user's project, and which of it is theirs.
   *
   * This directory usually sits inside a repository, and `target-brief.json`
   * will hold the user's own product requirements in their own words. Later
   * commands add `.fidelity-run/` — which holds screenshots of the reference
   * page — and `output/`. None of that was ever mentioned, so a user could fill
   * in a brief and commit it without the tool having said a word (def_0040).
   *
   * Reported, never acted on. Writing to the user's `.gitignore` would be this
   * tool modifying a file it does not own, in a project it was merely pointed
   * at — the class of action refused everywhere else in this codebase. The
   * information is the deliverable; the decision is theirs.
   */
  const userContentPaths = [
    { path: `${PROJECT_DIR}/target-brief.json`, holds: "your product requirements, in your own words" },
    { path: `${PROJECT_DIR}/project.json`, holds: "the reference URL you are analysing" },
    { path: ".fidelity-run/", holds: "screenshots of the reference page (created by capture, not by init)" },
    { path: "output/", holds: "generated prompts and specs (created by an analysis, not by init)" }
  ];

  warnings.push({
    code: "project-data-is-yours",
    message:
      `${PROJECT_DIR}/ was created inside this directory and holds content that will be yours: ` +
      userContentPaths.map((p) => p.path).join(", ") + ".",
    recommendation:
      "If this directory is under version control, decide whether those belong in it — a filled-in " +
      "target brief describes what you are building. Nothing was written to your .gitignore; that file is yours."
  });

  const status = warnings.length ? STATUS.COMPLETED_WITH_WARNINGS : STATUS.COMPLETED;

  const nextCommand = after.status === CONFIG_STATUS.INVALID
    ? "bigaap blockers --for analyze"
    : reference
      ? "bigaap blockers --for analyze"
      : "edit .bigaap-analyzer/project.json to set a reference, then `bigaap blockers --for analyze`";

  return cliResult({
    operation, status,
    reference: reference ?? null,
    warnings,
    hashes,
    artifacts: written.map((f) => ({ kind: f, path: join(projectRoot, f), bytes: null })),
    summary: existed
      ? `project at ${projectRoot} · ${written.length} file(s) added, ${preserved.length} preserved`
      : `project created at ${projectRoot} · ${written.length} file(s)`,
    readiness: READINESS.USABLE_WITH_LIMITS,
    readinessReason:
      "A project records what to analyse and under which policies. It licenses nothing on its own — " +
      "no evidence exists until something is captured, and no artifact exists until something is analysed.",
    detail: {
      projectPath: projectRoot,
      projectName,
      alreadyExisted: existed,
      filesCreated: written,
      /* Repo-relative and posix-style, so the report reads the same on any
       * platform and can be pasted into a .gitignore by whoever decides to. */
      createdPaths: [
        ...PROJECT_FILES.map((f) => `${PROJECT_DIR}/${f.name}`),
        ...PROJECT_DIRS.map((d) => `${PROJECT_DIR}/${d.name}/`)
      ],
      userContentPaths,
      filesPreserved: preserved,
      filesSkipped: skipped,
      conflicts,
      unrelatedFilesPresent: unrelated,
      schemaVersions: {
        config: CONFIG_SCHEMA_VERSION,
        bigaap: BIGAAP_VERSION
      },
      /* Two different questions, so two fields. `configurationStatus` is the
       * roll-up over required files — is the project readable and consistent.
       * `projectDeclaredStatus` is what project.json says about its own
       * completeness — has a reference been chosen. A single field would have
       * to answer both and would answer one of them wrongly. */
      configurationStatus: after.status,
      configurationStatusCovers: after.statusCovers,
      projectDeclaredStatus: after.files.find((f) => f.file === "project.json")?.data?.configurationStatus ?? null,
      targetBriefStatus: after.targetBriefStatus,
      directoriesCreated: PROJECT_DIRS.map((d) => d.name),
      analysisArtifactsCreated: [],
      nextRecommendedCommand: nextCommand
    }
  });
}

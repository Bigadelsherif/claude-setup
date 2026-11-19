/**
 * Preflight: what would block this mode, determined without doing the work.
 *
 * Today a user discovers a blocker by triggering it — a browser launch, a
 * capture, a minute of waiting, and then "the reference is unsafe for this
 * mode". Every one of those blockers was knowable from what is already on disk.
 *
 * **This module must not launch a browser.** Not as an optimisation — as a
 * contract. A preflight that captures is not a preflight, and a user who runs
 * it to avoid a capture would get one anyway. `driver-unavailable` is checked
 * by looking for an installed browser on disk, never by starting one.
 *
 * Each blocker says what it is, how bad it is, what the user must do, whether
 * a recapture can resolve it, and whether the input kind makes it impossible.
 * The last one matters most: "recapture and it will work" and "no capture will
 * ever fix this" are different answers, and a user acting on the wrong one
 * wastes a lot of time.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { modeRequirements, MODES as MODE_NAMES, isKnownMode } from "../modes/requirements.mjs";
import { loadTargetBrief } from "../workspace/workspace.mjs";
import { PROJECT_DIR, CONFIG_STATUS, CONFIG_SCHEMA_VERSION, inspectProject, projectExists } from "./project.mjs";

/** Every blocker code this preflight can emit. Stable identifiers; the prose may change. */
export const BLOCKER = Object.freeze({
  UNKNOWN_MODE: "unknown-mode",
  NO_WORKSPACE: "workspace-missing",
  NO_CAPTURE: "capture-missing",
  CAPTURE_UNREADABLE: "capture-unreadable",
  NO_IR: "ir-missing",
  BRIEF_MISSING: "target-brief-missing",
  BRIEF_INVALID: "target-brief-invalid",
  COVERAGE_LOW: "coverage-insufficient",
  REGION_UNREACHED: "primary-region-unreached",
  CONTESTED_CRITICAL: "contested-critical-claims",
  SOURCE_KIND_INADMISSIBLE: "source-kind-inadmissible",
  VIEWPORT_MISSING: "viewport-evidence-missing",
  STATE_MISSING: "state-evidence-missing",
  STACK_UNCONFIGURED: "stack-unconfigured",
  STACK_UNSUPPORTED: "stack-unsupported",
  DRIVER_UNAVAILABLE: "browser-driver-unavailable",
  ARTIFACTS_STALE: "artifacts-stale",
  PROJECT_NOT_INITIALIZED: "project-not-initialized",
  PROJECT_CONFIG_INVALID: "project-config-invalid",
  PROJECT_FILES_MISSING: "project-files-missing",
  BRIEF_INCOMPLETE: "target-brief-incomplete",
  SCHEMA_VERSION_INCOMPATIBLE: "schema-version-incompatible",
  CONFIG_STALE: "configuration-stale",
  FIDELITY_POLICY_UNSUPPORTED: "fidelity-policy-unsupported",
  CAPABILITY_UNSUPPORTED: "capability-unsupported",
  OPEN_LIMITATION: "open-limitation"
});

export const SEVERITY = Object.freeze({
  BLOCKING: "blocking",
  WARNING: "warning",
  INFORMATIONAL: "informational"
});

/**
 * Capabilities a user can ask for and will not get.
 *
 * Recorded as blockers rather than ignored, so asking produces a refusal with a
 * reason instead of silence. `impossibleForInputKind` is true where no capture
 * of any kind resolves it — these are scope decisions, not evidence gaps.
 */
const UNSUPPORTED_CAPABILITIES = Object.freeze({
  authenticated: {
    code: BLOCKER.CAPABILITY_UNSUPPORTED,
    explanation:
      "Authenticated capture is not implemented and is not planned. No command accepts credentials, and none bypasses " +
      "a consent gate, a CAPTCHA or a bot check.",
    userAction: "Capture a publicly reachable page, or export the rendered page yourself and analyse it as a local file.",
    recaptureResolves: false,
    impossibleForInputKind: true
  },
  "automatic-component-correction": {
    code: BLOCKER.CAPABILITY_UNSUPPORTED,
    explanation:
      "Component-level automatic correction is a permanent limitation (def_0030). Cross-implementation component matching " +
      "recovered half the components across two independent pairs, against a bar that was not moved.",
    userAction: "Use `bigaap tasks` and apply the corrections yourself. Category-level comparison is the ceiling.",
    recaptureResolves: false,
    impossibleForInputKind: true
  },
  "production-automation": {
    code: BLOCKER.CAPABILITY_UNSUPPORTED,
    explanation:
      "Unattended execution is not supported. The CLI is built for an operator reading results, and the run directory is " +
      "not concurrency-safe.",
    userAction: "Run commands interactively and read the results.",
    recaptureResolves: false,
    impossibleForInputKind: true
  }
});

/** Standing limitations, reported as informational context rather than as failures. */
const OPEN_LIMITATIONS = Object.freeze([
  {
    id: "def_0020",
    explanation:
      "Emitted structural-fallback selectors can have an unanchored root and may match nothing. One witness in ninety " +
      "selectors on one of six targets. They are not individually marked, so a reader cannot tell which carry the risk.",
    affects: ["prompt selectors"]
  },
  {
    id: "def_0022",
    explanation:
      "An English word whose only vowel is `e` can be classified as a build hash — roughly one name in eight hundred. " +
      "The cost is a weaker selector, never a wrong claim.",
    affects: ["selector choice"]
  },
  {
    id: "tolerances",
    explanation:
      "No measured tolerance is validated. Two of seventeen calibrated entries are, and both are finite policies rather " +
      "than numeric thresholds. A fidelity score is a measurement, not a verdict.",
    affects: ["fidelity scores"]
  }
]);

const blocker = ({ code, severity, explanation, userAction, recaptureResolves, impossibleForInputKind, mode, artifact }) => ({
  code,
  severity,
  explanation,
  userAction,
  recaptureResolves: !!recaptureResolves,
  impossibleForInputKind: !!impossibleForInputKind,
  affectedMode: mode ?? null,
  affectedArtifact: artifact ?? null
});

/** Is a Playwright browser present on disk? Checked by looking, never by launching. */
export function browserLikelyInstalled(env = process.env) {
  const candidates = [
    env.PLAYWRIGHT_BROWSERS_PATH,
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "ms-playwright") : null,
    env.HOME ? join(env.HOME, ".cache", "ms-playwright") : null,
    env.HOME ? join(env.HOME, "Library", "Caches", "ms-playwright") : null
  ].filter(Boolean);

  for (const dir of candidates) {
    try {
      if (existsSync(dir) && readdirSync(dir).some((d) => /^chromium|^chrome/i.test(d))) return true;
    } catch { /* unreadable is not the same as absent; fall through */ }
  }
  return null; /* null = could not determine, which is not the same as `no` */
}

/**
 * Runs the preflight.
 *
 * `readIR` and `readCapture` are injected so the checks are testable without a
 * workspace on disk, and so a caller that already holds an IR does not read it
 * twice.
 */
export function preflight({
  mode = "analyze",
  workspaceRoot = null,
  projectRoot = null,
  ir = null,
  briefPath = null,
  brief = undefined,
  viewport = null,
  state = null,
  stack = null,
  requestedCapabilities = [],
  env = process.env,
  now = Date.now()
} = {}) {
  const blockers = [];
  const warnings = [];
  const informational = [];
  const checked = [];

  const note = (name) => checked.push(name);
  const add = (b) => {
    if (b.severity === SEVERITY.BLOCKING) blockers.push(b);
    else if (b.severity === SEVERITY.WARNING) warnings.push(b);
    else informational.push(b);
  };

  /* ------------------------------------------------------ 1. the mode */
  note("requested-mode");
  const requirements = isKnownMode(mode) ? modeRequirements[mode] : null;
  if (!requirements) {
    add(blocker({
      code: BLOCKER.UNKNOWN_MODE, severity: SEVERITY.BLOCKING, mode,
      explanation: `\`${mode}\` is not a mode. The modes are: ${Object.values(MODE_NAMES).join(", ")}.`,
      userAction: `Re-run with one of: ${Object.values(MODE_NAMES).join(", ")}.`,
      recaptureResolves: false, impossibleForInputKind: true
    }));
    /* Nothing below can be evaluated against a mode that does not exist. */
    return summarise({ mode, blockers, warnings, informational, checked, browserChecked: false });
  }

  /* ------------------------------- 2. requested capabilities that do not exist */
  note("unsupported-capabilities");
  for (const cap of requestedCapabilities) {
    const spec = UNSUPPORTED_CAPABILITIES[cap];
    add(spec
      ? blocker({ ...spec, severity: SEVERITY.BLOCKING, mode })
      : blocker({
          code: BLOCKER.CAPABILITY_UNSUPPORTED, severity: SEVERITY.BLOCKING, mode,
          explanation: `\`${cap}\` is not a capability this tool has.`,
          userAction: "Remove the request, or check `bigaap help` for what exists.",
          recaptureResolves: false, impossibleForInputKind: true
        }));
  }

  /* ---------------------------------------------- 3. workspace and captures */
  note("input-availability");
  if (workspaceRoot) {
    if (!existsSync(workspaceRoot)) {
      add(blocker({
        code: BLOCKER.NO_WORKSPACE, severity: SEVERITY.BLOCKING, mode,
        explanation: `No workspace at ${workspaceRoot}.`,
        userAction: "Create one with `bigaap init`, or pass --workspace at an existing directory.",
        recaptureResolves: false, impossibleForInputKind: false
      }));
    } else {
      const rawDir = join(workspaceRoot, "raw");
      const captures = existsSync(rawDir) ? readdirSync(rawDir).filter((f) => f.endsWith(".json")) : [];
      if (!captures.length) {
        add(blocker({
          code: BLOCKER.NO_CAPTURE, severity: SEVERITY.BLOCKING, mode,
          explanation: "The workspace holds no capture, so there is nothing to analyse.",
          userAction: "Capture the reference first, then run this again.",
          recaptureResolves: true, impossibleForInputKind: false
        }));
      } else {
        /* A capture that cannot be parsed is a different problem from one that
         * is absent, and the remedy differs: recapture versus investigate. */
        for (const f of captures.filter((n) => n.startsWith("extract-"))) {
          try { JSON.parse(readFileSync(join(rawDir, f), "utf8")); }
          catch (e) {
            add(blocker({
              code: BLOCKER.CAPTURE_UNREADABLE, severity: SEVERITY.BLOCKING, mode, artifact: `raw/${f}`,
              explanation: `raw/${f} is not readable JSON — ${String(e.message).slice(0, 90)}.`,
              userAction: "Recapture. A truncated capture is usually an interrupted write.",
              recaptureResolves: true, impossibleForInputKind: false
            }));
          }
        }
      }
    }
  }

  /* --------------------------------------------- 3b. the project itself */
  note("project-configuration");
  let project = null;
  if (projectRoot) {
    if (!projectExists(projectRoot)) {
      add(blocker({
        code: BLOCKER.PROJECT_NOT_INITIALIZED, severity: SEVERITY.BLOCKING, mode,
        artifact: `${PROJECT_DIR}/project.json`,
        explanation: `No project at ${projectRoot}. Configuration, policies and the target brief all live there.`,
        userAction: "Run `bigaap init`. It creates the project without capturing anything.",
        recaptureResolves: false, impossibleForInputKind: false
      }));
    } else {
      project = inspectProject(projectRoot);

      for (const f of project.invalidFiles) {
        add(blocker({
          code: BLOCKER.PROJECT_CONFIG_INVALID, severity: SEVERITY.BLOCKING, mode, artifact: f.file,
          explanation: `${f.file} is invalid: ${f.reason}`,
          userAction: "Fix the file, or re-run `bigaap init --force` to replace it with a default. It is preserved rather than repaired, because repairing it would discard whatever you meant by it.",
          recaptureResolves: false, impossibleForInputKind: false
        }));
      }

      for (const f of project.unsupportedFiles) {
        /* A newer schema is not a broken file. Saying `invalid` would send the
         * user to fix something that is probably correct and simply ahead. */
        const version = /schema version/i.test(f.reason);
        add(blocker({
          code: version ? BLOCKER.SCHEMA_VERSION_INCOMPATIBLE : BLOCKER.FIDELITY_POLICY_UNSUPPORTED,
          severity: SEVERITY.BLOCKING, mode, artifact: f.file,
          explanation: `${f.file}: ${f.reason}`,
          userAction: version
            ? `This build reads schema version ${CONFIG_SCHEMA_VERSION}. Upgrade bigaap, or re-create the file.`
            : "Change the value to one this build implements. Unsupported requests are recorded and refused rather than substituted.",
          recaptureResolves: false, impossibleForInputKind: true
        }));
      }

      if (project.missingFiles.length) {
        const requiredMissing = project.files.filter((f) => f.required && f.status === CONFIG_STATUS.ABSENT);
        if (requiredMissing.length) {
          add(blocker({
            code: BLOCKER.PROJECT_FILES_MISSING, severity: SEVERITY.BLOCKING, mode,
            artifact: requiredMissing.map((f) => f.file).join(", "),
            explanation: `${requiredMissing.length} required project file(s) are missing: ${requiredMissing.map((f) => f.file).join(", ")}.`,
            userAction: "Re-run `bigaap init`. It adds what is missing and preserves what exists.",
            recaptureResolves: false, impossibleForInputKind: false
          }));
        }
      }

      if (project.missingDirectories.length) {
        add(blocker({
          code: BLOCKER.CONFIG_STALE, severity: SEVERITY.WARNING, mode,
          artifact: project.missingDirectories.join(", "),
          explanation: `The project is missing ${project.missingDirectories.length} director${project.missingDirectories.length === 1 ? "y" : "ies"}: ${project.missingDirectories.join(", ")}.`,
          userAction: "Re-run `bigaap init` to recreate them.",
          recaptureResolves: false, impossibleForInputKind: false
        }));
      }

      /* A stack the project names but this build cannot render for. */
      const stackFile = project.files.find((f) => f.file === "stack-adapter.json");
      if (stackFile?.data?.status === CONFIG_STATUS.UNSUPPORTED) {
        add(blocker({
          code: BLOCKER.STACK_UNSUPPORTED, severity: SEVERITY.BLOCKING, mode, artifact: "stack-adapter.json",
          explanation: `The project names \`${stackFile.data.adapter}\`, which has no renderer in this build.`,
          userAction: "Set `adapter` to `next-tailwind`. The analysis is stack-agnostic; only the prompt output is not.",
          recaptureResolves: false, impossibleForInputKind: true
        }));
      }

      /* A fidelity policy asking for something permanently unavailable. */
      const fidelity = project.files.find((f) => f.file === "fidelity-policy.json");
      if (fidelity?.data?.allowAutomaticComponentCorrection === true) {
        add(blocker({
          code: BLOCKER.FIDELITY_POLICY_UNSUPPORTED, severity: SEVERITY.BLOCKING, mode, artifact: "fidelity-policy.json",
          explanation: "`allowAutomaticComponentCorrection: true` requests a permanent limitation (def_0030). It cannot be enabled here or anywhere.",
          userAction: "Set it to false. Use `bigaap tasks` and apply corrections yourself; category-level comparison is the ceiling.",
          recaptureResolves: false, impossibleForInputKind: true
        }));
      }
    }
  }

  /* ------------------------------------------------- 4. the target brief */
  note("target-brief");
  const needsBrief = mode === "adapt" || mode === "extend";
  if (needsBrief) {
    const resolved = brief !== undefined
      ? brief
      : (briefPath ? loadTargetBrief(briefPath)
        : (workspaceRoot ? loadTargetBrief(join(workspaceRoot, "input", "target-brief.json")) : null));

    /* A template in the project is neither absent nor valid, and the remedy
     * differs from both: the file exists, so "create one" is wrong, and it is
     * not fillable by anything but a person.
     *
     * It only applies when the run has no brief of its own. A workspace brief —
     * or one passed with --brief — is what the run would actually use, so
     * reporting the project's untouched template instead would answer a
     * question the user did not ask, and would mask a malformed brief behind a
     * missing one. */
    const projectBrief = project?.files.find((f) => f.file === "target-brief.json");
    const runHasOwnBrief = resolved != null;
    if (!runHasOwnBrief && projectBrief && projectBrief.status === CONFIG_STATUS.INCOMPLETE) {
      add(blocker({
        code: BLOCKER.BRIEF_INCOMPLETE, severity: SEVERITY.BLOCKING, mode,
        artifact: `${PROJECT_DIR}/target-brief.json`,
        explanation: `\`${mode}\` needs a completed target brief. The one in the project is still the template, and it is deliberately not schema-valid so a run cannot proceed on placeholder text.`,
        userAction: "Replace every REQUIRED value in .bigaap-analyzer/target-brief.json with a description of YOUR product, then delete the $schemaTemplate marker.",
        recaptureResolves: false, impossibleForInputKind: false
      }));
    } else if (resolved == null) {
      /* Deliberately NOT a blocker in the gate sense: no recapture produces a
       * brief. It is work waiting on a person, and the caller turns this into
       * `requires-user-input`. */
      add(blocker({
        code: BLOCKER.BRIEF_MISSING, severity: SEVERITY.BLOCKING, mode,
        artifact: "input/target-brief.json",
        explanation: `\`${mode}\` describes what a DIFFERENT product should do, so it cannot run without a target brief.`,
        userAction: "Write input/target-brief.json describing your product's purpose, audience and constraints. Nothing here will invent one.",
        recaptureResolves: false, impossibleForInputKind: false
      }));
    } else if (resolved.$invalid) {
      add(blocker({
        code: BLOCKER.BRIEF_INVALID, severity: SEVERITY.BLOCKING, mode,
        artifact: resolved.$path ?? "input/target-brief.json",
        explanation: `The target brief does not satisfy target-brief.schema.json — ${resolved.$invalid}`,
        userAction: "Fix the fields named above. `bigaap blockers --json` lists them in full.",
        recaptureResolves: false, impossibleForInputKind: false
      }));
    }
  }

  /* ----------------------------------------- 5. evidence, coverage, contest */
  note("evidence-sufficiency");
  if (ir) {
    const t = requirements.thresholds ?? {};
    const coverage = ir.coverage ?? {};
    const reached = coverage.contentReached ?? null;
    const factor = coverage.coverageFactor ?? null;

    if (reached != null && t.minContentReached != null && reached < t.minContentReached) {
      add(blocker({
        code: BLOCKER.REGION_UNREACHED, severity: SEVERITY.BLOCKING, mode,
        explanation: `The primary content region was reached ${reached}, and \`${mode}\` needs at least ${t.minContentReached}.`,
        userAction: "Recapture with a longer settle window, or check whether an overlay hid the content.",
        recaptureResolves: true, impossibleForInputKind: false
      }));
    }
    if (factor != null && t.minCoverageFactor != null && factor < t.minCoverageFactor) {
      add(blocker({
        code: BLOCKER.COVERAGE_LOW, severity: SEVERITY.BLOCKING, mode,
        explanation: `Coverage factor ${factor} is below the ${t.minCoverageFactor} this mode requires.`,
        userAction: "Recapture; too little of the page was sampled to support this mode.",
        recaptureResolves: true, impossibleForInputKind: false
      }));
    }

    const contested = (ir.contestedClaims ?? []).filter((c) => c.critical !== false);
    if (contested.length) {
      add(blocker({
        code: BLOCKER.CONTESTED_CRITICAL, severity: SEVERITY.BLOCKING, mode,
        explanation: `${contested.length} critical claim(s) have disagreeing evidence and were not resolved.`,
        userAction: "File a correction for each contested claim, then regenerate.",
        recaptureResolves: false, impossibleForInputKind: false
      }));
    }

    /* Source-kind admissibility: a screenshot-only capture cannot support a
     * mode that requires measured DOM evidence, and no recapture of the same
     * KIND changes that. */
    const kinds = new Set((ir.sourceKinds ?? ir.meta?.sourceKinds ?? []).filter(Boolean));
    const acceptable = new Set(requirements.acceptableSourceKinds ?? []);
    if (kinds.size && acceptable.size) {
      const inadmissible = [...kinds].filter((k) => !acceptable.has(k));
      if (inadmissible.length === kinds.size) {
        add(blocker({
          code: BLOCKER.SOURCE_KIND_INADMISSIBLE, severity: SEVERITY.BLOCKING, mode,
          explanation: `This evidence is ${[...kinds].join(", ")}, and \`${mode}\` accepts ${[...acceptable].join(", ")}.`,
          userAction: `Capture the reference as a live page. \`${mode}\` cannot be satisfied from this kind of source.`,
          recaptureResolves: false, impossibleForInputKind: true
        }));
      }
    }
  } else if (workspaceRoot) {
    const irPath = join(workspaceRoot, "analysis", "ir.json");
    if (!existsSync(irPath)) {
      add(blocker({
        code: BLOCKER.NO_IR, severity: SEVERITY.WARNING, mode, artifact: "analysis/ir.json",
        explanation: "No IR has been derived yet, so evidence sufficiency could not be checked.",
        userAction: "Run `bigaap analyze` once; the evidence checks then become available.",
        recaptureResolves: true, impossibleForInputKind: false
      }));
    }
  }

  /* ------------------------------------------ 6. viewport and state evidence */
  if (viewport != null) {
    note("viewport-availability");
    const has = workspaceRoot && existsSync(join(workspaceRoot, "raw", `extract-${viewport}.json`));
    if (!has) {
      add(blocker({
        code: BLOCKER.VIEWPORT_MISSING, severity: SEVERITY.BLOCKING, mode,
        artifact: `raw/extract-${viewport}.json`,
        explanation: `No capture exists at ${viewport}px.`,
        userAction: `Capture that width, or request a viewport that was captured.`,
        recaptureResolves: true, impossibleForInputKind: false
      }));
    }
  }
  if (state != null) {
    note("state-availability");
    const dir = workspaceRoot ? join(workspaceRoot, "raw") : null;
    const has = dir && existsSync(dir) && readdirSync(dir).some((f) => f.includes(`-${state}-`) || f.includes(`${state}.`));
    if (!has) {
      add(blocker({
        code: BLOCKER.STATE_MISSING, severity: SEVERITY.WARNING, mode,
        explanation: `No capture of the \`${state}\` state. It will be reported unknown rather than compared.`,
        userAction: `Capture the state, or accept that it stays unknown — an un-induced state is never a mismatch.`,
        recaptureResolves: true, impossibleForInputKind: false
      }));
    }
  }

  /* ------------------------------------------------ 7. stack configuration */
  note("stack-configuration");
  const SUPPORTED_STACKS = ["next-tailwind"];
  if (stack && !SUPPORTED_STACKS.includes(stack)) {
    add(blocker({
      code: BLOCKER.STACK_UNSUPPORTED, severity: SEVERITY.BLOCKING, mode,
      explanation: `\`${stack}\` is not a supported stack adapter. Supported: ${SUPPORTED_STACKS.join(", ")}.`,
      userAction: `Use ${SUPPORTED_STACKS.join(" or ")}. The analysis itself is stack-agnostic; only the prompt output is not.`,
      recaptureResolves: false, impossibleForInputKind: true
    }));
  }

  /* --------------------------------------------- 8. driver availability */
  note("browser-driver");
  const installed = browserLikelyInstalled(env);
  if (installed === false) {
    add(blocker({
      code: BLOCKER.DRIVER_UNAVAILABLE, severity: SEVERITY.WARNING, mode,
      explanation: "No Chromium was found where Playwright installs one. A capture would fail to start.",
      userAction: "Run `npx playwright install chromium`.",
      recaptureResolves: false, impossibleForInputKind: false
    }));
  }

  /* ---------------------------------------------------- 9. stale artifacts */
  note("stale-artifacts");
  if (workspaceRoot && ir?.$hash) {
    const outDir = join(workspaceRoot, "output");
    if (existsSync(outDir)) {
      for (const f of readdirSync(outDir).filter((n) => n.endsWith(".md"))) {
        let head = "";
        try { head = readFileSync(join(outDir, f), "utf8").slice(0, 400); } catch { continue; }
        const stamped = /bigaap:ir-hash\s+(\S+)/.exec(head)?.[1] ?? null;
        if (stamped && !stamped.includes(ir.$hash)) {
          add(blocker({
            code: BLOCKER.ARTIFACTS_STALE, severity: SEVERITY.WARNING, mode, artifact: `output/${f}`,
            explanation: `output/${f} was projected from a different IR than the current one.`,
            userAction: "Re-run the analysis; artifacts are regenerated from the IR, never edited in place.",
            recaptureResolves: false, impossibleForInputKind: false
          }));
        }
      }
    }
  }

  /* ------------------------------------------------- 10. open limitations */
  note("open-limitations");
  for (const l of OPEN_LIMITATIONS) {
    add(blocker({
      code: BLOCKER.OPEN_LIMITATION, severity: SEVERITY.INFORMATIONAL, mode,
      explanation: `${l.id}: ${l.explanation}`,
      userAction: "No action available. Recorded so it is not a surprise later.",
      recaptureResolves: false, impossibleForInputKind: false,
      artifact: l.affects.join(", ")
    }));
  }

  return summarise({ mode, blockers, warnings, informational, checked, browserChecked: false });
}

function summarise({ mode, blockers, warnings, informational, checked, browserChecked }) {
  const briefMissing = blockers.some((b) => b.code === BLOCKER.BRIEF_MISSING);
  const briefInvalid = blockers.some((b) => b.code === BLOCKER.BRIEF_INVALID);

  return {
    mode,
    feasible: blockers.length === 0,
    blockers,
    warnings,
    informational,
    checksPerformed: checked,
    /* Recorded so the contract is testable: a preflight that launched a browser
     * would be a different thing wearing this name. */
    browserLaunched: browserChecked,
    /* The caller maps these to statuses. A missing brief is `requires-user-input`;
     * an invalid one is a `failed` validation; everything else is `blocked`. */
    requiresUserInput: briefMissing || blockers.some((b) => b.code === BLOCKER.BRIEF_INCOMPLETE),
    invalidInput: briefInvalid,
    resolvableByRecapture: blockers.filter((b) => b.recaptureResolves).map((b) => b.code),
    impossibleForThisInput: blockers.filter((b) => b.impossibleForInputKind).map((b) => b.code),
    summary: blockers.length
      ? `${blockers.length} blocker(s) for \`${mode}\`` + (warnings.length ? `, ${warnings.length} warning(s)` : "")
      : `no blockers for \`${mode}\`` + (warnings.length ? `, ${warnings.length} warning(s)` : "")
  };
}

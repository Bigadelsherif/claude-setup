/**
 * The CLI result contract.
 *
 * Every command returns this shape, and the shape is the point. A caller — a
 * script, a CI job, an agent — must be able to tell three things apart without
 * reading prose: the work completed, the work was refused because a gate said
 * so, and the work broke. Collapsing the last two is the failure mode this
 * exists to prevent: a blocked run has correct evidence and a reason, and
 * treating it as a crash throws that evidence away.
 *
 * A result is never synthesised from work that did not happen. `not-attempted`
 * exists so a command with nothing to do says so, rather than returning
 * `completed` over an empty set.
 */

import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { renderReadiness } from "./present.mjs";

export const CLI_RESULT_VERSION = "1";

export const STATUS = Object.freeze({
  COMPLETED: "completed",
  COMPLETED_WITH_WARNINGS: "completed-with-warnings",
  BLOCKED: "blocked",
  FAILED: "failed",
  CANCELLED: "cancelled",
  NOT_ATTEMPTED: "not-attempted",
  /**
   * The command cannot proceed without something only the user can supply.
   *
   * Distinct from `not-attempted`, which says there was nothing to do. A
   * missing target brief is not nothing to do — it is work waiting on an
   * answer, and reporting it as `not-attempted` tells the user to look
   * elsewhere for a problem that is in front of them.
   *
   * Distinct from `blocked`, which is a gate refusing on the evidence. No
   * amount of recapturing produces a target brief; only a person does.
   */
  REQUIRES_USER_INPUT: "requires-user-input"
});

export const ALL_STATUSES = Object.freeze(Object.values(STATUS));

/**
 * Exit codes, one per status.
 *
 * `blocked` and `failed` are deliberately different numbers. A CI job that
 * retries on 1 should not retry a run that was refused by a safety gate — the
 * retry would be refused identically, and the reason would scroll past twice.
 */
export const EXIT_CODE = Object.freeze({
  [STATUS.COMPLETED]: 0,
  [STATUS.COMPLETED_WITH_WARNINGS]: 0,
  [STATUS.FAILED]: 1,
  [STATUS.BLOCKED]: 3,
  [STATUS.CANCELLED]: 4,
  [STATUS.NOT_ATTEMPTED]: 5,
  /* Its own code so a caller can prompt rather than retry. Retrying a run
   * that is waiting for a target brief produces the same wait. */
  [STATUS.REQUIRES_USER_INPUT]: 6
});

export const sha256 = (value) =>
  createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

/**
 * The readiness decision attached to every result.
 *
 * Separate from `status`, because they answer different questions. `status` is
 * what happened to this invocation; `readiness` is what the evidence now
 * licenses. A comparison can complete and still license nothing.
 */
export const READINESS = Object.freeze({
  USABLE: "usable",
  USABLE_WITH_LIMITS: "usable-with-limits",
  NOT_USABLE: "not-usable",
  UNDETERMINED: "undetermined"
});

/**
 * Builds a result. Every field is present on every result, including the ones
 * that do not apply — an absent field and a null field read differently, and a
 * consumer should not have to guess which it is looking at.
 */
export function cliResult({
  operation,
  status,
  reference = null,
  target = null,
  viewport = null,
  state = null,
  mode = null,
  artifacts = [],
  hashes = {},
  warnings = [],
  blockers = [],
  errors = [],
  recoveryHistory = [],
  readiness = null,
  readinessReason = null,
  summary = null,
  detail = {},
  userActions = []
} = {}) {
  if (!ALL_STATUSES.includes(status)) {
    throw new Error(`unknown CLI status \`${status}\`; expected one of ${ALL_STATUSES.join(", ")}`);
  }

  /* A blocked result without a blocker is indistinguishable from a completed
   * one to anything that reads the reasons, so it is refused at construction
   * rather than discovered downstream. */
  if (status === STATUS.BLOCKED && blockers.length === 0) {
    throw new Error(`${operation} returned \`blocked\` with no blocker recorded`);
  }
  if (status === STATUS.FAILED && errors.length === 0) {
    throw new Error(`${operation} returned \`failed\` with no error recorded`);
  }
  if (status === STATUS.COMPLETED && (blockers.length || errors.length)) {
    throw new Error(`${operation} returned \`completed\` while carrying ${blockers.length} blocker(s) and ${errors.length} error(s)`);
  }
  /* A request for input that does not say what input is a dead end — worse
   * than a blocker without a remedy, because the user cannot even guess. */
  if (status === STATUS.REQUIRES_USER_INPUT && userActions.length === 0) {
    throw new Error(`${operation} returned \`requires-user-input\` without saying what the user must supply`);
  }
  /* `not-attempted` means there was nothing to do, and a reader is entitled to
   * know why work did not begin. */
  if (status === STATUS.NOT_ATTEMPTED && warnings.length === 0 && summary == null) {
    throw new Error(`${operation} returned \`not-attempted\` without explaining why work did not begin`);
  }

  return {
    resultVersion: CLI_RESULT_VERSION,
    operation,
    status,
    reference,
    target,
    viewport,
    state,
    mode,
    artifacts,
    hashes,
    warnings,
    blockers,
    errors,
    recoveryHistory,
    userActions,
    readiness: readiness ?? READINESS.UNDETERMINED,
    readinessReason,
    summary,
    detail,
    exitCode: EXIT_CODE[status],
    producedAt: new Date().toISOString()
  };
}

/**
 * Derives a status from what a capture session reported.
 *
 * The mapping is deliberately narrow: a capture session that was refused
 * before it began is `blocked`, one that recorded errors but still produced
 * evidence is `completed-with-warnings`, and one whose own logic threw is
 * `failed`. Nothing here can produce `completed` out of a run with errors.
 */
export function statusFromCapture(run) {
  if (!run) return STATUS.NOT_ATTEMPTED;
  if (run.blocked) return STATUS.BLOCKED;
  if (run.thrown) return STATUS.FAILED;
  if (run.metadata?.status === "blocked") return STATUS.BLOCKED;
  if (run.metadata?.status === "failed") return STATUS.FAILED;
  if ((run.metadata?.errors ?? []).length) return STATUS.COMPLETED_WITH_WARNINGS;
  if ((run.metadata?.warnings ?? []).length) return STATUS.COMPLETED_WITH_WARNINGS;
  return STATUS.COMPLETED;
}

/** Turns a capture contract's failures into CLI blockers, keeping the recommendation. */
export function blockersFromCapture(run) {
  if (!run?.blocked) return [];
  return (run.metadata?.errors ?? []).map((e) => ({
    code: e.code,
    stage: "capture",
    operation: e.operation,
    message: e.message,
    recommendation: e.recommendation ?? null
  }));
}

/** Records an artifact on a result, hashing the bytes actually written. */
export function writeArtifact(result, { kind, path, content }) {
  const body = typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n";
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, "utf8");
  const hash = sha256(body);
  result.artifacts.push({ kind, path, bytes: body.length });
  result.hashes[kind] = hash;
  return { path, hash, bytes: body.length };
}

/**
 * Prints a result and returns its exit code.
 *
 * `--json` emits the contract verbatim, because a consumer that has to parse
 * prose is a consumer that will eventually parse it wrong.
 */
export function emit(result, { json = false, verbose = false, log = console.log, err = console.error } = {}) {
  if (json) {
    /* stdout carries the document and nothing else. Every prompt, note and
     * diagnostic in this system goes to stderr, so `helmy … --json | jq` is
     * parseable without filtering — a single stray line makes the whole
     * document unreadable, and the line that breaks it is usually the helpful
     * one somebody added later. */
    log(JSON.stringify(result, null, 2));
    return result.exitCode;
  }

  /* A result carrying a readiness model is a report, and the report IS the
   * output: it goes to stdout whole, including its blockers. Sending those to
   * stderr would mean `helmy readiness > file` silently loses the reasons —
   * the opposite of the terse path, where a blocker is an aside to a command
   * that was doing something else. */
  if (result.detail?.readinessModel) {
    log(renderReadiness(result.detail.readinessModel, { verbose }));
    return result.exitCode;
  }

  /* A result carrying pre-rendered text is a report too. `telemetry status`
   * builds its own because what it reports — a privacy posture — is a different
   * shape from a readiness model, and forcing it into one would obscure it. */
  if (result.detail?.statusText) {
    log(result.detail.statusText);
    for (const a of result.userActions) {
      log("");
      log(`NEEDS YOU  ${a.what}`);
      if (a.how) log(`           ${a.how}`);
    }
    return result.exitCode;
  }

  const where = [
    result.reference ? `ref ${result.reference}` : null,
    result.target ? `target ${result.target}` : null,
    result.viewport ? `${result.viewport}px` : null,
    result.state && result.state !== "default" ? `state ${result.state}` : null,
    result.mode ? `mode ${result.mode}` : null
  ].filter(Boolean).join(" · ");

  log(`${result.operation}: ${result.status}${where ? `  [${where}]` : ""}`);
  if (result.summary) log(`  ${result.summary}`);

  for (const b of result.blockers) {
    err(`  BLOCKED ${b.code}${b.stage ? ` (${b.stage})` : ""}: ${b.message}`);
    if (b.recommendation) err(`          ${b.recommendation}`);
  }
  for (const e of result.errors) {
    err(`  ERROR ${e.code ?? "error"}${e.operation ? ` (${e.operation})` : ""}: ${e.message}`);
    if (e.recommendation) err(`        ${e.recommendation}`);
  }
  for (const a of result.userActions) {
    log(`  NEEDS YOU  ${a.what}`);
    if (a.how) log(`             ${a.how}`);
  }
  for (const w of result.warnings) {
    log(`  warn  ${w.code ?? w.operation ?? "warning"}: ${w.message ?? w.note}`);
  }
  for (const a of result.artifacts) {
    log(`  wrote ${a.path}  ${(result.hashes[a.kind] ?? "").slice(0, 12)}`);
  }
  if (result.recoveryHistory.length) {
    const failed = result.recoveryHistory.filter((h) => h.status === "failed").length;
    log(`  recovery: ${result.recoveryHistory.length} attempt(s), ${failed} failed`);
  }
  log(`  readiness: ${result.readiness}${result.readinessReason ? ` — ${result.readinessReason}` : ""}`);

  return result.exitCode;
}

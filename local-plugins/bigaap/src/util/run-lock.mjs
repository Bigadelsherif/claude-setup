/**
 * An exclusive lock for suites that cannot run concurrently.
 *
 * Written for def_0037. Two live-smoke runs overlapped, shared one set of
 * fixed scratch paths, and the first to finish deleted the second's artifacts
 * mid-flight. The second run then reported `9/12 passed`, exited 0, and named
 * three specific scenarios as failing — and the scenarios it named were stable,
 * because they are the ones that write artifacts last. It looked exactly like
 * three real regressions.
 *
 * That is the failure this module exists to prevent, and it is worth being
 * precise about which part was the defect. Running two instances was my
 * mistake. Converting that mistake into a plausible scenario report was the
 * tool's, because the two are acted on completely differently: a regression
 * gets investigated, a harness collision gets re-run.
 *
 * So a refused lock is **environment-not-ready** (exit 2), never a scenario
 * result. It is the same category as "the fixture server is not answering",
 * which the suites already handle that way.
 *
 * ## On stealing locks
 *
 * The one genuinely delicate decision here is what to do about a lock left
 * behind by a run that died. The rule:
 *
 *   - **Owner's pid is alive** → refuse. It may be a pid the OS reused for an
 *     unrelated process, in which case we are refusing unnecessarily — and that
 *     is the correct direction to be wrong in. An unnecessary refusal costs a
 *     re-run; a wrong reclaim costs a corrupted result that looks real.
 *   - **Owner's pid is gone** → reclaim, and say so loudly. A dead process
 *     cannot be writing artifacts, so there is nothing to protect. Pid reuse
 *     cannot mislead us here: it can only make a dead owner look alive, which
 *     lands in the safe case above.
 *
 * Nothing deletes a lock whose owner might still be running, under any flag.
 */

import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { hostname } from "node:os";

/** Why a lock could not be taken, or how it was taken. */
export const LOCK_RESULT = Object.freeze({
  ACQUIRED: "acquired",
  /** Reclaimed from an owner that is provably gone. */
  RECLAIMED_STALE: "reclaimed-stale",
  /** Someone else holds it and may still be running. */
  HELD: "held",
  /** The lock file exists but cannot be read or parsed. */
  UNREADABLE: "unreadable"
});

/** The exit code for "the environment is not ready", matching the suites. */
export const ENVIRONMENT_NOT_READY = 2;

/**
 * Whether a pid is running.
 *
 * `kill(pid, 0)` sends no signal and only tests for existence. `EPERM` means
 * the process exists and belongs to someone else — still alive, so still a
 * reason to refuse.
 */
export function processIsAlive(pid, { kill = process.kill.bind(process) } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "EPERM") return true;
    return false;
  }
}

/** What a lock file records about its owner. */
function ownerRecord({ tool, extra }) {
  return {
    pid: process.pid,
    host: hostname(),
    tool,
    startedAt: new Date().toISOString(),
    nodeVersion: process.version,
    ...extra
  };
}

function readOwner(lockPath) {
  try {
    /* The BOM strip is not decoration. A lock written by anything other than
     * this module — a shell helper, an editor, PowerShell's `Set-Content
     * -Encoding utf8` — can carry one, and `JSON.parse` rejects it. That sends
     * a perfectly readable lock down the "unreadable" path, which refuses
     * correctly but for the wrong reason and tells the reader to inspect a file
     * that is fine. */
    const text = readFileSync(lockPath, "utf8").replace(/^﻿/, "");
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Takes the lock, or explains why it could not.
 *
 * Never throws for a held lock: a caller needs the holder's details to report
 * them, and an exception would have to carry them as a payload anyway.
 *
 * `isAlive` is injectable so the stale-lock and active-process paths can be
 * tested without spawning processes — a test that has to start a real process
 * to check the safe path is a test nobody runs.
 */
export function acquireRunLock({
  lockPath,
  tool = "unknown",
  extra = {},
  isAlive = processIsAlive
} = {}) {
  if (!lockPath) throw new Error("acquireRunLock needs a lockPath");
  mkdirSync(dirname(lockPath), { recursive: true });

  const record = ownerRecord({ tool, extra });
  const write = () => writeFileSync(lockPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });

  try {
    /* `wx` fails if the path exists. The check and the create are one syscall,
     * so two processes racing here cannot both succeed. */
    write();
    return acquired(LOCK_RESULT.ACQUIRED, { lockPath, record });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }

  const owner = readOwner(lockPath);

  if (!owner) {
    /* Present but unreadable. Never reclaimed: an unparseable lock is not
     * evidence that its owner is gone, only that we cannot tell. */
    return {
      acquired: false,
      result: LOCK_RESULT.UNREADABLE,
      lockPath,
      owner: null,
      reason: `A lock file exists at ${lockPath} but could not be read.`,
      remedy: "Inspect it. If no run is active, delete it by hand — it is not removed automatically, because an unreadable lock is not evidence that its owner has stopped.",
      exitCode: ENVIRONMENT_NOT_READY
    };
  }

  if (isAlive(owner.pid)) {
    return {
      acquired: false,
      result: LOCK_RESULT.HELD,
      lockPath,
      owner,
      reason: `Another ${owner.tool ?? "run"} is active: pid ${owner.pid} on ${owner.host ?? "this host"}, started ${owner.startedAt ?? "at an unrecorded time"}.`,
      remedy: `Wait for it to finish, or stop pid ${owner.pid}. The lock is not taken from a process that may still be running — a wrong reclaim produces a corrupted result that looks real, which costs far more than waiting.`,
      exitCode: ENVIRONMENT_NOT_READY
    };
  }

  /* The owner is provably gone, so nothing is writing the artifacts this lock
   * protects. Reclaiming is safe, and it is announced rather than silent. */
  try {
    unlinkSync(lockPath);
    write();
  } catch (error) {
    return {
      acquired: false,
      result: LOCK_RESULT.UNREADABLE,
      lockPath,
      owner,
      reason: `A stale lock at ${lockPath} could not be replaced: ${error.message}`,
      remedy: "Delete it by hand and re-run.",
      exitCode: ENVIRONMENT_NOT_READY
    };
  }

  return acquired(LOCK_RESULT.RECLAIMED_STALE, {
    lockPath,
    record,
    previousOwner: owner,
    note: `Reclaimed a stale lock from pid ${owner.pid}, which is no longer running. That run did not release its lock, so it did not finish normally — its report, if any, was left in place.`
  });
}

/**
 * Builds the acquired result, including a release that is safe to call twice.
 *
 * `release()` removes only a lock this process still owns. A run whose lock was
 * reclaimed while it was stalled must not delete the reclaimer's lock on its
 * way out — that would hand the directory to a third run mid-flight, which is
 * the original defect with extra steps.
 */
function acquired(result, { lockPath, record, previousOwner = null, note = null }) {
  let released = false;

  const release = () => {
    if (released) return { released: false, reason: "already released" };
    released = true;
    try {
      const current = readOwner(lockPath);
      if (!current) return { released: false, reason: "the lock file is gone" };
      if (current.pid !== record.pid || current.startedAt !== record.startedAt) {
        return { released: false, reason: `the lock now belongs to pid ${current.pid}; leaving it alone` };
      }
      unlinkSync(lockPath);
      return { released: true, reason: null };
    } catch (error) {
      return { released: false, reason: error.message };
    }
  };

  return {
    acquired: true,
    result,
    lockPath,
    owner: record,
    previousOwner,
    note,
    release,
    /** True once `release` has run, whatever the outcome. */
    get isReleased() { return released; }
  };
}

/**
 * Registers release on every way a process can end.
 *
 * Success and failure are the easy paths. The ones that matter are the signals:
 * a run stopped with Ctrl-C that leaves its lock behind forces the next run to
 * deal with a stale lock, and while that is handled safely, it is handled by
 * reclaiming — which is a worse outcome than simply releasing on the way out.
 *
 * `exit` cannot do async work, so the release is synchronous by design.
 */
export function releaseOnExit(lock, { on = process.on.bind(process), exit = process.exit.bind(process) } = {}) {
  if (!lock?.acquired) return () => {};

  const done = () => { lock.release(); };

  const onSignal = (signal) => () => {
    done();
    /* Re-raise as the conventional exit code so a caller can still tell a
     * cancellation from a failure. */
    exit(signal === "SIGINT" ? 130 : 143);
  };

  const handlers = [
    ["exit", done],
    ["SIGINT", onSignal("SIGINT")],
    ["SIGTERM", onSignal("SIGTERM")],
    ["uncaughtException", (error) => { done(); throw error; }]
  ];
  for (const [event, handler] of handlers) on(event, handler);

  return done;
}

/** Renders a refusal for a terminal. */
export function describeRefusal(refusal) {
  const lines = [];
  lines.push(`Refusing to run: ${refusal.reason}`);
  lines.push("");
  lines.push(`Lock file: ${refusal.lockPath}`);
  if (refusal.owner) {
    lines.push(`Held by:   pid ${refusal.owner.pid}` +
      `${refusal.owner.tool ? ` (${refusal.owner.tool})` : ""}` +
      `${refusal.owner.host ? ` on ${refusal.owner.host}` : ""}`);
    if (refusal.owner.startedAt) lines.push(`Started:   ${refusal.owner.startedAt}`);
  }
  lines.push("");
  lines.push(refusal.remedy);
  lines.push("");
  lines.push("Nothing was run and no report was written. This is an environment problem,");
  lines.push("not a test result — the previous report is still the most recent real one.");
  return lines.join("\n");
}

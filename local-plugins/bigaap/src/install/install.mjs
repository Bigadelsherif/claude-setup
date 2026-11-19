/**
 * Install, upgrade, repair and uninstall.
 *
 * Every operation here is **planned before it is performed**. A plan is a list
 * of intended actions with a reason attached to each; performing it walks the
 * list. The split is not ceremony — it is what makes `--dry-run` truthful,
 * because the dry run and the real run execute the same planner and differ only
 * in whether the last step happens. A dry run computed by a separate code path
 * describes a program that does not exist.
 *
 * ## The rule everything else follows from
 *
 * **Never overwrite a file the user might have written.** Not "warn and
 * overwrite", not "overwrite and keep a backup" — refuse, name the file, and
 * require an explicit confirmation. A tool that destroys work is not repaired
 * by having kept a copy somewhere the user has to find.
 *
 * Conflict detection is by hash against the manifest. A managed file whose hash
 * matches is ours and may be replaced freely. One whose hash differs was
 * changed by somebody, and this build cannot tell an intentional edit from a
 * corruption — so it says exactly that and stops.
 *
 * ## Idempotence
 *
 * Installing twice is a no-op. Each planned action tests the destination first
 * and is skipped when it is already correct, so the second run reports `already
 * current` for everything rather than rewriting identical bytes.
 */

import {
  existsSync, readdirSync, statSync, lstatSync, mkdirSync, copyFileSync, writeFileSync,
  readFileSync, rmSync, accessSync, constants
} from "node:fs";
import { join, dirname, relative, sep, posix, resolve } from "node:path";

import { PLUGIN_ROOT } from "../workspace/workspace.mjs";
import {
  buildManifest, verifyManifest, controlByteFindings, hashFile,
  MANIFEST_FILE, UPGRADE_BEHAVIOUR, FILE_TYPE, isExcluded, exclusionFor
} from "./manifest.mjs";
import { PLUGIN_VERSION, compareLoose, nodeSatisfied, NODE_REQUIREMENT } from "./versions.mjs";

/** What an installation is being done into. */
export const INSTALL_MODE = Object.freeze({
  /** The repository checkout itself. Nothing is copied; it is already in place. */
  REPOSITORY: "repository",
  /** A user-wide Claude Code plugin directory. */
  GLOBAL: "global",
  /** A `.claude/plugins` directory inside one project. */
  PROJECT: "project"
});

/** What a planned action would do. */
export const ACTION = Object.freeze({
  CREATE: "create",
  REPLACE: "replace",
  SKIP_CURRENT: "skip-current",
  SKIP_PRESERVED: "skip-preserved",
  CONFLICT: "conflict",
  REMOVE: "remove",
  PRESERVE: "preserve"
});

const relPosix = (abs, root) => relative(root, abs).split(sep).join(posix.sep);

/**
 * Where a plugin installs, per mode.
 *
 * Returned rather than created. A path is a decision; making the directory is
 * an action, and actions belong in the plan.
 */
export function installTarget(mode, { home = process.env.HOME ?? process.env.USERPROFILE ?? null, projectRoot = process.cwd(), pluginRoot = PLUGIN_ROOT } = {}) {
  switch (mode) {
    case INSTALL_MODE.REPOSITORY:
      return { mode, path: pluginRoot, inPlace: true };
    case INSTALL_MODE.GLOBAL:
      return home
        ? { mode, path: join(home, ".claude", "plugins", "bigaap-ui-forensics"), inPlace: false }
        : { mode, path: null, inPlace: false, why: "no home directory is set in the environment" };
    case INSTALL_MODE.PROJECT:
      return { mode, path: join(projectRoot, ".claude", "plugins", "bigaap-ui-forensics"), inPlace: false };
    default:
      return { mode, path: null, inPlace: false, why: `\`${mode}\` is not an installation mode` };
  }
}

/* ------------------------------------------------------------- planning */

/**
 * Plans an installation or upgrade.
 *
 * One planner for both, because they are the same operation over a destination
 * that may or may not already hold files. Calling them one thing kept them from
 * drifting into two subtly different behaviours — which is how "upgrade wipes
 * your brief but install doesn't" happens.
 */
export function planInstall({
  source = PLUGIN_ROOT,
  target,
  manifest = null,
  force = false,
  existingManifest = undefined
} = {}) {
  const man = manifest ?? buildManifest({ root: source });
  const actions = [];
  const conflicts = [];

  /* An in-place installation copies nothing. Saying so plainly matters: a
   * repository checkout IS the installation, and a plan that listed 215 copies
   * onto themselves would invite someone to run it. */
  if (target?.inPlace) {
    return {
      target, source, inPlace: true,
      actions: [], conflicts: [],
      summary: "The repository checkout is the installation. Nothing is copied.",
      wouldWrite: 0, wouldReplace: 0, wouldSkip: man.files.length, blocked: false
    };
  }

  if (!target?.path) {
    return {
      target, source, inPlace: false, actions: [], conflicts: [],
      summary: target?.why ?? "no installation target",
      wouldWrite: 0, wouldReplace: 0, wouldSkip: 0, blocked: true,
      blockedReason: target?.why ?? "no installation target"
    };
  }

  /* The manifest already at the destination, when there is one. It tells us
   * which destination files WE wrote — without it, every existing file has to
   * be treated as possibly the user's, which is the safe reading but a noisy
   * one on a routine upgrade. */
  const prior = existingManifest !== undefined
    ? existingManifest
    : readManifestAt(target.path);

  const priorByPath = new Map((prior?.files ?? []).map((f) => [f.path, f]));

  for (const f of man.files) {
    const dest = join(target.path, f.path);

    if (!existsSync(dest)) {
      actions.push({ action: ACTION.CREATE, path: f.path, type: f.type, why: "not present at the destination" });
      continue;
    }

    let destHash = null;
    try { destHash = hashFile(dest); } catch { /* handled below */ }

    if (destHash === f.hash) {
      actions.push({ action: ACTION.SKIP_CURRENT, path: f.path, type: f.type, why: "already identical" });
      continue;
    }

    /* A preserved file is placed once and then belongs to the user. A target
     * brief they filled in is the case this exists for, and replacing it would
     * be the single most damaging thing an upgrade of this tool could do. */
    if (f.upgrade === UPGRADE_BEHAVIOUR.PRESERVE) {
      actions.push({ action: ACTION.SKIP_PRESERVED, path: f.path, type: f.type, why: "placed once; it is yours now" });
      continue;
    }

    const known = priorByPath.get(f.path);
    const weWroteIt = known && destHash === known.hash;

    if (weWroteIt) {
      actions.push({
        action: ACTION.REPLACE, path: f.path, type: f.type,
        why: `an unmodified ${known.version ?? "earlier"} file we installed`
      });
      continue;
    }

    /* Differs from ours AND from what we last wrote — or we have no record of
     * writing it. Either way this build cannot distinguish a deliberate edit
     * from a corrupted copy, and guessing in favour of "it's probably fine"
     * loses the user's work exactly when they were relying on it. */
    const conflict = {
      path: f.path, type: f.type,
      expected: known?.hash ?? "(no record — this file was not installed by us)",
      actual: destHash ?? "(unreadable)",
      why: destHash === null
        ? "the destination file cannot be read, so it cannot be compared"
        : known
          ? "the destination differs from the version we installed, so it has been edited since"
          : "a file with this name is already there and we have no record of installing it"
    };
    conflicts.push(conflict);
    actions.push({
      action: force ? ACTION.REPLACE : ACTION.CONFLICT,
      path: f.path, type: f.type,
      why: force ? "--force was given; the existing file is backed up first" : conflict.why
    });
  }

  const count = (a) => actions.filter((x) => x.action === a).length;
  return {
    target, source, inPlace: false,
    actions, conflicts,
    wouldWrite: count(ACTION.CREATE),
    wouldReplace: count(ACTION.REPLACE),
    wouldSkip: count(ACTION.SKIP_CURRENT) + count(ACTION.SKIP_PRESERVED),
    blocked: conflicts.length > 0 && !force,
    blockedReason: conflicts.length && !force
      ? `${conflicts.length} file(s) at the destination differ from this build's and were not installed by it.`
      : null,
    summary: conflicts.length && !force
      ? `${count(ACTION.CREATE)} to create, ${count(ACTION.REPLACE)} to replace, ${conflicts.length} conflict(s).`
      : `${count(ACTION.CREATE)} to create, ${count(ACTION.REPLACE)} to replace, ${count(ACTION.SKIP_CURRENT) + count(ACTION.SKIP_PRESERVED)} already current.`
  };
}

/** Reads a manifest from an installed directory, or null. */
export function readManifestAt(dir) {
  const p = join(dir, MANIFEST_FILE);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

/**
 * Performs a plan.
 *
 * Writes are attempted one file at a time and a failure on any one is recorded
 * and the walk continues, so a permission error on a single file does not leave
 * the rest unattempted with no record of why. The result says what was written,
 * what was skipped and what failed — an install that half-worked must be able
 * to say which half.
 */
export function performInstall(plan, { backupDir = null } = {}) {
  if (plan.inPlace) {
    return { performed: false, written: [], skipped: [], failed: [], backups: [], why: "in-place; nothing to copy" };
  }
  if (plan.blocked) {
    return { performed: false, written: [], skipped: [], failed: [], backups: [], why: plan.blockedReason };
  }

  const written = [];
  const skipped = [];
  const failed = [];
  const backups = [];

  for (const a of plan.actions) {
    if (a.action === ACTION.SKIP_CURRENT || a.action === ACTION.SKIP_PRESERVED) { skipped.push(a); continue; }
    if (a.action === ACTION.CONFLICT) { skipped.push(a); continue; }

    const src = join(plan.source, a.path);
    const dest = join(plan.target.path, a.path);

    try {
      /* Back up before replacing, always — including when --force made the
       * replacement legal. The confirmation covers the intent; the backup
       * covers the mistake. */
      if (a.action === ACTION.REPLACE && backupDir && existsSync(dest)) {
        const b = join(backupDir, a.path);
        mkdirSync(dirname(b), { recursive: true });
        copyFileSync(dest, b);
        backups.push({ path: a.path, backup: b });
      }
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
      written.push(a);
    } catch (error) {
      failed.push({ ...a, error: error.code ?? error.message });
    }
  }

  /* The manifest is written last and only when nothing failed. A manifest is a
   * claim that the files it lists are in place; writing one after a partial
   * copy would make the next repair trust a state that never existed. */
  let manifestWritten = false;
  if (!failed.length) {
    try {
      const man = buildManifest({ root: plan.source });
      writeFileSync(join(plan.target.path, MANIFEST_FILE), JSON.stringify(man, null, 2) + "\n", "utf8");
      manifestWritten = true;
    } catch (error) {
      failed.push({ path: MANIFEST_FILE, action: ACTION.CREATE, error: error.code ?? error.message });
    }
  }

  return {
    performed: true,
    written, skipped, failed, backups,
    manifestWritten,
    /* An interrupted or partly-failed install must not look finished. Without
     * a manifest the next `bigaap repair` treats the destination as unverified
     * rather than as a good installation with a few odd files. */
    complete: failed.length === 0 && manifestWritten,
    why: failed.length ? `${failed.length} file(s) could not be written; no manifest was written, so this installation is marked incomplete` : null
  };
}

/* --------------------------------------------------------------- repair */

/**
 * Verifies an installation and plans repairs.
 *
 * Repair NEVER overwrites a modified file without confirmation. A modified
 * managed file is reported, with its hash, and left alone. `--force` replaces
 * it and takes a backup first.
 */
export function planRepair({ root = PLUGIN_ROOT, manifest = undefined, force = false } = {}) {
  const man = manifest !== undefined ? manifest : (readManifestAt(root) ?? buildManifest({ root }));
  const verification = verifyManifest(man, { root });
  const controlBytes = controlByteFindings(man, { root });

  const actions = [];
  for (const f of verification.missing) {
    actions.push({ action: ACTION.CREATE, path: f.path, type: f.type, why: "missing from the installation" });
  }
  for (const f of verification.modified) {
    actions.push({
      action: force ? ACTION.REPLACE : ACTION.CONFLICT,
      path: f.path, type: f.type,
      why: force
        ? "--force was given; the modified file is backed up first"
        : "modified since installation — left alone. Re-run with --force to replace it, and it will be backed up first."
    });
  }
  for (const f of verification.unreadable) {
    actions.push({ action: ACTION.CONFLICT, path: f.path, type: f.type, why: `cannot be read (${f.why})` });
  }

  const node = nodeSatisfied();

  return {
    root,
    verification,
    controlBytes,
    actions,
    /* Environment problems are reported by repair but never fixed by it.
     * Installing a runtime or downloading a browser are large, network-bound
     * actions that must be the user's explicit choice. */
    environment: {
      node: node.ok ? null : { why: node.reason, userAction: `Install Node ${NODE_REQUIREMENT}.` },
      playwrightPackage: existsSync(join(root, "node_modules", "playwright"))
        ? null
        : { why: "the playwright package is not installed", userAction: "Run `npm install` in the plugin directory." }
    },
    repairable: actions.filter((a) => a.action === ACTION.CREATE).length,
    needsConfirmation: actions.filter((a) => a.action === ACTION.CONFLICT).length,
    ok: verification.ok && controlBytes.length === 0 && actions.length === 0
  };
}

/* ------------------------------------------------------------ uninstall */

/**
 * What an uninstall may touch, in ascending order of destructiveness.
 *
 * Each is separately opted into. Bundling them behind one flag would mean a
 * user who wanted the code gone lost their analysis history to the same
 * keystroke, and the two decisions are nothing alike.
 */
export const REMOVABLE = Object.freeze({
  PLUGIN_CODE: "plugin-code",
  PROJECT_CONFIG: "project-config",
  GENERATED_OUTPUTS: "generated-outputs",
  ANALYSIS_EVIDENCE: "analysis-evidence",
  CORRECTION_HISTORY: "correction-history",
  OBSERVABILITY_EVENTS: "observability-events"
});

/** What each category covers, whether it is the user's, and whether removing it can be undone. */
export const REMOVABLE_SPEC = Object.freeze({
  [REMOVABLE.PLUGIN_CODE]: {
    describe: "The installed plugin files themselves.",
    ours: true, irreversible: false, defaultRemoved: true,
    recover: "Reinstall."
  },
  [REMOVABLE.PROJECT_CONFIG]: {
    describe: ".bigaap-analyzer/ — project settings, policies and your target brief.",
    ours: false, irreversible: true, defaultRemoved: false,
    recover: "Nothing recovers a target brief you wrote. `bigaap init` creates a blank one."
  },
  [REMOVABLE.GENERATED_OUTPUTS]: {
    describe: "output/ — prompts and specs projected from an IR.",
    ours: true, irreversible: false, defaultRemoved: false,
    recover: "Re-run the analysis; every output is a regenerable projection of the IR."
  },
  [REMOVABLE.ANALYSIS_EVIDENCE]: {
    describe: "Captures, evidence maps and IR. What was measured.",
    ours: false, irreversible: true, defaultRemoved: false,
    recover: "Only by re-capturing the reference, which may no longer look the same."
  },
  [REMOVABLE.CORRECTION_HISTORY]: {
    describe: "feedback/corrections/ — what you corrected, and why.",
    ours: false, irreversible: true, defaultRemoved: false,
    recover: "Nothing. This is an append-only record of your decisions."
  },
  [REMOVABLE.OBSERVABILITY_EVENTS]: {
    describe: ".bigaap-observability/ — local diagnostic events.",
    ours: true, irreversible: true, defaultRemoved: false,
    recover: "Nothing, and nothing is lost that describes your work — these are durations and status codes."
  }
});

/**
 * Size of a tree, for the uninstall estimate.
 *
 * `lstatSync` and an explicit symlink skip. With `statSync` a link pointing at
 * its own ancestor recurses until the stack gives out — and this runs during an
 * uninstall, where a crash leaves the user unable to find out what would be
 * removed. A link is counted as the link, never followed.
 */
const dirSize = (dir) => {
  let bytes = 0;
  let files = 0;
  let symlinks = 0;
  const walk = (p) => {
    let st;
    try { st = lstatSync(p); } catch { return; }
    if (st.isSymbolicLink()) { symlinks += 1; return; }
    if (st.isDirectory()) {
      let entries = [];
      try { entries = readdirSync(p); } catch { return; }
      for (const e of entries) walk(join(p, e));
      return;
    }
    bytes += st.size;
    files += 1;
  };
  walk(dir);
  return { bytes, files, symlinks };
};

/**
 * Plans an uninstall. Always a dry run first — this returns the report and
 * removes nothing.
 *
 * Every category the user did NOT ask for appears in the plan as preserved,
 * with its size. An uninstall report that lists only what it will delete leaves
 * the user to work out what survives, which is the question they actually have.
 */
export function planUninstall({
  pluginRoot = PLUGIN_ROOT,
  projectRoot = process.cwd(),
  remove = [REMOVABLE.PLUGIN_CODE],
  manifest = undefined
} = {}) {
  const man = manifest !== undefined ? manifest : (readManifestAt(pluginRoot) ?? buildManifest({ root: pluginRoot }));

  const locations = {
    [REMOVABLE.PLUGIN_CODE]: (man.files ?? []).map((f) => join(pluginRoot, f.path)),
    [REMOVABLE.PROJECT_CONFIG]: [join(projectRoot, ".bigaap-analyzer")],
    [REMOVABLE.GENERATED_OUTPUTS]: [join(projectRoot, "output"), join(projectRoot, "outputs")],
    [REMOVABLE.ANALYSIS_EVIDENCE]: [join(projectRoot, ".ui-analysis"), join(projectRoot, "workspaces")],
    [REMOVABLE.CORRECTION_HISTORY]: [join(projectRoot, "feedback")],
    [REMOVABLE.OBSERVABILITY_EVENTS]: [join(projectRoot, ".bigaap-observability")]
  };

  const categories = [];
  for (const [key, spec] of Object.entries(REMOVABLE_SPEC)) {
    const paths = (locations[key] ?? []).filter((p) => existsSync(p));
    let bytes = 0;
    let files = 0;
    for (const p of paths) {
      let st;
      try { st = lstatSync(p); } catch { continue; }
      if (st.isSymbolicLink()) { files += 1; continue; }
      if (st.isDirectory()) { const d = dirSize(p); bytes += d.bytes; files += d.files; }
      else { bytes += st.size; files += 1; }
    }
    categories.push({
      category: key, ...spec,
      selected: remove.includes(key),
      present: paths.length > 0,
      paths, bytes, files
    });
  }

  /* Files at the plugin root that the manifest does not claim. Reported, never
   * removed: something is there that this build did not put there, and deleting
   * an unmanaged file during an uninstall is how a tool takes something that
   * was never its to take. */
  const unmanaged = [];
  if (existsSync(pluginRoot)) {
    const claimed = new Set((man.files ?? []).map((f) => f.path));
    const walk = (p) => {
      let entries = [];
      try { entries = readdirSync(p); } catch { return; }
      for (const e of entries) {
        const abs = join(p, e);
        const r = relPosix(abs, pluginRoot);
        if (isExcluded(r)) {
          unmanaged.push({ path: r, why: `not part of the package: ${exclusionFor(r).why}`, shared: false });
          continue;
        }
        let st;
        try { st = lstatSync(abs); } catch { continue; }
        /* Reported as a link and never followed. Following one would let this
         * enumeration walk out of the plugin root entirely and list paths that
         * have nothing to do with the installation. */
        if (st.isSymbolicLink()) {
          unmanaged.push({ path: r, why: "a symbolic link; not followed, and never removed", shared: true });
          continue;
        }
        if (st.isDirectory()) { walk(abs); continue; }
        if (!claimed.has(r)) unmanaged.push({ path: r, why: "present but not in the manifest", shared: false });
      }
    };
    walk(pluginRoot);
  }

  const selected = categories.filter((c) => c.selected && c.present);
  const preserved = categories.filter((c) => !c.selected);

  return {
    pluginRoot, projectRoot,
    dryRun: true,
    categories,
    wouldRemove: selected,
    wouldPreserve: preserved,
    unmanaged,
    totalBytes: selected.reduce((n, c) => n + c.bytes, 0),
    totalFiles: selected.reduce((n, c) => n + c.files, 0),
    irreversible: selected.filter((c) => c.irreversible),
    /* Any irreversible category needs its own explicit confirmation, separate
     * from having selected it. Selecting says what; confirming says yes. */
    requiresConfirmation: selected.some((c) => c.irreversible)
  };
}

/**
 * Performs an uninstall from a plan.
 *
 * Refuses unless every irreversible category was confirmed by name. A blanket
 * `--confirm` is not accepted for the destructive categories: the user must say
 * which data they mean, because "yes" to removing plugin code is not consent to
 * losing a correction history.
 */
export function performUninstall(plan, { confirmed = [] } = {}) {
  const needed = plan.irreversible.map((c) => c.category);
  const missing = needed.filter((c) => !confirmed.includes(c));
  if (missing.length) {
    return {
      performed: false,
      removed: [], failed: [], preserved: plan.wouldPreserve.map((c) => c.category),
      why: `not confirmed for: ${missing.join(", ")}. Each irreversible category must be confirmed by name.`
    };
  }

  const removed = [];
  const failed = [];
  for (const c of plan.wouldRemove) {
    for (const p of c.paths) {
      try { rmSync(p, { recursive: true, force: true }); removed.push({ category: c.category, path: p }); }
      catch (error) { failed.push({ category: c.category, path: p, error: error.code ?? error.message }); }
    }
  }

  return {
    performed: true,
    removed, failed,
    preserved: plan.wouldPreserve.map((c) => c.category),
    unmanagedLeftInPlace: plan.unmanaged.length,
    why: null
  };
}

/* -------------------------------------------------------------- upgrade */

/**
 * Compares an installed version against this build's.
 *
 * `same`, `upgrade`, `downgrade`, `unknown`. A downgrade is reported rather
 * than performed: installing older code over newer data is how a build ends up
 * reading files it does not understand, and the user asking for it usually
 * means something else.
 */
export function upgradeDirection(installedVersion, buildVersion = PLUGIN_VERSION) {
  if (installedVersion == null || buildVersion == null) {
    return { direction: "unknown", why: "one of the versions could not be read" };
  }
  const c = compareLoose(installedVersion, buildVersion);
  if (c === 0) return { direction: "same", why: `both are ${buildVersion}` };
  if (c < 0) return { direction: "upgrade", why: `${installedVersion} -> ${buildVersion}` };
  return {
    direction: "downgrade",
    why: `the installation is ${installedVersion} and this build is ${buildVersion}`,
    userAction: "Installing older code over newer data can leave files this build cannot read. Use the newer build, or uninstall first and install deliberately."
  };
}

/** Renders an install or upgrade plan. */
export function renderInstallPlan(plan) {
  const lines = [];
  if (plan.inPlace) {
    lines.push(plan.summary, "", "A repository checkout runs directly:", "  node bin/bigaap.mjs help");
    return lines.join("\n");
  }
  lines.push(`Target: ${plan.target?.path ?? "(none)"}  [${plan.target?.mode}]`, "", plan.summary, "");

  if (plan.conflicts.length) {
    lines.push(`${plan.conflicts.length} conflict(s) — nothing was written:`, "");
    for (const c of plan.conflicts) {
      lines.push(`  ${c.path}`);
      lines.push(`      ${c.why}`);
    }
    lines.push("", "Each is preserved as it is. Re-run with --force to replace them; every replaced file is backed up first.");
  }
  return lines.join("\n");
}

/** Renders an uninstall dry-run report. */
export function renderUninstallPlan(plan) {
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  const lines = ["Dry run. Nothing was removed.", ""];

  if (plan.wouldRemove.length) {
    lines.push("Would remove:");
    for (const c of plan.wouldRemove) {
      lines.push(`  ${c.category.padEnd(22)} ${c.files} file(s), ${kb(c.bytes)}${c.irreversible ? "   IRREVERSIBLE" : ""}`);
      lines.push(`      ${c.describe}`);
      if (c.irreversible) lines.push(`      recovery: ${c.recover}`);
    }
    lines.push("");
  }

  lines.push("Would preserve:");
  for (const c of plan.wouldPreserve) {
    lines.push(`  ${c.category.padEnd(22)} ${c.present ? `${c.files} file(s), ${kb(c.bytes)}` : "not present"}`);
    lines.push(`      ${c.describe}`);
  }

  if (plan.unmanaged.length) {
    lines.push("", `Unmanaged, left in place (${plan.unmanaged.length}):`);
    for (const u of plan.unmanaged.slice(0, 12)) lines.push(`  ${u.path} — ${u.why}`);
    if (plan.unmanaged.length > 12) lines.push(`  … and ${plan.unmanaged.length - 12} more`);
  }

  lines.push("", `Total to remove: ${plan.totalFiles} file(s), ${kb(plan.totalBytes)}`);
  if (plan.requiresConfirmation) {
    lines.push("", `Irreversible. Confirm each by name: --confirm ${plan.irreversible.map((c) => c.category).join(",")}`);
  }
  return lines.join("\n");
}

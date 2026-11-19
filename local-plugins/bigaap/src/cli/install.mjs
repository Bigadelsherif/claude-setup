/**
 * The installation command surface.
 *
 * Eight commands, all returning the same typed result every other command
 * returns. The statuses do real work here and the distinctions are not
 * cosmetic:
 *
 * - `blocked` — a gate refused. A conflict is the case: the files are intact,
 *   the reason is known, and re-running unchanged will refuse identically.
 * - `requires-user-input` — waiting on a decision only the user can make.
 *   Confirming a destructive removal is the case.
 * - `failed` — it broke. A permission error is the case.
 * - `not-attempted` — there was nothing to do.
 *
 * A CI job that retries on 1 must not retry a conflict, which is why a conflict
 * is 3 and not 1. That single property is most of the reason this contract
 * exists.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

import { cliResult, STATUS, READINESS } from "./result.mjs";
import { PLUGIN_ROOT } from "../workspace/workspace.mjs";
import { versionSet, renderVersions, checkCompatibility, COMPATIBILITY, COMPATIBILITY_KINDS, PLUGIN_VERSION } from "../install/versions.mjs";
import { buildManifest, verifyManifest, MANIFEST_FILE, controlByteFindings } from "../install/manifest.mjs";
import {
  INSTALL_MODE, ACTION, REMOVABLE, REMOVABLE_SPEC, installTarget, planInstall, performInstall,
  planRepair, planUninstall, performUninstall, readManifestAt, upgradeDirection,
  renderInstallPlan, renderUninstallPlan
} from "../install/install.mjs";
import { runDoctor, renderDoctor, CHECK } from "../install/doctor.mjs";
import { migrateTree, renderMigrations, MIGRATIONS, MIGRATION_IDS, DELIBERATELY_ABSENT, LEGACY_STATUS, UNMIGRATABLE_STATUS } from "../install/migrate.mjs";

/* ------------------------------------------------------------- version */

export function cmdVersion({ json = false } = {}) {
  const set = versionSet();
  const unreadable = set.bigaap == null;

  return cliResult({
    operation: "version",
    status: unreadable ? STATUS.FAILED : STATUS.COMPLETED,
    errors: unreadable
      ? [{
          code: "version-unreadable",
          message: "This build cannot read its own version from package.json.",
          recommendation: "Run `bigaap repair`. Nothing can be checked for compatibility against a version that cannot be read."
        }]
      : [],
    warnings: !unreadable && set.plugin && set.plugin !== set.bigaap
      ? [{
          code: "version-mismatch",
          message: `package.json says ${set.bigaap}; .claude-plugin/plugin.json says ${set.plugin}.`,
          recommendation: "Set both to the same value."
        }]
      : [],
    summary: unreadable ? "version unreadable" : `bigaap ${set.bigaap}`,
    detail: { versions: set, rendered: renderVersions(set) },
    readiness: READINESS.UNDETERMINED,
    readinessReason: "Reporting versions measures nothing and licenses nothing."
  });
}

/* -------------------------------------------------------------- doctor */

export function cmdDoctor({ root = PLUGIN_ROOT, env = process.env, allowBrowserLaunch = false } = {}) {
  const report = runDoctor({ root, env, allowBrowserLaunch });

  const status = report.state === CHECK.BLOCKING ? STATUS.BLOCKED
    : report.warnings.length || report.unknown.length ? STATUS.COMPLETED_WITH_WARNINGS
      : STATUS.COMPLETED;

  return cliResult({
    operation: "doctor",
    status,
    blockers: report.blocking.map((c) => ({
      code: `doctor-${c.id}`, message: c.summary, userAction: c.userAction,
      recaptureResolves: false, impossibleForInputKind: false
    })),
    warnings: [...report.warnings, ...report.unknown].map((c) => ({
      code: `doctor-${c.id}`, message: c.summary, recommendation: c.userAction
    })),
    summary: report.state === CHECK.OK
      ? "Everything this build needs is present. No browser was launched."
      : `${report.blocking.length} blocking, ${report.warnings.length} warning(s), ${report.unknown.length} undetermined. No browser was launched.`,
    detail: { doctor: report, rendered: renderDoctor(report), browserLaunched: report.browserLaunched },
    userActions: [...report.blocking, ...report.warnings]
      .filter((c) => c.userAction)
      .map((c) => ({ what: c.summary, how: c.userAction })),
    readiness: READINESS.UNDETERMINED,
    readinessReason: "Doctor reports whether the tool can run. It measures nothing about a reference."
  });
}

/* ------------------------------------------------------------- install */

export function cmdInstall({
  mode = INSTALL_MODE.REPOSITORY,
  source = PLUGIN_ROOT,
  projectRoot = process.cwd(),
  home = process.env.HOME ?? process.env.USERPROFILE ?? null,
  dryRun = true,
  force = false,
  backupDir = null
} = {}) {
  if (!Object.values(INSTALL_MODE).includes(mode)) {
    return cliResult({
      operation: "install", status: STATUS.FAILED,
      errors: [{
        code: "unknown-install-mode",
        message: `\`${mode}\` is not an installation mode.`,
        recommendation: `Use one of: ${Object.values(INSTALL_MODE).join(", ")}.`
      }],
      readiness: READINESS.UNDETERMINED, readinessReason: "Nothing was installed."
    });
  }

  const target = installTarget(mode, { home, projectRoot, pluginRoot: source });
  const plan = planInstall({ source, target, force });

  if (plan.inPlace) {
    return cliResult({
      operation: "install", status: STATUS.NOT_ATTEMPTED,
      summary: "The repository checkout is the installation; nothing is copied.",
      detail: { plan, rendered: renderInstallPlan(plan) },
      userActions: [{ what: "Run it from the checkout.", how: "node bin/bigaap.mjs help" }],
      readiness: READINESS.UNDETERMINED,
      readinessReason: "Nothing was installed because nothing needed to be."
    });
  }

  if (plan.blocked) {
    return cliResult({
      operation: "install", status: STATUS.BLOCKED,
      blockers: plan.conflicts.map((c) => ({
        code: "install-conflict",
        message: `${c.path}: ${c.why}`,
        userAction: "Keep it, or re-run with --force. A forced replacement is backed up first.",
        recaptureResolves: false, impossibleForInputKind: false
      })),
      summary: plan.blockedReason,
      detail: { plan, rendered: renderInstallPlan(plan) },
      userActions: [
        { what: "Inspect the listed files.", how: "Each is preserved exactly as it is." },
        { what: "Replace them, if they are not yours.", how: "Re-run with --force; every replaced file is backed up first." }
      ],
      readiness: READINESS.UNDETERMINED,
      readinessReason: "Nothing was written, so nothing changed."
    });
  }

  if (dryRun) {
    return cliResult({
      operation: "install",
      status: plan.wouldWrite + plan.wouldReplace === 0 ? STATUS.NOT_ATTEMPTED : STATUS.COMPLETED,
      summary: `Dry run. ${plan.summary}`,
      detail: { plan, rendered: renderInstallPlan(plan), dryRun: true },
      userActions: plan.wouldWrite + plan.wouldReplace === 0
        ? []
        : [{ what: "Perform it.", how: "Re-run with --apply." }],
      readiness: READINESS.UNDETERMINED,
      readinessReason: "A dry run changes nothing."
    });
  }

  const outcome = performInstall(plan, { backupDir });
  const failed = outcome.failed.length > 0;

  return cliResult({
    operation: "install",
    status: failed ? STATUS.FAILED : STATUS.COMPLETED,
    errors: outcome.failed.map((f) => ({
      code: f.error === "EACCES" || f.error === "EPERM" ? "install-permission-denied" : "install-write-failed",
      message: `${f.path}: ${f.error}`,
      recommendation: f.error === "EACCES" || f.error === "EPERM"
        ? "Check write permission on the destination, or install somewhere you own."
        : "Re-run; the installation is marked incomplete until it succeeds."
    })),
    artifacts: outcome.written.map((w) => ({ kind: w.type, path: w.path })),
    summary: failed
      ? `${outcome.written.length} written, ${outcome.failed.length} failed. No manifest was written, so this installation is marked incomplete.`
      : `${outcome.written.length} file(s) written, ${outcome.skipped.length} already current.`,
    detail: { plan, outcome },
    readiness: READINESS.UNDETERMINED,
    readinessReason: "Installing the tool measures nothing."
  });
}

/* ------------------------------------------------------------- upgrade */

export function cmdUpgrade({
  mode = INSTALL_MODE.GLOBAL,
  source = PLUGIN_ROOT,
  projectRoot = process.cwd(),
  home = process.env.HOME ?? process.env.USERPROFILE ?? null,
  dryRun = true,
  force = false,
  backupDir = null,
  migrate = true
} = {}) {
  const target = installTarget(mode, { home, projectRoot, pluginRoot: source });

  if (target.inPlace) {
    return cliResult({
      operation: "upgrade", status: STATUS.NOT_ATTEMPTED,
      summary: "A repository checkout is upgraded by updating the checkout, not by this command.",
      userActions: [{
        what: "Update the checkout instead.",
        how: "Pull the new revision, then run `bigaap migrations --apply` if a project needs migrating."
      }],
      readiness: READINESS.UNDETERMINED, readinessReason: "Nothing was changed."
    });
  }
  if (!target.path) {
    return cliResult({
      operation: "upgrade", status: STATUS.FAILED,
      errors: [{ code: "no-install-target", message: target.why ?? "no installation target", recommendation: "Pass --project, or set HOME." }],
      readiness: READINESS.UNDETERMINED, readinessReason: "Nothing was changed."
    });
  }

  const existing = readManifestAt(target.path);
  if (!existing) {
    return cliResult({
      operation: "upgrade", status: STATUS.REQUIRES_USER_INPUT,
      summary: `Nothing is installed at ${target.path}, or it has no manifest.`,
      userActions: [
        { what: "Install it first.", how: "bigaap install --mode " + mode + " --apply" },
        {
          what: "If files ARE there, decide what they are.",
          how: "They were not put there by this tool, and an upgrade will not adopt them silently."
        }
      ],
      detail: { target },
      readiness: READINESS.UNDETERMINED, readinessReason: "Nothing was changed."
    });
  }

  const direction = upgradeDirection(existing.pluginVersion, PLUGIN_VERSION);
  if (direction.direction === "downgrade" && !force) {
    return cliResult({
      operation: "upgrade", status: STATUS.BLOCKED,
      blockers: [{
        code: "upgrade-would-downgrade",
        message: direction.why,
        userAction: direction.userAction,
        recaptureResolves: false, impossibleForInputKind: false
      }],
      summary: "Refused: this would install older code over a newer installation.",
      detail: { target, direction },
      readiness: READINESS.UNDETERMINED, readinessReason: "Nothing was changed."
    });
  }

  const plan = planInstall({ source, target, force, existingManifest: existing });

  if (plan.blocked) {
    return cliResult({
      operation: "upgrade", status: STATUS.BLOCKED,
      blockers: plan.conflicts.map((c) => ({
        code: "upgrade-conflict",
        message: `${c.path}: ${c.why}`,
        userAction: "Keep your version, or re-run with --force. A forced replacement is backed up first.",
        recaptureResolves: false, impossibleForInputKind: false
      })),
      summary: plan.blockedReason,
      detail: { plan, direction, rendered: renderInstallPlan(plan) },
      readiness: READINESS.UNDETERMINED, readinessReason: "Nothing was written."
    });
  }

  const migrationReport = migrate ? migrateTree(projectRoot, { dryRun: dryRun || !force ? true : false, backupDir }) : null;

  if (dryRun) {
    return cliResult({
      operation: "upgrade", status: STATUS.COMPLETED,
      summary: `Dry run. ${direction.why}. ${plan.summary}`,
      detail: { plan, direction, migrations: migrationReport, rendered: renderInstallPlan(plan), dryRun: true },
      userActions: [{ what: "Perform it.", how: "Re-run with --apply." }],
      readiness: READINESS.UNDETERMINED, readinessReason: "A dry run changes nothing."
    });
  }

  const outcome = performInstall(plan, { backupDir });
  return cliResult({
    operation: "upgrade",
    status: outcome.failed.length ? STATUS.FAILED : STATUS.COMPLETED,
    errors: outcome.failed.map((f) => ({
      code: "upgrade-write-failed", message: `${f.path}: ${f.error}`,
      recommendation: "The installation is marked incomplete until this succeeds. Re-run."
    })),
    summary: outcome.failed.length
      ? `${outcome.written.length} written, ${outcome.failed.length} failed; marked incomplete.`
      : `${direction.why}. ${outcome.written.length} file(s) written, ${outcome.backups.length} backed up.`,
    detail: { plan, direction, outcome, migrations: migrationReport },
    readiness: READINESS.UNDETERMINED, readinessReason: "Upgrading the tool measures nothing."
  });
}

/* -------------------------------------------------------------- repair */

export function cmdRepair({ root = PLUGIN_ROOT, force = false, dryRun = true, backupDir = null } = {}) {
  const plan = planRepair({ root, force });

  if (plan.ok) {
    return cliResult({
      operation: "repair", status: STATUS.COMPLETED,
      summary: `All ${plan.verification.checked} managed file(s) match the manifest.`,
      detail: { repair: plan },
      readiness: READINESS.UNDETERMINED, readinessReason: "Verifying the installation measures nothing."
    });
  }

  const conflicts = plan.actions.filter((a) => a.action === ACTION.CONFLICT);

  /* A modified managed file is `requires-user-input`, not `blocked`. Nothing
   * refused it on the evidence — the tool is waiting for a person to say
   * whether their edit should survive, and only a person can answer that. */
  if (conflicts.length && !force) {
    return cliResult({
      operation: "repair", status: STATUS.REQUIRES_USER_INPUT,
      warnings: [
        ...conflicts.map((c) => ({
          code: "repair-file-modified", message: `${c.path}: ${c.why}`,
          recommendation: "Keep your edit, or re-run with --force to restore the managed version. A forced restore is backed up first."
        })),
        ...plan.controlBytes.map((c) => ({
          code: "repair-control-byte",
          message: `${c.path}:${c.line} contains a raw ${c.byte}`,
          recommendation: "In a regex literal this silently changes what the pattern matches (def_0038). Replace it with its escape sequence."
        }))
      ],
      summary: `${conflicts.length} managed file(s) differ from the manifest and were left alone. ${plan.repairable} missing file(s) can be restored.`,
      detail: { repair: plan },
      userActions: [
        { what: "Review each listed file.", how: "Your edit is intact; nothing was changed." },
        { what: "Restore the managed versions, if the edits were not deliberate.", how: "Re-run with --apply --force; each is backed up first." }
      ],
      readiness: READINESS.UNDETERMINED, readinessReason: "Nothing was changed."
    });
  }

  if (dryRun) {
    return cliResult({
      operation: "repair", status: STATUS.COMPLETED_WITH_WARNINGS,
      warnings: plan.actions.map((a) => ({ code: `repair-${a.action}`, message: `${a.path}: ${a.why}` })),
      summary: `Dry run. ${plan.repairable} file(s) would be restored, ${conflicts.length} conflict(s).`,
      detail: { repair: plan, dryRun: true },
      userActions: [{ what: "Restore the missing files.", how: "Re-run with --apply." }],
      readiness: READINESS.UNDETERMINED, readinessReason: "A dry run changes nothing."
    });
  }

  /* Restore from the plugin root itself, which is the only source of a managed
   * file's correct contents. A repair with no source to restore FROM can report
   * and cannot fix, and says so rather than pretending. */
  const restored = [];
  const failed = [];
  for (const a of plan.actions) {
    if (a.action !== ACTION.CREATE && a.action !== ACTION.REPLACE) continue;
    const src = join(PLUGIN_ROOT, a.path);
    const dest = join(root, a.path);
    if (!existsSync(src) || resolve(src) === resolve(dest)) {
      failed.push({ ...a, error: "no source copy is available to restore from" });
      continue;
    }
    try {
      if (backupDir && existsSync(dest)) {
        const b = join(backupDir, a.path);
        mkdirSync(dirname(b), { recursive: true });
        writeFileSync(b, readFileSync(dest));
      }
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(src));
      restored.push(a);
    } catch (error) {
      failed.push({ ...a, error: error.code ?? error.message });
    }
  }

  return cliResult({
    operation: "repair",
    status: failed.length ? STATUS.COMPLETED_WITH_WARNINGS : STATUS.COMPLETED,
    warnings: failed.map((f) => ({ code: "repair-failed", message: `${f.path}: ${f.error}` })),
    summary: `${restored.length} restored, ${failed.length} could not be.`,
    detail: { repair: plan, restored, failed },
    readiness: READINESS.UNDETERMINED, readinessReason: "Repairing the installation measures nothing."
  });
}

/* ----------------------------------------------------------- uninstall */

export function cmdUninstall({
  pluginRoot = PLUGIN_ROOT,
  projectRoot = process.cwd(),
  remove = [REMOVABLE.PLUGIN_CODE],
  confirmed = [],
  apply = false
} = {}) {
  const unknown = remove.filter((r) => !Object.values(REMOVABLE).includes(r));
  if (unknown.length) {
    return cliResult({
      operation: "uninstall", status: STATUS.FAILED,
      errors: [{
        code: "unknown-removal-category",
        message: `not a removal category: ${unknown.join(", ")}`,
        recommendation: `Use one or more of: ${Object.values(REMOVABLE).join(", ")}.`
      }],
      readiness: READINESS.UNDETERMINED, readinessReason: "Nothing was removed."
    });
  }

  const plan = planUninstall({ pluginRoot, projectRoot, remove });

  if (!apply) {
    return cliResult({
      operation: "uninstall",
      status: STATUS.COMPLETED,
      warnings: plan.irreversible.map((c) => ({
        code: "uninstall-irreversible",
        message: `${c.category}: ${c.files} file(s), ${(c.bytes / 1024).toFixed(1)} KB — ${c.recover}`,
        recommendation: `Confirm by name to proceed: --confirm ${c.category}`
      })),
      summary: `Dry run. Would remove ${plan.totalFiles} file(s) in ${plan.wouldRemove.length} categor(ies); ${plan.wouldPreserve.length} categor(ies) preserved.`,
      detail: { plan, rendered: renderUninstallPlan(plan) },
      userActions: plan.requiresConfirmation
        ? [{
            what: "Confirm each irreversible category by name.",
            how: `bigaap uninstall --apply --confirm ${plan.irreversible.map((c) => c.category).join(",")}`
          }]
        : [{ what: "Perform it.", how: "Re-run with --apply." }],
      readiness: READINESS.UNDETERMINED, readinessReason: "A dry run removes nothing."
    });
  }

  const outcome = performUninstall(plan, { confirmed });
  if (!outcome.performed) {
    return cliResult({
      operation: "uninstall", status: STATUS.REQUIRES_USER_INPUT,
      summary: outcome.why,
      detail: { plan, rendered: renderUninstallPlan(plan) },
      userActions: [{
        what: "Confirm each irreversible category by name.",
        how: `--confirm ${plan.irreversible.map((c) => c.category).join(",")}`
      }],
      readiness: READINESS.UNDETERMINED, readinessReason: "Nothing was removed."
    });
  }

  return cliResult({
    operation: "uninstall",
    status: outcome.failed.length ? STATUS.COMPLETED_WITH_WARNINGS : STATUS.COMPLETED,
    warnings: outcome.failed.map((f) => ({ code: "uninstall-remove-failed", message: `${f.path}: ${f.error}` })),
    summary: `${outcome.removed.length} path(s) removed. Preserved: ${outcome.preserved.join(", ") || "nothing"}. ${outcome.unmanagedLeftInPlace} unmanaged file(s) left in place.`,
    detail: { plan, outcome },
    readiness: READINESS.UNDETERMINED, readinessReason: "Removing the tool measures nothing."
  });
}

/* ---------------------------------------------------------- migrations */

export function cmdMigrations({ root = process.cwd(), apply = false, backupDir = null, list = false } = {}) {
  if (list) {
    return cliResult({
      operation: "migrations", status: STATUS.COMPLETED,
      summary: `${MIGRATIONS.length} migration(s) defined.`,
      detail: {
        migrations: MIGRATIONS.map((m) => ({
          id: m.id, kind: m.kind, from: m.from, to: m.to, describe: m.describe, reversible: m.reversible
        })),
        legacyStatus: LEGACY_STATUS,
        unmigratableStatus: UNMIGRATABLE_STATUS,
        deliberatelyAbsent: DELIBERATELY_ABSENT
      },
      readiness: READINESS.UNDETERMINED, readinessReason: "Listing migrations changes nothing."
    });
  }

  const report = migrateTree(root, { dryRun: !apply, backupDir });
  const refusals = report.results.flatMap((r) => (r.refusals ?? []).map((x) => ({ path: r.path, ...x })));

  return cliResult({
    operation: "migrations",
    status: report.checked === 0 ? STATUS.NOT_ATTEMPTED
      : refusals.length ? STATUS.COMPLETED_WITH_WARNINGS
        : STATUS.COMPLETED,
    warnings: refusals.map((r) => ({
      code: "migration-refused",
      message: `${r.path}${r.id ? ` (${r.id})` : ""}: ${r.why}`,
      recommendation: "Left exactly as it is. A migration that cannot be made without guessing is not made."
    })),
    summary: apply
      ? `${report.migrated} file(s) migrated, ${report.checked} checked.`
      : `Dry run. ${report.wouldMigrate} file(s) would be migrated, ${report.checked} checked.`,
    detail: { migrations: report, rendered: renderMigrations(report) },
    userActions: !apply && report.wouldMigrate
      ? [{ what: "Apply them.", how: "Re-run with --apply --backup <dir>; each file is copied before it is touched." }]
      : [],
    readiness: READINESS.UNDETERMINED, readinessReason: "Migrating configuration measures nothing."
  });
}

/* ------------------------------------------------------------- package */

export function cmdPackage({ root = PLUGIN_ROOT, write = false, out = null, verify = false } = {}) {
  const generatedDocs = GENERATED_DOCS;
  const manifest = buildManifest({ root, generatedDocs });

  if (verify) {
    const existing = readManifestAt(root);
    if (!existing) {
      return cliResult({
        operation: "package", status: STATUS.NOT_ATTEMPTED,
        summary: `No ${MANIFEST_FILE} to verify against.`,
        userActions: [{ what: "Create one.", how: "bigaap package --write" }],
        readiness: READINESS.UNDETERMINED, readinessReason: "Nothing was verified."
      });
    }
    const v = verifyManifest(existing, { root });
    const control = controlByteFindings(existing, { root });
    return cliResult({
      operation: "package",
      status: v.ok && !control.length ? STATUS.COMPLETED : STATUS.COMPLETED_WITH_WARNINGS,
      warnings: [
        ...v.modified.map((f) => ({ code: "package-file-modified", message: `${f.path} differs from the manifest` })),
        ...v.missing.map((f) => ({ code: "package-file-missing", message: `${f.path} is missing` })),
        ...control.map((c) => ({ code: "package-control-byte", message: `${c.path}:${c.line} contains a raw ${c.byte}` }))
      ],
      summary: `${v.okCount}/${v.checked} file(s) match. ${v.modified.length} modified, ${v.missing.length} missing, ${control.length} control-byte finding(s).`,
      detail: { verification: v, controlBytes: control },
      readiness: READINESS.UNDETERMINED, readinessReason: "Verifying a manifest measures nothing."
    });
  }

  /* The exclusion check is asserted here rather than trusted, because the
   * manifest is what an install copies: a leak into this list is a leak onto
   * somebody's disk. */
  const leaked = manifest.files.filter((f) =>
    /(^|\/)(node_modules|fixtures|tests|tools|dist)\//.test(f.path) ||
    /\.bigaap-(analyzer|observability)\//.test(f.path) ||
    /target-brief\.json$/.test(f.path) ||
    /\.(png|jpe?g|env|pem|key)$/i.test(f.path));

  if (leaked.length) {
    return cliResult({
      operation: "package", status: STATUS.BLOCKED,
      blockers: leaked.map((f) => ({
        code: "package-excluded-file-included",
        message: `${f.path} is in the manifest but must never be packaged.`,
        userAction: "This is a defect in the exclusion rules in src/install/manifest.mjs. Do not ship this manifest.",
        recaptureResolves: false, impossibleForInputKind: false
      })),
      summary: `${leaked.length} excluded file(s) reached the manifest.`,
      detail: { manifest },
      readiness: READINESS.UNDETERMINED, readinessReason: "No manifest was written."
    });
  }

  let written = null;
  if (write) {
    written = out ? resolve(out) : join(root, MANIFEST_FILE);
    try {
      mkdirSync(dirname(written), { recursive: true });
      writeFileSync(written, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    } catch (error) {
      return cliResult({
        operation: "package", status: STATUS.FAILED,
        errors: [{ code: "package-write-failed", message: `${written}: ${error.code ?? error.message}`, recommendation: "Check write permission." }],
        readiness: READINESS.UNDETERMINED, readinessReason: "No manifest was written."
      });
    }
  }

  return cliResult({
    operation: "package", status: STATUS.COMPLETED,
    artifacts: written ? [{ kind: "package-manifest", path: written }] : [],
    summary: `${manifest.fileCount} managed file(s), ${(manifest.totalBytes / 1024).toFixed(0)} KB. ${manifest.excluded.length} exclusion rule(s) applied.`,
    detail: { manifest: write ? { ...manifest, files: undefined, fileCount: manifest.fileCount } : manifest, written },
    readiness: READINESS.UNDETERMINED, readinessReason: "Building a manifest measures nothing."
  });
}

/**
 * The generated documents, by path.
 *
 * Listed rather than detected: a generated doc is one `tools/generate-command-docs.mjs`
 * owns, and there is no marker in the files themselves that distinguishes them
 * from hand-written ones.
 */
export const GENERATED_DOCS = Object.freeze([
  "docs/COMMANDS.md", "docs/BLOCKERS.md", "docs/CONFIGURATION.md", "docs/PROJECT-STRUCTURE.md",
  "docs/INPUTS.md", "docs/MODES.md", "docs/ARTIFACTS.md", "docs/OUTPUTS.md",
  "docs/PROMPT-CONTRACT.md", "docs/PROMPT-LINT.md", "docs/STACK-ADAPTERS.md",
  "docs/STATUS-CODES.md", "docs/READINESS.md"
]);

/* -------------------------------------------------------- compatibility */

/** Reports whether a specific artifact version can be read. Used by `bigaap version --check`. */
export function cmdCompatibility({ kind = null, version = null } = {}) {
  if (!kind) {
    return cliResult({
      operation: "compatibility", status: STATUS.COMPLETED,
      summary: `${COMPATIBILITY_KINDS.length} versioned artifact kind(s).`,
      detail: { compatibility: COMPATIBILITY },
      readiness: READINESS.UNDETERMINED, readinessReason: "Reporting compatibility measures nothing."
    });
  }

  const check = checkCompatibility(kind, version);
  const bad = check.status === "unsupported" || check.status === "unknown-kind";

  return cliResult({
    operation: "compatibility",
    status: bad ? STATUS.BLOCKED : STATUS.COMPLETED,
    blockers: bad
      ? [{
          code: check.status === "unknown-kind" ? "unknown-artifact-kind" : `incompatible-${check.direction ?? "version"}`,
          message: check.message, userAction: check.userAction,
          recaptureResolves: false, impossibleForInputKind: false
        }]
      : [],
    warnings: check.status === "migratable"
      ? [{ code: "migration-available", message: check.message, recommendation: check.userAction }]
      : [],
    summary: check.message,
    detail: { check },
    readiness: READINESS.UNDETERMINED, readinessReason: "A compatibility check measures nothing."
  });
}

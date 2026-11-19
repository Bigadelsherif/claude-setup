# Installation

Private, controlled use. Node and a checkout are the whole requirement.

**No Docker.** Nothing here uses it, needs it, or is easier with it.

## Quick start

```bash
node bin/helmy.mjs doctor
```

If that prints `Everything this build needs is present`, you are done. Run
`node bin/helmy.mjs help` for the command list.

## What you need

| | |
| --- | --- |
| **Node.js** | `>=18.17`. Checked by `helmy doctor`, and by every command through the same check. |
| **A checkout** | The repository is the installation in the default mode. |
| **Playwright** | Optional. Only live capture needs it. |
| **A browser binary** | Optional, and never downloaded for you. |
| **Docker** | No. |

## The four installation modes

### 1. Repository-local (the default, and the one to use)

```bash
node bin/helmy.mjs doctor
node bin/helmy.mjs help
```

A checkout **is** an installation. `helmy install` reports `not-attempted` here
and copies nothing, because there is nothing to copy — saying "installed 219
files" onto themselves would invite someone to run it.

### 2. As a Claude Code plugin — use the marketplace mechanism

**`helmy install --mode global` does NOT produce a loadable plugin.** It copies
the package and gives you a working CLI, which is useful and is not the same
thing. Claude Code installs plugins from a marketplace.

```bash
claude plugin validate .
claude plugin marketplace add ./ --scope project
claude plugin install helmy-ui-forensics@helmy --scope project
claude plugin details helmy-ui-forensics@helmy
```

Note `./` — a bare `.` is rejected as an invalid source format.

Verified against **Claude Code 2.1.179** on 2026-08-14: all five components
discovered (three commands, one agent, one skill).

**Install from a clean copy.** The loader copies the entire source directory —
1121 files, 47.1 MB from a working checkout here — and consults neither this
repository's package manifest nor its `.gitignore`. Installing from a checkout
you have been analysing in carries your analysis workspaces into the plugin
cache.

To remove:

```bash
claude plugin uninstall helmy-ui-forensics@helmy --scope project
claude plugin marketplace remove helmy --scope project
```

### 2b. Global CLI installation (not a plugin)

```bash
node bin/helmy.mjs install --mode global
node bin/helmy.mjs install --mode global --apply
```

Installs to `~/.claude/plugins/helmy-ui-forensics`. The first command is a dry
run; nothing is written without `--apply`. The result is a CLI you can run with
`node`; Claude Code will not load it as a plugin from there.

### 3. Project-local plugin

```bash
node bin/helmy.mjs install --mode project --apply
```

Installs to `./.claude/plugins/helmy-ui-forensics`, for a project that wants a
pinned copy of its own.

### 4. From a pinned version

There is no registry and no download step. Pin by checking out the revision you
want and installing from it:

```bash
git checkout v0.1.0
node bin/helmy.mjs install --mode global --apply
node bin/helmy.mjs version
```

`helmy version` reports what is actually installed, so a pin can be verified
rather than assumed.

## Installing over an existing installation

Safe, and it will refuse rather than damage anything:

- **Identical file** — skipped. A second install writes nothing at all.
- **A file we installed, unmodified** — replaced.
- **A file that differs from ours** — a **conflict**. Named, preserved, and the
  run exits `blocked` (code 3). Nothing is written.
- **A file placed once** (a target brief) — never touched.

To replace conflicting files anyway:

```bash
node bin/helmy.mjs install --mode global --apply --force --backup ./helmy-backup
```

Every replaced file is copied to `--backup` first. The confirmation covers the
intent; the backup covers the mistake.

## Optional: a browser, for live capture

Everything except live capture works with no browser at all — analysis from
existing captures, validation, prompt generation, corrections, readiness and
packaging.

When you do want to capture a live page:

```bash
npm install
npx playwright install chromium
```

**Neither is run for you.** The second downloads a few hundred megabytes, and a
tool that starts a large download on its own has made a decision that was yours
to make. `helmy doctor` reports a missing browser as a *warning*, never a
blocker, and names what still works.

## Offline

Nothing in the installation path touches the network. There is no fetch, no
download, no registry call, and no shell-out — a test asserts this against the
source of all three installation modules.

Offline, this is what happens:

| | |
| --- | --- |
| `install`, `upgrade`, `repair`, `uninstall` | Work normally. They copy local files. |
| `doctor`, `version`, `package`, `migrations` | Work normally. |
| `npm install` | Fails, as any npm command does offline. Install dependencies while connected. |
| `npx playwright install chromium` | Fails. Download the browser while connected. |
| Live capture | Fails to start, and is reported as a driver blocker with the install command to run. |
| Analysis from existing captures | Works. This is the offline path, and it is the majority of the tool. |

## Troubleshooting

**`helmy doctor` says a directory is missing.** A partial installation. Run
`helmy repair --apply`.

**`helmy doctor` says the version cannot be read.** `package.json` is missing or
unreadable. Nothing can be checked for compatibility against a version that
cannot be read, so this is a blocker rather than a warning. Reinstall.

**Install exits 3.** A conflict, not a crash. The files are intact and the
reason is named. Read the listed paths and decide; re-running unchanged will
refuse identically.

**Install exits 1.** A write failed. **No manifest was written**, so the
installation is marked incomplete rather than looking finished — the next
`helmy repair` will treat it as unverified. Fix the permission and re-run.

**Two versions reported.** `package.json` and `.claude-plugin/plugin.json`
disagree. Both are reported and neither is preferred, because silently
preferring one would make the other permanently wrong. Set them equal.

**A command exists but says "not yet implemented".** Its phase is named in the
message. That is deliberate: `unknown command` reads as *you typed it wrong*.

## Exit codes

| Code | Status | Means |
| --- | --- | --- |
| 0 | `completed` / `completed-with-warnings` | It worked |
| 1 | `failed` | It broke |
| 3 | `blocked` | A gate refused; nothing was damaged |
| 4 | `cancelled` | Stopped deliberately |
| 5 | `not-attempted` | There was nothing to do |
| 6 | `requires-user-input` | Waiting on a decision only you can make |

A CI job that retries on 1 must not retry a 3: it will refuse identically.

## Related

- [UPGRADE.md](UPGRADE.md) — upgrading, and what migrates
- [UNINSTALL.md](UNINSTALL.md) — what is removed, what is kept
- [REPAIR.md](REPAIR.md) — verifying an installation
- [PACKAGING.md](PACKAGING.md) — what ships and what never does
- [VERSIONING.md](VERSIONING.md) — every version this build declares
- [COMPATIBILITY.md](COMPATIBILITY.md) — what this build can read
- [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md) — what this tool does not do

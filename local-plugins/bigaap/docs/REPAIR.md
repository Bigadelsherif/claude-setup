# Repair and verify

```bash
node bin/bigaap.mjs repair
node bin/bigaap.mjs repair --apply
node bin/bigaap.mjs repair --apply --force --backup ./bigaap-backup
```

## What repair checks

Every managed file is hashed against the manifest, with four outcomes — separate
problems needing separate remedies:

| State | Means | Repair's action |
| --- | --- | --- |
| `ok` | The hash matches | Nothing |
| `missing` | Gone | **Restores it** with `--apply` |
| `modified` | The hash differs — somebody edited it | **Reports it. Never overwrites without `--force`** |
| `unreadable` | There, but cannot be hashed | Reports it |

Plus:

- the command catalog and every command's documentation
- the schemas
- the generated documents
- the required directory layout
- `.claude-plugin/plugin.json` — without it Claude Code will not load the plugin
- the entrypoint's **readability** (not its executable bit — see below)
- runtime availability
- Playwright package availability
- **raw control bytes in managed sources**

## The rule

> **Repair never overwrites a modified file without confirmation.**

This build cannot tell a deliberate edit from a corruption. A modified managed
file is reported with its path and left alone, and the command exits
`requires-user-input` (code 6) — not `blocked`, because nothing refused it on
the evidence; the tool is waiting for a person to say whether their edit should
survive, and only a person can answer that.

```
repair: requires-user-input
  warn  repair-file-modified: docs/OUTPUTS.md: modified since installation — left alone.
        Keep your edit, or re-run with --force to restore the managed version.
```

`--force` restores it and **backs up your version first**.

## Control bytes

Repair reports any raw control byte — anything below `0x20` that is not tab, LF
or CR — in a managed `.mjs`, `.json` or `.md` file.

This is not cosmetic. A literal `0x08` where `\b` belonged turned the regex
`/\bimport\s*\(/` into `/<BS>import\s*\(/`, a pattern that cannot match any real
source file. The assertion using it had been passing vacuously since it was
written, and the property it was meant to guarantee — that the no-browser
preflight module cannot reach a browser through a dynamic import — was
unprotected the whole time. That is [def_0038](../defects/def_0038.json).

## Executable permissions

Checked as **readability**, not as the executable bit.

On Windows the bit does not exist; on POSIX the entrypoint is invoked through
`node` by the package `bin` shim, so a missing `+x` is not what would break it.
Checking a permission that does not govern the behaviour would produce a warning
nobody can act on.

## What repair does not do

**It does not install anything.** A missing runtime and a missing browser are
reported with the command to run, never run for you. Both are large,
network-bound actions that must be your explicit choice.

**It does not fix a repository checkout's own files from itself.** In a checkout
the source and the destination are the same file, so there is nothing to restore
from. Repair reports this rather than pretending:

```
  repair-failed: src/ir/derive.mjs: no source copy is available to restore from
```

Use git there — that is what it is for.

## bigaap doctor

`doctor` answers *can this build do the work?* without doing any of it.

```bash
node bin/bigaap.mjs doctor
```

**No browser is launched.** That constraint is the design: the most common
reason to run doctor is that something is already wrong, and a diagnostic that
starts a browser to tell you the browser is missing hangs precisely when you
needed an answer.

Browser presence is a filesystem question with **three** answers:

| | |
| --- | --- |
| `true` | A Chromium was found where Playwright installs one |
| `false` | Nothing was found — a **warning**, with the install command |
| `null` | Could not determine — reported as *unknown* |

Reporting the third as `false` would send people to reinstall a browser they
already have.

Even `--allow-browser-launch` does not launch one. This build implements no
launch-based check, and says so rather than silently doing nothing.

### Doctor's states

| State | Meaning | Exit |
| --- | --- | --- |
| `ok` | Everything needed is present | 0 |
| `warning` | Usable, with limits. A missing browser is here | 0 |
| `unknown` | A check could not determine its answer. Not a failure | 0 |
| `blocking` | Something is missing the tool cannot work without | 3 |

A missing browser is never blocking. Doctor names what still works without one:
analysis from existing captures, validation, prompt generation, corrections,
readiness and packaging.

## Related

- [INSTALLATION.md](INSTALLATION.md)
- [PACKAGING.md](PACKAGING.md) — the manifest repair verifies against
- [UPGRADE.md](UPGRADE.md)

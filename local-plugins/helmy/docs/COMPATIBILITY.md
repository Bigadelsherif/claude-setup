# Compatibility

What this build will read, and what it refuses.

```bash
node bin/helmy.mjs version --check correction-record --version 0
```

## The readable set

| Kind | Writes | Reads | Migrates from |
| --- | --- | --- | --- |
| `project-config` | 1 | 1 | — |
| `target-brief` | 1 | 1 | — |
| `observability-config` | 1 | 1 | — |
| `observability-event` | 1 | 0, 1 | 0 |
| `correction-record` | 1 | 0, 1 | — |
| `artifact-metadata` | 1 | 1 | — |
| `ir` | 0.1.0 | 0.1.0 | — |
| `evidence` | 0.1.0 | 0.1.0 | — |

A version in `read` but not `migrates from` is readable as-is and needs no
migration — the common and preferable case.

## Four outcomes

| Status | Meaning | Action |
| --- | --- | --- |
| `compatible` | Open it | none |
| `migratable` | Readable, but a migration should run | `helmy migrations --apply` |
| `unsupported` | Refused, with a direction | see below |
| `unknown-kind` | Not a versioned kind this build knows | check the name |

## Refusals name a direction

"Newer than this build" and "older than this build" need **opposite** actions,
and a single `incompatible` would leave you to guess which.

**Newer:**

```
project-config version 99 is newer than this build writes (1) and is not in its
readable set (1).

  Upgrade helmy. This build must not guess at a shape it has never seen —
  doing so would read a field as something it is not.
```

**Older, with no migration:**

```
correction-record version -1 is older than anything this build reads (0, 1).

  No migration exists from -1. Re-create the file with `helmy init`, which
  preserves the existing one and reports the conflict.
```

Never a parse error. "Unexpected token" tells a user their file is broken; it is
not — it is simply newer or older than this build.

An incompatible version is `blocked` (exit 3) or `requires-user-input` (exit 6),
never a crash.

## An absent version is not a refusal

Read as the **earliest readable** version for its kind. Files predating
versioning exist, and refusing them would strand exactly the records this phase
preserves.

An unversioned correction record is read as version 0 and marked as such — see
[UPGRADE.md](UPGRADE.md).

## IR compatibility

One IR schema version, `0.1.0`. Nothing migrates to or from it because there is
nothing to migrate between.

When a second version exists, its migration belongs in `src/install/migrate.mjs`
alongside the others. Until then the slot is empty and **documented as empty** —
a no-op migration would imply a coverage that does not exist.

## Migration compatibility

Every migration is:

- **versioned** — an id, a `from` and a `to`
- **deterministic** — a pure function of its input; no clock, no filesystem
- **idempotent** — each `detect` tests for the absence of what its `apply` adds
- **logged** — every change is listed by name
- **reversible where practical** — 6 of 8 are; the other two say why not
- **non-destructive** — `--backup` copies each file before it is touched
- **tested against real fixtures**

## Claude Code integration

Discovered through `.claude-plugin/plugin.json`, which declares `commands`,
`agents` and `skills` directories. No minimum Claude Code version is declared,
because none is known to be required — the plugin uses the documented directory
layout and nothing version-specific.

`helmy doctor` reports a missing `plugin.json` as a **blocker**: without it the
commands and skill will not load, and every other check passing would be
misleading.

## Driver availability

| | |
| --- | --- |
| Playwright package | Optional. `helmy doctor` warns if absent |
| Browser binary | Optional. Warned about, **never downloaded for you** |
| Docker | Not required, not used |

Everything except live capture runs with no browser at all.

Browser presence is answered from the filesystem, with three outcomes —
including `could not determine`, which is reported as *unknown* rather than as
*no*, so nobody is sent to reinstall a browser they already have.

## Runtime

Node `>=18.17`. A version below it is a **blocker**; an unparseable version
string is **unknown**, not a failure.

## Related

- [VERSIONING.md](VERSIONING.md)
- [UPGRADE.md](UPGRADE.md)
- [INSTALLATION.md](INSTALLATION.md)

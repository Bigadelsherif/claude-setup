# Upgrade

```bash
node bin/bigaap.mjs upgrade --mode global
node bin/bigaap.mjs upgrade --mode global --apply --backup ./bigaap-backup
```

Dry run by default. An upgrade that surprises you has already run.

## What an upgrade does

| Category | Behaviour |
| --- | --- |
| Managed source, schemas, commands, docs | **Replaced** |
| A file placed once — your target brief | **Preserved**, always |
| A generated document | **Regenerated**, not copied |
| A file you edited | **Conflict.** Named, preserved, exit 3 |
| Project configuration | **Migrated**, additively |
| Evidence, IR, captures | **Untouched** |
| Correction history | **Untouched** except for an additive version marker |
| Observability events | **Untouched** |

## What it refuses

**A downgrade.** Installing older code over a newer installation leaves files
the older build cannot read:

```
upgrade: blocked
  BLOCKED upgrade-would-downgrade: the installation is 0.3.0 and this build is 0.2.0
```

`--force` permits it. It is refused by default because the user asking for it
usually means something else.

**Adopting files it did not install.** If a directory holds files but no
manifest, the upgrade reports `requires-user-input` rather than treating them as
an old installation. Something is there; this build does not know what.

**Replacing your edits.** Same conflict rule as install: named, preserved, exit 3.

## Migrations

```bash
node bin/bigaap.mjs migrations --list
node bin/bigaap.mjs migrations
node bin/bigaap.mjs migrations --apply --backup ./bigaap-backup
```

### The rule

> **A migration may add. It may rename. It must never reinterpret.**

Renaming is safe because the value survives. Reinterpreting is not: if an old
build wrote `status: "ok"` meaning *the command finished*, and this build reads
`completed` as *finished AND produced usable evidence*, then migrating one to
the other silently upgrades a claim nobody made.

### What migrates

| Migration | Kind | Reversible |
| --- | --- | --- |
| `m001` | Adds `schemaVersion` to an unversioned project.json | yes |
| `m002` | Replaces the fabricated `bigaapVersion` `0.0.0` with null | no |
| `m003` | Adds `configVersion` to an observability config | yes |
| `m004` | Marks an unversioned correction record as version 0 | yes |
| `m005` | Adds a canonical id beside a bare-numeric correction id | yes |
| `m006` | Adds `metadataVersion` to an artifact metadata block | yes |
| `m007` | Renames an unambiguous legacy status word | yes |
| `m008` | Reports an unstamped output artifact (does not rewrite it) | n/a |

Every migration is **deterministic** — a pure function of its input, consulting
no clock and no filesystem — and **idempotent**: each `detect` tests for the
absence of what its `apply` adds, so running one over its own output is a no-op.
Each is **logged**, each writes a **backup** first when `--backup` is given, and
none is **destructive**.

### Legacy status vocabulary

Renamed, because each old word had exactly one meaning:

| Old | New |
| --- | --- |
| `ok`, `success`, `done` | `completed` |
| `warn`, `warning` | `completed-with-warnings` |
| `refused` | `blocked` |
| `skipped` | `not-attempted` |
| `aborted` | `cancelled` |
| `needs_input`, `needs-input` | `requires-user-input` |

The original is kept as `$legacyStatus`, so the rename is reversible.

**Refused, by name:**

| Word | Why not |
| --- | --- |
| `error` | Used for both `failed` and `blocked` by different callers. Choosing one fabricates the distinction the result contract exists to preserve. |
| `fail` | Same ambiguity. |
| `incomplete` | Used for both `cancelled` and `requires-user-input`, which need opposite actions. |

These are reported as warnings and the file is left exactly as it is.

### Correction ids

A bare-numeric id gets a `canonicalId` **beside** it. The original `id` is
unchanged and remains the reference — a correction is referenced by id from
history, from artifact metadata and from your own notes, and rewriting it would
break every one of those to satisfy a formatting preference.

### Migrations that deliberately do not exist

Recorded, because an absent migration looks identical to a forgotten one.

| What | Why not |
| --- | --- |
| Evidence entries | Evidence records what was measured. It does not become false when the tool changes. |
| Correction record content | A correction says what someone believed on a date. Only additive version markers are applied. |
| Provenance status | Every mapping between `measured`/`observed`/`inferred`/`estimated`/`unknown` is a change of meaning. Promoting `inferred` to `observed` would credit an old run with evidence it never had. |
| `error` and `fail` | See above. |
| IR structure | There is one IR schema version. An empty slot is more honest than a no-op implying coverage. |

`bigaap migrations --list` prints all of this, including the absences.

## Upgrading a repository checkout

Pull, then migrate any project that needs it:

```bash
git pull
node bin/bigaap.mjs migrations --apply --backup ./bigaap-backup
node bin/bigaap.mjs doctor
```

`bigaap upgrade` reports `not-attempted` for a checkout, because updating a
checkout is git's job.

## Related

- [INSTALLATION.md](INSTALLATION.md)
- [COMPATIBILITY.md](COMPATIBILITY.md) — which versions this build reads
- [VERSIONING.md](VERSIONING.md)

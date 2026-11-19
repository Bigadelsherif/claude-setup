# Data retention

An unbounded local log is a disclosure risk that grows on its own. Everything below exists
to keep the store small enough that its existence stays a considered decision rather than
an accumulating liability.

## The limits

| Limit | Default | What it does |
| --- | --- | --- |
| `retentionDays` | 30 | Rotated files older than this are removed |
| `maxTotalBytes` | 5 MB | Oldest-first removal once the store exceeds it |
| `maxFileBytes` | 512 KB | The current file rotates when it grows past this |
| `maxFiles` | 20 | Enforced: once more than this many rotated files exist, the oldest are removed |

## Rotation renames; it never truncates

When the current file passes `maxFileBytes` it is **renamed** to `events.0001.jsonl` and a
new current file starts. Every event it held survives the rename.

Rotation is checked *after* a write, so an event is never lost to the size limit it was
the one to cross.

## Nothing is deleted silently

Retention returns a report naming every file it removed and why:

```
events.0001.jsonl — older than 30 day(s)
events.0002.jsonl — total size 6291456 exceeded the 5242880-byte limit
```

An event that vanishes without a trace is indistinguishable from one that was never
written, which would defeat the point of keeping any. The result carries
`everyRemovalReported: true` so a caller can assert it rather than trust it.

Run it on demand:

```bash
bigaap telemetry retention
```

## `maxFiles` is enforced, not advisory

It was documented as advisory while nothing read it. It is now applied in
`applyRetention` alongside the other three limits, oldest-first, and each removal is
reported with `more than N rotated file(s) were kept` as its reason.

A setting that appears in `telemetry status` while being silently ignored is worse than an
absent one: it tells the reader a bound is in force when no bound is in force. Every
setting the status command prints is now either enforced or labelled as not enforced.

## Order of removal

1. **Age first** — anything older than `retentionDays`.
2. **Then size** — oldest-first among what survived, until the total is under
   `maxTotalBytes`.

The **current** file is never removed by retention. It is the one being written to, and
removing it would lose the events most likely to explain whatever you are looking at.

## Corruption does not cascade

A corrupt line costs that line. The reader reports `{ file, line, why }` and continues,
and the file is left in place rather than repaired — a diagnostic store that rewrites
itself is not a record.

Nothing about a corrupt event file can affect the analysis workspace: the store lives in
`.bigaap-observability/`, outside it, for exactly this reason.

## Schema migration

Events carry a `schemaVersion`. On read:

- **Older** — migrated forward, filling new fields with `null` and derivable ones (like
  duration buckets) from what is there. `$migratedFrom` records where it came from.
- **Current** — untouched.
- **Newer** — **left unchanged**, not downgraded. Rewriting an event written by a later
  build would be the append-only store editing history to tidy up.

An event that cannot be migrated is kept and reported, never dropped.

## Clearing

```bash
bigaap telemetry clear --confirm
```

Removes every event file **and the salt**. Losing the salt means hashes in any earlier
export can no longer be grouped — by you or by anyone else. That is the property that
makes clearing meaningful rather than local housekeeping.

Without `--confirm`, nothing is removed and the command lists what it would.

## What retention does not do

- It does not aggregate, summarise or roll up before deleting. Summarising would keep a
  derived record of data you asked to be removed.
- It does not archive elsewhere. Removed means removed.
- It does not run automatically on a schedule. It runs on write and on demand, because a
  background process deleting your diagnostics unprompted is its own surprise.

## Related

- [PRIVACY.md](PRIVACY.md) — what is never recorded
- [OBSERVABILITY.md](OBSERVABILITY.md) — what an event carries
- [TELEMETRY.md](TELEMETRY.md) — the commands

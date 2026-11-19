# `helmy telemetry`

The command is called `telemetry` even though nothing here transmits.

That is deliberate. `telemetry` is the word people search for when they want to know what
a tool is collecting, and a tool that hides its local recording behind a friendlier name
has made itself harder to audit. `status` says *"no remote upload"* in as many words,
which is a stronger statement than an absent command.

## `helmy telemetry status`

The default verb. Answers *what does this tool know about me?*

```
Local observability is OFF. No events are being recorded.

Storage:            /path/to/project/.helmy-observability
Events:             0
Files:              0
Size:               0 B of 5.0 MB
Retention:          30 day(s)
Redaction:          high
URL origins:        not recorded
Diagnostic export:  not allowed
Remote upload:      never — this build has no upload path
Event schema:       v1
Last event:         none

Never recorded, at any setting:
  - screenshot
  - html
  …
```

## `helmy telemetry enable`

```bash
helmy telemetry enable                      # high redaction, no origins, no export
helmy telemetry enable --redaction balanced # keep origins instead of hashes
helmy telemetry enable --record-origins     # record which sites were analysed
helmy telemetry enable --allow-export       # permit diagnostic export
```

Enabling recording does **not** enable export, and does not lower redaction. Each is a
separate decision, and defaults never widen when you turn something on.

`--record-origins` returns a `NEEDS YOU` note saying plainly that origins identify which
sites were analysed. It is a real privacy decision and the output treats it as one.

## `helmy telemetry disable`

Stops recording. **Does not delete** — and the result says so, naming how many events
remain and how to remove them. Disabling and deleting are different intentions.

## `helmy telemetry inspect`

```bash
helmy telemetry inspect --limit 100
```

Every byte the tool kept, readable without a JSON viewer. Corrupt lines are reported as
warnings; the rest of the store is unaffected.

## `helmy telemetry clear --confirm`

Removes every event **and the salt**. The salt going too is what makes clearing
meaningful: without it, hashes in any previously-exported diagnostic become permanently
ungroupable rather than merely deleted from this machine.

Without `--confirm` it returns `requires-user-input` (exit 6) and removes nothing.

## `helmy telemetry export --to <path> --confirm`

Two gates, both deliberate:

1. **Permission** — `diagnosticExportAllowed` must be on. Willingness to keep local
   diagnostics is a different decision from willingness to hand them to somebody.
2. **Confirmation** — `--confirm` at the call.

Without permission: `blocked` (exit 3). Without confirmation: `requires-user-input`
(exit 6). Neither writes a file.

The bundle declares what it contains and what it excludes, carries the redaction rules,
and states that the salt is local so its hashes cannot be correlated with another
project's.

**The bundle is written to a path you choose. Nothing is transmitted; sharing it is your
action.**

## `helmy telemetry retention`

Applies the age and size limits now rather than waiting for the next write. Every removal
is listed with its reason — retention never removes anything silently.

## What fills the store

Nothing, until a command runs with observability enabled. From then on, every fidelity
command emits a start and an end event, readiness emits an evaluation, driver failures and
recovery attempts emit their own, and the correction commands emit at proposal, apply and
rejection. [OBSERVABILITY.md](OBSERVABILITY.md) has the table of what each one carries and
what it leaves out.

`helmy telemetry inspect` reads the store back with the same redaction that wrote it, so
what you see in `inspect` is what is on disk — there is no unredacted view, including for
you.

## Exit codes

| Situation | Status | Exit |
| --- | --- | --- |
| Any status/inspect/enable/disable | `completed` | 0 |
| Corrupt lines found while inspecting | `completed-with-warnings` | 0 |
| Export without permission | `blocked` | 3 |
| Unknown verb | `failed` | 1 |
| Clear or export without `--confirm` | `requires-user-input` | 6 |

## Related

- [PRIVACY.md](PRIVACY.md) — the boundary
- [OBSERVABILITY.md](OBSERVABILITY.md) — what an event carries
- [DATA-RETENTION.md](DATA-RETENTION.md) — how long anything lives
- [STATUS-CODES.md](STATUS-CODES.md) — every status and exit code

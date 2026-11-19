# Observability

Local diagnostics, so that real usage can reveal what code review cannot: which blockers
actually fire, which driver errors actually happen, whether recovery works, where the
time goes, which corrections get refused.

**Local only. Off by default. Nothing is transmitted** — see [PRIVACY.md](PRIVACY.md).

## What an event carries

Chosen by subtraction: start from "what would make this diagnosable", remove everything
that describes the page rather than the analysis, and what remains is shapes.

| | |
| --- | --- |
| Identity | event id, schema version, timestamp, event class |
| Context | command, mode, project id, workspace id, source kind, viewport, state |
| Outcome | status, duration, duration bucket, timeout category, retry count |
| Evidence | coverage ratio, confidence *summary* (counts and a range — never per-category) |
| Codes | blocker codes, warning codes, driver error category |
| Artifacts | kinds and hashes |
| Corrections | id, category, scope, review status, promotion status, validation outcome, before/after hashes |
| Defects | id, severity, module, status, recurrence, regression-test status |
| Versions | extractor, driver, tolerance, policy |
| Privacy | the classification applied when it was written |

An event can tell you that captures against one origin time out twice as often as
another. It cannot tell you what either page said.

**Codes, never messages.** A blocker's `code` is the diagnosable part; its `message` may
quote a selector or a heading. Only the code is recorded.

**Confidence as a shape.** Counts of measured and unmeasured categories plus a range. The
per-category numbers are a fingerprint of a specific page, so they are summarised rather
than stored.

## The fifteen event classes

`command-started` · `command-completed` · `command-blocked` · `command-failed` ·
`command-cancelled` · `browser-operation-failed` · `recovery-attempted` ·
`artifact-generated` · `artifact-invalidated` · `correction-proposed` ·
`correction-accepted` · `correction-rejected` · `correction-blocked` · `defect-detected` ·
`readiness-evaluated`

## Timing

Eleven operations are timed: preflight, capture, extraction, evidence building, IR
derivation, projection, validation, prompt linting, correction preview, correction apply,
export.

Durations are recorded as both a figure and a **bucket**. The bucket is what makes events
comparable, and it is what matters in an export — a precise duration on a specific
workspace is closer to identifying than it looks.

An unknown operation name throws at the call site. A typo in a metric is a metric that
silently never appears.

## Commands cannot build events

Commands call helpers in `src/observe/record.mjs`, which build well-formed events from
data the command already has — a `cliResult`, a correction record, a defect. A command
that cannot construct an arbitrary event cannot record an arbitrary value, and the set of
things that *can* be recorded is exactly the set of fields those helpers read.

## Recording never breaks a command

Every helper swallows its own errors. Diagnostics that can break the thing they are
diagnosing are worse than no diagnostics — a failed write must never turn a completed
analysis into a failed command.

## Where it lives

`.helmy-observability/`, deliberately **outside** the analysis workspace. That separation
means a corrupt event file cannot damage evidence, and a workspace copied or shared does
not carry diagnostics with it.

```
.helmy-observability/
  config.json        the settings
  salt               the per-project hashing salt
  events.jsonl       the current append-only log
  events.0001.jsonl  rotated
```

## Which workflows emit, and what each one leaves out

Instrumentation is at **choke points**, not at call sites. Every fidelity command runs
through one wrapper in `bin/helmy.mjs`, so a new command is observable the day it is
added and cannot be observable in a way its author invented.

| Workflow | Events | What it deliberately excludes |
| --- | --- | --- |
| Any fidelity command | `command-started`, then one of `command-completed` / `-blocked` / `-failed` / `-cancelled` | The URL, the brief, the target. Blockers and warnings by **code**; their messages can quote a heading or name a selector |
| Readiness evaluation | `readiness-evaluated` | Per-category confidence numbers — a table of twelve figures fingerprints one page. A count and a range instead |
| Capture and driver work | `browser-operation-failed` | The failing selector, the navigation URL, the driver's own message. The error *category*, the viewport, the timeout kind |
| Recovery | `recovery-attempted`, one per attempt | Everything above, plus what recovery actually did to the page |
| Artifact generation | `artifact-generated`, `artifact-invalidated` | The artifact's contents and its filename. The **kind** and the content **hash** |
| Correction proposal | `correction-proposed` | The correction's text, the claim's value, the user's reasoning. The category and the scope |
| Correction apply | `correction-accepted` / `-blocked` | The diff. Counts of affected artifacts, the before and after IR hashes |
| Correction rejection | `correction-rejected` | The rejection reason as written |
| Defects | `defect-detected` | Reproduction steps. The id, module, severity and whether a regression test exists |

Three properties hold across all of them:

**Codes, never messages.** Every axis — blockers, warnings, errors — is recorded as a
list of codes. A code is a value this codebase chose; a message can contain whatever the
page or the driver put in it.

**Enums are clamped before they are recorded.** `mode` comes from `--for`, so an
unrecognised value is *whatever the user typed*. It is recorded as `invalid`. A field that
readers treat as a fixed set must actually be a fixed set, or it is a free-text channel
wearing an enum's name.

**Counts, never lists.** `viewportCount` and `stateCount` are numbers. The lists they
count can carry a state name derived from a selector.

### Errors, when `verboseErrors` is on

`verboseErrors` adds exactly two fields: `errorClass` (the exception's constructor name)
and `stackDepth` (how many lines the stack had). Never the message, never a frame — a
frame carries an absolute path and a message can echo page text. The class and the depth
distinguish a `TypeError` five frames deep from one fifty frames deep, which is the part
that was ever diagnostic.

## Corruption is line-isolated

One unparseable line costs that line. The reader reports it and keeps going, because a
diagnostic store that becomes unreadable at the first bad byte fails exactly when
something has gone wrong — which is the only time anybody reads it.

## Configuration

| Setting | Default | Note |
| --- | --- | --- |
| `enabled` | `false` | Off until you say otherwise |
| `redactionLevel` | `high` | URLs hashed |
| `recordUrlOrigins` | `false` | A real privacy decision; yours to make |
| `diagnosticExportAllowed` | `false` | Separate from recording |
| `retentionDays` | `30` | Bounded |
| `maxTotalBytes` | `5 MB` | Bounded |
| `maxFiles` | `20` | Enforced: rotated files beyond it are removed, newest kept |
| `verboseErrors` | `false` | Enforced: adds error class and stack depth only, never a message or a frame |
| `remoteUpload` | `false` | Not a setting. Reported so the absence is visible |

Project policy can only ever **narrow**. A project that forbids observability is not
overridden by a user preference that wants it.

## Limitations

- Events describe the analysis, not the page. They cannot explain *why* a specific
  selector failed — only that selector-not-found occurred, at which viewport, how often.
- The store is per-project by design, so cross-project patterns are invisible. That is the
  same property that stops two exports being correlated.
- Nothing is aggregated, ranked or scored. There is no dashboard and this phase adds none.

## Related

- [PRIVACY.md](PRIVACY.md) — what is never recorded, and why
- [TELEMETRY.md](TELEMETRY.md) — the commands
- [DATA-RETENTION.md](DATA-RETENTION.md) — rotation, retention and clearing

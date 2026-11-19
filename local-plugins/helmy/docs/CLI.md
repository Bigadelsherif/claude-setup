# The CLI

How `helmy` behaves, as opposed to what each command does. For the per-command
reference see [COMMANDS.md](COMMANDS.md), which is generated from the catalog;
for the blocker codes see [BLOCKERS.md](BLOCKERS.md).

---

## The shape of every invocation

```bash
helmy <command> [options]
helmy help [command]
```

Every command returns the same typed result and exits on its own code. There is
no command that prints a number and leaves you to interpret it.

---

## Statuses and exit codes

| Code | Status | Means | What to do |
| --- | --- | --- | --- |
| 0 | `completed` | The work was done. | Read the artifacts. |
| 0 | `completed-with-warnings` | Done, with something recorded beside it. | Read the warnings; they are not noise. |
| 1 | `failed` | The work broke, or an input was malformed. | Fix the input, or file a defect. |
| 3 | `blocked` | A gate refused it. Evidence is intact; the reason is recorded. | Resolve what the blocker names. |
| 4 | `cancelled` | Stopped deliberately. | Nothing. |
| 5 | `not-attempted` | There was nothing to do. | Check you meant to run it. |
| 6 | `requires-user-input` | Waiting on something only you can supply. | Supply it. Retrying will not help. |

### Why these are separate

**`blocked` is not `failed`.** A blocked run has correct evidence and a reason;
treating it as a crash throws that evidence away. A CI job that retries on `1`
must not retry a run a safety gate refused, because the retry is refused
identically and the reason scrolls past twice.

**`requires-user-input` is not `not-attempted`.** `not-attempted` says there was
nothing to do. A missing target brief is not nothing to do — it is work waiting
on an answer, and reporting it as `not-attempted` sends the user looking
elsewhere for a problem that is in front of them.

**`requires-user-input` is not `blocked` either.** No amount of recapturing
produces a target brief. Only a person does.

### The contract enforces this

A result is refused at construction if it cannot be acted on:

- `blocked` with no blocker
- `failed` with no error
- `requires-user-input` with no stated user action
- `not-attempted` with no explanation of why work did not begin
- `completed` carrying a blocker or an error

These are thrown, not logged. A result that reaches a user must be actionable.

---

## The result contract

Every command emits the same fields, present whether or not they apply — an
absent field and a null field read differently, and a consumer should not have
to guess which it is looking at.

```
resultVersion  operation  status  reference  target  viewport  state  mode
artifacts  hashes  warnings  blockers  errors  recoveryHistory  userActions
readiness  readinessReason  summary  detail  exitCode  producedAt
```

`--json` emits the contract verbatim. Without it you get a human summary; with
it you get the thing to parse. A consumer that parses the prose will eventually
parse it wrong.

### `readiness` is not `status`

They answer different questions. `status` is what happened to this invocation.
`readiness` is what the evidence now licenses. **A comparison can complete and
still license nothing**, and the two fields say so independently.

---

## Preflight before work

`helmy blockers` reports what would stop a mode without running it, and
**without launching a browser**. That is a contract, not an optimisation: a
preflight that captures is not a preflight.

```bash
helmy blockers --workspace ./ws --for recreate
```

The mode workflows run the same preflight before doing anything, so a run that
cannot succeed says so before it costs a capture.

Each blocker carries six fields, and two of them decide what you do next:
`recaptureResolves` and `impossibleForInputKind`. The second is the one that
saves time — it distinguishes "capture again and it will work" from "no capture
of any kind will fix this".

---

## Modes

Five analysis modes: `analyze`, `recreate`, `adapt`, `extend`, `improve`.

`adapt` and `extend` describe what a **different** product should do, so they
require a target brief. **Nothing here will invent one.** A missing brief is
`requires-user-input`; a malformed one is `failed` with each schema violation
named.

A mode is refused, never downgraded silently. If `recreate` is unavailable, the
run says which requirement failed — it does not quietly produce `analyze` output
and let you assume.

---

## Artifacts

Generated files are **projections**, never sources. Each carries the IR hash it
was projected from.

Editing one is unsupported and detectable: `helmy verify` fails on a hash
mismatch. To change a claim, file a correction against the evidence and
regenerate.

Artifacts a mode does not support are not written, and stale ones from a
previous mode are pruned and reported.

---

## What the CLI will not do

- **Authenticate.** No command accepts credentials. No command bypasses a
  consent gate, a CAPTCHA or a bot check. A scope decision, not a gap.
- **Apply a correction to your components automatically.** A permanent
  limitation (`def_0030`). Tasks are instructions for a person.
- **Run unattended.** Built for an operator reading results; the run directory
  is not concurrency-safe.
- **Tell you one number.** There is no composite score and no overall readiness
  verdict, by construction and by audit.

---

## Reading output honestly

Three things worth internalising, because the output is designed around them:

1. **A `null` score means no evidence**, not zero. Zero would be a claim of
   total disagreement, which is much stronger than "we did not look".
2. **A score is a measurement, not a verdict.** No measured tolerance is
   validated; two of seventeen calibrated entries are, and both are finite
   policies rather than numeric thresholds.
3. **Confidence is provenance × coverage, reported as a pair.** They are never
   multiplied into one number, because a confident reading of a small sample and
   a hesitant reading of a large one are different situations.

---

## Further reading

| Document | What it covers |
| --- | --- |
| [WORKFLOWS.md](WORKFLOWS.md) | The twelve steps a mode command runs, and what can stop it at each |
| [INPUTS.md](INPUTS.md) | The five resolution layers, and what configuration may never resolve |
| [MODES.md](MODES.md) | What each mode requires, and what it refuses outright |
| [INTERACTIVE.md](INTERACTIVE.md) | Prompting, defaults, and cancellation |
| [READINESS.md](READINESS.md) | Can I do this, and if not what do I do next |
| [STATUS-CODES.md](STATUS-CODES.md) | Every status, exit code, requirement state and limitation kind |
| [VERIFY.md](VERIFY.md) | Whether what is on disk is still trustworthy |
| [RECOVERY.md](RECOVERY.md) | What the capture actually did, attempt by attempt |
| [TASKS.md](TASKS.md) | Correction tasks, and why every one is manual |
| [CORRECTIONS.md](CORRECTIONS.md) | Filing a correction, and what one may never do |
| [CORRECTION-REVIEW.md](CORRECTION-REVIEW.md) | The preview and the apply pipeline |
| [CORRECTION-SCOPES.md](CORRECTION-SCOPES.md) | How far a correction reaches |
| [PROMOTION.md](PROMOTION.md) | When a correction may become a rule |
| [PRIVACY.md](PRIVACY.md) | What is never recorded, and why |
| [OBSERVABILITY.md](OBSERVABILITY.md) | Local diagnostics: what an event carries |
| [TELEMETRY.md](TELEMETRY.md) | The `helmy telemetry` commands |
| [DATA-RETENTION.md](DATA-RETENTION.md) | Rotation, retention and clearing |
| [PROMPTS.md](PROMPTS.md) | How a claim becomes prompt text, and what keeps it honest |
| [PROMPT-CONTRACT.md](PROMPT-CONTRACT.md) | The four prompt contracts, section by section |
| [PROMPT-LINT.md](PROMPT-LINT.md) | Every lint rule, its severity, and whether it blocks |
| [STACK-ADAPTERS.md](STACK-ADAPTERS.md) | The implemented adapter, and what it cannot express |
| [ARTIFACTS.md](ARTIFACTS.md) | Every generated artifact, and the rules governing it |
| [OUTPUTS.md](OUTPUTS.md) | What each mode produces, and what a blocked run leaves behind |
| [FRESHNESS.md](FRESHNESS.md) | How staleness is detected, and why nothing regenerates silently |
| [EXPORTS.md](EXPORTS.md) | What may leave a run directory, and what may not |
| [COMMANDS.md](COMMANDS.md) | Every command, option and exit code |
| [BLOCKERS.md](BLOCKERS.md) | Every blocker code and its remedy |
| [CONFIGURATION.md](CONFIGURATION.md) | Project configuration files and their schemas |
| [PROJECT-STRUCTURE.md](PROJECT-STRUCTURE.md) | What `helmy init` creates |

`READINESS.md`, `STATUS-CODES.md`, `PROMPT-CONTRACT.md`, `PROMPT-LINT.md`,
`STACK-ADAPTERS.md`, `ARTIFACTS.md`, `OUTPUTS.md` and the last four are generated from the code by
`node tools/generate-command-docs.mjs`, and a check asserts they are current.

# Interactive runs

Prompting is **opt-in and conditional**. A mode command asks questions only when both of
these are true:

1. You passed `--interactive`, and
2. stdin and stdout are both terminals.

Either one alone is not enough. `--interactive` in a pipeline would otherwise deadlock
the pipeline: a question written to a pipe has nobody to answer it, and the run would
wait forever on input that is never coming. When you ask for prompting and there is no
terminal, the run does not hang and does not silently guess — it returns
`requires-user-input` (exit 6) listing what it would have asked, with
`detail.interactive: false` recording why it did not ask.

## Which stream the questions go to

Questions are written to **stderr**, never stdout.

The same command may be run with `--json`, and stdout then belongs entirely to the
machine-readable result. A question written there lands in the middle of the JSON
document and no parser can read the output. On a terminal the two streams interleave and
the corruption is invisible, which is exactly what makes it worth a rule.

## Defaults and how to accept them

Each question shows the value already resolved for it, and where that value came from.
Pressing Enter accepts what is shown.

```
Viewport widths, comma-separated [1440 · project default]:
Is the reference a live URL or a set of screenshots? (url / screenshots) [url · tool default]:
Target stack adapter (next-tailwind) [next-tailwind · your preference]:
```

The origin is shown because a bare `[1440]` tells you what happens if you press Enter but
not whether that width is your project's decision or the tool's guess — and those deserve
different amounts of scrutiny from whoever is sitting there.

A value you supplied explicitly on the command line is **never** re-asked — you already
answered it. Everything else is asked, with its resolved value as the default, which is
what makes the run guided rather than merely permissive. Skipping every input that
happened to have a value would mean interactive mode never asked about anything with a
default, which is nearly everything.

## Cancelling

Type any of `cancel`, `quit`, `abort`, or `q` at any prompt.

An empty answer is **not** cancellation — it accepts the shown default. Enter is the most
likely key for someone agreeing with a suggestion, and treating it as "stop everything"
would punish the common case.

Cancellation returns:

- status `cancelled`, exit code **4** — its own code, distinct from both success and
  failure
- `detail.cancelledAt` — which question you stopped at
- `detail.completed` — what had already been done (configuration loaded, defaults
  resolved)
- `detail.notAttempted` — preflight, capture, analysis, artifact generation
- `detail.browserLaunched: false`

Nothing is written on cancellation, including the answers already given. That is
deliberate: a partially-saved configuration is worse than none, because the next run
would inherit half a decision without saying so.

Cancelling is not an error. Exit 4 exists so a script can tell "the operator changed
their mind" apart from "the tool broke".

## Non-interactive runs

The default. Every input must come from a flag, the workspace, the project, or a
preference; anything missing is reported rather than asked for.

A `requires-user-input` result carries:

- `userActions` — what to supply, and the flag to supply it with
- `detail.missingInputs` — the same list, structured
- `detail.exampleCommand` — a runnable command with your workspace and project filled in

The example command is built from the same question table the prompts are, so it cannot
name a flag that does not exist. See [MODES.md](MODES.md) for that table.

## What prompting will not do

- It will not ask for credentials. Authenticated capture is not implemented and is not
  planned; a request for it is refused as unsupported, not collected.
- It will not offer to write a target brief for you. See
  [WORKFLOWS.md](WORKFLOWS.md#what-is-never-inferred).
- It will not ask you to confirm a conclusion. Evidence status, safety gates and
  measurements are not inputs, and no answer at a prompt can change one. See
  [INPUTS.md](INPUTS.md#what-configuration-may-never-resolve).

# Guided workflows

A mode command — `analyze`, `recreate`, `adapt`, `extend`, `improve` — is not a thin
wrapper over the pipeline. It is a front that establishes what the run is for, what it
has to work with, and whether it can honestly be attempted, *before* anything expensive
or irreversible happens.

The order of that front is the design. Everything that can refuse cheaply happens before
anything that costs a browser launch.

## The twelve steps

| # | Step | What can stop here |
| --- | --- | --- |
| 1 | Load the project configuration, if there is one | — |
| 2 | Validate it and resolve its defaults | `failed` — a project that exists and cannot be read |
| 3 | Parse the arguments actually typed | — |
| 4 | Let those arguments override everything beneath them | — |
| 5 | Check what this mode forbids for this kind of input | `blocked` — recapturing would not help |
| 6 | Detect missing and invalid inputs | `failed` — an input that is present and wrong |
| 7 | Run preflight and explain any blockers | `blocked` — before capture, not after |
| 8 | Ask for what is missing, if someone is there to ask | `cancelled` — the user stopped |
| 9 | Report what is still missing, if nobody is | `requires-user-input` |
| 10 | Run the pipeline | any pipeline status |
| 11 | Emit only what the mode supports | — |
| 12 | Preserve hashes and iteration history | — |

Steps 5 through 9 are the guarded band. Nothing in them launches a browser, and every
result they produce carries `browserLaunched: false` so that claim is checkable rather
than merely asserted.

## Statuses and exit codes

| Status | Exit | Meaning |
| --- | --- | --- |
| `completed` | 0 | The run finished and its claims are supported. |
| `completed-with-warnings` | 0 | Finished; something is worth reading before trusting it. |
| `failed` | 1 | Something went wrong that the tool could not work around. |
| `blocked` | 3 | The tool refused: the evidence does not support the request. |
| `cancelled` | 4 | You stopped it. Nothing was captured and nothing was written. |
| `not-attempted` | 5 | There was nothing to do. |
| `requires-user-input` | 6 | Waiting on something only you can supply. |

`blocked`, `cancelled` and `requires-user-input` are deliberately *not* failures. Each
one means something different about what to do next, and collapsing them into exit 1
would make a script treat "you have not written a brief yet" the same as "the capture
crashed".

## What a guided result always carries

Whatever its status, a mode result carries:

- `detail.resolvedConfiguration` — every input, its value, and which layer supplied it.
  See [INPUTS.md](INPUTS.md).
- `detail.resolutionSummary` — the same thing rendered for a human, defaults omitted.
- `detail.browserLaunched` — whether a browser was started at all.
- `detail.nextAction` — one concrete thing to do next.

A blocked run needs those as much as a completed one does. A refusal that does not say
what it was working from is not much better than a crash.

## Reference detection

A workspace that already holds a capture satisfies the reference requirement. You do not
re-supply `--url` to analyse something you already captured.

Which key the capture lands under follows the **manifest**, not the filename. Screenshot
evidence written to a file named `extract-1280.json` is still screenshot evidence, and
reading the filename instead would let `recreate` — which refuses screenshot evidence —
run on screenshots. The filename is only the fallback when no manifest is readable.

The same applies to the target brief: a brief already sitting at
`<workspace>/input/target-brief.json` satisfies `adapt` and `extend` without `--brief`.

## What is never inferred

No workflow writes a target brief. If `adapt` needs one and cannot find one, it returns
`requires-user-input` and names the flag and the conventional path — it does not create a
plausible file for you to discover later. A generated brief would flow into an adaptation
prompt that reads exactly as confident as one written from a real product decision, and
nothing downstream could tell the difference.

The same rule governs `productName`, the reference URL, and every other input: absent is
reported, never filled in.

## Preflight

`helmy blockers --for <mode>` runs steps 1 through 7 and stops. It answers "would this
work?" without doing it, and it never launches a browser — the check for a browser is a
filesystem check, not an attempt.

Every blocker it reports carries a `userAction`. A blocker you cannot act on is a
complaint.

## Related

- [INPUTS.md](INPUTS.md) — the five layers and what each resolved value records
- [MODES.md](MODES.md) — what each mode requires and what it refuses
- [INTERACTIVE.md](INTERACTIVE.md) — prompting, defaults, and cancellation
- [BLOCKERS.md](BLOCKERS.md) — every blocker code and its remedy

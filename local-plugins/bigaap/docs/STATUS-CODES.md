# Statuses and exit codes

**Generated from `src/cli/result.mjs` and `src/cli/readiness-model.mjs`
by `node tools/generate-command-docs.mjs`.**

Seven statuses, each with its own exit code. They are not interchangeable, and the
differences between them are the whole point: a CI job that retries on `1` must not
retry a run a safety gate refused, and a script that treats "waiting on you" as a
failure will report an outage every time somebody forgets a target brief.

## Run statuses

| Status | Exit | Meaning | What to do |
| --- | --- | --- | --- |
| `completed` | 0 | The run finished and its claims are supported. | Read the evidence report before acting on the spec. |
| `completed-with-warnings` | 0 | Finished. Something is worth reading before trusting it. | Read the warnings; they change how far to trust the output, not whether it exists. |
| `blocked` | 3 | The tool refused: the evidence does not support the request. | Read the blockers. Each says whether recapturing would change the verdict. |
| `failed` | 1 | Something went wrong that the tool could not work around. | Read the error. Nothing here is a finding about the reference. |
| `cancelled` | 4 | You stopped it. Nothing was captured and nothing was written. | Re-run when ready. Nothing was left half-configured. |
| `not-attempted` | 5 | There was nothing to do. | Check you pointed at the right workspace or run. |
| `requires-user-input` | 6 | Waiting on something only you can supply. | The result names the flag and the file. Nothing here invents a value. |

`completed` and `completed-with-warnings` both exit 0: both produced usable output.
The distinction is in the result, not the exit code, because a shell cannot act on it
but a reader can.

**Exit 2** is reserved for *environment not ready* — the fixture server is not
answering, or another run holds the lock. It is not a scenario result and never
means a check failed.

## Requirement statuses

Every mode requirement resolves to one of these. They appear in the readiness output
and in `--json` under `readinessModel.requirements`.

| Status | Meaning |
| --- | --- |
| `satisfied` | The evidence is present. |
| `warning` | Absent, and the mode can proceed without it. |
| `blocked` | Absent, and the mode requires it. |
| `unknown` | Looked for and not established. **Not** a failure unless the mode requires it. |
| `not-applicable` | This mode does not need it. |
| `requires-user-input` | Only you can supply it. |
| `unsupported` | Not available in this build. |

An `unknown` is never promoted to `blocked` unless the mode's own requirements say the
evidence is mandatory. Collapsing the two would refuse runs the evidence actually
supports.

## Artifact states

| State | Meaning |
| --- | --- |
| `generated` | Written by this run. |
| `not-generated` | Not written. For an optional artifact this is **not** a failure. |
| `blocked` | Withdrawn — by the safety gate or by prompt lint. A decision was made, not an omission. |
| `stale` | Its source moved after it was written. Preserved, not trusted. |
| `invalid` | Present and unreadable. |
| `historical` | A record of the past. Never regenerated. |
| `not-applicable` | This mode does not produce it. |
| `no-producer` | Registered so it is governed when it arrives; nothing writes it yet. |

`blocked` and `not-generated` are deliberately different. "Not written" reads as an
omission; a withdrawn implementation prompt was refused, and the reader needs to know
which happened.

## Limitation kinds

The distinction that decides what you do next, and the one most often lost.

| Kind | Meaning | Recapture helps |
| --- | --- | --- |
| `intrinsic-to-input` | No capture of this input kind will produce it. Change the input kind or use a mode this evidence supports. | no |
| `implementation` | This build does not implement it. Nothing you capture will change that. | no |
| `policy` | Refused by decision, not by capability. It will not become available by trying harder. | no |
| `coverage` | The capture did not reach it. Recapturing may help. | **yes** |

"Recapture and it will work" and "no capture of any kind will fix this" are different
answers. A report that gives neither sends the reader to try the same thing again.

# Recovery

`helmy recovery` shows what the capture actually did, attempt by attempt — including the
attempts that failed and what was done about them.

A capture that succeeded on its third try is not the same as one that succeeded on its
first, and a report that shows only the outcome hides the difference.

## What each attempt records

| Field | Meaning |
| --- | --- |
| `operation` | What was being attempted |
| `attempt` | Which try this was |
| `status` | completed / failed |
| `errorCategory` | The typed driver error, where one occurred |
| `retryDecision` | What the recovery policy decided |
| `retryCount` | How many retries had been spent |
| `durationMs` | How long it took |
| `viewport` / `state` | Which capture this belongs to |
| `artifactResult` | Whether an artifact came out of it |
| `recommendation` | What to do, where the error carries one |

## Six failure kinds, kept distinct

These are acted on completely differently, and a report that blurs them costs the reader
the wrong hours:

| Kind | What it means | What to do |
| --- | --- | --- |
| **Blocked preflight** | Refused before capture began | Read the blocker; nothing was attempted |
| **Driver failure** | The browser or the page failed | Check the attempt history for the typed error |
| **User cancellation** | You stopped it | Nothing was captured; re-run when ready |
| **Stale artifact** | The file predates its source | Regenerate, reading what changed first |
| **Missing input** | Something only you can supply | The result names the flag and the file |
| **Source-kind limitation** | The input cannot carry this evidence | Change the input; recapturing will not help |

The last one is the distinction that matters most. "Recapture and it will work" and "no
capture of any kind will ever fix this" are different answers, and a report giving neither
sends the reader to try the same thing again.

## What it does not do

`recovery` reads what is on disk. It launches no browser and re-attempts nothing, and it
reports `browserLaunched: false` so the claim is checkable.

Thirteen of the sixteen typed driver failures have never been observed against a real
browser — they are provoked against a stub in the unit suite, because a live browser
cannot be made to crash a renderer on demand. `recovery` shows what happened, not what
could.

## Related

- [READINESS.md](READINESS.md) — whether the run supports what you want to do
- [BLOCKERS.md](BLOCKERS.md) — every blocker code
- [STATUS-CODES.md](STATUS-CODES.md) — statuses and exit codes

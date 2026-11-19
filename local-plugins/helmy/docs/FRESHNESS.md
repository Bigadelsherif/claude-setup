# Freshness

An artifact is a snapshot of what an analysis concluded at one moment. When the
analysis moves, the file does not — and the file gives no sign of it. A rebuild prompt
generated three weeks ago looks exactly as authoritative as one generated this morning.

Freshness checking is what closes that gap. The governing rule:

> **A stale artifact is never silently regenerated.**

Silent regeneration looks like helpfulness and behaves like data loss. The reader asked
why the prompt said 16px; "it doesn't any more" answers nothing about why it ever did.
Worse, regenerating an implementation prompt can change what somebody is being told to
build without them having asked for that.

So staleness is *reported*: what moved, whether re-deriving is safe, and the original
left exactly where it was.

## Three hashes, three different answers

They are tracked separately because they mean different things, and one combined hash
would throw away the part a reader needs.

| Hash | What moving it means |
| --- | --- |
| `irHash` | What we **concluded** about the page changed. |
| `evidenceHash` | What we **observed** changed. A stronger reason to distrust the file. |
| `configurationHash` | The same observations judged by **different rules**. The page did not move; the question did. |

Two more fields are compared but are not hashes:

| Field | What differing means |
| --- | --- |
| `extractorVersion` | The two runs do not measure the same things. Not staleness — incompatibility. |
| `toleranceVersion` | Comparisons made under the old table cannot be read beside ones made under the new. |

## Four verdicts

| Verdict | Meaning |
| --- | --- |
| `fresh` | Everything it was made from is still current. |
| `stale` | A source moved. Re-deriving is possible; whether it is wise depends on the artifact. |
| `incompatible` | A version difference. Re-deriving would **not** reconcile it. |
| `undetermined` | Not enough metadata to tell. |

`undetermined` is not `fresh`. An artifact carrying no hashes the current run also has
cannot be vouched for, and treating "we did not look" as "it matches" is precisely how a
stale file gets used. The check reports it as its own verdict for that reason.

## Whether regeneration is safe

Safety is a property of the **artifact**, not of how it went stale. Re-deriving a
coverage report changes a description of a run. Re-deriving a build prompt changes what
somebody is told to build.

| Behavior | Which artifacts | What happens |
| --- | --- | --- |
| `regenerate-safe` | reports, specs, token files, inventories | Re-deriving reproduces it. Regeneration is offered. |
| `regenerate-needs-review` | every implementation prompt, fidelity report, correction tasks | Reported. A person reads what changed first; there is no one-click regenerate. |
| `preserve-only` | history records, recovery records, correction log | Never regenerated. These are supposed to describe the past. |

The per-artifact assignment is in [ARTIFACTS.md](ARTIFACTS.md).

## Where the check runs

Freshness is checked at the boundary where an artifact stops being output and becomes
input. That is where a wrong value starts travelling.

- being used as input to another workflow
- being copied into a target project
- generating correction tasks
- running a fidelity comparison
- exporting a prompt file

A refusal at any of these carries `preservesOriginal: true` — named explicitly so that a
caller cannot read a refusal as permission to fix the problem by overwriting the evidence
of it.

## After a re-capture

The useful question is not "is this one file stale" but "what do I now have to look at".
Asking one file at a time makes the reader do the join, so the check answers the whole
question at once, splitting the result by what needs a decision:

- **affected** — every artifact whose source moved
- **safeToRegenerate** — the subset a person can regenerate without reading anything
- **needsReview** — the subset where re-deriving changes instructions
- **fresh** / **undetermined** — reported separately, never merged

## What a stale artifact keeps

Everything. The file is not modified, not moved, and not marked. A `stale` status appears
in the *report*, and in the metadata only when the artifact is deliberately re-stamped —
never by the checker as a side effect of looking at it.

## Related

- [ARTIFACTS.md](ARTIFACTS.md) — per-artifact stale behavior and hash requirements
- [EXPORTS.md](EXPORTS.md) — why a stale prompt cannot leave, and a stale report can
- [OUTPUTS.md](OUTPUTS.md) — what each mode writes

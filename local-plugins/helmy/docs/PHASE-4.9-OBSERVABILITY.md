# Observability and regression policy

Two things that were followed by habit and are now written down: what may be
recorded from real usage, and what every future fix must carry.

---

## Part 1 — Observability

### Principle

Learn from real usage without collecting anything not needed to learn. The
default is **local-only**: everything below is written to the run directory, and
nothing leaves the machine unless the operator explicitly exports it.

**Never collected, by default or otherwise:** source page HTML, screenshots,
extracted copy, class names from third-party sites, URLs beyond their origin, or
any artifact content.

The failure mode to design against is not a leak. It is a diagnostic channel
that quietly becomes a content channel, one useful field at a time — each
addition defensible, the sum indefensible. Every field below states what it
excludes, so an addition has to argue against a written boundary rather than
against a vague intention.

### The record

One JSON-lines file per run directory, `telemetry.jsonl`, one line per command.

| Field | Content | Boundary |
| --- | --- | --- |
| `command` | the CLI operation name | — |
| `mode` | content mode, or the analysis mode requested | — |
| `sourceKind` | `url` / `synthetic` / `file` | **Origin only, never the full URL.** A path can carry a customer name, a ticket number, or an unreleased product |
| `viewport` | width and height | — |
| `status` | one of the six | — |
| `blockers` | codes and stages | **Codes, not messages.** A gate message can quote page content |
| `evidenceCoverage` | coverage factor, content-reached, sampled/total | Numeric only |
| `driverErrors` | typed codes and counts | Codes only. The `cause` message is kept locally and never exported |
| `recoveryAttempts` | per operation: attempts, recovered, final status | — |
| `timeouts` | which operation, which bound, whether it expired | Directly feeds the unobserved-failure question |
| `artifactHashes` | the hashes already on the contract | Hashes, never contents |
| `defectCandidates` | a typed code plus the invariant that failed | Never the data that failed it |

### `defectCandidates`

The most valuable field and the most dangerous.

A candidate is recorded when an invariant the system asserts about itself does
not hold: a hash mismatch, a category scoring `0` where `null` was expected, a
state reported mismatched with no two-sided evidence, a recovery reporting
success without an attempt, an operation bound expiring.

It records **which invariant failed and where in the pipeline** — never the
values that failed it. A candidate is a prompt to investigate on the operator's
own machine, not a bug report containing their data.

### Export

`helmy telemetry --export` produces a redacted bundle, **prints exactly what it
contains before writing**, and requires confirmation. There is no automatic
upload, no background reporting, and no opt-out switch to forget, because
nothing runs that would need one.

### What this is for

`unknown-driver-error` is classified `requires-future-production-telemetry`.
This is that telemetry. `timeouts` and `driverErrors` are what would eventually
let the ten fixture-observed categories be reclassified as field-observed —
which is a future phase's work, not this one's.

### Status

**Specified, not implemented.** Implementing it means adding a write to every
CLI command and a new subcommand, which is feature work; this phase records the
design so that the first implementation has a boundary to build against rather
than inventing one under deadline.

---

## Part 2 — Regression policy

Written down because it has been followed by habit and, twice now, by
correction. A habit is not a policy.

### Every fix, without exception

1. **Defect record before implementation.** The full record, filed before any
   code changes. A fix written first and documented after describes the fix
   rather than the defect.
2. **Reproduction.** A concrete, re-runnable path to the wrong behaviour — a
   fixture, a command, a test. "It happened during X" is not a reproduction.
3. **Expected behaviour**, stated independently of the implementation, so the
   record survives a different fix than the one first imagined.
4. **Scope** — `reference`, `global`, or a named subsystem — so a reader can
   tell what else the fix touches.
5. **Regression test**, named in the record, failing before and passing after.
   A record whose `regressionTest.status` is `none` is reported by
   `helmy defects` on every run and must never become routine.
6. **Impact on readiness**: which of the fifteen decisions this changes, or an
   explicit statement that it changes none.
7. **Documentation update** in the same change, not deferred.

### Promotion discipline

A defect is promoted for fixing on **two independent witnesses**, or on a cause
provable by inspection that does not rest on the measurement. Structural defects
— an unbounded loop, a missing base case, a flag that cannot be true — qualify
under the second clause. A single measured occurrence does not.

**A defect is never closed because it stopped recurring.** Phase 4.9 re-examined
`def_0020` and `def_0022` and found no second witness; both stayed open. Looking
and not finding is why they are open, not a reason to shut them.

### Permanent limitation

A third disposition, added in Phase 4.9 and now a first-class status. It means
the evidence says the capability does not work and will not be made to, so the
containment is the answer rather than a stopgap.

It requires the same evidence as a fix — `def_0030` needed a second independent
witness before it could be declared — and it must record **what was not tried**,
so a permanent limitation is not read as a proof of impossibility.

A defect holding this status appears in its own section of the log. Before it
existed, such a defect would have been filtered out of both the open and fixed
groups and **disappeared**, which is the one outcome a register exists to
prevent.

### Correction of an earlier record

**Preserved, and not a formality.**

When a diagnosis turns out to be wrong, the record is corrected in place with a
`correctionOfEarlierRecord` field stating what was originally claimed, what
evidence produced the wrong claim, and what the evidence actually shows. **The
original claim is not deleted.**

Two worked examples now exist:

- **`def_0035`** was first filed against `chromium.launch()` on the evidence
  that no `chrome` process was alive. Playwright's browser runs as
  `chrome-headless-shell`; looking for the right name showed it alive
  throughout, and the hang was in closing a page whose renderer was stuck
  mid-navigation. The observation that nothing was bounded survived; the
  attribution did not, and the fix went to every operation instead of one.

- **`def_0036`**, and the two scan corrections in Phase 4.9, are the same shape
  at a smaller scale: a count reused without being re-derived, a scan that
  counted audit files instead of hosts, and a scan that accepted a hash as a
  word. Each would have produced a confident wrong answer, and each is recorded
  beside the corrected one.

The reason to keep the wrong version is that the **method** that produced it —
checking for a process by a guessed name, counting files instead of subjects —
is the reusable lesson, and deleting the claim deletes the lesson with it.

# Recovery paths — Phase 4.6

Twenty policies: sixteen driver-error categories plus four runner-level
failures. Each answers five questions — retryable, how many times, what backoff,
fresh context needed, viewport blocked afterwards.

## The rule that shapes everything

**A retry never overwrites the failed attempt.** Every attempt is appended to
history, including the ones that failed, because "it worked on the third try"
and "it worked" are different facts and only the first is true.

Asserted directly: a screenshot that fails once then succeeds produces a
two-entry history whose first entry is still `failed`.

## The fifteen named failures

| Failure | Retries | Fresh context | Viewport blocked | Others continue |
|---|---:|---|---|---|
| browser startup failure | 2 | yes | yes | **no** |
| navigation timeout | 2 | no | yes | yes |
| screenshot failure | 2 | no | **no** | yes |
| script injection failure | 1 | yes | yes | yes |
| font readiness timeout | 1 | no | **no** | yes |
| asset readiness timeout | 1 | no | **no** | yes |
| state trigger failure | 1 | no | **no** | yes |
| browser page crash | 1 | yes | **no** | yes |
| interrupted iteration | **0** | yes | yes | yes |
| target process failure | 1 | no | yes | **no** |
| stale capture | **0** | no | yes | yes |
| invalid viewport | **0** | no | yes | yes |
| missing reference artifact | **0** | no | yes | yes |
| missing target artifact | 1 | no | yes | yes |
| cleanup failure | 1 | no | **no** | yes |

Three are worth reading closely.

**`selector-not-found` is not retryable.** An element that does not exist will
not exist on the second attempt. It is a finding about the target, recorded as
an unavailable state, not a driver failure.

**`invalid-viewport` is not retryable.** Retrying the same invalid value cannot
succeed; the run manifest has to change.

**`target-process-failure` stops every viewport.** It is the only failure
besides browser startup where `otherViewportsMayContinue` is false, because
every viewport depends on the target being up.

## Partial results

Six statuses: `completed`, `completed-with-warnings`, `blocked`, `failed`,
`not-attempted`, `cancelled`.

A run with three good viewports and one blocked is
**`completed-with-warnings`** — not `failed`, which would discard three valid
records, and not `completed`, which would hide the blocked one. The roll-up
names which viewports fell into each bucket.

**A failed reference prevents target startup** for that comparison — asserted
against the committed slice, where `targetStarted: false`.

**A failed target preserves the reference** and produces no score. Every blocked
viewport reports `categories: null` and `compositeScore: null`; no score is ever
computed from a missing record.

## Staleness

Ten checks before any comparison: reference IR hash, target IR hash, screenshot
hash, viewport metadata, state metadata, capture timestamp, source URL, driver
version, extractor version, tolerance version.

The distinction that matters is **stale** versus **incompatible**:

- A **driver version** difference is `stale` — it degrades the comparison
  without invalidating what was measured.
- An **extractor version** or **tolerance version** difference is
  `incompatible`. Two IRs from different extractors are not comparable, because
  a difference between them may be a change in what was *measured* rather than
  in the target. Comparing them silently would report the tool's own history as
  a fidelity finding.

A check that cannot be answered returns `unverifiable` and is listed — not
treated as a pass, not treated as a failure. An absent screenshot is
unverifiable; a screenshot stamped with the wrong IR hash is stale.

## Tap-target policy

Phase 4.5's `cand_03` recorded that the reports cited 44px as *the* minimum when
three published standards disagree. That is now configurable:

| Policy | Minimum | Source |
|---|---:|---|
| `wcag-2.2-aa` | 24px | WCAG 2.2 SC 2.5.8, with four named exceptions |
| `apple-hig` | 44px | Apple Human Interface Guidelines |
| `material-3` | 48px | Material Design 3 |

**Default: `apple-hig`**, with the rationale recorded on the policy object —
every prior phase measured against 44px, and silently loosening to 24px would
retire findings that Phases 4.2 and 4.3 deliberately preserved. It is a stated
decision, not a fact about the web.

The policy travels onto the intrinsic report, every tap-target finding, every
task, the category limitations and the expected-value text.
`verifyPolicyPropagation` checks it reached all of them rather than assuming.

Selecting WCAG changes the verdict on the same element: a 28px target passes at
24px and fails at 44px. An unknown policy name falls back to the default and
records the request rather than honouring it. Exceptions are named on the result
so a reader can disagree with the exemption rather than wonder why nothing was
reported.

## Limitations

1. **Recovery is exercised through stubs**, not against a live browser under
   real failure conditions.
2. **The capture tools have not been migrated** onto the driver interface, so
   the recovery policies do not yet govern the tools that actually capture.
3. **Backoff is fixed**, not adaptive.
4. **No cancellation plumbing.** `cancelled` is defined and rolled up correctly
   but nothing currently emits it.

# Verify

`helmy verify` answers: **is what is on disk still trustworthy?**

Not whether the analysis was good — that is [readiness](READINESS.md). This checks the
artifacts themselves, on the assumption that a file can be copied, edited, inherited from
an older run, or handed over by someone else.

## What it checks

| Check | What a failure means |
| --- | --- |
| Iteration hashes | An artifact no longer matches the hash recorded for it. It was edited, or it is from a different run. |
| Capture provenance | A capture contract cannot say which driver, extractor or attempt history produced it. It cannot be judged stale later, so it would pass a freshness check by being unverifiable. |
| Contract version | The capture was produced under a different contract than this build reads. |
| **Prompt lint** | A prompt would instruct someone to do the wrong thing. |
| **Freshness** | An artifact's source moved after it was written. |

The last two are new in Phase 5.6, and the first of them is the point. An artifact whose
hash matches and whose prompt renders a contested value as settled has **passed the
integrity check and failed the one that matters**. Integrity is necessary and not
sufficient.

## Prompt lint through verify

Every prompt on disk is re-linted rather than trusted from the run that wrote it. A
prompt can be edited after generation, and a lint result recorded at generation time
would describe a file that no longer exists.

A blocking finding fails verification. The result names the rule, where it is, what it
found and what to do — see [PROMPT-LINT.md](PROMPT-LINT.md) for the rule table.

## Exit codes

| Status | Exit | When |
| --- | --- | --- |
| `completed` | 0 | Every artifact matches its hash, carries its provenance, and passes lint |
| `failed` | 1 | At least one check failed |
| `not-attempted` | 5 | There is nothing to verify |

`not-attempted` is not a pass. An empty workspace has no failing artifacts because it has
no artifacts, and reporting that as success would be the most misleading green in the
system.

## Output

The default view leads with the decision, as everywhere else. `--verbose` adds every
artifact by name and its state; `--json` carries the full readiness model under
`detail.readinessModel`, including `lintFindings` with each finding's rule, severity,
location, evidence context, remediation and whether it blocked.

## Related

- [READINESS.md](READINESS.md) — whether the analysis supports what you want to do
- [FRESHNESS.md](FRESHNESS.md) — how staleness is detected
- [PROMPT-LINT.md](PROMPT-LINT.md) — every lint rule
- [STATUS-CODES.md](STATUS-CODES.md) — statuses and exit codes

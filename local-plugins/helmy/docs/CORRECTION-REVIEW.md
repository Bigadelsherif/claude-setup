# Reviewing a correction

Two things stand between a proposed correction and a changed workspace: the **preview**,
which is for you, and the **apply pipeline**, which is for the machine.

## The preview

Running a preview leaves the workspace byte-identical. It works on copies and returns a
description; nothing in it is passed a writable handle.

What it shows — because deciding needs more than a diff of one value:

| | |
| --- | --- |
| **Claim** | Original and corrected value, status and evidence on both sides |
| **Status change** | Including whether the status *strengthens* |
| **Confidence change** | Per category, only what moved |
| **Affected IR paths** | What the re-derivation would touch |
| **Affected projections** | Which projections read those paths |
| **Artifacts that will change** | By filename |
| **Artifacts that will be withdrawn** | An implementation prompt from a newly-blocked run |
| **Mode impact** | Decision before and after, gaps resolved and gaps introduced |
| **Readiness impact** | Status, requirements, blockers, warnings, unknowns, contested — each before and after |
| **Lint impact** | Whether a regenerated prompt would be withdrawn |
| **Evidence delta** | Gained and lost, **never netted against each other** |
| **Promotion impact** | Whether it could become a rule, and what is holding it back |
| **Risks** | Stated plainly, with why each matters |

## Evidence lost is never netted against evidence gained

A correction can raise a score by making something unmeasurable — fewer admissible
comparisons, higher apparent agreement. That is not an improvement, and a single net
number would hide exactly that.

So `newlyUnknown` and `nowKnown` are separate fields, and a correction that reduces
measurable evidence is **stopped** rather than applied:

```
corr_0003 was not applied: correction-reduces-measurable-evidence.
The previous artifacts are still the current ones, and the correction is preserved.
```

This is the same principle as `stopOnNewUncertainty` in the fidelity loop. The escape
hatch exists, is explicit, and has to be typed: `--allow-evidence-reduction`.

## The apply pipeline

Seventeen steps, and the order carries the whole safety argument: **everything that can
refuse runs before anything is published.**

1. Load the correction target
2. Validate current artifact freshness
3. Load the original evidence
4. Validate the correction record
5. Run the guards
6. Require acceptance
7. Re-derive the IR *in memory*
8. Re-project every artifact *in memory*
9. Check evidence was not reduced
10. Validate every regenerated artifact
11. Run prompt lint
12. Re-evaluate the mode requirements
13. Publish — IR and evidence map first, then artifacts
14. Record the resulting hashes
15. Append the acceptance event
16. Preserve the previous artifact hashes on the record
17. Report every step

## Why nothing is written until everything validates

The failure this is built against is subtle and expensive. A correction applies, the IR
re-derives, the artifacts re-project — and one is now invalid, or a prompt now lints as
dishonest, or the mode that was satisfiable no longer is.

If artifacts were written as they were produced, the workspace would hold a **mixture**:
some files from the corrected derivation, some from the previous one, and no way to tell
which is which.

So the new artifacts are held in memory, checked as a set, and published together or not
at all.

## When it stops

| Reason | What it means |
| --- | --- |
| `guard-refused` | The correction would launder evidence |
| `correction-record-invalid` | A required field is missing |
| `current-artifacts-are-stale` | Correcting on top of stale artifacts would attribute their staleness to this correction |
| `not-accepted` | Applying without acceptance would make review decorative |
| `regenerated-artifacts-failed-validation` | Nothing was published |
| `correction-reduces-measurable-evidence` | A run can look better by measuring less |

Every stop guarantees three things, stated on the result rather than implied:
`previousArtifactsPreserved`, `nothingPublished`, `correctionPreserved`.

The proposal survives a failure. A correction that vanished would be re-proposed by the
next person to notice the same problem.

## Related

- [CORRECTIONS.md](CORRECTIONS.md) — the record and what it may never do
- [PROMOTION.md](PROMOTION.md) — the promotion gate
- [FRESHNESS.md](FRESHNESS.md) — why stale artifacts block a correction

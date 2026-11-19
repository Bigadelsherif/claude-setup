# Phase 3.4 — minimal vertical slice results

Implemented 2026-08-12 in the required order. Report-first and manual-first;
nothing in the loop modifies an implementation.

**363 tests passing, zero failures.** 29 new.

---

## Step 1 — plan validated against the extractor and IR

Recorded in [fidelity-plan-validation.md](fidelity-plan-validation.md). Seventeen
of the nineteen planned dimensions exist in the IR as claim nodes with status,
confidence and evidence. Three corrections:

- **Section spacing does not exist.** There is no `layout.sectionSpacing`. The
  Spacing category compares the spacing *system* — base unit, ramp, observed
  values — which is better founded anyway.
- **Responsive is empty at one viewport** (`ir.responsive === {}`).
- **Interaction states are `unknown` on both sides.**

Both of the latter report `score: null, evidenceCoverage: 0`, which is the
designed behaviour and is exercised in the slice.

---

## Step 3 — Test 19, run before the loop was built

| Measure | Result |
|---|---|
| Expected pairs | 9 |
| Correct | 4 |
| **Wrong** | **0** |
| Missed | 5 |
| **Precision** | **1.000** |
| **Recall** | **0.444** |
| Reliable (bar: 0 wrong, recall ≥ 0.6) | **No** |

The first run of Test 19 returned zero matches for a different reason — the
committed `fixture-1440` golden predates coherence instrumentation, so every
structural signal was null and the matcher reported `insufficient-evidence` at
39% model availability. That is a confound, not a result. The reference was
recaptured with the current extractor under a new slug, preserving the golden,
and the numbers above are from that fair comparison.

### Step 4 — the decision

**Component-level matching is not relied upon.** Per the phase instruction, the
fallback applies in full:

- comparison runs at category and region level;
- component identity is *reported* as resolved or unresolved;
- automatic component correction is blocked outright;
- the mismatch is preserved as a limitation;
- `def_0030` is filed with the reproduction.

**No threshold was lowered.** Dropping 0.75 to 0.55 would have recovered three
of the five misses and would have been exactly the move the brief forbids.

Precision of 1.000 is worth stating plainly: the matcher never paired the wrong
components. Matches that *are* made are trustworthy, so they are reported and
used for observation — 3 of 8 resolved on the slice target — but none of them
unlocks an automatic correction.

---

## The slice, iteration by iteration

### Iteration 1 — target as written

| Category | Score | Coverage | Mismatches |
|---|---|---|---|
| region-coverage | 1.00 | 1.00 | 0 |
| **layout** | **0.75** | 1.00 | **1** |
| typography | 1.00 | 0.67 | 0 |
| spacing | 1.00 | 0.50 | 0 |
| color | 1.00 | 1.00 | 0 |
| components | 1.00 | 0.67 | 0 |
| motion | 1.00 | 1.00 | 0 |
| accessibility | 1.00 | 1.00 | 0 |
| states | **null** | 0 | 0 |
| responsive | **null** | 0 | 0 |
| pixel-only | **null** | 0 | 0 |

One difference, exactly as planted:

```
[high] layout.container.maxWidth: reference 1180 vs target 1280 (100px)
```

One task, automatic — a global stylesheet value, not a component:

```
task_0001 [high] automatic
  Set the primary content container max-width to 1180px and preserve the
  horizontal padding below the max-width threshold.
  acceptance: Target IR reports layout.container.maxWidth = 1180px ± 1.5px,
              and no other category score decreases.
```

**Comparative pixel comparison was suppressed**, with the reason recorded.

### Iteration 2 — container corrected by hand

Layout **0.75 → 1.00**, zero IR differences. The pixel-only category now scores
**0** on 3 intrinsic findings:

```
[medium] stacking-order-inverted: span.badge occluded by div.panel__thumb
  the centre of span.badge hit-tests to div.panel__thumb, which overlaps it
  — z-index 0 against 1
```

Zero IR differences accompany it. The IR cannot see this, which is the point.

---

## A measured correction to the plan

The plan assumed a comparative pixel diff between reference and target would
surface stacking, clipping and overflow. **It does not.** A real diff of the
controlled reference against the fidelity target produced **42 clusters**,
entirely because the copy differs — comparative pixel diffing assumes equivalent
content, and an independent implementation does not have it.

Two changes followed, both from measurement rather than from re-reading the plan:

1. **A global geometry difference suppresses the comparative pixel pass.**
   Attributing the whole viewport to a container change would be technically
   true and useless: residue would always be empty and a genuine pixel-only
   defect would hide behind an unrelated layout difference. The residue question
   is asked again once layout agrees.

2. **Overflow, clipping and stacking inversion are single-render properties, not
   comparative ones.** They are now checked on the target alone
   (`tools/visual-checks.mjs`), which makes them immune to content differences.
   Stacking is detected by hit-testing an element's own centre rather than by
   modelling stacking contexts. The reference is checked too: a condition the
   reference also exhibits is demoted to informational, because the target is
   not diverging from it.

The comparative diff backend (`tools/pixel-diff.mjs`) is built and works — it
uses the browser as the image decoder, so the zero-runtime-dependency rule
holds — and it remains the right tool for target-vs-target drift between
iterations, where content *is* equivalent.

---

## The ten proofs, plus the eleventh

| # | Proof | Result |
|---|---|---|
| 1 | Reference analysis loads | ✓ |
| 2 | Target application starts | ✓ served and captured |
| 3 | Target capture succeeds | ✓ |
| 4 | Target IR generated by the same pipeline | ✓ identical IR key set asserted |
| 5 | IR difference detected | ✓ exactly one, all eleven fields |
| 6 | Correction task generated | ✓ with acceptance condition |
| 7 | Pixel-only difference reported separately | ✓ zero IR differences accompany it |
| 8 | Corrected iteration improves the category | ✓ layout 0.75 → 1.00 |
| 9 | Regression prevents silent worsening | ✓ `new-uncertainty` fires |
| 10 | History and hashes intact | ✓ append-only enforced |
| 11 | Blocked comparison | ✓ no categories emitted |

The blocked case runs against the Stripe capture, whose safety status is
`unsafe-for-prompt-generation`. It fails at the **reference** stage, so the
target is never started, and `categories` is `null` rather than partial.

---

## What is deliberately not claimed

- **Not pixel-perfect fidelity.** The comparative pixel channel does not run
  between a reference and an independent implementation, and the intrinsic
  checks cover three named conditions, not "looks right".
- **Not validated thresholds.** `TOLERANCES.$validated === false`, asserted by a
  test. Every tolerance is inherited from `disagreement.mjs`, where it was
  chosen rather than measured.
- **Not general automatic correction.** One task in the slice is automatic, and
  it is a global stylesheet value. Every component-scoped task is manual, and
  every manual task states why. All seven blocking rules are implemented and
  each is proven reachable.
- **No composite score**, anywhere, asserted by a test.

## Limitations

1. **Component matching is unreliable across implementations** (`def_0030`,
   open). Recall 0.444. The true figure against real implementations is likely
   lower, not higher — this target shares the reference's internal shape.
2. **Comparative pixel diffing needs equivalent content**, so it is unavailable
   for reference-vs-implementation.
3. **One viewport, one page, one component**, as scoped.
4. **States and responsive cannot be scored** at one viewport.
5. **Spacing coverage is 0.50 and typography 0.67** on the slice — several
   dimensions are unknown on one side and are listed as unresolved rather than
   assumed to agree.
6. **`start()` is not implemented** on the driver; the slice serves the target
   through the existing fixture server. The interface is specified in the plan.

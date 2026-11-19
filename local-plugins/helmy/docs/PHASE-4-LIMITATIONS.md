# Phase 4 — limitations

Everything Phase 4 does not establish, in one place. This is not an appendix to
the results; it is the half of the results that is easiest to lose.

A limitation here is either **structural** (it follows from a decision, and
would need that decision reversed), **evidential** (the evidence has not been
gathered yet), or **open** (a known defect, deliberately not fixed).

---

## 1. No threshold is validated — *evidential*

`TOLERANCES.$validated` is `false`. Phase 4.5 ran twenty-four independent
fixtures and stopped short of declaring validation rather than declaring it.

Every comparison carries `thresholdsValidated: false` on its result contract,
and the audit fails if the flag flips without evidence. **A score is a
measurement, not a verdict.** Two scores from different runs are comparable to
each other; neither is comparable to a pass mark, because there is none.

No threshold was ever changed to make an existing test pass, and no threshold
was calibrated using only the fixture that produced it.

## 2. Thirteen of sixteen typed driver failures are unobserved — *evidential*

Observed against a real browser: `network-failure`, `selector-not-found`.

Unobserved: `startup-failed`, `browser-unavailable`, `navigation-timeout`,
`page-error`, `script-injection-failed`, `screenshot-failed`,
`state-trigger-failed`, `font-timeout`, `asset-timeout`, `viewport-invalid`,
`content-not-ready`, `cleanup-failed`, `unknown-driver-error`.
`authentication-required` is unreachable by design and will stay so.

That is 16 minus the 2 observed minus the 1 unreachable by design. This document
said twelve until Phase 4.9 enumerated the categories against the code
(`def_0036`); the list above was always right and only the count was wrong.

All thirteen are reachable through the migrated tools and are tested against a
stub launcher — a live browser cannot be made to crash a renderer or exhaust
memory on demand, and a suite that waited for one would be a suite that skipped.
But a policy exercised in a test is not a policy that has been seen in the
field, and the recovery behaviour for those thirteen is therefore predicted
rather than observed.

## 3. Component matching is incomplete — *open* (`def_0030`, high)

Across two independent implementations, component matching is precise (1.000)
and incomplete (recall 0.444). Fewer than half the components that correspond
are found to correspond.

This is not fixable by threshold tuning, and tuning it is what the phase brief
forbids. The consequences are enforced rather than noted: component-level
fidelity comparison falls back to category level, and automatic component
correction is blocked.

`def_0030` remains open. The audit fails if it is quietly closed.

## 4. Selector stability is qualified — *open* (`def_0020`, `def_0022`)

- **`def_0020`** (medium, open): the structural selector fallback stops after
  six ancestors and can leave the root unanchored, so an emitted selector may
  bind to a different subtree or to nothing. One witness in 83 selectors across
  six pages. Phase 3.2 produced no second witness — every emitted selector
  matched something on its page across eight comparisons — and promotion
  requires two independent witnesses, so it stays open at recurrence 1 rather
  than being fixed on one.
- **`def_0022`** (low, open): the vowel-ratio test ignores `y`, so an English
  word whose only other vowel is one `e` classifies as a build hash — `system`
  on tailwindcss.com. One real witness in 800 names on one target; the fix would
  change how every class name on every site is classified.
- Structural-selector **overmatching** remains an open question. It is recorded,
  not resolved.

A utility class is never recommended as deploy-stable. Selectors are not claimed
to be deploy-safe everywhere.

## 5. No composite score — *structural*

There is no composite fidelity, calibration, intrinsic or state score anywhere,
and the audit checks 117 sources and 379 artifacts to keep it that way.

This is a limitation on what the tool will tell you, and it is deliberate. A
single number would have to weight twelve categories against each other, and any
weighting is an unevidenced claim about which differences matter. Twelve scores
with their coverage attached say less and mean more.

`compositeScore: null` appears in the artifacts as an explicit refusal, not an
absence.

## 6. Scores are null without evidence — *structural*

A category with no evidence scores `null`, never `0`. Zero reads as total
disagreement, which is a much stronger claim than "we did not look".

The consequence is that a comparison routinely returns fewer than twelve scored
categories, and a consumer must handle `null`. That is the correct burden to
place on the consumer.

## 7. Blocked is not failed, and neither is a score — *structural*

A blocked comparison emits **no** category scores, no tasks, and no
implementation prompt. A partial score is read as a low score, and the point of
refusing is to avoid publishing a number that looks like a measurement of the
target when it is a measurement of the evidence.

The two exit codes differ (3 and 1) so a caller cannot collapse them by
accident.

## 8. Content modes are not interchangeable — *structural*

Equivalent-content mode requires all six entry conditions. When they do not
hold, the mode is **refused** and the unmet condition is named — it does not
degrade quietly into a weaker comparison.

Independent-content mode **disables** comparative pixel work rather than
thresholding it. Different copy produced 42 false clusters in the Phase 3.4
slice; a threshold would have made that number smaller and no more meaningful.

One consequence surfaced in Phase 4.8 and is worth stating: the stabilisation
that equivalent-content requires belongs to the **screenshot**, not to the
extraction. The extraction is deliberately unfrozen so it can read transition
values (`def_0032`), so a capture records `animationsFrozen` separately for each
artifact. A flag that does not say which artifact it is true of will be read
against the wrong one.

## 9. Interaction states are only as observable as the target — *structural*

A state that cannot be induced is `unavailable` with its reason. It is never a
mismatch, and it is never "absent by design" — the tool cannot tell those apart
and does not pretend to.

Comparison requires two-sided evidence. A state present on one side only is
reported as such rather than scored.

## 10. Intrinsic findings are not defects — *structural*

The thirteen intrinsic checks produce facts about one render. Whether a finding
is a defect depends on correlation against the reference and on declared intent,
and neither is decided by the check. A finding the reference shares is demoted,
not reported.

The tap-target minimum is a **policy**, not a measurement: WCAG 2.2 AA (24px),
Apple HIG (44px, the default) or Material 3 (48px). The chosen policy and its
rationale travel onto every finding, because a 40px target is a defect under one
policy and fine under another, and a report that does not say which is not
actionable.

## 11. Authenticated capture is not supported — *structural*

No command accepts credentials. No tool bypasses a consent gate, a CAPTCHA or a
bot check. An authenticated page must be opened by the person who owns the
account.

This is a scope decision, not a gap in the evidence. It will not change.

## 12. Automatic correction is not supported — *structural*

The loop is report-first and manual-first. `helmy tasks` emits instructions for
a person; nothing applies them, and the result carries `automatic: false`.
Component-level automatic correction is separately blocked by `def_0030`.

## 13. Everything verified is a local fixture or one of six real targets — *evidential*

The live smoke and CLI smoke suites target fixtures served from `fixtures/` over
HTTP. Six real third-party targets were captured during Phases 2 and 3 for
extractor validation.

Nothing in Phase 4 is evidence about a site that was not one of those. In
particular, no claim is made about behaviour on: pages behind a CDN that varies
by request, pages with heavy client-side routing, pages whose content changes
between two captures seconds apart, or any site with active bot detection.

## 14. One fix has no regression test — *recorded*

`def_0007` is marked fixed with `regressionTest.status: "none"`, and
`helmy defects` reports it as such on every run rather than letting it pass.

It recorded that third-party capture through the MCP browser is impossible under
a strict CSP. The fix was to capture through a driver instead. There is no test
that can assert the absence of a transport, so the gap is recorded rather than
papered over with a test that would assert something else.

## 15. Operation bounds are wall-clock, not cancellation — *structural*

`def_0035` was found by the CLI smoke suite stalling three times at the same
scenario. `runOperation` awaited every call with no time limit, and the result
envelope has no representation for "never returned" — so an operation that hung
stopped the run outright: no attempt recorded, no contract emitted, the process
killed from outside. Every operation now carries a per-operation bound and
reports the typed error it already used, so the existing policies govern it.

Two limits follow from how that is done:

- **It races, it does not cancel.** The underlying library offers no
  cancellation, so a bound that expires means *this did not complete in time*,
  not *this was stopped*. The call may still be running. A browser left behind
  by a cleanup that timed out is released by the next cleanup, or not at all —
  and `cleanup-failed` says so rather than claiming a release that did not
  happen.
- **The numbers are chosen, not measured.** 60s for a launch, 30s for a
  cleanup, 120s for a navigation or an evaluate. They are wide enough that no
  observed legitimate operation approaches them, and they are not calibrated
  against anything. A slower machine or a much larger page could reach one, and
  would then get a typed failure rather than a wait — which is the intended
  trade, but it is a trade.

The diagnosis in this record was also wrong once, and the record says so:
`def_0035` was first filed against `chromium.launch()` on the evidence that no
`chrome` process was alive. Playwright's Chromium runs as
`chrome-headless-shell`; looking for the right name showed the browser alive
throughout, and the hang was in closing a page whose renderer was still stuck in
a pending navigation. The observation that nothing was bounded stood; the
attribution did not.

## 16. The CLI is several processes, and state lives on disk — *structural*

Commands read their inputs back off disk rather than from each other, so a
sequence works the same run as a script or typed one command at a time.

The cost is that a run directory is the unit of state. Deleting it loses the
run; copying it copies the run; two commands writing the same run concurrently
is not supported and is not guarded against.

## 17. History is append-only, including after an interruption — *structural*

`FidelityHistory` refuses to write into an existing iteration directory. An
interruption that leaves a partial directory behind therefore causes the next
comparison to **skip** that number rather than overwrite it — iteration 3 may be
a partial record and iteration 4 the next complete one.

That is the intended behaviour: a partial record is evidence about the
interruption. The consequence is that iteration numbers are not guaranteed
contiguous, and a consumer that assumes they are will be wrong.

---

## Not claimed

- **Not** pixel-perfect fidelity.
- **Not** validated thresholds.
- **Not** general automatic correction.
- **Not** deploy-safe selectors everywhere.
- **Not** authenticated capture support.
- **Not** production readiness.
- **Not** a composite fidelity score.
- **Not** defect-free operation — 34 defects filed, 3 open.

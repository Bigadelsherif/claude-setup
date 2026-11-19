# Capture-tool migration — Phase 4.7

Phase 4.6 built a browser-driver interface, sixteen typed errors and twenty
recovery policies, and then recorded, accurately, that none of it governed
anything that actually captured. Every capture tool launched its own Chromium,
wrote its own `try/finally`, and discarded any attempt that failed. The
isolation test covered `src/` only, and said so — which meant the interface was
isolated from a layer nothing real went through.

This phase closes that. Eleven tools now go through one shared capture session;
no tool launches a browser; the recovery policies govern real capture execution;
and the isolation test covers `src/`, `tools/` and `bin/`.

## What moved

Every tool that launched Chromium, and what it became:

| Tool | Was | Now |
| --- | --- | --- |
| `tools/capture-playwright.mjs` | `chromium.launch` + two `addInitScript` calls + four `page.evaluate` passes | `withCaptureSession` with `injectScripts`, `evaluate` per pass |
| `tools/capture-states.mjs` | one browser, eleven state inductions in one `try` | one session per state spec, each with its own attempt history |
| `tools/capture-state.mjs` | `page.hover` / `page.focus` / raw `mouse.down` | `session.triggerState` |
| `tools/intrinsic-checks.mjs` | `chromium.launch` + hand-rolled freeze | `withCaptureSession`, plus a `--tap-policy` flag that reaches the capture |
| `tools/responsive-probe.mjs` | `chromium.launch` | `withCaptureSession` |
| `tools/visual-checks.mjs` | `chromium.launch` + `addStyleTag` freeze | `withCaptureSession` |
| `tools/pixel-diff.mjs` | `about:blank` as a canvas host | `withCaptureSession` with readiness waits off |
| `tools/selector-audit.mjs` | `chromium.launch` + `newContext` | `withCaptureSession` |
| `tools/classify-audit.mjs` | `chromium.launch` + `addInitScript` | `withCaptureSession` with `injectScripts` |
| `tools/survey-candidates.mjs` | one browser, a context per candidate, `try/catch` per URL | one session per candidate; a failure is recorded and the survey continues |
| `tools/build-screenshot-fixture.mjs` | `setContent` + `page.screenshot` | `data:` URL + `session.screenshotFullPage` |

`tools/phase4-slice.mjs`, `phase42-slice.mjs`, `phase43-slice.mjs` and
`phase44-slice.mjs` never launched a browser — they invoke the capture tools and
consume their artifacts — so they inherit the driver path without changing.

## The shared capture session

`src/capture/session.mjs` owns what each tool used to own separately: launch,
navigation, readiness, stabilisation, retry, backoff, context recreation,
artifact hashing, attempt history and cleanup. A tool supplies only the
page-side function it wants to run and what to do with the result.

Two consequences worth naming, because they are the reason the phase exists:

- A tool **cannot** skip a recovery policy. There is no path from a tool to the
  driver that does not pass through `CaptureSession.run`.
- A tool **cannot** discard a failed attempt. `run` appends to the history and
  never replaces, and `metadata()` emits the whole history on the artifact.

### The capture contract

Every capture emits the same twenty-five-field record whatever produced it, so a
downstream reader does not have to know which tool wrote an artifact to judge
whether it is comparable: contract, extractor, tolerance, driver name and
version, URL, source kind, viewport and height, device pixel ratio, state,
capture mode, tap-target policy and its version, start, end and duration,
attempt and retry counts, run status, readiness, artifacts and their hashes,
errors, warnings, evidence ids, and the full attempt history.

`stalenessRecord()` translates that contract into what `verifyFreshness` reads.
Without it, the freshness checks ran against real captures and returned eight of
ten `unverifiable` — the pair still read as passing. A check that cannot see its
input is not a check; the two modules had been written apart and never joined.

## Failures found by migrating

Three defects, all filed in full before being fixed, all with regression tests.

**def_0032 — stabilisation destroyed the evidence it was protecting.** The
session froze animation for every caller, because every caller that existed when
it was written wanted a still page. The full extraction does not: it reads
`transition-duration`, `transition-property` and `transition-timing-function`
off computed style and emits them as motion tokens, and a freeze sets all three
to zero. Migrating `capture-playwright.mjs` emptied all three histograms —
25 elements on the equivalent-content fixture, 13 on the hashed fixture, two
structurally independent witnesses found by differential capture against
pre-migration goldens. The freeze stylesheet was separately being counted as one
of the page's own, so the capture reported coverage of evidence about itself.

Fixed by making stabilisation the caller's decision rather than a default
inherited from unrelated callers, and by marking the apparatus stylesheet so the
extractor excludes it. Both goldens now reproduce byte-identically.

**def_0033 — recovery could restart itself, without bound.** Init scripts are
re-applied when a policy recreates the context, because a context recreated
without them would capture nothing and nothing would record why. The
re-application runs under a policy of its own, and the policy for an
unclassified injection failure asks for a new context. A session that could not
accept its scripts therefore recreated, failed, and recreated again. There is no
I/O in the loop, so it does not time out: it allocated until the process aborted
at a 4 GB heap. Forty attempts fired in under a second before a trace guard
caught it.

Fixed structurally rather than with a retry budget: a repair requested while one
is in progress is refused and recorded. A budget would have bounded the loop
while still treating an unrepairable session as repairable.

**def_0034 — a cleanup failure reported itself as recovered.** Cleanup cleared
its page map and nulled its browser handle whether or not the closes threw, then
raised `cleanup-failed`. The policy retries once; the retry found an empty map
and no handle, did nothing, and returned `ok`. So a browser process still
running was recorded as released — every single time, and the recommendation
attached to `cleanup-failed` (that a process may still be running) was
suppressed in exactly the case it exists for. Fixed by releasing only what
actually closed.

## Verification

**Unit suite: 555 tests, all passing, no browser required.** The nineteen new
tests in `tests/phase47-migration.test.mjs` provoke driver failures through the
shared session using a stub launcher. That is deliberate: a live browser cannot
be made to crash a renderer or exhaust memory to order, and a suite that waited
for one to happen would be a suite that skipped.

**Live smoke: 12 of 12 checks passing** — `docs/live-smoke-report.md`, produced
by `node tools/live-smoke.mjs` against the fixture server with a real Chromium.
It is kept out of `node --test tests/` on purpose. It needs a server and a
browser, and a unit suite that silently skips when neither is present reports
green for work it did not do.

Differential evidence that migration did not change what is observed:

| Artifact | Result |
| --- | --- |
| `fid-equiv-1440.raw.json` | identical to the pre-migration golden apart from timestamps |
| `hashed-1440.raw.json` | identical in structure and coverage; class names differ because that fixture regenerates them per build |
| `reference-1440.json` (11 state records) | all eleven byte-identical |
| `fixture-1280.png`, `fixture-480.png` | byte-identical PNGs |
| `truth.json`, both screenshot captures | identical |

## What this does not establish

- **Nothing is claimed about a site other than the local fixtures.** The live
  smoke targets are all served from `fixtures/`.
- **No threshold is validated by this phase.** Migration changed how captures
  execute and what they record about themselves; it did not calibrate anything.
- **Most of the sixteen typed failures have never occurred against a real
  browser.** They are reachable on demand against a stub and are tested there.
  A policy that has been exercised in a test is not a policy that has been
  observed in the field.
- **Authenticated capture remains out of scope**, and no tool acquires the
  ability to bypass a consent gate, a CAPTCHA, or a bot check.
- **Component-level automatic correction remains blocked** by `def_0030`, which
  this phase does not touch.

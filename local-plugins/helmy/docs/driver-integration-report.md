# Driver integration — which policies now govern what

Companion to `capture-migration-report.md`. That report says what moved; this
one says, for each recovery policy, whether it now governs real capture
execution and by what evidence.

The distinction being drawn throughout: **reachable** means the failure can be
provoked through a migrated tool's own code path (against a stub adapter, which
is how a renderer crash is made to happen on demand); **observed live** means it
has actually occurred against a real browser during this phase. Almost none have
been observed live, and that is the honest state — a policy exercised in a test
is not a policy that has been seen in the field.

## Where the boundary now sits

```
tool  →  withCaptureSession  →  CaptureSession.run  →  RecoveryManager  →  driver op
                                       │
                                       └── appends every attempt, failed or not
```

There is no other path. `tests/phase47-migration.test.mjs` asserts, statically,
that no file under `src/`, `tools/` or `bin/` imports Playwright by any of the
three forms (static, dynamic, CommonJS) or calls `chromium.launch` — the dynamic
form matters most, because the adapter itself uses `await import("playwright")`
and a tool that copied that line would have slipped past a static-only check.

## Policy coverage

| Error | Retry / new context | Reachable through a migrated tool | Observed live |
| --- | --- | --- | --- |
| `startup-failed` | 2 / yes | yes — test 5 | no |
| `browser-unavailable` | yes / yes | yes — via `#page` lookup after a failed recreate | no |
| `navigation-timeout` | 1 / no | yes — test 6, and the retry's failed attempt is asserted present | no |
| `network-failure` | 2 / no | yes — test 7 | **yes** — live smoke, unreachable target, 6 attempts / 3 failed |
| `page-error` | 1 / yes | yes — test 9, second `newContext` asserted | no |
| `script-injection-failed` | yes / yes | yes — def_0033 test | no |
| `screenshot-failed` | yes / no | yes — stub `screenshot` | no |
| `selector-not-found` | no / no | yes — state capture returns `available: false`, never a mismatch | **yes** — `hover:untriggerable` in every state run |
| `state-trigger-failed` | yes / no | yes — `session.triggerState` | no |
| `font-timeout` | 1 / no | yes — test 8, degrades rather than aborts | no |
| `asset-timeout` | 1 / no | yes — test 8 | no |
| `viewport-invalid` | no / no | yes — the adapter range-checks before opening a context | no |
| `authentication-required` | no / no | no | no |
| `content-not-ready` | yes / no | yes — `waitForDomReady` | no |
| `cleanup-failed` | 1 / no | yes — def_0034 test | no |
| `unknown-driver-error` | 1 / yes | yes — any unclassified throw | no |

`authentication-required` is unreachable by design: no tool authenticates, and
none is going to. It remains in the table so its absence is a recorded fact
rather than an omission.

## The ten integration scenarios

| Scenario | Behaviour through the migrated path |
| --- | --- |
| Browser will not start | Run is `blocked`, never `failed`-with-empty-results. The startup policy retries and every attempt is in the history. |
| Navigation times out | Retried; the failed attempt survives beside the successful one, and the run carries a warning so it does not read as clean. |
| Navigation never succeeds | `blocked`, and the tool returns `null` rather than an empty result that would read as a finding. Other viewports may continue. |
| Fonts never settle | Degrades. The capture still holds; `readiness.fontsReady` is `false` and `font-timeout` is recorded as its own typed failure rather than folded into a boolean. |
| Network never idles | Same shape: `readiness.networkIdle: false`, `asset-timeout` recorded. |
| Renderer crashes | Context is recreated, init scripts are re-applied to the new page, the retry runs there. The crash is recorded once, in full. |
| Operation never recovers | Every attempt is preserved; the run is `completed-with-warnings` and the error carries its recommendation. |
| Repair itself fails | Refused and recorded rather than retried into an unbounded loop (def_0033). |
| Cleanup fails | Recorded beside the earlier failure, never in place of it, and only what actually closed is forgotten (def_0034). |
| Artifact written on a retry | Written to `name.attempt-2.json`; the first attempt's partial evidence is never overwritten. |

## Staleness in the real path

`stalenessRecord()` maps the capture contract onto what the ten freshness checks
read. Before it existed the checks ran against real captures and returned eight
of ten `unverifiable`, which the roll-up treated as passing — the modules had
been built apart and never joined. With it, a real pair leaves nothing
unverifiable, an extractor difference is `incompatible` and refuses comparison,
and a driver difference is `stale` and asks for recapture.

The two verdicts are kept apart deliberately. `incompatible` means the two
captures measured different things and re-running the driver would not help;
`stale` means the same question may now answer differently. Collapsing them
would turn "recapture" into "give up", or worse, the reverse.

## Limits

- Thirteen of the sixteen policies have never fired against a real browser. They
  are reachable and tested; they are not field-observed.
- The live smoke suite targets local fixtures only.
- Nothing here calibrates a threshold or licenses automatic correction.

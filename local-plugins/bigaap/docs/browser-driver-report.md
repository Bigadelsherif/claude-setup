# Browser-driver abstraction — Phase 4.6

**536 tests passing, 0 failing** — 29 new.

## 1. The separation

The fidelity layer depends on `BrowserDriver` and never on Playwright. That is
asserted rather than intended: a test walks every `.mjs` under `src/` and fails
if any file except the adapter imports Playwright.

```
src/driver/interface.mjs         30 operations, normalized envelope, adapter verification
src/driver/errors.mjs            16 typed categories + Playwright classification
src/driver/playwright-driver.mjs the ONLY file that may import Playwright
src/driver/recovery.mjs          20 recovery policies, append-only attempt history
```

Playwright is imported **lazily** inside the adapter, so the interface, the
recovery manager and all 29 tests run in an environment with no browser
installed. The adapter takes an injectable launcher, which is how every failure
is provoked on demand — half of them cannot be triggered reliably against a live
Chromium.

## 2. The result envelope

Every operation returns the same shape, success or failure:

```
operation, status, value, error, errorCode, targetUrl, viewport, state,
startedAt, completedAt, durationMs, retryCount, evidenceIds, meta
```

`durationMs` is computed from the timestamps rather than supplied, so a caller
cannot report a duration that disagrees with its own clock. A caller reads
`status` and `error.code`; it never matches on a vendor exception type.

## 3. Typed errors

Sixteen categories, none collapsed. Recovery branches on the category, so "the
browser would not start" and "the selector was not found" have to be different
things — one warrants a fresh context and a retry, the other warrants neither
and is not a driver failure at all.

An unrecognised message becomes `unknown-driver-error` with the original text
preserved on `cause`, rather than being forced into a neighbouring category. A
wrong category routes recovery wrongly, which is worse than admitting the error
is unclassified. A `DriverError` constructed with an invalid code degrades to
`unknown` and keeps the attempted code on `declaredCode`.

## 4. Unsupported is not silence

`setDevicePixelRatio` returns `unsupported` with a stated reason: Chromium fixes
device scale when the context is created and it cannot be changed on a live
page. Declaring this matters — a caller who believes a 2x capture was taken will
draw conclusions the evidence cannot support, and the equivalent-content gate
already refuses to compare a 1x screenshot against a 2x one.

## 5. Capabilities and identity

A driver declares what it can do and stamps its identity onto artifacts:

```
{ driverName: "playwright-chromium", driverVersion: "0.1.0", capabilities: [...] }
```

`verifyAdapter` confirms an adapter implements all 30 operations before it is
trusted.

## 6. Limitations

1. **One adapter.** Chromium via Playwright. No Firefox, WebKit, or remote
   provider — out of scope by instruction.
2. **The adapter is exercised through a stub launcher**, not a live browser, in
   the test suite.
3. **The capture tools still call Playwright directly.** `capture-playwright`,
   `intrinsic-checks`, `capture-states` and the rest predate the interface and
   live outside `src/`. Migrating them is real work that was not in scope here;
   the isolation test covers `src/` only, and says so.
4. **Authenticated capture is not implemented.** `authentication-required` is a
   typed, non-retryable error whose recommendation states that credentials are
   never handled by the loop.
5. **No production-readiness claim.** Asserted by test against the policy text.

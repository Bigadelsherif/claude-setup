# Live smoke capture — Phase 4.7

Run 2026-08-20T18:40:01.419Z against `http://localhost:4174`, with a real Chromium through the migrated tools.

**12 of 12 checks passed.**

This exercises the migrated capture path end to end on the local fixtures. It is
evidence that the tools still capture what they captured before the migration and
that the contract they emit is populated from a real driver. It is not evidence
about any site other than these fixtures, and it does not establish that any
threshold is calibrated.

| Check | Result | Detail |
| --- | --- | --- |
| full extraction matches the pre-migration golden | pass | byte-identical apart from timestamps |
| def_0032: motion tokens survive the capture | pass | transition duration/easing/property over 25/25/25 elements |
| def_0032: the apparatus is not counted as the page's own stylesheet | pass | 1 sheet(s), golden 1 |
| the full extraction emits a populated capture contract | pass | status completed, 19 attempt(s) |
| all eleven state records match the pre-migration golden | pass | 11 states |
| state capture stamps the driver on the artifact | pass | playwright-chromium@0.1.0 |
| the tap-target policy reaches the real capture | pass | wcag-2.2-aa at 24px |
| intrinsic checks emit a populated capture contract | pass | 76 elements |
| the responsive probe reads a different page at a different width | pass | nav row at 1440, column at 375 |
| an unreachable target is recorded rather than thrown | pass | blocked: network-failure |
| the failed attempts survive in the artifact | pass | 6 attempt(s), 3 failed |
| the artifact carries a recommendation, not just a code | pass | The target was unreachable. Confirm it is running before re-running this viewport. |

## What this does not cover

- Third-party sites. Every target here is a local fixture served over HTTP.
- Authenticated pages, which remain out of scope by policy.
- Most of the sixteen typed driver failures. They are provoked against a stub in
  `tests/phase47-migration.test.mjs`, because a live browser cannot be made to
  crash a renderer or exhaust memory on demand — a suite that waited for one to
  happen would be a suite that skipped.

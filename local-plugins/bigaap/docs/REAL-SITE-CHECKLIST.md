# Real-site test checklist

Fixed **before** the first real-site run, so the run cannot be graded against
criteria invented after seeing the results.

**Target:** `https://stripe.com/pricing`
**Mode:** forensic analysis only. No implementation, no fidelity loop.
**Brand policy:** analysis target only. No logo, wordmark, brand name, marketing
copy, photography, illustration, or licensed font enters any generated output.

## Rule of the run

> Record failures first. Propose changes second. Do not silently fix a heuristic
> mid-run.

A heuristic that misbehaves is data. Patching it while the run is in flight
destroys the evidence of how the Phase 0 code actually generalises, which is the
entire purpose of the exercise.

Infrastructure changes needed to physically reach the page (CORS on the local
capture sink, for example) are not heuristic changes and are noted where made.

## Checks

| # | Check | Pass condition | Result |
|---|---|---|---|
| 1 | Cross-origin stylesheet access fails gracefully | `.cssRules` throws are caught; sheet URLs recorded in `coverage.sheetsBlocked`; no crash | **PASS** — 50 blocked, all recorded, no exception |
| 2 | Hashed/generated class names do not crash the repeat-group heuristic | Extractor completes; repeat groups detected or absent, never an exception | **PASS, not exercised** — Stripe uses BEM; only CSS filenames are hashed |
| 3 | Consent banners and overlays detected and recorded | Any consent/overlay element identified and reported in the run notes | **PARTIAL** — no banner served; 2 overlays found by diagnostics, extractor reported only 1 |
| 4 | Dynamically loaded content identified | Node count before/after settle recorded; late-loading regions noted | **PASS** — 25 scroll passes, 0 nodes added, recorded |
| 5 | CSS custom properties extracted when accessible | Declared properties captured from reachable sheets, with scope | **PASS** — 1065 captured |
| 6 | Inaccessible CSS rules marked unknown, not guessed | Every blocked sheet produces an `unknown` entry with a reason | **PASS** — 50 reasoned unknowns |
| 7 | Screenshot-derived values not marked exact | No `estimated` claim renders as an exact measurement (V4) | **PASS, vacuous** — zero `estimated` claims produced |
| 8 | Painted backgrounds distinguished from transparent wrappers | `paintedSurface` resolves to a background-painting node; `paints` flag correct | **PASS** — 7 of 13 resolved to a non-root descendant |
| 9 | `margin: auto` does not pollute the spacing histogram | No used-value auto margin appears as a spacing step | **PASS** |
| 10 | Fractional values not silently rounded | Sub-0.05px drift snaps and is recorded; real fractions preserved | **PASS** — 16.5px and 1.385 preserved |
| 11 | Every important claim retains an evidence reference | V3 passes; no measured/observed/inferred claim without `[ev_*]` | **PASS** |
| 12 | IR validates when values are unavailable | V1 passes against `ir.schema.json` despite missing categories | **PASS** — 54 unknowns, categories absent, still valid |
| 13 | Spec separates the five statuses clearly | Each status visually distinct and correctly applied | **PASS** |
| 14 | Output claims no more fidelity than the evidence supports | Confidence reflects real provenance; unknowns surfaced, not buried | **FAIL** — 0.71 confidence at 6.7% coverage |

**Score: 12 pass, 1 partial, 1 fail.** Checks 2 and 7 passed without being
genuinely exercised and must not be counted as validated. Full analysis in
[REAL-SITE-FINDINGS.md](REAL-SITE-FINDINGS.md).

## Artifacts this run must produce

- captured evidence (`raw/`, `analysis/evidence-map.json`)
- real-site IR (`analysis/ir.json`)
- `output/design-spec.md`
- `output/rebuild-prompt.md`
- extractor warnings
- unknowns report
- heuristic failures
- correction candidates
- comparison against the controlled fixture

## Comparison axes against the fixture

| Axis | Fixture baseline |
|---|---|
| Stylesheets accessible | 1 of 1, 0 blocked |
| Nodes sampled | 76 of 76, no truncation |
| Custom properties | 25 |
| Repeat groups | `article.card` ×6 |
| Overall confidence | 0.75 |
| Unknowns | 3 |
| Validation | 0 errors, 0 warnings |
| Container | 1180px measured |
| Spacing base | 8px, 88% coverage |
| Painted-surface resolution | correct via probe |

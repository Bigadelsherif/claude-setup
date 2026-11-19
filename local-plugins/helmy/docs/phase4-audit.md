# Phase 4 audit

Run 2026-08-17T17:57:21.504Z. Every check reads the code or the artifacts; none is asserted in prose.

**21 of 21 checks passed.**

| # | Invariant | Result | Evidence |
| --- | --- | --- | --- |
| 1 | no direct browser launch exists outside the adapter | pass | 180 source files checked |
| 2 | all capture paths use the shared session | pass | 14 capture tools + the CLI |
| 3 | every output is hashed from the bytes actually written | pass | CLI results, capture artifacts and iteration files all hash the serialised body |
| 4 | stale outputs are rejected rather than compared | pass | verifyFreshness refuses; the CLI maps a non-fresh verdict to `blocked`; the contract adapter feeds it real captures |
| 5 | blocked runs emit no categories and no implementation prompt | pass | blockedReport emits no scores; runViewport returns categories: null; the CLI records promptsEmitted |
| 6 | partial viewport results are represented as partial, not averaged | pass | one blocked viewport downgrades the roll-up to completed-with-warnings and is listed by width |
| 7 | a state that cannot be induced stays unknown, never a mismatch | pass | six state statuses; the CLI returns `undetermined` readiness with the reason preserved |
| 8 | independent-content mode disables comparative residue rather than thresholding it | pass | the mode returns comparativePixelAllowed: false and says why |
| 9 | intrinsic checks remain a separate category from comparative pixel residue | pass | `intrinsic-visual` and `comparative-pixel-residue` are distinct categories |
| 10 | no composite fidelity score exists, in code or in any emitted artifact | pass | no computed composite in 180 sources; null in all 402 artifacts |
| 11 | no tolerance is marked validated without evidence | pass | TOLERANCES.$validated = false; the calibration report records why |
| 12 | the tap-target policy is explicit, configurable and travels onto every artifact | pass | wcag-2.2-aa, apple-hig, material-3 · default apple-hig (44px) |
| 13 | no defect is quietly closed: two stay open, one is a decided permanent limitation | pass | open: def_0020, def_0022, def_0048 · def_0030 permanent-limitation on 2 witness(es) · 55 total |
| 14 | no unsupported readiness claim appears in the documentation | pass | 88 documents checked, per sentence |
| 15 | all fifteen readiness decisions exist and each names its basis and limits | pass | 15 decisions |
| 16 | blocked and failed carry different exit codes | pass | blocked=3, failed=1, not-attempted=5 |
| 17 | every typed driver failure is classified in the observation ledger | pass | 10 observed, 1 unreachable by design, 5 unobserved, of 16 |
| 18 | authentication-required is recorded as unreachable by design, not as an unobserved failure | pass | classified unreachable-by-design, attempted=false |
| 19 | tolerance status is per entry, and the global flag is derived from it | pass | 17 entries · 2 validated · colorDistance blocked-on-definition · $validated=false |
| 20 | def_0030 is a permanent limitation on two witnesses, with its containment intact and the bar unmoved | pass | status permanent-limitation · recall 0.5 vs bar 0.6 · automatic correction still not-usable: true |
| 21 | every defect appears in the rendered log, whatever its status | pass | 55 defect(s), 3 distinct status(es) |

Re-run with `node tools/phase4-audit.mjs`. It needs no browser and no server.

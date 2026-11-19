# M2a motion observation — real browser suite

Run 2026-08-16T16:56:34.370Z against `http://127.0.0.1:4175` with real Chromium, 1 consecutive run(s).

**14 of 14 checks passed.**

Separate from `tools/live-smoke.mjs`: different port, lock, fixture and
comparison model. This suite compares CLASSIFICATIONS, never bytes —
timestamps differ every run by definition.

| Check | Result | Detail |
| --- | --- | --- |
| run 1: #real-scroll observed a runtime change | pass | changed: opacity, transform |
| run 1: #real-scroll trigger VERIFIED against its control | pass | verified · control no-change |
| run 1: #decoy-autoplay NOT classified as scroll-triggered | pass | unverified · same-change |
| run 1: #decoy-autoplay runtime change RETAINED despite failed attribution | pass | class observed-runtime, changed 2 |
| run 1: intersection entry observed | pass | changed: opacity, transform |
| run 1: intersection entry trigger VERIFIED | pass | verified · no-change |
| run 1: #static-control produced no runtime change | pass | changed: 0 |
| run 1: cleanup after success | pass | focus true · apparatus true · scroll true |
| run 1: no apparatus marker remains | pass | 0 remaining |
| run 1: reduced-motion untouched reports null | pass | null |
| a bad selector is reported as a failed envelope, not a throw | pass | envelope failed: true |
| a mid-protocol throw still runs cleanup | pass | threw true · apparatus true · scroll true |
| cleanup after failure removed the apparatus | pass | true |
| classifications identical across 1 runs | pass | stable |

## What this does not cover

- Stagger, animation-progress series, video, reduced-motion comparison — all
  outside M2a and not inferred from what it does sample.
- Any site other than this fixture.
- Timing thresholds are not calibrated; a nondeterministic observation is
  classified `unverified` rather than resolved by loosening one.

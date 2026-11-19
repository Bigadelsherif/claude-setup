# CLI smoke — Phases 4.8 through 5.3

Run 2026-08-18T14:44:28.010Z against `http://localhost:4174`, driving `bin/bigaap.mjs` as a child process
with a real Chromium and the local fixtures.

**96 of 96 checks passed.**

Each scenario asserts on the emitted result contract and the process exit code,
not on the prose. The contract is the interface; a test that read the prose would
pass while the interface broke.

| Check | Result | Detail |
| --- | --- | --- |
| session starts and records its versions | pass | driver driver playwright-chromium@0.1.0 |
| the session records that no tolerance is validated | pass | tolerancesValidated=false |
| 1. reference analysis completes and returns the full contract | pass | reference @ 1440px · 76/76 nodes · 22 attempt(s) |
| 1b. the reference carries an IR hash and a lock | pass | ir 69917725265b707c |
| 1c. the reference capture preserves its attempt history | pass | 22 attempt(s) |
| 2. target capture completes and hashes every artifact | pass | 4 hashed artifact(s) |
| 3. multi-viewport capture reports each viewport separately | pass | 1440:completed 375:completed |
| 3b. a partial viewport result is represented as partial, not averaged | pass | no viewport blocked in this run |
| 4. hover state is induced on both sides | pass | reference changed=true target changed=true |
| 4b. an un-inducible state stays unknown rather than becoming a mismatch | pass | selector-not-found · readiness undetermined |
| 7. intrinsic checks run on each side independently | pass | target 15 finding(s), reference 15 |
| 7b. the tap-target policy is explicit on the result | pass | apple-hig |
| 7c. the tap-target policy is configurable and travels onto the session | pass | wcag-2.2-aa at 24px |
| 5. equivalent-content comparison completes and names its mode | pass | mode equivalent-content |
| 5b. no composite score is produced | pass | compositeScore is null and absent from the contract |
| 5c. a category with no evidence scores null, never zero | pass | 3 null score(s) |
| 5d. the result states that no threshold is validated | pass | thresholdsValidated=false |
| 6. independent-content comparison completes | pass | mode independent-content |
| 6b. independent content DISABLES comparative pixel residue rather than thresholding it | pass | comparativePixelAllowed=false |
| 6c. the residue category reports null, not a passing score | pass | residue score null |
| 8. correction tasks are generated from the latest iteration | pass | 1 task(s) |
| 8b. every task is manual; nothing is applied automatically | pass | automatic=false |
| 9. a matched pair of fresh captures is reported comparable | pass | All ten freshness checks pass. |
| 9b. a capture outside the freshness window is BLOCKED, not failed | pass | exit 3 · capture-timestamp |
| 9c. an extractor-version difference is `incompatible`, not merely stale | pass | The two artifacts were produced by different versions and measured dif |
| 10. recovery history is readable across every capture in the run | pass | 109 attempt(s) over 7 capture(s) |
| 10b. the history is on the contract, not only in the log | pass | recoveryHistory populated |
| 11. an unsafe reference BLOCKS the comparison | pass | exit 3 · reference-unsafe-for-mode, reference-primary-region-unreached |
| 11b. the target is never started for a blocked reference | pass | targetStarted=false |
| 11c. a blocked comparison emits no categories and no implementation prompt | pass | no categories, no tasks, no prompts |
| 11d. blocked carries its own exit code, distinct from failed | pass | exit 3, not 1 |
| 11e. no task is derived from a blocked comparison | pass | exit 3 |
| 12. an unreachable target is blocked, with its reason recorded | pass | network-failure |
| 12b. the failed target still wrote its attempt history | pass | 7 failed attempt(s) |
| 12c. the reference evidence is untouched and still verifies | pass | reference IR intact |
| 12d. a missing target produces no score for the pair, rather than a score of zero | pass | exit 5 · not-attempted |
| 12e. artifact validation still passes on the surviving reference | pass | 2/2 artifact check(s) passed |
| 13. a re-run appends a new iteration rather than reusing one | pass | 1 -> 2 |
| 13b. every earlier iteration still matches its recorded hashes | pass | 2/2 verified |
| 13c. an interrupted iteration directory is never overwritten | pass | wrote iteration 4 instead |
| 14. every artifact matches its hash and carries its provenance | pass | 10/10 artifact check(s) passed |
| 14b. a changed artifact fails validation rather than passing quietly | pass | exit 1 · iteration 1: content changed |
| 15. readiness reports fifteen separate decisions | pass | 15 decisions |
| 15b. there is no single overall verdict | pass | no overall field |
| 15c. production use is not-usable and says why | pass | No threshold is validated as a whole; driver failures observed against |
| 15d. authenticated targets are not-usable | pass | not implemented, by design |
| 15e. automatic global-value correction is not-usable while def_0030 is open | pass | blocked by def_0030 |
| 15f. every decision names what it rests on | pass | all fifteen carry a basis |
| every command returns the full contract and exits on its own code | pass | 6 commands checked |
| a command with nothing to do returns not-attempted, never a success | pass | exit 5 |
| 16. every approved command appears in help | pass | 16 commands listed |
| 16b. every approved command is reachable from the binary | pass | all reachable |
| 16c. an unknown command exits 1 and suggests the nearest name | pass | exit 1 |
| 16d. an unimplemented command is labelled as such, and none is mislabelled | pass | all 16 implemented |
| 17. a missing target brief is requires-user-input with exit 6 | pass | exit 6 · requires-user-input |
| 17b. and it says what the user must supply, without inventing one | pass | Pass --brief. a path is required — write `input/target-brief.json` in  |
| 17c. a malformed target brief fails validation with exit 1 | pass | exit 1 · failed |
| 17d. a valid analyze run completes and carries the IR hash | pass | 8 artifact(s) · IR 9e68c093024c2e1d |
| 17e. an invalid mode fails with exit 1 and lists the real modes | pass | exit 1 |
| 18. blockers reports findings on a completed result | pass | exit 0 · feasible false |
| 18b. blockers names the missing brief and what to do about it | pass | target-brief-missing |
| 18b2. a malformed brief is a different blocker from a missing one | pass | target-brief-invalid |
| 18c. blockers did not launch a browser, and returns fast enough to prove it | pass | browserLaunched=false in 156ms |
| 18d. an authenticated request is refused as impossible for this input | pass | Authenticated capture is not implemented and is not planned. |
| 18e. a feasible mode reports no blockers but still lists the standing limitations | pass | 3 limitation(s) recorded |
| 19. init creates a project and launches nothing | pass | exit 0 · 7 file(s) |
| 19b. every declared configuration file exists | pass | 7 files |
| 19c. the project directories exist and are empty | pass | 5 directories, all empty |
| 19d. the target brief is an explicit template, not a plausible brief | pass | $status=incomplete |
| 19e. init is idempotent: a re-run creates nothing and preserves everything | pass | created 0, preserved 7 |
| 19f. an unimplemented stack adapter is refused, never substituted | pass | exit 1 |
| 19g. an unusable project name is refused with its reason | pass | Pass --name with a usable name. It is refused rather than sa |
| 19h. blockers reports the incomplete brief rather than a missing one | pass | target-brief-incomplete |
| 19i. blockers on a project still launches no browser | pass | browserLaunched=false in 142ms |
| 19j. blockers detects an uninitialized project and points at init | pass | project-not-initialized |
| 20.1 analyze with a URL reference completes and records its provenance | pass | exit 0 · 8 artifact(s) |
| 20.1b every resolved value names where it came from | pass | 13 resolved key(s) |
| 20.2 analyze accepts screenshot evidence and says the input was screenshots | pass | exit 0 · inputSource screenshots |
| 20.3 adapt with a valid brief reaches the pipeline | pass | exit 0 · completed-with-warnings |
| 20.3b the brief it used is the one that was passed, on the record | pass | argument |
| 20.4 a missing brief is requires-user-input with exit 6, not a failure | pass | exit 6 · requires-user-input |
| 20.4b nothing was invented, and no browser was started to find out | pass | no brief written |
| 20.4c the example command it prints names flags that exist | pass | bigaap adapt --workspace C:\Users\bigo_\AppData\Local\Temp\bigaap-cli-smoke\p53-ad |
| 20.5 a malformed brief fails with exit 1, distinct from a missing one | pass | exit 1 · target-brief-invalid |
| 20.6 recreate refuses screenshot-only evidence before capturing anything | pass | exit 3 · blocked |
| 20.6b and says recapturing the same kind of source would not help | pass | input-kind-inadmissible |
| 20.7 improve runs on measured evidence without demanding a brief | pass | exit 0 · completed-with-warnings |
| 20.7b improve judges against a named published standard, not a house rule | pass | apple-hig |
| 20.8 --interactive without a terminal reports rather than hangs | pass | exit 6 · interactive false |
| 20.9 a project default is actually used, and labelled as the project's | pass | stack=next-tailwind from project-config |
| 20.9b an explicit argument wins, and says what it displaced | pass | stack=html-css overrode project-config, tool-default |
| 20.10 cancelling exits 4 — its own code, not failure and not success | pass | exit 4 · cancelled |
| 20.10b it says where it stopped and what it did not attempt | pass | at briefPath |
| 20.10c a cancelled run leaves nothing half-written | pass | 0 artifact(s) |
| 20.11 preflight reports a blocking condition without launching a browser | pass | 1 blocker(s) in 200ms |
| 20.11b and every blocker carries an action the user can take | pass | capture-missing |

## What this does not cover

- Every target is a local fixture served over HTTP. Nothing here is evidence about a third-party site.
- No threshold is exercised as validated; the comparisons assert that the results say so.
- Authenticated capture is not tested because it is not implemented, and will not be.
- Blocked-reference and unreachable-target scenarios use fixtures that genuinely fail the gate
  and a port that genuinely refuses a connection. Only the version-incompatibility and
  tampered-artifact checks are constructed, and both are constructed on a COPY so the run
  under test is never edited.

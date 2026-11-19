---
name: feedback_ci_step_conclusion_lies
description: "In the HBIMT social CI, every step reports conclusion=success even when red; only the gate step's `outcome` values are truthful"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 4ab3b683-9efb-4822-be42-e8e0e76bfac1
  modified: 2026-08-12T21:42:45.785Z
---

The `Local Supabase integration` workflow marks its suite steps
`continue-on-error: true`. The GitHub API then reports `conclusion: "success"`
for those steps **even when they failed** — `conclusion` is the value after
continue-on-error is applied; `outcome` is the real result.

So listing a run's steps can show 26 green steps next to a failed run. Run 33
looked exactly like that: every step "success", only `Gate — fail if anything
above failed` red.

**Why:** reporting a run as green off the step list is how a genuinely failing
CI gets signed off. It nearly happened.

**How to apply:** to verify a run, either read the job log's gate line
(`for outcome in "success" "success" ... ; do`, ordered: integration, unit,
typecheck, lint, build, e2e) or fetch the failing suite's own output. Also
cross-check `playwright exit code: 0` and grep the log for `CAUTION`, which the
summary script emits when the JUnit counts disagree with the runner's exit code.

Unit-test totals differ between local and CI by design: several suites use
`it.each` over `git ls-files --cached --others --exclude-standard`, so each
untracked file in the working tree adds a test locally that CI does not have.
A small count difference is not a skipped test. See [[project_hbimt_social_web]].

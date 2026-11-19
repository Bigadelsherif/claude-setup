---
name: feedback-one-batch-one-push
description: "Standing rule (2026-09-17): when a task is finished, commit AND push to main without asking. Still one coherent commit per workstream; still verify the deploy after"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 4ab3b683-9efb-4822-be42-e8e0e76bfac1
  modified: 2026-09-17T17:40:42.678Z
---

**Current rule (user, 2026-09-17, appstruct):** "always push and commit to main
after you finish the task." Do not stop to ask for commit or push approval once
the work is finished and local checks pass — commit to `main` and push.

This replaces the earlier practice of presenting a diff and waiting for an
explicit push approval. What still holds from that practice:

- **One coherent commit per workstream.** Code, docs and verification land
  together; don't push half-verified "just this bit" commits mid-task. Separate
  workstreams get separate commits (they may go out in one push).
- **Finish and verify before pushing** — typecheck, lint, build, and any
  project-specific gates (e.g. appstruct's CSP hash check) must pass first.
- **Verify the deploy after pushing** rather than assuming it went out; see
  [[feedback-verify-vercel-deploy-status]] and [[feedback-ci-step-conclusion-lies]].
- Never sweep the user's unrelated uncommitted files into a commit — stage
  explicit paths only.

**Why:** the user found per-step approval requests slow; they want finished work
shipped. The batching and verification discipline is what keeps shipping without
a gate safe.

**How to apply:** at the end of a task, run the full local gate, stage only the
files the task touched, commit, push to `main`, then check the deploy and report
the SHA and result. Stop and ask only if a check fails or the change would be
destructive/irreversible beyond a normal deploy.

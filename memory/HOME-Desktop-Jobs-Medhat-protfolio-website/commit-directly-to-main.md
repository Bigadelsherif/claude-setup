---
name: commit-directly-to-main
description: "Medhat repo git rule — commit + push straight to main, but only when the user says so (since 2026-09-18)"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2a4234b9-91ae-4b26-b9cb-7639dc197d8a
  modified: 2026-09-18T09:45:24.213Z
---

No branches or PRs for the Medhat portfolio repo: when committing, commit and push straight to main and report.

**Since 2026-09-18: do NOT commit or push unless the user explicitly asks** (e.g. "push to main", "commit"). The user wants the working tree left uncommitted so they can undo any change at any time.

**Why:** solo project, live site auto-deploys from main; the user wants control over what goes live and the ability to revert work in progress.

**How to apply:** make edits, build and verify, report — then wait. Commit only on an explicit instruction, then push to main.

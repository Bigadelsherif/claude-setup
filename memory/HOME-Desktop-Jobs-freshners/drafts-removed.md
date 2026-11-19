---
name: drafts-removed
description: "Old design drafts (Hangtime, drift, cutout, v1) were deleted on 2026-10-26; only the B2B homepage remains; a zip backup exists"
metadata:
  node_type: memory
  type: project
  originSessionId: 817e6363-d6de-4c86-baee-8d28636bfb88
  modified: 2026-10-26T11:51:01.203Z
---

On 2026-10-26 the user asked to remove every old design and draft. The project now has one page (`/`, the B2B site, Drift placeholder brand). Deleted: /hangtime, /hangtime-v1, /drift, /drift-v1, /cutout routes, src/v1, their components and assets. Painted art the site still uses moved from public/hangtime to public/b2b/painted.

A full backup of the folder before the cleanup is at C:\Users\bigo_\Desktop\Jobs\freshners-backup-2026-10-26.zip (nothing was ever committed to git).

**Why:** the user wants the folder clean, with only the current design.
**How to apply:** don't recreate drafts or reference the old routes; if the user wants something from an old draft back, restore it from the zip. Card life is 30 days site-wide (research.ts DAYS).

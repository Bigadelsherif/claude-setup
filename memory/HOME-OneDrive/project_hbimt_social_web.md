---
name: project-hbimt-social-web
description: "The \"How Bad Is My Taste\" social web app is a separate codebase from the RN app; roast engine still needs porting"
metadata: 
  node_type: memory
  type: project
  originSessionId: 3577e88f-3baa-43b7-a789-3a51ca973178
  modified: 2026-08-10T00:18:55.094Z
---

"How Bad Is My Taste" now has **two** codebases:

- **RN/Expo single-player app** — `C:\Users\bigo_\OneDrive\how-bad-is-my-taste`. Owns the real deterministic roast engine (`buildVerdict`) and the `content/` copy library.
- **Social web app** — `C:\Users\bigo_\Desktop\Jobs\how bad is my taste social`, repo `Bigadelsherif/how-bad-is-my-taste-social-app`. Next.js 16 + Supabase. Scaffolded 2026-08-10.

**Why:** the user was explicit that the web app is clean and web-only — do not touch the RN app from it.

**How to apply:** the web app's roast engine is a deliberate **stub** behind `lib/roast/`'s `RoastEngine` interface; `runRoast()` is the only entry point any caller uses. Porting the RN engine + content library is a planned follow-up pass, not an oversight — don't "fix" the placeholder copy. Signal-extraction location (browser canvas vs server sharp) is still an open decision. Free-tier Supabase, consistent with [[no-spend-constraint]].

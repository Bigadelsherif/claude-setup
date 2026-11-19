---
name: vite-stale-cache-false-failures
description: "In this workspace, Vite dev-server changes often appear \"not applied\" due to stale cache/tab state — clear node_modules/.vite and open a fresh tab before diagnosing"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 9778c3b6-acd2-4bf3-9cfc-0b588dcc83b5
  modified: 2026-09-01T12:36:03.339Z
---

When a code change to a Vite project in this workspace appears not to take effect in the browser (console errors referencing removed variables/imports, or UI looking unchanged), suspect stale caching **before** suspecting the code.

**Why:** This happened repeatedly during the fotolab-site build. Symptoms included `useState is not defined` / `activeIndex is not defined` after those were legitimately removed from source, and an "Invalid hook call / more than one copy of React" error even though `npm ls react` showed React correctly deduped. In every case the source was correct and the build passed — only the browser/dev-server cache was behind.

**How to apply:** When output contradicts source that builds cleanly:
1. `preview_stop` the server
2. `rm -rf node_modules/.vite`
3. `preview_start` again and open a **fresh tab** (reusing the old tab often keeps serving the stale module graph)

Also tell the user to hard-refresh (Ctrl+Shift+R) on their end, since their browser hits the same issue — the user reported "the animation is still the same" more than once when the code had in fact changed.

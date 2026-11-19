---
description: Analyze a reference interface and generate a measured design spec plus an implementation-ready rebuild prompt.
argument-hint: <url> | ./screenshots
---

Run the UI forensics pipeline against: **$ARGUMENTS**

Load the `ui-forensics` skill and follow its workflow. In short:

1. Load `.helmy-analyzer/rules/rules-learned.md` and `preferences.md` if present.
2. Classify the input. A public URL uses the sandboxed browser; a login-gated URL
   uses the user's own Chrome session — ask them to log in, never handle
   credentials yourself. Screenshot input is not supported yet; say so plainly
   rather than producing a low-fidelity analysis dressed up as a real one.
3. Capture at 1440px. Settle lazy content, decline non-essential cookies.
4. Run **both** extraction passes — `__HELMY_EXTRACT__()` then `__HELMY_PROBE__()`.
   Pass 2 is what resolves painted surfaces; skipping it produces wrong radii on
   any site that wraps its cards.
5. POST both payloads to disk. Do not return them into your context.
6. `helmy init` → `helmy ingest` → `helmy analyze` → `helmy validate`.

Report back: the IR hash, overall confidence, the count of unknowns, and the
three claims with the lowest confidence — those are the ones worth correcting
first.

Do not claim the analysis matches the reference beyond what was measured.

---
name: live-smoke-runtime-and-process-safety
description: "Helmy live-smoke takes ~48 min and shares the machine with the user's unrelated long-running dev processes that must never be killed."
metadata: 
  node_type: memory
  type: project
  originSessionId: 7f451fd3-5d36-44b6-a634-862925c1c932
  modified: 2026-08-19T20:22:26.059Z
---

`node tools/live-smoke.mjs` normally finishes in about **25–30 seconds** (measured 0.4 min on 2026-08-19, 12/12 passed, real Chromium). It stretched to **48m22s** the same day purely under machine contention — same code, same checks, ~120x slower. Budget a generous cap (60 min) but do not treat a long run as evidence of a hang, and do not treat the long figure as the norm.

It refuses to start unless its fixture server is already answering on **port 4174** (`node tools/serve-fixture.mjs`, whose port is fixed, not a `--port` flag). A supervisor should start that server itself and stop it by its own child handle.

This machine concurrently hosts the user's **own** unrelated work: an Expo dev server, EAS Android builds, `next start`, Playwright runs, and ~18 `how-bad-is-my-taste` workers. The user's standing instruction is verbatim: "Do not kill unrelated Node, Expo, EAS, Next, or Playwright processes."

**Why:** Helmy verification and the user's day-to-day dev processes are the same `node.exe` on the same box, so any process cleanup that matches loosely, or any PID-based kill, risks destroying hours of the user's unrelated build work.

**How to apply:**
- Never treat an empty stdout log as evidence of a hang — Node block-buffers stdout when it is not a TTY, and `execFileSync` blocks the parent. Judging progress this way caused one wrong kill already.
- Do not use output-file polling as a completion condition.
- Before terminating any PID, re-verify its **command line**, not just that the PID exists — and match on the *executable plus script* (`node.exe … live-smoke.mjs`), never on the script name appearing anywhere in the text. A loose `-match 'serve-fixture'` matched the Claude Bash shells that merely quoted the script and killed the shell running the command.
- Better still, **spawn** the job so completion is the child's own `exit` event; then no pid matching is needed at all.
- A supervisor's `setTimeout` cap does **not** hold across machine sleep. An overnight run reported `timed-out` after 625 minutes on a 60-minute cap, long after the job itself had finished cleanly. Treat a wildly over-budget elapsed time as "the machine slept", not as a hang.
- Live-smoke's unreachable-target scenario reports **6 attempts / 3 failed** on a healthy run. Extra `cleanup-failed` entries (e.g. 7/7) mean the browser could not be torn down — a sign the run was disturbed, not a product regression. Re-run before concluding anything from it.
- Never let a supervisor swallow `taskkill` errors (`stdio: "ignore"` + bare `catch {}`); a liveness probe that returns `""` on query failure will also report a live process as "gone".
- Helmy's own fixture servers (`tools/serve-fixture.mjs --port 4174` / `4176`) can outlive a run and hold their port — those are safe to clean once the command line is confirmed.

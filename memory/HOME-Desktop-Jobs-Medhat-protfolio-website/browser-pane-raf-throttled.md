---
name: browser-pane-raf-throttled
description: The in-app Browser pane stalls requestAnimationFrame; GSAP/Framer animations only advance while screenshots are captured
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 21ff72a0-5645-430c-aa0f-9d49a7a4ef28
  modified: 2026-09-13T10:53:08.863Z
---

In this desktop-app session the in-app Browser pane (mcp__Claude_Browser__*) does not fire requestAnimationFrame between tool calls. GSAP timelines, Framer Motion transitions, and smooth `scrollTo` freeze mid-way and look like bugs.

**Why:** The pane only paints a frame when a screenshot is captured (rAF probe returned 0 ticks in 1.5s while the page was visible). The same code ran fine once frames were pumped.

**How to apply:** Before diagnosing a "stuck" animation, probe rAF with a short JS loop. To advance animations, batch 10 to 25 tiny screenshots (scale 0.1 to 0.15) and then take one readable capture. Use `behavior: "instant"` for programmatic scrolls in the pane. See [[portfolio-site-stack]] for the project this was found on.

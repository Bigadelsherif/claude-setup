---
name: perf-work-closed
description: Owner closed the smoothness/performance work on 2026-10-22; two optional visual trade-offs were declined for now
metadata:
  node_type: memory
  type: project
  originSessionId: d67ce5a0-81d8-4532-9934-2b829b925fe2
  modified: 2026-10-22T16:32:34.718Z
---

On 2026-10-22 the owner said the site "is working good right now, that's enough" and closed the performance round.

Left undone on purpose (offered, not wanted for now):
- drawing case-study/Contact glass at 1.25x instead of 1.5x density on basic graphics chips (slightly softer on hi-DPI screens);
- Projects title letters fading in without the per-letter blur (removes 270-410 ms hitches when the title changes).

**Why:** the owner prioritises no visible change over the last bit of smoothness.
**How to apply:** don't re-propose these unless the owner reports stutter again; if they do, start from these two, and measure on their machine with appstruct.art/?perf (the frame meter) first. Note: switching glass resolution while scrolling was tried and measured worse (canvas resizes), so don't retry that. See [[owner-choices-over-audits]].

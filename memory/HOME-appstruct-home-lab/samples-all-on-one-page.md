---
name: samples-all-on-one-page
description: "When showing design ideas/samples, put every sample on one page, all visible and running at once — never one demo with switches"
metadata:
  node_type: memory
  type: feedback
  originSessionId: d67ce5a0-81d8-4532-9934-2b829b925fe2
  modified: 2026-10-15T20:58:30.729Z
---

When the user asks for ideas and samples, every idea must be visible on the same page at the same time, each running on its own (side by side / stacked, with a label and a one-line description). Do not build a single demo where ideas are chosen with toggles or buttons.

**Why:** the user built header + page-transition samples as one demo with a control panel and said "why do I only see 1 sample — from now on put all the samples in the same page" (2026-10-15).

**How to apply:** for motion or interaction samples, give each idea its own frame (e.g. an iframe of a demo page with the idea preset by URL params) that plays itself on a loop, and lay them all out on one gallery page. Related: [[appstruct-glass-site]].

---
name: no-spend-constraint
description: "User cannot spend money on any service/plan until after an investor meeting — free-tier only, flag anything paid"
metadata: 
  node_type: memory
  type: project
  originSessionId: 897f3aa2-3479-4b47-b51b-e0a3436bc656
---

No money can be spent on any paid plan, subscription, or payment-requiring service for at least a month from 2026-07-08 (until roughly 2026-08-08), pending an investor meeting.

**Why:** budget must stay untouched until after the investor meeting closes.

**How to apply:** default to free-tier services in any recommendation (hosting, storage, APIs, tooling). Before setting up or suggesting anything that requires a paid plan or a payment method on file, stop and flag it explicitly, then offer a free-tier alternative instead — do not assume it's fine to proceed. This applies across projects, not just one specific app. Revisit/lift this constraint once the user confirms the investor meeting has passed.

Relevant to [[feedback_lowkar_design_skill_routing]] context (Lowkar/Rakib project) — e.g. the Rakib photo-upload mock storage (canvas compression + localStorage) was deliberately kept free; any future move to real cloud storage there should default to free-tier options (Cloudflare R2, Supabase Storage free tier, Vercel Blob free allotment) with limits called out explicitly.

---
name: krea-cost-and-cheap-models
description: "Krea image generation for this user - cheap models only, and state the credit cost before and after every run"
metadata:
  node_type: memory
  type: feedback
  originSessionId: c1de9efe-b7be-4c4d-9700-fa9fd6c1b517
  modified: 2026-10-22T15:46:57.215Z
---

When generating with Krea for this user: use only the cheap models, never the expensive ones (e.g. Krea 2 Turbo ~2 credits, Z Image ~3, Flux.1 Dev ~5 per image; not Nano Banana Pro, GPT Image, Seedream Pro, Flux Ultra etc.). Always tell the user the cost before generating (use the preflight quote) and the actual spend and remaining balance after.

**Why:** the user said so on 2026-10-22 while choosing an old-TV image for the Good Stuff films section ("cheap model never use the expensive ones", "always tell me the cost before and after krea").

**How to apply:** run `generate_image` with `preflight: true` first, state the per-image and total cost in the reply, then generate, then report spend + `get_balance` remaining.

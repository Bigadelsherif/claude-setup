---
name: krea-model-choice
description: "Krea for Dar Senosi: only cheap Flux Dev or Qwen 2512 without asking; any other model (upscalers, enhancers, video) needs the user's explicit yes first"
metadata:
  node_type: memory
  type: feedback
  originSessionId: d5bc7b9b-ecc7-47f9-8a82-e9caab01c290
  modified: 2026-11-07T22:54:38.686Z
---

For Krea, choose only between the cheap Flux models (e.g. bfl/flux-1-dev) and Qwen (qwen/2512), picking whichever is better at the specific task. Quote the credits before generating.

Never run any other Krea model without the user saying so first: no upscalers or enhancers (Topaz, Magnific, Krea Enhance), no video models, no premium image models. A preflight quote is fine; the generation is not. The user said this on 8 Nov 2026 after a Topaz upscale was run unasked: "never use the expensive models without me saying".

**Why:** The user wants low cost and to decide every spend beyond the cheap models themselves (asked 2026-10-28 after Z Image was used; tightened 2026-11-08 after the Topaz upscale).

**How to apply:**
- Use Flux Dev (about 5 credits at 1024²) for photoreal textures, materials and atmosphere.
- Use Qwen 2512 (about 13 credits) when the image needs legible text, dense layouts or exact composition.
- For anything else, quote it with preflight and ask; run it only after an explicit yes for that model.
- Never use AI images to depict real pieces.

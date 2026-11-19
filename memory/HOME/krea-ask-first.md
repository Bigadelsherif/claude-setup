---
name: krea-ask-first
description: Krea — ONLY ever use the cheap model (bfl/flux-2-klein); never expensive ones. Generate only when the user asks/approves
metadata:
  node_type: memory
  type: feedback
  originSessionId: 2ac9f21a-4606-4db5-bdba-f085e335473c
  modified: 2026-10-26T23:02:46.890Z
---

Only ever use `bfl/flux-2-klein` (2K, ~1–4 credits per image) for Krea generations. NEVER use expensive models (nano-banana, flux pro, ideogram, video/3D models, etc.), not even as a fallback — if Klein can't do something, solve it in code or tell the user instead. Use a style reference via `image_urls` (the cockpit painting) and pack many pieces into one sprite sheet on a #00FF00 screen, keyed locally with scripts/key_sheet.py.

Do not run Krea on my own initiative for unrelated work: only when the user asked for Krea on the task at hand (for the Hangtime homepage sections they've said "use krea" — that covers cheap Klein sheets for that work). Balance checks are fine. Report credits used afterwards.

ALWAYS tell the user the Krea cost BEFORE a task (estimate: number of Klein images × ~1 credit, plus the starting balance from get_balance) and AFTER it (actual: balance before − balance after). The user asked for this explicitly ("always tell me how will krea cost before and after the task").

Exception: when the user explicitly names a model (2026-10-26 they asked for `qwen/2512`, ~15 credits/image at 1440×816), use it — still quote the cost before and report after. Qwen 2512 is text-to-image only (no image refs).

Dar Senosi redesign (2026-10-27): user said "you can use krea flux or qwen the cheap versions if you need to make perfect drawings" — standing permission there for cheap Flux (Klein) or cheap Qwen when a drawing/illustration is genuinely needed; still quote cost before/after. Never use AI images to depict actual antique pieces or invent provenance (project "only true facts" rule) — illustrations/decor only.

**Why:** the user pays for Krea Basic (5,000 credits/month) and wants spend tightly controlled. Said "stop using krea without asking", then (2026-10-22) "always use this cheaper models", then "from now on always use the cheap model never ever use the expensive ones".
**How to apply:** Klein only, sprite sheets, report cost. Related: [[hangtime-site]]

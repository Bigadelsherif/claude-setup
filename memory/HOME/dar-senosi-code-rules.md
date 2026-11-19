---
name: dar-senosi-code-rules
description: Dar Senosi Shopify redesign — may replace/remove old code if it stays Shopify-safe; live theme untouchable
metadata:
  node_type: memory
  type: feedback
  originSessionId: d5bc7b9b-ecc7-47f9-8a82-e9caab01c290
  modified: 2026-10-26T22:40:13.791Z
---

On the Dar Senosi Shopify redesign (theme "Dar Senosi – Redesign" #156666069127, store hnnqbm-mm), the user wants old code changed or removed rather than piled up ("add, don't delete" was rejected on 2026-10-27), as long as it still works with Shopify.

**Why:** leftover/duplicate code caused real problems (CSS class clashes with Atelier, duplicate stylesheet, 37MB unused assets) and slows the site.

**How to apply:**
- Replace/delete freely within a task, but: one Git commit per task, Theme Check with no new errors, verify on local preview + hosted dev theme (desktop + mobile), report what was removed and why.
- Never rename/remove section, block, setting IDs or templates that saved theme-editor content depends on unless the content is migrated too.
- Confirm nothing references a file before deleting it; list big removals (whole sections/templates/features) for approval first.
- NEVER run `shopify theme push`/`publish` (live OR the Redesign theme) unless the user explicitly orders it in that message — user stressed this 2026-10-27. Local git commits and `shopify theme dev` (temporary dev theme) are fine; say so clearly when reporting.
- Never edit, push to or publish the live theme; shared store data (menus, pages, products, metafields, notifications) needs approval. Avoid `sed -i` in the theme folder (temp files break `shopify theme dev`).
- The user is the sole approver (no client gates, no client pack/style tile); full Arabic version is in scope; SVGs are traced from the Brand Kit in Downloads\dar snoosi rather than requested.
- Full rules live in REDESIGN-PLAN.md in the project folder. Related: [[b2b-direction]] is a different project.

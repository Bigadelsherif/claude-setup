---
name: feedback-lowkar-design-skill-routing
description: Skill routing and design philosophy for Lowkar (rakib-web) UI/UX work
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 897f3aa2-3479-4b47-b51b-e0a3436bc656
---

For Lowkar homepage/UI work, default to the `ui-ux-pro-max` skill (the non-prefixed marketplace one from `nextlevelbuilder/ui-ux-pro-max-skill`, not the `anthropic-skills:ui-ux-pro-max` built-in — confirm which is active if both are ever listed again). Only pull in other design skills when the task specifically requires them:
- `design-system` — token/component consistency work
- `brand` — messaging/positioning refinement
- `gsap-*` — animation tasks only
- `mobile-app-ui-design` — mobile-native screen design only

**Why:** User explicitly said not to over-engineer or over-stylize the homepage. Lowkar should read as a premium, *practical* automotive marketplace (Salt Flat design system — see [i18n interpolation rule](feedback_i18n_interpolation.md) for another Lowkar-specific convention) — not a heavily animated or trend-stacked design showcase.

**How to apply:** Before reaching for a secondary design/animation skill on this project, check whether the task actually needs it per the list above. Default to restraint — fewer visual effects, tighter copy, functional clarity over decoration. This mirrors feedback already given earlier in the Lowkar homepage work: cut repetition, avoid "editorial/campaign" hero treatments, keep sections functionally distinct rather than decorative.

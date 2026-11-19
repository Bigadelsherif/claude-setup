---
name: owner-choices-over-audits
description: "Site decisions the owner made deliberately; audits flag them, but don't \"fix\" them without asking"
metadata:
  node_type: memory
  type: feedback
  originSessionId: d67ce5a0-81d8-4532-9934-2b829b925fe2
  modified: 2026-10-18T15:21:19.280Z
---

On appstruct.art (repo visual-snap-craft-13), some things audits flag as problems are the owner's own choices. Keep them unless the owner says otherwise:
- The home boot splash plays in full on every load, and the page can't be scrolled while it plays (owner asked for no scrolling during the splash, Oct 2026). A hard cap (main.tsx, 7.5 s after ready) only guards slow devices.
- Mouse-wheel speed is slowed to 0.6 (SmoothWheelScroll.tsx WHEEL_MULTIPLIER), set at the owner's request on 2026-09-21.

**Why:** an audit-driven "fix" undid the owner's wishes once (wheel speed raised, then restored); the owner wants their explicit decisions kept.

**How to apply:** when an audit recommends skipping/shortening the splash, letting scroll skip it, or speeding up the wheel, keep the current behaviour, fix only the underlying bug, and mention the trade-off to the owner instead. See also [[samples-all-on-one-page]].

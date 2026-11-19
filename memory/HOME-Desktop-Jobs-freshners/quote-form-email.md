---
name: quote-form-email
description: "Quote form sends through Resend to the client's inbox; since 2026-11-04 the user wants that address shown openly in the footer and structured data"
metadata:
  node_type: memory
  type: project
  originSessionId: 817e6363-d6de-4c86-baee-8d28636bfb88
  modified: 2026-11-01T20:03:11.967Z
---

The quote form posts to `/api/quote`, which emails the inbox in the server env var `QUOTE_TO` through Resend (`RESEND_API_KEY`, optional `QUOTE_FROM`). As of 2026-11-01 the key is blank until the user signs up at resend.com with that same inbox address, so the form shows a failure message with the phone number, never a false thank you.

**Why:** the user said to connect the email "but dont write it in the website". The phone +20 122 242 5273 is public and lives in `design.ts`. Without an own domain, Resend only delivers to the account owner's address.

**Changed 2026-11-04:** once the site moved to promoscent.net the user asked for the email to be shown on the site. It's EMAIL in content/brand.ts, written out in the footer, in the JSON-LD and llms.txt. The earlier 'never on the site' rule no longer applies; QUOTE_TO itself still stays in env.

**How to apply:** keep QUOTE_TO in env (`.env.local`, gitignored, and the host's settings). Never send a real test email to the client's inbox: test with a stand-in for Resend. The hosting must run server code, a static-only host won't do.

Related decisions that day: 80 organisations and 9 countries removed, European standards kept, minimum order 1,000, calculator claim reworded to time beside people, not attention. See [[brand-direction]].

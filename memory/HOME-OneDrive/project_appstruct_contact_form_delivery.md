---
name: project-appstruct-contact-form-delivery
description: "Appstruct's contact form delivers via Web3Forms and needs VITE_WEB3FORMS_KEY set, or it tells visitors to email instead"
metadata: 
  node_type: memory
  type: project
  originSessionId: d67ce5a0-81d8-4532-9934-2b829b925fe2
  modified: 2026-08-10T20:29:36.041Z
---

The Appstruct contact form's delivery lives in `src/lib/sendContact.ts`, not in
the page. It picks a transport at build time:

- **`VITE_WEB3FORMS_KEY` set** → posts to `https://api.web3forms.com/submit`.
  This is the path that works on Lovable, which cannot run a serverless
  function. Free tier is 250 submissions/month; the key is public by design
  (it only permits submitting to that one form).
- **unset** → posts to `/api/contact`, which is correct on Vercel and reports
  `"unconfigured"` on Lovable.

**As of 2026-08-10 the key is NOT set, so the live form does not deliver** — it
tells visitors to email `appstruct.art@gmail.com` and keeps their text in the
form. That is deliberate: the previous code showed "Message sent!" and silently
discarded every message, because Lovable answers `POST /api/contact` with
`200 text/html`. See [[project-appstruct-hosted-on-lovable]].

**Why:** the invariant that matters is *a 200 alone never means delivered*. The
success branch requires the body to parse as JSON **and** carry `{ok:true}`
(own endpoint) or `{success:true}` (Web3Forms). Anything else routes to a
visible failure. Loosening that check re-introduces silent data loss.

**How to apply:** to make the form actually send, get a key from
https://web3forms.com (enter the destination address, no account needed), set
`VITE_WEB3FORMS_KEY` in the Lovable project's environment variables, and
republish. `api/contact.ts` is kept on purpose — it is the stronger endpoint
(zod validation, rate limiting, HTML escaping) and resumes working on any host
with a serverless runtime.

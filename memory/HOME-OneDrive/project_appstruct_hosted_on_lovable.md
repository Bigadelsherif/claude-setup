---
name: project-appstruct-hosted-on-lovable
description: "appstruct.art MOVED from Lovable to Vercel (~2026-08-24): www is canonical, vercel.json is live, pushes to main deploy — plus the Linux-CRLF CSP trap and dual-lockfile risk"
metadata:
  node_type: memory
  type: project
  originSessionId: d67ce5a0-81d8-4532-9934-2b829b925fe2
  modified: 2026-09-17T10:09:10.822Z
---

**Superseded history:** until ~2026-08-23 `appstruct.art` (repo `visual-snap-craft-13`)
was served by **Lovable** (`Server: cloudflare`, no `x-vercel-*`), so `vercel.json`
was inert and `api/contact.ts` never ran. The slug keeps "lovable" only so existing
`[[links]]` still resolve — **that is no longer true.**

**Current (verified 2026-08-24):** the site is on **Vercel**.
- `https://www.appstruct.art` is canonical; apex `appstruct.art` 308-redirects to www.
  `SITE_URL`, sitemap, robots and JSON-LD `@id`s all use www.
- `vercel.json` is **live**: CSP, HSTS, Permissions-Policy and cache rules are served,
  and pushes to `main` deploy. Deployment Protection is on for preview URLs
  (anonymous curl gets 302 → vercel.com/login; inspect previews in the user's
  logged-in Chrome instead).
- SPA fallback needs the `rewrites` `/(.*)` → `/index.html`; filesystem still wins,
  so sitemap.xml/robots.txt keep their real content types.

**Why:** two traps cost real time and are not obvious from the code.
1. **CSP hash vs line endings.** `vercel.json` pins the inline boot script by sha256.
   Vercel builds on Linux from the LF git blob; a Windows checkout has CRLF, so
   `npm run csp-hash` printed a hash that broke production (permanent boot splash:
   script blocked, so even its 8s failsafe never ran). Fixed with `.gitattributes`
   `index.html text eol=lf`. If the splash ever hangs again, hash the bytes the
   *browser* parsed (crypto.subtle on the live page), not a local file.
2. **Dual lockfiles.** Repo has both `bun.lockb` (untouched since 2026-07-15) and
   `package-lock.json`; bun is not installed locally. No dependency has been added
   since, so nothing proves a new package survives the Vercel install — prefer
   dependency-free solutions or resolve the lockfile question first.

**How to apply:** check which host serves the domain before any header/API work
(it has changed once). Never claim a deploy is "still propagating" — verify via the
live bundle or headers, and see [[feedback-verify-vercel-deploy-status]]: a failed
build silently keeps serving the last good deploy. Contact delivery still needs a
build-time key: [[project-appstruct-contact-form-delivery]].

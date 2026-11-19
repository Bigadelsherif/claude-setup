---
name: medhat-custom-domain
description: "The Medhat Soody site's canonical address is https://medhatsoody.art (SITE_URL switched 2026-09-18)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2a4234b9-91ae-4b26-b9cb-7639dc197d8a
  modified: 2026-09-18T16:42:51.515Z
---

Canonical address is https://medhatsoody.art: SITE_URL in src/i18n/paths.ts and the robots.txt sitemap line were switched on 2026-09-18 (commit 82b84b7). medhat-soody.vercel.app still serves and redirects; as of 2026-09-18 that redirect was 307 and the user was asked to make it 308 (permanent) in Vercel → Domains.

**Why:** canonical links, sitemap, OG images and JSON-LD all derive from SITE_URL; one declared address keeps Google from splitting rankings.

**How to apply:** audit/SEO checks should run against medhatsoody.art. If a live check still shows a 307 from vercel.app, remind the user about the 308 setting.

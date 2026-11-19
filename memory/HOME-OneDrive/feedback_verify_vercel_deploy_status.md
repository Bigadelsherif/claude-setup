---
name: feedback-verify-vercel-deploy-status
description: "Don't infer Vercel deploy success from a fixed wait + page content — verify explicitly, since a silently-failed build serves the last-good deployment indefinitely and looks identical to a caching issue"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 897f3aa2-3479-4b47-b51b-e0a3436bc656
  modified: 2026-09-30T18:47:08.714Z
---

After pushing to a Vercel-connected repo, waiting ~90s and then checking whether new content appears on production is NOT sufficient to confirm the deploy succeeded. A **failed build silently keeps serving the last successful deployment** — from the outside, this looks exactly like a stale-cache problem (old content, `age` header climbing indefinitely), not a build failure. On 2026-07-13, several rounds of "why isn't this live yet" investigation (redirects 404ing, dealer console changes not appearing, chat disclaimer unchanged) were misdiagnosed as a Vercel edge-caching quirk across multiple pushes, when the real cause was that **every deploy since some point that day had been failing** (a function exceeded Vercel's 250MB uncompressed size limit) — nothing pushed since the last good deploy was actually live. The user had to point this out directly with the actual Vercel error message.

**Why:** Time-based waiting + content-diffing can't distinguish "still building" / "cache hasn't rotated" / "build failed, serving old deploy" — all three look identical from a page-content check. Only checking actual deploy status (Vercel dashboard, `vercel ls`/`vercel inspect` CLI if available, or a build-log-derived signal) disambiguates them.

**How to apply:** When verifying a push went live and content isn't updating after a reasonable wait, don't keep re-explaining it as caching/propagation — treat "the deploy may have failed" as an equally-likely hypothesis from the start, and say so explicitly rather than presenting caching as the confirmed diagnosis. If no direct Vercel dashboard/CLI access is available to check build status, say that limitation out loud rather than asserting a caching explanation with unwarranted confidence. See also [Lowkar deferred issues](project_lowkar_deferred_issues.md)'s function-size-limit item for the specific incident and root cause.

**The content check must be unique to the new deploy (2026-09-30, appstruct.art).** When a page check is used at all, the thing it looks for has to be something only the new build can produce. A catch-all SPA rewrite makes this trap easy to fall into: polling the brand-new `/writing` route for "HTTP 200 and some `<h1>`" reported success on the FIRST attempt, because the old deploy answered `/writing` through `{"source": "/(.*)", "destination": "/index.html"}` and served the prerendered **homepage** — a valid 200 with a valid, entirely wrong `<h1>`. Re-polling for the specific values (`h1 == "Writing"` AND `canonical == .../writing`) showed it genuinely went live a few minutes later. Assert on a route-specific string, not on a status code plus the existence of a tag.

**Resolved verification method (confirmed 2026-07-13):** `npx vercel` CLI is installed and already authenticated in this environment (`npx vercel whoami` → `bigadelsherif`). `npx vercel ls` lists recent deployments for the linked project with actual build status (`● Ready` / `● Building` / `● Error`) and age — this directly disambiguates "still building" from "failed" from "succeeded" without any wait-and-guess step. Always run this after a push instead of inferring from page content, and poll it (short sleep loop) if status is still `Building` rather than checking page content on a timer.

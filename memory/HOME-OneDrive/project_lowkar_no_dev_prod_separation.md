---
name: project-lowkar-no-dev-prod-separation
description: "Lowkar has no dev/prod environment isolation: local dev AND local builds both hit PRODUCTION Supabase — writes are real, and builds can EMAXCONN"
metadata: 
  node_type: memory
  type: project
  originSessionId: 897f3aa2-3479-4b47-b51b-e0a3436bc656
  modified: 2026-08-03T01:23:32.156Z
---

In `rakib-web`, `.env.local`'s `SUPABASE_DB_URL` / `SUPABASE_URL` point at the
**production** Supabase project (`wabzgukbtsqatyrhbwmj`). There is no separate
local or staging database for Postgres-backed data. `npm run dev` on localhost:3000
reads and writes the same rows the deployed site serves.

The local SQLite DB (`data/lowkar.db`, `src/lib/db.ts`) is **not** a fallback for
this — the public listings path (`getRealListings()` in listings.api.ts) goes
straight to Postgres whenever `sql` is configured, which it always is locally.

**Why it matters:** any "let me verify this live" step that mutates data — flipping
a listing's `market`, completing a deal, approving something — is a real production
write, visible on the deployed site while it's in effect. On 2026-08-02 a listing's
`market`/`currency_code` was flipped to `eg`/`EGP` for ~1 minute to browser-verify
the Egypt insurance placeholder, then reverted; that was the only way to render
that state because no EG-market listing exists.

**How to apply:** before any verification step that writes to the DB, say so
explicitly and get agreement — don't treat localhost as a sandbox. Prefer
read-only verification (cookies, query params, viewer-market-driven components)
over data mutation. If a mutation is genuinely the only path, record the original
values first, revert immediately, and verify the revert with a query rather than
assuming it worked.

## Second symptom: unbounded build-time connection pool

Same root cause (no environment isolation), different surface. `src/lib/supabaseDb.ts`
creates the postgres.js client with only `prepare: false` — **no `max`, no
`idle_timeout`**. postgres.js defaults to 10 connections per client instance, Next
spawns several static-generation workers during `next build`, each worker gets its
own `globalThis` and therefore its own pool, and nothing releases them mid-build.

So a local `next build` (~131 prerendered pages, dealer pages especially) opens an
unbounded pool against **production** Supabase, competing for a 200-connection
ceiling shared with the live site. On 2026-08-02 this produced
`ApiError: (EMAXCONN) max client connections reached, limit: 200` partway through
prerender, failing the build.

**Critically, this is load-dependent, not code-dependent.** The same commit failed
twice and then passed on a third run with no changes; a superset commit passed. Do
not read an EMAXCONN build failure as evidence that the commit under test broke
something — re-run before concluding anything, and don't bisect on it.

**Fix recommendation (agreed 2026-08-03, deliberately NOT applied):** set
`max: 3, idle_timeout: 20` (or similar) on the client in supabaseDb.ts.

## Third symptom, and the worst: NO PRODUCTION ERROR VISIBILITY

Verified 2026-08-03. **Sentry is not wired up in production at all.** Neither
`SENTRY_DSN` nor `NEXT_PUBLIC_SENTRY_DSN` exists in Vercel, in any environment
scope, on either project deploying this repo (`rakib-zzwn`, `rakib`).

`sentry.server.config.ts`, `sentry.edge.config.ts` and `src/instrumentation-client.ts`
all read `dsn: process.env.NEXT_PUBLIC_SENTRY_DSN` with no hardcoded fallback.
`NEXT_PUBLIC_*` is inlined at **build** time, so the deployed bundle ships
`dsn: undefined` and the SDK initialises as a silent no-op. Sentry confirms it:
`environment=production` with no query filter over **90 days** returns zero
events of any kind — not zero errors, zero ingestion.

**The trap:** a `production` environment *does* exist in Sentry, so the UI looks
wired up. `sentry.env.ts` computes the tag as
`NEXT_PUBLIC_SENTRY_ENVIRONMENT || NODE_ENV || 'development'`, and `.env.local`
sets the DSN but *not* the environment — so a local `next build` / `next start`
tags its events `production`. That tag was created by laptop builds, never by
Vercel. An empty production issue list therefore means **"no visibility"**, not
"clean production". On 2026-08-03 I misread exactly this and told the user a bug
was "live in production" based on an All-Envs view; every error in that list came
from a laptop.

**How to apply:** never treat a quiet Sentry production feed as evidence of health
until ingestion is confirmed. Check that events *arrive* before concluding anything
from their absence. Same discipline as [[feedback_verify_vercel_deploy_status]] —
absence of a failure signal is not a success signal.

## Follow-ups, grouped and prioritised

All three are the same underlying gap — no environment isolation — surfacing three
ways. Worth solving together rather than patching each symptom:

1. **HIGHEST — production error visibility** (flagged 2026-08-03): set
   `NEXT_PUBLIC_SENTRY_DSN` on `rakib-zzwn`'s Production scope, plus
   `NEXT_PUBLIC_SENTRY_ENVIRONMENT=production` explicitly so `NODE_ENV` can't
   mislabel local builds, then redeploy and confirm a deliberate test error lands
   tagged `production`. The other two items are *fragility* risks; this one is a
   complete blind spot — Lowkar could be failing for real users right now with no
   record of it. Free on Sentry's developer tier.
2. **Bounded pool in supabaseDb.ts** (flagged 2026-08-03): `max` + `idle_timeout`
   as above, so builds can't exhaust production's connection ceiling.
3. **Seed/staging-listing convention** (flagged 2026-08-02): one clearly-marked,
   permanently-seeded demo listing per market flagged non-production-critical, so
   verifying market-specific UI doesn't require flipping and reverting real rows.

A real staging/branch database would dissolve 2 and 3 at once. Related:
[[project_lowkar_deferred_issues]].

---
name: project-lowkar-deferred-issues
description: "Running list of known, deferred issues in the Lowkar (rakib-web) Supabase migration — not fixed yet, tracked for a future pass"
metadata: 
  node_type: memory
  type: project
  originSessionId: 897f3aa2-3479-4b47-b51b-e0a3436bc656
  modified: 2026-08-09T12:47:45.605Z
---

Running list of known bugs/gaps in `rakib-web` (Desktop project, `C:\Users\bigo_\Desktop\Jobs\find my car\Rakib\find my car\rakib-web`, junction `C:\rakib`) that are confirmed but explicitly deferred — not to be fixed opportunistically, only when the user asks for that specific item.

## 1. 32 SQLite routes not yet converted to Postgres

**What:** During the auth-lifecycle Postgres migration (commit `398d390`), the shared helpers (`getAuthUser`, `requireAdminUser`, `getOwnerListings`) were converted to async/Postgres, and 32 other route handlers got mechanical `await` added to keep the app compiling — but those 32 routes' *own* logic still queries the old SQLite `db` (`node:sqlite`), which doesn't work on Vercel's read-only serverless filesystem. All 8 admin mutation routes (listings approve/reject/restore/suspend/unsuspend, dealers approve/reject, reports resolve) were converted and verified live in production on 2026-07-11 (commit `b5c9e31`).

**CORRECTION (2026-07-11):** the earlier claim that "listings domain has been converted" was wrong/overstated. Only the *owner-facing* dashboard functions in `src/features/listings/listings.api.ts` (e.g. `getOwnerListings`, the "My listings" data path, ~line 136) were converted to `sql` (Postgres). The **public browse/detail path — `getListings()`, `getListing()`, `getListingIds()`, `getSimilarListings()`, and their `dbGetAllListings`/`dbGetListing`/`dbGetListingIds` helpers (lines ~104-223)** are still on the old SQLite `db`, which is always `null` in production. `getListings()`/`getListing()` fall back to the hardcoded mock `NORMALIZED_CARS` array (92 static cars from `@/data`) whenever `db` is null — meaning **no real (Postgres) used-car listing has ever been visible on the public marketplace in production**, regardless of moderation/approval status. Confirmed live 2026-07-11: approved a real test listing (`used_65539cf9`) via the real admin UI, verified genuine DB persistence (admin stats: Active 0→1), then searched/browsed for it on production as a second real user — absent from every sort order (Best deal, Newest) across all 92 results.

A conversion attempt was made 2026-07-11 and then **reverted** on discovering a bigger-than-expected product implication: production Postgres has only 1 real active listing, so `getListings()` preferring real data over mock would replace the 92-car demo catalog with just that 1 car (the function's contract is "real data replaces mock entirely once ≥1 row exists," not "merge"). Also crashed `/compare`'s build (`CompareView.tsx:37` assumes ≥2 cars always exist). User chose to revert and defer rather than ship a thinned catalog. **Any future attempt must address the merge-vs-replace product question first**, not just the SQLite→Postgres mechanics.

New-car trims (`dbGetAllTrims`, `dbGetTrim`, `dbGetGroupedTrimIds`, `getTrimsForModel`) have the same unconverted pattern, lower priority (no live production trim data exists to lose).

**Full audit (2026-07-11), routes confirmed still SQLite-only, grouped:**
- **Offers/Deals (8 routes)** — RESOLVED, see item #4 below.
- **Dealer console — RESOLVED 2026-07-14/15 (commit `9f1b8c6`), except `dealer/analytics`.** Converted `dealer/storefront` (GET+PATCH), `dealer/plan` (GET+POST), `dealer/leads`, `dealer/apply`, `dealer/application`, and `dealers.api.ts`'s `dealers_dir` reads (`getDealerDirectory`/`getDealerIds`/`getDealerDirEntry`) to Postgres, same "replace once genuinely seeded" contract as listings (new `getRealDealerDir()`, cache()-wrapped via a `src/lib/reactCache.ts` helper extracted from `listings.api.ts` for reuse). Also fixed `getStorefrontData()`'s hardcoded `getListingsBySeller('karim', ...)` — every dealer's public storefront was showing Karim Motors' inventory regardless of which dealer was requested; now resolves each dealer's own listings by directory name. Verified with two independent real dealers created through the actual apply→admin-approve→sign-in flow (not a DB bypass): storefront/plan/leads each show account-specific data with zero cross-account leakage, both locally and on production. `dealer/analytics` still returns 500 in production — not touched this phase (out of original scope), confirmed still broken via live network check, not a regression from this work.
  - **Dealer role split-brain (item #6, resolved as a seed-data fix, not structural):** traced to `dealer-001` being seeded in Postgres (`20260708120000_initial_schema.sql`, ported verbatim from a pre-existing bug in SQLite's `dbSchema.ts` v12 migration) with phone `+212600000002` — wrong format (`+212` prefix never sent by the real OTP flow) AND actually seller-001's canonical number, not dealer-001's. New migration `20260714120000_fix_dealer_001_phone.sql` corrects it to `600000003` (matching `scripts/seed.mjs`/`ConsoleGate.tsx`/`AuthView.tsx`/`statelessAuth.ts`). **The migration file is committed but NOT YET APPLIED to the live database** — applying it requires either a permission grant for a direct Postgres write or running it via the Supabase dashboard SQL editor; ask before doing either. The real admin-approval mechanism itself (`/api/admin/dealers/[id]/approve`) was already fully correct and Postgres-native the whole time — this was purely a one-time seed inconsistency between two separate seed sources, not a gap in the approval flow.
  - **New test data left live in production as part of verification:** two real dealer accounts were created via the actual apply→approve flow to satisfy "verify with 2+ real dealer accounts" — "Test Dealer Alpha" (reused the existing test account `611000001`/User 0001, previously `role='seller'`, now permanently `role='dealer'`) and "Test Dealer Beta" (brand-new throwaway account `699000002`/User 0002). Both show in the real public `/dealers` directory today (3 total: Demo Motors + these two). **No cleanup path exists in the admin UI** — Users tab only offers temporary suspension, not role reversion or dealers_dir deletion. Left as an open item for the user to decide (revert via direct DB access, or leave as ongoing test fixtures) rather than performed unilaterally.
  - **Transient false reading, not a real bug:** early in this phase's browser verification, a corrupted first dev-server instance (duplicate-React-copy crash loop, since resolved by a clean restart) briefly rendered the home page with "16 verified dealers" and unfamiliar names (Bavaria Maroc, Atlas Automotive, etc.) that never appeared again after restart and don't match any real seed data (`/dealers` consistently shows 3, matching the actual admin user list). Treat that one reading as dev-session noise, not a real behavior difference — don't chase it if it resurfaces in a transcript search.
- **Saved cars — RESOLVED 2026-07-12 (commit `94fae34`).** Root cause was one layer deeper than the flagged `/api` prefix bug: `AppStateProvider`'s `toggleSave`/`forceSave` (and the sign-in sync effect) gated every backend call on `IS_LIVE_API = !!(NEXT_PUBLIC_AUTH_PROVIDER && NEXT_PUBLIC_API_URL)`, permanently false since neither is set anywhere — so clicking "Save car" fired zero network requests at all, same class of bug as offers/deals (item #4). Fixed: removed the `IS_LIVE_API` gate on saved-cars call sites only (left it on the still-deferred my-offers sync), fixed the missing `/api` prefix in `saved.api.ts`, converted `GET /api/saved` + `POST`/`DELETE /api/saved/[carId]` to Postgres. Verified via the stronger fresh-sign-out/sign-in methodology (not same-tab reload) — genuine persistence confirmed.
- **Misc real user-facing (4 routes)** — `reports/route.ts` (report a listing), `new-cars/inquire/route.ts` + `[id]/route.ts`, `inspection-requests/route.ts`. Genuinely wired via real `fetch()` in `MiscModals.tsx`/`NewCarDetail.tsx`/`DCLeads.tsx`. Straightforward conversion candidates.
- **Machine-only (4 routes)** — `admin/audit`, `admin/cron`, `admin/db-diagnostics`, `admin/maintenance`. All gated by `adminGuard` (ADMIN_SECRET), never browser-reachable. Lowest priority, arguably fine indefinitely.
- **Analytics (1 route)** — `analytics/route.ts`, caller not yet confirmed, likely low-stakes telemetry.

**Why:** Explicit, deliberate migration sequencing — user wants each domain converted, tested, and committed as its own focused batch (same pattern as auth-lifecycle and admin), not all 32 at once.

**How to apply:** Don't touch these until the user asks to continue the domain-batching work. Highest priority when they do: **public browse/detail listings path** (blocked on the merge-vs-replace product decision above) and **offers/deals** (item #4 — needs client rewiring, not just DB conversion). Dealer console and the misc user-facing routes are lower-risk, mechanical conversions when scoped.

**CORE GAP RESOLVED 2026-07-14 (commit `ad5b4ed`):** `getListings()`/`getListing()`/`getListingIds()` now call `getRealListings()` (Postgres, `used_listings WHERE status='active'`) first and return it outright (replace, not merge) whenever ≥1 real row exists, falling back to SQLite then mock only when Postgres has zero. `getSimilarListings`/`getListingsBySeller`/`searchListings` inherit this automatically since they call `getListings()` internally. Verified live on production: `/cars/used_7d02b7fe` loads (was 404), real Supabase Storage photo returns 200 (not a placeholder), `/used-cars?makes=Kia` dropped from 12 (mock) to 1 (the real Kia), `/compare` and `/sell-fast` both verified not to crash under the new real-data-count scenarios.

Two new bugs caught by a full local production build *before* this shipped (would have broken production otherwise):
- **Supavisor pooler exhaustion (`EMAXCONN`, limit 200):** each `/cars/[id]` static-generation worker fired ~4 separate Postgres queries per page (`getListing`, `getSimilarListings`, `getListingsBySeller`, `getValuationPool` all route through `getRealListings()`), and Next's parallel workers building 11 real detail pages at once blew the connection cap. Fixed by wrapping `getRealListings()` in React's `cache()` for per-request dedup. **Gotcha:** `cache` is only exported by Next.js's vendored React build (server/RSC runtime) — the plain `react@18.3.1` package Vitest/Node resolve directly does not export it (`cache is not a function`), so `listings.api.ts` now feature-detects and falls back to an unmemoized passthrough outside the Next runtime. Worth remembering if `cache()` is reached for again elsewhere in this codebase.
- **Unconfigured `next/image` remote host:** `next.config.mjs`'s `images.remotePatterns` only allow-listed Unsplash — real listing photos live on Supabase Storage (`wabzgukbtsqatyrhbwmj.supabase.co`), which would have hard-crashed `next/image` (not degraded gracefully) for every real listing. Fixed by adding that specific hostname (not a wildcard `*.supabase.co`).

Remaining sub-items of #1 (32-SQLite-routes list above, dealer console, new-car trims) are unaffected by this fix and still deferred as originally scoped.

## 2. Settings panel mock-data gap (Notifications, Privacy, Search preferences) — RESOLVED (persistence only) 2026-07-11

**What:** `SetNotifs`/`SetPrivacy`/`SetPrefs` in `src/features/account/components/SettingsPanels.tsx` were pure client-side mock state, never wired to `AppState` or any backend. **Fixed 2026-07-11 (commit `1aa6c64`)**: added `users.notification_prefs`/`privacy_prefs`/`search_prefs` jsonb columns (Postgres migration `20260711120000_account_settings_prefs.sql`, applied to production with explicit user approval; SQLite mirror as TEXT columns via `dbSchema.ts` migration v16 for local dev/test parity), `PATCH /api/account/settings`, and wired all three panels through `AppState.setUserSettings`. Verified live: toggles/selections in all three panels genuinely persist across a fresh, independent reload for a real signed-in user (confirmed via network 200 + reload, not just optimistic UI).

**Deliberately scoped to persistence only** — audited first and confirmed nothing else in the app reads or enforces these values: no notification-sending mechanism exists anywhere, no privacy enforcement in `ContactModal`/`ChatPane`/messaging, no search personalization in `advisor.api.ts`/`home.api.ts`. Toggles are now durable across reload/re-login but functionally inert — flipping "Mask my phone number" doesn't hide anything, "New offers" won't trigger an email/push. Making them consequential is separate, unscoped future work (would need real work in the messaging and advisor/home domains, not just Settings).

`SetProfile` (the 4th panel) was fixed earlier in this engagement — wired to real `name`/`phone`/avatar from `AppState`; `email`/`city` still show an explicit "Not yet available" placeholder (no backing column/route for either).

## 3. CompareView hydration race on hard reload — RESOLVED 2026-07-11

**What:** `CompareView.tsx` seeded its car-id selection via a `useState` initializer reading `AppState.compare`/`saved` at mount time. `AppStateProvider` hydrates those from `localStorage` *after* initial mount (SSR/CSR mismatch avoidance). On a hard reload, the initializer could run before hydration completed, silently falling back to a stale/wrong car set (`saved`-cars fallback, or worse) with no error — e.g. a genuine 3-car selection showing "2 of 3 cars" after reload.

**Fixed (commit `ddba250`):** exposed AppStateProvider's previously-internal `hydrated` flag on the context. Split `CompareView` into an outer gate (renders a `.skel`-based loading skeleton while `!hydrated`) that only mounts the actual table component (`CompareTable`, a fresh instance) once hydration is confirmed complete — guaranteeing its `useState` initializer always sees the real, hydrated `compare`/`saved` values. Verified live: added 3 real cars, hard-reloaded `/compare` via both direct navigation and `window.location.reload()`, at desktop and mobile widths — "3 of 3 cars" correct every time, no stale fallback.

## 4. Offers/deals negotiation flow is entirely client-local mock — RESOLVED 2026-07-12/13

**What:** Discovered 2026-07-11 while trying to continue a dry run past "buyer makes an offer." `src/features/offers/offers.api.ts` (`sendOffer`, `getReceivedOffers`, `getMyOffers`, `acceptOffer`, `declineOffer`, `counterOffer`) and `src/features/deal/deal.api.ts` (`getDealData`, `createDealRecord`, `getDeal`, `patchDeal`) all gate on `process.env.NEXT_PUBLIC_API_URL` — when set, they'd call a PROVISIONAL external API; when unset (confirmed unset everywhere: not in `.env.local`, not in Vercel production env), every one of these functions is a **pure client-side mock**: `sendOffer` resolves a hardcoded `{ offerId: 'DEV-OFFER-001' }` after a fake 900ms delay and never calls `fetch` at all; `getReceivedOffers` returns a hardcoded `SEED_RECEIVED_OFFERS` array; `acceptOffer`/`declineOffer`/`counterOffer` just resolve `ok({})` with no request. The "My offers" page showing a freshly-sent offer is **AppState/localStorage state in the sender's own browser** — invisible to any other session, real or demo, including a legitimately signed-in seller.

**Distinct from issue #1 above:** this is not "SQLite instead of Postgres" — real `/api/offers/*` and deal routes exist in the codebase (`src/app/api/offers/route.ts`, `/my`, `/received`, `/[offerId]/accept|counter|decline`, all still on SQLite `db` too) but the **client never calls them** at all in the current build. They're orphaned/dead code from the frontend's perspective.

**Confirmed live:** sent a real offer as a real second user (`677001122`) on a mock-catalog listing (`used_001`) on production — zero `POST /api/offers` network request fired (checked via network log), yet "My offers" showed it with "made just now." This means a real two-user offer→deal→deal-room flow cannot be demoed with two real cross-session users at all right now — there is no cross-user data path for this domain, regardless of any DB conversion work.

**Why:** Appears to be an earlier-phase prototype seam (`ASSUMPTION:` / `PROVISIONAL` comments throughout) that was never connected, unlike auth/listings/admin which have since had real DB-backed paths built.

**RESOLVED in two phases:**
- **Offers (2026-07-12, commit `8ca8336`):** converted `offers.api.ts`'s 6 functions to call the real `/api/offers/*` routes unconditionally, converted those routes' SQLite `db.prepare` to Postgres `sql`, and closed real ownership gaps that were previously "prototype-acceptable" (`GET /offers/received` and `accept`/`counter`/`decline` now verify the caller against `used_listings.owner_id` server-side, not a client-claimed role). Also fixed two structural bugs found during live verification: `http.ts`'s `BASE` resolution crashed on server-side relative-URL fetches, and Postgres `BIGINT` timestamp columns returned as strings silently produced `Invalid Date`. Verified via genuine two-user round trip with fresh sign-out/sign-in at every step on production.
- **Deals (2026-07-12, commit `8661465`):** converted `POST /api/deals` + `GET`/`PATCH /api/deals/:carId` to Postgres (their per-field ownership enforcement was already correct pre-conversion). Un-gated `deal.api.ts`. Removed a fake 2.5s auto-resolve hack in `DealRoomView.tsx` that was silently running in production (gated the same backwards way as the `IS_LIVE_API` pattern) and masking whether the real two-party handover confirmation worked at all — buyer's waiting state now says "refresh to check for updates," matching the seller view's existing copy. Fixed `SellerDealRoomView.tsx`'s dead mount-refresh effect (same gating bug) so the seller's view now actually picks up the buyer's confirmation on reload. Verified via full two-user round trip (offer→deal→schedule→buyer confirms→seller confirms→completion→rating) with fresh sign-out/sign-in at every step on production, using a disposable test listing (admin-suspended afterward) since the original real listing's deal was already complete from local-dev testing against the same shared DB.

**Still deferred from this same domain:** `DealRoomView.tsx`'s "Sample reviews"/`isKarim`-adjacent dead code and the deal-room `Karim` special-casing were NOT touched — see item #7. Real-time/polling was explicitly skipped per user decision ("reload-to-see-updates is fine, matches the rest of the app").

## 5. Dealer console: storefront/inventory scoped from 100% mock to real dealer data (2026-07-13)

**What:** `getDealerConsoleData()` (`src/features/dealer/dealer.api.ts`) previously returned identical hardcoded mock data for EVERY signed-in dealer regardless of identity — businesses, inventory, team, branches, leads, and the storefront `Seller` record (hardcoded to `sellers.karim`) all came from static `@/data` imports.

**Inventory — RESOLVED (commit `f399cec`).** Turned out `DCInventory.tsx` was already independently fetching real data via `/api/dealer/listings` → `getOwnerListings(user.id)` (proven Postgres pattern) and silently ignoring the mock props it was given — only the console *chrome* around it (sidebar badge, business-switcher counts, free-plan cap display) still read the dead mock `data.inventory`. Fixed by lifting the fetch up to `DealerConsole.tsx` as a single source of truth and deleting the dead prop plumbing.

**Storefront — NOT attempted, needs `dealers_dir` Postgres conversion first.** See item #1's dealer-console bullet: `/api/dealer/storefront` throws on every production request today (no `db` null-guard), so wiring the real dealer id on top of it would be correct code sitting on broken infrastructure. Scope this as its own phase once `dealers_dir` reads/writes are converted — **frame it as "fix an actively-broken route," not "convert an unconverted one."**

**Team/branches/leads — explicitly held off**, no DB schema exists for any of them (confirmed zero matching tables in `supabase/migrations/*.sql`). Not urgent unless a demo specifically walks through those tabs — bigger product decision (what should dealer team/lead management actually look like), not a conversion task.

## 6. Dealer role split-brain: local SQLite vs. shared Postgres disagree on who's a dealer

**What:** Discovered 2026-07-13 while trying to live-verify the dealer console inventory fix with real non-zero data. `scripts/seed.mjs` seeds `dealer-001`/phone `600000003` with `role='dealer'` and 3 real listings into the **local SQLite** `users`/`used_listings` tables. But real authentication (`getAuthUser`) reads the **shared Postgres** `users` table — a completely separate record for the same phone number, which does not have `role='dealer'` there. Signing in as `600000003` lands on the buyer home page, not `/dealer`; the `ConsoleGate` "Enter as Dealer (demo)" button only flips *client-side* `AppState` role (via `signInAs('dealer', ...)`), so it renders the console shell but every real dealer-only server route (`/api/dealer/listings`, etc.) still 403s because the actual Postgres role never changed.

Also discovered mid-investigation: `POST /api/dealer/apply` has the same missing-`db`-guard problem as item #1's `dealer/storefront` finding, AND throws `FOREIGN KEY constraint failed` in local dev specifically because a user created via real (Postgres) OTP auth doesn't exist in the separate local SQLite `users` table at all — a different failure mode of the same root split.

**Why:** Two different databases (`db` = local SQLite, `sql` = shared Postgres) are both called "the" data layer depending on which route/table you're looking at, and the seed script only ever populated one of them for dealer-role identity. Not something introduced by any recent phase — pre-existing since whichever point SQLite→Postgres migration work began without a matching seed-data reconciliation pass.

**How to apply:** Don't assume any of the 4 seeded demo-account phones (admin/buyer/seller/dealer) genuinely have matching roles in both databases — verify per-phone before relying on one for a live demo or test. This is a data-consistency problem, separate from (but related to) the `dealers_dir`/dealer-route Postgres-conversion gap in items #1 and #5 — fixing the conversion doesn't automatically fix this; the seed data itself needs reconciling (or a fresh, deliberately-Postgres-seeded dealer test account created) once that phase is scoped.

## 7. Dead `isKarim` special-case in dealer storefront/deal-room code

**What:** Flagged 2026-07-12 as a background task (not yet started as of 2026-07-13). `src/features/dealers/StorefrontView.tsx` (lines ~35-40, 61, 96-97) special-cases `dir.id === 'karim'` to source seller stats from a hardcoded `sellers.karim` mock object instead of real `dir` data, and only shows "synced inventory" when `isKarim` is true. No dealer with id `'karim'` exists anywhere in current data (not seeded Postgres, not `static-dealers.json`, not `generated/dealers.json`) — `/dealers/karim` 404s today, making the entire branch permanently dead code. Every real dealer always takes the `isKarim===false` path and always shows the "hasn't synced their online stock" empty state regardless of whether they actually have real listings.

**How to apply:** Two possible fixes depending on intent — either add a real "Karim Motors" dealer back to seed data with a matching id, or (more likely correct) remove the special-case entirely and make the storefront always source inventory from the dealer's real listings via the same `getOwnerListings`/`getListingsBySeller` pattern used elsewhere. Check whether `dealers.api.ts`'s `getStorefrontData()` — which also hardcodes `getListingsBySeller('karim', ...)` regardless of the requested dealer id (a separate but related bug, same root cause) — should be fixed in the same pass.

## 8. Vercel deploy failures from 2026-07-13 — RESOLVED same day (commit `bb0a10f`)

**What:** Every deploy from some point on 2026-07-13 onward silently failed — `api/account/avatar` exceeded Vercel's 250MB uncompressed function-size limit at 334.28MB, so production kept serving the last successful deployment (predating that day's Phase 10 + dealer console work) while every push since looked like it had gone through. This was initially misdiagnosed as edge-cache staleness across several rounds of investigation before the user surfaced the actual Vercel build error directly — see [Verify Vercel deploy status](feedback_verify_vercel_deploy_status.md) for the process lesson.

**Root cause, confirmed via the actual Next.js trace manifest** (`.next/server/app/api/account/avatar/route.js.nft.json` — the literal file list `@vercel/nft` bundles for a route): it included `.git` pack objects and local dev `data/*.db(-wal)` SQLite files, neither of which the route touches. `src/lib/db.ts`'s `openDb()` calls `new DatabaseSync(dbPath)` with a **dynamically-computed path** (from `getServerConfig()`) — `@vercel/nft` can't statically resolve which file that is, so it conservatively includes neighboring files near the inferred directory instead of failing closed. Any route whose import graph reaches `db.ts` is at risk of the same over-inclusion (not just `account/avatar` — that one just happened to be large enough to tip over the limit first).

**Fix:** `experimental.outputFileTracingExcludes` in `next.config.mjs`, scoped to every route (`'*'` key), excluding `.git/**`, `data/**`, `.next/cache/**`, `.next/trace`, `node_modules/firebase/**` + `@firebase/**` (179MB combined, confirmed zero server-side import path anywhere — only a `'use client'` messaging hook uses it), `node_modules/@next/swc-*/**`, `node_modules/@esbuild/**`.

**Windows-only gotcha discovered while verifying this fix:** Next.js 14.2.35's `outputFileTracingExcludes` implementation has a confirmed local bug on Windows — it resolves exclude globs via `path.join()`, which produces backslash-separated absolute paths that break `picomatch`'s glob matching (backslash is an escape character in glob syntax, not a path separator there). **This means the fix cannot be verified locally on a Windows dev machine** (a rebuilt trace still shows the old files) — it must be confirmed via an actual Vercel deploy (Linux), which was done and succeeded. If touching this area of the codebase again on Windows and a rebuild's trace doesn't reflect an `outputFileTracingExcludes` change, this is why — don't conclude the config is wrong from a Windows-only test.

**How to apply going forward:** If a future route also balloons in size, check its `.next/server/.../route.js.nft.json` first (sum real file sizes, sort descending) before guessing at the cause — this is what actually found the root cause here, versus assuming it was a `sharp`/native-binary/image-library issue (which it wasn't). Any new route that imports `db.ts` (even transitively) inherits this same risk until `db.ts`'s SQLite paths are fully removed (see item #1) — the exclusion patterns are a mitigation, not a structural fix for the underlying dynamic-path tracing behavior.

## 10. Phase 6 — 10 real listings populated via the real sell wizard + admin approval (2026-07-14)

**What:** Created 10 real, varied used-car listings (Toyota Corolla/Yaris, Hyundai Accent/Tucson, Peugeot 208/308, Renault Clio/Duster, Volkswagen Golf, Kia Sportage — years 2016-2022, prices 100k-215k MAD, all 10 W_CITIES options covered) through the actual production sell wizard (3 real seller phone accounts) and approved through the actual admin moderation queue (real admin account `600000000`). Photos: 5 per listing (4 exterior + 1 interior), sourced from Wikimedia Commons under CC0/CC-BY/CC-BY-SA licenses (all permit reuse; CC-BY variants require attribution — full manifest with per-photo source URL/license/author in this session's scratchpad, not committed to the repo). No DB bypass — every create/photo-upload/submit/approve call was a genuine authenticated network request, confirmed via `read_network_requests` returning real 200s (e.g. `POST /api/listings/used_7d02b7fe/images`, `POST /api/admin/listings/used_7d02b7fe/approve`).

**Confirmed durable via:** admin's Active Listings panel (all 10 show "Live" with correct city/price/photos after a hard reload — the panel's counts don't live-update within the SPA without a reload, a minor stale-cache-within-session quirk worth knowing about but not fixing) and a real seller's My Listings dashboard (3 "Active" listings for phone `611000001`, matching exactly).

**Confirmed still NOT visible via the public path, exactly as predicted before starting this phase:** `/used-cars?makes=Kia` still shows the mock-only count (12, unchanged); a direct `/cars/used_7d02b7fe` URL 404s ("Listing not found"). This is the pre-existing, already-tracked gap in item #1 (`getListings()`/`getListing()` still SQLite-only, `db` is `null` in production, mock fallback always wins) — not a new bug from this phase, and expected per the user's explicit instruction not to touch that conversion in this phase.

**Sets up the next phase cleanly:** the "thin catalog" concern that caused the 2026-07-11 revert (only 1 real listing existed, so real-replaces-mock would have gutted the demo catalog) is now much less severe — there are 10 real, well-distributed listings instead of 1. The `CompareView.tsx:71` crash risk that same revert hit (`[cars[0], cars[1]]` assuming ≥2 cars always exist) was already fixed and browser-verified with 0/1/2-car scenarios earlier in this same session, before this listing-population work — `cars.slice(0, 2)` now, no longer a blocker. The next phase should flip `getListings()`/`getListing()`/`getListingIds()` to prefer real Postgres data (falling back to mock only when zero real active listings exist) and verify the browse page + direct listing URLs actually surface these 10 real listings correctly.

**Not touched, deliberately:** did not restart the `getListings()`/`getListing()` conversion itself in this phase — that is the explicit next step, not part of Phase 6.

## 9. New Cars gated behind market (Morocco hidden, Egypt placeholder) — RESOLVED 2026-07-13 (commit `f724da5`)

**What:** Market research established Morocco has no independent multi-brand new-car dealer model (exclusive brand concessionaires only), so "New Cars" — nav item, browse mode, detail page, dealer-inquiry routing — misrepresents the real market there. Egypt was scoped as a placeholder secondary market where the feature stays on. Decision: gate visibility by market, don't delete any New Cars code/data (kept as-is for Egypt and for a possible future concessionaire-directory reframe).

**Implementation:** New `src/middleware.ts` (first middleware in this project) resolves market via Vercel's `x-vercel-ip-country` edge geo header, cookie `market=ma|eg` (1yr, non-httpOnly), defaulting to `ma` for any unrecognized/undetectable country (safer default for the primary market). A quiet `?market=ma|eg` query param overrides the cookie for live demos with no user-facing UI — middleware strips the param and redirects to a clean URL after setting the cookie. Direct navigation to `/new-cars*` redirects to `/used-cars` when market is `ma`, handled entirely in middleware (not in the page components) specifically so `new-cars/[id]`'s existing `generateStaticParams`/`revalidate=300` ISR caching is untouched — reading `cookies()` inside a page/layout would have forced it dynamic instead.

`SiteHeader.tsx`/`SiteFooter.tsx` default their nav/footer arrays to the Morocco variant (no New Cars) on first paint — deterministic and flash-free for the majority case — and reveal New Cars via a post-mount effect (`src/lib/market.ts`'s `readMarketCookie()`) only if the cookie says `eg`. This mirrors the existing after-mount-reveal pattern in `I18nProvider.tsx`, but unlike that one, the SSR-safe default happens to equal the correct answer for most visitors, so there's no flash in the common case.

**Verified:** typecheck/lint/572 tests clean; browser-verified locally (default hides New cars in nav+footer, `/new-cars` redirects, `?market=eg` reveals + persists via cookie, `?market=ma` reverses it) and on production (`npx vercel ls` confirmed `● Ready`, not just wait-and-check — see [Verify Vercel deploy status](feedback_verify_vercel_deploy_status.md)); production build confirmed `new-cars/[id]` still shows as `●` (SSG, same static params) and the middleware bundle is a lean 27kB, no function-size regression.

**Not touched, deliberately:** New Cars' internal components (`BrowseView`, `NewCarDetail`, `NewCarCard`, `listing-pages.api.ts`, `AdvisorView`) — gating happens at the nav/route door, not inside the feature. `DCLeads.tsx`'s new-car-inquiry lead lane in the dealer console was left as-is (will just show zero entries for a Moroccan dealer, which is correct without any change). The `dealers_dir`/`brands_handled` Postgres-conversion gap (items #1/#5) is unaffected by this change — `brands_handled` becomes vestigial once New Cars is gated for Morocco, but the schema itself needed no changes for this pivot.

## 11. `rakib` Vercel project is a likely dead duplicate deployment (flagged 2026-08-03)

**What:** Two Vercel projects deploy this same GitHub repo (`Bigadelsherif/rakib`):
- `rakib-zzwn` → `rakib-zzwn.vercel.app` — 10 environment variables (all Supabase/Postgres). This is the one treated as production throughout this engagement.
- `rakib` → `rakib-tan.vercel.app` — **zero environment variables of any kind.**

Both were sitting on the same commit (`598c0f9`) as of 2026-08-03, so both rebuild on every push to `main`.

**Why it matters:** with no `SUPABASE_DB_URL`, `rakib` cannot reach the database at all — any page depending on real listings, auth, or dealers must be erroring or falling back. It is nevertheless publicly reachable at `rakib-tan.vercel.app`, so a shared or indexed link could land someone on a broken copy of the product. It also doubles build minutes on a Hobby plan for no benefit.

**Not investigated:** whether anything (a custom domain, an investor link, a bookmark) actually points at `rakib-tan.vercel.app`, and which project is genuinely older. Both need checking before deleting either.

**How to apply:** don't delete unilaterally — confirm no domain/link depends on it first, then remove the duplicate so `main` has exactly one deploy target. Related: the missing-Sentry-DSN finding in [[project_lowkar_no_dev_prod_separation]] applies to *both* projects, so neither has production error reporting today.

## 12. AuthGate flashes its sign-in prompt before hydration on every protected route (flagged 2026-08-03)

**What:** `AuthGate` (`src/components/layout/AuthGate.tsx:22`) decides with `if (user) return <>{children}</>;` — plain truthiness on `useAppState().user`, with no hydration guard. But `AppStateProvider:105` initialises `user` as `useState<User | null>(() => isDev ? { ...SEED_USER } : null)`, so in **production** it starts `null` and is only populated by the post-mount effect that reads localStorage (`:126`, with `setHydrated(true)` at `:153`).

Net effect: a genuinely signed-in user briefly sees "Sign in to continue" before the real page swaps in. Affects **every** `AuthGate`-wrapped route, not just `/deal`.

**Not introduced by PR #3.** This is long-standing `AuthGate` behavior. The `/deal` fix only made it *observable* there — previously `deal/page.tsx` threw during data fetch before `AuthGate` ever mounted, so the route showed an error boundary instead of ever reaching the gate. Confirmed on the PR's preview deploy: signed-out `/deal` now correctly renders the AuthGate prompt ("Sign in to continue" / "Your deal room needs a verified phone number…").

**Known fix pattern, already used in this codebase:** `CompareView` solves exactly this — see item #3 above. `AppStateProvider` already exposes a `hydrated` flag on the context (`:49`, `:394`); `CompareView` renders a `.skel` skeleton while `!hydrated` and only mounts the real component once hydration is confirmed. Applying the same outer-gate shape to `AuthGate` would remove the flash without touching its auth logic.

**How to apply:** deliberately deferred — out of scope for PR #3, which is limited to the two deal-room commits. If prioritised, prefer reusing the `hydrated`-flag gate rather than inventing a new mechanism, and remember it changes behavior on every protected route at once, so it needs a broader browser pass than a single-route fix.

## 13. Stale comment references to deleted FinanceCalculator / FinancingStructurePanel (flagged 2026-08-03)

**What:** the detail page's two finance cards — `FinanceCalculator.tsx` ("Monthly loan payment", free sliders) and `FinancingStructurePanel.tsx` ("Financing structure", curated presets) — were merged into a single `src/features/listings/components/detail/FinancingPanel.tsx` and both files deleted. Roughly **8 code comments in other files still name them**, in at least:

- `src/lib/tco.ts` (several, around `computeFinancingStructure` and `computeTcoForListing`)
- `src/features/advisor/advisor.engine.ts` and `src/features/advisor/AdvisorView.tsx`
- `src/features/compare/CompareView.tsx`
- `src/lib/insurance.ts`
- `src/config/tco.ts` (the `financingPresets` / badge-tone docs)

**Impact: cosmetic only.** Zero code references remain — verified by grep after the merge; every hit is inside a comment. Nothing imports or renders the deleted components, and typecheck/lint/tests are clean. The cost is purely that a future reader follows a comment to a file that no longer exists.

**Why not fixed at the time:** the merge task explicitly scoped `tco.ts` (and the shared financing math generally) as off-limits, and most of the stale references live there. Updating the reachable ones while leaving `tco.ts`'s untouched would have left the codebase in a *more* confusing half-updated state than leaving all of them consistent.

**How to apply:** low priority, do it as one sweep rather than opportunistically — rename every reference to `FinancingPanel` in a single commit so the docs stay internally consistent. Cheap to do alongside any future task that already has `tco.ts` in scope.

## 14. Real market-owned user accounts (`users.market`) — deliberately NOT built (flagged 2026-08-03)

**What:** the `users` table has **no `market` column** (`src/lib/dbSchema.ts:23-36`: `id, name, phone, id_verified, role, status, created_at, flags, avatar_url, notification_prefs, privacy_prefs, search_prefs`). Listings, dealers, financing applications and external intakes all got `market` columns in the Phase 4 market-ownership work; users never did. **Market is a cookie/session property, not an account property.**

**The C1 demo affordance is NOT market ownership — do not later mistake it for one.** On 2026-08-03 a fifth demo account was added (`buyer-eg-001`, phone `1012345678`) to `AuthView.tsx`'s `DEMO_ACCOUNTS`, `statelessAuth.ts`'s `demoUserForPhone` role map, and `scripts/seed.mjs`'s `seedDemoAccounts`, plus a `market` field on the `DEMO_ACCOUNTS` array used **only to filter which buttons the Quick sign-in panel shows**. That account is merely *usable in* Egypt (its phone passes EG's validator); it is not *owned by* Egypt. Signing in as it and signing in as a Moroccan demo account produce identical server-side identities — the EG experience comes entirely from the `market` cookie either way.

**What real ownership (option "C2") would require, all four:** a `users.market` column (SQLite `dbSchema.ts` + a Postgres migration), signup-time assignment from the resolved market cookie, session/`StoredUser` plumbing so `getAuthUser` returns it, and a decision about what happens to the existing rows (backfill everyone to `'ma'`?) and to a user who travels between markets — is market the account's home, or the current session's context? That product question should be answered before any schema work.

**Why deferred:** the user explicitly scoped 2026-08-03's work to C1 and ruled out C2 that night — no `users.market` column, no Postgres migration. The goal was only to make both market experiences testable as a signed-in user.

**How to apply:** don't add `users.market` opportunistically as part of an unrelated task; it changes auth, signup and every market-conditional surface at once. See also [[project_lowkar_no_dev_prod_separation]] — the migration would be a real production write.

## 15. MA-hardcoded phone validation outside the MarketConfig contract (flagged 2026-08-03)

**What:** two sites still validate phone numbers against Moroccan rules directly instead of going through `MarketConfig.phone.isValid`:

- `src/features/modals/components/ScheduleModals.tsx:183` — uses a local `MA_PHONE_RE` and the hardcoded string `'Enter a valid Moroccan mobile number (e.g. 0612345678)'`
- `src/app/api/inspection-requests/route.ts:58` — server-side, rejects with `'Phone must be a valid Moroccan mobile number (06x/07x or +2126x/+2127x)'`

**Same class of bug as the auth screen's**, which was fixed on 2026-08-03: the validator and/or its error message assume Morocco regardless of the active market. Under `market=eg` these will reject legitimate Egyptian numbers and explain the rejection in Moroccan terms.

**Why not fixed then:** out of scope — the reported bug was the auth/sign-in phone step, and nothing in that task's scope reached these two. Left untouched deliberately rather than opportunistically widened.

**How to apply:** both should read `marketConfig.phone.isValid` + `marketConfig.phone.invalidMessage` (the per-market fields added 2026-08-03 in `src/config/markets/types.ts`). The API route is server-side, so it needs the market resolved from the request cookie rather than the `useMarketConfig` hook. Note also that **`maIsValidPhone` rejects the leading-zero trunk form `0612345678`** that Moroccans commonly write and that `ScheduleModals`' own error text offers as the example — pre-existing, deliberately unchanged, and worth deciding on in the same pass.

## 16. HIGH PRIORITY — EG market gating is client-side only; SSR HTML is always Morocco (found 2026-08-03)

**Mechanism.** `useMarketConfig` (`src/config/markets/useMarketConfig.ts`) resolves the market from the cookie in a post-mount `useEffect`; before that it returns the **Morocco** config. Its own doc comment states this outright: *"SSR-safe — returns the Morocco config on the server and on first client paint."* Every market-conditional surface on the affected routes is a **client component** reading that hook, so the **server-rendered HTML is Morocco regardless of what the `market` cookie says.** The client corrects it after hydration, which is why every browser-based EG check tonight passed.

**Evidence** — `curl -b "market=eg"` against production (`177e54b`), counting currency strings in the served HTML:

| route | MAD | EGP | verdict |
|---|---|---|---|
| `/` | **25** | 0 | leaks MA |
| `/compare` | **14** | 0 | leaks MA |
| `/sell` | **14** | 0 | leaks MA |
| `/used-cars` | 0 | 0 | correct (server-side gated) |
| `/new-cars` | 0 | 0 | correct |
| `/monthly` | 0 | 0 | correct |
| `/advisor` | 0 | 0 | correct |

`/` serves `195,000 MAD`, `112,000 MAD`, `≈ 4,322 MAD / month`. `/compare`'s RSC payload contains literal `\"market\":\"ma\",\"currencyCode\":\"MAD\"` under an EG cookie. The four correct routes already do server-side gating properly — so this is **route-specific, not global**, and the fix is bounded.

**Three consequences:**
1. An EG visitor sees a **flash of Morocco content** (MAD prices) before hydration replaces it.
2. **No-JS clients and crawlers see Morocco entirely** — including the EGP illustrative examples rendering as MAD. SEO and any link-preview/scraper sees the wrong market.
3. A **cold-load investor demo shows the wrong market on first paint**, which is exactly the audience least likely to forgive it.

**Not a regression** — this is the documented consequence of the SSR-safe hook, present since the market layer was built. It was invisible all night because every verification was done in a hydrated browser. The lesson generalises: **market-conditional behavior must be checked in the served HTML, not just the DOM.**

**How to apply:** requires reading the market cookie in **server components** for `/`, `/compare`, `/sell` (via `cookies()`), which **forces those routes dynamic** — losing their static/ISR rendering. That is an architectural change with a real performance cost, not a patch. Needs a deliberate decision (accept the flash? accept dynamic rendering? server-gate only the currency-bearing sections?) before any implementation. Compare with how `/used-cars`/`/new-cars`/`/monthly`/`/advisor` already solve it — they may be a directly copyable pattern.

## 17. In-memory rate limiter under-counts across serverless instances (found 2026-08-03)

**What:** `src/lib/rateLimit.ts` is, per its own header, an *"In-memory fixed-window rate limiter."* On Vercel's multi-instance serverless runtime each instance keeps its own counters, so the documented ceilings are effectively **multiplied by the number of live instances**. The OTP verify route's "20 attempts per IP / 15 min" and "5 failed attempts per phone / 15 min" are therefore soft, not hard. The file already concedes per-IP limits *"may be under-counted."*

**Why it matters:** the per-phone failure lockout is the OTP brute-force control. A 6-digit code with a genuinely enforced 5-failure window is safe; one enforced per-instance is weaker by an unknown factor. Not urgent while the only codes in play are the fixed public demo code, but it becomes real the moment live OTP delivery is enabled.

**How to apply:** needs shared state — Postgres (a `rate_limits` table, consistent with the rest of the migration direction) or Upstash Redis via the Vercel Marketplace. Note the free-tier constraint in [[project_no_spend_constraint]] before reaching for a paid service.

## 18. Hardcoded ADMIN_SECRET fallback in statelessAuth (found 2026-08-03)

**What:** `src/lib/statelessAuth.ts:28` signs stateless session tokens with `process.env.ADMIN_SECRET || 'lowkar-demo-stateless-session-fallback'`. When `ADMIN_SECRET` is unset, the HMAC key is a constant that is **public in the repo**, so anyone who reads the source can forge a valid `fmc_tok` for any identity — including `role: 'admin'`.

**Currently unreachable, and that is the whole safety argument.** `apiAuth.ts:50` and `:94` only fall back to `verifyStatelessToken` when `sql` is null, and `sql` is non-null in production (`SUPABASE_DB_URL` is set on `rakib-zzwn`). So the forged-token path cannot be reached today. It is a **latent forged-session primitive** that activates silently the moment the sql-never-null invariant breaks — a bad env var, a Supabase outage causing `sql` to construct as null, or a new deployment target without the DB URL. The failure mode is "auth silently downgrades to a publicly-known key," with no error.

**How to apply:** either set `ADMIN_SECRET` in production so the fallback is never the live key, or make the fallback fail closed — throw/return null instead of signing with a constant, so a missing secret disables the stateless path rather than weakening it. The second is preferable: it makes the invariant enforced rather than assumed.

**Re-confirmed 2026-08-06** by a full-history secrets audit (current tree + `git log --all -S` pickaxe search across all 208 commits/branches): this is the only hardcoded secret literal anywhere in the codebase or its history — no live credential (DB connection string, service-role key, other admin secret) was ever committed, current or historical. Severity stands as LOW: unreachable while `sql` is non-null in production, superseded by real `ADMIN_SECRET` whenever set.

## 19. Wider MA-hardcoded sweep — unclassified (found 2026-08-03)

**What:** item #15 recorded two MA-hardcoded phone sites. A broader grep for `+212` / `[67]` patterns outside `config/markets` found **eight more files**:

- `src/app/api/listings/create/route.ts`
- `src/app/api/listings/draft/route.ts`
- `src/app/api/listings/[id]/route.ts`
- `src/features/auth/components/DealerSetup.tsx`
- `src/features/dealers/DealerApplyView.tsx`
- `src/features/dealer/components/DCStorefront.tsx`
- `src/features/listings/components/detail/useContactAction.ts`
- `src/components/layout/ConsoleGate.tsx`

**Deliberately unclassified.** I did not determine which are *validation* (rejects a legitimate Egyptian number — same bug class as #15, user-facing) versus *display/masking* (formats a number for output — cosmetic under EG, no functional break). That distinction decides priority and cannot be inferred from the grep. Separately, a parallel sweep found ~15 files with hardcoded `'MAD'` literals outside config/tests, which is likely the same story on the currency axis and relates directly to item #16.

**How to apply:** classify first, fix second. Read each site and tag it validation-vs-display before scoping any work; the validation ones join #15 as real bugs, the display ones are lower priority and may be partly subsumed by whatever decision comes out of #16.

## 20. ModalHead's close button is 36×36 — under the 44px touch minimum, on every modal (found 2026-08-04)

**What:** `src/features/modals/components/ModalHead.tsx:13` renders the close control with a hardcoded `style={{ width: 36, height: 36 }}`. Measured live at 375×812: **36 × 36**, against the **44px** minimum this codebase enforces essentially everywhere else — `SEG_TOUCH_TARGET` (FinancingPanel, AuthView's market selector, the insurance lead form), `.kind-selector`'s `min-height:44px`, and `minHeight: 44` on every row of SiteHeader's mobile menu.

**Scope: every modal, not one feature.** `ModalHead` has **14 call sites** across 7 files — `AuthModals`, `ContactModal`, `FinanceModals`, `MiscModals`, `OfferModal`, `PaymentModals`, `ScheduleModals`. So this is the dismiss affordance for offers, contact, scheduling, payment, sign-in, ID verification and the rest.

**Why it matters more than a typical touch-target miss:** the other two dismiss paths are **not discoverable on mobile**. Tapping the scrim is invisible affordance, and Escape needs a keyboard. That leaves an undersized button as the only *apparent* way out of a modal — so the cost of a mis-tap isn't a minor annoyance, it's a user who feels stuck in a dialog.

**How it surfaced:** measuring the new insurance lead sheet at 375px. That sheet's own header copies `width: 36, height: 36` from `ModalHead` — so the new code *matches* the existing pattern rather than introducing a new inconsistency. Deliberately left as-is: bumping it locally would make the lead sheet the only modal in the app with a different close-button size, which is worse than being consistently slightly wrong.

**How to apply:** fix once, globally, in `ModalHead` — `width: 44, height: 44` (keep the 19px icon; the box grows, the glyph doesn't). Then re-check the header's `padding: '22px 24px 6px'` still balances against the taller control, and sweep the 14 call sites for any that visually depend on the current header height. A dedicated pass, not opportunistic: it changes the top-right corner of every modal in the product at once and deserves one deliberate visual review across them.

## 21. ADMIN_SECRET dev fallthrough — a fresh checkout has unauthenticated admin endpoints in dev (found 2026-08-04)

**What:** `src/lib/adminGuard.ts:53` is `if (!isProd) return null; // dev without a configured secret — allow`. So when `ADMIN_SECRET` is unset, **every `adminGuard`-protected route is reachable in dev with no header at all**. Confirmed live: `GET /api/admin/insurance-leads` with no `x-admin-secret` returned **200 with full lead rows** (names + phone numbers).

**Scope is all of `/api/admin`, not one route — 33 route files use `adminGuard`.** The affected surface splits into two kinds, and the second is the serious one:

*Reads — data disclosure.* `insurance-leads` (names + phone numbers), `finance/applications/*` and its `dossier.pdf` / `package.zip` exports (full applicant dossiers: identity, income, uploaded documents), `finance/external-intakes/*`, `finance/assignable-users`, `audit`, `db-diagnostics`, `smtp/status`.

*Writes — an unauthenticated dev server can take irreversible, real-world actions.* Named explicitly, because "several are mutations" undersells it:
- `listings/[id]/approve` · `reject` · `suspend` · `unsuspend` · `restore` — publish or unpublish a live marketplace listing
- `id-verifications/[id]/approve` · `reject` — grant or deny a user's identity verification
- `dealers/[id]/approve` · `reject` — admit a dealer to the verified directory
- `finance/applications/[id]/send-email` — **sends real outbound email to a finance provider.** Not a DB write: an actual message leaving the system, unauthenticated.
- `finance/applications/[id]/status` · `assignment` · `response` · `communications` · `documents/[id]/review` — move a real financing application through its lifecycle
- `reports/[id]/resolve`, `admin/maintenance`, `admin/cron`, `smtp/test`

**And because there is no dev/prod DB separation ([[project_lowkar_no_dev_prod_separation]]), every one of those writes lands on production data.** Approving a listing from an unauthenticated localhost server publishes it to real users; `send-email` reaches a real provider inbox.

**Production is NOT affected** and fails closed correctly: with `ADMIN_SECRET` absent in prod, `adminGuard` logs `no_secret_prod` and returns 403. Verified by reading the code path, not assumed.

**Two related gaps that make this easy to miss:**
- **`ADMIN_SECRET` is not in `.env.example` at all** — grep returns nothing. A fresh checkout gets no prompt that the variable exists, so the insecure-by-default state is also the silent default.
- **`adminGuard`'s own comment overstates the safety net.** It says the prod case "should have been caught by config validation (instrumentation.ts)", but `validateAdminSecret` (`src/lib/config.ts:120`) does `if (!raw) return ''` — absent is explicitly allowed, and it only throws for *weak* or *short* values. Nothing anywhere requires the variable to be set. The comment describes a validation that does not exist.

**Fixed on this machine only, 2026-08-04** — appended a 48-char random `ADMIN_SECRET` to `.env.local`. Re-verified after a dev-server restart: no header → **403**, wrong secret → **403**, correct secret → **200**. That also exercised the `safeEqual` comparison path for the first time; it had never run, since the guard short-circuited at the fallthrough before reaching it. **`.env.local` is gitignored by design (`.gitignore:41`), so this fix does not travel** — every other checkout, teammate, CI job or fresh clone still starts open.

**Durable fix options (pick one, not both):**
1. Add `ADMIN_SECRET=` to `.env.example` with a comment explaining what it guards. Cheapest; makes the requirement discoverable but still opt-in.
2. Change the `!isProd` fallthrough to fail closed even in dev. Strictly safer, but will break any local workflow that currently calls an admin route without a header — check `scripts/` and any docs' curl examples before flipping it.

Option 2 with option 1's documentation is the honest combination; option 1 alone leaves the default insecure.

**Why not fixed now:** out of scope — discovered while verifying the insurance lead-capture admin export. Changing a global auth guard, or the env contract every checkout depends on, is not a side change to a feature branch.

## 22. Uncapped free-text fields across ~10 routes — data-integrity risk, not injection (found 2026-08-06, RESOLVED 2026-08-06)

**What it was:** a full injection/XSS audit confirmed SQL is parameterized everywhere (no non-tagged `sql()` calls anywhere in `src/`, all dynamic SET/WHERE builders push hardcoded column names, never request-body keys) and there is zero unescaped-rendering surface (`dangerouslySetInnerHTML`/`innerHTML`/`eval` — zero matches in `src/`). So this was never an injection or XSS finding — it was a survey of free-text API fields that were type-checked (`typeof === 'string'`) but had no length cap, a storage-bloat / rendering-overflow risk (e.g. someone submits a 500KB "name").

**Status: fully resolved across two PRs, both merged to `main`.**

**PR #7 (`fix/uncapped-message-fields`, merged) — the two worst cases, not even type-checked:**
- `offers/route.ts` `message` — had zero `typeof` check, inserted as-is. Now: `MAX_MESSAGE_LEN = 2000`, type+length check, 400 on violation.
- `new-cars/inquire/route.ts` `message` — read via a type-assertion cast, so a non-string value (e.g. a number) threw a 500 at `message?.trim()`. Now: same pattern, validated before any string method touches it.

**PR #8 (`fix/length-cap-remaining-free-text-fields`, open — merge pending review) — every other field named below, same pattern applied consistently:**
- Listings create/draft/`[id]` PATCH: `make`/`model`/`trim`/`city`/`fuel`/`gear`/`engine`/`color`/`origin`/`drive`/`body` capped at 100 chars; `aiDescription`/`blurb` at 2000.
- `dealer/apply` + `dealer/storefront` PATCH: `businessName`/`name`/`city`/`licenseNo` at 100; `address`/`description` at 2000; `logo_url` at 2048.
- `inspection-requests`: `car_title`/`city` at 100.
- `finance/external-intakes` (POST + PATCH, multipart): `make`/`model`/`city` at 100 (widens the pre-existing reject-on-wrong-type checks); `notes` at 2000; `sourceUrl` at 2048.
- Admin fields: `providerSubmissionNotes`, provider-response `notes`, assignment `note`, communications `message`+`subject`, send-email `subject`+`message`, external-intake review `note`, and all four reject/suspend `reason` fields (listings reject, id-verifications reject, dealers reject, listings suspend).

**Deliberate scope boundary, still true post-fix:** fields that silently coerced a non-string to a default/empty value (most of the Group A/B/C fields above) were left coercing — only a length check was added on top. Turning that into reject-on-wrong-type is a separate, larger behavior change, not attempted. The two fields that genuinely had *zero* type check (`offers.message`, `new-cars-inquire.message`) got the full fix in PR #7 since that gap was independent of length.

**Nothing named in the original finding remains uncapped.** Side-effect found and fixed in PR #8: `src/test-utils/db.ts`'s SQLite test-sql shim only routed `SELECT`/`WITH` through `.all()` — an `UPDATE ... RETURNING` (used by `dealer/storefront`'s PATCH) fell through to `.run()` and silently discarded the returned row. Pre-existing gap, exposed by writing the first real test for that route; fixed by widening the row-returning check to also match a trailing `RETURNING` clause.

Reference (unchanged, still the pattern to copy for any *new* free-text field): `messages/threads/[threadId]/messages/route.ts` (`MAX_BODY_LEN = 2000`), `reports/route.ts` (`detail.slice(0, 300)`), `insurance/leads/route.ts` (`contactName` bounded 2–80 chars).

## 23. File upload MIME validation trusts client-declared Content-Type, not magic bytes (found 2026-08-06)

**What:** every upload route (`account/avatar/route.ts:44`, `listings/[id]/images/route.ts:89`, `account/id-verification/route.ts:27`, `finance/applications/[id]/documents/route.ts:85` via `isAllowedFinanceMimeType`, `finance/external-intakes/route.ts:97` via `isAllowedIntakePhotoMimeType`) validates file type against `file.type` — the multipart part's `Content-Type` header, which is attacker-controlled and not derived from the actual file bytes. A file with arbitrary content but a spoofed `Content-Type: image/jpeg` would pass every one of these checks.

**Why it's low impact today, not unexploitable-in-principle:** (1) allowlists are narrow — `image/jpeg`, `image/png`, `image/webp`, `application/pdf` only, no `text/html`/`image/svg+xml`; (2) stored objects are served either via short-lived signed URLs (finance docs, ID docs, intake photos — never public) or rendered client-side via `<img src>` (avatars, listing photos), so nothing in the app's own rendering paths would execute a mislabeled payload as HTML/script; (3) file **size** checks are real and not spoofable — computed from actual decoded bytes by Next.js's `formData()` parser, not a header. Filenames are not a path-traversal vector either: avatar/ID-doc paths use fixed server-generated names; finance docs and intake photos do use the client filename but sanitize it first (`sanitizeFinanceFileName`/`sanitizeFileName` — strip path separators, whitelist `[a-zA-Z0-9._-]`, cap length).

**How to apply:** add a magic-byte sniff (e.g. the `file-type` npm package) alongside the existing `Content-Type` check on all 5 upload routes, rejecting on mismatch. Only worth prioritizing if the allowlist ever widens (e.g. adding a document type more dangerous than PDF) or if any of these buckets ever gets linked to/served publicly rather than via signed URL.

**Why not fixed now:** defense-in-depth on a surface with no working exploit today, found during a routine security audit — not blocking anything, not urgent.

## 24. NEXT_PUBLIC_SUPABASE_URL naming mismatch — likely dead feature-detection gate (found 2026-08-06)

**What:** `src/app/(marketplace)/new-cars/page.tsx:56` reads `process.env.NEXT_PUBLIC_SUPABASE_URL` as a feature-detection gate, but that variable is never defined anywhere — not in `.env.example`, not in `.env.local`. Only the non-prefixed `SUPABASE_URL` actually exists and is used elsewhere in the app. Found incidentally while auditing `.env.example` against actual `process.env` usage for the secrets audit — not a secret/security issue, a plain naming-mismatch bug.

**Effect:** the gate this variable controls almost certainly always evaluates false (since the var is always `undefined`), so whatever behavior it's meant to enable on `/new-cars` is likely permanently off. Not verified end-to-end what the visible product effect is — that's the next step if this gets picked up.

**Why not fixed now:** out of scope for a security audit; needs someone to trace what the gate is supposed to do on `/new-cars` before touching it, since the fix could be "rename to `SUPABASE_URL`" or could be "this was meant to be a different, never-added public var" — those are different fixes.

## 26. Dealer directory / user account split — 16 of 17 verified dealers have no one who can log in (found 2026-08-09)

**What:** `dealers_dir` has 17 rows, all `verified = true`. Only **1** user in `users` has `role = 'dealer'`. The other 16 storefronts (Atlas Automotive, Bavaria Maroc, Honda Maroc, SAIC Atlas, etc.) are catalog entries with no linked account — nobody can sign in, edit the storefront, or see/respond to leads for them. Same class of bug as item #6 (dealer role split-brain), but wider: #6 was one seed-data phone mismatch, this is 16 directory rows with no owner at all.

**Why it matters:** any lead captured for one of these 16 dealers (via `dealer/leads` or a future contact flow) has nowhere real to land — no user account will ever see it. The storefronts are publicly browsable and look real to a buyer.

**How to apply:** first determine whether these 16 are meant to be real dealer accounts that were never onboarded, or seed/demo directory entries that shouldn't be `verified=true` / publicly listed at all — that product question decides whether the fix is "create/link real user accounts" or "unverify and hide them." Don't assume either without checking with the user first, same as the #1 mock-catalog question.

**Why not fixed now:** found during a full audit pass; a product decision, not a mechanical fix.

## 27. Zero UI/component test coverage (found 2026-08-09)

**What:** 1440 passing tests, 95 test files — all API routes, server-side logic, and pure helpers. `find src/__tests__ -name '*.test.tsx'` returns **0**. `@testing-library` is not imported anywhere in the repo. No component has ever been rendered in a test.

**Why it matters:** the entire user-facing surface — sell wizard, finance wizard, browse/filter UI, admin consoles — is verified only by manual browser passes during each feature's build, never re-run automatically. A regression in rendering/interaction logic (as opposed to the data layer) has no safety net. Tonight's `dealer-storefront` test-shim bug (`RETURNING` silently discarded under the old test regex) is a preview of the same class of risk: the first time any test touched that route, it immediately found a real bug — because nothing had touched it before.

**Highest-risk untested surfaces, by size/complexity:**
- `src/features/finance/components/FinanceWizard.tsx` (663 lines)
- `src/features/finance/components/FinanceOpsDetail.tsx` (1157 lines)
- `src/features/listings/BrowseView.tsx` (1041 lines)
- the sell wizard (`WizardSteps.tsx` + `SellWizard.tsx`)

**How to apply:** add `@testing-library/react` + `jsdom`/`happy-dom` to the vitest config, then start with the sell and finance wizards — the two flows where a silent UI break costs a real customer, not full-app coverage from day one.

**Why not fixed now:** a genuinely new testing layer (new deps, new config, new patterns) — not a mechanical addition to the existing suite. Found during a full audit pass, not blocking anything today.

## 28. 37 suppressed react-hooks/exhaustive-deps warnings (found 2026-08-09)

**What:** `grep -rn eslint-disable` across `src/` returns 65 total suppressions; 37 of them (29 `-next-line` + 8 `-line`) are `react-hooks/exhaustive-deps` — by far the largest single cluster, ahead of `no-console` (23) and `no-img-element` (4). This stands out because type safety elsewhere in the codebase is otherwise excellent: only 8 `: any`/`as any` occurrences and 2 `@ts-ignore`/`@ts-expect-error` across all 76,615 lines of `src/`.

**Why it matters:** a suppressed exhaustive-deps warning means an effect intentionally (or not) reads a value from an outer scope without the effect re-running when that value changes — the classic source of "works on first render, silently stale after a state update" bugs, which are expensive to diagnose after the fact because they don't throw, they just show wrong data.

**How to apply:** audit the 37 one by one. Some are almost certainly deliberate and correct (e.g., an effect that should only run once on mount, with a lint suppression documenting that choice) — those just need a comment if they don't have one. Others may be genuine bugs hiding behind a suppression added to silence the linter rather than fix the dependency. Can't tell which is which without reading each site individually.

**Why not fixed now:** 37 individual judgment calls, not a mechanical sweep — found during a full audit pass, not blocking anything today.

## 29. Arabic i18n gap — 195 keys fall back to raw English (found 2026-08-09)

**What:** `src/i18n/fr.ts` has 1727 translation keys; `src/i18n/ar.ts` has 1625. Diffing by key (not line count — `ar.ts` packs multiple entries per line, so raw line count understates it): **195 keys exist in `fr.ts` with no `ar.ts` counterpart**, meaning an Arabic-language user sees the raw English source string for those. Sample of what's missing: `"No exact matches"`, `"Popular brands"`, `"Browse"`, `"Price reduced"`, `"Van"`, `"Crossover"`, `"Local"`, `"Imported"`, plus several full sentences like `"here are similar cars you might like"`. (There are also 93 keys present in `ar.ts` but missing from `fr.ts` — likely stale AR-only keys left over from the original `web-i18n.jsx` port per that file's own header comment; lower priority since French isn't the language falling back to English.)

**Why it matters:** both Lowkar markets (Morocco, Egypt) are Arabic-speaking; this isn't a nice-to-have locale, it's core-market copy. A visible mix of Arabic UI chrome with English fallback strings reads as unfinished.

**How to apply:** translate the 195 missing keys into `ar.ts`, matching the existing key style (English source string as key, Arabic value). Bounded, mechanical, delegatable — no code changes required, just filling in the dictionary.

**Why not fixed now:** translation work, not something to improvise without a real Arabic speaker/reviewer in the loop — found during a full audit pass.

## 30. 4 dependency advisories — 1 clean fix, 3 gated behind a breaking Next.js upgrade (found 2026-08-09)

**What:** `npm audit --omit=dev` reports 4 advisories:
- **3 HIGH** — all PostCSS source-map path-traversal / arbitrary-file-read issues (`GHSA-6g55-p6wh-862q`, `GHSA-r28c-9q8g-f849`, `GHSA-fxqj-rqcc-2cmp`). `npm audit fix` alone doesn't resolve these; `npm audit fix --force` does, but it upgrades to `next@16.3.0` — a **major version bump**, not a patch.
- **1 MODERATE** — `protobufjs` 7.5.0–7.6.4, DoS via infinite loop in `.proto` option parsing (`GHSA-j3f2-48v5-ccww`). Fixes cleanly via plain `npm audit fix`, no breaking change.

**Why it's not urgent despite "high":** the PostCSS vulnerability requires processing attacker-controlled CSS with an attacker-controlled `sourceMappingURL` comment; this app only ever compiles its own stylesheets at build time, so the practical exploitable surface is close to none today. It's a supply-chain hygiene item, not a live exploit path.

**How to apply:** run `npm audit fix` now for the moderate `protobufjs` issue (no breaking change, safe to do anytime). Treat the Next.js 16 upgrade as its own planned piece of work — codemods, testing the full app against the new major version, checking for breaking changes in App Router/Server Components behavior — not something to pull in as a side effect of a security patch.

**Why not fixed now:** the safe part (protobufjs) is a fair candidate for the next verification pass; the unsafe-to-rush part (Next 16) needs deliberate planning. Found during a full audit pass.

## 25. admin/dealers/[id]/approve — same latent RETURNING/test-shim bug class as #22's storefront fix, currently dormant (found 2026-08-06)

**What:** `src/app/api/admin/dealers/[id]/approve/route.ts:51` runs `UPDATE dealers_dir SET verified = true WHERE name = ${row.business_name} RETURNING id`, then branches on `flipRows.length === 0` to decide whether to create a new `dealers_dir` entry instead of updating the matched one — the exact same shape as the `dealer/storefront` PATCH bug fixed in PR #8 (`src/test-utils/db.ts`'s SQLite test-sql shim only routed `SELECT`/`WITH` through `.all()`; an `UPDATE ... RETURNING` fell through to `.run()`, which discards the returned rows and always yields `[]`).

**Currently dormant, not a live bug.** Confirmed via grep across `src/__tests__` that no test file imports or exercises this route's handler at all — zero coverage, so there is no test whose outcome the old (pre-PR-#8) shim behavior could have flipped. **Also never a production issue**: the real Postgres client (`src/lib/supabaseDb.ts`) handles `RETURNING` correctly regardless of what the test shim does: the shim only stands in for `sql` inside the in-memory SQLite test harness.

**The risk is purely forward-looking.** `src/test-utils/db.ts` was already fixed by PR #8 to route any statement containing `RETURNING` through `.all()`, so anyone writing a test for this route *today* would get a correct result and see `flipRows` populated correctly when a name-match exists. The note is here only so nobody is confused finding this file's `RETURNING` line during a future test-writing pass: before PR #8, a test for this route would have gotten a false pass on the "no match, create a new entry" branch even when a real name-match existed and should have been updated in place — that failure mode is now closed, but is worth knowing about if this route's history or blame is ever read in isolation.

**How it was found:** while answering a direct question about the blast radius of PR #8's `test-utils/db.ts` fix — grepped for every other `RETURNING` usage in `src/` to confirm nothing else's test outcome had silently changed. This was the only other hit; empirically confirmed via a full before/after test-suite diff (1440 tests, old vs. new shim) that its absence from the diff was because it's untested, not because it was already correct some other way.

**Why not fixed now:** not an action item — there's nothing to fix. Logged purely as context for whoever eventually adds test coverage to this route, so the historical "why does this look the same as the storefront bug" question has an answer on file.

# Migration Plan — Supabase → Neon + Neon Auth + Vercel

**Status:** Planning + schema-history recovery only. No cutover work has
started; Supabase remains the live backend. This instantiates
`03-phased-plan-template.md` from the Supabase→Neon playbook with this
repo's real tables, files, and decisions, as a checklist to track against
(mirrors `ROADMAP.md`'s `[x]` / `[ ]` / `[~]` convention).

## Decisions (recorded 2026-07-04)

- [x] **API layer style:** full custom API layer (hand-written serverless
      routes, plain `requireOwnRecord`-style authorization) — not Neon Data
      API. 24 tables, every RLS policy the same shape (`auth.uid() = user_id`).
- [x] **Framework:** switch Vite SPA → Next.js App Router. App has no router
      today (`registry.js` is a static array + `sessionStorage` state) — this
      is Phase A′, done first, still pointed at Supabase.
- [x] **Cutover:** staged, informal freeze (single-user app — "freeze" means
      pausing your own writes during the sync window).

## Pre-flight — schema recovery (done)

- [x] Introspect the live Supabase database directly (not just committed
      migrations) — confirmed **24 tables**, not the 19 in prior migrations.
- [x] Recover DDL/RLS for the 5 live-only tables (`bills`, `accounts`,
      `bill_amounts`, `account_balances`, `forecast_overrides`) as
      `supabase/migrations/015_recover_undocumented_tables.sql`.
- [x] Confirm no other undocumented triggers/functions exist (only
      `handle_new_user()` / `on_auth_user_created`).
- [x] Document recovered tables in `ARCHITECTURE.md` §5.1.1.

---

## Phase A′ — Next.js migration (Supabase untouched)

> ⚠️ **DO NOT MERGE THIS PHASE'S BRANCH TO `main` YET.** `next build` now
> evaluates the whole app at build time (unlike Vite) and requires
> `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`, but
> `.github/workflows/deploy.yml` still injects the old `VITE_*`-named
> secrets into a `vite build`-shaped pipeline (`dist/` output, no
> `output: 'export'`). Merging before the hosting cutover is decided would
> silently break the production GitHub Pages auto-deploy for the live,
> daily-use app. `deploy.yml` is deliberately left untouched for now — this
> phase is Vercel-preview-only until a hosting decision is made.

- [x] Scaffold Next.js App Router routes as thin wrappers around existing
      screen components in `src/modules/*` — no UI rewrite. (`app/layout.jsx`,
      `app/AppRoot.jsx`, `app/shellContext.js`)
- [x] Convert `registry.js`'s module list into file-based routes: one
      `app/<id>/page.jsx` per module (dashboard, payperiods, creditcards,
      scenarios, budget, forecast, commitments, wealth, settings, mapping).
- [x] Convert env vars: `import.meta.env.VITE_SUPABASE_URL` /
      `VITE_SUPABASE_ANON_KEY` → `process.env.NEXT_PUBLIC_SUPABASE_URL` /
      `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`src/lib/supabase.js`, `.env.example`).
- [x] Confirm both edge functions (`ai-chat`, `monarch-sync`) still callable
      from the new Next.js shell (still hitting Supabase in this phase) —
      confirmed 2026-07-04 via manual browser test on the Vercel preview.
- [x] ~~Redirect stub for old URLs~~ — not needed; current nav is
      state-based, no bookmarkable deep links exist.

**Gate A′** (all must pass before Phase B0):
- [x] Production build clean on a Vercel preview deploy — confirmed via
      Vercel's own build log (`vercel build`, zero errors) and a direct
      fetch of `/dashboard` returning 200 with correct markup/title, zero
      runtime errors logged. Vercel project: `ai-capital-planning`
      (`prj_9L8lnUCUFICicYe2iHlPY7n5tXyB`).
- [x] Every route renders on a hard refresh mid-route, not just client nav
      — confirmed 2026-07-04, manual browser test.
- [x] Login/session still works against Supabase — confirmed 2026-07-04,
      manual browser test.
- [x] Both edge functions still respond correctly from the new shell —
      confirmed 2026-07-04, manual browser test.

**Phase A′ — complete.** Vercel preview:
`ai-capital-planning-git-claude-supabase-neon-mi-27ec41-jonncy18.vercel.app`.
Still not merged to `main` (see warning above) — production GitHub Pages
app is untouched.

## Phase B0 — Neon + Neon Auth provisioning

- [x] Provision a Neon project + dev branch — project `ai-capital-planning`
      (`soft-resonance-24018910`), branch `dev` (`br-bold-tree-aj4lwhvo`),
      org `jonncy18@gmail.com` (free tier).
- [x] Apply full schema (24 tables, RLS stripped) to the dev branch —
      constructed as final-state DDL directly from live Supabase
      introspection (replaying the 16 migration files in order would have
      failed: migrations 007/008/013/014 alter `bills` before it's ever
      created — only the recovery migration creates it). Every `user_id`
      FK points to `neon_auth."user"(id)`, not Supabase's `auth.users`.
- [x] Provision Neon Auth; verified actual backend/JWKS URL directly against
      the live config (`get_neon_auth_config`) and the real `neon_auth`
      schema (9 tables: user, session, account, verification, jwks,
      organization, member, invitation, project_config) — confirmed Better
      Auth as documented, email/password enabled, no email verification
      required, matching the app's current flow closely.
- [~] Create the one real account — **blocked in this environment**: the
      sandbox's network policy rejects outbound connections to Neon Auth's
      domain entirely (403 on CONNECT, confirmed via proxy status) — this is
      the exact "some agent sandboxes can't reach the new auth provider"
      limitation the playbook's known-gotchas anticipates. Live sign-up/login
      needs to happen from an actual browser or a real UI, deferred to
      Phase B1 (there's nothing to click yet).
- [~] Restore data — 20 of 24 tables at exact row-count parity
      (`budget_categories`, `commitments`, `credit_cards`, `accounts`,
      `bills`, `scenarios`, `scenario_adjustments`, `wealth_snapshots`,
      `ai_briefings`, `user_profiles`, `import_logs`, `budget_status`,
      `ai_preferences`, `credit_card_earn_rates`, `credit_card_points`,
      `credit_card_point_redemptions`, `income_actuals`, `bill_amounts`,
      `account_balances`, `forecast_overrides`), plus `tax_brackets` (168),
      `budget_line_items` (583), and `forecast_line_items` (555) — all
      verified exact. **`transactions` deliberately left partial (1,450 of
      4,920 rows)** — decision made 2026-07-04: copying ~4,920 rows one
      batch at a time through agent-orchestrated SQL was taking over an
      hour and is the wrong tool for bulk data movement anyway. 1,450 rows
      is more than enough sample data to build and test the read/write API
      layer against. Full backfill is deferred to the actual cutover
      (Phase C), where a direct `pg_dump | psql` pipeline moves all rows in
      one shot — the approach `04-data-migration-runbook.md` recommends in
      the first place, not per-row agent SQL.
- [x] Bridge user row: a temporary `neon_auth."user"` row
      (`157a1267-6adf-4371-bd72-2e9bdbca64ad`, email `jonncy18@gmail.com`)
      was created so all migrated data's `user_id` FKs resolve correctly
      ahead of a real Neon Auth sign-up existing. **Needs reconciling in
      Phase B1/B2**: once a real account signs up through the app, either
      that signup's user id must match this bridge id, or all `user_id`
      columns need a one-time UPDATE to the real signed-up user's id.

**Gate B0:**
- [x] Schema verification: all 24 tables + 24 indexes present, correct FKs,
      no RLS, spot-checked column-by-column against the original Supabase
      schema.
- [~] Data verification: 20/24 tables at exact parity; `transactions` at
      1,450/4,920 by deliberate decision (see above), not a gap to close
      before moving on.
- [ ] Login against Neon Auth succeeds for a real account — blocked by
      sandbox network policy, deferred to Phase B1's browser-testable UI.

**Phase B0 — functionally complete enough to proceed to Phase B1.** The two
open items above (auth login test, transaction backfill) don't block
building the API layer; both close out naturally once Phase B1 exists to
test against.

## Phase B1 — Read path

### Pilot slice (done, 2026-07-04) — proves the pattern on one module

Before rolling the read/write + auth pattern out across all ~95 call
sites, built and proved it narrow on one small, self-contained module
first (`commitments` — single table, simple CRUD, 0 production rows at
risk):

- [x] Shared Postgres client for Neon — `src/lib/neon/client.js`
- [x] ~~Hand-rolled JWT-verification helper~~ — built, tested working, then
      **superseded and deleted** in favor of Neon's official SDK (see below).
- [x] Commitments CRUD API routes — `app/api/commitments/route.js` (GET/POST),
      `app/api/commitments/[id]/route.js` (PATCH/DELETE). Every query's
      `WHERE` clause includes `user_id = <verified userId>` as the
      authorization boundary — reviewed directly, not just self-reported by
      the build agent.
- [x] Standalone test harness — `app/neon-auth-test/page.jsx` (unlinked from
      any nav), exercises sign-up/sign-in/session/Commitments end to end.
- [x] **Live browser verification — confirmed twice, 2026-07-04.** Once
      against the hand-rolled REST+JWT approach, then again against the
      official SDK rework below — both proved the full round trip working.
- Main app's `Login.jsx`, `Commitments.jsx`, and everything Supabase-related
  are **untouched** — purely additive, reversible by deleting the pilot files.

**Switched to Neon's official `@neondatabase/auth` SDK (2026-07-04)** —
decided after the hand-rolled pass surfaced two real, non-obvious bugs
(below). The SDK handles session cookies, JWT refresh, and CSRF
automatically instead of us re-deriving it:
- `src/lib/neon/authServer.js` — `createNeonAuth({ baseUrl, cookies: { secret } })`
- `app/api/auth/[...path]/route.js` — `auth.handler()`, proxies all auth
  calls through this app's own origin (confirmed by reading the installed
  package's actual source, not assumed: `createAuthClient()` takes no
  arguments and issues relative fetches — the browser never talks to
  Neon's auth domain directly, sidestepping CORS/trusted-origin concerns
  entirely for every future module).
- API routes now check `const { data: session } = await auth.getSession()`
  instead of a hand-rolled Bearer/JWKS check — same `WHERE user_id = ...`
  authorization boundary, just a different auth-check block.
- Requires two Vercel env vars: `NEON_AUTH_BASE_URL`,
  `NEON_AUTH_COOKIE_SECRET` (a random signing key, generated once, not
  tied to any account).
- **Live browser verification confirmed 2026-07-04** — sign-in → Get
  Session (cookie, no token handling) → create/list commitment, all
  working against the Vercel preview + Neon dev branch.

**Two real bugs found and fixed during the hand-rolled pass, now moot
since the SDK replaced that code, but documented in case any future
module needs a direct-REST fallback:**
1. Sign-up/sign-in's own REST response `token` field is an opaque session
   token, not a JWT — fails JWKS verification (`Invalid Compact JWS`). The
   real JWT requires a separate `GET {base_url}/token` call. The SDK
   avoids this entirely (session cookies, no manual token handling).
2. **`sql.json(...)` doesn't exist on `@neondatabase/serverless`** — that's
   `postgres.js`'s API, not Neon's driver. Every jsonb column write across
   the app needs `JSON.stringify(value)::jsonb` instead. Fixed in both
   Commitments routes; grep for this pattern before porting any other
   table with jsonb columns (`budget_categories`, `commitments`,
   `ai_preferences`, `user_profiles.tax_profile`, `tax_brackets`, etc.) —
   this one is unrelated to the auth switch and will still recur.

### Full rollout — broad, in waves (started 2026-07-04)

Same pattern as the pilot, applied file-by-file: `auth.getSession()` check →
401 if absent → every query scoped by `WHERE user_id = ...` → jsonb columns
written as `${JSON.stringify(value)}::jsonb`.

- [x] **Wave 1 — done, committed (`85a8674`, `e71e6b2`, `ee408ff`):**
  - `app/api/ai-briefings/route.js` — GET (latest by `module_context`), POST
  - `app/api/wealth-snapshots/route.js` + `[id]/route.js` — GET
    (list/`?latest=true`), POST, DELETE
  - `app/api/scenarios/route.js`, `[id]/route.js`,
    `[id]/adjustments/route.js`, `[id]/adjustments/[adjustmentId]/route.js`
    — full CRUD; hardened beyond source (adjustment writes verify category
    ownership; adjustment delete scopes by `scenario_id+user_id`, not just
    `id`); `cloneScenario` deliberately not ported (multi-step, out of
    narrow scope) — tracked below
  - `app/api/ai-preferences/route.js` — GET/PUT, single-row upsert via
    `ON CONFLICT (user_id) DO UPDATE`
  - `app/api/budget-categories/route.js`, `[id]/route.js`, `import/route.js`
    — GET, POST/PATCH/DELETE, bulk import; also fixed a real Phase B0 schema
    gap found in this wave (see `016_neon_budget_categories_unique_constraint.sql`)
  - `app/api/transactions/route.js`, `recent/route.js`, `analysis/route.js`,
    `by-category/route.js`, `by-month/route.js`, `year/[year]/route.js` —
    full read path + bulk-import POST (`ON CONFLICT (user_id, dedup_key) DO
    NOTHING` via `jsonb_to_recordset`)
- [x] **Wave 2 — done, committed (`5f981ff`, `e7804c1`, `86d994a`, `0a120db`,
      `17bb0ce`, `a65c53c`):**
  - `app/api/import-logs/route.js` — GET (last 50), POST
  - `app/api/budget-status/route.js` — GET (`?year=&version=`), PUT upsert
  - `app/api/tax-brackets/route.js` — GET, mirrors `loadAll()` (world-readable
    reference data, no `user_id` column — only a session check, not an
    ownership filter)
  - `app/api/income-actuals/route.js` + `transactions/route.js` — GET/POST/
    DELETE plus the "pull from transaction history" read
  - `app/api/profile/route.js` — GET, PUT (full upsert), PATCH
    (`min_checking_balance` only, kept separate so it can't clobber the
    other ~19 fields)
  - `app/api/budget-line-items/route.js`, `years/route.js`, `[id]/route.js`
    — GET (joined with `budget_categories`), POST (bulk replace-for-year via
    `sql.transaction([DELETE, INSERT])`, or single insert), PATCH/DELETE;
    hardened beyond source (`updateLineItemAmount`/`deleteLineItem` only
    filtered by `id` in Supabase, relying on RLS — added
    `AND user_id = ...` + 404, same class of fix as Wave 1's scenarios port)
  - **3 more real Phase B0 schema gaps found and fixed** (same pattern as
    `budget_categories` in Wave 1): `income_actuals`, `tax_brackets`, and
    `budget_status` were all missing their Supabase unique constraints on
    Neon. Fixed via `017_neon_missing_unique_constraints.sql` (along with
    `credit_card_earn_rates`, needed for Wave 3).
- [x] **Wave 3 — done, committed (`71d4caa`, `ef428f2`, `9386448`,
      `bb2b860`):**
  - `app/api/forecast-overrides/route.js` — GET (joined with
    `budget_categories`), POST upsert, DELETE; fixed a real missing unique
    constraint on `(user_id, category_id, budget_year, month)`
    (`019_neon_forecast_overrides_unique_constraint.sql`)
  - `app/api/credit-cards/route.js`, `[id]/route.js`, `earn-rates/route.js`,
    `points/route.js`, `redemptions/route.js` + `[id]/route.js`,
    `transaction-accounts/route.js`, `settings/route.js` — full CRUD across
    all 4 credit-card tables plus a dedicated `cc_coverage_pct`/
    `cc_optimization_pct` settings endpoint (kept separate from
    `app/api/profile/route.js`, which deliberately excludes those two
    columns); hardened beyond source on `deleteCreditCard`, `deleteEarnRate`,
    `upsertPointRedemption`'s update path, and `deletePointRedemption` (all
    bare-`id` mutations in Supabase, relying on RLS alone)
  - `app/api/accounts/route.js` + `[id]/route.js`, `app/api/bills/route.js` +
    `[id]/route.js` + `forecast-amounts/route.js`,
    `app/api/bill-amounts/route.js` + `[billId]/[year]/[month]/route.js`,
    `app/api/account-balances/route.js` — full CRUD across `accounts`,
    `bills`, `bill_amounts`, `account_balances`; hardened beyond source on
    `deleteAccount`/`deleteBill` (bare-id) and on every `bill_amounts`
    operation (source took no `userId` at all — added an `EXISTS` ownership
    join against `bills`); `pay_day` is recomputed server-side from
    `pay_same_as_due` rather than trusted from the client. Fixed 2 more real
    missing unique constraints (`bill_amounts(bill_id,year,month)`,
    `account_balances(account_id,year,month,period_half)`,
    `018_neon_bills_unique_constraints.sql`)
  - `app/api/forecast-line-items/route.js`, `[id]/route.js`, `seed/route.js`,
    `reset/route.js`, `by-label/route.js`, `set-rate/route.js` — full CRUD +
    seed/reset/rate-fill operations; hardened beyond source on
    `updateForecastLineItem`/`deleteForecastLineItem` (bare-id); reads
    `budget_line_items` directly via SQL join rather than an internal HTTP
    round-trip; `resetForecastToBudget`'s delete-then-reseed and
    `setForecastRate`'s delete-then-insert both run as a single atomic
    `sql.transaction([...])`
  - **This completes the broad rollout — all 17 `src/lib/db/*.js` modules
    (plus the `commitments` pilot) now have a parallel Neon-backed API
    route.** `src/lib/db/*.js` and every Supabase-backed module remain fully
    intact and untouched — the app still runs on Supabase in production;
    this rollout only built the new Neon API layer alongside it.
- [ ] Follow-up gaps tracked, not blocking: `cloneScenario`,
      `getUserGroups`/`getExcludedCategoryNames`/`seedDefaultCategories`
      (`src/lib/db/budgetCategories.js`)
- [ ] Fold in the two files that bypass the `db/` layer today and query
      Supabase directly: `src/modules/dashboard/Dashboard.jsx`,
      `src/modules/creditcards/CreditCards.jsx` — not yet started; these
      still read/write Supabase directly, same as every other module's UI
      layer (frontend cutover to the Neon API is Phase C, not this rollout)
- [x] ~~Public whitelist endpoint~~ — not needed; no unauthenticated read
      paths exist anywhere in this app

**Gate B1:**
- [x] Pilot module (commitments): auth check + query pattern built,
      code-reviewed, and confirmed working live end-to-end in browser
      (2026-07-04) — create + list round trip against Neon.
- [x] All 17 modules (Waves 1-3) built and build-verified (`npm run build`
      clean each time); live browser verification still outstanding beyond
      the original pilot — deferred to Phase C cutover testing.
- [ ] Every module renders from Neon, visually identical to Supabase version
      — blocked on the frontend actually switching to the new API routes
      (currently additive-only; UI still reads Supabase)
- [ ] A request with no/forged token 403s (not a silent broad read)

## Phase B2 — Write path

- [x] **Port every write call site** — already done: every Wave 1-3 route
      was built with full CRUD (GET+POST/PATCH/DELETE together), not reads
      first and writes later, so this phase's core work landed alongside
      Phase B1's.
- [x] **Reviewed multi-step client-orchestrated writes** — confirmed via a
      fresh read of the source, no server transaction needed beyond what's
      already built:
  - [x] `promoteToCommitted`/`promoteToModeled` (`src/lib/db/scenarios.js`)
        — each is a single UPDATE statement, no second table write (no
        baseline audit record exists in the source despite the phase note
        above suggesting one — verified by reading the actual functions).
        Already correctly ported as a single UPDATE in
        `app/api/scenarios/[id]/route.js`'s PATCH.
  - [x] `saveBudgetForYear` (`src/lib/db/budgetLineItems.js`) — already
        ported as an atomic `sql.transaction([DELETE, INSERT])` in Wave 2
        (see above).
  - [x] CSV import path — `importTransactions` and `logImport` are separate,
        decoupled calls from `src/modules/import/ImportFlow.jsx` (the
        source itself wraps the `logImport` call in a non-fatal try/catch,
        confirming it's deliberately not transactional with the import).
        Already correctly ported as two independent endpoints
        (`app/api/transactions` POST, `app/api/import-logs` POST).
- [x] **Application-level equivalent of `handle_new_user()`** — Neon Auth
      has no trigger hook on user creation, so `GET /api/profile` now runs
      the same idempotent `INSERT INTO user_profiles (id) VALUES (...) ON
      CONFLICT (id) DO NOTHING` before its SELECT, ensuring a row exists on
      first authenticated read (the same point `Login → Onboarding` already
      gates on `onboarding_complete` from this table). Verified live against
      the Neon dev branch with a throwaway insert/re-insert/cleanup.

**Gate B2:**
- [ ] Scripted CRUD walkthrough across all 24 tables passes — not yet run;
      needs a live browser or scripted HTTP pass, deferred alongside the
      rest of Phase B1's live-verification backlog.
- [x] Profile auto-provisioning fires correctly for a fresh Neon Auth signup
      — verified via direct SQL insert/re-insert against the real schema
      (idempotent, correct defaults). Not yet exercised through an actual
      Neon Auth sign-up + first `GET /api/profile` call in a browser.

## Phase B3 — Realtime → polling

- [x] **Skipped** — zero `.channel()`/`.subscribe()` call sites anywhere in
      `src/`; nothing to replace.

## Phase B4 — Auth completion

- [x] ~~Remove cosmetic/fake gates~~ — none exist; only real gate is the
      `session` check in `App.jsx`
- [~] Direct-probe test: hit a scoped Neon-backed route with no/forged token,
      confirm 403 now that RLS isn't the enforcement layer — **blocked in
      this sandbox**: outbound curl to the Vercel preview domain fails
      (network policy), the same class of restriction that blocked live
      Neon Auth testing in Phase B0. Every route already returns 401 (not
      403, but the equivalent "no session, no data" behavior) via its
      `if (!session?.user?.id)` guard — reviewed directly in code across
      all 20 route files, not just self-reported. Needs a real curl/browser
      probe from outside this sandbox to close out.

**Gate B4:**
- [ ] Logged-out access limited to the login screen only
- [ ] Direct-URL probe against a scoped endpoint with the wrong/missing
      identity fails correctly

## Phase B5 — Remaining server-side logic

- [x] Port `supabase/functions/ai-chat` → `app/api/ai-chat/route.js` — same
      request/response contract (`{messages, system, maxTokens, model,
      modelFamily, cacheSystem, tools}` in, `{text, content, stop_reason}`
      out), model-resolution caching logic ported as-is. Needs a fresh
      `ANTHROPIC_API_KEY` Vercel env var — not yet set, not copied from
      Supabase.
- [x] Port `supabase/functions/monarch-sync` → `app/api/monarch-sync/route.js`
      — same contract. The Supabase gateway's JWT verification (which the
      Deno function relied on implicitly) is replaced with an explicit
      `auth.getSession()` check, same pattern as every other route in this
      migration. **Real bug fixed during the port**: the source generated
      its Monarch `device-uuid` once at module scope (top-level
      `crypto.randomUUID()`), reused across every request to a warm Deno
      instance — different users would share one device UUID. Now generated
      per-request.
- [ ] Re-run the golden-question suite: grill session, scenario AI composer,
      AI briefing, category/bill/credit-card parsers (9 call sites funneled
      through `sendMessage.js`) — blocked until an `ANTHROPIC_API_KEY` is set
      on Vercel and the client wrappers (`sendMessage.js`, `monarch.js`) are
      switched from `supabase.functions.invoke(...)` to `fetch('/api/...')`;
      neither has happened yet (additive-only, same as every other module —
      the frontend still calls the Supabase functions today).

**Gate B5:**
- [ ] Every AI capability produces the same response shape as today — routes
      are contract-compatible by construction (verified by reading the exact
      shapes both `sendMessage.js` and `monarch.js` expect and matching them
      exactly), but not yet exercised live: needs the API key + frontend
      switch above.
- [ ] `monarch-sync` still authenticates and paginates correctly — same
      blocker (needs a live Monarch account + frontend switch to test).

## Phase C — Cutover

- [ ] Write out the rollback script (revert Vercel env vars, resume
      Supabase writes) *before* flipping anything
- [ ] Pause your own writes (informal freeze)
- [ ] Final data re-sync + full verification suite — must match exactly
      across all 24 tables
- [ ] Flip Vercel env vars to Neon/Neon Auth production config
- [ ] Smoke test: login → one read (Dashboard) → one write (add a
      transaction or adjustment) → one multi-step transaction (promote a
      scenario) → one AI call (briefing or command bar)
- [ ] Leave the Supabase project **paused, not deleted**

## Phase D — Decommission

- [ ] Run the fresh-context audit (`06-post-migration-audit-prompt.md`) as a
      genuinely new subagent — both the code-reference sweep and the
      data-path trace variant (this repo has one confirmed history of
      live-only undocumented state, so don't skip the trace variant)
- [ ] Fix anything the audit finds
- [ ] Remove `@supabase/supabase-js` from `package.json`
- [ ] Delete `supabase/` (functions + migrations) after archiving final
      schema state wherever Neon migrations are tracked going forward
- [ ] Delete `.github/workflows/deploy.yml` if fully replaced by Vercel's
      own deploy
- [ ] Update `ARCHITECTURE.md` §3.3 and §5 to describe Neon as current
- [ ] Pause (don't delete) the Supabase project for a fallback window

---

## Already ruled out — no work needed here

- Realtime replacement (Phase B3)
- Public/anon-key read-site hardening (no public pages exist)
- Cosmetic auth gate removal (none exist)
- `uuid-ossp` extension work (schema is `gen_random_uuid()` throughout)

## Watch for while building

- **Numeric stringification** — every `numeric` column comes back as a
  string from Neon's driver, not a JS number. Audit `.toFixed()`/arithmetic
  call sites in the dashboard widgets, forecast grid, and wealth projection
  during Phase B1, not after.
- **Neon Auth `trusted_origins`** — list every Vercel hostname (production
  domain, `-xxxxx.vercel.app`, `-git-main-*.vercel.app`) once Phase A′ is
  live, or preview-deploy logins fail with a generic "invalid credentials"
  message that looks like a wrong password.

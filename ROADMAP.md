# AI Capital Planning OS — V1 Roadmap

**Repo:** AI Capital Planning  
**Architecture Reference:** `ARCHITECTURE.md`  
**Build Philosophy:** Schema first, data layer second, UI third. No frontend work before the data model is solid. Each phase produces something usable before the next phase begins.

---

## Next Up

Post-migration hardening. The Supabase → Neon + Neon Auth + Vercel migration is complete and live on `main`, and the scenario-commit → Forecast → Bill Planner write-through shipped 2026-07-10. The standout open gap is test coverage — there is still no automated test suite for the app's ~53 routes. Work has shifted from feature/migration delivery into the hardening backlog.

## Current Status — Session Log

**Last updated:** 2026-07-24 (Income side added to the Scenario Planner)

- **Scenario Planner — Income tab (2026-07-24):** the planner was expense-only
  (each `scenario_adjustments` row is a delta on a budget category). Added an
  **Income** tab to model the revenue side — raises, bonus changes, new recurring
  income, and one-time windfalls (Phase 1 approval → build; **not yet
  live-verified**).
  - **Schema (`db/migrations/021_income_scenarios.sql`):** `scenarios.kind`
    ('expense' default | 'income') + new `scenario_income_adjustments` table
    (per-month signed `gross_amount` for display and `net_amount` post-tax for
    integration; `income_type`, `taxable`). **Additive/safe, but NOT yet applied
    to the Neon dev branch** — the user declined the live apply mid-session.
    Must be applied before the feature works; the scenarios POST route falls back
    to a kind-less insert if the column is absent, so expense scenario creation
    never breaks if code ships ahead of the migration.
  - **Net math (`src/lib/income/incomeScenarioMath.js`):** user enters gross; net
    is derived with the same effective tax rate + 401k % the dashboard income
    forecast uses. Verified against the plan's worked example (a $132k→$150k raise
    from Aug nets +$4,800 for the year: $7,500 gross − $2,100 tax − $600 401k).
  - **Integration:** `contextLoader` sums committed income `net_amount` per month
    into `ctx.incomeScenarioNetByMonth`; `incomeVsExpenses()` folds it into the
    monthly income forecast so dashboard net/savings and the AI brief reflect it.
    Committing an income scenario skips the `forecast_line_items` write (income
    isn't there). Expense tabs filter to `kind='expense'`; the AI brief gains
    committed/modeled income-scenario sections.
  - **UI (`src/modules/scenarios/Scenarios.jsx`):** new Income tab with a 4-type
    form, live post-tax impact preview (gross → tax → 401k → net), preview →
    Commit / Keep-modeled, and a list of income scenarios with commit/revert/
    delete + per-month detail.
  - **API:** `app/api/scenarios/[id]/income-adjustments/` (GET/POST) and
    `.../[adjId]` (DELETE); scenarios POST accepts `kind`; PATCH commit branches
    on kind. Build clean (`next build`, 54 pages incl. the new routes).
  - **Deferred:** AI natural-language income scenarios (manual-first per the
    plan); Wealth Trajectory income-awareness (it uses a manual contribution
    slider today).

- **AI Scenario Composer silent-stall fix (2026-07-24):** building a realistic
  multi-part scenario (reported live: a Tesla Model 3 lease correction — new
  $479/mo payment + 2-month overlap with the old lease + FSD $99/mo + $2,022
  delivery fee + down payment, spanning a multi-year lease) produced a **blank
  AI bubble with no preview and no error**, and every retry repeated it.
  - **Root cause:** `runScenarioAgent`/`continueFromMessages` capped model output
    at `maxTokens: 1500` (and `runAdjustmentAgent` at 1024). A large
    `create_scenario` tool call serialized past that limit, so Anthropic
    truncated it with `stop_reason: 'max_tokens'`. The agent only branched on
    `'tool_use'`; the truncated call fell through to `return { text: res.text }`
    with `res.text` empty (the whole response was the cut-off tool call) →
    silent blank.
  - **Fix (`src/lib/ai/scenarioAgent.js`):** raised the ceiling for tool-bearing
    calls to `AGENT_MAX_TOKENS = 8000` so realistic multi-month/multi-year
    scenarios fit; added explicit `stop_reason === 'max_tokens'` handling that
    returns a clear "too large — split it into smaller pieces" message instead of
    a blank; and made the non-tool path fall back to a rephrase prompt when the
    model returns empty text. Applied to both the create-scenario and
    add-adjustment agents. Build verified clean (`next build`, 54 pages).
    **Live-verification pending** — re-run the Tesla correction in the composer.

- **PWA icons → Orbit brand mark (2026-07-24):** replaced the placeholder bolt
  PWA icons with the final "Orbit" app icon (gradient "C" + gold trajectory pin
  on orbital rings). `icon-192`/`icon-512` are the full tile; `maskable-512` is
  inset ~84% for Android's circle crop. Master kept at
  `assets/orbit-icon-master.png` (outside the web-served `public/` path). Merged
  in #156. (A stale home-screen icon after install is a device/browser cache
  artifact — remove and reinstall to refresh; the served assets are correct.)

- **PWA wrapper shipped (2026-07-23):** the app is now an installable Progressive
  Web App (Phase 1 approval → build → audit per the Agentic Loop; audit passed
  clean, no iterations). Runbook `docs/PWA.md` updated from PLANNED to BUILT.
  - `app/manifest.js` → `/manifest.webmanifest` (`start_url: "/"` → Dashboard,
    `display: standalone`, `theme_color`/`background_color` `#0C0F12` = the app's
    real `--bg-app` dark chrome, pulled from `src/styles/tokens.css`).
  - `app/sw.js` — Serwist (`@serwist/next` 9.5.12) service worker. **All
    `/api/**` (data + AI) are `NetworkOnly`** (registered ahead of `defaultCache`
    so it beats Serwist's default NetworkFirst `/api` handler) — never cache
    financials or AI answers; static shell/assets use Serwist's Next.js defaults.
  - `public/icons/{icon-192,icon-512,maskable-512}.png` — rasterized from the
    existing `public/favicon.svg` brand mark via Playwright/Chromium (no
    sharp/imagemagick in the env); maskable carries a safe margin.
  - `app/layout.jsx` — `metadata` (manifest, appleWebApp, apple-touch icon) +
    `viewport.themeColor`, added without disturbing the existing server-component
    `<head>`/theme-init logic.
  - **Build-system change:** Next 16 defaults to Turbopack, but `@serwist/next`
    bundles the SW via a webpack plugin (silently skipped under Turbopack). The
    `build` script is now **`next build --webpack`** (required); `next dev` stays
    on Turbopack (SW `disable`d in dev) via an empty `turbopack: {}`. Generated
    `public/sw.js` is gitignored.
  - Verified: `npm run build` compiles clean (53 routes), `✓ (serwist) Bundling
    the service worker script`, `/manifest.webmanifest` static-rendered, SW
    contains the `/api/` NetworkOnly rule, lint clean. **Runtime install/offline
    behavior is visually unverified** — needs a browser against the Vercel HTTPS
    deploy (the CI sandbox lacks `NEON_AUTH_COOKIE_SECRET` + outbound access).
  - Distribution (Play Store, TWA vs. public listing) remains a deliberately
    deferred decision — see `docs/PWA.md`; the PWA keeps both doors open.

- **Scenario commit → Forecast → Bill Planner pipeline (2026-07-10):** Previously, committing a scenario only flipped its status chip — the Forecast module showed committed deltas solely as an optional, unsaved "Committed Scenarios ▾" overlay, and Bill Planner had no scenario awareness at all. Built the missing write-through:
  - `db/migrations/020_forecast_line_items_scenario_source.sql` — adds nullable `forecast_line_items.source_scenario_id` (FK to `scenarios`), applied directly to the live `dev` branch (the branch the app actually runs against — confirmed `main` has no tables, despite being marked `default`/`primary` in the Neon project).
  - `app/api/scenarios/[id]/route.js` `PATCH` — committing a scenario (`state → 'committed'`) now atomically inserts one `forecast_line_items` row per `scenario_adjustment` (same `category_id`/`month`/`year→budget_year`, `amount = delta_amount`, `label` prefixed with the scenario name, `source: 'scenario'`, tagged with `source_scenario_id`). Leaving `committed` (or `DELETE`ing the scenario) deletes those tagged rows in the same transaction, cleanly reverting the forecast. Since `app/api/bills/forecast-amounts` already sums `forecast_line_items` by `category_id`, Bill Planner picks up the change with no code changes of its own — all three tables key off the same `budget_categories.id`.
  - **Backfilled the 3 scenarios already committed in production** (Tesla Model 3 lease replacement, Flights timing shift, Claude Max cloud services) — their 15 adjustment rows didn't exist yet when this feature shipped, so a one-time `INSERT ... SELECT` (identical shape to the route's own insert) ran directly against Neon. Verified: `Monthly Car Payment`'s forecast now correctly drops $467 → $349 for Oct–Dec 2026, matching the committed lease-replacement scenario.
  - `src/modules/forecast/Forecast.jsx` — removed the "Committed Scenarios ▾" tier (state, dropdown, chart line, legend, summary text) since committed scenarios are now baked directly into the base Forecast and the overlay would double-count. The "Modeled ▾" tier is unchanged — modeled scenarios remain exploratory-only, never written.
  - Build verified clean (`next build`, 53 routes). No test suite exists yet to run (tracked in the hardening backlog).

- **Post-migration verification (2026-07-08):** user confirmed, live in the browser, the three features that had shipped audited-but-unverified: Grill Session (Budget module), the Scenario Planner's Baseline/Committed/Modeled/Ideas 4-tab layout, and the AI Adjustment Composer. Also confirmed a real Monarch CSV export imports end-to-end (parse → unmapped-category screen → dedup → dashboard). This closes out the last of the pre-migration "Recommended next session" checklist; see that section below for the current (hardening-focused) list. Also corrected a stale note: the 2026-07-04 Phase B0 "`transactions` backfill is skipped" decision was already superseded the next day by the live-verification re-upload (row gap closed to 4,977/4,980) — the ROADMAP hadn't been cleaned up to reflect that.

**Previously last updated:** 2026-07-05 (Migration fully complete: merged to `main`, Vercel Production tracks `main`, GitHub Pages retired, Supabase project paused — no rollback-net pieces remain live)

- **Phase C — cutover to production, complete (2026-07-05):** Promoted the migration branch to Vercel Production (dashboard action, not a `main` merge), then switched Vercel's Production environment to **Branch Tracking** on `claude/supabase-neon-migration-review-2np75c` so every push auto-deploys to `ai-capital-planning.vercel.app` with no manual promote step. Fixed a 403 on first login: Neon Auth's `trusted_origins` only had the branch-preview URL — added both production domain aliases. Full smoke test passed: login, every module's reads/writes, a scenario clone + delete, AI calls.
  - **Live testing found and fixed 6 real bugs** (beyond the earlier browser-verification pass): a numeric-alignment regression (the old Vite app's `#root { text-align: center }` baseline had no equivalent under Next.js's `<body>` root — restored on `body`); 8 AI parser modules (`accountParser`, `billParser`, `billAmountsParser`, `creditCardParser` ×2, `categoryMapper`, `suggestBuckets`, `suggestTabMatches`, `grillSession`) still calling the old Supabase edge function directly instead of `/api/ai-chat` (found by a pre-cleanup audit, fixed via a new `aiChatRaw.js` helper preserving the exact `{data,error}` contract); the grill session's opening call sending an empty `messages: []` array, which both the old and new AI routes reject — a pre-existing bug, not a migration regression, just never exercised before; an overlapping in-detail "✦ AI" button in Scenarios blocking the Confirm-delete button; and — the big one — **all 15 foreign keys in the schema had lost their `ON DELETE` rule** (`CASCADE`/`SET NULL` on Supabase → `NO ACTION` on Neon) during the original schema recreation, so deleting an account, bill, credit card, budget category, commitment, or scenario with any related data 500'd. Fixed all 6 affected DELETE routes atomically, replicating Supabase's exact original semantics. All fixes verified live on production after each push.
  - You added 2 real scenarios and re-uploaded a fuller Monarch transactions export directly against the Neon-backed preview during this session — both re-synced/backfilled into Neon (scenarios copied from Supabase with their adjustments; transactions went from 3,735 → 4,977 of Supabase's 4,980, the 3-row gap accepted as noise).
- **Phase D — cleanup, complete (2026-07-05):** Removed `src/lib/supabase.js` and the `@supabase/supabase-js` dependency (zero real importers left, verified before and after the AI parser fix), `NEXT_PUBLIC_SUPABASE_*` from `.env.example`, the orphaned `app/neon-auth-test/` pilot page, and Vite-era `eslint-plugin-react-refresh`. `npm run build` verified to succeed with **zero Supabase env vars set at all**. `ARCHITECTURE.md` updated to describe the current Neon/Vercel/Neon-Auth stack.
- **Full cutover: merged to `main`, GitHub Pages retired (2026-07-05).** After a short burn-in on the branch preview, the user confirmed everything works and pushed the whole migration through:
  - Marked PR #142 ready for review (it had sat as a draft since Phase A′) with an updated title/description reflecting the actual final scope, then merged it into `main` — a clean fast-forward, zero divergence (`main` had no independent commits since the branch was cut). Merge commit `44aa527`.
  - User flipped Vercel's Production environment's branch tracking from the migration branch to `main`. Confirmed the resulting deployment builds from `main` (commit `44aa527`), targets `production`, and serves correctly on `ai-capital-planning.vercel.app` — Neon Auth's `trusted_origins` already covered that domain, so no login breakage.
  - Deleted `.github/workflows/deploy.yml` (after explicit confirmation, since an earlier "wait a few days" deferral had been in place and a permission classifier correctly paused to double-check before deleting a safety-net file). GitHub Pages stops receiving new deployments; its last successful build stays published/frozen — deleting the workflow doesn't take down existing Pages content. GitHub itself remains the source-control repo throughout; only the old static-hosting pipeline is gone.
  - **Supabase project paused (2026-07-05, user action).** Data preserved, not deleted — reversible if ever needed. This was the last piece of the original rollback net. **The migration is now fully complete end to end: Neon + Neon Auth + Vercel is the entire live stack, with nothing left running on Supabase or GitHub Pages.**

- **Frontend cutover (Supabase → Neon), all stages — committed (2026-07-05):** Phase B1/B2/B5 built the parallel Neon API layer, but the app itself still called Supabase directly for everything, including auth — so none of that new layer could be exercised through the real UI. Built the frontend cutover in staged, verified waves (parallel background build agents per module, same pattern as the backend rollout), preserving every function's exact exported signature/return shape so no `src/modules/*.jsx` UI component needed to change:
  - **Stage 1 (auth):** `src/lib/auth/useAuth.js` and `src/modules/auth/Login.jsx` rewritten to use the `@neondatabase/auth` client SDK (`authClient.useSession()`/`signUp.email()`/`signIn.email()`) instead of `supabase.auth.*`, preserving the `{session, loading, user}` hook shape. Added a required `name` field to sign-up (Neon Auth's user table has `NOT NULL name`, unlike Supabase). `app/AppRoot.jsx`'s sign-out switched to `authClient.signOut()`. `src/lib/db/profile.js` rewritten as the reference template every subsequent module followed: a `parseJsonOrThrow(res)` helper, `fetch(url, {credentials:'include'})` for every call, unused `userId` params kept as `_userId` for signature compatibility. Commit `9e14963`.
  - **Wave A (6 modules):** `commitments`, `transactions`, `budgetCategories`, `scenarios`, `wealthSnapshots`, `aiBriefings`+`aiPreferences` — all rewritten to call their already-built Neon routes. Commits `949c064`, `38dc977`, `2d93df9`, `99a30e3`, `bba2eae`, `fcb8032`.
  - **Wave B (9 modules):** `importLog`+`budgetStatus`, `taxBrackets`+`income`, `budgetLineItems`, `forecastLineItems`+`forecastOverrides`, `creditCards`, `bills` — same pattern. Commits `8290ebf`, `b9ee274`, `6262505`, `c557159`, `b424d8f`, `9105548`. This completed all 17 `src/lib/db/*.js` modules.
  - **Gap closure (5 parallel agents, 2026-07-05):**
    - `budgetCategories.js#seedDefaultCategories`, `scenarios.js#deleteAdjustment`, `scenarios.js#cloneScenario` — all three closed. Added `app/api/budget-categories/seed/route.js` (idempotent, only inserts categories not already present), a flatter `app/api/scenarios/adjustments/[adjustmentId]/route.js` DELETE (ownership verified via `scenario_adjustments`' own `user_id` column, matching the real call site's `deleteAdjustment(adjustmentId)` signature), and `app/api/scenarios/[id]/clone/route.js` POST (a single atomic CTE statement: insert new scenario + copy adjustments in one query). Commit `4830da4`.
    - `src/modules/dashboard/Dashboard.jsx` — its only two direct Supabase calls (in `PointsSummaryWidget`, reading `budget_line_items`/`forecast_line_items`) swapped for the already-migrated `getBudgetLineItems`/`getForecastLineItems`. Commit `611878b`.
    - `src/modules/creditcards/CreditCards.jsx` — its 6 direct Supabase call sites (category-mapping PATCHes plus `bills`/`budget_line_items`/`forecast_line_items` reads) swapped for `getBills`/`getBudgetLineItems`/`getForecastLineItems` plus a small local fetch helper hitting the existing `app/api/budget-categories/[id]/route.js` PATCH for the `cc_category`/`cash_only`/`pinned_card_id` fields. Commit `1b83e5b`.
    - `src/lib/ai/sendMessage.js` + `src/lib/integrations/monarch.js` — switched from `supabase.functions.invoke(...)` to `fetch('/api/ai-chat')`/`fetch('/api/monarch-sync')`, preserving equivalent error-shape handling. Commit `ffa8e64`. **Needs a manual step**: `ANTHROPIC_API_KEY` still needs to be set as a Vercel env var for `/api/ai-chat` to actually work once live.
  - **This completes the entire frontend cutover** — no file in the app calls Supabase directly anymore except the Supabase client module itself (kept, unused once cutover is live). `npm run build` verified clean end-to-end (54 routes/pages compiled).
  - **Bridge-user reconciliation — done (2026-07-05):** user signed up for real through the Vercel preview (`jonncy18@gmail.com` → new Neon Auth id `10de683e-4eca-4465-98d2-2212c8fe5f17`). The bridge account's email (previously blocking sign-up with a 422) was freed by renaming it to `bridge-migrated@internal.invalid`. Ran a one-time reassignment: deleted the blank auto-provisioned `user_profiles` row for the new id, moved the real migrated `user_profiles` row's `id` from the bridge id to the new id, and updated `user_id` from the bridge id to the new id across all 22 other tables. Verified zero rows remain under the bridge id anywhere.
  - **`ANTHROPIC_API_KEY` set on Vercel and confirmed working (2026-07-05)** — user tested the AI chat/briefing live against `/api/ai-chat` on the branch preview.
  - **Live browser verification — done (2026-07-05).** User exercised the app directly and 3 real bugs surfaced, all found and fixed:
    - **Theme toggle** — 3 stacked root causes from the Next.js migration: (1) no pre-hydration script, so SSR/client state started out of sync; (2) `app/layout.jsx` was a client component, so React re-reconciled and stripped `data-theme` off `<html>` on every re-render; (3) `AppRoot.jsx`'s `profileLoading` initialized `false`, opening a one-render window where `<Onboarding/>` transiently mounted on every page load, and its unmount cleanup called `removeAttribute('data-theme')`, wiping the theme the app shell had just applied. Fixed all three; confirmed persists across toggle, refresh, and navigation.
    - **Scenario data gap** — 2 scenarios the user added live (after the Phase B0 copy) were missing from Neon. Copied both plus their 7 adjustment rows from Supabase, preserving original ids/timestamps; also found and deleted an unrelated test-artifact scenario left over from verifying the `cloneScenario` route.
    - **Budget data drift** — saving the Budget page on the Neon-backed preview did a delete-and-reinsert that dropped 119 near-zero rows (583→464, $91,202→$91,205). Re-synced from Supabase (still the source of truth pre-cutover) via a background agent, verified row-for-row via checksum; also fixed `budget_status` (`draft`→`finalized`, matching Supabase's original finalization).
    - Also verified via checksum during this pass: forecast lines, category mappings, earn rates, and cards were all already byte-identical between Supabase and Neon — the credit-card totals discrepancy the user first flagged turned out to be a stale-tab timing issue, not a real bug.
  - ~~`transactions` backfill~~ — resolved same day: the live browser verification pass (below) re-uploaded a fuller Monarch export directly against Neon, closing the row gap to 4,977/4,980 (3-row gap accepted as noise). No further backfill needed.
  - **Phase C runbook drafted in `MIGRATION_PLAN.md`** — real mechanics clarified: production today is GitHub Pages (Vite + Supabase, `main` branch, no custom domain), which cannot run this branch's Next.js API routes — so cutover is a **hosting-provider switch** (GitHub Pages → Vercel), not just an env-var flip on an already-live Vercel production. Rollback is correspondingly cheap: GitHub Pages/`main`/Supabase are untouched throughout, so rollback is just "use the old `*.github.io` URL" until the migration branch is trusted as the daily driver.

- **Supabase → Neon + Neon Auth + Vercel migration — Phase A′ complete (2026-07-04):**
  - Ran a full assessment against an external Supabase→Neon migration playbook: schema inventory, RLS, auth model, data-access pattern, realtime, edge functions, env vars, build/hosting.
  - **Live-schema gap found and fixed:** 5 tables (`bills`, `accounts`, `bill_amounts`, `account_balances`, `forecast_overrides`) existed only in the live Supabase database — never in a committed migration (only later `ALTER TABLE`s referenced them). Recovered via direct introspection (Supabase MCP) and committed as `db/migrations/015_recover_undocumented_tables.sql`. All 24 live tables now match committed migrations. Documented in `ARCHITECTURE.md` §5.1.1.
  - **Decisions recorded:** full custom API layer (not Neon Data API); switch Vite SPA → Next.js App Router (current app had no router at all — `registry.js` was state-based nav); staged cutover with an informal freeze (single-user app).
  - Instantiated the phased plan as `MIGRATION_PLAN.md` (Phase A′ Next.js → B0 provisioning → B1 read path → B2 write path → B3 skipped, no realtime in use → B4 auth → B5 edge functions → C cutover → D decommission).
  - **Phase A′ built and audited** (separate build/audit subagent pass, per this file's Agentic Loop protocol): converted the Vite SPA to Next.js App Router. `App.jsx` + `AppShell.jsx` logic merged into `app/AppRoot.jsx` verbatim; `activeModule` now derives from the URL (`usePathname()`/`router.push`) instead of internal state + `sessionStorage`, so every module gets a real, bookmarkable route and browser back/forward now works between them. One `app/<id>/page.jsx` per module, all sourcing shared state via a new `useShell()` context. Env vars moved `import.meta.env.VITE_*` → `process.env.NEXT_PUBLIC_*`. Zero changes to any module's visual design or to the data layer.
  - **Deployed to a Vercel preview** (project `ai-capital-planning`, `prj_9L8lnUCUFICicYe2iHlPY7n5tXyB`) and **verified working end-to-end in browser**: login, navigation between all modules, hard refresh mid-module, and both edge functions (`ai-chat`, `monarch-sync`) all confirmed working against Supabase from the new Next.js shell.
  - **Known landmine, tracked in `MIGRATION_PLAN.md`:** `next build` now requires `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` at build time and outputs to `.next/`, which the (deliberately untouched) GitHub Pages `deploy.yml` isn't set up for. **Do not merge this branch to `main`** until the hosting cutover is decided — production GitHub Pages deploy is untouched and still live.
  - PR #142 tracks this work, still open/draft.

- **Phase B0 (Neon + Neon Auth provisioning) — functionally complete (2026-07-04):**
  - Provisioned a real Neon project (`ai-capital-planning`, `soft-resonance-24018910`) with a `dev` branch, and Neon Auth on it — confirmed live via `get_neon_auth_config` and direct `neon_auth` schema introspection (9 tables: user, session, account, verification, jwks, organization, member, invitation, project_config — Better Auth, as the playbook warned to verify rather than assume).
  - Applied the full 24-table schema as final-state DDL (not a migration replay — replaying the 16 committed migration files in order would fail on a fresh database, since migrations 007/008/013/014 alter `bills` before it's ever created). Every `user_id` FK points to `neon_auth."user"(id)`, RLS fully stripped per the recorded custom-API-layer decision.
  - Copied data table-by-table from Supabase using the Supabase/Neon MCP servers' own authenticated connections (no connection strings ever handled directly). 20 of 24 tables at exact row-count parity, plus `tax_brackets`/`budget_line_items`/`forecast_line_items` also exact.
  - **Decision (2026-07-04): stopped short of full `transactions` backfill.** Copying ~4,920 rows one batch at a time through agent-orchestrated SQL took over an hour and kept stalling (subagents repeatedly claimed to be "waiting for a notification" they can't receive, or got killed mid-batch) — the wrong tool for bulk data movement. Landed at 1,450/4,920 rows, which is sufficient sample data to build the API layer against. Full backfill deferred to the actual cutover (Phase C), via a direct `pg_dump | psql` pipeline as the runbook already recommends — a fast, one-shot operation, not per-row agent SQL.
  - A temporary bridge row was created in `neon_auth."user"` (id `157a1267-6adf-4371-bd72-2e9bdbca64ad`) so migrated data's `user_id` FKs resolve ahead of a real signup existing — needs reconciling once a real account signs up through the app (Phase B1/B2).
  - **Live Neon Auth login test blocked in this sandbox**: outbound connections to Neon Auth's domain are rejected by the environment's network policy (403 on CONNECT) — exactly the "agent sandbox can't reach the new auth provider" limitation the playbook's gotchas file anticipates. Deferred to Phase B1, once there's a real UI to test through.
  - One security-classifier flag surfaced mid-migration (data movement to an "untrusted" external destination) — reviewed and confirmed as an expected false positive: the Neon project is the user's own, created this session with explicit approval, and the data never left the user's own accounts.
  - **Immediate next step (added to "Recommended next session" below, item 6):** upload a real Monarch CSV export through the Vercel preview to verify the import pipeline end-to-end on the Next.js build — the app there still talks to Supabase, so this is independent of Phase B1's Neon write-layer work.

- **Phase B1 pilot — Neon-backed Commitments API, verified working end-to-end (2026-07-04):** decided to prove the read/write + auth pattern on one small module before rolling it out across all ~95 Supabase call sites, rather than building broad in one pass. Picked `commitments` (single table, simple CRUD, no rows at risk). Built: `src/lib/neon/client.js` (shared Postgres client), `src/lib/neon/auth.js` (verifies a Neon Auth bearer JWT against the branch's JWKS endpoint), `app/api/commitments/route.js` + `[id]/route.js` (CRUD routes — every query's `WHERE` clause includes `user_id = <verified userId>` as the authorization boundary, reviewed directly), and `app/neon-auth-test/page.jsx` (a standalone, unlinked diagnostic page that signs in via Neon Auth directly and exercises the routes). Main app's `Login.jsx`/`Commitments.jsx`/Supabase are untouched — purely additive.
  - **Confirmed working live in browser**: sign-up → JWT → create commitment → list commitment, full round trip against the Vercel preview + Neon dev branch.
  - **Two real bugs found via live testing and fixed:** (1) sign-up/sign-in's own response `token` field is an opaque session token, not a JWT — the real JWT has to be fetched separately via `GET {base_url}/token` using the session cookie sign-up already set. (2) `sql.json(...)` doesn't exist on `@neondatabase/serverless` (that's `postgres.js`'s API) — every jsonb write needs `JSON.stringify(value)::jsonb` instead; several other tables have jsonb columns and will need the same fix during the full rollout.
  - **Switched to Neon's official `@neondatabase/auth` SDK (2026-07-04)**, replacing the hand-rolled REST+JWT approach that surfaced bug (1) above. Added `src/lib/neon/authServer.js` (`createNeonAuth`), `app/api/auth/[...path]/route.js` (the auth proxy — confirmed by reading the installed package's source that the browser only ever talks to this app's own origin, never Neon's auth domain directly), and rewrote the test page to use cookie-based sessions with zero manual token handling. Deleted the now-superseded `src/lib/neon/auth.js`. Needs two Vercel env vars: `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`.
  - **Confirmed working live in browser a second time** against the SDK rework: sign-in → Get Session (cookie only) → create/list commitment, full round trip against Neon.

- **Phase B1 broad rollout, Wave 1 of 3 — committed (2026-07-05):** with the pattern proven on the pilot, rolled it out across the first 6 of ~17 `src/lib/db/*.js` modules, run as parallel build agents against isolated new files (no shared-file conflicts): `ai_briefings`, `wealth_snapshots`, `scenarios` (+ `scenario_adjustments`), `ai_preferences`, `budget_categories` (+ bulk import), `transactions` (full read path + bulk-import POST). Same pattern throughout: `auth.getSession()` → 401 if absent → `WHERE user_id = ...` on every query → `${JSON.stringify(value)}::jsonb` for jsonb writes. Commits `85a8674`, `e71e6b2`, `ee408ff`.
  - **Real Phase B0 schema gap found and fixed:** Supabase's `budget_categories` has `unique(user_id, category)` (`001_initial_schema.sql` line 47) that was missed when the Neon schema was built from live introspection in Phase B0. Added directly to the Neon dev branch and documented as `db/migrations/016_neon_budget_categories_unique_constraint.sql`.
  - **Two real hardening fixes beyond the source modules**, found during the scenarios port: `deleteAdjustment` now scopes by `scenario_id+user_id` (source only filtered by `id`), and `addAdjustment` now verifies `category_id` ownership before insert (source never checked it) — both closing an unauthenticated-id-trust gap, not just porting behavior 1:1.
  - **Known gaps tracked, not blocking:** `cloneScenario` (multi-step: create scenario + copy adjustments) and `getUserGroups`/`getExcludedCategoryNames`/`seedDefaultCategories` (derived views/one-time seed, not simple CRUD) not yet ported.
  - All new routes are build-verified (`npm run build` clean) but not yet live-browser-tested — only the original commitments pilot has had a live round-trip test so far.

- **Phase B1 broad rollout, Wave 2 of 3 — committed (2026-07-05):** ported the next 6 modules: `import_logs`, `budget_status`, `tax_brackets`, `income_actuals`, `user_profiles`, `budget_line_items`. Commits `5f981ff`, `e7804c1`, `86d994a`, `0a120db`, `17bb0ce`, `a65c53c`.
  - `tax_brackets` is world-readable reference data (no `user_id` column) — its route only checks for a valid session, matching Supabase's `for select to authenticated using (true)` policy exactly.
  - `user_profiles`'s PK **is** the Neon Auth user id (no separate `user_id` column) — routes key off `WHERE id = userId`. Split into a full-row `PUT` upsert plus a narrow `PATCH` for `min_checking_balance` alone, so a partial update can't clobber the other ~19 fields.
  - `budget_line_items`'s `saveBudgetForYear` (delete-then-bulk-insert for a year) was ported as a single atomic `sql.transaction([DELETE, INSERT])` via `@neondatabase/serverless`, rather than two independent statements — closes a real crash-mid-operation gap the original Supabase version also had.
  - **Two more hardening fixes beyond the source module**, found in `budgetLineItems.js`: `updateLineItemAmount` and `deleteLineItem` filtered only by `id` in Supabase (relying entirely on RLS to block cross-user access) — both routes now also require `AND user_id = ...` and 404 otherwise. Same class of fix as the scenarios hardening in Wave 1.
  - **3 more real Phase B0 schema gaps found and fixed**: grepped every migration for `unique` and cross-checked against Neon's actual `pg_constraint` — `income_actuals`, `tax_brackets`, and `budget_status` were all missing their Supabase unique constraints (same miss as `budget_categories` in Wave 1). Fixed directly on Neon and documented in `db/migrations/017_neon_missing_unique_constraints.sql` (bundled with `credit_card_earn_rates`, needed ahead of Wave 3).
  - Wave 3 (`forecast_line_items`, `forecast_overrides`, `credit_cards`, `bills`, plus folding in `Dashboard.jsx`/`CreditCards.jsx`, the two files that bypass the `db/` layer) is next and last.

- **Phase B1 broad rollout, Wave 3 of 3 — committed, rollout complete (2026-07-05):** ported the final 4 modules: `forecast_overrides`, `credit_cards` (+ earn rates/points/redemptions), `bills` (+ `accounts`/`bill_amounts`/`account_balances`), `forecast_line_items`. Commits `71d4caa`, `ef428f2`, `9386448`, `bb2b860`. **This completes the broad rollout — all 17 `src/lib/db/*.js` modules, plus the original `commitments` pilot, now have a parallel Neon-backed API route.**
  - **2 more real Phase B0 schema gaps found and fixed**: `forecast_overrides(user_id,category_id,budget_year,month)` and, in the bills port, `bill_amounts(bill_id,year,month)` + `account_balances(account_id,year,month,period_half)` — all missing their Supabase unique constraints on Neon, same recurring class of gap as every prior wave. Fixed and documented in `018_neon_bills_unique_constraints.sql` / `019_neon_forecast_overrides_unique_constraint.sql`.
  - **Several more hardening fixes beyond source**, all following the same pattern (bare-`id` mutations that relied on Supabase RLS, now requiring an explicit `user_id`/ownership check since Neon has none): `deleteCreditCard`, `deleteEarnRate`, `upsertPointRedemption`'s update path, `deletePointRedemption`, `deleteAccount`, `deleteBill`, `updateForecastLineItem`, `deleteForecastLineItem`. The `bills.js` port went further still: `getBillAmountsForBill`/`upsertBillAmount`/`deleteBillAmount` took no `userId` at all in the source, so each now verifies bill ownership via an `EXISTS` join against `bills` before reading or writing.
  - `credit_cards.settings` (the two `cc_coverage_pct`/`cc_optimization_pct` columns living on `user_profiles`) got its own dedicated endpoint rather than being folded into `app/api/profile/route.js`'s `PUT`, since that route already deliberately excludes those two columns to avoid clobbering them.
  - `forecast_line_items`' `resetForecastToBudget` (delete + reseed) and `setForecastRate` (delete + rate-fill insert) both run as a single atomic `sql.transaction([...])`, same pattern as `budget_line_items`' `saveBudgetForYear` in Wave 2.
  - Every new route is build-verified (`npm run build` clean, 51 routes total); none has been live-browser-tested yet beyond the original commitments pilot.
  - **Remaining, tracked, not blocking**: `cloneScenario` and `budgetCategories.js`'s `getUserGroups`/`getExcludedCategoryNames`/`seedDefaultCategories` (Wave 1 gaps, still open); folding `src/modules/dashboard/Dashboard.jsx` and `src/modules/creditcards/CreditCards.jsx` off their direct Supabase queries onto the new API routes — not started, and out of scope for this rollout (which only builds the parallel Neon layer; the frontend cutover itself is Phase C).

- **Phase B2 (write path review) + B5 (AI/Monarch edge functions) — committed (2026-07-05):**
  - **Profile auto-provisioning built**: Neon Auth has no equivalent of Supabase's `handle_new_user()` trigger (`insert into user_profiles (id) values (new.id) on conflict (id) do nothing`, fired on every `auth.users` insert). `GET /api/profile` now runs the same idempotent insert before its select, so a fresh signup always has a row by the time `Login → Onboarding` reads it. Verified live against the real Neon schema with a throwaway insert/re-insert/cleanup (idempotent, correct column defaults).
  - **Multi-step write review**: re-read the three flagged call sites directly rather than trust the plan's framing — `promoteToCommitted`/`promoteToModeled` (`scenarios.js`) are each a single UPDATE with no second table write (no baseline-audit record exists in the source); `saveBudgetForYear` was already ported as an atomic transaction in Wave 2; the CSV import path (`importTransactions` + `logImport`) is deliberately non-transactional even in the source (the app wraps the `logImport` call in a non-fatal try/catch). No further server-transaction work was needed anywhere.
  - **`ai-chat` and `monarch-sync` Supabase Edge Functions ported** to `app/api/ai-chat/route.js` and `app/api/monarch-sync/route.js` — same request/response contracts as the client wrappers (`src/lib/ai/sendMessage.js`, `src/lib/integrations/monarch.js`) already expect, so no client changes are needed once they're switched over. Both functions relied on the Supabase gateway to verify the caller's JWT before invocation; replaced with an explicit `auth.getSession()` check, same as every other route in this migration. `ai-chat` needs a fresh `ANTHROPIC_API_KEY` Vercel env var — not yet set, not copied from Supabase's secret.
  - **Real bug fixed during the `monarch-sync` port**: the Deno function generated its Monarch `device-uuid` once at module scope (top-level `crypto.randomUUID()`), reused across every request served by that warm instance — different users sharing one device UUID. Now generated fresh per request.
  - **Blocked in this sandbox**: the B4 direct-probe test (curl a scoped route with no token, confirm it's rejected) — outbound curl to the Vercel preview domain fails under this environment's network policy, the same restriction that blocked live Neon Auth testing in Phase B0. Every route's `401` guard was reviewed directly in code instead (all 22 route files). Needs a real probe from outside this sandbox to close out, along with the B5 golden-question suite (needs the `ANTHROPIC_API_KEY` set + the frontend actually switched from `supabase.functions.invoke` to `fetch('/api/...')`, neither done yet).

**Previously last updated:** 2026-06-23 (Phases 0–11 largely built; in daily use)

### Done so far
- **Phase 0 complete** — Vite + React SPA, GitHub Pages deploy (auto on push to `main`), Supabase project live, client configured.
- **Phase 1 schema live** — all tables created in Supabase via `db/migrations/001_initial_schema.sql`: `transactions`, `budget_categories`, `budget_line_items`, `commitments`, `scenarios`, `scenario_adjustments`, `wealth_snapshots`, `ai_briefings`, plus `user_profiles`. **RLS enabled** on every table (per-user `auth.uid()` policies).
- **Auth working** (done early, ahead of Phase 10) — email/password sign-up + sign-in (`src/modules/auth/Login.jsx`), session tracking (`src/lib/auth/useAuth.js`), auth gate in `App.jsx` (Login → Onboarding → App shell), sign-out.
- **Profile persistence** — onboarding answers saved to `user_profiles` in Supabase (`src/lib/db/profile.js`); a signup trigger auto-creates the profile row (`migration 002` hardened it with pinned `search_path` to fix a signup 500).
- **DB helper layer scaffolded** — `src/lib/db/transactions.js` (`importTransactions` w/ dedup, `getRecentTransactions`, `getTransactions`), `src/lib/db/commitments.js`, `src/lib/db/profile.js`.
- **Verified end-to-end:** new user can sign up → land in onboarding → profile row written.
- **Phase 2 complete** — Full CSV import pipeline:
  - `src/lib/csv/monarchParser.js` — Monarch Money CSV parser (handles quoted fields, date/amount parsing, row-level error reporting).
  - `src/lib/csv/categoryMap.js` — 100+ Monarch category → group/type mappings; `findUnmappedCategories`, `applyMappings`.
  - `src/lib/db/budgetCategories.js` — `seedDefaultCategories(userId)` (idempotent upsert on first import), `upsertCategory`, `getBudgetCategories`.
  - `src/lib/db/importLog.js` — `logImport`, `getImportHistory` backed by new `import_logs` table.
  - `db/migrations/003_import_logs.sql` — `import_logs` table with RLS (apply in Supabase SQL Editor).
  - `src/modules/import/ImportFlow.jsx` — Full-screen import state machine: parsing → unmapped-categories dialog → importing → summary.
  - Onboarding now passes `raw` CSV through to `onComplete`; App.jsx inserts ImportFlow between onboarding and main app when CSV is present.
  - Settings → Data Management section: re-import CSV drop zone + import history log.
- **Phase 3 complete** — Dashboard shell, navigation, command bar, AI proxy:
  - `src/modules/shell/AppShell.jsx` — hub layout (sidebar + canvas + command bar), responsive (mobile/tablet/desktop), owns AI context + command-bar submit.
  - `src/modules/shell/Sidebar.jsx` — collapsible left sidebar (icon rail when collapsed); also rendered inside mobile drawer.
  - `src/modules/shell/CommandBar.jsx` — persistent AI input; desktop bottom bar, mobile FAB + bottom sheet. Responses render as a dismissible card in the canvas.
  - `src/modules/registry.js` — central module registry (single source of truth for nav + routing).
  - `src/modules/dashboard/Dashboard.jsx` — widget grid with drag-to-rearrange scaffold; live widgets (trailing-12-month activity, categories, commitments) render real numbers from the AI context.
  - Module stubs: `cashflow`, `scenarios`, `budget`, `commitments`, `wealth` (shared `common/ModuleStub.jsx`), plus `mapping` "Coming Soon".
  - `src/lib/theme/useTheme.js` — persistent dark/light toggle (localStorage, sets `data-theme`).
  - `src/lib/ai/contextLoader.js` — `loadAIContext(userId)` (90d txns + categories + active commitments + latest wealth snapshot), `summarizeContext`, `buildContextBrief`.
  - **AI now wired through a secure Supabase Edge Function** — `db/functions/ai-chat/index.ts` holds the Anthropic key server-side; `src/lib/ai/sendMessage.js` calls it via `supabase.functions.invoke('ai-chat')` (JWT auto-attached). The browser never sees the key.
- **Phase 4 complete** — Cash Flow Timing Module:
  - `src/modules/cashflow/CashFlow.jsx` — full 12-month rolling calendar; month cards with spike detection, configurable threshold, click-to-expand category breakdown, trailing 4-quarter summary, loading/error/empty states.
  - `src/lib/db/transactions.js` — added `getTransactionsByMonth(userId, fromDate, toDate)` for date-range queries used by the calendar.
  - **CSV import batching fix** — `importTransactions` now upserts in 500-row batches (handles 1000+ row files) and uses count-before/count-after to accurately measure inserts instead of relying on the unreliable `ignoreDuplicates` return value.
- **Phase 5 complete** — Scenario Planner:
  - `src/lib/db/scenarios.js` — full data layer: `getScenarios`, `createScenario`, `deleteScenario`, `promoteToCommitted`, `getAdjustments`, `addAdjustment`, `deleteAdjustment`.
  - `src/modules/scenarios/Scenarios.jsx` — full module: two-panel layout (scenario list + detail), scenario creation form, adjustment input (category/month/year/delta/label), promote-to-committed flow, Adjustments and Comparison View tabs, view mode toggle (Baseline / Actual Plan / Scenarios), responsive mobile layout.
  - `src/lib/ai/contextLoader.js` — scenarios (with adjustments) now loaded into AI context and included in the context brief sent to the AI.
  - `src/lib/ai/sendMessage.js` — system prompt updated to reference scenario planning capability.
  - AppShell wired: `userId` and `mobile` passed to Scenarios module.
- **Phase 6 complete** — Annual Budget Builder:
  - `src/lib/budget/patternAnalyzer.js` — pure historical pattern analyzer: classifies each category Fixed/Flexible/Non-Monthly from frequency + coefficient of variation, annualizes the observed window, and generates draft `budget_line_items` (Non-Monthly distributed by historical month histogram).
  - `src/lib/db/budgetLineItems.js` — `getBudgetLineItems`, `getBudgetYears`, `saveBudgetForYear` (delete-then-insert per year/version), `updateLineItemAmount`, `deleteLineItem`.
  - `src/lib/db/transactions.js` — added `getTransactionsForAnalysis` (paginated 24-month pull).
  - `src/modules/budget/Budget.jsx` — generate-from-history flow with an editable draft (toggle/adjust per category), month-by-month schedule grid (group subtotals, commitment rows, totals), year selector, mobile per-month cards.
- **Phase 7 complete** — Long-Term Commitments:
  - `src/lib/commitments/schedule.js` — shared `cost_structure` normalizer (monthly/annual/total/custom) → month-by-month cash demand; `commitmentYearSchedule`, `commitmentTotalProjected`, `aggregateCommitmentsForYear`, `describeCostStructure`. Consumed by Cash Flow, Budget, Wealth, Dashboard.
  - `src/modules/commitments/Commitments.jsx` — full CRUD form (type, status, dates, cost structure, split rules, notes), list with status filter, detail view with 12-month bar timeline + split allocation bars.
- **Phase 8 complete** — Wealth Trajectory:
  - `src/lib/wealth/projection.js` — deterministic monthly-compounding projection, baseline-vs-scenario comparison, `yearsToTarget`, `investableFromSnapshot`.
  - `src/lib/db/wealthSnapshots.js` — snapshot CRUD; `contextLoader` reuses `getLatestWealthSnapshot`.
  - `src/modules/wealth/Wealth.jsx` — net worth snapshot form, SVG trajectory chart (baseline vs. commitment-drained), assumption sliders (contribution / return / horizon / retirement target), commitment-impact toggle, snapshot history.
- **Phase 9 complete** — Dashboard widgets + AI Briefing:
  - `src/lib/dashboard/widgetData.js` — pure derivations: `monthlyBudgetVsActual`, `spendByGroupYear`, `spendByCategoryForGroup`, `incomeVsExpenses`, `yearProjection`, `budgetVsActual`, `cashFlowSpike`, `commitmentsSummary`, `wealthSummary`, `scenarioImpact`.
  - `src/lib/db/aiBriefings.js` — `getLatestBriefing` / `saveBriefing` (cached per `module_context`).
  - `src/modules/dashboard/Dashboard.jsx` — all predefined widgets wired to live context; AI Briefing widget (on-demand, cached to `ai_briefings`); configure mode with drag-reorder + show/hide persisted to localStorage.
  - `contextLoader` now also loads current-year `budget_line_items` + budget years; brief + summary expanded accordingly.
- **Phase 10 (mostly complete)** — Onboarding: 5-step flow already live (`src/modules/onboarding/Onboarding.jsx`) — welcome, 3-part priority conversation, data-path choice, CSV upload + baseline, completion → dashboard. Category confirmation handled in `ImportFlow`. Remaining: in-onboarding commitment setup + auto budget-generation step (both available as first-class modules now).
- **Dashboard enhancement pass (this session):**
  - **Monthly Budget vs. Actuals chart** (`src/modules/dashboard/BudgetActualsChart.jsx`) — full 12-month bar chart with budget vs. actual per month, forecast overrides, TODAY marker, variance threshold chip (adjustable 1–25%, persisted to `user_profiles`), full-year on-track pill, and tooltip on hover.
  - **Income vs. Expenses redesign** — all 12 months shown as a bar chart (solid teal/orange for actuals, dashed for forecast), TODAY marker, full-year KPIs (savings rate, income, expenses, net) below chart, YTD row. Mirrors the BVA chart layout.
  - **Post-tax income forecast** — `incomeVsExpenses` now computes `salary/12` as the base monthly forecast, adds bonus in `bonus_month` only, subtracts estimated taxes at the effective rate on `salary + bonus`, monthly benefits deduction, and monthly 401k contribution. Falls back to a rolling transaction average when no salary profile is set.
  - **Spend by Group widget** (`SpendByGroupWidget`) — full-year actual + forecast stacked bar vs. budget bar per group, hover tooltip, click-to-drill-down modal (`SpendGroupDetail`) showing category-level breakdown with its own bar chart.
  - **Settings additions** — bonus month selector (Jan–Dec), benefits toggle (flat $ vs. % of gross), 401k % + on-bonus checkbox, live take-home readout showing each deduction line. Variance threshold slider. All saved to `user_profiles`.
  - **Collapse/expand** — every dashboard card has a ▾/▸ chevron; a global ▾ COLLAPSE / ▸ EXPAND button in the header actions collapses or expands all visible cards at once. State persisted to localStorage.
  - **Bug fix** — `BvaWidget` referenced `IveTooltip`, `TooltipHeader`, `TooltipRow` without defining them, causing a `ReferenceError` on first render that crashed the entire React tree and produced a blank page. Added the three missing component definitions.
  - **Schema additions** — `user_profiles` gained 8 new nullable columns: `variance_threshold`, `bonus_month`, `benefits_amount`, `benefits_pct`, `four01k_pct`, `four01k_on_bonus`, `annual_income` (already existed), `annual_bonus` (already existed).

- **Budget table + line-level upload (2026-06-22):**
  - `ScheduleGrid` rewritten to mirror `ForecastGrid`: sticky headers, scrollable max-height, groups expanded by default, per-category drill-down toggle, named sub-rows at 54px indent.
  - Upload Budget now captures individual named line items from xlsx detail tabs (`extractLineItemsFromDetail` in `budgetParser.js`); labels stored in `budget_line_items.label`.
  - Fixed/Flexible categories now matched against detail tabs (removed Non-Monthly-only restriction in `parseBudgetWorkbook`).
  - `TabMatchReview` dialog expanded to show all categories with matched tabs (not just Non-Monthly), with a type badge for Fixed/Flexible entries.

- **Forecast + Budget: label-grouped line items (2026-06-22):**
  - `src/lib/db/forecastLineItems.js` — added `setForecastRate(userId, categoryId, label, rate)` (batch-sets all future months) and `deleteForecastItemsByLabel(userId, categoryId, label)`.
  - `src/modules/forecast/Forecast.jsx` — labels now group into a single 12-month row; a `$` rate input on the left bulk-sets all future months; individual cells remain editable for overrides; past months read-only; Add form simplified to label + rate; delete removes the whole label at once.
  - `src/modules/budget/Budget.jsx` — `ScheduleGrid` sub-rows now grouped by label (one row spanning all 12 columns), matching the Forecast grid layout.
  - `src/modules/shell/AppShell.jsx` + `src/modules/dashboard/Dashboard.jsx` — `dataNonce` bumped on import completion, threaded as `reloadSignal` to Dashboard so `yearTxns` refetches automatically after a transaction import (fixes stale charts post-import).

- **Scenario planner full rebuild (2026-06-22–23):**
  - `src/modules/scenarios/Scenarios.jsx` — complete rebuild (~2000→3000 lines):
    - **Sidebar-first nav:** removed 3-button top toggle; sidebar is now always-visible primary nav with Baseline + Actual Plan items at top, then scenario list; inline `+` button to add a scenario.
    - **Baseline panel:** past months show actual transaction spending (gray bars), current/future months show budget/forecast (accent bars); category group breakdown with dual-segment progress bars and legend.
    - **Actual Plan view:** lists all committed scenarios as summary cards (name, commit date, net delta chip, adjustment count, View Details link).
    - **ScenarioDetail tabs (3):** Adjustments (period-grouped table, colored badge chips, hover-reveal delete, net total row), Forecast Impact (12-month side-by-side bar chart vs baseline, hover tooltips, annual summary stats), Baseline Comparison (SVG grouped bars per period, delta chips, hover tooltips).
    - **AiScenarioComposer:** full conversation history maintained across sends, right-aligned user bubbles, AI responses with ✦ icon, CLEAR button.
    - **UI cleanup pass:** removed dead code (TimelineChart, EmptyState, buildCumulativeTimeline), collapsed sidebar dividers to 1, tightened module header padding, shortened button labels ("✓ Commit", × delete icon), removed redundant empty-state hint.
  - `src/lib/dashboard/widgetData.js` — `monthlyBudgetVsActual()` now accepts a `scenarioFilter` param (`'all'` | `'baseline'` | scenario id) and folds committed scenario adjustment deltas into future forecast months accordingly.
  - `src/modules/dashboard/BudgetActualsChart.jsx` — replaced static "N scenarios applied" badge with interactive `ScenarioDropdown` chip (Baseline / All / Individual); follows same chip/popover pattern as `ThresholdChip`.
  - `src/modules/shell/AppShell.jsx` — passes `onGoToForecast` callback and `reloadSignal` to Scenarios; Scenarios passes `reloadSignal` to Forecast so promoting a scenario triggers a Forecast reload.

- **Data integrity hardening (2026-06-23):**
  - `src/lib/db/transactions.js` — `getTransactionsByMonth` and `getTransactionsForYear` now use `.range()` pagination loops (same pattern as `getTransactionsForAnalysis`). Root cause: with 1,117 transactions in 2026, the default Supabase 1000-row cap silently truncated all 114 June rows, making June actuals invisible in the Income vs Expenses chart.
  - Full pagination audit — added `.range()` loops to all high-volume queries: `getRecentTransactions` (transactions.js), `getDistinctTransactionAccounts` (creditCards.js), `getIncomeTransactions` (income.js), `getBudgetLineItems` + `getBudgetYears` (budgetLineItems.js), `getBillAmountsForBill` + `getBillAmountsRange` (bills.js).
  - `src/lib/ai/contextLoader.js` — `buildContextBrief` now computes the same current-year income/expense projection as the Income widget: YTD actuals + salary/budget forecast for remaining months via `incomeVsExpenses()`. Previously used trailing-12-month figures that spanned two calendar years, producing AI briefings inconsistent with dashboard numbers.
  - `src/lib/ai/sendMessage.js` + `src/modules/dashboard/Dashboard.jsx` — `yearTxns` (Jan–Dec current year, fresh on each dashboard render) now threaded from `BriefingWidget` → `sendAIMessage` → `buildContextBrief`, bypassing stale `ctx.transactions` and the 1000-row cap. Falls back to filtering `ctx.transactions` for the AI command bar where `yearTxns` is not available.
  - `src/modules/budget/Budget.jsx` + `src/modules/forecast/Forecast.jsx` — groups default to collapsed (track `expandedGroups` opt-in set instead of `collapsedGroups` opt-out set).

- **Documentation trail infrastructure (2026-06-23):**
  - `.claude/skills/update-docs.md` — `/update-docs` skill: at end of each session, synthesizes git log + conversation and updates ROADMAP.md (new dated entry), ARCHITECTURE.md (if architectural change), README.md (if phase/status changed), then commits and pushes.
  - `.gitignore` — changed `.claude/` (fully ignored) to `.claude/*` + `!.claude/skills/` so skills are committed and survive fresh clones; local config (settings.json, etc.) still ignored.

- **Pay Period Planner — Cash Flow tab fixes (2026-06-24):**
  - **Stat card redesign:** replaced "Avg Inflow / mo · Avg Outflow / mo · Net Margin · Projected Annual Net" with a two-part split: YTD Net (elapsed actual months), Forecast Net (remaining months at salary/12), Net Margin (forecast period only), Projected Year-End (YTD + forecast). A bonus in actuals no longer inflates the forward-looking rate.
  - **Bill → Expense Actuals linking:** new `actuals_category` (text) column on `bills` (migration 013, applied). When set, `loadOutflowSeries()` sums actual transactions in that category per past month and injects into `billAmountsMap` — so historical Cash Flow outflow for that bill automatically reflects real spending instead of showing $0 (no manual entries needed). Future months still use forecast/fixed. `resolveBillAmount()` updated to honor the injected value over `fixed_amount`. BillForm gains "LINK TO EXPENSE ACTUALS" dropdown; bill rows show `↙ ACTUALS` badge.
  - **Root cause of historical asymmetry** (Philippine transfers): bill had a forecast budget amount but no `bill_amounts` entries → past months $0, future months showed budget. Fix: link the bill's `actuals_category` to the expense category in transactions.

- **Budget Builder Grill Session + Year Lock (2026-06-24):**
  - `src/lib/ai/grillSession.js` — new `sendGrillMessage()` function: builds a 6-phase-aware system prompt (income, life events, commitments, non-monthly, category targets, envelope check) from user profile + commitments + prior budget + trailing 12-month spending groups; calls `supabase.functions.invoke('ai-chat')` — no API key in browser.
  - `src/modules/budget/GrillSession.jsx` — new conversational wizard component: 6-phase stepper, chat interface (user right / AI left with ✦ icon), auto-sends Phase 1 opening on mount, "Next Phase →" advances indicator without re-prompting, "Generate Draft →" exits to GeneratePanel, "× Exit" cancels. Loads user profile + spending-by-group + prior budget-by-group on mount for AI context.
  - `src/modules/budget/Budget.jsx` — "✦ Start Grill Session" as primary CTA in empty state; "✦ Grill Session" button in view-state header; `grilling` state routes to GrillSession before existing flow states; ModuleHeader always visible when grill session is active.
  - **Year lock notification banner** — amber banner in view state when `status === 'draft'`: "YYYY budget is not yet finalized. Aim to finalize by January 15, YYYY+1." with inline Finalize button. Hidden when finalized.
  - 2 build iterations (iteration 1 fixed: spending-by-group sign convention inverted, `item.group` → `item.budget_categories?.group`). Audit passed clean.
  - **Browser-verified (2026-07-08)** — grill session opens, AI responds on mount, phase stepper advances, Generate Draft triggers pattern analysis, year lock banner shows/hides correctly.

- **Scenario Planner restructure + Ideas tier (2026-06-24):**
  - Sidebar-first navigation replaced with 4-tab layout: Baseline · Committed · Modeled · Ideas. Sidebar removed entirely.
  - `activeTab` state (default: `'committed'`) replaces `viewMode`. Tab bar colored by tier (blue/purple/amber/slate) with live count badges on Committed, Modeled, Ideas tabs.
  - **Ideas** is a new lightweight scenario tier (`state: 'idea'`). Idea cards show name, description, source tag, and `→ Model` / `✕` actions. No adjustment inputs — ideas are name + note only.
  - `→ Model` promotes an idea to `state: 'modeled'` and switches to the Modeled tab. Ideas accumulate durably in the `scenarios` table.
  - `migration 014_scenarios_idea_state.sql` — adds CHECK constraint on `scenarios.state` for `('modeled', 'committed', 'idea')`. **Must be applied in Supabase SQL Editor.**
  - `src/lib/db/scenarios.js` — `createScenario` now accepts `state` param (default `'modeled'`); added `promoteToModeled()`.
  - AiScenarioComposer remains in Modeled tab; `✦ AI` toggle button in ScenarioDetail header switches between detail and composer.
  - 1 build iteration, audit passed clean. **Browser-verified (2026-07-08)** — Baseline / Committed / Modeled / Ideas tabs render correctly, Ideas tab accumulates, → Model promotes.

- **AI context brief fixes (2026-06-24, merged into PR #134):**
  - Income label corrected: now explicitly states "401k and benefits are payroll deductions that never appear in bank transactions — this figure IS take-home pay"
  - Removed incorrect 401k reconciliation block that suggested 401k as a cash flow gap explanation (401k is pre-payroll, never in bank transactions)
  - Added trailing 12-month net with explanation of why it may differ from the current-year projection
  - Added excluded-categories list with double-counting explanation
  - Added expense methodology note: forward months use budget targets, actual net may exceed projection

- **AI Scenario Composer fixes (2026-06-24):**
  - **Blank bubble fix:** `AiScenarioComposer` did not handle `status: 'pending'` — rendered an empty chat bubble when the agent paused for confirmation. Fixed: pending state now stored and rendered as a preview card (adjustment rows + net delta + Confirm/Cancel buttons) instead of an empty text node.
  - **Replacement scenario clarification:** `SYSTEM_PROMPT` in `sendMessage.js` updated with explicit rules — before calling `create_scenario`, AI must ask for the old cost in replacement/upgrade scenarios, confirm timing when "probably/around" used, and confirm one-time vs. recurring when unclear.

- **Natural language adjustments in ScenarioDetail (2026-06-24):**
  - `src/lib/ai/scenarioAgent.js` — added `ADD_ADJUSTMENT_TOOL`, `runAdjustmentAgent`, `confirmPendingAdjustments`, `cancelPendingAdjustments`. Uses same preview-before-write pattern as `create_scenario` but adds to an EXISTING scenario (takes `scenarioId`). Existing adjustments passed as context to prevent duplication.
  - `src/modules/scenarios/Scenarios.jsx` — new `AiAdjustmentComposer` component: compact chat interface inside the adjustments modal. Manual / ✦ AI tab toggle (only when scenario is not committed). AI tab shows chat history, sends to `runAdjustmentAgent`, previews proposed adjustments with Confirm/Cancel before writing. On confirm, parent's `handleAdjsRefresh` reloads adjustments from Supabase.
  - **Browser-verified (2026-07-08)** — open a modeled scenario → Adjustments → ✦ AI tab → natural language request → preview card appears → confirm writes rows → table refreshes.

- **AI prompt storage restructure (2026-06-24):**
  - **5 new files** in `src/lib/ai/`:
    - `parserBase.js` — `parserSystem(task, role)`, `JSON_ARRAY_RULE`, `sheetsToText()` — eliminates 4 duplicate copies of the same `sheetsToText` function and near-identical SYSTEM strings across the parser family.
    - `scenarioAgent.prompts.js` — `buildScenarioSystemExtra()`, `buildAdjustmentSystemExtra()` extracted from inline construction in agent functions.
    - `grillSession.prompts.js` — `GRILL_PHASE_NAMES`, `buildGrillSystemPrompt()` extracted from `grillSession.js`.
    - `suggestBuckets.prompts.js` — `buildBucketSystemPrompt(groupList)` extracted from inline template in `suggestBuckets.js`.
    - `categoryMapper.prompts.js` — `CATEGORY_MAPPER_SYSTEM` constant.
  - **8 files modified** to import from the new prompt files instead of constructing AI text inline.
  - **Convention established:** AI-facing text lives in `*.prompts.js` siblings; execution files are orchestration-only.
  - `ARCHITECTURE.md` — new section 5.2.1 "AI Prompt Stack" documents the 4-layer assembly order (persona → context brief → systemExtra → tool schemas) and the file convention.
  - Build clean (151 modules, 0 errors). 1 audit iteration (worktree scenarioAgent.js was missing adjustment-agent block — fixed before merge).

- **Forecast: committed + modeled scenario layers with multi-select (2026-06-26):**
  - `src/modules/forecast/Forecast.jsx` — the layer toggle's single `+ Scenarios` button is replaced by two tier buttons: **Committed Scenarios** and **Modeled**, each with a `▾` multi-select dropdown (checkbox list with All/None, live `selected/total` count badge).
  - Only the scenarios the user checks in the active tier's dropdown are folded into the forecast (previously *all* committed scenarios were applied unconditionally). Committed and Modeled each keep an independent selection.
  - Modeled scenarios (with adjustments) are now loaded alongside committed ones; selections reconcile across reloads/year changes (new scenarios default to selected, removed ones drop, prior picks preserved). The "with scenarios" summary stat, legend, and delta highlighting all follow the active tier.

### Known follow-ups / gotchas
- **Deploy the Edge Function:** `supabase functions deploy ai-chat` and `supabase secrets set ANTHROPIC_API_KEY=...` (see `db/functions/ai-chat/README.md`). Until deployed, the command bar returns a friendly "could not reach AI service" message. **Confirm the secret is named `ANTHROPIC_API_KEY`** (update `Deno.env.get` in the function if it differs).
- **Retire the browser-side path:** `src/lib/anthropic.js` (direct browser call via `VITE_ANTHROPIC_API_KEY`) is now superseded by the Edge Function and should not be used. Keep the GitHub `VITE_ANTHROPIC_API_KEY` secret empty; rotate the key if it was ever exposed.
- **Apply migration 003** in Supabase SQL Editor (`db/migrations/003_import_logs.sql`) before import logging will work. The import itself succeeds without it; logging fails silently (non-fatal).
- **Apply schema additions for income/settings** — `variance_threshold`, `bonus_month`, `benefits_amount`, `benefits_pct`, `four01k_pct`, `four01k_on_bonus` columns must exist in `user_profiles` for Settings save and income forecast to work. Add via SQL Editor if the migration wasn't applied.
- **Test with real Monarch CSV** — dedup logic and parser logic are written but not tested against an actual 12–24 month export.
- **No error boundary** — unhandled React render errors still produce a blank page. Add one soon.
- ~~**Supabase 1000-row truncation**~~ — resolved: all high-volume queries now use `.range()` pagination loops.
- ~~**AI briefing income figures inconsistent with dashboard**~~ — resolved: AI context now uses the same current-year `incomeVsExpenses()` projection as the Income widget.
- Email confirmation setting in Supabase Auth determines whether signup logs in immediately vs. requires an email link.

### Recommended next session

*(Superseded 2026-07-08 — the migration to Neon/Vercel is fully complete, so the Supabase/PR #142-era items below no longer apply. Current state: all three previously "visually unverified" UI features and the real Monarch CSV end-to-end test are now confirmed. Remaining work is the hardening backlog.)*

~~**Browser verification**~~ — Grill Session, Scenario 4-tab layout, and AI Adjustment Composer all confirmed working live (2026-07-08). ✓
~~**Real Monarch CSV end-to-end test**~~ — confirmed working live (2026-07-08). ✓
~~**Add React error boundary**~~ — done, Phase 11. ✓
~~**Deploy + verify `ai-chat`**~~ — superseded by the Neon/Vercel migration; `/api/ai-chat` confirmed live. ✓

~~**Pin the AI model version**~~ — decided against (2026-07-08): `resolveModel()` (`app/api/ai-chat/route.js`) is kept as-is, resolving to the newest release within a named family (`sonnet`/`haiku`). The family is the intentional pin; the exact version is meant to float so the app always runs on Anthropic's latest release for that family.
~~**Verify income forecast math**~~ — confirmed good (2026-07-08). ✓

**Reliability (current priority — see `ARCHITECTURE.md` §10 hardening backlog)**
1. **Add Vitest unit tests** for pure modeling functions — `widgetData.js`, `patternAnalyzer.js`, `schedule.js`, scenario delta math.
2. **Move currency math to integer cents** — dollar amounts are currently JS floats throughout; no visible bug yet, but a known rounding-error risk as data volume grows.

**Polish**
3. **Mobile QA pass** — all modules at 760 and 1100 breakpoints; Scenario 4-tab layout on mobile. **In progress (2026-07-08):** dashboard has a slight horizontal scroll on mobile (should fit edge-to-edge); Forecast module's mobile view (stacked month blocks) is under review for a better layout.
4. **Make the repo public** — held from Phase 11, now that the AI proxy/key handling is confirmed solid post-migration.

~~**Transactions backfill**~~ — resolved via the live browser-verification re-upload (2026-07-05); no gap worth closing. ✓
~~**Security cleanup**~~ — `src/lib/anthropic.js` deleted, `VITE_ANTHROPIC_API_KEY` removed from build workflow and `.env`; GitHub secret confirmed empty. ✓
~~**Apply outstanding DB migrations**~~ — all applied ✓  
~~**Preview-before-write for AI scenario mutations**~~ — implemented ✓  
~~**AI command bar yearTxns threading**~~ — implemented ✓

---

## Phase 0 — Repo and Project Setup
*Goal: Clean foundation before a single line of product code is written.*

- [x] Initialize Vite + React SPA (`npm create vite@latest`)
- [x] Configure GitHub Pages deployment
- [x] Set up Supabase project (new project, not shared with other apps)
- [x] Install and configure Supabase client in React app
- [x] Set up `.env` file with Supabase URL, anon key, and Anthropic API key
- [x] Configure ESLint, Prettier, basic project structure
- [x] Commit `ARCHITECTURE.md` and `ROADMAP.md` to repo root
- [x] Confirm Anthropic API model string (verify current `claude-sonnet-4-6`) ✓
- [x] Verify Supabase free tier limits (500MB storage — confirmed sufficient) ✓

**Exit criteria:** App builds and deploys to GitHub Pages. Supabase project live. No product features yet. ✓

---

## Phase 1 — Supabase Schema
*Goal: Full data model live in Supabase before any UI is built.*

- [x] Create `transactions` table with dedup_key unique index
- [x] Create `budget_categories` table
- [x] Create `budget_line_items` table
- [x] Create `scenarios` table
- [x] Create `scenario_adjustments` table
- [x] Create `commitments` table with jsonb cost_structure and split_rules
- [x] Create `wealth_snapshots` table
- [x] Create `ai_briefings` table
- [x] Set up Row Level Security (RLS) policies for all tables
- [ ] Seed `budget_categories` table from FY26 budget (46 categories, 11 groups, Fixed/Flexible/Non-Monthly types)
- [~] Write and test deduplication logic (composite key: date + merchant + amount + account) — logic written (`buildDedupKey`), not yet tested against a real CSV
- [x] Verify schema against architecture doc — no gaps, no John-specific hardcoding

**Exit criteria:** All tables live in Supabase. RLS enabled. Budget categories seeded. Dedup logic tested.

---

## Phase 2 — Data Ingestion
*Goal: CSV import pipeline working end-to-end with deduplication.*

- [x] Build CSV upload component (drag-and-drop + file picker) — in Onboarding Step 4 + Settings re-import
- [x] Build Monarch CSV parser (`src/lib/csv/monarchParser.js`) — handles quoted fields, row-level errors, date/amount parsing
- [x] Map Monarch Category → `budget_categories.category` on import (`src/lib/csv/categoryMap.js`, 100+ categories)
- [x] Derive Group from category mapping table (not imported directly)
- [x] Run deduplication check on every import (existing `importTransactions` dedup via `user_id,dedup_key` unique constraint)
- [x] Display import summary: X new transactions added, Y duplicates skipped
- [x] Handle unmapped categories: surface for user confirmation before inserting (UnmappedScreen in ImportFlow)
- [~] Test with real Monarch CSV exports (12-month and 24-month files) — logic written, not yet tested against a real export
- [x] Build import history log (`import_logs` table + `src/lib/db/importLog.js` + display in Settings)

**Exit criteria:** Upload a Monarch CSV, see transactions in Supabase, duplicates correctly skipped, unmapped categories surfaced. ✓ (pending real-data test)

---

## Phase 3 — Dashboard Shell and Navigation
*Goal: The hub is live. Navigation works. No module content yet.*

- [x] Build persistent collapsible left sidebar (web) — `Sidebar.jsx`, collapses to icon rail
- [x] Build card-based navigation (mobile) — top bar + slide-in drawer with module list
- [x] Implement responsive breakpoints (desktop / tablet / mobile) — 760 / 1100 thresholds in `AppShell.jsx`
- [x] Build route structure for all modules (state-based switching via `registry.js`; pages exist as placeholders)
- [x] Build Dashboard canvas (empty widget grid, drag-to-rearrange scaffold) — `Dashboard.jsx`
- [x] Build AI command bar (persistent, bottom of canvas on desktop) — `CommandBar.jsx`
- [x] Build FAB + bottom sheet AI input (mobile)
- [x] Wire command bar to Anthropic API — via secure Supabase Edge Function proxy (`db/functions/ai-chat`), not direct browser call
- [x] Build AI context loader (pulls user data from Supabase at session start) — `lib/ai/contextLoader.js`
- [x] Build "Coming Soon" stub page for Mapping module — `mapping/Mapping.jsx`
- [x] Implement dark/light mode toggle — `lib/theme/useTheme.js`, persisted to localStorage

**Exit criteria:** Full navigation works. Dashboard renders. Command bar connects to Anthropic API. All module routes exist. Responsive on mobile and desktop. ✓ (command bar answers live once `ai-chat` is deployed)

---

## Phase 4 — Cash Flow Timing Module
*Goal: First fully functional module. The foundation everything else sits on.*

- [x] Build 12-month rolling cash demand calendar view
- [x] Pull Non-Monthly budget line items from Supabase by month — surfaced in the CashFlow "Planned" view
- [x] Render month-by-month cash outflow schedule
- [x] Build upcoming spike alerts (configurable dollar threshold)
- [x] Build quarter-by-quarter cash flow summary
- [x] Build category drill-down by month
- [ ] Wire AI command bar context to Cash Flow Timing module
- [ ] Test with real FY26 budget line items (cruises, subscriptions, transfers)

**Exit criteria:** Can open Cash Flow Timing and see when every large/irregular expense hits across the next 12 months.

---

## Phase 5 — Scenario Planner
*Goal: Core decision engine. The primary value proposition.*

- [x] Build scenario creation flow (name, description, start from baseline)
- [x] Build scenario adjustment input (category + month + delta amount + label)
- [x] Implement scenario states: Modeled vs. Committed
- [x] Build "Promote to Committed" flow with baseline audit record
- [x] Build view mode toggle: Baseline only / Actual Plan (baseline + committed) / Modeled scenario vs. baseline
- [x] Build side-by-side scenario comparison view (Comparison View tab — cumulative delta by month)
- [ ] Build assumption sliders for direct manipulation (deferred to Phase 6+)
- [x] Wire AI command bar to Scenario Planner — AI context now includes scenarios + adjustments; AI can describe scenario adjustments in conversational answers
- [x] Build scenario list view (all modeled and committed scenarios)
- [ ] Test: "What happens if I book a $5,000 cruise in Q3?" → AI creates scenario → renders in canvas

**Exit criteria:** Can create a scenario manually or via AI, promote it to committed, and see baseline vs. actual plan side by side.

---

## Phase 6 — Annual Budget Builder
*Goal: Replace the manual spreadsheet process.*

- [~] Build AI-guided budget generation session flow — deterministic analyzer-driven generate flow built; conversational AI session deferred
- [x] Build historical pattern analyzer (ingests 12–24 months of transactions, identifies Fixed/Flexible/Non-Monthly patterns by category) — `src/lib/budget/patternAnalyzer.js`
- [ ] Build conversational timing confirmation flow (AI asks about Non-Monthly items) — deferred (Non-Monthly timing derived from historical month histogram instead)
- [x] Build month-by-month budget schedule generator (output: `budget_line_items` rows)
- [x] Build annual drill-down view (single year from multi-year schedule) — year selector + schedule grid; `ScheduleGrid` mirrors `ForecastGrid` with sticky headers, group collapse, and per-category named sub-row drill-down (2026-06-22)
- [~] Build multi-year budget view (3–5 year horizon) — per-year selectable; side-by-side multi-year roll-up deferred
- [x] Wire Long-Term Commitments into multi-year projection (auto-populate from `commitments` table) — commitment rows rendered in the schedule grid
- [x] Build budget edit/override UI (user can adjust AI-generated targets) — editable draft in generate flow
- [x] Build Upload Budget path (import existing .xlsx/.csv) — `parseBudgetFile` / `parseBudgetCSV` / `parseBudgetWorkbook` in `src/lib/csv/budgetParser.js`; supports detail-tab line-item capture with `extractLineItemsFromDetail`; Tab Match Review covers all matched categories (2026-06-22)
- [ ] Build budget version history (track changes year over year) — schema supports `budget_version`; UI deferred
- [ ] Test: Full FY27 budget generation from FY25–FY26 transaction history — pending real data

**Exit criteria:** Can run the budget generation flow and produce a complete month-by-month budget without touching a spreadsheet. ✓ (multi-year roll-up + conversational session deferred)

---

## Phase 7 — Long-Term Commitments Module
*Goal: First-class tracking of all financial obligations spanning more than one year.*

- [x] Build commitment creation form (name, type, start/end date, cost structure, status, notes)
- [x] Build cost structure input (monthly amount, annual total, or custom schedule via jsonb)
- [x] Build split rules input (percentage allocation across categories — e.g., 95% mission / 5% family support)
- [x] Build commitment list view (active, paused, completed) — with status filter
- [x] Build commitment detail view (timeline, total projected cost, month-by-month schedule)
- [x] Wire commitments into Annual Budget Builder (auto-populate as schedule rows) — via `commitmentYearSchedule`
- [x] Wire commitments into Cash Flow Timing (auto-populate as future cash demands) — CashFlow "Planned" view aggregates active commitments via `schedule.js` + Non-Monthly budget line items into a forward 12-month cash-demand calendar
- [x] Wire commitments into Scenario Planner / Wealth (surfaced as constraints) — Wealth drains active commitments; AI context includes them
- [ ] Wire AI command bar to Commitments — AI can add/modify commitments via conversation — deferred (AI context includes commitments read-only)
- [ ] Seed with existing commitments — user-entered via form

**Exit criteria:** All active long-term commitments visible with projected cost schedules. Changes flow into Budget, Wealth, and the AI context. ✓

---

## Phase 8 — Wealth Trajectory Module
*Goal: Long-term wealth and retirement scenario modeling.*

- [x] Build net worth input form (investment balance, retirement balance, other assets, liabilities)
- [x] Build wealth snapshot history (track net worth over time)
- [x] Build baseline trajectory chart (projected net worth over time given current assumptions) — SVG chart
- [x] Build contribution scenario sliders (contribution rate, market return assumption, retirement target date)
- [x] Build commitment impact overlay (how long-term commitments affect wealth trajectory) — baseline vs. commitment-drained series
- [ ] Build bonus allocation scenario ("if I get a $X bonus, where should it go?") — deferred
- [ ] Wire AI command bar to Wealth Trajectory — deferred (AI context includes latest snapshot)
- [x] Build retirement horizon view (years to target retirement date, projected balance at retirement) — years-to-target + projected balance stats

**Exit criteria:** Can see current wealth trajectory and model the impact of changing contribution rates, market assumptions, and commitments. ✓ (bonus-allocation + AI-driven modeling deferred)

---

## Phase 9 — Dashboard Widgets and AI Briefing
*Goal: Dashboard becomes a real control center, not just a navigation hub.*

- [x] Build and wire all pre-defined widgets to live Supabase data:
  - [x] Monthly Budget vs. Actuals chart (12-month bars, variance threshold, full-year pill, forecast overrides)
  - [x] Income vs. Expenses (12-month chart, post-tax forecast, full-year KPIs)
  - [x] Spend by Group (full-year actual + forecast vs. budget per group, drill-down modal)
  - [x] Cash flow spike (next upcoming commitment spike)
  - [x] Budget vs. projected (run-rate) trajectory
  - [x] Run-rate EOY projection
  - [x] Long-Term Commitments summary
  - [x] Wealth Trajectory snapshot
  - [x] Scenario Plan summary
- [x] Build AI Briefing widget (on-demand narrative generation, cached in `ai_briefings` table)
- [x] Build widget add/remove/rearrange functionality (drag-to-configure + show/hide, persisted to localStorage)
- [x] Build widget collapse/expand (per-card chevron + global toggle, persisted to localStorage)
- [ ] Build AI-generated custom widget save flow — deferred
- [ ] Build widget-level AI context (command bar response scoped to widget in focus) — deferred

**Exit criteria:** Dashboard is a fully populated control center. All predefined widgets live. AI Briefing generates and caches. ✓ (custom AI widgets deferred)

---

## Phase 10 — Onboarding Flow
*Goal: A new user can get from zero to populated dashboard without help.*

- [x] Build login / auth screen (Supabase Auth) — done early
- [x] Build empty state detection (no data → trigger onboarding) — via `user_profiles.onboarding_complete`
- [x] Build welcome screen and priority mapping conversation (3-part setup questions) — `Onboarding.jsx` Step1–2
- [x] Build CSV upload step — `Onboarding.jsx` Step4 + `ImportFlow`
- [x] Build category confirmation step — `ImportFlow` unmapped-categories screen
- [ ] Build commitment setup step — deferred (Commitments module available post-onboarding)
- [ ] Build first budget generation step (runs Annual Budget Builder automatically) — deferred (Budget Builder available post-onboarding)
- [x] Build onboarding completion → redirect to populated Dashboard — Step5
- [x] Build "Coming Soon" placeholder for Mapping module

**Exit criteria:** A new user can complete onboarding end-to-end and land on a populated dashboard. ✓ (in-flow commitment + auto-budget steps deferred)

---

## Phase 11 — Polish and Pre-Launch
*Goal: Production-ready for personal daily use.*

- [x] Add React error boundary (`src/modules/common/ErrorBoundary.jsx` wraps `<App />` in `main.jsx`)
- [ ] Full mobile QA pass (all modules, all breakpoints)
- [ ] Performance audit (Supabase query optimization, AI context payload size)
- [ ] Error handling audit (failed imports, API errors, empty states)
- [ ] AI response quality review (context prompt tuning)
- [x] API key proxy — `ai-chat` Edge Function ACTIVE (version 5), confirmed live with real 200 responses. `ANTHROPIC_API_KEY` secret confirmed set.
- [x] Security cleanup: `src/lib/anthropic.js` deleted, `VITE_ANTHROPIC_API_KEY` removed from `.env`, from `.github/workflows/deploy.yml` build env, and from README setup. GitHub Actions secret confirmed empty. Vite never inlined the key (no `import.meta.env.VITE_ANTHROPIC_API_KEY` reference in `src/`).
- [ ] Make repo public (after proxy is confirmed working)
- [ ] Final ROADMAP.md update (check off completed phases, note any scope changes)

**Exit criteria:** App is in daily personal use. Repo is public. API key is protected.

---

## Phase 2+ Backlog (Not in V1 Scope)

- **AI-driven app customization (builds on AI personalization).** The personalization
  interview ("grill me") already produces a durable, flexible `ai_preferences` blob
  (priorities, surface/ignore, tone, notes). Once the dashboard/module catalog is
  built out, a "layout recommender" can read that blob to auto-configure which
  dashboards, widgets, and modules a given user sees by default — instead of making
  them configure it by hand. No schema change needed: new features read the existing
  preferences record; the interview prompt just grows a few questions about new
  surfaces. Deliberately deferred until there's more than one dashboard to choose
  between.
- Monarch unofficial API connection (live data sync)
- Category Mapping module (full build-out)
- Monte Carlo simulation for Wealth Trajectory
- React Native native mobile app
- Multi-tenant / public user accounts
- Credit card annual fee rewards value analysis
- Remitly / Western Union supplemental transfer data
- Google Sheets sync
- Social Security and tax modeling (Wealth Trajectory expansion)
- Vitest unit tests for `widgetData.js`, `patternAnalyzer.js`, `schedule.js`, scenario delta math

---

## Native app (PWA → Play Store) — PLANNED

**Status:** Planned / not started. Candidate to ship as an installable Android
app via a PWA wrapped in a TWA. Part of the cross-repo NGS native rollout,
which is piloted in **NextGen-Immersion** — the PWA→TWA→Play pipeline is proven
there first.

**Distinct from the other two apps:** Immersion and NextGen-Scholars are
private (Play Internal Testing). This app **may go public** (see "Multi-tenant /
public user accounts" in future scope above). A public production listing is a
heavier path — content rating, data-safety declaration (financial data —
declare honestly), privacy policy, and the new-account 12-tester / 14-day
closed-testing gate. **Decide private-vs-public later;** the PWA groundwork is a
prerequisite either way and keeps both options open.

Runbook: `docs/PWA.md` (written; work not started). Deliverables: manifest
(`app/manifest.js`), service worker (all data/AI API routes network-only —
single-user, so no cross-user leak risk, but financial-data freshness still
forbids caching), 192/512 + maskable icons rasterized from the existing
`public/favicon.svg` / `icons.svg`. Play Store step chosen once the
private/public decision is made.

---

## Session Protocol for Claude Code

Load into every Claude Code session:
1. `ARCHITECTURE.md` — product vision, data model, module specs
2. `ROADMAP.md` — current phase, completed tasks, next tasks
3. Any relevant module file if working within a specific module

Start each session by stating:
- Current phase
- What was completed last session
- What you want to accomplish this session

This prevents context drift and keeps each session scoped to a single phase or task group.

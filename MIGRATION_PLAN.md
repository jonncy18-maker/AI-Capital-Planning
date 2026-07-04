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

- [ ] Build shared Postgres client + JWT-verification helper (JWKS, cached)
      for Vercel serverless functions
- [ ] Port every read call site — ~95 call sites across 17 files in
      `src/lib/db/*.js`
- [ ] Fold in the two files that bypass the `db/` layer today and query
      Supabase directly: `src/modules/dashboard/Dashboard.jsx`,
      `src/modules/creditcards/CreditCards.jsx`
- [x] ~~Public whitelist endpoint~~ — not needed; no unauthenticated read
      paths exist anywhere in this app

**Gate B1:**
- [ ] Every module renders from Neon, visually identical to Supabase version
- [ ] A request with no/forged token 403s (not a silent broad read)

## Phase B2 — Write path

- [ ] Port every write call site (same file list as B1)
- [ ] Review for multi-step client-orchestrated writes that should become
      one server transaction — check first:
  - [ ] `promoteToCommitted` (`src/lib/db/scenarios.js` — scenario commit +
        baseline audit record)
  - [ ] `saveBudgetForYear` (`src/lib/db/budgetLineItems.js` —
        delete-then-insert per year/version)
  - [ ] CSV import path (`importTransactions` batched upsert + `import_logs`
        write)
- [ ] Build an application-level equivalent of `handle_new_user()` (no
      `auth.users` table to hang a Postgres trigger off under Neon Auth) —
      "ensure profile row" on first authenticated request

**Gate B2:**
- [ ] Scripted CRUD walkthrough across all 24 tables passes
- [ ] Profile auto-provisioning fires correctly for a fresh Neon Auth signup

## Phase B3 — Realtime → polling

- [x] **Skipped** — zero `.channel()`/`.subscribe()` call sites anywhere in
      `src/`; nothing to replace.

## Phase B4 — Auth completion

- [x] ~~Remove cosmetic/fake gates~~ — none exist; only real gate is the
      `session` check in `App.jsx`
- [ ] Direct-probe test: hit a scoped Neon-backed route with no/forged token,
      confirm 403 now that RLS isn't the enforcement layer

**Gate B4:**
- [ ] Logged-out access limited to the login screen only
- [ ] Direct-URL probe against a scoped endpoint with the wrong/missing
      identity fails correctly

## Phase B5 — Remaining server-side logic

- [ ] Port `supabase/functions/ai-chat` → Vercel serverless function (same
      request/response contract); mint a fresh `ANTHROPIC_API_KEY`, don't
      copy the Supabase secret
- [ ] Port `supabase/functions/monarch-sync` → Vercel serverless function
      (no stored secret, but needs the same JWT-verification rewrite)
- [ ] Re-run the golden-question suite: grill session, scenario AI composer,
      AI briefing, category/bill/credit-card parsers (9 call sites funneled
      through `sendMessage.js`)

**Gate B5:**
- [ ] Every AI capability produces the same response shape as today
- [ ] `monarch-sync` still authenticates and paginates correctly

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

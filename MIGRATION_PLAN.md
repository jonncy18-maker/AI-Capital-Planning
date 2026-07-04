# Migration Plan — Supabase → Neon + Neon Auth + Vercel

**Status:** Planning only. No cutover work has started. This instantiates
`03-phased-plan-template.md` from the Supabase→Neon playbook with this
repo's real tables, endpoints, and decisions. Nothing in this repo depends
on Neon/Vercel yet — the app runs exactly as it did before this plan was
written.

## Decisions (recorded 2026-07-04, per playbook `02-architecture-decisions.md`)

1. **API layer style: full custom API layer.** Every read/write becomes a
   hand-written serverless route; authorization is a plain `requireOwnRecord`-
   style check per route, not Neon Data API / RLS-over-HTTP. Justified by the
   schema: 24 tables, every RLS policy identical in shape
   (`auth.uid() = user_id`), no per-role branching to lose by leaving RLS.
2. **Framework: switch Vite SPA → Next.js App Router.** The app currently has
   no router at all (`src/modules/registry.js` is a static array driving
   state-based navigation via `sessionStorage`) — introducing Next.js routing
   is a bigger one-time cost here than in a typical port, but it aligns with
   every Neon/Vercel/Neon Auth convention going forward instead of fighting
   them by hand. This becomes its own Phase A′, done first, still pointed at
   Supabase.
3. **Cutover: staged, informal freeze.** Single-user app in daily personal
   use — "announce a freeze" means pausing your own writes for the sync
   window, not a multi-user notice. Otherwise the full staged procedure from
   `04-data-migration-runbook.md` applies as written.

## Pre-flight finding (resolved)

Live-database introspection (2026-07-04, via the Supabase MCP server against
project `wdzfvgketuvjksdbrjdo`) confirmed the real schema is **24 tables**,
not the 19 visible in previously-committed migrations. 5 tables — `bills`,
`accounts`, `bill_amounts`, `account_balances`, `forecast_overrides` — existed
only in the live database. Recovered as
`supabase/migrations/015_recover_undocumented_tables.sql` (see
`ARCHITECTURE.md` §5.1.1). All 5 follow the same `auth.uid() = user_id`
ownership RLS pattern as every other table — no new authorization shape to
design for. The one other database object confirmed by introspection: a
single trigger, `on_auth_user_created` → `handle_new_user()`, auto-creating a
`user_profiles` row on signup (no other undocumented triggers/functions
exist).

## Phase A′ — Next.js migration (Supabase untouched)

- Scaffold Next.js App Router routes as thin wrappers around the existing
  screen components in `src/modules/*` — no UI rewrite.
- Convert `registry.js`'s static module list into file-based routes
  (`app/dashboard`, `app/cashflow`, `app/scenarios`, `app/budget`,
  `app/commitments`, `app/wealth`, `app/settings`, `app/mapping`).
- Convert env vars: `import.meta.env.VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY` → `process.env.NEXT_PUBLIC_SUPABASE_URL` /
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- No bookmarked/shared URLs to preserve — current nav is state-based, not
  route-based, so no redirect-stub work is needed here (a simplification vs.
  the playbook's default assumption).
- Still calls Supabase directly (client + edge functions) — zero data-layer
  change in this phase.

**Gate A′:** production build clean on Vercel preview; every new route
renders correctly including a hard refresh mid-route (not just client nav);
login/session and both edge functions (`ai-chat`, `monarch-sync`) still work
against Supabase from the new Next.js shell.

## Phase B0 — Neon + Neon Auth provisioning

- Provision a Neon project + dev branch.
- Apply the full recovered schema (19 originally-committed tables +
  `015_recover_undocumented_tables.sql`) to the dev branch, RLS statements
  stripped per `05-known-gotchas.md` #3 (RLS is vestigial on Neon — the
  *intent* moves into route code in Phase B1/B4, not the schema).
- Provision Neon Auth; verify its actual backend (Better Auth) and JWKS URL
  directly against the live config — don't assume from docs. Create one
  real account (this is a single-user app).
- Restore data; verify row-count parity per table against Supabase (24
  tables, per the introspected list above).

**Gate B0:** verification query set (§`04-data-migration-runbook.md` Step 2)
matches on all 24 tables; login against Neon Auth succeeds for the one real
account.

## Phase B1 — Read path

- Build the shared Postgres client + auth-JWT-verification helper (JWKS,
  cached) for Vercel serverless functions — this replaces the "free" gateway
  JWT check Supabase's PostgREST/Edge Function gateway provided.
- Port every read call site. Current inventory: ~95 query call sites across
  17 files in `src/lib/db/*.js`, plus **two call sites outside that layer
  that bypass it today** — `src/modules/dashboard/Dashboard.jsx` (direct
  queries against `budget_line_items`/`forecast_line_items`) and
  `src/modules/creditcards/CreditCards.jsx` (direct queries against
  `budget_categories`/`bills`/`budget_line_items`/`forecast_line_items`).
  Fold both into the new API layer so there's no equivalent bypass on the
  other side — this is exactly the kind of gap `06-post-migration-audit-prompt.md`
  is designed to catch, so fix it now rather than relying on that audit to
  find it later.
- No public/unauthenticated read paths exist in this app (confirmed during
  assessment) — every new route requires auth by default, no curated
  whitelist endpoint needed.

**Gate B1:** every module renders from Neon, visually identical to the
Supabase-backed version; network tab shows no other user's data (moot for a
single-user app, but verify the auth check still 403s a forged/missing
token).

## Phase B2 — Write path

- Port every write call site (same file list as B1).
- Audit specifically for multi-step client-orchestrated writes that should
  become one server transaction — candidates to check first:
  `promoteToCommitted` (scenario commit + baseline audit record in
  `src/lib/db/scenarios.js`), `saveBudgetForYear` (delete-then-insert per
  year/version in `src/lib/db/budgetLineItems.js`), and the CSV import path
  (`importTransactions` batched upsert + `import_logs` write).
- Confirm the one live trigger (`handle_new_user` / `on_auth_user_created`)
  has an application-level equivalent under Neon Auth (no `auth.users` table
  to hang a Postgres trigger off of) — e.g. "ensure profile row" on first
  authenticated request.

**Gate B2:** scripted CRUD walkthrough across all 24 tables; the
`user_profiles` auto-provisioning equivalent fires correctly for a fresh
Neon Auth signup.

## Phase B3 — Realtime → polling

**Skipped.** Confirmed zero `.channel()`/`.subscribe()` call sites anywhere
in `src/` — nothing to replace.

## Phase B4 — Auth completion

- No cosmetic/fake gates exist to remove (confirmed during assessment — the
  only gate is the real `session` check in `App.jsx`).
- Re-verify with a direct probe: hit a scoped Neon-backed route with no
  token / a forged token and confirm 403, not a silent broad read, now that
  RLS is no longer the enforcement layer.

**Gate B4:** logged-out access is limited to the login screen only; a
direct probe against any data route without a valid Neon Auth token fails
correctly.

## Phase B5 — Remaining server-side logic

- Port `supabase/functions/ai-chat` → a Vercel serverless function. Same
  contract (messages/system/model/tools in, narrative/tool-calls out);
  `ANTHROPIC_API_KEY` becomes a Vercel project env var, minted fresh (per
  `05-known-gotchas.md` #7) rather than copied.
- Port `supabase/functions/monarch-sync` → a Vercel serverless function.
  No stored secret (credentials are user-supplied per call), but same
  JWT-verification rewrite applies since there's no Supabase gateway
  checking auth before the function body runs.
- Re-run the golden-question suite (grill session, scenario AI composer,
  AI briefing, category/bill/credit-card parsers — 9 call sites funneled
  through `sendMessage.js`) against the ported functions.

**Gate B5:** every AI capability produces the same shape of response as
today; `monarch-sync` still authenticates and paginates correctly.

## Phase C — Cutover

1. Pause your own writes (informal freeze — single-user app).
2. Final data re-sync + full verification suite (Step 2 of
   `04-data-migration-runbook.md`) — must match exactly across all 24
   tables.
3. Flip Vercel env vars to the Neon/Neon Auth production config.
4. Smoke test: login, one read (Dashboard), one write (add a transaction or
   scenario adjustment), one multi-step transaction (promote a scenario),
   one AI call (briefing or command bar).
5. Leave the Supabase project **paused, not deleted** — write down the
   rollback (revert Vercel env vars, resume Supabase) before flipping, not
   after.

## Phase D — Decommission

- Run the fresh-context audit from `06-post-migration-audit-prompt.md` as a
  genuinely new subagent — both the code-reference sweep and the data-path
  trace variant, given this repo already has one confirmed history of
  live-only undocumented state (the 5 recovered tables) that a name-based
  grep alone wouldn't have caught.
- Only after that audit is clean: remove `@supabase/supabase-js` from
  `package.json`, delete `supabase/` (functions + migrations — after copying
  final schema state to wherever Neon migrations are tracked going forward),
  delete `.github/workflows/deploy.yml` (GitHub Pages) if fully replaced by
  Vercel's own deploy, update `ARCHITECTURE.md` §3.3 and §5 to describe Neon
  as current rather than Supabase.
- Pause (don't delete) the Supabase project for a fallback window before
  actually deleting anything there.

## What does *not* need to change

- No realtime replacement (Phase B3 skipped).
- No public/anon-key read-site hardening (there are none).
- No cosmetic auth gates to fix (there are none).
- UUID generation (`gen_random_uuid()` everywhere) needs no `uuid-ossp`
  extension work on Neon.

## Watch for while building (from `05-known-gotchas.md`)

- **Numeric stringification** — every `numeric` column (amounts, targets,
  balances, point values) comes back as a string from Neon's driver instead
  of PostgREST's JSON numbers. Audit `.toFixed()`/arithmetic call sites in
  the dashboard widgets, forecast grid, and wealth projection during Phase
  B1, not after.
- **Neon Auth `trusted_origins`** — list every Vercel hostname (production
  domain, `-xxxxx.vercel.app`, `-git-main-*.vercel.app`) once Phase A′ is
  live, or logins on preview/branch deploys fail with a generic
  "invalid credentials" message that looks like a wrong password.

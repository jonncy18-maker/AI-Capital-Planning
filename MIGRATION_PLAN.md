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

- [ ] Scaffold Next.js App Router routes as thin wrappers around existing
      screen components in `src/modules/*` — no UI rewrite.
- [ ] Convert `registry.js`'s static module list into file-based routes:
      `app/dashboard`, `app/cashflow`, `app/scenarios`, `app/budget`,
      `app/commitments`, `app/wealth`, `app/settings`, `app/mapping`.
- [ ] Convert env vars: `import.meta.env.VITE_SUPABASE_URL` /
      `VITE_SUPABASE_ANON_KEY` → `process.env.NEXT_PUBLIC_SUPABASE_URL` /
      `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- [ ] Confirm both edge functions (`ai-chat`, `monarch-sync`) still callable
      from the new Next.js shell (still hitting Supabase in this phase).
- [x] ~~Redirect stub for old URLs~~ — not needed; current nav is
      state-based, no bookmarkable deep links exist.

**Gate A′** (all must pass before Phase B0):
- [ ] Production build clean on a Vercel preview deploy
- [ ] Every route renders on a hard refresh mid-route, not just client nav
- [ ] Login/session still works against Supabase
- [ ] Both edge functions still respond correctly from the new shell

## Phase B0 — Neon + Neon Auth provisioning

- [ ] Provision a Neon project + dev branch
- [ ] Apply full schema (19 original + `015_recover_undocumented_tables.sql`)
      to the dev branch, RLS statements stripped (intent moves to route code
      in B1/B4, not the schema — see gotchas below)
- [ ] Provision Neon Auth; verify actual backend/JWKS URL against the live
      config directly (don't assume from docs)
- [ ] Create the one real account (single-user app)
- [ ] Restore data; verify row-count parity across all 24 tables

**Gate B0:**
- [ ] Verification query set matches on all 24 tables
- [ ] Login against Neon Auth succeeds for the real account

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

# AI Capital Planning OS — V1 Roadmap

**Repo:** AI Capital Planning  
**Architecture Reference:** `ARCHITECTURE.md`  
**Build Philosophy:** Schema first, data layer second, UI third. No frontend work before the data model is solid. Each phase produces something usable before the next phase begins.

---

## Current Status — Session Log

**Last updated:** 2026-06-17 (Phases 5–10 built)

### Done so far
- **Phase 0 complete** — Vite + React SPA, GitHub Pages deploy (auto on push to `main`), Supabase project live, client configured.
- **Phase 1 schema live** — all tables created in Supabase via `supabase/migrations/001_initial_schema.sql`: `transactions`, `budget_categories`, `budget_line_items`, `commitments`, `scenarios`, `scenario_adjustments`, `wealth_snapshots`, `ai_briefings`, plus `user_profiles`. **RLS enabled** on every table (per-user `auth.uid()` policies).
- **Auth working** (done early, ahead of Phase 10) — email/password sign-up + sign-in (`src/modules/auth/Login.jsx`), session tracking (`src/lib/auth/useAuth.js`), auth gate in `App.jsx` (Login → Onboarding → App shell), sign-out.
- **Profile persistence** — onboarding answers saved to `user_profiles` in Supabase (`src/lib/db/profile.js`); a signup trigger auto-creates the profile row (`migration 002` hardened it with pinned `search_path` to fix a signup 500).
- **DB helper layer scaffolded** — `src/lib/db/transactions.js` (`importTransactions` w/ dedup, `getRecentTransactions`, `getTransactions`), `src/lib/db/commitments.js`, `src/lib/db/profile.js`.
- **Verified end-to-end:** new user can sign up → land in onboarding → profile row written.
- **Phase 2 complete** — Full CSV import pipeline:
  - `src/lib/csv/monarchParser.js` — Monarch Money CSV parser (handles quoted fields, date/amount parsing, row-level error reporting).
  - `src/lib/csv/categoryMap.js` — 100+ Monarch category → group/type mappings; `findUnmappedCategories`, `applyMappings`.
  - `src/lib/db/budgetCategories.js` — `seedDefaultCategories(userId)` (idempotent upsert on first import), `upsertCategory`, `getBudgetCategories`.
  - `src/lib/db/importLog.js` — `logImport`, `getImportHistory` backed by new `import_logs` table.
  - `supabase/migrations/003_import_logs.sql` — `import_logs` table with RLS (apply in Supabase SQL Editor).
  - `src/modules/import/ImportFlow.jsx` — Full-screen import state machine: parsing → unmapped-categories dialog → importing → summary.
  - Onboarding now passes `raw` CSV through to `onComplete`; App.jsx inserts ImportFlow between onboarding and main app when CSV is present.
  - Settings → Data Management section: re-import CSV drop zone + import history log.
- **Phase 3 complete** — Dashboard shell, navigation, command bar, AI proxy:
  - `src/modules/shell/AppShell.jsx` — hub layout (sidebar + canvas + command bar), responsive (mobile/tablet/desktop), owns AI context + command-bar submit.
  - `src/modules/shell/Sidebar.jsx` — collapsible left sidebar (icon rail when collapsed); also rendered inside mobile drawer.
  - `src/modules/shell/CommandBar.jsx` — persistent AI input; desktop bottom bar, mobile FAB + bottom sheet. Responses render as a dismissible card in the canvas.
  - `src/modules/registry.js` — central module registry (single source of truth for nav + routing).
  - `src/modules/dashboard/Dashboard.jsx` — widget grid with drag-to-rearrange scaffold; live widgets (90-day activity, categories, commitments) render real numbers from the AI context.
  - Module stubs: `cashflow`, `scenarios`, `budget`, `commitments`, `wealth` (shared `common/ModuleStub.jsx`), plus `mapping` "Coming Soon".
  - `src/lib/theme/useTheme.js` — persistent dark/light toggle (localStorage, sets `data-theme`).
  - `src/lib/ai/contextLoader.js` — `loadAIContext(userId)` (90d txns + categories + active commitments + latest wealth snapshot), `summarizeContext`, `buildContextBrief`.
  - **AI now wired through a secure Supabase Edge Function** — `supabase/functions/ai-chat/index.ts` holds the Anthropic key server-side; `src/lib/ai/sendMessage.js` calls it via `supabase.functions.invoke('ai-chat')` (JWT auto-attached). The browser never sees the key.
- **Phase 4 complete** — Cash Flow Timing Module:
  - `src/modules/cashflow/CashFlow.jsx` — full 12-month rolling calendar; month cards with spike detection, configurable threshold, click-to-expand category breakdown, trailing 4-quarter summary, loading/error/empty states.
  - `src/lib/db/transactions.js` — added `getTransactionsByMonth(userId, fromDate, toDate)` for date-range queries used by the calendar.
  - **CSV import batching fix** — `importTransactions` now upserts in 500-row batches (handles 1000+ row files) and uses count-before/count-after to accurately measure inserts instead of relying on the unreliable `ignoreDuplicates` return value.

### Known follow-ups / gotchas
- **Deploy the Edge Function:** `supabase functions deploy ai-chat` and `supabase secrets set ANTHROPIC_API_KEY=...` (see `supabase/functions/ai-chat/README.md`). Until deployed, the command bar returns a friendly "could not reach AI service" message. **Confirm the secret is named `ANTHROPIC_API_KEY`** (update `Deno.env.get` in the function if it differs).
- **Retire the browser-side path:** `src/lib/anthropic.js` (direct browser call via `VITE_ANTHROPIC_API_KEY`) is now superseded by the Edge Function and should not be used. Keep the GitHub `VITE_ANTHROPIC_API_KEY` secret empty; rotate the key if it was ever exposed.
- **Apply migration 003** in Supabase SQL Editor (`supabase/migrations/003_import_logs.sql`) before import logging will work. The import itself succeeds without it; logging fails silently (non-fatal).
- **Test with real Monarch CSV** — dedup logic and parser logic are written but not tested against an actual 12–24 month export.
- **budget_categories seed is per-user** — seeded on first import via `seedDefaultCategories(userId)`.
- Email confirmation setting in Supabase Auth determines whether signup logs in immediately vs. requires an email link.

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
  - `src/lib/dashboard/widgetData.js` — pure derivations (spend by group, run-rate EOY, budget vs. projected, cash-flow spike, commitments summary, wealth summary).
  - `src/lib/db/aiBriefings.js` — `getLatestBriefing` / `saveBriefing` (cached per `module_context`).
  - `src/modules/dashboard/Dashboard.jsx` — all predefined widgets wired to live context; AI Briefing widget (on-demand, cached to `ai_briefings`); configure mode with drag-reorder + show/hide persisted to localStorage.
  - `contextLoader` now also loads current-year `budget_line_items` + budget years; brief + summary expanded accordingly.
- **Phase 10 (mostly complete)** — Onboarding: 5-step flow already live (`src/modules/onboarding/Onboarding.jsx`) — welcome, 3-part priority conversation, data-path choice, CSV upload + baseline, completion → dashboard. Category confirmation handled in `ImportFlow`. Remaining: in-onboarding commitment setup + auto budget-generation step (both available as first-class modules now).

### Known build note (this session)
- Local `vite build` in this sandbox uses **rolldown-vite 8.0.16**, whose tree-shaker drops the entry module's `render()` side effect, producing an app-less bundle (affects the whole repo equally, including previously-shipped modules). Building with `rollupOptions.treeshake: false` produces a correct bundle (all 101 modules + entry present). Source verified correct via ESLint + the treeshake-off build. Did **not** alter the committed `vite.config.js` since this is a sandbox toolchain artifact and production deploys have been working.

### Recommended next session — Phase 11: Polish and Pre-Launch (10-step plan)

Ordered by "what unblocks the most." Steps 1, 2, 10 need Supabase/GitHub
account access; steps 4, 5, 6, 8, 9 are pure code.

**Foundation — make what's built actually work**
1. **Deploy + verify the `ai-chat` Edge Function** and set `ANTHROPIC_API_KEY`
   in Supabase. Every AI feature (command bar, briefing) returns a
   "can't reach service" message until this is live. Highest leverage.
2. **Apply migration `003_import_logs.sql`** in Supabase; confirm import
   logging writes.
3. **Real-data test of the CSV pipeline** — run an actual 12–24 month Monarch
   export through parse → dedup → unmapped-category screen → insert. Validates
   parser, dedup key, and category map together.

**Close the functional wiring gaps**
4. **Wire commitments into Cash Flow Timing** — `schedule.js` helper exists but
   `CashFlow.jsx` doesn't consume it; future commitment spikes don't show on
   the calendar yet (Phase 4/7 gap).
5. **Pull Non-Monthly budget line items into Cash Flow by month** — remaining
   unchecked Phase 4 item; makes the calendar reflect planned outflows, not
   just historical txns.
6. **Wire per-module AI context** — scope the command bar's context to the
   active module so answers match what's on screen.

**Polish + pre-launch**
7. **Mobile QA pass** across all modules at the 760/1100 breakpoints.
8. **Error-handling & empty-state audit** — failed imports, AI errors, no-data
   states in every module.
9. **Security cleanup** — delete the superseded browser-side
   `src/lib/anthropic.js` path, confirm `VITE_ANTHROPIC_API_KEY` is empty,
   rotate the key if ever exposed.
10. **Make the repo public** once the proxy is confirmed, then do a final
    ROADMAP reconciliation pass.

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

**Exit criteria:** App builds and deploys to GitHub Pages. Supabase project live. No product features yet.

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
- [x] Wire command bar to Anthropic API — via secure Supabase Edge Function proxy (`supabase/functions/ai-chat`), not direct browser call
- [x] Build AI context loader (pulls user data from Supabase at session start) — `lib/ai/contextLoader.js`
- [x] Build "Coming Soon" stub page for Mapping module — `mapping/Mapping.jsx`
- [x] Implement dark/light mode toggle — `lib/theme/useTheme.js`, persisted to localStorage

**Exit criteria:** Full navigation works. Dashboard renders. Command bar connects to Anthropic API. All module routes exist. Responsive on mobile and desktop. ✓ (command bar answers live once `ai-chat` is deployed)

---

## Phase 4 — Cash Flow Timing Module
*Goal: First fully functional module. The foundation everything else sits on.*

- [x] Build 12-month rolling cash demand calendar view
- [ ] Pull Non-Monthly budget line items from Supabase by month
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
- [x] Build annual drill-down view (single year from multi-year schedule) — year selector + schedule grid
- [~] Build multi-year budget view (3–5 year horizon) — per-year selectable; side-by-side multi-year roll-up deferred
- [x] Wire Long-Term Commitments into multi-year projection (auto-populate from `commitments` table) — commitment rows rendered in the schedule grid
- [x] Build budget edit/override UI (user can adjust AI-generated targets) — editable draft in generate flow
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
- [~] Wire commitments into Cash Flow Timing (auto-populate as future cash demands) — shared `schedule.js` helper ready; CashFlow consumption is a follow-up
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
  - [x] Monthly spend by group
  - [x] Cash flow spike (next upcoming commitment spike)
  - [x] Budget vs. projected (run-rate) trajectory
  - [x] Run-rate EOY projection
  - [x] Long-Term Commitments summary
  - [x] Wealth Trajectory snapshot
- [x] Build AI Briefing widget (on-demand narrative generation, cached in `ai_briefings` table)
- [x] Build widget add/remove/rearrange functionality (drag-to-configure + show/hide, persisted to localStorage)
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

- [ ] Full mobile QA pass (all modules, all breakpoints)
- [ ] Performance audit (Supabase query optimization, AI context payload size)
- [ ] Error handling audit (failed imports, API errors, empty states)
- [ ] AI response quality review (context prompt tuning)
- [x] API key proxy (shields Anthropic API key — required before any public access) — built in Phase 3 as a **Supabase Edge Function** (`supabase/functions/ai-chat`), not Netlify. Remaining: confirm deployed + secret set in production.
- [ ] Make repo public (after proxy is confirmed working)
- [ ] Final ROADMAP.md update (check off completed phases, note any scope changes)

**Exit criteria:** App is in daily personal use. Repo is public. API key is protected.

---

## Phase 2+ Backlog (Not in V1 Scope)

- Monarch unofficial API connection (live data sync)
- Category Mapping module (full build-out)
- Monte Carlo simulation for Wealth Trajectory
- React Native native mobile app
- Multi-tenant / public user accounts
- Credit card annual fee rewards value analysis
- Remitly / Western Union supplemental transfer data
- Google Sheets sync
- Social Security and tax modeling (Wealth Trajectory expansion)

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

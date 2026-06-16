# AI Capital Planning OS — V1 Roadmap

**Repo:** AI Capital Planning  
**Architecture Reference:** `ARCHITECTURE.md`  
**Build Philosophy:** Schema first, data layer second, UI third. No frontend work before the data model is solid. Each phase produces something usable before the next phase begins.

---

## Phase 0 — Repo and Project Setup
*Goal: Clean foundation before a single line of product code is written.*

- [x] Initialize Vite + React SPA (`npm create vite@latest`)
- [ ] Configure GitHub Pages deployment
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

- [ ] Create `transactions` table with dedup_key unique index
- [ ] Create `budget_categories` table
- [ ] Create `budget_line_items` table
- [ ] Create `scenarios` table
- [ ] Create `scenario_adjustments` table
- [ ] Create `commitments` table with jsonb cost_structure and split_rules
- [ ] Create `wealth_snapshots` table
- [ ] Create `ai_briefings` table
- [ ] Set up Row Level Security (RLS) policies for all tables
- [ ] Seed `budget_categories` table from FY26 budget (46 categories, 11 groups, Fixed/Flexible/Non-Monthly types)
- [ ] Write and test deduplication logic (composite key: date + merchant + amount + account)
- [ ] Verify schema against architecture doc — no gaps, no John-specific hardcoding

**Exit criteria:** All tables live in Supabase. RLS enabled. Budget categories seeded. Dedup logic tested.

---

## Phase 2 — Data Ingestion
*Goal: CSV import pipeline working end-to-end with deduplication.*

- [ ] Build CSV upload component (drag-and-drop + file picker)
- [ ] Build Monarch CSV parser (expected columns: Date, Merchant, Category, Account, Original Statement, Notes, Amount, Tags, Owner)
- [ ] Map Monarch Category → `budget_categories.category` on import
- [ ] Derive Group from category mapping table (not imported directly)
- [ ] Run deduplication check on every import
- [ ] Display import summary: X new transactions added, Y duplicates skipped
- [ ] Handle unmapped categories: surface for user confirmation before inserting
- [ ] Test with real Monarch CSV exports (12-month and 24-month files)
- [ ] Build import history log (what was imported, when, how many rows)

**Exit criteria:** Upload a Monarch CSV, see transactions in Supabase, duplicates correctly skipped, unmapped categories surfaced.

---

## Phase 3 — Dashboard Shell and Navigation
*Goal: The hub is live. Navigation works. No module content yet.*

- [ ] Build persistent collapsible left sidebar (web)
- [ ] Build card-based navigation (mobile)
- [ ] Implement responsive breakpoints (desktop / tablet / mobile)
- [ ] Build route structure for all modules (pages exist, content is placeholder)
- [ ] Build Dashboard canvas (empty widget grid, drag-to-rearrange scaffold)
- [ ] Build AI command bar (persistent, bottom of canvas on desktop)
- [ ] Build FAB + bottom sheet AI input (mobile)
- [ ] Wire command bar to Anthropic API (basic echo test — confirm API connection works)
- [ ] Build AI context loader (pulls user data from Supabase at session start)
- [ ] Build "Coming Soon" stub page for Mapping module
- [ ] Implement dark/light mode toggle (match design system from NGS Navigator)

**Exit criteria:** Full navigation works. Dashboard renders. Command bar connects to Anthropic API. All module routes exist. Responsive on mobile and desktop.

---

## Phase 4 — Cash Flow Timing Module
*Goal: First fully functional module. The foundation everything else sits on.*

- [ ] Build 12-month rolling cash demand calendar view
- [ ] Pull Non-Monthly budget line items from Supabase by month
- [ ] Render month-by-month cash outflow schedule
- [ ] Build upcoming spike alerts (configurable dollar threshold)
- [ ] Build quarter-by-quarter cash flow summary
- [ ] Build category drill-down by month
- [ ] Wire AI command bar context to Cash Flow Timing module
- [ ] Test with real FY26 budget line items (cruises, subscriptions, transfers)

**Exit criteria:** Can open Cash Flow Timing and see when every large/irregular expense hits across the next 12 months.

---

## Phase 5 — Scenario Planner
*Goal: Core decision engine. The primary value proposition.*

- [ ] Build scenario creation flow (name, description, start from baseline)
- [ ] Build scenario adjustment input (category + month + delta amount + label)
- [ ] Implement scenario states: Modeled vs. Committed
- [ ] Build "Promote to Committed" flow with baseline audit record
- [ ] Build view mode toggle: Baseline only / Actual Plan (baseline + committed) / Modeled scenario vs. baseline
- [ ] Build side-by-side scenario comparison view
- [ ] Build assumption sliders for direct manipulation (no AI required)
- [ ] Wire AI command bar to Scenario Planner — AI can create and modify scenarios via conversation
- [ ] Build scenario list view (all modeled and committed scenarios)
- [ ] Test: "What happens if I book a $5,000 cruise in Q3?" → AI creates scenario → renders in canvas

**Exit criteria:** Can create a scenario manually or via AI, promote it to committed, and see baseline vs. actual plan side by side.

---

## Phase 6 — Annual Budget Builder
*Goal: Replace the manual spreadsheet process.*

- [ ] Build AI-guided budget generation session flow
- [ ] Build historical pattern analyzer (ingests 12–24 months of transactions, identifies Fixed/Flexible/Non-Monthly patterns by category)
- [ ] Build conversational timing confirmation flow (AI asks about Non-Monthly items: "Your cruise final payment hit September — same timing next year?")
- [ ] Build month-by-month budget schedule generator (output: `budget_line_items` rows)
- [ ] Build annual drill-down view (single year from multi-year schedule)
- [ ] Build multi-year budget view (3–5 year horizon)
- [ ] Wire Long-Term Commitments into multi-year projection (auto-populate from `commitments` table)
- [ ] Build budget edit/override UI (user can adjust AI-generated targets)
- [ ] Build budget version history (track changes year over year)
- [ ] Test: Full FY27 budget generation from FY25–FY26 transaction history

**Exit criteria:** Can run the AI budget session and produce a complete multi-year month-by-month budget without touching a spreadsheet.

---

## Phase 7 — Long-Term Commitments Module
*Goal: First-class tracking of all financial obligations spanning more than one year.*

- [ ] Build commitment creation form (name, type, start/end date, cost structure, status, notes)
- [ ] Build cost structure input (monthly amount, annual total, or custom schedule via jsonb)
- [ ] Build split rules input (percentage allocation across categories — e.g., 95% mission / 5% family support)
- [ ] Build commitment list view (active, paused, completed)
- [ ] Build commitment detail view (timeline, total projected cost, month-by-month schedule)
- [ ] Wire commitments into Cash Flow Timing (auto-populate as future cash demands)
- [ ] Wire commitments into Annual Budget Builder (auto-populate as Non-Monthly line items)
- [ ] Wire commitments into Scenario Planner (surfaced as baseline constraints)
- [ ] Wire AI command bar to Commitments — AI can add/modify commitments via conversation
- [ ] Seed with existing commitments (Claire scholarship, car lease, etc.)

**Exit criteria:** All active long-term commitments visible with projected cost schedules. Changes to commitments automatically reflected in Cash Flow Timing and Annual Budget.

---

## Phase 8 — Wealth Trajectory Module
*Goal: Long-term wealth and retirement scenario modeling.*

- [ ] Build net worth input form (investment balance, retirement balance, other assets, liabilities)
- [ ] Build wealth snapshot history (track net worth over time)
- [ ] Build baseline trajectory chart (projected net worth over time given current assumptions)
- [ ] Build contribution scenario sliders (contribution rate, market return assumption, retirement target date)
- [ ] Build commitment impact overlay (how long-term commitments affect wealth trajectory)
- [ ] Build bonus allocation scenario ("if I get a $X bonus, where should it go?")
- [ ] Wire AI command bar to Wealth Trajectory — AI can model scenarios via conversation
- [ ] Build retirement horizon view (years to target retirement date, projected balance at retirement)

**Exit criteria:** Can see current wealth trajectory and model the impact of changing contribution rates, market assumptions, or bonus allocation decisions.

---

## Phase 9 — Dashboard Widgets and AI Briefing
*Goal: Dashboard becomes a real control center, not just a navigation hub.*

- [ ] Build and wire all pre-defined widgets to live Supabase data:
  - Monthly spend by group (vs. budget target)
  - Cash flow spike calendar
  - Budget vs. actual trajectory
  - Run-rate EOY projection
  - Long-Term Commitments summary
  - Wealth Trajectory snapshot
- [ ] Build AI Briefing widget (on-demand narrative generation, cached in `ai_briefings` table)
- [ ] Build widget add/remove/rearrange functionality (drag-to-configure)
- [ ] Build AI-generated custom widget save flow (AI creates widget → user saves → renders deterministically)
- [ ] Build widget-level AI context (command bar response scoped to widget in focus)

**Exit criteria:** Dashboard is a fully populated control center. All widgets live. AI Briefing generates and caches. Custom widgets savable.

---

## Phase 10 — Onboarding Flow
*Goal: A new user can get from zero to populated dashboard without help.*

- [ ] Build login / auth screen (Supabase Auth)
- [ ] Build empty state detection (no data → trigger onboarding)
- [ ] Build welcome screen and priority mapping conversation (AI asks 3–5 setup questions)
- [ ] Build CSV upload step with progress indicator
- [ ] Build category confirmation step
- [ ] Build commitment setup step
- [ ] Build first budget generation step (runs Annual Budget Builder automatically)
- [ ] Build onboarding completion → redirect to populated Dashboard
- [ ] Build "Coming Soon" placeholder for Mapping module (accessible from onboarding and Settings)

**Exit criteria:** A new user can complete onboarding end-to-end and land on a populated dashboard.

---

## Phase 11 — Polish and Pre-Launch
*Goal: Production-ready for personal daily use.*

- [ ] Full mobile QA pass (all modules, all breakpoints)
- [ ] Performance audit (Supabase query optimization, AI context payload size)
- [ ] Error handling audit (failed imports, API errors, empty states)
- [ ] AI response quality review (context prompt tuning)
- [ ] Netlify Functions proxy setup (shields Anthropic API key — required before any public access)
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

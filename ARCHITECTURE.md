# AI Capital Planning OS — V1 Architecture Document

**Repo:** AI Capital Planning  
**Description:** A personal capital planning OS. Forward-looking scenario modeling, cash flow timing, and AI-driven decision support built on top of transaction data.  
**Version:** 1.0  
**Status:** V1 built and in daily use. All core modules are live. This document is the founding architecture; implementation notes are inline where behavior diverged from the original design.

---

## 1. Product Vision

This is not a budgeting app. It is not a reporting layer. It is a **forward-looking decision and scenario engine** for sophisticated personal finance users.

The backward-looking reporting problem is already solved — by Monarch Money, YNAB, or any transaction tracking tool the user brings. This app owns everything that comes after: what should I do, what happens if I do it, and when will the money actually move.

**The core thesis:** Every major financial decision is a capital allocation decision. This app gives users an AI-powered interface to reason through those decisions against their actual financial reality — their committed expenses, known future events, long-term obligations, and wealth trajectory — before they make them.

**Target user:** Sophisticated personal finance users who already use a budgeting tool, have 12–24 months of transaction history, think in scenarios and cash flow horizons, and have financial commitments that span multiple years.

---

## 2. Product Philosophy

### What this app does
- Models forward-looking scenarios and their cash flow impact
- Tracks and forecasts long-term commitments (>1 year)
- Generates and maintains multi-year budgets with annual drill-down
- Surfaces cash flow timing — when large or irregular expenses actually hit
- Supports AI-driven decisions via natural language conversation
- Tracks wealth trajectory and retirement scenario modeling

### What this app deliberately does not do
- Replace transaction tracking (Monarch, YNAB, etc. handle this)
- Re-report historical spending (the user's existing tool does this)
- Manage investments or act as a robo-advisor
- Provide licensed financial advice

### Design principle
Assume a sophisticated user. No hand-holding, no beginner guardrails in V1. The product earns its value through depth and intelligence, not simplicity.

---

## 3. Architecture Overview

### 3.1 Two-Layer Interface Model

The app has two coexisting layers:

**Dashboard Layer (deterministic)**
Traditional UI — widgets, sliders, toggles, charts, assumption inputs. Renders directly from Neon. Zero AI token cost. Fast, tactile, always available. The user can interact entirely without invoking the AI.

**AI Layer (conversational)**
The AI acts *on* the dashboard — it doesn't replace it. User asks a question via the command bar; the AI moves levers, surfaces a scenario widget, and delivers a short narrative answer. The dashboard updates to reflect the AI's output. Chat history is accessible but secondary.

These layers are not modes — they coexist. The AI enhances the dashboard; the dashboard gives the AI's output a structured visual home.

### 3.2 Hub-and-Spoke Navigation

The **Dashboard** is the hub — the control center. Each **Module** is a spoke — where the real work happens. The dashboard shows summaries and quick levers; the modules contain the full modeling, analysis, and AI-assisted decision tools.

### 3.3 Platform Architecture

**Current (post Supabase → Neon migration, 2026-07-05):**
- **Frontend:** React 19 on Next.js App Router, responsive at mobile and desktop breakpoints
- **Backend/Database:** Neon (serverless PostgreSQL) via `app/api/**` route handlers — every route does its own `auth.getSession()` check and scopes every query by `user_id` (no RLS layer; the API route is the authorization boundary)
- **Auth:** Neon Auth (Better Auth), session via an httpOnly cookie; `src/lib/neon/authServer.js`/`authClient.js`
- **AI:** Anthropic API (model resolved per-family at request time), proxied through `/api/ai-chat` — the key lives server-side only, never shipped to the browser
- **Deployment:** Vercel (production + branch previews); `main` merged and set as Vercel's Production-tracked branch (2026-07-05) — auto-deploys on every push
- **GitHub Pages — retired (2026-07-05):** `.github/workflows/deploy.yml` (the old Vite+Supabase static build/deploy pipeline) has been deleted now that `main` is fully on the Neon/Vercel stack. The last successful Pages build stays published as a frozen snapshot (deleting the workflow doesn't take down existing Pages content), but nothing will deploy there again. GitHub itself remains the source-control repo throughout — only the old static-hosting pipeline is gone.
- **Remaining fallback:** the Supabase project itself is still live (not paused/deleted) as a final, deliberately temporary safety net — see `MIGRATION_PLAN.md` Phase D.
- **Future:** React Native native app (planned migration, not V1 scope)

---

## 4. Module Map

### 4.1 Dashboard (Hub)
The default landing screen after login. Widget canvas with drag-to-rearrange configurability. Persistent collapsible left sidebar for navigation on web; card-based navigation on mobile.

**Widgets built and live:**
- Monthly Budget vs. Actuals bar chart (12 months, actuals + forecast, TODAY marker, on-target threshold control)
- Income vs. Expenses 12-month chart (post-tax income forecast, actuals for past months, forecast bars for future)
- Spend by Group drill-down (vs. budget target, expandable per group)
- Budget vs. Actual (BvA) KPI summary widget
- Long-Term Commitments summary
- Wealth Trajectory snapshot
- AI Briefing card (on-demand narrative, cached, single token cost per refresh)
- Net Worth snapshot

**Layout configurability:** Drag-to-reorder, show/hide per card, collapse/expand per card (chevron in each card header), global Collapse All / Expand All. All layout state persisted to localStorage.

**AI-generated widgets:** Savable as custom widgets. Generated once (one token cost), then rendered deterministically from Neon like any pre-defined widget.

**Command Bar:** Persistent, context-aware input that follows the user across all modules. On desktop: bottom-of-canvas input bar. On mobile: floating action button (FAB) that expands to a bottom sheet. AI responses manifest as widgets or cards in the canvas — not as a separate chat screen.

### 4.2 Cash Flow Timing
Month-by-month view of when money actually moves. Surfaces large and irregular expenses before they arrive. Powered entirely by the Non-Monthly commitment structure in Neon — no AI required to render.

Key views:
- 12-month rolling cash demand calendar
- Upcoming spike alerts (configurable threshold)
- Quarter-by-quarter cash flow summary
- Category drill-down by month

### 4.3 Scenario Planner
The core decision engine. Where the user goes to answer "what happens if" questions.

**Scenario states:**
- **Modeled:** Exploratory. Does not affect baseline or other scenarios.
- **Committed:** Promoted to ground truth. Layers on top of baseline. Both baseline and committed view always accessible for audit.

**Navigation model** *(updated 2026-06-23):* Sidebar is the primary nav. Top of sidebar has fixed Baseline and Actual Plan items; below is the scrollable scenario list with an inline `+` to add a scenario. There is no top-of-canvas toggle; the sidebar is always visible on desktop.

**Baseline panel:** Past months render actual transaction spending (gray bars); current and future months render the budget/forecast plan (accent bars). Category group breakdown shows dual-segment progress bars (actuals vs. budget).

**Actual Plan view:** Lists all committed scenarios as summary cards — name, commit date, net delta chip, adjustment count, and a link to view details. Provides an audit trail of what decisions have been locked in against the baseline.

**ScenarioDetail tabs (3):**
- **Adjustments:** Period-grouped table with colored badge chips (green savings / red increases), hover-reveal delete, net total row.
- **Forecast Impact:** 12-month side-by-side bar chart (baseline vs. with-scenario); hover tooltips; annual summary stats. Pulls from `forecastLineItems` + `budgetLineItems` in context.
- **Baseline Comparison:** SVG grouped bars per period, delta chips, hover tooltips.

**AI Scenario Composer:** Full conversation history maintained across sends. User messages right-aligned, AI responses with ✦ icon. CLEAR button resets thread. The AI reads the full scenario state and can propose adjustments directly.

**Dashboard integration** *(added 2026-06-23):* `monthlyBudgetVsActual()` in `widgetData.js` accepts a `scenarioFilter` param (`'all'` | `'baseline'` | scenario id) and folds committed scenario adjustment deltas into future forecast months. `BudgetActualsChart` exposes an interactive `ScenarioDropdown` chip that lets the user switch between Baseline, All Committed, or a single scenario view without leaving the dashboard.

**Commit → Forecast → Bill Planner flow** *(added 2026-07-10):* Committing a scenario (`PATCH /api/scenarios/[id]` with `state: 'committed'`) writes its `scenario_adjustments` into `forecast_line_items` as new rows tagged with `source_scenario_id` and `source: 'scenario'`, atomically alongside the state change. Since Bill Planner (`app/api/bills/forecast-amounts`) and every other forecast consumer read `forecast_line_items` directly, the commit's impact reaches them automatically — no separate "layer" toggle needed. Reverting a scenario out of `committed` (or deleting it) deletes its tagged rows in the same transaction, cleanly reverting the forecast. `AppShell` still receives `onGoToForecast` so the user can jump to the Forecast module after committing, and `reloadSignal` still triggers a fresh Forecast data load — but that reload now shows real, persisted numbers rather than a client-side overlay. Forecast's old "Committed Scenarios ▾" picker was removed for the same reason (it would double-count amounts already baked into the base forecast); the "Modeled ▾" picker is unchanged since modeled scenarios stay exploratory-only.

**Deduplication:** Scenarios are versioned. Promoting a scenario to committed creates an audit record of the prior baseline state.

### 4.4 Annual Budget Builder (Multi-Year)
Replaces the manual spreadsheet process. AI-guided session that generates the month-by-month cash flow schedule from historical transaction data and user-confirmed commitments.

**Build flow:**
1. AI ingests last 12–24 months of transaction history from Neon
2. AI identifies recurring patterns by category and type (Fixed, Flexible, Non-Monthly)
3. AI surfaces non-monthly items and asks timing questions conversationally: "Your cruise final payment hit September last year — is that timing the same for next year?"
4. User confirms, adjusts, or overrides through conversation or direct input
5. App generates the full multi-year month-by-month budget schedule
6. User can drill into any single year for annual view

**Upload Budget (alternative entry path):**
The user can also upload an existing `.xlsx` or `.csv` budget file to seed the budget without AI generation. The workbook parser (`src/lib/csv/budgetParser.js`) supports multi-sheet workbooks where the main sheet contains the category→group→type→target mapping and sibling sheets are detail tabs (one per Non-Monthly or otherwise detailed category) with a Period 1–12 monthly grid.

Key behaviors:
- **Header detection** is flexible: case-insensitive, punctuation-insensitive, scans the first 25 rows (title/blank rows above the table are ignored).
- **Detail tab matching**: any sheet with a Period 1–12 row is recognized as a detail tab. The parser uses exact normalized-name matching first, then fuzzy Levenshtein ≥ 0.8 as a fallback. Tabs are matched against *all* category types (Fixed, Flexible, Non-Monthly), not just Non-Monthly.
- **Line-level detail**: `extractLineItemsFromDetail()` pulls individual named rows from each detail tab (e.g. "Delta Flight - Philippines Luggage") and stores them as `budget_line_items` rows with a `label` field, enabling sub-row drill-down in the schedule grid.
- **Tab Match Review**: a confirmation dialog shows every category that was auto-matched to a detail tab (regardless of type), plus all Non-Monthly categories that may need a tab assigned. Fixed/Flexible entries are shown with a type badge so the user can confirm or reassign before saving.

**Budget types (inherited from transaction data):**
- **Fixed:** Same amount, same cadence (rent, car payment, gym)
- **Flexible:** Variable amount, recurring category (groceries, dining, shopping)
- **Non-Monthly:** Irregular timing, known annual total (cruises, annual fees, scholarship transfers)

**Multi-year handling:** Long-Term Commitments with defined timespans automatically feed into the multi-year projection. The AI flags years where commitment profiles change (e.g., a scholarship ending, a lease expiring).

### 4.5 Long-Term Commitments
First-class module for any financial obligation spanning more than one year.

**Commitment structure (per record):**
- Custom name (user-defined)
- Category / commitment type
- Start date and end date (or open-ended)
- Cost structure (monthly, annual, irregular schedule)
- Status (Active, Paused, Completed)
- Notes / context

**Examples of commitment types:**
- Scholarship or education support (multi-year, per-person)
- Family financial support (recurring international transfers)
- Vehicle lease (fixed term, known payment)
- Eldercare or dependent support
- Charitable giving pledge

**Integration:** Commitments feed directly into the Annual Budget Builder (as Non-Monthly line items), the Cash Flow Timing module (as future cash demands), and the Scenario Planner (as baseline constraints the AI reasons against).

**Default split assumption (configurable):** For transfer-type commitments with mixed purposes, the user can define a percentage split across categories (e.g., 95% mission-related, 5% family support). Overridable per commitment.

### 4.6 Wealth Trajectory
Retirement and long-term wealth modeling. Answers "where is my overall financial life heading?"

**Core features:**
- Net worth baseline (manually entered or imported)
- Investment contribution scenario modeling (contribution rate sliders, market return assumptions)
- Retirement horizon modeling (target date, withdrawal rate)
- Impact of long-term commitments on wealth trajectory
- "What if" scenarios: bonus allocation, early retirement, increased giving

**Note:** This module does not manage investments or provide licensed advice. It models trajectories based on user-supplied assumptions.

**V1 scope:** Core trajectory view + contribution scenario sliders. Monte Carlo simulation is a Phase 2 feature.

### 4.7 Settings / Data Management
- Transaction data import (CSV upload, Monarch-first parser, extensible to other formats)
- Deduplication logic (composite key: date + merchant + amount + account)
- Category mapping review and confirmation
- Budget category structure management
- User preferences and assumption defaults
- API key management (Anthropic)

### 4.8 Mapping Module (Stub)
Navigation entry point exists in sidebar. Clicking opens a "Coming Soon" page. UI real estate and navigation path reserved for Phase 2 build-out.

---

## 5. Data Architecture

*Schema originated on Supabase and was ported table-for-table to Neon during
the 2026-07 migration (see §3.3, `MIGRATION_PLAN.md`) — every table/column
below is current on Neon; only the hosting/auth provider changed. FK
`ON DELETE` behavior (CASCADE/SET NULL) is enforced at the application layer
in `app/api/**` route handlers rather than the database, since the Phase B0
schema recreation didn't carry those rules over 1:1.*

### 5.1 Neon Schema (Core Tables)

**transactions**
```
id                  uuid PRIMARY KEY
date                date
merchant            text
category            text
group               text
account             text
amount              numeric
original_statement  text
notes               text
owner               text
import_source       text
dedup_key           text UNIQUE  -- date + merchant + amount + account (composite)
created_at          timestamptz
```

**budget_categories**
```
id              uuid PRIMARY KEY
category        text UNIQUE
group           text
type            text  -- 'Fixed' | 'Flexible' | 'Non-Monthly'
monthly_target  numeric
annual_target   numeric
is_active       boolean
created_at      timestamptz
```

**budget_line_items**
```
id              uuid PRIMARY KEY
budget_year     integer
budget_version  text  -- supports multi-year
category_id     uuid REFERENCES budget_categories
month           integer  -- 1-12
amount          numeric
label           text  -- e.g. "Celebrity Cruise - Final Payment"
commitment_id   uuid REFERENCES commitments (nullable)
created_at      timestamptz
```

**scenarios**
```
id              uuid PRIMARY KEY
name            text
description     text
state           text  -- 'modeled' | 'committed'
created_at      timestamptz
committed_at    timestamptz (nullable)
parent_baseline uuid REFERENCES scenarios (nullable)  -- audit trail
```

**scenario_adjustments**
```
id              uuid PRIMARY KEY
scenario_id     uuid REFERENCES scenarios
category_id     uuid REFERENCES budget_categories
month           integer
year            integer
delta_amount    numeric  -- adjustment vs. baseline
label           text
created_at      timestamptz
```

**commitments**
```
id              uuid PRIMARY KEY
name            text  -- user-defined
type            text  -- 'scholarship' | 'family_support' | 'lease' | 'other'
start_date      date
end_date        date (nullable)  -- null = open-ended
status          text  -- 'active' | 'paused' | 'completed'
cost_structure  jsonb  -- flexible: monthly amount, annual total, or schedule
split_rules     jsonb  -- e.g. {"mission": 0.95, "family_support": 0.05}
notes           text
created_at      timestamptz
```

**wealth_snapshots**
```
id              uuid PRIMARY KEY
snapshot_date   date
net_worth       numeric
investment_balance numeric
retirement_balance numeric
other_assets    numeric
liabilities     numeric
notes           text
created_at      timestamptz
```

**ai_briefings**
```
id              uuid PRIMARY KEY
generated_at    timestamptz
context_summary text  -- what data was used
narrative       text  -- the AI-generated briefing
module_context  text  -- which module generated it
is_cached       boolean
```

**user_profiles** *(added during V1 build)*
```
id                  uuid PRIMARY KEY REFERENCES auth.users
salary              numeric         -- annual gross salary
bonus               numeric         -- annual bonus amount
bonus_month         integer         -- 1-12, month bonus is received
benefits_amount     numeric         -- monthly benefits deduction ($ or %)
benefits_is_pct     boolean         -- true = benefits_amount is a percent of salary
k401_pct            numeric         -- 401k contribution % of gross
bonus_also_subject  boolean         -- whether 401k/benefits apply in bonus month too
created_at          timestamptz
updated_at          timestamptz
```

### 5.1.1 Recovered Tables (existed live only, never committed)

Discovered during Supabase → Neon migration assessment (2026-07-04): 5 tables were created directly in the Supabase SQL editor and queried by the app, but never had a `CREATE TABLE` in any committed migration — only later `ALTER TABLE` statements referenced them. Recovered from live introspection and committed as `db/migrations/015_recover_undocumented_tables.sql`. Live row counts as of the audit noted in parens.

**accounts** (6 rows) — bank/investment accounts (`checking` | `savings` | `investment` | `other`), one flagged `is_primary_checking`.

**bills** (20 rows) — recurring bills (`credit_card` | `loan` | `rent` | `investment` | `subscription` | `other`), due/pay day, optional fixed amount, links to `accounts` (debit/auto-fund), `budget_categories` (forecast), `credit_cards`, and an `actuals_category` linking historical actuals to a spend category.

**bill_amounts** (77 rows) — per-bill, per-month actual/planned amount overrides.

**account_balances** (10 rows) — per-account balance snapshots, twice-monthly (`period_half` 1 or 2).

**forecast_overrides** (0 rows) — per-category, per-month manual overrides of the forecast.

All five carry `user_id → auth.users(id)` and the same `for all using (user_id = auth.uid())` RLS policy as every other table — no exception to the ownership pattern documented in §5.1.

### 5.2 AI Context Strategy

At session start, the app automatically loads the following from Neon into the AI's context window:

- Trailing 12 months of transactions (summary level, not full row detail) — a full annual cycle so the AI captures seasonality and annual bills rather than anchoring to a rolling quarter
- Full budget_categories table (targets and types)
- Current year budget_line_items (month-by-month schedule)
- All active commitments with cost structures
- Current committed scenario (if any)
- Most recent wealth snapshot
- Any open modeled scenarios
- AI personalization preferences (from `ai_preferences`) — rendered into the brief as explicit "how to brief this user" guidance the AI honors

This gives the AI enough context to answer any decision question without requiring the user to re-explain their financial situation each session. The context is structured, not a raw data dump — it's formatted as a financial brief the AI can reason against immediately.

**Current-year income/expense projection in context** *(added 2026-06-23):* `buildContextBrief` now computes the same current-year projection as the Income vs. Expenses dashboard widget: YTD actuals from `yearTxns` (Jan–Dec, current year) + salary/budget forecast for remaining months via `incomeVsExpenses()`. This ensures AI briefings quote the same income and expense figures the user sees on screen. The command bar path still uses `ctx.transactions` (trailing 365 days); this is a known gap to resolve.

**yearTxns threading** *(added 2026-06-23):* The dashboard `BriefingWidget` now passes `yearTxns` (the same fresh Jan–Dec slice the widgets use) into `sendAIMessage` → `buildContextBrief`, bypassing `ctx.transactions` which is loaded once at session start and subject to a 1,000-row default limit on the trailing-365-day window.

**Query pagination (1,000-row default limit)** *(added 2026-06-23):* All DB helper functions that could realistically return >1000 rows now use a `.range()`-based pagination loop. The original backend's 1,000-row default limit was silent (no error, no warning) — it simply returned a truncated result set. Affected functions: `getRecentTransactions`, `getTransactionsByMonth`, `getTransactionsForYear`, `getDistinctTransactionAccounts`, `getIncomeTransactions`, `getBudgetLineItems`, `getBudgetYears`, `getBillAmountsForBill`, `getBillAmountsRange`. Low-volume tables (categories, commitments, scenarios, snapshots, etc.) are left with default limits.

#### 5.2.1 AI Prompt Stack

All AI calls are assembled from four layers in this order:

1. **Main persona** (`sendMessage.js` → `SYSTEM_PROMPT`) — the assistant's core identity, reasoning style, clarification rules, and financial domain instructions. Appended to every single AI call.

2. **Context brief** (`contextLoader.js` → `buildContextBrief()`) — the user's live financial picture: transactions, budget targets, commitments, scenarios, salary profile. Regenerated per call from Neon data.

3. **systemExtra** (`*.prompts.js` files) — call-specific instructions appended for a given agent or capability. Examples: category name hints for `create_scenario`, existing-adjustment context for `add_adjustment`, phase instructions for the Grill Session interview.

4. **Tool schemas** (`scenarioAgent.js`) — Anthropic tool definitions (`CREATE_SCENARIO_TOOL`, `ADD_ADJUSTMENT_TOOL`). Tool descriptions are part of the prompt in Anthropic's API.

**Source file convention:**
- `src/lib/ai/sendMessage.js` — main persona (layer 1)
- `src/lib/ai/contextLoader.js` — context brief (layer 2)
- `src/lib/ai/*.prompts.js` — systemExtra builders (layer 3) — one file per agent/capability
- `src/lib/ai/parserBase.js` — shared system prompt builder and utilities for the parser family
- Parser-specific SYSTEM strings are built with `parserSystem(task)` from `parserBase.js`

When debugging unexpected AI behavior, check the layers in order: is the persona correct? Is the context data fresh? Is systemExtra providing the right framing? Are tool descriptions accurate?

### 5.3 Deduplication Logic

On every CSV import, a `dedup_key` is generated per row:
```
dedup_key = date + "|" + merchant.toLowerCase() + "|" + amount + "|" + account
```
If the key already exists in the `transactions` table, the row is skipped. Import summary shows new rows added vs. duplicates skipped.

---

## 6. Data Ingestion

### 6.1 Import Flow (V1)
1. User uploads CSV via Settings / Data Management
2. Parser detects format (Monarch-first; extensible)
3. Deduplication check runs against existing transactions
4. New rows are inserted; duplicates are logged and skipped
5. User sees import summary: X new transactions, Y duplicates skipped
6. Category mapping confirmation step (if unmapped categories detected)

### 6.2 Monarch CSV Parser (V1)
Expected columns: `Date`, `Merchant`, `Category`, `Account`, `Original Statement`, `Notes`, `Amount`, `Tags`, `Owner`

The parser maps Monarch's Category directly to `budget_categories.category`. Group is derived from the category mapping table, not imported directly (since Monarch exports both but our source of truth is the app's category table).

### 6.3 History Requirement
- **Minimum:** 12 months of transaction history for baseline budget generation
- **Ideal:** 24 months to distinguish annual patterns from one-time events
- **Cap:** 24 months requested on onboarding; older data can be imported but is archived rather than used for active modeling

---

## 7. Onboarding Flow

1. **Login** (auth via Neon Auth)
2. **Welcome screen** — app detects no data, surfaces greeting
3. **Priority mapping** — AI asks 3–5 questions to understand the user's financial priorities and commitment types
4. **CSV upload** — user uploads 12–24 months of transaction history
5. **Category confirmation** — app maps imported categories to its budget structure; user confirms or adjusts
6. **Commitment setup** — user adds any long-term commitments (>1 year) the transaction history won't capture
7. **First budget generation** — AI runs the Annual Budget Builder to generate a baseline Year 1 budget from the imported history
8. **Dashboard** — user lands on their populated home screen

---

## 8. UI Structure

### 8.1 Navigation
- **Web:** Persistent collapsible left sidebar
- **Mobile:** Card-based module navigation (bottom or home screen)
- **Sidebar items:** Dashboard, Cash Flow Timing, Scenario Planner, Annual Budget Builder, Long-Term Commitments, Wealth Trajectory, Settings, Mapping (Coming Soon)

### 8.2 AI Command Bar
- **Web:** Persistent input bar at bottom of canvas, follows user across all modules
- **Mobile:** Floating action button (FAB), expands to bottom sheet
- **Context-aware:** Knows which module is active; AI responses are scoped to that module's data
- **Output:** AI responses manifest as widgets or cards in the current canvas view — not as a standalone chat screen

### 8.3 Responsive Breakpoints
- Desktop: full sidebar + widget canvas
- Tablet: collapsible sidebar + simplified canvas
- Mobile: card navigation + FAB command bar

---

## 9. What's Deferred (Phase 2+)

- Monarch unofficial API connection (live data sync)
- Category Mapping module (full build-out)
- Monte Carlo simulation for Wealth Trajectory
- Multi-user / public deployment
- React Native native mobile app
- Credit card annual fee rewards value analysis
- Remitly / Western Union supplemental transfer data
- Google Sheets sync
- True multi-tenant architecture with Netlify Functions API proxy

---

## 10. Implementation Notes (V1 Divergences & Additions)

The founding architecture held. These are the notable implementation details that weren't pinned at design time:

**Income modeling added.** `user_profiles` table stores salary, bonus, bonus month, benefits, and 401k% so the Income vs. Expenses chart can show a post-tax take-home forecast (effective tax rate derived from trailing 12-month transaction data).

**Settings module expanded.** Beyond CSV import and category mapping, Settings now includes a Planning tab (salary, bonus, 401k, benefits inputs with live take-home readout), an AI Preferences tab (briefing persona and communication style), and a Budget tab (variance threshold).

**Collapse/expand on all cards.** The dashboard widget canvas gained per-card collapse (chevron in each card's own header) plus global Collapse All / Expand All. State is stored in the `layout` object in localStorage alongside `order` and `hidden`.

**Error boundary not yet added.** A missing component definition caused a blank-page incident (June 2026). Adding a React error boundary around `<AppShell>` is the highest-priority hardening item. A missing component produces a `ReferenceError` that crashes the full React tree with no recovery path — blank page with no console access for users.

**Model version deliberately not pinned.** `resolveModel` (`app/api/ai-chat/route.js`) resolves each call to the newest model within a named family (`sonnet` / `haiku`), re-checked every 6 hours — the family is the pinned choice, not the version. This is intentional: the app always runs on the latest release Anthropic ships for that family, no manual upgrade step required.

**Budget schedule grid matches forecast grid.** `ScheduleGrid` now mirrors `ForecastGrid` in layout: sticky column and row headers, scrollable max-height, groups expanded by default with a collapse toggle, per-category drill-down toggle (▸) that expands into individual named sub-rows (↳) at 54px indent. Sub-rows come from `budget_line_items` rows whose `label` field is populated (either from the Upload Budget xlsx parser or from commitment names).

**Known hardening backlog** (in order of leverage):
1. Add Vitest + unit tests for pure modeling functions
2. Add React error boundary
3. Strengthen CI (lint + tests, not just build)
4. Preview-before-write for AI scenario creation
5. Move currency math to integer cents
6. Surface errors instead of swallowing them

---

*Document generated from architecture grill session. All major decisions held through V1. Build sequence executed as planned: schema → import/dedup → Dashboard shell → Cash Flow Timing → Scenario Planner → Budget Builder → Commitments → Wealth Trajectory → onboarding polish.*

# AI Capital Planning OS — V1 Architecture Document

**Repo:** AI Capital Planning  
**Description:** A personal capital planning OS. Forward-looking scenario modeling, cash flow timing, and AI-driven decision support built on top of transaction data.  
**Version:** 1.0  
**Status:** Pre-build. Founding architecture document.

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
Traditional UI — widgets, sliders, toggles, charts, assumption inputs. Renders directly from Supabase. Zero AI token cost. Fast, tactile, always available. The user can interact entirely without invoking the AI.

**AI Layer (conversational)**
The AI acts *on* the dashboard — it doesn't replace it. User asks a question via the command bar; the AI moves levers, surfaces a scenario widget, and delivers a short narrative answer. The dashboard updates to reflect the AI's output. Chat history is accessible but secondary.

These layers are not modes — they coexist. The AI enhances the dashboard; the dashboard gives the AI's output a structured visual home.

### 3.2 Hub-and-Spoke Navigation

The **Dashboard** is the hub — the control center. Each **Module** is a spoke — where the real work happens. The dashboard shows summaries and quick levers; the modules contain the full modeling, analysis, and AI-assisted decision tools.

### 3.3 Platform Architecture

- **Frontend:** React SPA (Vite), responsive at mobile and desktop breakpoints
- **Backend/Database:** Supabase (PostgreSQL)
- **AI:** Anthropic API (Claude Sonnet), context loaded from Supabase at session start
- **Deployment:** GitHub Pages (V1 personal use); Netlify Functions proxy added before any public deployment to shield API key
- **Future:** React Native native app (planned migration, not V1 scope)

---

## 4. Module Map

### 4.1 Dashboard (Hub)
The default landing screen after login. Widget canvas with drag-to-rearrange configurability. Persistent collapsible left sidebar for navigation on web; card-based navigation on mobile.

**Pre-defined widgets (forward-looking, deterministic):**
- Monthly spend by group (vs. budget target)
- Cash flow spike calendar (upcoming large/irregular expenses)
- Budget vs. actual trajectory (YTD + projected EOY)
- Run-rate EOY projection
- Long-Term Commitments summary
- Wealth Trajectory snapshot
- AI Briefing card (on-demand narrative, cached, single token cost per refresh)

**AI-generated widgets:** Savable as custom widgets. Generated once (one token cost), then rendered deterministically from Supabase like any pre-defined widget.

**Command Bar:** Persistent, context-aware input that follows the user across all modules. On desktop: bottom-of-canvas input bar. On mobile: floating action button (FAB) that expands to a bottom sheet. AI responses manifest as widgets or cards in the canvas — not as a separate chat screen.

### 4.2 Cash Flow Timing
Month-by-month view of when money actually moves. Surfaces large and irregular expenses before they arrive. Powered entirely by the Non-Monthly commitment structure in Supabase — no AI required to render.

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

**View modes:**
- Baseline only
- Baseline + committed (labeled "Actual Plan")
- Any modeled scenario vs. baseline
- Side-by-side scenario comparison

**Interaction:** Levers and sliders for direct manipulation. AI command bar for complex or multi-variable scenarios. AI can drive the levers; user can also move them manually without invoking AI.

**Deduplication:** Scenarios are versioned. Promoting a scenario to committed creates an audit record of the prior baseline state.

### 4.4 Annual Budget Builder (Multi-Year)
Replaces the manual spreadsheet process. AI-guided session that generates the month-by-month cash flow schedule from historical transaction data and user-confirmed commitments.

**Build flow:**
1. AI ingests last 12–24 months of transaction history from Supabase
2. AI identifies recurring patterns by category and type (Fixed, Flexible, Non-Monthly)
3. AI surfaces non-monthly items and asks timing questions conversationally: "Your cruise final payment hit September last year — is that timing the same for next year?"
4. User confirms, adjusts, or overrides through conversation or direct input
5. App generates the full multi-year month-by-month budget schedule
6. User can drill into any single year for annual view

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

### 5.1 Supabase Schema (Core Tables)

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

### 5.2 AI Context Strategy

At session start, the app automatically loads the following from Supabase into the AI's context window:

- Last 90 days of transactions (summary level, not full row detail)
- Full budget_categories table (targets and types)
- Current year budget_line_items (month-by-month schedule)
- All active commitments with cost structures
- Current committed scenario (if any)
- Most recent wealth snapshot
- Any open modeled scenarios

This gives the AI enough context to answer any decision question without requiring the user to re-explain their financial situation each session. The context is structured, not a raw data dump — it's formatted as a financial brief the AI can reason against immediately.

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

1. **Login** (auth via Supabase)
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

## 10. Open Items Before Build

1. Confirm Supabase project setup (new project or existing)
2. Confirm whether to archive or repurpose V0 repo
3. Verify current Anthropic model string for API calls
4. Define the exact widget inventory for the Dashboard (deferred to build phase)
5. Define Wealth Trajectory input fields for V1 (net worth components)

---

*Document generated from architecture grill session. All major decisions locked. Build sequence: Supabase schema → data import + deduplication → Dashboard shell + navigation → Cash Flow Timing → Scenario Planner → Annual Budget Builder → Long-Term Commitments → Wealth Trajectory → Onboarding flow.*

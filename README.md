# AI Capital Planning

A personal capital planning OS — forward-looking scenario modeling, cash flow timing, and AI-driven decision support built on top of transaction data.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full product vision and data model.  
See [`ROADMAP.md`](./ROADMAP.md) for the phase-by-phase build plan.

## Stack

- **Frontend:** React 19 + Vite (this repo)
- **Database:** Supabase (PostgreSQL)
- **AI:** Anthropic API (`claude-sonnet-4-6`)
- **Deployment:** GitHub Pages (personal use); Netlify Functions proxy before any public deployment

## Setup

```bash
cp .env.example .env
# Fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_ANTHROPIC_API_KEY

npm install
npm run dev
```

## Current Phase

**Phase 11 — Polish and Pre-Launch.** All V1 modules are built and in daily use. The dashboard is a fully populated control center with live data widgets, a monthly budget vs. actuals chart, income vs. expenses forecast, spend-by-group drill-down, AI briefing, and drag/collapse/show-hide layout configurability.

Recent work completed this session:
- Post-tax income forecast (salary ÷ 12 + bonus month, minus estimated taxes, benefits, 401k) wired into the Income vs. Expenses chart
- Settings expanded with bonus month selector, benefits ($ or %), 401k %, on-bonus toggle, and live take-home readout
- Income vs. Expenses chart redesigned to show all 12 months (actuals for past, forecast bars for future) with TODAY marker and full-year KPIs
- Collapse/expand toggle on every dashboard card (per-card chevron + global Collapse All / Expand All button), persisted to localStorage

## Hardening priorities

This is an AI-first forecasting tool, so it carries the complexity of financial
modeling *and* an AI layer on top. The foundations are sound (deterministic
modeling engine + AI as the intent/translation layer + Supabase/RLS), but the
following are the priorities to take it from "impressive prototype" to a robust,
trustworthy build. Roughly in order of leverage:

1. **Test the modeling math.** No test runner exists yet (`package.json` has only
   build/lint). Add Vitest and unit-test the pure functions that decide money —
   `lib/dashboard/widgetData`, `lib/commitments/schedule`, `lib/wealth/projection`,
   `lib/budget/patternAnalyzer`, scenario deltas, and CSV dedup. Highest-leverage
   step from "looks right" to "provably right."
2. **Add an error boundary.** The app has no React error boundary — any unhandled
   render error produces a blank page with no recovery path. Wrap `<App>` or
   `<AppShell>` in an `<ErrorBoundary>` that shows a fallback UI. (A missing
   component definition caused a blank-page incident in June 2026.)
3. **Strengthen CI gates.** CI currently runs only `npm run build`. Make it run
   lint + tests, and clear the existing repo-wide lint failures
   (`react-hooks/set-state-in-effect`, unused vars) so regressions actually block.
4. **Preview-before-write for AI mutations.** `create_scenario` commits to the DB
   immediately and relies on fuzzy category matching. The AI's computed deltas and
   category mapping should land in a preview the user approves before persisting,
   and creation should be idempotent (a retried tool loop must not double-create).
5. **Money precision.** Currency is JS floats with `Math.round` scattered across
   modules; over many months/categories this drifts. Move to integer cents or a
   single rounding seam.
6. **Pin the AI model.** `resolveModel` always floats to the newest model. For a
   financial product that's a silent behavior-change risk (tool-use / JSON output
   can shift) — pin and upgrade deliberately, spot-checking tool calls and
   `suggestBuckets` JSON after each bump.
7. **Stop swallowing errors.** Many `.catch(() => [])` hide failures; finance
   needs surfaced errors plus basic telemetry/observability.
8. **Data-source consistency.** The dashboard chart fetches full-year transactions
   separately from the trailing-12-month AI context, and Monarch↔CSV dedup leans on
   merchant/account strings matching. Nail down these correctness edges.

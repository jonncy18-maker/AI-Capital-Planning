# AI Capital Planning

A personal capital planning OS — forward-looking scenario modeling, cash flow timing, and AI-driven decision support built on top of transaction data.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full product vision and data model.  
See [`ROADMAP.md`](./ROADMAP.md) for the phase-by-phase build plan.

## Stack

- **Frontend:** React + Vite (this repo)
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
2. **Strengthen CI gates.** CI currently runs only `npm run build`. Make it run
   lint + tests, and clear the existing repo-wide lint failures
   (`react-hooks/set-state-in-effect`, unused vars) so regressions actually block.
3. **Preview-before-write for AI mutations.** `create_scenario` commits to the DB
   immediately and relies on fuzzy category matching. The AI's computed deltas and
   category mapping should land in a preview the user approves before persisting,
   and creation should be idempotent (a retried tool loop must not double-create).
4. **Money precision.** Currency is JS floats with `Math.round` scattered across
   modules; over many months/categories this drifts. Move to integer cents or a
   single rounding seam.
5. **Pin the AI model.** `resolveModel` always floats to the newest model. For a
   financial product that's a silent behavior-change risk (tool-use / JSON output
   can shift) — pin and upgrade deliberately, spot-checking tool calls and
   `suggestBuckets` JSON after each bump.
6. **Stop swallowing errors.** Many `.catch(() => [])` hide failures; finance
   needs surfaced errors plus basic telemetry/observability.
7. **Data-source consistency.** The dashboard chart fetches full-year transactions
   separately from the 90-day AI context, and Monarch↔CSV dedup leans on
   merchant/account strings matching. Nail down these correctness edges.

## Current Phase

**Phase 0 complete.** Phase 1 next: Supabase schema.

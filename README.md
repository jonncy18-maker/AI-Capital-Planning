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

## Current Phase

**Phase 0 complete.** Phase 1 next: Supabase schema.

# Stack Blueprint

*Canonical source: `NextGen-Immersion` (gold-standard structure as of Phase 14/2026-07-04). Copy this file verbatim into any project's repo root and keep it in sync manually — there is no shared package linking these repos, so "sync" means re-copy when the canonical copy changes materially.*

## How to use this document

This file has two jobs. Use the mode that matches what you're doing:

- **Scaffolding a new project** — copy the section skeleton in Part 1 into the new project's `CLAUDE.md`, filling in every `<placeholder>`. Adopt the reference patterns in Part 2 verbatim unless the new project's stack genuinely forces a different choice — if it does, write down *why* it diverges, right there in the CLAUDE.md, so the next session doesn't "fix" it back.
- **Cleaning up an existing project's `CLAUDE.md`** — run the Part 3 checklist against it. The goal is a `CLAUDE.md` that reads like NGS-Immersion's: a living reference someone (or some future Claude session) can act on immediately, with history moved out to `ROADMAP.md` where it belongs.

A `CLAUDE.md` that matches this shape should need no re-reading of the whole file to answer "where do secrets live" or "what's the one gotcha that bit us before" — those answers should be in one place each, not spread across a migration narrative.

---

## Part 1 — Section Skeleton

Use this order. Skip a section only if it's genuinely not applicable (e.g. no Routes table for a single-page app) — don't reorder.

### 1. Header
One-line description of what the project is and who it's for. Then bullets: repo name, live URL(s), stack one-liner, any recent cutover date worth flagging.

### 2. Stack
A single code-block table — framework, frontend, routing, styling, database, auth, hosting, language, formatting. If the stack changed recently (a migration), add one short "stack history" paragraph directly under the table — one paragraph, not a changelog. The changelog lives in `ROADMAP.md`.

### 3. API Key / Security Rules
**Required whenever the project touches any secret** (API keys, DB connection strings, auth secrets). A table: `Key | Prefix | Lives | Why`. Followed by one bolded **Rule:** sentence stating the boundary (e.g. "anything that touches \<third-party API\> goes through a server-side function; the browser never calls it directly").

### 4. Project Structure
An annotated directory tree, real paths from the actual repo, one-line comment per entry explaining its role — not a restatement of the filename.

### 5. Environment Variables
A single code block, split into server-side (no public prefix) and client-side (public-prefixed) sections. Include the actual variable names, not placeholders, plus any platform-specific gotcha (e.g. "must be enabled for both Production and Preview or `/api/me` 500s").

### 6. Routes / Pages *(only for multi-route apps)*
Table: `Route | Component | Role`. Skip for single-page apps — HashRouter/App-Router internals go in Project Structure instead.

### 7. Key Rules for Claude Code
The highest-value section. One bolded rule-lead-in per paragraph, each describing a specific gotcha discovered the hard way — not generic advice. Examples from real gotchas across these projects: a type-coercion quirk in the DB driver, an idempotency key requirement, a timer that must stop on specific player states, an auth model that must not be reverted to a prior broken version. If a rule doesn't reference a concrete failure mode that actually happened (or would obviously happen), it doesn't belong here — it belongs in generic engineering practice, not this file.

### 8. Working in This Environment
Tooling quirks specific to running Claude Code against this repo: commit signing workarounds, CDN/cache lag after deploys, sandbox network restrictions, anything that would otherwise cause a session to falsely conclude something didn't work.

### 9. Agentic Loop
**One line, linking to the canonical protocol URL.** Never paste the phase descriptions into this file — a second copy of the protocol text drifts from the source and nobody remembers to update both. State only the activation threshold (file count / new component / data layer / user-visible / time estimate) in one sentence.

### 10. References
Links only — related repos, protocol docs, key third-party doc pages.

---

## Part 2 — Reference Patterns

These are concrete, working patterns from NGS-Immersion. When scaffolding a new project or cleaning up an existing one, prefer copying these over re-deriving them — they've already had their bugs found.

**Same-origin auth session (Neon Auth / Better Auth).** Don't let the browser talk to the auth provider directly — that makes the session cookie third-party and browsers drop it (silent logout on refresh). Route auth through your own same-origin handler: `createNeonAuth({ baseUrl, cookies: { secret, sameSite: 'lax' } })` exposed at `app/api/auth/[...path]/route.js` via `export const { GET, POST } = auth.handler()`. The client uses the **no-arg** `createAuthClient()` pointed at the same-origin proxy, never a direct provider URL. This is the single highest-value pattern to copy — getting it wrong looks fine until the first refresh-triggered logout bug report.

**Secret isolation.** Anything that touches a third-party API key or a direct DB write path lives in a server-only function (`pages/api/*` / route handlers), never in client code, regardless of framework. No env var carrying a secret gets the public/client prefix (`NEXT_PUBLIC_`, `VITE_`, etc.) — that prefix inlines it into the browser bundle at build time.

**Numeric-string coercion.** Any serverless Postgres driver returning `NUMERIC`/`DECIMAL` columns as strings (to avoid precision loss) will silently break `.toFixed()` / arithmetic downstream. Coerce with `Number(...)` at the API boundary, not in the component. This has independently bitten both NGS-Immersion and NextGen-Scholars — assume it'll happen in any new Neon-backed project and coerce proactively rather than waiting to hit it.

**Idempotent writes for unreliable clients.** Any write triggered by a page-unload / beacon / retry-prone path needs a client-generated idempotency key with `ON CONFLICT (key) DO NOTHING`, and the local buffer only clears after a confirmed write. Don't rely on "it probably won't double-fire."

**Vercel env var scoping.** A secret missing from **Preview** (only set on Production) breaks preview deploys in a way that looks like an auth bug, not a config bug. Set every secret for both Production and Preview explicitly; don't assume Vercel copies one to the other.

---

## Part 3 — Cleanup Checklist (existing projects)

Run this against a project's current `CLAUDE.md`:

- [ ] Does a `ROADMAP.md` (or equivalent session log) exist? If not, create one — dated history moves there, not in `CLAUDE.md`.
- [ ] Is there a narrative migration/history section longer than one paragraph inside `CLAUDE.md`? Move it to `ROADMAP.md`'s session log, leave one summary paragraph behind.
- [ ] Does the Agentic Loop section paste the full protocol text instead of linking to it? Replace with a one-line link + activation threshold.
- [ ] Is there a Security/API-key table? If the project has any secret and no such table, add one.
- [ ] Are the remaining sections in Part 1's order? Reorder if not — consistency across projects is the point.
- [ ] Does "Key Rules for Claude Code" contain generic advice rather than specific, previously-hit gotchas? Trim generic entries; they add re-reading cost without adding information.
- [ ] Does `CLAUDE.md` tell the session to read `ARCHITECTURE.md`/`ROADMAP.md` at session start (if those files exist)? If they exist but aren't referenced, add the pointer.

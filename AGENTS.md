# AI Capital Planning OS

Personal capital-planning app, in daily personal use: a Next.js App Router frontend backed by Neon (serverless Postgres) and deployed on Vercel.

Shared project instructions for every coding agent (Claude Code, Codex, Antigravity). Each agent's role and permissions live in its own global file, not here.

## Session protocol
At the start of each session, read `ARCHITECTURE.md` and `ROADMAP.md` to orient on the current phase and recommended next steps.

## Project context
- **Next.js 16 App Router** frontend (React 19), **Neon (serverless Postgres)**
  backend via `app/api/*` route handlers, Neon Auth for sessions, Anthropic
  claude-sonnet-4-6 via the `app/api/ai-chat` route.
- Deployed to **Vercel** (migrated off Vite/GitHub Pages/Supabase — see
  `MIGRATION_PLAN.md` / `ROADMAP.md`).
- App is in daily personal use — reliability and data integrity take priority over new features
- Never expose the Anthropic API key in the browser; all AI calls route through the server-side `app/api/ai-chat` route.

> **Backend:** Neon (serverless Postgres) throughout. The old `supabase/`
> reference directory was renamed to `db/` (schema migrations + the original,
> since-ported edge functions, kept as history), and the leftover
> `supabase`-named strings in `app/api/*`/`src/*` comments were cleaned up in a
> 2026-07-08 pass. Remaining "Supabase" mentions live only in the migration
> history docs (`ROADMAP.md`, `MIGRATION_PLAN.md`, `ARCHITECTURE.md` history
> sections), where they are accurate record.

## Native app (PWA → Play Store) — PLANNED

Candidate to ship as an installable Android app (PWA → TWA). **Unlike the other
two NGS apps (Immersion, Scholars — private/Internal Testing), this one may go
public** ("Multi-tenant / public user accounts" is in ROADMAP future scope),
which would mean a heavier Play path (content review, data-safety for financial
data, the new-account 12-tester/14-day gate). That distribution decision is
deferred — but the PWA groundwork is a prerequisite either way and keeps both
doors open. Runbook: **`docs/PWA.md`**. Follows the NextGen-Immersion pilot.

---

## Coder Profile — always on

Profile: https://raw.githubusercontent.com/jonncy18-maker/Agentic-Loop/main/CODER_PROFILE.md

Read it at the start of every session. It applies to **every task, with no threshold** — it governs how code is written and how it gets verified (root rule: anything not verified by execution is unverified, and gets reported as unverified). It is a separate layer from the loop below, which governs whether the right thing was built. A change small enough to skip the loop is still governed by the profile.

> The loop protocol below is inlined in this file rather than fetched from the Agentic-Loop repo — this project is where the protocol originated. It can drift from the canonical `AGENTIC_LOOP.md`. Reconciling the two is a separate task.

---

## Agentic Loop — Goal Execution Workflow

### When to activate
Activate the full loop when **any** of the following are true:
- Change touches 3+ files
- New component or module is being created
- Touches the data layer (Supabase queries, schema, AI context)
- Has user-facing behavior the user can see and interact with
- Estimated effort is more than ~5 minutes of work

For everything else (typo, one-liner, single-file config tweak) — execute directly and report back. No loop needed.

---

### Phase 1 — Understand & Verify

1. Read `ARCHITECTURE.md` and `ROADMAP.md`
2. Read all files relevant to the goal
3. Produce a **visual artifact** showing what changes from the user's perspective — what they will *see and experience* after the work is done (before/after behavior, new UI elements, removed elements). This is outcome-focused, not implementation-focused. No file lists, no diffs.
4. **Always stop for approval.** Do not proceed until the user explicitly approves.
   - Exception: if the user says "just do it" in the same message as the goal, treat that as pre-approval and skip to Phase 2.

---

### Phase 2 — Instructions

A goal agent produces a detailed instruction set containing:
- The original goal statement (verbatim)
- The spirit of the goal (what success looks like in plain language)
- Specific files to create or modify
- Exact behavior expected per file
- Success criteria the audit agent will check against
- Any constraints or things explicitly NOT to do

These instructions are the contract between the goal agent, build agent, and audit agent.

---

### Phase 3 — Build

A separate build agent executes against the instruction set from Phase 2. The build agent:
- Works from the instructions only — does not re-interpret the goal
- Makes no architectural decisions not covered by the instructions (surfaces them as blockers instead)
- Writes code comments only where the *why* is non-obvious — no narration, no "added for X" comments

---

### Phase 4 — Audit

A separate audit agent reconciles what was built against the Phase 2 instructions and the original goal. The audit agent:
- Checks **factual compliance**: does the code match the instructions exactly?
- Checks **spirit compliance**: does the outcome match the intent of the original goal?
- Distinguishes between the two failure types:
  - **Factual failure** — code does not match instructions. Use an iteration to fix.
  - **Judgment failure** — this is a spirit/intent call that only the user can resolve. **Escalate immediately** — do not consume an iteration on a judgment call.
- Flags any user-facing (UI) changes as **"visually unverified"** — these must be confirmed by the user in the browser before the goal is marked complete.

---

### Phase 5 — Iteration

If the audit is not satisfied:
- Run up to **3 iterations** total (Phase 3 → Phase 4, repeated)
- Each iteration the build agent targets only the specific failures identified by the audit agent
- After each iteration the audit agent re-runs a full check

If after 3 iterations the audit is still not satisfied, **stop** and produce a Stuck Report (see below).

---

### Phase 6 — Documentation

After a satisfactory audit, update documentation:
- **`ROADMAP.md`** — add a session log entry: what was built, how many iterations, what the audit found
- **`ARCHITECTURE.md`** — update only if a structural or data model decision changed
- No new documentation files — feed into existing surfaces only

---

### Stuck Report Format

When the 3-iteration cap is reached without a satisfactory audit, stop and report:

```
## Stuck Report

**Goal:** [original goal statement]

**Iteration 1:** [what was built] → [what the audit failed on]
**Iteration 2:** [what was changed] → [what the audit failed on]
**Iteration 3:** [what was changed] → [what the audit still fails on]

**Root cause assessment:** [what I believe is blocking resolution]

**Decision needed from you:** [the specific question or choice that would unblock this]
```

---

## Cross-Cutting Rules

Anthropic models are pinned by family, not by version (decided 2026-07-08, see ROADMAP.md): `resolveModel()` in `app/api/ai-chat/route.js` resolves `sonnet`/`haiku` to the newest release in that family. The exact IDs in `MODEL_FALLBACKS` (e.g. `claude-haiku-4-5`, `claude-sonnet-4-6`) are only used when that lookup fails. Non-Anthropic models (e.g. `gpt-6-luna`) stay pinned to exact IDs.

**Where things go.** Anything only Claude Code needs goes in `CLAUDE.md`. Never put agent permissions (push, merge, deploy) in this file: every agent reads it.

## Working in an agent copy (Codex / Antigravity)

Applies only when your working directory is under `~/code/_codex/` or `~/code/_antigravity/`. Those copies sync from the local `main` in `~/code/<repo>`, not from GitHub (local `main` is usually ahead, and the copies have no push access).

At the start of each session, with the copy on a clean `main`:

1. `git fetch local && git merge --ff-only local/main`.
2. If the copy is not on a clean `main`, or the fast-forward fails, stop and tell John. Do not reset, rebase or discard anything on your own.
3. Do your work on a local branch and hand it back through the audit inbox; never edit `main` in the copy.

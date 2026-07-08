# AI Capital Planning OS — Claude Code Instructions

## Session protocol
At the start of each session, read `ARCHITECTURE.md` and `ROADMAP.md` to orient on the current phase and recommended next steps.

## Response style
- **Always use visual artifacts** (charts, tables, diagrams, dashboards) when explaining data, showing audit results, comparing before/after changes, or summarizing a set of items. Prefer a rendered visual over a plain text list whenever the content benefits from structure or layout.
- Keep text responses short and direct.
- No trailing summaries — the diff speaks for itself.

## Project context
- React 19 + Vite frontend, Supabase PostgreSQL backend, Anthropic claude-sonnet-4-6 via Edge Function
- Deployed to GitHub Pages (auto-deploys on push to `main`)
- App is in daily personal use — reliability and data integrity take priority over new features
- Never expose the Anthropic API key in the browser; all AI calls route through `supabase/functions/ai-chat`

> **Stale — needs a separate cleanup pass:** the "Project context" above no
> longer matches the repo. The app has migrated to **Next.js App Router**
> (`app/`, `next.config.mjs`, Next 16) on Vercel (see `MIGRATION_PLAN.md` /
> `ROADMAP.md`). Treat the Next.js/Vercel state as current.

## Native app (PWA → Play Store) — PLANNED

Candidate to ship as an installable Android app (PWA → TWA). **Unlike the other
two NGS apps (Immersion, Scholars — private/Internal Testing), this one may go
public** ("Multi-tenant / public user accounts" is in ROADMAP future scope),
which would mean a heavier Play path (content review, data-safety for financial
data, the new-account 12-tester/14-day gate). That distribution decision is
deferred — but the PWA groundwork is a prerequisite either way and keeps both
doors open. Runbook: **`docs/PWA.md`**. Follows the NextGen-Immersion pilot.

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

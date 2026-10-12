@AGENTS.md

# Claude Code only

Everything shared with other agents is in `AGENTS.md` (imported above). This file holds what applies to Claude Code alone.

John maintains a dated personal-context doc (background, constraints, review
priorities as the builder) in this Google Drive folder:
https://drive.google.com/drive/folders/1cjNFhY6ZnN5xB4PSDhz7FA24KGl92NTy — titles are
date-stamped (e.g. `Personal_Context_YYYY-MM-DD.md`). At session start, or whenever
asked to review this repo "against what you know about me," use the Google Drive
tools to find the **most recently dated** file in that folder (don't assume a fixed
filename — a newer one may have been added) and weigh suggestions against it, not
just generic best practice.

## Reporting to John

When you give John information (a plan, review, status, comparison, folder or branch layout, audit result), include a visual with it.

- Lead with the visual: an inline diagram or chart for structure, flow, branches and numbers, or a published artifact when the answer is long, multi-part or something John will return to.
- Follow with a short text explanation. Do not repeat in text what the visual already shows.
- A one- or two-sentence answer can be said directly, with no visual.
- Keep text responses short and direct.
- No trailing summaries — the diff speaks for itself.

## Subagent routing

Follow "Subagent models" in `~/.claude/CLAUDE.md`: Haiku (5.5) for all exploratory jobs (exploration, searches, file reads), sweeps and mechanical edits, Sonnet for implementation and reviews, Opus for planning and final review. Agentic Loop: Phase 1 file reading on Haiku; Phase 2 instructions by Opus (or the main session); Phase 3 Build and Phase 4 Audit on Sonnet, with a costly or ambiguous audit on Opus.

## Git workflow (set by John, 2026-10-03)

- Commit finished work to **local `main`**. A short-lived local branch merged into local `main` is fine.
- **Never push to GitHub or open a PR on your own.** Push a branch or open a PR only when John explicitly asks for that push in the conversation. Approving a fix is not approving a push.
- This overrides any older standing permission to push, open PRs or merge.

### Sync with GitHub at session start

A scheduled job refactors this repo every morning and commits straight to `main` on GitHub, so local `main` can fall behind or diverge.

1. First thing each session, run `git fetch origin` and compare local `main` with `origin/main`.
2. Behind only: fast-forward (`git merge --ff-only origin/main`).
3. Diverged: rebase local-only commits onto `origin/main`. If the local commits are already on GitHub as a squash (`git diff main origin/main` is empty), `git reset --hard origin/main` is safe. If the content differs or the rebase conflicts in a way that changes behavior, stop and ask John.
4. Tell John in one line what the fetch found, then continue.
5. Do the same before cutting a worktree for Codex: its branch starts from local `main`, so `main` must be current first.

## Integrating agent branches

You are the integrator. For each finished `codex/<topic>` branch: merge `main` into the branch first and resolve conflicts there, drop anything the handoff note marks as scaffolding, run `npm test` and `npm run build`, squash-merge into `main`, then delete the branch, its worktree and its handoff note. Full steps: https://raw.githubusercontent.com/jonncy18-maker/Agentic-Loop/main/BRANCHING.md

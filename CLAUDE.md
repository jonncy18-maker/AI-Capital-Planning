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

## Response style
- **Always use visual artifacts** (charts, tables, diagrams, dashboards) when explaining data, showing audit results, comparing before/after changes, or summarizing a set of items. Prefer a rendered visual over a plain text list whenever the content benefits from structure or layout.
- Keep text responses short and direct.
- No trailing summaries — the diff speaks for itself.

## Git workflow (set by John, 2026-10-03)

- Commit finished work to **local `main`**. A short-lived local branch merged into local `main` is fine.
- **Never push to GitHub or open a PR on your own.** Push a branch or open a PR only when John explicitly asks for that push in the conversation. Approving a fix is not approving a push.
- This overrides any older standing permission to push, open PRs or merge.

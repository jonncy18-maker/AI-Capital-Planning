@AGENTS.md

# Antigravity only

Everything shared with other agents is in `AGENTS.md` (imported above). This file holds what applies to Antigravity (Gemini) alone.

## Subagent & Task Routing

**Subagent model selection — name the family, never a version; choose by how checkable the output is.** The main session picks the model per task:

- **Flash** — anything with a clear spec whose output gets checked:
  - Repo exploration, ripgrep sweeps, file/usage discovery
  - Summarizing command output and test runner logs
  - Mechanical edits, formatting, small tests, and reading documentation to a spec
  - Agentic Loop Phase 1 file reading
- **Pro** — the default when building or analyzing:
  - Feature implementation, UI work, bug tracing, refactors, and test suites
  - Audit reconciliation (Agentic Loop Phase 4)
- **Escalate, don't patch around.** If a cheaper model's result looks thin or fails a check, rerun it one tier up rather than trusting or hand-fixing it.

Write model families here ("Flash", "Pro", never exact version numbers), so the rule keeps meaning the current tier without an edit.

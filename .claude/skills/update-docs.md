# Update Governing Docs

Synthesize what was built in this session and update the repository's governing markdown files to maintain a durable documentation trail. Run this at the end of every working session.

---

## Step 1 — Gather session context

Run these commands to understand what changed:

```bash
git log --oneline -20
git diff HEAD~3..HEAD --stat
```

Also draw from this conversation: what was built, fixed, decided, or left unresolved.

---

## Step 2 — Update ROADMAP.md

`ROADMAP.md` is the primary session log. Make these edits:

**a) Update the "Last updated" line** in the "Current Status — Session Log" section with today's date.

**b) Append a new session entry** inside the "Done so far" list, immediately before the "Known follow-ups / gotchas" heading. Match the existing format exactly:

```
- **[Short description of the work] (YYYY-MM-DD):**
  - `path/to/file.js` — what changed and why
  - `path/to/other.jsx` — what changed and why
  - Any schema changes, migrations, or data-layer touches
  - Any bug fixes with root cause noted
```

Rules for the entry:
- Date is today's date in `YYYY-MM-DD` format
- Lead with the most significant change
- Reference file paths when useful for future orientation
- Note root causes for bugs, not just symptoms
- Do not pad with obvious filler — if nothing changed in a file, don't mention it

**c) Update "Known follow-ups / gotchas"** — add any new gotchas discovered this session; mark resolved ones with ~~strikethrough~~ or remove them if truly closed.

**d) Replace "Recommended next session"** with an accurate, prioritized list based on what was actually completed and what remains. Keep the Reliability / Data quality / etc. headers if they still apply.

---

## Step 3 — Update ARCHITECTURE.md (conditional)

Only edit `ARCHITECTURE.md` if this session introduced any of the following:

- A new module, major component, or page added to the module map
- A schema or data-model change that affects the architecture overview
- A new third-party integration or service dependency
- A deployment or infrastructure change
- A decision that diverges from the original design (add an inline implementation note at the relevant section)
- A new edge function or backend capability

If none of the above apply, skip this step entirely.

When editing, add a concise inline note in the relevant section rather than rewriting existing prose. Mark it with the date: `*(added YYYY-MM-DD)*`.

---

## Step 4 — Update README.md (conditional)

Only edit `README.md` if:

- A new phase was completed (update "Current phase" reference)
- The "recent completions" or highlights list should reflect this session
- Major new user-facing capabilities are now available

If the session was purely maintenance or a small fix, skip this step.

---

## Step 5 — Commit the doc updates

Stage only the markdown files that were actually changed:

```bash
git add ROADMAP.md
# add ARCHITECTURE.md and/or README.md only if edited
git commit -m "docs: session update YYYY-MM-DD — [one-line summary of what was built]"
```

The commit message summary should name the work, not describe the docs update (e.g. `docs: session update 2026-06-23 — error boundary + DB migration apply`).

Push to the current branch:

```bash
git push -u origin $(git branch --show-current)
```

---

## Output to user

After completing the updates, print a short confirmation:

```
Session docs updated:
- ROADMAP.md: added entry "[title]" under "Done so far"; updated next-session list
- ARCHITECTURE.md: [updated / skipped]
- README.md: [updated / skipped]
Committed as: docs: session update YYYY-MM-DD — [summary]
```

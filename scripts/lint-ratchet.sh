#!/usr/bin/env bash
# Fails only if the files a PR touches have MORE ESLint errors than they had on
# the base commit. main carries pre-existing lint debt, so a plain `npm run lint`
# gate would be red on every PR; this blocks new debt without demanding the old
# debt be paid first.
# Usage: scripts/lint-ratchet.sh <base-sha>
set -euo pipefail

base="$1"
mapfile -t files < <(git diff --name-only --diff-filter=AMR "$base"...HEAD -- '*.js' '*.jsx' '*.mjs')
if [ ${#files[@]} -eq 0 ]; then
  echo "No JS files changed."
  exit 0
fi

count_errors() {
  npx eslint --no-warn-ignored -f json "$@" 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).reduce((n,r)=>n+r.errorCount,0)))' || true
}

head_errors=$(count_errors "${files[@]}")

worktree=$(mktemp -d)
git worktree add --detach --quiet "$worktree" "$base"
ln -s "$PWD/node_modules" "$worktree/node_modules"
base_files=()
for f in "${files[@]}"; do [ -f "$worktree/$f" ] && base_files+=("$f"); done
base_errors=0
if [ ${#base_files[@]} -gt 0 ]; then
  base_errors=$(cd "$worktree" && count_errors "${base_files[@]}")
fi
git worktree remove --force "$worktree"

echo "ESLint errors in changed files: base=$base_errors head=$head_errors"
if [ "$head_errors" -gt "$base_errors" ]; then
  npx eslint --no-warn-ignored "${files[@]}" || true
  echo "This PR adds lint errors to the files it touches."
  exit 1
fi

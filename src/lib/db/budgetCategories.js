// Neon-backed client seam for budget_categories, fronting
// app/api/budget-categories/route.js, app/api/budget-categories/[id]/route.js,
// app/api/budget-categories/import/route.js, and
// app/api/budget-categories/seed/route.js. Session auth is via the Neon Auth
// cookie (credentials: 'include'), so the routes derive the real user id
// from the session — `userId` params are kept for signature compatibility
// with existing callers (contextLoader.js, scenarioAgent.js, and every
// src/modules/* caller listed below).

async function parseJsonOrThrow(res) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return body
}

// Upsert the default Monarch category → group/type mappings for this user.
// Safe to call multiple times — will not overwrite user-customized targets.
export async function seedDefaultCategories(_userId) {
  const res = await fetch('/api/budget-categories/seed', {
    method: 'POST',
    credentials: 'include',
  })
  await parseJsonOrThrow(res)
}

// Upsert a single custom category mapping (e.g. from the unmapped-categories
// dialog or the Mapping editor). `excludeFromTotals` is only written when the
// caller passes it, so callers that don't manage it leave the flag untouched.
export async function upsertCategory(_userId, { category, group, type, excludeFromTotals }) {
  const body = { category, group, type }
  if (excludeFromTotals !== undefined) body.excludeFromTotals = !!excludeFromTotals

  const res = await fetch('/api/budget-categories', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  await parseJsonOrThrow(res)
}

// Set of category names this user has flagged exclude_from_totals — used to
// drop transfers / credit-card payments from spend & income aggregations.
export async function getExcludedCategoryNames(_userId) {
  const res = await fetch('/api/budget-categories', { credentials: 'include' })
  const data = await parseJsonOrThrow(res)
  return new Set((data ?? []).filter(r => r.exclude_from_totals).map(r => r.category).filter(Boolean))
}

// Fetch all budget_categories for this user.
export async function getBudgetCategories(_userId) {
  const res = await fetch('/api/budget-categories', { credentials: 'include' })
  const data = await parseJsonOrThrow(res)
  return data ?? []
}

// Distinct, non-empty groups this user already uses — i.e. their own budget
// buckets. Used to drive flexible mapping (AI + dropdowns map into these
// instead of a fixed built-in list). Derived client-side from the same
// category list the GET route already returns.
export async function getUserGroups(_userId) {
  const res = await fetch('/api/budget-categories', { credentials: 'include' })
  const data = await parseJsonOrThrow(res)
  return [...new Set((data ?? []).map(r => r.group).filter(Boolean))].sort()
}

// Bulk upsert category → { group, type, monthly_target } mappings, e.g. from a
// budget/mapping CSV the user already maintains. This is authoritative: it seeds
// the user's own buckets so subsequent imports map cleanly without AI guessing.
// Rows without a category or group are skipped.
export async function importCategoryMappings(_userId, rows) {
  const payload = (rows ?? []).filter(r => r.category && r.group)

  if (payload.length === 0) return { imported: 0 }

  const res = await fetch('/api/budget-categories/import', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rows: payload }),
  })
  return parseJsonOrThrow(res)
}

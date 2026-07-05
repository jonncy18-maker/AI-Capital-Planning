// Neon-backed client seam for budget_status, fronting app/api/budget-status/route.js
// (Neon Auth session cookie via credentials: 'include' — no token handling).
// `userId` params are kept for signature compatibility with existing callers
// (Budget.jsx) even though the route derives the real identity from the
// session itself.
//
// Lifecycle status for a year's budget. A missing row means the budget has
// never been finalized — i.e. it's a freely editable draft. We default to
// 'draft' (and swallow ALL errors, including network/parse failures) so the
// UI keeps working even if the budget_status table hasn't been migrated yet.

export async function getBudgetStatus(_userId, year, version = 'v1') {
  try {
    const params = new URLSearchParams({ year, version })
    const res = await fetch(`/api/budget-status?${params.toString()}`, { credentials: 'include' })
    const body = await res.json().catch(() => null)
    if (!res.ok || !body) return { status: 'draft', finalized_at: null }
    return { status: body?.status ?? 'draft', finalized_at: body?.finalized_at ?? null }
  } catch {
    return { status: 'draft', finalized_at: null }
  }
}

export async function setBudgetStatus(_userId, year, status, version = 'v1') {
  const res = await fetch('/api/budget-status', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ year, version, status }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
}

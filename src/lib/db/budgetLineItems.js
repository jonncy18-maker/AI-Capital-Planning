// Neon-backed client seam for budget_line_items, fronting
// app/api/budget-line-items/route.js, .../years/route.js, .../[id]/route.js
// (Neon Auth session cookie via credentials: 'include' — no token handling).
// `userId` params are kept for signature compatibility with existing callers
// (Budget.jsx, Forecast.jsx, CashFlow.jsx, PayPeriodPlanner.jsx, cashSeries.js,
// contextLoader.js) even though the routes derive the real identity from the
// session itself.

async function parseJsonOrThrow(res) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return body
}

// Returns rows shaped like the original `*, budget_categories(id, category, "group", type)`
// embedded select — callers read `li.budget_categories?.group` etc.
export async function getBudgetLineItems(_userId, { year } = {}) {
  const params = new URLSearchParams()
  if (year) params.set('year', year)
  const qs = params.toString()
  const res = await fetch(`/api/budget-line-items${qs ? `?${qs}` : ''}`, { credentials: 'include' })
  return parseJsonOrThrow(res)
}

export async function getBudgetYears(_userId) {
  const res = await fetch('/api/budget-line-items/years', { credentials: 'include' })
  return parseJsonOrThrow(res)
}

// Replace all budget_line_items for a given year+version with the supplied rows.
export async function saveBudgetForYear(_userId, year, version = 'v1', items) {
  const res = await fetch('/api/budget-line-items', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ year, version, items }),
  })
  await parseJsonOrThrow(res)
}

// Insert a single budget line item (e.g. adding a new line under a category from
// the Forecast drill-down). Returns the inserted row with its category joined so
// callers can fold it straight into their in-memory line-item list.
export async function insertBudgetLineItem(_userId, { year, version = 'v1', categoryId, month, amount, label }) {
  const res = await fetch('/api/budget-line-items', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ year, version, categoryId, month, amount, label: label ?? null }),
  })
  return parseJsonOrThrow(res)
}

// Update a single line item's amount (for inline editing).
export async function updateLineItemAmount(id, amount) {
  const res = await fetch(`/api/budget-line-items/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ amount }),
  })
  await parseJsonOrThrow(res)
}

export async function deleteLineItem(id) {
  const res = await fetch(`/api/budget-line-items/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  await parseJsonOrThrow(res)
}

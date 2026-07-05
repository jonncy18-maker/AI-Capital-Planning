// Neon-backed client seam for transactions, fronting the routes under
// app/api/transactions/ (Neon Auth session cookie via credentials: 'include'
// — no token handling). `userId` params are kept for signature compatibility
// with existing callers even though each route derives the real identity
// from the session itself.

async function parseJsonOrThrow(res) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return body
}

// Build the dedup key used for import deduplication.
export function buildDedupKey({ date, merchant, amount, account }) {
  return `${date}|${merchant.toLowerCase()}|${amount}|${account ?? ''}`
}

// Insert rows from a parsed CSV, skipping duplicates.
// Returns { inserted: number, skipped: number }.
export async function importTransactions(_userId, rows) {
  const res = await fetch('/api/transactions', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rows }),
  })
  return parseJsonOrThrow(res)
}

// Fetch recent transactions for AI context (last N days, summary level).
// Defaults to a full trailing year so the AI sees the whole annual cycle.
export async function getRecentTransactions(_userId, days = 365) {
  const params = new URLSearchParams({ days: String(days) })
  const res = await fetch(`/api/transactions/recent?${params}`, { credentials: 'include' })
  return parseJsonOrThrow(res)
}

// Fetch transactions with optional filters.
export async function getTransactions(_userId, { from, to, category, limit = 500 } = {}) {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  if (category) params.set('category', category)
  params.set('limit', String(limit))
  const res = await fetch(`/api/transactions?${params}`, { credentials: 'include' })
  return parseJsonOrThrow(res)
}

// Fetch a wide window of transactions for budget pattern analysis.
export async function getTransactionsForAnalysis(_userId, months = 24) {
  const params = new URLSearchParams({ months: String(months) })
  const res = await fetch(`/api/transactions/analysis?${params}`, { credentials: 'include' })
  return parseJsonOrThrow(res)
}

// Fetch all expense transactions for a full calendar year (for forecast actuals).
export async function getTransactionsForYear(_userId, year) {
  const res = await fetch(`/api/transactions/year/${year}`, { credentials: 'include' })
  return parseJsonOrThrow(res)
}

// Fetch outflow (negative amount) transactions for the given category names
// across a year range. Used to compute per-month actuals for bills that are
// linked to an expense category instead of manual bill_amounts entries.
// Returns rows with { date, category, amount } (amount is always negative).
export async function getExpenseActualsByCategories(_userId, categories, startYear, endYear) {
  if (!categories || categories.length === 0) return []
  const params = new URLSearchParams({
    categories: categories.join(','),
    startYear: String(startYear),
    endYear: String(endYear),
  })
  const res = await fetch(`/api/transactions/by-category?${params}`, { credentials: 'include' })
  return parseJsonOrThrow(res)
}

// Fetch transactions in a date range for cash flow calendar aggregation.
export async function getTransactionsByMonth(_userId, fromDate, toDate) {
  const params = new URLSearchParams({ from: fromDate, to: toDate })
  const res = await fetch(`/api/transactions/by-month?${params}`, { credentials: 'include' })
  return parseJsonOrThrow(res)
}

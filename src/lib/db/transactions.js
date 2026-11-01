// Neon-backed client seam for transactions, fronting the routes under
// app/api/transactions/ (Neon Auth session cookie via credentials: 'include'
// — no token handling). `userId` params are kept for signature compatibility
// with existing callers even though each route derives the real identity
// from the session itself.

import { apiFetch } from './apiClient.js'

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
  const res = await apiFetch('/api/transactions', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rows }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const err = new Error(body?.error || `Request failed (${res.status})`)
    // Present when an earlier batch already committed before a later one failed.
    if (body?.committed_batches != null) err.partial = body
    throw err
  }
  return res.json().catch(() => ({}))
}

// Fetch recent transactions for AI context (last N days, summary level).
// Defaults to a full trailing year so the AI sees the whole annual cycle.
export async function getRecentTransactions(_userId, days = 365) {
  const params = new URLSearchParams({ days: String(days) })
  const res = await apiFetch(`/api/transactions/recent?${params}`, { credentials: 'include' })
  return parseJsonOrThrow(res)
}

// Fetch transactions with optional filters.
export async function getTransactions(_userId, { from, to, category, merchant, account, limit = 500, offset } = {}) {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  if (category) params.set('category', category)
  if (merchant) params.set('merchant', merchant)
  if (account) params.set('account', account)
  params.set('limit', String(limit))
  if (offset) params.set('offset', String(offset))
  const res = await apiFetch(`/api/transactions?${params}`, { credentials: 'include' })
  return parseJsonOrThrow(res)
}

// Fetch a wide window of transactions for budget pattern analysis.
export async function getTransactionsForAnalysis(_userId, months = 24) {
  const params = new URLSearchParams({ months: String(months) })
  const res = await apiFetch(`/api/transactions/analysis?${params}`, { credentials: 'include' })
  return parseJsonOrThrow(res)
}

// Fetch all expense transactions for a full calendar year (for forecast actuals).
export async function getTransactionsForYear(_userId, year) {
  const res = await apiFetch(`/api/transactions/year/${year}`, { credentials: 'include' })
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
  const res = await apiFetch(`/api/transactions/by-category?${params}`, { credentials: 'include' })
  return parseJsonOrThrow(res)
}

// Fetch transactions in a date range for cash flow calendar aggregation.
export async function getTransactionsByMonth(_userId, fromDate, toDate) {
  const params = new URLSearchParams({ from: fromDate, to: toDate })
  const res = await apiFetch(`/api/transactions/by-month?${params}`, { credentials: 'include' })
  const rows = await parseJsonOrThrow(res)
  // Neon returns numeric columns as strings; normalize once at this boundary
  // so every consumer sees a number (display and stored data are unchanged).
  return Array.isArray(rows) ? rows.map(r => ({ ...r, amount: Number(r.amount) })) : rows
}

// Change category / group / notes on existing rows by id. With dryRun the
// server only reads and reports before -> after.
export async function reclassifyTransactions(_userId, updates, { dryRun = false } = {}) {
  const res = await apiFetch('/api/transactions/reclassify', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ updates, dry_run: dryRun }),
  })
  return parseJsonOrThrow(res)
}

// Server-side Monarch CSV import. mode 'preview' saves nothing.
export async function importMonarchCsv(_userId, { csv, mode, filename, chunk, category_groups }) {
  const res = await apiFetch('/api/transactions/import', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ csv, mode, filename, chunk, category_groups }),
  })
  return parseJsonOrThrow(res)
}

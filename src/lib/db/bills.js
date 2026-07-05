// Neon-backed client seam for accounts/bills/bill_amounts/account_balances,
// fronting the already-built app/api/accounts, app/api/bills,
// app/api/bill-amounts and app/api/account-balances routes (Neon Auth session
// cookie via credentials: 'include' — no token handling). `userId` params are
// kept for signature compatibility with existing callers even though the
// routes derive the real identity from the session itself.

async function parseJsonOrThrow(res) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return body
}

async function parseNoContentOrThrow(res) {
  if (res.status === 204) return
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
}

// ─── Accounts ────────────────────────────────────────────────────────────────

export async function getAccounts(_userId) {
  const res = await fetch('/api/accounts', { credentials: 'include' })
  return parseJsonOrThrow(res)
}

export async function upsertAccount(_userId, account) {
  const res = await fetch('/api/accounts', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(account),
  })
  return parseJsonOrThrow(res)
}

export async function deleteAccount(id) {
  const res = await fetch(`/api/accounts/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  await parseNoContentOrThrow(res)
}

// ─── Bills ───────────────────────────────────────────────────────────────────

export async function getBills(_userId) {
  const res = await fetch('/api/bills', { credentials: 'include' })
  return parseJsonOrThrow(res)
}

export async function upsertBill(_userId, bill) {
  const res = await fetch('/api/bills', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(bill),
  })
  return parseJsonOrThrow(res)
}

export async function deleteBill(id) {
  const res = await fetch(`/api/bills/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  await parseNoContentOrThrow(res)
}

// ─── Bill amounts (variable monthly amounts, e.g. CC statements) ─────────────

export async function getBillAmounts(_userId, year, month) {
  const params = new URLSearchParams({ year: String(year), month: String(month) })
  const res = await fetch(`/api/bill-amounts?${params}`, { credentials: 'include' })
  return parseJsonOrThrow(res)
}

export async function getBillAmountsForBill(billId) {
  const params = new URLSearchParams({ billId })
  const res = await fetch(`/api/bill-amounts?${params}`, { credentials: 'include' })
  return parseJsonOrThrow(res)
}

export async function getBillAmountsRange(_userId, startYear, endYear) {
  const params = new URLSearchParams({ startYear: String(startYear), endYear: String(endYear) })
  const res = await fetch(`/api/bill-amounts?${params}`, { credentials: 'include' })
  return parseJsonOrThrow(res)
}

export async function upsertBillAmount(_userId, billId, year, month, amount, notes = null) {
  const res = await fetch('/api/bill-amounts', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ billId, year, month, amount, notes }),
  })
  return parseJsonOrThrow(res)
}

export async function deleteBillAmount(billId, year, month) {
  const res = await fetch(`/api/bill-amounts/${billId}/${year}/${month}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  await parseNoContentOrThrow(res)
}

// ─── Account balances (manual period snapshots) ───────────────────────────────

export async function getAccountBalances(_userId, year, month) {
  const params = new URLSearchParams({ year: String(year), month: String(month) })
  const res = await fetch(`/api/account-balances?${params}`, { credentials: 'include' })
  return parseJsonOrThrow(res)
}

export async function upsertAccountBalance(_userId, accountId, year, month, periodHalf, balance) {
  const res = await fetch('/api/account-balances', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountId, year, month, periodHalf, balance }),
  })
  return parseJsonOrThrow(res)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Fetch the effective monthly forecast amount for each bill that has a
// forecast_category_id. Returns a map of billId → derived amount (after divisor).
// Resolution: sum(forecast_line_items) ?? sum(budget_line_items) for that
// category+month. The forecast is an independent dataset; where it has lines for
// the category/month they define the amount, otherwise the budget is used.
export async function getForecastAmountsForBills(_userId, year, month, bills) {
  const linkedBills = bills.filter(b => b.forecast_category_id)
  if (linkedBills.length === 0) return {}

  const res = await fetch('/api/bills/forecast-amounts', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ year, month, bills }),
  })
  return parseJsonOrThrow(res)
}

// Returns the effective amount for a bill in a given month.
// Priority: manual bill_amounts entry → linked-card statement projection →
//           forecast-derived → fixed_amount → null (variable).
// The card-statement projection lets a credit-card bill auto-fill from the
// statement balance projected for its linked card, while a manual entry still wins.
export function resolveBillAmount(bill, billAmountsMap, forecastAmountsMap = {}, cardStatementMap = {}) {
  // A forecast-linked bill is driven by its forecast — the Bills-tab link is the
  // source of truth, so a stale per-month entry must not mask it. (Credit-card
  // statement projections below are estimates a manual entry may still override.)
  const forecastAmt = bill.forecast_category_id != null ? forecastAmountsMap[bill.id] : null
  if (forecastAmt != null) return forecastAmt
  // For actuals-linked bills the category-transaction total (injected into
  // billAmountsMap by loadOutflowSeries) wins over both fixed_amount and card
  // projections — the actual beats any estimate.
  if (bill.actuals_category != null && billAmountsMap[bill.id] != null) return billAmountsMap[bill.id]
  // Manual per-month entries apply only to plain variable bills. A stored amount
  // on a fixed bill is stale data from a prior variable config and must not
  // override the fixed amount (otherwise it double-counts in trends/schedule).
  if (bill.fixed_amount == null && billAmountsMap[bill.id] != null) return billAmountsMap[bill.id]
  if (cardStatementMap[bill.id] != null) return cardStatementMap[bill.id]
  return bill.fixed_amount ?? null
}

// Given a list of bills and their resolved amounts, splits them into
// the two semi-monthly periods defined by the user's pay schedule.
// period 1: bills whose pay_day <= midpoint (default 15)
// period 2: bills whose pay_day > midpoint
export function splitBillsByPeriod(bills, billAmountsMap, midpoint = 15, forecastAmountsMap = {}, cardStatementMap = {}) {
  const period1 = []
  const period2 = []

  for (const bill of bills) {
    const amount = resolveBillAmount(bill, billAmountsMap, forecastAmountsMap, cardStatementMap)
    const entry = { ...bill, resolvedAmount: amount }
    if (bill.pay_day <= midpoint) {
      period1.push(entry)
    } else {
      period2.push(entry)
    }
  }

  return { period1, period2 }
}

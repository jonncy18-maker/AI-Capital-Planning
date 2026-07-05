// ─── Income actuals (one cash-inflow figure per month) ────────────────────────
// Income = cash inflow. Historical months are pulled from transactions; any month
// can be manually adjusted. Forecast (future) months are derived live from the
// salary/bonus assumptions in Settings (see incomeForecast.js) and are not stored.
//
// Neon-backed client seam fronting app/api/income-actuals/route.js and
// app/api/income-actuals/transactions/route.js (Neon Auth session cookie via
// credentials: 'include' — no token handling). `userId` params are kept for
// signature compatibility with existing callers even though the routes derive
// the real identity from the session itself.

async function parseJsonOrThrow(res) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return body
}

export async function getIncomeActualsRange(_userId, startYear, endYear) {
  const params = new URLSearchParams({ startYear, endYear })
  const res = await fetch(`/api/income-actuals?${params.toString()}`, { credentials: 'include' })
  const data = await parseJsonOrThrow(res)
  return data ?? []
}

export async function upsertIncomeActual(_userId, year, month, amount, source = 'manual') {
  const res = await fetch('/api/income-actuals', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ year, month, amount, source }),
  })
  return parseJsonOrThrow(res)
}

export async function deleteIncomeActual(_userId, year, month) {
  const params = new URLSearchParams({ year, month })
  const res = await fetch(`/api/income-actuals?${params.toString()}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  await parseJsonOrThrow(res)
}

// Positive (income) transactions in a date range, for the "pull from history"
// action. Caller aggregates by month and drops excluded categories.
export async function getIncomeTransactions(_userId, startDate, endDate) {
  const params = new URLSearchParams({ startDate, endDate })
  const res = await fetch(`/api/income-actuals/transactions?${params.toString()}`, {
    credentials: 'include',
  })
  const data = await parseJsonOrThrow(res)
  return data ?? []
}

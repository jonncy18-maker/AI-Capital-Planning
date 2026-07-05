// Neon-backed client seam for forecast_line_items, fronting
// app/api/forecast-line-items/route.js (+ [id], seed, reset, by-label,
// set-rate sub-routes). `userId` params are kept for signature
// compatibility with existing callers even though the routes derive the
// real identity from the Neon Auth session cookie (credentials: 'include').
//
// The forecast is an independent dataset: its own line items, seeded once from
// the budget and edited independently thereafter. Budget edits never flow into
// the forecast, and forecast edits never touch the budget.

async function parseJsonOrThrow(res) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return body
}

export async function getForecastLineItems(_userId, year) {
  const res = await fetch(`/api/forecast-line-items?year=${encodeURIComponent(year)}`, {
    credentials: 'include',
  })
  const data = await parseJsonOrThrow(res)
  return data ?? []
}

// True when a forecast already exists for the year (i.e. it has been initialized).
export async function hasForecastForYear(_userId, year) {
  const res = await fetch(
    `/api/forecast-line-items?year=${encodeURIComponent(year)}&hasForecast=true`,
    { credentials: 'include' }
  )
  const data = await parseJsonOrThrow(res)
  return !!data?.hasForecast
}

export async function insertForecastLineItem(_userId, { year, categoryId, month, amount, label, note }) {
  const res = await fetch('/api/forecast-line-items', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      year,
      categoryId,
      month,
      amount,
      label: label ?? null,
      note: note ?? null,
    }),
  })
  return parseJsonOrThrow(res)
}

export async function updateForecastLineItem(id, { amount, label, note }) {
  const patch = {}
  if (amount !== undefined) patch.amount = amount
  if (label !== undefined) patch.label = label
  if (note !== undefined) patch.note = note

  const res = await fetch(`/api/forecast-line-items/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
  return parseJsonOrThrow(res)
}

export async function deleteForecastLineItem(id) {
  const res = await fetch(`/api/forecast-line-items/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error || `Request failed (${res.status})`)
  }
}

// Seed the forecast for a year by copying the budget line items. Used the first
// time a user initializes the forecast (or when resetting it back to the budget).
// Returns the freshly inserted forecast rows (with their category joined).
export async function seedForecastFromBudget(_userId, year) {
  const res = await fetch('/api/forecast-line-items/seed', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ year }),
  })
  const data = await parseJsonOrThrow(res)
  return data ?? []
}

// Reset: wipe the year's forecast and re-seed it from the current budget.
export async function resetForecastToBudget(_userId, year) {
  const res = await fetch('/api/forecast-line-items/reset', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ year }),
  })
  const data = await parseJsonOrThrow(res)
  return data ?? []
}

// Delete all forecast lines for a given category + label (all months).
export async function deleteForecastItemsByLabel(_userId, { year, categoryId, label }) {
  const params = new URLSearchParams({ year: String(year), categoryId })
  if (label != null) params.set('label', label)
  const res = await fetch(`/api/forecast-line-items/by-label?${params.toString()}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  await parseJsonOrThrow(res)
}

// Replace all forecast lines for a given category + label in months >= fromMonth
// with a flat rate. Deletes existing rows in that range, then inserts new ones.
// Returns the freshly inserted rows.
export async function setForecastRate(_userId, { year, categoryId, label, rate, fromMonth }) {
  const res = await fetch('/api/forecast-line-items/set-rate', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ year, categoryId, label: label ?? null, rate, fromMonth }),
  })
  const data = await parseJsonOrThrow(res)
  return data ?? []
}

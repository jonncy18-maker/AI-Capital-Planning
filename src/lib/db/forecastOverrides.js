// Neon-backed client seam for forecast_overrides, fronting
// app/api/forecast-overrides/route.js. `userId` params are kept for
// signature compatibility with existing callers even though the route
// derives the real identity from the Neon Auth session cookie
// (credentials: 'include').

async function parseJsonOrThrow(res) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return body
}

export async function getForecastOverrides(_userId, year) {
  const res = await fetch(`/api/forecast-overrides?year=${encodeURIComponent(year)}`, {
    credentials: 'include',
  })
  const data = await parseJsonOrThrow(res)
  return data ?? []
}

export async function upsertForecastOverride(_userId, { categoryId, year, month, amount, note }) {
  const res = await fetch('/api/forecast-overrides', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ categoryId, year, month, amount, note: note ?? null }),
  })
  await parseJsonOrThrow(res)
}

export async function deleteForecastOverride(_userId, categoryId, year, month) {
  const params = new URLSearchParams({
    categoryId,
    year: String(year),
    month: String(month),
  })
  const res = await fetch(`/api/forecast-overrides?${params.toString()}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  await parseJsonOrThrow(res)
}

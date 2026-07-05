// Neon-backed client seam for wealth_snapshots, fronting
// app/api/wealth-snapshots/route.js and app/api/wealth-snapshots/[id]/route.js
// (Neon Auth session cookie via credentials: 'include' — no token handling).
// `userId` params are kept for signature compatibility with existing callers
// (Wealth.jsx, contextLoader.js) even though the routes derive the real
// identity from the session itself.

async function parseJsonOrThrow(res) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return body
}

export async function getWealthSnapshots(_userId, limit = 24) {
  const res = await fetch(`/api/wealth-snapshots?limit=${encodeURIComponent(limit)}`, {
    credentials: 'include',
  })
  const data = await parseJsonOrThrow(res)
  return data ?? []
}

export async function getLatestWealthSnapshot(_userId) {
  const res = await fetch('/api/wealth-snapshots?latest=true', { credentials: 'include' })
  return parseJsonOrThrow(res)
}

export async function saveWealthSnapshot(_userId, {
  snapshot_date,
  net_worth,
  investment_balance,
  retirement_balance,
  other_assets,
  liabilities,
  notes,
}) {
  const res = await fetch('/api/wealth-snapshots', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      snapshot_date,
      net_worth,
      investment_balance: investment_balance ?? null,
      retirement_balance: retirement_balance ?? null,
      other_assets: other_assets ?? null,
      liabilities: liabilities ?? null,
      notes: notes ?? null,
    }),
  })
  return parseJsonOrThrow(res)
}

export async function deleteWealthSnapshot(id) {
  const res = await fetch(`/api/wealth-snapshots/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error || `Request failed (${res.status})`)
  }
}

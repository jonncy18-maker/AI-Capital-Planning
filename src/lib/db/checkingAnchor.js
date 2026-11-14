// Neon-backed client seam for the checking balance anchor, fronting
// app/api/checking-anchor/route.js (Neon Auth session cookie via
// credentials: 'include' — no token handling).

import { apiFetch } from './apiClient.js'

async function parseJsonOrThrow(res) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return body
}

// → { account_id, as_of_date: 'YYYY-MM-DD', balance, updated_at } or null
export async function getCheckingAnchor(accountId) {
  const params = new URLSearchParams({ accountId })
  const res = await apiFetch(`/api/checking-anchor?${params}`, { credentials: 'include' })
  return parseJsonOrThrow(res)
}

export async function saveCheckingAnchor({ accountId, asOfDate, balance }) {
  const res = await apiFetch('/api/checking-anchor', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountId, asOfDate, balance }),
  })
  return parseJsonOrThrow(res)
}

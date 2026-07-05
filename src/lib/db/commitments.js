// Neon-backed client seam for commitments, fronting app/api/commitments/route.js
// and app/api/commitments/[id]/route.js (Neon Auth session cookie via
// credentials: 'include' — no token handling). `userId` params are kept for
// signature compatibility with existing callers (CashFlow.jsx, Wealth.jsx,
// Budget.jsx, Commitments.jsx) even though the routes derive the real
// identity from the session itself.

async function parseJsonOrThrow(res) {
  if (res.status === 204) return null
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return body
}

export async function getCommitments(_userId, { status = 'active' } = {}) {
  // The route defaults to status=active when the query param is absent, and
  // returns all rows when the param is present but empty. Always send the
  // param explicitly so `{ status: null }` (used by Commitments.jsx to list
  // everything) maps onto that "empty means no filter" contract.
  const params = new URLSearchParams({ status: status ?? '' })
  const res = await fetch(`/api/commitments?${params.toString()}`, { credentials: 'include' })
  const data = await parseJsonOrThrow(res)
  return data ?? []
}

export async function upsertCommitment(_userId, commitment) {
  if (commitment?.id) {
    const res = await fetch(`/api/commitments/${commitment.id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(commitment),
    })
    return parseJsonOrThrow(res)
  }

  const res = await fetch('/api/commitments', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(commitment),
  })
  return parseJsonOrThrow(res)
}

export async function deleteCommitment(id) {
  const res = await fetch(`/api/commitments/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  await parseJsonOrThrow(res)
}

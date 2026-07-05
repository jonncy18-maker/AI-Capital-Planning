// Neon-backed client seam for user_profiles, fronting app/api/profile/route.js
// (Neon Auth session cookie via credentials: 'include' — no token handling).
// `userId` params are kept for signature compatibility with existing callers
// (AppRoot.jsx, GrillSession.jsx, PayPeriodPlanner.jsx, contextLoader.js) even
// though the route derives the real identity from the session itself.

async function parseJsonOrThrow(res) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return body
}

export async function getProfile(_userId) {
  const res = await fetch('/api/profile', { credentials: 'include' })
  return parseJsonOrThrow(res)
}

export async function saveMinCheckingBalance(_userId, amount) {
  const res = await fetch('/api/profile', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ minCheckingBalance: amount }),
  })
  await parseJsonOrThrow(res)
}

export async function saveProfile(_userId, profile) {
  const res = await fetch('/api/profile', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(profile),
  })
  return parseJsonOrThrow(res)
}

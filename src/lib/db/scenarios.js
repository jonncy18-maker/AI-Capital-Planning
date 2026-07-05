// Neon-backed client seam for scenarios and scenario_adjustments, fronting
// the routes under app/api/scenarios/ (Neon Auth session cookie via
// credentials: 'include' — no token handling). `userId` params are kept for
// signature compatibility with existing callers (Scenarios.jsx, Forecast.jsx,
// scenarioAgent.js, contextLoader.js) even though each route derives the
// real identity from the session itself.

async function parseJsonOrThrow(res) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return body
}

export async function getScenarios(_userId) {
  const res = await fetch('/api/scenarios', { credentials: 'include' })
  return parseJsonOrThrow(res)
}

export async function createScenario(_userId, { name, description = '', state = 'modeled' }) {
  const res = await fetch('/api/scenarios', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, description, state }),
  })
  return parseJsonOrThrow(res)
}

export async function updateScenario(_userId, scenarioId, updates) {
  const res = await fetch(`/api/scenarios/${scenarioId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(updates),
  })
  return parseJsonOrThrow(res)
}

export async function deleteScenario(_userId, scenarioId) {
  const res = await fetch(`/api/scenarios/${scenarioId}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error || `Request failed (${res.status})`)
  }
}

export async function promoteToCommitted(_userId, scenarioId) {
  const res = await fetch(`/api/scenarios/${scenarioId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state: 'committed' }),
  })
  return parseJsonOrThrow(res)
}

export async function promoteToModeled(_userId, scenarioId) {
  const res = await fetch(`/api/scenarios/${scenarioId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state: 'modeled' }),
  })
  return parseJsonOrThrow(res)
}

export async function getAdjustments(_userId, scenarioId) {
  const res = await fetch(`/api/scenarios/${scenarioId}/adjustments`, { credentials: 'include' })
  return parseJsonOrThrow(res)
}

export async function addAdjustment(_userId, scenarioId, { category_id, month, year, delta_amount, label = '' }) {
  const res = await fetch(`/api/scenarios/${scenarioId}/adjustments`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ category_id, month, year, delta_amount, label }),
  })
  return parseJsonOrThrow(res)
}

export async function deleteAdjustment(adjustmentId) {
  const res = await fetch(`/api/scenarios/adjustments/${adjustmentId}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error || `Request failed (${res.status})`)
  }
}

export async function cloneScenario(_userId, scenarioId, { name, description = '' }) {
  const res = await fetch(`/api/scenarios/${scenarioId}/clone`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, description }),
  })
  return parseJsonOrThrow(res)
}

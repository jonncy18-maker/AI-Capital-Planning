// Neon-backed client seam for scenarios and scenario_adjustments, fronting
// the routes under app/api/scenarios/ (Neon Auth session cookie via
// credentials: 'include' — no token handling). `userId` params are kept for
// signature compatibility with existing callers (Scenarios.jsx, Forecast.jsx,
// scenarioAgent.js, contextLoader.js) even though each route derives the
// real identity from the session itself.
//
// KNOWN GAP — deleteAdjustment(adjustmentId) and cloneScenario(...) are left
// on the Supabase client below: the built DELETE route for a single
// adjustment lives at /api/scenarios/[id]/adjustments/[adjustmentId] and
// requires the parent scenarioId in the URL, but deleteAdjustment's existing
// signature/call sites only ever supply the adjustmentId. cloneScenario is a
// multi-step write (create scenario + copy adjustments) that was
// deliberately not given a dedicated route during the backend rollout. Both
// are tracked as follow-ups, not solved here.
import { supabase } from '../supabase.js'

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

// Still Supabase-backed — see KNOWN GAP note at the top of this file.
export async function deleteAdjustment(adjustmentId) {
  const { error } = await supabase
    .from('scenario_adjustments')
    .delete()
    .eq('id', adjustmentId)

  if (error) throw error
}

// Still Supabase-backed — see KNOWN GAP note at the top of this file.
export async function cloneScenario(userId, scenarioId, { name, description = '' }) {
  const newScenario = await createScenario(userId, { name, description })
  const adjs = await getAdjustments(userId, scenarioId)
  for (const adj of adjs) {
    await addAdjustment(userId, newScenario.id, {
      category_id: adj.category_id,
      month: adj.month,
      year: adj.year,
      delta_amount: adj.delta_amount,
      label: adj.label || '',
    })
  }
  return newScenario
}

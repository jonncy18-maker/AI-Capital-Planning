// Neon-backed client seam for the 5-year outlook, fronting app/api/outlook/**
// and app/api/scenarios/**/outlook-adjustments (Neon Auth session cookie via
// credentials: 'include' — no token handling).

import { apiFetch } from './apiClient.js'

async function parseJsonOrThrow(res) {
  if (res.status === 204) return null
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return body
}

function jsonRequest(method, body) {
  return {
    method,
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export async function getOutlookAssumptions() {
  const res = await apiFetch('/api/outlook/assumptions', { credentials: 'include' })
  return parseJsonOrThrow(res)
}

// patch: { inflation_rate?, income_growth_rate?, group_rates?: { [group]: rate | null } }
export async function saveOutlookAssumptions(patch) {
  const res = await apiFetch('/api/outlook/assumptions', jsonRequest('PUT', patch))
  return parseJsonOrThrow(res)
}

export async function getOutlookEvents() {
  const res = await apiFetch('/api/outlook/events', { credentials: 'include' })
  return parseJsonOrThrow(res)
}

export async function createOutlookEvent({ year, group_name, name, amount }) {
  const res = await apiFetch('/api/outlook/events', jsonRequest('POST', { year, group_name, name, amount }))
  return parseJsonOrThrow(res)
}

export async function updateOutlookEvent(id, patch) {
  const res = await apiFetch(`/api/outlook/events/${id}`, jsonRequest('PATCH', patch))
  return parseJsonOrThrow(res)
}

export async function deleteOutlookEvent(id) {
  const res = await apiFetch(`/api/outlook/events/${id}`, { method: 'DELETE', credentials: 'include' })
  await parseJsonOrThrow(res)
}

// Outlook adjustments of every committed scenario (the outlook baseline).
export async function getCommittedOutlookAdjustments() {
  const res = await apiFetch('/api/scenarios/outlook-adjustments?committed=1', { credentials: 'include' })
  return parseJsonOrThrow(res)
}

// Every outlook adjustment the user owns, across all scenarios (one request).
export async function getAllOutlookAdjustments() {
  const res = await apiFetch('/api/scenarios/outlook-adjustments', { credentials: 'include' })
  return parseJsonOrThrow(res)
}

export async function getScenarioOutlookAdjustments(scenarioId) {
  const res = await apiFetch(`/api/scenarios/${scenarioId}/outlook-adjustments`, { credentials: 'include' })
  return parseJsonOrThrow(res)
}

export async function addScenarioOutlookAdjustment(scenarioId, { year, group_name, delta_amount, label = '' }) {
  const res = await apiFetch(
    `/api/scenarios/${scenarioId}/outlook-adjustments`,
    jsonRequest('POST', { year, group_name, delta_amount, label })
  )
  return parseJsonOrThrow(res)
}

export async function deleteScenarioOutlookAdjustment(adjustmentId) {
  const res = await apiFetch(`/api/scenarios/outlook-adjustments/${adjustmentId}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  await parseJsonOrThrow(res)
}

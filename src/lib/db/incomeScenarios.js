// Neon-backed client seam for income-scenario adjustments, fronting the routes
// under app/api/scenarios/[id]/income-adjustments/. Income scenarios themselves
// are ordinary rows in the scenarios table (kind = 'income'), so they reuse
// createScenario/updateScenario/deleteScenario from scenarios.js. Only the
// per-month income deltas need their own endpoints (income has no
// budget_category to hang off of).

async function parseJsonOrThrow(res) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return body
}

export async function getIncomeAdjustments(_userId, scenarioId) {
  const res = await fetch(`/api/scenarios/${scenarioId}/income-adjustments`, { credentials: 'include' })
  return parseJsonOrThrow(res)
}

export async function addIncomeAdjustment(_userId, scenarioId, {
  year, month, income_type, gross_amount = 0, net_amount, taxable = true, label = '',
}) {
  const res = await fetch(`/api/scenarios/${scenarioId}/income-adjustments`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ year, month, income_type, gross_amount, net_amount, taxable, label }),
  })
  return parseJsonOrThrow(res)
}

export async function deleteIncomeAdjustment(_userId, scenarioId, adjId) {
  const res = await fetch(`/api/scenarios/${scenarioId}/income-adjustments/${adjId}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error || `Request failed (${res.status})`)
  }
}

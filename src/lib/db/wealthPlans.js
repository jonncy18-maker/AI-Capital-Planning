import { apiFetch } from './apiClient.js'
async function parse(res) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return body
}
export async function getWealthPlans() {
  return parse(await apiFetch('/api/wealth-plans', { credentials: 'include' }))
}
export async function saveWealthPlan(plan) {
  return parse(
    await apiFetch('/api/wealth-plans', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(plan),
    })
  )
}

// Request-body validation shared by the outlook routes. Each returns
// { value } on success or { error } with a message safe to send to the client.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isUuid = v => typeof v === 'string' && UUID_RE.test(v)

export const isFiniteNumber = v => typeof v === 'number' && Number.isFinite(v)

export function validateRate(v, field) {
  if (!isFiniteNumber(v) || v < -0.5 || v > 1.0) {
    return { error: `Field "${field}" must be a number between -0.5 and 1.0.` }
  }
  return { value: v }
}

export function validateGroupName(v, field = 'group_name') {
  if (typeof v !== 'string' || !v.trim() || v.length > 100) {
    return { error: `Field "${field}" must be a non-empty string of at most 100 characters.` }
  }
  return { value: v }
}

export function validateYear(v, field = 'year') {
  if (!Number.isInteger(v) || v < 2000 || v > 2100) {
    return { error: `Field "${field}" must be an integer between 2000 and 2100.` }
  }
  return { value: v }
}

export function validateEventName(v) {
  if (typeof v !== 'string' || !v.trim() || v.length > 200) {
    return { error: 'Field "name" must be a non-empty string of at most 200 characters.' }
  }
  return { value: v.trim() }
}

export function validateAmount(v, field) {
  if (!isFiniteNumber(v)) return { error: `Field "${field}" must be a finite number.` }
  return { value: v }
}

// group_rates patch: { [group]: rate | null }. null removes the override.
export function validateGroupRatesPatch(v) {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) {
    return { error: 'Field "group_rates" must be an object.' }
  }
  const out = {}
  for (const [key, rate] of Object.entries(v)) {
    const k = validateGroupName(key, 'group_rates key')
    if (k.error) return k
    if (rate === null) { out[key] = null; continue }
    const r = validateRate(rate, `group_rates.${key}`)
    if (r.error) return r
    out[key] = rate
  }
  return { value: out }
}

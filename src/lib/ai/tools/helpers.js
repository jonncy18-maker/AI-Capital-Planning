// Shared utilities for the AI tool registry.
//
// Tools receive raw model-authored input, so every value has to be coerced and
// clamped before it reaches the DB layer — the model can and will emit a month
// of 0, a year as a string, or a category name that only approximately matches.

export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function thisYear() {
  return new Date().getFullYear()
}

export function toYear(v) {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n > 1900 ? n : thisYear()
}

export function toMonth(v) {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(12, Math.max(1, n)) : 1
}

export function toNumber(v, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function toNullableNumber(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function money(v) {
  const n = Number(v) || 0
  const sign = n < 0 ? '−' : ''
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString()}`
}

export function signedMoney(v) {
  const n = Number(v) || 0
  return `${n >= 0 ? '+' : '−'}$${Math.abs(Math.round(n)).toLocaleString()}`
}

export function monthLabel(year, month) {
  return `${MONTH_SHORT[(toMonth(month) - 1) % 12]} ${toYear(year)}`
}

function normalize(s) {
  return (s || '').toString().trim().toLowerCase()
}

// Exact match first, then a containment match in either direction — the same
// resolution the scenario agent has always used, kept identical so category
// names the model already gets right keep resolving the same way.
export function resolveCategoryId(categories, name) {
  if (!name) return null
  const lc = normalize(name)
  const exact = (categories ?? []).find(c => normalize(c.category) === lc)
  if (exact) return exact.id
  const fuzzy = (categories ?? []).find(c => {
    const cn = normalize(c.category)
    if (cn.length < 4 || lc.length < 4) return false
    return cn.includes(lc) || lc.includes(cn)
  })
  return fuzzy ? fuzzy.id : null
}

export function findCategory(categories, name) {
  const id = resolveCategoryId(categories, name)
  return (categories ?? []).find(c => c.id === id) ?? null
}

// Generic name→record resolution for bills, accounts, cards, commitments and
// scenarios. Accepts an id outright so the model can pass back an id it read
// from lookup_data.
export function resolveByName(rows, needle, field = 'name') {
  if (!needle) return null
  const lc = normalize(needle)
  const byId = (rows ?? []).find(r => normalize(r.id) === lc)
  if (byId) return byId
  const exact = (rows ?? []).find(r => normalize(r[field]) === lc)
  if (exact) return exact
  return (rows ?? []).find(r => {
    const rn = normalize(r[field])
    if (rn.length < 4 || lc.length < 4) return false
    return rn.includes(lc) || lc.includes(rn)
  }) ?? null
}

export function requireField(input, field) {
  const v = input?.[field]
  if (v === undefined || v === null || v === '') {
    throw new Error(`Missing required field: ${field}`)
  }
  return v
}

// Preview rows are the contract between a tool and the confirmation card:
// { label, value, tone } where tone drives the value colour
// ('neutral' | 'good' | 'bad' | 'muted').
export function row(label, value, tone = 'neutral') {
  return { label, value: value === null || value === undefined || value === '' ? '—' : String(value), tone }
}

// Cash-terms tone: more spending reads bad, more income/savings reads good.
export function deltaTone(delta, isIncome = false) {
  const effective = isIncome ? Number(delta) : -Number(delta)
  return effective >= 0 ? 'good' : 'bad'
}

export function isIncomeCategoryName(categories, name) {
  const cat = findCategory(categories, name)
  return normalize(cat?.group) === 'income'
}

// Trim a list for previews so a 40-row write still renders as a readable card.
export function previewRows(rows, limit = 8) {
  if (rows.length <= limit) return { rows, overflow: 0 }
  return { rows: rows.slice(0, limit), overflow: rows.length - limit }
}

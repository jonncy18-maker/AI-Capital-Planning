// Exact money arithmetic: integer cents inside calculations, dollars at every
// boundary (API, DB, UI). Pure, no dependencies.
//
// Rounding rule (used everywhere here): round HALF AWAY FROM ZERO, applied
// once at the end of a conversion/multiply, never inside a sum. Float noise
// like 1.005*100 = 100.49999999999999 is cleaned with toPrecision(15) first,
// so 1.005 -> 101 cents and 2.675 -> 268 cents (what a human reads).

const MAX_PRECISE = 15

function roundHalfAway(v) {
  if (!Number.isFinite(v)) return 0
  const r = Math.sign(v) * Math.round(Number(Math.abs(v).toPrecision(MAX_PRECISE)))
  return r === 0 ? 0 : r // never -0
}

// Largest accepted magnitude in dollars, so cents stay integer-safe
// (1e11 dollars = 1e13 cents, far below 2^53).
export const MAX_DOLLARS = 1e11
const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i

function toNumberOrNaN(x) {
  let n = NaN
  if (typeof x === 'number') n = x
  else if (typeof x === 'string') {
    // Decimal gate: rejects '0x10', '0b1', '0o7', 'Infinity', ''.
    const s = x.trim()
    n = DECIMAL.test(s) ? Number(s) : NaN
  }
  return Number.isFinite(n) && Math.abs(n) <= MAX_DOLLARS ? n : NaN
}

// Lenient: anything unusable (or beyond +/-1e11 dollars) becomes 0 cents.
// For DB numerics (numbers / Neon numeric strings, sometimes padded) ONLY.
// Never use it on user-typed text: it silently yields 0 for junk. Use
// parseMoneyInput there.
export function toCents(x) {
  const n = toNumberOrNaN(x)
  if (!Number.isFinite(n)) return 0
  return roundHalfAway(n * 100)
}

// Strict: null for invalid input (non-numeric, blank, non-finite, or more
// than two decimal places). Negatives allowed.
export function parseCentsStrict(x) {
  const n = toNumberOrNaN(x)
  if (!Number.isFinite(n)) return null
  const scaled = n * 100
  if (Math.abs(scaled - Math.round(scaled)) > 0.000001) return null
  const c = Math.round(scaled)
  return c === 0 ? 0 : c
}

export function fromCents(c) {
  const n = Number(c)
  if (!Number.isFinite(n)) return 0
  const r = Math.round(n) / 100
  return r === 0 ? 0 : r
}

export function sumCents(list, pick) {
  let total = 0
  for (const item of list ?? []) {
    const v = Number(pick ? pick(item) : item)
    if (Number.isFinite(v)) total += Math.round(v)
  }
  return total
}

export function sumDollars(list, pick) {
  let total = 0
  for (const item of list ?? []) total += toCents(pick ? pick(item) : item)
  return fromCents(total)
}

export function addDollars(...xs) {
  return sumDollars(xs)
}

// cents * float factor (rate, ratio) -> integer cents, rounded once (half
// away from zero).
export function mulCents(cents, factor) {
  return roundHalfAway(Number(cents) * Number(factor))
}

// Split totalCents into n parts that sum exactly. Earlier buckets receive the
// extra cents (largest-remainder with equal remainders). Sign is preserved.
export function allocateCents(totalCents, n) {
  const parts = Math.floor(Number(n))
  if (!Number.isFinite(parts) || parts < 1) return []
  const total = Math.round(Number(totalCents)) || 0
  const sign = total < 0 ? -1 : 1
  const abs = Math.abs(total)
  const base = Math.floor(abs / parts)
  const rem = abs - base * parts
  return Array.from({ length: parts }, (_, i) => {
    const v = sign * (base + (i < rem ? 1 : 0))
    return v === 0 ? 0 : v
  })
}

// Mirrors src/lib/ai/tools/helpers.js `money` / `signedMoney` output (U+2212
// minus sign, whole-dollar Math.round of the magnitude) so swapping is invisible.
export function formatMoney(dollars, { decimals = 0, signed = false } = {}) {
  const n = Number(dollars) || 0
  const sign = signed ? (n >= 0 ? '+' : '−') : n < 0 ? '−' : ''
  let body
  if (decimals > 0) {
    body = (Math.abs(toCents(n)) / 100).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  } else {
    body = Math.abs(Math.round(n)).toLocaleString('en-US')
  }
  return `${sign}$${body}`
}

// "$1,234.50" -> 1234.5, "(1,234.50)" / "-1,234.50" / "1,234.50-" -> -1234.5.
// Returns null for anything invalid (never a silent 0).
export function parseMoneyInput(str) {
  if (typeof str === 'number') return Number.isFinite(str) ? fromCents(toCents(str)) : null
  if (typeof str !== 'string') return null
  let s = str.replace(/[\s$,]/g, '').replace(/−/g, '-')
  let neg = false
  if (/^\(.*\)$/.test(s)) {
    neg = true
    s = s.slice(1, -1)
  }
  if (s.startsWith('-')) {
    if (neg) return null
    neg = true
    s = s.slice(1)
  } else if (s.endsWith('-')) {
    if (neg) return null
    neg = true
    s = s.slice(0, -1)
  }
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) return null
  const v = fromCents(toCents(s))
  return neg ? (v === 0 ? 0 : -v) : v
}

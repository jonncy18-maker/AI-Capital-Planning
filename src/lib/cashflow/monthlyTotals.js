import { toCents, fromCents } from '../money.js'

// Totals for one month's transaction rows (Actuals view). Amounts may be
// numbers or numeric strings; sums are cent-exact. totalOut is returned as a
// positive magnitude; net = in - out.
export function monthlyTotals(rows) {
  let outC = 0
  let inC = 0
  for (const r of rows ?? []) {
    const c = toCents(r.amount)
    if (c < 0) outC += c
    else if (c > 0) inC += c
  }
  return { totalOut: fromCents(Math.abs(outC)), totalIn: fromCents(inC), net: fromCents(inC + outC) }
}

// Per-category totals, most negative first.
export function categoryTotals(rows) {
  const map = {}
  for (const r of rows ?? []) {
    const key = r.category || 'Uncategorized'
    if (!map[key]) map[key] = { category: key, group: r.group, cents: 0 }
    map[key].cents += toCents(r.amount)
  }
  return Object.values(map)
    .map(({ cents, ...rest }) => ({ ...rest, total: fromCents(cents) }))
    .sort((a, b) => a.total - b.total)
}

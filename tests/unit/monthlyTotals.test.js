import { describe, it, expect } from 'vitest'
import { monthlyTotals, categoryTotals } from '../../src/lib/cashflow/monthlyTotals.js'

// The pre-fix logic from CashFlow.jsx aggregateByMonth, kept to prove the bug.
function oldTotals(rows) {
  const totalOut = rows.filter(r => r.amount < 0).reduce((s, r) => s + r.amount, 0)
  const totalIn = rows.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0)
  return { totalOut: Math.abs(totalOut), totalIn, net: totalIn + totalOut }
}

const rows = [
  { amount: '-12.50', category: 'Food', group: 'Needs' },
  { amount: '-7.25', category: 'Food', group: 'Needs' },
  { amount: '100.00', category: 'Paycheck', group: 'Income' },
  { amount: '50.10', category: 'Refund', group: 'Income' },
]

describe('monthlyTotals', () => {
  it('reproduces the old string-concatenation bug', () => {
    const old = oldTotals(rows)
    // 0 + "-12.50" + "-7.25" => "0-12.50-7.25" -> Math.abs(NaN)
    expect(old.totalOut).toBeNaN()
    expect(old.totalIn).toBe('0100.0050.10') // string concatenation, not 150.10
  })
  it('totals string amounts correctly', () => {
    // out = 12.50 + 7.25 = 19.75; in = 100.00 + 50.10 = 150.10; net = 130.35
    expect(monthlyTotals(rows)).toEqual({ totalOut: 19.75, totalIn: 150.1, net: 130.35 })
  })
  it('works with number amounts and avoids float drift', () => {
    const r = [{ amount: 0.1 }, { amount: 0.2 }, { amount: -0.3 }]
    // plain: 0.1+0.2 = 0.30000000000000004
    expect(monthlyTotals(r)).toEqual({ totalOut: 0.3, totalIn: 0.3, net: 0 })
    expect(Object.is(monthlyTotals(r).net, 0)).toBe(true)
  })
  it('handles empty, null and junk rows', () => {
    expect(monthlyTotals([])).toEqual({ totalOut: 0, totalIn: 0, net: 0 })
    expect(monthlyTotals(null)).toEqual({ totalOut: 0, totalIn: 0, net: 0 })
    expect(monthlyTotals([{ amount: null }, { amount: 'x' }])).toEqual({ totalOut: 0, totalIn: 0, net: 0 })
  })
})

describe('categoryTotals', () => {
  it('sums per category with string amounts, most negative first', () => {
    expect(categoryTotals(rows)).toEqual([
      { category: 'Food', group: 'Needs', total: -19.75 },
      { category: 'Refund', group: 'Income', total: 50.1 },
      { category: 'Paycheck', group: 'Income', total: 100 },
    ])
  })
  it('buckets missing category as Uncategorized', () => {
    expect(categoryTotals([{ amount: '-1.10' }, { amount: '-2.20', category: '' }])).toEqual([
      { category: 'Uncategorized', group: undefined, total: -3.3 },
    ])
  })
})

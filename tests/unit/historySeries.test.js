import { describe, it, expect, afterAll } from 'vitest'
import { fromCents } from '../../src/lib/money.js'
import { monthlyBudgetVsActual, incomeVsExpenses } from '../../src/lib/dashboard/widgetData.js'
import {
  monthKey, monthLabel, aggregateTransactions, aggregateBudget, budgetStatus,
  rangeMonthKeys, buildHistory, buildMonthDetail, categoryTrend, categoryTransactions,
} from '../../src/lib/history/historySeries.js'
import { freezeClock, thawClock, budgetCtx, txn, TXNS_2026 } from './helpers/widgetFixtures.js'

freezeClock()
afterAll(() => thawClock())

const EXCLUDED = new Set(['Transfer'])
const NOW = new Date(2026, 5, 15)
const ctx = budgetCtx()
const merch = (t, merchant) => ({ ...t, merchant })

// 2025: data in Jan and Mar only (Feb is empty). No budget in 2025.
const TX = [
  merch(txn('2025-01-05', 'Rent', -1000), 'Landlord'),
  merch(txn('2025-01-12', 'Groceries', -200.1), 'Trader Joes'),
  merch(txn('2025-01-13', 'Groceries', -0.2), 'Trader Joes'),
  txn('2025-01-20', 'Transfer', -500),
  merch(txn('2025-01-31', 'Salary', 3000), 'Employer'),
  merch(txn('2025-03-05', 'Rent', -1000), 'Landlord'),
  merch(txn('2025-03-06', 'Groceries', 15), 'Refund Co'),
  ...TXNS_2026,
]

describe('monthKey / monthLabel', () => {
  it('parses dates as local calendar dates and rejects garbage', () => {
    expect(monthKey('2026-09-01T00:00:00.000Z')).toBe('2026-09')
    expect(monthKey('garbage')).toBeNull()
    expect(monthLabel('2026-03')).toBe('Mar 26')
  })
})

describe('aggregateTransactions', () => {
  const agg = aggregateTransactions(TX, EXCLUDED)

  it('sums monthly spend by group, category and merchant in exact cents', () => {
    const jan = agg.byMonth['2025-01']
    expect(jan.spend).toBe(120030)
    expect(jan.group).toEqual({ Housing: 100000, Food: 20030 })
    expect(jan.category).toEqual({ Rent: 100000, Groceries: 20030 })
    expect(jan.merchant).toEqual({ Landlord: 100000, 'Trader Joes': 20030 })
  })

  it('skips excluded categories and positive amounts from spend, counts positives as income', () => {
    const jan = agg.byMonth['2025-01']
    expect(jan.category.Transfer).toBeUndefined()
    expect(jan.income).toBe(300000)
    expect(agg.byMonth['2025-03'].spend).toBe(100000)
    expect(agg.byMonth['2025-03'].income).toBe(1500)
  })

  it('marks a month with any transaction as having data and an empty month as not', () => {
    expect(agg.byMonth['2025-01'].hasData).toBe(true)
    expect(agg.byMonth['2025-02']).toBeUndefined()
  })

  it('counts a month with only excluded rows as having data with zero spend', () => {
    const a = aggregateTransactions([txn('2025-05-01', 'Transfer', -50)], EXCLUDED)
    expect(a.byMonth['2025-05']).toMatchObject({ hasData: true, spend: 0, income: 0 })
  })
})

describe('budgetStatus', () => {
  it('is null without a budget', () => {
    expect(budgetStatus(500, null)).toBeNull()
  })
  it('is over above budget, under only when more than 10% below, else on', () => {
    expect(budgetStatus(101, 100)).toBe('over')
    expect(budgetStatus(100, 100)).toBe('on')
    expect(budgetStatus(90, 100)).toBe('on')
    expect(budgetStatus(89, 100)).toBe('under')
  })
})

describe('aggregateBudget', () => {
  const b = aggregateBudget(ctx.budgetLineItems)
  it('keys by year-month and keeps income lines out of the plan', () => {
    expect(b['2026-01'].total).toBe(150000)
    expect(b['2026-07'].total).toBe(150000)
    expect(b['2026-01'].category.Rent).toBe(100000)
    expect(b['2026-01'].group.Food).toBe(50000)
    expect(b['2025-01']).toBeUndefined()
  })
})

describe('rangeMonthKeys', () => {
  const agg = aggregateTransactions(TX, EXCLUDED)
  it('all spans first to last data month including gaps', () => {
    const keys = rangeMonthKeys('all', agg, NOW)
    expect(keys[0]).toBe('2025-01')
    expect(keys.at(-1)).toBe('2026-07')
    expect(keys).toContain('2025-02')
  })
  it('12 ends at the current month, fy is the calendar year of now', () => {
    expect(rangeMonthKeys('12', agg, NOW)).toHaveLength(12)
    expect(rangeMonthKeys('12', agg, NOW).at(-1)).toBe('2026-06')
    expect(rangeMonthKeys('fy', agg, NOW)).toEqual(Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`))
  })
  it('is empty when there is no data and the range is all', () => {
    expect(rangeMonthKeys('all', aggregateTransactions([], EXCLUDED), NOW)).toEqual([])
  })
})

describe('buildHistory', () => {
  const run = (groupBy, range = 'all', lineItems = ctx.budgetLineItems) => buildHistory({
    txns: TX, lineItems, excluded: EXCLUDED, groupBy, range, now: NOW,
  })

  it('overlays budget only where a budget exists and gives no status for unbudgeted months', () => {
    const h = run('category')
    const rent = h.rows.find(r => r.name === 'Rent')
    expect(rent.cells['2025-01']).toMatchObject({ actual: 100000, budget: null, status: null })
    expect(rent.cells['2026-01']).toMatchObject({ actual: 100000, budget: 100000, status: 'on' })
    const groc = h.rows.find(r => r.name === 'Groceries')
    expect(groc.cells['2026-02']).toMatchObject({ actual: 70000, budget: 40000, status: 'over' })
    expect(groc.cells['2026-03']).toMatchObject({ actual: 20000, budget: 40000, status: 'under' })
  })

  it('marks empty months as no data and skips them in totals ("N of M months")', () => {
    const h = run('group')
    const feb25 = h.columns.find(c => c.key === '2025-02')
    expect(feb25.hasData).toBe(false)
    expect(h.rows[0].cells['2025-02']).toBeUndefined()
    expect(h.totals.monthsWithData).toBe(h.columns.filter(c => c.hasData).length)
    expect(h.totals.monthsInRange).toBe(h.columns.length)
    expect(h.totals.monthsWithData).toBeLessThan(h.totals.monthsInRange)
  })

  it('computes spent, income and savings rate over data months only', () => {
    const h = run('group', 'all')
    const spent = 120030 + 100000 + 77700 + (150000 + 180000 + 130000 + 140000 + 30000 + 100000)
    expect(h.totals.spent).toBe(spent)
    expect(h.totals.income).toBe(300000 + 1500 + 300000)
    expect(h.totals.savingsRate).toBeCloseTo((h.totals.income - spent) / h.totals.income, 10)
  })

  it('has null savings rate when there is no income', () => {
    const h = buildHistory({ txns: [txn('2026-01-05', 'Rent', -10)], lineItems: [], excluded: EXCLUDED, groupBy: 'group', range: 'all', now: NOW })
    expect(h.totals.savingsRate).toBeNull()
  })

  it('compares to budget only over months that have both data and a budget', () => {
    const h = run('group', 'all')
    expect(h.vsBudget.months).toBe(6) // Jan, Feb, Mar, May, Jun, Jul 2026
    expect(h.vsBudget.budget).toBe(150000 * 6)
    expect(h.vsBudget.actual).toBe(150000 + 180000 + 130000 + 140000 + 30000 + 100000)
  })

  it('does not treat a budgeted month with no transactions as spend', () => {
    const h = run('group', 'fy')
    const apr = h.columns.find(c => c.key === '2026-04')
    expect(apr.hasData).toBe(false)
    expect(apr.budget).toBe(150000)
  })

  it('labels rows with spend but no budget in a budgeted year', () => {
    const lineItems = ctx.budgetLineItems.filter(li => li.budget_categories.category !== 'Dining')
    const h = run('category', 'fy', lineItems)
    expect(h.rows.find(r => r.name === 'Dining').noBudget).toBe(true)
    expect(h.rows.find(r => r.name === 'Rent').noBudget).toBe(false)
  })

  it('does not label rows in years with no budget', () => {
    const h = run('category')
    expect(h.rows.every(r => r.cells['2025-01'] === undefined || r.cells['2025-01'].unbudgeted === false)).toBe(true)
  })

  it('merchant mode never carries budget', () => {
    const h = run('merchant', 'fy')
    for (const r of h.rows) for (const c of Object.values(r.cells)) expect(c.budget).toBeNull()
  })

  it('sorts rows by total spend, largest first', () => {
    const totals = run('group').rows.map(r => r.total)
    expect([...totals].sort((a, b) => b - a)).toEqual(totals)
  })
})

describe('buildMonthDetail', () => {
  const d = buildMonthDetail({ txns: TX, lineItems: ctx.budgetLineItems, excluded: EXCLUDED, month: '2026-02' })
  it('lists per category planned / actual / left', () => {
    const groc = d.categories.find(c => c.name === 'Groceries')
    expect(groc).toMatchObject({ planned: 40000, actual: 70000, left: -30000 })
    expect(d.hasBudget).toBe(true)
  })
  it('splits income vs expenses and drops transfers', () => {
    const m = buildMonthDetail({ txns: TX, lineItems: [], excluded: EXCLUDED, month: '2025-01' })
    expect(m.income).toBe(300000)
    expect(m.expenses).toBe(120030)
    expect(m.hasBudget).toBe(false)
    expect(m.categories[0]).toMatchObject({ planned: null, left: null })
  })
  it('includes budgeted categories with no spend', () => {
    const m = buildMonthDetail({ txns: TX, lineItems: ctx.budgetLineItems, excluded: EXCLUDED, month: '2026-04' })
    expect(m.hasData).toBe(false)
    expect(m.categories.find(c => c.name === 'Rent')).toMatchObject({ planned: 100000, actual: 0 })
  })
})

describe('categoryTrend / categoryTransactions', () => {
  it('returns month bars with budget only where it exists', () => {
    const bars = categoryTrend({ txns: TX, lineItems: ctx.budgetLineItems, excluded: EXCLUDED, category: 'Rent', monthKeys: ['2025-01', '2026-01', '2026-04'] })
    expect(bars).toEqual([
      { key: '2025-01', actual: 100000, budget: null, hasData: true },
      { key: '2026-01', actual: 100000, budget: 100000, hasData: true },
      { key: '2026-04', actual: 0, budget: 100000, hasData: false },
    ])
  })
  it('lists the category transactions for one month, expenses only, with index keys', () => {
    const rows = categoryTransactions({ txns: TX, excluded: EXCLUDED, category: 'Groceries', month: '2025-01' })
    expect(rows.map(r => r.cents)).toEqual([20010, 20])
    expect(rows[0].index).toBeTypeOf('number')
  })
})

describe('parity with widgetData on the same fixture', () => {
  const mbva = monthlyBudgetVsActual(ctx, TXNS_2026)
  const ive = incomeVsExpenses(ctx, TXNS_2026)
  const h = buildHistory({ txns: TXNS_2026, lineItems: ctx.budgetLineItems, excluded: EXCLUDED, groupBy: 'group', range: 'fy', now: NOW })

  it('matches monthlyBudgetVsActual actual and budget (months up to the current one)', () => {
    for (const mo of mbva.months) {
      const col = h.columns[mo.month]
      expect(fromCents(col.budget)).toBe(mo.budget)
      if (mo.actual != null) expect(fromCents(col.spend)).toBe(mo.actual)
    }
  })

  it('matches incomeVsExpenses monthly income and expenses for every month', () => {
    h.columns.forEach((col, m) => {
      expect(fromCents(col.income)).toBe(ive.monthlyIncome[m])
      expect(fromCents(col.spend)).toBe(ive.monthlyExpenses[m])
    })
  })
})

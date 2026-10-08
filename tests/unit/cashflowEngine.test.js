import { describe, it, expect } from 'vitest'
import {
  daysInMonth,
  routeForecastToCards,
  computeStatementForecast,
  statementDueIn,
  projectedBillAmounts,
} from '../../src/lib/cashflow/cashflowEngine.js'

const cat = (id, extra = {}) => ({ id, category: `cat${id}`, group: 'G', is_active: true, cc_category: 'dining', ...extra })
const li = (category_id, month, amount) => ({ category_id, month, amount })
const card = (id, extra = {}) => ({ id, ...extra })

const route = (over) =>
  routeForecastToCards({
    budgetCategories: [],
    lineItems: [],
    forecastLines: [],
    cards: [card('c1', { is_default: true })],
    earnRateMap: { c1: { dining: 2 } },
    coveragePct: 80,
    optimizationPct: 100,
    ...over,
  })

describe('daysInMonth', () => {
  it('handles leap years', () => {
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2026, 12)).toBe(31)
  })
})

describe('routeForecastToCards', () => {
  it('splits spend into covered card dollars and uncovered cash (80% coverage)', () => {
    const r = route({ budgetCategories: [cat(1)], lineItems: [li(1, 1, 100)] })
    expect(r.cardDollarsByMonth.c1[1]).toBe(80)
    expect(r.cashByMonth[1]).toBe(20)
    expect(r.cashDetailByMonth[1]).toEqual([
      { categoryId: 1, name: 'cat1', group: 'G', amount: 20, kind: 'uncovered' },
    ])
  })

  it('sends cash_only categories fully to cash, and skips inactive / non-positive spend', () => {
    const r = route({
      budgetCategories: [cat(1, { cash_only: true }), cat(2, { is_active: false }), cat(3)],
      lineItems: [li(1, 2, 50), li(2, 2, 70), li(3, 2, 0), li(3, 3, -5)],
    })
    expect(r.cashByMonth[2]).toBe(50)
    expect(r.cashDetailByMonth[2]).toEqual([
      { categoryId: 1, name: 'cat1', group: 'G', amount: 50, kind: 'cash_only' },
    ])
    expect(r.cardDollarsByMonth.c1).toEqual({})
    expect(r.cashByMonth[3]).toBe(0)
  })

  it('treats all spend as cash when there are no cards', () => {
    const r = route({ budgetCategories: [cat(1)], lineItems: [li(1, 1, 40)], cards: [] })
    expect(r.cashByMonth[1]).toBe(40)
    expect(r.cashDetailByMonth[1][0].kind).toBe('cash_only')
  })

  it('splits optimized spend to the best card and the rest to the default card', () => {
    const r = route({
      budgetCategories: [cat(1)],
      lineItems: [li(1, 1, 100)],
      cards: [card('c1', { is_default: true }), card('c2')],
      earnRateMap: { c1: { dining: 1 }, c2: { dining: 3 } },
      coveragePct: 100,
      optimizationPct: 50,
    })
    expect(r.cardDollarsByMonth.c2[1]).toBe(50)
    expect(r.cardDollarsByMonth.c1[1]).toBe(50)
    expect(r.cashByMonth[1]).toBe(0)
  })

  it('honors a pinned card over earn-rate optimization', () => {
    const r = route({
      budgetCategories: [cat(1, { pinned_card_id: 'c1' })],
      lineItems: [li(1, 1, 100)],
      cards: [card('c1', { is_default: true }), card('c2')],
      earnRateMap: { c1: { dining: 1 }, c2: { dining: 3 } },
      coveragePct: 100,
    })
    expect(r.cardDollarsByMonth.c1[1]).toBe(100)
    expect(r.cardDollarsByMonth.c2).toEqual({})
  })

  it('prefers forecast lines over budget lines once a forecast exists', () => {
    const r = route({
      budgetCategories: [cat(1)],
      lineItems: [li(1, 1, 100)],
      forecastLines: [li(1, 1, 200)],
      coveragePct: 100,
    })
    expect(r.cardDollarsByMonth.c1[1]).toBe(200)
  })

  // Exactness cases below fail on the old float accumulation.
  it('ten 0.10 line items cover exactly 1.00 (no 0.9999999999999999)', () => {
    const lines = Array.from({ length: 10 }, () => li(1, 1, 0.1))
    const r = route({ budgetCategories: [cat(1)], lineItems: lines, coveragePct: 100 })
    expect(r.cardDollarsByMonth.c1[1]).toBe(1)
  })

  it('card and cash parts sum exactly to the spend (19.99 at 80% coverage)', () => {
    const r = route({ budgetCategories: [cat(1)], lineItems: [li(1, 1, '19.99')] })
    // 1999 cents * 0.8 = 1599.2 -> 1599 on card; the remaining 400 cents is cash.
    expect(r.cardDollarsByMonth.c1[1]).toBe(15.99)
    expect(r.cashByMonth[1]).toBe(4)
  })

  it('odd-cent spend: optimized + default parts always sum to the card share', () => {
    const two = {
      budgetCategories: [cat(1)],
      lineItems: [li(1, 1, '100.01')],
      cards: [card('c1', { is_default: true }), card('c2')],
      earnRateMap: { c1: { dining: 1 }, c2: { dining: 3 } },
      coveragePct: 100,
    }
    // 10001 cents, 100% coverage. 33.3%: optimized = 10001*0.333 = 3330.333 -> 3330,
    // default = remainder 6671 (6671 + 3330 = 10001).
    const a = route({ ...two, optimizationPct: 33.3 })
    expect(a.cardDollarsByMonth.c2[1]).toBe(33.3)
    expect(a.cardDollarsByMonth.c1[1]).toBe(66.71)
    // 50%: 10001*0.5 = 5000.5 -> 5001 (half away from zero); default = 10001-5001 = 5000.
    // A separate mulCents(cardable, 1-opt) would also give 5001 and create a spare cent.
    const b = route({ ...two, optimizationPct: 50 })
    expect(b.cardDollarsByMonth.c2[1]).toBe(50.01)
    expect(b.cardDollarsByMonth.c1[1]).toBe(50)
    expect(b.cashByMonth[1]).toBe(0)
  })

  it('a single uncovered cent still goes to cash (threshold is > 0 cents)', () => {
    // 100 cents at 99% coverage: cardable 99, uncovered exactly 1 cent.
    const r = route({ budgetCategories: [cat(1)], lineItems: [li(1, 1, 1)], coveragePct: 99 })
    expect(r.cardDollarsByMonth.c1[1]).toBe(0.99)
    expect(r.cashByMonth[1]).toBe(0.01)
    expect(r.cashDetailByMonth[1]).toEqual([
      { categoryId: 1, name: 'cat1', group: 'G', amount: 0.01, kind: 'uncovered' },
    ])
  })

  it('Neon-style string amounts accumulate exactly across cash items', () => {
    const cats = [1, 2, 3].map((i) => cat(i, { cash_only: true }))
    const r = route({
      budgetCategories: cats,
      lineItems: [li(1, 1, ' 0.10 '), li(2, 1, '0.20'), li(3, 1, '0.30')],
    })
    expect(r.cashByMonth[1]).toBe(0.6)
  })
})

describe('computeStatementForecast', () => {
  const cards = [card('c1', { statement_close_day: 15, due_days_after_close: 21 })]

  it('attributes spend to statements proportionally by close day', () => {
    const out = computeStatementForecast({ cardDollarsByMonth: { c1: { 1: 310 } }, cards, year: 2026 })
    const s = out.c1
    expect(s).toHaveLength(12)
    expect(s[0].balance).toBe(150) // 310 * 15/31
    expect(s[1].balance).toBe(160) // 310 * 16/31, the after-close part of January
    expect(s[2].balance).toBe(0)
    expect(s[0].closeDate).toEqual(new Date(2026, 0, 15))
    expect(s[0].dueDate).toEqual(new Date(2026, 1, 5))
  })

  it('returns an empty list for a card with no close day, and clamps close day to month length', () => {
    const out = computeStatementForecast({
      cardDollarsByMonth: {},
      cards: [card('a'), card('b', { statement_close_day: 31 })],
      year: 2026,
    })
    expect(out.a).toEqual([])
    expect(out.b[1].closeDate).toEqual(new Date(2026, 1, 28))
    expect(out.b[1].balance).toBe(0)
  })

  it('statement balances are whole cents (proration rounds once)', () => {
    const out = computeStatementForecast({ cardDollarsByMonth: { c1: { 1: 100 } }, cards, year: 2026 })
    // 100 * 15/31 = 48.387... -> 48.39 ; 100 * 16/31 = 51.612... -> 51.61
    expect(out.c1[0].balance).toBe(48.39)
    expect(out.c1[1].balance).toBe(51.61)
  })
})

describe('statement proration rounding', () => {
  it('a half cent rounds away from zero, for early and late portions', () => {
    // Feb 2026 has 28 days; close day 14 -> early = late = 14/28 = 0.5 exactly.
    // 33.33 = 3333 cents; 3333 * 0.5 = 1666.5 -> 1667 (floor would give 1666).
    const c = [card('c1', { statement_close_day: 14 })]
    const out = computeStatementForecast({ cardDollarsByMonth: { c1: { 2: 33.33 } }, cards: c, year: 2026 })
    expect(out.c1[1].balance).toBe(16.67) // Feb statement: early part of Feb spend
    expect(out.c1[2].balance).toBe(16.67) // Mar statement: late part of Feb spend
  })
})

describe('statementDueIn / projectedBillAmounts', () => {
  const cards = [card('c1', { statement_close_day: 15, due_days_after_close: 21 })]
  const statements = computeStatementForecast({ cardDollarsByMonth: { c1: { 1: 310 } }, cards, year: 2026 })

  it('finds the statement whose due date falls in the month', () => {
    const due = statementDueIn(statements.c1, 2026, 2)
    expect(due.balance).toBe(150)
    expect(due.dueDate).toEqual(new Date(2026, 1, 5))
    expect(statementDueIn(statements.c1, 2025, 2)).toBeNull()
    expect(statementDueIn(null, 2026, 2)).toBeNull()
  })

  it('sums multiple statements due in one month exactly', () => {
    const d = (m, day) => new Date(2026, m, day)
    const stmts = [
      { balance: 0.1, closeDate: d(0, 1), dueDate: d(1, 5) },
      { balance: 0.2, closeDate: d(0, 2), dueDate: d(1, 3) },
    ]
    const due = statementDueIn(stmts, 2026, 2)
    expect(due.balance).toBe(0.3)
    expect(due.dueDate).toEqual(d(1, 3))
    expect(due.closeDate).toEqual(d(0, 2))
  })

  it('maps linked bills to their projected statement amount', () => {
    const map = projectedBillAmounts({
      bills: [{ id: 'b1', credit_card_id: 'c1' }, { id: 'b2' }, { id: 'b3', credit_card_id: 'zz' }],
      statementsByCard: statements,
      year: 2026,
      month: 2,
    })
    expect(map).toEqual({ b1: 150 })
  })
})

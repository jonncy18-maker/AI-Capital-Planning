import { describe, it, expect } from 'vitest'
import {
  isIncomeAdjustment,
  cashEffect,
  grossToNet,
  computeImpactSummary,
  buildComparisonRows,
  buildCumulativeTimeline,
} from '../../src/lib/scenarios/scenarioUtils.js'

const adj = (year, month, delta, category, group, extra = {}) => ({
  year, month, delta_amount: delta, budget_categories: { category, group }, ...extra,
})
const income = (year, month, delta) => adj(year, month, delta, 'Salary', 'Income')
const spend = (year, month, delta, category = 'Auto Lease') => adj(year, month, delta, category, 'Housing')

describe('isIncomeAdjustment', () => {
  it('matches the Income group case- and whitespace-insensitively', () => {
    expect(isIncomeAdjustment(income(2026, 1, 1))).toBe(true)
    expect(isIncomeAdjustment(adj(2026, 1, 1, 'X', ' INCOME '))).toBe(true)
    expect(isIncomeAdjustment(adj(2026, 1, 1, 'X', 'income'))).toBe(true)
  })

  it('is false for spending groups and missing data', () => {
    expect(isIncomeAdjustment(spend(2026, 1, 1))).toBe(false)
    expect(isIncomeAdjustment(adj(2026, 1, 1, 'X', null))).toBe(false)
    expect(isIncomeAdjustment({})).toBe(false)
    expect(isIncomeAdjustment(null)).toBe(false)
    expect(isIncomeAdjustment(undefined)).toBe(false)
  })
})

describe('cashEffect', () => {
  it('spending +500 is 500 worse off', () => {
    expect(cashEffect(spend(2026, 1, 500))).toBe(-500)
  })

  it('income +500 is 500 better off', () => {
    expect(cashEffect(income(2026, 1, 500))).toBe(500)
  })

  it('flips both ways for negative deltas', () => {
    expect(cashEffect(spend(2026, 1, -300))).toBe(300) // cutting a bill
    expect(cashEffect(income(2026, 1, -200))).toBe(-200) // losing income
  })

  it('reads string deltas', () => {
    expect(cashEffect(spend(2026, 1, '250'))).toBe(-250)
  })

  it('is 0 for missing or non-numeric deltas', () => {
    expect(cashEffect(spend(2026, 1, undefined))).toBeCloseTo(0)
    expect(cashEffect(spend(2026, 1, 'abc'))).toBeCloseTo(0)
    expect(cashEffect(null)).toBeCloseTo(0)
  })
})

describe('grossToNet', () => {
  it('taxes by default and skips 401k: 10000 at 22% -> tax 2200, net 7800', () => {
    expect(grossToNet(10000, {}, { effectiveRate: 0.22, four01kPct: 6 })).toEqual({
      gross: 10000, tax: 2200, k401: 0, net: 7800, effRatePct: 22, k401Pct: 6,
    })
  })

  it('subtracts 401k when it applies: 6% of 10000 = 600 -> net 10000-2200-600 = 7200', () => {
    const r = grossToNet(10000, { applies401k: true }, { effectiveRate: 0.22, four01kPct: 6 })
    expect(r.k401).toBe(600)
    expect(r.net).toBe(7200)
  })

  it('skips tax when not taxable: net 10000-600 = 9400', () => {
    const r = grossToNet(10000, { taxable: false, applies401k: true }, { effectiveRate: 0.22, four01kPct: 6 })
    expect(r.tax).toBe(0)
    expect(r.net).toBe(9400)
  })

  it('returns the gross unchanged with no tax context', () => {
    const r = grossToNet(1234)
    expect(r.net).toBe(1234)
    expect(r.effRatePct).toBe(0)
  })

  it('rounds the displayed rate: 0.2349 -> 23', () => {
    expect(grossToNet(100, {}, { effectiveRate: 0.2349 }).effRatePct).toBe(23)
  })

  it('treats a non-numeric gross as 0', () => {
    expect(grossToNet('abc', {}, { effectiveRate: 0.2 }).net).toBe(0)
  })
})

describe('computeImpactSummary', () => {
  // 12000 of income across the trailing year -> 1000/mo run rate
  const ctx = {
    transactions: [
      { amount: 6000 }, { amount: 6000 }, { amount: -400 }, // expense ignored
    ],
    budgetLineItems: [
      { amount: 300, budget_categories: { category: 'Auto Lease' } },
      { amount: '200', budget_categories: { category: 'Auto Lease' } },
      { amount: 999, budget_categories: { category: 'Groceries' } }, // not in scenario
      { amount: 5000, budget_categories: { category: 'Salary' } },
    ],
  }

  it('returns a zeroed summary for no adjustments', () => {
    const s = computeImpactSummary([], ctx)
    expect(s).toMatchObject({
      netTotal: 0, monthCount: 0, cashTotal: 0, isOneTime: false, horizon: '—',
      incomeRunRate: 1000, pctOfIncome: null, hasBudget: true, hasIncome: true,
    })
    // with nothing selected, planned = every line item: 300+200+999+5000
    expect(s.budgetPlanned).toBe(6499)
  })

  it('copes with a missing ctx', () => {
    const s = computeImpactSummary([], undefined)
    expect(s.hasBudget).toBe(false)
    expect(s.hasIncome).toBe(false)
    expect(s.incomeRunRate).toBe(0)
  })

  describe('mixed spending and income across two months', () => {
    // Mar: +500 Auto Lease (cash -500), +200 Salary (cash +200); May: +100 Auto Lease (cash -100)
    const s = computeImpactSummary([spend(2026, 3, 500), income(2026, 3, 200), spend(2026, 5, 100)], ctx)

    it('sums raw deltas: 500+200+100 = 800 over 2 months', () => {
      expect(s.netTotal).toBe(800)
      expect(s.monthCount).toBe(2)
      expect(s.monthlyAvg).toBe(400)
      expect(s.annualized).toBe(4800)
    })

    it('sums cash effects: -500+200-100 = -400 -> -200/mo -> -2400/yr', () => {
      expect(s.cashTotal).toBe(-400)
      expect(s.cashMonthlyAvg).toBe(-200)
      expect(s.cashAnnualized).toBe(-2400)
      expect(s.isOneTime).toBe(false)
    })

    it('labels the horizon', () => {
      expect(s.horizon).toBe('Mar 2026 – May 2026')
    })

    it('measures affordability: |-200| / 1000 = 20%', () => {
      expect(s.incomeRunRate).toBe(1000)
      expect(s.pctOfIncome).toBeCloseTo(20)
    })

    it('plans only against touched categories: 300+200 (Auto Lease) + 5000 (Salary) = 5500', () => {
      expect(s.budgetPlanned).toBe(5500)
      // projected adds the RAW delta total (800) to planned
      expect(s.budgetProjected).toBe(6300)
    })
  })

  it('flags a single month as one-time with a single-month horizon', () => {
    const s = computeImpactSummary([income(2026, 12, 1000)], ctx)
    expect(s.isOneTime).toBe(true)
    expect(s.horizon).toBe('Dec 2026')
    expect(s.cashTotal).toBe(1000)
  })

  it('treats the same month in different years as different periods', () => {
    const s = computeImpactSummary([spend(2026, 1, 100), spend(2027, 1, 100)], ctx)
    expect(s.monthCount).toBe(2)
    expect(s.horizon).toBe('Jan 2026 – Jan 2027')
  })

  it('leaves pctOfIncome null when there is no income history', () => {
    const s = computeImpactSummary([spend(2026, 1, 100)], { transactions: [], budgetLineItems: [] })
    expect(s.pctOfIncome).toBeNull()
    expect(s.hasIncome).toBe(false)
    expect(s.hasBudget).toBe(false)
  })
})

describe('buildComparisonRows', () => {
  it('returns [] for no adjustments', () => {
    expect(buildComparisonRows([], {})).toEqual([])
  })

  it('uses the budget as baseline when no forecast exists, summing same-month lines', () => {
    const ctx = {
      budgetLineItems: [
        { month: 3, amount: 1000, budget_categories: { category: 'Auto Lease' } },
        { month: 3, amount: '200', budget_categories: { category: ' Auto Lease ' } }, // trimmed
        { month: 4, amount: 50, budget_categories: { category: 'Auto Lease' } },
      ],
    }
    const [p] = buildComparisonRows([spend(2026, 3, 500, 'Auto Lease')], ctx)
    expect(p.periodLabel).toBe('Mar 2026')
    // baseline 1000+200 = 1200; scenario 1200+500
    expect(p.rows[0]).toMatchObject({ baseline: 1200, delta: 500, scenario: 1700, cashDelta: -500, isIncome: false })
    expect(p.periodBaseline).toBe(1200)
    expect(p.periodScenario).toBe(1700)
  })

  it('prefers forecast lines over the budget once a forecast is initialized', () => {
    const ctx = {
      budgetLineItems: [{ month: 3, amount: 1000, budget_categories: { category: 'Auto Lease' } }],
      forecastLineItems: [{ month: 3, amount: 900, budget_categories: { category: 'Auto Lease' } }],
    }
    const [p] = buildComparisonRows([spend(2026, 3, 100)], ctx)
    expect(p.rows[0].baseline).toBe(900)
    expect(p.rows[0].scenario).toBe(1000)
  })

  it('has no baseline for a category absent from an initialized forecast', () => {
    const ctx = {
      budgetLineItems: [{ month: 3, amount: 1000, budget_categories: { category: 'Auto Lease' } }],
      forecastLineItems: [{ month: 3, amount: 50, budget_categories: { category: 'Other' } }],
    }
    const [p] = buildComparisonRows([spend(2026, 3, 100)], ctx)
    expect(p.rows[0].baseline).toBeNull()
    expect(p.rows[0].scenario).toBeNull()
    expect(p.periodBaseline).toBeNull()
    expect(p.periodScenario).toBeNull()
  })

  it('matches baselines by month, not just category', () => {
    const ctx = { budgetLineItems: [{ month: 4, amount: 50, budget_categories: { category: 'Auto Lease' } }] }
    const [p] = buildComparisonRows([spend(2026, 3, 100)], ctx)
    expect(p.rows[0].baseline).toBeNull()
  })

  it('totals a period across rows and uses signed cash deltas', () => {
    const ctx = { budgetLineItems: [{ month: 3, amount: 1000, budget_categories: { category: 'Auto Lease' } }] }
    const [p] = buildComparisonRows([spend(2026, 3, 500), income(2026, 3, 200)], ctx)
    expect(p.periodDelta).toBe(700) // raw: 500 + 200
    expect(p.periodCashDelta).toBe(-300) // -500 + 200
    // Semantics-preserving: periodBaseline is now explicitly the sum of
    // (baseline ?? 0). Salary (+200) has no baseline, so it adds 0 + 200:
    // periodBaseline = 1000 + 0; periodScenario = 1000 + (500 + 200) = 1700.
    expect(p.periodBaseline).toBe(1000)
    expect(p.periodScenario).toBe(p.periodBaseline + p.periodDelta)
    expect(p.periodScenario).toBe(1700)
  })

  it('period scenario equals the sum of per-row (baseline ?? 0) + delta', () => {
    const ctx = { budgetLineItems: [
      { month: 3, amount: 1000, budget_categories: { category: 'Auto Lease' } },
      { month: 3, amount: 400, budget_categories: { category: 'Food' } },
    ] }
    const adj = [
      spend(2026, 3, 100, 'Food'),
      spend(2026, 3, 50, 'Unbudgeted'),
    ]
    const [p] = buildComparisonRows(adj, ctx)
    // Food: 400 + 100 = 500; Unbudgeted: 0 + 50 = 50 -> 550
    expect(p.periodBaseline).toBe(400)
    expect(p.periodScenario).toBe(550)
  })

  it('labels a category-less adjustment with an em dash and defaults label to empty', () => {
    const [p] = buildComparisonRows([{ id: 'a1', year: 2026, month: 1, delta_amount: 10 }], {})
    expect(p.rows[0]).toMatchObject({ id: 'a1', category: '—', label: '', baseline: null, delta: 10, isIncome: false })
  })

  it('sorts periods chronologically across years', () => {
    const periods = buildComparisonRows([spend(2027, 1, 1), spend(2026, 12, 1), spend(2026, 2, 1)], {})
    expect(periods.map(p => p.periodLabel)).toEqual(['Feb 2026', 'Dec 2026', 'Jan 2027'])
  })
})

describe('buildCumulativeTimeline', () => {
  it('returns an empty timeline for no adjustments', () => {
    expect(buildCumulativeTimeline([])).toEqual({ labels: [], values: [], min: 0, max: 0 })
  })

  it('accumulates cash effects in chronological order regardless of input order', () => {
    // 2026-03: -500 + 200 = -300;  2026-05: delta -300 on spending = +300;  2027-01: +1000
    // running: -300, 0, 1000
    const tl = buildCumulativeTimeline([
      income(2027, 1, 1000),
      spend(2026, 5, -300),
      spend(2026, 3, 500),
      income(2026, 3, 200),
    ])
    expect(tl.labels).toEqual(['Mar 2026', 'May 2026', 'Jan 2027'])
    expect(tl.values).toEqual([-300, 0, 1000])
    expect(tl.min).toBe(-300)
    expect(tl.max).toBe(1000)
  })

  it('anchors min and max at 0 when everything is one-signed', () => {
    const tl = buildCumulativeTimeline([income(2026, 1, 100), income(2026, 2, 100)])
    expect(tl.values).toEqual([100, 200])
    expect(tl.min).toBe(0)
    expect(tl.max).toBe(200)
  })
})

describe('integer-cents exactness', () => {
  it('sums ten 0.1 deltas to exactly 1', () => {
    const adjs = Array.from({ length: 10 }, () => adj(2026, 1, '0.10', 'Auto', 'Housing'))
    expect(computeImpactSummary(adjs, {}).netTotal).toBe(1)
    expect(computeImpactSummary(adjs, {}).cashTotal).toBe(-1)
    expect(buildComparisonRows(adjs, {})[0].periodDelta).toBe(1)
    expect(buildCumulativeTimeline(adjs).values).toEqual([-1])
  })

  it('handles Neon-style string deltas and 19.99 x 3', () => {
    const adjs = [adj(2026, 1, ' 19.99 ', 'A', 'Fun'), adj(2026, 1, '19.99', 'B', 'Fun'), adj(2026, 1, 19.99, 'C', 'Fun')]
    expect(computeImpactSummary(adjs, {}).netTotal).toBe(59.97)
    expect(cashEffect(adj(2026, 1, '-12.50', 'A', 'Fun'))).toBe(12.5)
  })

  it('grossToNet rounds tax once to the cent', () => {
    const r = grossToNet(1000.1, {}, { effectiveRate: 0.1, four01kPct: 3 })
    expect(r.tax).toBe(100.01)
    expect(r.net).toBe(900.09)
  })

  it('baseline plus delta is exact', () => {
    const ctx = { budgetLineItems: [{ month: 1, amount: '0.10', budget_categories: { category: 'A' } }, { month: 1, amount: '0.20', budget_categories: { category: 'A' } }] }
    const row = buildComparisonRows([adj(2026, 1, '0.01', 'A', 'Fun')], ctx)[0]
    expect(row.periodBaseline).toBe(0.3)
    expect(row.periodScenario).toBe(0.31)
  })
})

describe('rounding pins', () => {
  it('grossToNet rounds an exact half cent away from zero', () => {
    // 0.05 -> 5 cents; 5 * 0.1 = 0.5 cent -> rounds to 1 cent (a floor would give 0)
    const pos = grossToNet(0.05, {}, { effectiveRate: 0.1 })
    expect(pos.tax).toBe(0.01)
    expect(pos.net).toBe(0.04)
    // -5 cents * 0.1 = -0.5 cent -> -1 cent (away from zero, not toward +inf)
    const neg = grossToNet(-0.05, {}, { effectiveRate: 0.1 })
    expect(neg.tax).toBe(-0.01)
    expect(neg.net).toBe(-0.04)
  })

  it('buildComparisonRows row.scenario is exact: baseline 0.5 + 0.2 plus delta 0.1 = 0.8', () => {
    // 50 + 20 = 70 cents baseline; + 10 cents = 80 cents (float 0.7 + 0.1 = 0.7999999999999999)
    const ctx = { budgetLineItems: [
      { month: 1, amount: 0.5, budget_categories: { category: 'A' } },
      { month: 1, amount: 0.2, budget_categories: { category: 'A' } },
    ] }
    const row = buildComparisonRows([adj(2026, 1, 0.1, 'A', 'Fun')], ctx)[0].rows[0]
    expect(row.baseline).toBe(0.7)
    expect(row.scenario).toBe(0.8)
  })
})

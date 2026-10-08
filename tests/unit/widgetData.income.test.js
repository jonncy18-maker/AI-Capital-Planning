import { describe, it, expect, afterAll, afterEach } from 'vitest'
import { incomeVsExpenses, cashFlowForecast } from '../../src/lib/dashboard/widgetData.js'
import { freezeClock, thawClock, lines, txn, adj, CATEGORIES } from './helpers/widgetFixtures.js'

// Clock frozen at 2026-06-15 12:00 local (current month index 5).
// Module-level because describes compute results at collection time.
freezeClock()
afterAll(() => thawClock())

// Income 3000 every month Jan-Jun; Rent 1000 every month Jan-Jun; Dining 200 in Mar;
// a 500 Transfer in Feb that must be ignored (exclude_from_totals).
const monthStr = (m) => `2026-${String(m).padStart(2, '0')}-01`
const TXNS_B = [
  ...[1, 2, 3, 4, 5, 6].flatMap(m => [txn(monthStr(m), 'Salary', 3000), txn(monthStr(m), 'Rent', -1000)]),
  txn('2026-02-10', 'Transfer', -500),
  txn('2026-03-10', 'Dining', -200),
]
const ctxB = (extra = {}) => ({
  thisYear: 2026,
  categories: CATEGORIES,
  budgetLineItems: lines('Rent', 1000),
  forecastLineItems: [],
  scenarios: [],
  commitments: [],
  ...extra,
})

describe('incomeVsExpenses', () => {
  describe('no salary profile (rolling-average fallback)', () => {
    const r = incomeVsExpenses(ctxB(), TXNS_B)

    it('totals year to date: income 6 x 3000, expenses 6 x 1000 + 200', () => {
      expect(r.hasData).toBe(true)
      expect(r.ytdIncome).toBe(18000)
      expect(r.ytdExpenses).toBe(6200)
      expect(r.ytdNet).toBe(11800)
      expect(r.savingsRate).toBeCloseTo((11800 / 18000) * 100) // 65.56
    })

    it('builds monthly series from transactions, excluding transfers', () => {
      expect(r.monthlyIncome).toEqual([3000, 3000, 3000, 3000, 3000, 3000, 0, 0, 0, 0, 0, 0])
      expect(r.monthlyExpenses).toEqual([1000, 1000, 1200, 1000, 1000, 1000, 0, 0, 0, 0, 0, 0])
      expect(r.currentMonth).toBe(5)
    })

    it('splits expenses into actual and forecast: 6200 + Jul-Dec 6 x 1000', () => {
      expect(r.fullYearActualExpenses).toBe(6200)
      expect(r.fullYearForecastExpenses).toBe(6000)
      expect(r.fullYearExpenses).toBe(12200)
      expect(r.monthlyExpenseForecast).toEqual(Array(12).fill(1000))
    })

    it('projects income as ytd + average of completed months x 6 remaining: 18000 + 3000 x 6', () => {
      // completed Jan-May = 15000 / 5 = 3000
      expect(r.avgMonthlyIncome).toBe(3000)
      expect(r.fullYearIncome).toBe(36000)
      expect(r.fullYearNet).toBe(23800)
      expect(r.fullYearSavingsRate).toBeCloseTo((23800 / 36000) * 100) // 66.11
      expect(r.monthlyIncomeForecast).toBeNull()
    })

    it('finds the top spending group', () => {
      expect(r.topYtdGroup).toEqual({ name: 'Housing', amount: 6000 })
    })

    it('averages expenses over elapsed months', () => {
      // BUG?: numerator includes the in-progress June (6200) but the divisor is
      // currentMonth (5), so this overstates the average. avgMonthlyIncome uses
      // completed months on both sides; expenses do not.
      expect(r.avgMonthlyExpenses).toBe(1240)
    })

    it('has no prior-year rate without prior transactions', () => {
      expect(r.priorYearSavingsRate).toBeNull()
    })
  })

  it('computes the prior-year savings rate, excluding transfers: (2000-1500)/2000 = 25%', () => {
    const prior = [txn('2025-03-01', 'Salary', 2000), txn('2025-04-01', 'Rent', -1500), txn('2025-05-01', 'Transfer', -9999)]
    expect(incomeVsExpenses(ctxB(), TXNS_B, prior).priorYearSavingsRate).toBeCloseTo(25)
  })

  it('leaves the prior-year rate null when prior income is zero', () => {
    expect(incomeVsExpenses(ctxB(), TXNS_B, [txn('2025-04-01', 'Rent', -1500)]).priorYearSavingsRate).toBeNull()
  })

  it('adds planned income lines and committed scenario income for forecast months', () => {
    // Salary 2000 planned in Aug, committed scenario +500 income in Sep:
    // 36000 + 2000 + 500. Income lines never enter the expense forecast.
    const ctx = ctxB({
      budgetLineItems: [...lines('Rent', 1000), ...lines('Salary', { 8: 2000 })],
      scenarios: [{ id: 's', state: 'committed', adjustments: [adj(2026, 9, 500, 'Salary', 'Income')] }],
    })
    const r = incomeVsExpenses(ctx, TXNS_B)
    expect(r.fullYearIncome).toBe(38500)
    expect(r.fullYearExpenses).toBe(12200)
  })

  describe('salary profile forecast', () => {
    // salary 120000 + bonus 12000 -> gross 132000, tax 33000 -> 25% effective.
    // benefits 6000/yr -> 500/mo; 401k 5% of salary -> 500/mo.
    // Normal month: 10000 - 2500 - 500 - 500 = 6500.
    const profile = { annual_income: 120000, annual_bonus: 12000, bonus_month: 3, benefits_amount: 6000, four01k_pct: 5, four01k_on_bonus: true }
    const incomeEstimate = { totalTax: 33000 }

    it('forecasts a bonus month with 401k on the bonus: 22000 - 5500 - 1100 - 500 = 14900', () => {
      const r = incomeVsExpenses(ctxB({ profile, incomeEstimate }), TXNS_B)
      expect(r.monthlyIncomeForecast).toHaveLength(12)
      expect(r.monthlyIncomeForecast[0]).toBeCloseTo(6500)
      expect(r.monthlyIncomeForecast[2]).toBeCloseTo(14900)
      expect(r.monthlyIncomeForecast[11]).toBeCloseTo(6500)
    })

    it('uses actual income for elapsed months and the forecast after: 18000 + 6 x 6500 = 57000', () => {
      const r = incomeVsExpenses(ctxB({ profile, incomeEstimate }), TXNS_B)
      expect(r.fullYearIncome).toBeCloseTo(57000)
      expect(r.fullYearNet).toBeCloseTo(44800) // 57000 - 12200
      expect(r.fullYearSavingsRate).toBeCloseTo((44800 / 57000) * 100) // 78.60
    })

    it('skips 401k on the bonus when four01k_on_bonus is false: 22000 - 5500 - 500 - 500 = 15500', () => {
      const r = incomeVsExpenses(ctxB({ profile: { ...profile, four01k_on_bonus: false }, incomeEstimate }), TXNS_B)
      expect(r.monthlyIncomeForecast[2]).toBeCloseTo(15500)
    })

    it('derives benefits from a percentage: 10% x 132000 = 13200 -> 1100/mo', () => {
      const p = { ...profile, benefits_amount: 0, benefits_pct: 10 }
      const r = incomeVsExpenses(ctxB({ profile: p, incomeEstimate }), TXNS_B)
      expect(r.monthlyIncomeForecast[0]).toBeCloseTo(5900) // 10000 - 2500 - 500 - 1100
      expect(r.monthlyIncomeForecast[2]).toBeCloseTo(14300) // 22000 - 5500 - 1100 - 1100
    })

    it('applies no bonus when bonus_month is null', () => {
      const r = incomeVsExpenses(ctxB({ profile: { ...profile, bonus_month: null }, incomeEstimate }), TXNS_B)
      expect(r.monthlyIncomeForecast.every(v => Math.abs(v - 6500) < 1e-9)).toBe(true)
    })

    it('never forecasts negative income', () => {
      // 1000 gross - 1000 (401k 100%) - 500 benefits = -500 -> clamped to 0
      const p = { annual_income: 12000, benefits_amount: 6000, four01k_pct: 100 }
      const r = incomeVsExpenses(ctxB({ profile: p, incomeEstimate: { totalTax: 0 } }), TXNS_B)
      expect(r.monthlyIncomeForecast[0]).toBe(0)
    })

    it('ignores the profile when salary is zero', () => {
      const r = incomeVsExpenses(ctxB({ profile: { annual_income: 0 } }), TXNS_B)
      expect(r.monthlyIncomeForecast).toBeNull()
      expect(r.fullYearIncome).toBe(36000)
    })
  })

  it('handles an empty ctx', () => {
    const r = incomeVsExpenses({}, [])
    expect(r.hasData).toBe(false)
    expect(r.ytdIncome).toBe(0)
    expect(r.ytdExpenses).toBe(0)
    expect(r.savingsRate).toBeNull()
    expect(r.fullYearIncome).toBe(0)
    expect(r.fullYearExpenses).toBe(0)
    expect(r.fullYearSavingsRate).toBeNull()
    expect(r.topYtdGroup).toBeNull()
    expect(r.avgMonthlyIncome).toBe(0)
  })

  it('handles undefined ctx', () => {
    expect(incomeVsExpenses(undefined).hasData).toBe(false)
  })

  it('falls back to category then "Other" when a transaction has no group', () => {
    const r = incomeVsExpenses({}, [
      { date: '2026-01-02', category: 'Coffee', amount: -30 },
      { date: '2026-01-03', amount: -10 },
    ])
    expect(r.topYtdGroup).toEqual({ name: 'Coffee', amount: 30 })
  })

  it('ytd excludes future-dated transactions but the monthly series and projection keep them', () => {
    // BUG?: a June 20 charge (after "today", June 15) is dropped from ytdExpenses
    // yet counted in monthlyExpenses and in fullYearActualExpenses via the
    // month-level actuals, so the headline numbers disagree.
    const r = incomeVsExpenses(ctxB(), [...TXNS_B, txn('2026-06-20', 'Dining', -999)])
    expect(r.ytdExpenses).toBe(6200)
    expect(r.monthlyExpenses[5]).toBe(1999)
    expect(r.fullYearActualExpenses).toBe(7199)
  })

  describe('in January (current month index 0)', () => {
    afterEach(() => freezeClock())

    it('uses the single month as the average: 3000 x 11 remaining + 3000 ytd', () => {
      thawClock()
      freezeClock(new Date(2026, 0, 20, 12))
      const r = incomeVsExpenses(ctxB(), [txn('2026-01-03', 'Salary', 3000), txn('2026-01-05', 'Rent', -1000)])
      expect(r.currentMonth).toBe(0)
      expect(r.avgMonthlyIncome).toBe(3000)
      expect(r.avgMonthlyExpenses).toBe(1000)
      expect(r.fullYearIncome).toBe(36000)
      expect(r.fullYearExpenses).toBe(12000) // 1000 actual + 11 x 1000
      expect(r.fullYearSavingsRate).toBeCloseTo((24000 / 36000) * 100)
    })
  })
})

describe('cashFlowForecast', () => {
  // Elapsed months (Jan-May) use transaction net:
  //   Jan 3000-1000=2000, Feb 2000 (transfer ignored), Mar 3000-1000-200=1800, Apr 2000, May 2000 -> 9800
  // Forecast months (Jun-Dec) use forecast income minus commitments and Non-Monthly budget items.
  const commitments = [
    { name: 'Car', status: 'active', cost_structure: { kind: 'monthly', amount: 300 } },
    { name: 'Insurance', status: 'active', cost_structure: { kind: 'annual', amount: 1200, month: 9 } },
    { name: 'Paid off', status: 'completed', cost_structure: { kind: 'monthly', amount: 999 } },
  ]
  const nonMonthly = (month, amount, label, extra = {}) => ({
    month, amount, label, budget_year: 2026, budget_categories: { category: 'Travel', type: 'Non-Monthly' }, ...extra,
  })
  const budgetLineItems = [
    ...lines('Rent', 1000), // Fixed: not a cash-flow spike item
    nonMonthly(7, 250, 'Vacation'),
    nonMonthly(7, 40, undefined), // no label -> category name
    nonMonthly(7, 5000, 'Linked', { commitment_id: 'c1' }), // owned by a commitment: skipped
    nonMonthly(7, 7777, 'Last year', { budget_year: 2025 }), // other budget year
  ]
  const ctx = (extra = {}) => ctxB({ commitments, budgetLineItems, ...extra })

  describe('no salary profile', () => {
    const r = cashFlowForecast(ctx(), TXNS_B)

    it('marks Jan-May as actual with net transaction totals', () => {
      expect(r.todayIdx).toBe(5)
      expect(r.data.slice(0, 5).map(d => d.total)).toEqual([2000, 2000, 1800, 2000, 2000])
      expect(r.data.slice(0, 5).every(d => d.isActual)).toBe(true)
      expect(r.actualNet).toBe(9800)
    })

    it('treats the current month as forecast and ignores its transactions', () => {
      // June has 3000 income / 1000 rent in TXNS_B but is forecast, so only Car 300 hits it.
      expect(r.data[5]).toMatchObject({ isActual: false, commitmentDemand: 300, budgetDemand: 0, forecastIncome: 0, total: -300 })
    })

    it('adds commitment demand and Non-Monthly budget items to forecast months', () => {
      // Jul: Car 300 + Vacation 250 + unlabeled Travel 40 = 590 out
      expect(r.data[6]).toMatchObject({ commitmentDemand: 300, budgetDemand: 290, total: -590 })
      expect(r.data[6].sources).toEqual([
        { name: 'Car', kind: 'commitment', amount: 300 },
        { name: 'Vacation', kind: 'budget', amount: 250 },
        { name: 'Travel', kind: 'budget', amount: 40 },
      ])
      // Sep: Car 300 + Insurance 1200
      expect(r.data[8].commitmentDemand).toBe(1500)
      expect(r.data[8].total).toBe(-1500)
    })

    it('skips completed commitments, linked budget lines and other budget years', () => {
      const names = r.data.flatMap(d => d.sources.map(s => s.name))
      expect(names).not.toContain('Paid off')
      expect(names).not.toContain('Linked')
      expect(names).not.toContain('Last year')
    })

    it('totals halves and nets: forecast = -(7 x 300 + 290 + 1200) = -3590', () => {
      // Jun -300, Jul -590, Aug -300, Sep -1500, Oct -300, Nov -300, Dec -300
      expect(r.forecastNet).toBe(-3590)
      expect(r.halves).toEqual([
        { label: 'H1 · JAN–JUN', total: 9500 }, // 9800 - 300
        { label: 'H2 · JUL–DEC', total: -3290 }, // -590-300-1500-300-300-300
      ])
      expect(r.max).toBe(2000)
      expect(r.hasData).toBe(true)
    })
  })

  describe('with a salary profile', () => {
    const profile = { annual_income: 120000, annual_bonus: 12000, bonus_month: 3, benefits_amount: 6000, four01k_pct: 5, four01k_on_bonus: true }
    const r = cashFlowForecast(ctx({ profile, incomeEstimate: { totalTax: 33000 } }), TXNS_B)

    it('adds post-tax income (6500/mo) to forecast months', () => {
      expect(r.data[5].forecastIncome).toBeCloseTo(6500)
      expect(r.data[5].total).toBeCloseTo(6200) // 6500 - 300
      expect(r.data[6].total).toBeCloseTo(5910) // 6500 - 590
      expect(r.data[8].total).toBeCloseTo(5000) // 6500 - 1500
    })

    it('leaves elapsed months on actual net', () => {
      expect(r.data[2].total).toBe(1800)
      expect(r.data[2].forecastIncome).toBe(0)
    })

    it('sums to forecast net 7 x 6500 - 3590 = 41910', () => {
      expect(r.forecastNet).toBeCloseTo(41910)
    })
  })

  it('stops a commitment after its end date', () => {
    const c = [{ name: 'Short', status: 'active', cost_structure: { kind: 'monthly', amount: 100 }, end_date: '2026-07-31' }]
    const r = cashFlowForecast({ thisYear: 2026, commitments: c }, [])
    expect(r.data.slice(5, 9).map(d => d.total)).toEqual([-100, -100, 0, 0]) // Jun, Jul, Aug, Sep
  })

  it('names unnamed commitments "Commitment"', () => {
    const r = cashFlowForecast({ thisYear: 2026, commitments: [{ status: 'active', cost_structure: { kind: 'monthly', amount: 5 } }] }, [])
    expect(r.data[5].sources[0].name).toBe('Commitment')
  })

  it('handles an empty ctx', () => {
    const r = cashFlowForecast({}, [])
    expect(r.data).toHaveLength(12)
    expect(r.data.every(d => d.total === 0)).toBe(true)
    expect(r.hasData).toBe(false)
    expect(r.max).toBe(1)
    expect(r.halves.map(h => h.total)).toEqual([0, 0])
    expect(r.actualNet).toBe(0)
    expect(r.forecastNet).toBe(0)
  })

  it('treats a past year as entirely actual', () => {
    const r = cashFlowForecast({ thisYear: 2025 }, [txn('2025-03-01', 'Salary', 100), txn('2026-03-01', 'Salary', 555)])
    expect(r.todayIdx).toBe(12)
    expect(r.data.every(d => d.isActual)).toBe(true)
    expect(r.data[2].total).toBe(100)
    expect(r.actualNet).toBe(100)
    expect(r.forecastNet).toBe(0)
  })

  it('shows no forecast at all for a future year', () => {
    // BUG?: any year other than the current one gets todayIdx 12, so a 2027
    // view marks every month "actual" and drops its commitments.
    const c = [{ name: 'Car', status: 'active', cost_structure: { kind: 'monthly', amount: 300 } }]
    const r = cashFlowForecast({ thisYear: 2027, commitments: c }, [])
    expect(r.todayIdx).toBe(12)
    expect(r.data.every(d => d.isActual && d.total === 0)).toBe(true)
  })
})

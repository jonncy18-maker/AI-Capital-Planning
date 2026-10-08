import { describe, it, expect, afterAll } from 'vitest'
import {
  monthlyBudgetVsActual, spendByGroupYear, spendByCategoryForGroup, yearProjection, budgetVsActual,
  incomeVsExpenses, cashFlowForecast, cashFlowSpike, commitmentsSummary, wealthSummary, scenarioImpact,
} from '../../src/lib/dashboard/widgetData.js'
import { freezeClock, thawClock, lines, txn, adj, CATEGORIES } from './helpers/widgetFixtures.js'

// Exactness tests: every money sum goes through integer cents, so classic float
// drift (0.1 + 0.2, ten x 0.1, 19.99 x 3) must not leak into the results.
// Clock frozen at 2026-06-15 12:00 local (current month index 5).
freezeClock()
afterAll(() => thawClock())

const ctx = (extra = {}) => ({
  thisYear: 2026, categories: CATEGORIES, budgetLineItems: [], forecastLineItems: [],
  scenarios: [], commitments: [], ...extra,
})
const tenTimes = (n, fn) => Array.from({ length: n }, (_, i) => fn(i))
// Ten Jan dining charges of -0.10 (a float sum of these is 0.9999999999999999).
const tenDimes = tenTimes(10, () => txn('2026-01-10', 'Dining', -0.1))

describe('monthlyBudgetVsActual exactness', () => {
  it('sums ten -0.10 charges to exactly 1', () => {
    const r = monthlyBudgetVsActual(ctx(), tenDimes)
    expect(r.months[0].actual).toBe(1)
    expect(r.ytdActual).toBe(1)
    expect(r.fullYearProjected).toBe(1)
  })

  it('sums Neon-style padded string amounts exactly', () => {
    const t = tenTimes(10, () => txn('2026-01-10', 'Dining', ' -0.10 '))
    expect(monthlyBudgetVsActual(ctx(), t).months[0].actual).toBe(1)
  })

  it('sums ten 0.10 budget lines and an 0.1 + 0.2 forecast without drift', () => {
    const budget = tenTimes(10, () => lines('Dining', { 1: '0.10' })[0])
    const forecast = [lines('Dining', { 1: 0.1 })[0], lines('Dining', { 1: 0.2 })[0]]
    const r = monthlyBudgetVsActual(ctx({ budgetLineItems: budget, forecastLineItems: forecast }), [])
    expect(r.months[0].budget).toBe(1)
    expect(r.annualBudget).toBe(1)
    expect(r.months[0].forecast).toBe(0.3)
    expect(r.annualForecast).toBe(0.3)
  })

  it('applies committed scenario deltas in cents', () => {
    const scenarios = [{
      state: 'committed',
      adjustments: [adj(2026, 8, 0.1, 'Dining', 'Food'), adj(2026, 8, 0.2, 'Dining', 'Food')],
    }]
    const r = monthlyBudgetVsActual(ctx({ scenarios, budgetLineItems: lines('Dining', 0) }), [])
    expect(r.months[7].forecast).toBe(0.3)
  })

  it('keeps percentages as unrounded floats from exact cents', () => {
    const r = monthlyBudgetVsActual(ctx({ budgetLineItems: lines('Dining', { 1: 3 }) }), [txn('2026-01-05', 'Dining', -1)])
    expect(r.ytdPct).toBeCloseTo(100 / 3, 12)
    expect(r.ytdPct).not.toBe(33.33)
  })
})

describe('yearProjection / budgetVsActual exactness', () => {
  it('adds actuals and forecast exactly', () => {
    const c = ctx({ budgetLineItems: lines('Dining', 0.1) })
    // Jan actual 1.00 from ten dimes; Feb-May no actuals so they forecast 0.10 each,
    // June (current) forecasts 0.10, Jul-Dec 0.10 each -> 11 x 0.10 + 1.00
    const r = yearProjection(c, tenDimes)
    expect(r.actualToDate).toBe(1)
    expect(r.forecastRemaining).toBe(1.1)
    expect(r.projectedTotal).toBe(2.1)
  })

  it('computes planned, variance and pct from cents', () => {
    const c = ctx({ budgetLineItems: lines('Dining', { 1: 0.1, 2: 0.2, 3: 0.4 }) })
    const r = budgetVsActual(c, [])
    expect(r.planned).toBe(0.7)
    expect(r.projected).toBe(0.7)
    expect(r.variance).toBe(0)
    expect(r.pct).toBe(100)
  })
})

describe('spendByGroupYear / spendByCategoryForGroup exactness', () => {
  it('sums actual, forecast and budget per group without drift', () => {
    const c = ctx({ budgetLineItems: lines('Dining', 0.1) })
    const r = spendByGroupYear(c, tenDimes)
    const food = r.rows.find(x => x.group === 'Food')
    expect(food.actual).toBe(1)
    expect(food.forecast).toBe(0.6) // Jul-Dec, 6 x 0.10
    expect(food.projected).toBe(1.6)
    expect(food.budget).toBe(1.2)
  })

  it('drill-down rows and group series are cent-exact', () => {
    const c = ctx({ budgetLineItems: lines('Dining', { 1: 0.1, 2: 0.2 }) })
    const r = spendByCategoryForGroup(c, tenDimes, 'Food')
    const dining = r.rows.find(x => x.category === 'Dining')
    expect(dining.actual).toBe(1)
    expect(dining.fullBudget).toBe(0.3)
    expect(dining.ytdBudget).toBe(0.3)
    expect(dining.monthlyActual[0]).toBe(1)
    expect(r.groupMonthlyActual[0]).toBe(1)
    expect(r.groupMonthlyBudget.slice(0, 2)).toEqual([0.1, 0.2])
  })
})

describe('incomeVsExpenses exactness', () => {
  it('sums income and expenses year to date exactly', () => {
    const t = [txn('2026-01-05', 'Salary', 0.1), txn('2026-02-05', 'Salary', 0.2), ...tenDimes]
    const r = incomeVsExpenses(ctx(), t)
    expect(r.ytdIncome).toBe(0.3)
    expect(r.ytdExpenses).toBe(1)
    expect(r.ytdNet).toBe(-0.7)
    expect(r.monthlyExpenses[0]).toBe(1)
    expect(r.topYtdGroup).toEqual({ name: 'Food', amount: 1 })
  })

  it('keeps savings rate and averages as unrounded floats', () => {
    // Jan income 1.01 -> 101 cents over 5 completed months = 20.2 cents, not rounded
    const r = incomeVsExpenses(ctx(), [txn('2026-01-05', 'Salary', 1.01)])
    expect(r.avgMonthlyIncome).toBeCloseTo(0.202, 12)
    expect(r.avgMonthlyIncome).not.toBe(0.2)
    expect(r.savingsRate).toBe(100)
    // fallback projection: 1.01 + round(20.2c x 6 = 121.2c) = 1.01 + 1.21
    expect(r.fullYearIncome).toBe(2.22)
  })

  it('computes prior-year savings rate from cents', () => {
    const py = [txn('2025-03-01', 'Salary', 0.3), ...tenTimes(10, () => txn('2025-03-02', 'Dining', -0.01))]
    const r = incomeVsExpenses(ctx(), [], py)
    expect(r.priorYearSavingsRate).toBeCloseTo((20 / 30) * 100, 12)
  })

  it('splits an uneven salary across 12 months so the forecast sums exactly', () => {
    // 100000.01 / 12 does not divide evenly; the parts must add back up.
    const c = ctx({ profile: { annual_income: '100000.01' } })
    const r = incomeVsExpenses(c, [])
    const cents = r.monthlyIncomeForecast.map(v => Math.round(v * 100))
    expect(cents.every((v, i) => Math.abs(v - r.monthlyIncomeForecast[i] * 100) < 1e-6)).toBe(true)
    expect(cents.reduce((a, b) => a + b, 0)).toBe(10000001)
  })

  it('applies tax, benefits and 401k per month in cents', () => {
    const c = ctx({
      profile: { annual_income: 120000, annual_bonus: 12000, bonus_month: 3, four01k_pct: 5, four01k_on_bonus: true, benefits_amount: 2400 },
      incomeEstimate: { totalTax: 33000 }, // effective rate 25%
    })
    const f = incomeVsExpenses(c, []).monthlyIncomeForecast
    // plain month: 10000 - 2500 tax - 500 401k - 200 benefits
    expect(f[0]).toBe(6800)
    // bonus month (Mar): 22000 gross - 5500 tax - (500 + 600) 401k - 200 benefits
    expect(f[2]).toBe(15200)
  })

  it('adds planned income lines and scenario deltas for forecast months exactly', () => {
    const c = ctx({
      budgetLineItems: lines('Salary', { 7: 0.1, 8: 0.2 }),
      scenarios: [{ state: 'committed', adjustments: [adj(2026, 9, 0.1, 'Salary', 'Income')] }],
      profile: { annual_income: 12000 },
    })
    const base = incomeVsExpenses(ctx({ profile: { annual_income: 12000 } }), [])
    const r = incomeVsExpenses(c, [])
    expect(r.fullYearIncome - base.fullYearIncome).toBeCloseTo(0.4, 12)
    expect(Math.round(r.fullYearIncome * 100)).toBe(r.fullYearIncome * 100)
  })
})

describe('cashFlowForecast exactness', () => {
  it('nets actual months exactly and sums halves / actualNet without drift', () => {
    const t = [txn('2026-01-05', 'Salary', 0.1), txn('2026-01-06', 'Salary', 0.2), txn('2026-02-05', 'Salary', 0.1)]
    const r = cashFlowForecast(ctx(), t)
    expect(r.data[0].total).toBe(0.3)
    expect(r.halves[0].total).toBe(0.4)
    expect(r.actualNet).toBe(0.4)
    expect(r.forecastNet).toBe(0)
  })

  it('subtracts commitment and non-monthly budget demand in cents', () => {
    const budget = [
      { ...lines('Rent', { 7: 0.1 }, { type: 'Non-Monthly' })[0] },
      { ...lines('Rent', { 7: 0.2 }, { type: 'Non-Monthly' })[0] },
    ]
    const r = cashFlowForecast(ctx({ budgetLineItems: budget }), [])
    const jul = r.data[6]
    expect(jul.budgetDemand).toBe(0.3)
    expect(jul.total).toBe(-0.3)
    expect(r.forecastNet).toBe(-0.3)
  })
})

describe('commitments / wealth / scenarios exactness', () => {
  const monthly = (name, amount) => ({ name, status: 'active', cost_structure: { kind: 'monthly', amount } })

  it('totals ten 0.10/month commitments exactly', () => {
    const commitments = tenTimes(10, i => monthly(`C${i}`, 0.1))
    const spike = cashFlowSpike({ thisYear: 2026, commitments })
    expect(spike.amount).toBe(1)
    expect(spike.yearTotal).toBe(12)
    expect(commitmentsSummary({ thisYear: 2026, commitments }).yearTotal).toBe(12)
  })

  it('adds investment and retirement balances in cents, string-safe', () => {
    const r = wealthSummary({ wealth: { net_worth: ' 1000.10 ', investment_balance: '0.1', retirement_balance: 0.2, snapshot_date: '2026-06-01' } })
    expect(r.investable).toBe(0.3)
    expect(r.netWorth).toBe(1000.1)
  })

  it('sums scenario cash effects exactly and averages unrounded', () => {
    const scenarios = [
      { name: 'S', state: 'committed', adjustments: [adj(2026, 7, 0.1, 'Salary', 'Income'), adj(2026, 8, 0.2, 'Salary', 'Income'), adj(2026, 9, 0.2, 'Salary', 'Income')] },
      { name: 'M', state: 'modeled', adjustments: [adj(2026, 7, 0.1, 'Rent', 'Housing'), adj(2026, 7, 0.2, 'Rent', 'Housing')] },
    ]
    const r = scenarioImpact({ thisYear: 2026, scenarios })
    expect(r.committed[0].netTotal).toBe(0.5)
    expect(r.committed[0].monthlyAvg).toBeCloseTo(0.5 / 3, 12)
    expect(r.committedMonthlyNet).toBeCloseTo(0.5 / 3, 12)
    expect(r.committedAnnualNet).toBe(0.5)
    expect(r.modeled[0].netTotal).toBe(-0.3)
  })
})

describe('rounding and placement pins', () => {
  it('gives the extra cents of an uneven salary split to the EARLIER months', () => {
    // 100000.01 = 10000001 cents; 10000001 / 12 = 833333 rem 5
    // -> months 0-4 get 833334 (8333.34), months 5-11 get 833333 (8333.33)
    const r = incomeVsExpenses(ctx({ profile: { annual_income: 100000.01 } }), [])
    expect(r.monthlyIncomeForecast).toEqual([
      8333.34, 8333.34, 8333.34, 8333.34, 8333.34,
      8333.33, 8333.33, 8333.33, 8333.33, 8333.33, 8333.33, 8333.33,
    ])
  })

  it('rounds a tax product landing exactly on x.5 cents half away from zero', () => {
    // salary 24.00 -> 200 cents/month; tax 0.30 / 24.00 = 1.25% -> 200 x 0.0125 = 2.5 cents
    // half away from zero -> 3 cents, so 200 - 3 = 197 cents (floor would give 198)
    const c = ctx({ profile: { annual_income: 24 }, incomeEstimate: { totalTax: 0.3 } })
    expect(incomeVsExpenses(c, []).monthlyIncomeForecast[0]).toBe(1.97)
  })

  it('keeps ytdBudget (plan) separate from ytdForecast (override) and ytdActual', () => {
    // Jan: budget 100, forecast override 150, actual 120 -> ytd 100 / 150 / 120
    const c = ctx({
      budgetLineItems: lines('Dining', { 1: 100 }),
      forecastLineItems: lines('Dining', { 1: 150 }),
    })
    const r = monthlyBudgetVsActual(c, [txn('2026-01-05', 'Dining', -120)])
    expect(r.ytdBudget).toBe(100)
    expect(r.ytdForecast).toBe(150)
    expect(r.ytdActual).toBe(120)
    expect(r.ytdPct).toBeCloseTo(80, 12)
  })

  it('rounds a sub-cent net worth to the nearest cent', () => {
    // 1234.567 -> 123456.7 cents -> 123457 -> 1234.57
    expect(wealthSummary({ wealth: { net_worth: 1234.567 } }).netWorth).toBe(1234.57)
  })

  it('keeps a group row at exactly $1.00 budget and drops one at $0.99', () => {
    const keep = spendByGroupYear(ctx({ budgetLineItems: lines('Dining', { 1: 1.0 }) }), [])
    expect(keep.rows.map(r => r.group)).toEqual(['Food'])
    const drop = spendByGroupYear(ctx({ budgetLineItems: lines('Dining', { 1: 0.99 }) }), [])
    expect(drop.rows).toEqual([])
  })
})

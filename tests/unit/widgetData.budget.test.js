import { describe, it, expect, afterAll } from 'vitest'
import {
  monthlyBudgetVsActual,
  yearProjection,
  budgetVsActual,
  spendByGroupYear,
  spendByCategoryForGroup,
  MONTHS,
} from '../../src/lib/dashboard/widgetData.js'
import { freezeClock, thawClock, budgetCtx, lines, txn, adj, TXNS_2026, CATEGORIES } from './helpers/widgetFixtures.js'

// Clock is frozen at 2026-06-15 12:00 local, so currentMonth index = 5 (June).
// Frozen at module level because several describes compute results at collection time.
freezeClock()
afterAll(() => thawClock())

// Budget per month = Rent 1000 + Groceries 400 + Dining 100 = 1500 (Salary is income, excluded).
// Actual by month (TXNS_2026): Jan 1500, Feb 1800, Mar 1300, Apr none, May 1400, Jun 300.

describe('monthlyBudgetVsActual', () => {
  it('exports twelve month labels', () => {
    expect(MONTHS).toHaveLength(12)
    expect(MONTHS[0]).toBe('Jan')
    expect(MONTHS[11]).toBe('Dec')
  })

  describe('baseline (budget only, no forecast lines)', () => {
    const r = monthlyBudgetVsActual(budgetCtx(), TXNS_2026)

    it('keeps income lines out of the expense plan', () => {
      expect(r.annualBudget).toBe(18000) // 1500 x 12, not +5000
      expect(r.forecastIncome[6]).toBe(5000)
      expect(r.hasBudget).toBe(true)
      expect(r.hasForecastOverrides).toBe(false)
      expect(r.annualForecast).toBe(18000)
    })

    it('sums actuals per month, dropping transfers, income, other years and bad dates', () => {
      expect(r.months.map(m => m.actual)).toEqual([1500, 1800, 1300, null, 1400, 300, null, null, null, null, null, null])
      expect(r.hasActuals).toBe(true)
      expect(r.currentMonth).toBe(5)
    })

    it('does not treat future-month transactions as actuals', () => {
      expect(r.months[6].hasActual).toBe(false) // July txn exists but is future
      expect(r.months[6].isFuture).toBe(true)
    })

    it('flags month position', () => {
      expect(r.months[4]).toMatchObject({ isPast: true, isCurrent: false, isFuture: false })
      expect(r.months[5]).toMatchObject({ isPast: false, isCurrent: true, isFuture: false })
      expect(r.months[6]).toMatchObject({ isPast: false, isCurrent: false, isFuture: true })
    })

    it('statuses use a +/-10% band around forecast', () => {
      // Jan 1500 vs 1500 -> on; Feb 1800 > 1650 -> over; Mar 1300 < 1350 -> under;
      // Apr no data -> none; May 1400 in [1350,1650] -> on; Jun 300 -> under.
      expect(r.months.slice(0, 7).map(m => m.status)).toEqual(['on', 'over', 'under', 'none', 'on', 'under', 'none'])
    })

    it('rolls YTD only over months with actuals: 1500+1800+1300+1400+300 = 6300 vs 5 x 1500', () => {
      expect(r.ytdActual).toBe(6300)
      expect(r.ytdBudget).toBe(7500)
      expect(r.ytdForecast).toBe(7500)
      expect(r.ytdPct).toBeCloseTo(84)
    })

    it('projects the year as actuals + forecast for the gaps: 6300 + Apr 1500 + Jul-Dec 9000 = 16800', () => {
      expect(r.fullYearProjected).toBe(16800)
      expect(r.fullYearPct).toBeCloseTo((16800 / 18000) * 100) // 93.33
      expect(r.onTrack).toBe(true)
    })

    it('reports no committed scenarios', () => {
      expect(r.committedScenarioCount).toBe(0)
      expect(r.hasCommittedScenarios).toBe(false)
      expect(r.varThreshold).toBe(10)
    })
  })

  it('honors a custom variance threshold: 50% widens the band so Feb 1800 is on', () => {
    // band = 1500 +/- 750 -> [750, 2250]; Feb 1800 on, Jun 300 under
    const r = monthlyBudgetVsActual(budgetCtx({ varianceThreshold: 50 }), TXNS_2026)
    expect(r.months[1].status).toBe('on')
    expect(r.months[5].status).toBe('under')
    expect(r.varThreshold).toBe(50)
  })

  it('goes off track when the projection passes budget by more than the threshold', () => {
    // Rent budget 100/mo = 1200/yr; Jan actual 1000 -> projected 1000 + 11 x 100 = 2100 -> 175%
    const ctx = { thisYear: 2026, categories: CATEGORIES, budgetLineItems: lines('Rent', 100) }
    const r = monthlyBudgetVsActual(ctx, [txn('2026-01-10', 'Rent', -1000)])
    expect(r.fullYearProjected).toBe(2100)
    expect(r.fullYearPct).toBeCloseTo(175)
    expect(r.onTrack).toBe(false)
  })

  describe('with forecast lines', () => {
    // Initialized forecast replaces the budget entirely: only Aug has lines.
    const forecastLineItems = [
      ...lines('Rent', { 8: 1000 }),
      ...lines('Groceries', { 8: 900 }),
      ...lines('Salary', { 9: 2000 }),
    ]
    const r = monthlyBudgetVsActual(budgetCtx({ forecastLineItems }), TXNS_2026)

    it('sums forecast lines per month instead of the budget', () => {
      expect(r.hasForecastOverrides).toBe(true)
      expect(r.annualForecast).toBe(1900)
      expect(r.months[7].forecast).toBe(1900)
      expect(r.months[7].hasOverride).toBe(true)
      expect(r.months[0].forecast).toBe(0)
    })

    it('leaves the budget series untouched', () => {
      expect(r.annualBudget).toBe(18000)
      expect(r.months[7].budget).toBe(1500)
    })

    it('has no status where the forecast is zero, even with actuals', () => {
      expect(r.months[0].status).toBe('none') // Jan: actual 1500 but forecast 0
    })

    it('projects from actuals plus the forecast: 6300 + Apr 0 + Aug 1900 = 8200', () => {
      expect(r.fullYearProjected).toBe(8200)
      expect(r.fullYearPct).toBeCloseTo((8200 / 18000) * 100)
    })

    it('routes forecast income lines to forecastIncome', () => {
      expect(r.forecastIncome[8]).toBe(2000)
      expect(r.forecastIncome[6]).toBe(0)
    })
  })

  describe('committed scenario filters', () => {
    const scenarios = [
      {
        id: 's1', state: 'committed',
        adjustments: [
          adj(2026, 8, 300, 'Rent', 'Housing'), // Aug spend +300
          adj(2026, 6, 999, 'Rent', 'Housing'), // June = current month, ignored
          adj(2025, 9, 888, 'Rent', 'Housing'), // other year, ignored
          adj(2026, 9, 2000, 'Salary', 'Income'), // goes to income deltas
        ],
      },
      { id: 's2', state: 'committed', adjustments: [adj(2026, 10, 50, 'Dining', 'Food')] },
      { id: 's3', state: 'modeled', adjustments: [adj(2026, 8, 7777, 'Rent', 'Housing')] },
    ]
    const run = (filter) => monthlyBudgetVsActual(budgetCtx({ scenarios }), TXNS_2026, filter)

    it('all: applies every committed scenario to future months only', () => {
      const r = run('all')
      expect(r.months[7].forecast).toBe(1800) // 1500 + 300
      expect(r.months[9].forecast).toBe(1550) // 1500 + 50
      expect(r.months[5].forecast).toBe(1500) // June delta not applied
      expect(r.scenarioIncomeDeltas[8]).toBe(2000)
      expect(r.committedScenarioCount).toBe(2)
      expect(r.hasCommittedScenarios).toBe(true)
    })

    it('ignores modeled scenarios', () => {
      expect(run('all').months[7].forecast).toBe(1800) // not 1800 + 7777
    })

    it('baseline: applies none but still counts committed scenarios', () => {
      const r = run('baseline')
      expect(r.months[7].forecast).toBe(1500)
      expect(r.months[9].forecast).toBe(1500)
      expect(r.scenarioIncomeDeltas[8]).toBe(0)
      expect(r.committedScenarioCount).toBe(2)
    })

    it('by id: applies only the chosen scenario', () => {
      const r = run('s2')
      expect(r.months[7].forecast).toBe(1500)
      expect(r.months[9].forecast).toBe(1550)
      expect(r.scenarioIncomeDeltas[8]).toBe(0)
    })

    it('unknown id applies nothing', () => {
      const r = run('nope')
      expect(r.months[7].forecast).toBe(1500)
      expect(r.months[9].forecast).toBe(1500)
    })

    it('feeds scenario deltas into the full-year projection', () => {
      // 16800 + 300 (Aug) + 50 (Oct)
      expect(run('all').fullYearProjected).toBe(17150)
    })
  })

  describe('empty and missing data', () => {
    it('handles an empty ctx', () => {
      const r = monthlyBudgetVsActual({}, [])
      expect(r.months).toHaveLength(12)
      expect(r.hasBudget).toBe(false)
      expect(r.hasActuals).toBe(false)
      expect(r.annualBudget).toBe(0)
      expect(r.fullYearProjected).toBe(0)
      expect(r.fullYearPct).toBeNull()
      expect(r.ytdPct).toBeNull()
      expect(r.onTrack).toBe(true)
      expect(r.year).toBe(2026) // falls back to the clock
    })

    it('handles undefined ctx and default transactions', () => {
      expect(monthlyBudgetVsActual(undefined).annualBudget).toBe(0)
    })

    it('defaults a line item with no month to January and skips out-of-range months', () => {
      const ctx = {
        thisYear: 2026,
        budgetLineItems: [
          { amount: 10, budget_categories: { group: 'X' } }, // month undefined -> Jan
          { month: 0, amount: 99, budget_categories: { group: 'X' } },
          { month: 13, amount: 99, budget_categories: { group: 'X' } },
        ],
      }
      const r = monthlyBudgetVsActual(ctx, [])
      expect(r.months[0].budget).toBe(10)
      expect(r.annualBudget).toBe(10)
    })
  })

  it('treats a past year as fully elapsed (current month = December)', () => {
    const ctx = { thisYear: 2025, categories: CATEGORIES, budgetLineItems: lines('Rent', 100, { year: 2025 }) }
    const r = monthlyBudgetVsActual(ctx, [txn('2025-03-01', 'Rent', -100)])
    expect(r.currentMonth).toBe(11)
    expect(r.months[2].actual).toBe(100)
    expect(r.months[2].status).toBe('on')
    expect(r.months[0].isPast).toBe(true)
  })

  it('never applies committed scenarios to a future year', () => {
    // BUG?: for any year other than the current one currentMonth is 11, so the
    // "future months only" scenario filter drops every adjustment for next year.
    const ctx = {
      thisYear: 2027,
      categories: CATEGORIES,
      budgetLineItems: lines('Rent', 100, { year: 2027 }),
      scenarios: [{ id: 's', state: 'committed', adjustments: [adj(2027, 3, 500, 'Rent', 'Housing')] }],
    }
    const r = monthlyBudgetVsActual(ctx, [])
    expect(r.months[2].forecast).toBe(100)
  })
})

describe('yearProjection', () => {
  it('splits actuals to date from forecast remaining', () => {
    const r = yearProjection(budgetCtx(), TXNS_2026)
    expect(r.actualToDate).toBe(6300)
    // Apr 1500 + Jul..Dec 6 x 1500 (the July txn is future so July is forecast)
    expect(r.forecastRemaining).toBe(10500)
    expect(r.projectedTotal).toBe(16800)
    expect(r.hasActuals).toBe(true)
  })

  it('counts days left to Dec 31 from the frozen clock', () => {
    // Jun 15 12:00 -> Dec 31 00:00 = 198.5 days -> rounds to 199
    expect(yearProjection(budgetCtx(), TXNS_2026).daysLeft).toBe(199)
  })

  it('handles an empty ctx', () => {
    expect(yearProjection({}, [])).toEqual({
      projectedTotal: 0, actualToDate: 0, forecastRemaining: 0, daysLeft: 199, hasActuals: false,
    })
  })
})

describe('budgetVsActual', () => {
  it('compares the non-income plan to the projection', () => {
    const r = budgetVsActual(budgetCtx(), TXNS_2026)
    expect(r.planned).toBe(18000)
    expect(r.projected).toBe(16800)
    expect(r.variance).toBe(-1200)
    expect(r.pct).toBeCloseTo(93.3333)
    expect(r.hasBudget).toBe(true)
  })

  it('reports an overspend as positive variance', () => {
    const ctx = { thisYear: 2026, categories: CATEGORIES, budgetLineItems: lines('Rent', 100) }
    const r = budgetVsActual(ctx, [txn('2026-01-10', 'Rent', -1000)])
    expect(r.planned).toBe(1200)
    expect(r.projected).toBe(2100)
    expect(r.variance).toBe(900)
  })

  it('has a null pct and hasBudget false with no budget', () => {
    const r = budgetVsActual({}, [])
    expect(r).toEqual({ planned: 0, projected: 0, variance: 0, pct: null, hasBudget: false })
  })
})

describe('spendByGroupYear', () => {
  // Housing: actual Jan,Feb,Mar,May = 4000 (Jun none; Jul txn is future) + forecast Jul-Dec 6 x 1000 = 10000 vs budget 12000
  // Food: actual 2050 + 250 = 2300 + forecast 6 x 500 = 3000 -> 5300 vs budget 6000
  const r = spendByGroupYear(budgetCtx(), TXNS_2026)

  it('builds actual + forecast per group against the annual budget', () => {
    expect(r.rows).toEqual([
      { group: 'Housing', actual: 4000, forecast: 6000, projected: 10000, budget: 12000 },
      { group: 'Food', actual: 2300, forecast: 3000, projected: 5300, budget: 6000 },
    ])
  })

  it('sorts by projection and sizes the bar scale', () => {
    expect(r.rows.map(x => x.group)).toEqual(['Housing', 'Food'])
    expect(r.max).toBe(12000)
    expect(r.totalGroups).toBe(2)
    expect(r.hasBudget).toBe(true)
  })

  it('omits Income and excluded groups', () => {
    expect(r.rows.some(x => x.group === 'Income' || x.group === 'Transfers')).toBe(false)
  })

  it('limits to topN while reporting the total group count', () => {
    const top1 = spendByGroupYear(budgetCtx(), TXNS_2026, 1)
    expect(top1.rows).toHaveLength(1)
    expect(top1.rows[0].group).toBe('Housing')
    expect(top1.totalGroups).toBe(2)
  })

  it('includes groups that have spend but no budget, and drops sub-$1 groups', () => {
    const extra = [...TXNS_2026, { date: '2026-02-03', category: 'Flights', group: 'Travel', amount: -200 },
      { date: '2026-02-04', category: 'Gum', group: 'Tiny', amount: -0.5 }]
    const rows = spendByGroupYear(budgetCtx(), extra).rows
    expect(rows.find(x => x.group === 'Travel')).toEqual({ group: 'Travel', actual: 200, forecast: 0, projected: 200, budget: 0 })
    expect(rows.find(x => x.group === 'Tiny')).toBeUndefined()
  })

  it('uses forecast lines for remaining months, falling back to budget for groups without any', () => {
    const forecastLineItems = lines('Rent', { 7: 1200, 8: 1200, 9: 1200, 10: 1200, 11: 1200, 12: 1200 })
    const rows = spendByGroupYear(budgetCtx({ forecastLineItems }), TXNS_2026).rows
    expect(rows.find(x => x.group === 'Housing').forecast).toBe(7200) // 6 x 1200
    expect(rows.find(x => x.group === 'Housing').projected).toBe(11200)
    expect(rows.find(x => x.group === 'Food').forecast).toBe(3000) // budget fallback
  })

  it('counts a month with no transactions as $0 rather than its forecast', () => {
    // BUG?: April has no data. yearProjection fills it with the 1500 forecast
    // (total 16800) but the group totals treat it as 0 (10000 + 5300 = 15300),
    // so the two dashboard figures disagree by exactly April's plan.
    const sum = r.rows.reduce((s, x) => s + x.projected, 0)
    expect(sum).toBe(15300)
    expect(yearProjection(budgetCtx(), TXNS_2026).projectedTotal - sum).toBe(1500)
  })

  it('handles an empty ctx', () => {
    expect(spendByGroupYear({}, [])).toEqual({ rows: [], max: 1, totalGroups: 0, hasBudget: false })
    expect(spendByGroupYear(undefined)).toEqual({ rows: [], max: 1, totalGroups: 0, hasBudget: false })
  })
})

describe('spendByCategoryForGroup', () => {
  const r = spendByCategoryForGroup(budgetCtx(), TXNS_2026, 'Food')

  it('breaks the group into category rows', () => {
    // Groceries: actual 450+700+200+400+300 = 2050; forecast Jul-Dec 6 x 400 = 2400; projected 4450;
    //   fullBudget 4800; ytdBudget Jan-Jun 6 x 400 = 2400
    // Dining: actual 50+100+100 = 250; forecast 6 x 100 = 600; projected 850; fullBudget 1200; ytdBudget 600
    expect(r.rows.map(x => x.category)).toEqual(['Groceries', 'Dining'])
    expect(r.rows[0]).toMatchObject({ actual: 2050, forecast: 2400, projected: 4450, fullBudget: 4800, ytdBudget: 2400 })
    expect(r.rows[1]).toMatchObject({ actual: 250, forecast: 600, projected: 850, fullBudget: 1200, ytdBudget: 600 })
  })

  it('carries per-month series', () => {
    expect(r.rows[0].monthlyActual).toEqual([450, 700, 200, 0, 400, 300, 0, 0, 0, 0, 0, 0])
    expect(r.rows[0].monthlyBudget).toEqual(Array(12).fill(400))
  })

  it('rolls up group-level monthly series and scale', () => {
    expect(r.groupMonthlyActual).toEqual([500, 800, 300, 0, 400, 300, 0, 0, 0, 0, 0, 0])
    expect(r.groupMonthlyBudget).toEqual(Array(12).fill(500))
    expect(r.max).toBe(4800)
    expect(r.currentMonth).toBe(5)
  })

  it('is empty for an unknown group', () => {
    const none = spendByCategoryForGroup(budgetCtx(), TXNS_2026, 'Nope')
    expect(none.rows).toEqual([])
    expect(none.max).toBe(1)
    expect(none.groupMonthlyActual).toEqual(Array(12).fill(0))
  })

  it('uses forecast lines per category and falls back to budget for the rest', () => {
    // Groceries forecast only 1000 in Aug -> projected 2050 + 1000; Dining falls back to budget
    const ctx = budgetCtx({ forecastLineItems: lines('Groceries', { 8: 1000 }) })
    const out = spendByCategoryForGroup(ctx, TXNS_2026, 'Food')
    const groc = out.rows.find(x => x.category === 'Groceries')
    const dine = out.rows.find(x => x.category === 'Dining')
    expect(groc.forecast).toBe(1000)
    expect(groc.projected).toBe(3050)
    expect(dine.forecast).toBe(600)
  })

  it('skips line items whose category id is unknown', () => {
    const ctx = budgetCtx({
      budgetLineItems: [{ category_id: 'ghost', month: 1, amount: 500, budget_categories: { category: 'Ghost', group: 'Food' } }],
    })
    expect(spendByCategoryForGroup(ctx, [], 'Food').rows).toEqual([])
  })

  it('shows spend with no budget and ignores excluded categories', () => {
    const txns = [
      txn('2026-02-01', 'Dining', -80),
      { date: '2026-02-02', category: 'Transfer', group: 'Food', amount: -9999 },
    ]
    const out = spendByCategoryForGroup({ thisYear: 2026, categories: CATEGORIES }, txns, 'Food')
    expect(out.rows).toHaveLength(1)
    expect(out.rows[0]).toMatchObject({ category: 'Dining', actual: 80, projected: 80, fullBudget: 0 })
  })

  it('handles an empty ctx', () => {
    expect(spendByCategoryForGroup({}, [], 'Food').rows).toEqual([])
  })
})

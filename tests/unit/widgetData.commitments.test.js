import { describe, it, expect, afterAll } from 'vitest'
import { cashFlowSpike, commitmentsSummary, wealthSummary, scenarioImpact } from '../../src/lib/dashboard/widgetData.js'
import { freezeClock, thawClock, adj } from './helpers/widgetFixtures.js'

// Clock frozen at 2026-06-15 12:00 local (current month index 5 = June).
freezeClock()
afterAll(() => thawClock())

const monthly = (name, amount, extra = {}) => ({ name, status: 'active', cost_structure: { kind: 'monthly', amount }, ...extra })
const annual = (name, amount, month, extra = {}) => ({ name, status: 'active', cost_structure: { kind: 'annual', amount, month }, ...extra })

describe('cashFlowSpike', () => {
  // Per-month demand 2026: 300 every month + Tax 2000 in Mar + Insurance 1200 in Sep
  const commitments = [
    monthly('Car', 300),
    annual('Tax', 2000, 3),
    annual('Insurance', 1200, 9),
    monthly('Paid off', 999, { status: 'completed' }),
  ]

  it('finds the biggest upcoming month, ignoring months already past', () => {
    // Mar (2300) is behind us; scanning Jun-Dec the peak is Sep: 300 + 1200
    const r = cashFlowSpike({ thisYear: 2026, commitments })
    expect(r).toMatchObject({ hasData: true, month: 'Sep', amount: 1500 })
  })

  it('totals the whole year of active commitments, past months included', () => {
    // 12 x 300 + 2000 + 1200
    expect(cashFlowSpike({ thisYear: 2026, commitments }).yearTotal).toBe(6800)
  })

  it('scans the full year for a non-current year', () => {
    const r = cashFlowSpike({ thisYear: 2027, commitments })
    expect(r).toMatchObject({ month: 'Mar', amount: 2300 })
  })

  it('picks the earliest month on a tie', () => {
    const r = cashFlowSpike({ thisYear: 2026, commitments: [annual('A', 500, 9), annual('B', 500, 7)] })
    expect(r).toMatchObject({ month: 'Jul', amount: 500 })
  })

  it('reports no spike when the only demand is behind us', () => {
    const r = cashFlowSpike({ thisYear: 2026, commitments: [annual('Tax', 2000, 3)] })
    expect(r).toEqual({ hasData: false, month: null, amount: 0, yearTotal: 2000 })
  })

  it('handles no commitments and an empty ctx', () => {
    const empty = { hasData: false, month: null, amount: 0, yearTotal: 0 }
    expect(cashFlowSpike({ thisYear: 2026, commitments: [] })).toEqual(empty)
    expect(cashFlowSpike({})).toEqual(empty)
    expect(cashFlowSpike(undefined)).toEqual(empty)
  })
})

describe('commitmentsSummary', () => {
  const commitments = [
    monthly('Car', 100), // 1200/yr
    annual('Insurance', 600, 2), // 600/yr
    monthly('Paid off', 50, { status: 'completed' }),
    monthly('Paused', 30, { status: 'paused' }),
  ]

  it('counts active vs all and totals only active demand: 1200 + 600', () => {
    expect(commitmentsSummary({ thisYear: 2026, commitments })).toEqual({ activeCount: 2, totalCount: 4, yearTotal: 1800 })
  })

  it('only counts months inside a commitment window', () => {
    // starts Jul 2026 -> Jul..Dec = 6 x 100
    const c = [monthly('Later', 100, { start_date: '2026-07-01' })]
    expect(commitmentsSummary({ thisYear: 2026, commitments: c }).yearTotal).toBe(600)
    expect(commitmentsSummary({ thisYear: 2025, commitments: c }).yearTotal).toBe(0)
  })

  it('defaults the year to the clock (2026)', () => {
    expect(commitmentsSummary({ commitments: [monthly('Car', 10)] }).yearTotal).toBe(120)
  })

  it('handles empty and missing ctx', () => {
    expect(commitmentsSummary({})).toEqual({ activeCount: 0, totalCount: 0, yearTotal: 0 })
    expect(commitmentsSummary(undefined)).toEqual({ activeCount: 0, totalCount: 0, yearTotal: 0 })
  })
})

describe('wealthSummary', () => {
  it('reports no data without a wealth snapshot', () => {
    expect(wealthSummary({})).toEqual({ hasData: false })
    expect(wealthSummary(undefined)).toEqual({ hasData: false })
    expect(wealthSummary({ wealth: null })).toEqual({ hasData: false })
  })

  it('reads net worth and sums investable = investment + retirement', () => {
    const r = wealthSummary({
      wealth: { net_worth: '250000.50', investment_balance: 100000, retirement_balance: '50000', snapshot_date: '2026-05-31' },
    })
    expect(r).toEqual({ hasData: true, netWorth: 250000.5, investable: 150000, date: '2026-05-31' })
  })

  it('treats missing or null balances as 0', () => {
    const r = wealthSummary({ wealth: { net_worth: null, investment_balance: null, retirement_balance: 40 } })
    expect(r.netWorth).toBe(0)
    expect(r.investable).toBe(40)
    expect(r.date).toBeUndefined()
  })
})

describe('scenarioImpact', () => {
  // Raise (committed): +500 income Jul, +500 income Aug, +200 rent Aug
  //   cash effects +500, +500, -200 -> net 800 over 2 distinct months -> 400/mo
  // Bonus (committed): +1000 income Dec 2026, +300 income Jan 2027
  //   net 1300 over 2 months -> 650/mo
  // Car (modeled): +400 rent Oct -> cash -400
  const scenarios = [
    {
      name: 'Raise', state: 'committed',
      adjustments: [adj(2026, 7, 500, 'Salary', 'Income'), adj(2026, 8, 500, 'Salary', 'Income'), adj(2026, 8, 200, 'Rent', 'Housing')],
    },
    {
      name: 'Bonus', state: 'committed',
      adjustments: [adj(2026, 12, 1000, 'Salary', 'Income'), adj(2027, 1, 300, 'Salary', 'Income')],
    },
    { name: 'Car', state: 'modeled', adjustments: [adj(2026, 10, 400, 'Rent', 'Housing')] },
    { name: 'Draft', state: 'draft', adjustments: [adj(2026, 10, 99999, 'Rent', 'Housing')] },
  ]

  it('returns an empty result with no scenarios', () => {
    const empty = { hasData: false, committed: [], modeled: [], committedMonthlyNet: 0, committedAnnualNet: 0, hasCommitted: false }
    expect(scenarioImpact({})).toEqual(empty)
    expect(scenarioImpact({ scenarios: [] })).toEqual(empty)
    expect(scenarioImpact(undefined)).toEqual(empty)
  })

  describe('with committed and modeled scenarios', () => {
    const r = scenarioImpact({ thisYear: 2026, scenarios })

    it('summarizes committed scenarios by signed cash effect', () => {
      expect(r.hasData).toBe(true)
      expect(r.hasCommitted).toBe(true)
      expect(r.committed).toEqual([
        { name: 'Raise', netTotal: 800, monthlyAvg: 400 },
        { name: 'Bonus', netTotal: 1300, monthlyAvg: 650 },
      ])
    })

    it('summarizes modeled scenarios separately and ignores other states', () => {
      expect(r.modeled).toEqual([{ name: 'Car', netTotal: -400 }])
    })

    it('adds monthly averages across committed scenarios: 400 + 650', () => {
      expect(r.committedMonthlyNet).toBe(1050)
    })

    it('computes the annual figure from this year only: Raise 800 + Bonus Dec 1000 = 1800', () => {
      // Jan 2027 (+300) is excluded, and no x12 extrapolation of a one-off bonus.
      expect(r.committedAnnualNet).toBe(1800)
    })
  })

  it('re-scopes the annual figure to ctx.thisYear', () => {
    // 2027 holds only the +300 Jan bonus
    expect(scenarioImpact({ thisYear: 2027, scenarios }).committedAnnualNet).toBe(300)
  })

  it('matches string years', () => {
    const s = [{ name: 'S', state: 'committed', adjustments: [adj('2026', 3, 100, 'Salary', 'Income')] }]
    expect(scenarioImpact({ thisYear: 2026, scenarios: s }).committedAnnualNet).toBe(100)
  })

  it('defaults the year to the clock', () => {
    expect(scenarioImpact({ scenarios }).committedAnnualNet).toBe(1800)
  })

  it('handles a committed scenario with no adjustments', () => {
    const r = scenarioImpact({ scenarios: [{ name: 'Empty', state: 'committed' }] })
    expect(r.committed).toEqual([{ name: 'Empty', netTotal: 0, monthlyAvg: 0 }])
    expect(r.committedMonthlyNet).toBe(0)
    expect(r.committedAnnualNet).toBe(0)
  })

  it('reports no committed totals when everything is modeled', () => {
    const r = scenarioImpact({ scenarios: [scenarios[2]] })
    expect(r.hasCommitted).toBe(false)
    expect(r.committedMonthlyNet).toBe(0)
    expect(r.committedAnnualNet).toBe(0)
    expect(r.modeled).toHaveLength(1)
  })

  it('counts a spending cut as better off', () => {
    const s = [{ name: 'Cut', state: 'committed', adjustments: [adj(2026, 7, -150, 'Rent', 'Housing')] }]
    expect(scenarioImpact({ scenarios: s }).committed[0].netTotal).toBe(150)
  })
})

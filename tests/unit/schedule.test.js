import { describe, it, expect } from 'vitest'
import {
  commitmentMonthlyDemand,
  commitmentYearSchedule,
  commitmentTotalProjected,
  aggregateCommitmentsForYear,
  describeCostStructure,
} from '../../src/lib/commitments/schedule.js'

const monthly = (amount, extra = {}) => ({ cost_structure: { kind: 'monthly', amount }, ...extra })
const zeros = (n) => Array(n).fill(0)

describe('commitmentMonthlyDemand', () => {
  describe('monthly', () => {
    it('charges the full amount every month when there are no dates', () => {
      const c = monthly(100)
      for (let m = 1; m <= 12; m++) expect(commitmentMonthlyDemand(c, 2026, m)).toBe(100)
    })

    it('accepts the legacy monthly_amount shape with no kind', () => {
      expect(commitmentMonthlyDemand({ cost_structure: { monthly_amount: 50 } }, 2026, 7)).toBe(50)
    })

    it('coerces numeric strings', () => {
      expect(commitmentMonthlyDemand(monthly('75.5'), 2026, 1)).toBeCloseTo(75.5)
    })

    it('treats non-numeric amounts as 0', () => {
      expect(commitmentMonthlyDemand(monthly('abc'), 2026, 1)).toBe(0)
    })

    it('is active only from the start month through the end month inclusive', () => {
      // start Mar 2026, end Aug 2026 -> Mar..Aug = 6 active months
      const c = monthly(100, { start_date: '2026-03-15', end_date: '2026-08-31' })
      expect(commitmentYearSchedule(c, 2026)).toEqual([0, 0, 100, 100, 100, 100, 100, 100, 0, 0, 0, 0])
    })

    it('is 0 for years entirely before the start or after the end', () => {
      const c = monthly(100, { start_date: '2026-03-01', end_date: '2026-08-31' })
      expect(commitmentYearSchedule(c, 2025)).toEqual(zeros(12))
      expect(commitmentYearSchedule(c, 2027)).toEqual(zeros(12))
    })

    it('runs open-ended forward from the start date', () => {
      const c = monthly(100, { start_date: '2026-10-01' })
      expect(commitmentYearSchedule(c, 2026)).toEqual([...zeros(9), 100, 100, 100])
      expect(commitmentYearSchedule(c, 2040)).toEqual(Array(12).fill(100))
    })

    it('runs from the beginning up to the end date when there is no start', () => {
      const c = monthly(100, { end_date: '2026-02-10' })
      expect(commitmentYearSchedule(c, 2026)).toEqual([100, 100, ...zeros(10)])
    })

    it('handles a month-end start (Jan 31 still counts January)', () => {
      const c = monthly(100, { start_date: '2026-01-31' })
      expect(commitmentMonthlyDemand(c, 2026, 1)).toBe(100)
      expect(commitmentMonthlyDemand(c, 2025, 12)).toBe(0)
    })

    it('handles a non-leap Feb 28 end date: Feb active, Mar not', () => {
      const c = monthly(100, { end_date: '2026-02-28' })
      expect(commitmentMonthlyDemand(c, 2026, 2)).toBe(100)
      expect(commitmentMonthlyDemand(c, 2026, 3)).toBe(0)
    })

    it('handles a leap-year Feb 29 end date: Feb active, Mar not', () => {
      const c = monthly(100, { end_date: '2028-02-29' })
      expect(commitmentMonthlyDemand(c, 2028, 2)).toBe(100)
      expect(commitmentMonthlyDemand(c, 2028, 3)).toBe(0)
    })

    it('handles a leap-day start date: Feb active, Jan not', () => {
      const c = monthly(100, { start_date: '2028-02-29' })
      expect(commitmentMonthlyDemand(c, 2028, 1)).toBe(0)
      expect(commitmentMonthlyDemand(c, 2028, 2)).toBe(100)
    })

    it('reads ISO timestamps by their calendar day, not UTC', () => {
      const c = monthly(100, { start_date: '2026-09-01T00:00:00.000Z' })
      expect(commitmentMonthlyDemand(c, 2026, 8)).toBe(0)
      expect(commitmentMonthlyDemand(c, 2026, 9)).toBe(100)
    })
  })

  describe('annual', () => {
    it('charges only in the due month', () => {
      const c = { cost_structure: { kind: 'annual', amount: 1200, month: 4 } }
      expect(commitmentYearSchedule(c, 2026)).toEqual([0, 0, 0, 1200, ...zeros(8)])
    })

    it('defaults the due month to January', () => {
      const c = { cost_structure: { kind: 'annual', amount: 600 } }
      expect(commitmentYearSchedule(c, 2026)).toEqual([600, ...zeros(11)])
    })

    it('accepts the legacy annual_total / due_month shape', () => {
      const c = { cost_structure: { annual_total: 600, due_month: 11 } }
      expect(commitmentMonthlyDemand(c, 2026, 11)).toBe(600)
      expect(commitmentMonthlyDemand(c, 2026, 10)).toBe(0)
    })

    it('does not charge when the due month falls outside the active window', () => {
      const c = {
        cost_structure: { kind: 'annual', amount: 1200, month: 4 },
        start_date: '2026-06-01',
      }
      expect(commitmentYearSchedule(c, 2026)).toEqual(zeros(12))
      expect(commitmentMonthlyDemand(c, 2027, 4)).toBe(1200)
    })
  })

  describe('total', () => {
    it('spreads evenly across a 12-month span', () => {
      // 1200 over Jan..Dec 2026 = 100/mo
      const c = { cost_structure: { kind: 'total', amount: 1200 }, start_date: '2026-01-01', end_date: '2026-12-31' }
      expect(commitmentYearSchedule(c, 2026)).toEqual(Array(12).fill(100))
    })

    it('counts months across a year boundary inclusively', () => {
      // Nov 2026 .. Feb 2027 = (2027-2026)*12 + (1-10) + 1 = 4 months; 400/4 = 100
      const c = { cost_structure: { kind: 'total', amount: 400 }, start_date: '2026-11-15', end_date: '2027-02-10' }
      expect(commitmentYearSchedule(c, 2026)).toEqual([...zeros(10), 100, 100])
      expect(commitmentYearSchedule(c, 2027)).toEqual([100, 100, ...zeros(10)])
    })

    it('treats a single-month span as one month holding the whole amount', () => {
      const c = { cost_structure: { kind: 'total', amount: 500 }, start_date: '2026-05-01', end_date: '2026-05-31' }
      expect(commitmentMonthlyDemand(c, 2026, 5)).toBe(500)
    })

    it('is 0 when either date is missing', () => {
      expect(commitmentMonthlyDemand({ cost_structure: { kind: 'total', amount: 500 }, start_date: '2026-01-01' }, 2026, 3)).toBe(0)
      expect(commitmentMonthlyDemand({ cost_structure: { kind: 'total', amount: 500 }, end_date: '2026-12-01' }, 2026, 3)).toBe(0)
    })
  })

  describe('custom', () => {
    const c = { cost_structure: { kind: 'custom', schedule: { 1: 10, 6: 60, 12: 120 } } }

    it('uses explicit per-month amounts and 0 for unlisted months', () => {
      expect(commitmentYearSchedule(c, 2026)).toEqual([10, 0, 0, 0, 0, 60, 0, 0, 0, 0, 0, 120])
    })

    it('handles a missing or non-numeric schedule', () => {
      expect(commitmentMonthlyDemand({ cost_structure: { kind: 'custom' } }, 2026, 1)).toBe(0)
      expect(commitmentMonthlyDemand({ cost_structure: { kind: 'custom', schedule: { 1: 'x' } } }, 2026, 1)).toBe(0)
    })

    it('still respects the active window', () => {
      const bounded = { ...c, end_date: '2026-03-31' }
      expect(commitmentYearSchedule(bounded, 2026)).toEqual([10, ...zeros(11)])
    })
  })

  describe('empty or unknown shapes', () => {
    it('is 0 with no cost_structure, an empty one, or an unknown kind', () => {
      expect(commitmentMonthlyDemand({}, 2026, 1)).toBe(0)
      expect(commitmentMonthlyDemand({ cost_structure: null }, 2026, 1)).toBe(0)
      expect(commitmentMonthlyDemand({ cost_structure: {} }, 2026, 1)).toBe(0)
      expect(commitmentMonthlyDemand({ cost_structure: { kind: 'weekly', amount: 10 } }, 2026, 1)).toBe(0)
    })
  })

  it('still counts completed commitments (status is not consulted)', () => {
    // BUG?: isActiveInMonth has an empty `status === 'completed'` branch, so a
    // completed commitment keeps producing demand. Callers filter by status.
    expect(commitmentMonthlyDemand(monthly(100, { status: 'completed' }), 2026, 1)).toBe(100)
  })
})

describe('commitmentYearSchedule', () => {
  it('returns exactly 12 entries, Jan first', () => {
    const s = commitmentYearSchedule(monthly(10), 2026)
    expect(s).toHaveLength(12)
    expect(s.reduce((a, b) => a + b, 0)).toBe(120)
  })
})

describe('commitmentTotalProjected', () => {
  it('returns the stated amount for a total commitment, dates or not', () => {
    expect(commitmentTotalProjected({ cost_structure: { kind: 'total', amount: 4800 } })).toBe(4800)
  })

  it('sums a bounded monthly commitment: Mar..Aug = 6 x 100', () => {
    expect(commitmentTotalProjected(monthly(100, { start_date: '2026-03-01', end_date: '2026-08-31' }))).toBe(600)
  })

  it('projects a representative 12 months for open-ended commitments', () => {
    expect(commitmentTotalProjected(monthly(100, { start_date: '2026-01-01' }))).toBe(1200)
  })

  it('is 0 with no start date (for non-total kinds)', () => {
    expect(commitmentTotalProjected(monthly(100))).toBe(0)
  })

  it('counts each annual hit across a multi-year span: Apr 2026/27/28 = 3 x 1200', () => {
    const c = {
      cost_structure: { kind: 'annual', amount: 1200, month: 4 },
      start_date: '2026-01-01',
      end_date: '2028-12-31',
    }
    expect(commitmentTotalProjected(c)).toBe(3600)
  })

  it('sums custom schedule months inside the span: 10 + 60 + 120', () => {
    const c = {
      cost_structure: { kind: 'custom', schedule: { 1: 10, 6: 60, 12: 120 } },
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    }
    expect(commitmentTotalProjected(c)).toBe(190)
  })

  it('caps the walk at 600 months: 101 years of 10/mo -> 600 x 10', () => {
    expect(commitmentTotalProjected(monthly(10, { start_date: '2000-01-01', end_date: '2100-12-31' }))).toBe(6000)
  })

  it('is 0 for an unknown kind', () => {
    expect(commitmentTotalProjected({ cost_structure: { kind: 'x' }, start_date: '2026-01-01' })).toBe(0)
  })

  it('disagrees with the monthly demand for a total commitment missing an end date', () => {
    // BUG?: total with only a start date projects the full amount here but
    // commitmentMonthlyDemand returns 0 for every month, so Cash Flow shows
    // nothing while the summary shows the lump sum.
    const c = { cost_structure: { kind: 'total', amount: 1000 }, start_date: '2026-01-01' }
    expect(commitmentTotalProjected(c)).toBe(1000)
    expect(commitmentYearSchedule(c, 2026)).toEqual(zeros(12))
  })
})

describe('aggregateCommitmentsForYear', () => {
  it('returns 12 zeros for no commitments', () => {
    expect(aggregateCommitmentsForYear([], 2026)).toEqual(zeros(12))
  })

  it('adds schedules month by month: 100/mo + 1200 in April', () => {
    const list = [monthly(100), { cost_structure: { kind: 'annual', amount: 1200, month: 4 } }]
    expect(aggregateCommitmentsForYear(list, 2026)).toEqual([100, 100, 100, 1300, 100, 100, 100, 100, 100, 100, 100, 100])
  })

  it('respects each commitment window independently', () => {
    const list = [
      monthly(100, { end_date: '2026-03-31' }),
      monthly(50, { start_date: '2026-11-01' }),
    ]
    expect(aggregateCommitmentsForYear(list, 2026)).toEqual([100, 100, 100, ...zeros(7), 50, 50])
  })
})

describe('describeCostStructure', () => {
  it('describes monthly', () => {
    expect(describeCostStructure({ kind: 'monthly', amount: 250 })).toBe('$250/mo')
    expect(describeCostStructure({ monthly_amount: 250 })).toBe('$250/mo')
  })

  it('rounds to whole dollars', () => {
    expect(describeCostStructure({ kind: 'monthly', amount: 99.6 })).toBe('$100/mo')
  })

  it('describes annual with its month', () => {
    expect(describeCostStructure({ kind: 'annual', amount: 600, month: 4 })).toBe('$600/yr (Apr)')
    expect(describeCostStructure({ annual_total: 600, due_month: 12 })).toBe('$600/yr (Dec)')
  })

  it('defaults annual to January', () => {
    expect(describeCostStructure({ kind: 'annual', amount: 600 })).toBe('$600/yr (Jan)')
  })

  it('describes total and custom', () => {
    expect(describeCostStructure({ kind: 'total', amount: 500 })).toBe('$500 total')
    expect(describeCostStructure({ kind: 'custom', schedule: {} })).toBe('Custom schedule')
  })

  it('falls back to an em dash for empty, missing or unknown', () => {
    expect(describeCostStructure()).toBe('—')
    expect(describeCostStructure({})).toBe('—')
    expect(describeCostStructure({ kind: 'weekly' })).toBe('—')
  })

  it('prints "undefined" for an out-of-range annual month', () => {
    // BUG?: month 13 indexes past the MONTHS array.
    expect(describeCostStructure({ kind: 'annual', amount: 600, month: 13 })).toBe('$600/yr (undefined)')
  })
})

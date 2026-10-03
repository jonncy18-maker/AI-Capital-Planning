import { describe, it, expect } from 'vitest'
import {
  commitmentMonthlyDemand,
  commitmentYearSchedule,
  commitmentTotalProjected,
  aggregateCommitmentsForYear,
} from '../src/lib/commitments/schedule.js'

describe('Commitment Scheduling (schedule.js)', () => {
  describe('commitmentMonthlyDemand', () => {
    it('handles monthly cost structure', () => {
      const commitment = {
        status: 'active',
        cost_structure: { kind: 'monthly', amount: 250 },
      }
      expect(commitmentMonthlyDemand(commitment, 2026, 1)).toBe(250)
      expect(commitmentMonthlyDemand(commitment, 2026, 12)).toBe(250)
    })

    it('handles fallback monthly_amount property', () => {
      const commitment = {
        status: 'active',
        cost_structure: { monthly_amount: 150 },
      }
      expect(commitmentMonthlyDemand(commitment, 2026, 6)).toBe(150)
    })

    it('handles annual cost structure in designated month', () => {
      const commitment = {
        status: 'active',
        cost_structure: { kind: 'annual', amount: 1200, month: 7 },
      }
      expect(commitmentMonthlyDemand(commitment, 2026, 6)).toBe(0)
      expect(commitmentMonthlyDemand(commitment, 2026, 7)).toBe(1200)
      expect(commitmentMonthlyDemand(commitment, 2026, 8)).toBe(0)
    })

    it('handles total cost structure spread across date range', () => {
      // 4 months: 2026-01-01 to 2026-04-30 => 4 calendar months
      const commitment = {
        status: 'active',
        start_date: '2026-01-01',
        end_date: '2026-04-30',
        cost_structure: { kind: 'total', amount: 1000 },
      }
      expect(commitmentMonthlyDemand(commitment, 2026, 1)).toBe(250)
      expect(commitmentMonthlyDemand(commitment, 2026, 4)).toBe(250)
      expect(commitmentMonthlyDemand(commitment, 2026, 5)).toBe(0) // outside range
    })

    it('handles custom schedule mapping by month number', () => {
      const commitment = {
        status: 'active',
        cost_structure: {
          kind: 'custom',
          schedule: { '3': 500, '9': 750 },
        },
      }
      expect(commitmentMonthlyDemand(commitment, 2026, 1)).toBe(0)
      expect(commitmentMonthlyDemand(commitment, 2026, 3)).toBe(500)
      expect(commitmentMonthlyDemand(commitment, 2026, 9)).toBe(750)
    })

    it('respects start_date and end_date activity boundaries', () => {
      const commitment = {
        status: 'active',
        start_date: '2026-03-01',
        end_date: '2026-06-30',
        cost_structure: { kind: 'monthly', amount: 100 },
      }
      expect(commitmentMonthlyDemand(commitment, 2026, 2)).toBe(0)
      expect(commitmentMonthlyDemand(commitment, 2026, 3)).toBe(100)
      expect(commitmentMonthlyDemand(commitment, 2026, 6)).toBe(100)
      expect(commitmentMonthlyDemand(commitment, 2026, 7)).toBe(0)
    })
  })

  describe('commitmentYearSchedule', () => {
    it('returns a 12-month array of cash demand', () => {
      const commitment = {
        status: 'active',
        cost_structure: { kind: 'monthly', amount: 100 },
      }
      const sched = commitmentYearSchedule(commitment, 2026)
      expect(sched).toHaveLength(12)
      expect(sched.every(val => val === 100)).toBe(true)
    })
  })

  describe('commitmentTotalProjected', () => {
    it('returns exact amount for kind=total', () => {
      const commitment = {
        cost_structure: { kind: 'total', amount: 5000 },
      }
      expect(commitmentTotalProjected(commitment)).toBe(5000)
    })

    it('calculates sum across lifespan for monthly with start and end', () => {
      const commitment = {
        status: 'active',
        start_date: '2026-01-01',
        end_date: '2026-06-30',
        cost_structure: { kind: 'monthly', amount: 200 },
      }
      expect(commitmentTotalProjected(commitment)).toBe(1200)
    })
  })

  describe('aggregateCommitmentsForYear', () => {
    it('sums multiple commitments across all 12 months', () => {
      const c1 = {
        status: 'active',
        cost_structure: { kind: 'monthly', amount: 100 },
      }
      const c2 = {
        status: 'active',
        cost_structure: { kind: 'annual', amount: 500, month: 5 },
      }
      const totals = aggregateCommitmentsForYear([c1, c2], 2026)
      expect(totals).toHaveLength(12)
      expect(totals[0]).toBe(100) // Jan
      expect(totals[4]).toBe(600) // May: 100 + 500
      expect(totals[11]).toBe(100) // Dec
    })
  })
})

import { describe, it, expect } from 'vitest'
import {
  isIncomeAdjustment,
  cashEffect,
  grossToNet,
  computeImpactSummary,
} from '../src/lib/scenarios/scenarioUtils.js'

describe('Scenario Modeling Utilities (scenarioUtils.js)', () => {
  describe('isIncomeAdjustment', () => {
    it('detects Income group case-insensitively with whitespace tolerance', () => {
      expect(isIncomeAdjustment({ budget_categories: { group: 'Income' } })).toBe(true)
      expect(isIncomeAdjustment({ budget_categories: { group: '  income ' } })).toBe(true)
      expect(isIncomeAdjustment({ budget_categories: { group: 'Housing' } })).toBe(false)
      expect(isIncomeAdjustment(null)).toBe(false)
    })
  })

  describe('cashEffect', () => {
    it('treats positive delta on Income as positive cash effect', () => {
      const adj = {
        delta_amount: 1500,
        budget_categories: { group: 'Income' },
      }
      expect(cashEffect(adj)).toBe(1500)
    })

    it('flips sign on spending categories: positive delta means negative cash effect (more spend)', () => {
      const adj = {
        delta_amount: 300,
        budget_categories: { group: 'Groceries' },
      }
      expect(cashEffect(adj)).toBe(-300)
    })

    it('treats reduction in spend (negative delta) as positive cash effect (savings)', () => {
      const adj = {
        delta_amount: -200,
        budget_categories: { group: 'Utilities' },
      }
      expect(cashEffect(adj)).toBe(200)
    })
  })

  describe('grossToNet', () => {
    it('calculates tax deduction based on effective rate', () => {
      const result = grossToNet(10000, { taxable: true, applies401k: false }, { effectiveRate: 0.25 })
      expect(result.gross).toBe(10000)
      expect(result.tax).toBe(2500)
      expect(result.k401).toBe(0)
      expect(result.net).toBe(7500)
      expect(result.effRatePct).toBe(25)
    })

    it('calculates 401k deduction when applies401k is enabled', () => {
      const result = grossToNet(10000, { taxable: true, applies401k: true }, { effectiveRate: 0.20, four01kPct: 10 })
      expect(result.gross).toBe(10000)
      expect(result.tax).toBe(2000)
      expect(result.k401).toBe(1000)
      expect(result.net).toBe(7000)
    })

    it('skips tax deduction when taxable is false', () => {
      const result = grossToNet(5000, { taxable: false, applies401k: false }, { effectiveRate: 0.30 })
      expect(result.tax).toBe(0)
      expect(result.net).toBe(5000)
    })
  })

  describe('computeImpactSummary', () => {
    it('returns empty baseline metrics when adjustments array is empty', () => {
      const summary = computeImpactSummary([], { budgetLineItems: [] })
      expect(summary.netTotal).toBe(0)
      expect(summary.cashTotal).toBe(0)
      expect(summary.monthCount).toBe(0)
      expect(summary.horizon).toBe('—')
    })

    it('calculates multi-month cash metrics and horizons', () => {
      const adjustments = [
        {
          year: 2026,
          month: 1,
          delta_amount: 500,
          budget_categories: { category: 'Bonus', group: 'Income' },
        },
        {
          year: 2026,
          month: 2,
          delta_amount: 100,
          budget_categories: { category: 'Dining', group: 'Food' },
        },
      ]
      const ctx = {
        budgetLineItems: [
          { amount: 400, budget_categories: { category: 'Dining' } },
        ],
        transactions: [
          { amount: 60000 }, // Trailing 12 months income run rate = 60000 / 12 = 5000/mo
        ],
      }
      const summary = computeImpactSummary(adjustments, ctx)
      expect(summary.netTotal).toBe(600) // 500 + 100
      expect(summary.cashTotal).toBe(400) // +500 income - 100 expense
      expect(summary.monthCount).toBe(2)
      expect(summary.monthlyAvg).toBe(300)
      expect(summary.cashMonthlyAvg).toBe(200)
      expect(summary.isOneTime).toBe(false)
      expect(summary.horizon).toBe('Jan 2026 – Feb 2026')
      expect(summary.incomeRunRate).toBe(5000)
      expect(summary.budgetPlanned).toBe(400)
      expect(summary.budgetProjected).toBe(1000) // planned 400 + netTotal 600
    })

    it('flags one-time adjustment correctly when monthCount is 1', () => {
      const adjustments = [
        {
          year: 2026,
          month: 3,
          delta_amount: 1000,
          budget_categories: { category: 'Bonus', group: 'Income' },
        },
      ]
      const summary = computeImpactSummary(adjustments, { budgetLineItems: [] })
      expect(summary.monthCount).toBe(1)
      expect(summary.isOneTime).toBe(true)
      expect(summary.horizon).toBe('Mar 2026')
    })
  })
})

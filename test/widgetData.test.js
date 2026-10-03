import { describe, it, expect } from 'vitest'
import {
  spendByGroupYear,
  spendByCategoryForGroup,
} from '../src/lib/dashboard/widgetData.js'

describe('Dashboard Widget Data (widgetData.js)', () => {
  describe('spendByGroupYear', () => {
    it('returns empty result when no line items and no transactions exist', () => {
      const result = spendByGroupYear({ thisYear: 2026 }, [])
      expect(result.rows).toHaveLength(0)
      expect(result.hasBudget).toBe(false)
    })

    it('aggregates expense line items by group while excluding Income group', () => {
      const ctx = {
        thisYear: 2026,
        budgetLineItems: [
          {
            month: 1,
            amount: 1500,
            budget_categories: { group: 'Housing' },
          },
          {
            month: 2,
            amount: 500,
            budget_categories: { group: 'Food' },
          },
          {
            month: 1,
            amount: 8000,
            budget_categories: { group: 'Income' }, // should be ignored
          },
        ],
      }
      const result = spendByGroupYear(ctx, [])
      expect(result.hasBudget).toBe(true)
      const groups = result.rows.map(r => r.group)
      expect(groups).toContain('Housing')
      expect(groups).toContain('Food')
      expect(groups).not.toContain('Income')
    })

    it('filters out excluded categories from transactions', () => {
      const ctx = {
        thisYear: 2026,
        categories: [
          { category: 'Credit Card Payment', exclude_from_totals: true },
        ],
        budgetLineItems: [],
      }
      const txns = [
        {
          date: '2026-03-10',
          amount: -500,
          category: 'Credit Card Payment',
          group: 'Transfers',
        },
        {
          date: '2026-03-12',
          amount: -120,
          category: 'Groceries',
          group: 'Food',
        },
      ]
      const result = spendByGroupYear(ctx, txns)
      const groups = result.rows.map(r => r.group)
      expect(groups).not.toContain('Transfers')
      expect(groups).toContain('Food')
    })
  })

  describe('spendByCategoryForGroup', () => {
    it('breaks down group spend by category for drill-down', () => {
      const ctx = {
        thisYear: 2026,
        categories: [
          { id: 'cat-groc', category: 'Groceries', group: 'Food' },
          { id: 'cat-rest', category: 'Restaurants', group: 'Food' },
        ],
        budgetLineItems: [
          {
            category_id: 'cat-groc',
            month: 1,
            amount: 600,
            budget_categories: { group: 'Food' },
          },
          {
            category_id: 'cat-rest',
            month: 1,
            amount: 300,
            budget_categories: { group: 'Food' },
          },
        ],
      }
      const result = spendByCategoryForGroup(ctx, [], 'Food')
      expect(result.rows).toHaveLength(2)
      const names = result.rows.map(r => r.category)
      expect(names).toContain('Groceries')
      expect(names).toContain('Restaurants')
    })
  })
})

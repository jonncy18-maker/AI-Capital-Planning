import { describe, it, expect } from 'vitest'
import {
  analyzeTransactions,
  generateBudgetDraft,
  MONTHS,
} from '../src/lib/budget/patternAnalyzer.js'

describe('Budget Pattern Analyzer (patternAnalyzer.js)', () => {
  it('exports 12 calendar month labels', () => {
    expect(MONTHS).toHaveLength(12)
    expect(MONTHS[0]).toBe('Jan')
    expect(MONTHS[11]).toBe('Dec')
  })

  describe('analyzeTransactions', () => {
    it('classifies Fixed category when frequency >= 0.6 and low coefficient of variation', () => {
      // 10 months of identical rent: -2000
      const transactions = []
      for (let m = 1; m <= 10; m++) {
        transactions.push({
          date: `2026-${String(m).padStart(2, '0')}-01`,
          category: 'Rent',
          amount: -2000,
        })
      }
      const categories = [
        { id: 'cat-rent', category: 'Rent', group: 'Housing' },
      ]

      const analysis = analyzeTransactions(transactions, categories)
      expect(analysis.spanMonths).toBe(10)
      const rentCat = analysis.categories.find(c => c.category === 'Rent')
      expect(rentCat).toBeDefined()
      expect(rentCat.inferredType).toBe('Fixed')
      expect(rentCat.frequency).toBe(1.0)
      expect(rentCat.cov).toBe(0)
    })

    it('classifies Flexible category when frequency >= 0.5 but higher variation', () => {
      // 8 months with varying amounts: -100, -500, -200, -800
      const transactions = []
      const amounts = [-100, -500, -200, -800, -150, -600, -250, -900]
      for (let m = 1; m <= 8; m++) {
        transactions.push({
          date: `2026-${String(m).padStart(2, '0')}-15`,
          category: 'Dining Out',
          amount: amounts[m - 1],
        })
      }
      // total span 10 months
      transactions.push({ date: '2026-09-15', category: 'Other', amount: -50 })
      transactions.push({ date: '2026-10-15', category: 'Other', amount: -50 })

      const categories = [
        { id: 'cat-dining', category: 'Dining Out', group: 'Food' },
      ]
      const analysis = analyzeTransactions(transactions, categories)
      const dining = analysis.categories.find(c => c.category === 'Dining Out')
      expect(dining).toBeDefined()
      expect(dining.frequency).toBe(0.8) // 8/10 >= 0.5
      expect(dining.inferredType).toBe('Flexible')
    })

    it('classifies Non-Monthly category when frequency < 0.5', () => {
      // 2 months out of 10
      const transactions = [
        { date: '2026-02-15', category: 'Car Insurance', amount: -600 },
        { date: '2026-08-15', category: 'Car Insurance', amount: -600 },
      ]
      for (let m = 1; m <= 10; m++) {
        transactions.push({ date: `2026-${String(m).padStart(2, '0')}-01`, category: 'Misc', amount: -10 })
      }

      const categories = [
        { id: 'cat-ins', category: 'Car Insurance', group: 'Transport' },
      ]
      const analysis = analyzeTransactions(transactions, categories)
      const ins = analysis.categories.find(c => c.category === 'Car Insurance')
      expect(ins.inferredType).toBe('Non-Monthly')
    })

    it('ignores positive income transactions and excluded transfer categories', () => {
      const transactions = [
        { date: '2026-01-01', category: 'Paycheck', amount: 5000 },
        { date: '2026-01-02', category: 'CC Payment', amount: -1000 },
        { date: '2026-01-03', category: 'Groceries', amount: -150 },
      ]
      const categories = [
        { id: 'c1', category: 'Paycheck', group: 'Income' },
        { id: 'c2', category: 'CC Payment', group: 'Transfers', exclude_from_totals: true },
        { id: 'c3', category: 'Groceries', group: 'Food' },
      ]
      const analysis = analyzeTransactions(transactions, categories)
      expect(analysis.categories.map(c => c.category)).not.toContain('Paycheck')
      expect(analysis.categories.map(c => c.category)).not.toContain('CC Payment')
      expect(analysis.categories.map(c => c.category)).toContain('Groceries')
    })
  })

  describe('generateBudgetDraft', () => {
    it('spreads Fixed/Flexible items evenly across 12 months', () => {
      const analysis = {
        categories: [
          {
            category_id: 'c-sub',
            category: 'Streaming',
            group: 'Entertainment',
            type: 'Fixed',
            annualTotal: 240,
            monthlyAvg: 20,
          },
        ],
      }
      const draft = generateBudgetDraft(analysis, 2026)
      expect(draft).toHaveLength(12)
      expect(draft[0].month).toBe(1)
      expect(draft[0].amount).toBe(20)
      expect(draft[11].month).toBe(12)
      expect(draft[11].amount).toBe(20)
    })

    it('allocates Non-Monthly items proportionally to historical month histogram', () => {
      const histogram = Array(12).fill(0)
      histogram[2] = 500 // March
      histogram[8] = 500 // Sept
      const analysis = {
        categories: [
          {
            category_id: 'c-tuition',
            category: 'Tuition',
            group: 'Education',
            type: 'Non-Monthly',
            annualTotal: 1000,
            monthHistogram: histogram,
          },
        ],
      }
      const draft = generateBudgetDraft(analysis, 2026)
      expect(draft).toHaveLength(2)
      expect(draft[0].month).toBe(3)
      expect(draft[0].amount).toBe(500)
      expect(draft[1].month).toBe(9)
      expect(draft[1].amount).toBe(500)
    })
  })
})

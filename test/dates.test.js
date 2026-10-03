import { describe, it, expect } from 'vitest'
import { parseLocalDate } from '../src/lib/dates.js'
import { analyzeTransactions } from '../src/lib/budget/patternAnalyzer.js'

describe('parseLocalDate', () => {
  it('keeps the calendar day for plain and ISO-Z date strings', () => {
    for (const s of ['2026-09-01', '2026-09-01T00:00:00.000Z']) {
      const d = parseLocalDate(s)
      expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 9, 1])
    }
  })
  it('returns an invalid date for garbage', () => {
    expect(isNaN(parseLocalDate('nope'))).toBe(true)
  })
})

describe('1st-of-month bucketing', () => {
  it('does not shift 1st-of-month spend into the prior month', () => {
    const rows = [{ date: '2026-09-01', category: 'Rent', amount: -1000 }]
    const { categories } = analyzeTransactions(rows, [])
    expect(categories[0].monthHistogram[8]).toBe(1000) // Sep, not Aug
  })
})

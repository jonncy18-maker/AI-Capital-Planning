// Aggregates raw transaction rows into a compact per-category profile
// ready to feed into the AI bucket-suggestion prompt.
// Delegates pattern math to analyzeTransactions — no duplicate logic.

import { analyzeTransactions } from '../budget/patternAnalyzer.js'

export function buildCategoryProfile(rows) {
  const { spanMonths, categories } = analyzeTransactions(rows, [])

  const totalAnnual = categories.reduce((s, c) => s + c.annualTotal, 0)

  // Collect up to 3 distinct merchants per category for the AI hint
  const merchantsByCategory = {}
  for (const row of rows) {
    const cat = row.category || 'Uncategorized'
    if (!merchantsByCategory[cat]) merchantsByCategory[cat] = new Set()
    if (row.merchant) merchantsByCategory[cat].add(row.merchant)
  }

  return {
    spanMonths,
    categories: categories.map(c => ({
      category: c.category,
      monthlyAvg: Math.round(c.monthlyAvg),
      annualTotal: Math.round(c.annualTotal),
      // Percent of months this category appeared (0-100)
      frequencyPct: Math.round(c.frequency * 100),
      inferredType: c.inferredType,
      // Share of total spend, one decimal (e.g. 4.2%)
      shareOfSpend:
        totalAnnual > 0
          ? Math.round((c.annualTotal / totalAnnual) * 1000) / 10
          : 0,
      topMerchants: [...(merchantsByCategory[c.category] ?? [])].slice(0, 3),
    })),
  }
}

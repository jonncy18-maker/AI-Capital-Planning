import { parseLocalDate } from '../dates.js'
import { toCents, fromCents, sumCents, sumDollars } from '../money.js'
// Historical pattern analyzer for the Annual Budget Builder.
//
// Ingests raw transactions + budget_categories and classifies each spending
// category's pattern (Fixed / Flexible / Non-Monthly), then proposes a
// month-by-month budget for a target year. Pure functions — no I/O — so the
// output is deterministic and testable.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function mean(nums) {
  if (!nums.length) return 0
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

function stddev(nums) {
  if (nums.length < 2) return 0
  const m = mean(nums)
  const variance = nums.reduce((a, b) => a + (b - m) ** 2, 0) / nums.length
  return Math.sqrt(variance)
}

// Single source of truth for "this transaction is real spend": an outflow in a
// category that isn't excluded. Shared by the totals and the span denominator.
function isCountedExpense(t, excluded) {
  if ((Number(t.amount) || 0) >= 0) return false
  const category = t.category || 'Uncategorized'
  return !(excluded && excluded.has(category))
}

// Group expense transactions by category → month-key → summed outflow (positive
// integer CENTS; classifyCategory converts back to dollars).
// Income (amount > 0) is ignored; budgets here track planned outflows.
// `excluded` is a Set of category names to drop entirely (transfers / payments).
function buildCategoryMonthlyTotals(transactions, excluded) {
  const byCategory = {}
  for (const t of transactions) {
    if (!isCountedExpense(t, excluded)) continue
    const amount = Number(t.amount) || 0
    const category = t.category || 'Uncategorized'
    const d = parseLocalDate(t.date)
    if (isNaN(d)) continue
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    byCategory[category] = byCategory[category] || {}
    byCategory[category][key] = (byCategory[category][key] || 0) + Math.abs(toCents(amount))
  }
  return byCategory
}

// Count distinct months containing at least one counted expense (the
// denominator for "how often does this category appear"). Income-only or
// excluded-transfer-only months would otherwise dilute every category.
function countSpanMonths(transactions, excluded) {
  const keys = new Set()
  for (const t of transactions) {
    if (!isCountedExpense(t, excluded)) continue
    const d = parseLocalDate(t.date)
    if (isNaN(d)) continue
    keys.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return Math.max(keys.size, 1)
}

// Classify a single category from its monthly totals.
function classifyCategory(monthlyTotalsMap, spanMonths) {
  const monthKeys = Object.keys(monthlyTotalsMap)
  const activeMonths = monthKeys.length
  const amountsCents = Object.values(monthlyTotalsMap)
  const amounts = amountsCents.map(fromCents)
  const totalCents = sumCents(amountsCents)
  const total = fromCents(totalCents)
  const frequency = activeMonths / spanMonths
  const avgWhenActive = activeMonths ? totalCents / activeMonths / 100 : 0
  const cov = avgWhenActive ? stddev(amounts) / avgWhenActive : 0 // coefficient of variation

  // Which calendar months (1-12) does this category historically hit?
  const histogramCents = Array(12).fill(0)
  for (const [key, amt] of Object.entries(monthlyTotalsMap)) {
    const m = parseInt(key.slice(5, 7), 10)
    if (m >= 1 && m <= 12) histogramCents[m - 1] += amt
  }
  const monthHistogram = histogramCents.map(fromCents)

  let type
  if (frequency >= 0.6 && cov < 0.2) {
    type = 'Fixed'
  } else if (frequency >= 0.5) {
    type = 'Flexible'
  } else {
    type = 'Non-Monthly'
  }

  // Annualize: extrapolate the observed window to a full 12-month year.
  const annualTotal = (spanMonths > 0 ? (totalCents / spanMonths) * 12 : totalCents) / 100
  const monthlyAvg = annualTotal / 12

  return {
    type,
    activeMonths,
    frequency,
    total,
    annualTotal,
    monthlyAvg,
    avgWhenActive,
    cov,
    monthHistogram,
  }
}

// Full analysis: returns a per-category breakdown joined to budget_categories.
export function analyzeTransactions(transactions, categories = []) {
  // Categories flagged exclude_from_totals (transfers, CC payments) never seed a
  // budget line — they aren't real spend.
  const excluded = new Set(categories.filter((c) => c.exclude_from_totals).map((c) => c.category))
  const spanMonths = countSpanMonths(transactions, excluded)
  const totals = buildCategoryMonthlyTotals(transactions, excluded)

  // Map category name → budget_categories row (for id, group, configured type).
  const catLookup = {}
  for (const c of categories) catLookup[c.category] = c

  const results = []
  for (const [categoryName, monthlyMap] of Object.entries(totals)) {
    const stats = classifyCategory(monthlyMap, spanMonths)
    const matched = catLookup[categoryName] || null
    results.push({
      category: categoryName,
      category_id: matched?.id ?? null,
      group: matched?.group ?? null,
      ...stats,
      // After the spread so stats.type doesn't clobber a user-configured type.
      type: matched?.type ?? stats.type,
      inferredType: stats.type,
    })
  }

  // Sort by annual total descending — biggest line items first.
  results.sort((a, b) => b.annualTotal - a.annualTotal)
  return { spanMonths, categories: results }
}

// Generate draft budget_line_items for a target year from an analysis.
// - Fixed/Flexible: spread evenly across all 12 months (monthlyAvg).
// - Non-Monthly: distribute the annual total proportionally to the historical
//   month histogram so irregular hits land in their real months.
// Categories without a matched category_id are skipped (can't FK a line item).
export function generateBudgetDraft(analysis, year) {
  const items = []
  for (const cat of analysis.categories) {
    if (!cat.category_id) continue
    if (cat.annualTotal < 1) continue

    if (cat.type === 'Non-Monthly') {
      const histTotal = sumDollars(cat.monthHistogram)
      for (let m = 0; m < 12; m++) {
        const share = histTotal > 0 ? cat.monthHistogram[m] / histTotal : 0
        const amount = Math.round(cat.annualTotal * share)
        if (amount > 0) {
          items.push({
            category_id: cat.category_id,
            category: cat.category,
            group: cat.group,
            type: cat.type,
            month: m + 1,
            year,
            amount,
            label: `${cat.category} — ${MONTHS[m]}`,
          })
        }
      }
    } else {
      const amount = Math.round(cat.monthlyAvg)
      if (amount <= 0) continue
      for (let m = 0; m < 12; m++) {
        items.push({
          category_id: cat.category_id,
          category: cat.category,
          group: cat.group,
          type: cat.type,
          month: m + 1,
          year,
          amount,
          label: null,
        })
      }
    }
  }
  return items
}

export { MONTHS }

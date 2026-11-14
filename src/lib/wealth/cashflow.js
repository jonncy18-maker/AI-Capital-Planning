// Per-year take-home and spending for a Wealth Trajectory plan, drawn from the
// numbers the app already shows. Pure: callers pass loaded inputs and freeze the
// result on the saved plan (assumptions.cashflow_by_year). All money math is
// integer cents, rounded once per multiply.

import { toCents, fromCents, mulCents, sumCents } from '../money.js'
import { commitmentYearSchedule } from '../commitments/schedule.js'

export const SOURCE_LABELS = {
  actual_forecast: 'Actual + Forecast',
  outlook: '5-year outlook',
  growth: 'Growth rates',
  manual: 'Manual',
}

export function sourceLabel(source, year) {
  return source === 'budget' ? `${year} budget` : (SOURCE_LABELS[source] ?? source)
}

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v)
const groupKey = (g) => (g || '').trim().toLowerCase()
const round = (v) => fromCents(toCents(v))

// Budget-only fallback for the current year: the Settings tax estimate for
// take-home and the sum of the year's budget lines for spending. Commitment
// lines count here (real spending this year); the outlook adds them separately.
export function budgetFallback(ctx) {
  if (!ctx) return { takeHome: null, spending: null }
  const net = ctx.incomeEstimate?.netIncome
  const takeHome = isFiniteNumber(net) && net > 0 ? round(net) : null
  const lines = ctx.budgetLineItems ?? []
  if (!lines.length) return { takeHome, spending: null }
  const catById = new Map((ctx.categories ?? []).map((c) => [c.id, c]))
  const spending = sumCents(lines, (li) => {
    const cat = catById.get(li.category_id)
    const group = groupKey(li.budget_categories?.group ?? cat?.group)
    if (group === 'income' || group === 'transfers') return 0
    if (cat?.exclude_from_totals || li.budget_categories?.exclude_from_totals) return 0
    return toCents(li.amount)
  })
  return { takeHome, spending: fromCents(spending) }
}

export function cashflowMap(rows) {
  return Object.fromEntries(
    rows.map((r) => [r.year, { take_home: r.take_home, spending: r.spending, source: r.source }])
  )
}

export function deriveCashflow({
  startYear,
  endYear,
  curYear,
  payGrowth,
  spendGrowth,
  current = null,
  budget = null,
  outlook = null,
  extras = { commitments: [], events: [] },
  overrides = {},
}) {
  const outlookOk =
    !!outlook && !outlook.empty && Array.isArray(outlook.columns) && Array.isArray(outlook.groups)
  const commitments = extras?.commitments ?? []
  const events = extras?.events ?? []
  const rows = []
  let prior = null

  // Spending growth drives only the years after the outlook's last column, grown
  // from that column's group total (not commitments or events, which keep their
  // own dates). Without a usable later column, such years chain from the prior
  // year so the growth rate always has an effect.
  let lastIdx = -1
  if (outlookOk) {
    outlook.columns.forEach((c, i) => {
      if (lastIdx < 0 || c.year > outlook.columns[lastIdx].year) lastIdx = i
    })
  }
  const lastYear = lastIdx >= 0 ? outlook.columns[lastIdx].year : null
  const lastBase = lastIdx >= 0 ? outlook.groupTotals?.[lastIdx] : null
  const growFromLast = outlookOk && lastYear > curYear && isFiniteNumber(lastBase)

  for (let year = curYear; year <= endYear; year++) {
    let takeHome
    let spending
    let source
    const override = overrides?.[year]
    if (override) {
      takeHome = Math.max(0, round(override.take_home))
      spending = Math.max(0, round(override.spending))
      source = 'manual'
    } else if (year === curYear) {
      if (
        current &&
        current.hasData === true &&
        isFiniteNumber(current.fullYearIncome) &&
        isFiniteNumber(current.fullYearExpenses) &&
        current.fullYearIncome > 0
      ) {
        takeHome = round(current.fullYearIncome)
        spending = round(current.fullYearExpenses)
        source = 'actual_forecast'
      } else if (budget?.takeHome != null && budget?.spending != null) {
        takeHome = budget.takeHome
        spending = budget.spending
        source = 'budget'
      } else {
        takeHome = budget?.takeHome ?? 0
        spending = budget?.spending ?? 0
        source = 'manual'
      }
    } else {
      const col = outlookOk ? outlook.columns.findIndex((c) => c.year === year) : -1
      let incomeFromOutlook = false
      let spendFromOutlook = false
      if (col >= 0 && isFiniteNumber(outlook.income?.[col])) {
        takeHome = outlook.income[col]
        incomeFromOutlook = true
      } else {
        takeHome = fromCents(mulCents(toCents(prior.take_home), 1 + payGrowth))
      }
      if (outlookOk && col >= 0) {
        spending = fromCents(
          toCents(outlook.groupTotals?.[col]) +
            toCents(outlook.commitments?.[col]) +
            toCents(outlook.events?.[col]?.total)
        )
        spendFromOutlook = true
      } else if (outlookOk && growFromLast) {
        const groups =
          year > lastYear
            ? mulCents(toCents(lastBase), Math.pow(1 + spendGrowth, year - lastYear))
            : // A gap before a late-starting window keeps the per-group rates.
              sumCents(outlook.groups, (g) =>
                mulCents(toCents(g.base), Math.pow(1 + g.rate, year - outlook.baseYear))
              )
        const fixed = sumCents(commitments, (c) =>
          toCents(commitmentYearSchedule(c, year).reduce((x, y) => x + y, 0))
        )
        const planned = sumCents(
          events.filter((e) => e.year === year),
          (e) => toCents(e.amount)
        )
        spending = fromCents(groups + fixed + planned)
      } else {
        spending = fromCents(mulCents(toCents(prior.spending), 1 + spendGrowth))
      }
      source = incomeFromOutlook && spendFromOutlook ? 'outlook' : 'growth'
    }
    prior = {
      year,
      take_home: takeHome,
      spending,
      surplus: fromCents(toCents(takeHome) - toCents(spending)),
      source,
    }
    if (year >= startYear) rows.push(prior)
  }
  return rows
}

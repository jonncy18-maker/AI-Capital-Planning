// Pure helpers for scenario analysis views — no AI calls, all computed from DB data.
import { toCents, fromCents, sumCents, sumDollars, addDollars, mulCents } from '../money.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parsePeriodLabel(year, month) {
  return `${MONTHS[month - 1]} ${year}`
}

// `delta_amount` is always stored relative to its own category line: +$500 on
// Auto Lease is $500 more spending, +$500 on Income is $500 more income. Those
// are opposite cash effects, so anything that aggregates or colours a delta has
// to flip the sign for spending categories first — otherwise a bonus reads as a
// bill.
export function isIncomeAdjustment(a) {
  return (a?.budget_categories?.group || '').trim().toLowerCase() === 'income'
}

// Signed effect on cash: positive = better off, negative = worse off.
function cashEffectCents(a) {
  const delta = toCents(a?.delta_amount)
  return isIncomeAdjustment(a) ? delta : -delta
}

export function cashEffect(a) {
  return fromCents(cashEffectCents(a))
}

// Convert a GROSS income figure to the NET cash that actually lands, using the
// same effective tax rate + 401k % the income forecast uses. An income-scenario
// adjustment stores the after-tax delta on the income category; the user usually
// knows the headline (gross) number, so this derives the net for them.
// taxCtx: { effectiveRate: 0..1, four01kPct: percent }.
export function grossToNet(gross, { taxable = true, applies401k = false } = {}, taxCtx = {}) {
  const gc = toCents(gross)
  const effRate = Number(taxCtx?.effectiveRate) || 0
  const k401Pct = Number(taxCtx?.four01kPct) || 0
  const taxC = taxable ? mulCents(gc, effRate) : 0
  const k401C = applies401k ? mulCents(gc, k401Pct / 100) : 0
  return { gross: fromCents(gc), tax: fromCents(taxC), k401: fromCents(k401C), net: fromCents(gc - taxC - k401C), effRatePct: Math.round(effRate * 100), k401Pct }
}

// Average monthly income from the trailing 12 months of context transactions.
function monthlyIncomeRunRate(ctx) {
  const incomeYearCents = sumCents(
    (ctx?.transactions ?? []).filter(t => Number(t.amount) > 0),
    t => toCents(t.amount)
  )
  return incomeYearCents / 12 / 100
}

// Derive key impact metrics for a set of adjustments.
export function computeImpactSummary(adjustments, ctx) {
  const lineItems = ctx?.budgetLineItems ?? []

  if (!adjustments.length) {
    return {
      netTotal: 0, monthCount: 0, monthlyAvg: 0, annualized: 0, horizon: '—',
      cashTotal: 0, cashMonthlyAvg: 0, cashAnnualized: 0, isOneTime: false,
      incomeRunRate: monthlyIncomeRunRate(ctx),
      pctOfIncome: null,
      budgetPlanned: sumDollars(lineItems, li => li.amount),
      budgetProjected: 0,
      hasBudget: lineItems.length > 0,
      hasIncome: monthlyIncomeRunRate(ctx) > 0,
    }
  }

  const netTotalCents = sumCents(adjustments, a => toCents(a.delta_amount))
  const netTotal = fromCents(netTotalCents)

  const periodSet = new Set(adjustments.map(a => `${a.year}-${String(a.month).padStart(2, '0')}`))
  const monthCount = periodSet.size
  const monthlyAvg = monthCount > 0 ? netTotalCents / monthCount / 100 : 0
  const annualized = monthCount > 0 ? netTotalCents / monthCount * 12 / 100 : 0

  // Cash-effect view: income adds, spending subtracts, so a scenario mixing the
  // two nets out correctly and the sign always means better/worse off.
  const cashTotalCents = sumCents(adjustments, cashEffectCents)
  const cashTotal = fromCents(cashTotalCents)
  const cashMonthlyAvg = monthCount > 0 ? cashTotalCents / monthCount / 100 : 0
  // Extrapolating a single month to a year turns a one-off bonus into a salary,
  // so callers get the flag and show the total instead.
  const isOneTime = monthCount === 1
  const cashAnnualized = monthCount > 0 ? cashTotalCents / monthCount * 12 / 100 : 0

  // Horizon string
  const sortedPeriods = [...periodSet].sort()
  const first = sortedPeriods[0].split('-')
  const last = sortedPeriods[sortedPeriods.length - 1].split('-')
  const firstLabel = parsePeriodLabel(first[0], parseInt(first[1]))
  const lastLabel = parsePeriodLabel(last[0], parseInt(last[1]))
  const horizon = firstLabel === lastLabel ? firstLabel : `${firstLabel} – ${lastLabel}`

  // Income affordability
  const incomeRunRate = monthlyIncomeRunRate(ctx)
  const pctOfIncome = incomeRunRate > 0 ? (Math.abs(cashMonthlyAvg) / incomeRunRate) * 100 : null

  // Budget: sum only the categories that appear in this scenario's adjustments
  const adjCategoryNames = new Set(
    adjustments.map(a => a.budget_categories?.category).filter(Boolean)
  )
  const budgetPlanned = sumDollars(
    lineItems.filter(li => adjCategoryNames.has(li.budget_categories?.category)),
    li => li.amount
  )
  const budgetProjected = addDollars(budgetPlanned, netTotal)

  return {
    netTotal,
    monthCount,
    monthlyAvg,
    annualized,
    cashTotal,
    cashMonthlyAvg,
    cashAnnualized,
    isOneTime,
    horizon,
    incomeRunRate,
    pctOfIncome,
    budgetPlanned,
    budgetProjected,
    hasBudget: lineItems.length > 0,
    hasIncome: incomeRunRate > 0,
  }
}

// Join adjustments to the forecast baseline, grouped by period. The baseline is
// the independent forecast (forecast_line_items), falling back to the budget when
// no forecast has been initialized for the year.
export function buildComparisonRows(adjustments, ctx) {
  const lineItems = ctx?.budgetLineItems ?? []
  const forecastLines = ctx?.forecastLineItems ?? []

  // Budget index by category name + month
  const budgetIndex = {}
  for (const li of lineItems) {
    const cat = (li.budget_categories?.category || '').trim()
    if (!cat) continue
    const key = `${cat}::${li.month}`
    budgetIndex[key] = (budgetIndex[key] || 0) + toCents(li.amount)
  }
  // Forecast baseline: sum forecast lines when initialized, else the budget.
  let forecastIndex
  if (forecastLines.length > 0) {
    forecastIndex = {}
    for (const fi of forecastLines) {
      const cat = (fi.budget_categories?.category || '').trim()
      if (!cat) continue
      const key = `${cat}::${fi.month}`
      forecastIndex[key] = (forecastIndex[key] || 0) + toCents(fi.amount)
    }
  } else {
    forecastIndex = { ...budgetIndex }
  }

  // Group adjustments by year-month
  const byPeriod = {}
  for (const a of adjustments) {
    const periodKey = `${a.year}-${String(a.month).padStart(2, '0')}`
    if (!byPeriod[periodKey]) byPeriod[periodKey] = { year: a.year, month: a.month, rows: [] }

    const catName = a.budget_categories?.category ?? '—'
    const budgetKey = `${catName}::${a.month}`
    const baseline = forecastIndex[budgetKey] != null ? fromCents(forecastIndex[budgetKey]) : null
    const delta = Number(a.delta_amount)

    byPeriod[periodKey].rows.push({
      id: a.id,
      category: catName,
      label: a.label || '',
      baseline,
      delta,
      isIncome: isIncomeAdjustment(a),
      cashDelta: cashEffect(a),
      scenario: baseline != null ? addDollars(baseline, delta) : null,
    })
  }

  return Object.values(byPeriod)
    .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
    .map(p => {
      const periodDelta = sumDollars(p.rows, r => r.delta)
      const periodCashDelta = sumDollars(p.rows, r => r.cashDelta)
      // Rows with no baseline contribute 0, so baseline + deltas cover the same rows.
      const hasBaseline = p.rows.some(r => r.baseline != null)
      const periodBaseline = hasBaseline ? sumDollars(p.rows, r => r.baseline ?? 0) : null
      const periodScenario = periodBaseline != null ? addDollars(periodBaseline, periodDelta) : null
      return {
        ...p,
        periodLabel: parsePeriodLabel(p.year, p.month),
        periodDelta,
        periodCashDelta,
        periodBaseline,
        periodScenario,
      }
    })
}

// Build cumulative timeline data for the SVG chart.
export function buildCumulativeTimeline(adjustments) {
  if (!adjustments.length) return { labels: [], values: [], min: 0, max: 0 }

  const byPeriod = {}
  for (const a of adjustments) {
    const key = `${a.year}-${String(a.month).padStart(2, '0')}`
    byPeriod[key] = (byPeriod[key] || 0) + cashEffectCents(a)
  }

  const sorted = Object.entries(byPeriod).sort(([a], [b]) => (a < b ? -1 : 1))
  const labels = sorted.map(([key]) => {
    const [y, m] = key.split('-')
    return `${MONTHS[parseInt(m) - 1]} ${y}`
  })

  let running = 0 // cents
  const values = sorted.map(([, delta]) => { running += delta; return fromCents(running) })

  return {
    labels,
    values,
    min: Math.min(0, ...values),
    max: Math.max(0, ...values),
  }
}

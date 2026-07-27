// Pure helpers for scenario analysis views — no AI calls, all computed from DB data.

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
export function cashEffect(a) {
  const delta = Number(a?.delta_amount) || 0
  return isIncomeAdjustment(a) ? delta : -delta
}

// Convert a GROSS income figure to the NET cash that actually lands, using the
// same effective tax rate + 401k % the income forecast uses. An income-scenario
// adjustment stores the after-tax delta on the income category; the user usually
// knows the headline (gross) number, so this derives the net for them.
// taxCtx: { effectiveRate: 0..1, four01kPct: percent }.
export function grossToNet(gross, { taxable = true, applies401k = false } = {}, taxCtx = {}) {
  const g = Number(gross) || 0
  const effRate = Number(taxCtx?.effectiveRate) || 0
  const k401Pct = Number(taxCtx?.four01kPct) || 0
  const tax = taxable ? g * effRate : 0
  const k401 = applies401k ? g * (k401Pct / 100) : 0
  return { gross: g, tax, k401, net: g - tax - k401, effRatePct: Math.round(effRate * 100), k401Pct }
}

// Average monthly income from the trailing 12 months of context transactions.
function monthlyIncomeRunRate(ctx) {
  const incomeYear = (ctx?.transactions ?? [])
    .filter(t => Number(t.amount) > 0)
    .reduce((s, t) => s + Number(t.amount), 0)
  return incomeYear / 12
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
      budgetPlanned: lineItems.reduce((s, li) => s + Number(li.amount || 0), 0),
      budgetProjected: 0,
      hasBudget: lineItems.length > 0,
      hasIncome: monthlyIncomeRunRate(ctx) > 0,
    }
  }

  const netTotal = adjustments.reduce((s, a) => s + Number(a.delta_amount), 0)

  const periodSet = new Set(adjustments.map(a => `${a.year}-${String(a.month).padStart(2, '0')}`))
  const monthCount = periodSet.size
  const monthlyAvg = monthCount > 0 ? netTotal / monthCount : 0
  const annualized = monthlyAvg * 12

  // Cash-effect view: income adds, spending subtracts, so a scenario mixing the
  // two nets out correctly and the sign always means better/worse off.
  const cashTotal = adjustments.reduce((s, a) => s + cashEffect(a), 0)
  const cashMonthlyAvg = monthCount > 0 ? cashTotal / monthCount : 0
  // Extrapolating a single month to a year turns a one-off bonus into a salary,
  // so callers get the flag and show the total instead.
  const isOneTime = monthCount === 1
  const cashAnnualized = cashMonthlyAvg * 12

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
  const budgetPlanned = lineItems
    .filter(li => adjCategoryNames.has(li.budget_categories?.category))
    .reduce((s, li) => s + Number(li.amount || 0), 0)
  const budgetProjected = budgetPlanned + netTotal

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
    budgetIndex[key] = (budgetIndex[key] || 0) + Number(li.amount || 0)
  }
  // Forecast baseline: sum forecast lines when initialized, else the budget.
  let forecastIndex
  if (forecastLines.length > 0) {
    forecastIndex = {}
    for (const fi of forecastLines) {
      const cat = (fi.budget_categories?.category || '').trim()
      if (!cat) continue
      const key = `${cat}::${fi.month}`
      forecastIndex[key] = (forecastIndex[key] || 0) + Number(fi.amount || 0)
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
    const baseline = forecastIndex[budgetKey] != null ? forecastIndex[budgetKey] : null
    const delta = Number(a.delta_amount)

    byPeriod[periodKey].rows.push({
      id: a.id,
      category: catName,
      label: a.label || '',
      baseline,
      delta,
      isIncome: isIncomeAdjustment(a),
      cashDelta: cashEffect(a),
      scenario: baseline != null ? baseline + delta : null,
    })
  }

  return Object.values(byPeriod)
    .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
    .map(p => {
      const periodDelta = p.rows.reduce((s, r) => s + r.delta, 0)
      const periodCashDelta = p.rows.reduce((s, r) => s + r.cashDelta, 0)
      const baselineRows = p.rows.filter(r => r.baseline != null)
      const periodBaseline = baselineRows.length > 0 ? baselineRows.reduce((s, r) => s + r.baseline, 0) : null
      const periodScenario = periodBaseline != null ? periodBaseline + periodDelta : null
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
    byPeriod[key] = (byPeriod[key] || 0) + cashEffect(a)
  }

  const sorted = Object.entries(byPeriod).sort(([a], [b]) => (a < b ? -1 : 1))
  const labels = sorted.map(([key]) => {
    const [y, m] = key.split('-')
    return `${MONTHS[parseInt(m) - 1]} ${y}`
  })

  let running = 0
  const values = sorted.map(([, delta]) => { running += delta; return running })

  return {
    labels,
    values,
    min: Math.min(0, ...values),
    max: Math.max(0, ...values),
  }
}

// Pure helpers for scenario analysis views — no AI calls, all computed from DB data.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parsePeriodLabel(year, month) {
  return `${MONTHS[month - 1]} ${year}`
}

// Annualized income from the last 90 days of transactions (90 days ≈ 3 months).
function monthlyIncomeRunRate(ctx) {
  const income90 = (ctx?.transactions ?? [])
    .filter(t => Number(t.amount) > 0)
    .reduce((s, t) => s + Number(t.amount), 0)
  return income90 / 3
}

// Annualized spend run-rate from trailing 90 days.
function annualizedSpend(ctx) {
  const spend90 = (ctx?.transactions ?? [])
    .filter(t => Number(t.amount) < 0)
    .reduce((s, t) => s + Math.abs(Number(t.amount)), 0)
  return (spend90 / 90) * 365
}

// Derive key impact metrics for a set of adjustments.
export function computeImpactSummary(adjustments, ctx) {
  const lineItems = ctx?.budgetLineItems ?? []

  if (!adjustments.length) {
    return {
      netTotal: 0, monthCount: 0, monthlyAvg: 0, annualized: 0, horizon: '—',
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

  // Horizon string
  const sortedPeriods = [...periodSet].sort()
  const first = sortedPeriods[0].split('-')
  const last = sortedPeriods[sortedPeriods.length - 1].split('-')
  const firstLabel = parsePeriodLabel(first[0], parseInt(first[1]))
  const lastLabel = parsePeriodLabel(last[0], parseInt(last[1]))
  const horizon = firstLabel === lastLabel ? firstLabel : `${firstLabel} – ${lastLabel}`

  // Income affordability
  const incomeRunRate = monthlyIncomeRunRate(ctx)
  const pctOfIncome = incomeRunRate > 0 ? (Math.abs(monthlyAvg) / incomeRunRate) * 100 : null

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
    horizon,
    incomeRunRate,
    pctOfIncome,
    budgetPlanned,
    budgetProjected,
    hasBudget: lineItems.length > 0,
    hasIncome: incomeRunRate > 0,
  }
}

// Join adjustments to the forecast baseline (override ?? budget), grouped by period.
export function buildComparisonRows(adjustments, ctx) {
  const lineItems = ctx?.budgetLineItems ?? []
  const overrides = ctx?.forecastOverrides ?? []

  // Build forecast index: prefer override, fall back to budget
  const budgetIndex = {}
  for (const li of lineItems) {
    const cat = (li.budget_categories?.category || '').trim()
    if (!cat) continue
    const key = `${cat}::${li.month}`
    budgetIndex[key] = (budgetIndex[key] || 0) + Number(li.amount || 0)
  }
  // Override index wins when present
  const forecastIndex = { ...budgetIndex }
  for (const ov of overrides) {
    const cat = (ov.budget_categories?.category || '').trim()
    if (!cat) continue
    const key = `${cat}::${ov.month}`
    forecastIndex[key] = Number(ov.amount)
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
      scenario: baseline != null ? baseline + delta : null,
    })
  }

  return Object.values(byPeriod)
    .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
    .map(p => {
      const periodDelta = p.rows.reduce((s, r) => s + r.delta, 0)
      const baselineRows = p.rows.filter(r => r.baseline != null)
      const periodBaseline = baselineRows.length > 0 ? baselineRows.reduce((s, r) => s + r.baseline, 0) : null
      const periodScenario = periodBaseline != null ? periodBaseline + periodDelta : null
      return {
        ...p,
        periodLabel: parsePeriodLabel(p.year, p.month),
        periodDelta,
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
    byPeriod[key] = (byPeriod[key] || 0) + Number(a.delta_amount)
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

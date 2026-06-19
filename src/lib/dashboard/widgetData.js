// Derives dashboard widget data from the loaded AI context. Pure functions so
// widgets render deterministically from Supabase data with zero AI token cost.

import { aggregateCommitmentsForYear } from '../commitments/schedule.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Monthly spend by group (last 90 days of transactions).
export function spendByGroup(ctx, topN = 6) {
  const txns = ctx?.transactions ?? []
  const byGroup = {}
  for (const t of txns) {
    const amt = Number(t.amount) || 0
    if (amt >= 0) continue
    const g = t.group || 'Uncategorized'
    byGroup[g] = (byGroup[g] || 0) + Math.abs(amt)
  }
  const rows = Object.entries(byGroup)
    .map(([group, total]) => ({ group, total }))
    .sort((a, b) => b.total - a.total)
  const max = rows.length ? rows[0].total : 0
  return { rows: rows.slice(0, topN), max, totalGroups: rows.length }
}

// Run-rate end-of-year projection from the trailing 90-day spend.
export function runRateEOY(ctx) {
  const txns = ctx?.transactions ?? []
  const spend90 = txns.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount) || 0), 0)
  const dailyRate = spend90 / 90
  const annualized = dailyRate * 365
  // Remaining spend this calendar year
  const now = new Date()
  const endOfYear = new Date(now.getFullYear(), 11, 31)
  const daysLeft = Math.max(Math.round((endOfYear - now) / 86400000), 0)
  const projectedRemaining = dailyRate * daysLeft
  return { annualized, dailyRate, daysLeft, projectedRemaining }
}

// Budget vs. actual: planned annual (from line items) vs. projected (run-rate).
export function budgetVsActual(ctx) {
  const lineItems = ctx?.budgetLineItems ?? []
  const planned = lineItems.reduce((s, li) => s + Number(li.amount || 0), 0)
  const { annualized } = runRateEOY(ctx)
  const variance = annualized - planned
  const pct = planned > 0 ? (annualized / planned) * 100 : null
  return { planned, projected: annualized, variance, pct, hasBudget: lineItems.length > 0 }
}

// Cash-flow spike: largest upcoming month from commitments in the current year.
export function cashFlowSpike(ctx) {
  const commitments = (ctx?.commitments ?? []).filter(c => c.status === 'active')
  const year = ctx?.thisYear ?? new Date().getFullYear()
  const monthly = aggregateCommitmentsForYear(commitments, year)
  const now = new Date()
  const startMonth = year === now.getFullYear() ? now.getMonth() : 0 // 0-indexed
  let spikeMonth = -1
  let spikeVal = 0
  for (let m = startMonth; m < 12; m++) {
    if (monthly[m] > spikeVal) { spikeVal = monthly[m]; spikeMonth = m }
  }
  return {
    hasData: spikeMonth >= 0 && spikeVal > 0,
    month: spikeMonth >= 0 ? MONTHS[spikeMonth] : null,
    amount: spikeVal,
    yearTotal: monthly.reduce((a, b) => a + b, 0),
  }
}

// Long-term commitments summary.
export function commitmentsSummary(ctx) {
  const commitments = ctx?.commitments ?? []
  const active = commitments.filter(c => c.status === 'active')
  const year = ctx?.thisYear ?? new Date().getFullYear()
  const yearTotal = aggregateCommitmentsForYear(active, year).reduce((a, b) => a + b, 0)
  return { activeCount: active.length, totalCount: commitments.length, yearTotal }
}

// Month-by-month budget vs. actuals for the year. Budget comes from the saved
// line items (summed per month); actuals come from the supplied full-year
// transactions (expenses only, summed per month). Past months show real actuals;
// the current and future months fall back to budget as a forecast so the chart
// reads as a continuous plan-vs-reality picture.
//
// status per month:  'under' | 'on' (±10% of budget) | 'over' | 'none' (no budget)
//
// Transfers and credit-card payments (categories flagged exclude_from_totals)
// are dropped so actuals aren't overstated — the same rule loadAIContext applies
// to the 90-day context. The full-year transactions are fetched raw, so we must
// re-apply the exclusion here against ctx.categories.
export function monthlyBudgetVsActual(ctx, yearTransactions = []) {
  const lineItems = ctx?.budgetLineItems ?? []
  const overrides = ctx?.forecastOverrides ?? []
  const year = ctx?.thisYear ?? new Date().getFullYear()
  const excluded = new Set(
    (ctx?.categories ?? []).filter(c => c.exclude_from_totals).map(c => c.category)
  )

  const budget = Array(12).fill(0)
  for (const li of lineItems) {
    const m = (li.month ?? 1) - 1
    if (m >= 0 && m < 12) budget[m] += Number(li.amount || 0)
  }

  // Forecast = override ?? budget per category per month.
  // Re-aggregate from scratch: start with budget, then apply overrides.
  // An override replaces the per-category contribution for that month.
  // We build a category→month budget index so we can subtract the original
  // budget contribution and add the override value.
  const catMonthBudget = {}
  for (const li of lineItems) {
    const catId = li.category_id
    const m = (li.month ?? 1) - 1
    if (m < 0 || m >= 12 || !catId) continue
    if (!catMonthBudget[catId]) catMonthBudget[catId] = Array(12).fill(0)
    catMonthBudget[catId][m] += Number(li.amount || 0)
  }
  const forecast = [...budget]
  for (const ov of overrides) {
    const catId = ov.category_id
    const m = (ov.month ?? 1) - 1
    if (m < 0 || m >= 12 || !catId) continue
    const budgetContrib = catMonthBudget[catId]?.[m] ?? 0
    forecast[m] = forecast[m] - budgetContrib + Number(ov.amount)
    // update the contribution so further overrides for same cat accumulate correctly
    if (!catMonthBudget[catId]) catMonthBudget[catId] = Array(12).fill(0)
    catMonthBudget[catId][m] = Number(ov.amount)
  }

  const actual = Array(12).fill(0)
  const seen = Array(12).fill(false)
  for (const t of yearTransactions) {
    const amt = Number(t.amount) || 0
    if (amt >= 0) continue // expenses only
    if (excluded.has(t.category)) continue // transfers / credit-card payments
    const d = new Date(t.date)
    if (Number.isNaN(d.getTime()) || d.getFullYear() !== year) continue
    const m = d.getMonth()
    actual[m] += Math.abs(amt)
    seen[m] = true
  }

  const now = new Date()
  const currentMonth = year === now.getFullYear() ? now.getMonth() : 11

  const months = MONTHS.map((label, m) => {
    const b = budget[m]
    const f = forecast[m]          // forecast = override ?? budget for this month
    const hasOverride = f !== b    // at least one category overridden
    const isPast = m < currentMonth
    const isCurrent = m === currentMonth
    const isFuture = m > currentMonth
    const hasActual = !isFuture && seen[m]
    const a = hasActual ? actual[m] : null
    // For status comparison use forecast (not raw budget) so overridden months track correctly
    let status = 'none'
    if (f > 0 && a != null) {
      if (a > f * 1.1) status = 'over'
      else if (a < f * 0.9) status = 'under'
      else status = 'on'
    }
    return { month: m, label, budget: b, forecast: f, hasOverride, actual: a, hasActual, isPast, isCurrent, isFuture, status }
  })

  // YTD roll-up against forecast (not raw budget) — drives the "on track" pill.
  let ytdBudget = 0
  let ytdForecast = 0
  let ytdActual = 0
  for (const mo of months) {
    if (mo.actual == null) continue
    ytdBudget += mo.budget
    ytdForecast += mo.forecast
    ytdActual += mo.actual
  }
  const ytdPct = ytdForecast > 0 ? (ytdActual / ytdForecast) * 100 : null
  const onTrack = ytdPct == null ? true : ytdPct <= 105

  return {
    year,
    currentMonth,
    months,
    hasBudget: lineItems.length > 0,
    hasForecastOverrides: overrides.length > 0,
    hasActuals: seen.some(Boolean),
    annualBudget: budget.reduce((a, b) => a + b, 0),
    annualForecast: forecast.reduce((a, b) => a + b, 0),
    ytdBudget,
    ytdForecast,
    ytdActual,
    ytdPct,
    onTrack,
  }
}

// Wealth snapshot summary.
export function wealthSummary(ctx) {
  const w = ctx?.wealth
  if (!w) return { hasData: false }
  return {
    hasData: true,
    netWorth: Number(w.net_worth || 0),
    investable: (Number(w.investment_balance) || 0) + (Number(w.retirement_balance) || 0),
    date: w.snapshot_date,
  }
}

// Scenario impact summary from the loaded context.
// committed scenarios contribute a measurable plan delta; modeled are tracked separately.
export function scenarioImpact(ctx) {
  const scenarios = ctx?.scenarios ?? []
  if (!scenarios.length) return { hasData: false, committed: [], modeled: [], committedMonthlyNet: 0, committedAnnualNet: 0, hasCommitted: false }

  const committed = scenarios.filter(s => s.state === 'committed')
  const modeled = scenarios.filter(s => s.state === 'modeled')

  const committedSummaries = committed.map(s => {
    const adjs = s.adjustments ?? []
    const netTotal = adjs.reduce((sum, a) => sum + Number(a.delta_amount), 0)
    const monthCount = new Set(adjs.map(a => `${a.year}-${a.month}`)).size
    const monthlyAvg = monthCount > 0 ? netTotal / monthCount : 0
    return { name: s.name, netTotal, monthlyAvg }
  })

  const modeledSummaries = modeled.map(s => {
    const adjs = s.adjustments ?? []
    const netTotal = adjs.reduce((sum, a) => sum + Number(a.delta_amount), 0)
    return { name: s.name, netTotal }
  })

  const committedMonthlyNet = committedSummaries.reduce((s, c) => s + c.monthlyAvg, 0)

  return {
    hasData: true,
    committed: committedSummaries,
    modeled: modeledSummaries,
    committedMonthlyNet,
    committedAnnualNet: committedMonthlyNet * 12,
    hasCommitted: committed.length > 0,
  }
}

export { MONTHS }

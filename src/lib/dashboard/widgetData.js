// Derives dashboard widget data from the loaded AI context. Pure functions so
// widgets render deterministically from database data with zero AI token cost.

import { parseLocalDate } from '../dates.js'
import { aggregateCommitmentsForYear, commitmentMonthlyDemand } from '../commitments/schedule.js'
import { cashEffect, isIncomeAdjustment } from '../scenarios/scenarioUtils.js'
import { toCents, fromCents, sumCents, sumDollars, mulCents, allocateCents } from '../money.js'
import { matchAccountsToCards } from '../cashflow/cardAccountMatch.js'
import { computeCardCashTiming } from '../cashflow/cashflowEngine.js'

// All money below is summed in integer cents and converted back to dollars only
// in the returned objects. Averages and percentages stay unrounded floats.

// Budget and forecast line items exist for income categories too (a committed
// income scenario writes one). Every "spend" aggregate below sums line items,
// so income lines have to be filtered out or a bonus lands as an expense.
const isIncomeGroup = (g) => (g || '').trim().toLowerCase() === 'income'

// Index of the in-progress month for a year: 11 for a past year (every month is
// actual), -1 for a future year (every month is forecast), else today's month.
function currentMonthIndex(year, now = new Date()) {
  const cy = now.getFullYear()
  if (year < cy) return 11
  if (year > cy) return -1
  return now.getMonth()
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Spend by group for the full year: actual (YTD, real transactions) + forecast
// (budget/override for the remaining months) compared against the annual budget.
// Past months contribute their real actuals; the current and future months
// contribute the planned/forecast amount — so each group's bar reads as the
// best full-year estimate (actual-so-far + plan-for-the-rest) against budget.
export function spendByGroupYear(ctx, yearTxns = [], topN = 8) {
  const lineItems = ctx?.budgetLineItems ?? []
  const forecastLines = ctx?.forecastLineItems ?? []
  const year = ctx?.thisYear ?? new Date().getFullYear()
  const categories = ctx?.categories ?? []
  const excluded = new Set(categories.filter(c => c.exclude_from_totals).map(c => c.category))

  const currentMonth = currentMonthIndex(year)

  // category_id → group (from line items first, then the category table).
  const catGroup = {}
  for (const c of categories) if (c.id) catGroup[c.id] = c.group || 'Uncategorized'
  for (const li of lineItems) {
    if (li.category_id) catGroup[li.category_id] = li.budget_categories?.group || catGroup[li.category_id] || 'Uncategorized'
  }

  // Budget by group by month.
  const budgetByGroupMonth = {}
  for (const li of lineItems) {
    const g = li.budget_categories?.group || 'Uncategorized'
    if (isIncomeGroup(g)) continue
    const m = (li.month ?? 1) - 1
    if (m < 0 || m > 11) continue
    if (!budgetByGroupMonth[g]) budgetByGroupMonth[g] = Array(12).fill(0)
    budgetByGroupMonth[g][m] += toCents(li.amount)
  }

  // Forecast from the independent forecast lines, grouped by month; falls back to
  // the budget when no forecast has been initialized for the year.
  const forecastInitialized = forecastLines.length > 0
  const forecastByGroupMonth = {}
  if (forecastInitialized) {
    for (const fi of forecastLines) {
      const m = (fi.month ?? 1) - 1
      if (m < 0 || m > 11) continue
      const g = fi.budget_categories?.group || catGroup[fi.category_id] || 'Uncategorized'
      if (isIncomeGroup(g)) continue
      if (!forecastByGroupMonth[g]) forecastByGroupMonth[g] = Array(12).fill(0)
      forecastByGroupMonth[g][m] += toCents(fi.amount)
    }
  } else {
    for (const g of Object.keys(budgetByGroupMonth)) forecastByGroupMonth[g] = [...budgetByGroupMonth[g]]
  }

  // Actual expenses by group by month from the full-year transactions.
  const actualByGroupMonth = {}
  for (const t of yearTxns) {
    const amt = Number(t.amount) || 0
    if (amt >= 0) continue // expenses only
    if (excluded.has(t.category)) continue
    const d = parseLocalDate(t.date)
    if (Number.isNaN(d.getTime()) || d.getFullYear() !== year) continue
    const g = t.group || 'Uncategorized'
    const m = d.getMonth()
    if (!actualByGroupMonth[g]) actualByGroupMonth[g] = Array(12).fill(0)
    actualByGroupMonth[g][m] += Math.abs(toCents(amt))
  }

  const groups = new Set([
    ...Object.keys(budgetByGroupMonth),
    ...Object.keys(actualByGroupMonth),
  ])

  const rows = []
  for (const g of groups) {
    const budgetMonths = budgetByGroupMonth[g] || Array(12).fill(0)
    const forecastMonths = forecastByGroupMonth[g] || budgetMonths
    const actualMonths = actualByGroupMonth[g] || Array(12).fill(0)
    let actual = 0
    let forecast = 0
    let budget = 0
    for (let m = 0; m < 12; m++) {
      budget += budgetMonths[m]
      if (m <= currentMonth) actual += actualMonths[m]
      else forecast += forecastMonths[m]
    }
    const projected = actual + forecast
    if (budget < 100 && projected < 100) continue
    rows.push({ group: g, actual, forecast, projected, budget })
  }

  rows.sort((a, b) => b.projected - a.projected)
  const top = rows.slice(0, topN).map(r => ({
    group: r.group,
    actual: fromCents(r.actual),
    forecast: fromCents(r.forecast),
    projected: fromCents(r.projected),
    budget: fromCents(r.budget),
  }))
  const max = top.reduce((m, r) => Math.max(m, r.projected, r.budget), 0) || 1

  return { rows: top, max, totalGroups: rows.length, hasBudget: lineItems.length > 0 }
}

// Full-year spend projection: real actuals for elapsed months + budget/override
// forecast for the remaining months. Replaces the old trailing-run-rate model so
// the projection reflects the user's actual plan, not an annualized recent pace.
export function yearProjection(ctx, yearTxns = []) {
  const mbva = monthlyBudgetVsActual(ctx, yearTxns)
  let actualToDate = 0
  let forecastRemaining = 0
  for (const mo of mbva.months) {
    if (mo.actual != null) actualToDate += toCents(mo.actual)
    else forecastRemaining += toCents(mo.forecast)
  }
  const projectedTotal = fromCents(actualToDate + forecastRemaining)
  actualToDate = fromCents(actualToDate)
  forecastRemaining = fromCents(forecastRemaining)
  const now = new Date()
  const endOfYear = new Date(now.getFullYear(), 11, 31)
  const daysLeft = Math.max(Math.round((endOfYear - now) / 86400000), 0)
  return { projectedTotal, actualToDate, forecastRemaining, daysLeft, hasActuals: mbva.hasActuals }
}

// Budget vs. actual: planned annual (from line items) vs. full-year projection
// (actuals-to-date + forecast-for-the-rest).
export function budgetVsActual(ctx, yearTxns = []) {
  const lineItems = ctx?.budgetLineItems ?? []
  const plannedC = sumCents(
    lineItems.filter(li => !isIncomeGroup(li.budget_categories?.group)),
    li => toCents(li.amount)
  )
  const { projectedTotal } = yearProjection(ctx, yearTxns)
  const projectedC = toCents(projectedTotal)
  const pct = plannedC > 0 ? (projectedC / plannedC) * 100 : null
  return {
    planned: fromCents(plannedC),
    projected: projectedTotal,
    variance: fromCents(projectedC - plannedC),
    pct,
    hasBudget: lineItems.length > 0,
  }
}

// Cash-flow spike: largest upcoming month from commitments in the current year.
export function cashFlowSpike(ctx) {
  const commitments = (ctx?.commitments ?? []).filter(c => c.status === 'active')
  const year = ctx?.thisYear ?? new Date().getFullYear()
  const monthly = aggregateCommitmentsForYear(commitments, year).map(toCents)
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
    amount: fromCents(spikeVal),
    yearTotal: fromCents(sumCents(monthly)),
  }
}

// Long-term commitments summary.
export function commitmentsSummary(ctx) {
  const commitments = ctx?.commitments ?? []
  const active = commitments.filter(c => c.status === 'active')
  const year = ctx?.thisYear ?? new Date().getFullYear()
  const yearTotal = sumDollars(aggregateCommitmentsForYear(active, year))
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
// to the trailing context. The full-year transactions are fetched raw, so we must
// re-apply the exclusion here against ctx.categories.
export function monthlyBudgetVsActual(ctx, yearTransactions = [], scenarioFilter = 'all') {
  const lineItems = ctx?.budgetLineItems ?? []
  const forecastLines = ctx?.forecastLineItems ?? []
  const year = ctx?.thisYear ?? new Date().getFullYear()
  const excluded = new Set(
    (ctx?.categories ?? []).filter(c => c.exclude_from_totals).map(c => c.category)
  )

  // Income-category lines are tracked separately: they belong to the income
  // projection, never to the expense plan. Arrays hold integer cents.
  const budget = Array(12).fill(0)
  const budgetIncome = Array(12).fill(0)
  for (const li of lineItems) {
    const m = (li.month ?? 1) - 1
    if (m < 0 || m >= 12) continue
    const target = isIncomeGroup(li.budget_categories?.group) ? budgetIncome : budget
    target[m] += toCents(li.amount)
  }

  // Forecast is its own independent dataset (forecast_line_items), seeded from
  // the budget. When a forecast exists for the year we sum its lines per month;
  // otherwise we fall back to the budget so the chart still reads as a plan.
  const forecastInitialized = forecastLines.length > 0
  const forecast = [...budget]
  const forecastIncome = [...budgetIncome]
  if (forecastInitialized) {
    for (let m = 0; m < 12; m++) { forecast[m] = 0; forecastIncome[m] = 0 }
    for (const fi of forecastLines) {
      const m = (fi.month ?? 1) - 1
      if (m < 0 || m >= 12) continue
      const target = isIncomeGroup(fi.budget_categories?.group) ? forecastIncome : forecast
      target[m] += toCents(fi.amount)
    }
  }

  const actual = Array(12).fill(0)
  const seen = Array(12).fill(false)
  for (const t of yearTransactions) {
    const amt = Number(t.amount) || 0
    if (amt >= 0) continue // expenses only
    if (excluded.has(t.category)) continue // transfers / credit-card payments
    const d = parseLocalDate(t.date)
    if (Number.isNaN(d.getTime()) || d.getFullYear() !== year) continue
    const m = d.getMonth()
    actual[m] += Math.abs(toCents(amt))
    seen[m] = true
  }

  const currentMonth = currentMonthIndex(year)

  // Committed scenario deltas for future months only.
  // scenarioFilter: 'all' = apply all committed, 'baseline' = none, id string = only that one.
  const scenarioDeltas = Array(12).fill(0)
  const scenarioIncomeDeltas = Array(12).fill(0)
  let committedScenarioCount = 0
  for (const s of (ctx?.scenarios ?? [])) {
    if (s.state !== 'committed') continue
    committedScenarioCount++
    if (scenarioFilter === 'baseline') continue
    if (scenarioFilter !== 'all' && s.id !== scenarioFilter) continue
    for (const adj of (s.adjustments ?? [])) {
      if (Number(adj.year) !== year) continue
      const m = (adj.month ?? 1) - 1
      if (m < 0 || m >= 12 || m <= currentMonth) continue
      const target = isIncomeAdjustment(adj) ? scenarioIncomeDeltas : scenarioDeltas
      target[m] += toCents(adj.delta_amount)
    }
  }

  const varThreshold = ctx?.varianceThreshold ?? 10   // percent, e.g. 10 means ±10%
  const varRatio = varThreshold / 100                  // decimal form, e.g. 0.10

  const forecastWithScenarios = forecast.map((v, m) => v + scenarioDeltas[m])
  const actualOrNull = actual.map((v, m) => (m > currentMonth || !seen[m] ? null : v))

  const months = MONTHS.map((label, m) => {
    const b = budget[m]
    const f = forecastWithScenarios[m]   // forecast + committed scenario deltas
    const hasOverride = f !== b    // at least one category overridden
    const isPast = m < currentMonth
    const isCurrent = m === currentMonth
    const isFuture = m > currentMonth
    const a = actualOrNull[m]
    const hasActual = a != null
    // For status comparison use forecast (not raw budget) so overridden months track correctly
    let status = 'none'
    if (f > 0 && a != null) {
      if (a > f * (1 + varRatio)) status = 'over'
      else if (a < f * (1 - varRatio)) status = 'under'
      else status = 'on'
    }
    return {
      month: m, label, budget: fromCents(b), forecast: fromCents(f), hasOverride,
      actual: a == null ? null : fromCents(a), hasActual, isPast, isCurrent, isFuture, status,
    }
  })

  // YTD roll-up against forecast (not raw budget) — drives the "on track" pill.
  let ytdBudget = 0
  let ytdForecast = 0
  let ytdActual = 0
  for (let m = 0; m < 12; m++) {
    if (actualOrNull[m] == null) continue
    ytdBudget += budget[m]
    ytdForecast += forecastWithScenarios[m]
    ytdActual += actualOrNull[m]
  }
  const ytdPct = ytdForecast > 0 ? (ytdActual / ytdForecast) * 100 : null

  // Full-year projection: actuals for past/current months + forecast for the rest
  let fullYearProjected = 0
  for (let m = 0; m < 12; m++) {
    fullYearProjected += actualOrNull[m] != null ? actualOrNull[m] : forecastWithScenarios[m]
  }
  const annualBudgetTotal = sumCents(budget)
  const fullYearPct = annualBudgetTotal > 0 ? (fullYearProjected / annualBudgetTotal) * 100 : null
  const onTrack = (fullYearPct ?? ytdPct) == null ? true : (fullYearPct ?? ytdPct) <= 100 + varThreshold

  return {
    year,
    currentMonth,
    months,
    hasBudget: lineItems.length > 0,
    hasForecastOverrides: forecastInitialized,
    hasActuals: seen.some(Boolean),
    annualBudget: fromCents(annualBudgetTotal),
    annualForecast: fromCents(sumCents(forecast)),
    ytdBudget: fromCents(ytdBudget),
    ytdForecast: fromCents(ytdForecast),
    ytdActual: fromCents(ytdActual),
    ytdPct,
    fullYearProjected: fromCents(fullYearProjected),
    fullYearPct,
    onTrack,
    committedScenarioCount,
    hasCommittedScenarios: committedScenarioCount > 0,
    varThreshold,
    // Income-category plan lines, kept out of the expense series above so the
    // income projection can pick them up instead.
    forecastIncome: forecastIncome.map(fromCents),
    scenarioIncomeDeltas: scenarioIncomeDeltas.map(fromCents),
  }
}

// Wealth snapshot summary.
export function wealthSummary(ctx) {
  const w = ctx?.wealth
  if (!w) return { hasData: false }
  return {
    hasData: true,
    netWorth: fromCents(toCents(w.net_worth)),
    investable: fromCents(toCents(w.investment_balance) + toCents(w.retirement_balance)),
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

  // cashEffect, not the raw delta: an adjustment on an Income category improves
  // the position, every other category worsens it.
  const effectCents = (a) => toCents(cashEffect(a))
  const committedSummaries = committed.map(s => {
    const adjs = s.adjustments ?? []
    const netCents = sumCents(adjs, effectCents)
    const monthCount = new Set(adjs.map(a => `${a.year}-${a.month}`)).size
    // Average: float division of exact cents, left unrounded.
    const avgCents = monthCount > 0 ? netCents / monthCount : 0
    return { name: s.name, netTotal: fromCents(netCents), monthlyAvg: avgCents / 100 }
  })
  const avgCentsList = committed.map(s => {
    const adjs = s.adjustments ?? []
    const monthCount = new Set(adjs.map(a => `${a.year}-${a.month}`)).size
    return monthCount > 0 ? sumCents(adjs, effectCents) / monthCount : 0
  })

  const modeledSummaries = modeled.map(s => ({
    name: s.name,
    netTotal: fromCents(sumCents(s.adjustments ?? [], effectCents)),
  }))

  // Sum of per-scenario averages (statistics, not a money total): float, unrounded.
  const committedMonthlyNet = avgCentsList.reduce((s, v) => s + v, 0) / 100

  // Annual figure = this year's actual cash effects, not monthlyAvg × 12 —
  // extrapolation would turn a one-off bonus into a phantom recurring salary.
  const thisYear = ctx?.thisYear ?? new Date().getFullYear()
  const committedAnnualNet = fromCents(sumCents(
    committed.flatMap(sc => (sc.adjustments ?? []).filter(a => Number(a.year) === thisYear)),
    effectCents
  ))

  return {
    hasData: true,
    committed: committedSummaries,
    modeled: modeledSummaries,
    committedMonthlyNet,
    committedAnnualNet,
    hasCommitted: committed.length > 0,
  }
}

// Post-tax monthly income forecast from the salary profile, in integer cents
// (null when no salary is set). Base is salary/12 with the annual bonus added in
// bonus_month only; subtracts estimated taxes (the effective rate on salary +
// bonus), benefits, and 401k contributions. Annual amounts are split across the
// 12 months with allocateCents so they sum exactly to the annual figure.
function monthlyIncomeForecastCents(ctx) {
  const profile = ctx?.profile
  const salary = toCents(profile?.annual_income)
  if (salary <= 0) return null
  const annualBonus = toCents(profile?.annual_bonus)
  const rawBonusMonth = profile?.bonus_month  // stored 1-12; null if no bonus month
  const bonusMonthIdx = rawBonusMonth != null ? Number(rawBonusMonth) - 1 : null  // 0-11

  const totalGross = salary + annualBonus
  const benefitsAmount = toCents(profile?.benefits_amount)
  const benefitsPct = Number(profile?.benefits_pct) || 0
  const annualBenefits = benefitsAmount > 0 ? benefitsAmount
    : (benefitsPct > 0 ? mulCents(totalGross, benefitsPct / 100) : 0)
  const monthlyBenefits = allocateCents(annualBenefits, 12)

  const totalTax = toCents(ctx?.incomeEstimate?.totalTax)
  const effectiveTaxRate = totalGross > 0 ? totalTax / totalGross : 0

  const four01kPct = Number(profile?.four01k_pct) || 0
  const four01kOnBonus = profile?.four01k_on_bonus ?? false
  const monthlySalary = allocateCents(salary, 12)
  const monthly401kSalary = allocateCents(mulCents(salary, four01kPct / 100), 12)
  const bonus401k = mulCents(annualBonus, four01kPct / 100)

  return Array.from({ length: 12 }, (_, m) => {
    const isBonus = bonusMonthIdx !== null && m === bonusMonthIdx
    const grossMonth = monthlySalary[m] + (isBonus ? annualBonus : 0)
    const taxMonth = mulCents(grossMonth, effectiveTaxRate)
    const month401k = monthly401kSalary[m] + (isBonus && four01kOnBonus ? bonus401k : 0)
    return Math.max(0, grossMonth - taxMonth - month401k - monthlyBenefits[m])
  })
}

// Income vs. expenses — YTD from full-year transactions plus a full-year
// actual-so-far + forecast-for-the-rest projection. When a salary profile exists,
// future months use post-tax income forecast (salary/12 + bonus in bonus_month,
// minus taxes/benefits/401k) instead of a rolling average.
export function incomeVsExpenses(ctx, yearTxns = [], priorYearTxns = []) {
  const excluded = new Set(
    (ctx?.categories ?? []).filter(c => c.exclude_from_totals).map(c => c.category)
  )
  const now = new Date()
  const year = ctx?.thisYear ?? now.getFullYear()

  // "To date" = every month up to and including the in-progress one, so a charge
  // dated later this month counts here exactly as it does in the monthly series
  // and fullYearActualExpenses. Later months stay forecast-only.
  const currentMonth = currentMonthIndex(year, now)
  const ytd = yearTxns.filter(t => {
    if (excluded.has(t.category)) return false
    const d = parseLocalDate(t.date)
    return !isNaN(d.getTime()) && d.getFullYear() === year && d.getMonth() <= currentMonth
  })

  const incomeCents = (list) => sumCents(list.filter(t => Number(t.amount) > 0), t => toCents(t.amount))
  const expenseCents = (list) => sumCents(list.filter(t => Number(t.amount) < 0), t => Math.abs(toCents(t.amount)))

  const ytdIncomeC = incomeCents(ytd)
  const ytdExpensesC = expenseCents(ytd)
  const ytdNetC = ytdIncomeC - ytdExpensesC
  const savingsRate = ytdIncomeC > 0 ? (ytdNetC / ytdIncomeC) * 100 : null

  // ── Expense forecast (budget/override per month) ─────────────────────────────
  const mbva = monthlyBudgetVsActual(ctx, yearTxns)
  let fullYearActualExpenses = 0
  let fullYearForecastExpenses = 0
  // Planned income for the same months the expense side is forecasting — months
  // with actuals already carry their income through the transaction totals, so
  // only forecast months contribute here and nothing is double counted.
  let forecastIncomeLines = 0
  mbva.months.forEach((mo, m) => {
    if (mo.actual != null) {
      fullYearActualExpenses += toCents(mo.actual)
    } else {
      fullYearForecastExpenses += toCents(mo.forecast ?? 0)
      forecastIncomeLines += toCents(mbva.forecastIncome?.[m] ?? 0) + toCents(mbva.scenarioIncomeDeltas?.[m] ?? 0)
    }
  })
  const fullYearExpenses = fullYearActualExpenses + fullYearForecastExpenses

  // Month-by-month actuals from transactions (cents)
  const incomeByMonth = Array(12).fill(0)
  const expensesByMonth = Array(12).fill(0)
  for (const t of yearTxns) {
    const amt = Number(t.amount) || 0
    if (amt === 0) continue
    if (excluded.has(t.category)) continue
    const d = parseLocalDate(t.date)
    if (Number.isNaN(d.getTime()) || d.getFullYear() !== year) continue
    if (amt > 0) incomeByMonth[d.getMonth()] += toCents(amt)
    else expensesByMonth[d.getMonth()] += Math.abs(toCents(amt))
  }

  const monthlyIncomeForecast = monthlyIncomeForecastCents(ctx)

  // ── Full-year income: actuals for elapsed months, forecast for the rest ──────
  let fullYearIncome = 0
  if (monthlyIncomeForecast) {
    for (let m = 0; m < 12; m++) {
      fullYearIncome += m <= currentMonth ? incomeByMonth[m] : monthlyIncomeForecast[m]
    }
  } else {
    // Fallback: rolling average of completed months
    const avgIncomeCents = averageOfCompleted(incomeByMonth, currentMonth)
    fullYearIncome = ytdIncomeC + mulCents(avgIncomeCents, Math.max(11 - currentMonth, 0))
  }

  fullYearIncome += forecastIncomeLines

  const fullYearNet = fullYearIncome - fullYearExpenses
  const fullYearSavingsRate = fullYearIncome > 0 ? (fullYearNet / fullYearIncome) * 100 : null

  // Rolling averages for display (statistics: exact cents / n, not rounded)
  const avgMonthlyIncome = averageOfCompleted(incomeByMonth, currentMonth) / 100
  const avgMonthlyExpenses = averageOfCompleted(expensesByMonth, currentMonth) / 100

  // Expense forecast per month (budget/override for future months)
  const monthlyExpenseForecast = mbva.months.map(mo => mo.forecast ?? 0)

  // Top YTD spending group
  const ytdSpendByGroup = {}
  for (const t of ytd) {
    if (Number(t.amount) < 0) {
      const grp = t.group || t.category || 'Other'
      ytdSpendByGroup[grp] = (ytdSpendByGroup[grp] || 0) + Math.abs(toCents(t.amount))
    }
  }
  const topGroupEntry = Object.entries(ytdSpendByGroup).sort((a, b) => b[1] - a[1])[0]
  const topYtdGroup = topGroupEntry ? { name: topGroupEntry[0], amount: fromCents(topGroupEntry[1]) } : null

  // Prior-year full savings rate
  let priorYearSavingsRate = null
  if (priorYearTxns.length > 0) {
    const pyFiltered = priorYearTxns.filter(t => !excluded.has(t.category))
    const pyIncome = incomeCents(pyFiltered)
    const pyNet = pyIncome - expenseCents(pyFiltered)
    priorYearSavingsRate = pyIncome > 0 ? (pyNet / pyIncome) * 100 : null
  }

  return {
    hasData: ytd.length > 0,
    ytdIncome: fromCents(ytdIncomeC),
    ytdExpenses: fromCents(ytdExpensesC),
    ytdNet: fromCents(ytdNetC),
    savingsRate,
    avgMonthlyIncome,
    avgMonthlyExpenses,
    fullYearIncome: fromCents(fullYearIncome),
    fullYearExpenses: fromCents(fullYearExpenses),
    fullYearActualExpenses: fromCents(fullYearActualExpenses),
    fullYearForecastExpenses: fromCents(fullYearForecastExpenses),
    fullYearNet: fromCents(fullYearNet),
    fullYearSavingsRate,
    topYtdGroup,
    priorYearSavingsRate,
    monthlyIncome: incomeByMonth.map(fromCents),
    monthlyExpenses: expensesByMonth.map(fromCents),
    monthlyIncomeForecast: monthlyIncomeForecast ? monthlyIncomeForecast.map(fromCents) : null,
    monthlyExpenseForecast,
    currentMonth,
  }
}

// Average per completed month (m < currentMonth), in (fractional) cents. In
// January there is no completed month yet, so the in-progress month stands in;
// a future year (currentMonth -1) has no basis, so 0.
function averageOfCompleted(byMonthCents, currentMonth) {
  if (currentMonth > 0) {
    let sum = 0
    for (let m = 0; m < currentMonth; m++) sum += byMonthCents[m]
    return sum / currentMonth
  }
  return currentMonth === 0 ? byMonthCents[0] : 0
}

// Category-level breakdown for a single spend group — used by the drill-down modal.
// Mirrors the logic of spendByGroupYear but scoped to one group and at category granularity.
export function spendByCategoryForGroup(ctx, yearTxns = [], groupName) {
  const lineItems = ctx?.budgetLineItems ?? []
  const forecastLines = ctx?.forecastLineItems ?? []
  const year = ctx?.thisYear ?? new Date().getFullYear()
  const categories = ctx?.categories ?? []
  const excluded = new Set(categories.filter(c => c.exclude_from_totals).map(c => c.category))

  const currentMonth = currentMonthIndex(year)

  // category_id (UUID) → category name string
  const catIdToName = {}
  for (const c of categories) {
    if (c.id && c.category) catIdToName[c.id] = c.category
  }

  // Budget per category per month (only for the target group), in cents
  const budgetByCatMonth = {}
  for (const li of lineItems) {
    const g = li.budget_categories?.group || 'Uncategorized'
    if (g !== groupName) continue
    const catName = catIdToName[li.category_id]
    if (!catName || excluded.has(catName)) continue
    const m = (li.month ?? 1) - 1
    if (m < 0 || m > 11) continue
    if (!budgetByCatMonth[catName]) budgetByCatMonth[catName] = Array(12).fill(0)
    budgetByCatMonth[catName][m] += toCents(li.amount)
  }

  // Forecast from the independent forecast lines for this group; falls back to the
  // budget when no forecast has been initialized for the year.
  const forecastInitialized = forecastLines.length > 0
  const forecastByCatMonth = {}
  if (forecastInitialized) {
    for (const fi of forecastLines) {
      const g = fi.budget_categories?.group || 'Uncategorized'
      if (g !== groupName) continue
      const catName = catIdToName[fi.category_id]
      if (!catName || excluded.has(catName)) continue
      const m = (fi.month ?? 1) - 1
      if (m < 0 || m > 11) continue
      if (!forecastByCatMonth[catName]) forecastByCatMonth[catName] = Array(12).fill(0)
      forecastByCatMonth[catName][m] += toCents(fi.amount)
    }
  } else {
    for (const cat of Object.keys(budgetByCatMonth)) {
      forecastByCatMonth[cat] = [...budgetByCatMonth[cat]]
    }
  }

  // Actual expenses by category from transactions
  const actualByCatMonth = {}
  for (const t of yearTxns) {
    const amt = Number(t.amount) || 0
    if (amt >= 0) continue
    if (excluded.has(t.category)) continue
    if ((t.group || 'Uncategorized') !== groupName) continue
    const d = parseLocalDate(t.date)
    if (Number.isNaN(d.getTime()) || d.getFullYear() !== year) continue
    const m = d.getMonth()
    if (!actualByCatMonth[t.category]) actualByCatMonth[t.category] = Array(12).fill(0)
    actualByCatMonth[t.category][m] += Math.abs(toCents(amt))
  }

  const allCats = new Set([...Object.keys(budgetByCatMonth), ...Object.keys(actualByCatMonth)])

  const rowsC = []
  for (const cat of allCats) {
    const budgetMonths = budgetByCatMonth[cat] || Array(12).fill(0)
    const forecastMonths = forecastByCatMonth[cat] || budgetMonths
    const actualMonths = actualByCatMonth[cat] || Array(12).fill(0)
    let actual = 0, forecast = 0, fullBudget = 0, ytdBudget = 0
    for (let m = 0; m < 12; m++) {
      fullBudget += budgetMonths[m]
      if (m <= currentMonth) {
        actual += actualMonths[m]
        ytdBudget += budgetMonths[m]
      } else {
        forecast += forecastMonths[m]
      }
    }
    const projected = actual + forecast
    if (fullBudget < 100 && projected < 100) continue
    rowsC.push({ category: cat, actual, forecast, projected, fullBudget, ytdBudget,
      monthlyActual: [...actualMonths], monthlyBudget: [...budgetMonths] })
  }

  rowsC.sort((a, b) => b.projected - a.projected)

  const groupMonthlyActual = Array(12).fill(0)
  const groupMonthlyBudget = Array(12).fill(0)
  for (const r of rowsC) {
    for (let m = 0; m < 12; m++) {
      groupMonthlyActual[m] += r.monthlyActual[m] || 0
      groupMonthlyBudget[m] += r.monthlyBudget[m] || 0
    }
  }

  const rows = rowsC.map(r => ({
    category: r.category,
    actual: fromCents(r.actual),
    forecast: fromCents(r.forecast),
    projected: fromCents(r.projected),
    fullBudget: fromCents(r.fullBudget),
    ytdBudget: fromCents(r.ytdBudget),
    monthlyActual: r.monthlyActual.map(fromCents),
    monthlyBudget: r.monthlyBudget.map(fromCents),
  }))
  const max = rows.reduce((m, r) => Math.max(m, r.projected, r.fullBudget), 0) || 1

  return {
    rows, max, currentMonth,
    groupMonthlyActual: groupMonthlyActual.map(fromCents),
    groupMonthlyBudget: groupMonthlyBudget.map(fromCents),
  }
}

// Full-year net cash flow: income minus expenses for actual months; forecast
// income (salary profile) minus commitment + non-monthly budget demand for
// future months. Bars can be positive or negative.
//
// With opts.cards holding at least one card that has a statement close day, the
// widget switches to cash basis: spend on a matched card account counts when its
// statement is paid (computeCardCashTiming), not on the purchase date.
// opts = { cards, priorYearTxns, cardDollarsByMonth }.
export function cashFlowForecast(ctx, yearTxns = [], opts = {}) {
  const now = new Date()
  const year = ctx?.thisYear ?? now.getFullYear()
  // First forecast month: the in-progress month is itself forecast, so a past
  // year has none (12) and a future year starts in January (0).
  const cmi = currentMonthIndex(year, now)
  const currentMonthIdx = year === now.getFullYear() ? cmi : cmi + 1
  const commitments = (ctx?.commitments ?? []).filter(c => c.status === 'active')
  const lineItems = ctx?.budgetLineItems ?? []
  const excluded = new Set((ctx?.categories ?? []).filter(c => c.exclude_from_totals).map(c => c.category))

  // Non-Monthly budget items indexed by "budgetYear-month" (amounts in cents)
  const budgetByYM = {}
  for (const li of lineItems) {
    const cat = li.budget_categories || {}
    if (cat.type !== 'Non-Monthly') continue
    if (li.commitment_id) continue
    const key = `${li.budget_year}-${li.month}`
    if (!budgetByYM[key]) budgetByYM[key] = []
    budgetByYM[key].push({ name: li.label || cat.category || 'Budget item', amount: toCents(li.amount) })
  }

  const timingCards = (opts.cards ?? []).filter(c => c.statement_close_day)
  const cashBasis = timingCards.length > 0
  const accountCardMap = new Map()
  if (cashBasis) {
    const names = new Set()
    for (const t of [...yearTxns, ...(opts.priorYearTxns ?? [])]) if (t.account) names.add(t.account)
    const timingIds = new Set(timingCards.map(c => c.id))
    for (const [account, cardId] of matchAccountsToCards(opts.cards, names)) {
      if (timingIds.has(cardId)) accountCardMap.set(account, cardId)
    }
  }

  // Net cash flow per actual month (income − expenses, sign preserved), in cents.
  // On cash basis, card-account rows are left out: they land via statement payments.
  const netByMonth = Array(12).fill(0)
  const nonCardSpendByMonth = Array(12).fill(0)
  for (const t of yearTxns) {
    const amt = Number(t.amount) || 0
    if (amt === 0) continue
    if (excluded.has(t.category)) continue
    if (cashBasis && accountCardMap.has(t.account)) continue
    const d = parseLocalDate(t.date)
    if (Number.isNaN(d.getTime()) || d.getFullYear() !== year) continue
    netByMonth[d.getMonth()] += toCents(amt)
    if (amt < 0) nonCardSpendByMonth[d.getMonth()] -= toCents(amt)
  }

  // Income forecast per month from salary profile (same model as incomeVsExpenses)
  const monthlyIncomeForecast = monthlyIncomeForecastCents(ctx)
  // Commitments with budget lines are already inside the monthly forecast;
  // only unlinked ones need their own demand added to the outflow.
  const linkedCommitmentIds = new Set(lineItems.filter(li => li.commitment_id).map(li => li.commitment_id))
  // Forecast outflow and planned income lines come from the same source as
  // incomeVsExpenses, so both widgets reconcile on the full-year net.
  const mbva = monthlyBudgetVsActual(ctx, yearTxns)

  // Planned outflow per forecast month (cents), shared by both bases.
  const unlinkedDemandByMonth = Array(12).fill(0)
  const outflowByMonth = Array(12).fill(0)
  for (let i = Math.max(currentMonthIdx, 0); i < 12; i++) {
    for (const c of commitments) {
      if (linkedCommitmentIds.has(c.id)) continue
      const demand = commitmentMonthlyDemand(c, year, i + 1)
      if (demand > 0) unlinkedDemandByMonth[i] += toCents(demand)
    }
    outflowByMonth[i] = toCents(mbva.months[i].forecast ?? 0) + unlinkedDemandByMonth[i]
  }

  let timing = null
  const inMonthCardByMonth = Array(12).fill(0)
  if (cashBasis) {
    // Card dollars can never exceed the month's planned outflow; scale them down
    // so in-month cash spend stays >= 0 and the totals reconcile.
    const scaledCardDollars = {}
    for (const c of timingCards) scaledCardDollars[c.id] = {}
    for (let i = Math.max(currentMonthIdx, 0); i < 12; i++) {
      const perCard = timingCards.map(c => toCents(opts.cardDollarsByMonth?.[c.id]?.[i + 1] ?? 0))
      const total = sumCents(perCard)
      const cap = Math.max(outflowByMonth[i], 0)
      const scale = total > cap ? cap / total : 1
      timingCards.forEach((c, k) => {
        const scaled = scale === 1 ? perCard[k] : mulCents(perCard[k], scale)
        scaledCardDollars[c.id][i + 1] = fromCents(scaled)
        inMonthCardByMonth[i] += scaled
      })
    }
    timing = computeCardCashTiming({
      cards: timingCards, accountCardMap, year, currentMonthIdx,
      yearTxns, priorYearTxns: opts.priorYearTxns, excludedCategories: excluded,
      forecastCardDollarsByMonth: scaledCardDollars,
    })
  }
  const paymentsC = (i) => (timing ? toCents(timing.paymentsByMonth[i]) : 0)

  // Full Jan–Dec: actual months use transaction net; forecast months use income − outflows
  const totalsC = []
  const data = MONTHS.map((label, i) => {
    const m = i + 1
    if (i < currentMonthIdx) {
      const net = netByMonth[i] - paymentsC(i)
      totalsC.push(net)
      return {
        year, month: m, label, isActual: true, commitmentDemand: 0, budgetDemand: 0, forecastIncome: 0, total: fromCents(net), sources: [],
        ...(cashBasis && { cardPayments: fromCents(paymentsC(i)), inMonthSpend: fromCents(nonCardSpendByMonth[i]) }),
      }
    }
    const sources = []
    let commitmentDemand = 0
    for (const c of commitments) {
      const demand = commitmentMonthlyDemand(c, year, m)
      if (demand > 0) {
        const demandC = toCents(demand)
        sources.push({ name: c.name || 'Commitment', kind: 'commitment', amount: fromCents(demandC) })
        commitmentDemand += demandC
      }
    }
    let budgetDemand = 0
    for (const b of budgetByYM[`${year}-${m}`] || []) {
      sources.push({ name: b.name, kind: 'budget', amount: fromCents(b.amount) })
      budgetDemand += b.amount
    }
    const forecastIncome = (monthlyIncomeForecast ? monthlyIncomeForecast[i] : 0)
      + toCents(mbva.forecastIncome?.[i] ?? 0) + toCents(mbva.scenarioIncomeDeltas?.[i] ?? 0)
    // Total planned spend for the month (regular + non-monthly + linked commitments);
    // commitment/budget demand above is the itemised part shown in tooltips.
    const outflow = outflowByMonth[i]
    const inMonthSpend = cashBasis ? Math.max(outflow - inMonthCardByMonth[i], 0) : outflow
    const total = forecastIncome - inMonthSpend - paymentsC(i)
    totalsC.push(total)
    return {
      year, month: m, label, isActual: false,
      commitmentDemand: fromCents(commitmentDemand), budgetDemand: fromCents(budgetDemand),
      forecastOutflow: fromCents(outflow),
      forecastIncome: fromCents(forecastIncome), total: fromCents(total), sources,
      ...(cashBasis && { cardPayments: fromCents(paymentsC(i)), inMonthSpend: fromCents(inMonthSpend) }),
    }
  })

  const max = data.reduce((m, d) => Math.max(m, Math.abs(d.total)), 0) || 1
  const halves = [
    { label: 'H1 · JAN–JUN', total: fromCents(sumCents(totalsC.slice(0, 6))) },
    { label: 'H2 · JUL–DEC', total: fromCents(sumCents(totalsC.slice(6))) },
  ]
  const actualNet = fromCents(sumCents(totalsC.filter((_, i) => data[i].isActual)))
  const forecastNet = fromCents(sumCents(totalsC.filter((_, i) => !data[i].isActual)))

  return {
    data, max, hasData: data.some(d => d.total !== 0), halves, todayIdx: currentMonthIdx, actualNet, forecastNet,
    basis: cashBasis ? 'cash' : 'accrual',
    carryIn: timing?.carryIn ?? 0,
    carryOut: timing?.carryOut ?? 0,
  }
}

export { MONTHS }

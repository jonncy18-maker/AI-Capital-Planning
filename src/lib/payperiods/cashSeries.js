// Shared month-series computation for the Pay Period Planner's full-year views
// (TRENDS outflow chart and CASH FLOW inflow-vs-outflow chart). Centralising this
// keeps the outflow numbers identical across both tabs.

import {
  getBillAmountsRange, getForecastAmountsForBills, splitBillsByPeriod,
} from '../db/bills.js'
import { getBudgetLineItems } from '../db/budgetLineItems.js'
import { getForecastLineItems } from '../db/forecastLineItems.js'
import { getIncomeActualsRange, getIncomeTransactions } from '../db/income.js'
import { getExpenseActualsByCategories } from '../db/transactions.js'
import { estimateNet } from '../db/taxBrackets.js'
import { monthlyNetForecast } from './incomeForecast.js'
import {
  routeForecastToCards, computeStatementForecast, projectedBillAmounts,
} from '../cashflow/cashflowEngine.js'

export const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// The forecast period: the current calendar year, Jan–Dec (12 months), matching
// the rest of the app's annual forecast (Dashboard / Forecast use the calendar
// year). Elapsed months resolve to actuals, the current + future months to
// forecast. Each slot: { year, month, isFuture, isCurrent, label }.
export function buildMonthSlots(now = new Date()) {
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1
  const slots = []
  for (let month = 1; month <= 12; month++) {
    slots.push({
      year: currentYear, month,
      isFuture: month > currentMonth,
      isCurrent: month === currentMonth,
      label: MONTH_ABBR[month - 1],
    })
  }
  return { slots, currentYear, currentMonth }
}

// Compute per-month bill outflow split into the two pay periods, with forecast
// amounts (budget-derived + projected credit-card statements) for future months.
// Returns the slots array, each augmented with:
//   { period1Total, period2Total, period1Bills, period2Bills }
export async function loadOutflowSeries({
  userId, bills, payDay2,
  creditCards = [], budgetCategories = [], earnRateMap = {},
  ccCoverage = 80, ccOptimization = 100,
  now = new Date(),
}) {
  const midpoint = (payDay2 ?? 30) - 1
  const { slots, currentYear, currentMonth } = buildMonthSlots(now)

  if (!bills || bills.length === 0) {
    return slots.map(s => ({ ...s, period1Total: 0, period2Total: 0, period1Bills: [], period2Bills: [] }))
  }

  const startYear = slots[0].year
  const endYear = slots[slots.length - 1].year
  const rawAmounts = await getBillAmountsRange(userId, startYear, endYear)

  // amountIndex[year][month][bill_id] = amount
  const amountIndex = {}
  for (const row of rawAmounts) {
    if (!amountIndex[row.year]) amountIndex[row.year] = {}
    if (!amountIndex[row.year][row.month]) amountIndex[row.year][row.month] = {}
    amountIndex[row.year][row.month][row.bill_id] = row.amount
  }

  // Most recent actual per bill (variable-bill fallback). Only entries up to the
  // current month count — a future-dated actual shouldn't seed other future months.
  const sorted = [...rawAmounts]
    .filter(r => r.year < currentYear || (r.year === currentYear && r.month <= currentMonth))
    .sort((a, b) => (a.year !== b.year ? b.year - a.year : b.month - a.month))
  const lastKnownAmounts = {}
  for (const row of sorted) {
    if (lastKnownAmounts[row.bill_id] === undefined && row.amount != null) {
      lastKnownAmounts[row.bill_id] = row.amount
    }
  }

  // Fallback for variable bills (no fixed_amount) in future months. Forecast-linked
  // bills are excluded: their amount comes solely from the forecast, so when the
  // forecast is empty for a month they read $0 rather than carrying a stale actual.
  const variableFallbackMap = {}
  for (const bill of bills) {
    if (bill.fixed_amount == null && !bill.forecast_category_id && lastKnownAmounts[bill.id] != null) {
      variableFallbackMap[bill.id] = lastKnownAmounts[bill.id]
    }
  }

  // Budget-derived forecast amounts for future slots.
  const futureSlots = slots.filter(s => s.isFuture)
  const forecastResults = {}
  if (futureSlots.length > 0 && bills.some(b => b.forecast_category_id)) {
    await Promise.all(futureSlots.map(async s => {
      forecastResults[`${s.year}-${s.month}`] = await getForecastAmountsForBills(userId, s.year, s.month, bills)
    }))
  }

  // For bills linked to an expense category (actuals_category), fetch the real
  // transaction totals per month so past periods show what actually went out
  // instead of requiring manual bill_amounts entries. Only past + current months
  // need this — future months still use the forecast mechanism.
  const actualsLinkedBills = bills.filter(b => b.actuals_category)
  const categoryActualsIndex = {} // [year][month][category] = total outflow
  if (actualsLinkedBills.length > 0) {
    const cats = [...new Set(actualsLinkedBills.map(b => b.actuals_category))]
    const txns = await getExpenseActualsByCategories(userId, cats, startYear, endYear)
    for (const t of txns) {
      const d = new Date(t.date)
      const y = d.getFullYear(), m = d.getMonth() + 1
      if (!categoryActualsIndex[y]) categoryActualsIndex[y] = {}
      if (!categoryActualsIndex[y][m]) categoryActualsIndex[y][m] = {}
      const cat = t.category
      categoryActualsIndex[y][m][cat] = (categoryActualsIndex[y][m][cat] ?? 0) + Math.abs(Number(t.amount))
    }
  }

  // Projected credit-card statements for every year the forecast window spans,
  // merged per card so a statement is matched by its due date regardless of which
  // year it closes in (e.g. a December statement paid in January).
  const statementsByCard = {}
  const futureYears = [...new Set(futureSlots.map(s => s.year))]
  if (futureYears.length > 0 && creditCards.length > 0 && bills.some(b => b.credit_card_id)) {
    await Promise.all(futureYears.map(async year => {
      const [lineItems, forecastLines] = await Promise.all([
        getBudgetLineItems(userId, { year }),
        getForecastLineItems(userId, year),
      ])
      const cashflow = routeForecastToCards({
        budgetCategories, lineItems, forecastLines,
        cards: creditCards, earnRateMap,
        coveragePct: ccCoverage, optimizationPct: ccOptimization,
      })
      const stmts = computeStatementForecast({
        cardDollarsByMonth: cashflow.cardDollarsByMonth, cards: creditCards, year,
      })
      for (const cardId of Object.keys(stmts)) {
        statementsByCard[cardId] = (statementsByCard[cardId] ?? []).concat(stmts[cardId])
      }
    }))
  }

  return slots.map(slot => {
    // Start with manually-entered/pulled bill_amounts, then overlay category
    // actuals for bills linked to a transaction category (past months only).
    let billAmountsMap = amountIndex[slot.year]?.[slot.month] ?? {}
    if (!slot.isFuture && actualsLinkedBills.length > 0) {
      const monthCatActuals = categoryActualsIndex[slot.year]?.[slot.month] ?? {}
      const overlay = {}
      for (const bill of actualsLinkedBills) {
        overlay[bill.id] = monthCatActuals[bill.actuals_category] ?? 0
      }
      billAmountsMap = { ...billAmountsMap, ...overlay }
    }
    const cardStatementMap = slot.isFuture
      ? projectedBillAmounts({ bills, statementsByCard, year: slot.year, month: slot.month })
      : {}
    const forecastAmountsMap = slot.isFuture
      ? { ...variableFallbackMap, ...(forecastResults[`${slot.year}-${slot.month}`] ?? {}), ...cardStatementMap }
      : {}

    const { period1, period2 } = splitBillsByPeriod(bills, billAmountsMap, midpoint, forecastAmountsMap, cardStatementMap)
    const period1Total = period1.reduce((s, b) => s + (b.resolvedAmount != null ? Number(b.resolvedAmount) : 0), 0)
    const period2Total = period2.reduce((s, b) => s + (b.resolvedAmount != null ? Number(b.resolvedAmount) : 0), 0)
    return { ...slot, period1Total, period2Total, period1Bills: period1, period2Bills: period2 }
  })
}

// Compute per-month cash inflow. Resolution per month:
//   stored actual (pulled from transactions or manually adjusted)        →
//   else, current + future months: net salary/bonus forecast from Settings →
//   else, an elapsed past month with no stored actual: live sum of income
//     transactions for that month (same filter "Pull income from history" uses,
//     just computed on the fly instead of requiring the user to click it) →
//   else (no income transactions found either): 0.
// The current month is forecast, not history — it's still in progress, so pulling
// partial month-to-date income would understate it.
// Returns the slots array, each with { inflow, inflowIsActual, inflowKind }.
//   inflowKind: 'actual' | 'forecast' | 'live' | 'none'
export async function loadInflowSeries({ userId, profile, budgetCategories = [], now = new Date() }) {
  const { slots } = buildMonthSlots(now)
  const startYear = slots[0].year
  const endYear = slots[slots.length - 1].year

  // Stored actuals (pulled or manual), indexed by year→month.
  const rawActuals = await getIncomeActualsRange(userId, startYear, endYear)
  const actualIndex = {}
  for (const row of rawActuals) {
    if (!actualIndex[row.year]) actualIndex[row.year] = {}
    actualIndex[row.year][row.month] = Number(row.amount)
  }

  // Live fallback for elapsed past months with no stored actual: sum income
  // transactions directly, same category exclusions as the manual pull.
  const unresolvedPast = slots.filter(s => !s.isFuture && !s.isCurrent && actualIndex[s.year]?.[s.month] == null)
  const liveIndex = {}
  if (unresolvedPast.length > 0) {
    const excludedSet = new Set((budgetCategories ?? []).filter(c => c.exclude_from_totals).map(c => c.category))
    const first = unresolvedPast[0]
    const last = unresolvedPast[unresolvedPast.length - 1]
    const startDate = `${first.year}-${String(first.month).padStart(2, '0')}-01`
    const lastDay = new Date(last.year, last.month, 0).getDate()
    const endDate = `${last.year}-${String(last.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    const txns = await getIncomeTransactions(userId, startDate, endDate)
    for (const t of txns) {
      if (excludedSet.has(t.category)) continue
      const d = new Date(t.date)
      const y = d.getFullYear(), m = d.getMonth() + 1
      if (!liveIndex[y]) liveIndex[y] = {}
      liveIndex[y][m] = (liveIndex[y][m] ?? 0) + Number(t.amount)
    }
  }

  // Settings-derived net forecast, per year the current+future window spans.
  const forecastByYear = {}
  if (Number(profile?.annual_income) > 0) {
    const forecastYears = [...new Set(slots.filter(s => s.isFuture || s.isCurrent).map(s => s.year))]
    const tp = profile.tax_profile || {}
    await Promise.all(forecastYears.map(async year => {
      const est = await estimateNet({
        grossIncome: Number(profile.annual_income) || 0,
        bonus: Number(profile.annual_bonus) || 0,
        filingStatus: tp.filingStatus || 'single',
        state: tp.state || null,
        stateRateOverride: tp.stateRateOverride ?? null,
        preTaxDeductions: (Number(tp.preTax401k) || 0) + (Number(tp.preTaxOther) || 0),
        year,
      }).catch(() => null)
      forecastByYear[year] = monthlyNetForecast(profile, est)
    }))
  }

  return slots.map(slot => {
    const stored = actualIndex[slot.year]?.[slot.month]
    if (stored != null) return { ...slot, inflow: stored, inflowIsActual: true, inflowKind: 'actual' }
    if (slot.isFuture || slot.isCurrent) {
      const fc = forecastByYear[slot.year]?.[slot.month - 1] ?? 0
      return { ...slot, inflow: fc, inflowIsActual: false, inflowKind: fc > 0 ? 'forecast' : 'none' }
    }
    const live = liveIndex[slot.year]?.[slot.month] ?? 0
    return { ...slot, inflow: live, inflowIsActual: false, inflowKind: live > 0 ? 'live' : 'none' }
  })
}

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

export { MONTHS }

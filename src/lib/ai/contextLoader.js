import { getRecentTransactions } from '../db/transactions.js'
import { getBudgetCategories } from '../db/budgetCategories.js'
import { getCommitments } from '../db/commitments.js'
import { getScenarios, getAdjustments } from '../db/scenarios.js'
import { getLatestWealthSnapshot } from '../db/wealthSnapshots.js'
import { getBudgetLineItems, getBudgetYears } from '../db/budgetLineItems.js'
import { getForecastOverrides } from '../db/forecastOverrides.js'
import { getForecastLineItems } from '../db/forecastLineItems.js'
import { getProfile } from '../db/profile.js'
import { estimateNet } from '../db/taxBrackets.js'
import { getAIPreferences } from '../db/aiPreferences.js'
import { formatPreferencesForBrief } from './preferences.js'
import { incomeVsExpenses } from '../dashboard/widgetData.js'

// How far back the AI's transaction context reaches. A full trailing year
// captures the user's actual annual cycle (seasonality, annual bills, bonuses)
// rather than anchoring the AI to an arbitrary rolling quarter.
const CONTEXT_DAYS = 365

// Loads the structured financial brief the AI reasons against at session start.
// Mirrors ARCHITECTURE §5.2 (AI Context Strategy): trailing 12 months of
// transactions (summary level), budget categories, current-year budget line
// items, active commitments, latest wealth snapshot, all open scenarios, and the
// user's AI personalization preferences.

export async function loadAIContext(userId) {
  const thisYear = new Date().getFullYear()

  const [transactions, categories, commitments, wealth, scenarios, budgetYears, profile, aiPreferences] =
    await Promise.all([
      getRecentTransactions(userId, CONTEXT_DAYS).catch(() => []),
      getBudgetCategories(userId).catch(() => []),
      getCommitments(userId, { status: null }).catch(() => []),
      getLatestWealthSnapshot(userId).catch(() => null),
      getScenarios(userId).catch(() => []),
      getBudgetYears(userId).catch(() => []),
      getProfile(userId).catch(() => null),
      getAIPreferences(userId).catch(() => ({ preferences: {}, grill_enabled: false })),
    ])

  // Estimated take-home for the current year (gross→net), so the assistant
  // reasons on after-tax dollars. Null when no income is set or brackets are
  // unavailable.
  let incomeEstimate = null
  if (profile?.annual_income > 0) {
    const tp = profile.tax_profile || {}
    incomeEstimate = await estimateNet({
      grossIncome: Number(profile.annual_income) || 0,
      bonus: Number(profile.annual_bonus) || 0,
      filingStatus: tp.filingStatus || 'single',
      state: tp.state || null,
      stateRateOverride: tp.stateRateOverride ?? null,
      preTaxDeductions: (Number(tp.preTax401k) || 0) + (Number(tp.preTaxOther) || 0),
      year: thisYear,
    }).catch(() => null)
  }

  const [budgetLineItems, forecastOverrides, forecastLineItems, scenariosWithAdjs] = await Promise.all([
    getBudgetLineItems(userId, { year: thisYear }).catch(() => []),
    getForecastOverrides(userId, thisYear).catch(() => []),
    getForecastLineItems(userId, thisYear).catch(() => []),
    // Load adjustments for all open scenarios (modeled + committed)
    Promise.all(
      scenarios.map(async s => {
        const adjustments = await getAdjustments(userId, s.id).catch(() => [])
        return { ...s, adjustments }
      })
    ),
  ])

  // Drop transfers / credit-card payments so spend and income aren't overstated.
  const excluded = new Set(categories.filter(c => c.exclude_from_totals).map(c => c.category))
  const realTransactions = excluded.size
    ? transactions.filter(t => !excluded.has(t.category))
    : transactions

  return {
    transactions: realTransactions,
    categories,
    commitments,
    wealth,
    scenarios: scenariosWithAdjs,
    budgetLineItems,
    forecastOverrides,
    forecastLineItems,
    budgetYears,
    profile,
    incomeEstimate,
    aiPreferences: aiPreferences?.preferences ?? {},
    grillEnabled: aiPreferences?.grill_enabled ?? false,
    thisYear,
    varianceThreshold: profile?.variance_threshold ?? 10,
    loadedAt: new Date().toISOString(),
  }
}

// Lightweight stats for dashboard widgets / UI badges.
export function summarizeContext(ctx) {
  const txn = ctx?.transactions ?? []
  const spendTrailing = txn
    .filter(t => Number(t.amount) < 0)
    .reduce((sum, t) => sum + Math.abs(Number(t.amount) || 0), 0)
  const incomeTrailing = txn
    .filter(t => Number(t.amount) > 0)
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0)

  const scenarios = ctx?.scenarios ?? []
  const commitments = ctx?.commitments ?? []
  const lineItems = ctx?.budgetLineItems ?? []
  const budgetTotal = lineItems.reduce((sum, li) => sum + Number(li.amount || 0), 0)
  const wealth = ctx?.wealth ?? null

  return {
    transactionCount: txn.length,
    categoryCount: (ctx?.categories ?? []).length,
    commitmentCount: commitments.length,
    activeCommitmentCount: commitments.filter(c => c.status === 'active').length,
    scenarioCount: scenarios.length,
    modeledCount: scenarios.filter(s => s.state === 'modeled').length,
    committedCount: scenarios.filter(s => s.state === 'committed').length,
    budgetYears: ctx?.budgetYears ?? [],
    budgetLineItemCount: lineItems.length,
    budgetTotal,
    spendTrailing,
    incomeTrailing,
    hasWealth: !!wealth,
    netWorth: wealth ? Number(wealth.net_worth || 0) : null,
  }
}

// Structured text brief — formatted for the AI to reason against immediately.
// Used once the Edge Function proxy is wired (see sendMessage.js).
export function buildContextBrief(ctx, yearTxns) {
  if (!ctx) return 'No financial context loaded.'
  const s = summarizeContext(ctx)
  const lines = []

  lines.push('## Financial Context')

  // Current-year projection: YTD actuals + remaining-month forecasts.
  // Prefer the freshly-fetched yearTxns (same dataset the dashboard widgets use);
  // fall back to filtering ctx.transactions when yearTxns isn't passed.
  const currentYearTxns = yearTxns ?? (ctx?.transactions ?? []).filter(t => {
    const d = new Date(t.date)
    return !Number.isNaN(d.getTime()) && d.getFullYear() === ctx?.thisYear
  })
  const ivs = incomeVsExpenses(ctx, currentYearTxns)
  if (ivs.hasData || (ctx?.budgetLineItems ?? []).length > 0) {
    const savingsNote = ivs.fullYearSavingsRate != null
      ? `, ~${Math.round(ivs.fullYearSavingsRate)}% projected savings rate`
      : ''
    const netSign = ivs.fullYearNet >= 0 ? '+' : ''
    lines.push(
      `- Current year (${ctx.thisYear}) projection: ` +
      `~$${Math.round(ivs.fullYearIncome).toLocaleString()} income (YTD actuals + salary forecast for remaining months), ` +
      `~$${Math.round(ivs.fullYearExpenses).toLocaleString()} expenses (YTD actuals + budget forecast for remaining months), ` +
      `net ${netSign}$${Math.round(ivs.fullYearNet).toLocaleString()}${savingsNote}`
    )
  }

  // Trailing 12-month actuals (spans two calendar years — for trend context only).
  lines.push(
    `- Trailing 12-month actuals (${s.transactionCount} rows, spans prior + current year): ` +
    `~$${Math.round(s.spendTrailing).toLocaleString()} spend, ` +
    `~$${Math.round(s.incomeTrailing).toLocaleString()} income`
  )

  const inc = ctx.incomeEstimate
  if (inc && inc.grossWages > 0) {
    lines.push(
      `- Salary profile (${inc.year}${inc.estimated ? ', est.' : ''}, for tax reference only — use "Current year projection" above for actual net income): ` +
      `$${Math.round(inc.grossWages).toLocaleString()} gross, ` +
      `~${(inc.effectiveRate * 100).toFixed(0)}% est. effective tax rate ` +
      `(federal $${Math.round(inc.federalTax).toLocaleString()}, ` +
      `FICA $${Math.round(inc.ficaTax).toLocaleString()}, ` +
      `state $${Math.round(inc.stateTax).toLocaleString()})`
    )
  }

  if (s.categoryCount) {
    const byGroup = {}
    for (const c of ctx.categories) {
      byGroup[c.group] = (byGroup[c.group] || 0) + 1
    }
    const groups = Object.entries(byGroup)
      .map(([g, n]) => `${g} (${n})`)
      .join(', ')
    lines.push(`- Budget categories: ${s.categoryCount} across groups — ${groups}`)
  }

  if (s.commitmentCount) {
    const active = ctx.commitments.filter(c => c.status === 'active')
    const names = (active.length ? active : ctx.commitments).map(c => c.name).join(', ')
    lines.push(`- Commitments: ${s.commitmentCount} (${s.activeCommitmentCount} active) — ${names}`)
  }

  if (s.budgetLineItemCount) {
    lines.push(
      `- Budget (${ctx.thisYear}): ${s.budgetLineItemCount} line items, ` +
      `~$${Math.round(s.budgetTotal).toLocaleString()} planned for the year`
    )
  } else if (s.budgetYears.length) {
    lines.push(`- Budget years on file: ${s.budgetYears.join(', ')}`)
  }

  if (ctx.wealth) {
    lines.push(
      `- Latest wealth snapshot (${ctx.wealth.snapshot_date}): ` +
      `net worth $${Number(ctx.wealth.net_worth || 0).toLocaleString()}`
    )
  }

  const scenarios = ctx?.scenarios ?? []
  if (scenarios.length) {
    const modeled = scenarios.filter(s => s.state === 'modeled')
    const committed = scenarios.filter(s => s.state === 'committed')
    if (committed.length) {
      lines.push(`\n## Committed Scenarios (${committed.length})`)
      for (const s of committed) {
        const total = (s.adjustments ?? []).reduce((sum, a) => sum + Number(a.delta_amount), 0)
        lines.push(`- "${s.name}"${s.description ? ': ' + s.description : ''} — ${s.adjustments?.length ?? 0} adjustments, net delta $${Math.round(total).toLocaleString()}`)
      }
    }
    if (modeled.length) {
      lines.push(`\n## Modeled Scenarios (${modeled.length})`)
      for (const s of modeled) {
        const total = (s.adjustments ?? []).reduce((sum, a) => sum + Number(a.delta_amount), 0)
        lines.push(`- "${s.name}"${s.description ? ': ' + s.description : ''} — ${s.adjustments?.length ?? 0} adjustments, net delta $${Math.round(total).toLocaleString()}`)
      }
    }
  }

  const prefsBlock = formatPreferencesForBrief(ctx?.aiPreferences)
  if (prefsBlock) lines.push('\n' + prefsBlock)

  return lines.join('\n')
}

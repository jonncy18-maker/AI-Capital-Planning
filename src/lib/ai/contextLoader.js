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

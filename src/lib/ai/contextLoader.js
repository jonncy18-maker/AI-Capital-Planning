import { getRecentTransactions } from '../db/transactions.js'
import { getBudgetCategories } from '../db/budgetCategories.js'
import { getCommitments } from '../db/commitments.js'
import { getScenarios, getAdjustments } from '../db/scenarios.js'
import { getLatestWealthSnapshot } from '../db/wealthSnapshots.js'
import { getBudgetLineItems, getBudgetYears } from '../db/budgetLineItems.js'

// Loads the structured financial brief the AI reasons against at session start.
// Mirrors ARCHITECTURE §5.2 (AI Context Strategy): last 90 days of transactions
// (summary level), budget categories, current-year budget line items, active
// commitments, latest wealth snapshot, and all open scenarios.

export async function loadAIContext(userId) {
  const thisYear = new Date().getFullYear()

  const [transactions, categories, commitments, wealth, scenarios, budgetYears] =
    await Promise.all([
      getRecentTransactions(userId, 90).catch(() => []),
      getBudgetCategories(userId).catch(() => []),
      getCommitments(userId, { status: null }).catch(() => []),
      getLatestWealthSnapshot(userId).catch(() => null),
      getScenarios(userId).catch(() => []),
      getBudgetYears(userId).catch(() => []),
    ])

  const [budgetLineItems, scenariosWithAdjs] = await Promise.all([
    getBudgetLineItems(userId, { year: thisYear }).catch(() => []),
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
    budgetYears,
    thisYear,
    loadedAt: new Date().toISOString(),
  }
}

// Lightweight stats for dashboard widgets / UI badges.
export function summarizeContext(ctx) {
  const txn = ctx?.transactions ?? []
  const spend90d = txn
    .filter(t => Number(t.amount) < 0)
    .reduce((sum, t) => sum + Math.abs(Number(t.amount) || 0), 0)
  const income90d = txn
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
    spend90d,
    income90d,
    hasWealth: !!wealth,
    netWorth: wealth ? Number(wealth.net_worth || 0) : null,
  }
}

// Structured text brief — formatted for the AI to reason against immediately.
// Used once the Edge Function proxy is wired (see sendMessage.js).
export function buildContextBrief(ctx) {
  if (!ctx) return 'No financial context loaded.'
  const s = summarizeContext(ctx)
  const lines = []

  lines.push('## Financial Context')
  lines.push(
    `- Transactions (last 90d): ${s.transactionCount} rows, ` +
    `~$${Math.round(s.spend90d).toLocaleString()} spend, ` +
    `~$${Math.round(s.income90d).toLocaleString()} income`
  )

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

  return lines.join('\n')
}

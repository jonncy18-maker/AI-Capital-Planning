// Read-everywhere tool. One tool with a `resource` switch rather than ~20
// single-purpose read tools: the schema stays small enough to keep in every
// prompt, and adding a resource costs one case rather than one more tool the
// model has to choose between.
//
// The session context brief (contextLoader.js) is a summary loaded once. This
// tool is the live path — it is what the assistant uses when a question needs
// current, row-level data from a module it wasn't briefed on.

import { getBills, getAccounts, getAccountBalances, getBillAmountsRange } from '../../db/bills.js'
import { getCommitments } from '../../db/commitments.js'
import {
  getCreditCards, getEarnRates, getPointsBalances, getPointRedemptions, getCCSettings,
} from '../../db/creditCards.js'
import { getWealthSnapshots } from '../../db/wealthSnapshots.js'
import { getBudgetCategories } from '../../db/budgetCategories.js'
import { getBudgetLineItems, getBudgetYears } from '../../db/budgetLineItems.js'
import { getForecastLineItems } from '../../db/forecastLineItems.js'
import { getForecastOverrides } from '../../db/forecastOverrides.js'
import { getScenarios, getAdjustments } from '../../db/scenarios.js'
import { getTransactionsByMonth } from '../../db/transactions.js'
import { getIncomeActualsRange } from '../../db/income.js'
import { getProfile } from '../../db/profile.js'
import { getAIPreferences } from '../../db/aiPreferences.js'
import { getImportHistory } from '../../db/importLog.js'
import { thisYear, toYear, toMonth, resolveByName } from './helpers.js'

// Row ceiling per lookup. Enough for a full year of line items; small enough
// that a careless query can't blow the context window.
const MAX_ROWS = 400

const RESOURCES = [
  'bills', 'bill_amounts', 'accounts', 'account_balances',
  'commitments',
  'credit_cards', 'earn_rates', 'points_balances', 'redemptions', 'credit_card_settings',
  'wealth_snapshots',
  'budget_categories', 'budget_line_items', 'budget_years',
  'forecast_line_items', 'forecast_overrides',
  'scenarios', 'scenario_adjustments',
  'transactions', 'income_actuals',
  'profile', 'ai_preferences', 'import_history',
]

export const LOOKUP_TOOL = {
  name: 'lookup_data',
  description:
    'Read the user\'s live data for any module. Use this BEFORE any write when you need ' +
    'current values, exact names, or ids — the financial context in the system prompt is a ' +
    'session summary and may be stale or incomplete. Returns rows as JSON. ' +
    'Also use it to answer questions about modules the context brief does not cover ' +
    '(bills, accounts, credit cards, forecast, income actuals, import history).',
  input_schema: {
    type: 'object',
    properties: {
      resource: { type: 'string', enum: RESOURCES, description: 'Which dataset to read.' },
      year: { type: 'integer', description: 'Four-digit year. Used by bill_amounts, account_balances, redemptions, budget_line_items, forecast_line_items, forecast_overrides, transactions, income_actuals. Defaults to the current year.' },
      month: { type: 'integer', minimum: 1, maximum: 12, description: 'Month 1-12. Used by account_balances and transactions.' },
      scenario: { type: 'string', description: 'Scenario name or id — required for scenario_adjustments.' },
      search: { type: 'string', description: 'Case-insensitive filter applied to the row name/category/group/merchant.' },
      limit: { type: 'integer', description: `Max rows to return (default 100, hard cap ${MAX_ROWS}).` },
      offset: { type: 'integer', description: 'Skip this many matching rows before returning `limit` more — page through a result larger than one call can return using the previous response\'s `next_offset`.' },
    },
    required: ['resource'],
  },
}

function matches(rowObj, needle) {
  if (!needle) return true
  const lc = needle.toLowerCase()
  return ['name', 'category', 'merchant', 'label', 'group', 'notes'].some(k => {
    const v = rowObj?.[k]
    return typeof v === 'string' && v.toLowerCase().includes(lc)
  })
}

// Drop null/empty keys so a 400-row payload stays compact in the tool_result.
function compact(rowObj) {
  const out = {}
  for (const [k, v] of Object.entries(rowObj ?? {})) {
    if (v === null || v === undefined || v === '') continue
    out[k] = v
  }
  return out
}

async function fetchResource(userId, input) {
  const year = input.year ? toYear(input.year) : thisYear()
  const month = input.month ? toMonth(input.month) : null

  switch (input.resource) {
    case 'bills': return getBills(userId)
    case 'bill_amounts': return getBillAmountsRange(userId, year, year)
    case 'accounts': return getAccounts(userId)
    case 'account_balances': return getAccountBalances(userId, year, month ?? new Date().getMonth() + 1)
    case 'commitments': return getCommitments(userId, { status: null })
    case 'credit_cards': return getCreditCards(userId)
    case 'earn_rates': return getEarnRates(userId)
    case 'points_balances': {
      const map = await getPointsBalances(userId)
      return Object.entries(map ?? {}).map(([cardId, v]) => ({ card_id: cardId, ...v }))
    }
    case 'redemptions': return getPointRedemptions(userId, year)
    case 'credit_card_settings': {
      const s = await getCCSettings(userId)
      return [s ?? {}]
    }
    case 'wealth_snapshots': return getWealthSnapshots(userId, 24)
    case 'budget_categories': return getBudgetCategories(userId)
    case 'budget_line_items': {
      const rows = await getBudgetLineItems(userId, { year })
      return (rows ?? []).map(li => ({
        id: li.id,
        category: li.budget_categories?.category ?? null,
        group: li.budget_categories?.group ?? null,
        month: li.month,
        year: li.budget_year,
        amount: li.amount,
        label: li.label,
      }))
    }
    case 'budget_years': {
      const years = await getBudgetYears(userId)
      return (years ?? []).map(y => (typeof y === 'object' ? y : { year: y }))
    }
    case 'forecast_line_items': {
      const rows = await getForecastLineItems(userId, year)
      return (rows ?? []).map(li => ({
        id: li.id,
        category: li.budget_categories?.category ?? li.category ?? null,
        group: li.budget_categories?.group ?? null,
        month: li.month,
        year: li.budget_year ?? year,
        amount: li.amount,
        label: li.label,
        source: li.source,
      }))
    }
    case 'forecast_overrides': return getForecastOverrides(userId, year)
    case 'scenarios': return getScenarios(userId)
    case 'scenario_adjustments': {
      const scenarios = await getScenarios(userId)
      const target = resolveByName(scenarios, input.scenario)
      if (!target) throw new Error('Scenario not found — pass the scenario name or id in `scenario`.')
      const adj = await getAdjustments(userId, target.id)
      return (adj ?? []).map(a => ({
        id: a.id,
        scenario: target.name,
        category: a.budget_categories?.category ?? null,
        year: a.year,
        month: a.month,
        delta_amount: a.delta_amount,
        label: a.label,
      }))
    }
    case 'transactions': {
      const start = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`
      const end = month
        ? new Date(year, month, 0).toISOString().slice(0, 10)
        : `${year}-12-31`
      return getTransactionsByMonth(userId, start, end)
    }
    case 'income_actuals': return getIncomeActualsRange(userId, year, year)
    case 'profile': {
      const p = await getProfile(userId)
      return [p ?? {}]
    }
    case 'ai_preferences': {
      const p = await getAIPreferences(userId)
      return [p ?? {}]
    }
    case 'import_history': return getImportHistory(userId)
    default:
      throw new Error(`Unknown resource: ${input.resource}`)
  }
}

export const readTools = [
  {
    name: LOOKUP_TOOL.name,
    group: 'read',
    write: false,
    schema: LOOKUP_TOOL,
    async execute(userId, input) {
      const rows = await fetchResource(userId, input ?? {})
      const list = Array.isArray(rows) ? rows : [rows]
      const filtered = list.filter(r => matches(r, input?.search))
      const limit = Math.min(MAX_ROWS, Math.max(1, Number(input?.limit) || 100))
      const offset = Math.max(0, Number(input?.offset) || 0)
      const page = filtered.slice(offset, offset + limit).map(compact)
      const nextOffset = offset + page.length < filtered.length ? offset + page.length : null
      return {
        summary: `Read ${page.length} of ${filtered.length} ${input.resource} row${filtered.length === 1 ? '' : 's'}`
          + (nextOffset != null ? ` (more available — call again with offset: ${nextOffset})` : ''),
        result: {
          resource: input.resource,
          count: filtered.length,
          returned: page.length,
          offset,
          next_offset: nextOffset,
          truncated: nextOffset != null,
          rows: page,
        },
      }
    },
  },
]

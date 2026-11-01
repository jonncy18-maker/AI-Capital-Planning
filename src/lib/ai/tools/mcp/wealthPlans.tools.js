// Saved wealth plan tools (MCP only).

import { getWealthPlans, saveWealthPlan } from '../../../db/wealthPlans.js'
import { validatePlan } from '../../../wealth/plans.js'
import { derivePlan } from '../../../wealth/projection.js'
import { money, row } from '../helpers.js'
import { withMode } from './shared.js'

function withoutMode(input) {
  const plan = { ...(input ?? {}) }
  delete plan.mode
  return plan
}

export const wealthPlanTools = [
  {
    name: 'list_wealth_plans',
    group: 'wealth',
    write: false,
    schema: {
      name: 'list_wealth_plans',
      description: 'Saved wealth plans (the frozen benchmark the Wealth tab compares snapshots against), newest first.',
      input_schema: { type: 'object', properties: {} },
    },
    async execute() {
      const rows = await getWealthPlans()
      return { summary: `${rows.length} wealth plan${rows.length === 1 ? '' : 's'}`, result: { count: rows.length, rows } }
    },
  },

  {
    name: 'save_wealth_plan',
    group: 'wealth',
    write: true,
    mcpGated: true,
    schema: {
      name: 'save_wealth_plan',
      description:
        'Save a wealth plan. Plans are immutable: saving always creates a new version and there is no ' +
        'update or delete, so check the preview first. The server validates the plan and, when it has ' +
        '`assumptions`, re-derives the frozen columns from them.',
      input_schema: {
        type: 'object',
        properties: withMode({
          name: { type: 'string', description: 'Up to 100 characters.' },
          start_date: { type: 'string', description: 'YYYY-MM-DD.' },
          start_balance: { type: 'number' },
          monthly_contribution: { type: 'number' },
          annual_return: { type: 'number', description: 'Decimal between 0 and 0.25.' },
          horizon: { type: 'integer', description: 'Years, 5 to 40.' },
          retirement_target: { type: 'number' },
          include_commitments: { type: 'boolean' },
          emergency_cash_target: { type: 'number' },
          starting_contributions_ytd: { type: 'number' },
          annual_commitment_drain: { type: 'number' },
          annual_contributions: { type: 'object', description: 'Year -> contribution.' },
          annual_contributions_without_commitments: { type: 'object', description: 'Year -> contribution.' },
          assumptions: { type: 'object', description: 'Wealth assumptions object (see the Wealth tab).' },
        }),
        required: ['name', 'start_date', 'start_balance', 'monthly_contribution', 'annual_return', 'horizon', 'retirement_target', 'include_commitments'],
      },
    },
    async preview(input) {
      try {
        const p = derivePlan(validatePlan(withoutMode(input)))
        return {
          title: `Save wealth plan · ${p.name}`,
          subtitle: 'Creates a new immutable version.',
          rows: [
            row('Start', `${p.start_date} · ${money(p.start_balance)}`),
            row('Monthly contribution', money(p.monthly_contribution)),
            row('Annual return', `${(p.annual_return * 100).toFixed(2)}%`),
            row('Horizon', `${p.horizon} years`),
            row('Retirement target', money(p.retirement_target)),
            row('Includes commitments', p.include_commitments ? 'yes' : 'no'),
          ],
        }
      } catch (e) {
        return { title: 'Save wealth plan', subtitle: `Invalid plan: ${e.message}`, rows: [] }
      }
    },
    async execute(_userId, input) {
      const saved = await saveWealthPlan(withoutMode(input))
      return { summary: `Saved wealth plan "${saved?.name ?? input.name}"`, result: saved }
    },
  },
]

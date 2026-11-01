// Scenario outlook-adjustment tools (MCP only).

import { getScenarios } from '../../../db/scenarios.js'
import {
  getScenarioOutlookAdjustments, getAllOutlookAdjustments, getCommittedOutlookAdjustments,
  addScenarioOutlookAdjustment, deleteScenarioOutlookAdjustment,
} from '../../../db/outlook.js'
import { resolveByName, row, signedMoney, requireField, toNumber, toYear } from '../helpers.js'
import { withMode } from './shared.js'

async function requireScenario(userId, needle) {
  requireField({ scenario: needle }, 'scenario')
  const target = resolveByName(await getScenarios(userId), needle)
  if (!target) throw new Error(`No scenario named "${needle}".`)
  return target
}

export const scenarioOutlookTools = [
  {
    name: 'list_scenario_outlook_adjustments',
    group: 'scenarios',
    write: false,
    schema: {
      name: 'list_scenario_outlook_adjustments',
      description:
        'Outlook adjustments (a yearly delta on an expense group). With `scenario`, that scenario\'s ' +
        'adjustments; otherwise every adjustment, or only those of committed scenarios when committed_only is true.',
      input_schema: {
        type: 'object',
        properties: {
          scenario: { type: 'string', description: 'Scenario name or id.' },
          committed_only: { type: 'boolean' },
        },
      },
    },
    async execute(userId, input) {
      let rows
      if (input.scenario) rows = await getScenarioOutlookAdjustments((await requireScenario(userId, input.scenario)).id)
      else rows = input.committed_only ? await getCommittedOutlookAdjustments() : await getAllOutlookAdjustments()
      return { summary: `${rows.length} outlook adjustment${rows.length === 1 ? '' : 's'}`, result: { count: rows.length, rows } }
    },
  },

  {
    name: 'add_scenario_outlook_adjustment',
    group: 'scenarios',
    write: true,
    mcpGated: true,
    schema: {
      name: 'add_scenario_outlook_adjustment',
      description: 'Add a yearly outlook adjustment to a scenario: delta_amount is added to the group for that year (negative = saves money).',
      input_schema: {
        type: 'object',
        properties: withMode({
          scenario: { type: 'string', description: 'Scenario name or id.' },
          year: { type: 'integer' },
          group_name: { type: 'string' },
          delta_amount: { type: 'number' },
          label: { type: 'string' },
        }),
        required: ['scenario', 'year', 'group_name', 'delta_amount'],
      },
    },
    async preview(input, ctx) {
      const target = await requireScenario(ctx.userId, input.scenario)
      return {
        title: `Outlook adjustment · ${target.name}`,
        subtitle: input.label || '',
        rows: [row('Year', input.year), row('Group', input.group_name), row('Delta', signedMoney(input.delta_amount))],
      }
    },
    async execute(userId, input) {
      const target = await requireScenario(userId, input.scenario)
      const saved = await addScenarioOutlookAdjustment(target.id, {
        year: toYear(requireField(input, 'year')),
        group_name: requireField(input, 'group_name'),
        delta_amount: toNumber(requireField(input, 'delta_amount')),
        label: input.label ?? '',
      })
      return { summary: `Added outlook adjustment to "${target.name}"`, result: saved }
    },
  },

  {
    name: 'delete_scenario_outlook_adjustment',
    group: 'scenarios',
    write: true,
    mcpGated: true,
    schema: {
      name: 'delete_scenario_outlook_adjustment',
      description: 'Delete one scenario outlook adjustment by id (see list_scenario_outlook_adjustments).',
      input_schema: {
        type: 'object',
        properties: withMode({ id: { type: 'string' } }),
        required: ['id'],
      },
    },
    async preview(input) {
      const target = (await getAllOutlookAdjustments()).find(a => a.id === input.id)
      return {
        title: 'Delete outlook adjustment',
        destructive: true,
        subtitle: target ? target.label || '' : `No adjustment with id ${input.id}`,
        rows: target
          ? [row('Year', target.year), row('Group', target.group_name), row('Delta', signedMoney(target.delta_amount))]
          : [],
      }
    },
    async execute(_userId, input) {
      requireField(input, 'id')
      await deleteScenarioOutlookAdjustment(input.id)
      return { summary: 'Deleted outlook adjustment', result: { id: input.id } }
    },
  },
]

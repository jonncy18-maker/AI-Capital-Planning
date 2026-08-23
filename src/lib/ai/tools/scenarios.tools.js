// Scenario Planner tools. create_scenario and add_adjustment keep the exact
// schemas and execution paths the Scenario Composer has always used — they are
// re-exported here so the global assistant reaches them through the same
// registry as everything else, and so their confirmation card stays the
// purpose-built scenario preview rather than the generic row list.

import {
  CREATE_SCENARIO_TOOL, ADD_ADJUSTMENT_TOOL,
  executeCreateScenario, executeAddAdjustments, buildPreview, buildAdjPreview,
} from '../scenarioAgent.js'
import {
  getScenarios, getAdjustments, deleteScenario, cloneScenario, updateScenario,
  promoteToCommitted, promoteToModeled, deleteAdjustment,
} from '../../db/scenarios.js'
import { getBudgetCategories } from '../../db/budgetCategories.js'
import { money, resolveByName, row, signedMoney, requireField, toNumber } from './helpers.js'

async function requireScenario(userId, needle) {
  const target = resolveByName(await getScenarios(userId), needle)
  if (!target) throw new Error(`No scenario named "${needle}".`)
  return target
}

export const scenarioTools = [
  {
    name: 'create_scenario',
    group: 'scenarios',
    write: true,
    schema: CREATE_SCENARIO_TOOL,
    async preview(input, ctx) {
      const categories = ctx.categories ?? await getBudgetCategories(ctx.userId)
      return { kind: 'scenario', ...buildPreview(input, categories) }
    },
    async execute(userId, input) {
      const summary = await executeCreateScenario(userId, input)
      return {
        summary: `Created scenario "${summary.name}" with ${summary.adjustmentCount} adjustment${summary.adjustmentCount === 1 ? '' : 's'}`,
        result: summary,
        // Surfaces the "Open →" card in the chat thread.
        created: summary,
        undo: { tool: 'delete_scenario', input: { scenario: summary.scenarioId } },
      }
    },
  },

  {
    name: 'add_scenario_adjustments',
    group: 'scenarios',
    write: true,
    schema: {
      name: 'add_scenario_adjustments',
      description:
        ADD_ADJUSTMENT_TOOL.description.replace('the current scenario', 'an existing scenario') +
        ' Name the scenario in `scenario`.',
      input_schema: {
        type: 'object',
        properties: {
          scenario: { type: 'string', description: 'Name or id of the scenario to add to.' },
          ...ADD_ADJUSTMENT_TOOL.input_schema.properties,
        },
        required: ['scenario', 'adjustments'],
      },
    },
    async preview(input, ctx) {
      const categories = ctx.categories ?? await getBudgetCategories(ctx.userId)
      const preview = buildAdjPreview(input, categories)
      return { kind: 'scenario', name: `Add to "${input.scenario}"`, description: '', ...preview }
    },
    async execute(userId, input) {
      const target = await requireScenario(userId, requireField(input, 'scenario'))
      const summary = await executeAddAdjustments(userId, target.id, input)
      return {
        summary: `Added ${summary.adjustmentCount} adjustment${summary.adjustmentCount === 1 ? '' : 's'} to "${target.name}"`,
        result: { scenarioId: target.id, ...summary },
        created: { scenarioId: target.id, name: target.name, ...summary },
      }
    },
  },

  {
    name: 'commit_scenario',
    group: 'scenarios',
    write: true,
    schema: {
      name: 'commit_scenario',
      description:
        'Promote a modeled scenario to committed. This writes its adjustments into the forecast, ' +
        'so every downstream view (Forecast, Bill Planner, cash flow) picks them up. Reversible ' +
        'with revert_scenario.',
      input_schema: {
        type: 'object',
        properties: { scenario: { type: 'string', description: 'Scenario name or id.' } },
        required: ['scenario'],
      },
    },
    async preview(input, ctx) {
      const target = resolveByName(await getScenarios(ctx.userId), input.scenario)
      const adjustments = target ? await getAdjustments(ctx.userId, target.id) : []
      const net = (adjustments ?? []).reduce((s, a) => s - toNumber(a.delta_amount), 0)
      return {
        title: `Commit scenario · ${target?.name ?? input.scenario}`,
        subtitle: 'Adjustments are written into the forecast and reach every downstream view.',
        rows: [
          row('Adjustments', (adjustments ?? []).length),
          row('Net cash impact', signedMoney(net), net >= 0 ? 'good' : 'bad'),
          row('Current state', target?.state ?? '—'),
        ],
      }
    },
    async execute(userId, input) {
      const target = await requireScenario(userId, requireField(input, 'scenario'))
      await promoteToCommitted(userId, target.id)
      return {
        summary: `Committed scenario "${target.name}"`,
        result: { scenarioId: target.id },
        undo: { tool: 'revert_scenario', input: { scenario: target.id } },
      }
    },
  },

  {
    name: 'revert_scenario',
    group: 'scenarios',
    write: true,
    schema: {
      name: 'revert_scenario',
      description: 'Move a committed scenario back to modeled, deleting the forecast rows it wrote. The scenario and its adjustments are kept.',
      input_schema: {
        type: 'object',
        properties: { scenario: { type: 'string', description: 'Scenario name or id.' } },
        required: ['scenario'],
      },
    },
    async preview(input, ctx) {
      const target = resolveByName(await getScenarios(ctx.userId), input.scenario)
      return {
        title: `Revert scenario · ${target?.name ?? input.scenario}`,
        subtitle: 'Its forecast rows are removed; the scenario itself stays.',
        rows: [row('Current state', target?.state ?? '—')],
        destructive: true,
      }
    },
    async execute(userId, input) {
      const target = await requireScenario(userId, requireField(input, 'scenario'))
      await promoteToModeled(userId, target.id)
      return { summary: `Reverted scenario "${target.name}" to modeled`, result: { scenarioId: target.id } }
    },
  },

  {
    name: 'update_scenario',
    group: 'scenarios',
    write: true,
    schema: {
      name: 'update_scenario',
      description:
        'Rename a scenario or edit its description — e.g. to correct stale wording after its ' +
        'adjustments changed. Does not touch state (use commit_scenario/revert_scenario for that) ' +
        'or its adjustments.',
      input_schema: {
        type: 'object',
        properties: {
          scenario: { type: 'string', description: 'Scenario name or id.' },
          name: { type: 'string', description: 'New name. Omit to leave unchanged.' },
          description: { type: 'string', description: 'New description. Omit to leave unchanged.' },
        },
        required: ['scenario'],
      },
    },
    async preview(input, ctx) {
      const target = resolveByName(await getScenarios(ctx.userId), input.scenario)
      const rows = []
      if (input.name !== undefined) rows.push(row('Name', `${target?.name ?? '—'} → ${input.name}`))
      if (input.description !== undefined) rows.push(row('Description', input.description || '(cleared)'))
      return {
        title: `Update scenario · ${target?.name ?? input.scenario}`,
        rows: rows.length ? rows : [row('Change', 'Nothing to update — provide name and/or description.', 'muted')],
      }
    },
    async execute(userId, input) {
      const target = await requireScenario(userId, requireField(input, 'scenario'))
      const updates = {}
      if (input.name !== undefined) updates.name = input.name
      if (input.description !== undefined) updates.description = input.description
      if (Object.keys(updates).length === 0) throw new Error('Provide a new name and/or description to update.')
      await updateScenario(userId, target.id, updates)
      return { summary: `Updated "${target.name}"`, result: { scenarioId: target.id, ...updates } }
    },
  },

  {
    name: 'clone_scenario',
    group: 'scenarios',
    write: true,
    schema: {
      name: 'clone_scenario',
      description: 'Copy a scenario and its adjustments under a new name, so a variant can be modelled without touching the original.',
      input_schema: {
        type: 'object',
        properties: {
          scenario: { type: 'string', description: 'Scenario to copy.' },
          name: { type: 'string', description: 'Name for the copy.' },
          description: { type: 'string' },
        },
        required: ['scenario', 'name'],
      },
    },
    async preview(input, ctx) {
      const target = resolveByName(await getScenarios(ctx.userId), input.scenario)
      const adjustments = target ? await getAdjustments(ctx.userId, target.id) : []
      return {
        title: `Clone scenario · ${target?.name ?? input.scenario}`,
        subtitle: input.description || '',
        rows: [row('New name', input.name), row('Adjustments copied', (adjustments ?? []).length)],
      }
    },
    async execute(userId, input) {
      const target = await requireScenario(userId, requireField(input, 'scenario'))
      const clone = await cloneScenario(userId, target.id, {
        name: requireField(input, 'name'),
        description: input.description ?? '',
      })
      return {
        summary: `Cloned "${target.name}" as "${input.name}"`,
        result: { scenarioId: clone?.id },
        undo: clone?.id ? { tool: 'delete_scenario', input: { scenario: clone.id } } : null,
      }
    },
  },

  {
    name: 'delete_scenario',
    group: 'scenarios',
    write: true,
    schema: {
      name: 'delete_scenario',
      description: 'Delete a scenario and all of its adjustments. If it is committed, its forecast rows are removed too.',
      input_schema: {
        type: 'object',
        properties: { scenario: { type: 'string', description: 'Scenario name or id.' } },
        required: ['scenario'],
      },
    },
    async preview(input, ctx) {
      const target = resolveByName(await getScenarios(ctx.userId), input.scenario)
      const adjustments = target ? await getAdjustments(ctx.userId, target.id) : []
      return {
        title: `Delete scenario · ${target?.name ?? input.scenario}`,
        subtitle: target ? '' : 'No scenario with that name was found.',
        rows: [
          row('State', target?.state ?? '—'),
          row('Adjustments lost', (adjustments ?? []).length, 'bad'),
        ],
        destructive: true,
      }
    },
    async execute(userId, input) {
      const target = await requireScenario(userId, requireField(input, 'scenario'))
      await deleteScenario(userId, target.id)
      return { summary: `Deleted scenario "${target.name}"`, result: { scenarioId: target.id } }
    },
  },

  {
    name: 'delete_scenario_adjustment',
    group: 'scenarios',
    write: true,
    schema: {
      name: 'delete_scenario_adjustment',
      description: 'Remove a single adjustment from a scenario. Read scenario_adjustments with lookup_data first to get the row to remove.',
      input_schema: {
        type: 'object',
        properties: {
          scenario: { type: 'string', description: 'Scenario name or id.' },
          adjustment_id: { type: 'string', description: 'Id of the adjustment row.' },
        },
        required: ['scenario', 'adjustment_id'],
      },
    },
    async preview(input, ctx) {
      const target = resolveByName(await getScenarios(ctx.userId), input.scenario)
      const adjustments = target ? await getAdjustments(ctx.userId, target.id) : []
      const adj = (adjustments ?? []).find(a => a.id === input.adjustment_id)
      return {
        title: `Delete adjustment · ${target?.name ?? input.scenario}`,
        rows: adj ? [
          row('Category', adj.budget_categories?.category ?? '—'),
          row('Period', `${adj.month}/${adj.year}`),
          row('Amount', money(adj.delta_amount)),
        ] : [row('Adjustment', 'not found', 'muted')],
        destructive: true,
      }
    },
    async execute(userId, input) {
      const target = await requireScenario(userId, requireField(input, 'scenario'))
      const adjustments = await getAdjustments(userId, target.id)
      const adj = (adjustments ?? []).find(a => a.id === requireField(input, 'adjustment_id'))
      if (!adj) throw new Error('That adjustment is not on this scenario.')
      await deleteAdjustment(adj.id)
      return { summary: `Removed an adjustment from "${target.name}"`, result: { scenarioId: target.id, adjustmentId: adj.id } }
    },
  },
]

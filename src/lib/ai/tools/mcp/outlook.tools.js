// 5-year outlook tools (MCP only). Wraps the same seams the Budget outlook view uses.

import { loadOutlookInputs } from '../../../outlook/loadOutlook.js'
import { buildOutlook } from '../../../outlook/outlookEngine.js'
import {
  getOutlookAssumptions, saveOutlookAssumptions,
  getOutlookEvents, createOutlookEvent, updateOutlookEvent, deleteOutlookEvent,
} from '../../../db/outlook.js'
import { money, row, requireField, toNumber, toYear } from '../helpers.js'
import { withMode } from './shared.js'

function toYears(outlook) {
  if (outlook.empty) return []
  return outlook.columns.map((col, i) => ({
    year: col.year,
    kind: col.kind,
    income: outlook.income[i],
    groups: Object.fromEntries(outlook.groups.map(g => [g.name, g.cells[i].amount])),
    group_total: outlook.groupTotals[i],
    commitments: outlook.commitments[i],
    events: outlook.events[i].total,
    net_savings: outlook.netSavings[i],
  }))
}

const ASSUMPTION_FIELDS = ['inflation_rate', 'income_growth_rate', 'group_rates']

export const outlookTools = [
  {
    name: 'get_outlook',
    group: 'outlook',
    write: false,
    schema: {
      name: 'get_outlook',
      description:
        'The 5-year outlook as the Budget outlook view shows it: per year income, expense by group, ' +
        'commitments, one-off events and net savings, built from the budget, active commitments, ' +
        'committed scenarios and the saved outlook assumptions.',
      input_schema: { type: 'object', properties: {} },
    },
    async execute(userId) {
      const inputs = await loadOutlookInputs(userId)
      const outlook = buildOutlook({ ...inputs, events: inputs.events, selectedAdjustments: [] })
      return {
        summary: outlook.empty ? 'No budget to build an outlook from yet' : `Outlook for ${outlook.columns.length} years`,
        result: {
          base_year: inputs.baseYear,
          assumptions: inputs.assumptions,
          events: inputs.events,
          adjustments: inputs.adjustments,
          years: toYears(outlook),
        },
      }
    },
  },

  {
    name: 'save_outlook_assumptions',
    group: 'outlook',
    write: true,
    mcpGated: true,
    schema: {
      name: 'save_outlook_assumptions',
      description:
        'Change the outlook growth assumptions. Only the fields you pass change. group_rates maps an ' +
        'expense group to its own annual rate, or null to fall back to the inflation rate.',
      input_schema: {
        type: 'object',
        properties: withMode({
          inflation_rate: { type: 'number', description: 'Annual expense inflation as a decimal, e.g. 0.03.' },
          income_growth_rate: { type: 'number', description: 'Annual income growth as a decimal.' },
          group_rates: {
            type: 'object',
            description: 'Per-group annual rate overrides, e.g. {"Housing":0.04,"Travel":null}.',
            additionalProperties: { type: ['number', 'null'] },
          },
        }),
      },
    },
    async preview(input) {
      const current = await getOutlookAssumptions()
      const rows = ASSUMPTION_FIELDS.filter(f => input[f] !== undefined).map(f =>
        row(f, `${JSON.stringify(current?.[f] ?? null)} → ${JSON.stringify(input[f])}`))
      return { title: 'Outlook assumptions', rows }
    },
    async execute(_userId, input) {
      const patch = Object.fromEntries(ASSUMPTION_FIELDS.filter(f => input[f] !== undefined).map(f => [f, input[f]]))
      if (Object.keys(patch).length === 0) throw new Error('Pass at least one of inflation_rate, income_growth_rate, group_rates.')
      const saved = await saveOutlookAssumptions(patch)
      return { summary: 'Saved outlook assumptions', result: saved }
    },
  },

  {
    name: 'save_outlook_event',
    group: 'outlook',
    write: true,
    mcpGated: true,
    schema: {
      name: 'save_outlook_event',
      description:
        'Add a one-off outlook event (e.g. a car purchase in 2028), or edit one by passing its id. ' +
        'Amount is a positive cost.',
      input_schema: {
        type: 'object',
        properties: withMode({
          id: { type: 'string', description: 'Existing event id to edit; omit to create.' },
          year: { type: 'integer' },
          group_name: { type: 'string', description: 'Expense group the event belongs to.' },
          name: { type: 'string' },
          amount: { type: 'number' },
        }),
        required: ['year', 'group_name', 'name', 'amount'],
      },
    },
    async preview(input) {
      return {
        title: `${input.id ? 'Edit' : 'Add'} outlook event`,
        subtitle: input.name,
        rows: [
          row('Year', input.year),
          row('Group', input.group_name),
          row('Amount', money(input.amount), 'bad'),
        ],
      }
    },
    async execute(_userId, input) {
      const event = {
        year: toYear(requireField(input, 'year')),
        group_name: requireField(input, 'group_name'),
        name: requireField(input, 'name'),
        amount: toNumber(requireField(input, 'amount')),
      }
      const saved = input.id ? await updateOutlookEvent(input.id, event) : await createOutlookEvent(event)
      return { summary: `${input.id ? 'Updated' : 'Added'} outlook event "${event.name}"`, result: saved }
    },
  },

  {
    name: 'delete_outlook_event',
    group: 'outlook',
    write: true,
    mcpGated: true,
    schema: {
      name: 'delete_outlook_event',
      description: 'Delete an outlook event by id.',
      input_schema: {
        type: 'object',
        properties: withMode({ id: { type: 'string' } }),
        required: ['id'],
      },
    },
    async preview(input) {
      const target = (await getOutlookEvents()).find(e => e.id === input.id)
      return {
        title: 'Delete outlook event',
        destructive: true,
        subtitle: target ? target.name : `No event with id ${input.id}`,
        rows: target
          ? [row('Year', target.year), row('Group', target.group_name), row('Amount', money(target.amount))]
          : [],
      }
    },
    async execute(_userId, input) {
      requireField(input, 'id')
      await deleteOutlookEvent(input.id)
      return { summary: 'Deleted outlook event', result: { id: input.id } }
    },
  },
]

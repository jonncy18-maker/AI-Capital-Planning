// Wealth Trajectory write tools.

import { saveWealthSnapshot, getWealthSnapshots, deleteWealthSnapshot } from '../../db/wealthSnapshots.js'
import { money, row, toNullableNumber, toNumber, requireField } from './helpers.js'

function today() {
  return new Date().toISOString().slice(0, 10)
}

export const wealthTools = [
  {
    name: 'save_wealth_snapshot',
    group: 'wealth',
    write: true,
    schema: {
      name: 'save_wealth_snapshot',
      description:
        'Record a net worth snapshot for a date. Net worth is the headline figure; the component ' +
        'balances are optional but make the trajectory chart more useful. A snapshot for a date ' +
        'that already exists is replaced.',
      input_schema: {
        type: 'object',
        properties: {
          snapshot_date: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' },
          net_worth: { type: 'number', description: 'Total net worth (assets minus liabilities).' },
          investment_balance: { type: 'number', description: 'Taxable investment balance.' },
          retirement_balance: { type: 'number', description: '401k / IRA balance.' },
          other_assets: { type: 'number', description: 'Cash, property, other assets.' },
          liabilities: { type: 'number', description: 'Total debt, entered as a positive number.' },
          notes: { type: 'string' },
        },
        required: ['net_worth'],
      },
    },
    async preview(input) {
      return {
        title: `Wealth snapshot · ${input.snapshot_date ?? today()}`,
        subtitle: input.notes || '',
        rows: [
          row('Net worth', money(input.net_worth), 'good'),
          row('Investments', input.investment_balance != null ? money(input.investment_balance) : null),
          row('Retirement', input.retirement_balance != null ? money(input.retirement_balance) : null),
          row('Other assets', input.other_assets != null ? money(input.other_assets) : null),
          row('Liabilities', input.liabilities != null ? money(input.liabilities) : null, 'bad'),
        ],
      }
    },
    async execute(userId, input) {
      requireField(input, 'net_worth')
      const snapshot_date = input.snapshot_date ?? today()
      const saved = await saveWealthSnapshot(userId, {
        snapshot_date,
        net_worth: toNumber(input.net_worth),
        investment_balance: toNullableNumber(input.investment_balance),
        retirement_balance: toNullableNumber(input.retirement_balance),
        other_assets: toNullableNumber(input.other_assets),
        liabilities: toNullableNumber(input.liabilities),
        notes: input.notes ?? null,
      })
      return {
        summary: `Saved wealth snapshot for ${snapshot_date} at ${money(input.net_worth)}`,
        result: { id: saved?.id, snapshot_date },
        undo: saved?.id ? { tool: 'delete_wealth_snapshot', input: { snapshot_date } } : null,
      }
    },
  },

  {
    name: 'delete_wealth_snapshot',
    group: 'wealth',
    write: true,
    schema: {
      name: 'delete_wealth_snapshot',
      description: 'Delete the wealth snapshot recorded for a given date.',
      input_schema: {
        type: 'object',
        properties: { snapshot_date: { type: 'string', description: 'YYYY-MM-DD.' } },
        required: ['snapshot_date'],
      },
    },
    async preview(input, ctx) {
      const snaps = await getWealthSnapshots(ctx.userId, 24)
      const target = (snaps ?? []).find(s => s.snapshot_date?.slice(0, 10) === input.snapshot_date)
      return {
        title: `Delete wealth snapshot · ${input.snapshot_date}`,
        subtitle: target ? '' : 'No snapshot found for that date.',
        rows: target ? [row('Net worth', money(target.net_worth))] : [],
        destructive: true,
      }
    },
    async execute(userId, input) {
      const snaps = await getWealthSnapshots(userId, 24)
      const target = (snaps ?? []).find(s => s.snapshot_date?.slice(0, 10) === requireField(input, 'snapshot_date'))
      if (!target) throw new Error(`No wealth snapshot on ${input.snapshot_date}.`)
      await deleteWealthSnapshot(target.id)
      return { summary: `Deleted wealth snapshot for ${input.snapshot_date}`, result: { id: target.id } }
    },
  },
]

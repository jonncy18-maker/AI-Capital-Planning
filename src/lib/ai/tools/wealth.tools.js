// Wealth Trajectory write tools.

import { saveWealthSnapshot, getWealthSnapshots, deleteWealthSnapshot } from '../../db/wealthSnapshots.js'
import { money, row, toNullableNumber, toNumber, requireField } from './helpers.js'

const SNAPSHOT_SCAN_LIMIT = 1000

// Snapshots are plain inserts, so a date can hold several rows; an id is the only
// unambiguous handle. A date-only target is refused rather than guessed.
export function resolveSnapshotTarget(snaps, input) {
  const rows = snaps ?? []
  if (input.id) {
    const byId = rows.find(s => s.id === input.id)
    if (!byId) throw new Error(`No wealth snapshot with id ${input.id}.`)
    return byId
  }
  const date = requireField(input, 'snapshot_date')
  const matches = rows.filter(s => s.snapshot_date?.slice(0, 10) === date)
  if (matches.length === 0) throw new Error(`No wealth snapshot on ${date}.`)
  if (matches.length > 1) {
    throw new Error(
      `${matches.length} wealth snapshots share ${date} (ids: ${matches.map(m => m.id).join(', ')}). Pass id to choose one.`
    )
  }
  return matches[0]
}

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
        'balances are optional but make the trajectory chart more useful. Saving always adds a ' +
        'new row, so a second save on the same date creates a duplicate; delete the old one by id.',
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
        undo: saved?.id ? { tool: 'delete_wealth_snapshot', input: { id: saved.id } } : null,
      }
    },
  },

  {
    name: 'delete_wealth_snapshot',
    group: 'wealth',
    write: true,
    schema: {
      name: 'delete_wealth_snapshot',
      description:
        'Delete one wealth snapshot. Pass its id (from lookup_data wealth_snapshots) to target ' +
        'an exact row; pass snapshot_date only when a single snapshot exists on that date.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Snapshot id. Preferred; unambiguous.' },
          snapshot_date: { type: 'string', description: 'YYYY-MM-DD. Refused if several snapshots share the date.' },
        },
      },
    },
    async preview(input, ctx) {
      const snaps = await getWealthSnapshots(ctx.userId, SNAPSHOT_SCAN_LIMIT)
      let target = null
      let subtitle = ''
      try {
        target = resolveSnapshotTarget(snaps, input)
      } catch (err) {
        subtitle = err.message
      }
      return {
        title: `Delete wealth snapshot · ${target?.snapshot_date?.slice(0, 10) ?? input.snapshot_date ?? input.id}`,
        subtitle,
        rows: target ? [row('Net worth', money(target.net_worth))] : [],
        destructive: true,
      }
    },
    async execute(userId, input) {
      const snaps = await getWealthSnapshots(userId, SNAPSHOT_SCAN_LIMIT)
      const target = resolveSnapshotTarget(snaps, input)
      await deleteWealthSnapshot(target.id)
      return {
        summary: `Deleted wealth snapshot for ${target.snapshot_date?.slice(0, 10)} (${money(target.net_worth)})`,
        result: { id: target.id },
      }
    },
  },
]

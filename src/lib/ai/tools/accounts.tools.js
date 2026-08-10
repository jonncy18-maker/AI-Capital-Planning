// Accounts and twice-monthly balance snapshots.

import {
  getAccounts, upsertAccount, deleteAccount, upsertAccountBalance,
} from '../../db/bills.js'
import {
  money, resolveByName, row, toMonth, toNumber, toYear, thisYear, requireField, MONTH_SHORT,
} from './helpers.js'

const ACCOUNT_TYPES = ['checking', 'savings', 'investment', 'other']

export const accountTools = [
  {
    name: 'save_account',
    group: 'accounts',
    write: true,
    schema: {
      name: 'save_account',
      description:
        'Create a bank or investment account, or update an existing one by name. ' +
        'Exactly one account should be the primary checking account — setting a new one ' +
        'does not clear the old flag, so check with lookup_data first.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Account name as the user refers to it.' },
          type: { type: 'string', enum: ACCOUNT_TYPES },
          is_primary_checking: { type: 'boolean', description: 'The account the pay-period planner funds bills from.' },
          active: { type: 'boolean' },
        },
        required: ['name'],
      },
    },
    async preview(input, ctx) {
      const existing = resolveByName(await getAccounts(ctx.userId), input.name)
      return {
        title: existing ? `Update account · ${existing.name}` : `New account · ${input.name}`,
        rows: [
          row('Type', input.type ?? existing?.type ?? 'checking'),
          row('Primary checking', (input.is_primary_checking ?? existing?.is_primary_checking) ? 'Yes' : 'No'),
          row('Active', (input.active ?? existing?.active ?? true) ? 'Yes' : 'No'),
        ],
      }
    },
    async execute(userId, input) {
      requireField(input, 'name')
      const existing = resolveByName(await getAccounts(userId), input.name)
      const payload = {
        name: input.name.trim(),
        type: input.type ?? existing?.type ?? 'checking',
        is_primary_checking: input.is_primary_checking ?? existing?.is_primary_checking ?? false,
        active: input.active ?? existing?.active ?? true,
      }
      if (existing) payload.id = existing.id
      const saved = await upsertAccount(userId, payload)
      return {
        summary: `${existing ? 'Updated' : 'Created'} account "${payload.name}"`,
        result: { id: saved?.id ?? existing?.id },
        undo: existing ? null : { tool: 'delete_account', input: { name: payload.name } },
      }
    },
  },

  {
    name: 'delete_account',
    group: 'accounts',
    write: true,
    schema: {
      name: 'delete_account',
      description: 'Delete an account by name. Bills that debit from it lose that link.',
      input_schema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
    async preview(input, ctx) {
      const target = resolveByName(await getAccounts(ctx.userId), input.name)
      return {
        title: `Delete account · ${target?.name ?? input.name}`,
        subtitle: target ? '' : 'No account with that name was found.',
        rows: target ? [row('Type', target.type)] : [],
        destructive: true,
      }
    },
    async execute(userId, input) {
      const target = resolveByName(await getAccounts(userId), requireField(input, 'name'))
      if (!target) throw new Error(`No account named "${input.name}".`)
      await deleteAccount(target.id)
      return { summary: `Deleted account "${target.name}"`, result: { id: target.id } }
    },
  },

  {
    name: 'save_account_balance',
    group: 'accounts',
    write: true,
    schema: {
      name: 'save_account_balance',
      description:
        'Record an account balance for one half of a month. Balances are tracked twice ' +
        'monthly: period 1 is the first half, period 2 the second.',
      input_schema: {
        type: 'object',
        properties: {
          account: { type: 'string', description: 'Account name or id.' },
          year: { type: 'integer' },
          month: { type: 'integer', minimum: 1, maximum: 12 },
          period_half: { type: 'integer', enum: [1, 2], description: '1 = first half of the month, 2 = second half.' },
          balance: { type: 'number' },
        },
        required: ['account', 'month', 'period_half', 'balance'],
      },
    },
    async preview(input, ctx) {
      const target = resolveByName(await getAccounts(ctx.userId), input.account)
      return {
        title: `Balance · ${target?.name ?? input.account}`,
        subtitle: target ? '' : 'No account with that name was found.',
        rows: [
          row('Period', `${MONTH_SHORT[toMonth(input.month) - 1]} ${toYear(input.year)} · half ${input.period_half}`),
          row('Balance', money(input.balance), 'good'),
        ],
      }
    },
    async execute(userId, input) {
      const target = resolveByName(await getAccounts(userId), requireField(input, 'account'))
      if (!target) throw new Error(`No account named "${input.account}".`)
      const year = input.year ? toYear(input.year) : thisYear()
      const month = toMonth(input.month)
      const half = Number(input.period_half) === 2 ? 2 : 1
      await upsertAccountBalance(userId, target.id, year, month, half, toNumber(input.balance))
      return {
        summary: `Recorded ${money(input.balance)} on "${target.name}" for ${MONTH_SHORT[month - 1]} ${year} (half ${half})`,
        result: { accountId: target.id, year, month, period_half: half },
      }
    },
  },
]

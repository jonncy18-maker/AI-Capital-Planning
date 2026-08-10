// Income actuals and the budget-year lifecycle status.

import { getIncomeActualsRange, upsertIncomeActual, deleteIncomeActual } from '../../db/income.js'
import { getBudgetStatus, setBudgetStatus } from '../../db/budgetStatus.js'
import { money, row, toMonth, toNumber, toYear, requireField, MONTH_SHORT } from './helpers.js'

export const incomeTools = [
  {
    name: 'set_income_actual',
    group: 'income',
    write: true,
    schema: {
      name: 'set_income_actual',
      description:
        'Set the recorded cash income for a month, overriding what was derived from transactions. ' +
        'Future months are forecast from the salary assumptions and are not stored — use ' +
        'update_planning_profile for those.',
      input_schema: {
        type: 'object',
        properties: {
          year: { type: 'integer' },
          month: { type: 'integer', minimum: 1, maximum: 12 },
          amount: { type: 'number', description: 'Total cash inflow for the month.' },
        },
        required: ['month', 'amount'],
      },
    },
    async preview(input, ctx) {
      const year = toYear(input.year)
      const month = toMonth(requireField(input, 'month'))
      const rows = await getIncomeActualsRange(ctx.userId, year, year)
      const current = (rows ?? []).find(r => r.month === month && (r.year ?? year) === year)
      return {
        title: `Income · ${MONTH_SHORT[month - 1]} ${year}`,
        rows: [row('Amount', `${current ? money(current.amount) : '—'} → ${money(input.amount)}`, 'good')],
      }
    },
    async execute(userId, input) {
      const year = toYear(input.year)
      const month = toMonth(requireField(input, 'month'))
      await upsertIncomeActual(userId, year, month, toNumber(input.amount), 'manual')
      return {
        summary: `Set ${MONTH_SHORT[month - 1]} ${year} income to ${money(input.amount)}`,
        result: { year, month },
        undo: { tool: 'clear_income_actual', input: { year, month } },
      }
    },
  },

  {
    name: 'clear_income_actual',
    group: 'income',
    write: true,
    schema: {
      name: 'clear_income_actual',
      description: 'Remove a manual income entry for a month so it falls back to the transaction-derived figure.',
      input_schema: {
        type: 'object',
        properties: {
          year: { type: 'integer' },
          month: { type: 'integer', minimum: 1, maximum: 12 },
        },
        required: ['month'],
      },
    },
    async preview(input) {
      return {
        title: `Clear income entry · ${MONTH_SHORT[toMonth(input.month) - 1]} ${toYear(input.year)}`,
        rows: [row('Falls back to', 'transaction-derived income', 'muted')],
        destructive: true,
      }
    },
    async execute(userId, input) {
      const year = toYear(input.year)
      const month = toMonth(requireField(input, 'month'))
      await deleteIncomeActual(userId, year, month)
      return { summary: `Cleared the manual income entry for ${MONTH_SHORT[month - 1]} ${year}`, result: { year, month } }
    },
  },

  {
    name: 'set_budget_status',
    group: 'budget',
    write: true,
    schema: {
      name: 'set_budget_status',
      description: 'Mark a budget year as finalized or move it back to draft. A finalized budget is the plan of record for that year.',
      input_schema: {
        type: 'object',
        properties: {
          year: { type: 'integer' },
          status: { type: 'string', enum: ['draft', 'final'] },
        },
        required: ['year', 'status'],
      },
    },
    async preview(input, ctx) {
      const year = toYear(requireField(input, 'year'))
      const current = await getBudgetStatus(ctx.userId, year)
      return {
        title: `Budget status · ${year}`,
        rows: [row('Status', `${current?.status ?? 'draft'} → ${input.status}`)],
      }
    },
    async execute(userId, input) {
      const year = toYear(requireField(input, 'year'))
      await setBudgetStatus(userId, year, requireField(input, 'status'))
      return { summary: `Marked the ${year} budget as ${input.status}`, result: { year, status: input.status } }
    },
  },
]

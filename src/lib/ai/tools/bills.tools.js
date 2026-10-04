// Bill Planner write tools. Bills drive the pay-period schedule and the cash
// demand calendar, so every tool here goes through the confirmation card.

import {
  getBills, upsertBill, deleteBill, upsertBillAmount, deleteBillAmount, getAccounts, getBillAmounts, saveBillAmountItems,
} from '../../db/bills.js'
import { isBillAmountItemsEligible, initialBillAmountItems, normalizeBillAmountItems, totalBillAmountItems } from '../../payperiods/billAmountItems.js'
import { getBudgetCategories } from '../../db/budgetCategories.js'
import {
  money, resolveByName, resolveCategoryId, row, toMonth, toNumber, toNullableNumber,
  toYear, requireField, MONTH_SHORT,
} from './helpers.js'

const BILL_TYPES = ['credit_card', 'loan', 'rent', 'investment', 'subscription', 'other']
const PAYMENT_METHODS = ['auto', 'manual']

export const billTools = [
  ...billAmountItemTools(),
  {
    name: 'save_bill',
    group: 'bills',
    write: true,
    schema: {
      name: 'save_bill',
      description:
        'Create a recurring bill or update an existing one by name. A bill has a due day and a pay ' +
        'day; its amount comes from `fixed_amount`, from a linked forecast category, or is entered ' +
        'per month with set_bill_amount. Use lookup_data on "bills" first when editing so you keep ' +
        'the existing configuration.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Bill name. For an update this must match the existing bill.' },
          rename_to: { type: 'string' },
          bill_type: { type: 'string', enum: BILL_TYPES },
          due_day: { type: 'integer', minimum: 1, maximum: 31 },
          pay_day: { type: 'integer', minimum: 1, maximum: 31, description: 'Day the payment leaves the account. Omit to pay on the due day.' },
          pay_same_as_due: { type: 'boolean' },
          payment_method: { type: 'string', enum: PAYMENT_METHODS },
          fixed_amount: { type: 'number', description: 'Set for a fixed bill. Omit for a variable bill.' },
          debits_from_account: { type: 'string', description: 'Account name the payment comes from.' },
          forecast_category: { type: 'string', description: 'Budget category whose forecast drives this bill\'s amount.' },
          actuals_category: { type: 'string', description: 'Category used to pull historical actuals for this bill.' },
          active: { type: 'boolean' },
          exclude_from_schedule: { type: 'boolean', description: 'Keep the bill on record but out of the pay-period schedule.' },
        },
        required: ['name'],
      },
    },
    async preview(input, ctx) {
      const existing = resolveByName(await getBills(ctx.userId), input.name)
      const amount = input.fixed_amount ?? existing?.fixed_amount
      return {
        title: existing ? `Update bill · ${existing.name}` : `New bill · ${input.name}`,
        rows: [
          input.rename_to ? row('Rename to', input.rename_to) : null,
          row('Type', input.bill_type ?? existing?.bill_type ?? 'other'),
          row('Due day', input.due_day ?? existing?.due_day),
          row('Pay day', input.pay_day ?? existing?.pay_day ?? input.due_day ?? existing?.due_day),
          row('Amount', amount != null ? money(amount) : 'variable'),
          input.debits_from_account ? row('Debits from', input.debits_from_account) : null,
          input.forecast_category ? row('Forecast category', input.forecast_category) : null,
          input.active === false ? row('Active', 'No', 'bad') : null,
        ].filter(Boolean),
      }
    },
    async execute(userId, input) {
      requireField(input, 'name')
      const bills = await getBills(userId)
      const existing = resolveByName(bills, input.name)

      let debitsFromId = existing?.debits_from_account_id ?? null
      if (input.debits_from_account) {
        const account = resolveByName(await getAccounts(userId), input.debits_from_account)
        if (!account) throw new Error(`No account named "${input.debits_from_account}".`)
        debitsFromId = account.id
      }

      let forecastCategoryId = existing?.forecast_category_id ?? null
      if (input.forecast_category) {
        forecastCategoryId = resolveCategoryId(await getBudgetCategories(userId), input.forecast_category)
        if (!forecastCategoryId) throw new Error(`No budget category named "${input.forecast_category}".`)
      }

      const paySameAsDue = input.pay_same_as_due ?? existing?.pay_same_as_due ?? (input.pay_day === undefined)
      const payload = {
        name: input.rename_to?.trim() || existing?.name || input.name.trim(),
        bill_type: input.bill_type ?? existing?.bill_type ?? 'other',
        due_day: input.due_day ?? existing?.due_day ?? 1,
        pay_same_as_due: paySameAsDue,
        pay_day: input.pay_day ?? existing?.pay_day ?? input.due_day ?? existing?.due_day ?? 1,
        payment_method: input.payment_method ?? existing?.payment_method ?? 'manual',
        fixed_amount: input.fixed_amount !== undefined ? toNullableNumber(input.fixed_amount) : (existing?.fixed_amount ?? null),
        debits_from_account_id: debitsFromId,
        active: input.active ?? existing?.active ?? true,
        forecast_category_id: forecastCategoryId,
        forecast_divisor: existing?.forecast_divisor ?? 1,
        statement_close_day: existing?.statement_close_day ?? null,
        credit_card_id: existing?.credit_card_id ?? null,
        actuals_category: input.actuals_category ?? existing?.actuals_category ?? null,
        exclude_from_schedule: input.exclude_from_schedule ?? existing?.exclude_from_schedule ?? false,
      }
      if (existing) payload.id = existing.id

      const saved = await upsertBill(userId, payload)
      return {
        summary: `${existing ? 'Updated' : 'Created'} bill "${payload.name}"`,
        result: { id: saved?.id ?? existing?.id, name: payload.name },
        undo: existing ? null : { tool: 'delete_bill', input: { name: payload.name } },
      }
    },
  },

  {
    name: 'delete_bill',
    group: 'bills',
    write: true,
    schema: {
      name: 'delete_bill',
      description: 'Delete a bill by name, along with its per-month amounts. To stop a bill without losing its history, call save_bill with active: false instead.',
      input_schema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
    async preview(input, ctx) {
      const target = resolveByName(await getBills(ctx.userId), input.name)
      return {
        title: `Delete bill · ${target?.name ?? input.name}`,
        subtitle: target ? '' : 'No bill with that name was found.',
        rows: target ? [
          row('Type', target.bill_type),
          row('Amount', target.fixed_amount != null ? money(target.fixed_amount) : 'variable'),
          row('Due day', target.due_day),
        ] : [],
        destructive: true,
      }
    },
    async execute(userId, input) {
      const target = resolveByName(await getBills(userId), requireField(input, 'name'))
      if (!target) throw new Error(`No bill named "${input.name}".`)
      await deleteBill(target.id)
      return { summary: `Deleted bill "${target.name}"`, result: { id: target.id } }
    },
  },

  {
    name: 'set_bill_amount',
    group: 'bills',
    write: true,
    schema: {
      name: 'set_bill_amount',
      description:
        'Set the amount for a variable bill in one or more specific months (e.g. a credit card ' +
        'statement). Applies to the given months only — it does not change the bill\'s fixed amount.',
      input_schema: {
        type: 'object',
        properties: {
          bill: { type: 'string', description: 'Bill name or id.' },
          year: { type: 'integer' },
          months: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 12 }, description: 'Months to set. Defaults to the single `month` value.' },
          month: { type: 'integer', minimum: 1, maximum: 12 },
          amount: { type: 'number' },
          notes: { type: 'string' },
        },
        required: ['bill', 'amount'],
      },
    },
    async preview(input, ctx) {
      const target = resolveByName(await getBills(ctx.userId), input.bill)
      const months = monthList(input)
      return {
        title: `Bill amount · ${target?.name ?? input.bill}`,
        subtitle: input.notes || '',
        rows: [
          row('Months', months.map(m => MONTH_SHORT[m - 1]).join(', ')),
          row('Year', toYear(input.year)),
          row('Amount', money(input.amount), 'bad'),
        ],
      }
    },
    async execute(userId, input) {
      const target = resolveByName(await getBills(userId), requireField(input, 'bill'))
      if (!target) throw new Error(`No bill named "${input.bill}".`)
      const year = toYear(input.year)
      const months = monthList(input)
      for (const m of months) {
        await upsertBillAmount(userId, target.id, year, m, toNumber(input.amount), input.notes ?? null)
      }
      return {
        summary: `Set "${target.name}" to ${money(input.amount)} for ${months.length} month${months.length === 1 ? '' : 's'} in ${year}`,
        result: { billId: target.id, year, months },
        undo: { tool: 'clear_bill_amount', input: { bill: target.name, year, months } },
      }
    },
  },

  {
    name: 'clear_bill_amount',
    group: 'bills',
    write: true,
    schema: {
      name: 'clear_bill_amount',
      description: 'Remove the per-month amount entries for a bill, letting it fall back to its fixed amount or forecast.',
      input_schema: {
        type: 'object',
        properties: {
          bill: { type: 'string' },
          year: { type: 'integer' },
          months: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 12 } },
          month: { type: 'integer', minimum: 1, maximum: 12 },
        },
        required: ['bill'],
      },
    },
    async preview(input, ctx) {
      const target = resolveByName(await getBills(ctx.userId), input.bill)
      const months = monthList(input)
      return {
        title: `Clear bill amounts · ${target?.name ?? input.bill}`,
        rows: [
          row('Months', months.map(m => MONTH_SHORT[m - 1]).join(', ')),
          row('Year', toYear(input.year)),
        ],
        destructive: true,
      }
    },
    async execute(userId, input) {
      const target = resolveByName(await getBills(userId), requireField(input, 'bill'))
      if (!target) throw new Error(`No bill named "${input.bill}".`)
      const year = toYear(input.year)
      const months = monthList(input)
      for (const m of months) await deleteBillAmount(target.id, year, m)
      return {
        summary: `Cleared ${months.length} month${months.length === 1 ? '' : 's'} of amounts on "${target.name}"`,
        result: { billId: target.id, year, months },
      }
    },
  },
]

// months[] wins over month; a bare call defaults to the current month so
// "set the Amex statement to $2,400" doesn't fail on a missing field.
function monthList(input) {
  if (Array.isArray(input?.months) && input.months.length) {
    return [...new Set(input.months.map(toMonth))].sort((a, b) => a - b)
  }
  if (input?.month !== undefined) return [toMonth(input.month)]
  return [new Date().getMonth() + 1]
}

// These item tools deliberately require an exact target and explicit month;
// fuzzy matching or calendar defaults can charge the wrong bill or period.
async function itemContext(userId, input) {
  if (typeof input.bill !== 'string' || !input.bill.trim()) throw new Error('Provide a bill ID or exact name.')
  if (!Number.isInteger(input.year) || !Number.isInteger(input.month) || input.month < 1 || input.month > 12) {
    throw new Error('Provide an explicit integer year and month (1–12).')
  }
  const bills = await getBills(userId)
  const idMatch = bills.find(bill => bill.id === input.bill)
  const matches = idMatch ? [idMatch] : bills.filter(bill => bill.name === input.bill)
  if (matches.length !== 1) throw new Error('Bill name must match exactly and unambiguously; use its ID.')
  const bill = matches[0]
  if (!isBillAmountItemsEligible(bill)) throw new Error('Only unlinked variable bills can have items.')
  const rows = await getBillAmounts(userId, input.year, input.month)
  const stored = rows.find(value => value.bill_id === bill.id)
  return { bill, stored, year: input.year, month: input.month }
}

function itemResult(context, saved = context.stored) {
  return {
    billId: context.bill.id, year: context.year, month: context.month,
    items: saved?.items ?? null, total: Number(saved?.amount ?? 0), revision: saved?.item_revision ?? 0,
  }
}

function itemMutation(action, context, input) {
  const items = initialBillAmountItems(context.stored)
  let affected
  if (action === 'add') {
    affected = { id: globalThis.crypto.randomUUID(), name: input.name, amount: input.amount }
    items.push(affected)
  } else {
    const index = items.findIndex(item => item.id === input.item_id)
    if (index < 0) throw new Error('Item not found. List this month’s items and use its item_id.')
    affected = items[index]
    if (action === 'remove') items.splice(index, 1)
    else {
      if (input.name === undefined && input.amount === undefined) throw new Error('Provide a name or amount to update.')
      affected = { ...affected, ...(input.name !== undefined ? { name: input.name } : {}), ...(input.amount !== undefined ? { amount: input.amount } : {}) }
      items[index] = affected
    }
  }
  return { items: normalizeBillAmountItems(items), affected }
}

function billAmountItemTools() {
  const properties = {
    bill: { type: 'string', description: 'Bill ID or exact, unambiguous bill name. No partial matches.' },
    year: { type: 'integer' },
    month: { type: 'integer', minimum: 1, maximum: 12 },
  }
  const dollars = amount => Number(amount).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
  return [
    {
      name: 'list_bill_amount_items', group: 'bills', write: false,
      schema: { name: 'list_bill_amount_items', description: 'Read monthly items, total and revision for an unlinked variable bill. items:null means a legacy scalar amount; first add preserves it as Existing amount.', input_schema: { type: 'object', properties, required: ['bill', 'year', 'month'] } },
      async execute(userId, input) {
        const context = await itemContext(userId, input)
        return { summary: `Items for "${context.bill.name}" in ${context.year}-${context.month}`, result: itemResult(context) }
      },
    },
    ...['add', 'update', 'remove'].map(action => {
      const name = `${action}_bill_amount_item`
      return {
        name, group: 'bills', write: true,
        schema: {
          name, description: `${action === 'add' ? 'Add a named monthly outflow item, preserving any existing manual amount on first add' : action === 'update' ? 'Edit a specific monthly outflow item by item_id' : 'Remove a specific monthly outflow item by item_id'}. Requires an unlinked variable bill and an explicit year/month. Concurrent changes fail; list again before retrying.`,
          input_schema: {
            type: 'object', properties: { ...properties,
              ...(action !== 'add' ? { item_id: { type: 'string' } } : {}),
              ...(action !== 'remove' ? { name: { type: 'string', minLength: 1, maxLength: 200 }, amount: { type: 'number', minimum: 0, maximum: 10000000 } } : {}),
            },
            required: ['bill', 'year', 'month', ...(action === 'add' ? ['name', 'amount'] : ['item_id'])],
          },
        },
        async preview(input, ctx) {
          const context = await itemContext(ctx.userId, input)
          const { items, affected } = itemMutation(action, context, input)
          return {
            title: `${action[0].toUpperCase() + action.slice(1)} outflow item · ${context.bill.name}`,
            rows: [row('Month', `${MONTH_SHORT[context.month - 1]} ${context.year}`), row('Item', affected.name), row('Amount', dollars(affected.amount)), row('New monthly total', dollars(totalBillAmountItems(items)))],
            destructive: action === 'remove',
          }
        },
        async execute(userId, input) {
          const context = await itemContext(userId, input)
          const { items, affected } = itemMutation(action, context, input)
          const saved = await saveBillAmountItems(userId, context.bill.id, context.year, context.month, items, context.stored?.item_revision ?? 0, context.stored?.id ?? null)
          return { summary: `${action === 'add' ? 'Added' : action === 'update' ? 'Updated' : 'Removed'} "${affected.name}" on "${context.bill.name}"`, result: itemResult(context, saved) }
        },
      }
    }),
  ]
}

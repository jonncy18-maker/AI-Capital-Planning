// Annual Budget Builder: category structure and the month-by-month schedule.

import { getBudgetCategories, upsertCategory } from '../../db/budgetCategories.js'
import {
  getBudgetLineItems, insertBudgetLineItem, updateLineItemAmount, deleteLineItem,
} from '../../db/budgetLineItems.js'
import {
  money, findCategory, resolveCategoryId, row, toMonth, toNumber, toNullableNumber,
  toYear, requireField, MONTH_SHORT, previewRows,
} from './helpers.js'

const CATEGORY_TYPES = ['Fixed', 'Flexible', 'Non-Monthly']

// Shared by the budget and forecast tools: months[] wins, then month, then a
// from/to range, then the whole year.
export function resolveMonths(input) {
  if (Array.isArray(input?.months) && input.months.length) {
    return [...new Set(input.months.map(toMonth))].sort((a, b) => a - b)
  }
  if (input?.month !== undefined) return [toMonth(input.month)]
  if (input?.from_month !== undefined || input?.to_month !== undefined) {
    const from = toMonth(input.from_month ?? 1)
    const to = toMonth(input.to_month ?? 12)
    const out = []
    for (let m = Math.min(from, to); m <= Math.max(from, to); m++) out.push(m)
    return out
  }
  return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
}

export function describeMonths(months) {
  if (months.length === 12) return 'every month'
  if (months.length === 1) return MONTH_SHORT[months[0] - 1]
  const contiguous = months.every((m, i) => i === 0 || m === months[i - 1] + 1)
  if (contiguous) return `${MONTH_SHORT[months[0] - 1]}–${MONTH_SHORT[months[months.length - 1] - 1]}`
  return months.map(m => MONTH_SHORT[m - 1]).join(', ')
}

// A line item matches when it is on the same category+month and carries the same
// label. A labelled write ("Cruise final payment") only touches its own sub-row;
// an unlabelled write only touches the plain category row.
function matchesLabel(item, label) {
  const itemLabel = item.label ?? null
  return (label ?? null) === itemLabel
}

export const budgetTools = [
  {
    name: 'save_budget_category',
    group: 'budget',
    write: true,
    schema: {
      name: 'save_budget_category',
      description:
        'Create a budget category or update its group, type or targets. Type drives how the ' +
        'category is modelled: Fixed (same amount every month), Flexible (variable but recurring), ' +
        'Non-Monthly (irregular timing, known annual total).',
      input_schema: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Category name.' },
          group: { type: 'string', description: 'Group it rolls up to, e.g. "Housing".' },
          type: { type: 'string', enum: CATEGORY_TYPES },
          monthly_target: { type: 'number' },
          annual_target: { type: 'number' },
          exclude_from_totals: { type: 'boolean', description: 'True for transfers and card payments that should not count as spend.' },
          is_active: { type: 'boolean' },
        },
        required: ['category'],
      },
    },
    async preview(input, ctx) {
      const existing = findCategory(await getBudgetCategories(ctx.userId), input.category)
      return {
        title: existing ? `Update category · ${existing.category}` : `New category · ${input.category}`,
        rows: [
          row('Group', input.group ?? existing?.group ?? 'Uncategorized'),
          row('Type', input.type ?? existing?.type ?? 'Flexible'),
          input.monthly_target !== undefined ? row('Monthly target', money(input.monthly_target)) : null,
          input.annual_target !== undefined ? row('Annual target', money(input.annual_target)) : null,
          input.exclude_from_totals !== undefined ? row('Excluded from totals', input.exclude_from_totals ? 'Yes' : 'No') : null,
        ].filter(Boolean),
      }
    },
    async execute(userId, input) {
      requireField(input, 'category')
      const existing = findCategory(await getBudgetCategories(userId), input.category)
      await upsertCategory(userId, {
        category: existing?.category ?? input.category.trim(),
        group: input.group ?? existing?.group ?? 'Uncategorized',
        type: input.type ?? existing?.type ?? 'Flexible',
        excludeFromTotals: input.exclude_from_totals ?? existing?.exclude_from_totals,
        monthlyTarget: input.monthly_target !== undefined ? toNullableNumber(input.monthly_target) : undefined,
        annualTarget: input.annual_target !== undefined ? toNullableNumber(input.annual_target) : undefined,
        isActive: input.is_active,
      })
      return {
        summary: `${existing ? 'Updated' : 'Created'} category "${existing?.category ?? input.category}"`,
        result: { category: existing?.category ?? input.category },
      }
    },
  },

  {
    name: 'set_budget_amount',
    group: 'budget',
    write: true,
    schema: {
      name: 'set_budget_amount',
      description:
        'Set the budgeted amount for a category across one or more months of a budget year. ' +
        'Existing rows for those months are updated; missing ones are created. Pass a `label` to ' +
        'write a named sub-row (e.g. "Celebrity Cruise - Final Payment") instead of the plain ' +
        'category row. This edits the BUDGET, which is the plan of record — the forecast is a ' +
        'separate dataset, use set_forecast_amount for that.',
      input_schema: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Budget category name.' },
          year: { type: 'integer', description: 'Budget year. Defaults to the current year.' },
          months: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 12 } },
          month: { type: 'integer', minimum: 1, maximum: 12 },
          from_month: { type: 'integer', minimum: 1, maximum: 12, description: 'Start of a month range (inclusive).' },
          to_month: { type: 'integer', minimum: 1, maximum: 12, description: 'End of a month range (inclusive).' },
          amount: { type: 'number', description: 'Amount per month, as a positive spend figure.' },
          label: { type: 'string', description: 'Optional sub-row name.' },
        },
        required: ['category', 'amount'],
      },
    },
    async preview(input, ctx) {
      const year = toYear(input.year)
      const months = resolveMonths(input)
      const cat = findCategory(await getBudgetCategories(ctx.userId), input.category)
      const items = cat ? await getBudgetLineItems(ctx.userId, { year }) : []
      const current = (items ?? []).filter(li => li.category_id === cat?.id && months.includes(li.month) && matchesLabel(li, input.label ?? null))
      const currentTotal = current.reduce((s, li) => s + toNumber(li.amount), 0)
      const nextTotal = toNumber(input.amount) * months.length
      return {
        title: `Budget ${year} · ${cat?.category ?? input.category}`,
        subtitle: input.label ? `Sub-row: ${input.label}` : '',
        rows: [
          cat ? null : row('Category', 'will be created', 'muted'),
          row('Months', `${describeMonths(months)} (${months.length})`),
          row('Per month', money(input.amount)),
          row('Year total', `${money(currentTotal)} → ${money(nextTotal)}`, nextTotal > currentTotal ? 'bad' : 'good'),
        ].filter(Boolean),
      }
    },
    async execute(userId, input) {
      requireField(input, 'category')
      const year = toYear(input.year)
      const months = resolveMonths(input)
      const amount = toNumber(input.amount)
      const label = input.label ?? null

      let categories = await getBudgetCategories(userId)
      let categoryId = resolveCategoryId(categories, input.category)
      if (!categoryId) {
        await upsertCategory(userId, { category: input.category.trim(), group: 'Uncategorized', type: 'Flexible' })
        categories = await getBudgetCategories(userId)
        categoryId = resolveCategoryId(categories, input.category)
        if (!categoryId) throw new Error(`Could not create category "${input.category}".`)
      }

      const items = await getBudgetLineItems(userId, { year })
      let updated = 0
      let created = 0
      for (const month of months) {
        const match = (items ?? []).find(li => li.category_id === categoryId && li.month === month && matchesLabel(li, label))
        if (match) {
          await updateLineItemAmount(match.id, amount)
          updated += 1
        } else {
          await insertBudgetLineItem(userId, { year, categoryId, month, amount, label })
          created += 1
        }
      }
      return {
        summary: `Budget ${year}: ${input.category} set to ${money(amount)} for ${describeMonths(months)} (${updated} updated, ${created} added)`,
        result: { year, months, amount, updated, created },
      }
    },
  },

  {
    name: 'delete_budget_lines',
    group: 'budget',
    write: true,
    schema: {
      name: 'delete_budget_lines',
      description: 'Remove budget line items for a category in the given months (all months if none given). Pass `label` to remove only a named sub-row.',
      input_schema: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          year: { type: 'integer' },
          months: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 12 } },
          month: { type: 'integer', minimum: 1, maximum: 12 },
          from_month: { type: 'integer', minimum: 1, maximum: 12 },
          to_month: { type: 'integer', minimum: 1, maximum: 12 },
          label: { type: 'string' },
        },
        required: ['category'],
      },
    },
    async preview(input, ctx) {
      const year = toYear(input.year)
      const months = resolveMonths(input)
      const cat = findCategory(await getBudgetCategories(ctx.userId), input.category)
      const items = await getBudgetLineItems(ctx.userId, { year })
      const doomed = (items ?? []).filter(li =>
        li.category_id === cat?.id && months.includes(li.month) &&
        (input.label === undefined || matchesLabel(li, input.label))
      )
      const { rows, overflow } = previewRows(doomed.map(li => row(`${MONTH_SHORT[li.month - 1]} ${li.label ? `· ${li.label}` : ''}`, money(li.amount), 'bad')))
      return {
        title: `Delete budget lines · ${cat?.category ?? input.category}`,
        subtitle: `${doomed.length} line${doomed.length === 1 ? '' : 's'} in ${year}`,
        rows,
        footer: overflow ? `…and ${overflow} more` : '',
        destructive: true,
      }
    },
    async execute(userId, input) {
      const year = toYear(input.year)
      const months = resolveMonths(input)
      const cat = findCategory(await getBudgetCategories(userId), requireField(input, 'category'))
      if (!cat) throw new Error(`No budget category named "${input.category}".`)
      const items = await getBudgetLineItems(userId, { year })
      const doomed = (items ?? []).filter(li =>
        li.category_id === cat.id && months.includes(li.month) &&
        (input.label === undefined || matchesLabel(li, input.label))
      )
      for (const li of doomed) await deleteLineItem(li.id)
      return {
        summary: `Deleted ${doomed.length} budget line${doomed.length === 1 ? '' : 's'} for ${cat.category} in ${year}`,
        result: { year, deleted: doomed.length },
      }
    },
  },
]

// Forecast module: the working plan, seeded once from the budget and edited
// independently thereafter.

import {
  getForecastLineItems, insertForecastLineItem, updateForecastLineItem,
  deleteForecastLineItem, setForecastRate, resetForecastToBudget,
  seedForecastFromBudget, hasForecastForYear,
} from '../../db/forecastLineItems.js'
import { upsertForecastOverride, deleteForecastOverride } from '../../db/forecastOverrides.js'
import { getBudgetCategories, upsertCategory } from '../../db/budgetCategories.js'
import { resolveMonths, describeMonths } from './budget.tools.js'
import {
  money, findCategory, resolveCategoryId, row, toMonth, toNumber, toYear,
  requireField, MONTH_SHORT,
} from './helpers.js'

// Rows written by a committed scenario carry source_scenario_id. They are owned
// by that scenario (reverting it deletes them), so manual edits never touch
// them — otherwise an edit here would silently vanish on revert.
function isEditable(li) {
  return li.source_scenario_id == null
}

function matchesLabel(li, label) {
  return (label ?? null) === (li.label ?? null)
}

export const forecastTools = [
  {
    name: 'set_forecast_amount',
    group: 'forecast',
    write: true,
    schema: {
      name: 'set_forecast_amount',
      description:
        'Set the forecast amount for a category across one or more months. The forecast is the ' +
        'live working plan — it drives the Bill Planner and cash flow views. Existing rows are ' +
        'updated and missing ones created. Rows written by a committed scenario are left alone. ' +
        'Use set_budget_amount instead when the user means the budget of record.',
      input_schema: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          year: { type: 'integer' },
          months: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 12 } },
          month: { type: 'integer', minimum: 1, maximum: 12 },
          from_month: { type: 'integer', minimum: 1, maximum: 12 },
          to_month: { type: 'integer', minimum: 1, maximum: 12 },
          amount: { type: 'number' },
          label: { type: 'string', description: 'Optional named sub-row.' },
          note: { type: 'string' },
        },
        required: ['category', 'amount'],
      },
    },
    async preview(input, ctx) {
      const year = toYear(input.year)
      const months = resolveMonths(input)
      const cat = findCategory(await getBudgetCategories(ctx.userId), input.category)
      const items = await getForecastLineItems(ctx.userId, year)
      const current = (items ?? []).filter(li =>
        li.category_id === cat?.id && months.includes(li.month) && matchesLabel(li, input.label ?? null) && isEditable(li)
      )
      const currentTotal = current.reduce((s, li) => s + toNumber(li.amount), 0)
      const nextTotal = toNumber(input.amount) * months.length
      return {
        title: `Forecast ${year} · ${cat?.category ?? input.category}`,
        subtitle: input.label ? `Sub-row: ${input.label}` : '',
        rows: [
          cat ? null : row('Category', 'will be created', 'muted'),
          row('Months', `${describeMonths(months)} (${months.length})`),
          row('Per month', money(input.amount)),
          row('Range total', `${money(currentTotal)} → ${money(nextTotal)}`, nextTotal > currentTotal ? 'bad' : 'good'),
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

      // Writing into a year that was never initialized would leave the forecast
      // holding this one category and nothing else, so seed it from the budget first.
      if (!(await hasForecastForYear(userId, year))) {
        await seedForecastFromBudget(userId, year)
      }

      const items = await getForecastLineItems(userId, year)
      let updated = 0
      let created = 0
      for (const month of months) {
        const match = (items ?? []).find(li =>
          li.category_id === categoryId && li.month === month && matchesLabel(li, label) && isEditable(li)
        )
        if (match) {
          await updateForecastLineItem(match.id, { amount, note: input.note })
          updated += 1
        } else {
          await insertForecastLineItem(userId, { year, categoryId, month, amount, label, note: input.note ?? null })
          created += 1
        }
      }
      return {
        summary: `Forecast ${year}: ${input.category} set to ${money(amount)} for ${describeMonths(months)} (${updated} updated, ${created} added)`,
        result: { year, months, amount, updated, created },
      }
    },
  },

  {
    name: 'set_forecast_rate',
    group: 'forecast',
    write: true,
    schema: {
      name: 'set_forecast_rate',
      description:
        'Replace a category\'s forecast with a flat monthly rate from a given month to the end of ' +
        'the year — the "run this category at $X from here on" action. Existing rows in that range ' +
        'are replaced, not added to.',
      input_schema: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          year: { type: 'integer' },
          from_month: { type: 'integer', minimum: 1, maximum: 12, description: 'First month the rate applies to. Defaults to the current month.' },
          rate: { type: 'number', description: 'Monthly amount.' },
          label: { type: 'string', description: 'Restrict to a named sub-row.' },
        },
        required: ['category', 'rate'],
      },
    },
    async preview(input, ctx) {
      const cat = findCategory(await getBudgetCategories(ctx.userId), input.category)
      const from = toMonth(input.from_month ?? new Date().getMonth() + 1)
      return {
        title: `Forecast rate · ${cat?.category ?? input.category}`,
        subtitle: input.label ? `Sub-row: ${input.label}` : '',
        rows: [
          row('From', `${MONTH_SHORT[from - 1]} ${toYear(input.year)} onwards`),
          row('Rate', `${money(input.rate)} / month`),
          row('Replaces', 'existing forecast rows in that range', 'muted'),
        ],
      }
    },
    async execute(userId, input) {
      const categoryId = resolveCategoryId(await getBudgetCategories(userId), requireField(input, 'category'))
      if (!categoryId) throw new Error(`No budget category named "${input.category}".`)
      const year = toYear(input.year)
      const fromMonth = toMonth(input.from_month ?? new Date().getMonth() + 1)
      const rows = await setForecastRate(userId, {
        year, categoryId, label: input.label ?? null, rate: toNumber(input.rate), fromMonth,
      })
      return {
        summary: `Forecast ${year}: ${input.category} running at ${money(input.rate)}/mo from ${MONTH_SHORT[fromMonth - 1]} (${rows?.length ?? 0} months)`,
        result: { year, fromMonth, months: rows?.length ?? 0 },
      }
    },
  },

  {
    name: 'delete_forecast_lines',
    group: 'forecast',
    write: true,
    schema: {
      name: 'delete_forecast_lines',
      description: 'Remove forecast rows for a category in the given months. Rows owned by a committed scenario are left alone.',
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
      const items = await getForecastLineItems(ctx.userId, year)
      const doomed = (items ?? []).filter(li =>
        li.category_id === cat?.id && months.includes(li.month) && isEditable(li) &&
        (input.label === undefined || matchesLabel(li, input.label))
      )
      return {
        title: `Delete forecast lines · ${cat?.category ?? input.category}`,
        subtitle: `${doomed.length} row${doomed.length === 1 ? '' : 's'} in ${year}`,
        rows: [
          row('Months', describeMonths(months)),
          row('Total removed', money(doomed.reduce((s, li) => s + toNumber(li.amount), 0)), 'good'),
        ],
        destructive: true,
      }
    },
    async execute(userId, input) {
      const year = toYear(input.year)
      const months = resolveMonths(input)
      const cat = findCategory(await getBudgetCategories(userId), requireField(input, 'category'))
      if (!cat) throw new Error(`No budget category named "${input.category}".`)
      const items = await getForecastLineItems(userId, year)
      const doomed = (items ?? []).filter(li =>
        li.category_id === cat.id && months.includes(li.month) && isEditable(li) &&
        (input.label === undefined || matchesLabel(li, input.label))
      )
      for (const li of doomed) await deleteForecastLineItem(li.id)
      return {
        summary: `Deleted ${doomed.length} forecast row${doomed.length === 1 ? '' : 's'} for ${cat.category} in ${year}`,
        result: { year, deleted: doomed.length },
      }
    },
  },

  {
    name: 'reset_forecast_to_budget',
    group: 'forecast',
    write: true,
    schema: {
      name: 'reset_forecast_to_budget',
      description:
        'Wipe a year\'s forecast and re-seed it from the current budget. This discards every ' +
        'forecast edit for that year. Only use it when the user explicitly asks to start the ' +
        'forecast over.',
      input_schema: {
        type: 'object',
        properties: { year: { type: 'integer' } },
        required: ['year'],
      },
    },
    async preview(input, ctx) {
      const year = toYear(input.year)
      const items = await getForecastLineItems(ctx.userId, year)
      return {
        title: `Reset forecast · ${year}`,
        subtitle: 'Every forecast edit for this year is discarded and replaced with the budget.',
        rows: [row('Rows replaced', (items ?? []).length, 'bad')],
        destructive: true,
      }
    },
    async execute(userId, input) {
      const year = toYear(requireField(input, 'year'))
      const rows = await resetForecastToBudget(userId, year)
      return { summary: `Reset ${year} forecast to the budget (${rows?.length ?? 0} rows)`, result: { year, rows: rows?.length ?? 0 } }
    },
  },

  {
    name: 'set_forecast_override',
    group: 'forecast',
    write: true,
    schema: {
      name: 'set_forecast_override',
      description:
        'Pin a category\'s forecast total for a single month, overriding whatever its line items ' +
        'add up to. Set clear: true to remove an existing override.',
      input_schema: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          year: { type: 'integer' },
          month: { type: 'integer', minimum: 1, maximum: 12 },
          amount: { type: 'number', description: 'Override total for the month.' },
          clear: { type: 'boolean', description: 'True to remove the override instead of setting one.' },
          note: { type: 'string' },
        },
        required: ['category', 'month'],
      },
    },
    async preview(input, ctx) {
      const cat = findCategory(await getBudgetCategories(ctx.userId), input.category)
      const clearing = input.clear === true || input.amount === null || input.amount === undefined
      return {
        title: `${clearing ? 'Clear' : 'Set'} forecast override · ${cat?.category ?? input.category}`,
        rows: [
          row('Month', `${MONTH_SHORT[toMonth(input.month) - 1]} ${toYear(input.year)}`),
          row('Override', clearing ? 'removed' : money(input.amount)),
        ],
        destructive: clearing,
      }
    },
    async execute(userId, input) {
      const categoryId = resolveCategoryId(await getBudgetCategories(userId), requireField(input, 'category'))
      if (!categoryId) throw new Error(`No budget category named "${input.category}".`)
      const year = toYear(input.year)
      const month = toMonth(requireField(input, 'month'))
      if (input.clear === true || input.amount === null || input.amount === undefined) {
        await deleteForecastOverride(userId, categoryId, year, month)
        return { summary: `Cleared forecast override on ${input.category} for ${MONTH_SHORT[month - 1]} ${year}`, result: { year, month } }
      }
      await upsertForecastOverride(userId, {
        categoryId, year, month, amount: toNumber(input.amount), note: input.note ?? null,
      })
      return {
        summary: `Pinned ${input.category} to ${money(input.amount)} for ${MONTH_SHORT[month - 1]} ${year}`,
        result: { year, month },
      }
    },
  },
]

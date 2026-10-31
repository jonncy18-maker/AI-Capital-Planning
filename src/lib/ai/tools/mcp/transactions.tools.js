// Transaction tools (MCP only): search, summarise, cash flow and recategorise.

import { getTransactions, getTransactionsByMonth, reclassifyTransactions } from '../../../db/transactions.js'
import { getBudgetCategories, getExcludedCategoryNames } from '../../../db/budgetCategories.js'
import { MONARCH_CATEGORY_MAP } from '../../../csv/categoryMap.js'
import { monthlyTotals, categoryTotals } from '../../../cashflow/monthlyTotals.js'
import { row, previewRows, requireField, toYear, toMonth } from '../helpers.js'
import { withMode } from './shared.js'

const MAX_PAGE = 400
const MAX_SUMMARY_MONTHS = 36
const MAX_IDS = 500
const DATE = /^\d{4}-\d{2}-\d{2}$/
const iso = (d) => String(d ?? '').slice(0, 10)

function compactRow(t) {
  return {
    id: t.id,
    date: iso(t.date),
    merchant: t.merchant,
    amount: Number(t.amount),
    account: t.account,
    category: t.category,
    group: t.group,
    notes: t.notes || undefined,
    ...(t.tags ? { tags: t.tags } : {}),
  }
}

function requireDate(input, field) {
  const v = requireField(input, field)
  if (!DATE.test(String(v))) throw new Error(`${field} must be YYYY-MM-DD.`)
  return String(v)
}

function monthsBetween(from, to) {
  return (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1
}

async function loadRange(userId, from, to, includeExcluded) {
  const [rows, excluded] = await Promise.all([
    getTransactionsByMonth(userId, from, to),
    includeExcluded ? Promise.resolve(new Set()) : getExcludedCategoryNames(userId).catch(() => new Set()),
  ])
  return (rows ?? []).filter(t => !excluded.has(t.category))
}

function byMonth(rows) {
  const out = new Map()
  for (const t of rows) {
    const key = iso(t.date).slice(0, 7)
    if (!out.has(key)) out.set(key, [])
    out.get(key).push(t)
  }
  return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

async function resolveGroup(userId, category) {
  const own = (await getBudgetCategories(userId)).find(c => c.category === category)
  return own?.group ?? MONARCH_CATEGORY_MAP[category]?.group ?? null
}

async function buildUpdates(userId, input) {
  const ids = Array.isArray(input.ids) ? [...new Set(input.ids)] : []
  if (ids.length === 0) throw new Error('Pass at least one transaction id in ids.')
  if (ids.length > MAX_IDS) throw new Error(`At most ${MAX_IDS} ids per call.`)
  const category = String(requireField(input, 'category')).trim()
  const group = await resolveGroup(userId, category)
  return ids.map(id => ({
    id,
    category,
    group,
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  }))
}

export const transactionTools = [
  {
    name: 'search_transactions',
    group: 'transactions',
    write: false,
    schema: {
      name: 'search_transactions',
      description:
        'Search transactions, newest first. Filter by date range, exact category, merchant substring or exact account. ' +
        `Returns up to ${MAX_PAGE} rows per call (default 100); page with the returned next_offset. Rows include the id used by recategorize_transactions.`,
      input_schema: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'YYYY-MM-DD, inclusive.' },
          to: { type: 'string', description: 'YYYY-MM-DD, inclusive.' },
          category: { type: 'string' },
          merchant: { type: 'string', description: 'Case-insensitive substring.' },
          account: { type: 'string', description: 'Exact account name.' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
      },
    },
    async execute(userId, input) {
      const limit = Math.min(MAX_PAGE, Math.max(1, Number(input.limit) || 100))
      const offset = Math.max(0, Number(input.offset) || 0)
      // One extra row tells us whether another page exists without a count query.
      const fetched = await getTransactions(userId, {
        from: input.from, to: input.to, category: input.category,
        merchant: input.merchant, account: input.account, limit: limit + 1, offset,
      })
      const page = fetched.slice(0, limit).map(compactRow)
      const nextOffset = fetched.length > limit ? offset + limit : null
      return {
        summary: `Found ${page.length} transaction${page.length === 1 ? '' : 's'}`
          + (nextOffset != null ? ` (more available: call again with offset ${nextOffset})` : ''),
        result: { count: page.length, returned: page.length, offset, next_offset: nextOffset, has_more: nextOffset != null, rows: page },
      }
    },
  },

  {
    name: 'summarize_transactions',
    group: 'transactions',
    write: false,
    schema: {
      name: 'summarize_transactions',
      description:
        `Totals over a date range of at most ${MAX_SUMMARY_MONTHS} months, grouped by month, category or both. ` +
        'Transfers and other categories flagged exclude-from-totals are dropped unless include_excluded is true, ' +
        'matching the Cash flow tab. total_out is a positive magnitude; net is in minus out.',
      input_schema: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'YYYY-MM-DD.' },
          to: { type: 'string', description: 'YYYY-MM-DD.' },
          group_by: { type: 'string', enum: ['month', 'category', 'month_category'] },
          include_excluded: { type: 'boolean' },
        },
        required: ['from', 'to', 'group_by'],
      },
    },
    async execute(userId, input) {
      const from = requireDate(input, 'from')
      const to = requireDate(input, 'to')
      if (to < from) throw new Error('to must not be before from.')
      if (monthsBetween(from, to) > MAX_SUMMARY_MONTHS) throw new Error(`Range is limited to ${MAX_SUMMARY_MONTHS} months.`)
      const mode = requireField(input, 'group_by')
      const rows = await loadRange(userId, from, to, input.include_excluded === true)
      const months = byMonth(rows)

      let result
      if (mode === 'month') {
        result = { months: months.map(([month, r]) => ({ month, ...monthlyTotals(r) })) }
      } else if (mode === 'category') {
        result = { categories: categoryTotals(rows) }
      } else if (mode === 'month_category') {
        result = { months: months.map(([month, r]) => ({ month, ...monthlyTotals(r), categories: categoryTotals(r) })) }
      } else {
        throw new Error('group_by must be month, category or month_category.')
      }
      return { summary: `Summarised ${rows.length} transactions ${from} to ${to}`, result: { from, to, transactions: rows.length, ...result } }
    },
  },

  {
    name: 'get_cash_flow',
    group: 'transactions',
    write: false,
    schema: {
      name: 'get_cash_flow',
      description: 'Actual money in, money out and net for one month (the Cash flow tab, Actuals view), with the per-category breakdown. Excluded categories (transfers) are dropped.',
      input_schema: {
        type: 'object',
        properties: { year: { type: 'integer' }, month: { type: 'integer', description: '1-12.' } },
        required: ['year', 'month'],
      },
    },
    async execute(userId, input) {
      const year = toYear(input.year)
      const month = toMonth(input.month)
      const pad = (n) => String(n).padStart(2, '0')
      const from = `${year}-${pad(month)}-01`
      const to = `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`
      const rows = await loadRange(userId, from, to, false)
      const totals = monthlyTotals(rows)
      return {
        summary: `Cash flow for ${year}-${pad(month)}`,
        result: { year, month, totalIn: totals.totalIn, totalOut: totals.totalOut, net: totals.net, by_category: categoryTotals(rows) },
      }
    },
  },

  {
    name: 'recategorize_transactions',
    group: 'transactions',
    write: true,
    mcpGated: true,
    schema: {
      name: 'recategorize_transactions',
      description:
        'Change the category (and optionally notes) of existing transactions by id, from search_transactions. ' +
        'The group follows the category from your budget categories. Date, amount, merchant and account never change. ' +
        'Note: a later Monarch import whose category differs will reclassify these rows back (Monarch is the source of truth).',
      input_schema: {
        type: 'object',
        properties: withMode({
          ids: { type: 'array', items: { type: 'string' }, description: `Transaction ids, at most ${MAX_IDS}.` },
          category: { type: 'string' },
          notes: { type: 'string' },
        }),
        required: ['ids', 'category'],
      },
    },
    async preview(input, ctx) {
      const updates = await buildUpdates(ctx.userId, input)
      const dry = await reclassifyTransactions(ctx.userId, updates, { dryRun: true })
      const { rows, overflow } = previewRows(
        dry.rows.map(r => row(`${r.date} · ${r.merchant} · ${r.amount}`, `${r.category_before ?? '—'} → ${r.category_after}`)),
        10
      )
      return {
        title: `Recategorize ${dry.rows.length} transaction${dry.rows.length === 1 ? '' : 's'} → ${input.category}`,
        subtitle: [
          overflow ? `+${overflow} more not shown` : '',
          dry.not_found?.length ? `${dry.not_found.length} id(s) not found: ${dry.not_found.join(', ')}` : '',
        ].filter(Boolean).join(' · '),
        rows,
      }
    },
    async execute(userId, input) {
      const updates = await buildUpdates(userId, input)
      const out = await reclassifyTransactions(userId, updates)
      return {
        summary: `Recategorized ${out.updated} transaction${out.updated === 1 ? '' : 's'} to ${input.category}`
          + (out.not_found?.length ? ` (${out.not_found.length} id(s) not found)` : ''),
        result: out,
      }
    },
  },
]

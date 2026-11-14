// Pure series math for the History module. All money is integer cents; the UI
// converts at the edge. Spend/income rules match widgetData.js
// (monthlyBudgetVsActual / incomeVsExpenses): excluded categories are dropped,
// expenses are negative amounts, positive amounts are income.

import { parseLocalDate } from '../dates.js'
import { toCents } from '../money.js'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const UNDER_RATIO = 0.9

const isIncomeGroup = (g) => (g || '').trim().toLowerCase() === 'income'
const pad = (n) => String(n).padStart(2, '0')
const bump = (obj, k, c) => { obj[k] = (obj[k] || 0) + c }

export function monthKey(date) {
  const d = parseLocalDate(date)
  return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number)
  return `${MONTH_NAMES[m - 1]} ${String(y).slice(2)}`
}

function shiftKey(key, delta) {
  const [y, m] = key.split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`
}

export function aggregateTransactions(txns, excluded) {
  const byMonth = {}
  for (const t of txns ?? []) {
    const key = monthKey(t.date)
    if (!key) continue
    const m = byMonth[key] ??= { hasData: true, spend: 0, income: 0, group: {}, category: {}, merchant: {} }
    const amt = Number(t.amount) || 0
    if (amt === 0 || (t.category && excluded?.has(t.category))) continue
    const cents = Math.abs(toCents(amt))
    if (amt > 0) { m.income += cents; continue }
    m.spend += cents
    bump(m.group, t.group || 'Uncategorized', cents)
    bump(m.category, t.category || 'Uncategorized', cents)
    bump(m.merchant, t.merchant || 'Unknown', cents)
  }
  return { byMonth }
}

// A line item existing for a month means "a budget exists" there, even at $0.
// Duplicate versions are summed, as widgetData.js and the Budget tab do.
export function aggregateBudget(lineItems) {
  const out = {}
  for (const li of lineItems ?? []) {
    const year = Number(li.budget_year)
    const month = Number(li.month)
    if (!year || !month) continue
    const bc = li.budget_categories
    if (isIncomeGroup(bc?.group)) continue
    const m = out[`${year}-${pad(month)}`] ??= { total: 0, group: {}, category: {} }
    const cents = toCents(li.amount)
    m.total += cents
    bump(m.group, bc?.group || 'Uncategorized', cents)
    bump(m.category, bc?.category || 'Uncategorized', cents)
  }
  return out
}

export function budgetStatus(actual, budget) {
  if (budget == null) return null
  if (actual > budget) return 'over'
  if (actual < budget * UNDER_RATIO) return 'under'
  return 'on'
}

// offset pages backward: months for '12', years for 'fy'. Ignored for 'all'.
export function rangeMonthKeys(kind, agg, now = new Date(), offset = 0) {
  if (kind === 'fy') {
    const y = now.getFullYear() - offset
    return Array.from({ length: 12 }, (_, i) => `${y}-${pad(i + 1)}`)
  }
  if (kind === '12') {
    const end = shiftKey(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`, -offset)
    return Array.from({ length: 12 }, (_, i) => shiftKey(end, i - 11))
  }
  const keys = Object.keys(agg.byMonth).sort()
  if (!keys.length) return []
  const out = []
  for (let k = keys[0]; k <= keys.at(-1); k = shiftKey(k, 1)) out.push(k)
  return out
}

export function buildHistory({ txns, lineItems, excluded, groupBy = 'group', range = 'all', offset = 0, now = new Date() }) {
  const agg = aggregateTransactions(txns, excluded)
  const budget = aggregateBudget(lineItems)
  const keys = rangeMonthKeys(range, agg, now, offset)
  const dim = groupBy === 'category' ? 'category' : groupBy === 'merchant' ? 'merchant' : 'group'
  const budgetable = dim !== 'merchant'

  const columns = keys.map((key) => {
    const a = agg.byMonth[key]
    return {
      key,
      label: monthLabel(key),
      hasData: !!a,
      spend: a?.spend ?? 0,
      income: a?.income ?? 0,
      budget: budget[key]?.total ?? null,
    }
  })

  const names = new Set()
  for (const key of keys) {
    for (const n of Object.keys(agg.byMonth[key]?.[dim] ?? {})) names.add(n)
    if (budgetable && agg.byMonth[key]) for (const n of Object.keys(budget[key]?.[dim] ?? {})) names.add(n)
  }

  const rows = []
  for (const name of names) {
    const cells = {}
    let total = 0
    let anyBudget = false
    let anyUnbudgeted = false
    for (const key of keys) {
      const a = agg.byMonth[key]
      if (!a) continue
      const actual = a[dim][name] ?? 0
      const monthBudget = budget[key]
      const b = budgetable && monthBudget ? (monthBudget[dim][name] ?? null) : null
      if (actual === 0 && b == null) continue
      const unbudgeted = budgetable && !!monthBudget && b == null && actual > 0
      if (b != null) anyBudget = true
      if (unbudgeted) anyUnbudgeted = true
      cells[key] = { actual, budget: b, status: budgetStatus(actual, b), unbudgeted }
      total += actual
    }
    rows.push({ name, cells, total, noBudget: anyUnbudgeted && !anyBudget })
  }
  rows.sort((x, y) => y.total - x.total || x.name.localeCompare(y.name))

  let spent = 0
  let income = 0
  let vsActual = 0
  let vsBudgetTotal = 0
  let vsMonths = 0
  for (const c of columns) {
    if (!c.hasData) continue
    spent += c.spend
    income += c.income
    if (c.budget != null) { vsActual += c.spend; vsBudgetTotal += c.budget; vsMonths += 1 }
  }
  const monthsWithData = columns.filter(c => c.hasData).length

  return {
    columns,
    rows,
    totals: {
      spent,
      income,
      savingsRate: income > 0 ? (income - spent) / income : null,
      monthsWithData,
      monthsInRange: columns.length,
    },
    vsBudget: { actual: vsActual, budget: vsBudgetTotal, months: vsMonths },
  }
}

export function buildMonthDetail({ txns, lineItems, excluded, month }) {
  const a = aggregateTransactions(txns, excluded).byMonth[month]
  const b = aggregateBudget(lineItems)[month]
  const names = new Set([...Object.keys(a?.category ?? {}), ...Object.keys(b?.category ?? {})])
  const groupOf = {}
  for (const li of lineItems ?? []) {
    if (li.budget_categories?.category) groupOf[li.budget_categories.category] = li.budget_categories.group
  }
  for (const t of txns ?? []) {
    if (t.category && t.group && monthKey(t.date) === month) groupOf[t.category] ??= t.group
  }
  const categories = [...names].map((name) => {
    const actual = a?.category[name] ?? 0
    const planned = b ? (b.category[name] ?? null) : null
    return { name, group: groupOf[name] ?? null, planned, actual, left: planned == null ? null : planned - actual }
  })
  categories.sort((x, y) => y.actual - x.actual || x.name.localeCompare(y.name))
  return {
    month,
    label: monthLabel(month),
    hasData: !!a,
    hasBudget: !!b,
    income: a?.income ?? 0,
    expenses: a?.spend ?? 0,
    planned: b?.total ?? null,
    categories,
  }
}

export function categoryTrend({ txns, lineItems, excluded, category, monthKeys }) {
  const agg = aggregateTransactions(txns, excluded)
  const budget = aggregateBudget(lineItems)
  return monthKeys.map((key) => ({
    key,
    actual: agg.byMonth[key]?.category[category] ?? 0,
    budget: budget[key]?.category[category] ?? null,
    hasData: !!agg.byMonth[key],
  }))
}

export function categoryTransactions({ txns, excluded, category, month }) {
  const out = []
  ;(txns ?? []).forEach((t, index) => {
    const amt = Number(t.amount) || 0
    if (amt >= 0 || monthKey(t.date) !== month) return
    if (t.category && excluded?.has(t.category)) return
    if ((t.category || 'Uncategorized') !== category) return
    out.push({ index, date: t.date, merchant: t.merchant || 'Unknown', account: t.account || '', cents: Math.abs(toCents(amt)) })
  })
  return out
}

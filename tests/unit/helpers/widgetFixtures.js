// Shared hand-made ctx fixtures for the widgetData tests.
// "Now" in these tests is 2026-06-15 12:00 local (month index 5 = June).
import { vi } from 'vitest'

export const NOW = new Date(2026, 5, 15, 12, 0, 0)

export function freezeClock(date = NOW) {
  vi.useFakeTimers()
  vi.setSystemTime(date)
}

export function thawClock() {
  vi.useRealTimers()
}

export const CATEGORIES = [
  { id: 'c-rent', category: 'Rent', group: 'Housing' },
  { id: 'c-groc', category: 'Groceries', group: 'Food' },
  { id: 'c-dine', category: 'Dining', group: 'Food' },
  { id: 'c-xfer', category: 'Transfer', group: 'Transfers', exclude_from_totals: true },
  { id: 'c-sal', category: 'Salary', group: 'Income' },
]

const GROUP_BY_CAT = { Rent: 'Housing', Groceries: 'Food', Dining: 'Food', Salary: 'Income', Transfer: 'Transfers' }
const ID_BY_CAT = { Rent: 'c-rent', Groceries: 'c-groc', Dining: 'c-dine', Salary: 'c-sal', Transfer: 'c-xfer' }

// Line items for one category. `amounts` is a number (same all 12 months), an
// array of 12, or an object {month: amount}.
export function lines(category, amounts, { year = 2026, type = 'Fixed' } = {}) {
  let byMonth
  if (typeof amounts === 'number') byMonth = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, amounts]))
  else if (Array.isArray(amounts)) byMonth = Object.fromEntries(amounts.map((a, i) => [i + 1, a]))
  else byMonth = amounts
  return Object.entries(byMonth).map(([month, amount]) => ({
    category_id: ID_BY_CAT[category],
    month: Number(month),
    amount,
    budget_year: year,
    budget_categories: { category, group: GROUP_BY_CAT[category], type },
  }))
}

export function txn(date, category, amount) {
  return { date, category, group: GROUP_BY_CAT[category], amount }
}

// Budget: Rent 1000 + Groceries 400 + Dining 100 = 1500 every month, plus a
// 5000 Salary (Income) line in July that must never count as spend.
export function budgetCtx(extra = {}) {
  return {
    thisYear: 2026,
    categories: CATEGORIES,
    budgetLineItems: [
      ...lines('Rent', 1000),
      ...lines('Groceries', 400),
      ...lines('Dining', 100),
      ...lines('Salary', { 7: 5000 }),
    ],
    forecastLineItems: [],
    scenarios: [],
    commitments: [],
    ...extra,
  }
}

// Actuals against budgetCtx():
//   Jan 1500, Feb 1800, Mar 1300, Apr none, May 1400, Jun 300 (current), Jul future.
export const TXNS_2026 = [
  txn('2026-01-05', 'Rent', -1000), txn('2026-01-12', 'Groceries', -450), txn('2026-01-20', 'Dining', -50),
  txn('2026-02-05', 'Rent', -1000), txn('2026-02-12', 'Groceries', -700), txn('2026-02-20', 'Dining', -100),
  txn('2026-03-05', 'Rent', -1000), txn('2026-03-12', 'Groceries', -200), txn('2026-03-20', 'Dining', -100),
  txn('2026-03-25', 'Transfer', -9999), // excluded category
  txn('2026-03-28', 'Salary', 3000), // income, ignored by expense math
  txn('2026-05-05', 'Rent', -1000), txn('2026-05-12', 'Groceries', -400),
  txn('2026-06-02', 'Groceries', -300),
  txn('2026-07-05', 'Rent', -1000), // future month: must not count as actual
  txn('2025-12-30', 'Rent', -777), // other year
  { date: 'garbage', category: 'Rent', group: 'Housing', amount: -123 }, // unparseable
]

export const adj = (year, month, delta, category, group, extra = {}) => ({
  year, month, delta_amount: delta, budget_categories: { category, group }, ...extra,
})

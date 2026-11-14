// Gathers the inputs for buildCheckingHistory (checkingHistory.js). Read-only:
// it calls no writing function.

import { getTransactionsByMonth } from '../db/transactions.js'
import { getAccountBalances } from '../db/bills.js'
import { addDays, mondayOnOrBefore } from './weeklyCashSeries.js'
import { HISTORY_WEEKS, RECONCILE_WINDOW_DAYS } from './checkingHistory.js'

const ACCOUNT_NAME_LOOKBACK_DAYS = 548

// Account names from roughly 18 months of transactions, so quiet accounts still appear.
export async function loadMonarchAccountNames({ userId, today }) {
  const rows = await getTransactionsByMonth(userId, addDays(today, -ACCOUNT_NAME_LOOKBACK_DAYS), today)
  return (Array.isArray(rows) ? rows : []).map(r => ({ account: String(r.account ?? '') }))
}

export async function loadCheckingHistoryInputs({ userId, primary, today }) {
  const start = mondayOnOrBefore(today)
  const fetchFrom = addDays(start, -(HISTORY_WEEKS * 7) - RECONCILE_WINDOW_DAYS - 1)

  // One unfiltered range read (about 40 days); matching the account happens in JS.
  const rows = await getTransactionsByMonth(userId, fetchFrom, today)
  const transactions = (Array.isArray(rows) ? rows : []).map(r => ({
    date: String(r.date).slice(0, 10),
    amount: Number(r.amount),
    account: String(r.account ?? ''),
    merchant: String(r.merchant ?? ''),
  }))

  const [fy, fm] = fetchFrom.split('-').map(Number)
  const [ty, tm] = today.split('-').map(Number)
  const months = []
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? (y += 1, m = 1) : (m += 1)) {
    months.push({ y, m })
  }
  const balanceRows = (await Promise.all(months.map(({ y, m }) => getAccountBalances(userId, y, m)))).flat()

  return { transactions, balanceRows, fetchFrom, accountName: primary?.monarch_account_name ?? null }
}

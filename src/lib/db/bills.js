import { supabase } from '../supabase.js'

// ─── Accounts ────────────────────────────────────────────────────────────────

export async function getAccounts(userId) {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('active', true)
    .order('display_order', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function upsertAccount(userId, account) {
  const { data, error } = await supabase
    .from('accounts')
    .upsert({ ...account, user_id: userId })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteAccount(id) {
  const { error } = await supabase.from('accounts').delete().eq('id', id)
  if (error) throw error
}

// ─── Bills ───────────────────────────────────────────────────────────────────

export async function getBills(userId) {
  const { data, error } = await supabase
    .from('bills')
    .select('*')
    .eq('user_id', userId)
    .eq('active', true)
    .order('pay_day', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function upsertBill(userId, bill) {
  const row = {
    ...bill,
    user_id: userId,
    // enforce pay_day = due_day when toggled
    pay_day: bill.pay_same_as_due ? bill.due_day : bill.pay_day,
  }
  const { data, error } = await supabase
    .from('bills')
    .upsert(row)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteBill(id) {
  const { error } = await supabase.from('bills').delete().eq('id', id)
  if (error) throw error
}

// ─── Bill amounts (variable monthly amounts, e.g. CC statements) ─────────────

export async function getBillAmounts(userId, year, month) {
  const { data, error } = await supabase
    .from('bill_amounts')
    .select('*')
    .eq('user_id', userId)
    .eq('year', year)
    .eq('month', month)
  if (error) throw error
  return data ?? []
}

export async function getBillAmountsForBill(billId) {
  const { data, error } = await supabase
    .from('bill_amounts')
    .select('*')
    .eq('bill_id', billId)
    .order('year', { ascending: false })
    .order('month', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function upsertBillAmount(userId, billId, year, month, amount, notes = null) {
  const { data, error } = await supabase
    .from('bill_amounts')
    .upsert({ bill_id: billId, user_id: userId, year, month, amount, notes })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteBillAmount(billId, year, month) {
  const { error } = await supabase
    .from('bill_amounts')
    .delete()
    .eq('bill_id', billId)
    .eq('year', year)
    .eq('month', month)
  if (error) throw error
}

// ─── Account balances (manual period snapshots) ───────────────────────────────

export async function getAccountBalances(userId, year, month) {
  const { data, error } = await supabase
    .from('account_balances')
    .select('*, account:accounts(id, name, type, is_primary_checking)')
    .eq('user_id', userId)
    .eq('year', year)
    .eq('month', month)
    .order('period_half', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function upsertAccountBalance(userId, accountId, year, month, periodHalf, balance) {
  const { data, error } = await supabase
    .from('account_balances')
    .upsert({ account_id: accountId, user_id: userId, year, month, period_half: periodHalf, balance })
    .select()
    .single()
  if (error) throw error
  return data
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Returns the effective amount for a bill in a given month:
// uses bill_amounts entry if present, otherwise falls back to fixed_amount.
export function resolveBillAmount(bill, billAmountsMap) {
  const key = bill.id
  if (billAmountsMap[key] != null) return billAmountsMap[key]
  return bill.fixed_amount ?? null
}

// Given a list of bills and their resolved amounts, splits them into
// the two semi-monthly periods defined by the user's pay schedule.
// period 1: bills whose pay_day <= midpoint (default 15)
// period 2: bills whose pay_day > midpoint
export function splitBillsByPeriod(bills, billAmountsMap, midpoint = 15) {
  const period1 = []
  const period2 = []

  for (const bill of bills) {
    const amount = resolveBillAmount(bill, billAmountsMap)
    const entry = { ...bill, resolvedAmount: amount }
    if (bill.pay_day <= midpoint) {
      period1.push(entry)
    } else {
      period2.push(entry)
    }
  }

  return { period1, period2 }
}

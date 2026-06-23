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

// Pages through results to avoid Supabase's default 1,000-row cap.
export async function getBillAmountsForBill(billId) {
  const PAGE = 1000
  const all = []
  let from = 0
  let more = true
  while (more) {
    const { data, error } = await supabase
      .from('bill_amounts')
      .select('*')
      .eq('bill_id', billId)
      .order('year', { ascending: false })
      .order('month', { ascending: false })
      .range(from, from + PAGE - 1)

    if (error) throw error
    const batch = data ?? []
    all.push(...batch)
    more = batch.length === PAGE
    from += PAGE
  }
  return all
}

// Pages through results to avoid Supabase's default 1,000-row cap.
export async function getBillAmountsRange(userId, startYear, endYear) {
  const PAGE = 1000
  const all = []
  let from = 0
  let more = true
  while (more) {
    const { data, error } = await supabase
      .from('bill_amounts')
      .select('*')
      .eq('user_id', userId)
      .gte('year', startYear)
      .lte('year', endYear)
      .range(from, from + PAGE - 1)

    if (error) throw error
    const batch = data ?? []
    all.push(...batch)
    more = batch.length === PAGE
    from += PAGE
  }
  return all
}

export async function upsertBillAmount(userId, billId, year, month, amount, notes = null) {
  const { data, error } = await supabase
    .from('bill_amounts')
    .upsert(
      { bill_id: billId, user_id: userId, year, month, amount, notes },
      { onConflict: 'bill_id,year,month' }
    )
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
    .upsert(
      { account_id: accountId, user_id: userId, year, month, period_half: periodHalf, balance },
      { onConflict: 'account_id,year,month,period_half' }
    )
    .select()
    .single()
  if (error) throw error
  return data
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Fetch the effective monthly forecast amount for each bill that has a
// forecast_category_id. Returns a map of billId → derived amount (after divisor).
// Resolution: sum(forecast_line_items) ?? sum(budget_line_items) for that
// category+month. The forecast is an independent dataset; where it has lines for
// the category/month they define the amount, otherwise the budget is used.
export async function getForecastAmountsForBills(userId, year, month, bills) {
  const linkedBills = bills.filter(b => b.forecast_category_id)
  if (linkedBills.length === 0) return {}

  const categoryIds = [...new Set(linkedBills.map(b => b.forecast_category_id))]

  const [{ data: lineItems, error: liErr }, { data: forecastLines, error: fErr }] = await Promise.all([
    supabase
      .from('budget_line_items')
      .select('category_id, amount')
      .eq('user_id', userId)
      .eq('budget_year', year)
      .eq('month', month)
      .in('category_id', categoryIds),
    supabase
      .from('forecast_line_items')
      .select('category_id, amount')
      .eq('user_id', userId)
      .eq('budget_year', year)
      .eq('month', month)
      .in('category_id', categoryIds),
  ])
  if (liErr) throw liErr
  if (fErr) throw fErr

  // Sum budget_line_items per category
  const lineItemTotals = {}
  for (const li of (lineItems ?? [])) {
    lineItemTotals[li.category_id] = (lineItemTotals[li.category_id] ?? 0) + Number(li.amount)
  }

  // Sum forecast_line_items per category (these take precedence when present)
  const forecastTotals = {}
  for (const fi of (forecastLines ?? [])) {
    forecastTotals[fi.category_id] = (forecastTotals[fi.category_id] ?? 0) + Number(fi.amount)
  }

  const result = {}
  for (const bill of linkedBills) {
    const monthly = forecastTotals[bill.forecast_category_id] ?? lineItemTotals[bill.forecast_category_id] ?? null
    if (monthly != null) {
      result[bill.id] = monthly / Math.max(1, bill.forecast_divisor ?? 1)
    }
  }
  return result
}

// Returns the effective amount for a bill in a given month.
// Priority: manual bill_amounts entry → linked-card statement projection →
//           forecast-derived → fixed_amount → null (variable).
// The card-statement projection lets a credit-card bill auto-fill from the
// statement balance projected for its linked card, while a manual entry still wins.
export function resolveBillAmount(bill, billAmountsMap, forecastAmountsMap = {}, cardStatementMap = {}) {
  // A forecast-linked bill is driven by its forecast — the Bills-tab link is the
  // source of truth, so a stale per-month entry must not mask it. (Credit-card
  // statement projections below are estimates a manual entry may still override.)
  const forecastAmt = bill.forecast_category_id != null ? forecastAmountsMap[bill.id] : null
  if (forecastAmt != null) return forecastAmt
  // Manual per-month entries apply only to plain variable bills. A stored amount
  // on a fixed bill is stale data from a prior variable config and must not
  // override the fixed amount (otherwise it double-counts in trends/schedule).
  if (bill.fixed_amount == null && billAmountsMap[bill.id] != null) return billAmountsMap[bill.id]
  if (cardStatementMap[bill.id] != null) return cardStatementMap[bill.id]
  return bill.fixed_amount ?? null
}

// Given a list of bills and their resolved amounts, splits them into
// the two semi-monthly periods defined by the user's pay schedule.
// period 1: bills whose pay_day <= midpoint (default 15)
// period 2: bills whose pay_day > midpoint
export function splitBillsByPeriod(bills, billAmountsMap, midpoint = 15, forecastAmountsMap = {}, cardStatementMap = {}) {
  const period1 = []
  const period2 = []

  for (const bill of bills) {
    const amount = resolveBillAmount(bill, billAmountsMap, forecastAmountsMap, cardStatementMap)
    const entry = { ...bill, resolvedAmount: amount }
    if (bill.pay_day <= midpoint) {
      period1.push(entry)
    } else {
      period2.push(entry)
    }
  }

  return { period1, period2 }
}

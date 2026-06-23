import { supabase } from '../supabase.js'

// ─── Income actuals (one cash-inflow figure per month) ────────────────────────
// Income = cash inflow. Historical months are pulled from transactions; any month
// can be manually adjusted. Forecast (future) months are derived live from the
// salary/bonus assumptions in Settings (see incomeForecast.js) and are not stored.

export async function getIncomeActualsRange(userId, startYear, endYear) {
  const { data, error } = await supabase
    .from('income_actuals')
    .select('*')
    .eq('user_id', userId)
    .gte('year', startYear)
    .lte('year', endYear)
  if (error) throw error
  return data ?? []
}

export async function upsertIncomeActual(userId, year, month, amount, source = 'manual') {
  const { data, error } = await supabase
    .from('income_actuals')
    .upsert(
      { user_id: userId, year, month, amount, source },
      { onConflict: 'user_id,year,month' }
    )
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteIncomeActual(userId, year, month) {
  const { error } = await supabase
    .from('income_actuals')
    .delete()
    .eq('user_id', userId)
    .eq('year', year)
    .eq('month', month)
  if (error) throw error
}

// Positive (income) transactions in a date range, for the "pull from history"
// action. Caller aggregates by month and drops excluded categories.
// Pages through results to avoid Supabase's default 1,000-row cap.
export async function getIncomeTransactions(userId, startDate, endDate) {
  const PAGE = 1000
  const all = []
  let from = 0
  let more = true
  while (more) {
    const { data, error } = await supabase
      .from('transactions')
      .select('date, amount, category')
      .eq('user_id', userId)
      .gt('amount', 0)
      .gte('date', startDate)
      .lte('date', endDate)
      .range(from, from + PAGE - 1)

    if (error) throw error
    const batch = data ?? []
    all.push(...batch)
    more = batch.length === PAGE
    from += PAGE
  }
  return all
}

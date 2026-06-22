import { supabase } from '../supabase.js'
import { getBudgetLineItems } from './budgetLineItems.js'

// The forecast is an independent dataset: its own line items, seeded once from
// the budget and edited independently thereafter. Budget edits never flow into
// the forecast, and forecast edits never touch the budget.

export async function getForecastLineItems(userId, year) {
  const { data, error } = await supabase
    .from('forecast_line_items')
    .select('*, budget_categories(id, category, "group", type)')
    .eq('user_id', userId)
    .eq('budget_year', year)
    .order('month', { ascending: true })

  if (error) throw error
  return data ?? []
}

// True when a forecast already exists for the year (i.e. it has been initialized).
export async function hasForecastForYear(userId, year) {
  const { count, error } = await supabase
    .from('forecast_line_items')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('budget_year', year)

  if (error) throw error
  return (count ?? 0) > 0
}

export async function insertForecastLineItem(userId, { year, categoryId, month, amount, label, note }) {
  const { data, error } = await supabase
    .from('forecast_line_items')
    .insert({
      user_id: userId,
      budget_year: year,
      category_id: categoryId,
      month,
      amount,
      label: label ?? null,
      note: note ?? null,
      source: 'manual',
    })
    .select('*, budget_categories(id, category, "group", type)')
    .single()

  if (error) throw error
  return data
}

export async function updateForecastLineItem(id, { amount, label, note }) {
  const patch = { updated_at: new Date().toISOString() }
  if (amount !== undefined) patch.amount = amount
  if (label !== undefined) patch.label = label
  if (note !== undefined) patch.note = note

  const { data, error } = await supabase
    .from('forecast_line_items')
    .update(patch)
    .eq('id', id)
    .select('*, budget_categories(id, category, "group", type)')
    .single()

  if (error) throw error
  return data
}

export async function deleteForecastLineItem(id) {
  const { error } = await supabase.from('forecast_line_items').delete().eq('id', id)
  if (error) throw error
}

// Seed the forecast for a year by copying the budget line items. Used the first
// time a user initializes the forecast (or when resetting it back to the budget).
// Returns the freshly inserted forecast rows (with their category joined).
export async function seedForecastFromBudget(userId, year) {
  const budgetItems = await getBudgetLineItems(userId, { year })
  const rows = budgetItems
    .filter(li => li.category_id)
    .map(li => ({
      user_id: userId,
      budget_year: year,
      category_id: li.category_id,
      month: li.month ?? 1,
      amount: Number(li.amount) || 0,
      label: li.label ?? null,
      note: null,
      source: 'seed',
    }))

  if (!rows.length) return []

  const { data, error } = await supabase
    .from('forecast_line_items')
    .insert(rows)
    .select('*, budget_categories(id, category, "group", type)')

  if (error) throw error
  return data ?? []
}

// Reset: wipe the year's forecast and re-seed it from the current budget.
export async function resetForecastToBudget(userId, year) {
  const { error: delErr } = await supabase
    .from('forecast_line_items')
    .delete()
    .eq('user_id', userId)
    .eq('budget_year', year)
  if (delErr) throw delErr
  return seedForecastFromBudget(userId, year)
}

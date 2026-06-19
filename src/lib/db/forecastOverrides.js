import { supabase } from '../supabase.js'

export async function getForecastOverrides(userId, year) {
  const { data, error } = await supabase
    .from('forecast_overrides')
    .select('*, budget_categories(id, category, "group", type)')
    .eq('user_id', userId)
    .eq('budget_year', year)
  if (error) throw error
  return data ?? []
}

export async function upsertForecastOverride(userId, { categoryId, year, month, amount, note }) {
  const { error } = await supabase
    .from('forecast_overrides')
    .upsert({
      user_id: userId,
      category_id: categoryId,
      budget_year: year,
      month,
      amount,
      note: note ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,category_id,budget_year,month' })
  if (error) throw error
}

export async function deleteForecastOverride(userId, categoryId, year, month) {
  const { error } = await supabase
    .from('forecast_overrides')
    .delete()
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .eq('budget_year', year)
    .eq('month', month)
  if (error) throw error
}

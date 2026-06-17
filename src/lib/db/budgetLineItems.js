import { supabase } from '../supabase.js'

export async function getBudgetLineItems(userId, { year } = {}) {
  let q = supabase
    .from('budget_line_items')
    .select('*, budget_categories(id, category, "group", type)')
    .eq('user_id', userId)
    .order('month', { ascending: true })

  if (year) q = q.eq('budget_year', year)

  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function getBudgetYears(userId) {
  const { data, error } = await supabase
    .from('budget_line_items')
    .select('budget_year')
    .eq('user_id', userId)

  if (error) throw error
  const years = [...new Set((data ?? []).map(r => r.budget_year))].sort((a, b) => a - b)
  return years
}

// Replace all budget_line_items for a given year+version with the supplied rows.
export async function saveBudgetForYear(userId, year, version = 'v1', items) {
  // Delete existing rows for this year/version first
  const { error: delErr } = await supabase
    .from('budget_line_items')
    .delete()
    .eq('user_id', userId)
    .eq('budget_year', year)
    .eq('budget_version', version)

  if (delErr) throw delErr

  if (!items.length) return

  const rows = items.map(item => ({
    user_id: userId,
    budget_year: year,
    budget_version: version,
    category_id: item.category_id,
    month: item.month,
    amount: item.amount,
    label: item.label ?? null,
    commitment_id: item.commitment_id ?? null,
  }))

  const { error } = await supabase.from('budget_line_items').insert(rows)
  if (error) throw error
}

// Update a single line item's amount (for inline editing).
export async function updateLineItemAmount(id, amount) {
  const { error } = await supabase
    .from('budget_line_items')
    .update({ amount })
    .eq('id', id)

  if (error) throw error
}

export async function deleteLineItem(id) {
  const { error } = await supabase.from('budget_line_items').delete().eq('id', id)
  if (error) throw error
}

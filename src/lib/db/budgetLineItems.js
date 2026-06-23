import { supabase } from '../supabase.js'

// Pages through results to avoid Supabase's default 1,000-row cap.
export async function getBudgetLineItems(userId, { year } = {}) {
  const PAGE = 1000
  const all = []
  let from = 0
  let more = true
  while (more) {
    let q = supabase
      .from('budget_line_items')
      .select('*, budget_categories(id, category, "group", type)')
      .eq('user_id', userId)
      .order('month', { ascending: true })
      .range(from, from + PAGE - 1)

    if (year) q = q.eq('budget_year', year)

    const { data, error } = await q
    if (error) throw error
    const batch = data ?? []
    all.push(...batch)
    more = batch.length === PAGE
    from += PAGE
  }
  return all
}

// Pages through results to avoid Supabase's default 1,000-row cap.
export async function getBudgetYears(userId) {
  const PAGE = 1000
  const all = []
  let from = 0
  let more = true
  while (more) {
    const { data, error } = await supabase
      .from('budget_line_items')
      .select('budget_year')
      .eq('user_id', userId)
      .range(from, from + PAGE - 1)

    if (error) throw error
    const batch = data ?? []
    all.push(...batch)
    more = batch.length === PAGE
    from += PAGE
  }
  const years = [...new Set(all.map(r => r.budget_year))].sort((a, b) => a - b)
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

// Insert a single budget line item (e.g. adding a new line under a category from
// the Forecast drill-down). Returns the inserted row with its category joined so
// callers can fold it straight into their in-memory line-item list.
export async function insertBudgetLineItem(userId, { year, version = 'v1', categoryId, month, amount, label }) {
  const { data, error } = await supabase
    .from('budget_line_items')
    .insert({
      user_id: userId,
      budget_year: year,
      budget_version: version,
      category_id: categoryId,
      month,
      amount,
      label: label ?? null,
    })
    .select('*, budget_categories(id, category, "group", type)')
    .single()

  if (error) throw error
  return data
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

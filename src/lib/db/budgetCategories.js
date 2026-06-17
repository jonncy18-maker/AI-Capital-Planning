import { supabase } from '../supabase.js'
import { CATEGORY_SEED_DATA } from '../csv/categoryMap.js'

// Upsert the default Monarch category → group/type mappings for this user.
// Safe to call multiple times — will not overwrite user-customized targets.
export async function seedDefaultCategories(userId) {
  const rows = CATEGORY_SEED_DATA.map(c => ({
    user_id: userId,
    category: c.category,
    group: c.group,
    type: c.type,
    is_active: true,
  }))

  const { error } = await supabase
    .from('budget_categories')
    .upsert(rows, { onConflict: 'user_id,category', ignoreDuplicates: true })

  if (error) throw error
}

// Upsert a single custom category mapping (e.g. from the unmapped-categories dialog).
export async function upsertCategory(userId, { category, group, type }) {
  const { error } = await supabase
    .from('budget_categories')
    .upsert(
      { user_id: userId, category, group, type, is_active: true },
      { onConflict: 'user_id,category' }
    )

  if (error) throw error
}

// Fetch all budget_categories for this user.
export async function getBudgetCategories(userId) {
  const { data, error } = await supabase
    .from('budget_categories')
    .select('*')
    .eq('user_id', userId)
    .order('group', { ascending: true })

  if (error) throw error
  return data ?? []
}

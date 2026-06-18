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
    exclude_from_totals: !!c.exclude,
    is_active: true,
  }))

  const { error } = await supabase
    .from('budget_categories')
    .upsert(rows, { onConflict: 'user_id,category', ignoreDuplicates: true })

  if (error) throw error
}

// Upsert a single custom category mapping (e.g. from the unmapped-categories
// dialog or the Mapping editor). `excludeFromTotals` is only written when the
// caller passes it, so callers that don't manage it leave the flag untouched.
export async function upsertCategory(userId, { category, group, type, excludeFromTotals }) {
  const row = { user_id: userId, category, group, type, is_active: true }
  if (excludeFromTotals !== undefined) row.exclude_from_totals = !!excludeFromTotals

  const { error } = await supabase
    .from('budget_categories')
    .upsert(row, { onConflict: 'user_id,category' })

  if (error) throw error
}

// Set of category names this user has flagged exclude_from_totals — used to
// drop transfers / credit-card payments from spend & income aggregations.
export async function getExcludedCategoryNames(userId) {
  const { data, error } = await supabase
    .from('budget_categories')
    .select('category')
    .eq('user_id', userId)
    .eq('exclude_from_totals', true)

  if (error) throw error
  return new Set((data ?? []).map(r => r.category).filter(Boolean))
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

// Distinct, non-empty groups this user already uses — i.e. their own budget
// buckets. Used to drive flexible mapping (AI + dropdowns map into these
// instead of a fixed built-in list).
export async function getUserGroups(userId) {
  const { data, error } = await supabase
    .from('budget_categories')
    .select('group')
    .eq('user_id', userId)
    .not('group', 'is', null)

  if (error) throw error
  return [...new Set((data ?? []).map(r => r.group).filter(Boolean))].sort()
}

// Bulk upsert category → { group, type, monthly_target } mappings, e.g. from a
// budget/mapping CSV the user already maintains. This is authoritative: it seeds
// the user's own buckets so subsequent imports map cleanly without AI guessing.
// Rows without a category or group are skipped.
export async function importCategoryMappings(userId, rows) {
  const payload = (rows ?? [])
    .filter(r => r.category && r.group)
    .map(r => ({
      user_id: userId,
      category: r.category,
      group: r.group,
      ...(r.type ? { type: r.type } : {}),
      ...(r.monthlyTarget != null ? { monthly_target: r.monthlyTarget } : {}),
      is_active: true,
    }))

  if (payload.length === 0) return { imported: 0 }

  const { error } = await supabase
    .from('budget_categories')
    .upsert(payload, { onConflict: 'user_id,category' })

  if (error) throw error
  return { imported: payload.length }
}

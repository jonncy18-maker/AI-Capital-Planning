import { supabase } from '../supabase.js'

// Lifecycle status for a year's budget. A missing row means the budget has
// never been finalized — i.e. it's a freely editable draft. We default to
// 'draft' (and swallow errors) so the UI keeps working even if the
// budget_status table hasn't been migrated yet.

export async function getBudgetStatus(userId, year, version = 'v1') {
  const { data, error } = await supabase
    .from('budget_status')
    .select('status, finalized_at')
    .eq('user_id', userId)
    .eq('budget_year', year)
    .eq('budget_version', version)
    .maybeSingle()

  if (error) return { status: 'draft', finalized_at: null }
  return { status: data?.status ?? 'draft', finalized_at: data?.finalized_at ?? null }
}

export async function setBudgetStatus(userId, year, status, version = 'v1') {
  const row = {
    user_id: userId,
    budget_year: year,
    budget_version: version,
    status,
    finalized_at: status === 'finalized' ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }
  const { error } = await supabase
    .from('budget_status')
    .upsert(row, { onConflict: 'user_id,budget_year,budget_version' })
  if (error) throw error
}

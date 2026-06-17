import { supabase } from '../supabase.js'

export async function getWealthSnapshots(userId, limit = 24) {
  const { data, error } = await supabase
    .from('wealth_snapshots')
    .select('*')
    .eq('user_id', userId)
    .order('snapshot_date', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data ?? []
}

export async function getLatestWealthSnapshot(userId) {
  const { data, error } = await supabase
    .from('wealth_snapshots')
    .select('*')
    .eq('user_id', userId)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function saveWealthSnapshot(userId, {
  snapshot_date,
  net_worth,
  investment_balance,
  retirement_balance,
  other_assets,
  liabilities,
  notes,
}) {
  const { data, error } = await supabase
    .from('wealth_snapshots')
    .insert({
      user_id: userId,
      snapshot_date,
      net_worth,
      investment_balance: investment_balance ?? null,
      retirement_balance: retirement_balance ?? null,
      other_assets: other_assets ?? null,
      liabilities: liabilities ?? null,
      notes: notes ?? null,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteWealthSnapshot(id) {
  const { error } = await supabase.from('wealth_snapshots').delete().eq('id', id)
  if (error) throw error
}

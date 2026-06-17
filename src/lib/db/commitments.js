import { supabase } from '../supabase.js'

export async function getCommitments(userId, { status = 'active' } = {}) {
  let q = supabase
    .from('commitments')
    .select('*')
    .eq('user_id', userId)
    .order('start_date', { ascending: true })

  if (status) q = q.eq('status', status)

  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function upsertCommitment(userId, commitment) {
  const { data, error } = await supabase
    .from('commitments')
    .upsert({ ...commitment, user_id: userId })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteCommitment(id) {
  const { error } = await supabase.from('commitments').delete().eq('id', id)
  if (error) throw error
}

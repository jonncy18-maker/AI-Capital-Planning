import { supabase } from '../supabase.js'

export async function logImport(userId, { filename, totalRows, inserted, skipped, unmappedCount }) {
  const { data, error } = await supabase
    .from('import_logs')
    .insert({
      user_id: userId,
      filename: filename ?? null,
      total_rows: totalRows,
      inserted,
      skipped,
      unmapped_count: unmappedCount ?? 0,
    })
    .select('id, created_at')
    .single()

  if (error) throw error
  return data
}

export async function getImportHistory(userId) {
  const { data, error } = await supabase
    .from('import_logs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw error
  return data ?? []
}

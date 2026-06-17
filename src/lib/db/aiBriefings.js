import { supabase } from '../supabase.js'

// Most recent cached briefing for a module context (or dashboard overview).
export async function getLatestBriefing(userId, moduleContext = 'dashboard') {
  const { data, error } = await supabase
    .from('ai_briefings')
    .select('*')
    .eq('user_id', userId)
    .eq('module_context', moduleContext)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function saveBriefing(userId, { narrative, context_summary, module_context = 'dashboard' }) {
  const { data, error } = await supabase
    .from('ai_briefings')
    .insert({
      user_id: userId,
      narrative,
      context_summary: context_summary ?? null,
      module_context,
      is_cached: true,
      generated_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) throw error
  return data
}

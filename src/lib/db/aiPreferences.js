import { supabase } from '../supabase.js'

// AI personalization preferences (one row per user). A missing row means the
// user has never personalized — the AI uses its neutral defaults. We default to
// an empty object (and swallow errors) so the UI keeps working even if the
// ai_preferences table hasn't been migrated yet.

const EMPTY = { preferences: {}, interview: null, grill_enabled: false }

export async function getAIPreferences(userId) {
  const { data, error } = await supabase
    .from('ai_preferences')
    .select('preferences, interview, grill_enabled')
    .eq('user_id', userId)
    .maybeSingle()

  if (error || !data) return { ...EMPTY }
  return {
    preferences: data.preferences ?? {},
    interview: data.interview ?? null,
    grill_enabled: !!data.grill_enabled,
  }
}

export async function saveAIPreferences(userId, { preferences, interview, grill_enabled }) {
  const row = {
    user_id: userId,
    updated_at: new Date().toISOString(),
  }
  if (preferences !== undefined) row.preferences = preferences
  if (interview !== undefined) row.interview = interview
  if (grill_enabled !== undefined) row.grill_enabled = grill_enabled

  const { error } = await supabase
    .from('ai_preferences')
    .upsert(row, { onConflict: 'user_id' })
  if (error) throw error
}

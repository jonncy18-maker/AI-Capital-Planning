import { supabase } from '../supabase.js'

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (error) throw error
  return data
}

export async function saveProfile(userId, profile) {
  const { data, error } = await supabase
    .from('user_profiles')
    .upsert({
      id: userId,
      focuses: profile.focuses ?? [],
      commitments: profile.commitments ?? [],
      planning_horizon: profile.planningHorizon ?? [],
      period_options: profile.periodOptions ?? [],
      period_default: profile.periodDefault ?? null,
      data_path: profile.dataPath ?? null,
      onboarding_complete: profile.onboardingComplete ?? false,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) throw error
  return data
}

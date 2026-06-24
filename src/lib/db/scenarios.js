import { supabase } from '../supabase.js'

export async function getScenarios(userId) {
  const { data, error } = await supabase
    .from('scenarios')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

export async function createScenario(userId, { name, description = '' }) {
  const { data, error } = await supabase
    .from('scenarios')
    .insert({ user_id: userId, name, description, state: 'modeled' })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateScenario(userId, scenarioId, updates) {
  const { data, error } = await supabase
    .from('scenarios')
    .update(updates)
    .eq('id', scenarioId)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteScenario(userId, scenarioId) {
  const { error } = await supabase
    .from('scenarios')
    .delete()
    .eq('id', scenarioId)
    .eq('user_id', userId)

  if (error) throw error
}

export async function promoteToCommitted(userId, scenarioId) {
  const { data, error } = await supabase
    .from('scenarios')
    .update({ state: 'committed', committed_at: new Date().toISOString() })
    .eq('id', scenarioId)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getAdjustments(userId, scenarioId) {
  const { data, error } = await supabase
    .from('scenario_adjustments')
    .select('*, budget_categories(category, "group", type)')
    .eq('user_id', userId)
    .eq('scenario_id', scenarioId)
    .order('year', { ascending: true })
    .order('month', { ascending: true })

  if (error) throw error
  return data ?? []
}

export async function addAdjustment(userId, scenarioId, { category_id, month, year, delta_amount, label = '' }) {
  const { data, error } = await supabase
    .from('scenario_adjustments')
    .insert({ user_id: userId, scenario_id: scenarioId, category_id, month, year, delta_amount, label })
    .select('*, budget_categories(category, "group", type)')
    .single()

  if (error) throw error
  return data
}

export async function deleteAdjustment(adjustmentId) {
  const { error } = await supabase
    .from('scenario_adjustments')
    .delete()
    .eq('id', adjustmentId)

  if (error) throw error
}

export async function cloneScenario(userId, scenarioId, { name, description = '' }) {
  const newScenario = await createScenario(userId, { name, description })
  const adjs = await getAdjustments(userId, scenarioId)
  for (const adj of adjs) {
    await addAdjustment(userId, newScenario.id, {
      category_id: adj.category_id,
      month: adj.month,
      year: adj.year,
      delta_amount: adj.delta_amount,
      label: adj.label || '',
    })
  }
  return newScenario
}

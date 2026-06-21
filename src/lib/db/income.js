import { supabase } from '../supabase.js'

// ─── Income sources (salary, bonus, …) ───────────────────────────────────────

export async function getIncomeSources(userId) {
  const { data, error } = await supabase
    .from('income_sources')
    .select('*')
    .eq('user_id', userId)
    .eq('active', true)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function upsertIncomeSource(userId, source) {
  const row = {
    ...source,
    user_id: userId,
    // annual sources need a pay month; monthly ones ignore it
    month: source.cadence === 'annual' ? source.month : null,
  }
  const { data, error } = await supabase
    .from('income_sources')
    .upsert(row)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteIncomeSource(id) {
  const { error } = await supabase.from('income_sources').delete().eq('id', id)
  if (error) throw error
}

// ─── Income actuals (per-month reconciliation) ────────────────────────────────

export async function getIncomeAmountsRange(userId, startYear, endYear) {
  const { data, error } = await supabase
    .from('income_amounts')
    .select('*')
    .eq('user_id', userId)
    .gte('year', startYear)
    .lte('year', endYear)
  if (error) throw error
  return data ?? []
}

export async function getIncomeAmounts(userId, year, month) {
  const { data, error } = await supabase
    .from('income_amounts')
    .select('*')
    .eq('user_id', userId)
    .eq('year', year)
    .eq('month', month)
  if (error) throw error
  return data ?? []
}

export async function upsertIncomeAmount(userId, incomeSourceId, year, month, amount, notes = null) {
  const { data, error } = await supabase
    .from('income_amounts')
    .upsert(
      { income_source_id: incomeSourceId, user_id: userId, year, month, amount, notes },
      { onConflict: 'income_source_id,year,month' }
    )
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteIncomeAmount(incomeSourceId, year, month) {
  const { error } = await supabase
    .from('income_amounts')
    .delete()
    .eq('income_source_id', incomeSourceId)
    .eq('year', year)
    .eq('month', month)
  if (error) throw error
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// The expected inflow a source contributes to a given month (1-12).
//   monthly → its amount every month
//   annual  → its amount only in its pay month, else 0
//   variable (amount == null) → null (no forecast; relies on entered actuals)
export function expectedInflowForMonth(source, month) {
  if (source.amount == null) return null
  if (source.cadence === 'annual') return source.month === month ? Number(source.amount) : 0
  return Number(source.amount)
}

// Resolve a month's inflow across all sources. An entered actual always wins over
// the expected amount (mirrors resolveBillAmount for outflow). Returns the total,
// the per-source lines, and whether any actual was entered for the month.
export function resolveMonthlyInflow(sources, actualsMap = {}, month) {
  let total = 0
  let hasActual = false
  const lines = []
  for (const s of (sources ?? [])) {
    const expected = expectedInflowForMonth(s, month)
    const actualRaw = actualsMap[s.id]
    const actual = actualRaw != null ? Number(actualRaw) : null
    if (actual != null) hasActual = true
    const resolved = actual != null ? actual : (expected ?? 0)
    total += resolved
    // keep lines that carry a value so the tooltip/reconcile view stays uncluttered
    if (resolved !== 0 || actual != null || (expected != null && expected !== 0)) {
      lines.push({ source: s, expected, actual, resolved })
    }
  }
  return { total, lines, hasActual }
}

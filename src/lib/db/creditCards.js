import { supabase } from '../supabase.js'

// ─── Credit Cards ─────────────────────────────────────────────────────────────

export async function getCreditCards(userId) {
  const { data, error } = await supabase
    .from('credit_cards')
    .select('*')
    .eq('user_id', userId)
    .eq('active', true)
    .order('display_order', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function upsertCreditCard(userId, card) {
  const { data, error } = await supabase
    .from('credit_cards')
    .upsert({ ...card, user_id: userId })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteCreditCard(id) {
  const { error } = await supabase.from('credit_cards').delete().eq('id', id)
  if (error) throw error
}

// ─── Earn Rates ───────────────────────────────────────────────────────────────

export async function getEarnRates(userId) {
  const { data, error } = await supabase
    .from('credit_card_earn_rates')
    .select('*')
    .eq('user_id', userId)
  if (error) throw error
  return data ?? []
}

export async function upsertEarnRate(userId, cardId, ccCategory, earnRate) {
  const { data, error } = await supabase
    .from('credit_card_earn_rates')
    .upsert({ card_id: cardId, user_id: userId, cc_category: ccCategory, earn_rate: earnRate })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteEarnRate(cardId, ccCategory) {
  const { error } = await supabase
    .from('credit_card_earn_rates')
    .delete()
    .eq('card_id', cardId)
    .eq('cc_category', ccCategory)
  if (error) throw error
}

// Returns a nested map: { [cardId]: { [cc_category]: earn_rate } }
export function buildEarnRateMap(earnRates) {
  const map = {}
  for (const r of earnRates) {
    if (!map[r.card_id]) map[r.card_id] = {}
    map[r.card_id][r.cc_category] = Number(r.earn_rate)
  }
  return map
}

// ─── Points Balances ──────────────────────────────────────────────────────────

// Returns the latest snapshot per card as a map: { [cardId]: { balance, as_of_date } }
export async function getPointsBalances(userId) {
  const { data, error } = await supabase
    .from('credit_card_points')
    .select('*')
    .eq('user_id', userId)
    .order('as_of_date', { ascending: false })
  if (error) throw error

  const latest = {}
  for (const row of (data ?? [])) {
    if (!latest[row.card_id]) latest[row.card_id] = row
  }
  return latest
}

export async function upsertPointsBalance(userId, cardId, balance, asOfDate) {
  const { data, error } = await supabase
    .from('credit_card_points')
    .insert({ card_id: cardId, user_id: userId, balance, as_of_date: asOfDate })
    .select()
    .single()
  if (error) throw error
  return data
}

// ─── Planned Redemptions ──────────────────────────────────────────────────────

export async function getPointRedemptions(userId, year) {
  const { data, error } = await supabase
    .from('credit_card_point_redemptions')
    .select('*')
    .eq('user_id', userId)
    .eq('year', year)
    .order('month', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function upsertPointRedemption(userId, redemption) {
  const row = { ...redemption, user_id: userId }
  if (row.id) {
    const { data, error } = await supabase
      .from('credit_card_point_redemptions')
      .update(row)
      .eq('id', row.id)
      .select()
      .single()
    if (error) throw error
    return data
  }
  const { data, error } = await supabase
    .from('credit_card_point_redemptions')
    .insert(row)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deletePointRedemption(id) {
  const { error } = await supabase
    .from('credit_card_point_redemptions')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ─── Transaction account detection ───────────────────────────────────────────

// Returns distinct account names from transactions with their transaction counts,
// for the AI to classify as credit cards. Caller passes result to parseCreditCardsFromTransactions.
export async function getDistinctTransactionAccounts(userId) {
  const { data, error } = await supabase
    .rpc('get_distinct_accounts', { p_user_id: userId })
    .catch(() => ({ data: null, error: { message: 'rpc not available' } }))

  if (!error && data) return data

  // Fallback: fetch via select (less efficient but always works)
  const { data: txns, error: txnErr } = await supabase
    .from('transactions')
    .select('account')
    .eq('user_id', userId)
    .not('account', 'is', null)

  if (txnErr) throw txnErr

  const counts = {}
  for (const t of (txns ?? [])) {
    counts[t.account] = (counts[t.account] ?? 0) + 1
  }

  return Object.entries(counts)
    .map(([account, txn_count]) => ({ account, txn_count }))
    .sort((a, b) => b.txn_count - a.txn_count)
}

// ─── CC Settings (from user_profiles) ────────────────────────────────────────

export async function getCCSettings(userId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('cc_coverage_pct, cc_optimization_pct')
    .eq('id', userId)
    .single()
  if (error) throw error
  return {
    coveragePct: data?.cc_coverage_pct ?? 80,
    optimizationPct: data?.cc_optimization_pct ?? 100,
  }
}

export async function updateCCSettings(userId, { coveragePct, optimizationPct }) {
  const { error } = await supabase
    .from('user_profiles')
    .update({ cc_coverage_pct: coveragePct, cc_optimization_pct: optimizationPct })
    .eq('id', userId)
  if (error) throw error
}

import { supabase } from '../supabase.js'

// Build the dedup key used for import deduplication.
export function buildDedupKey({ date, merchant, amount, account }) {
  return `${date}|${merchant.toLowerCase()}|${amount}|${account ?? ''}`
}

// Insert rows from a parsed CSV, skipping duplicates.
// Returns { inserted: number, skipped: number }.
// Uses count-before / count-after to accurately measure inserts, and
// batches in groups of 500 to avoid payload limits on large files.
export async function importTransactions(userId, rows) {
  const prepared = rows.map(r => ({
    user_id: userId,
    date: r.date,
    merchant: r.merchant,
    category: r.category ?? null,
    group: r.group ?? null,
    account: r.account ?? null,
    amount: r.amount,
    original_statement: r.originalStatement ?? null,
    notes: r.notes ?? null,
    owner: r.owner ?? null,
    import_source: r.importSource ?? 'csv',
    dedup_key: buildDedupKey(r),
  }))

  const { count: beforeCount, error: beforeErr } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  if (beforeErr) throw beforeErr

  const BATCH = 500
  for (let i = 0; i < prepared.length; i += BATCH) {
    const { error } = await supabase
      .from('transactions')
      .upsert(prepared.slice(i, i + BATCH), { onConflict: 'user_id,dedup_key', ignoreDuplicates: true })
    if (error) throw error
  }

  const { count: afterCount, error: afterErr } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  if (afterErr) throw afterErr

  const inserted = (afterCount ?? 0) - (beforeCount ?? 0)
  const skipped = prepared.length - inserted
  return { inserted, skipped }
}

// Fetch recent transactions for AI context (last N days, summary level).
export async function getRecentTransactions(userId, days = 90) {
  const since = new Date()
  since.setDate(since.getDate() - days)

  const { data, error } = await supabase
    .from('transactions')
    .select('date, merchant, category, "group", amount, account')
    .eq('user_id', userId)
    .gte('date', since.toISOString().slice(0, 10))
    .order('date', { ascending: false })

  if (error) throw error
  return data ?? []
}

// Fetch transactions with optional filters.
export async function getTransactions(userId, { from, to, category, limit = 500 } = {}) {
  let q = supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(limit)

  if (from) q = q.gte('date', from)
  if (to)   q = q.lte('date', to)
  if (category) q = q.eq('category', category)

  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

// Fetch transactions in a date range for cash flow calendar aggregation.
export async function getTransactionsByMonth(userId, fromDate, toDate) {
  const { data, error } = await supabase
    .from('transactions')
    .select('date, amount, "group", category, merchant')
    .eq('user_id', userId)
    .gte('date', fromDate)
    .lte('date', toDate)
    .order('date', { ascending: true })

  if (error) throw error
  return data ?? []
}

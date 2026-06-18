// Monarch Money integration seam.
//
// Monarch has no official public API. The community has reverse-engineered its
// private GraphQL endpoint (the same one the web app uses), which a handful of
// third-party connectors wrap (e.g. the `monarchmoney` Python library). We lean
// on that here, but the browser cannot talk to Monarch directly — its GraphQL
// endpoint rejects cross-origin requests and a session token must never live in
// client JS. So the actual login + transaction pull runs server-side in the
// `monarch-sync` Supabase Edge Function (see supabase/functions/monarch-sync),
// which holds the session and returns normalized rows. This module is the thin
// client seam; it mirrors how sendMessage.js fronts the ai-chat function.
//
// The reliable, always-available path remains the Monarch CSV export — this just
// removes the manual download/upload step when the function is deployed.

import { supabase } from '../supabase.js'

const MONARCH_COLUMNS = [
  'Date', 'Merchant', 'Category', 'Account',
  'Original Statement', 'Notes', 'Amount', 'Tags', 'Owner',
]

function csvCell(v) {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Render normalized Monarch rows as a CSV string in the exact column layout the
// existing Monarch CSV parser/import pipeline expects — so a sync reuses the same
// parse → category-map → dedup-import flow as a manual upload, no special-casing.
//
// Deduplication is automatic and bidirectional: importTransactions computes a
// dedup_key of `date|merchant_lower|amount|account` for every row and upserts
// with onConflict (user_id, dedup_key) + ignoreDuplicates against a UNIQUE
// constraint. Because the API sync is funneled through the SAME Monarch CSV
// parser, an identical transaction — whether it first arrived via a CSV export
// or a sync — produces the same key and is skipped. So a sync never re-inserts
// what a CSV already added, and a later CSV won't duplicate what a sync added.
export function monarchRowsToCSV(rows) {
  const header = MONARCH_COLUMNS.join(',')
  const lines = rows.map(r => [
    r.date, r.merchant, r.category, r.account,
    r.originalStatement ?? r.original_statement ?? '',
    r.notes ?? '', r.amount, r.tags ?? '', r.owner ?? '',
  ].map(csvCell).join(','))
  return [header, ...lines].join('\n')
}

// Pull transactions from Monarch via the edge function. Returns
//   { status: 'ok', csv, count }                       on success
//   { status: 'gated' | 'error', message }             otherwise
// `since` is an optional ISO date (YYYY-MM-DD) lower bound.
export async function syncMonarchTransactions({ email, password, mfaCode, since } = {}) {
  if (!email || !password) {
    return { status: 'error', message: 'Enter your Monarch email and password to connect.' }
  }

  const { data, error } = await supabase.functions.invoke('monarch-sync', {
    body: { email, password, mfaCode: mfaCode || null, since: since || null },
  })

  if (error) {
    // Function not deployed yet, or a network/auth failure reaching it.
    return {
      status: 'gated',
      message:
        `Could not reach the Monarch sync service: ${error.message}. ` +
        `This needs the monarch-sync Edge Function deployed ` +
        `(see supabase/functions/monarch-sync/README.md). ` +
        `Until then, use the Monarch CSV export below.`,
    }
  }
  if (data?.error) {
    return { status: 'error', message: data.error }
  }

  const rows = data?.transactions ?? []
  return { status: 'ok', csv: monarchRowsToCSV(rows), count: rows.length }
}

export { MONARCH_COLUMNS }

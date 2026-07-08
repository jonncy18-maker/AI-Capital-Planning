import { getNeonSql } from '../../../src/lib/neon/client.js'
import { auth } from '../../../src/lib/neon/authServer.js'

// Mirrors src/lib/db/transactions.js#buildDedupKey exactly. Duplicated here
// (rather than imported) so this server route has no dependency on the
// client-side db module.
function buildDedupKey({ date, merchant, amount, account }) {
  return `${date}|${merchant.toLowerCase()}|${amount}|${account ?? ''}`
}

// GET /api/transactions?from=&to=&category=&limit=
// Mirrors src/lib/db/transactions.js#getTransactions: general-purpose
// filtered fetch, newest first, capped by limit (default 500).
export async function GET(request) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const category = searchParams.get('category')
  const limitParam = Number.parseInt(searchParams.get('limit'), 10)
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 500

  try {
    const sql = getNeonSql()
    // Neon has no default row cap, so a single filtered query with an explicit
    // LIMIT covers this function without a paging loop (a 1,000-row page limit
    // would have required one).
    const rows = await sql`
      SELECT * FROM transactions
      WHERE user_id = ${userId}
        AND (${from}::date IS NULL OR date >= ${from}::date)
        AND (${to}::date IS NULL OR date <= ${to}::date)
        AND (${category}::text IS NULL OR category = ${category})
      ORDER BY date DESC
      LIMIT ${limit}
    `
    return Response.json(rows)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// POST /api/transactions
// Body: { rows: [{ date, merchant, category, group, account, amount,
//   originalStatement, notes, owner, importSource }, ...] }
// Mirrors src/lib/db/transactions.js#importTransactions: bulk insert with
// dedup via the (user_id, dedup_key) unique constraint. Uses
// INSERT ... ON CONFLICT DO NOTHING (rather than the original
// count-before/count-after) since RETURNING gives an exact inserted count
// directly. Batches of 500 via jsonb_to_recordset to match the source
// file's batching and avoid oversized statements.
export async function POST(request) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  const rows = body?.rows
  if (!Array.isArray(rows) || rows.length === 0) {
    return Response.json({ error: 'Field "rows" must be a non-empty array.' }, { status: 400 })
  }

  for (const [i, r] of rows.entries()) {
    if (!r?.date || !r?.merchant || typeof r.amount !== 'number') {
      return Response.json(
        { error: `Row ${i} is missing required fields "date", "merchant", or "amount".` },
        { status: 400 }
      )
    }
  }

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

  const BATCH = 500
  let inserted = 0

  try {
    const sql = getNeonSql()
    for (let i = 0; i < prepared.length; i += BATCH) {
      const batch = prepared.slice(i, i + BATCH)
      const result = await sql`
        INSERT INTO transactions
          (user_id, date, merchant, category, "group", account, amount,
           original_statement, notes, owner, import_source, dedup_key)
        SELECT
          user_id, date, merchant, category, "group", account, amount,
          original_statement, notes, owner, import_source, dedup_key
        FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS t(
          user_id uuid, date date, merchant text, category text, "group" text,
          account text, amount numeric, original_statement text, notes text,
          owner text, import_source text, dedup_key text
        )
        ON CONFLICT (user_id, dedup_key) DO NOTHING
        RETURNING id
      `
      inserted += result.length
    }
    const skipped = prepared.length - inserted
    return Response.json({ inserted, skipped }, { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

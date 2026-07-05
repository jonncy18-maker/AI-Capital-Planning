import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { auth } from '../../../../src/lib/neon/authServer.js'

// Mirrors src/lib/db/creditCards.js#getDistinctTransactionAccounts. The
// source pages through all rows (1000 at a time) to work around Supabase's
// default row cap, then reduces to counts in JS. Neon has no such cap, so
// this does the grouping/sorting directly in SQL instead.
export async function GET() {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  try {
    const sql = getNeonSql()
    const rows = await sql`
      SELECT account, COUNT(*) AS txn_count
      FROM transactions
      WHERE user_id = ${userId} AND account IS NOT NULL
      GROUP BY account
      ORDER BY txn_count DESC
    `
    const result = rows.map((r) => ({ account: r.account, txn_count: Number(r.txn_count) }))
    return Response.json(result)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

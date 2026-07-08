import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { auth } from '../../../../src/lib/neon/authServer.js'

// GET /api/transactions/recent?days=
// Mirrors src/lib/db/transactions.js#getRecentTransactions: summary-level
// columns for AI context, defaults to a trailing year (365 days), newest
// first. Neon has no default row cap, so no paging loop is needed here
// (the original version paged in chunks of 1,000 to work around that cap).
export async function GET(request) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const daysParam = Number.parseInt(searchParams.get('days'), 10)
  const days = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 365

  try {
    const sql = getNeonSql()
    const rows = await sql`
      SELECT date, merchant, category, "group", amount, account
      FROM transactions
      WHERE user_id = ${userId}
        AND date >= (CURRENT_DATE - (${days}::int || ' days')::interval)
      ORDER BY date DESC
    `
    return Response.json(rows)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { auth } from '../../../../src/lib/neon/authServer.js'

// GET /api/transactions/analysis?months=
// Mirrors src/lib/db/transactions.js#getTransactionsForAnalysis: wide window
// for budget pattern analysis, oldest first, defaults to 24 months.
export async function GET(request) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const monthsParam = Number.parseInt(searchParams.get('months'), 10)
  const months = Number.isFinite(monthsParam) && monthsParam > 0 ? monthsParam : 24

  try {
    const sql = getNeonSql()
    const rows = await sql`
      SELECT date, amount, category, "group"
      FROM transactions
      WHERE user_id = ${userId}
        AND date >= (CURRENT_DATE - (${months}::int || ' months')::interval)
      ORDER BY date ASC
    `
    return Response.json(rows)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

import { getNeonSql } from '../../../../../src/lib/neon/client.js'
import { auth } from '../../../../../src/lib/neon/authServer.js'

// GET /api/transactions/year/:year
// Mirrors src/lib/db/transactions.js#getTransactionsForYear: full-calendar-
// year expense actuals (amount < 0 only) for forecast actuals, oldest first.
export async function GET(request, context) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { year } = await context.params
  const yearNum = Number.parseInt(year, 10)
  if (!Number.isFinite(yearNum)) {
    return Response.json({ error: 'Path param "year" must be a number.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()
    const rows = await sql`
      SELECT date, amount, category, "group"
      FROM transactions
      WHERE user_id = ${userId}
        AND date >= ${`${yearNum}-01-01`}::date
        AND date <= ${`${yearNum}-12-31`}::date
        AND amount < 0
      ORDER BY date ASC
    `
    return Response.json(rows)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { auth } from '../../../../src/lib/neon/authServer.js'

// GET /api/transactions/by-month?from=&to=
// Mirrors src/lib/db/transactions.js#getTransactionsByMonth: date-range
// fetch for cash flow calendar aggregation, oldest first. Both bounds are
// required (the source function's fromDate/toDate are required params).
export async function GET(request) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  if (!from || !to) {
    return Response.json({ error: 'Query params "from" and "to" are required.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()
    const rows = await sql`
      SELECT date, amount, "group", category, merchant
      FROM transactions
      WHERE user_id = ${userId}
        AND date >= ${from}::date
        AND date <= ${to}::date
      ORDER BY date ASC
    `
    return Response.json(rows)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

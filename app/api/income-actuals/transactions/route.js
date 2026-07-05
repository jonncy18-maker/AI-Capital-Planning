import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { auth } from '../../../../src/lib/neon/authServer.js'

// GET /api/income-actuals/transactions?startDate=&endDate=
// Mirrors src/lib/db/income.js#getIncomeTransactions: positive (income)
// transactions in a date range, for the "pull actual income from transaction
// history" action. Kept as its own route (rather than a query-param branch
// on the parent income-actuals route) since it queries a different table
// (transactions, not income_actuals) and has a distinct response shape.
// Neon has no default row cap (unlike Supabase's 1,000-row page limit), so
// the source file's manual paging loop is unnecessary here — same reasoning
// already applied in the Wave 1 transactions/recent route.
export async function GET(request) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  if (!startDate || !endDate) {
    return Response.json(
      { error: 'Query params "startDate" and "endDate" are required.' },
      { status: 400 }
    )
  }

  try {
    const sql = getNeonSql()
    const rows = await sql`
      SELECT date, amount, category FROM transactions
      WHERE user_id = ${userId}
        AND amount > 0
        AND date >= ${startDate}::date
        AND date <= ${endDate}::date
    `
    return Response.json(rows)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

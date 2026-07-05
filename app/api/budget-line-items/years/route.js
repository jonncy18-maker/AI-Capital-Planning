import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { auth } from '../../../../src/lib/neon/authServer.js'

// GET /api/budget-line-items/years
// Mirrors src/lib/db/budgetLineItems.js#getBudgetYears: distinct sorted list
// of budget_year values for the user. Neon has no default row cap (unlike
// Supabase's 1,000-row page limit), so a single DISTINCT query covers this
// without the source's manual paging loop.
export async function GET() {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  try {
    const sql = getNeonSql()
    const rows = await sql`
      SELECT DISTINCT budget_year
      FROM budget_line_items
      WHERE user_id = ${userId}
      ORDER BY budget_year ASC
    `
    return Response.json(rows.map(r => r.budget_year))
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { auth } from '../../../../src/lib/neon/authServer.js'

// GET /api/transactions/by-category?categories=a,b,c&startYear=&endYear=
// Mirrors src/lib/db/transactions.js#getExpenseActualsByCategories: outflow
// (amount < 0) transactions for the given category names across a year
// range, used to compute per-month actuals for bills linked to an expense
// category. Returns [] if "categories" is missing/empty, same as the source
// function's early-return guard.
export async function GET(request) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const categoriesParam = searchParams.get('categories')
  const categories = categoriesParam
    ? categoriesParam.split(',').map(c => c.trim()).filter(Boolean)
    : []

  if (categories.length === 0) {
    return Response.json([])
  }

  const startYear = searchParams.get('startYear')
  const endYear = searchParams.get('endYear')
  if (!startYear || !endYear) {
    return Response.json(
      { error: 'Query params "startYear" and "endYear" are required.' },
      { status: 400 }
    )
  }

  try {
    const sql = getNeonSql()
    const rows = await sql`
      SELECT date, category, amount
      FROM transactions
      WHERE user_id = ${userId}
        AND category = ANY(${categories})
        AND amount < 0
        AND date >= ${`${startYear}-01-01`}::date
        AND date <= ${`${endYear}-12-31`}::date
    `
    return Response.json(rows)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

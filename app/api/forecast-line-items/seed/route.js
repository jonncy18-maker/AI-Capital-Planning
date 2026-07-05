import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { auth } from '../../../../src/lib/neon/authServer.js'

function shapeForecastLineItem(row) {
  const { cat_id, cat_category, cat_group, cat_type, ...rest } = row
  return {
    ...rest,
    budget_categories:
      cat_id != null
        ? { id: cat_id, category: cat_category, group: cat_group, type: cat_type }
        : null,
  }
}

// POST /api/forecast-line-items/seed
// Body: { year }
// Mirrors src/lib/db/forecastLineItems.js#seedForecastFromBudget: copies
// budget_line_items for the year into forecast_line_items (source='seed',
// note=null). The source reads via getBudgetLineItems(userId, { year }),
// which does NOT filter by budget_version — this route matches that by
// selecting from budget_line_items across all versions for the year.
// Queries budget_line_items directly (INSERT ... SELECT) rather than doing
// an internal HTTP round-trip to /api/budget-line-items, per the task's
// guidance. category_id is NOT NULL on budget_line_items, so the source's
// `.filter(li => li.category_id)` is enforced by the schema already; the
// WHERE clause below still states it explicitly for clarity/defense.
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

  const { year } = body || {}
  if (!Number.isInteger(year)) {
    return Response.json({ error: 'Field "year" must be an integer.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()

    const inserted = await sql`
      INSERT INTO forecast_line_items
        (user_id, budget_year, category_id, month, amount, label, note, source)
      SELECT
        bli.user_id,
        bli.budget_year,
        bli.category_id,
        COALESCE(bli.month, 1),
        COALESCE(bli.amount, 0),
        bli.label,
        NULL,
        'seed'
      FROM budget_line_items bli
      WHERE bli.user_id = ${userId}
        AND bli.budget_year = ${year}
        AND bli.category_id IS NOT NULL
      RETURNING id
    `

    if (inserted.length === 0) {
      return Response.json([])
    }

    const ids = inserted.map(r => r.id)
    const rows = await sql`
      SELECT
        fli.*,
        bc.id AS cat_id,
        bc.category AS cat_category,
        bc."group" AS cat_group,
        bc.type AS cat_type
      FROM forecast_line_items fli
      LEFT JOIN budget_categories bc ON bc.id = fli.category_id
      WHERE fli.id = ANY(${ids})
      ORDER BY fli.month ASC
    `
    return Response.json(rows.map(shapeForecastLineItem))
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

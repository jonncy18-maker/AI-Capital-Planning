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

// POST /api/forecast-line-items/reset
// Body: { year }
// Mirrors src/lib/db/forecastLineItems.js#resetForecastToBudget: wipes the
// year's forecast and re-seeds it from budget_line_items. The delete and the
// reseed run atomically inside a single @neondatabase/serverless
// sql.transaction — a crash mid-operation must not leave the year's forecast
// deleted with nothing re-seeded. The reseed is expressed as a single
// INSERT ... SELECT (no intermediate JS rows array needed), so it can sit in
// the same transaction array as the DELETE, per the source's
// delete-then-reseed sequencing.
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

    const [, inserted] = await sql.transaction([
      sql`
        DELETE FROM forecast_line_items
        WHERE user_id = ${userId} AND budget_year = ${year}
      `,
      sql`
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
      `,
    ])

    if (!inserted || inserted.length === 0) {
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

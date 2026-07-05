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

// POST /api/forecast-line-items/set-rate
// Body: { year, categoryId, label, rate, fromMonth }
// Mirrors src/lib/db/forecastLineItems.js#setForecastRate: replaces all
// forecast lines for user+year+category+label in months >= fromMonth with a
// flat monthly rate. Delete-then-insert must be atomic when rate > 0 (a
// crash mid-operation must not leave the range half-deleted with no
// replacement rows), so both statements run inside a single
// sql.transaction via jsonb_to_recordset, matching the pattern used in
// app/api/budget-line-items/route.js. If rate <= 0, only the delete runs —
// matches the source's early return.
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

  const { year, categoryId, label = null, rate, fromMonth } = body || {}

  if (!Number.isInteger(year)) {
    return Response.json({ error: 'Field "year" must be an integer.' }, { status: 400 })
  }
  if (!categoryId || typeof categoryId !== 'string') {
    return Response.json({ error: 'Field "categoryId" is required.' }, { status: 400 })
  }
  if (typeof rate !== 'number' || Number.isNaN(rate)) {
    return Response.json({ error: 'Field "rate" must be a number.' }, { status: 400 })
  }
  if (!Number.isInteger(fromMonth) || fromMonth < 1 || fromMonth > 12) {
    return Response.json({ error: 'Field "fromMonth" must be an integer between 1 and 12.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()

    if (rate <= 0) {
      await (label != null
        ? sql`
            DELETE FROM forecast_line_items
            WHERE user_id = ${userId}
              AND budget_year = ${year}
              AND category_id = ${categoryId}
              AND label = ${label}
              AND month >= ${fromMonth}
          `
        : sql`
            DELETE FROM forecast_line_items
            WHERE user_id = ${userId}
              AND budget_year = ${year}
              AND category_id = ${categoryId}
              AND label IS NULL
              AND month >= ${fromMonth}
          `)
      return Response.json([])
    }

    const rows = []
    for (let m = fromMonth; m <= 12; m++) {
      rows.push({
        user_id: userId,
        budget_year: year,
        category_id: categoryId,
        month: m,
        amount: rate,
        label: label ?? null,
        note: null,
        source: 'manual',
      })
    }

    const [, inserted] =
      label != null
        ? await sql.transaction([
            sql`
              DELETE FROM forecast_line_items
              WHERE user_id = ${userId}
                AND budget_year = ${year}
                AND category_id = ${categoryId}
                AND label = ${label}
                AND month >= ${fromMonth}
            `,
            sql`
              INSERT INTO forecast_line_items
                (user_id, budget_year, category_id, month, amount, label, note, source)
              SELECT
                user_id, budget_year, category_id, month, amount, label, note, source
              FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS t(
                user_id uuid, budget_year int, category_id uuid, month int,
                amount numeric, label text, note text, source text
              )
              RETURNING id
            `,
          ])
        : await sql.transaction([
            sql`
              DELETE FROM forecast_line_items
              WHERE user_id = ${userId}
                AND budget_year = ${year}
                AND category_id = ${categoryId}
                AND label IS NULL
                AND month >= ${fromMonth}
            `,
            sql`
              INSERT INTO forecast_line_items
                (user_id, budget_year, category_id, month, amount, label, note, source)
              SELECT
                user_id, budget_year, category_id, month, amount, label, note, source
              FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS t(
                user_id uuid, budget_year int, category_id uuid, month int,
                amount numeric, label text, note text, source text
              )
              RETURNING id
            `,
          ])

    const ids = inserted.map(r => r.id)
    const full = await sql`
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
    return Response.json(full.map(shapeForecastLineItem))
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

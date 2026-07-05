import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { auth } from '../../../../src/lib/neon/authServer.js'

// DELETE /api/forecast-line-items/by-label?year=&categoryId=&label=
// Mirrors src/lib/db/forecastLineItems.js#deleteForecastItemsByLabel:
// deletes all forecast lines (all months) for a given user+year+category+
// label. Uses query params (this is a bulk filter delete, not a single
// resource by id, so it doesn't fit the [id]/route.js pattern). `label` is
// optional — omitting it targets rows where label IS NULL, matching the
// source's `label != null ? .eq('label', label) : .is('label', null)`.
export async function DELETE(request) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const yearParam = searchParams.get('year')
  const year = yearParam ? Number.parseInt(yearParam, 10) : null
  const categoryId = searchParams.get('categoryId')
  const label = searchParams.has('label') ? searchParams.get('label') : null

  if (!Number.isInteger(year)) {
    return Response.json({ error: 'Query param "year" is required and must be an integer.' }, { status: 400 })
  }
  if (!categoryId) {
    return Response.json({ error: 'Query param "categoryId" is required.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()
    const rows =
      label != null
        ? await sql`
            DELETE FROM forecast_line_items
            WHERE user_id = ${userId}
              AND budget_year = ${year}
              AND category_id = ${categoryId}
              AND label = ${label}
            RETURNING id
          `
        : await sql`
            DELETE FROM forecast_line_items
            WHERE user_id = ${userId}
              AND budget_year = ${year}
              AND category_id = ${categoryId}
              AND label IS NULL
            RETURNING id
          `
    return Response.json({ success: true, count: rows.length })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

import { getNeonSql } from '../../../src/lib/neon/client.js'
import { auth } from '../../../src/lib/neon/authServer.js'

// Reshapes the flat join result back into the nested shape
// src/lib/db/forecastLineItems.js's functions return via Supabase's
// `*, budget_categories(id, category, "group", type)` embedded select.
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

// GET /api/forecast-line-items?year=
//   -> mirrors src/lib/db/forecastLineItems.js#getForecastLineItems
// GET /api/forecast-line-items?year=&hasForecast=true
//   -> mirrors src/lib/db/forecastLineItems.js#hasForecastForYear, returns
//      { hasForecast: boolean } instead of the row list (disambiguated by
//      the hasForecast query param since both need `year` and hit the same
//      table, keeping this a single GET handler rather than a second route).
export async function GET(request) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const yearParam = searchParams.get('year')
  const year = yearParam ? Number.parseInt(yearParam, 10) : null

  if (!Number.isInteger(year)) {
    return Response.json({ error: 'Query param "year" is required and must be an integer.' }, { status: 400 })
  }

  const wantsHasForecast = searchParams.get('hasForecast') === 'true'

  try {
    const sql = getNeonSql()

    if (wantsHasForecast) {
      const rows = await sql`
        SELECT 1 FROM forecast_line_items
        WHERE user_id = ${userId} AND budget_year = ${year}
        LIMIT 1
      `
      return Response.json({ hasForecast: rows.length > 0 })
    }

    const rows = await sql`
      SELECT
        fli.*,
        bc.id AS cat_id,
        bc.category AS cat_category,
        bc."group" AS cat_group,
        bc.type AS cat_type
      FROM forecast_line_items fli
      LEFT JOIN budget_categories bc ON bc.id = fli.category_id
      WHERE fli.user_id = ${userId} AND fli.budget_year = ${year}
      ORDER BY fli.month ASC
    `
    return Response.json(rows.map(shapeForecastLineItem))
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// POST /api/forecast-line-items
// Body: { year, categoryId, month, amount, label, note }
// Mirrors src/lib/db/forecastLineItems.js#insertForecastLineItem (single
// insert, source='manual').
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

  const { year, categoryId, month, amount, label = null, note = null } = body || {}

  if (!Number.isInteger(year)) {
    return Response.json({ error: 'Field "year" must be an integer.' }, { status: 400 })
  }
  if (!categoryId || typeof categoryId !== 'string') {
    return Response.json({ error: 'Field "categoryId" is required.' }, { status: 400 })
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return Response.json({ error: 'Field "month" must be an integer between 1 and 12.' }, { status: 400 })
  }
  if (typeof amount !== 'number' || Number.isNaN(amount)) {
    return Response.json({ error: 'Field "amount" must be a number.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()
    const [inserted] = await sql`
      INSERT INTO forecast_line_items
        (user_id, budget_year, category_id, month, amount, label, note, source)
      VALUES
        (${userId}, ${year}, ${categoryId}, ${month}, ${amount}, ${label}, ${note}, 'manual')
      RETURNING id
    `

    const [row] = await sql`
      SELECT
        fli.*,
        bc.id AS cat_id,
        bc.category AS cat_category,
        bc."group" AS cat_group,
        bc.type AS cat_type
      FROM forecast_line_items fli
      LEFT JOIN budget_categories bc ON bc.id = fli.category_id
      WHERE fli.id = ${inserted.id}
    `
    return Response.json(shapeForecastLineItem(row), { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

import { getNeonSql } from '../../../src/lib/neon/client.js'
import { auth } from '../../../src/lib/neon/authServer.js'

// Reshapes the flat join result back into the nested shape
// src/lib/db/forecastOverrides.js#getForecastOverrides returns via
// the original `*, budget_categories(id, category, "group", type)` embedded
// select. Same pattern as app/api/budget-line-items/route.js#shapeLineItem.
function shapeOverride(row) {
  const { cat_id, cat_category, cat_group, cat_type, ...rest } = row
  return {
    ...rest,
    budget_categories:
      cat_id != null
        ? { id: cat_id, category: cat_category, group: cat_group, type: cat_type }
        : null,
  }
}

// GET /api/forecast-overrides?year=
// Mirrors src/lib/db/forecastOverrides.js#getForecastOverrides.
export async function GET(request) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const yearParam = searchParams.get('year')
  const year = yearParam ? Number.parseInt(yearParam, 10) : null

  if (!Number.isFinite(year)) {
    return Response.json({ error: 'Query param "year" is required and must be an integer.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()
    const rows = await sql`
      SELECT
        fo.*,
        bc.id AS cat_id,
        bc.category AS cat_category,
        bc."group" AS cat_group,
        bc.type AS cat_type
      FROM forecast_overrides fo
      LEFT JOIN budget_categories bc ON bc.id = fo.category_id
      WHERE fo.user_id = ${userId} AND fo.budget_year = ${year}
    `
    return Response.json(rows.map(shapeOverride))
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// POST /api/forecast-overrides
// Body: { categoryId, year, month, amount, note }
// Mirrors src/lib/db/forecastOverrides.js#upsertForecastOverride: upsert on
// the (user_id, category_id, budget_year, month) unique constraint (added to
// Neon via db/migrations/018_neon_forecast_overrides_unique_constraint.sql,
// since it was missing from the original Neon schema recovery). Unlike the
// source's fire-and-forget upsert, this route returns the resulting row.
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

  const { categoryId, year, month, amount, note = null } = body || {}

  if (!categoryId || typeof categoryId !== 'string') {
    return Response.json({ error: 'Field "categoryId" is required.' }, { status: 400 })
  }
  if (!Number.isInteger(year)) {
    return Response.json({ error: 'Field "year" must be an integer.' }, { status: 400 })
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return Response.json({ error: 'Field "month" must be an integer between 1 and 12.' }, { status: 400 })
  }
  if (typeof amount !== 'number' || Number.isNaN(amount)) {
    return Response.json({ error: 'Field "amount" must be a number.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()
    const [row] = await sql`
      INSERT INTO forecast_overrides
        (user_id, category_id, budget_year, month, amount, note, updated_at)
      VALUES
        (${userId}, ${categoryId}, ${year}, ${month}, ${amount}, ${note}, now())
      ON CONFLICT (user_id, category_id, budget_year, month) DO UPDATE
        SET amount = EXCLUDED.amount, note = EXCLUDED.note, updated_at = now()
      RETURNING *
    `
    return Response.json(row)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// DELETE /api/forecast-overrides?categoryId=&year=&month=
// Mirrors src/lib/db/forecastOverrides.js#deleteForecastOverride. This is a
// compound-key delete (no single "id" identifies a row from the client's
// perspective — callers address rows by categoryId/year/month), so query
// params are used rather than a nested /[id] route, same judgment call as
// app/api/income-actuals/route.js#DELETE.
export async function DELETE(request) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const categoryId = searchParams.get('categoryId')
  const year = Number.parseInt(searchParams.get('year'), 10)
  const month = Number.parseInt(searchParams.get('month'), 10)

  if (!categoryId || typeof categoryId !== 'string') {
    return Response.json({ error: 'Query param "categoryId" is required.' }, { status: 400 })
  }
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return Response.json(
      { error: 'Query params "year" and "month" are required and must be integers.' },
      { status: 400 }
    )
  }

  try {
    const sql = getNeonSql()
    await sql`
      DELETE FROM forecast_overrides
      WHERE user_id = ${userId} AND category_id = ${categoryId} AND budget_year = ${year} AND month = ${month}
    `
    return Response.json({ success: true })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

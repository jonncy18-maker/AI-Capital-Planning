import { getNeonSql } from '../../../src/lib/neon/client.js'
import { auth } from '../../../src/lib/neon/authServer.js'

// GET /api/income-actuals?startYear=&endYear=
// Mirrors src/lib/db/income.js#getIncomeActualsRange.
export async function GET(request) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const startYear = Number.parseInt(searchParams.get('startYear'), 10)
  const endYear = Number.parseInt(searchParams.get('endYear'), 10)

  if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) {
    return Response.json(
      { error: 'Query params "startYear" and "endYear" are required and must be integers.' },
      { status: 400 }
    )
  }

  try {
    const sql = getNeonSql()
    const rows = await sql`
      SELECT * FROM income_actuals
      WHERE user_id = ${userId} AND year >= ${startYear} AND year <= ${endYear}
    `
    return Response.json(rows)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// POST /api/income-actuals
// Body: { year, month, amount, source }
// Mirrors src/lib/db/income.js#upsertIncomeActual: upsert on the
// (user_id, year, month) unique constraint, returns the resulting row.
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

  const { year, month, amount, source = 'manual' } = body || {}

  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return Response.json(
      { error: 'Fields "year" and "month" are required and must be integers.' },
      { status: 400 }
    )
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return Response.json({ error: 'Field "amount" is required and must be a number.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()
    const [row] = await sql`
      INSERT INTO income_actuals (user_id, year, month, amount, source)
      VALUES (${userId}, ${year}, ${month}, ${amount}, ${source})
      ON CONFLICT (user_id, year, month) DO UPDATE
        SET amount = EXCLUDED.amount, source = EXCLUDED.source
      RETURNING *
    `
    return Response.json(row)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// DELETE /api/income-actuals?year=&month=
// Mirrors src/lib/db/income.js#deleteIncomeActual. This is a compound-key
// delete (no single "id" identifies a row from the client's perspective —
// callers address rows by (year, month)), so query params are used rather
// than a nested /[id] route, consistent with how this route already
// addresses records by year/month everywhere else.
export async function DELETE(request) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const year = Number.parseInt(searchParams.get('year'), 10)
  const month = Number.parseInt(searchParams.get('month'), 10)

  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return Response.json(
      { error: 'Query params "year" and "month" are required and must be integers.' },
      { status: 400 }
    )
  }

  try {
    const sql = getNeonSql()
    await sql`
      DELETE FROM income_actuals
      WHERE user_id = ${userId} AND year = ${year} AND month = ${month}
    `
    return Response.json({ success: true })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

import { getNeonSql } from '../../../src/lib/neon/client.js'
import { auth } from '../../../src/lib/neon/authServer.js'

const ALLOWED_STATUSES = ['draft', 'finalized']

// Mirrors src/lib/db/budgetStatus.js: a missing row means the budget has
// never been finalized — i.e. it's a freely editable draft.
const DEFAULT_STATUS = { status: 'draft', finalized_at: null }

export async function GET(request) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const year = searchParams.get('year')
  const version = searchParams.has('version') ? searchParams.get('version') : 'v1'

  if (!year) {
    return Response.json({ error: 'Query param "year" is required.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()
    // WHERE user_id = ${userId} is the authorization boundary: a user can
    // only ever read their own budget status rows.
    const [row] = await sql`
      SELECT status, finalized_at
      FROM budget_status
      WHERE user_id = ${userId} AND budget_year = ${year} AND budget_version = ${version}
    `
    // Unlike src/lib/db/budgetStatus.js#getBudgetStatus (which swallows all
    // errors into the draft default), we only default on a genuinely missing
    // row — a real DB error below still surfaces as a 500.
    if (!row) {
      return Response.json({ ...DEFAULT_STATUS })
    }
    return Response.json({
      status: row.status ?? 'draft',
      finalized_at: row.finalized_at ?? null,
    })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function PUT(request) {
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

  const { year, version = 'v1', status } = body || {}

  if (!year) {
    return Response.json({ error: 'Field "year" is required.' }, { status: 400 })
  }
  if (!status || !ALLOWED_STATUSES.includes(status)) {
    return Response.json(
      { error: `Field "status" must be one of: ${ALLOWED_STATUSES.join(', ')}.` },
      { status: 400 }
    )
  }

  try {
    const sql = getNeonSql()
    // finalized_at is derived server-side from status, exactly as
    // src/lib/db/budgetStatus.js#setBudgetStatus does — set to the current
    // timestamp only when finalizing, cleared otherwise.
    const finalizedAt = status === 'finalized' ? new Date().toISOString() : null
    const [row] = await sql`
      INSERT INTO budget_status (user_id, budget_year, budget_version, status, finalized_at, updated_at)
      VALUES (
        ${userId}, ${year}, ${version}, ${status}, ${finalizedAt}, now()
      )
      ON CONFLICT (user_id, budget_year, budget_version) DO UPDATE SET
        status = EXCLUDED.status,
        finalized_at = EXCLUDED.finalized_at,
        updated_at = now()
      RETURNING status, finalized_at
    `
    return Response.json({
      status: row.status,
      finalized_at: row.finalized_at ?? null,
    })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

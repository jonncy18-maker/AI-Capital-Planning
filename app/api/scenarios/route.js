import { getNeonSql } from '../../../src/lib/neon/client.js'
import { auth } from '../../../src/lib/neon/authServer.js'

const ALLOWED_STATES = ['modeled', 'committed', 'idea']
const ALLOWED_KINDS = ['expense', 'income']

export async function GET(request) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  try {
    const sql = getNeonSql()
    const rows = await sql`
      SELECT * FROM scenarios
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `
    return Response.json(rows)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

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

  const { name, description = '', state = 'modeled', kind = 'expense' } = body || {}

  if (!name || typeof name !== 'string') {
    return Response.json({ error: 'Field "name" is required.' }, { status: 400 })
  }
  if (!ALLOWED_STATES.includes(state)) {
    return Response.json(
      { error: `Field "state" must be one of: ${ALLOWED_STATES.join(', ')}.` },
      { status: 400 }
    )
  }
  if (!ALLOWED_KINDS.includes(kind)) {
    return Response.json(
      { error: `Field "kind" must be one of: ${ALLOWED_KINDS.join(', ')}.` },
      { status: 400 }
    )
  }

  try {
    const sql = getNeonSql()
    let row
    try {
      ;[row] = await sql`
        INSERT INTO scenarios
          (user_id, name, description, state, kind)
        VALUES
          (${userId}, ${name}, ${description}, ${state}, ${kind})
        RETURNING *
      `
    } catch (err) {
      // Backward-compat: if the kind column isn't present yet (migration 021 not
      // applied), never break expense scenario creation — fall back to the
      // pre-migration insert. Income scenarios genuinely require the migration.
      if (kind === 'expense' && /column .*kind.* does not exist/i.test(err.message || '')) {
        ;[row] = await sql`
          INSERT INTO scenarios
            (user_id, name, description, state)
          VALUES
            (${userId}, ${name}, ${description}, ${state})
          RETURNING *
        `
      } else if (kind === 'income' && /column .*kind.* does not exist/i.test(err.message || '')) {
        return Response.json(
          { error: 'Income scenarios require a database migration (021_income_scenarios) that has not been applied yet.' },
          { status: 503 }
        )
      } else {
        throw err
      }
    }
    return Response.json(row, { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

import { getNeonSql } from '../../../src/lib/neon/client.js'
import { auth } from '../../../src/lib/neon/authServer.js'

const ALLOWED_TYPES = ['scholarship', 'family_support', 'lease', 'eldercare', 'other']

export async function GET(request) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  // Mirrors src/lib/db/commitments.js#getCommitments: defaults to 'active',
  // and passing an empty status returns all rows regardless of status.
  const status = searchParams.has('status') ? searchParams.get('status') : 'active'

  try {
    const sql = getNeonSql()
    const rows = status
      ? await sql`
          SELECT * FROM commitments
          WHERE user_id = ${userId} AND status = ${status}
          ORDER BY start_date ASC
        `
      : await sql`
          SELECT * FROM commitments
          WHERE user_id = ${userId}
          ORDER BY start_date ASC
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

  const {
    name,
    type = null,
    start_date,
    end_date = null,
    status = 'active',
    cost_structure = {},
    split_rules = {},
    notes = null,
  } = body || {}

  if (!name || typeof name !== 'string') {
    return Response.json({ error: 'Field "name" is required.' }, { status: 400 })
  }
  if (!start_date) {
    return Response.json({ error: 'Field "start_date" is required.' }, { status: 400 })
  }
  if (type !== null && !ALLOWED_TYPES.includes(type)) {
    return Response.json(
      { error: `Field "type" must be one of: ${ALLOWED_TYPES.join(', ')}.` },
      { status: 400 }
    )
  }

  try {
    const sql = getNeonSql()
    const [row] = await sql`
      INSERT INTO commitments
        (user_id, name, type, start_date, end_date, status, cost_structure, split_rules, notes)
      VALUES
        (${userId}, ${name}, ${type}, ${start_date}, ${end_date}, ${status},
         ${JSON.stringify(cost_structure ?? {})}::jsonb, ${JSON.stringify(split_rules ?? {})}::jsonb, ${notes})
      RETURNING *
    `
    return Response.json(row, { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

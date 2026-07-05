import { getNeonSql } from '../../../src/lib/neon/client.js'
import { auth } from '../../../src/lib/neon/authServer.js'

const ALLOWED_STATES = ['modeled', 'committed', 'idea']

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

  const { name, description = '', state = 'modeled' } = body || {}

  if (!name || typeof name !== 'string') {
    return Response.json({ error: 'Field "name" is required.' }, { status: 400 })
  }
  if (!ALLOWED_STATES.includes(state)) {
    return Response.json(
      { error: `Field "state" must be one of: ${ALLOWED_STATES.join(', ')}.` },
      { status: 400 }
    )
  }

  try {
    const sql = getNeonSql()
    const [row] = await sql`
      INSERT INTO scenarios
        (user_id, name, description, state)
      VALUES
        (${userId}, ${name}, ${description}, ${state})
      RETURNING *
    `
    return Response.json(row, { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

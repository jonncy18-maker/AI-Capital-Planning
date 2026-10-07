import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { getSessionOrToken } from '../../../../src/lib/neon/apiAuth.js'
import {
  validateYear,
  validateGroupName,
  validateEventName,
  validateAmount,
} from '../../../../src/lib/outlook/validation.js'

// GET /api/outlook/events -> every outlook event for the user.
export async function GET(request) {
  const { data: session } = await getSessionOrToken(request)
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  try {
    const sql = getNeonSql()
    const rows = await sql`
      SELECT * FROM outlook_events
      WHERE user_id = ${userId}
      ORDER BY year ASC, created_at ASC
    `
    return Response.json(rows.map(r => ({ ...r, amount: Number(r.amount) })))
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// POST /api/outlook/events { year, group_name, name, amount }
export async function POST(request) {
  const { data: session } = await getSessionOrToken(request)
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

  const year = validateYear(body?.year)
  if (year.error) return Response.json({ error: year.error }, { status: 400 })
  const group = validateGroupName(body?.group_name)
  if (group.error) return Response.json({ error: group.error }, { status: 400 })
  const name = validateEventName(body?.name)
  if (name.error) return Response.json({ error: name.error }, { status: 400 })
  const amount = validateAmount(body?.amount, 'amount')
  if (amount.error) return Response.json({ error: amount.error }, { status: 400 })

  try {
    const sql = getNeonSql()
    const [row] = await sql`
      INSERT INTO outlook_events (user_id, year, group_name, name, amount)
      VALUES (${userId}, ${year.value}, ${group.value}, ${name.value}, ${amount.value})
      RETURNING *
    `
    return Response.json({ ...row, amount: Number(row.amount) }, { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

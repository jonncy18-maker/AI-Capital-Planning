import { getNeonSql } from '../../../../../src/lib/neon/client.js'
import { getSessionOrToken } from '../../../../../src/lib/neon/apiAuth.js'
import {
  isUuid,
  validateYear,
  validateGroupName,
  validateEventName,
  validateAmount,
} from '../../../../../src/lib/outlook/validation.js'

const NOT_FOUND = { error: 'Event not found.' }

// PATCH /api/outlook/events/:id { year?, group_name?, name?, amount? }
export async function PATCH(request, context) {
  const { data: session } = await getSessionOrToken(request)
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id
  const { id } = await context.params
  if (!isUuid(id)) return Response.json(NOT_FOUND, { status: 404 })

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  const fields = { year: null, group_name: null, name: null, amount: null }
  const checks = {
    year: validateYear,
    group_name: validateGroupName,
    name: validateEventName,
    amount: (v) => validateAmount(v, 'amount'),
  }
  for (const key of Object.keys(fields)) {
    if (body?.[key] === undefined) continue
    const r = checks[key](body[key])
    if (r.error) return Response.json({ error: r.error }, { status: 400 })
    fields[key] = r.value
  }
  if (Object.values(fields).every((v) => v === null)) {
    return Response.json({ error: 'No updatable fields provided.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()
    // WHERE user_id is the authorization check: another user's id matches nothing.
    const [row] = await sql`
      UPDATE outlook_events SET
        year = COALESCE(${fields.year}::int, year),
        group_name = COALESCE(${fields.group_name}::text, group_name),
        name = COALESCE(${fields.name}::text, name),
        amount = COALESCE(${fields.amount}::numeric, amount)
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING *
    `
    if (!row) return Response.json(NOT_FOUND, { status: 404 })
    return Response.json({ ...row, amount: Number(row.amount) })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(request, context) {
  const { data: session } = await getSessionOrToken(request)
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id
  const { id } = await context.params
  if (!isUuid(id)) return Response.json(NOT_FOUND, { status: 404 })

  try {
    const sql = getNeonSql()
    const rows = await sql`
      DELETE FROM outlook_events WHERE id = ${id} AND user_id = ${userId} RETURNING id
    `
    if (rows.length === 0) return Response.json(NOT_FOUND, { status: 404 })
    return new Response(null, { status: 204 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

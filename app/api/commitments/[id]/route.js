import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { auth } from '../../../../src/lib/neon/authServer.js'

const ALLOWED_TYPES = ['scholarship', 'family_support', 'lease', 'eldercare', 'other']
const ALLOWED_STATUSES = ['active', 'paused', 'completed']
const UPDATABLE_FIELDS = [
  'name',
  'type',
  'start_date',
  'end_date',
  'status',
  'cost_structure',
  'split_rules',
  'notes',
]

export async function PATCH(request, context) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { id } = await context.params

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  if (body?.type != null && !ALLOWED_TYPES.includes(body.type)) {
    return Response.json(
      { error: `Field "type" must be one of: ${ALLOWED_TYPES.join(', ')}.` },
      { status: 400 }
    )
  }
  if (body?.status != null && !ALLOWED_STATUSES.includes(body.status)) {
    return Response.json(
      { error: `Field "status" must be one of: ${ALLOWED_STATUSES.join(', ')}.` },
      { status: 400 }
    )
  }

  const updates = {}
  for (const field of UPDATABLE_FIELDS) {
    if (body && Object.prototype.hasOwnProperty.call(body, field)) {
      updates[field] = body[field]
    }
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'No updatable fields provided.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()
    // WHERE user_id = ${userId} on both queries is the authorization check:
    // it guarantees a user can never read or update a row they don't own,
    // even by guessing an id. Fetch-then-merge (rather than a partial
    // UPDATE ... COALESCE) so fields explicitly set to null (e.g. clearing
    // end_date or notes) are honored, not skipped.
    const [existing] = await sql`
      SELECT * FROM commitments WHERE id = ${id} AND user_id = ${userId}
    `
    if (!existing) {
      return Response.json({ error: 'Commitment not found.' }, { status: 404 })
    }

    const merged = { ...existing, ...updates }

    const [row] = await sql`
      UPDATE commitments
      SET
        name = ${merged.name},
        type = ${merged.type},
        start_date = ${merged.start_date},
        end_date = ${merged.end_date},
        status = ${merged.status},
        cost_structure = ${JSON.stringify(merged.cost_structure ?? {})}::jsonb,
        split_rules = ${JSON.stringify(merged.split_rules ?? {})}::jsonb,
        notes = ${merged.notes}
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING *
    `

    if (!row) {
      return Response.json({ error: 'Commitment not found.' }, { status: 404 })
    }
    return Response.json(row)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(request, context) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { id } = await context.params

  try {
    const sql = getNeonSql()
    // The original schema had budget_line_items.commitment_id ON DELETE SET
    // NULL, dropped to NO ACTION during the Neon schema recreation. A plain
    // DELETE here would foreign-key-violate the moment a budget line item
    // still references this commitment.
    const [, rows] = await sql.transaction([
      sql`UPDATE budget_line_items SET commitment_id = NULL WHERE commitment_id = ${id} AND user_id = ${userId}`,
      sql`DELETE FROM commitments WHERE id = ${id} AND user_id = ${userId} RETURNING id`,
    ])

    if (rows.length === 0) {
      return Response.json({ error: 'Commitment not found.' }, { status: 404 })
    }
    return new Response(null, { status: 204 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { auth } from '../../../../src/lib/neon/authServer.js'

const ALLOWED_STATES = ['modeled', 'committed', 'idea']
const UPDATABLE_FIELDS = ['name', 'description', 'state']

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

  if (body?.state != null && !ALLOWED_STATES.includes(body.state)) {
    return Response.json(
      { error: `Field "state" must be one of: ${ALLOWED_STATES.join(', ')}.` },
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
    // even by guessing an id.
    const [existing] = await sql`
      SELECT * FROM scenarios WHERE id = ${id} AND user_id = ${userId}
    `
    if (!existing) {
      return Response.json({ error: 'Scenario not found.' }, { status: 404 })
    }

    const merged = { ...existing, ...updates }

    // Mirrors src/lib/db/scenarios.js#promoteToCommitted / #promoteToModeled:
    // committed_at is derived from the target state, not settable directly.
    let committedAt = existing.committed_at
    if (Object.prototype.hasOwnProperty.call(updates, 'state')) {
      committedAt = merged.state === 'committed' ? new Date().toISOString() : null
    }

    const [row] = await sql`
      UPDATE scenarios
      SET
        name = ${merged.name},
        description = ${merged.description},
        state = ${merged.state},
        committed_at = ${committedAt}
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING *
    `

    if (!row) {
      return Response.json({ error: 'Scenario not found.' }, { status: 404 })
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
    // WHERE user_id = ${userId} is the authorization check: it guarantees a
    // user can never delete a row they don't own, even by guessing an id.
    const rows = await sql`
      DELETE FROM scenarios
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id
    `

    if (rows.length === 0) {
      return Response.json({ error: 'Scenario not found.' }, { status: 404 })
    }
    return new Response(null, { status: 204 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

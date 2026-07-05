import { getNeonSql } from '../../../src/lib/neon/client.js'
import { auth } from '../../../src/lib/neon/authServer.js'

const ALLOWED_TYPES = ['checking', 'savings', 'investment', 'other']

// Mirrors src/lib/db/bills.js#getAccounts.
export async function GET() {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  try {
    const sql = getNeonSql()
    const rows = await sql`
      SELECT * FROM accounts
      WHERE user_id = ${userId} AND active = true
      ORDER BY display_order ASC
    `
    return Response.json(rows)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// Upsert endpoint mirroring src/lib/db/bills.js#upsertAccount.
// - If body.id is provided, updates that row (scoped to the caller's user_id).
// - Otherwise inserts a new row (accounts.id defaults to gen_random_uuid()).
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
    id = null,
    name,
    type,
    is_primary_checking = false,
    display_order = 0,
    active = true,
  } = body || {}

  if (type !== undefined && type !== null && !ALLOWED_TYPES.includes(type)) {
    return Response.json(
      { error: `Field "type" must be one of: ${ALLOWED_TYPES.join(', ')}.` },
      { status: 400 }
    )
  }

  try {
    const sql = getNeonSql()

    let existing = null
    if (id) {
      // WHERE user_id = ${userId} is the authorization boundary: a user can
      // never touch a row they don't own, even by guessing an id.
      ;[existing] = await sql`
        SELECT * FROM accounts WHERE id = ${id} AND user_id = ${userId}
      `
      if (!existing) {
        return Response.json({ error: 'Account not found.' }, { status: 404 })
      }
    } else {
      if (!name || typeof name !== 'string') {
        return Response.json({ error: 'Field "name" is required.' }, { status: 400 })
      }
      if (!type) {
        return Response.json({ error: 'Field "type" is required.' }, { status: 400 })
      }
    }

    if (existing) {
      const merged = {
        name: name ?? existing.name,
        type: type ?? existing.type,
        is_primary_checking:
          is_primary_checking !== undefined ? !!is_primary_checking : existing.is_primary_checking,
        display_order: display_order ?? existing.display_order,
        active: active !== undefined ? !!active : existing.active,
      }

      const [row] = await sql`
        UPDATE accounts
        SET
          name = ${merged.name},
          type = ${merged.type},
          is_primary_checking = ${merged.is_primary_checking},
          display_order = ${merged.display_order},
          active = ${merged.active}
        WHERE id = ${existing.id} AND user_id = ${userId}
        RETURNING *
      `
      return Response.json(row)
    }

    const [row] = await sql`
      INSERT INTO accounts
        (user_id, name, type, is_primary_checking, display_order, active)
      VALUES
        (${userId}, ${name}, ${type}, ${!!is_primary_checking}, ${display_order}, ${active !== undefined ? !!active : true})
      RETURNING *
    `
    return Response.json(row, { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

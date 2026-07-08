import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { auth } from '../../../../src/lib/neon/authServer.js'

const ALLOWED_TYPES = ['Fixed', 'Flexible', 'Non-Monthly']

// Mirrors src/lib/db/budgetCategories.js#importCategoryMappings: bulk upsert
// category -> { group, type, monthlyTarget } mappings, e.g. from a
// budget/mapping CSV. Authoritative: seeds the user's own buckets so
// subsequent imports map cleanly. Rows without a category or group are
// skipped, matching the source's filter.
//
// There is no unique constraint on (user_id, category) in the Neon schema
// (unlike the original onConflict: 'user_id,category' upsert), so each row is
// applied as a sequential fetch-then-insert-or-update rather than a single
// INSERT ... ON CONFLICT statement (judgment call — see report).
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

  const rows = Array.isArray(body?.rows) ? body.rows : null
  if (!rows) {
    return Response.json({ error: 'Field "rows" must be an array.' }, { status: 400 })
  }

  const payload = rows.filter(r => r && r.category && r.group)

  for (const r of payload) {
    if (r.type != null && !ALLOWED_TYPES.includes(r.type)) {
      return Response.json(
        { error: `Field "type" must be one of: ${ALLOWED_TYPES.join(', ')} (category "${r.category}").` },
        { status: 400 }
      )
    }
  }

  if (payload.length === 0) {
    return Response.json({ imported: 0 })
  }

  try {
    const sql = getNeonSql()
    let imported = 0

    // Each row needs a read (does this category already exist for this user?)
    // before deciding insert vs. update, so this runs as a sequential loop of
    // round trips rather than a single batched statement.
    for (const r of payload) {
      const [existing] = await sql`
        SELECT id FROM budget_categories WHERE user_id = ${userId} AND category = ${r.category}
      `

      if (existing) {
        await sql`
          UPDATE budget_categories
          SET
            "group" = ${r.group},
            type = ${r.type ?? null},
            monthly_target = ${r.monthlyTarget ?? null},
            is_active = true
          WHERE id = ${existing.id} AND user_id = ${userId}
        `
      } else {
        await sql`
          INSERT INTO budget_categories (user_id, category, "group", type, monthly_target, is_active)
          VALUES (${userId}, ${r.category}, ${r.group}, ${r.type ?? null}, ${r.monthlyTarget ?? null}, true)
        `
      }
      imported += 1
    }

    return Response.json({ imported })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

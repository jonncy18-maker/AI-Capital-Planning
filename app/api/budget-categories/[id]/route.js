import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { auth } from '../../../../src/lib/neon/authServer.js'

const ALLOWED_TYPES = ['Fixed', 'Flexible', 'Non-Monthly']
const UPDATABLE_FIELDS = [
  'category',
  'group',
  'type',
  'monthly_target',
  'annual_target',
  'exclude_from_totals',
  'cc_category',
  'cash_only',
  'pinned_card_id',
  'is_active',
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
    // even by guessing an id. Fetch-then-merge so fields explicitly set to
    // null (e.g. clearing group or type) are honored, not skipped.
    const [existing] = await sql`
      SELECT * FROM budget_categories WHERE id = ${id} AND user_id = ${userId}
    `
    if (!existing) {
      return Response.json({ error: 'Budget category not found.' }, { status: 404 })
    }

    const merged = { ...existing, ...updates }

    const [row] = await sql`
      UPDATE budget_categories
      SET
        category = ${merged.category},
        "group" = ${merged.group},
        type = ${merged.type},
        monthly_target = ${merged.monthly_target},
        annual_target = ${merged.annual_target},
        exclude_from_totals = ${!!merged.exclude_from_totals},
        cc_category = ${merged.cc_category},
        cash_only = ${!!merged.cash_only},
        pinned_card_id = ${merged.pinned_card_id},
        is_active = ${!!merged.is_active}
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING *
    `

    if (!row) {
      return Response.json({ error: 'Budget category not found.' }, { status: 404 })
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
    // The original schema had budget_line_items/forecast_line_items/
    // forecast_overrides/scenario_adjustments.category_id ON DELETE CASCADE,
    // and bills.forecast_category_id ON DELETE SET NULL — all dropped to
    // NO ACTION during the Neon schema recreation. A plain DELETE here would
    // foreign-key-violate the moment the category has any budget/forecast
    // lines, overrides, scenario adjustments, or a linked bill.
    const [, , , , , rows] = await sql.transaction([
      sql`DELETE FROM budget_line_items WHERE category_id = ${id} AND user_id = ${userId}`,
      sql`DELETE FROM forecast_line_items WHERE category_id = ${id} AND user_id = ${userId}`,
      sql`DELETE FROM forecast_overrides WHERE category_id = ${id} AND user_id = ${userId}`,
      sql`DELETE FROM scenario_adjustments WHERE category_id = ${id} AND user_id = ${userId}`,
      sql`UPDATE bills SET forecast_category_id = NULL WHERE forecast_category_id = ${id} AND user_id = ${userId}`,
      sql`DELETE FROM budget_categories WHERE id = ${id} AND user_id = ${userId} RETURNING id`,
    ])

    if (rows.length === 0) {
      return Response.json({ error: 'Budget category not found.' }, { status: 404 })
    }
    return new Response(null, { status: 204 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { auth } from '../../../../src/lib/neon/authServer.js'

// PATCH /api/budget-line-items/:id
// Body: { amount }
// Mirrors src/lib/db/budgetLineItems.js#updateLineItemAmount, with a required
// hardening fix: the source function filters only by `id` and relies
// entirely on Supabase RLS to prevent cross-user access. Neon has RLS
// stripped (custom API layer enforces authorization instead), so this route
// adds `AND user_id = ${userId}` to the UPDATE and returns 404 if the row
// doesn't exist or isn't owned by the caller — the same class of gap
// hardened for scenario_adjustments#deleteAdjustment in the Wave 1 port.
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

  const { amount } = body || {}
  if (typeof amount !== 'number' || Number.isNaN(amount)) {
    return Response.json({ error: 'Field "amount" must be a number.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()
    const [row] = await sql`
      UPDATE budget_line_items
      SET amount = ${amount}
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id
    `
    if (!row) {
      return Response.json({ error: 'Budget line item not found.' }, { status: 404 })
    }
    return Response.json({ success: true })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// DELETE /api/budget-line-items/:id
// Mirrors src/lib/db/budgetLineItems.js#deleteLineItem, with the same
// required hardening fix as PATCH above: adds `AND user_id = ${userId}` to
// the DELETE and returns 404 if the row doesn't exist or isn't owned by the
// caller (the source filters only by `id`, relying entirely on Supabase RLS,
// which Neon does not have).
export async function DELETE(request, context) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { id } = await context.params

  try {
    const sql = getNeonSql()
    const [row] = await sql`
      DELETE FROM budget_line_items
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id
    `
    if (!row) {
      return Response.json({ error: 'Budget line item not found.' }, { status: 404 })
    }
    return Response.json({ success: true })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

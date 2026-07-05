import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { auth } from '../../../../src/lib/neon/authServer.js'

function shapeForecastLineItem(row) {
  const { cat_id, cat_category, cat_group, cat_type, ...rest } = row
  return {
    ...rest,
    budget_categories:
      cat_id != null
        ? { id: cat_id, category: cat_category, group: cat_group, type: cat_type }
        : null,
  }
}

// PATCH /api/forecast-line-items/:id
// Body: { amount, label, note } (partial — only fields present are applied)
// Mirrors src/lib/db/forecastLineItems.js#updateForecastLineItem, with a
// required hardening fix: the source function filters only by `id` and
// relies entirely on Supabase RLS to prevent cross-user access. Neon has RLS
// stripped (custom API layer enforces authorization instead), so this route
// adds `AND user_id = ${userId}` and returns 404 if the row doesn't exist or
// isn't owned by the caller — the same class of gap hardened for
// budget_line_items' updateLineItemAmount/deleteLineItem in Wave 2 and
// scenario_adjustments in Wave 1.
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

  const hasAmount = body && Object.prototype.hasOwnProperty.call(body, 'amount') && body.amount !== undefined
  const hasLabel = body && Object.prototype.hasOwnProperty.call(body, 'label') && body.label !== undefined
  const hasNote = body && Object.prototype.hasOwnProperty.call(body, 'note') && body.note !== undefined

  if (hasAmount && (typeof body.amount !== 'number' || Number.isNaN(body.amount))) {
    return Response.json({ error: 'Field "amount" must be a number.' }, { status: 400 })
  }

  if (!hasAmount && !hasLabel && !hasNote) {
    return Response.json({ error: 'No updatable fields provided.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()

    // Fetch-then-merge (rather than a partial UPDATE ... COALESCE) so a field
    // explicitly set to null (e.g. clearing note) is honored, not skipped —
    // matches the source's `!== undefined` field-by-field patch semantics.
    const [existing] = await sql`
      SELECT * FROM forecast_line_items WHERE id = ${id} AND user_id = ${userId}
    `
    if (!existing) {
      return Response.json({ error: 'Forecast line item not found.' }, { status: 404 })
    }

    const merged = {
      amount: hasAmount ? body.amount : existing.amount,
      label: hasLabel ? body.label : existing.label,
      note: hasNote ? body.note : existing.note,
    }

    const [row] = await sql`
      UPDATE forecast_line_items
      SET amount = ${merged.amount}, label = ${merged.label}, note = ${merged.note}, updated_at = now()
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id
    `
    if (!row) {
      return Response.json({ error: 'Forecast line item not found.' }, { status: 404 })
    }

    const [full] = await sql`
      SELECT
        fli.*,
        bc.id AS cat_id,
        bc.category AS cat_category,
        bc."group" AS cat_group,
        bc.type AS cat_type
      FROM forecast_line_items fli
      LEFT JOIN budget_categories bc ON bc.id = fli.category_id
      WHERE fli.id = ${id}
    `
    return Response.json(shapeForecastLineItem(full))
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// DELETE /api/forecast-line-items/:id
// Mirrors src/lib/db/forecastLineItems.js#deleteForecastLineItem, with the
// same required hardening fix as PATCH above: adds `AND user_id = ${userId}`
// to the DELETE and returns 404 if the row doesn't exist or isn't owned by
// the caller (the source filters only by `id`, relying entirely on Supabase
// RLS, which Neon does not have).
export async function DELETE(request, context) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { id } = await context.params

  try {
    const sql = getNeonSql()
    const rows = await sql`
      DELETE FROM forecast_line_items
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id
    `
    if (rows.length === 0) {
      return Response.json({ error: 'Forecast line item not found.' }, { status: 404 })
    }
    return new Response(null, { status: 204 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

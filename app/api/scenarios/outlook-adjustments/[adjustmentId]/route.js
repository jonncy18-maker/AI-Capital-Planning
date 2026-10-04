import { getNeonSql } from '../../../../../src/lib/neon/client.js'
import { getSessionOrToken } from '../../../../../src/lib/neon/apiAuth.js'
import { isUuid } from '../../../../../src/lib/outlook/validation.js'

export async function DELETE(request, context) {
  const { data: session } = await getSessionOrToken(request)
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id
  const { adjustmentId } = await context.params
  if (!isUuid(adjustmentId)) {
    return Response.json({ error: 'Adjustment not found.' }, { status: 404 })
  }

  try {
    const sql = getNeonSql()
    // WHERE user_id is the authorization check: a guessed id of another user's
    // adjustment matches nothing.
    const rows = await sql`
      DELETE FROM scenario_outlook_adjustments
      WHERE id = ${adjustmentId} AND user_id = ${userId}
      RETURNING id
    `
    if (rows.length === 0) {
      return Response.json({ error: 'Adjustment not found.' }, { status: 404 })
    }
    return new Response(null, { status: 204 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

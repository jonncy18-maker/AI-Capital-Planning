import { getNeonSql } from '../../../../../src/lib/neon/client.js'
import { auth } from '../../../../../src/lib/neon/authServer.js'

// Flatter sibling of app/api/scenarios/[id]/adjustments/[adjustmentId]/route.js
// DELETE, for src/lib/db/scenarios.js#deleteAdjustment(adjustmentId), whose
// only real call site (Scenarios.jsx#handleDeleteAdj) never has the parent
// scenario id in hand. scenario_adjustments carries its own user_id column
// (see app/api/scenarios/[id]/adjustments/route.js), so ownership can be
// verified directly without a join through scenarios.
export async function DELETE(request, context) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { adjustmentId } = await context.params

  try {
    const sql = getNeonSql()
    // WHERE user_id = ${userId} is the authorization check: it guarantees a
    // user can never delete an adjustment they don't own, even by guessing
    // an id.
    const rows = await sql`
      DELETE FROM scenario_adjustments
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

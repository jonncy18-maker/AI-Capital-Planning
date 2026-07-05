import { getNeonSql } from '../../../../../../src/lib/neon/client.js'
import { auth } from '../../../../../../src/lib/neon/authServer.js'

export async function DELETE(request, context) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { id: scenarioId, adjustmentId } = await context.params

  try {
    const sql = getNeonSql()
    // WHERE user_id = ${userId} AND scenario_id = ${scenarioId} is the
    // authorization check: it guarantees a user can never delete an
    // adjustment they don't own, even by guessing an id. (Stricter than
    // src/lib/db/scenarios.js#deleteAdjustment, which only filters by id.)
    const rows = await sql`
      DELETE FROM scenario_adjustments
      WHERE id = ${adjustmentId} AND scenario_id = ${scenarioId} AND user_id = ${userId}
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

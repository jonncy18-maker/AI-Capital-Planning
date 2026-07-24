import { getNeonSql } from '../../../../../../src/lib/neon/client.js'
import { auth } from '../../../../../../src/lib/neon/authServer.js'

// Delete a single income adjustment. Scoped by user_id (the authorization
// boundary) and scenario_id so a caller can never remove a row they don't own.
export async function DELETE(request, context) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id
  const { id: scenarioId, adjId } = await context.params

  try {
    const sql = getNeonSql()
    const [row] = await sql`
      DELETE FROM scenario_income_adjustments
      WHERE id = ${adjId} AND scenario_id = ${scenarioId} AND user_id = ${userId}
      RETURNING id
    `
    if (!row) {
      return Response.json({ error: 'Income adjustment not found.' }, { status: 404 })
    }
    return new Response(null, { status: 204 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

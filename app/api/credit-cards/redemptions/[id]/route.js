import { getNeonSql } from '../../../../../src/lib/neon/client.js'
import { auth } from '../../../../../src/lib/neon/authServer.js'

// Mirrors src/lib/db/creditCards.js#deletePointRedemption, hardened: the
// source only filters by id. WHERE user_id = ${userId} is the authorization
// check — a user can never delete a redemption they don't own.
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
      DELETE FROM credit_card_point_redemptions
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id
    `

    if (rows.length === 0) {
      return Response.json({ error: 'Point redemption not found.' }, { status: 404 })
    }
    return new Response(null, { status: 204 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

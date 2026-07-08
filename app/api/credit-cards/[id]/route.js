import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { auth } from '../../../../src/lib/neon/authServer.js'

// Mirrors src/lib/db/creditCards.js#deleteCreditCard, hardened: the source
// only filters by id (relies on RLS). WHERE user_id = ${userId} is the
// authorization check here — a user can never delete a card they don't own,
// even by guessing an id.
export async function DELETE(request, context) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { id } = await context.params

  try {
    const sql = getNeonSql()
    // The original schema had credit_card_earn_rates/points/point_redemptions
    // .card_id ON DELETE CASCADE, and bills.credit_card_id +
    // budget_categories.pinned_card_id ON DELETE SET NULL — all dropped to
    // NO ACTION during the Neon schema recreation. A plain DELETE here would
    // foreign-key-violate the moment the card has any earn rates, points,
    // redemptions, linked bills, or pinned categories.
    const [, , , , , rows] = await sql.transaction([
      sql`DELETE FROM credit_card_earn_rates WHERE card_id = ${id} AND user_id = ${userId}`,
      sql`DELETE FROM credit_card_points WHERE card_id = ${id} AND user_id = ${userId}`,
      sql`DELETE FROM credit_card_point_redemptions WHERE card_id = ${id} AND user_id = ${userId}`,
      sql`UPDATE bills SET credit_card_id = NULL WHERE credit_card_id = ${id} AND user_id = ${userId}`,
      sql`UPDATE budget_categories SET pinned_card_id = NULL WHERE pinned_card_id = ${id} AND user_id = ${userId}`,
      sql`DELETE FROM credit_cards WHERE id = ${id} AND user_id = ${userId} RETURNING id`,
    ])

    if (rows.length === 0) {
      return Response.json({ error: 'Credit card not found.' }, { status: 404 })
    }
    return new Response(null, { status: 204 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

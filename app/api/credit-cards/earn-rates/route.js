import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { auth } from '../../../../src/lib/neon/authServer.js'

// Mirrors src/lib/db/creditCards.js#getEarnRates.
export async function GET() {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  try {
    const sql = getNeonSql()
    const rows = await sql`
      SELECT * FROM credit_card_earn_rates WHERE user_id = ${userId}
    `
    return Response.json(rows)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// Mirrors src/lib/db/creditCards.js#upsertEarnRate: upsert on (card_id,
// cc_category), which now has a real unique constraint on Neon
// (credit_card_earn_rates_card_id_cc_category_key — verified via pg_constraint,
// see db/migrations/017_neon_missing_unique_constraints.sql).
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

  const { cardId, ccCategory, earnRate } = body || {}

  if (!cardId || typeof cardId !== 'string') {
    return Response.json({ error: 'Field "cardId" is required.' }, { status: 400 })
  }
  if (!ccCategory || typeof ccCategory !== 'string') {
    return Response.json({ error: 'Field "ccCategory" is required.' }, { status: 400 })
  }
  if (earnRate === undefined || earnRate === null) {
    return Response.json({ error: 'Field "earnRate" is required.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()
    const [row] = await sql`
      INSERT INTO credit_card_earn_rates (card_id, user_id, cc_category, earn_rate)
      VALUES (${cardId}, ${userId}, ${ccCategory}, ${earnRate})
      ON CONFLICT (card_id, cc_category) DO UPDATE SET
        earn_rate = EXCLUDED.earn_rate,
        user_id = EXCLUDED.user_id
      RETURNING *
    `
    return Response.json(row)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// Mirrors src/lib/db/creditCards.js#deleteEarnRate, hardened: the source has
// no user_id filter at all. credit_card_earn_rates has its own user_id
// column (verified via information_schema), so we filter directly on it —
// the authorization boundary for this delete.
export async function DELETE(request) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const cardId = searchParams.get('cardId')
  const ccCategory = searchParams.get('ccCategory')

  if (!cardId) {
    return Response.json({ error: 'Query param "cardId" is required.' }, { status: 400 })
  }
  if (!ccCategory) {
    return Response.json({ error: 'Query param "ccCategory" is required.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()
    const rows = await sql`
      DELETE FROM credit_card_earn_rates
      WHERE card_id = ${cardId} AND cc_category = ${ccCategory} AND user_id = ${userId}
      RETURNING id
    `

    if (rows.length === 0) {
      return Response.json({ error: 'Earn rate not found.' }, { status: 404 })
    }
    return new Response(null, { status: 204 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

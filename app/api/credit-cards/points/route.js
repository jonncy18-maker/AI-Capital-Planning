import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { auth } from '../../../../src/lib/neon/authServer.js'

// Mirrors src/lib/db/creditCards.js#getPointsBalances: fetch all snapshot
// rows ordered newest-first, then reduce to the latest row per card in JS
// (kept server-side to match the source's returned map shape exactly:
// { [cardId]: { balance, as_of_date, ... } }).
export async function GET() {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  try {
    const sql = getNeonSql()
    const rows = await sql`
      SELECT * FROM credit_card_points
      WHERE user_id = ${userId}
      ORDER BY as_of_date DESC
    `

    const latest = {}
    for (const row of rows) {
      if (!latest[row.card_id]) latest[row.card_id] = row
    }
    return Response.json(latest)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// Mirrors src/lib/db/creditCards.js#upsertPointsBalance: despite the name,
// this is a plain INSERT — each call creates a new snapshot row, it does not
// update an existing one.
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

  const { cardId, balance, asOfDate } = body || {}

  if (!cardId || typeof cardId !== 'string') {
    return Response.json({ error: 'Field "cardId" is required.' }, { status: 400 })
  }
  if (balance === undefined || balance === null) {
    return Response.json({ error: 'Field "balance" is required.' }, { status: 400 })
  }
  if (!asOfDate) {
    return Response.json({ error: 'Field "asOfDate" is required.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()
    const [row] = await sql`
      INSERT INTO credit_card_points (card_id, user_id, balance, as_of_date)
      VALUES (${cardId}, ${userId}, ${balance}, ${asOfDate})
      RETURNING *
    `
    return Response.json(row, { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

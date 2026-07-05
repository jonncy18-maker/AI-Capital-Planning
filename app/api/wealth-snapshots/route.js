import { getNeonSql } from '../../../src/lib/neon/client.js'
import { auth } from '../../../src/lib/neon/authServer.js'

export async function GET(request) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const latest = searchParams.get('latest') === 'true'
  // Mirrors src/lib/db/wealthSnapshots.js#getWealthSnapshots default limit.
  const limitParam = searchParams.get('limit')
  const limit = latest ? 1 : limitParam ? parseInt(limitParam, 10) : 24

  if (!latest && (!Number.isInteger(limit) || limit <= 0)) {
    return Response.json({ error: 'Query param "limit" must be a positive integer.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()
    const rows = await sql`
      SELECT * FROM wealth_snapshots
      WHERE user_id = ${userId}
      ORDER BY snapshot_date DESC
      LIMIT ${limit}
    `

    if (latest) {
      // Mirrors src/lib/db/wealthSnapshots.js#getLatestWealthSnapshot: returns
      // a single object (or null) rather than a list.
      return Response.json(rows[0] ?? null)
    }
    return Response.json(rows)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

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

  const {
    snapshot_date,
    net_worth = null,
    investment_balance = null,
    retirement_balance = null,
    other_assets = null,
    liabilities = null,
    notes = null,
  } = body || {}

  if (!snapshot_date) {
    return Response.json({ error: 'Field "snapshot_date" is required.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()
    const [row] = await sql`
      INSERT INTO wealth_snapshots
        (user_id, snapshot_date, net_worth, investment_balance, retirement_balance, other_assets, liabilities, notes)
      VALUES
        (${userId}, ${snapshot_date}, ${net_worth}, ${investment_balance}, ${retirement_balance}, ${other_assets}, ${liabilities}, ${notes})
      RETURNING *
    `
    return Response.json(row, { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

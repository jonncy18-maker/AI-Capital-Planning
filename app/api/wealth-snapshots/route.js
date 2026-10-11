import { validDate, validateSnapshotAmounts } from '../../../src/lib/wealth/plans.js'
import { getNeonSql } from '../../../src/lib/neon/client.js'
import { getSessionOrToken } from '../../../src/lib/neon/apiAuth.js'

export async function GET(request) {
  const { data: session } = await getSessionOrToken(request)
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
    return Response.json(
      { error: 'Query param "limit" must be a positive integer.' },
      { status: 400 }
    )
  }

  try {
    const sql = getNeonSql()
    const rows = await sql`
      SELECT *, snapshot_date::text AS snapshot_date FROM wealth_snapshots
      WHERE user_id = ${userId}
      ORDER BY wealth_snapshots.snapshot_date DESC, created_at DESC, id DESC
      LIMIT ${limit}
    `

    if (latest) {
      // Mirrors src/lib/db/wealthSnapshots.js#getLatestWealthSnapshot: returns
      // a single object (or null) rather than a list.
      return Response.json(rows[0] ?? null)
    }
    return Response.json(rows)
  } catch (err) {
    return Response.json(
      {
        error:
          err.code === '42703'
            ? 'Emergency cash and contributions need migration 025_wealth_plans.sql before saving. Existing snapshots remain available.'
            : err.message,
      },
      { status: 500 }
    )
  }
}

export async function POST(request) {
  const { data: session } = await getSessionOrToken(request)
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
    emergency_cash = null,
    investment_contributions_ytd = null,
  } = body || {}

  if (!validDate(snapshot_date)) {
    return Response.json(
      { error: 'Field "snapshot_date" must be a real YYYY-MM-DD date.' },
      { status: 400 }
    )
  }

  try {
    validateSnapshotAmounts({
      net_worth,
      investment_balance,
      retirement_balance,
      other_assets,
      liabilities,
      emergency_cash,
      investment_contributions_ytd,
    })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 })
  }

  try {
    const sql = getNeonSql()
    if (
      !Object.hasOwn(body, 'emergency_cash') &&
      !Object.hasOwn(body, 'investment_contributions_ytd')
    ) {
      const [legacy] = await sql`INSERT INTO wealth_snapshots
        (user_id, snapshot_date, net_worth, investment_balance, retirement_balance, other_assets, liabilities, notes)
        VALUES (${userId}, ${snapshot_date}, ${net_worth}, ${investment_balance}, ${retirement_balance}, ${other_assets}, ${liabilities}, ${notes}) RETURNING *, snapshot_date::text AS snapshot_date`
      return Response.json(legacy, { status: 201 })
    }
    const [row] = await sql`
      INSERT INTO wealth_snapshots
        (user_id, snapshot_date, net_worth, investment_balance, retirement_balance, other_assets, liabilities, notes, emergency_cash, investment_contributions_ytd)
      VALUES
        (${userId}, ${snapshot_date}, ${net_worth}, ${investment_balance}, ${retirement_balance}, ${other_assets}, ${liabilities}, ${notes}, ${emergency_cash}, ${investment_contributions_ytd})
      RETURNING *, snapshot_date::text AS snapshot_date
    `
    return Response.json(row, { status: 201 })
  } catch (err) {
    return Response.json(
      {
        error:
          err.code === '42703'
            ? 'Emergency cash and contributions need migration 025_wealth_plans.sql before saving. Existing snapshots remain available.'
            : err.message,
      },
      { status: 500 }
    )
  }
}

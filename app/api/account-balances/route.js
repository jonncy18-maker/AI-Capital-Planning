import { getNeonSql } from '../../../src/lib/neon/client.js'
import { auth } from '../../../src/lib/neon/authServer.js'

// Reshapes the flat join result back into the nested shape
// src/lib/db/bills.js#getAccountBalances returns via the original
// `*, account:accounts(id, name, type, is_primary_checking)` embedded select.
function shapeBalance(row) {
  const { acct_id, acct_name, acct_type, acct_is_primary_checking, ...rest } = row
  return {
    ...rest,
    account:
      acct_id != null
        ? { id: acct_id, name: acct_name, type: acct_type, is_primary_checking: acct_is_primary_checking }
        : null,
  }
}

// GET /api/account-balances?year=&month=
// Mirrors src/lib/db/bills.js#getAccountBalances.
export async function GET(request) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const yearParam = searchParams.get('year')
  const monthParam = searchParams.get('month')
  if (!yearParam || !monthParam) {
    return Response.json({ error: 'Query params "year" and "month" are required.' }, { status: 400 })
  }
  const year = Number.parseInt(yearParam, 10)
  const month = Number.parseInt(monthParam, 10)
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    return Response.json({ error: 'Query params "year" and "month" must be integers.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()
    const rows = await sql`
      SELECT
        ab.*,
        a.id AS acct_id,
        a.name AS acct_name,
        a.type AS acct_type,
        a.is_primary_checking AS acct_is_primary_checking
      FROM account_balances ab
      LEFT JOIN accounts a ON a.id = ab.account_id
      WHERE ab.user_id = ${userId} AND ab.year = ${year} AND ab.month = ${month}
      ORDER BY ab.period_half ASC
    `
    return Response.json(rows.map(shapeBalance))
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// POST /api/account-balances — upsert on (account_id, year, month, period_half),
// mirroring src/lib/db/bills.js#upsertAccountBalance. The unique constraint
// this relies on (account_balances_account_id_year_month_period_half_key) was
// missing on the Neon dev branch and was added directly + documented in
// db/migrations/018_neon_bills_unique_constraints.sql.
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

  const { accountId, year, month, periodHalf, balance } = body || {}

  if (!accountId || typeof accountId !== 'string') {
    return Response.json({ error: 'Field "accountId" is required.' }, { status: 400 })
  }
  if (!Number.isInteger(year)) {
    return Response.json({ error: 'Field "year" must be an integer.' }, { status: 400 })
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return Response.json({ error: 'Field "month" must be an integer between 1 and 12.' }, { status: 400 })
  }
  if (periodHalf !== 1 && periodHalf !== 2) {
    return Response.json({ error: 'Field "periodHalf" must be 1 or 2.' }, { status: 400 })
  }
  if (typeof balance !== 'number' || Number.isNaN(balance)) {
    return Response.json({ error: 'Field "balance" must be a number.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()

    // Ownership check, consistent with the bill_amounts hardening: verify
    // the account belongs to this user before writing.
    const [account] = await sql`SELECT id FROM accounts WHERE id = ${accountId} AND user_id = ${userId}`
    if (!account) {
      return Response.json({ error: 'Account not found.' }, { status: 404 })
    }

    const [row] = await sql`
      INSERT INTO account_balances (account_id, user_id, year, month, period_half, balance)
      VALUES (${accountId}, ${userId}, ${year}, ${month}, ${periodHalf}, ${balance})
      ON CONFLICT (account_id, year, month, period_half)
      DO UPDATE SET balance = EXCLUDED.balance
      RETURNING *
    `
    return Response.json(row, { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

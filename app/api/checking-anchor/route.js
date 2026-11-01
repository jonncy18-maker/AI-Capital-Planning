import { getNeonSql } from '../../../src/lib/neon/client.js'
import { getSessionOrToken } from '../../../src/lib/neon/apiAuth.js'
import { parseCentsStrict, fromCents } from '../../../src/lib/money.js'

const UUID_RE = /^[0-9a-f-]{36}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_BALANCE_CENTS = 1e9 * 100
const MAX_AGE_DAYS = 366

function shapeRow(row) {
  return {
    account_id: row.account_id,
    as_of_date: row.as_of_date,
    balance: Number(row.balance),
    updated_at: row.updated_at,
  }
}

// Day number for a YYYY-MM-DD string, or null when it is not a real calendar date
// (the round-trip rejects Feb 30 and similar).
function dayNumber(ymd) {
  if (typeof ymd !== 'string' || !DATE_RE.test(ymd)) return null
  const [y, m, d] = ymd.split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d)
  const dt = new Date(ms)
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return ms / 86400000
}

// GET /api/checking-anchor?accountId=<uuid> — the saved anchor row, or null.
export async function GET(request) {
  const { data: session } = await getSessionOrToken(request)
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const accountId = new URL(request.url).searchParams.get('accountId')
  if (!accountId || !UUID_RE.test(accountId)) {
    return Response.json({ error: 'Query param "accountId" must be a UUID.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()
    const rows = await sql`
      SELECT account_id, to_char(as_of_date, 'YYYY-MM-DD') AS as_of_date, balance, updated_at
      FROM checking_balance_anchors
      WHERE user_id = ${userId} AND account_id = ${accountId}
    `
    return Response.json(rows.length ? shapeRow(rows[0]) : null)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// PUT /api/checking-anchor { accountId, asOfDate, balance } — upsert on (user_id, account_id).
export async function PUT(request) {
  const { data: session } = await getSessionOrToken(request)
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const { accountId, asOfDate, balance } = body ?? {}
  if (typeof accountId !== 'string' || !UUID_RE.test(accountId)) {
    return Response.json({ error: 'Field "accountId" must be a UUID.' }, { status: 400 })
  }

  const asOfNum = dayNumber(asOfDate)
  if (asOfNum == null) {
    return Response.json({ error: 'Field "asOfDate" must be a real date in YYYY-MM-DD format.' }, { status: 400 })
  }
  const todayNum = Math.floor(Date.now() / 86400000)
  // +1 day of slack so a client in a timezone ahead of UTC can enter its own today.
  if (asOfNum > todayNum + 1) {
    return Response.json({ error: 'as-of date cannot be in the future' }, { status: 400 })
  }
  if (todayNum - asOfNum > MAX_AGE_DAYS) {
    return Response.json({ error: `as-of date cannot be more than ${MAX_AGE_DAYS} days old` }, { status: 400 })
  }

  const cents = parseCentsStrict(balance)
  if (cents == null) {
    return Response.json({ error: 'Field "balance" must be a number with at most 2 decimals.' }, { status: 400 })
  }
  if (Math.abs(cents) > MAX_BALANCE_CENTS) {
    return Response.json({ error: 'Field "balance" is out of range.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()
    const [account] = await sql`
      SELECT id, type FROM accounts WHERE id = ${accountId} AND user_id = ${userId}
    `
    if (!account) {
      return Response.json({ error: 'Account not found.' }, { status: 404 })
    }
    if (account.type !== 'checking') {
      return Response.json({ error: 'Account must be a checking account.' }, { status: 400 })
    }

    const [row] = await sql`
      INSERT INTO checking_balance_anchors (user_id, account_id, as_of_date, balance)
      VALUES (${userId}, ${accountId}, ${asOfDate}, ${fromCents(cents)})
      ON CONFLICT (user_id, account_id) DO UPDATE SET
        as_of_date = EXCLUDED.as_of_date,
        balance = EXCLUDED.balance,
        updated_at = now()
      RETURNING account_id, to_char(as_of_date, 'YYYY-MM-DD') AS as_of_date, balance, updated_at
    `
    return Response.json(shapeRow(row))
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

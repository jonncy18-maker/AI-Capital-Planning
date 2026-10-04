import { getNeonSql } from '../../../src/lib/neon/client.js'
import { isBillAmountItemsEligible, normalizeBillAmountItems, totalBillAmountItems, isUuid } from '../../../src/lib/payperiods/billAmountItems.js'
import { getSessionOrToken } from '../../../src/lib/neon/apiAuth.js'

// GET /api/bill-amounts — three read modes on one route, disambiguated by
// which query params are present (checked in this priority order):
//   1. ?billId=            -> mirrors getBillAmountsForBill(billId)
//   2. ?startYear=&endYear= -> mirrors getBillAmountsRange(userId, startYear, endYear)
//   3. ?year=&month=        -> mirrors getBillAmounts(userId, year, month)
// Neon has no default row cap, so modes 1 and 2 skip the source's manual
// paging loop (a 1,000-row page limit would have required one).
export async function GET(request) {
  const { data: session } = await getSessionOrToken(request)
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const billId = searchParams.get('billId')
  const startYearParam = searchParams.get('startYear')
  const endYearParam = searchParams.get('endYear')
  const yearParam = searchParams.get('year')
  const monthParam = searchParams.get('month')

  try {
    const sql = getNeonSql()

    if (billId) {
      // Hardening beyond the source: getBillAmountsForBill(billId) takes no
      // userId, so a caller could otherwise read another user's bill_amounts
      // by guessing a bill_id. We verify ownership via a join against bills.
      const rows = await sql`
        SELECT ba.* FROM bill_amounts ba
        WHERE ba.bill_id = ${billId}
          AND EXISTS (
            SELECT 1 FROM bills b WHERE b.id = ba.bill_id AND b.user_id = ${userId}
          )
        ORDER BY ba.year DESC, ba.month DESC
      `
      return Response.json(rows)
    }

    if (startYearParam && endYearParam) {
      const startYear = Number.parseInt(startYearParam, 10)
      const endYear = Number.parseInt(endYearParam, 10)
      if (!Number.isInteger(startYear) || !Number.isInteger(endYear)) {
        return Response.json(
          { error: 'Query params "startYear" and "endYear" must be integers.' },
          { status: 400 }
        )
      }
      const rows = await sql`
        SELECT * FROM bill_amounts
        WHERE user_id = ${userId} AND year >= ${startYear} AND year <= ${endYear}
      `
      return Response.json(rows)
    }

    if (!yearParam || !monthParam) {
      return Response.json(
        { error: 'Provide either "billId", or "startYear"+"endYear", or "year"+"month".' },
        { status: 400 }
      )
    }
    const year = Number.parseInt(yearParam, 10)
    const month = Number.parseInt(monthParam, 10)
    if (!Number.isInteger(year) || !Number.isInteger(month)) {
      return Response.json({ error: 'Query params "year" and "month" must be integers.' }, { status: 400 })
    }

    const rows = await sql`
      SELECT * FROM bill_amounts
      WHERE user_id = ${userId} AND year = ${year} AND month = ${month}
    `
    return Response.json(rows)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// POST /api/bill-amounts — upsert on (bill_id, year, month), mirroring
// src/lib/db/bills.js#upsertBillAmount. The unique constraint this relies on
// (bill_amounts_bill_id_year_month_key) was missing on the Neon dev branch
// and was added directly + documented in
// db/migrations/018_neon_bills_unique_constraints.sql.
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

  const { billId, year, month, amount, notes = null } = body || {}

  if (!billId || typeof billId !== 'string') {
    return Response.json({ error: 'Field "billId" is required.' }, { status: 400 })
  }
  if (!Number.isInteger(year)) {
    return Response.json({ error: 'Field "year" must be an integer.' }, { status: 400 })
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return Response.json({ error: 'Field "month" must be an integer between 1 and 12.' }, { status: 400 })
  }
  const itemWrite = Object.hasOwn(body, 'items')
  if (!itemWrite && (typeof amount !== 'number' || !Number.isFinite(amount))) {
    return Response.json({ error: 'Field "amount" must be a number.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()

    // Hardening: verify the bill belongs to this user before writing, since
    // the source's onConflict upsert has no ownership check of its own beyond
    // whatever user_id the caller passes.
    const [bill] = await sql`SELECT * FROM bills WHERE id = ${billId} AND user_id = ${userId}`
    if (!bill) {
      return Response.json({ error: 'Bill not found.' }, { status: 404 })
    }

    let row
    if (itemWrite) {
      if (!isBillAmountItemsEligible(bill)) {
        return Response.json({ error: 'Only unlinked variable bills can have items.' }, { status: 400 })
      }
      const { expectedRevision, expectedRowId } = body
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
        return Response.json({ error: 'expectedRevision must be a nonnegative integer.' }, { status: 400 })
      }
      if (expectedRowId !== null && !isUuid(expectedRowId)) {
        return Response.json({ error: 'expectedRowId must be the saved row UUID or null for a new month.' }, { status: 400 })
      }
      let items, total
      try {
        items = normalizeBillAmountItems(body.items)
        total = totalBillAmountItems(items)
      } catch (err) {
        return Response.json({ error: err.message }, { status: 400 })
      }
      const [current] = await sql`
        SELECT * FROM bill_amounts WHERE bill_id = ${billId} AND user_id = ${userId}
          AND year = ${year} AND month = ${month}
      `
      if ((current?.item_revision ?? 0) !== expectedRevision || (current?.id ?? null) !== expectedRowId) {
        return Response.json({ error: 'This month changed. Reload its items before saving.' }, { status: 409 })
      }
      // Existing snapshots only UPDATE their original row: DELETE cannot turn
      // an item edit into an INSERT that resurrects a removed monthly amount.
      if (expectedRowId !== null) {
        ;[row] = await sql`
          UPDATE bill_amounts SET amount = ${total}, items = ${JSON.stringify(items)}::jsonb,
            item_revision = item_revision + 1
          WHERE id = ${expectedRowId} AND bill_id = ${billId} AND user_id = ${userId}
            AND year = ${year} AND month = ${month} AND item_revision = ${expectedRevision}
          RETURNING *
        `
      } else {
        ;[row] = await sql`
          INSERT INTO bill_amounts (bill_id, user_id, year, month, amount, items, item_revision)
          VALUES (${billId}, ${userId}, ${year}, ${month}, ${total}, ${JSON.stringify(items)}::jsonb, 1)
          ON CONFLICT (bill_id, year, month) DO NOTHING
          RETURNING *
        `
      }
    } else {
      ;[row] = await sql`
        INSERT INTO bill_amounts (bill_id, user_id, year, month, amount, notes, item_revision)
        VALUES (${billId}, ${userId}, ${year}, ${month}, ${amount}, ${notes}, 1)
        ON CONFLICT (bill_id, year, month)
        DO UPDATE SET amount = EXCLUDED.amount, notes = EXCLUDED.notes,
          item_revision = bill_amounts.item_revision + 1
        WHERE bill_amounts.user_id = ${userId} AND bill_amounts.items IS NULL
        RETURNING *
      `
    }
    if (!row) return Response.json({ error: 'This month changed or is itemized. Reload and edit its items.' }, { status: 409 })
    return Response.json(row, { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

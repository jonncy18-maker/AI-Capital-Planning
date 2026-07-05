import { getNeonSql } from '../../../../../../src/lib/neon/client.js'
import { auth } from '../../../../../../src/lib/neon/authServer.js'

// DELETE /api/bill-amounts/:billId/:year/:month
// Mirrors src/lib/db/bills.js#deleteBillAmount. Hardened: the source has no
// user_id filter at all (bill_amounts does have a user_id column, but the
// delete only filters by bill_id/year/month) — we add an ownership check via
// EXISTS against bills, consistent with the GET ?billId= hardening.
export async function DELETE(request, context) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { billId, year, month } = await context.params
  const yearNum = Number.parseInt(year, 10)
  const monthNum = Number.parseInt(month, 10)
  if (!Number.isInteger(yearNum) || !Number.isInteger(monthNum)) {
    return Response.json({ error: 'URL params "year" and "month" must be integers.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()
    const rows = await sql`
      DELETE FROM bill_amounts
      WHERE bill_id = ${billId} AND year = ${yearNum} AND month = ${monthNum}
        AND EXISTS (SELECT 1 FROM bills b WHERE b.id = ${billId} AND b.user_id = ${userId})
      RETURNING id
    `

    if (rows.length === 0) {
      return Response.json({ error: 'Bill amount not found.' }, { status: 404 })
    }
    return new Response(null, { status: 204 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

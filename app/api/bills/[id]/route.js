import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { auth } from '../../../../src/lib/neon/authServer.js'

// Mirrors src/lib/db/bills.js#deleteBill. Hardened: the source only filters
// by `id` (relying on Supabase RLS) — here we add an explicit user_id check
// since Neon has no RLS layer to fall back on.
export async function DELETE(request, context) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { id } = await context.params

  try {
    const sql = getNeonSql()
    // The Supabase source had bill_amounts.bill_id ON DELETE CASCADE, dropped
    // to NO ACTION during the Neon schema recreation, so a plain DELETE here
    // would foreign-key-violate the moment the bill has any amount rows.
    const [, rows] = await sql.transaction([
      sql`DELETE FROM bill_amounts WHERE bill_id = ${id} AND user_id = ${userId}`,
      sql`DELETE FROM bills WHERE id = ${id} AND user_id = ${userId} RETURNING id`,
    ])

    if (rows.length === 0) {
      return Response.json({ error: 'Bill not found.' }, { status: 404 })
    }
    return new Response(null, { status: 204 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

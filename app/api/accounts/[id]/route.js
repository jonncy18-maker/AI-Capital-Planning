import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { auth } from '../../../../src/lib/neon/authServer.js'

// Mirrors src/lib/db/bills.js#deleteAccount. Hardened: the source only
// filters by `id` (relying on Supabase RLS) — here we add an explicit
// user_id check since Neon has no RLS layer to fall back on.
export async function DELETE(request, context) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { id } = await context.params

  try {
    const sql = getNeonSql()
    const rows = await sql`
      DELETE FROM accounts
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id
    `

    if (rows.length === 0) {
      return Response.json({ error: 'Account not found.' }, { status: 404 })
    }
    return new Response(null, { status: 204 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

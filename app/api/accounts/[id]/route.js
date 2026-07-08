import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { auth } from '../../../../src/lib/neon/authServer.js'

// Mirrors src/lib/db/bills.js#deleteAccount. Hardened: the source only
// filters by `id` (the original schema relied on RLS to prevent cross-user
// access) — here we add an explicit user_id check since Neon has no RLS layer
// to fall back on.
export async function DELETE(request, context) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { id } = await context.params

  try {
    const sql = getNeonSql()
    // The original schema had account_balances.account_id ON DELETE CASCADE
    // and bills.{auto_fund,debits_from}_account_id ON DELETE SET NULL — both
    // dropped to NO ACTION during the Neon schema recreation, so a plain
    // DELETE here would foreign-key-violate the moment the account has any
    // balances or linked bills. Replicate the cascade/null-out atomically.
    const [, , , rows] = await sql.transaction([
      sql`DELETE FROM account_balances WHERE account_id = ${id} AND user_id = ${userId}`,
      sql`UPDATE bills SET auto_fund_account_id = NULL WHERE auto_fund_account_id = ${id} AND user_id = ${userId}`,
      sql`UPDATE bills SET debits_from_account_id = NULL WHERE debits_from_account_id = ${id} AND user_id = ${userId}`,
      sql`DELETE FROM accounts WHERE id = ${id} AND user_id = ${userId} RETURNING id`,
    ])

    if (rows.length === 0) {
      return Response.json({ error: 'Account not found.' }, { status: 404 })
    }
    return new Response(null, { status: 204 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

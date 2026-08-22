import { getNeonSql } from '../../../src/lib/neon/client.js'
import { getSessionOrToken } from '../../../src/lib/neon/apiAuth.js'

// Mirrors src/lib/db/taxBrackets.js#loadAll: `tax_brackets` is world-readable
// reference data (federal brackets, FICA constants, state rates), not
// per-user data — there is no `user_id` column and no per-row ownership
// filter, matching the original RLS policy `for select to authenticated
// using (true)`. The only check is "is there a valid session at all".
//
// Returns the full raw table; the client re-runs the existing pure
// find/resolveYear/inflate logic (src/lib/tax/*.js) against these rows,
// same as it does today against the database-loaded rows.
export async function GET(request) {
  const { data: session } = await getSessionOrToken(request)
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const sql = getNeonSql()
    const rows = await sql`SELECT * FROM tax_brackets`
    return Response.json(rows)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

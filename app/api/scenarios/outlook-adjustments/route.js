import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { getSessionOrToken } from '../../../../src/lib/neon/apiAuth.js'

// GET /api/scenarios/outlook-adjustments?committed=1
// Every outlook adjustment of the user's committed scenarios — the baseline
// the 5-year outlook always includes. Without the param, returns the user's
// outlook adjustments across all scenarios. Each row carries scenario_id and
// scenario_state so callers can split them.
export async function GET(request) {
  const { data: session } = await getSessionOrToken(request)
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id
  const committedOnly = new URL(request.url).searchParams.get('committed') === '1'

  try {
    const sql = getNeonSql()
    const rows = await sql`
      SELECT soa.*, s.state AS scenario_state
      FROM scenario_outlook_adjustments soa
      JOIN scenarios s ON s.id = soa.scenario_id AND s.user_id = soa.user_id
      WHERE soa.user_id = ${userId}
        AND (${committedOnly}::boolean = false OR s.state = 'committed')
      ORDER BY soa.year ASC, soa.created_at ASC
    `
    return Response.json(rows.map(r => ({ ...r, delta_amount: Number(r.delta_amount) })))
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

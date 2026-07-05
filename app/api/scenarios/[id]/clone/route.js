import { getNeonSql } from '../../../../../src/lib/neon/client.js'
import { auth } from '../../../../../src/lib/neon/authServer.js'

// Mirrors src/lib/db/scenarios.js#cloneScenario: create a new scenario and
// copy every adjustment from the source scenario onto it. Unlike the old
// Supabase implementation (separate create + per-adjustment insert calls),
// this runs as a single statement — a CTE chaining the new scenario's INSERT
// straight into the adjustments copy INSERT ... SELECT — so the clone is
// atomic by construction (a lone Postgres statement) without needing to
// thread a generated id back through a sql.transaction array.
export async function POST(request, context) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { id: scenarioId } = await context.params

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  const { name, description = '' } = body || {}
  if (!name || typeof name !== 'string') {
    return Response.json({ error: 'Field "name" is required.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()

    // Ownership check on the source scenario before cloning anything.
    const [source] = await sql`
      SELECT id FROM scenarios WHERE id = ${scenarioId} AND user_id = ${userId}
    `
    if (!source) {
      return Response.json({ error: 'Scenario not found.' }, { status: 404 })
    }

    const [row] = await sql`
      WITH new_scenario AS (
        INSERT INTO scenarios (user_id, name, description, state)
        VALUES (${userId}, ${name}, ${description}, 'modeled')
        RETURNING *
      ),
      copied_adjustments AS (
        INSERT INTO scenario_adjustments
          (user_id, scenario_id, category_id, month, year, delta_amount, label)
        SELECT sa.user_id, ns.id, sa.category_id, sa.month, sa.year, sa.delta_amount, sa.label
        FROM scenario_adjustments sa, new_scenario ns
        WHERE sa.scenario_id = ${scenarioId} AND sa.user_id = ${userId}
        RETURNING 1
      )
      SELECT * FROM new_scenario
    `

    return Response.json(row, { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

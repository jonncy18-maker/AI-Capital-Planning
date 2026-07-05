import { getNeonSql } from '../../../../../src/lib/neon/client.js'
import { auth } from '../../../../../src/lib/neon/authServer.js'

// Reshapes the flat join result back into the nested shape
// src/lib/db/scenarios.js#getAdjustments/#addAdjustment return via Supabase's
// `*, budget_categories(category, "group", type)` embedded select.
function shapeAdjustment(row) {
  const { category_category, category_group, category_type, ...rest } = row
  return {
    ...rest,
    budget_categories: {
      category: category_category,
      group: category_group,
      type: category_type,
    },
  }
}

export async function GET(request, context) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { id: scenarioId } = await context.params

  try {
    const sql = getNeonSql()

    // Ownership check on the parent scenario before returning any adjustments.
    const [scenario] = await sql`
      SELECT id FROM scenarios WHERE id = ${scenarioId} AND user_id = ${userId}
    `
    if (!scenario) {
      return Response.json({ error: 'Scenario not found.' }, { status: 404 })
    }

    const rows = await sql`
      SELECT
        sa.*,
        bc.category AS category_category,
        bc."group" AS category_group,
        bc.type AS category_type
      FROM scenario_adjustments sa
      JOIN budget_categories bc ON bc.id = sa.category_id
      WHERE sa.user_id = ${userId} AND sa.scenario_id = ${scenarioId}
      ORDER BY sa.year ASC, sa.month ASC
    `
    return Response.json(rows.map(shapeAdjustment))
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

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

  const { category_id, month, year, delta_amount, label = '' } = body || {}

  if (!category_id || typeof category_id !== 'string') {
    return Response.json({ error: 'Field "category_id" is required.' }, { status: 400 })
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return Response.json({ error: 'Field "month" must be an integer between 1 and 12.' }, { status: 400 })
  }
  if (!Number.isInteger(year)) {
    return Response.json({ error: 'Field "year" must be an integer.' }, { status: 400 })
  }
  if (typeof delta_amount !== 'number' || Number.isNaN(delta_amount)) {
    return Response.json({ error: 'Field "delta_amount" must be a number.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()

    // Ownership checks on both the parent scenario and the referenced
    // category — neither id in the request body can be trusted on its own.
    const [scenario] = await sql`
      SELECT id FROM scenarios WHERE id = ${scenarioId} AND user_id = ${userId}
    `
    if (!scenario) {
      return Response.json({ error: 'Scenario not found.' }, { status: 404 })
    }

    const [category] = await sql`
      SELECT id FROM budget_categories WHERE id = ${category_id} AND user_id = ${userId}
    `
    if (!category) {
      return Response.json({ error: 'Budget category not found.' }, { status: 404 })
    }

    const [inserted] = await sql`
      INSERT INTO scenario_adjustments
        (user_id, scenario_id, category_id, month, year, delta_amount, label)
      VALUES
        (${userId}, ${scenarioId}, ${category_id}, ${month}, ${year}, ${delta_amount}, ${label})
      RETURNING id
    `

    const [row] = await sql`
      SELECT
        sa.*,
        bc.category AS category_category,
        bc."group" AS category_group,
        bc.type AS category_type
      FROM scenario_adjustments sa
      JOIN budget_categories bc ON bc.id = sa.category_id
      WHERE sa.id = ${inserted.id}
    `
    return Response.json(shapeAdjustment(row), { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

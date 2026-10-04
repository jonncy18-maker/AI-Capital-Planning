import { getNeonSql } from '../../../../../src/lib/neon/client.js'
import { getSessionOrToken } from '../../../../../src/lib/neon/apiAuth.js'
import {
  isUuid,
  validateYear,
  validateGroupName,
  validateAmount,
} from '../../../../../src/lib/outlook/validation.js'

const NOT_FOUND = { error: 'Scenario not found.' }

function shape(row) {
  return { ...row, delta_amount: Number(row.delta_amount) }
}

// Outlook adjustments are keyed by (year, group), not month x category, and are
// read live by the outlook view. They are deliberately not mirrored into
// forecast_line_items, so there is no resyncCommittedScenario call here.
export async function GET(request, context) {
  const { data: session } = await getSessionOrToken(request)
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id
  const { id: scenarioId } = await context.params
  if (!isUuid(scenarioId)) return Response.json(NOT_FOUND, { status: 404 })

  try {
    const sql = getNeonSql()
    const [scenario] = await sql`
      SELECT id FROM scenarios WHERE id = ${scenarioId} AND user_id = ${userId}
    `
    if (!scenario) return Response.json(NOT_FOUND, { status: 404 })

    const rows = await sql`
      SELECT * FROM scenario_outlook_adjustments
      WHERE user_id = ${userId} AND scenario_id = ${scenarioId}
      ORDER BY year ASC, created_at ASC
    `
    return Response.json(rows.map(shape))
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// POST { year, group_name, delta_amount, label? }
export async function POST(request, context) {
  const { data: session } = await getSessionOrToken(request)
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id
  const { id: scenarioId } = await context.params
  if (!isUuid(scenarioId)) return Response.json(NOT_FOUND, { status: 404 })

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  const year = validateYear(body?.year)
  if (year.error) return Response.json({ error: year.error }, { status: 400 })
  const group = validateGroupName(body?.group_name)
  if (group.error) return Response.json({ error: group.error }, { status: 400 })
  const delta = validateAmount(body?.delta_amount, 'delta_amount')
  if (delta.error) return Response.json({ error: delta.error }, { status: 400 })
  const label = typeof body?.label === 'string' ? body.label.slice(0, 200) : ''

  try {
    const sql = getNeonSql()
    // The scenario id in the URL can't be trusted on its own.
    const [scenario] = await sql`
      SELECT id FROM scenarios WHERE id = ${scenarioId} AND user_id = ${userId}
    `
    if (!scenario) return Response.json(NOT_FOUND, { status: 404 })

    const [row] = await sql`
      INSERT INTO scenario_outlook_adjustments
        (user_id, scenario_id, year, group_name, delta_amount, label)
      VALUES
        (${userId}, ${scenarioId}, ${year.value}, ${group.value}, ${delta.value}, ${label})
      RETURNING *
    `
    return Response.json(shape(row), { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

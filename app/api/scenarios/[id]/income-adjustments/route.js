import { getNeonSql } from '../../../../../src/lib/neon/client.js'
import { auth } from '../../../../../src/lib/neon/authServer.js'

// Per-month income deltas for an income-kind scenario. Parallel to
// scenario_adjustments (expenses) but income has no budget_category, so amounts
// live in scenario_income_adjustments: gross_amount (display/audit) and
// net_amount (post-tax, the value folded into the income forecast).

const ALLOWED_TYPES = ['salary', 'bonus', 'recurring', 'windfall']

export async function GET(request, context) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id
  const { id: scenarioId } = await context.params

  try {
    const sql = getNeonSql()
    const [scenario] = await sql`
      SELECT id FROM scenarios WHERE id = ${scenarioId} AND user_id = ${userId}
    `
    if (!scenario) {
      return Response.json({ error: 'Scenario not found.' }, { status: 404 })
    }

    const rows = await sql`
      SELECT * FROM scenario_income_adjustments
      WHERE user_id = ${userId} AND scenario_id = ${scenarioId}
      ORDER BY year ASC, month ASC
    `
    return Response.json(rows)
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

  const {
    year, month, income_type,
    gross_amount = 0, net_amount, taxable = true, label = '',
  } = body || {}

  if (!Number.isInteger(year)) {
    return Response.json({ error: 'Field "year" must be an integer.' }, { status: 400 })
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return Response.json({ error: 'Field "month" must be an integer between 1 and 12.' }, { status: 400 })
  }
  if (!ALLOWED_TYPES.includes(income_type)) {
    return Response.json({ error: `Field "income_type" must be one of: ${ALLOWED_TYPES.join(', ')}.` }, { status: 400 })
  }
  if (typeof net_amount !== 'number' || Number.isNaN(net_amount)) {
    return Response.json({ error: 'Field "net_amount" must be a number.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()
    const [scenario] = await sql`
      SELECT id FROM scenarios WHERE id = ${scenarioId} AND user_id = ${userId}
    `
    if (!scenario) {
      return Response.json({ error: 'Scenario not found.' }, { status: 404 })
    }

    const [row] = await sql`
      INSERT INTO scenario_income_adjustments
        (user_id, scenario_id, year, month, income_type, gross_amount, net_amount, taxable, label)
      VALUES
        (${userId}, ${scenarioId}, ${year}, ${month}, ${income_type},
         ${Number(gross_amount) || 0}, ${net_amount}, ${!!taxable}, ${label})
      RETURNING *
    `
    return Response.json(row, { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

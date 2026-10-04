import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { getSessionOrToken } from '../../../../src/lib/neon/apiAuth.js'
import { validateRate, validateGroupRatesPatch } from '../../../../src/lib/outlook/validation.js'

const DEFAULTS = { inflation_rate: 0.03, income_growth_rate: 0.03, group_rates: {} }

function shape(row) {
  return {
    inflation_rate: Number(row.inflation_rate),
    income_growth_rate: Number(row.income_growth_rate),
    group_rates: row.group_rates ?? {},
  }
}

// GET /api/outlook/assumptions -> the user's row, or the defaults when none is
// saved yet (nothing is written on read).
export async function GET(request) {
  const { data: session } = await getSessionOrToken(request)
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  try {
    const sql = getNeonSql()
    const [row] = await sql`SELECT * FROM outlook_assumptions WHERE user_id = ${userId}`
    return Response.json(row ? shape(row) : DEFAULTS)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// PUT /api/outlook/assumptions { inflation_rate?, income_growth_rate?, group_rates? }
// Upserts. group_rates is a patch merged into the saved map; a null value
// removes that group's override.
export async function PUT(request) {
  const { data: session } = await getSessionOrToken(request)
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  const patch = {}
  for (const field of ['inflation_rate', 'income_growth_rate']) {
    if (body?.[field] === undefined) continue
    const r = validateRate(body[field], field)
    if (r.error) return Response.json({ error: r.error }, { status: 400 })
    patch[field] = r.value
  }
  let groupRatesPatch = null
  if (body?.group_rates !== undefined) {
    const g = validateGroupRatesPatch(body.group_rates)
    if (g.error) return Response.json({ error: g.error }, { status: 400 })
    groupRatesPatch = g.value
  }

  try {
    const sql = getNeonSql()
    const [existing] = await sql`SELECT * FROM outlook_assumptions WHERE user_id = ${userId}`
    const current = existing ? shape(existing) : DEFAULTS

    const groupRates = { ...current.group_rates }
    for (const [k, v] of Object.entries(groupRatesPatch ?? {})) {
      if (v === null) delete groupRates[k]
      else groupRates[k] = v
    }
    const inflation = patch.inflation_rate ?? current.inflation_rate
    const growth = patch.income_growth_rate ?? current.income_growth_rate

    const [row] = await sql`
      INSERT INTO outlook_assumptions
        (user_id, inflation_rate, income_growth_rate, group_rates, updated_at)
      VALUES
        (${userId}, ${inflation}, ${growth}, ${JSON.stringify(groupRates)}::jsonb, now())
      ON CONFLICT (user_id) DO UPDATE SET
        inflation_rate = EXCLUDED.inflation_rate,
        income_growth_rate = EXCLUDED.income_growth_rate,
        group_rates = EXCLUDED.group_rates,
        updated_at = now()
      RETURNING *
    `
    return Response.json(shape(row))
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

import { getNeonSql } from '../../../src/lib/neon/client.js'
import { getSessionOrToken } from '../../../src/lib/neon/apiAuth.js'
import { validatePlan } from '../../../src/lib/wealth/plans.js'
import { derivePlan } from '../../../src/lib/wealth/projection.js'

function failure(err) {
  return Response.json(
    {
      error:
        err.code === '42P01' || err.code === '42703'
          ? 'Saved plans need migrations 025_wealth_plans.sql and 026_wealth_plan_assumptions.sql before use. Your snapshots remain available.'
          : err.message,
    },
    { status: 500 }
  )
}
export async function GET(request) {
  const { data: session } = await getSessionOrToken(request)
  if (!session?.user?.id) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  try {
    const sql = getNeonSql()
    return Response.json(
      await sql`SELECT *, start_date::text AS start_date FROM wealth_plans WHERE user_id = ${session.user.id} ORDER BY created_at DESC, id DESC`
    )
  } catch (err) {
    return failure(err)
  }
}
export async function POST(request) {
  const { data: session } = await getSessionOrToken(request)
  if (!session?.user?.id) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  let p
  try {
    p = derivePlan(validatePlan(await request.json()))
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 })
  }
  try {
    const sql = getNeonSql()
    const [row] =
      await sql`INSERT INTO wealth_plans (user_id, name, start_date, start_balance, monthly_contribution, annual_return, horizon, retirement_target, emergency_cash_target, starting_contributions_ytd, annual_contributions, annual_contributions_without_commitments, annual_commitment_drain, include_commitments, assumptions)
      VALUES (${session.user.id}, ${p.name}, ${p.start_date}, ${p.start_balance}, ${p.monthly_contribution}, ${p.annual_return}, ${p.horizon}, ${p.retirement_target}, ${p.emergency_cash_target}, ${p.starting_contributions_ytd}, ${JSON.stringify(p.annual_contributions)}::jsonb, ${JSON.stringify(p.annual_contributions_without_commitments)}::jsonb, ${p.annual_commitment_drain}, ${p.include_commitments}, ${p.assumptions == null ? null : JSON.stringify(p.assumptions)}::jsonb) RETURNING *, start_date::text AS start_date`
    return Response.json(row, { status: 201 })
  } catch (err) {
    return failure(err)
  }
}

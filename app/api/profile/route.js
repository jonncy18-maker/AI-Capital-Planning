import { getNeonSql } from '../../../src/lib/neon/client.js'
import { auth } from '../../../src/lib/neon/authServer.js'

export async function GET() {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  try {
    const sql = getNeonSql()
    // Application-level equivalent of Supabase's handle_new_user() trigger
    // (supabase/migrations/002_fix_new_user_trigger.sql: `insert into
    // user_profiles (id) values (new.id) on conflict (id) do nothing`,
    // fired after every auth.users insert). Neon Auth has no equivalent
    // trigger hook available on user creation, so the row is ensured here
    // instead, on first authenticated read — GET /api/profile is the first
    // thing the app calls after login (Login → Onboarding gates on
    // onboarding_complete from this same row). Idempotent: a no-op for an
    // existing user.
    await sql`INSERT INTO user_profiles (id) VALUES (${userId}) ON CONFLICT (id) DO NOTHING`
    // id IS the PK here (no separate user_id column) — this is both the
    // lookup and the authorization boundary in one condition.
    const [row] = await sql`
      SELECT * FROM user_profiles WHERE id = ${userId}
    `
    return Response.json(row)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function PUT(request) {
  const { data: session } = await auth.getSession()
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
  const profile = body || {}

  // Mirrors src/lib/db/profile.js#saveProfile field-for-field, including its
  // camelCase-with-snake_case-fallback convention and defaults.
  const focuses = profile.focuses ?? []
  const commitments = profile.commitments ?? []
  const planningHorizon = profile.planningHorizon ?? profile.planning_horizon ?? []
  const periodOptions = profile.periodOptions ?? profile.period_options ?? []
  const periodDefault = profile.periodDefault ?? profile.period_default ?? null
  const dataPath = profile.dataPath ?? profile.data_path ?? null
  const onboardingComplete = profile.onboardingComplete ?? profile.onboarding_complete ?? false
  const annualIncome = profile.annualIncome ?? profile.annual_income ?? null
  const annualBonus = profile.annualBonus ?? profile.annual_bonus ?? null
  const savingsGoalAmount = profile.savingsGoalAmount ?? profile.savings_goal_amount ?? null
  const savingsGoalPct = profile.savingsGoalPct ?? profile.savings_goal_pct ?? null
  const savingsGoalType = profile.savingsGoalType ?? profile.savings_goal_type ?? null
  const taxProfile = profile.taxProfile ?? profile.tax_profile ?? null
  const varianceThreshold = profile.varianceThreshold ?? profile.variance_threshold ?? 10
  const bonusMonth = profile.bonusMonth ?? profile.bonus_month ?? null
  const benefitsAmount = profile.benefitsAmount ?? profile.benefits_amount ?? null
  const benefitsPct = profile.benefitsPct ?? profile.benefits_pct ?? null
  const four01kPct = profile.four01kPct ?? profile.four01k_pct ?? null
  const four01kOnBonus = profile.four01kOnBonus ?? profile.four01k_on_bonus ?? false
  const payFrequency = profile.payFrequency ?? profile.pay_frequency ?? null
  const payDay1 = profile.payDay1 ?? profile.pay_day_1 ?? null
  const payDay2 = profile.payDay2 ?? profile.pay_day_2 ?? null

  try {
    const sql = getNeonSql()
    // ON CONFLICT (id) DO UPDATE is the full-row upsert equivalent of
    // supabase's .upsert(). Only the ~20 columns saveProfile touches are
    // listed here; cc_coverage_pct, cc_optimization_pct and
    // min_checking_balance are intentionally left out of both the insert
    // column list defaults and the update SET clause so this endpoint never
    // clobbers them — they're managed elsewhere (see PATCH below for
    // min_checking_balance).
    const [row] = await sql`
      INSERT INTO user_profiles (
        id, focuses, commitments, planning_horizon, period_options, period_default,
        data_path, onboarding_complete, annual_income, annual_bonus,
        savings_goal_amount, savings_goal_pct, savings_goal_type, tax_profile,
        variance_threshold, bonus_month, benefits_amount, benefits_pct,
        four01k_pct, four01k_on_bonus, pay_frequency, pay_day_1, pay_day_2,
        updated_at
      )
      VALUES (
        ${userId}, ${focuses}::text[], ${commitments}::text[], ${planningHorizon}::integer[],
        ${periodOptions}::text[], ${periodDefault}, ${dataPath}, ${onboardingComplete},
        ${annualIncome}, ${annualBonus}, ${savingsGoalAmount}, ${savingsGoalPct},
        ${savingsGoalType}, ${taxProfile === null ? null : JSON.stringify(taxProfile)}::jsonb,
        ${varianceThreshold}, ${bonusMonth}, ${benefitsAmount}, ${benefitsPct},
        ${four01kPct}, ${four01kOnBonus}, ${payFrequency}, ${payDay1}, ${payDay2}, now()
      )
      ON CONFLICT (id) DO UPDATE SET
        focuses = EXCLUDED.focuses,
        commitments = EXCLUDED.commitments,
        planning_horizon = EXCLUDED.planning_horizon,
        period_options = EXCLUDED.period_options,
        period_default = EXCLUDED.period_default,
        data_path = EXCLUDED.data_path,
        onboarding_complete = EXCLUDED.onboarding_complete,
        annual_income = EXCLUDED.annual_income,
        annual_bonus = EXCLUDED.annual_bonus,
        savings_goal_amount = EXCLUDED.savings_goal_amount,
        savings_goal_pct = EXCLUDED.savings_goal_pct,
        savings_goal_type = EXCLUDED.savings_goal_type,
        tax_profile = EXCLUDED.tax_profile,
        variance_threshold = EXCLUDED.variance_threshold,
        bonus_month = EXCLUDED.bonus_month,
        benefits_amount = EXCLUDED.benefits_amount,
        benefits_pct = EXCLUDED.benefits_pct,
        four01k_pct = EXCLUDED.four01k_pct,
        four01k_on_bonus = EXCLUDED.four01k_on_bonus,
        pay_frequency = EXCLUDED.pay_frequency,
        pay_day_1 = EXCLUDED.pay_day_1,
        pay_day_2 = EXCLUDED.pay_day_2,
        updated_at = now()
      RETURNING *
    `
    return Response.json(row)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// Narrow port of src/lib/db/profile.js#saveMinCheckingBalance: a dedicated
// partial update so callers touching only this one field don't need to
// round-trip the full ~20-field profile through PUT (and risk clobbering
// fields they didn't send, since PUT is a full upsert, not a patch).
export async function PATCH(request) {
  const { data: session } = await auth.getSession()
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

  const amount = body?.minCheckingBalance ?? body?.min_checking_balance
  if (amount === undefined || amount === null) {
    return Response.json(
      { error: 'Field "minCheckingBalance" (or "min_checking_balance") is required.' },
      { status: 400 }
    )
  }

  try {
    const sql = getNeonSql()
    const [row] = await sql`
      UPDATE user_profiles
      SET min_checking_balance = ${amount}, updated_at = now()
      WHERE id = ${userId}
      RETURNING *
    `
    if (!row) {
      return Response.json({ error: 'Profile not found.' }, { status: 404 })
    }
    return Response.json(row)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

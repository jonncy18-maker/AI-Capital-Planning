import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { auth } from '../../../../src/lib/neon/authServer.js'

// Narrow, dedicated endpoint for the two cc_* fields on user_profiles.
// app/api/profile/route.js#PUT deliberately excludes cc_coverage_pct and
// cc_optimization_pct from its full-profile upsert (see the comment there)
// so it never clobbers them — this route owns them instead, mirroring
// src/lib/db/creditCards.js#getCCSettings / #updateCCSettings.
export async function GET() {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  try {
    const sql = getNeonSql()
    const [row] = await sql`
      SELECT cc_coverage_pct, cc_optimization_pct FROM user_profiles WHERE id = ${userId}
    `
    return Response.json({
      coveragePct: row?.cc_coverage_pct ?? 80,
      optimizationPct: row?.cc_optimization_pct ?? 100,
    })
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

  const coveragePct = body?.coveragePct ?? body?.cc_coverage_pct
  const optimizationPct = body?.optimizationPct ?? body?.cc_optimization_pct

  if (coveragePct === undefined || coveragePct === null) {
    return Response.json({ error: 'Field "coveragePct" is required.' }, { status: 400 })
  }
  if (optimizationPct === undefined || optimizationPct === null) {
    return Response.json({ error: 'Field "optimizationPct" is required.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()
    const [row] = await sql`
      UPDATE user_profiles
      SET cc_coverage_pct = ${coveragePct}, cc_optimization_pct = ${optimizationPct}
      WHERE id = ${userId}
      RETURNING cc_coverage_pct, cc_optimization_pct
    `
    if (!row) {
      return Response.json({ error: 'Profile not found.' }, { status: 404 })
    }
    return Response.json({
      coveragePct: row.cc_coverage_pct,
      optimizationPct: row.cc_optimization_pct,
    })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

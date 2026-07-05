import { getNeonSql } from '../../../src/lib/neon/client.js'
import { auth } from '../../../src/lib/neon/authServer.js'

export async function GET(request) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  // Mirrors src/lib/db/aiBriefings.js#getLatestBriefing: defaults to 'dashboard'.
  const moduleContext = searchParams.get('module_context') ?? 'dashboard'

  try {
    const sql = getNeonSql()
    const [row] = await sql`
      SELECT * FROM ai_briefings
      WHERE user_id = ${userId} AND module_context = ${moduleContext}
      ORDER BY generated_at DESC
      LIMIT 1
    `
    return Response.json(row ?? null)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request) {
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

  const {
    narrative,
    context_summary = null,
    module_context = 'dashboard',
  } = body || {}

  if (!narrative || typeof narrative !== 'string') {
    return Response.json({ error: 'Field "narrative" is required.' }, { status: 400 })
  }

  try {
    const sql = getNeonSql()
    // Mirrors src/lib/db/aiBriefings.js#saveBriefing: is_cached is always true
    // for briefings saved through this endpoint, generated_at set to now().
    const [row] = await sql`
      INSERT INTO ai_briefings
        (user_id, narrative, context_summary, module_context, is_cached, generated_at)
      VALUES
        (${userId}, ${narrative}, ${context_summary}, ${module_context}, true, now())
      RETURNING *
    `
    return Response.json(row, { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

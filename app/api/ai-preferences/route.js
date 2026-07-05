import { getNeonSql } from '../../../src/lib/neon/client.js'
import { auth } from '../../../src/lib/neon/authServer.js'

// Mirrors src/lib/db/aiPreferences.js#EMPTY: a missing row means the user
// has never personalized — the AI uses its neutral defaults.
const EMPTY = { preferences: {}, interview: null, grill_enabled: false }

export async function GET() {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }
  const userId = session.user.id

  try {
    const sql = getNeonSql()
    // WHERE user_id = ${userId} is the authorization boundary: a user can
    // only ever read their own single preferences row.
    const [row] = await sql`
      SELECT preferences, interview, grill_enabled
      FROM ai_preferences
      WHERE user_id = ${userId}
    `
    if (!row) {
      return Response.json({ ...EMPTY })
    }
    return Response.json({
      preferences: row.preferences ?? {},
      interview: row.interview ?? null,
      grill_enabled: !!row.grill_enabled,
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

  const { preferences, interview, grill_enabled } = body || {}

  try {
    const sql = getNeonSql()
    // Fetch-then-merge (rather than partial UPDATE ... COALESCE) so fields
    // explicitly set to null/undefined behave the same as
    // src/lib/db/aiPreferences.js#saveAIPreferences: only fields present in
    // the request body override the existing row; absent fields are left
    // untouched instead of being reset to a default.
    const [existing] = await sql`
      SELECT preferences, interview, grill_enabled
      FROM ai_preferences
      WHERE user_id = ${userId}
    `

    const merged = {
      preferences: preferences !== undefined ? preferences : (existing ? existing.preferences : {}),
      interview: interview !== undefined ? interview : (existing ? existing.interview : null),
      grill_enabled: grill_enabled !== undefined ? grill_enabled : (existing ? existing.grill_enabled : false),
    }

    const [row] = await sql`
      INSERT INTO ai_preferences (user_id, preferences, interview, grill_enabled, updated_at)
      VALUES (
        ${userId},
        ${JSON.stringify(merged.preferences ?? {})}::jsonb,
        ${merged.interview === null ? null : JSON.stringify(merged.interview)}::jsonb,
        ${!!merged.grill_enabled},
        now()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        preferences = EXCLUDED.preferences,
        interview = EXCLUDED.interview,
        grill_enabled = EXCLUDED.grill_enabled,
        updated_at = now()
      RETURNING preferences, interview, grill_enabled
    `
    return Response.json({
      preferences: row.preferences ?? {},
      interview: row.interview ?? null,
      grill_enabled: !!row.grill_enabled,
    })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

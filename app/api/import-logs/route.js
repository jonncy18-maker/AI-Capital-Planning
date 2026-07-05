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
    const rows = await sql`
      SELECT * FROM import_logs
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT 50
    `
    return Response.json(rows)
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
    filename = null,
    totalRows,
    inserted,
    skipped,
    unmappedCount = 0,
  } = body || {}

  try {
    const sql = getNeonSql()
    const [row] = await sql`
      INSERT INTO import_logs
        (user_id, filename, total_rows, inserted, skipped, unmapped_count)
      VALUES
        (${userId}, ${filename}, ${totalRows}, ${inserted}, ${skipped}, ${unmappedCount ?? 0})
      RETURNING id, created_at
    `
    return Response.json(row, { status: 201 })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

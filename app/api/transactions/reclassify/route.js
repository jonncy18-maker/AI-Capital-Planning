import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { getSessionOrToken } from '../../../../src/lib/neon/apiAuth.js'

const MAX_UPDATES = 500
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const isoDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? '').slice(0, 10))

// POST /api/transactions/reclassify
// Body: { updates: [{ id, category, group?, notes? }], dry_run? }
// Changes only category, "group" and notes. A field that is absent from an
// update is left as it is; date, amount, merchant, account and dedup_key are
// never written, so the dedup key keeps matching the original export.
export async function POST(request) {
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

  const updates = body?.updates
  if (!Array.isArray(updates) || updates.length === 0) {
    return Response.json({ error: 'Field "updates" must be a non-empty array.' }, { status: 400 })
  }
  if (updates.length > MAX_UPDATES) {
    return Response.json({ error: `At most ${MAX_UPDATES} updates per call.` }, { status: 400 })
  }
  for (const [i, u] of updates.entries()) {
    if (!u || typeof u.id !== 'string' || !UUID.test(u.id)) {
      return Response.json({ error: `Update ${i} needs a valid transaction "id".` }, { status: 400 })
    }
    if (typeof u.category !== 'string' || u.category.trim() === '') {
      return Response.json({ error: `Update ${i} needs a "category".` }, { status: 400 })
    }
  }
  const dryRun = body.dry_run === true
  const ids = [...new Set(updates.map(u => u.id))]

  try {
    const sql = getNeonSql()
    const before = await sql`
      SELECT id, date, merchant, amount, account, category, notes FROM transactions
      WHERE user_id = ${userId} AND id = ANY(${ids}::uuid[])
    `
    const byId = new Map(before.map(r => [r.id, r]))

    let updated = 0
    if (!dryRun && before.length > 0) {
      let withTags = false
      if (updates.some(u => 'tags' in u)) {
        const col = await sql`
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'transactions' AND column_name = 'tags'
        `
        withTags = col.length > 0
      }
      const found = updates.filter(u => byId.has(u.id)).map(u => ({
        id: u.id,
        category: u.category,
        set_group: 'group' in u,
        grp: u.group ?? null,
        set_notes: 'notes' in u,
        notes: u.notes ?? null,
        set_tags: withTags && 'tags' in u,
        tags: u.tags ?? null,
      }))
      const result = withTags ? await sql`
        UPDATE transactions t
        SET category = u.category,
            "group" = CASE WHEN u.set_group THEN u.grp ELSE t."group" END,
            notes = CASE WHEN u.set_notes THEN u.notes ELSE t.notes END,
            tags = CASE WHEN u.set_tags THEN u.tags ELSE t.tags END
        FROM jsonb_to_recordset(${JSON.stringify(found)}::jsonb)
          AS u(id uuid, category text, set_group boolean, grp text, set_notes boolean, notes text,
               set_tags boolean, tags text)
        WHERE t.user_id = ${userId} AND t.id = u.id
        RETURNING t.id
      ` : await sql`
        UPDATE transactions t
        SET category = u.category,
            "group" = CASE WHEN u.set_group THEN u.grp ELSE t."group" END,
            notes = CASE WHEN u.set_notes THEN u.notes ELSE t.notes END
        FROM jsonb_to_recordset(${JSON.stringify(found)}::jsonb)
          AS u(id uuid, category text, set_group boolean, grp text, set_notes boolean, notes text)
        WHERE t.user_id = ${userId} AND t.id = u.id
        RETURNING t.id
      `
      updated = result.length
    }

    const rows = updates.filter(u => byId.has(u.id)).map(u => {
      const b = byId.get(u.id)
      return {
        id: u.id,
        date: isoDate(b.date),
        merchant: b.merchant,
        amount: Number(b.amount),
        account: b.account,
        category_before: b.category,
        category_after: u.category,
        notes_before: b.notes,
        notes_after: 'notes' in u ? (u.notes ?? null) : b.notes,
      }
    })
    return Response.json({
      updated,
      not_found: ids.filter(id => !byId.has(id)),
      rows,
    })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

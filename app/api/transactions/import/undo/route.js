import { randomUUID } from 'node:crypto'
import { getNeonSql } from '../../../../../src/lib/neon/client.js'
import { getSessionOrToken } from '../../../../../src/lib/neon/apiAuth.js'
import { detectImportColumns } from '../../../../../src/lib/import/importColumns.js'
import {
  undoEligibility, planRows, planMappings, undoCounts, countsMatch, shapeUndoResult,
} from '../../../../../src/lib/import/undoPlan.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COUNT_KEYS = ['delete', 'restore', 'skip', 'remove_mappings']

const validExpected = (e) =>
  !!e && typeof e === 'object' && COUNT_KEYS.every(k => Number.isInteger(e[k]) && e[k] >= 0)

async function loadPlan(sql, userId, log, columns, removeAutoMappings) {
  const snapshots = await sql`
    SELECT transaction_id, kind, before_category, before_group, before_notes, before_tags,
           after_category, after_group, after_notes, after_tags, tags_tracked
    FROM import_log_rows
    WHERE import_log_id = ${log.id}::uuid AND user_id = ${userId}
  `
  const ids = snapshots.map(s => s.transaction_id)
  const current = ids.length === 0 ? [] : columns.tags
    ? await sql`
        SELECT id, date, merchant, amount, account, category, "group", notes, tags FROM transactions
        WHERE id = ANY(${ids}::uuid[]) AND user_id = ${userId}
      `
    : await sql`
        SELECT id, date, merchant, amount, account, category, "group", notes FROM transactions
        WHERE id = ANY(${ids}::uuid[]) AND user_id = ${userId}
      `
  const rows = planRows({ snapshots, currentById: new Map(current.map(r => [r.id, r])), columns })

  const recorded = await sql`
    SELECT budget_category_id, category FROM import_log_categories
    WHERE import_log_id = ${log.id}::uuid AND user_id = ${userId}
  `
  let mappings = []
  if (recorded.length > 0) {
    const catIds = recorded.map(r => r.budget_category_id)
    const cats = columns.mappingSource
      ? await sql`
          SELECT id, category, mapping_source FROM budget_categories
          WHERE id = ANY(${catIds}::uuid[]) AND user_id = ${userId}
        `
      : await sql`
          SELECT id, category FROM budget_categories
          WHERE id = ANY(${catIds}::uuid[]) AND user_id = ${userId}
        `
    const names = cats.map(c => c.category)
    const usage = names.length === 0 ? [] : await sql`
      SELECT category, array_agg(id) AS ids FROM transactions
      WHERE user_id = ${userId} AND category = ANY(${names})
      GROUP BY category
    `
    const referenced = await sql`
      SELECT c.id FROM budget_categories c
      WHERE c.user_id = ${userId} AND c.id = ANY(${catIds}::uuid[])
        AND (
          EXISTS (SELECT 1 FROM budget_line_items x WHERE x.category_id = c.id AND x.user_id = ${userId})
          OR EXISTS (SELECT 1 FROM scenario_adjustments x WHERE x.category_id = c.id AND x.user_id = ${userId})
          OR EXISTS (SELECT 1 FROM forecast_line_items x WHERE x.category_id = c.id AND x.user_id = ${userId})
          OR EXISTS (SELECT 1 FROM forecast_overrides x WHERE x.category_id = c.id AND x.user_id = ${userId})
          OR EXISTS (SELECT 1 FROM bills x WHERE x.forecast_category_id = c.id AND x.user_id = ${userId})
        )
    `
    mappings = planMappings({
      recorded,
      categoriesById: new Map(cats.map(c => [c.id, c])),
      usageByName: new Map(usage.map(u => [u.category, u.ids])),
      referencedIds: new Set(referenced.map(r => r.id)),
      toDelete: rows.toDelete,
      toRestore: rows.toRestore,
      columns,
    })
  }
  const plan = { ...rows, mappings }
  return { plan, counts: undoCounts(plan, removeAutoMappings) }
}

// POST /api/transactions/import/undo
// Body: { import_id, mode?: 'preview'|'commit', remove_auto_mappings?, expected? }
// Takes back one Monarch import. Preview reads only. Commit recomputes the
// plan, refuses if it no longer matches `expected`, then runs one transaction
// whose every write is guarded by a token only that transaction holds and by
// the row still equalling the snapshot taken at import time.
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

  const importId = body?.import_id
  const mode = body?.mode ?? 'preview'
  const removeAutoMappings = body?.remove_auto_mappings ?? false
  const expected = body?.expected
  if (typeof importId !== 'string' || !UUID_RE.test(importId)) {
    return Response.json({ error: 'Field "import_id" must be a UUID.' }, { status: 400 })
  }
  if (mode !== 'preview' && mode !== 'commit') {
    return Response.json({ error: 'Field "mode" must be "preview" or "commit".' }, { status: 400 })
  }
  if (typeof removeAutoMappings !== 'boolean') {
    return Response.json({ error: 'Field "remove_auto_mappings" must be a boolean.' }, { status: 400 })
  }
  if (mode === 'commit' && !validExpected(expected)) {
    return Response.json(
      { error: 'Commit needs "expected": the delete, restore, skip and remove_mappings counts from the preview.' },
      { status: 400 }
    )
  }

  try {
    const sql = getNeonSql()
    const columns = await detectImportColumns(sql)
    const [log] = columns.undo
      ? await sql`SELECT * FROM import_logs WHERE id = ${importId}::uuid AND user_id = ${userId}`
      : await sql`SELECT id, user_id, filename, created_at FROM import_logs WHERE id = ${importId}::uuid AND user_id = ${userId}`
    if (!log) return Response.json({ error: 'not_found' }, { status: 404 })

    const eligibility = undoEligibility(log, { columns })
    if (!eligibility.undoable) {
      if (eligibility.reason === 'already_undone') {
        return Response.json({ error: 'already_undone', undone_at: log.undone_at }, { status: 409 })
      }
      return Response.json({ error: 'not_undoable', reason: eligibility.reason }, { status: 422 })
    }

    const { plan, counts } = await loadPlan(sql, userId, log, columns, removeAutoMappings)
    const preview = shapeUndoResult({ mode: 'preview', log, plan, removeAutoMappings, columns })
    if (mode === 'preview') return Response.json(preview)

    if (!countsMatch(expected, counts)) {
      return Response.json({ error: 'plan_changed', expected, actual: counts, preview }, { status: 409 })
    }

    const token = randomUUID()
    const deleteIds = plan.toDelete
    const restoreIds = plan.toRestore.map(r => r.id)
    const removableIds = removeAutoMappings
      ? plan.mappings.filter(m => m.removable).map(m => m.budget_category_id)
      : []
    const planned = { ...counts, import_id: log.id, planned_at: new Date().toISOString() }
    const queries = [
      sql`
        UPDATE import_logs
        SET status = 'undone', undone_at = now(), undo_token = ${token}::uuid,
            undo_summary = ${JSON.stringify(planned)}::jsonb
        WHERE id = ${log.id}::uuid AND user_id = ${userId} AND status = 'committed'
        RETURNING undone_at
      `,
      columns.tags
        ? sql`
            DELETE FROM transactions t USING import_log_rows r
            WHERE r.import_log_id = ${log.id}::uuid AND r.user_id = ${userId} AND r.kind = 'insert'
              AND t.id = r.transaction_id AND t.user_id = ${userId}
              AND t.id = ANY(${deleteIds}::uuid[])
              AND coalesce(btrim(t.category), '') = coalesce(btrim(r.after_category), '')
              AND coalesce(btrim(t."group"), '') = coalesce(btrim(r.after_group), '')
              AND coalesce(btrim(t.notes), '') = coalesce(btrim(r.after_notes), '')
              AND (NOT r.tags_tracked OR coalesce(btrim(t.tags), '') = coalesce(btrim(r.after_tags), ''))
              AND EXISTS (
                SELECT 1 FROM import_logs WHERE id = ${log.id}::uuid AND user_id = ${userId} AND undo_token = ${token}::uuid
              )
            RETURNING t.id
          `
        : sql`
            DELETE FROM transactions t USING import_log_rows r
            WHERE r.import_log_id = ${log.id}::uuid AND r.user_id = ${userId} AND r.kind = 'insert'
              AND t.id = r.transaction_id AND t.user_id = ${userId}
              AND t.id = ANY(${deleteIds}::uuid[])
              AND coalesce(btrim(t.category), '') = coalesce(btrim(r.after_category), '')
              AND coalesce(btrim(t."group"), '') = coalesce(btrim(r.after_group), '')
              AND coalesce(btrim(t.notes), '') = coalesce(btrim(r.after_notes), '')
              AND EXISTS (
                SELECT 1 FROM import_logs WHERE id = ${log.id}::uuid AND user_id = ${userId} AND undo_token = ${token}::uuid
              )
            RETURNING t.id
          `,
      columns.tags
        ? sql`
            UPDATE transactions t
            SET category = r.before_category, "group" = r.before_group, notes = r.before_notes,
                tags = CASE WHEN r.tags_tracked THEN r.before_tags ELSE t.tags END
            FROM import_log_rows r
            WHERE r.import_log_id = ${log.id}::uuid AND r.user_id = ${userId} AND r.kind = 'reclassify'
              AND t.id = r.transaction_id AND t.user_id = ${userId}
              AND t.id = ANY(${restoreIds}::uuid[])
              AND coalesce(btrim(t.category), '') = coalesce(btrim(r.after_category), '')
              AND coalesce(btrim(t."group"), '') = coalesce(btrim(r.after_group), '')
              AND coalesce(btrim(t.notes), '') = coalesce(btrim(r.after_notes), '')
              AND (NOT r.tags_tracked OR coalesce(btrim(t.tags), '') = coalesce(btrim(r.after_tags), ''))
              AND EXISTS (
                SELECT 1 FROM import_logs WHERE id = ${log.id}::uuid AND user_id = ${userId} AND undo_token = ${token}::uuid
              )
            RETURNING t.id
          `
        : sql`
            UPDATE transactions t
            SET category = r.before_category, "group" = r.before_group, notes = r.before_notes
            FROM import_log_rows r
            WHERE r.import_log_id = ${log.id}::uuid AND r.user_id = ${userId} AND r.kind = 'reclassify'
              AND t.id = r.transaction_id AND t.user_id = ${userId}
              AND t.id = ANY(${restoreIds}::uuid[])
              AND coalesce(btrim(t.category), '') = coalesce(btrim(r.after_category), '')
              AND coalesce(btrim(t."group"), '') = coalesce(btrim(r.after_group), '')
              AND coalesce(btrim(t.notes), '') = coalesce(btrim(r.after_notes), '')
              AND EXISTS (
                SELECT 1 FROM import_logs WHERE id = ${log.id}::uuid AND user_id = ${userId} AND undo_token = ${token}::uuid
              )
            RETURNING t.id
          `,
    ]
    if (removeAutoMappings && columns.mappingSource) {
      // Runs after the deletes and restores so the usage check sees their effect.
      queries.push(sql`
        DELETE FROM budget_categories b
        WHERE b.user_id = ${userId} AND b.id = ANY(${removableIds}::uuid[])
          AND b.mapping_source = 'auto_import'
          AND NOT EXISTS (SELECT 1 FROM transactions x WHERE x.user_id = ${userId} AND x.category = b.category)
          AND NOT EXISTS (SELECT 1 FROM budget_line_items x WHERE x.user_id = ${userId} AND x.category_id = b.id)
          AND NOT EXISTS (SELECT 1 FROM scenario_adjustments x WHERE x.user_id = ${userId} AND x.category_id = b.id)
          AND NOT EXISTS (SELECT 1 FROM forecast_line_items x WHERE x.user_id = ${userId} AND x.category_id = b.id)
          AND NOT EXISTS (SELECT 1 FROM forecast_overrides x WHERE x.user_id = ${userId} AND x.category_id = b.id)
          AND NOT EXISTS (SELECT 1 FROM bills x WHERE x.user_id = ${userId} AND x.forecast_category_id = b.id)
          AND EXISTS (
            SELECT 1 FROM import_logs WHERE id = ${log.id}::uuid AND user_id = ${userId} AND undo_token = ${token}::uuid
          )
        RETURNING b.id
      `)
    }

    let results
    try {
      results = await sql.transaction(queries)
    } catch (err) {
      return Response.json({ error: err.message, committed: false }, { status: 500 })
    }

    const undoneAt = results[0]?.[0]?.undone_at
    if (!undoneAt) {
      return Response.json({ error: 'already_undone' }, { status: 409 })
    }
    const deleted = results[1]?.length ?? 0
    const restored = results[2]?.length ?? 0
    const removed = removeAutoMappings && columns.mappingSource ? (results[3]?.length ?? 0) : 0
    const raced = counts.delete + counts.restore + counts.remove_mappings - deleted - restored - removed
    if (raced > 0) {
      try {
        const actual = { ...planned, actual: { deleted, restored, mappings_removed: removed }, raced }
        await sql`
          UPDATE import_logs SET undo_summary = ${JSON.stringify(actual)}::jsonb
          WHERE id = ${log.id}::uuid AND user_id = ${userId} AND undo_token = ${token}::uuid
        `
      } catch { /* the undo itself is committed; the summary just keeps the planned counts */ }
    }

    return Response.json(shapeUndoResult({
      mode: 'commit',
      log,
      plan,
      commit: {
        undone_at: undoneAt,
        counts: {
          deleted, restored,
          skipped: counts.skip + Math.max(0, counts.delete - deleted) + Math.max(0, counts.restore - restored),
          mappings_removed: removed,
        },
        raced: Math.max(0, raced),
      },
    }))
  } catch (err) {
    return Response.json({ error: err.message, committed: false }, { status: 500 })
  }
}

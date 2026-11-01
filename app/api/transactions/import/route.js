import { getNeonSql } from '../../../../src/lib/neon/client.js'
import { getSessionOrToken } from '../../../../src/lib/neon/apiAuth.js'
import { parseMonarchCSV } from '../../../../src/lib/csv/monarchParser.js'
import { CATEGORY_SEED_DATA } from '../../../../src/lib/csv/categoryMap.js'
import { buildDedupKey } from '../../../../src/lib/db/transactions.js'
import { buildImportPlan, shapeImportResult } from '../../../../src/lib/import/monarchImportPlan.js'

const MAX_CSV_CHARS = 1_000_000
const MAX_ROWS = 2000
const BATCH = 500

const TOO_LARGE =
  'File too large for one call — split it into chunks of ~500 rows, each starting with the header row, on date boundaries.'

async function detectColumns(sql) {
  const found = await sql`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND ((table_name = 'budget_categories' AND column_name IN ('mapping_source', 'mapping_note'))
        OR (table_name = 'transactions' AND column_name = 'tags'))
  `
  const has = (t, c) => found.some(r => r.table_name === t && r.column_name === c)
  return {
    mappingSource: has('budget_categories', 'mapping_source') && has('budget_categories', 'mapping_note'),
    tags: has('transactions', 'tags'),
  }
}

async function loadExisting(sql, userId, keys, columns) {
  const rows = columns.tags
    ? await sql`
        SELECT id, dedup_key, category, "group", notes, tags FROM transactions
        WHERE user_id = ${userId} AND dedup_key = ANY(${keys})
      `
    : await sql`
        SELECT id, dedup_key, category, "group", notes FROM transactions
        WHERE user_id = ${userId} AND dedup_key = ANY(${keys})
      `
  return new Map(rows.map(r => [r.dedup_key, r]))
}

function chunked(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

// Every statement of a commit, in execution order. `kind` lets the caller read
// the right result back out of sql.transaction()'s positional result array.
function buildStatements(sql, userId, plan, columns, logRow) {
  const statements = []

  if (plan.seedToInsert.length > 0) {
    const seed = plan.seedToInsert.map(s => ({
      category: s.category, grp: s.group, type: s.type, exclude: !!s.exclude,
    }))
    statements.push({
      kind: 'seed',
      query: sql`
        INSERT INTO budget_categories (user_id, category, "group", type, exclude_from_totals, is_active)
        SELECT ${userId}::uuid, t.category, t.grp, t.type, t.exclude, true
        FROM jsonb_to_recordset(${JSON.stringify(seed)}::jsonb)
          AS t(category text, grp text, type text, exclude boolean)
        WHERE NOT EXISTS (
          SELECT 1 FROM budget_categories b WHERE b.user_id = ${userId}::uuid AND b.category = t.category
        )
      `,
    })
  }

  if (plan.autoMappings.length > 0) {
    const maps = plan.autoMappings.map(a => ({
      category: a.category,
      grp: a.group,
      type: a.type,
      note: `${a.reason}${a.matched_to ? `:${a.matched_to}` : ''}${a.similarity != null ? ` (${a.similarity})` : ''}`,
    }))
    statements.push({
      kind: 'mapping',
      query: columns.mappingSource
        ? sql`
            INSERT INTO budget_categories
              (user_id, category, "group", type, exclude_from_totals, is_active, mapping_source, mapping_note)
            SELECT ${userId}::uuid, t.category, t.grp, t.type, false, true, 'auto_import', t.note
            FROM jsonb_to_recordset(${JSON.stringify(maps)}::jsonb)
              AS t(category text, grp text, type text, note text)
            WHERE NOT EXISTS (
              SELECT 1 FROM budget_categories b WHERE b.user_id = ${userId}::uuid AND b.category = t.category
            )
          `
        : sql`
            INSERT INTO budget_categories (user_id, category, "group", type, exclude_from_totals, is_active)
            SELECT ${userId}::uuid, t.category, t.grp, t.type, false, true
            FROM jsonb_to_recordset(${JSON.stringify(maps)}::jsonb)
              AS t(category text, grp text, type text, note text)
            WHERE NOT EXISTS (
              SELECT 1 FROM budget_categories b WHERE b.user_id = ${userId}::uuid AND b.category = t.category
            )
          `,
    })
  }

  for (const batch of chunked(plan.newRows, BATCH)) {
    const prepared = batch.map(r => ({
      user_id: userId,
      date: r.date,
      merchant: r.merchant,
      category: r.category ?? null,
      group: r.group ?? null,
      account: r.account ?? null,
      amount: r.amount,
      original_statement: r.originalStatement ?? null,
      notes: r.notes ?? null,
      owner: r.owner ?? null,
      import_source: r.importSource ?? 'monarch_csv',
      dedup_key: buildDedupKey(r),
      tags: r.tags ?? null,
    }))
    statements.push({
      kind: 'insert',
      query: columns.tags
        ? sql`
            INSERT INTO transactions
              (user_id, date, merchant, category, "group", account, amount,
               original_statement, notes, owner, import_source, dedup_key, tags)
            SELECT
              user_id, date, merchant, category, "group", account, amount,
              original_statement, notes, owner, import_source, dedup_key, tags
            FROM jsonb_to_recordset(${JSON.stringify(prepared)}::jsonb) AS t(
              user_id uuid, date date, merchant text, category text, "group" text,
              account text, amount numeric, original_statement text, notes text,
              owner text, import_source text, dedup_key text, tags text
            )
            ON CONFLICT (user_id, dedup_key) DO NOTHING
            RETURNING id
          `
        : sql`
            INSERT INTO transactions
              (user_id, date, merchant, category, "group", account, amount,
               original_statement, notes, owner, import_source, dedup_key)
            SELECT
              user_id, date, merchant, category, "group", account, amount,
              original_statement, notes, owner, import_source, dedup_key
            FROM jsonb_to_recordset(${JSON.stringify(prepared)}::jsonb) AS t(
              user_id uuid, date date, merchant text, category text, "group" text,
              account text, amount numeric, original_statement text, notes text,
              owner text, import_source text, dedup_key text
            )
            ON CONFLICT (user_id, dedup_key) DO NOTHING
            RETURNING id
          `,
    })
  }

  for (const batch of chunked(plan.reclassifications.map(r => r.update), BATCH)) {
    statements.push({
      kind: 'update',
      query: columns.tags
        ? sql`
            UPDATE transactions t
            SET category = u.category, "group" = u.grp, notes = u.notes, tags = u.tags
            FROM jsonb_to_recordset(${JSON.stringify(batch.map(({ group, ...rest }) => ({ ...rest, grp: group })))}::jsonb)
              AS u(id uuid, dedup_key text, category text, grp text, notes text, tags text)
            WHERE t.user_id = ${userId}::uuid AND t.id = u.id AND t.dedup_key = u.dedup_key
            RETURNING t.id
          `
        : sql`
            UPDATE transactions t
            SET category = u.category, "group" = u.grp, notes = u.notes
            FROM jsonb_to_recordset(${JSON.stringify(batch.map(({ group, ...rest }) => ({ ...rest, grp: group })))}::jsonb)
              AS u(id uuid, dedup_key text, category text, grp text, notes text)
            WHERE t.user_id = ${userId}::uuid AND t.id = u.id AND t.dedup_key = u.dedup_key
            RETURNING t.id
          `,
    })
  }

  statements.push({
    kind: 'log',
    query: sql`
      INSERT INTO import_logs (user_id, filename, total_rows, inserted, skipped, unmapped_count)
      VALUES (${userId}, ${logRow.filename}, ${logRow.total_rows}, ${logRow.inserted},
              ${logRow.skipped}, ${logRow.unmapped_count})
      RETURNING id
    `,
  })

  return statements
}

// POST /api/transactions/import
// Body: { csv, mode: 'preview'|'commit', filename?, chunk?, category_groups? }
// Server-side Monarch CSV import: parse, dedupe against the (user_id, dedup_key)
// key, map unknown categories deterministically, then either report the plan
// (preview, SELECT-only) or execute it in a single transaction (commit).
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

  const { csv, filename, chunk, category_groups: categoryGroups } = body ?? {}
  const mode = body?.mode ?? 'preview'
  if (typeof csv !== 'string' || csv.trim() === '') {
    return Response.json({ error: 'Field "csv" must be a non-empty string.' }, { status: 400 })
  }
  if (mode !== 'preview' && mode !== 'commit') {
    return Response.json({ error: 'Field "mode" must be "preview" or "commit".' }, { status: 400 })
  }
  if (csv.length > MAX_CSV_CHARS) {
    return Response.json({ error: TOO_LARGE }, { status: 413 })
  }
  if (chunk != null) {
    const { index, count } = chunk
    if (!Number.isInteger(index) || !Number.isInteger(count) || index < 1 || count < 1 || index > count) {
      return Response.json({ error: 'Field "chunk" must be { index, count } with 1 <= index <= count.' }, { status: 400 })
    }
  }
  if (categoryGroups != null) {
    const ok = typeof categoryGroups === 'object' && !Array.isArray(categoryGroups) &&
      Object.values(categoryGroups).every(v => typeof v === 'string')
    if (!ok) {
      return Response.json({ error: 'Field "category_groups" must map category names to group names.' }, { status: 400 })
    }
  }

  const parsed = parseMonarchCSV(csv)
  if (parsed.rows.length === 0) {
    return Response.json({ error: 'No importable rows.', errors: parsed.errors }, { status: 400 })
  }
  if (parsed.rows.length > MAX_ROWS) {
    return Response.json({ error: TOO_LARGE }, { status: 413 })
  }

  const logName = `${filename || 'mcp-import.csv'}${chunk ? ` (part ${chunk.index}/${chunk.count})` : ''}`

  try {
    const sql = getNeonSql()
    const columns = await detectColumns(sql)
    const categories = await sql`SELECT * FROM budget_categories WHERE user_id = ${userId}`
    const keys = [...new Set(parsed.rows.map(buildDedupKey))]
    const existingByKey = await loadExisting(sql, userId, keys, columns)

    const plan = buildImportPlan({
      parsedRows: parsed.rows,
      parseErrors: parsed.errors,
      existingByKey,
      categories,
      seedData: CATEGORY_SEED_DATA,
      categoryGroups: categoryGroups ?? {},
      columns,
    })
    const shape = { filename: logName, chunk: chunk ?? undefined, columns }

    if (mode === 'preview') {
      return Response.json(shapeImportResult(plan, { mode, ...shape }))
    }

    const c = plan.counts
    const statements = buildStatements(sql, userId, plan, columns, {
      filename: logName,
      total_rows: c.parsed,
      inserted: c.new,
      skipped: c.duplicate + c.ambiguous_rows + c.collapsed_identical,
      unmapped_count: plan.autoMappings.length,
    })
    let results
    try {
      results = await sql.transaction(statements.map(s => s.query))
    } catch (err) {
      return Response.json(
        { error: err.message, committed: false, inserted: 0, reclassified: 0 },
        { status: 500 }
      )
    }

    const countOf = (kind) => statements.reduce(
      (n, s, i) => (s.kind === kind ? n + (results[i]?.length ?? 0) : n), 0)
    const inserted = countOf('insert')
    const logIndex = statements.findIndex(s => s.kind === 'log')
    const commit = {
      inserted,
      skipped_duplicate: c.new - inserted,
      reclassified: countOf('update'),
      import_log_id: results[logIndex]?.[0]?.id ?? null,
    }
    return Response.json(shapeImportResult(plan, { mode, ...shape, commit }))
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

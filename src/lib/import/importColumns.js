// One information_schema read that tells the import and undo routes which
// optional migrations (028 markers/tags, 030 undo) are applied.
export async function detectImportColumns(sql) {
  const found = await sql`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND ((table_name = 'budget_categories' AND column_name IN ('mapping_source', 'mapping_note'))
        OR (table_name = 'transactions' AND column_name IN ('tags', 'import_log_id'))
        OR (table_name = 'import_logs' AND column_name IN ('status', 'undo_token'))
        OR (table_name = 'import_log_rows' AND column_name = 'tags_tracked')
        OR (table_name = 'import_log_categories' AND column_name = 'budget_category_id'))
  `
  const has = (t, c) => found.some(r => r.table_name === t && r.column_name === c)
  return {
    mappingSource: has('budget_categories', 'mapping_source') && has('budget_categories', 'mapping_note'),
    tags: has('transactions', 'tags'),
    undo: has('import_logs', 'status') && has('import_logs', 'undo_token') &&
      has('transactions', 'import_log_id') && has('import_log_rows', 'tags_tracked') &&
      has('import_log_categories', 'budget_category_id'),
  }
}

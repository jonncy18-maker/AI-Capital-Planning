// Monarch CSV import (MCP only). The CSV travels as a tool argument and is
// parsed, deduplicated and categorised server-side; see
// app/api/transactions/import/route.js and src/lib/import/monarchImportPlan.js.

import { importMonarchCsv } from '../../../db/transactions.js'
import { getImportHistory, previewImportUndo, commitImportUndo } from '../../../db/importLog.js'
import { requireField } from '../helpers.js'
import { MODE_PROP } from './shared.js'

function oneLine(r) {
  const c = r.counts
  const tail = r.committed
    ? `${c.inserted} inserted, ${c.skipped_duplicate} skipped as already present`
    : 'Nothing saved'
  return `${r.committed ? 'Committed' : 'Preview'}: ${c.new} new, ${c.duplicate} already imported, ${c.reclassified} reclassified, ` +
    `${c.ambiguous_rows} ambiguous, ${r.auto_mappings.length} categories auto-mapped. ${tail}.`
}

function undoLine(r) {
  const c = r.counts
  return r.committed
    ? `Undone: deleted ${c.deleted}, restored ${c.restored}, skipped ${c.skipped}, removed ${c.mappings_removed} categories.`
    : `Preview: would delete ${c.delete}, restore ${c.restore}, skip ${c.skip}. Nothing changed.`
}

export const importTools = [
  {
    name: 'import_monarch_transactions',
    group: 'import',
    write: true,
    // Handles `mode` itself: its preview is the full dry-run plan.
    mcpGated: false,
    schema: {
      name: 'import_monarch_transactions',
      description:
        'Import a Monarch Money transactions CSV export, the same way the app\'s import screen does: deduplicated, ' +
        'categorised and logged. mode defaults to "preview", which saves nothing and returns the plan: new rows, rows already imported, ' +
        'rows whose category or notes changed in Monarch (reclassified, applied only on commit), ambiguous rows (skipped) and categories ' +
        'that would be auto-created. Call again with mode:"commit" to apply. Re-sending overlapping exports is safe. ' +
        'Limits: at most 2,000 rows or 1 MB per call, ~500 rows recommended; split larger files on date boundaries and put the header row ' +
        'in every chunk, passing chunk {index,count}; commit chunks in order. Unknown categories never block the import: each is mapped to ' +
        'a group by name match, the optional category_groups input, closest name, or Uncategorized, and created as a budget category. ' +
        'Review them in auto_mappings and undo with save_budget_category or delete_budget_category. Monarch transaction ids are not in ' +
        'the export, so duplicates are detected by date, merchant, amount and account (identical purchases on one day collapse to one row).',
      input_schema: {
        type: 'object',
        properties: {
          csv: { type: 'string', description: 'The full Monarch export text, or one chunk that starts with the header row.' },
          mode: MODE_PROP,
          filename: { type: 'string', description: 'Shown in the import history.' },
          chunk: {
            type: 'object',
            properties: { index: { type: 'integer' }, count: { type: 'integer' } },
            description: 'When the file is split: this chunk\'s 1-based index and the total chunk count.',
          },
          category_groups: {
            type: 'object',
            description: 'Optional map of Monarch category name to its Monarch group, used to place unknown categories.',
            additionalProperties: { type: 'string' },
          },
        },
        required: ['csv'],
      },
    },
    async preview(input) {
      const r = await importMonarchCsv(null, { ...input, mode: 'preview' })
      return { title: 'Import Monarch transactions', subtitle: oneLine(r), rows: [] }
    },
    async execute(userId, input) {
      requireField(input, 'csv')
      const mode = input.mode === 'commit' ? 'commit' : 'preview'
      const result = await importMonarchCsv(userId, {
        csv: input.csv, mode, filename: input.filename, chunk: input.chunk, category_groups: input.category_groups,
      })
      return { summary: oneLine(result), result }
    },
  },
  {
    name: 'list_monarch_imports',
    group: 'import',
    write: false,
    schema: {
      name: 'list_monarch_imports',
      description:
        'List recent import history (newest first) with the id, counts, status and whether it can be undone with undo_monarch_import. ' +
        'Chunked imports appear as one entry per chunk.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 50, description: 'How many imports to return (default 20).' },
        },
      },
    },
    async execute(userId, input) {
      const limit = Number.isInteger(input?.limit) ? Math.min(50, Math.max(1, input.limit)) : 20
      const logs = (await getImportHistory(userId)).slice(0, limit)
      const imports = logs.map(l => ({
        id: l.id,
        filename: l.filename,
        created_at: l.created_at,
        inserted: l.inserted,
        reclassified: l.reclassified ?? null,
        categories_auto_mapped: l.categories_auto_mapped ?? null,
        status: l.status ?? null,
        undone_at: l.undone_at ?? null,
        undoable: !!l.undoable,
        not_undoable_reason: l.not_undoable_reason ?? null,
      }))
      const undoable = imports.filter(i => i.undoable).length
      return { summary: `${imports.length} imports, ${undoable} can be undone.`, result: { imports } }
    },
  },
  {
    name: 'undo_monarch_import',
    group: 'import',
    write: true,
    // Handles `mode` itself: its preview is the full dry-run plan.
    mcpGated: false,
    schema: {
      name: 'undo_monarch_import',
      description:
        'Undo one Monarch import by its id (see list_monarch_imports). mode defaults to "preview", which changes nothing and reports how many rows ' +
        'would be deleted, restored to their previous category/notes/tags, or skipped. Rows edited or deleted since the import are skipped and listed, ' +
        'never overwritten. Call again with mode:"commit" and the expected counts from the preview to apply. Set remove_auto_mappings to also remove ' +
        'categories the import auto-created, only where nothing uses them. One import log per call: a chunked import is several logs, undo each. ' +
        'Imports older than 90 days and imports made before migration 030 cannot be undone.',
      input_schema: {
        type: 'object',
        properties: {
          import_id: { type: 'string', description: 'The import log id from list_monarch_imports.' },
          mode: MODE_PROP,
          remove_auto_mappings: { type: 'boolean', description: 'Also remove auto-created categories that nothing uses (default false).' },
          expected: {
            type: 'object',
            description: 'Required for commit: copy the expected object from the preview ({delete, restore, skip, remove_mappings}).',
            properties: {
              delete: { type: 'integer' }, restore: { type: 'integer' }, skip: { type: 'integer' }, remove_mappings: { type: 'integer' },
            },
          },
        },
        required: ['import_id'],
      },
    },
    async preview(input) {
      const r = await previewImportUndo(null, input.import_id, { removeAutoMappings: !!input.remove_auto_mappings })
      return { title: 'Undo Monarch import', subtitle: undoLine(r), rows: [] }
    },
    async execute(userId, input) {
      requireField(input, 'import_id')
      const removeAutoMappings = !!input.remove_auto_mappings
      const result = input.mode === 'commit'
        ? await commitImportUndo(userId, input.import_id, { expected: input.expected, removeAutoMappings })
        : await previewImportUndo(userId, input.import_id, { removeAutoMappings })
      return { summary: undoLine(result), result }
    },
  },
]

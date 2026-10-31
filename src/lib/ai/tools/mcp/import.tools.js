// Monarch CSV import (MCP only). The CSV travels as a tool argument and is
// parsed, deduplicated and categorised server-side; see
// app/api/transactions/import/route.js and src/lib/import/monarchImportPlan.js.

import { importMonarchCsv } from '../../../db/transactions.js'
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
]

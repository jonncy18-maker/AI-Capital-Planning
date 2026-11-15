// Pure planning step for undoing a Monarch import (no I/O). The route reads the
// snapshots and the current rows, this decides what is safe to touch: a row is
// only deleted or restored while it still equals what the import left behind.
// Anything John changed since is skipped and listed, never overwritten.

export const UNDO_WINDOW_DAYS = 90
export const SKIP_LIST_LIMIT = 200

const DAY_MS = 24 * 60 * 60 * 1000

export const n = (v) => String(v ?? '').trim()

export function undoEligibility(log, { columns, now = new Date() } = {}) {
  if (!columns?.undo) return { undoable: false, reason: 'migration_not_applied' }
  if (log.source !== 'monarch_import' || log.status == null) return { undoable: false, reason: 'pre_migration' }
  if (log.status === 'undone') return { undoable: false, reason: 'already_undone' }
  const age = new Date(now).getTime() - new Date(log.created_at).getTime()
  if (age > UNDO_WINDOW_DAYS * DAY_MS) return { undoable: false, reason: 'expired' }
  return { undoable: true, reason: null }
}

function comparedFields(snapshot, columns) {
  const fields = ['category', 'group', 'notes']
  if (columns.tags && snapshot.tags_tracked) fields.push('tags')
  return fields
}

export function planRows({ snapshots, currentById, columns }) {
  const toDelete = []
  const toRestore = []
  const skipped = []

  for (const s of snapshots) {
    const cur = currentById.get(s.transaction_id)
    if (!cur) {
      skipped.push({ transaction_id: s.transaction_id, kind: s.kind, reason: 'deleted' })
      continue
    }
    const fields = comparedFields(s, columns)
    const changed = fields.filter(f => n(cur[f]) !== n(s[`after_${f}`]))
    if (changed.length > 0) {
      skipped.push({
        transaction_id: s.transaction_id,
        kind: s.kind,
        reason: 'edited',
        changed,
        current: Object.fromEntries(changed.map(f => [f, cur[f] ?? null])),
        snapshot: Object.fromEntries(changed.map(f => [f, s[`after_${f}`] ?? null])),
        date: cur.date, merchant: cur.merchant, amount: cur.amount, account: cur.account,
      })
    } else if (s.kind === 'insert') {
      toDelete.push(s.transaction_id)
    } else {
      const before = { category: s.before_category, group: s.before_group, notes: s.before_notes }
      if (columns.tags && s.tags_tracked) before.tags = s.before_tags
      toRestore.push({ id: s.transaction_id, before })
    }
  }
  return { toDelete, toRestore, skipped }
}

// Which auto-created categories could be removed without orphaning anything.
// `usageByName`: Map of category name -> ids of transactions that use it now.
// `referencedIds`: Set of category ids still referenced by budget lines,
// scenarios, forecast rows, overrides or bills.
export function planMappings({ recorded, categoriesById, usageByName, referencedIds, toDelete, toRestore, columns }) {
  const deleted = new Set(toDelete)
  const restoreCategory = new Map(toRestore.map(r => [r.id, n(r.before.category)]))

  return recorded.map(rec => {
    const out = (removable, reason) => ({
      budget_category_id: rec.budget_category_id, category: rec.category, removable, reason,
    })
    if (!columns.mappingSource) return out(false, 'no_marker_column')
    const cat = categoriesById.get(rec.budget_category_id)
    if (!cat) return out(false, 'already_removed')
    if (cat.mapping_source !== 'auto_import') return out(false, 'not_auto_created')
    // Renamed since the import: the user has taken ownership, so keep it.
    if (n(cat.category) !== n(rec.category)) return out(false, 'edited')
    if (referencedIds.has(rec.budget_category_id)) return out(false, 'referenced')

    const name = n(cat.category)
    const stays = (usageByName.get(cat.category) ?? []).some(id => {
      if (deleted.has(id)) return false
      return !restoreCategory.has(id) || restoreCategory.get(id) === name
    })
    const returns = toRestore.some(r => n(r.before.category) === name)
    return stays || returns ? out(false, 'in_use') : out(true, null)
  })
}

export function undoCounts(plan, removeAutoMappings) {
  const removable = plan.mappings.filter(m => m.removable).length
  return {
    delete: plan.toDelete.length,
    restore: plan.toRestore.length,
    skip: plan.skipped.length,
    remove_mappings: removeAutoMappings ? removable : 0,
  }
}

const COUNT_KEYS = ['delete', 'restore', 'skip', 'remove_mappings']

export function countsMatch(expected, actual) {
  return !!expected && !!actual && COUNT_KEYS.every(k => expected[k] === actual[k])
}

// Response bodies for the undo route. `plan` is { toDelete, toRestore, skipped, mappings }.
export function shapeUndoResult({ mode, log, plan, removeAutoMappings = false, columns = {}, commit = null }) {
  if (mode === 'commit') {
    return {
      mode: 'commit',
      committed: true,
      import_id: log.id,
      undone_at: commit.undone_at,
      counts: commit.counts,
      raced: commit.raced,
    }
  }
  const skipped = plan.skipped.slice(0, SKIP_LIST_LIMIT)
  return {
    mode: 'preview',
    committed: false,
    import_id: log.id,
    filename: log.filename,
    created_at: log.created_at,
    counts: {
      delete: plan.toDelete.length,
      restore: plan.toRestore.length,
      skip: plan.skipped.length,
      skip_edited: plan.skipped.filter(s => s.reason === 'edited').length,
      skip_deleted: plan.skipped.filter(s => s.reason === 'deleted').length,
      mappings_recorded: plan.mappings.length,
      mappings_removable: plan.mappings.filter(m => m.removable).length,
    },
    skipped,
    ...(plan.skipped.length > skipped.length ? { skipped_truncated: plan.skipped.length - skipped.length } : {}),
    mappings: plan.mappings,
    expected: undoCounts(plan, removeAutoMappings),
    tags_compared: !!columns.tags,
    marker_column_present: !!columns.mappingSource,
    next: 'Nothing was changed. Call again with mode:"commit", passing expected.',
  }
}

import { describe, it, expect } from 'vitest'
import {
  undoEligibility, planRows, planMappings, undoCounts, countsMatch, shapeUndoResult, n,
  UNDO_WINDOW_DAYS, SKIP_LIST_LIMIT,
} from '../../src/lib/import/undoPlan.js'

const NOW = new Date('2026-11-01T00:00:00Z')
const DAY = 86_400_000
const ago = (days) => new Date(NOW.getTime() - days * DAY).toISOString()
const ON = { undo: true, tags: true, mappingSource: true }
const log = (over = {}) => ({ id: 'l1', source: 'monarch_import', status: 'committed', created_at: ago(1), ...over })

describe('undoEligibility', () => {
  it('is undoable for a recent committed Monarch import', () => {
    expect(undoEligibility(log(), { columns: ON, now: NOW })).toEqual({ undoable: true, reason: null })
  })
  it('reports migration_not_applied', () => {
    expect(undoEligibility(log(), { columns: { undo: false }, now: NOW }).reason).toBe('migration_not_applied')
  })
  it('reports pre_migration for a different source or null status', () => {
    expect(undoEligibility(log({ source: null }), { columns: ON, now: NOW }).reason).toBe('pre_migration')
    expect(undoEligibility(log({ source: 'app_import' }), { columns: ON, now: NOW }).reason).toBe('pre_migration')
    expect(undoEligibility(log({ status: null }), { columns: ON, now: NOW }).reason).toBe('pre_migration')
  })
  it('reports already_undone', () => {
    expect(undoEligibility(log({ status: 'undone' }), { columns: ON, now: NOW }).reason).toBe('already_undone')
  })
  it('reports expired after the window, regardless of pruning', () => {
    expect(UNDO_WINDOW_DAYS).toBe(90)
    expect(undoEligibility(log({ created_at: ago(91) }), { columns: ON, now: NOW }).reason).toBe('expired')
    expect(undoEligibility(log({ created_at: ago(89) }), { columns: ON, now: NOW }).undoable).toBe(true)
  })
})

const snap = (over = {}) => ({
  transaction_id: 't1', kind: 'insert', tags_tracked: false,
  before_category: 'Old', before_group: 'OG', before_notes: 'on', before_tags: 'ot',
  after_category: 'Cat', after_group: 'Grp', after_notes: 'note', after_tags: 'tag',
  ...over,
})
const cur = (over = {}) => ({
  id: 't1', date: '2026-10-01', merchant: 'M', amount: -5, account: 'A',
  category: 'Cat', group: 'Grp', notes: 'note', tags: 'tag', ...over,
})
const rows = (snapshots, current, columns = ON) =>
  planRows({ snapshots, currentById: new Map(current.map(c => [c.id, c])), columns })

describe('planRows', () => {
  it('deletes an untouched inserted row', () => {
    expect(rows([snap()], [cur()]).toDelete).toEqual(['t1'])
  })
  it('restores an untouched reclassified row with group and tags', () => {
    const p = rows([snap({ kind: 'reclassify', tags_tracked: true })], [cur()])
    expect(p.toRestore).toEqual([{ id: 't1', before: { category: 'Old', group: 'OG', notes: 'on', tags: 'ot' } }])
  })
  it('skips a deleted row', () => {
    expect(rows([snap()], []).skipped[0]).toMatchObject({ transaction_id: 't1', reason: 'deleted' })
  })
  it('skips an edited row with the changed list and context', () => {
    const p = rows([snap()], [cur({ category: 'Other', notes: 'mine' })])
    expect(p.toDelete).toEqual([])
    expect(p.skipped[0]).toMatchObject({
      reason: 'edited', changed: ['category', 'notes'], merchant: 'M', amount: -5, account: 'A', date: '2026-10-01',
      current: { category: 'Other', notes: 'mine' }, snapshot: { category: 'Cat', notes: 'note' },
    })
  })
  it('treats null, empty and whitespace as equal', () => {
    expect(n(null)).toBe('')
    const p = rows([snap({ after_notes: null }), snap({ transaction_id: 't2', after_notes: '  ' })],
      [cur({ notes: '' }), cur({ id: 't2', notes: null })])
    expect(p.toDelete).toEqual(['t1', 't2'])
  })
  it('ignores tags when untracked or when the column is absent', () => {
    expect(rows([snap()], [cur({ tags: 'changed' })]).toDelete).toEqual(['t1'])
    expect(rows([snap({ tags_tracked: true })], [cur({ tags: 'changed' })], { ...ON, tags: false }).toDelete).toEqual(['t1'])
    expect(rows([snap({ tags_tracked: true })], [cur({ tags: 'changed' })]).skipped[0].changed).toEqual(['tags'])
  })
  it('leaves tags out of the restore when not tracked', () => {
    const p = rows([snap({ kind: 'reclassify' })], [cur()])
    expect(p.toRestore[0].before).not.toHaveProperty('tags')
  })
})

const base = () => ({
  recorded: [{ budget_category_id: 'c1', category: 'Auto' }],
  categoriesById: new Map([['c1', { id: 'c1', category: 'Auto', mapping_source: 'auto_import' }]]),
  usageByName: new Map(),
  referencedIds: new Set(),
  toDelete: [], toRestore: [], columns: ON,
})
const map = (over) => planMappings({ ...base(), ...over })[0]

describe('planMappings', () => {
  it('is removable when nothing uses the category', () => {
    expect(map({})).toMatchObject({ budget_category_id: 'c1', category: 'Auto', removable: true })
  })
  it('is not removable without the marker column', () => {
    expect(map({ columns: { ...ON, mappingSource: false } })).toMatchObject({ removable: false, reason: 'no_marker_column' })
  })
  it('is not removable when the marker is not auto_import', () => {
    const categoriesById = new Map([['c1', { id: 'c1', category: 'Auto', mapping_source: null }]])
    expect(map({ categoriesById }).removable).toBe(false)
  })
  it('is not removable once the user renamed it', () => {
    const categoriesById = new Map([['c1', { id: 'c1', category: 'My Auto', mapping_source: 'auto_import' }]])
    expect(map({ categoriesById })).toMatchObject({ removable: false, reason: 'edited' })
  })
  it('is not removable when referenced elsewhere', () => {
    expect(map({ referencedIds: new Set(['c1']) })).toMatchObject({ removable: false, reason: 'referenced' })
  })
  it('is not removable when another transaction uses it', () => {
    expect(map({ usageByName: new Map([['Auto', ['other']]]) })).toMatchObject({ removable: false, reason: 'in_use' })
  })
  it('is not removable once the category itself is gone', () => {
    expect(map({ categoriesById: new Map() }).removable).toBe(false)
  })
  it('is removable when only the rows being deleted use it', () => {
    expect(map({ usageByName: new Map([['Auto', ['a', 'b']]]), toDelete: ['a', 'b'] }).removable).toBe(true)
  })
  it('stays when a restored row keeps it or a restore brings it back', () => {
    const keeps = map({
      usageByName: new Map([['Auto', ['a']]]),
      toRestore: [{ id: 'a', before: { category: 'Auto' } }],
    })
    expect(keeps.removable).toBe(false)
    const returns = map({ toRestore: [{ id: 'z', before: { category: 'Auto' } }] })
    expect(returns.removable).toBe(false)
  })
  it('is removable when restored rows move off it', () => {
    expect(map({
      usageByName: new Map([['Auto', ['a']]]),
      toRestore: [{ id: 'a', before: { category: 'Old' } }],
    }).removable).toBe(true)
  })
})

describe('counts', () => {
  const plan = {
    toDelete: ['a', 'b'], toRestore: [{ id: 'c' }], skipped: [{ reason: 'edited' }, { reason: 'deleted' }],
    mappings: [{ removable: true }, { removable: false }],
  }
  it('counts remove_mappings only when ticked', () => {
    expect(undoCounts(plan, true)).toEqual({ delete: 2, restore: 1, skip: 2, remove_mappings: 1 })
    expect(undoCounts(plan, false).remove_mappings).toBe(0)
  })
  it('countsMatch needs all four keys equal', () => {
    const a = undoCounts(plan, true)
    expect(countsMatch(a, { ...a })).toBe(true)
    expect(countsMatch(a, { ...a, skip: 3 })).toBe(false)
    expect(countsMatch(null, a)).toBe(false)
  })
})

describe('shapeUndoResult', () => {
  it('caps the skipped list and reports the overflow', () => {
    const skipped = Array.from({ length: SKIP_LIST_LIMIT + 5 }, (_, i) => ({ transaction_id: `t${i}`, reason: 'edited' }))
    const out = shapeUndoResult({
      mode: 'preview', log: { id: 'l1', filename: 'f', created_at: 'x' },
      plan: { toDelete: [], toRestore: [], skipped, mappings: [] }, columns: ON,
    })
    expect(out.skipped).toHaveLength(SKIP_LIST_LIMIT)
    expect(out.skipped_truncated).toBe(5)
    expect(out).toMatchObject({ committed: false, counts: { skip: SKIP_LIST_LIMIT + 5, skip_edited: SKIP_LIST_LIMIT + 5 } })
  })
})

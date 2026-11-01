import { describe, it, expect } from 'vitest'
import { buildImportPlan, shapeImportResult } from '../../src/lib/import/monarchImportPlan.js'
import { CATEGORY_SEED_DATA } from '../../src/lib/csv/categoryMap.js'
import { buildDedupKey } from '../../src/lib/db/transactions.js'

const r = (o = {}) => ({
  date: '2026-10-03', merchant: 'Starbucks', category: 'Coffee Shops', account: 'Amex', originalStatement: '',
  notes: '', amount: -5.25, tags: '', owner: '', importSource: 'monarch_csv', ...o,
})
const userCats = [
  { category: 'Coffee Shops', group: 'Food & Dining', type: 'Flexible' },
  { category: 'Restaurants', group: 'Food & Dining', type: 'Flexible' },
  { category: 'Gifts', group: 'Shopping', type: 'Flexible' },
]
const plan = (rows, extra = {}) =>
  buildImportPlan({ parsedRows: rows, categories: userCats, seedData: CATEGORY_SEED_DATA, ...extra })
const existing = (row, o = {}) =>
  new Map([[buildDedupKey(row), { id: 'id-1', dedup_key: buildDedupKey(row), category: row.category, notes: row.notes, tags: null, ...o }]])

describe('dedup and reclassification', () => {
  it('treats an identical existing row as a clean duplicate', () => {
    const p = plan([r()], { existingByKey: existing(r()) })
    expect(p.counts).toMatchObject({ new: 0, duplicate: 1, reclassified: 0 })
  })

  it('reclassifies on a category change and recomputes the group', () => {
    const p = plan([r({ category: 'Gifts' })], { existingByKey: existing(r(), { category: 'Restaurants' }) })
    expect(p.reclassifications).toHaveLength(1)
    expect(p.reclassifications[0].update).toEqual({
      id: 'id-1', dedup_key: buildDedupKey(r()), category: 'Gifts', group: 'Shopping', notes: '',
    })
  })

  it('reclassifies on a notes change', () => {
    const p = plan([r({ notes: 'bday' })], { existingByKey: existing(r(), { notes: '' }) })
    expect(p.counts.reclassified).toBe(1)
  })

  it('treats null, empty and whitespace notes as equal', () => {
    for (const stored of [null, '', '   ']) {
      const p = plan([r({ notes: '  ' })], { existingByKey: existing(r(), { notes: stored }) })
      expect(p.counts).toMatchObject({ duplicate: 1, reclassified: 0 })
    }
  })

  it('never puts date, amount, merchant or account in an update payload', () => {
    const p = plan([r({ category: 'Gifts' })], { existingByKey: existing(r(), { category: 'Restaurants' }) })
    expect(Object.keys(p.reclassifications[0].update).sort()).toEqual(['category', 'dedup_key', 'group', 'id', 'notes'])
  })
})

describe('in-file duplicates', () => {
  it('skips and reports ambiguous keys', () => {
    const p = plan([r(), r({ category: 'Restaurants' })])
    expect(p.counts).toMatchObject({ new: 0, ambiguous_rows: 2 })
    expect(p.ambiguous[0]).toMatchObject({ rows: 2, categories: ['Coffee Shops', 'Restaurants'] })
  })

  it('collapses identical rows with a count', () => {
    const p = plan([r(), r(), r()])
    expect(p.counts).toMatchObject({ new: 1, collapsed_identical: 2 })
  })

  it('accounts for every parsed row in a mixed file', () => {
    const dup = r({ merchant: 'Dup' })
    const rec = r({ merchant: 'Rec', category: 'Gifts' })
    const p = plan(
      [r({ merchant: 'New', category: 'Brand New Thing' }), dup, rec, r(), r({ category: 'Restaurants' }), r({ merchant: 'New', category: 'Brand New Thing' })],
      { existingByKey: new Map([...existing(dup), ...existing(rec, { category: 'Restaurants' })]) }
    )
    expect(p.counts).toMatchObject({
      parsed: 6, new: 1, duplicate: 1, reclassified: 1, ambiguous_rows: 2, collapsed_identical: 1,
    })
    const c = p.counts
    expect(c.new + c.duplicate + c.reclassified + c.ambiguous_rows + c.collapsed_identical).toBe(c.parsed)
    expect(p.autoMappings).toHaveLength(1)
  })
})

describe('tags', () => {
  it('ignores tag differences when the column is absent', () => {
    const p = plan([r({ tags: 'a' })], { existingByKey: existing(r()), columns: { tags: false } })
    expect(p.counts.duplicate).toBe(1)
  })
  it('ignores tags when the stored value is null', () => {
    const p = plan([r({ tags: 'a' })], { existingByKey: existing(r()), columns: { tags: true } })
    expect(p.counts.duplicate).toBe(1)
  })
  it('reclassifies on a differing stored tag and includes tags in the payload', () => {
    const p = plan([r({ tags: 'a' })], { existingByKey: existing(r(), { tags: 'b' }), columns: { tags: true } })
    expect(p.reclassifications[0].update.tags).toBe('a')
  })
})

describe('auto-mapping', () => {
  const one = (cat, extra) => plan([r({ category: cat })], extra).autoMappings[0]

  it('step 1: name_match on a normalised name', () => {
    expect(one('coffee-shops')).toMatchObject({ reason: 'name_match', matched_to: 'Coffee Shops', group: 'Food & Dining' })
  })
  it('step 2: monarch_group when category_groups is supplied', () => {
    expect(one('Zzz Widgets', { categoryGroups: { 'Zzz Widgets': 'shopping' } }))
      .toMatchObject({ reason: 'monarch_group', group: 'Shopping', matched_to: 'Shopping' })
  })
  it('step 3: closest by token similarity, deterministically', () => {
    const a = one('Coffee Beans Shops')
    expect(a).toMatchObject({ reason: 'closest', matched_to: 'Coffee Shops' })
    expect(one('Coffee Beans Shops')).toEqual(a)
  })
  it('step 4: falls back to Uncategorized', () => {
    expect(one('Qwerty Zxcv')).toMatchObject({ reason: 'fallback', group: 'Uncategorized', type: 'Flexible', matched_to: null })
  })
  it('does not auto-map a seed-known category', () => {
    expect(plan([r({ category: 'Groceries' })]).autoMappings).toHaveLength(0)
  })
  it('sets a non-null group on new rows with an auto-mapped category', () => {
    const p = plan([r({ category: 'Qwerty Zxcv' })])
    expect(p.newRows[0].group).toBe('Uncategorized')
  })
  it('leaves an empty category unmapped', () => {
    const p = plan([r({ category: '' })])
    expect(p.autoMappings).toHaveLength(0)
    expect(p.newRows[0].group).toBeNull()
  })
})

describe('re-import and result shape', () => {
  it('a second run of the same file inserts and reclassifies nothing', () => {
    const rows = [r({ merchant: 'A', category: 'Qwerty Zxcv' }), r({ merchant: 'B' })]
    const first = plan(rows)
    const stored = new Map(first.newRows.map((row, i) => [buildDedupKey(row), {
      id: `id-${i}`, dedup_key: buildDedupKey(row), category: row.category, notes: row.notes,
    }]))
    const second = plan(rows, { existingByKey: stored })
    expect(second.counts).toMatchObject({ new: 0, reclassified: 0, duplicate: 2 })
  })

  it('preview and commit share the same lists', () => {
    const p = plan([r({ category: 'Gifts' }), r({ merchant: 'X', category: 'Qwerty Zxcv' })], { existingByKey: existing(r(), { category: 'Restaurants' }) })
    const prev = shapeImportResult(p, { mode: 'preview', filename: 'f.csv' })
    const com = shapeImportResult(p, { mode: 'commit', filename: 'f.csv', commit: { inserted: 1, skipped_duplicate: 0, reclassified: 1, import_log_id: 'log' } })
    expect(com.reclassified).toEqual(prev.reclassified)
    expect(com.ambiguous).toEqual(prev.ambiguous)
    const strip = (list) => list.map(a => ({ ...a, created: undefined }))
    expect(strip(com.auto_mappings)).toEqual(strip(prev.auto_mappings))
    expect(prev.committed).toBe(false)
    expect(prev.next).toMatch(/commit/)
    expect(com).toMatchObject({ committed: true, import_log_id: 'log' })
    expect(com.next).toBeUndefined()
    expect(com.auto_mappings[0].created).toBe(true)
    expect(com.counts.inserted).toBe(1)
  })

  it('caps new_sample at 20', () => {
    const rows = Array.from({ length: 30 }, (_, i) => r({ merchant: `M${i}` }))
    expect(shapeImportResult(plan(rows), { mode: 'preview' }).new_sample).toHaveLength(20)
  })
})

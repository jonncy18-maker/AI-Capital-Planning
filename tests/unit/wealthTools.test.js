import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({
  getWealthSnapshots: vi.fn(),
  saveWealthSnapshot: vi.fn(),
  deleteWealthSnapshot: vi.fn(),
}))
vi.mock('../../src/lib/db/wealthSnapshots.js', () => db)

import { wealthTools, resolveSnapshotTarget } from '../../src/lib/ai/tools/wealth.tools.js'

const del = wealthTools.find(t => t.name === 'delete_wealth_snapshot')
const old = { id: 'old-id', snapshot_date: '2026-10-18', net_worth: 362221.48 }
const fresh = { id: 'new-id', snapshot_date: '2026-10-18', net_worth: 365701.24 }
const other = { id: 'other-id', snapshot_date: '2026-09-01', net_worth: 1 }

beforeEach(() => vi.clearAllMocks())

describe('resolveSnapshotTarget', () => {
  it('picks the exact row by id even when the date is shared', () => {
    expect(resolveSnapshotTarget([fresh, old], { id: 'old-id' })).toBe(old)
  })
  it('accepts a date with a single snapshot', () => {
    expect(resolveSnapshotTarget([fresh, other], { snapshot_date: '2026-09-01' })).toBe(other)
  })
  it('refuses a shared date and lists the ids', () => {
    expect(() => resolveSnapshotTarget([fresh, old], { snapshot_date: '2026-10-18' })).toThrow(/new-id, old-id/)
  })
  it('throws on unknown id, unknown date and empty input', () => {
    expect(() => resolveSnapshotTarget([fresh], { id: 'nope' })).toThrow(/No wealth snapshot with id/)
    expect(() => resolveSnapshotTarget([fresh], { snapshot_date: '2020-01-01' })).toThrow(/No wealth snapshot on/)
    expect(() => resolveSnapshotTarget([fresh], {})).toThrow()
  })
})

describe('delete_wealth_snapshot', () => {
  it('deletes only the requested id', async () => {
    db.getWealthSnapshots.mockResolvedValue([fresh, old])
    const res = await del.execute('u1', { id: 'old-id' })
    expect(db.deleteWealthSnapshot).toHaveBeenCalledOnce()
    expect(db.deleteWealthSnapshot).toHaveBeenCalledWith('old-id')
    expect(res.result.id).toBe('old-id')
  })
  it('deletes nothing when the date is ambiguous', async () => {
    db.getWealthSnapshots.mockResolvedValue([fresh, old])
    await expect(del.execute('u1', { snapshot_date: '2026-10-18' })).rejects.toThrow(/share/)
    expect(db.deleteWealthSnapshot).not.toHaveBeenCalled()
  })
  it('preview reports the ambiguity instead of throwing', async () => {
    db.getWealthSnapshots.mockResolvedValue([fresh, old])
    const p = await del.preview({ snapshot_date: '2026-10-18' }, { userId: 'u1' })
    expect(p.rows).toEqual([])
    expect(p.subtitle).toMatch(/share/)
  })
})

describe('save_wealth_snapshot undo', () => {
  it('undoes by id, not date', async () => {
    db.saveWealthSnapshot.mockResolvedValue({ id: 'saved-id' })
    const save = wealthTools.find(t => t.name === 'save_wealth_snapshot')
    const res = await save.execute('u1', { net_worth: 5, snapshot_date: '2026-10-18' })
    expect(res.undo).toEqual({ tool: 'delete_wealth_snapshot', input: { id: 'saved-id' } })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  session: { data: { user: { id: 'u1' } } },
  queries: [],
  txns: [],
  columns: [],
  log: [],
  snapshots: [],
  current: [],
  recorded: [],
  cats: [],
  usage: [],
  referenced: [],
  txResult: null,
  txError: null,
}))

vi.mock('../../src/lib/neon/apiAuth.js', () => ({ getSessionOrToken: async () => state.session }))
vi.mock('../../src/lib/neon/client.js', () => {
  const run = (text) => {
    if (text.includes('information_schema.columns')) return state.columns
    if (text.includes('FROM import_logs WHERE id')) return state.log
    if (text.includes('FROM import_log_rows')) return state.snapshots
    if (text.includes('FROM import_log_categories')) return state.recorded
    if (text.includes('SELECT c.id FROM budget_categories c')) return state.referenced
    if (text.includes('array_agg')) return state.usage
    if (text.includes('FROM budget_categories')) return state.cats
    if (text.includes('FROM transactions') && text.includes('id = ANY')) return state.current
    return []
  }
  const sql = (strings, ...values) => {
    const text = strings.join('?')
    state.queries.push(text)
    const p = Promise.resolve(run(text))
    p.__text = text
    p.__values = values
    return p
  }
  sql.transaction = async (queries) => {
    state.txns.push(queries.map(q => q.__text))
    if (state.txError) throw state.txError
    return queries.map(q => {
      if (state.txResult) {
        const hit = state.txResult(q.__text)
        if (hit) return hit
      }
      if (q.__text.includes('UPDATE import_logs')) return [{ undone_at: '2026-11-01T00:00:00Z' }]
      if (q.__text.includes('DELETE FROM transactions')) return [{ id: 'ins1' }]
      if (q.__text.includes('UPDATE transactions')) return [{ id: 'rec1' }]
      if (q.__text.includes('DELETE FROM budget_categories')) return [{ id: 'c1' }]
      return []
    })
  }
  return { getNeonSql: () => sql }
})

const { POST } = await import('../../app/api/transactions/import/undo/route.js')

const ID = '11111111-1111-4111-8111-111111111111'
const UNDO_COLS = [
  { table_name: 'import_logs', column_name: 'status' },
  { table_name: 'import_logs', column_name: 'undo_token' },
  { table_name: 'transactions', column_name: 'import_log_id' },
  { table_name: 'import_log_rows', column_name: 'tags_tracked' },
  { table_name: 'import_log_categories', column_name: 'budget_category_id' },
]
const TAGS = { table_name: 'transactions', column_name: 'tags' }
const MARKER = [
  { table_name: 'budget_categories', column_name: 'mapping_source' },
  { table_name: 'budget_categories', column_name: 'mapping_note' },
]
const call = (body) => POST(new Request('http://x/api/transactions/import/undo', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))
const recentLog = (over = {}) => ({
  id: ID, filename: 'a.csv', created_at: new Date().toISOString(), source: 'monarch_import', status: 'committed', ...over,
})
const snap = (over = {}) => ({
  transaction_id: 'ins1', kind: 'insert', tags_tracked: false,
  before_category: null, before_group: null, before_notes: null, before_tags: null,
  after_category: 'Cat', after_group: 'Grp', after_notes: null, after_tags: null, ...over,
})
const cur = (over = {}) => ({
  id: 'ins1', date: '2026-10-01', merchant: 'M', amount: -5, account: 'A', category: 'Cat', group: 'Grp', notes: null, ...over,
})

function seed({ tags = false, marker = true } = {}) {
  state.columns = [...UNDO_COLS, ...(tags ? [TAGS] : []), ...(marker ? MARKER : [])]
  state.log = [recentLog()]
  state.snapshots = [snap(), snap({ transaction_id: 'rec1', kind: 'reclassify', before_category: 'Old', before_group: 'OG' })]
  state.current = [cur(), cur({ id: 'rec1' })]
}

beforeEach(() => {
  state.session = { data: { user: { id: 'u1' } } }
  state.queries = []
  state.txns = []
  state.columns = []
  state.log = []
  state.snapshots = []
  state.current = []
  state.recorded = []
  state.cats = []
  state.usage = []
  state.referenced = []
  state.txResult = null
  state.txError = null
})

describe('undo route validation', () => {
  it('401 without a session', async () => {
    state.session = { data: null }
    expect((await call({ import_id: ID })).status).toBe(401)
  })
  it('400 on bad JSON', async () => {
    const res = await POST(new Request('http://x', { method: 'POST', body: '{nope' }))
    expect(res.status).toBe(400)
  })
  it('400 on a non-UUID import_id, bad mode, bad remove flag', async () => {
    expect((await call({ import_id: 'abc' })).status).toBe(400)
    expect((await call({ import_id: ID, mode: 'wipe' })).status).toBe(400)
    expect((await call({ import_id: ID, remove_auto_mappings: 'yes' })).status).toBe(400)
  })
  it('400 on commit without a valid expected', async () => {
    expect((await call({ import_id: ID, mode: 'commit' })).status).toBe(400)
    expect((await call({ import_id: ID, mode: 'commit', expected: { delete: 1 } })).status).toBe(400)
    expect((await call({ import_id: ID, mode: 'commit', expected: { delete: -1, restore: 0, skip: 0, remove_mappings: 0 } })).status).toBe(400)
  })
})

describe('undo route lookup and eligibility', () => {
  it('404 when no log matches this id and user, and the lookup filters by user', async () => {
    seed()
    state.log = []
    const res = await call({ import_id: ID })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
    const lookup = state.queries.find(q => q.includes('FROM import_logs WHERE id'))
    expect(lookup).toMatch(/user_id/)
  })
  it.each([
    ['migration_not_applied', () => { state.columns = [] }],
    ['pre_migration', () => { state.log = [recentLog({ source: null, status: null })] }],
    ['expired', () => { state.log = [recentLog({ created_at: new Date(Date.now() - 91 * 86_400_000).toISOString() })] }],
  ])('422 %s', async (reason, arrange) => {
    seed()
    arrange()
    const res = await call({ import_id: ID })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'not_undoable', reason })
  })
  it('409 when already undone', async () => {
    seed()
    state.log = [recentLog({ status: 'undone', undone_at: '2026-10-30T00:00:00Z' })]
    const res = await call({ import_id: ID })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'already_undone', undone_at: '2026-10-30T00:00:00Z' })
  })
})

describe('undo preview', () => {
  it('reports counts, issues no writes and filters every table read by user', async () => {
    seed()
    state.current = [cur(), cur({ id: 'rec1', category: 'Edited by John' })]
    const res = await call({ import_id: ID })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      mode: 'preview', committed: false, import_id: ID,
      counts: { delete: 1, restore: 0, skip: 1, skip_edited: 1 },
      expected: { delete: 1, restore: 0, skip: 1, remove_mappings: 0 },
    })
    for (const q of state.queries) {
      expect(q).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i)
      if (!q.includes('information_schema')) expect(q).toMatch(/user_id/)
    }
    expect(state.txns).toHaveLength(0)
  })

  it('reflects remove_auto_mappings in expected', async () => {
    seed()
    state.recorded = [{ budget_category_id: 'c1', category: 'Auto' }]
    state.cats = [{ id: 'c1', category: 'Auto', mapping_source: 'auto_import' }]
    const off = await (await call({ import_id: ID })).json()
    const on = await (await call({ import_id: ID, remove_auto_mappings: true })).json()
    expect(off.counts.mappings_removable).toBe(1)
    expect(off.expected.remove_mappings).toBe(0)
    expect(on.expected.remove_mappings).toBe(1)
  })
})

const expected = { delete: 1, restore: 1, skip: 0, remove_mappings: 0 }

describe('undo commit', () => {
  it('409 plan_changed when the counts no longer match', async () => {
    seed()
    const res = await call({ import_id: ID, mode: 'commit', expected: { ...expected, delete: 5 } })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'plan_changed', actual: expected })
    expect(body.preview.mode).toBe('preview')
    expect(state.txns).toHaveLength(0)
  })

  it('runs exactly one transaction: status update first, token guard on every write', async () => {
    seed()
    const res = await call({ import_id: ID, mode: 'commit', expected })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      mode: 'commit', committed: true, import_id: ID, raced: 0,
      counts: { deleted: 1, restored: 1, skipped: 0, mappings_removed: 0 },
    })
    expect(state.txns).toHaveLength(1)
    const [first, ...writes] = state.txns[0]
    expect(first).toMatch(/UPDATE import_logs[\s\S]*status = 'undone'[\s\S]*status = 'committed'/)
    expect(writes).toHaveLength(2)
    for (const w of writes) {
      expect(w).toMatch(/undo_token/)
      expect(w).toMatch(/user_id/)
    }
    expect(state.txns[0].some(q => q.includes('DELETE FROM budget_categories'))).toBe(false)
  })

  it('guards every write with the snapshot equality check, tags included when tracked', async () => {
    seed({ tags: true })
    await call({ import_id: ID, mode: 'commit', expected })
    const [, del, restore] = state.txns[0]
    for (const q of [del, restore]) {
      expect(q).toMatch(/btrim\(t\.category\)[\s\S]*r\.after_category/)
      expect(q).toMatch(/r\.after_tags/)
    }
    expect(restore).toMatch(/tags = CASE WHEN r\.tags_tracked/)
  })

  it('leaves tags out entirely when the column is absent', async () => {
    seed({ tags: false })
    await call({ import_id: ID, mode: 'commit', expected })
    expect(state.txns[0].join('\n')).not.toMatch(/tags/)
  })

  it('deletes categories only when ticked, with all six reference guards and the token', async () => {
    seed()
    state.recorded = [{ budget_category_id: 'c1', category: 'Auto' }]
    state.cats = [{ id: 'c1', category: 'Auto', mapping_source: 'auto_import' }]
    const withMap = { ...expected, remove_mappings: 1 }

    const unticked = await call({ import_id: ID, mode: 'commit', expected })
    expect(unticked.status).toBe(200)
    expect(state.txns[0].some(q => q.includes('DELETE FROM budget_categories'))).toBe(false)

    state.txns = []
    const res = await call({ import_id: ID, mode: 'commit', expected: withMap, remove_auto_mappings: true })
    expect((await res.json()).counts.mappings_removed).toBe(1)
    const del = state.txns[0].find(q => q.includes('DELETE FROM budget_categories'))
    expect(state.txns[0].at(-1)).toBe(del)
    expect(del).toMatch(/mapping_source = 'auto_import'/)
    expect(del).toMatch(/undo_token/)
    for (const t of ['transactions', 'budget_line_items', 'scenario_adjustments', 'forecast_line_items', 'forecast_overrides', 'bills']) {
      expect(del).toMatch(new RegExp(`NOT EXISTS \\(SELECT 1 FROM ${t} x WHERE x\\.user_id`))
    }
  })

  it('409 when the status update matches no row', async () => {
    seed()
    state.txResult = (text) => (text.includes('UPDATE import_logs') ? [] : null)
    const res = await call({ import_id: ID, mode: 'commit', expected })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('already_undone')
  })

  it('reports rows lost to a race and records the actuals', async () => {
    seed()
    state.txResult = (text) => (text.includes('DELETE FROM transactions') ? [] : null)
    const body = await (await call({ import_id: ID, mode: 'commit', expected })).json()
    expect(body.raced).toBe(1)
    expect(body.counts).toMatchObject({ deleted: 0, restored: 1, skipped: 1 })
    expect(state.queries.some(q => /UPDATE import_logs SET undo_summary/.test(q) && /undo_token/.test(q))).toBe(true)
  })

  it('500 with committed:false when the transaction is rejected', async () => {
    seed()
    state.txError = new Error('boom')
    const res = await call({ import_id: ID, mode: 'commit', expected })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'boom', committed: false })
  })
})

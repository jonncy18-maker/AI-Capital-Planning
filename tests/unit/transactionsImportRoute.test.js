import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  session: { data: { user: { id: 'u1' } } },
  queries: [],
  txns: [],
  columns: [],
  categories: [],
  existing: [],
}))

vi.mock('../../src/lib/neon/apiAuth.js', () => ({ getSessionOrToken: async () => state.session }))
vi.mock('../../src/lib/neon/client.js', () => {
  const run = (text) => {
    if (text.includes('information_schema.columns')) return state.columns
    if (text.includes('FROM budget_categories WHERE user_id')) return state.categories
    if (text.includes('FROM transactions') && text.includes('dedup_key = ANY')) return state.existing
    return []
  }
  const sql = (strings) => {
    const text = strings.join('?')
    state.queries.push(text)
    const p = Promise.resolve(run(text))
    p.__text = text
    return p
  }
  sql.transaction = async (queries) => {
    state.txns.push(queries.map(q => q.__text))
    return queries.map(q => {
      if (q.__text.includes('INSERT INTO transactions')) return [{ id: 'new' }]
      if (q.__text.includes('UPDATE transactions')) return [{ id: 'upd' }]
      if (q.__text.includes('INSERT INTO import_logs')) return [{ id: 'log-1' }]
      return []
    })
  }
  return { getNeonSql: () => sql }
})

const { POST } = await import('../../app/api/transactions/import/route.js')

const HEADER = 'Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags,Owner'
const csv = (...lines) => [HEADER, ...lines].join('\n')
const call = (body) => POST(new Request('http://x/api/transactions/import', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))
const GOOD = csv('2026-10-03,Starbucks,Coffee Shops,Amex,STARBUCKS,,-5.25,,John')

beforeEach(() => {
  state.session = { data: { user: { id: 'u1' } } }
  state.queries = []
  state.txns = []
  state.columns = []
  state.categories = []
  state.existing = []
})

describe('import route', () => {
  it('401 without a session', async () => {
    state.session = { data: null }
    expect((await call({ csv: GOOD })).status).toBe(401)
  })

  it('400 on missing columns', async () => {
    const res = await call({ csv: 'Date,Merchant\n2026-10-03,x', mode: 'preview' })
    expect(res.status).toBe(400)
    expect((await res.json()).errors[0]).toMatch(/Missing expected columns/)
  })

  it('413 over the size cap', async () => {
    const res = await call({ csv: 'x'.repeat(1_000_001), mode: 'preview' })
    expect(res.status).toBe(413)
  })

  it('413 over the row cap', async () => {
    const lines = Array.from({ length: 2001 }, (_, i) => `2026-10-03,M${i},Groceries,Amex,S,,-1,,J`)
    expect((await call({ csv: csv(...lines), mode: 'preview' })).status).toBe(413)
  })

  it('preview issues only SELECT statements and saves nothing', async () => {
    const res = await call({ csv: GOOD, mode: 'preview' })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ mode: 'preview', committed: false })
    expect(body.counts.new).toBe(1)
    expect(state.queries.length).toBeGreaterThan(0)
    for (const q of state.queries) expect(q).not.toMatch(/INSERT|UPDATE|DELETE/i)
    expect(state.txns).toHaveLength(0)
  })

  it('defaults to preview when mode is absent', async () => {
    const body = await (await call({ csv: GOOD })).json()
    expect(body.committed).toBe(false)
  })

  it('commit runs one transaction with seed, mapping, insert and log, and reports real counts', async () => {
    const withUnknown = csv('2026-10-03,Starbucks,Qwerty Zxcv,Amex,S,,-5.25,,J')
    const body = await (await call({ csv: withUnknown, mode: 'commit', filename: 'a.csv', chunk: { index: 2, count: 3 } })).json()
    expect(state.txns).toHaveLength(1)
    const t = state.txns[0].join('\n')
    expect(t).toMatch(/INSERT INTO budget_categories/)
    expect(t).toMatch(/INSERT INTO transactions/)
    expect(t).toMatch(/INSERT INTO import_logs/)
    expect(body).toMatchObject({ committed: true, import_log_id: 'log-1', counts: { inserted: 1, skipped_duplicate: 0 } })
    expect(body.auto_mappings[0]).toMatchObject({ created: true, reason: 'fallback' })
  })

  it('commit applies a reclassification through one UPDATE', async () => {
    state.existing = [{ id: 'e1', dedup_key: '2026-10-03|starbucks|-5.25|Amex', category: 'Restaurants', notes: '' }]
    const body = await (await call({ csv: GOOD, mode: 'commit' })).json()
    expect(state.txns[0].filter(q => q.includes('UPDATE transactions'))).toHaveLength(1)
    expect(body.counts).toMatchObject({ new: 0, reclassified: 1 })
  })

  it('without migration 027 uses no marker or tags columns', async () => {
    const body = await (await call({ csv: csv('2026-10-03,S,Qwerty Zxcv,Amex,S,,-5,x,J'), mode: 'commit' })).json()
    const t = state.txns[0].join('\n')
    expect(t).not.toMatch(/mapping_source|tags/)
    expect(body).toMatchObject({ marker_column_present: false, tags_column_present: false })
  })

  it('with migration 027 writes the marker and tags', async () => {
    state.columns = [
      { table_name: 'budget_categories', column_name: 'mapping_source' },
      { table_name: 'budget_categories', column_name: 'mapping_note' },
      { table_name: 'transactions', column_name: 'tags' },
    ]
    const body = await (await call({ csv: csv('2026-10-03,S,Qwerty Zxcv,Amex,S,,-5,x,J'), mode: 'commit' })).json()
    const t = state.txns[0].join('\n')
    expect(t).toMatch(/mapping_source/)
    expect(t).toMatch(/tags/)
    expect(body).toMatchObject({ marker_column_present: true, tags_column_present: true })
  })

  it('a failed transaction commits nothing and says so', async () => {
    const { getNeonSql } = await import('../../src/lib/neon/client.js')
    const spy = vi.spyOn(getNeonSql(), 'transaction').mockRejectedValueOnce(new Error('boom'))
    const res = await call({ csv: GOOD, mode: 'commit' })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'boom', committed: false, inserted: 0, reclassified: 0 })
    spy.mockRestore()
  })
})

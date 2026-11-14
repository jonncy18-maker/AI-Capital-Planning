import { describe, it, expect, vi, beforeEach } from 'vitest'

const ID1 = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'

const state = vi.hoisted(() => ({ session: { data: { user: { id: 'u1' } } }, queries: [], vals: [] }))
vi.mock('../../src/lib/neon/apiAuth.js', () => ({ getSessionOrToken: async () => state.session }))
vi.mock('../../src/lib/neon/client.js', () => ({
  getNeonSql: () => (strings, ...vals) => {
    const text = strings.join('?')
    state.queries.push(text)
    state.vals.push(vals)
    if (text.includes('SELECT id, date')) {
      return Promise.resolve([{ id: '11111111-1111-4111-8111-111111111111', date: '2026-10-03', merchant: 'Starbucks', amount: '-5.25', account: 'Amex', category: 'Restaurants', notes: 'old' }])
    }
    if (text.includes('UPDATE transactions')) return Promise.resolve([{ id: '11111111-1111-4111-8111-111111111111' }])
    return Promise.resolve([])
  },
}))

const { POST } = await import('../../app/api/transactions/reclassify/route.js')
const call = (body) => POST(new Request('http://x/api/transactions/reclassify', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))

beforeEach(() => { state.session = { data: { user: { id: 'u1' } } }; state.queries = []; state.vals = [] })

describe('reclassify route', () => {
  it('401 without a session', async () => {
    state.session = { data: null }
    expect((await call({ updates: [{ id: ID1, category: 'X' }] })).status).toBe(401)
  })

  it('rejects bad ids and oversize batches', async () => {
    expect((await call({ updates: [{ id: 'nope', category: 'X' }] })).status).toBe(400)
    const many = Array.from({ length: 501 }, () => ({ id: ID1, category: 'X' }))
    expect((await call({ updates: many })).status).toBe(400)
  })

  it('SET touches only category, group and notes, scoped to the user', async () => {
    const body = await (await call({ updates: [{ id: ID1, category: 'Coffee Shops', group: 'Food & Dining' }, { id: ID2, category: 'X' }] })).json()
    const upd = state.queries.find(q => q.includes('UPDATE transactions'))
    const set = upd.slice(upd.indexOf('SET'), upd.indexOf('FROM jsonb'))
    expect(set).toMatch(/category/)
    expect(set).not.toMatch(/date|amount|merchant|account|dedup_key/)
    expect(upd).toMatch(/WHERE t\.user_id = \?/)
    expect(body.updated).toBe(1)
    expect(body.not_found).toEqual([ID2])
    expect(body.rows[0]).toMatchObject({ category_before: 'Restaurants', category_after: 'Coffee Shops', notes_before: 'old', notes_after: 'old', amount: -5.25 })
  })

  it('dry_run is SELECT only and updates nothing', async () => {
    const body = await (await call({ updates: [{ id: ID1, category: 'X', notes: 'n' }], dry_run: true })).json()
    for (const q of state.queries) expect(q).not.toMatch(/INSERT|UPDATE|DELETE/i)
    expect(body.updated).toBe(0)
    expect(body.rows[0].notes_after).toBe('n')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

// F-006: the earn-rate upsert must only touch rows on a card the caller owns,
// and must never rewrite the row's owner.
const state = vi.hoisted(() => ({ sql: '', vals: [], result: [] }))
vi.mock('../../src/lib/neon/apiAuth.js', () => ({
  getSessionOrToken: async () => ({ data: { user: { id: 'alice' } } }),
}))
vi.mock('../../src/lib/neon/client.js', () => ({
  getNeonSql: () => (strings, ...vals) => {
    state.sql = strings.join('?')
    state.vals = vals
    return Promise.resolve(state.result)
  },
}))

const { POST } = await import('../../app/api/credit-cards/earn-rates/route.js')
const post = (body) => POST(new Request('http://x/api/credit-cards/earn-rates', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))
const body = { cardId: 'card-bob', ccCategory: 'Dining', earnRate: 99 }

beforeEach(() => { state.sql = ''; state.vals = []; state.result = [] })

describe('POST /api/credit-cards/earn-rates ownership', () => {
  it('scopes the insert to a card the caller owns', async () => {
    await post(body)
    expect(state.sql).toMatch(/FROM credit_cards c\s+WHERE c\.id = \? AND c\.user_id = \?/)
    expect(state.vals).toContain('alice')
    expect(state.vals).toContain('card-bob')
  })

  it('never rewrites the owner and guards the conflict update', async () => {
    await post(body)
    const setClause = state.sql.split('DO UPDATE SET')[1].split('WHERE')[0]
    expect(setClause).not.toMatch(/user_id/)
    expect(state.sql).toMatch(/WHERE credit_card_earn_rates\.user_id = EXCLUDED\.user_id/)
  })

  it('returns 404 when no row comes back (not the caller\'s card or row)', async () => {
    state.result = []
    const res = await post(body)
    expect(res.status).toBe(404)
  })

  it('returns the row for the caller\'s own card', async () => {
    state.result = [{ id: 'r1', card_id: 'card-bob', user_id: 'alice', earn_rate: 99 }]
    const res = await post(body)
    expect(res.status).toBe(200)
    expect((await res.json()).earn_rate).toBe(99)
  })
})

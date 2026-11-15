import { describe, it, expect, vi, beforeEach } from 'vitest'

// Points and redemption writes must reference a card the caller owns.
const state = vi.hoisted(() => ({ owned: true, writes: [] }))
vi.mock('../../src/lib/neon/apiAuth.js', () => ({
  getSessionOrToken: async () => ({ data: { user: { id: 'alice' } } }),
}))
vi.mock('../../src/lib/neon/client.js', () => ({
  getNeonSql: () => (strings, ...vals) => {
    const text = strings.join('?')
    if (text.includes('FROM credit_cards')) return Promise.resolve(state.owned ? [{ id: vals[1][0] }] : [])
    if (text.includes('SELECT * FROM credit_card_point_redemptions')) return Promise.resolve([{ id: 'r1', card_id: 'mine', year: 2026, month: 1, points_amount: 5, description: null }])
    state.writes.push(text)
    return Promise.resolve([{ id: 'new' }])
  },
}))

const points = await import('../../app/api/credit-cards/points/route.js')
const redemptions = await import('../../app/api/credit-cards/redemptions/route.js')
const req = (body) => new Request('http://x', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})

beforeEach(() => { state.owned = true; state.writes = [] })

describe('points POST', () => {
  const body = { cardId: 'c1', balance: 10, asOfDate: '2026-11-01' }
  it('saves for an owned card', async () => {
    expect((await points.POST(req(body))).status).toBe(201)
    expect(state.writes).toHaveLength(1)
  })
  it('404s and writes nothing for a card the caller does not own', async () => {
    state.owned = false
    expect((await points.POST(req(body))).status).toBe(404)
    expect(state.writes).toHaveLength(0)
  })
})

describe('redemptions POST', () => {
  const create = { cardId: 'c1', year: 2026, month: 1, pointsAmount: 5 }
  it('creates for an owned card', async () => {
    expect((await redemptions.POST(req(create))).status).toBe(201)
  })
  it('404s on create for a card the caller does not own', async () => {
    state.owned = false
    expect((await redemptions.POST(req(create))).status).toBe(404)
    expect(state.writes).toHaveLength(0)
  })
  it('404s when an edit moves the redemption to a foreign card', async () => {
    state.owned = false
    expect((await redemptions.POST(req({ id: 'r1', cardId: 'other' }))).status).toBe(404)
    expect(state.writes).toHaveLength(0)
  })
  it('allows an edit that keeps an owned card', async () => {
    expect((await redemptions.POST(req({ id: 'r1', pointsAmount: 9 }))).status).toBe(200)
  })
})

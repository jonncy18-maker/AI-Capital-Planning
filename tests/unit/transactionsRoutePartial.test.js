import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({ calls: 0, failOn: 0, vals: [] }))
vi.mock('../../src/lib/neon/apiAuth.js', () => ({ getSessionOrToken: async () => ({ data: { user: { id: 'u1' } } }) }))
vi.mock('../../src/lib/neon/client.js', () => ({
  getNeonSql: () => (strings, ...vals) => {
    state.calls++
    state.vals.push(vals)
    if (state.failOn && state.calls === state.failOn) return Promise.reject(new Error('batch down'))
    return Promise.resolve(strings.join('?').includes('INSERT') ? [{ id: 'x' }] : [])
  },
}))

const { GET, POST } = await import('../../app/api/transactions/route.js')
const { buildDedupKey } = await import('../../src/lib/db/transactions.js')

const rows = (n) => Array.from({ length: n }, (_, i) => ({ date: '2026-10-03', merchant: `M${i}`, amount: -1 }))
const post = (r) => POST(new Request('http://x/api/transactions', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows: r }),
}))

beforeEach(() => { state.calls = 0; state.failOn = 0; state.vals = [] })

describe('POST /api/transactions partial failure', () => {
  it('reports committed batches when a later batch fails', async () => {
    state.failOn = 2
    const res = await post(rows(501))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'batch down', inserted: 1, committed_batches: 1, total_batches: 2 })
  })

  it('keeps the plain error when the first batch fails', async () => {
    state.failOn = 1
    expect(await (await post(rows(3))).json()).toEqual({ error: 'batch down' })
  })

  it('keeps the success shape', async () => {
    const res = await post(rows(2))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ inserted: 1, skipped: 1 })
  })
})

describe('GET /api/transactions filters', () => {
  it('passes merchant, account and offset through', async () => {
    await GET(new Request('http://x/api/transactions?merchant=star&account=Amex&offset=40&limit=10'))
    expect(state.vals[0]).toEqual(expect.arrayContaining(['star', 'Amex', 40, 10]))
  })

  it('defaults the new filters to null and offset 0', async () => {
    await GET(new Request('http://x/api/transactions'))
    expect(state.vals[0]).toEqual(expect.arrayContaining([null, 0]))
  })
})

describe('buildDedupKey copies', () => {
  it('route and db seam produce identical keys', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync('app/api/transactions/route.js', 'utf8')
    const copy = new Function(`${src.match(/function buildDedupKey[\s\S]*?\n}/)[0]}; return buildDedupKey`)()
    for (const r of [{ date: '2026-10-03', merchant: 'ABC Store', amount: -5.25, account: 'Amex' }, { date: '2026-01-01', merchant: 'X', amount: 10, account: null }]) {
      expect(copy(r)).toBe(buildDedupKey(r))
    }
  })
})

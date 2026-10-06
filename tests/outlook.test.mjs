// Run: node --experimental-vm-modules --test tests/outlook.test.mjs
// Pure engine and projection checks run directly; route handlers are loaded with
// injected in-memory SQL/auth fakes. These checks do not execute PostgreSQL.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import {
  buildOutlook,
  resolveBaseYear,
  outlookNetSavingsMap,
  outlookGroupTargets,
  outlookContributionMaps,
} from '../src/lib/outlook/outlookEngine.js'
import { summarizeOutlookAdjustments, outlookChip, formatSignedMoney } from '../src/lib/outlook/scenarioSummary.js'
import { projectTrajectory } from '../src/lib/wealth/projection.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const approx = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`)

const NEXT = 2027
const cats = [
  { id: 'c-rent', category: 'Rent', group: 'Housing', exclude_from_totals: false },
  { id: 'c-food', category: 'Groceries', group: 'Food', exclude_from_totals: false },
  { id: 'c-pay', category: 'Paycheck', group: 'Income', exclude_from_totals: false },
  { id: 'c-xfer', category: 'Transfer', group: 'Transfers', exclude_from_totals: true },
  { id: 'c-cc', category: 'Card Payment', group: 'Credit Cards', exclude_from_totals: true },
]
const li = (category_id, amount, extra = {}) => ({ category_id, amount, month: 1, ...extra })
const lineItems = [
  li('c-rent', 1000), li('c-rent', 1000),
  li('c-food', 500),
  li('c-food', 300, { commitment_id: 'cm-1' }),
  li('c-pay', 9000),
  li('c-xfer', 700),
  li('c-cc', 400),
]

function base(overrides = {}) {
  return {
    nextYear: NEXT,
    baseYear: NEXT,
    baseLineItems: lineItems,
    categories: cats,
    commitments: [],
    takeHomeBase: 60000,
    assumptions: { inflation_rate: 0.03, income_growth_rate: 0.02, group_rates: {} },
    events: [],
    adjustments: [],
    selectedAdjustments: [],
    ...overrides,
  }
}
const group = (o, name) => o.groups.find(g => g.name === name)

test('columns are NEXT..NEXT+4; detailed only for a NEXT base', () => {
  const o = buildOutlook(base())
  assert.deepEqual(o.columns.map(c => c.year), [2027, 2028, 2029, 2030, 2031])
  assert.deepEqual(o.columns.map(c => c.kind), ['detailed', 'outlook', 'outlook', 'outlook', 'outlook'])
  assert.equal(o.baseMode, 'next')
})

test('base year falls back to the current year, all columns outlook; none -> empty', () => {
  assert.equal(resolveBaseYear({ nextYear: 2027, curYear: 2026, hasNextBudget: true, hasCurBudget: true }), 2027)
  assert.equal(resolveBaseYear({ nextYear: 2027, curYear: 2026, hasNextBudget: false, hasCurBudget: true }), 2026)
  assert.equal(resolveBaseYear({ nextYear: 2027, curYear: 2026, hasNextBudget: false, hasCurBudget: false }), null)
  const o = buildOutlook(base({ baseYear: 2026 }))
  assert.ok(o.columns.every(c => c.kind === 'outlook'))
  assert.equal(o.baseMode, 'current')
  // NEXT is one compounding step from the 2026 base.
  approx(group(o, 'Housing').cells[0].amount, 2000 * 1.03)
  assert.deepEqual(buildOutlook(base({ baseYear: null })), { empty: true, nextYear: NEXT, baseYear: null })
})

test('groups compound per year with the default rate; detailed year equals the roll-up', () => {
  const o = buildOutlook(base())
  const housing = group(o, 'Housing')
  assert.equal(housing.base, 2000)
  assert.equal(housing.cells[0].amount, 2000)
  approx(housing.cells[1].amount, 2000 * 1.03)
  approx(housing.cells[4].amount, 2000 * Math.pow(1.03, 4))
  assert.equal(housing.isOverride, false)
})

test('per-group override rate replaces the inflation default for that group only', () => {
  const o = buildOutlook(base({ assumptions: { inflation_rate: 0.03, income_growth_rate: 0.02, group_rates: { Housing: 0.05 } } }))
  approx(group(o, 'Housing').cells[2].amount, 2000 * Math.pow(1.05, 2))
  assert.equal(group(o, 'Housing').isOverride, true)
  approx(group(o, 'Food').cells[2].amount, 500 * Math.pow(1.03, 2))
  // a 0% override is a real override, not "unset"
  const zero = buildOutlook(base({ assumptions: { inflation_rate: 0.03, group_rates: { Housing: 0 } } }))
  approx(group(zero, 'Housing').cells[3].amount, 2000)
})

test('Income, Transfers and exclude_from_totals groups are not expense groups', () => {
  const names = buildOutlook(base()).groups.map(g => g.name)
  assert.deepEqual(names, ['Food', 'Housing'])
})

test('commitment-linked line items are excluded from group bases', () => {
  assert.equal(group(buildOutlook(base()), 'Food').base, 500)
})

test('commitments are placed exactly, never inflated, and mark the first year without them', () => {
  const commitments = [
    { id: 'a', name: 'Car loan', start_date: '2025-01-01', end_date: '2028-06-30', cost_structure: { kind: 'monthly', amount: 100 } },
    { id: 'b', name: 'Gym', start_date: '2025-01-01', end_date: null, cost_structure: { kind: 'monthly', amount: 10 } },
  ]
  const o = buildOutlook(base({ commitments }))
  // 2027: 12*(100+10); 2028: Jan-Jun 600 + 120 = 720
  assert.equal(o.commitments[0], 1320)
  assert.equal(o.commitments[1], 720)
  assert.equal(o.commitments[2], 120)
  assert.deepEqual(o.commitmentEnds[2], [{ id: 'a', name: 'Car loan', ended: 'Jun 2028' }])
  assert.deepEqual(o.commitmentEnds[1], [])
  assert.deepEqual(o.commitmentEnds[3], [])
})

test('events and adjustments are one-time, not compounded', () => {
  const o = buildOutlook(base({
    events: [{ id: 'e1', year: 2029, group_name: 'Housing', name: 'Roof', amount: 8000 }],
    adjustments: [{ year: 2029, group_name: 'Food', delta_amount: 600 }],
  }))
  assert.equal(o.events[2].total, 8000)
  assert.equal(o.events[3].total, 0)
  assert.equal(o.events[2].items[0].name, 'Roof')
  // events never appear inside group rows
  approx(group(o, 'Housing').cells[2].amount, 2000 * Math.pow(1.03, 2))
  // adjustment sits in its own year only
  approx(group(o, 'Food').cells[2].amount, 500 * Math.pow(1.03, 2) + 600)
  approx(group(o, 'Food').cells[3].amount, 500 * Math.pow(1.03, 3))
  assert.equal(group(o, 'Food').cells[2].committedAdj, 600)
})

test('net savings = income - groups - commitments - events; events counted once', () => {
  const o = buildOutlook(base({
    commitments: [{ id: 'b', name: 'Gym', start_date: '2025-01-01', end_date: null, cost_structure: { kind: 'monthly', amount: 10 } }],
    events: [{ id: 'e1', year: 2028, group_name: 'Housing', name: 'Roof', amount: 8000 }],
    adjustments: [{ year: 2028, group_name: 'Food', delta_amount: 600 }],
  }))
  const income = 60000 * 1.02
  approx(o.income[1], income)
  const groups = 2000 * 1.03 + 500 * 1.03 + 600
  approx(o.netSavings[1], income - groups - 120 - 8000)
  approx(o.netSavings[0], 60000 - 2500 - 120)
})

test('selected scenario shows as a delta; committed adjustments stay in the baseline', () => {
  const o = buildOutlook(base({
    adjustments: [{ year: 2028, group_name: 'Food', delta_amount: 100 }],
    selectedAdjustments: [{ year: 2028, group_name: 'Food', delta_amount: 250 }, { year: 2029, group_name: 'Housing', delta_amount: -50 }],
  }))
  const food = group(o, 'Food').cells[1]
  assert.equal(food.committedAdj, 100)
  assert.equal(food.scenarioDelta, 250)
  approx(food.amount, 500 * 1.03 + 100)
  approx(o.netSavingsScenario[1], o.netSavings[1] - 250)
  approx(o.netSavingsScenario[2], o.netSavings[2] + 50)
  approx(o.netSavings[1], buildOutlook(base({ adjustments: [{ year: 2028, group_name: 'Food', delta_amount: 100 }] })).netSavings[1])
})

test('adjustments on the detailed column are ignored; base=current keeps them', () => {
  const adj = [{ year: 2027, group_name: 'Food', delta_amount: 900 }]
  const o = buildOutlook(base({ adjustments: adj, selectedAdjustments: adj }))
  assert.equal(group(o, 'Food').cells[0].amount, 500)
  assert.equal(group(o, 'Food').cells[0].committedAdj, 0)
  assert.equal(group(o, 'Food').cells[0].scenarioDelta, 0)
  assert.equal(o.netSavings[0], 60000 - 2500)
  const cur = buildOutlook(base({ baseYear: 2026, adjustments: adj }))
  assert.equal(group(cur, 'Food').cells[0].committedAdj, 900)
})

test('an adjustment on an unseen group still gets a row so totals reconcile', () => {
  const o = buildOutlook(base({ adjustments: [{ year: 2028, group_name: 'Travel', delta_amount: 900 }] }))
  assert.equal(group(o, 'Travel').cells[1].amount, 900)
  approx(o.groupTotals[1], 2000 * 1.03 + 500 * 1.03 + 900)
})

test('missing income -> null income and net savings, never invented', () => {
  for (const takeHomeBase of [null, undefined, 0, NaN]) {
    const o = buildOutlook(base({ takeHomeBase }))
    assert.ok(o.income.every(v => v === null))
    assert.ok(o.netSavings.every(v => v === null))
    assert.ok(o.netSavingsScenario.every(v => v === null))
    assert.equal(outlookNetSavingsMap(o), null)
  }
})

test('helpers: net savings map needs all five years; group targets by year', () => {
  const o = buildOutlook(base())
  assert.deepEqual(Object.keys(outlookNetSavingsMap(o)).map(Number), [2027, 2028, 2029, 2030, 2031])
  assert.equal(outlookGroupTargets(o, 2028).Housing, o.groups.find(g => g.name === 'Housing').cells[1].amount)
  assert.equal(outlookGroupTargets(o, 2040), null)
})

test('contribution maps: with = net savings, without = net + commitments, by projection year', () => {
  const commitments = [{ id: 'b', name: 'Gym', start_date: '2025-01-01', end_date: null, cost_structure: { kind: 'monthly', amount: 10 } }]
  const o = buildOutlook(base({ commitments }))
  const m = outlookContributionMaps(o, 2026)
  assert.deepEqual(Object.keys(m.withCommitments).map(Number), [1, 2, 3, 4, 5])
  for (let i = 0; i < 5; i++) {
    approx(m.withCommitments[i + 1], o.netSavings[i])
    approx(m.withoutCommitments[i + 1], o.netSavings[i] + 120)
  }
  assert.equal(outlookContributionMaps(buildOutlook(base({ takeHomeBase: null })), 2026), null)
})

test('projectTrajectory: yearContributions skip the commitment drain in override years only', () => {
  const args = { startBalance: 0, monthlyContribution: 1000, annualReturn: 0, years: 3, annualCommitmentDrain: 1200 }
  const plain = projectTrajectory(args)
  assert.deepEqual(plain.map(p => p.balance), [0, 10800, 21600, 32400])
  const withOutlook = projectTrajectory({ ...args, yearContributions: { 1: 6000, 2: -2400 } })
  // y1: +6000 (no drain), y2: -2400 floored at 0 balance path, y3: back to 1000/mo - 100/mo drain
  assert.deepEqual(withOutlook.map(p => p.balance), [0, 6000, 3600, 14400])
  const arr = projectTrajectory({ ...args, yearContributions: [undefined, 6000] })
  assert.equal(arr[1].balance, 6000)
  assert.equal(arr[2].balance, 6000 + 10800)
})

test('projectTrajectory: unchanged without yearContributions; withdrawals floor at zero', () => {
  const a = projectTrajectory({ startBalance: 5000, monthlyContribution: 300, annualReturn: 0.06, years: 5 })
  const b = projectTrajectory({ startBalance: 5000, monthlyContribution: 300, annualReturn: 0.06, years: 5, yearContributions: null })
  assert.deepEqual(a, b)
  const floored = projectTrajectory({ startBalance: 1000, annualReturn: 0, years: 1, yearContributions: { 1: -100000 } })
  assert.equal(floored[1].balance, 0)
})

// ── Route handlers ───────────────────────────────────────────────────────────

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const S_ALICE = '11111111-1111-4111-8111-111111111111'
const S_BOB = '22222222-2222-4222-8222-222222222222'
const EV_BOB = '33333333-3333-4333-8333-333333333333'

async function routeHarness() {
  const state = {
    user: A,
    calls: [],
    scenarios: [{ id: S_ALICE, user_id: A, state: 'modeled' }, { id: S_BOB, user_id: B, state: 'committed' }],
    assumptions: new Map(),
    events: [{ id: EV_BOB, user_id: B, year: 2029, group_name: 'Housing', name: 'Roof', amount: '100' }],
    adjustments: [],
  }
  const sql = async (strings, ...values) => {
    const q = strings.join('?').replace(/\s+/g, ' ').trim()
    state.calls.push({ q, values })
    if (q.startsWith('SELECT soa.*')) {
      const [user_id, committedOnly] = values
      return state.adjustments
        .map(a => ({ ...a, scenario_state: state.scenarios.find(sc => sc.id === a.scenario_id)?.state }))
        .filter(a => a.user_id === user_id && (!committedOnly || a.scenario_state === 'committed'))
    }
    if (q.startsWith('SELECT id FROM scenarios')) return state.scenarios.filter(s => s.id === values[0] && s.user_id === values[1]).map(s => ({ id: s.id }))
    if (q.startsWith('SELECT * FROM outlook_assumptions')) { const r = state.assumptions.get(values[0]); return r ? [r] : [] }
    if (q.startsWith('INSERT INTO outlook_assumptions')) {
      assert.match(q, /ON CONFLICT \(user_id\)/)
      const [user_id, inflation_rate, income_growth_rate, groupRates] = values
      const row = { user_id, inflation_rate, income_growth_rate, group_rates: JSON.parse(groupRates) }
      state.assumptions.set(user_id, row)
      return [row]
    }
    if (q.startsWith('INSERT INTO scenario_outlook_adjustments')) {
      const [user_id, scenario_id, year, group_name, delta_amount, label] = values
      const row = { id: webcryptoId(state.adjustments.length), user_id, scenario_id, year, group_name, delta_amount, label }
      state.adjustments.push(row)
      return [row]
    }
    if (q.startsWith('DELETE FROM scenario_outlook_adjustments')) {
      const [id, user_id] = values
      const i = state.adjustments.findIndex(a => a.id === id && a.user_id === user_id)
      if (i < 0) return []
      return state.adjustments.splice(i, 1).map(a => ({ id: a.id }))
    }
    if (q.startsWith('DELETE FROM outlook_events')) {
      const [id, user_id] = values
      const i = state.events.findIndex(e => e.id === id && e.user_id === user_id)
      if (i < 0) return []
      return state.events.splice(i, 1).map(e => ({ id: e.id }))
    }
    if (q.startsWith('UPDATE outlook_events')) {
      const [year, group_name, name, amount, id, user_id] = values
      const e = state.events.find(x => x.id === id && x.user_id === user_id)
      if (!e) return []
      Object.assign(e, { year: year ?? e.year, group_name: group_name ?? e.group_name, name: name ?? e.name, amount: amount ?? e.amount })
      return [e]
    }
    if (q.startsWith('INSERT INTO outlook_events')) {
      const [user_id, year, group_name, name, amount] = values
      const row = { id: webcryptoId(50), user_id, year, group_name, name, amount }
      state.events.push(row)
      return [row]
    }
    throw new Error(`Unhandled SQL fake: ${q}`)
  }
  const context = vm.createContext({ Response, Request, URL, URLSearchParams, console })
  const cache = new Map()
  async function load(path) {
    if (cache.has(path)) return cache.get(path)
    let exports
    if (path.endsWith('/neon/client.js')) exports = { getNeonSql: () => sql }
    if (path.endsWith('/neon/apiAuth.js')) exports = { getSessionOrToken: async () => ({ data: state.user ? { user: { id: state.user } } : null }) }
    const module = exports
      ? new vm.SyntheticModule(Object.keys(exports), function () { for (const [n, v] of Object.entries(exports)) this.setExport(n, v) }, { context, identifier: path })
      : new vm.SourceTextModule(await readFile(path, 'utf8'), { context, identifier: path })
    cache.set(path, module)
    await module.link((specifier, parent) => load(resolve(dirname(parent.identifier), specifier)))
    return module
  }
  const modules = {}
  const files = {
    assumptions: 'app/api/outlook/assumptions/route.js',
    events: 'app/api/outlook/events/route.js',
    event: 'app/api/outlook/events/[id]/route.js',
    adjustments: 'app/api/scenarios/[id]/outlook-adjustments/route.js',
    adjustment: 'app/api/scenarios/outlook-adjustments/[adjustmentId]/route.js',
    allAdjustments: 'app/api/scenarios/outlook-adjustments/route.js',
  }
  for (const [name, path] of Object.entries(files)) {
    const m = await load(resolve(root, path)); await m.evaluate(); modules[name] = m.namespace
  }
  const req = (method, body) => new Request('http://local/x', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } })
  return { state, modules, req }
}
const webcryptoId = n => `99999999-9999-4999-8999-${String(n).padStart(12, '0')}`

test('assumptions PUT is scoped to the session user and validates rates', async () => {
  const h = await routeHarness()
  const ok = await h.modules.assumptions.PUT(h.req('PUT', { inflation_rate: 0.04, group_rates: { Housing: 0.05 } }))
  assert.equal(ok.status, 200)
  assert.equal(h.state.assumptions.get(A).inflation_rate, 0.04)
  assert.equal(h.state.assumptions.has(B), false)
  const insert = h.state.calls.find(c => c.q.startsWith('INSERT INTO outlook_assumptions'))
  assert.equal(insert.values[0], A)

  // null removes an override, other overrides survive
  await h.modules.assumptions.PUT(h.req('PUT', { group_rates: { Food: 0.02 } }))
  await h.modules.assumptions.PUT(h.req('PUT', { group_rates: { Housing: null } }))
  assert.deepEqual(h.state.assumptions.get(A).group_rates, { Food: 0.02 })

  for (const bad of [{ inflation_rate: 1.5 }, { income_growth_rate: -0.6 }, { inflation_rate: 'x' }, { group_rates: { '': 0.1 } }, { group_rates: { ['x'.repeat(101)]: 0.1 } }, { group_rates: { Housing: '0.1' } }, { group_rates: [] }]) {
    assert.equal((await h.modules.assumptions.PUT(h.req('PUT', bad))).status, 400, JSON.stringify(bad))
  }
  h.state.user = null
  assert.equal((await h.modules.assumptions.PUT(h.req('PUT', { inflation_rate: 0.01 }))).status, 401)
  assert.equal((await h.modules.assumptions.GET(h.req('GET'))).status, 401)
})

test('assumptions GET returns defaults when no row exists', async () => {
  const h = await routeHarness()
  const res = await h.modules.assumptions.GET(h.req('GET'))
  assert.deepEqual(await res.json(), { inflation_rate: 0.03, income_growth_rate: 0.03, group_rates: {} })
})

test('outlook adjustment POST on another user\'s scenario is rejected and writes nothing', async () => {
  const h = await routeHarness()
  const body = { year: 2029, group_name: 'Food', delta_amount: 500 }
  const foreign = await h.modules.adjustments.POST(h.req('POST', body), { params: Promise.resolve({ id: S_BOB }) })
  assert.equal(foreign.status, 404)
  assert.equal(h.state.adjustments.length, 0)
  assert.equal(h.state.calls.some(c => c.q.startsWith('INSERT INTO scenario_outlook_adjustments')), false)
  const own = await h.modules.adjustments.POST(h.req('POST', body), { params: Promise.resolve({ id: S_ALICE }) })
  assert.equal(own.status, 201)
  assert.equal(h.state.adjustments[0].user_id, A)
  assert.equal((await h.modules.adjustments.GET(h.req('GET'), { params: Promise.resolve({ id: S_BOB }) })).status, 404)
  assert.equal((await h.modules.adjustments.POST(h.req('POST', body), { params: Promise.resolve({ id: 'not-a-uuid' }) })).status, 404)
  for (const bad of [{ ...body, year: 1999 }, { ...body, year: 2029.5 }, { ...body, group_name: '' }, { ...body, delta_amount: NaN }, { ...body, delta_amount: '5' }]) {
    assert.equal((await h.modules.adjustments.POST(h.req('POST', bad), { params: Promise.resolve({ id: S_ALICE }) })).status, 400)
  }
  h.state.user = null
  assert.equal((await h.modules.adjustments.POST(h.req('POST', body), { params: Promise.resolve({ id: S_ALICE }) })).status, 401)
})

test('outlook adjustment and event deletes are scoped to the user', async () => {
  const h = await routeHarness()
  const created = await h.modules.adjustments.POST(h.req('POST', { year: 2029, group_name: 'Food', delta_amount: 5 }), { params: Promise.resolve({ id: S_ALICE }) })
  const { id } = await created.json()
  h.state.user = B
  assert.equal((await h.modules.adjustment.DELETE(h.req('DELETE'), { params: Promise.resolve({ adjustmentId: id }) })).status, 404)
  assert.equal(h.state.adjustments.length, 1)
  h.state.user = A
  assert.equal((await h.modules.adjustment.DELETE(h.req('DELETE'), { params: Promise.resolve({ adjustmentId: id }) })).status, 204)

  assert.equal((await h.modules.event.DELETE(h.req('DELETE'), { params: Promise.resolve({ id: EV_BOB }) })).status, 404)
  assert.equal((await h.modules.event.PATCH(h.req('PATCH', { amount: 1 }), { params: Promise.resolve({ id: EV_BOB }) })).status, 404)
  assert.equal(h.state.events[0].amount, '100')
})

test('event create validates input and stamps the session user', async () => {
  const h = await routeHarness()
  const res = await h.modules.events.POST(h.req('POST', { year: 2030, group_name: 'Housing', name: ' New roof ', amount: 9000 }))
  assert.equal(res.status, 201)
  const row = h.state.events.at(-1)
  assert.equal(row.user_id, A)
  assert.equal(row.name, 'New roof')
  for (const bad of [{ year: 2030, group_name: 'Housing', name: '', amount: 1 }, { year: 2030, group_name: 'Housing', name: 'x'.repeat(201), amount: 1 }, { year: 2030, group_name: 'Housing', name: 'x', amount: Infinity }, { year: 3000, group_name: 'Housing', name: 'x', amount: 1 }]) {
    assert.equal((await h.modules.events.POST(h.req('POST', bad))).status, 400)
  }
})

test('GET all outlook adjustments returns only the session user\'s rows; committed=1 filters', async () => {
  const h = await routeHarness()
  h.state.adjustments.push(
    { id: webcryptoId(1), user_id: A, scenario_id: S_ALICE, year: 2029, group_name: 'Food', delta_amount: 5 },
    { id: webcryptoId(2), user_id: B, scenario_id: S_BOB, year: 2029, group_name: 'Food', delta_amount: 7 },
  )
  const all = await (await h.modules.allAdjustments.GET(h.req('GET'))).json()
  assert.deepEqual(all.map(a => a.id), [webcryptoId(1)])
  const call = h.state.calls.at(-1)
  assert.equal(call.values[0], A)
  assert.equal((await (await h.modules.allAdjustments.GET(new Request('http://local/x?committed=1'))).json()).length, 0)
  h.state.user = B
  const bobCommitted = await (await h.modules.allAdjustments.GET(new Request('http://local/x?committed=1'))).json()
  assert.deepEqual(bobCommitted.map(a => a.id), [webcryptoId(2)])
  h.state.user = null
  assert.equal((await h.modules.allAdjustments.GET(h.req('GET'))).status, 401)
})

test('scenario summary: per-year sort, net savings, chip text', () => {
  assert.equal(summarizeOutlookAdjustments([]), null)
  assert.equal(outlookChip(null), null)
  const s = summarizeOutlookAdjustments([
    { id: '3', year: 2031, group_name: 'Travel', delta_amount: -300 },
    { id: '1', year: 2029, group_name: 'Travel', delta_amount: 1200 },
    { id: '2', year: 2029, group_name: 'Food', delta_amount: '100' },
  ])
  assert.deepEqual(s.byYear.map(y => y.year), [2029, 2031])
  assert.deepEqual(s.byYear[0].items.map(i => i.group_name), ['Food', 'Travel'])
  assert.equal(s.byYear[0].net, -1300)
  assert.equal(s.byYear[1].net, 300)
  assert.equal(s.total, 1000)
  assert.deepEqual(outlookChip(s), { text: '−$1,000 · 2029–2031 outlook', tone: 'bad' })
  const one = summarizeOutlookAdjustments([{ id: '1', year: 2029, group_name: 'Travel', delta_amount: 1200 }])
  assert.equal(outlookChip(one).text, '−$1,200 · 2029 outlook')
  const saving = outlookChip(summarizeOutlookAdjustments([{ id: 'x', year: 2029, group_name: 'A', delta_amount: -300 }]))
  assert.deepEqual(saving, { text: '+$300 · 2029 outlook', tone: 'good' })
  assert.equal(formatSignedMoney(-1200), '−$1,200')
  assert.equal(formatSignedMoney(0), '$0')
})

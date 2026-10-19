// Real route/client modules; auth and SQL transport are injected. No database is mutated.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultAssumptions } from '../src/lib/wealth/assumptions.js'
import { planFromAssumptions } from '../src/lib/wealth/projection.js'
import { validDate, latestSnapshots, expectedAt, buildPlanSeries } from '../src/lib/wealth/plans.js'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baseline = {
  name: 'Saved',
  start_date: '2027-07-15',
  start_balance: 10000,
  monthly_contribution: 500,
  annual_return: 0.06,
  horizon: 5,
  retirement_target: 100000,
  emergency_cash_target: null,
  starting_contributions_ytd: null,
  annual_contributions: { 2028: 10000 },
  annual_contributions_without_commitments: { 2028: 12000 },
  annual_commitment_drain: 2000,
  include_commitments: true,
}
async function harness({ dateOffset = '+00:00' } = {}) {
  const state = { user: 'alice', calls: [], plans: [], snapshots: [], error: null }
  // pg DATE is parsed into JS Date unless the selected SQL value is explicitly TEXT.
  const driverRow = (row, field, query) => ({
    ...row,
    [field]: query.includes(`${field}::text AS ${field}`)
      ? row[field]
      : new Date(`${row[field]}T00:00:00${dateOffset}`),
  })
  const sql = async (strings, ...values) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim()
    state.calls.push({ query, values })
    if (state.error) throw state.error
    if (/^SELECT .* FROM wealth_plans/.test(query))
      return state.plans
        .filter((p) => p.user_id === values[0])
        .map((row) => driverRow(row, 'start_date', query))
    if (query.startsWith('INSERT INTO wealth_plans')) {
      const row = {
        ...baseline,
        id: String(state.plans.length),
        user_id: values[0],
        name: values[1],
        start_date: values[2],
        start_balance: values[3],
        annual_contributions: JSON.parse(values[10]),
        annual_contributions_without_commitments: JSON.parse(values[11]),
        assumptions: values[14] == null ? null : JSON.parse(values[14]),
      }
      state.plans.push(row)
      return [driverRow(row, 'start_date', query)]
    }
    if (/^SELECT .* FROM wealth_snapshots/.test(query))
      return state.snapshots
        .filter((s) => s.user_id === values[0])
        .slice(0, values[1])
        .map((row) => driverRow(row, 'snapshot_date', query))
    if (query.startsWith('INSERT INTO wealth_snapshots')) {
      const row = {
        id: String(state.snapshots.length),
        user_id: values[0],
        snapshot_date: values[1],
        investment_balance: values[3],
        retirement_balance: values[4],
        emergency_cash: values[8],
        investment_contributions_ytd: values[9],
      }
      state.snapshots.push(row)
      return [driverRow(row, 'snapshot_date', query)]
    }
    throw new Error('Unexpected SQL')
  }
  const context = vm.createContext({ Response, Request, URL, console })
  const cache = new Map()
  async function load(path) {
    if (cache.has(path)) return cache.get(path)
    let exports
    if (path.endsWith('/neon/client.js')) exports = { getNeonSql: () => sql }
    if (path.endsWith('/neon/apiAuth.js'))
      exports = {
        getSessionOrToken: async () => ({ data: state.user ? { user: { id: state.user } } : null }),
      }
    const module = exports
      ? new vm.SyntheticModule(
          Object.keys(exports),
          function () {
            for (const [k, v] of Object.entries(exports)) this.setExport(k, v)
          },
          { context, identifier: path }
        )
      : new vm.SourceTextModule(await readFile(path, 'utf8'), { context, identifier: path })
    cache.set(path, module)
    if (!exports) await module.link((specifier) => load(resolve(dirname(path), specifier)))
    return module
  }
  const plans = await load(resolve(root, 'app/api/wealth-plans/route.js'))
  await plans.evaluate()
  const snapshots = await load(resolve(root, 'app/api/wealth-snapshots/route.js'))
  await snapshots.evaluate()
  const request = (body) =>
    new Request('http://local/api/wealth-plans', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  return { state, plans: plans.namespace, snapshots: snapshots.namespace, request }
}
test('plan routes require auth, scope to session, and save immutable new rows', async () => {
  const h = await harness()
  h.state.user = null
  assert.equal((await h.plans.GET(new Request('http://local/api/wealth-plans'))).status, 401)
  assert.equal((await h.plans.POST(h.request(baseline))).status, 401)
  assert.equal(h.state.calls.length, 0)
  h.state.user = 'alice'
  for (let i = 0; i < 2; i++)
    assert.equal((await h.plans.POST(h.request({ ...baseline, user_id: 'bob' }))).status, 201)
  assert.equal(h.state.plans.length, 2)
  assert.equal(h.state.plans[0].user_id, 'alice')
  h.state.plans.push({ id: 'b', user_id: 'bob' })
  const response = await h.plans.GET(new Request('http://local/api/wealth-plans'))
  assert.equal((await response.json()).length, 2)
  assert.match(h.state.calls.at(-1).query, /WHERE user_id = \?/)
  assert.deepEqual(h.state.calls.at(-1).values, ['alice'])
  assert.equal(
    h.state.calls.some((c) => /UPDATE|DELETE/.test(c.query)),
    false
  )
})
test('invalid plans are rejected before SQL; missing migration explains recovery', async () => {
  const h = await harness()
  for (const extra of [
    { annual_return: '6' },
    { start_date: '2027-02-30' },
    { monthly_contribution: 0.001 },
    { annual_contributions: { 2028: null } },
  ])
    assert.equal((await h.plans.POST(h.request({ ...baseline, ...extra }))).status, 400)
  assert.equal(h.state.calls.length, 0)
  h.state.error = Object.assign(new Error('relation missing'), { code: '42P01' })
  const response = await h.plans.GET(new Request('http://local/api/wealth-plans'))
  assert.equal(response.status, 500)
  assert.match((await response.json()).error, /025_wealth_plans.sql/)
})
test('snapshots preserve null/zero, reject invalid cash and support legacy calls', async () => {
  const h = await harness()
  const snapshot = {
    snapshot_date: '2027-07-15',
    investment_balance: null,
    retirement_balance: 0,
    other_assets: 1000,
    emergency_cash: 500,
    investment_contributions_ytd: -100,
  }
  const response = await h.snapshots.POST(h.request(snapshot))
  assert.equal(response.status, 201)
  const row = await response.json()
  assert.equal(row.investment_balance, null)
  assert.equal(row.retirement_balance, 0)
  assert.equal(row.investment_contributions_ytd, -100)
  for (const extra of [
    { emergency_cash: 1000.01 },
    { other_assets: null },
    { investment_balance: 'invalid' },
    { investment_contributions_ytd: 0.001 },
  ])
    assert.equal((await h.snapshots.POST(h.request({ ...snapshot, ...extra }))).status, 400)
  assert.equal(h.state.calls.length, 1)
  assert.equal(
    (await h.snapshots.POST(h.request({ snapshot_date: '2027-07-16', investment_balance: 0 })))
      .status,
    201
  )
  assert.doesNotMatch(h.state.calls.at(-1).query, /emergency_cash/)
  h.state.user = null
  assert.equal((await h.snapshots.POST(h.request(snapshot))).status, 401)
})

for (const operation of [
  'plan GET',
  'plan POST',
  'snapshot GET',
  'snapshot latest',
  'snapshot POST legacy',
  'snapshot POST extended',
]) {
  test(`${operation} preserves SQL calendar date when driver midnight differs from UTC`, async () => {
    const h = await harness({ dateOffset: '+14:00' })
    const snapshot = {
      id: 's',
      user_id: 'alice',
      snapshot_date: '2027-07-15',
      investment_balance: 10000,
      retirement_balance: 0,
      other_assets: 1000,
    }
    h.state.plans.push({ ...baseline, id: 'p', user_id: 'alice' })
    h.state.snapshots.push(snapshot)
    let response
    if (operation === 'plan GET')
      response = await h.plans.GET(new Request('http://local/api/wealth-plans'))
    else if (operation === 'plan POST') response = await h.plans.POST(h.request(baseline))
    else if (operation === 'snapshot GET')
      response = await h.snapshots.GET(new Request('http://local/api/wealth-snapshots'))
    else if (operation === 'snapshot latest')
      response = await h.snapshots.GET(new Request('http://local/api/wealth-snapshots?latest=true'))
    else
      response = await h.snapshots.POST(
        h.request({
          ...snapshot,
          ...(operation.endsWith('extended')
            ? { emergency_cash: 500, investment_contributions_ytd: 0 }
            : {}),
        })
      )
    const body = await response.json()
    const row = Array.isArray(body) ? body[0] : body
    const calendar = operation.startsWith('plan') ? row.start_date : row.snapshot_date
    assert.equal(calendar, '2027-07-15')
    assert.equal(validDate(calendar), true)
    if (operation.startsWith('plan')) {
      assert.equal(expectedAt(row, '2027-07-15').balance, 10000)
      assert.ok(buildPlanSeries(row).monthly.length > 0)
    } else assert.equal(latestSnapshots([row], '2028-01-01').length, 1)
    assert.equal(new Date('2027-07-15T00:00:00+14:00').toISOString().slice(0, 10), '2027-07-14')
  })
}
test('plan with assumptions is validated and stored on the new row; bad assumptions are rejected before SQL', async () => {
  const h = await harness()
  const body = planFromAssumptions({
    name: 'With assumptions',
    startDate: '2026-10-18',
    startBalance: 350903.6,
    assumptions: defaultAssumptions(),
  })
  const res = await h.plans.POST(h.request(body))
  assert.equal(res.status, 201)
  assert.equal(h.state.plans[0].assumptions.retirement_age, 60)
  assert.equal(h.state.plans[0].assumptions.caps.k401, 24500)
  const forged = await h.plans.POST(
    h.request({ ...body, annual_return: 0, annual_contributions: { 2026: 0 } })
  )
  assert.equal(forged.status, 201)
  const forgedValues = h.state.calls.at(-1).values
  assert.equal(forgedValues[5], 0.07, 'server re-derives the base return from assumptions')
  assert.notDeepEqual(JSON.parse(forgedValues[10]), { 2026: 0 })
  const before = h.state.calls.length
  const bad = await h.plans.POST(
    h.request({ ...body, assumptions: { ...body.assumptions, retirement_age: 20 } })
  )
  assert.equal(bad.status, 400)
  assert.equal(h.state.calls.length, before)
})

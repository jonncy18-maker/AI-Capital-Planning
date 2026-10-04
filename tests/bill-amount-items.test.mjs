// Run: node --experimental-vm-modules --test tests/bill-amount-items.test.mjs
// Real exported route handlers, shared client seam and bill tools; SQL and auth
// are injected in-memory fakes. These checks do not execute PostgreSQL.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import * as items from '../src/lib/payperiods/billAmountItems.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const id = '11111111-1111-4111-8111-111111111111'
const id2 = '22222222-2222-4222-8222-222222222222'
const item = (amount = 10, name = 'Car repair', itemId = id) => ({ id: itemId, name, amount })
const bill = { id: 'bill-a', user_id: 'alice', name: 'Misc cash outflow', fixed_amount: null }

async function harness() {
  const state = { user: 'alice', bills: [bill, { ...bill, id: 'bill-b', user_id: 'bob' }], amounts: new Map(), calls: [], race: null }
  const key = (billId, year, month) => `${billId}/${year}/${month}`
  const sql = async (strings, ...values) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim()
    state.calls.push({ query, values })
    if (query.startsWith('SELECT * FROM bills')) return state.bills.filter(value => value.id === values[0] && value.user_id === values[1])
    if (query.startsWith('SELECT * FROM bill_amounts')) {
      if (query.includes('WHERE bill_id')) {
        const value = state.amounts.get(key(values[0], values[2], values[3]))
        return value?.user_id === values[1] ? [structuredClone(value)] : []
      }
      return [...state.amounts.values()].filter(value => value.user_id === values[0] && value.year === values[1] && value.month === values[2]).map(value => structuredClone(value))
    }
    if (query.startsWith('UPDATE bill_amounts')) {
      if (state.race) { const race = state.race; state.race = null; race() }
      const [amount, payload, rowId, billId, userId, year, month, expected] = values
      const rowKey = key(billId, year, month)
      const old = state.amounts.get(rowKey)
      assert.match(query, /WHERE id = \? AND bill_id = \? AND user_id = \?/)
      assert.match(query, /item_revision = \? RETURNING/)
      if (!old || old.user_id !== userId || old.id !== rowId || old.item_revision !== expected) return []
      const saved = { ...old, amount, items: JSON.parse(payload), item_revision: old.item_revision + 1 }
      state.amounts.set(rowKey, saved)
      return [structuredClone(saved)]
    }
    if (query.startsWith('INSERT INTO bill_amounts')) {
      if (state.race) { const race = state.race; state.race = null; race() }
      const [billId, userId, year, month, amount, payload] = values
      const rowKey = key(billId, year, month)
      const old = state.amounts.get(rowKey)
      if (query.includes('items, item_revision')) {
        assert.match(query, /ON CONFLICT \(bill_id, year, month\) DO NOTHING/)
        if (old) return []
        const saved = { id: webcrypto.randomUUID(), bill_id: billId, user_id: userId, year, month, amount, items: JSON.parse(payload), item_revision: 1 }
        state.amounts.set(rowKey, saved)
        return [structuredClone(saved)]
      }
      assert.match(query, /WHERE bill_amounts.user_id = \?/)
      assert.match(query, /bill_amounts.items IS NULL/)
      if (old && (old.user_id !== userId || old.items != null)) return []
      const saved = { ...old, id: old?.id ?? webcrypto.randomUUID(), bill_id: billId, user_id: userId, year, month, amount, notes: payload, items: null, item_revision: (old?.item_revision ?? 0) + 1 }
      state.amounts.set(rowKey, saved)
      return [structuredClone(saved)]
    }
    if (query.startsWith('DELETE FROM bill_amounts') || query.startsWith('SELECT id FROM bill_amounts')) {
      const [billId, year, month, userId] = values
      const rowKey = key(billId, year, month)
      const stored = state.amounts.get(rowKey)
      const owned = state.bills.some(value => value.id === billId && value.user_id === userId)
      if (!owned || stored?.user_id !== userId) return []
      if (query.startsWith('SELECT')) return stored.items != null ? [{ id: billId }] : []
      assert.match(query, /items IS NULL/)
      if (stored.items != null) return []
      state.amounts.delete(rowKey)
      return [{ id: billId }]
    }
    throw new Error(`Unhandled SQL fake: ${query}`)
  }
  const context = vm.createContext({ Response, Request, URL, URLSearchParams, console, crypto: webcrypto })
  const cache = new Map()
  const modules = {}
  const apiFetch = async (path, options = {}) => {
    if (path === '/api/bills') return Response.json(state.bills.filter(value => value.user_id === state.user))
    if (path.startsWith('/api/bill-amounts?')) return modules.route.GET(new Request(`http://local${path}`))
    if (path === '/api/bill-amounts') return modules.route.POST(new Request(`http://local${path}`, options))
    if (path.startsWith('/api/bill-amounts/')) {
      const [, , , billId, year, month] = path.split('/')
      return modules.deletion.DELETE(new Request(`http://local${path}`, options), { params: Promise.resolve({ billId, year, month }) })
    }
    throw new Error(`Unhandled API ${path}`)
  }
  async function load(path) {
    if (cache.has(path)) return cache.get(path)
    let exports
    if (path.endsWith('/neon/client.js')) exports = { getNeonSql: () => sql }
    if (path.endsWith('/neon/apiAuth.js')) exports = { getSessionOrToken: async () => ({ data: state.user ? { user: { id: state.user } } : null }) }
    if (path.endsWith('/db/apiClient.js')) exports = { apiFetch }
    const module = exports
      ? new vm.SyntheticModule(Object.keys(exports), function () { for (const [name, value] of Object.entries(exports)) this.setExport(name, value) }, { context, identifier: path })
      : new vm.SourceTextModule(await readFile(path, 'utf8'), { context, identifier: path })
    cache.set(path, module)
    await module.link((specifier, parent) => load(resolve(dirname(parent.identifier), specifier)))
    return module
  }
  for (const [name, path] of Object.entries({ route: 'app/api/bill-amounts/route.js', deletion: 'app/api/bill-amounts/[billId]/[year]/[month]/route.js', db: 'src/lib/db/bills.js', tools: 'src/lib/ai/tools/bills.tools.js' })) {
    const module = await load(resolve(root, path)); await module.evaluate(); modules[name] = module.namespace
  }
  const post = body => modules.route.POST(new Request('http://local/api/bill-amounts', { method: 'POST', body: JSON.stringify({ expectedRowId: null, ...body }), headers: { 'content-type': 'application/json' } }))
  const tool = name => modules.tools.billTools.find(value => value.name === name)
  return { state, modules, post, tool, key }
}

for (const amount of [-1, Infinity, NaN, 1.001, 10000001, '1']) {
  test(`invalid amount ${String(amount)} rejected`, () => assert.throws(() => items.normalizeBillAmountItems([item(amount)])))
}
test('names, UUIDs, duplicate IDs, list limit and cents', () => {
  assert.equal(items.totalBillAmountItems([item(0.1), item(0.2, 'Fee', id2)]), 0.3)
  assert.equal(items.normalizeBillAmountItems([item(0, '  Fee  ')])[0].name, 'Fee')
  assert.equal(items.totalBillAmountItems([]), 0)
  for (const list of [[item(1, ' ')], [item(1, 'x'.repeat(201))], [item(1, 'Bad', 'bad')], [item(), item()], Array.from({ length: 101 }, () => item())]) assert.throws(() => items.normalizeBillAmountItems(list))
})
test('eligibility excludes each derived/fixed amount source', () => {
  assert.equal(items.isBillAmountItemsEligible(bill), true)
  for (const source of ['fixed_amount', 'forecast_category_id', 'actuals_category', 'credit_card_id']) assert.equal(items.isBillAmountItemsEligible({ ...bill, [source]: source === 'fixed_amount' ? 0 : 'linked' }), false)
})
test('first add preserves baseline; empty itemized list stays empty', () => {
  const baseline = items.initialBillAmountItems({ amount: '30.25' }, () => id)
  assert.deepEqual(baseline, [item(30.25, 'Existing amount')])
  assert.deepEqual(items.initialBillAmountItems({ items: [], amount: 50 }), [])
})
test('real shared seam saves derived total and empty list', async () => {
  const h = await harness()
  const saved = await h.modules.db.saveBillAmountItems('ignored', bill.id, 2026, 10, [item(0.1), item(0.2, 'Fee', id2)], 0)
  assert.equal(saved.amount, 0.3); assert.equal(saved.item_revision, 1)
  const empty = await h.modules.db.saveBillAmountItems('ignored', bill.id, 2026, 10, [], 1, saved.id)
  assert.equal(empty.amount, 0); assert.deepEqual(empty.items, []); assert.equal(empty.item_revision, 2)
})
test('route validates item payload and bill eligibility', async () => {
  const h = await harness()
  for (const patch of [{ items: [item(-1)] }, { expectedRevision: -1 }, { month: 13 }, { items: [item(), item()] }]) {
    const response = await h.post({ billId: bill.id, year: 2026, month: 10, items: [], expectedRevision: 0, ...patch })
    assert.equal(response.status, 400)
  }
  h.state.bills[0] = { ...bill, credit_card_id: 'linked' }
  assert.equal((await h.post({ billId: bill.id, year: 2026, month: 10, items: [], expectedRevision: 0 })).status, 400)
})
test('scalar and delete cannot erase itemized amount or notes', async () => {
  const h = await harness()
  await h.modules.db.upsertBillAmount('alice', bill.id, 2026, 10, 20, 'Keep notes')
  await h.modules.db.saveBillAmountItems('alice', bill.id, 2026, 10, [item(20)], 1, h.state.amounts.get(h.key(bill.id, 2026, 10)).id)
  const before = structuredClone(h.state.amounts.get(h.key(bill.id, 2026, 10)))
  await assert.rejects(h.modules.db.upsertBillAmount('alice', bill.id, 2026, 10, 90, 'Erase'), /itemized/)
  await assert.rejects(h.modules.db.deleteBillAmount(bill.id, 2026, 10), /itemized/)
  assert.deepEqual(h.state.amounts.get(h.key(bill.id, 2026, 10)), before)
})
test('stale reads and concurrent writes fail without blind retries', async () => {
  const h = await harness()
  await h.modules.db.upsertBillAmount('alice', bill.id, 2026, 10, 20)
  await assert.rejects(h.modules.db.saveBillAmountItems('alice', bill.id, 2026, 10, [], 0), /changed/)
  h.state.race = () => { const value = h.state.amounts.get(h.key(bill.id, 2026, 10)); value.amount = 35; value.item_revision++ }
  await assert.rejects(h.modules.db.saveBillAmountItems('alice', bill.id, 2026, 10, [item(20)], 1, h.state.amounts.get(h.key(bill.id, 2026, 10)).id), /changed/)
  assert.equal(h.state.amounts.get(h.key(bill.id, 2026, 10)).amount, 35)
})
test('authentication, ownership, month and user isolation', async () => {
  const h = await harness()
  assert.equal((await h.post({ billId: 'bill-b', year: 2026, month: 10, items: [], expectedRevision: 0 })).status, 404)
  await h.modules.db.saveBillAmountItems('alice', bill.id, 2026, 10, [item(50)], 0)
  assert.deepEqual(await h.modules.db.getBillAmounts('alice', 2026, 11), [])
  h.state.user = 'bob'
  assert.deepEqual(await h.modules.db.getBillAmounts('bob', 2026, 10), [])
  assert.equal((await h.post({ billId: bill.id, year: 2026, month: 10, amount: 1 })).status, 404)
  h.state.user = null
  assert.equal((await h.post({ billId: bill.id, year: 2026, month: 10, amount: 1 })).status, 401)
})
test('registered tools use shared APIs for list/add/edit/remove and retain baseline', async () => {
  const h = await harness()
  const target = { bill: bill.name, year: 2026, month: 10 }
  await h.modules.db.upsertBillAmount('alice', bill.id, 2026, 10, 15.25)
  const listed = await h.tool('list_bill_amount_items').execute('alice', target)
  assert.equal(listed.result.items, null); assert.equal(listed.result.total, 15.25)
  const added = await h.tool('add_bill_amount_item').execute('alice', { ...target, name: 'Repair', amount: 0.1 })
  assert.equal(added.result.total, 15.35); assert.equal(added.result.items[0].name, 'Existing amount')
  const item_id = added.result.items[1].id
  const edited = await h.tool('update_bill_amount_item').execute('alice', { ...target, item_id, amount: 0.2 })
  assert.equal(edited.result.total, 15.45)
  const preview = await h.tool('remove_bill_amount_item').preview({ ...target, item_id }, { userId: 'alice' })
  assert.equal(preview.destructive, true)
  const removed = await h.tool('remove_bill_amount_item').execute('alice', { ...target, item_id })
  assert.equal(removed.result.total, 15.25); assert.equal(removed.result.revision, 4)
  await assert.rejects(h.tool('update_bill_amount_item').execute('alice', { ...target, item_id, amount: 30 }), /not found/)
  for (const input of [{ bill: 'Misc', year: 2026, month: 10 }, { bill: bill.id, month: 10 }, { ...target, month: 0 }]) await assert.rejects(h.tool('list_bill_amount_items').execute('alice', input))
  h.state.bills.push({ ...bill, id: 'duplicate' })
  await assert.rejects(h.tool('list_bill_amount_items').execute('alice', target), /unambiguously/)
  assert.equal((await h.tool('list_bill_amount_items').execute('alice', { ...target, bill: bill.id })).result.total, 15.25)
})
test('MCP write conflict leaves winning item list untouched', async () => {
  const h = await harness()
  const target = { bill: bill.id, year: 2026, month: 10, name: 'Repair', amount: 10 }
  await h.tool('add_bill_amount_item').execute('alice', target)
  h.state.race = () => { const value = h.state.amounts.get(h.key(bill.id, 2026, 10)); value.items = [item(45, 'Winner')]; value.amount = 45; value.item_revision++ }
  await assert.rejects(h.tool('add_bill_amount_item').execute('alice', target), /changed/)
  assert.equal(h.state.amounts.get(h.key(bill.id, 2026, 10)).items[0].name, 'Winner')
})

test('delete/recreate identity rejects old scalar snapshot even when revisions repeat', async () => {
  const h = await harness()
  const old = await h.modules.db.upsertBillAmount('alice', bill.id, 2026, 10, 100)
  await h.modules.db.deleteBillAmount(bill.id, 2026, 10)
  const recreated = await h.modules.db.upsertBillAmount('alice', bill.id, 2026, 10, 200)
  assert.equal(old.item_revision, recreated.item_revision)
  assert.notEqual(old.id, recreated.id)
  await assert.rejects(h.modules.db.saveBillAmountItems('alice', bill.id, 2026, 10, [item(100)], old.item_revision, old.id), /changed/)
  assert.equal(h.state.amounts.get(h.key(bill.id, 2026, 10)).amount, 200)
})

const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
async function plannerHandlers() {
  const source = await readFile(resolve(root, 'src/modules/payperiods/PayPeriodPlanner.jsx'), 'utf8')
  const start = source.indexOf('  function handleAmountChange(')
  const end = source.indexOf('  function handleBalanceChange', start)
  const scalar = defer(), itemSave = defer()
  const state = { amounts: { 'bill-a': 100 }, rows: { 'bill-a': { id, amount: 100, items: null, item_revision: 1 } }, busy: {}, errors: [], scalarCalls: 0, itemCalls: 0 }
  const environment = {
    currentScope: 'alice-2026-10', amountScope: 'alice-2026-10', activeScope: { current: 'alice-2026-10' }, scopeGeneration: { current: 0 }, amountMutationEpoch: { current: 0 }, pendingAmounts: { current: {} },
    userId: 'alice', navYear: 2026, navMonth: 10, amountRows: state.rows,
    setAmountsMap: change => { state.amounts = change(state.amounts) },
    setAmountRows: change => { state.rows = change(state.rows) },
    setScalarBusy: change => { state.busy = change(state.busy) },
    setError: error => state.errors.push(error),
    upsertBillAmount: () => { state.scalarCalls++; return scalar.promise },
    saveBillAmountItems: () => { state.itemCalls++; return itemSave.promise },
  }
  const context = vm.createContext(environment)
  vm.runInContext(source.slice(start, end) + '\nglobalThis.handlers = { handleAmountChange, handleAmountBlur, handleItemsSave }', context)
  return { context, state, scalar, itemSave, handlers: context.handlers }
}
test('pending item save blocks competing scalar blur and keeps authoritative total', async () => {
  const h = await plannerHandlers()
  const saving = h.handlers.handleItemsSave('bill-a', [item(150)], 1, id)
  await h.handlers.handleAmountBlur('bill-a', '100')
  assert.equal(h.state.scalarCalls, 0)
  h.itemSave.resolve({ id, amount: 150, items: [item(150)], item_revision: 2 })
  await saving
  assert.equal(h.state.rows['bill-a'].amount, 150)
  assert.equal(h.state.amounts['bill-a'], 150)
})
test('pending scalar save blocks item conversion until scalar row returns', async () => {
  const h = await plannerHandlers()
  const saving = h.handlers.handleAmountBlur('bill-a', '120')
  await assert.rejects(h.handlers.handleItemsSave('bill-a', [item(100)], 1, id), /Wait/)
  assert.equal(h.state.itemCalls, 0)
  h.scalar.resolve({ id, amount: 120, items: null, item_revision: 2 })
  await saving
  assert.equal(h.state.amounts['bill-a'], 120)
})
test('leave and reopen same month rejects stale item response and preserves newer data', async () => {
  const h = await plannerHandlers()
  const saving = h.handlers.handleItemsSave('bill-a', [item(150)], 1, id)
  h.context.activeScope.current = 'alice-2026-11'; h.context.scopeGeneration.current++
  h.context.activeScope.current = 'alice-2026-10'; h.context.scopeGeneration.current++
  h.state.rows = { 'bill-a': { id, amount: 250, items: [item(250)], item_revision: 4 } }
  h.state.amounts = { 'bill-a': 250 }
  h.context.pendingAmounts.current = {}
  h.itemSave.resolve({ id, amount: 150, items: [item(150)], item_revision: 2 })
  await assert.rejects(saving, /Month changed/)
  assert.equal(h.state.rows['bill-a'].item_revision, 4)
  assert.equal(h.state.amounts['bill-a'], 250)
})
test('old scalar failure after leave and reopen cannot restore stale baseline', async () => {
  const h = await plannerHandlers()
  const saving = h.handlers.handleAmountBlur('bill-a', '120')
  h.context.scopeGeneration.current += 2
  h.state.amounts = { 'bill-a': 250 }
  h.scalar.reject(new Error('Conflict'))
  await saving
  assert.equal(h.state.amounts['bill-a'], 250)
  assert.deepEqual(h.state.errors, [])
})

test('deletion between item read and atomic UPDATE cannot resurrect a removed row', async () => {
  const h = await harness()
  const old = await h.modules.db.upsertBillAmount('alice', bill.id, 2026, 10, 100)
  h.state.race = () => h.state.amounts.delete(h.key(bill.id, 2026, 10))
  await assert.rejects(h.modules.db.saveBillAmountItems('alice', bill.id, 2026, 10, [item(100)], old.item_revision, old.id), /changed/)
  assert.equal(h.state.amounts.has(h.key(bill.id, 2026, 10)), false)
})

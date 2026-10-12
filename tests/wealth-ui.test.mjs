// Execute the real component with injected React hooks and async transport.
// This tests state/effect lifecycle and card props; it does not verify browser layout.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import * as engine from '../src/lib/wealth/plans.js'
import * as money from '../src/lib/money.js'
import * as selection from '../src/lib/wealth/selection.js'
const require = createRequire(import.meta.url)
const babel = require('next/dist/compiled/babel/core')
const source = await readFile(new URL('../src/modules/wealth/Wealth.jsx', import.meta.url), 'utf8')
const code = babel.transformSync(source, {
  babelrc: false,
  configFile: false,
  presets: [
    [
      require('next/dist/compiled/babel/preset-react'),
      { runtime: 'classic', pragma: 'h', pragmaFrag: 'Fragment' },
    ],
  ],
  plugins: [require('next/dist/compiled/babel/plugin-transform-modules-commonjs')],
}).code
const baseline = {
  name: 'Baseline',
  start_date: '2026-01-01',
  start_balance: 10000,
  monthly_contribution: 100,
  annual_return: 0,
  horizon: 5,
  retirement_target: 100000,
  emergency_cash_target: 30000,
  starting_contributions_ytd: 0,
  annual_contributions: {},
  annual_contributions_without_commitments: {},
  annual_commitment_drain: 0,
  include_commitments: true,
}
function harness({ storage = new Map(), blocked = false } = {}) {
  const fixtures = {
    alice: [
      { ...baseline, id: 'newest' },
      { ...baseline, id: 'original' },
    ],
    bob: [{ ...baseline, id: 'bob-plan' }],
  }
  const rows = [
    {
      id: 'pre',
      snapshot_date: '2025-01-15',
      investment_balance: 9000,
      retirement_balance: 0,
      emergency_cash: 20000,
      investment_contributions_ytd: 100,
    },
    {
      id: 'post',
      snapshot_date: '2032-01-15',
      investment_balance: 9000,
      retirement_balance: 0,
      emergency_cash: 20000,
      investment_contributions_ytd: 100,
    },
  ]
  let cells = [],
    index = 0,
    pending = [],
    owner = 'alice',
    deleteGate = null,
    releaseDelete = null
  const delayed = new Map(),
    resolvers = new Map()
  const storageApi = {
    getItem: (key) => {
      if (blocked) throw new Error('blocked')
      return storage.get(key)
    },
    setItem: (key, value) => {
      if (blocked) throw new Error('blocked')
      storage.set(key, value)
    },
    removeItem: (key) => storage.delete(key),
  }
  const hooks = {
    useState(initial) {
      const i = index++
      if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial
      return [
        cells[i],
        (v) => {
          cells[i] = typeof v === 'function' ? v(cells[i]) : v
        },
      ]
    },
    useRef(initial) {
      const i = index++
      if (!(i in cells)) cells[i] = { current: initial }
      return cells[i]
    },
    useMemo(fn, deps) {
      const i = index++
      const old = cells[i]
      if (!old || deps.some((v, j) => v !== old.deps[j])) cells[i] = { deps, value: fn() }
      return cells[i].value
    },
    useCallback(fn, deps) {
      const i = index++
      const old = cells[i]
      if (!old || deps.some((v, j) => v !== old.deps[j])) cells[i] = { deps, value: fn }
      return cells[i].value
    },
    useEffect(fn, deps) {
      const i = index++
      const old = cells[i]
      if (!old || deps.some((v, j) => v !== old.deps[j])) {
        pending.push(() => {
          old?.cleanup?.()
          cells[i] = { deps, cleanup: fn() }
        })
      }
    },
  }
  const stubs = {
    react: hooks,
    '../../lib/db/wealthSnapshots.js': {
      getWealthSnapshots: async () => rows.map((r) => ({ ...r })),
      saveWealthSnapshot: async () => ({}),
      deleteWealthSnapshot: async (id) => {
        if (deleteGate) await deleteGate
        const i = rows.findIndex((r) => r.id === id)
        if (i !== -1) rows.splice(i, 1)
      },
    },
    '../../lib/db/wealthPlans.js': {
      getWealthPlans: async () =>
        delayed.has(owner)
          ? new Promise((resolve) => resolvers.set(owner, resolve))
          : fixtures[owner],
      saveWealthPlan: async (payload) => {
        const saved = { ...payload, id: 'saved' }
        fixtures[owner].unshift(saved)
        return saved
      },
    },
    '../../lib/db/commitments.js': { getCommitments: async () => [] },
    '../../lib/commitments/schedule.js': { commitmentYearSchedule: () => [] },
    '../../lib/outlook/loadOutlook.js': { loadOutlookInputs: async () => null },
    '../../lib/outlook/outlookEngine.js': { buildOutlook: () => null },
    '../../lib/wealth/plans.js': {
      ...engine,
      latestSnapshots: (rows) => engine.latestSnapshots(rows, '2035-12-31'),
    },
    '../../lib/money.js': money,
    '../../lib/wealth/selection.js': {
      ...selection,
      readSelectedPlanId: (userId) => selection.readSelectedPlanId(userId, storageApi),
      storeSelectedPlanId: (userId, id) => selection.storeSelectedPlanId(userId, id, storageApi),
    },
    '../common/ModuleHeader.jsx': { default: () => {} },
    '../common/layout.js': { CONTENT_MAX: 1200 },
    './WealthChart.jsx': { default: () => {} },
    './Wealth.css': {},
  }
  const context = vm.createContext({
    exports: {},
    require: (name) => {
      assert.ok(name in stubs, name)
      return stubs[name]
    },
    h: (type, props, ...children) => ({ type, props: { ...props, children } }),
    Fragment: 'fragment',
    Intl,
    Date,
    console,
    window: { confirm: () => true },
  })
  vm.runInContext(code, context)
  function render() {
    index = 0
    return context.exports.default({ userId: owner, mobile: false })
  }
  async function settle() {
    let tree = render()
    for (let n = 0; n < 4; n++) {
      const effects = pending
      pending = []
      effects.forEach((fn) => fn())
      await new Promise((resolve) => setTimeout(resolve, 0))
      tree = render()
    }
    return tree
  }
  function remount() {
    cells.forEach((cell) => cell?.cleanup?.())
    cells = []
    pending = []
  }
  function all(tree) {
    const out = []
    function walk(node) {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) {
        node.forEach(walk)
        return
      }
      out.push(node)
      walk(node.props?.children)
    }
    walk(tree)
    return out
  }
  function version(tree) {
    return all(tree).find(
      (n) => n.type === 'select' && fixtures[owner].some((p) => p.id === n.props.value)
    )
  }
  function picker(tree, label) {
    const parent = all(tree).find((n) => n.type === 'label' && n.props.children[0] === label)
    return all(parent).find((n) => n.type === 'select')
  }
  return {
    storage,
    fixtures,
    delayPlans: (id) => delayed.set(id, true),
    holdDeletes: () => {
      deleteGate = new Promise((resolve) => {
        releaseDelete = resolve
      })
    },
    releaseDeletes: () => releaseDelete(),
    resolvePlans: (id) => resolvers.get(id)(fixtures[id]),
    render,
    settle,
    remount,
    all,
    version,
    picker,
    setUser: (id) => {
      owner = id
    },
  }
}
test('older selected version survives snapshot refresh and remount; users stay scoped; missing ID falls back', async () => {
  const h = harness()
  let tree = await h.settle()
  h.version(tree).props.onChange({ target: { value: 'original' } })
  tree = await h.settle()
  assert.equal(h.version(tree).props.value, 'original')
  const header = h.all(tree).find((n) => n.props?.moduleId === 'wealth')
  header.props.actions.props.onClick()
  tree = h.render()
  await h
    .all(tree)
    .find((n) => n.type?.name === 'SnapshotForm')
    .props.onSave({})
  tree = await h.settle()
  assert.equal(h.version(tree).props.value, 'original')
  h.all(tree)
    .find((n) => n.type === 'button' && n.props.children[0] === 'Delete')
    .props.onClick()
  tree = await h.settle()
  assert.equal(h.version(tree).props.value, 'original')
  h.remount()
  tree = await h.settle()
  assert.equal(h.version(tree).props.value, 'original')
  h.setUser('bob')
  assert.equal(h.version(h.render()), undefined)
  tree = await h.settle()
  assert.equal(h.version(tree).props.value, 'bob-plan')
  h.setUser('alice')
  tree = await h.settle()
  assert.equal(h.version(tree).props.value, 'original')
  h.fixtures.alice = h.fixtures.alice.filter((p) => p.id !== 'original')
  h.remount()
  tree = await h.settle()
  assert.equal(h.version(tree).props.value, 'newest')
  assert.deepEqual([...h.storage.values()].sort(), ['bob-plan', 'newest'])
})
test('new baseline saves its selected ID; inaccessible storage preserves selection during session', async () => {
  for (const blocked of [false, true]) {
    const h = harness({ blocked })
    let tree = await h.settle()
    h.version(tree).props.onChange({ target: { value: 'original' } })
    tree = await h.settle()
    assert.equal(h.version(tree).props.value, 'original')
    h.all(tree)
      .find((n) => n.type === 'button' && n.props.children.includes('Save new baseline'))
      .props.onClick()
    tree = h.render()
    await h
      .all(tree)
      .find((n) => n.type?.name === 'NewPlan')
      .props.onSave(baseline)
    tree = await h.settle()
    assert.equal(h.version(tree).props.value, 'saved')
    if (!blocked) {
      h.remount()
      tree = await h.settle()
      assert.equal(h.version(tree).props.value, 'saved')
    }
  }
})
test('prebaseline/posthorizon cash cards keep actuals but have no comparable annual or monthly target', async () => {
  const h = harness()
  let tree = await h.settle()
  for (const year of [2025, 2032]) {
    h.picker(tree, 'Checkpoint year').props.onChange({ target: { value: String(year) } })
    tree = h.render()
    const cash = h.all(tree).find((n) => n.props?.title === 'Recorded emergency cash')
    assert.equal(cash.props.actual, 20000)
    assert.equal(cash.props.expected, null)
    const investment = h.all(tree).find((n) => n.props?.title === 'Recorded investment actual')
    assert.equal(investment.props.expected, undefined)
    const target = h
      .all(tree)
      .find((n) => n.type === 'h3' && n.props.children[0] === 'Emergency cash target')
    assert.ok(target)
    const targetCard = h
      .all(tree)
      .find((n) => n.props?.className === 'wealth-benchmark' && h.all(n).includes(target))
    assert.ok(
      h
        .all(targetCard)
        .some((n) => n.props?.className === 'wealth-amount' && n.props.children[0] === '—')
    )
  }
  h.all(tree)
    .find((n) => n.props?.role === 'tab' && n.props.children[0] === 'Monthly check-in')
    .props.onClick()
  tree = h.render()
  h.picker(tree, 'Month').props.onChange({ target: { value: '0' } })
  for (const year of [2025, 2032]) {
    h.picker(h.render(), 'Year').props.onChange({ target: { value: String(year) } })
    tree = h.render()
    const cash = h.all(tree).find((n) => n.props?.title === 'Emergency cash')
    assert.equal(cash.props.actual, 20000)
    assert.equal(cash.props.expected, null)
  }
})

test('late previous-user plans GET cannot replace the current user selection', async () => {
  const h = harness()
  h.delayPlans('alice')
  let tree = await h.settle()
  assert.equal(h.version(tree), undefined)
  h.setUser('bob')
  tree = await h.settle()
  assert.equal(h.version(tree).props.value, 'bob-plan')
  h.resolvePlans('alice')
  tree = await h.settle()
  assert.equal(h.version(tree).props.value, 'bob-plan')
  assert.deepEqual([...h.storage.values()], ['bob-plan'])
})

test('a refresh started before saving a plan cannot remove the new row or selected ID', async () => {
  const h = harness()
  let tree = await h.settle()
  const oldRows = h.fixtures.alice.slice()
  const deleteButtons = (t) =>
    h.all(t).filter((n) => n.type === 'button' && n.props.children[0] === 'Delete')
  const before = deleteButtons(tree).length
  h.delayPlans('alice')
  deleteButtons(tree)[0].props.onClick()
  tree = await h.settle()
  h.all(tree)
    .find((n) => n.type === 'button' && n.props.children.includes('Save new baseline'))
    .props.onClick()
  tree = h.render()
  await h
    .all(tree)
    .find((n) => n.type?.name === 'NewPlan')
    .props.onSave(baseline)
  tree = h.render()
  assert.equal(h.version(tree).props.value, 'saved')
  h.fixtures.alice = oldRows
  h.resolvePlans('alice')
  tree = await h.settle()
  const version = h.all(tree).find((n) => n.type === 'select' && n.props.value === 'saved')
  assert.ok(version, 'saved baseline must remain in the loaded plans after an older response')
  assert.deepEqual([...h.storage.values()], ['saved'])
  assert.ok(h.all(version).some((n) => n.type === 'option' && n.props.value === 'saved'))
  assert.equal(deleteButtons(tree).length, before - 1, 'deleted snapshot must leave history')
})

test("a previous user's late delete refresh cannot drop the current user's read", async () => {
  const h = harness()
  let tree = await h.settle()
  h.holdDeletes()
  h.all(tree)
    .find((n) => n.type === 'button' && n.props.children[0] === 'Delete')
    .props.onClick()
  h.setUser('bob')
  h.delayPlans('bob')
  tree = await h.settle()
  h.releaseDeletes()
  await new Promise((resolve) => setTimeout(resolve, 0))
  h.resolvePlans('bob')
  tree = await h.settle()
  assert.equal(h.version(tree)?.props.value, 'bob-plan')
})

import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const babel = require('next/dist/compiled/babel/core')
const code = babel.transformSync(readFileSync(new URL('../../src/modules/forecast/Forecast.jsx', import.meta.url), 'utf8'), {
  babelrc: false, configFile: false,
  presets: [[require('next/dist/compiled/babel/preset-react'), { runtime: 'classic', pragma: 'h', pragmaFrag: 'Fragment' }]],
  plugins: [require('next/dist/compiled/babel/plugin-transform-modules-commonjs')],
}).code
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

function harness() {
  const category = { id: 'salary', category: 'Salary', group: 'Income', type: 'Fixed' }
  const year = new Date().getFullYear()
  let saved = [10, 11, 12].map(month => ({ id: `line-${month}`, category_id: category.id, budget_categories: category, year, month, label: 'Main job', amount: 100 }))
  const cells = []
  let cursor = 0, pending = [], tree, nextReads = []
  const props = { userId: 'alice', mobile: false, reloadSignal: 0, onDataChange() { props.reloadSignal += 1; render() } }
  const hooks = {
    Fragment: 'fragment',
    useState(initial) { const slot = cursor++; if (!(slot in cells)) cells[slot] = typeof initial === 'function' ? initial() : initial; return [cells[slot], value => { cells[slot] = typeof value === 'function' ? value(cells[slot]) : value }] },
    useRef(initial) { const slot = cursor++; if (!(slot in cells)) cells[slot] = { current: initial }; return cells[slot] },
    useMemo(fn, deps) { const slot = cursor++; const old = cells[slot]; if (!old || deps.some((dep, index) => dep !== old.deps[index])) cells[slot] = { deps, value: fn() }; return cells[slot].value },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps) },
    useEffect(fn, deps) { const slot = cursor++; const old = cells[slot]; if (!old || deps.some((dep, index) => dep !== old.deps[index])) { cells[slot] = { deps, cleanup: old?.cleanup }; pending.push(() => { old?.cleanup?.(); cells[slot].cleanup = fn() }) } },
  }
  const Popup = () => null
  const noop = () => null
  const update = vi.fn(async (id, { amount }) => { saved = saved.map(line => line.id === id ? { ...line, amount } : line) })
  const seams = {
    react: hooks,
    './ForecastGroupEditor.jsx': { default: Popup },
    '../common/MobileMonthPlan.jsx': { default: noop, MobileMonthSelector: noop, MobileAnnualSummary: noop },
    '../common/ModuleHeader.jsx': { default: noop },
    '../common/layout.js': { CONTENT_MAX: 1500 },
    '../../lib/dates.js': { parseLocalDate: value => new Date(value) },
    '../../lib/scenarios/scenarioUtils.js': { isIncomeAdjustment: () => false },
    '../../lib/db/budgetLineItems.js': { getBudgetLineItems: async () => saved.map(line => ({ ...line })), getBudgetYears: async () => [year, year + 1] },
    '../../lib/db/budgetCategories.js': { getBudgetCategories: async () => [category] },
    '../../lib/db/forecastLineItems.js': { getForecastLineItems: () => nextReads.length ? nextReads.shift().promise : Promise.resolve(saved.map(line => ({ ...line }))), updateForecastLineItem: update },
    '../../lib/db/transactions.js': { getTransactionsForYear: async () => [] },
    '../../lib/db/scenarios.js': { getScenarios: async () => [], getAdjustments: async () => [] },
  }
  for (const seam of Object.values(seams)) Object.defineProperty(seam, '__esModule', { value: true })
  const exports = {}
  vm.runInNewContext(code, { exports, require: name => seams[name], h: (type, nodeProps, ...children) => ({ type, props: nodeProps ?? {}, children: children.flat(Infinity).filter(child => child != null) }) })
  function render() { cursor = 0; tree = exports.default(props); const effects = pending; pending = []; for (const effect of effects) effect(); return tree }
  function nodes(node = tree) { if (!node || typeof node !== 'object') return []; return [node, ...node.children.flatMap(child => nodes(child))] }
  function popup() { return nodes().find(node => node.type === Popup) }
  function grid() { return nodes().find(node => node.props.kind === 'income') }
  async function settle() { await new Promise(resolve => setTimeout(resolve, 0)); render() }
  function open() { const income = grid(); income.props.onOpenGroup(income.props.catRows); render() }
  function holdRead() { const gate = deferred(); nextReads.push(gate); return gate }
  render()
  return { render, settle, popup, grid, open, holdRead, props, update, get saved() { return saved } }
}

describe('Forecast background refresh and popup mounting', () => {
  it('keeps the same popup mounted through reloadSignal/loading and saves all three months', async () => {
    const app = harness(); await app.settle(); app.open()
    const initialType = app.popup().type
    const initialKey = app.popup().props.key
    for (const [month, amount] of [[10, 123.45], [11, 234.56], [12, 345.67]]) {
      const gate = app.holdRead()
      await app.popup().props.onUpdateLine(`line-${month}`, amount, true)
      app.render()
      expect(app.popup()?.type).toBe(initialType)
      expect(app.popup()?.props.key).toBe(initialKey)
      gate.resolve(app.saved.map(line => ({ ...line })))
      await app.settle()
    }
    expect(app.update).toHaveBeenCalledTimes(3)
    expect(app.saved.map(line => line.amount)).toEqual([123.45, 234.56, 345.67])
    app.popup().props.onClose(); app.render()
    expect(app.popup()).toBeUndefined()
    app.props.reloadSignal += 1; app.render(); await app.settle()
    expect(app.popup()).toBeUndefined()
  })
  it('rejects out-of-order snapshots and reads started before a newer completed write', async () => {
    const app = harness(); await app.settle(); app.open()
    const oldRead = app.holdRead()
    const oldSnapshot = app.saved.map(line => ({ ...line }))
    app.props.reloadSignal += 1; app.render()
    const newestRead = app.holdRead()
    await app.popup().props.onUpdateLine('line-10', 777.89, true)
    app.render()
    newestRead.resolve(app.saved.map(line => ({ ...line }))); await app.settle()
    oldRead.resolve(oldSnapshot); await app.settle()
    expect(app.grid().props.catRows[0].forecast[9]).toBe(777.89)
    const beforeWrite = app.holdRead()
    app.props.reloadSignal += 1; app.render()
    const afterWrite = app.holdRead()
    await app.popup().props.onUpdateLine('line-11', 888.12, true)
    app.render()
    beforeWrite.resolve(oldSnapshot); await app.settle()
    expect(app.popup().props.rows[0].forecast[10]).toBe(888.12)
    afterWrite.resolve(app.saved.map(line => ({ ...line }))); await app.settle()
    expect(app.grid().props.catRows[0].forecast[10]).toBe(888.12)
  })
})

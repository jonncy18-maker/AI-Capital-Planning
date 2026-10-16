import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const babel = require('next/dist/compiled/babel/core')
const code = babel.transformSync(readFileSync(new URL('../../src/modules/forecast/ForecastGroupEditor.jsx', import.meta.url), 'utf8'), {
  babelrc: false, configFile: false,
  presets: [[require('next/dist/compiled/babel/preset-react'), { runtime: 'classic', pragma: 'h' }]],
  plugins: [require('next/dist/compiled/babel/plugin-transform-modules-commonjs')],
}).code

function harness(update = vi.fn().mockResolvedValue(undefined)) {
  const cells = []
  let cursor = 0
  const hooks = {
    useState(initial) {
      const slot = cursor++
      if (!(slot in cells)) cells[slot] = typeof initial === 'function' ? initial() : initial
      return [cells[slot], value => { cells[slot] = typeof value === 'function' ? value(cells[slot]) : value }]
    },
    useRef(initial) { const slot = cursor++; if (!(slot in cells)) cells[slot] = { current: initial }; return cells[slot] },
    useEffect() {},
  }
  const exports = {}
  vm.runInNewContext(code, { exports, require: () => hooks, h: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter(child => child != null) }) })
  const props = {
    rows: [{ catId: 'income', group: 'Income', name: 'Salary', items: [{ id: 'a', label: 'Main job', month: 1, amount: 101.25 }, { id: 'b', label: 'Main job', month: 2, amount: 50 }] }],
    year: new Date().getFullYear() + 1, editable: true,
    onUpdateLine: update, onAddLine: vi.fn().mockResolvedValue(undefined), onSetRate: vi.fn().mockResolvedValue(undefined), onDeleteLabel: vi.fn().mockResolvedValue(undefined), onClose: vi.fn(),
  }
  let tree
  function render() { cursor = 0; tree = exports.default(props); return tree }
  function nodes(node = tree) { if (!node || typeof node !== 'object') return []; return [node, ...node.children.flatMap(child => nodes(child))] }
  function label(name) { return nodes().find(node => node.props['aria-label'] === name) }
  function button(name) { return nodes().find(node => node.type === 'button' && node.children.includes(name)) }
  async function settle() { await new Promise(resolve => setTimeout(resolve, 0)); render() }
  render()
  return { props, render, label, button, nodes, settle }
}

describe('Forecast popup amount drafts', () => {
  it('survives deletion of the last category while retaining unrelated amount drafts', () => {
    const app = harness()
    app.label('Salary Main job Jan').props.onChange({ target: { value: '12.34' } })
    app.props.rows = []
    expect(() => app.render()).not.toThrow()
    expect(app.label('Salary Main job Jan').props.value).toBe('12.34')
  })
  it('retains a failed named missing-month draft after its category disappears', async () => {
    const app = harness()
    app.props.onUpdateLine.mockImplementation(async () => { app.props.rows = [] })
    app.props.onAddLine.mockRejectedValueOnce(new Error('Insert failed'))
    app.label('Salary Main job Jan').props.onChange({ target: { value: '0' } })
    app.label('Salary Main job Mar').props.onChange({ target: { value: '12.34' } })
    app.render(); app.button('Save changes').props.onClick(); await app.settle()
    expect(app.label('Salary Main job Mar').props.value).toBe('12.34')
    expect(app.button('Save changes').props.disabled).toBe(false)
    expect(app.props.onAddLine).toHaveBeenCalledWith('income', 'Main job', 3, 12.34)
  })
  it('Escape requests parent-owned closure and is blocked during persistence', async () => {
    let release
    const app = harness(vi.fn(() => new Promise(resolve => { release = resolve })))
    const event = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() }
    app.nodes()[0].props.onKeyDown(event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(app.props.onClose).toHaveBeenCalledOnce()
    app.props.onClose.mockClear()
    app.label('Salary Main job Jan').props.onChange({ target: { value: '15' } })
    app.render(); app.button('Save changes').props.onClick(); app.render()
    app.nodes()[0].props.onKeyDown(event)
    app.nodes()[0].props.onCancel(event)
    expect(app.props.onClose).not.toHaveBeenCalled()
    release(); await app.settle()
    app.nodes()[0].props.onCancel(event)
    expect(app.props.onClose).toHaveBeenCalledOnce()
  })
  it('Cancel never persists changed amounts', () => {
    const app = harness()
    app.label('Salary Main job Jan').props.onChange({ target: { value: '199.45' } })
    app.render()
    app.button('Cancel').props.onClick()
    expect(app.props.onClose).toHaveBeenCalledOnce()
    expect(app.props.onUpdateLine).not.toHaveBeenCalled()
  })
  it('saves signed cents and zero, prevents duplicate submit, and blocks immediate actions while dirty', async () => {
    let release
    const update = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve })).mockResolvedValue(undefined)
    const app = harness(update)
    app.label('Salary Main job Jan').props.onChange({ target: { value: '-12.45' } })
    app.label('Salary Main job Feb').props.onChange({ target: { value: '0' } })
    app.render()
    expect(app.button('Delete line now').props.disabled).toBe(true)
    app.button('Save changes').props.onClick()
    app.button('Save changes').props.onClick()
    expect(update).toHaveBeenCalledTimes(1)
    release()
    await app.settle()
    expect(update.mock.calls).toEqual([['a', -12.45, true], ['b', 0, true]])
    expect(app.button('Save changes').props.disabled).toBe(true)
  })
  it('validates all drafts before any write and retains failed drafts for retry', async () => {
    const app = harness()
    app.label('Salary Main job Jan').props.onChange({ target: { value: '7.89' } })
    app.label('Salary Main job Feb').props.onChange({ target: { value: '' } })
    app.render(); app.button('Save changes').props.onClick(); await app.settle()
    expect(app.props.onUpdateLine).not.toHaveBeenCalled()
    expect(app.label('Salary Main job Jan').props.value).toBe('7.89')
    expect(app.nodes().some(node => node.props.role === 'alert')).toBe(true)
    app.label('Salary Main job Feb').props.onChange({ target: { value: '25.34' } })
    app.props.onUpdateLine.mockRejectedValueOnce(new Error('Save failed'))
    app.render(); app.button('Save changes').props.onClick(); await app.settle()
    expect(app.label('Salary Main job Jan').props.value).toBe('7.89')
    expect(app.button('Save changes').props.disabled).toBe(false)
  })
})

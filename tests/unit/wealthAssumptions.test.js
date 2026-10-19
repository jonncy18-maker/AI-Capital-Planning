import { describe, it, expect } from 'vitest'
import { defaultAssumptions, validateAssumptions } from '../../src/lib/wealth/assumptions.js'
import {
  retirementTarget,
  baseReturn,
  scenarioRates,
  annualFlows,
  planFromAssumptions,
  scenarioLines,
  planHorizon,
  balanceAtAge,
} from '../../src/lib/wealth/projection.js'
import { validatePlan, expectedAt } from '../../src/lib/wealth/plans.js'

const A = (over = {}) => ({ ...defaultAssumptions(), ...over })
const START = '2026-10-18'

describe('retirement target', () => {
  it('is 25x spend inflated to the retirement age', () => {
    expect(retirementTarget(A({ retirement_age: 60 }))).toBeCloseTo(
      25 * 105000 * Math.pow(1.03, 28),
      1
    )
    expect(retirementTarget(A({ retirement_age: 55, inflation: 0 }))).toBe(2625000)
    expect(retirementTarget(A({ retirement_age: 65 }))).toBeGreaterThan(
      retirementTarget(A({ retirement_age: 55 }))
    )
  })
})

describe('return modes and scenarios', () => {
  it('manual mode uses the manual rate; index mode uses the chosen preset', () => {
    expect(baseReturn(A())).toBe(0.07)
    expect(baseReturn(A({ return_mode: 'index', index_preset: '10y' }))).toBe(0.1467)
    expect(baseReturn(A({ return_mode: 'index', index_preset: '30y' }))).toBe(0.0991)
  })
  it('default pair is base +/- 2% and extra scenarios are added; rates floor at 0', () => {
    const r = scenarioRates(A())
    expect(r.map((x) => x.rate)).toEqual([0.07, 0.05, 0.09])
    const more = scenarioRates(
      A({ scenarios: [{ name: 'Crash', delta: -0.1 }], manual_return: 0.05 })
    )
    expect(more[1].rate).toBe(0)
  })
})

describe('annual contribution flows', () => {
  it('2026 payroll caps, 25% match, Roth from surplus, rest to emergency then taxable', () => {
    const f = annualFlows(A({ emergency: { target: 30000, current: 22000 } }), START, 5)
    const y0 = f[0]
    expect(y0.year).toBe(2026)
    expect(y0.employee_401k).toBe(24178)
    expect(y0.match_401k).toBe(6044.5)
    expect(y0.hsa).toBe(4400)
    expect(y0.roth_ira).toBe(7500)
    // 10,000 surplus - 7,500 Roth = 2,500, all into the emergency gap
    expect(y0.to_emergency).toBe(2500)
    expect(y0.taxable).toBe(0)
    expect(y0.total).toBe(24178 + 6044.5 + 7500 + 4400)
  })
  it('caps and pay grow 3%/yr; surplus beyond the emergency target goes to taxable', () => {
    const f = annualFlows(A({ emergency: { target: 30000, current: 30000 } }), START, 3)
    expect(f[1].hsa).toBeCloseTo(4400 * 1.03, 2)
    expect(f[0].taxable).toBe(2500)
    expect(f[1].taxable).toBeCloseTo(10300 - 7500 * 1.03, 2)
  })
  it('emergency fund fills across years before taxable receives anything', () => {
    const f = annualFlows(A({ emergency: { target: 30000, current: 27000 } }), START, 6)
    const toEc = f.reduce((s, r) => s + r.to_emergency, 0)
    expect(toEc).toBeCloseTo(3000, 2)
    expect(f[0].taxable).toBe(0)
    expect(f.at(-1).taxable).toBeGreaterThan(0)
  })
  it('uses outlook surplus for captured years and limits Roth to available surplus', () => {
    const a = A({
      surplus_by_year: { 2027: 3000, 2028: -2000 },
      emergency: { target: 0, current: 0 },
    })
    const f = annualFlows(a, START, 3)
    expect(f[1].roth_ira).toBe(3000)
    expect(f[1].taxable).toBe(0)
    expect(f[2].roth_ira).toBe(0)
    expect(f[2].taxable).toBe(-2000)
  })
  it('catch-up is off by default and adds 401k/IRA at 50 and HSA at 55 when on', () => {
    const off = annualFlows(A(), '2026-01-01', 25)
    const on = annualFlows(A({ catch_up: { ...A().catch_up, enabled: true } }), '2026-01-01', 25)
    expect(on[17].employee_401k).toBe(off[17].employee_401k) // age 49
    expect(on[18].employee_401k - off[18].employee_401k).toBeGreaterThan(0) // age 50
    expect(on[18].hsa).toBe(off[18].hsa)
    expect(on[23].hsa - off[23].hsa).toBe(1000) // age 55
    expect(off[18].employee_401k).toBeLessThanOrEqual(24500 * Math.pow(1.03, 18))
  })
  it('employee contribution is capped at the cap', () => {
    const f = annualFlows(A({ employee_401k: 99999 }), START, 1)
    expect(f[0].employee_401k).toBe(24500)
  })
})

describe('plan from assumptions', { timeout: 30000 }, () => {
  const plan = () =>
    planFromAssumptions({
      name: 'Test',
      startDate: START,
      startBalance: 350903.6,
      assumptions: A({ emergency: { target: 30000, current: 22000 } }),
    })
  it('produces a valid plan row with derived target, return and calendar-year contributions', () => {
    const p = plan()
    const v = validatePlan(p)
    expect(v.annual_return).toBe(0.07)
    expect(v.horizon).toBe(33)
    expect(v.retirement_target).toBe(retirementTarget(p.assumptions))
    expect(Object.keys(v.annual_contributions)).toHaveLength(34)
    expect(v.assumptions.retirement_age).toBe(60)
  })
  it('horizon covers age 65 even when retiring earlier', () => {
    expect(planHorizon(A({ retirement_age: 55 }))).toBe(33)
  })
  it('scenario lines order by return and share the same contributions', () => {
    const lines = scenarioLines(plan())
    expect(lines.map((l) => l.name)).toEqual(['Base', 'Base −2%', 'Base +2%'])
    const end = (l) => l.series.monthly.at(-1).balance
    expect(end(lines[1])).toBeLessThan(end(lines[0]))
    expect(end(lines[2])).toBeGreaterThan(end(lines[0]))
    // higher return reaches the target earlier
    expect(lines[2].reachedAge).toBeLessThan(lines[1].reachedAge ?? 99)
  })
  it('by-age lookup returns the December balance of that age', () => {
    const p = plan()
    const base = scenarioLines(p)[0]
    expect(balanceAtAge(p, base, 33)).toBe(expectedAt(p, '2027-12-31').balance)
  })
  it('every scenario is deterministic with a hand-checkable zero-return case', () => {
    const a = A({
      manual_return: 0,
      scenarios: [],
      surplus: { base: 0, source: 'manual' },
      caps: { year: 2026, k401: 12000, ira: 0, hsa: 0, growth: 0 },
      employee_401k: 12000,
      match_rate: 0,
      pay_growth: 0,
      emergency: { target: 0, current: 0 },
    })
    const p = planFromAssumptions({
      name: 'Z',
      startDate: '2027-01-01',
      startBalance: 1000,
      assumptions: a,
    })
    // the baseline is the close of its date, so day 1 of 2027 earns no deposit
    const y27 = expectedAt(p, '2027-12-31').balance
    expect(y27).toBeCloseTo(13000 - 1000 / 31, 1)
    expect(expectedAt(p, '2028-12-31').balance - y27).toBeCloseTo(12000, 6)
  })
})

describe('assumption validation', () => {
  it('accepts the defaults', () => {
    expect(() => validateAssumptions(defaultAssumptions())).not.toThrow()
  })
  it('rejects bad shapes', () => {
    for (const bad of [
      { retirement_age: 30 },
      { return_mode: 'live' },
      { inflation: 0.5 },
      { scenarios: [{ name: '', delta: 0.01 }] },
      { scenarios: [{ name: 'x', delta: 0.5 }] },
      { manual_return: 0.3 },
      { return_mode: 'index', index_preset: 'nope' },
      { caps: { year: 2026, k401: -1, ira: 0, hsa: 0, growth: 0 } },
    ])
      expect(() => validateAssumptions({ ...defaultAssumptions(), ...bad })).toThrow()
  })
  it('keeps index presets with as-of date and source', () => {
    const v = validateAssumptions(defaultAssumptions())
    expect(v.presets.map((p) => p.rate)).toEqual([0.1116, 0.1467, 0.0991])
    expect(v.presets[0].as_of).toBe('2026-10-17')
  })
})

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  deriveCashflow,
  budgetFallback,
  cashflowMap,
  sourceLabel,
} from '../../src/lib/wealth/cashflow.js'
import { defaultAssumptions, validateAssumptions } from '../../src/lib/wealth/assumptions.js'
import {
  annualFlows,
  planFromAssumptions,
  planHorizon,
  derivePlan,
} from '../../src/lib/wealth/projection.js'
import { validatePlan, captureOutlook } from '../../src/lib/wealth/plans.js'
import { commitmentYearSchedule } from '../../src/lib/commitments/schedule.js'
import { buildOutlook } from '../../src/lib/outlook/outlookEngine.js'
import { toCents, fromCents, mulCents, parseCentsStrict } from '../../src/lib/money.js'

const golden = JSON.parse(
  readFileSync(new URL('./fixtures/wealth-legacy-golden.json', import.meta.url), 'utf8')
)
const CUR = 2026
const GOOD = { hasData: true, fullYearIncome: 100000, fullYearExpenses: 70000 }
const BUDGET = { takeHome: 80000, spending: 60000 }
const rowFor = (rows, year) => rows.find((r) => r.year === year)

function derive(over = {}) {
  return deriveCashflow({
    startYear: CUR,
    endYear: CUR + 10,
    curYear: CUR,
    payGrowth: 0.03,
    spendGrowth: 0.03,
    current: GOOD,
    budget: BUDGET,
    outlook: null,
    ...over,
  })
}

const monthly100 = {
  start_date: '2026-01-01',
  end_date: '2033-12-31',
  cost_structure: { kind: 'monthly', amount: 100 },
}
const catalog = [
  { id: 'c1', group: 'Housing' },
  { id: 'c2', group: 'Fun' },
]
const realOutlook = (over = {}) =>
  buildOutlook({
    nextYear: 2027,
    baseYear: 2027,
    baseLineItems: [
      { category_id: 'c1', amount: 12000, budget_categories: { group: 'Housing' } },
      { category_id: 'c2', amount: 6000, budget_categories: { group: 'Fun' } },
    ],
    categories: catalog,
    commitments: [monthly100],
    takeHomeBase: 60000,
    assumptions: {},
    events: [{ year: 2029, amount: 1500 }],
    ...over,
  })
// Hand-built outlook in the buildOutlook shape, for the years after its window.
const handOutlook = () => ({
  empty: false,
  baseYear: CUR + 1,
  columns: [1, 2, 3, 4, 5].map((n) => ({ year: CUR + n, kind: 'outlook' })),
  groups: [
    { name: 'A', base: 1000, rate: 0.05 },
    { name: 'B', base: 500, rate: 0 },
  ],
  income: [50000, 51000, 52000, 53000, 54000],
  groupTotals: [1500, 1550, 1600, 1650, 1700],
  commitments: [1200, 1200, 1200, 1200, 1200],
  events: [0, 0, 0, 0, 0].map((total) => ({ total })),
  netSavings: [47300, 48250, 49200, 50150, 51100],
})

describe('legacy plans are unchanged', () => {
  const fixtures = {
    L1: { a: defaultAssumptions(), start: '2026-10-18', balance: 350903.6, ytd: null },
    L2: {
      a: {
        ...defaultAssumptions(),
        surplus: { base: 10000, source: 'outlook' },
        surplus_by_year: { 2027: 3000, 2028: -2000 },
        emergency: { target: 30000, current: 22000 },
      },
      start: '2026-07-01',
      balance: 1000,
      ytd: 5000,
    },
    L3: {
      a: (() => {
        const a = defaultAssumptions()
        a.catch_up.enabled = true
        a.pay_growth = 0.05
        a.spend_growth = 0.1
        a.retirement_age = 55
        return a
      })(),
      start: '2026-01-01',
      balance: 0,
      ytd: null,
    },
  }
  const input = (k) => ({
    name: k,
    startDate: fixtures[k].start,
    startBalance: fixtures[k].balance,
    startingContributionsYtd: fixtures[k].ytd,
    assumptions: structuredClone(fixtures[k].a),
  })
  for (const k of Object.keys(fixtures)) {
    it(`${k} matches the output captured before the change`, () => {
      const f = fixtures[k]
      expect(annualFlows(structuredClone(f.a), f.start, planHorizon(f.a))).toStrictEqual(
        golden[k].annualFlows
      )
      expect(planFromAssumptions(input(k))).toStrictEqual(golden[k].planFromAssumptions)
      expect(validateAssumptions(structuredClone(f.a))).toStrictEqual(golden[k].validateAssumptions)
      expect(derivePlan(validatePlan(planFromAssumptions(input(k))))).toStrictEqual(
        golden[k].derivePlan
      )
    })
  }

  it('spend_growth alone does not move a legacy plan', () => {
    const f = fixtures.L3
    const b = { ...f.a, spend_growth: 0.2 }
    expect(annualFlows(b, f.start, planHorizon(b))).toStrictEqual(
      annualFlows(f.a, f.start, planHorizon(f.a))
    )
    expect(planFromAssumptions({ ...input('L3'), assumptions: b }).annual_contributions).toEqual(
      planFromAssumptions(input('L3')).annual_contributions
    )
  })

  it('a validated legacy plan has no cashflow_by_year key', () => {
    expect('cashflow_by_year' in validateAssumptions(defaultAssumptions())).toBe(false)
  })
})

describe('current-year row', () => {
  it('uses the Dashboard actual + forecast', () => {
    const [row] = derive({
      current: { hasData: true, fullYearIncome: 100000.55, fullYearExpenses: 70000.1 },
    })
    expect(row).toEqual({
      year: CUR,
      take_home: 100000.55,
      spending: 70000.1,
      surplus: 30000.45,
      source: 'actual_forecast',
    })
  })

  it('falls to the budget when the Dashboard has nothing usable', () => {
    for (const current of [
      null,
      { ...GOOD, hasData: false },
      { ...GOOD, fullYearIncome: 0 },
      { ...GOOD, fullYearIncome: NaN },
    ]) {
      const [row] = derive({ current })
      expect(row).toMatchObject({ take_home: 80000, spending: 60000, source: 'budget' })
    }
  })

  it('is manual when take-home is unknown, prefilled with what is known', () => {
    const [a] = derive({ current: null, budget: { takeHome: null, spending: 60000 } })
    expect(a).toMatchObject({ take_home: 0, spending: 60000, source: 'manual' })
    const [b] = derive({ current: null, budget: { takeHome: null, spending: null } })
    expect(b).toMatchObject({ take_home: 0, spending: 0, source: 'manual' })
  })
})

describe('budgetFallback', () => {
  const ctx = {
    incomeEstimate: { netIncome: 90000.123 },
    categories: [
      { id: 'a', group: 'Housing' },
      { id: 'b', group: 'Misc', exclude_from_totals: true },
      { id: 'c', group: ' Transfers ' },
      { id: 'd', group: 'Income' },
    ],
    budgetLineItems: [
      { category_id: 'a', amount: 1000 },
      { category_id: 'a', amount: 250.5, commitment_id: 'k' },
      { category_id: 'b', amount: 999 },
      { category_id: 'c', amount: 888 },
      { category_id: 'd', amount: 777 },
      { category_id: 'x', amount: 5, budget_categories: { group: 'income' } },
      { category_id: 'y', amount: 6, budget_categories: { group: 'Transfers' } },
      {
        category_id: 'z',
        amount: 7,
        budget_categories: { group: 'Fun', exclude_from_totals: true },
      },
      { category_id: 'w', amount: 3, budget_categories: { group: 'Fun' } },
    ],
  }
  it('sums spending lines, keeping commitment lines and dropping the rest', () => {
    expect(budgetFallback(ctx)).toEqual({ takeHome: 90000.12, spending: 1253.5 })
  })
  it('returns null spending for no lines and null take-home for bad net income', () => {
    expect(budgetFallback({ incomeEstimate: { netIncome: 5 }, budgetLineItems: [] })).toEqual({
      takeHome: 5,
      spending: null,
    })
    for (const netIncome of [0, -5, undefined]) {
      expect(budgetFallback({ incomeEstimate: { netIncome } }).takeHome).toBeNull()
    }
    expect(budgetFallback(null)).toEqual({ takeHome: null, spending: null })
  })
})

describe('outlook window', () => {
  it('rows take take-home and spending from the outlook and match captureOutlook', () => {
    const outlook = realOutlook()
    const rows = derive({ outlook, endYear: 2031 })
    const captured = captureOutlook(outlook).withCommitments
    for (const c of outlook.columns) {
      const i = outlook.columns.indexOf(c)
      const r = rowFor(rows, c.year)
      expect(r.source).toBe('outlook')
      expect(r.spending).toBe(
        fromCents(
          toCents(outlook.groupTotals[i]) +
            toCents(outlook.commitments[i]) +
            toCents(outlook.events[i].total)
        )
      )
      expect(r.surplus).toBe(captured[c.year])
      expect(toCents(r.take_home) - toCents(r.spending)).toBe(toCents(outlook.netSavings[i]))
    }
  })

  it('chains take-home at pay growth when the outlook has no income', () => {
    const outlook = realOutlook({ takeHomeBase: null })
    const rows = derive({ outlook, endYear: 2031 })
    const r27 = rowFor(rows, 2027)
    expect(r27.take_home).toBe(fromCents(mulCents(toCents(100000), 1.03)))
    expect(r27.spending).toBe(
      fromCents(
        toCents(outlook.groupTotals[0]) +
          toCents(outlook.commitments[0]) +
          toCents(outlook.events[0].total)
      )
    )
    expect(r27.source).toBe('growth')
  })

  it('chains both figures from the prior year with no usable outlook', () => {
    for (const outlook of [null, { empty: true }]) {
      const rows = derive({ outlook, endYear: 2028, payGrowth: 0.04, spendGrowth: 0.06 })
      const r27 = rowFor(rows, 2027)
      expect(r27.take_home).toBe(fromCents(mulCents(toCents(100000), 1.04)))
      expect(r27.spending).toBe(fromCents(mulCents(toCents(70000), 1.06)))
      expect(r27.source).toBe('growth')
      expect(rowFor(rows, 2028).spending).toBe(fromCents(mulCents(toCents(r27.spending), 1.06)))
    }
  })
})

describe('after the window', () => {
  const extras = {
    commitments: [monthly100],
    events: [{ year: CUR + 8, amount: 2000 }],
  }
  const commitCents = (year, list = extras.commitments) =>
    list.reduce(
      (s, c) => s + toCents(commitmentYearSchedule(c, year).reduce((x, y) => x + y, 0)),
      0
    )

  it('grows the last outlook group total at spend growth, with commitments and events on real dates', () => {
    const rows = derive({ outlook: handOutlook(), extras, endYear: CUR + 8, spendGrowth: 0.04 })
    const r6 = rowFor(rows, CUR + 6)
    expect(r6.spending).toBe(
      fromCents(mulCents(toCents(1700), 1.04) + commitCents(CUR + 6))
    )
    expect(r6.take_home).toBe(fromCents(mulCents(toCents(54000), 1.03)))
    expect(r6.source).toBe('growth')
    const r8 = rowFor(rows, CUR + 8)
    expect(r8.spending).toBe(
      fromCents(mulCents(toCents(1700), Math.pow(1.04, 3)) + commitCents(CUR + 8) + toCents(2000))
    )
  })

  it('spend growth moves years after the window but not years inside it', () => {
    const at = (spendGrowth) =>
      derive({ outlook: handOutlook(), extras, endYear: CUR + 8, spendGrowth })
    const low = at(0.03)
    const high = at(0.06)
    for (let n = 0; n <= 5; n++)
      expect(rowFor(high, CUR + n).spending).toBe(rowFor(low, CUR + n).spending)
    for (let n = 6; n <= 8; n++)
      expect(rowFor(high, CUR + n).spending).toBeGreaterThan(rowFor(low, CUR + n).spending)
  })

  it('does not compound a last-year event into later years', () => {
    const o = handOutlook()
    o.events[4] = { total: 5000 }
    const rows = derive({ outlook: o, extras: { commitments: [monthly100], events: [] }, endYear: CUR + 6 })
    expect(rowFor(rows, CUR + 5).spending).toBe(fromCents(toCents(1700) + toCents(1200) + toCents(5000)))
    expect(rowFor(rows, CUR + 6).spending).toBe(
      fromCents(mulCents(toCents(1700), 1.03) + commitCents(CUR + 6, [monthly100]))
    )
  })

  it('keeps commitments on their schedule dates after the window', () => {
    const ending = { ...monthly100, end_date: `${CUR + 6}-06-30` }
    const starting = { ...monthly100, start_date: `${CUR + 7}-01-01`, end_date: `${CUR + 9}-12-31` }
    const list = [ending, starting]
    const rows = derive({ outlook: handOutlook(), extras: { commitments: list, events: [] }, endYear: CUR + 8 })
    for (const n of [6, 7, 8])
      expect(rowFor(rows, CUR + n).spending).toBe(
        fromCents(mulCents(toCents(1700), Math.pow(1.03, n - 5)) + commitCents(CUR + n, list))
      )
    expect(commitCents(CUR + 6, list)).toBeGreaterThan(0)
  })

  it('adds a planned event once in its year without compounding it', () => {
    const rows = derive({ outlook: handOutlook(), extras, endYear: CUR + 9 })
    const base = (n) => mulCents(toCents(1700), Math.pow(1.03, n - 5)) + commitCents(CUR + n)
    expect(rowFor(rows, CUR + 8).spending).toBe(fromCents(base(8) + toCents(2000)))
    expect(rowFor(rows, CUR + 9).spending).toBe(fromCents(base(9)))
  })

  it('an outlook-less plan still chains from the prior year at spend growth', () => {
    const at = (spendGrowth) =>
      derive({ outlook: null, endYear: CUR + 8, spendGrowth }).map((r) => r.spending)
    const low = at(0.03)
    const high = at(0.06)
    for (let i = 1; i < low.length; i++) expect(high[i]).toBeGreaterThan(low[i])
  })

  it('chains from the prior year when no outlook column is after the current year', () => {
    const o = handOutlook()
    o.columns = [{ year: CUR - 1, kind: 'outlook' }, { year: CUR, kind: 'outlook' }]
    const rows = derive({ outlook: o, endYear: CUR + 2, spendGrowth: 0.06 })
    const r1 = rowFor(rows, CUR + 1)
    expect(r1.spending).toBe(fromCents(mulCents(toCents(70000), 1.06)))
    expect(rowFor(rows, CUR + 2).spending).toBe(fromCents(mulCents(toCents(r1.spending), 1.06)))
  })

  it('a later-year manual override sticks and does not move the growth base', () => {
    const base = derive({ outlook: handOutlook(), extras, endYear: CUR + 8 })
    const rows = derive({
      outlook: handOutlook(),
      extras,
      endYear: CUR + 8,
      overrides: { [CUR + 6]: { take_home: 1, spending: 2 } },
    })
    expect(rowFor(rows, CUR + 6)).toMatchObject({ spending: 2, source: 'manual' })
    expect(rowFor(rows, CUR + 7).spending).toBe(rowFor(base, CUR + 7).spending)
  })
})

describe('overrides', () => {
  it('sticks, rounds, clamps and feeds later chained years', () => {
    const rows = derive({ overrides: { [CUR + 2]: { take_home: 1234.567, spending: -5 } } })
    expect(rowFor(rows, CUR + 2)).toMatchObject({
      take_home: 1234.57,
      spending: 0,
      source: 'manual',
    })
    expect(rowFor(rows, CUR + 3).take_home).toBe(fromCents(mulCents(toCents(1234.57), 1.03)))
    expect(rowFor(rows, CUR + 3).spending).toBe(0)
  })

  it('overrides the current year whatever the Dashboard holds', () => {
    const rows = derive({ overrides: { [CUR]: { take_home: 1, spending: 2 } } })
    expect(rows[0]).toMatchObject({ take_home: 1, spending: 2, surplus: -1, source: 'manual' })
  })

  it('does not mutate its inputs', () => {
    const input = {
      current: { ...GOOD },
      budget: { ...BUDGET },
      outlook: handOutlook(),
      extras: { commitments: [monthly100], events: [{ year: CUR + 8, amount: 5 }] },
      overrides: { [CUR + 1]: { take_home: 5, spending: 6 } },
    }
    const before = structuredClone(input)
    derive(input)
    expect(input).toEqual(before)
  })
})

describe('range and rounding', () => {
  it('starts at startYear when it is after the current year', () => {
    const rows = derive({ startYear: CUR + 3, outlook: null })
    expect(rows[0].year).toBe(CUR + 3)
    const full = derive({ outlook: null })
    expect(rows[0]).toEqual(rowFor(full, CUR + 3))
  })

  it('starts at the current year when the plan starts earlier, and the old formula covers the gap', () => {
    const a = { ...defaultAssumptions() }
    const rows = derive({ startYear: 2024, endYear: 2024 + planHorizon(a) })
    expect(rows[0].year).toBe(CUR)
    const withMap = { ...a, cashflow_by_year: cashflowMap(rows) }
    const flows = annualFlows(withMap, '2024-06-01', planHorizon(a))
    const legacy = annualFlows(a, '2024-06-01', planHorizon(a))
    expect(flows[0].surplus).toBe(legacy[0].surplus)
    expect(flows[1].surplus).toBe(legacy[1].surplus)
    expect(flows[2].surplus).toBe(rows[0].surplus)
  })

  it('ends at endYear', () => {
    const rows = derive({ endYear: CUR + 7 })
    expect(rows.at(-1).year).toBe(CUR + 7)
  })

  it('keeps every figure at whole cents over 40 years', () => {
    const rows = derive({ endYear: CUR + 40, payGrowth: 0.037, spendGrowth: 0.037 })
    for (const r of rows)
      for (const k of ['take_home', 'spending', 'surplus'])
        expect(parseCentsStrict(r[k])).not.toBeNull()
  })

  it('labels the sources', () => {
    expect(sourceLabel('actual_forecast', 2026)).toBe('Actual + Forecast')
    expect(sourceLabel('budget', 2026)).toBe('2026 budget')
    expect(sourceLabel('outlook', 2027)).toBe('5-year outlook')
    expect(sourceLabel('growth', 2032)).toBe('Growth rates')
    expect(sourceLabel('manual', 2030)).toBe('Manual')
  })
})

describe('validation, projection and plan round trip', () => {
  const map = (over = {}) => ({
    2026: { take_home: 100000, spending: 70000, source: 'actual_forecast' },
    2027: { take_home: 103000, spending: 72100, source: 'growth' },
    ...over,
  })
  const withMap = (cashflow_by_year, over = {}) => ({
    ...defaultAssumptions(),
    ...over,
    cashflow_by_year,
  })

  it('accepts a valid map and drops a client surplus and unknown keys', () => {
    const v = validateAssumptions(
      withMap({ 2026: { take_home: 1, spending: 2, source: 'manual', surplus: 99, extra: 1 } })
    )
    expect(v.cashflow_by_year).toStrictEqual({
      2026: { take_home: 1, spending: 2, source: 'manual' },
    })
  })

  it('rejects bad shapes', () => {
    const bad = [
      map({ 2026: { take_home: 1, spending: 2, source: 'magic' } }),
      map({ 2026: { take_home: 1, spending: -1, source: 'manual' } }),
      map({ 2026: { take_home: 1.001, spending: 2, source: 'manual' } }),
      [map()],
      { '20x6': { take_home: 1, spending: 2, source: 'manual' } },
      { 1999: { take_home: 1, spending: 2, source: 'manual' } },
      Object.fromEntries(
        Array.from({ length: 101 }, (_, i) => [
          2000 + i,
          { take_home: 1, spending: 1, source: 'manual' },
        ])
      ),
    ]
    for (const b of bad) expect(() => validateAssumptions(withMap(b))).toThrow()
  })

  it('annualFlows prefers cashflow_by_year, then surplus_by_year, then the base formula', () => {
    const a = withMap(map(), { surplus_by_year: { 2026: 1, 2028: 4321 } })
    const flows = annualFlows(a, '2026-01-01', 3)
    expect(flows[0].surplus).toBe(30000)
    expect(flows[1].surplus).toBe(30900)
    expect(flows[2].surplus).toBe(4321)
    expect(flows[3].surplus).toBe(
      Math.round(a.surplus.base * Math.pow(1 + a.pay_growth, 2029 - a.caps.year) * 100) / 100
    )
  })

  it('spend growth moves the projection once rows are re-derived (F-003)', () => {
    const plan = (spendGrowth) => {
      const base = {
        ...defaultAssumptions(),
        spend_growth: spendGrowth,
        emergency: { target: 0, current: 0 },
      }
      const rows = derive({ spendGrowth, endYear: 2026 + planHorizon(base), outlook: null })
      const a = { ...base, cashflow_by_year: cashflowMap(rows) }
      return {
        flows: annualFlows(a, '2026-01-01', planHorizon(a)),
        plan: planFromAssumptions({
          name: 'x',
          startDate: '2026-01-01',
          startBalance: 0,
          assumptions: a,
        }),
      }
    }
    const lo = plan(0.03)
    const hi = plan(0.06)
    for (let i = 1; i < lo.flows.length; i++) {
      expect(hi.flows[i].surplus).toBeLessThan(lo.flows[i].surplus)
      expect(hi.flows[i].total).not.toBe(lo.flows[i].total)
      const year = lo.flows[i].year
      expect(hi.plan.annual_contributions[year]).not.toBe(lo.plan.annual_contributions[year])
    }
  })

  it('adds no commitment drain with or without the map', () => {
    const a = withMap(map())
    const p = planFromAssumptions({
      name: 'x',
      startDate: '2026-01-01',
      startBalance: 0,
      assumptions: a,
    })
    expect(p.include_commitments).toBe(false)
    expect(p.annual_commitment_drain).toBe(0)
    expect(p.annual_contributions_without_commitments).toStrictEqual(p.annual_contributions)
  })

  it('derivePlan keeps the map and recomputes contributions from it', () => {
    const a = withMap(map())
    const p = planFromAssumptions({
      name: 'x',
      startDate: '2026-01-01',
      startBalance: 0,
      assumptions: a,
    })
    const forged = {
      ...p,
      annual_contributions: { 2026: 1 },
      annual_contributions_without_commitments: { 2026: 1 },
    }
    const derived = derivePlan(validatePlan(forged))
    expect(derived.assumptions.cashflow_by_year).toStrictEqual(a.cashflow_by_year)
    expect(derived.annual_contributions).toEqual(p.annual_contributions)
  })
})

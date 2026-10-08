import { describe, it, expect } from 'vitest'
import {
  buildOutlook,
  computeGroupBases,
  computeCushion,
  outlookContributionMaps,
} from '../../src/lib/outlook/outlookEngine.js'
import { summarizeOutlookAdjustments } from '../../src/lib/outlook/scenarioSummary.js'

const categories = [{ id: 1, group: 'Food' }]
const lines = (...amounts) => amounts.map((amount) => ({ category_id: 1, amount }))
const outlook = (over) =>
  buildOutlook({
    nextYear: 2027,
    baseYear: 2027,
    categories,
    baseLineItems: lines(100),
    assumptions: { inflation_rate: 0.03, income_growth_rate: 0.03 },
    ...over,
  })

describe('computeGroupBases', () => {
  it('ten 0.10 line items sum to exactly 1 (floats give 0.9999999999999999)', () => {
    const b = computeGroupBases({ baseLineItems: lines(...Array(10).fill(0.1)), categories })
    expect(b.Food).toBe(1)
  })

  it('accepts Neon numeric strings, padded or negative', () => {
    const b = computeGroupBases({ baseLineItems: lines('19.99', ' 0.01 ', '-5.00'), categories })
    expect(b.Food).toBe(15)
  })
})

describe('buildOutlook money math', () => {
  it('compounds the base once and rounds the cell to a cent (half away from zero)', () => {
    // 0.50 * 1.01 = 0.505 -> 0.51 ; 100.05 * 1.03 = 103.0515 -> 103.05
    const a = outlook({ baseLineItems: lines('0.50'), assumptions: { inflation_rate: 0.01 } })
    expect(a.groups[0].cells[1].amount).toBe(0.51)
    const b = outlook({ baseLineItems: lines('100.05') })
    expect(b.groups[0].cells[1].amount).toBe(103.05)
    expect(b.groups[0].base).toBe(100.05)
  })

  it('one-off events and adjustments accumulate exactly', () => {
    const o = outlook({
      events: [
        { year: 2028, amount: '0.1' },
        { year: 2028, amount: 0.2 },
      ],
      adjustments: [
        { year: 2028, group_name: 'Food', delta_amount: 0.1 },
        { year: 2028, group_name: 'Food', delta_amount: '0.20' },
      ],
      selectedAdjustments: [
        { year: 2029, group_name: 'Food', delta_amount: 0.1 },
        { year: 2029, group_name: 'Food', delta_amount: 0.2 },
      ],
    })
    expect(o.events[1].total).toBe(0.3)
    expect(o.groups[0].cells[1].committedAdj).toBe(0.3)
    expect(o.groups[0].cells[2].scenarioDelta).toBe(0.3)
    expect(o.scenarioDeltaTotals[2]).toBe(0.3)
  })

  it('net savings are exact cent differences of income, groups, commitments and events', () => {
    const o = outlook({
      baseLineItems: lines('0.1'),
      takeHomeBase: '1000.10',
      assumptions: { inflation_rate: 0, income_growth_rate: 0 },
      events: [{ year: 2027, amount: '0.2' }],
      commitments: [{ id: 'c', cost_structure: { kind: 'monthly', amount: '0.01' } }],
    })
    // groups 0.10, commitments 0.01 * 12 = 0.12, events 0.20
    expect(o.groupTotals[0]).toBe(0.1)
    expect(o.commitments[0]).toBe(0.12)
    expect(o.netSavings[0]).toBe(999.68)
    expect(o.netSavingsScenario[0]).toBe(999.68)
  })

  it('a total commitment that does not divide evenly keeps its cents over the year', () => {
    const o = outlook({
      commitments: [
        {
          id: 'c',
          start_date: '2027-01-01',
          end_date: '2027-03-31',
          cost_structure: { kind: 'total', amount: 1000 },
        },
      ],
    })
    expect(o.commitments[0]).toBe(1000)
  })

  it('income grows by the rate with one rounding per year', () => {
    const o = outlook({ takeHomeBase: '50000.55' })
    // 50000.55 * 1.03 = 51500.5665 -> 51500.57
    expect(o.income[1]).toBe(51500.57)
  })
})

describe('buildOutlook invariants across several groups', () => {
  const cats = [{ id: 1, group: 'Food' }, { id: 2, group: 'Fun' }]
  const o = buildOutlook({
    nextYear: 2027,
    baseYear: 2027,
    categories: cats,
    baseLineItems: [
      { category_id: 1, amount: '100.05' },
      { category_id: 2, amount: '33.33' },
    ],
    takeHomeBase: 5000,
    assumptions: { inflation_rate: 0.03, income_growth_rate: 0.02, group_rates: { Fun: 0.015 } },
    events: [
      { year: 2028, amount: '0.07' },
      { year: 2028, amount: '0.23' },
    ],
    commitments: [{ id: 'c', cost_structure: { kind: 'monthly', amount: '10.01' } }],
  })
  const c = (n) => Math.round(n * 100)

  it('hand-derived 2028 column', () => {
    const food = o.groups.find((g) => g.name === 'Food').cells[1].amount
    const fun = o.groups.find((g) => g.name === 'Fun').cells[1].amount
    expect(food).toBe(103.05) // 10005 * 1.03 = 10305.15 -> 10305
    expect(fun).toBe(33.83) // 3333 * 1.015 = 3382.995 -> 3383 (half away)
    expect(o.groupTotals[1]).toBe(136.88) // 103.05 + 33.83
    expect(o.income[1]).toBe(5100) // 500000 * 1.02
    expect(o.commitments[1]).toBe(120.12) // 12 * 10.01
    expect(o.events[1].total).toBe(0.3)
    // 5100.00 - 136.88 - 120.12 - 0.30
    expect(o.netSavings[1]).toBe(4842.7)
  })

  it('every year: group total is the exact cent sum of its cells, net savings the exact difference', () => {
    o.columns.forEach((_, i) => {
      const cellSum = o.groups.reduce((s, g) => s + c(g.cells[i].amount), 0)
      expect(c(o.groupTotals[i])).toBe(cellSum)
      expect(c(o.netSavings[i])).toBe(
        c(o.income[i]) - c(o.groupTotals[i]) - c(o.commitments[i]) - c(o.events[i].total)
      )
    })
  })
})

describe('computeCushion', () => {
  it('running balance is exact in cents (0.1 + 0.2 = 0.3)', () => {
    const c = computeCushion({ netSavings: [0.2, 0.1, '0.01'], startCash: '0.1', floor: 0.3 })
    expect(c.cushion).toEqual([0.3, 0.4, 0.41])
    expect(c.minCushion).toBe(0.3)
    expect(c.buffer).toBe(0)
    expect(c.isPass).toBe(true)
  })
})

describe('outlookContributionMaps', () => {
  it('adds the commitment total back exactly', () => {
    const o = {
      empty: false,
      columns: [{ year: 2027 }],
      netSavings: [0.1],
      commitments: [0.2],
    }
    expect(outlookContributionMaps(o, 2026).withoutCommitments[1]).toBe(0.3)
  })
})

describe('summarizeOutlookAdjustments', () => {
  it('sums deltas exactly and avoids -0', () => {
    const s = summarizeOutlookAdjustments([
      { id: 1, year: 2028, group_name: 'A', delta_amount: 0.1 },
      { id: 2, year: 2028, group_name: 'B', delta_amount: '0.20' },
      { id: 3, year: 2029, group_name: 'A', delta_amount: 0 },
    ])
    expect(s.total).toBe(0.3)
    expect(s.byYear[0].net).toBe(-0.3)
    expect(Object.is(s.byYear[1].net, 0)).toBe(true)
  })
})

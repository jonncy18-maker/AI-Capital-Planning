import { describe, it, expect } from 'vitest'
import { buildWeeklyCashSeries } from '../../src/lib/payperiods/weeklyCashSeries.js'
import { summarizeWeeks, buildWeeksChartModel } from '../../src/lib/payperiods/weeksSummary.js'

// 2026-10-26 is a Monday.
function run(over = {}) {
  return buildWeeklyCashSeries({
    today: '2026-10-26', weeks: 13, anchor: { asOfDate: '2026-10-25', balance: 1000 },
    minBalance: 0, payDays: [5, 20], monthlyNetByYear: {}, bonusMonth: null,
    bills: [], billAmountsByMonth: {}, cards: [], cardSpendByMonth: {}, cardManualByMonth: {},
    cashSpendByMonth: {}, includeSpend: true, warnings: [], ...over,
  })
}

// A 1500 bill on the 28th dips week 0 to -500; the November bill has no amount.
const dipping = (over = {}) => run({
  bills: [{ id: 'b', name: 'Rent', pay_day: 28 }],
  billAmountsByMonth: { '2026-10': { b: 1500 } }, ...over,
})

describe('summarizeWeeks', () => {
  it('(s1) lowest is the intra-week low across projection weeks', () => {
    const s = summarizeWeeks(dipping(), { minBalance: 0 })
    expect(s.lowest).toEqual({ amount: -500, weekIndex: 0, weekStart: '2026-10-26', date: '2026-10-28' })
  })

  it('(s2) N of M follows the selected range', () => {
    expect(summarizeWeeks(dipping({ weeks: 6 })).weekCount).toBe(6)
    expect(summarizeWeeks(dipping({ weeks: 13 })).weekCount).toBe(13)
    expect(summarizeWeeks(dipping({ weeks: 6 })).belowCount).toBe(6)
  })

  it('(s3) moveBy is min minus the deepest low in cents, dated the day before the first below-min day', () => {
    const s = summarizeWeeks(dipping({ minBalance: 100.25 }), { minBalance: 100.25 })
    expect(s.moveBy).toEqual({ amount: 600.25, firstBelowDate: '2026-10-28', byDate: '2026-10-27' })
  })

  it('(s4) nothing below the minimum gives no moveBy', () => {
    const s = summarizeWeeks(run(), { minBalance: 0 })
    expect(s.belowCount).toBe(0)
    expect(s.moveBy).toBeNull()
    expect(s.lowest.amount).toBe(1000)
  })

  it('(s5) no anchor gives nulls', () => {
    expect(summarizeWeeks(run({ anchor: null }), { minBalance: 0 }))
      .toEqual({ lowest: null, belowCount: null, weekCount: null, moveBy: null })
  })

  it('(s6) firstBelowDate is the first day when the opening is already below the minimum', () => {
    const series = run({ anchor: { asOfDate: '2026-10-25', balance: -100 } })
    expect(series.weeks[0].firstBelowDate).toBe('2026-10-26')
    expect(summarizeWeeks(series, { minBalance: 0 }).moveBy.byDate).toBe('2026-10-25')
  })
})

const hist = (over = {}) => {
  const mk = (index, balance, gap = false) => ({
    index, weekStart: `2026-10-${String(26 + 7 * index).padStart(2, '0')}`.replace(/^2026-10-(\d+)$/, m => m),
    weekEnd: '', balance: gap ? null : balance, gap, gapReason: gap ? 'gap' : null,
    approximate: false, approxReasons: [], net: gap ? null : 10, netGapReason: null, netApproximate: false,
  })
  const weekStarts = ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']
  const weekEnds = ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25']
  const pts = [mk(-4, 100), mk(-3, 0, true), mk(-2, 200), mk(-1, 300)].map((p, i) => ({
    ...p, weekStart: weekStarts[i], weekEnd: weekEnds[i],
  }))
  return { status: 'ok', points: pts, ...over }
}

describe('buildWeeksChartModel', () => {
  it('(s7) y-domain includes the minimum, gaps split history, projection starts at max(asOf, start-1)', () => {
    const series = run({ anchor: { asOfDate: '2026-10-14', balance: 400 } })
    const m = buildWeeksChartModel({ history: hist(), series, minBalance: 5000, today: '2026-10-28' })
    expect(m.empty).toBe(false)
    expect(m.yDomain[1]).toBeGreaterThanOrEqual(5000)
    expect(m.yDomain[0]).toBeLessThanOrEqual(100)
    expect(m.historyLine).toHaveLength(2)
    expect(m.historyLine[0]).toHaveLength(1)
    expect(m.historyLine[1].map(p => p.value)).toEqual([200, 300])
    const startPt = m.projectionLine.find(p => p.start)
    expect(startPt.date).toBe('2026-10-25')
    expect(startPt.label).toBe('Projected from your 2026-10-14 balance')
    expect(m.projectionLine[0].joint).toBe(true)
    expect(m.yTicks.length).toBeGreaterThanOrEqual(3)
    expect(m.yTicks.length).toBeLessThanOrEqual(6)

    const live = buildWeeksChartModel({ history: hist(), series: run(), minBalance: 0, today: '2026-10-28' })
    const liveStart = live.projectionLine.find(p => p.start)
    expect(liveStart.date).toBe('2026-10-25')
    expect(liveStart.label).toBe('Projected from your 2026-10-25 balance')
    const sameDay = run({ today: '2026-10-28', anchor: { asOfDate: '2026-10-28', balance: 50 } })
    const sd = buildWeeksChartModel({ history: hist(), series: sameDay, minBalance: 0, today: '2026-10-28' })
    expect(sd.projectionLine.find(p => p.start)).toMatchObject({ date: '2026-10-28', label: 'Your balance' })
  })

  it('(s8) week -4 starts at u=0 and the today marker sits mid-day', () => {
    const m = buildWeeksChartModel({ history: hist(), series: run(), minBalance: 0, today: '2026-10-28' })
    expect(m.bars[0]).toMatchObject({ kind: 'actual', index: -4, x0: 0 })
    expect(m.bars[4]).toMatchObject({ kind: 'projected', index: 0, x0: 28 })
    expect(m.xDomain).toEqual([0, 28 + 7 * 13])
    expect(m.historyLine[0][0].x).toBe(7)
    expect(m.todayX).toBe(30.5)
    expect(m.projectionLine.at(-1).x).toBe(28 + 7 * 13)
  })

  it('(s9) no anchor gives an empty model with bars', () => {
    const m = buildWeeksChartModel({
      history: hist(), series: run({ anchor: null }), minBalance: 0, today: '2026-10-28',
    })
    expect(m.empty).toBe(true)
    expect(m.bars).toHaveLength(4 + 13)
    expect(m.projectionLine).toBeUndefined()
  })

  it('draws an overlay line only when given', () => {
    const base = run()
    const over = run({ whatIf: { extraEvents: [{ id: 1, date: '2026-11-03', direction: 'out', amount: 100, label: 'x' }] } })
    expect(buildWeeksChartModel({ history: hist(), series: base, minBalance: 0, today: '2026-10-28' }).overlayLine).toBeNull()
    const m = buildWeeksChartModel({ history: hist(), series: base, overlay: over, minBalance: 0, today: '2026-10-28' })
    expect(m.overlayLine.at(-1).value).toBe(900)
  })
})

// Pure: the four WEEKS tiles and the geometry-free chart model. Dates are
// 'YYYY-MM-DD'; the chart x unit is days (see u() below), never milliseconds.

import { toCents, fromCents } from '../money.js'
import { addDays, toDayNum } from './weeklyCashSeries.js'
import { HISTORY_WEEKS } from './checkingHistory.js'

const NULL_SUMMARY = { lowest: null, belowCount: null, weekCount: null, moveBy: null }

export function summarizeWeeks(series, { minBalance = 0 } = {}) {
  if (!series?.hasAnchor) return { ...NULL_SUMMARY }
  const weeks = series.weeks
  let lowest = null
  let lowestC = null
  for (const w of weeks) {
    if (w.low == null) continue
    const c = toCents(w.low)
    if (lowestC == null || c < lowestC) {
      lowestC = c
      lowest = { amount: w.low, weekIndex: w.index, weekStart: w.start, date: w.lowDate }
    }
  }
  const below = weeks.filter(w => w.belowMin)
  let moveBy = null
  if (below.length > 0 && lowestC != null) {
    const firstBelowDate = below[0].firstBelowDate ?? below[0].start
    moveBy = {
      amount: fromCents(toCents(minBalance) - lowestC),
      firstBelowDate,
      // Outflows land before inflows on the same day, so the money is needed the day before.
      byDate: addDays(firstBelowDate, -1),
    }
  }
  return { lowest, belowCount: below.length, weekCount: weeks.length, moveBy }
}

function niceTicks(lo, hi) {
  const span = hi - lo
  const raw = span / 5
  const pow = 10 ** Math.floor(Math.log10(raw))
  let fallback = null
  for (const mult of [1, 2, 2.5, 5, 10]) {
    const step = mult * pow
    const first = Math.ceil(lo / step)
    const last = Math.floor(hi / step)
    const ticks = []
    for (let k = first; k <= last; k++) ticks.push(Math.round(k * step * 100) / 100)
    if (ticks.length >= 4 && ticks.length <= 6) return ticks
    if (ticks.length <= 6 && !fallback) fallback = ticks
  }
  return fallback ?? [lo, hi]
}

export function buildWeeksChartModel({ history, series, overlay = null, minBalance = 0, today }) {
  const weeks = series.weeks
  const origin = toDayNum(addDays(series.start, -HISTORY_WEEKS * 7))
  const u = ymd => toDayNum(ymd) - origin + 1
  const histPoints = history?.points ?? []

  const bars = [
    ...histPoints.map(p => ({
      kind: 'actual', index: p.index, x0: 28 + 7 * p.index, xc: 28 + 7 * p.index + 3.5, weekStart: p.weekStart,
      net: p.net, gap: p.net == null, gapReason: p.netGapReason, approximate: !!p.netApproximate,
    })),
    ...weeks.map(w => ({
      kind: 'projected', index: w.index, x0: 28 + 7 * w.index, xc: 28 + 7 * w.index + 3.5, weekStart: w.start,
      net: w.net, gap: false, gapReason: null, approximate: false,
    })),
  ]
  const xDomain = [0, 28 + 7 * weeks.length]
  const todayX = u(today) - 0.5
  if (!series.hasAnchor) return { empty: true, bars, xDomain, todayX }

  const historyLine = []
  let seg = []
  for (const p of histPoints) {
    if (p.gap) {
      if (seg.length) historyLine.push(seg)
      seg = []
    } else {
      seg.push({
        x: u(p.weekEnd), value: p.balance, date: p.weekEnd, index: p.index,
        approximate: p.approximate, approxReasons: p.approxReasons,
      })
    }
  }
  if (seg.length) historyLine.push(seg)
  const lastHist = [...histPoints].reverse().find(p => !p.gap)

  const asOf = series.asOfDate
  const projectionOf = s => {
    const startDate = asOf >= s.start ? asOf : addDays(s.start, -1)
    const pts = []
    if (lastHist) {
      pts.push({ x: u(lastHist.weekEnd), value: lastHist.balance, date: lastHist.weekEnd, label: 'History', joint: true })
    }
    pts.push({
      x: u(startDate), value: s.weeks[0].opening, date: startDate, start: true,
      label: asOf >= s.start ? 'Your balance' : `Projected from your ${asOf} balance`,
    })
    for (const w of s.weeks) {
      pts.push({ x: u(w.end), value: w.closing, date: w.end, index: w.index, belowMin: w.belowMin, low: w.low, lowDate: w.lowDate })
    }
    return pts
  }
  const projectionLine = projectionOf(series)
  const overlayLine = overlay?.hasAnchor ? projectionOf(overlay) : null

  const values = [Number(minBalance) || 0]
  for (const s of historyLine) for (const p of s) values.push(p.value)
  for (const p of projectionLine) values.push(p.value)
  for (const p of overlayLine ?? []) values.push(p.value)
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  if (hi === lo) { lo -= 500; hi += 500 } else {
    const pad = Math.max((hi - lo) * 0.05, 50)
    lo -= pad; hi += pad
  }

  return {
    empty: false, bars, xDomain, todayX, historyLine, projectionLine, overlayLine,
    yDomain: [lo, hi], yTicks: niceTicks(lo, hi), minBalance: Number(minBalance) || 0,
    weekAxis: [
      ...histPoints.map(p => ({ index: p.index, x0: 28 + 7 * p.index, date: p.weekStart })),
      ...weeks.map(w => ({ index: w.index, x0: 28 + 7 * w.index, date: w.start })),
    ],
  }
}

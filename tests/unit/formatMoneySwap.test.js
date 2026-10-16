import { describe, it, expect } from 'vitest'
import { formatMoney } from '../../src/lib/money.js'
import { money, signedMoney } from '../../src/lib/ai/tools/helpers.js'

// Inline copies of the OLD implementations. A formatter is swapped for
// formatMoney only when it is byte-identical over INPUTS.
const old = {
  helpersMoney: (v) => { const n = Number(v) || 0; return `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString()}` },
  helpersSigned: (v) => { const n = Number(v) || 0; return `${n >= 0 ? '+' : '−'}$${Math.abs(Math.round(n)).toLocaleString()}` },
  outlookFmtSigned: (n) => (n < 0 ? '−$' : '+$') + Math.abs(Math.round(n)).toLocaleString(),
  fmtFullDollar: (n) => '$' + Math.round(n || 0).toLocaleString(), // Budget/Forecast/Commitments/Trends/Dashboard/...
  fmtAbs: (n) => '$' + Math.abs(Math.round(n)).toLocaleString(), // Scenarios fmtAbs, scenarioSummary money
  cashFlowFull: (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString(),
  signedAscii: (n) => { const v = Math.round(Number(n) || 0); return (v < 0 ? '-$' : '+$') + Math.abs(v).toLocaleString() },
  forecastFmtD: (n) => `${n >= 0 ? '+' : '−'}${'$' + Math.round(Math.abs(n) || 0).toLocaleString()}`,
}

const INPUTS = [
  0, -0, 1, -1, 0.4, -0.4, 0.5, -0.5, 2.5, -2.5, 999.5, -999.5, 1e6, -1e6, 1234567.89, -1234567.89,
  null, undefined, NaN, '12.6', '-12.6', '', 'abc', Infinity, -Infinity,
]
const diffs = (a, b) => INPUTS.filter((x) => a(x) !== b(x))

describe('swapped: helpers money/signedMoney now delegate to formatMoney', () => {
  it('byte-identical to the old implementations', () => {
    expect(diffs(old.helpersMoney, money)).toEqual([])
    expect(diffs(old.helpersSigned, signedMoney)).toEqual([])
    expect(diffs(old.helpersMoney, (x) => formatMoney(x))).toEqual([])
    expect(diffs(old.helpersSigned, (x) => formatMoney(x, { signed: true }))).toEqual([])
  })
})

describe('NOT swapped: documented divergences (guards the reason)', () => {
  const D = (a, b) => diffs(a, b).length
  it('OutlookView fmtSigned differs on NaN/undefined/junk only', () => {
    const d = diffs(old.outlookFmtSigned, (x) => formatMoney(x, { signed: true }))
    expect(d.length).toBeGreaterThan(0)
    expect(d.every((x) => !Number.isFinite(Number(x)) || x === '')).toBe(true)
  })
  it('"$-5" style fmtFull differs on negatives', () => {
    expect(old.fmtFullDollar(-5)).toBe('$-5')
    expect(D(old.fmtFullDollar, (x) => formatMoney(x))).toBeGreaterThan(0)
  })
  it('abs-only formatters drop the sign', () => {
    expect(D(old.fmtAbs, (x) => formatMoney(x))).toBeGreaterThan(0)
  })
  it('ASCII-hyphen formatters differ', () => {
    expect(D(old.cashFlowFull, (x) => formatMoney(x))).toBeGreaterThan(0)
    expect(D(old.signedAscii, (x) => formatMoney(x, { signed: true }))).toBeGreaterThan(0)
  })
  it('Forecast fmtD rounds magnitude before abs: differs on -2.5 / -999.5', () => {
    const d = diffs(old.forecastFmtD, (x) => formatMoney(x, { signed: true }))
    expect(d).toContain(-2.5)
    expect(d).toContain(-999.5)
  })
})

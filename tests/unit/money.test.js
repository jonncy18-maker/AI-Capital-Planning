import { describe, it, expect } from 'vitest'
import {
  toCents, parseCentsStrict, fromCents, sumCents, sumDollars, addDollars,
  mulCents, allocateCents, formatMoney, parseMoneyInput,
} from '../../src/lib/money.js'
import { money, signedMoney } from '../../src/lib/ai/tools/helpers.js'

// Deterministic PRNG (mulberry32) so the property loops are reproducible.
function rng(seed) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('toCents', () => {
  it('converts numbers and numeric strings', () => {
    expect(toCents(12.5)).toBe(1250)
    expect(toCents('-12.50')).toBe(-1250)
    expect(toCents('  100.00 ')).toBe(10000)
    expect(toCents('0')).toBe(0)
  })
  it('cleans float noise', () => {
    expect(toCents(0.1 + 0.2)).toBe(30) // 0.30000000000000004
    expect(toCents(1.005)).toBe(101) // 1.005*100 = 100.49999999999999, human reads 1.005 -> 101
    expect(toCents(2.675)).toBe(268) // 267.49999999999994 -> 268
    expect(toCents(19.99 * 3)).toBe(5997) // 59.97000000000001 -> 5997
    expect(toCents(-1.005)).toBe(-101) // half away from zero
  })
  it('never returns -0', () => {
    expect(Object.is(toCents(-0), 0)).toBe(true)
    expect(Object.is(toCents(-0.001), 0)).toBe(true)
    expect(Object.is(toCents('-0'), 0)).toBe(true)
  })
  it('returns 0 for unusable input', () => {
    for (const bad of [null, undefined, NaN, Infinity, -Infinity, '', '   ', 'abc', '1,234', {}, [], true]) {
      expect(toCents(bad)).toBe(0)
    }
  })
  it('treats |x| > 1e11 dollars as out of range', () => {
    expect(toCents(1e11)).toBe(1e13)
    expect(toCents(-1e11)).toBe(-1e13)
    expect(toCents(1e11 + 1)).toBe(0)
    expect(toCents(1e21)).toBe(0)
    expect(toCents('-1e12')).toBe(0)
  })
  it('rejects hex/binary/octal strings', () => {
    for (const s of ['0x10', '0b1', '0o7', '-0x10', ' 0XFF ']) expect(toCents(s)).toBe(0)
  })
  it('accepts plain decimal and exponent strings', () => {
    expect(toCents('1e2')).toBe(10000)
    expect(toCents('+5')).toBe(500)
    expect(toCents('.5')).toBe(50)
  })
})

describe('parseCentsStrict', () => {
  it('parses valid input', () => {
    expect(parseCentsStrict(12.34)).toBe(1234)
    expect(parseCentsStrict('-12.50')).toBe(-1250)
    expect(parseCentsStrict(' 5 ')).toBe(500)
    expect(Object.is(parseCentsStrict(-0), 0)).toBe(true)
  })
  it('returns null for invalid input', () => {
    for (const bad of [null, undefined, NaN, Infinity, '', ' ', 'x', 1.005, '0.001', {}]) {
      expect(parseCentsStrict(bad)).toBeNull()
    }
  })
  it('rejects hex/binary/octal and out-of-range', () => {
    for (const bad of ['0x10', '0b1', '0o7', 1e11 + 1, '1e12', 1e21]) expect(parseCentsStrict(bad)).toBeNull()
    expect(parseCentsStrict(1e11)).toBe(1e13)
  })
  it('accepts 0.1+0.2 within tolerance', () => {
    expect(parseCentsStrict(0.1 + 0.2)).toBe(30)
  })
})

describe('fromCents', () => {
  it('divides by 100', () => {
    expect(fromCents(1250)).toBe(12.5)
    expect(fromCents(-5)).toBe(-0.05)
    expect(fromCents(1234.4)).toBe(12.34) // rounds to an integer cent first
  })
  it('never returns -0 and tolerates junk', () => {
    expect(Object.is(fromCents(-0), 0)).toBe(true)
    expect(fromCents(NaN)).toBe(0)
    expect(fromCents(undefined)).toBe(0)
  })
})

describe('sumCents / sumDollars / addDollars', () => {
  it('sums integer cents', () => {
    expect(sumCents([100, 250, -50])).toBe(300)
    expect(sumCents([{ c: 1 }, { c: 2 }], x => x.c)).toBe(3)
    expect(sumCents(null)).toBe(0)
  })
  it('sums dollars exactly', () => {
    expect(addDollars(0.1, 0.2)).toBe(0.3) // plain 0.1+0.2 = 0.30000000000000004
    expect(sumDollars(['-12.50', '100.00', ' 3.25 '])).toBe(90.75)
    expect(sumDollars([{ a: 19.99 }, { a: 19.99 }, { a: 19.99 }], x => x.a)).toBe(59.97)
    expect(sumDollars([1.1, 2.2, 3.3])).toBe(6.6) // plain sum 6.6000000000000005
  })
  it('skips junk and avoids -0', () => {
    expect(sumDollars([null, undefined, NaN, 'x', 5])).toBe(5)
    expect(Object.is(sumDollars([]), 0)).toBe(true)
    expect(Object.is(addDollars(-0, -0), 0)).toBe(true)
    expect(Object.is(addDollars(1.5, -1.5), 0)).toBe(true)
  })
})

describe('mulCents', () => {
  it('rounds half away from zero once', () => {
    expect(mulCents(1000, 0.0005)).toBe(1) // 0.5 -> 1
    expect(mulCents(-1000, 0.0005)).toBe(-1) // -0.5 -> -1
    expect(mulCents(10000, 0.0725)).toBe(725)
    expect(mulCents(333, 0.5)).toBe(167) // 166.5 -> 167
    expect(mulCents(1999, 3)).toBe(5997)
  })
  it('handles zero, junk and -0', () => {
    expect(Object.is(mulCents(-1, 0.1), 0)).toBe(true)
    expect(mulCents(NaN, 2)).toBe(0)
    expect(mulCents(100, Infinity)).toBe(0)
  })
})

describe('allocateCents', () => {
  it('splits with earlier buckets getting the extra cent', () => {
    expect(allocateCents(100, 3)).toEqual([34, 33, 33])
    expect(allocateCents(101, 3)).toEqual([34, 34, 33])
    expect(allocateCents(2, 5)).toEqual([1, 1, 0, 0, 0])
    expect(allocateCents(0, 2)).toEqual([0, 0])
  })
  it('preserves sign', () => {
    expect(allocateCents(-100, 3)).toEqual([-34, -33, -33])
    expect(allocateCents(-100, 3).every(v => !Object.is(v, -0))).toBe(true)
  })
  it('returns [] for invalid n', () => {
    expect(allocateCents(100, 0)).toEqual([])
    expect(allocateCents(100, -2)).toEqual([])
    expect(allocateCents(100, NaN)).toEqual([])
  })
})

describe('formatMoney', () => {
  it('formats whole dollars', () => {
    expect(formatMoney(1234)).toBe('$1,234')
    expect(formatMoney(-1234)).toBe('−$1,234')
    expect(formatMoney(0)).toBe('$0')
    expect(formatMoney(1234.5)).toBe('$1,235')
    expect(formatMoney(1234567.89)).toBe('$1,234,568')
  })
  it('formats two decimals', () => {
    expect(formatMoney(1234.5, { decimals: 2 })).toBe('$1,234.50')
    expect(formatMoney(-0.05, { decimals: 2 })).toBe('−$0.05')
    expect(formatMoney(1.005, { decimals: 2 })).toBe('$1.01')
  })
  it('signed variant', () => {
    expect(formatMoney(5, { signed: true })).toBe('+$5')
    expect(formatMoney(-5, { signed: true })).toBe('−$5')
    expect(formatMoney(0, { signed: true })).toBe('+$0')
  })
  it('handles junk as $0', () => {
    expect(formatMoney(null)).toBe('$0')
    expect(formatMoney(NaN)).toBe('$0')
    expect(formatMoney('abc')).toBe('$0')
  })
  it('matches the existing ai-tools helpers for the same inputs', () => {
    const samples = [0, 1, -1, 0.4, -0.4, 0.5, -0.5, 1234.49, 1234.5, -1234.5, 999999.5, -87654321, '12.7', null, undefined, NaN]
    for (const s of samples) {
      expect(formatMoney(s)).toBe(money(s))
      expect(formatMoney(s, { signed: true })).toBe(signedMoney(s))
    }
  })
})

describe('parseMoneyInput', () => {
  it('parses common formats', () => {
    expect(parseMoneyInput('$1,234.50')).toBe(1234.5)
    expect(parseMoneyInput(' 12 ')).toBe(12)
    expect(parseMoneyInput('.5')).toBe(0.5)
    expect(parseMoneyInput('5.')).toBe(5)
  })
  it('handles negatives', () => {
    expect(parseMoneyInput('(1,234.50)')).toBe(-1234.5)
    expect(parseMoneyInput('-$12.50')).toBe(-12.5)
    expect(parseMoneyInput('12.50-')).toBe(-12.5)
    expect(parseMoneyInput('−7')).toBe(-7) // U+2212
    expect(Object.is(parseMoneyInput('-0'), 0)).toBe(true)
    expect(Object.is(parseMoneyInput('(0.00)'), 0)).toBe(true)
  })
  it('returns null (never 0) for invalid input', () => {
    for (const bad of ['', '   ', '$', 'abc', '1.2.3', '--5', '(-5)', '(5', '5)', '1e3', null, undefined, NaN, Infinity, {}]) {
      expect(parseMoneyInput(bad)).toBeNull()
    }
  })
  it('rounds to the cent', () => {
    expect(parseMoneyInput('1.005')).toBe(1.01)
  })
})

describe('property loops', () => {
  it('sumDollars equals the cent-exact total over 1000 random lists', () => {
    const r = rng(12345)
    for (let i = 0; i < 1000; i++) {
      const n = 1 + Math.floor(r() * 30)
      const centsList = Array.from({ length: n }, () => Math.round((r() - 0.4) * 2_000_000))
      const exact = centsList.reduce((s, c) => s + c, 0)
      const asStrings = i % 2 === 0
      const dollars = centsList.map(c => (asStrings ? (c / 100).toFixed(2) : c / 100))
      expect(sumDollars(dollars)).toBe(fromCents(exact))
      expect(sumDollars(dollars.map(d => ({ d })), x => x.d)).toBe(fromCents(exact))
    }
  })
  it('toCents(fromCents(c)) round-trips', () => {
    const r = rng(777)
    for (let i = 0; i < 1000; i++) {
      const c = Math.round((r() - 0.5) * 1e10)
      expect(toCents(fromCents(c))).toBe(c)
    }
  })
  it('allocateCents always sums to the total with spread <= 1', () => {
    const r = rng(99)
    for (let i = 0; i < 1000; i++) {
      const total = Math.round((r() - 0.5) * 1e8)
      const n = 1 + Math.floor(r() * 24)
      const parts = allocateCents(total, n)
      expect(parts).toHaveLength(n)
      expect(parts.reduce((s, v) => s + v, 0)).toBe(total)
      expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1)
    }
  })
})

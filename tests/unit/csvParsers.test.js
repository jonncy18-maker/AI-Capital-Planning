import { describe, it, expect } from 'vitest'
import { parseMonarchCSV } from '../../src/lib/csv/monarchParser.js'
import { parseBudgetCSV } from '../../src/lib/csv/budgetParser.js'
import { parseLooseMoney, toCents, fromCents } from '../../src/lib/money.js'

const MON_HEAD = 'Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags,Owner'
function monarch(amounts) {
  const lines = [MON_HEAD, ...amounts.map((a, i) => `2026-01-0${(i % 9) + 1},Shop ${i},Food,Chk,,,"${a}",,J`)]
  return parseMonarchCSV(lines.join('\n'))
}
const monAmt = (raw) => {
  const r = monarch([raw])
  return r.rows.length ? r.rows[0].amount : r.errors.length ? 'ERR' : undefined
}
function budget(raw) {
  const r = parseBudgetCSV(`Category,Group,Monthly\nGroceries,Flexible,"${raw}"`)
  return r.rows[0]?.monthlyTarget
}

const oldParse = (raw) => parseFloat(String(raw).replace(/[^-\d.]/g, ''))
const cent = (n) => fromCents(toCents(n))

describe('parenthesized and trailing-minus negatives', () => {
  it.each([
    ['(12.50)', -12.5], ['($1,234.50)', -1234.5], ['$(12.50)', -12.5], ['12.50-', -12.5],
    ['−3', -3], ['−$3.00', -3], ['-$3.00', -3], ['(0.99)', -0.99],
  ])('%s -> %s (monarch + budget)', (raw, want) => {
    expect(monAmt(raw)).toBe(want)
    expect(budget(raw)).toBe(want)
  })
})

describe('inputs the old code accepted keep their value', () => {
  it.each([
    ['$1,234.50', 1234.5], [' 12.5 ', 12.5], ['USD 12.50', 12.5], ['100', 100], ['.5', 0.5], ['-0.25', -0.25], ['+7', 7],
  ])('%s -> %s', (raw, want) => {
    expect(monAmt(raw)).toBe(want)
    expect(budget(raw)).toBe(want)
  })
})

describe('cent rounding', () => {
  it('rounds once, half away from zero, without float noise', () => {
    expect(parseLooseMoney('12.345')).toBe(12.35)
    expect(parseLooseMoney('1.005')).toBe(1.01)
    expect(parseLooseMoney('2.675')).toBe(2.68)
    expect(parseLooseMoney('-2.675')).toBe(-2.68)
    expect(parseLooseMoney('(1.005)')).toBe(-1.01)
    expect(parseLooseMoney('0.30000000000000004')).toBe(0.3)
  })
  it('row totals of 0.1-style amounts are exact when summed in cents', () => {
    const r = monarch(Array(10).fill('0.1'))
    const cents = r.rows.reduce((s, x) => s + toCents(x.amount), 0)
    expect(fromCents(cents)).toBe(1)
    const r2 = monarch(['0.1', '0.2'])
    expect(fromCents(r2.rows.reduce((s, x) => s + toCents(x.amount), 0))).toBe(0.3)
  })
  it('never returns -0', () => {
    expect(Object.is(parseLooseMoney('-0.001'), 0)).toBe(true)
    expect(Object.is(parseLooseMoney('(0)'), 0)).toBe(true)
  })
})

describe('junk and blanks', () => {
  it('monarch pushes the existing invalid-amount error row', () => {
    for (const bad of ['abc', '-', '.', '$', '()']) {
      const r = monarch([bad])
      expect(r.rows).toHaveLength(0)
      expect(r.errors[0]).toMatch(/invalid amount/)
    }
  })
  it('blank monarch amount defaults to 0 as before', () => {
    const r = parseMonarchCSV(`${MON_HEAD}\n2026-01-01,Shop,Food,Chk,,,,,J`)
    expect(r.rows[0].amount).toBe(0)
  })
  it('budget parseAmount yields null for blank/junk', () => {
    for (const bad of ['', 'abc', '-', '.']) expect(budget(bad)).toBeNull()
  })
  it('parseLooseMoney: null/undefined/junk -> null', () => {
    for (const bad of [null, undefined, '', 'x', '--']) expect(parseLooseMoney(bad)).toBeNull()
  })
})

describe('huge values', () => {
  it('keeps the old float value instead of silently zeroing', () => {
    expect(parseLooseMoney('1000000000000')).toBe(1e12)
    expect(parseLooseMoney('(1000000000000)')).toBe(-1e12)
    expect(parseLooseMoney('99999999999.99')).toBe(99999999999.99)
  })
})

describe('differential vs the old parseFloat formula', () => {
  it('matches after cent rounding on generated well-formed inputs', () => {
    let a = 12345
    const rnd = () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    let n = 0
    for (let i = 0; i < 600; i++) {
      const whole = Math.floor(rnd() * 10 ** Math.floor(rnd() * 9))
      const dec = rnd() < 0.2 ? '' : '.' + String(Math.floor(rnd() * 10 ** (1 + Math.floor(rnd() * 3)))).padStart(2, '0')
      const body = whole.toLocaleString('en-US') + dec
      const prefix = ['', '$', 'USD ', ' ', '$ '][Math.floor(rnd() * 5)]
      const sign = rnd() < 0.4 ? '-' : ''
      const raw = `${sign}${prefix}${body}`
      const want = cent(oldParse(raw))
      expect(parseLooseMoney(raw), raw).toBe(want)
      expect(monAmt(raw), raw).toBe(want)
      expect(budget(raw), raw).toBe(want)
      n++
    }
    expect(n).toBe(600)
  })
})

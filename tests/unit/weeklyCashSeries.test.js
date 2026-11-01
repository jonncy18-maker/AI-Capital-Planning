import { describe, it, expect } from 'vitest'
import {
  addDays, mondayOnOrBefore, clampDay, resolvePayDays, buildWeeklyCashSeries,
} from '../../src/lib/payperiods/weeklyCashSeries.js'

const cents = d => Math.round(d * 100)

// 2026-10-26 is a Monday. Salary arrays are dollars per month (index 0 = Jan).
const flat = n => Array(12).fill(n)

function run(over = {}) {
  return buildWeeklyCashSeries({
    today: '2026-10-26', weeks: 13, anchor: { asOfDate: '2026-10-25', balance: 1000 },
    minBalance: 0, payDays: [5, 20], monthlyNetByYear: {}, bonusMonth: null,
    bills: [], billAmountsByMonth: {}, cards: [], cardSpendByMonth: {}, cardManualByMonth: {},
    cashSpendByMonth: {}, includeSpend: true, warnings: [], ...over,
  })
}

const allEvents = r => r.weeks.flatMap(w => w.events)
const bill = (id, pay_day, name = id) => ({ id, name, pay_day })

describe('date helpers', () => {
  it('(a) mondayOnOrBefore: Monday, Sunday, month and year boundaries', () => {
    expect(mondayOnOrBefore('2026-10-26')).toBe('2026-10-26')
    expect(mondayOnOrBefore('2026-11-01')).toBe('2026-10-26')
    expect(mondayOnOrBefore('2026-12-31')).toBe('2026-12-28')
    expect(mondayOnOrBefore('2027-01-03')).toBe('2026-12-28')
  })

  it('addDays crosses DST and month ends exactly', () => {
    expect(addDays('2026-10-15', 21)).toBe('2026-11-05')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('clampDay limits to month length', () => {
    expect(clampDay(2027, 2, 31)).toBe(28)
    expect(clampDay(2028, 2, 31)).toBe(29)
  })

  it('(b) weeks start on Monday; 13 weeks from 2026-10-26 end 2027-01-24', () => {
    const r = run({ today: '2026-10-28' })
    expect(r.start).toBe('2026-10-26')
    expect(r.end).toBe('2027-01-24')
    expect(r.weeks).toHaveLength(13)
    for (const w of r.weeks) expect(mondayOnOrBefore(w.start)).toBe(w.start)
    expect(r.weeks[12].end).toBe('2027-01-24')
  })
})

describe('bills', () => {
  it('(c) pay_day 31 lands on Nov 30, Feb 28 (2027) and Feb 29 (2028)', () => {
    const amounts = { '2026-11': { b: 10 }, '2027-2': { b: 10 }, '2028-2': { b: 10 } }
    const nov = run({ bills: [bill('b', 31)], billAmountsByMonth: { '2026-11': { b: 10 } } })
    expect(allEvents(nov).find(e => e.kind === 'bill' && e.amount === 10).date).toBe('2026-11-30')
    const feb27 = run({
      today: '2027-02-22', weeks: 6, anchor: { asOfDate: '2027-02-21', balance: 100 },
      bills: [bill('b', 31)], billAmountsByMonth: amounts,
    })
    expect(allEvents(feb27).find(e => e.kind === 'bill' && e.amount === 10).date).toBe('2027-02-28')
    const feb28 = run({
      today: '2028-02-21', weeks: 6, anchor: { asOfDate: '2028-02-20', balance: 100 },
      bills: [bill('b', 31)], billAmountsByMonth: amounts,
    })
    expect(allEvents(feb28).find(e => e.kind === 'bill' && e.amount === 10).date).toBe('2028-02-29')
  })

  it('(p) a null bill amount is an unknown event excluded from net', () => {
    const r = run({
      bills: [bill('b', 28, 'Water')],
      billAmountsByMonth: { '2026-10': { b: null } },
    })
    const ev = allEvents(r).find(e => e.label === 'Water')
    expect(ev.unknownAmount).toBe(true)
    expect(ev.amount).toBe(0)
    expect(r.weeks[0].bills).toBe(0)
    expect(r.weeks[0].net).toBe(0)
    expect(r.weeks[0].closing).toBe(1000)
  })

  it('skips a bill with no pay_day/due_day and warns', () => {
    const r = run({ bills: [{ id: 'x', name: 'Mystery' }] })
    expect(allEvents(r)).toHaveLength(0)
    expect(r.warnings.some(w => w.includes('Mystery'))).toBe(true)
  })
})

describe('income', () => {
  const feb = { 2027: Array(12).fill(0).map((_, i) => (i === 1 ? 3000.01 : 0)) }

  it('(d) pay days 30/31 in February clamp to the last day; both present, sum equals month', () => {
    const r = run({
      today: '2027-02-22', weeks: 6, anchor: { asOfDate: '2027-02-21', balance: 0 },
      payDays: [30, 31], monthlyNetByYear: feb,
    })
    const pay = allEvents(r).filter(e => e.kind === 'income' && e.date.startsWith('2027-02'))
    expect(pay).toHaveLength(2)
    expect(pay.every(e => e.date === '2027-02-28')).toBe(true)
    expect(pay.reduce((s, e) => s + cents(e.amount), 0)).toBe(300001)
  })

  it('(e) odd-cent month splits with p1 = p2 + 1 cent', () => {
    const r = run({
      today: '2026-11-02', weeks: 6, anchor: { asOfDate: '2026-11-01', balance: 0 },
      monthlyNetByYear: { 2026: flat(1000.01), 2027: flat(1000.01) },
    })
    const nov = allEvents(r).filter(e => e.kind === 'income' && e.date.startsWith('2026-11'))
    expect(nov.map(e => cents(e.amount))).toEqual([50001, 50000])
  })

  it('(f) bonus month puts the bonus on the later paycheck; p1 + p2 = month cents', () => {
    const net = flat(5000)
    net[10] = 9000.01 // November bonus month (index 10)
    const r = run({
      today: '2026-11-02', weeks: 6, anchor: { asOfDate: '2026-11-01', balance: 0 },
      monthlyNetByYear: { 2026: net, 2027: flat(5000) }, bonusMonth: 11,
    })
    const nov = allEvents(r).filter(e => e.kind === 'income' && e.date.startsWith('2026-11'))
    expect(nov).toHaveLength(2)
    expect(cents(nov[0].amount)).toBe(250000)
    expect(cents(nov[1].amount)).toBe(650001)
    expect(nov[1].label).toBe('Paycheck + bonus')
    expect(cents(nov[0].amount) + cents(nov[1].amount)).toBe(900001)
  })

  it('warns once per year without a salary forecast', () => {
    const r = run({ monthlyNetByYear: { 2026: null, 2027: null } })
    expect(r.warnings.filter(w => w === 'No salary forecast for 2026')).toHaveLength(1)
    expect(r.warnings).toContain('No salary forecast for 2027')
  })
})

describe('card statements', () => {
  const card = { id: 'c1', name: 'Visa', statement_close_day: 15, due_days_after_close: 21 }

  it('(g) close 2026-10-15 + 21 days is due exactly 2026-11-05 (across DST)', () => {
    const r = run({
      cards: [card],
      cardSpendByMonth: { c1: { '2026-10': 3100, '2026-9': 3000 } },
    })
    const ev = allEvents(r).find(e => e.kind === 'card')
    expect(ev.date).toBe('2026-11-05')
    expect(ev.label).toBe('Visa statement')
    // early(Oct) = 3100 * 15/31, late(Sep) = 3000 - 3000*15/30
    expect(cents(ev.amount)).toBe(150000 + 150000)
  })

  it('(h) a December late half appears in the January (next-year) statement', () => {
    const r = run({
      today: '2027-01-18', weeks: 6, anchor: { asOfDate: '2027-01-17', balance: 0 },
      cards: [{ ...card, statement_close_day: 10 }],
      cardSpendByMonth: { c1: { '2026-12': 3100, '2027-1': 0 } },
    })
    // Jan 10 statement = early(Jan)=0 + late(Dec) = 3100 - round(3100*10/31)=3100-1000
    const ev = allEvents(r).find(e => e.kind === 'card' && e.date === '2027-01-31')
    expect(ev).toBeDefined()
    expect(cents(ev.amount)).toBe(210000)
  })

  it('(i) a manual amount for the due month replaces the projection', () => {
    const r = run({
      cards: [card],
      cardSpendByMonth: { c1: { '2026-10': 3100, '2026-9': 3000 } },
      cardManualByMonth: { c1: { '2026-11': 777.77 } },
    })
    const ev = allEvents(r).find(e => e.kind === 'card' && e.date === '2026-11-05')
    expect(ev.amount).toBe(777.77)
    expect(ev.manual).toBe(true)
  })
})

describe('running balance', () => {
  it('(j) closing = opening + net and opening(i+1) = closing(i)', () => {
    const r = run({
      bills: [bill('r', 1, 'Rent'), bill('u', 9, 'Util')],
      billAmountsByMonth: Object.fromEntries(
        ['2026-10', '2026-11', '2026-12', '2027-1'].map(k => [k, { r: 1500.5, u: 80.25 }]),
      ),
      monthlyNetByYear: { 2026: flat(4000.33), 2027: flat(4000.33) },
      cashSpendByMonth: { '2026-10': 500.07, '2026-11': 500.07, '2026-12': 500.07, '2027-1': 500.07 },
    })
    for (let i = 0; i < r.weeks.length; i++) {
      const w = r.weeks[i]
      expect(cents(w.closing)).toBe(cents(w.opening) + cents(w.net))
      if (i > 0) expect(w.opening).toBe(r.weeks[i - 1].closing)
    }
  })

  it('(k) Monday bill then Friday paycheck flags belowMin though closing >= min', () => {
    // Week of 2026-11-02: Mon Nov 2 bill, Fri Nov 6 pay (payDays [6, 20]).
    const r = run({
      today: '2026-11-02', weeks: 6, anchor: { asOfDate: '2026-11-01', balance: 500 },
      minBalance: 400, payDays: [6, 20],
      monthlyNetByYear: { 2026: flat(2000), 2027: flat(2000) },
      bills: [bill('b', 2)], billAmountsByMonth: { '2026-11': { b: 300 } },
    })
    const w = r.weeks[0]
    expect(w.closing).toBe(500 - 300 + 1000)
    expect(w.closing).toBeGreaterThanOrEqual(400)
    expect(w.low).toBe(200)
    expect(w.lowDate).toBe('2026-11-02')
    expect(w.belowMin).toBe(true)
    expect(w.negative).toBe(false)
    expect(r.firstBelowMinIndex).toBe(0)
  })

  it('same-day outflows are applied before inflows', () => {
    const r = run({
      today: '2026-11-02', weeks: 6, anchor: { asOfDate: '2026-11-01', balance: 100 },
      minBalance: 0, payDays: [3, 20],
      monthlyNetByYear: { 2026: flat(2000), 2027: flat(2000) },
      bills: [bill('b', 3)], billAmountsByMonth: { '2026-11': { b: 300 } },
    })
    expect(r.weeks[0].low).toBe(-200)
    expect(r.weeks[0].negative).toBe(true)
  })

  it('(l) below-min is strict: equal to the minimum is not flagged', () => {
    const base = {
      today: '2026-11-02', weeks: 6, anchor: { asOfDate: '2026-11-01', balance: 500 },
      bills: [bill('b', 2)], billAmountsByMonth: { '2026-11': { b: 300 } },
    }
    expect(run({ ...base, minBalance: 200 }).weeks[0].belowMin).toBe(false)
    expect(run({ ...base, minBalance: 200.01 }).weeks[0].belowMin).toBe(true)
  })

  it('(m) events on the as-of date are excluded, the next day included', () => {
    const base = {
      today: '2026-11-02', weeks: 6,
      bills: [bill('b', 3)], billAmountsByMonth: { '2026-11': { b: 100 } },
    }
    const on = run({ ...base, anchor: { asOfDate: '2026-11-03', balance: 500 } })
    expect(on.weeks[0].bills).toBe(0)
    expect(on.weeks[0].closing).toBe(500)
    const before = run({ ...base, anchor: { asOfDate: '2026-11-02', balance: 500 } })
    expect(before.weeks[0].bills).toBe(100)
    expect(before.weeks[0].closing).toBe(400)
  })

  it('(m) an as-of date before the window start produces carriedIn on week 1', () => {
    const r = run({
      today: '2026-11-02', weeks: 6, anchor: { asOfDate: '2026-10-28', balance: 1000 },
      bills: [bill('b', 30)],
      billAmountsByMonth: { '2026-10': { b: 120.5 } },
    })
    expect(r.carriedIn).toBe(-120.5)
    expect(r.weeks[0].opening).toBe(879.5)
    expect(r.weeks[0].bills).toBe(0)
  })
})

describe('day-to-day spend', () => {
  it('(n) a window covering whole months reproduces each monthly total to the cent', () => {
    // 2027-02-01 .. 2027-02-28 is exactly 4 weeks (28-day month).
    const feb = run({
      today: '2027-02-01', weeks: 4, anchor: { asOfDate: '2027-01-31', balance: 0 },
      cashSpendByMonth: { '2027-2': 280.03 },
    })
    expect(cents(feb.totals.spend)).toBe(28003)
    // 2026-12-28 .. 2027-01-31 is 5 weeks: Dec 28-31 plus all 31 days of January.
    const jan = run({
      today: '2026-12-28', weeks: 5, anchor: { asOfDate: '2026-12-27', balance: 0 },
      cashSpendByMonth: { '2026-12': 0, '2027-1': 310.01 },
    })
    expect(cents(jan.totals.spend)).toBe(31001)
  })

  it('(n) a straddling week mixes the day-shares of both months', () => {
    const r = run({
      today: '2026-12-28', weeks: 2, anchor: { asOfDate: '2026-12-27', balance: 0 },
      cashSpendByMonth: { '2026-12': 310.01, '2027-1': 310.01 },
    })
    // Dec 28-31 (4 days) + Jan 1-3 (3 days). 31001 cents / 31 days = 1000 r1, so
    // the first cent-extra day is day 1 only.
    const decShare = 4 * 1000
    const janShare = 3 * 1000 + 1
    expect(cents(r.weeks[0].spend)).toBe(decShare + janShare)
    expect(r.weeks[0].start).toBe('2026-12-28')
    expect(r.weeks[0].end).toBe('2027-01-03')
  })

  it('(o) includeSpend:false zeroes spend; balances differ by exactly the spend total', () => {
    const base = {
      cashSpendByMonth: { '2026-10': 600.01, '2026-11': 450.55, '2026-12': 310.1, '2027-1': 99.99 },
    }
    const on = run({ ...base, includeSpend: true })
    const off = run({ ...base, includeSpend: false })
    expect(off.weeks.every(w => w.spend === 0)).toBe(true)
    expect(off.totals.spend).toBe(0)
    const last = on.weeks.length - 1
    expect(cents(off.weeks[last].closing) - cents(on.weeks[last].closing)).toBe(cents(on.totals.spend))
  })
})

describe('exact cents', () => {
  it('(q) 0.1 + 0.2-style amounts sum exactly', () => {
    const r = run({
      anchor: { asOfDate: '2026-10-25', balance: 0.3 },
      bills: [bill('a', 27), bill('b', 27)],
      billAmountsByMonth: { '2026-10': { a: 0.1, b: 0.2 } },
    })
    expect(r.weeks[0].bills).toBe(0.3)
    expect(r.weeks[0].closing).toBe(0)
    expect(r.weeks[0].belowMin).toBe(false)
  })
})

describe('degenerate inputs', () => {
  it('(r) empty data with an anchor: flat balance, no flags', () => {
    const r = run({ minBalance: 100, anchor: { asOfDate: '2026-10-25', balance: 250 } })
    expect(r.hasAnchor).toBe(true)
    for (const w of r.weeks) {
      expect(w.opening).toBe(250)
      expect(w.closing).toBe(250)
      expect(w.belowMin).toBe(false)
      expect(w.negative).toBe(false)
    }
    expect(r.firstBelowMinIndex).toBeNull()
  })

  it('(s) no anchor: balances null, no flags, flows still shown', () => {
    const r = run({
      anchor: null, minBalance: 100,
      bills: [bill('b', 28)], billAmountsByMonth: { '2026-10': { b: 50 } },
    })
    expect(r.hasAnchor).toBe(false)
    expect(r.carriedIn).toBeNull()
    for (const w of r.weeks) {
      expect(w.opening).toBeNull()
      expect(w.closing).toBeNull()
      expect(w.low).toBeNull()
      expect(w.lowDate).toBeNull()
      expect(w.belowMin).toBe(false)
      expect(w.negative).toBe(false)
    }
    expect(r.weeks[0].bills).toBe(50)
    expect(r.firstBelowMinIndex).toBeNull()
  })
})

describe('resolvePayDays', () => {
  it('(t) null profile defaults to 5/20 with a mismatch', () => {
    const r = resolvePayDays(null)
    expect(r.days).toEqual([5, 20])
    expect(r.mismatch).toBeTruthy()
  })

  it('(t) 5/20 semi_monthly has no mismatch', () => {
    const r = resolvePayDays({ pay_frequency: 'semi_monthly', pay_day_1: 5, pay_day_2: 20 })
    expect(r.days).toEqual([5, 20])
    expect(r.mismatch).toBeNull()
  })

  it('(t) 15/30 is used but flagged', () => {
    const r = resolvePayDays({ pay_frequency: 'semi_monthly', pay_day_1: 15, pay_day_2: 30 })
    expect(r.days).toEqual([15, 30])
    expect(r.mismatch).toContain('15/30')
  })

  it('(t) biweekly is flagged', () => {
    const r = resolvePayDays({ pay_frequency: 'biweekly', pay_day_1: 5, pay_day_2: 20 })
    expect(r.mismatch).toContain('biweekly')
  })
})

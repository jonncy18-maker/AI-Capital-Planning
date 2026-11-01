import { describe, it, expect } from 'vitest'
import { buildWeeklyCashSeries } from '../../src/lib/payperiods/weeklyCashSeries.js'
import { allocateCents, toCents, fromCents } from '../../src/lib/money.js'
import {
  validateQuickWhatIf, scenarioMonthDeltas, buildWhatIfParam, hasWhatIf,
} from '../../src/lib/payperiods/whatIfs.js'

// 2026-10-26 is a Monday; the window runs to 2027-01-24.
function input(over = {}) {
  return {
    today: '2026-10-26', weeks: 13, anchor: { asOfDate: '2026-10-25', balance: 1000 },
    minBalance: 0, payDays: [5, 20], monthlyNetByYear: {}, bonusMonth: null,
    bills: [], billAmountsByMonth: {}, cards: [], cardSpendByMonth: {}, cardManualByMonth: {},
    cashSpendByMonth: {}, includeSpend: false, warnings: [], ...over,
  }
}
const run = (over, whatIf) => buildWeeklyCashSeries({ ...input(over), ...(whatIf ? { whatIf } : {}) })
const events = r => r.weeks.flatMap(w => w.events)

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o)) deepFreeze(v)
  }
  return o
}

const rentBill = { id: 'b', name: 'Rent', pay_day: 15 }
const rentAmounts = { '2026-11': { b: 50 }, '2026-12': { b: 50 } }

describe('buildWeeklyCashSeries whatIf', () => {
  it('(w1) never mutates inputs and an empty whatIf leaves the base result unchanged', () => {
    const frozen = deepFreeze(input({ bills: [rentBill], billAmountsByMonth: rentAmounts }))
    const before = JSON.stringify(frozen)
    const noKey = buildWeeklyCashSeries(frozen)
    expect(buildWeeklyCashSeries({ ...frozen, whatIf: {} })).toEqual(noKey)

    const whatIf = deepFreeze({
      extraEvents: [{ id: 1, date: '2026-11-03', direction: 'out', amount: 10, label: 'x' }],
      skipBills: [{ billId: 'b', ym: '2026-12' }],
      moveBills: [{ billId: 'b', ym: '2026-11', toDate: '2026-11-20' }],
      moveCards: [], monthDeltas: { '2026-11': -33.33 },
    })
    const whatIfBefore = JSON.stringify(whatIf)
    const withIt = buildWeeklyCashSeries({ ...frozen, whatIf })
    expect(withIt).not.toEqual(noKey)
    expect(JSON.stringify(frozen)).toBe(before)
    expect(JSON.stringify(whatIf)).toBe(whatIfBefore)
    expect(buildWeeklyCashSeries(frozen)).toEqual(noKey)
  })

  it('(w2) extra expense and income shift net and balance from that day on, and can flip belowMin', () => {
    const base = run({ minBalance: 950 })
    const r = run({ minBalance: 950 }, {
      extraEvents: [
        { id: 1, date: '2026-11-03', direction: 'out', amount: 100, label: 'Laptop' },
        { id: 2, date: '2026-10-28', direction: 'in', amount: 250.5, label: 'Gift' },
      ],
    })
    expect(base.weeks[1].belowMin).toBe(false)
    expect(r.weeks[0].net).toBe(250.5)
    expect(r.weeks[0].other).toBe(250.5)
    expect(r.weeks[0].closing).toBe(1250.5)
    expect(r.weeks[1].net).toBe(-100)
    expect(r.weeks[1].closing).toBe(1150.5)
    const out = events(r).find(e => e.label === 'What-if: Laptop')
    expect(out).toMatchObject({ kind: 'oneoff', direction: 'out', whatIf: true, amount: 100 })

    const dip = run({ minBalance: 950 }, {
      extraEvents: [{ id: 1, date: '2026-11-03', direction: 'out', amount: 100, label: 'Laptop' }],
    })
    expect(dip.weeks[1].belowMin).toBe(true)
    expect(dip.weeks[1].firstBelowDate).toBe('2026-11-03')
    expect(dip.firstBelowMinIndex).toBe(1)
  })

  it('(w3) skipping a bill removes only that month occurrence', () => {
    const args = { bills: [rentBill], billAmountsByMonth: rentAmounts }
    const bills = r => events(r).filter(e => e.kind === 'bill' && !e.unknownAmount)
    expect(bills(run(args)).map(e => e.date)).toEqual(['2026-11-15', '2026-12-15'])
    const skipped = run(args, { skipBills: [{ billId: 'b', ym: '2026-11' }] })
    expect(bills(skipped).map(e => e.date)).toEqual(['2026-12-15'])
    expect(bills(run(args))[0]).toMatchObject({ billId: 'b', ym: '2026-11' })
  })

  it('(w4) moving a bill to a later week moves the balance between weeks and keeps the total', () => {
    const args = { bills: [rentBill], billAmountsByMonth: rentAmounts }
    const base = run(args)
    const moved = run(args, { moveBills: [{ billId: 'b', ym: '2026-11', toDate: '2026-11-17' }] })
    // 2026-11-15 is week 2 (11-09..11-15); 11-17 is week 3.
    expect(moved.weeks[2].closing).toBe(base.weeks[2].closing + 50)
    expect(moved.weeks[3].closing).toBe(base.weeks[3].closing)
    expect(moved.totals.bills).toBe(base.totals.bills)
    expect(events(moved).find(e => e.date === '2026-11-17')).toMatchObject({ kind: 'bill', whatIf: true })
  })

  it('(w5) moving a card payment moves the balance between weeks and keeps the total', () => {
    const args = {
      cards: [{ id: 'c', name: 'Visa', statement_close_day: 5 }],
      cardManualByMonth: { c: { '2026-11': 400 } },
    }
    const base = run(args)
    const card = events(base).find(e => e.kind === 'card' && e.ym === '2026-11')
    expect(card).toMatchObject({ cardId: 'c', date: '2026-11-26', amount: 400 })
    const moved = run(args, { moveCards: [{ cardId: 'c', dueYm: '2026-11', toDate: '2026-12-02' }] })
    // 11-26 is week 4 (11-23..11-29); 12-02 is week 5 (11-30..12-06).
    expect(moved.weeks[4].closing).toBe(base.weeks[4].closing + 400)
    expect(moved.weeks[5].closing).toBe(base.weeks[5].closing)
    expect(moved.totals.cardPayments).toBe(base.totals.cardPayments)
  })

  it('(w6) moved or extra dates on/before asOf or past the end are dropped with a warning', () => {
    const args = { bills: [rentBill], billAmountsByMonth: rentAmounts }
    const r = run(args, {
      moveBills: [{ billId: 'b', ym: '2026-11', toDate: '2026-10-25' }],
      extraEvents: [{ id: 1, date: '2027-02-01', direction: 'out', amount: 5, label: 'Late' }],
    })
    expect(r.warnings).toContain('What-if "Rent" on 2026-10-25 is outside the projection; ignored')
    expect(r.warnings).toContain('What-if "Late" on 2027-02-01 is outside the projection; ignored')
    expect(events(r).some(e => e.label === 'What-if: Late')).toBe(false)
    expect(events(r).filter(e => e.kind === 'bill' && !e.unknownAmount).map(e => e.date)).toEqual(['2026-12-15'])
    const dup = run(args, {
      extraEvents: [
        { id: 1, date: '2027-02-01', direction: 'out', amount: 5, label: 'Late' },
        { id: 2, date: '2027-02-01', direction: 'out', amount: 6, label: 'Late' },
      ],
    })
    expect(dup.warnings.filter(w => w.includes('"Late"'))).toHaveLength(1)
  })

  it('(w7) month deltas spread per day, sum exactly, and a straddling week mixes two months', () => {
    const r = run({}, { monthDeltas: { '2026-11': -100.01, '2026-12': 50 } })
    expect(r.totals.other).toBe(-50.01)
    expect(r.weeks.at(-1).closing).toBe(949.99)
    const sum = r.weeks.reduce((s, w) => s + toCents(w.other), 0)
    expect(sum).toBe(-5001)
    // Week 5 (11-30..12-06): Nov 30 (last of 30 parts) plus Dec 1-6 (6 of 31 parts).
    const nov = allocateCents(toCents(-100.01), 30)
    const dec = allocateCents(toCents(50), 31)
    const expected = nov[29] + dec.slice(0, 6).reduce((a, b) => a + b, 0)
    expect(toCents(r.weeks[5].other)).toBe(expected)
    const ev = r.weeks[5].events.find(e => e.kind === 'scenario')
    expect(ev).toMatchObject({ direction: expected > 0 ? 'in' : 'out', whatIf: true })
    expect(toCents(ev.amount)).toBe(Math.abs(expected))
    expect(fromCents(expected)).toBe(r.weeks[5].other)
  })

  it('(w10) an empty whatIf gives other = 0 everywhere', () => {
    const r = run({ bills: [rentBill], billAmountsByMonth: rentAmounts }, {})
    for (const w of r.weeks) expect(w.other).toBe(0)
    expect(r.totals.other).toBe(0)
    expect(events(r).some(e => e.kind === 'scenario' || e.kind === 'oneoff')).toBe(false)
  })
})

describe('scenarioMonthDeltas', () => {
  const adj = (over = {}) => ({
    category_id: 'c1', year: 2026, month: 11, delta_amount: 100, budget_categories: { group: 'Food' }, ...over,
  })
  const adjustments = [
    adj(),
    adj({ delta_amount: 25.5 }),
    adj({ category_id: 'inc', delta_amount: 500, budget_categories: { group: 'Income' } }),
    adj({ category_id: 'tr', delta_amount: 70, budget_categories: { group: 'Transfers' } }),
    adj({ category_id: 'ex', delta_amount: 80 }),
    adj({ month: 12, delta_amount: -40 }),
  ]
  const cats = [{ id: 'ex', exclude_from_totals: true }]

  it('(w8) modeled scenarios apply cash effect; income, transfers and excluded categories are skipped and counted', () => {
    const r = scenarioMonthDeltas({ state: 'modeled' }, adjustments, cats)
    expect(r.applied).toBe(true)
    expect(r.deltas).toEqual({ '2026-11': -125.5, '2026-12': 40 })
    expect(r.skippedIncome).toBe(1)
    expect(r.skippedOther).toBe(2)
  })

  it('(w8) committed scenarios are never overlaid', () => {
    const r = scenarioMonthDeltas({ state: 'committed' }, adjustments, cats)
    expect(r).toEqual({ deltas: {}, skippedIncome: 0, skippedOther: 0, applied: false })
    expect(scenarioMonthDeltas(null, adjustments, cats).applied).toBe(false)
  })
})

describe('validateQuickWhatIf', () => {
  const ctx = { start: '2026-10-26', end: '2027-01-24', existing: [] }
  const good = { type: 'expense', id: 1, date: '2026-11-03', amount: 100, label: 'Laptop' }

  it('(w9) accepts a valid item and rejects bad ones', () => {
    expect(validateQuickWhatIf(good, ctx).ok).toBe(true)
    expect(validateQuickWhatIf({ ...good, amount: 0 }, ctx).ok).toBe(false)
    expect(validateQuickWhatIf({ ...good, amount: -5 }, ctx).ok).toBe(false)
    expect(validateQuickWhatIf({ ...good, amount: 1.234 }, ctx).ok).toBe(false)
    expect(validateQuickWhatIf({ ...good, amount: 2e9 }, ctx).ok).toBe(false)
    expect(validateQuickWhatIf({ ...good, amount: '12' }, ctx).ok).toBe(false)
    expect(validateQuickWhatIf({ ...good, date: '2027-01-25' }, ctx).ok).toBe(false)
    expect(validateQuickWhatIf({ ...good, date: '2026-10-25' }, ctx).ok).toBe(false)
    expect(validateQuickWhatIf({ ...good, date: '2027-02-30' }, ctx).ok).toBe(false)
    expect(validateQuickWhatIf({ ...good, label: '   ' }, ctx).ok).toBe(false)
    expect(validateQuickWhatIf({ ...good, label: 'x'.repeat(61) }, ctx).ok).toBe(false)
    expect(validateQuickWhatIf({ ...good, type: 'income' }, ctx).ok).toBe(true)
  })

  it('(w9) rejects a duplicate occurrence', () => {
    const existing = [
      { type: 'skipBill', id: 1, billId: 'b', ym: '2026-11' },
      { type: 'moveCard', id: 2, cardId: 'c', dueYm: '2026-11', toDate: '2026-12-02' },
    ]
    const dupBill = { type: 'moveBill', id: 3, billId: 'b', ym: '2026-11', toDate: '2026-11-20' }
    expect(validateQuickWhatIf(dupBill, { ...ctx, existing })).toEqual({ ok: false, error: 'That payment already has a what-if' })
    const dupCard = { type: 'moveCard', id: 4, cardId: 'c', dueYm: '2026-11', toDate: '2026-12-03' }
    expect(validateQuickWhatIf(dupCard, { ...ctx, existing }).ok).toBe(false)
    expect(validateQuickWhatIf({ ...dupBill, ym: '2026-12' }, { ...ctx, existing }).ok).toBe(true)
    expect(validateQuickWhatIf({ ...dupBill, toDate: '2027-02-01' }, ctx).ok).toBe(false)
  })
})

describe('buildWhatIfParam / hasWhatIf', () => {
  it('maps items to the series shape without mutating its arguments', () => {
    const items = Object.freeze([
      Object.freeze({ type: 'expense', id: 1, date: '2026-11-03', amount: 10, label: ' A ' }),
      Object.freeze({ type: 'income', id: 2, date: '2026-11-04', amount: 20, label: 'B' }),
      Object.freeze({ type: 'skipBill', id: 3, billId: 'b', ym: '2026-11' }),
      Object.freeze({ type: 'moveBill', id: 4, billId: 'b', ym: '2026-12', toDate: '2026-12-20' }),
      Object.freeze({ type: 'moveCard', id: 5, cardId: 'c', dueYm: '2026-11', toDate: '2026-12-02' }),
    ])
    const deltas = Object.freeze({ '2026-11': -5, '2026-12': 0 })
    const p = buildWhatIfParam(items, deltas)
    expect(p.extraEvents).toEqual([
      { id: 1, date: '2026-11-03', direction: 'out', amount: 10, label: 'A' },
      { id: 2, date: '2026-11-04', direction: 'in', amount: 20, label: 'B' },
    ])
    expect(p.skipBills).toEqual([{ billId: 'b', ym: '2026-11' }])
    expect(p.moveBills).toEqual([{ billId: 'b', ym: '2026-12', toDate: '2026-12-20' }])
    expect(p.moveCards).toEqual([{ cardId: 'c', dueYm: '2026-11', toDate: '2026-12-02' }])
    expect(p.monthDeltas).toEqual({ '2026-11': -5 })
    expect(hasWhatIf(p)).toBe(true)
    expect(hasWhatIf(buildWhatIfParam([], {}))).toBe(false)
    expect(hasWhatIf(buildWhatIfParam([], { '2026-11': 0 }))).toBe(false)
    expect(hasWhatIf(null)).toBe(false)
  })
})

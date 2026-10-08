import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { matchAccountsToCards } from '../../src/lib/cashflow/cardAccountMatch.js'
import { computeCardCashTiming } from '../../src/lib/cashflow/cashflowEngine.js'
import { cashFlowForecast } from '../../src/lib/dashboard/widgetData.js'
import { CATEGORIES, lines, freezeClock, thawClock } from './helpers/widgetFixtures.js'

const card = (id, name, last_four = null, extra = {}) => ({
  id, name, last_four, statement_close_day: null, due_days_after_close: 21, ...extra,
})
const cardTxn = (account, date, amount, category = 'Dining') => ({ date, amount, category, account })
const sum = (xs) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100

describe('matchAccountsToCards', () => {
  const cards = [
    card('vx', 'Venture X', '5715'),
    card('csp', 'Sapphire Preferred'),
    card('ff1', 'Freedom Flex 1'),
    card('ff2', 'Freedom Flex 2'),
    card('hy', 'World of Hyatt Visa'),
    card('ag', 'Amex Gold', '2006'),
    card('sv', 'Savor', '2166'),
    card('az', 'Amazon Prime Visa'),
    card('rz', 'Ritz-Carlton Card'),
  ]
  const accounts = [
    'Venture X (...5715)',
    'Chase Sapphire Preferred',
    'Freedom Flex 1',
    'Freedom Flex 2',
    'Hyatt Visa',
    'American Express Gold Card (...2006)',
    'Savor (...2166)',
    'Amazon Prime Card',
    'The Ritz-Carlton Card',
    'Checking - 9377 (...9377)',
    'Open savings (...4633)',
    'Business Ink',
    'Discover it Card (...XXXX-XXXX-XXXX-8139)',
  ]

  it('maps real-shaped Monarch account names to their cards', () => {
    const m = matchAccountsToCards(cards, accounts)
    expect(Object.fromEntries(m)).toEqual({
      'Venture X (...5715)': 'vx',
      'Chase Sapphire Preferred': 'csp',
      'Freedom Flex 1': 'ff1',
      'Freedom Flex 2': 'ff2',
      'Hyatt Visa': 'hy',
      'American Express Gold Card (...2006)': 'ag',
      'Savor (...2166)': 'sv',
      'Amazon Prime Card': 'az',
      'The Ritz-Carlton Card': 'rz',
    })
  })

  it('leaves non-card and unknown accounts unmatched', () => {
    const m = matchAccountsToCards(cards, accounts)
    for (const a of ['Checking - 9377 (...9377)', 'Open savings (...4633)', 'Business Ink', 'Discover it Card (...XXXX-XXXX-XXXX-8139)']) {
      expect(m.has(a)).toBe(false)
    }
  })

  it('prefers last four over the name', () => {
    const m = matchAccountsToCards([card('a', 'Venture X', '5715'), card('b', 'Venture X Business', '9999')], ['Venture X Business (...5715)'])
    expect(m.get('Venture X Business (...5715)')).toBe('a')
  })

  it('does not match when two cards fit the account', () => {
    expect(matchAccountsToCards([card('a', 'Gold Card'), card('b', 'The Gold')], ['Gold']).size).toBe(0)
    expect(matchAccountsToCards([card('a', 'X', '1111'), card('b', 'Y', '1111')], ['Z (...1111)']).size).toBe(0)
  })

  it('handles empty input', () => {
    expect(matchAccountsToCards([], ['Venture X']).size).toBe(0)
    expect(matchAccountsToCards(cards, []).size).toBe(0)
    expect(matchAccountsToCards(undefined, undefined).size).toBe(0)
  })
})

describe('computeCardCashTiming', () => {
  const vx = card('vx', 'Venture X', '5715', { statement_close_day: 15, due_days_after_close: 21 })
  const acct = 'Venture X (...5715)'
  const accountCardMap = new Map([[acct, 'vx']])
  const base = { cards: [vx], accountCardMap, year: 2026, currentMonthIdx: 12, excludedCategories: new Set(['Transfer']) }

  const prior = [
    cardTxn(acct, '2025-12-10', -30), // early: Dec 15 stmt, due Jan 5 2026
    cardTxn(acct, '2025-12-20', -40), // late: Jan 15 stmt, due Feb 5 2026
  ]
  const txns = [
    cardTxn(acct, '2026-03-10', -100), // early: Mar 15 stmt, due Apr 5
    cardTxn(acct, '2026-03-20', -50), // late: Apr 15 stmt, due May 6
    cardTxn(acct, '2026-12-20', -70), // late: Jan 15 2027 stmt, due Feb 5 2027
  ]

  it('lags each purchase by statement close plus due days (hand-computed)', () => {
    const r = computeCardCashTiming({ ...base, yearTxns: txns, priorYearTxns: prior })
    expect(r.paymentsByMonth).toEqual([30, 40, 0, 100, 50, 0, 0, 0, 0, 0, 0, 0])
    expect(r.carryIn).toBe(70)
    expect(r.carryOut).toBe(70)
    expect(r.cardActualSpendByMonth.slice(0, 4)).toEqual([0, 0, 150, 0])
    expect(r.cardActualSpendByMonth[11]).toBe(70)
    expect(r.hasData).toBe(true)
  })

  it('satisfies spend + carryIn - payments = carryOut', () => {
    const r = computeCardCashTiming({ ...base, yearTxns: txns, priorYearTxns: prior })
    expect(sum(r.cardActualSpendByMonth) + r.carryIn - sum(r.paymentsByMonth)).toBeCloseTo(r.carryOut, 2)
  })

  it('splits on the close day boundary: day 15 is on the earlier statement, day 16 on the next', () => {
    const r = computeCardCashTiming({
      ...base, yearTxns: [cardTxn(acct, '2026-08-15', -10), cardTxn(acct, '2026-08-16', -20)], priorYearTxns: [],
    })
    // Aug 15 -> Aug 15 stmt, due Sep 5. Aug 16 -> Sep 15 stmt, due Oct 6.
    expect(r.paymentsByMonth[8]).toBe(10)
    expect(r.paymentsByMonth[9]).toBe(20)
  })

  it('clamps the close day to short months', () => {
    const c31 = card('c', 'Thirty One', null, { statement_close_day: 31, due_days_after_close: 10 })
    const r = computeCardCashTiming({
      ...base, cards: [c31], accountCardMap: new Map([['Thirty One', 'c']]),
      yearTxns: [cardTxn('Thirty One', '2026-02-28', -10)], priorYearTxns: [],
    })
    // Close Feb 28 (clamped), due Mar 10.
    expect(r.paymentsByMonth[2]).toBe(10)
  })

  it('nets refunds and skips excluded categories and unmatched accounts', () => {
    const r = computeCardCashTiming({
      ...base,
      yearTxns: [
        cardTxn(acct, '2026-03-10', -100),
        cardTxn(acct, '2026-03-11', 25), // refund
        cardTxn(acct, '2026-03-12', -999, 'Transfer'), // card payment row
        cardTxn('Checking - 9377 (...9377)', '2026-03-12', -500),
      ],
      priorYearTxns: [],
    })
    expect(r.paymentsByMonth[3]).toBe(75)
  })

  it('does not throw without prior-year transactions', () => {
    for (const priorYearTxns of [undefined, []]) {
      const r = computeCardCashTiming({ ...base, yearTxns: txns, priorYearTxns })
      expect(r.carryIn).toBe(0)
      expect(r.paymentsByMonth[3]).toBe(100)
    }
  })

  it('ignores cards without a statement close day', () => {
    const noClose = card('nc', 'No Close', null)
    const r = computeCardCashTiming({
      ...base, cards: [noClose], accountCardMap: new Map([['No Close', 'nc']]),
      yearTxns: [cardTxn('No Close', '2026-03-10', -100)], priorYearTxns: [],
    })
    expect(r.paymentsByMonth.every(v => v === 0)).toBe(true)
    expect(r.hasData).toBe(false)
  })

  it('uses the proportional split of forecast dollars for forecast months', () => {
    const r = computeCardCashTiming({
      ...base, year: 2027, currentMonthIdx: 0, yearTxns: [], priorYearTxns: [],
      forecastCardDollarsByMonth: { vx: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 310])) },
    })
    // Jan: early 310*15/31 = 150 closes Jan 15 (due Feb 5); late 160 closes Feb 15 (due Mar 8).
    expect(r.paymentsByMonth[1]).toBeCloseTo(150, 2) // Jan early only (no Dec 2026 spend)
    expect(sum(r.cardActualSpendByMonth)).toBe(0)
    expect(sum(r.paymentsByMonth) + r.carryOut - r.carryIn).toBeCloseTo(310 * 12, 2)
  })
})

describe('cashFlowForecast cash basis', () => {
  beforeEach(() => freezeClock())
  afterEach(() => thawClock())

  const vx = card('vx', 'Venture X', '5715', { statement_close_day: 15, due_days_after_close: 21 })
  const acct = 'Venture X (...5715)'
  const cardDollars = { vx: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 600])) }
  const ctx2027 = {
    thisYear: 2027,
    categories: CATEGORIES,
    budgetLineItems: [...lines('Rent', 1000, { year: 2027 }), ...lines('Groceries', 500, { year: 2027 })],
    commitments: [],
  }
  const netOf = (r) => sum(r.data.map(d => d.total))
  // 600/mo splits 290.32 early / 309.68 late in 31-day months, 300/300 in 30-day months.
  const sameAsForecast = [
    cardTxn(acct, '2026-11-10', -300), cardTxn(acct, '2026-11-20', -300),
    cardTxn(acct, '2026-12-10', -290.32), cardTxn(acct, '2026-12-20', -309.68),
  ]

  it('steady spend: full-year cash net equals accrual net, carry in equals carry out', () => {
    const accrual = cashFlowForecast(ctx2027, [])
    const cash = cashFlowForecast(ctx2027, [], { cards: [vx], priorYearTxns: sameAsForecast, cardDollarsByMonth: cardDollars })
    expect(accrual.basis).toBe('accrual')
    expect(cash.basis).toBe('cash')
    expect(cash.carryIn).toBe(900)
    expect(cash.carryOut).toBe(900)
    expect(netOf(cash)).toBeCloseTo(netOf(accrual), 2)
    expect(cash.data[0].cardPayments).toBeGreaterThan(0)
  })

  it('lower prior-year spend lifts cash net above accrual by carryOut - carryIn', () => {
    const accrual = cashFlowForecast(ctx2027, [])
    const cash = cashFlowForecast(ctx2027, [], {
      cards: [vx], priorYearTxns: [cardTxn(acct, '2026-12-20', -100)], cardDollarsByMonth: cardDollars,
    })
    expect(cash.carryIn).toBe(100)
    expect(netOf(cash) - netOf(accrual)).toBeCloseTo(cash.carryOut - cash.carryIn, 2)
    expect(netOf(cash)).toBeGreaterThan(netOf(accrual))
  })

  it('reports in-month cash spend as outflow minus card dollars', () => {
    const cash = cashFlowForecast(ctx2027, [], { cards: [vx], priorYearTxns: [], cardDollarsByMonth: cardDollars })
    expect(cash.data[3].forecastOutflow).toBe(1500)
    expect(cash.data[3].inMonthSpend).toBe(900)
  })

  it('scales card dollars down when they exceed planned outflow', () => {
    const big = { vx: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 5000])) }
    const cash = cashFlowForecast(ctx2027, [], { cards: [vx], priorYearTxns: [], cardDollarsByMonth: big })
    expect(cash.data.every(d => d.inMonthSpend >= 0)).toBe(true)
    expect(cash.data[3].inMonthSpend).toBe(0)
    expect(netOf(cash) - netOf(cashFlowForecast(ctx2027, []))).toBeCloseTo(cash.carryOut - cash.carryIn, 2)
  })

  it('actual months: a card purchase lands in a later month, other accounts stay put', () => {
    const ctx = { thisYear: 2026, categories: CATEGORIES, commitments: [] }
    const checking = 'Checking - 9377 (...9377)'
    const r = cashFlowForecast(ctx, [
      cardTxn(acct, '2026-02-20', -200), // late Feb: Mar 15 stmt, due Apr 5
      cardTxn(checking, '2026-02-21', -1000, 'Rent'),
      cardTxn(checking, '2026-02-28', 3000, 'Salary'),
    ], { cards: [vx], priorYearTxns: [], cardDollarsByMonth: {} })
    expect(r.data[1].total).toBe(2000) // Feb: checking only
    expect(r.data[1].cardPayments).toBe(0)
    expect(r.data[3].cardPayments).toBe(200)
    expect(r.data[3].total).toBe(-200)
    expect(r.actualNet).toBe(1800)
  })

  it('keeps unmatched-account rows in-month', () => {
    const ctx = { thisYear: 2026, categories: CATEGORIES, commitments: [] }
    const r = cashFlowForecast(ctx, [cardTxn('Business Ink', '2026-02-20', -200)], { cards: [vx], priorYearTxns: [], cardDollarsByMonth: {} })
    expect(r.data[1].total).toBe(-200)
  })

  it('falls back to accrual when no card has a close day', () => {
    const ctx = { thisYear: 2026, categories: CATEGORIES, commitments: [] }
    const t = [cardTxn(acct, '2026-02-20', -200)]
    const plain = cashFlowForecast(ctx, t)
    const noClose = cashFlowForecast(ctx, t, { cards: [card('vx', 'Venture X', '5715')], priorYearTxns: [], cardDollarsByMonth: {} })
    expect(noClose.basis).toBe('accrual')
    expect(noClose).toEqual(plain)
    expect(plain.data[1].total).toBe(-200)
    expect(plain.carryIn).toBe(0)
  })
})

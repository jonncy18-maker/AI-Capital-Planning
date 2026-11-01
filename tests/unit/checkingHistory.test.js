import { describe, it, expect } from 'vitest'
import {
  buildCheckingHistory, snapshotCheckpoints, monarchAccountOptions, reconcileToleranceCents,
  HISTORY_WEEKS, RECONCILE_WINDOW_DAYS,
} from '../../src/lib/payperiods/checkingHistory.js'
import { mondayOnOrBefore } from '../../src/lib/payperiods/weeklyCashSeries.js'

const ACCT = 'Checking - 1 (...1)'
const tx = (date, amount, over = {}) => ({ date, amount, account: ACCT, merchant: 'M', ...over })

// today 2026-10-28 (Wed) -> start Monday 2026-10-26; history weeks end 10-04, 10-11, 10-18, 10-25.
const base = (over = {}) => ({
  today: '2026-10-28', start: '2026-10-26',
  anchor: { asOfDate: '2026-10-25', balance: 1000 },
  accountName: ACCT, fetchFrom: '2026-09-24', checkpoints: [],
  transactions: [
    tx('2026-10-25', -50), tx('2026-10-20', -200), tx('2026-10-15', 500),
    tx('2026-10-10', -100), tx('2026-10-02', -30),
    tx('2026-10-27', -5, { account: 'Other' }),
  ],
  ...over,
})

const balances = h => h.points.map(p => p.balance)

describe('constants', () => {
  it('exports the window sizes and tolerance', () => {
    expect(HISTORY_WEEKS).toBe(4)
    expect(RECONCILE_WINDOW_DAYS).toBe(3)
    expect(reconcileToleranceCents(10000)).toBe(2500)
    expect(reconcileToleranceCents(1000000)).toBe(10000)
    expect(reconcileToleranceCents(-1000000)).toBe(10000)
  })
})

describe('walk-back', () => {
  it('(h1) mixed signs, a transfer and a card payment give exact cents for all 4 week-ends', () => {
    const h = buildCheckingHistory(base({
      anchor: { asOfDate: '2026-10-25', balance: 1000.07 },
      transactions: [
        tx('2026-10-25', -50.01), tx('2026-10-20', -200.33, { merchant: 'Card payment' }), tx('2026-10-15', 500.1),
        tx('2026-10-10', -100, { merchant: 'Transfer to Savings' }), tx('2026-10-02', -30.99),
        tx('2026-10-27', -5, { account: 'Other' }),
      ],
    }))
    expect(h.status).toBe('ok')
    expect(balances(h)).toEqual([850.31, 750.31, 1250.41, 1000.07])
    expect(h.points.map(p => p.index)).toEqual([-4, -3, -2, -1])
    expect(h.points.map(p => p.weekEnd)).toEqual(['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25'])
    expect(h.points[0].net).toBe(-30.99)
    expect(h.points[2].inflow).toBe(500.1)
    expect(h.points[3].outflow).toBe(250.34)
  })

  it('(h2) the anchor day is excluded for its own point but included for earlier ones', () => {
    const h = buildCheckingHistory(base())
    expect(balances(h)).toEqual([850, 750, 1250, 1000])
  })

  it('(h3) coverage before asOf makes every point a gap, and counts other accounts', () => {
    const stale = buildCheckingHistory(base({
      transactions: [tx('2026-10-20', -200), tx('2026-10-24', -1, { account: 'Other' })],
    }))
    expect(stale.status).toBe('not-synced')
    expect(stale.coverageThrough).toBe('2026-10-24')
    for (const p of stale.points) {
      expect(p.gap).toBe(true)
      expect(p.balance).toBeNull()
      expect(p.gapReason).toContain('Transactions synced through 2026-10-24')
    }
    // Mapped rows stop at 10-20, but another account synced later: coverage is fine.
    const fresh = buildCheckingHistory(base({
      transactions: [tx('2026-10-20', -200), tx('2026-10-27', -1, { account: 'Other' })],
    }))
    expect(fresh.status).toBe('ok')
    expect(fresh.coverageThrough).toBe('2026-10-27')
  })

  it('(h4) week-ends after asOf are gaps and never walk forward', () => {
    const h = buildCheckingHistory(base({
      anchor: { asOfDate: '2026-10-14', balance: 500 },
      transactions: [tx('2026-10-12', -40), tx('2026-10-20', -200), tx('2026-10-05', -10)],
    }))
    expect(h.status).toBe('ok')
    expect(h.points[0].balance).toBe(550)
    expect(h.points[1].balance).toBe(540)
    expect(h.points[2].gap).toBe(true)
    expect(h.points[2].gapReason).toContain('projection covers')
    expect(h.points[3].gap).toBe(true)
  })

  it('(h5) crosses month and year boundaries with Monday week starts', () => {
    const today = '2027-01-06'
    const start = mondayOnOrBefore(today)
    expect(start).toBe('2027-01-04')
    const h = buildCheckingHistory({
      today, start, anchor: { asOfDate: '2027-01-03', balance: 2000 }, accountName: ACCT, fetchFrom: '2026-12-03',
      transactions: [
        tx('2027-01-02', -100), tx('2026-12-30', 300), tx('2026-12-20', -50),
        tx('2027-01-04', -1, { account: 'Other' }),
      ],
    })
    expect(h.status).toBe('ok')
    expect(h.points.map(p => p.weekStart)).toEqual(['2026-12-07', '2026-12-14', '2026-12-21', '2026-12-28'])
    for (const p of h.points) expect(mondayOnOrBefore(p.weekStart)).toBe(p.weekStart)
    expect(balances(h)).toEqual([1850, 1800, 1800, 2000])
    expect(h.points[3].net).toBe(200)
  })
})

describe('reconciliation', () => {
  const cp = (date, balance, label = 'Oct period 1 snapshot') => ({ date, balance, label })

  it('(h6) a snapshot inside the tolerance is ok; outside marks every point approximate; uncovered is skipped', () => {
    const ok = buildCheckingHistory(base({ checkpoints: [cp('2026-10-15', 1270)] }))
    expect(ok.reconciliation).toHaveLength(1)
    expect(ok.reconciliation[0]).toMatchObject({ ok: true, lo: 750, hi: 1250, diff: 20 })
    expect(ok.approximate).toBe(false)

    const bad = buildCheckingHistory(base({ checkpoints: [cp('2026-10-15', 2000)] }))
    expect(bad.reconciliation[0].ok).toBe(false)
    expect(bad.approximate).toBe(true)
    for (const p of bad.points) {
      expect(p.approximate).toBe(true)
      expect(p.approxReasons.join(' ')).toContain('Off from your Oct period 1 snapshot')
    }

    const skipped = buildCheckingHistory(base({
      fetchFrom: '2026-10-10', checkpoints: [cp('2026-10-10', 99999)],
    }))
    expect(skipped.reconciliation).toEqual([])
    expect(skipped.approximate).toBe(false)
  })

  it('ignores checkpoints outside [start-28, asOf]', () => {
    const h = buildCheckingHistory(base({ checkpoints: [cp('2026-09-01', 1), cp('2026-10-30', 1)] }))
    expect(h.reconciliation).toEqual([])
  })
})

describe('matching and duplicates', () => {
  it('(h7) account matching ignores case and whitespace, and other accounts', () => {
    const h = buildCheckingHistory(base({
      accountName: '  CHECKING - 1 (...1) ',
      transactions: [
        tx('2026-10-20', -200, { account: ' checking - 1 (...1)  ' }),
        tx('2026-10-21', -999, { account: 'Savings - 2' }),
        tx('2026-10-27', -1, { account: 'Savings - 2' }),
      ],
    }))
    expect(h.status).toBe('ok')
    expect(h.points[2].balance).toBe(1200)
  })

  it('(h8) possible duplicates are flagged, never removed', () => {
    const h = buildCheckingHistory(base({
      transactions: [
        tx('2026-10-15', -40, { merchant: 'Netflix' }), tx('2026-10-15', -40, { merchant: 'NETFLIX INC' }),
        tx('2026-10-16', -10, { merchant: 'Shop' }), tx('2026-10-16', -10, { merchant: 'shop ' }),
        tx('2026-10-27', -1, { account: 'Other' }),
      ],
    }))
    expect(h.possibleDuplicates).toEqual([{ date: '2026-10-15', amount: -40, merchants: ['Netflix', 'NETFLIX INC'] }])
    expect(h.points[0].approximate).toBe(true)
    expect(h.points[1].approximate).toBe(true)
    expect(h.points[2].approximate).toBe(false)
    expect(h.points[2].netApproximate).toBe(true)
    expect(h.points[2].net).toBe(-100)
    expect(h.points[2].transactions).toHaveLength(4)
  })
})

describe('statuses', () => {
  it('(h9) no-mapping, no-anchor and zero-mapped-rows; nets still computed without an anchor', () => {
    const none = buildCheckingHistory(base({ accountName: null }))
    expect(none.status).toBe('no-mapping')
    expect(none.points[0].gapReason).toBe('Map your Monarch checking account to see history')
    expect(none.points[0].net).toBeNull()

    const noAnchor = buildCheckingHistory(base({ anchor: null }))
    expect(noAnchor.status).toBe('no-anchor')
    expect(noAnchor.points[0].gapReason).toBe('Enter a balance to see history')
    expect(noAnchor.points[2].net).toBe(500)
    expect(noAnchor.points[2].balance).toBeNull()
  })

  it('zero mapped rows reports the since-date', () => {
    const h = buildCheckingHistory(base({ transactions: [tx('2026-10-27', -1, { account: 'Other' })] }))
    expect(h.status).toBe('no-transactions')
    expect(h.points[0].gapReason).toBe(`No transactions for "${ACCT}" since 2026-09-24`)
    expect(h.points[0].net).toBeNull()
  })

  it('(h11) empty transactions', () => {
    const h = buildCheckingHistory(base({ transactions: [] }))
    expect(h.status).toBe('no-transactions')
    expect(h.coverageThrough).toBeNull()
    expect(h.points).toHaveLength(4)
    expect(h.possibleDuplicates).toEqual([])
  })
})

describe('helpers', () => {
  it('(h10) snapshotCheckpoints uses pay days (default 15/30) and clamps Feb 30', () => {
    const rows = [
      { account_id: 'a', year: 2027, month: 2, period_half: 2, balance: '100.5' },
      { account_id: 'a', year: 2026, month: 10, period_half: 1, balance: 50 },
      { account_id: 'a', year: 2026, month: 10, period_half: 2, balance: null },
      { account_id: 'b', year: 2026, month: 10, period_half: 1, balance: 1 },
    ]
    expect(snapshotCheckpoints(rows, 'a', null)).toEqual([
      { date: '2026-10-15', balance: 50, label: 'Oct period 1 snapshot' },
      { date: '2027-02-28', balance: 100.5, label: 'Feb period 2 snapshot' },
    ])
    expect(snapshotCheckpoints(rows, 'a', { pay_day_1: 5, pay_day_2: 20 }).map(c => c.date))
      .toEqual(['2026-10-05', '2027-02-20'])
  })

  it('(h12) monarchAccountOptions orders by count then name', () => {
    const t = [
      { account: 'B' }, { account: ' B ' }, { account: 'A' }, { account: 'C' }, { account: 'C' }, { account: 'C' }, { account: '' },
    ]
    expect(monarchAccountOptions(t)).toEqual([
      { name: 'C', count: 3 }, { name: 'B', count: 2 }, { name: 'A', count: 1 },
    ])
    expect(monarchAccountOptions([])).toEqual([])
  })
})

// Pure rolling weekly cash-timing projection for the Pay Periods WEEKS tab.
// No I/O: weeklyCashLoader.js gathers the inputs, this builds the weeks.
//
// All dates are local calendar strings 'YYYY-MM-DD'. Date arithmetic runs on
// integer day numbers (UTC midnight / 86400000) so DST never shifts a day.
// All money is integer cents internally; dollars only in the returned object.

import { toCents, fromCents, mulCents, allocateCents } from '../money.js'
import { daysInMonth } from '../cashflow/cashflowEngine.js'

export const DEFAULT_PAY_DAYS = [5, 20]

const DEFAULT_DUE_DAYS = 21
const KIND_ORDER = { income: 0, bill: 1, card: 2, spend: 3 }

const pad = n => String(n).padStart(2, '0')
const ymdOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`

function parseYmd(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number)
  return { y, m, d }
}

function toDayNum(ymd) {
  const { y, m, d } = parseYmd(ymd)
  return Date.UTC(y, m - 1, d) / 86400000
}

function fromDayNum(n) {
  const dt = new Date(n * 86400000)
  return ymdOf(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

export function addDays(ymd, n) {
  return fromDayNum(toDayNum(ymd) + n)
}

// Monday is the week start. Day 0 (1970-01-01) was a Thursday.
export function mondayOnOrBefore(ymd) {
  const n = toDayNum(ymd)
  const dow = (((n + 4) % 7) + 7) % 7 // 0 = Sunday
  return fromDayNum(n - ((dow + 6) % 7))
}

export function clampDay(year, month, day) {
  return Math.min(day, daysInMonth(year, month))
}

function nextMonth(y, m) {
  return m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 }
}

function prevMonth(y, m) {
  return m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }
}

function monthsBetween(fromYmd, toYmd, leadMonths = 0) {
  let { y, m } = parseYmd(fromYmd)
  for (let i = 0; i < leadMonths; i++) ({ y, m } = prevMonth(y, m))
  const end = parseYmd(toYmd)
  const out = []
  while (y < end.y || (y === end.y && m <= end.m)) {
    out.push({ y, m })
    ;({ y, m } = nextMonth(y, m))
  }
  return out
}

const isPayDay = v => Number.isInteger(v) && v >= 1 && v <= 31

export function resolvePayDays(profile) {
  const d1 = profile?.pay_day_1 ?? null
  const d2 = profile?.pay_day_2 ?? null
  const freq = profile?.pay_frequency ?? null
  const valid = isPayDay(d1) && isPayDay(d2)
  const days = valid ? [d1, d2] : [...DEFAULT_PAY_DAYS]

  const notes = []
  if (freq != null && freq !== 'semi_monthly') {
    notes.push(`Profile pay frequency is ${freq}; WEEKS projects semi-monthly paychecks.`)
  }
  if (d1 == null || d2 == null) {
    notes.push('Profile pay days are not set; WEEKS assumes the 5th and 20th.')
  } else if (!valid) {
    notes.push(`Profile pay days (${d1}/${d2}) are not valid; WEEKS assumes the 5th and 20th.`)
  } else if (d1 !== DEFAULT_PAY_DAYS[0] || d2 !== DEFAULT_PAY_DAYS[1]) {
    notes.push(`Profile pay days are ${d1}/${d2}; WEEKS uses them as semi-monthly paydays.`)
  }
  return { days, mismatch: notes.length ? notes.join(' ') : null }
}

// Statement balance for the statement closing in (y, m): the on/before-close share
// of that month's spend plus the after-close share of the previous month's. Stitches
// the year boundary, which computeStatementForecast omits.
function statementBalanceC(spendCents, y, m, closeDay) {
  const early = (yy, mm) => {
    const closeD = clampDay(yy, mm, closeDay)
    return mulCents(spendCents(yy, mm), closeD / daysInMonth(yy, mm))
  }
  const prev = prevMonth(y, m)
  const late = spendCents(prev.y, prev.m) - early(prev.y, prev.m)
  return early(y, m) + late
}

export function buildWeeklyCashSeries(input) {
  const {
    today, weeks = 13, anchor = null, minBalance = 0, payDays = DEFAULT_PAY_DAYS,
    monthlyNetByYear = {}, bonusMonth = null, bills = [], billAmountsByMonth = {},
    cards = [], cardSpendByMonth = {}, cardManualByMonth = {}, cashSpendByMonth = {},
    includeSpend = true,
  } = input

  const warnings = [...(input.warnings ?? [])]
  const warn = msg => { if (!warnings.includes(msg)) warnings.push(msg) }

  const start = mondayOnOrBefore(today)
  const end = addDays(start, weeks * 7 - 1)
  const hasAnchor = !!anchor && anchor.asOfDate != null && Number.isFinite(Number(anchor.balance))
  const asOf = hasAnchor ? anchor.asOfDate : null

  // Events on or before the as-of date are already in the balance.
  const lo = hasAnchor ? (addDays(asOf, 1) < start ? addDays(asOf, 1) : start) : start
  const counts = date => date <= end && (hasAnchor ? date > asOf : date >= start)

  const events = [] // { date, kind, label, amountC, unknownAmount?, manual? }
  const push = e => { if (counts(e.date)) events.push(e) }
  const monthKey = (y, m) => `${y}-${m}`
  const months = monthsBetween(lo, end)

  // Income
  const noForecastYears = new Set()
  const [payA, payB] = [...payDays].sort((a, b) => a - b)
  for (const { y, m } of months) {
    const netArr = monthlyNetByYear[y]
    if (!netArr) {
      if (!noForecastYears.has(y)) { noForecastYears.add(y); warn(`No salary forecast for ${y}`) }
      continue
    }
    const monthC = toCents(netArr[m - 1] ?? 0)
    if (monthC === 0) continue
    let p1, p2
    let bonusC = 0
    if (bonusMonth != null && m === Number(bonusMonth)) {
      // Base pay is another month's net; the excess is the bonus, paid on the later check.
      const baseC = Math.min(toCents(netArr[Number(bonusMonth) % 12] ?? 0), monthC)
      ;[p1, p2] = allocateCents(baseC, 2)
      bonusC = monthC - baseC
      p2 += bonusC
    } else {
      ;[p1, p2] = allocateCents(monthC, 2)
    }
    const dateA = ymdOf(y, m, clampDay(y, m, payA))
    const dateB = ymdOf(y, m, clampDay(y, m, payB))
    if (p1 !== 0) push({ date: dateA, kind: 'income', label: 'Paycheck', amountC: p1 })
    if (p2 !== 0) {
      push({ date: dateB, kind: 'income', label: bonusC > 0 ? 'Paycheck + bonus' : 'Paycheck', amountC: p2 })
    }
  }

  // Bills
  for (const bill of bills) {
    const day = bill.pay_day ?? bill.due_day
    if (day == null) { warn(`${bill.name}: no pay day or due day; skipped`); continue }
    for (const { y, m } of months) {
      const amount = billAmountsByMonth[monthKey(y, m)]?.[bill.id]
      const unknown = amount == null
      push({
        date: ymdOf(y, m, clampDay(y, m, day)), kind: 'bill', label: bill.name,
        amountC: unknown ? 0 : toCents(amount), ...(unknown ? { unknownAmount: true } : {}),
      })
    }
  }

  // Card statement payments
  for (const card of cards) {
    const closeDay = card.statement_close_day
    if (!closeDay) continue
    const dueOffset = card.due_days_after_close ?? DEFAULT_DUE_DAYS
    const spendC = (y, m) => toCents(cardSpendByMonth[card.id]?.[monthKey(y, m)] ?? 0)
    const manual = cardManualByMonth[card.id] ?? {}

    const byDueMonth = {}
    for (const { y, m } of monthsBetween(lo, end, 3)) {
      const closeD = clampDay(y, m, closeDay)
      const due = addDays(ymdOf(y, m, closeD), dueOffset)
      const { y: dy, m: dm } = parseYmd(due)
      const key = monthKey(dy, dm)
      const slot = byDueMonth[key] ?? (byDueMonth[key] = { dueDate: due, amountC: 0 })
      slot.amountC += statementBalanceC(spendC, y, m, closeDay)
      if (due < slot.dueDate) slot.dueDate = due
    }
    for (const [key, slot] of Object.entries(byDueMonth)) {
      const override = manual[key]
      const isManual = typeof override === 'number' && Number.isFinite(override)
      push({
        date: slot.dueDate, kind: 'card', label: `${card.name} statement`,
        amountC: isManual ? toCents(override) : slot.amountC, ...(isManual ? { manual: true } : {}),
      })
    }
  }

  // Day-to-day cash spend, spread evenly over each month's days
  const spendByDay = {}
  if (includeSpend) {
    for (const { y, m } of months) {
      const dim = daysInMonth(y, m)
      const parts = allocateCents(toCents(cashSpendByMonth[monthKey(y, m)] ?? 0), dim)
      for (let d = 1; d <= dim; d++) {
        const date = ymdOf(y, m, d)
        if (counts(date) && parts[d - 1] !== 0) spendByDay[date] = parts[d - 1]
      }
    }
  }

  const signedC = e => (e.unknownAmount ? 0 : e.kind === 'income' ? e.amountC : -e.amountC)

  let carriedC = 0
  const dayOut = {}
  const dayIn = {}
  for (const e of events) {
    if (e.date < start) { carriedC += signedC(e); continue }
    const bucket = e.kind === 'income' ? dayIn : dayOut
    bucket[e.date] = (bucket[e.date] ?? 0) + (e.unknownAmount ? 0 : e.amountC)
  }
  for (const [date, c] of Object.entries(spendByDay)) {
    if (date < start) { carriedC -= c; continue }
    dayOut[date] = (dayOut[date] ?? 0) + c
  }

  const minC = toCents(minBalance)
  let balC = hasAnchor ? toCents(anchor.balance) + carriedC : null
  const outWeeks = []
  const totalsC = { income: 0, bills: 0, cardPayments: 0, spend: 0 }

  for (let i = 0; i < weeks; i++) {
    const wStart = addDays(start, i * 7)
    const wEnd = addDays(wStart, 6)
    const openingC = balC
    let lowC = openingC
    let lowDate = openingC == null ? null : wStart
    const sums = { income: 0, bills: 0, cardPayments: 0, spend: 0 }

    const weekEvents = events
      .filter(e => e.date >= wStart && e.date <= wEnd)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : KIND_ORDER[a.kind] - KIND_ORDER[b.kind]))
    for (const e of weekEvents) {
      if (e.unknownAmount) continue
      if (e.kind === 'income') sums.income += e.amountC
      else if (e.kind === 'bill') sums.bills += e.amountC
      else sums.cardPayments += e.amountC
    }

    for (let d = 0; d < 7; d++) {
      const date = addDays(wStart, d)
      const out = dayOut[date] ?? 0
      const inc = dayIn[date] ?? 0
      if (balC != null) {
        balC -= out
        if (out > 0 && balC < lowC) { lowC = balC; lowDate = date }
        balC += inc
      }
    }
    for (let d = 0; d < 7; d++) sums.spend += spendByDay[addDays(wStart, d)] ?? 0

    const netC = sums.income - sums.bills - sums.cardPayments - sums.spend
    const outEvents = weekEvents.map(e => ({
      date: e.date, kind: e.kind, label: e.label,
      amount: fromCents(e.amountC),
      ...(e.unknownAmount ? { unknownAmount: true } : {}),
      ...(e.manual ? { manual: true } : {}),
    }))
    if (sums.spend !== 0) {
      outEvents.push({ date: wStart, kind: 'spend', label: 'Day-to-day spend (cash)', amount: fromCents(sums.spend) })
    }

    for (const k of Object.keys(totalsC)) totalsC[k] += sums[k]
    outWeeks.push({
      index: i, start: wStart, end: wEnd,
      opening: openingC == null ? null : fromCents(openingC),
      income: fromCents(sums.income),
      bills: fromCents(sums.bills),
      cardPayments: fromCents(sums.cardPayments),
      spend: fromCents(sums.spend),
      net: fromCents(netC),
      closing: balC == null ? null : fromCents(balC),
      low: lowC == null ? null : fromCents(lowC),
      lowDate,
      belowMin: lowC != null && lowC < minC,
      negative: lowC != null && lowC < 0,
      events: outEvents,
    })
  }

  const firstBelow = outWeeks.find(w => w.belowMin)
  return {
    hasAnchor, start, end,
    carriedIn: hasAnchor ? fromCents(carriedC) : null,
    weeks: outWeeks,
    firstBelowMinIndex: firstBelow ? firstBelow.index : null,
    totals: {
      income: fromCents(totalsC.income), bills: fromCents(totalsC.bills),
      cardPayments: fromCents(totalsC.cardPayments), spend: fromCents(totalsC.spend),
    },
    warnings,
  }
}

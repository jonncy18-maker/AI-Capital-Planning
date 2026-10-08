// ─── Cash Flow Engine ─────────────────────────────────────────────────────────
//
// Translates forecast spend (independent forecast_line_items per category per
// month, falling back to budget_line_items) into projected cash outflow,
// accounting for the credit-card float:
// spend happens during a statement cycle, but cash leaves checking only when the
// statement is paid (statement close day + due_days_after_close).
//
//   1. routeForecastToCards   — route monthly forecast spend to each card in $
//                               (mirrors the points engine's best/default split),
//                               plus the non-card cash portion that leaves in-month.
//   2. computeStatementForecast — per card, the projected balance of the statement
//                               closing in each month, attributed proportionally by
//                               close day, with its due (payment) date.
//   3. statementDueIn / projectedBillAmounts — the statement payment landing in a
//                               given month, mapped onto linked bills.
//
// All functions are pure; callers pass pre-loaded data.

import {
  buildSpendMaps,
  resolveMonthlySpend,
  bestCardForCategory,
} from '../creditcards/pointsEngine.js'
import { toCents, fromCents, mulCents, sumCents } from '../money.js'
import { parseLocalDate } from '../dates.js'

// Days in a 1-indexed month (month 1..12).
export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

// Route forecast spend to credit cards in dollars, mirroring the points engine's
// best-card / default-card split but accumulating dollars instead of points.
// Also captures non-card cash outflow:
//   - cash_only categories (full forecast amount), and
//   - the portion of cardable spend not put on a card (per the coverage setting).
//
// Returns:
//   cardDollarsByMonth: { [cardId]: { [month]: dollars } }  — covered card spend
//   cashByMonth:        { [month]: dollars }                — non-card cash spend
//   cashDetailByMonth:  { [month]: Array<{ categoryId, name, group, amount, kind }> }
export function routeForecastToCards({
  budgetCategories, lineItems, forecastLines,
  cards, earnRateMap, coveragePct, optimizationPct,
}) {
  const cardDollarsByMonth = {}
  const cashByMonth = {}
  const cashDetailByMonth = {}
  for (let m = 1; m <= 12; m++) { cashByMonth[m] = 0; cashDetailByMonth[m] = [] }
  for (const c of (cards ?? [])) cardDollarsByMonth[c.id] = {}

  const spendMaps = buildSpendMaps(lineItems, forecastLines)
  const hasCards = cards && cards.length > 0
  const defaultCard = hasCards ? (cards.find(c => c.is_default) ?? cards[0]) : null
  const coverageFactor = (coveragePct ?? 80) / 100
  const optimizationFactor = (optimizationPct ?? 100) / 100

  // Accumulated in integer cents; converted back to dollars before returning.
  const cardCents = {}
  for (const c of (cards ?? [])) cardCents[c.id] = {}
  const cashCents = {}
  for (let m = 1; m <= 12; m++) cashCents[m] = 0

  const pushCash = (m, cat, amountCents, kind) => {
    cashCents[m] += amountCents
    cashDetailByMonth[m].push({
      categoryId: cat.id, name: cat.category, group: cat.group, amount: fromCents(amountCents), kind,
    })
  }

  for (const cat of (budgetCategories ?? [])) {
    if (!cat.is_active) continue
    const ccCat = cat.cc_category || 'other'

    for (let m = 1; m <= 12; m++) {
      const spend = toCents(resolveMonthlySpend(cat.id, m, spendMaps))
      if (spend <= 0) continue

      // Cash-only categories, or any spend when no cards exist, leave as in-month cash.
      if (cat.cash_only || !hasCards) {
        pushCash(m, cat, spend, 'cash_only')
        continue
      }

      const cardable = mulCents(spend, coverageFactor)
      const uncovered = spend - cardable
      if (uncovered > 0) pushCash(m, cat, uncovered, 'uncovered')

      // Pinned card overrides earn-rate optimization for this category.
      const pinnedCard = cat.pinned_card_id ? (cards ?? []).find(c => c.id === cat.pinned_card_id) : null
      const best = pinnedCard ? { cardId: pinnedCard.id } : bestCardForCategory(ccCat, cards, earnRateMap)
      // The default share is the remainder, so the two parts always sum to cardable.
      const optimizedSpend = mulCents(cardable, optimizationFactor)
      const defaultSpend = cardable - optimizedSpend
      if (best) {
        cardCents[best.cardId][m] = (cardCents[best.cardId][m] ?? 0) + optimizedSpend
      }
      if (defaultCard) {
        cardCents[defaultCard.id][m] = (cardCents[defaultCard.id][m] ?? 0) + defaultSpend
      }
    }
  }

  for (const id of Object.keys(cardCents)) {
    for (const m of Object.keys(cardCents[id])) cardDollarsByMonth[id][m] = fromCents(cardCents[id][m])
  }
  for (let m = 1; m <= 12; m++) cashByMonth[m] = fromCents(cashCents[m])

  return { cardDollarsByMonth, cashByMonth, cashDetailByMonth }
}

// Per card, the projected statement closing in each month of `year`.
// Proportional-by-close-day attribution: a statement closing on day D of month M
// contains the on/before-close portion of month M's spend (days 1..D) plus the
// after-close portion of month M-1's spend (days D+1..end).
//
// Returns: { [cardId]: Array<{ month, closeDate, dueDate, balance }> }  (month 1..12)
// Note: a January statement omits the prior December's after-close spend, since
// only `year`'s monthly spend is supplied.
export function computeStatementForecast({ cardDollarsByMonth, cards, year }) {
  const out = {}
  for (const card of (cards ?? [])) {
    const D = card.statement_close_day
    if (!D) { out[card.id] = []; continue }
    const dueOffset = card.due_days_after_close ?? 21
    const byMonth = cardDollarsByMonth?.[card.id] ?? {}
    const statements = []

    for (let M = 1; M <= 12; M++) {
      const dim = daysInMonth(year, M)
      const closeD = Math.min(D, dim)
      const fracEarly = closeD / dim
      let balance = mulCents(toCents(byMonth[M] ?? 0), fracEarly)

      const prev = M - 1
      if (prev >= 1) {
        const dimPrev = daysInMonth(year, prev)
        const fracLatePrev = 1 - (Math.min(D, dimPrev) / dimPrev)
        balance += mulCents(toCents(byMonth[prev] ?? 0), fracLatePrev)
      }

      const closeDate = new Date(year, M - 1, closeD)
      const dueDate = new Date(closeDate.getTime() + dueOffset * 86400000)
      statements.push({ month: M, closeDate, dueDate, balance: fromCents(balance) })
    }
    out[card.id] = statements
  }
  return out
}

// The projected statement payment for a card whose DUE date falls in (year, month).
// Returns { balance, closeDate, dueDate } or null. Sums if more than one matches.
export function statementDueIn(statements, year, month) {
  if (!statements) return null
  let match = null
  let balanceCents = 0
  for (const s of statements) {
    if (s.dueDate.getFullYear() === year && s.dueDate.getMonth() + 1 === month) {
      if (!match) match = { balance: 0, closeDate: s.closeDate, dueDate: s.dueDate }
      balanceCents += toCents(s.balance)
      if (s.dueDate < match.dueDate) { match.dueDate = s.dueDate; match.closeDate = s.closeDate }
    }
  }
  if (match) match.balance = fromCents(balanceCents)
  return match
}

// Map of billId → projected statement amount, for bills linked to a credit card
// whose statement payment is due in (year, month).
export function projectedBillAmounts({ bills, statementsByCard, year, month }) {
  const map = {}
  for (const b of (bills ?? [])) {
    if (!b.credit_card_id) continue
    const due = statementDueIn(statementsByCard?.[b.credit_card_id], year, month)
    if (due) map[b.id] = due.balance
  }
  return map
}

// Cash-basis card payments for `year`, lagging spend by statement close + due
// date. Unlike computeStatementForecast this also reads the PRIOR year's spend,
// so a December statement paid in January is counted, and reports what is
// carried in from last year and out to next.
//
// Spend by purchase month is split into early (days <= close day) and late
// (days > close day) halves. The statement closing in month M is
// early(M) + late(M-1) and is paid in full on close + due_days_after_close.
// Actual months (prior year, and `year` months before currentMonthIdx) use the
// exact transaction dates of rows whose account maps to the card; later months
// use the proportional split of forecastCardDollarsByMonth[cardId][month].
//
// Identity: card spend of `year` + carryIn - sum(paymentsByMonth) = carryOut.
// Only cards with statement_close_day participate.
export function computeCardCashTiming({
  cards, accountCardMap, year, currentMonthIdx,
  yearTxns, priorYearTxns, excludedCategories, forecastCardDollarsByMonth,
}) {
  const excluded = excludedCategories instanceof Set ? excludedCategories : new Set(excludedCategories ?? [])
  const timingCards = (cards ?? []).filter(c => c.statement_close_day)
  const byCard = new Map(timingCards.map(c => [c.id, c]))
  const paymentsC = Array(12).fill(0)
  const actualSpendC = Array(12).fill(0)
  let carryInC = 0
  let carryOutC = 0

  // early/late cents per card, by calendar year then month index 0..11
  const split = {}
  for (const c of timingCards) {
    split[c.id] = {
      [year - 1]: { early: Array(12).fill(0), late: Array(12).fill(0) },
      [year]: { early: Array(12).fill(0), late: Array(12).fill(0) },
    }
  }

  const addRows = (rows, rowYear, lastMonthExclusive) => {
    for (const t of rows ?? []) {
      const cardId = accountCardMap?.get?.(t.account)
      if (cardId == null || !byCard.has(cardId)) continue
      if (excluded.has(t.category)) continue
      const amt = Number(t.amount) || 0
      if (amt === 0) continue
      const d = parseLocalDate(t.date)
      if (Number.isNaN(d.getTime()) || d.getFullYear() !== rowYear) continue
      const mi = d.getMonth()
      if (mi >= lastMonthExclusive) continue
      const closeD = Math.min(byCard.get(cardId).statement_close_day, daysInMonth(rowYear, mi + 1))
      split[cardId][rowYear][d.getDate() <= closeD ? 'early' : 'late'][mi] -= toCents(amt)
    }
  }
  addRows(priorYearTxns, year - 1, 12)
  addRows(yearTxns, year, currentMonthIdx)

  for (const c of timingCards) {
    const bucket = split[c.id][year]
    for (let mi = Math.max(currentMonthIdx, 0); mi < 12; mi++) {
      const dim = daysInMonth(year, mi + 1)
      const closeD = Math.min(c.statement_close_day, dim)
      const total = toCents(forecastCardDollarsByMonth?.[c.id]?.[mi + 1] ?? 0)
      const early = mulCents(total, closeD / dim)
      bucket.early[mi] = early
      bucket.late[mi] = total - early
    }
    for (let mi = 0; mi < Math.min(currentMonthIdx, 12); mi++) {
      actualSpendC[mi] += bucket.early[mi] + bucket.late[mi]
    }

    const dueOffset = c.due_days_after_close ?? 21
    // Statements closing Jan(year-1)..Dec(year), then a virtual Jan(year+1)
    // holding only December's late half.
    for (let n = 0; n <= 24; n++) {
      const sy = year - 1 + Math.floor(n / 12)
      const mi = n % 12
      const closeD = Math.min(c.statement_close_day, daysInMonth(sy, mi + 1))
      const dueDate = new Date(sy, mi, closeD + dueOffset)

      const early = sy <= year ? split[c.id][sy].early[mi] : 0
      const lateMi = (mi + 11) % 12
      const lateYear = mi === 0 ? sy - 1 : sy
      const late = lateYear >= year - 1 ? split[c.id][lateYear].late[lateMi] : 0

      // Year-1 spend: the whole of a year-1 statement, plus the December late
      // half sitting in January's statement.
      const priorPart = (sy === year - 1 ? early : 0) + (lateYear === year - 1 ? late : 0)

      if (dueDate.getFullYear() === year) {
        paymentsC[dueDate.getMonth()] += early + late
        carryInC += priorPart
      } else if (dueDate.getFullYear() > year) {
        carryOutC += early + late - priorPart
      }
    }
  }

  return {
    paymentsByMonth: paymentsC.map(fromCents),
    carryIn: fromCents(carryInC),
    carryOut: fromCents(carryOutC),
    cardActualSpendByMonth: actualSpendC.map(fromCents),
    hasData: timingCards.length > 0 && (sumCents(paymentsC) !== 0 || carryInC !== 0 || carryOutC !== 0),
  }
}

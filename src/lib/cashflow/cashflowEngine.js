// ─── Cash Flow Engine ─────────────────────────────────────────────────────────
//
// Translates forecast spend (budget_line_items / forecast_overrides per category
// per month) into projected cash outflow, accounting for the credit-card float:
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
  budgetCategories, lineItems, overrides,
  cards, earnRateMap, coveragePct, optimizationPct,
}) {
  const cardDollarsByMonth = {}
  const cashByMonth = {}
  const cashDetailByMonth = {}
  for (let m = 1; m <= 12; m++) { cashByMonth[m] = 0; cashDetailByMonth[m] = [] }
  for (const c of (cards ?? [])) cardDollarsByMonth[c.id] = {}

  const { lineItemsByCategory, overridesByCategory } = buildSpendMaps(lineItems, overrides)
  const hasCards = cards && cards.length > 0
  const defaultCard = hasCards ? (cards.find(c => c.is_default) ?? cards[0]) : null
  const coverageFactor = (coveragePct ?? 80) / 100
  const optimizationFactor = (optimizationPct ?? 100) / 100

  const pushCash = (m, cat, amount, kind) => {
    cashByMonth[m] += amount
    cashDetailByMonth[m].push({
      categoryId: cat.id, name: cat.category, group: cat.group, amount, kind,
    })
  }

  for (const cat of (budgetCategories ?? [])) {
    if (!cat.is_active) continue
    const ccCat = cat.cc_category || 'other'

    for (let m = 1; m <= 12; m++) {
      const spend = resolveMonthlySpend(cat.id, m, lineItemsByCategory, overridesByCategory)
      if (spend <= 0) continue

      // Cash-only categories, or any spend when no cards exist, leave as in-month cash.
      if (cat.cash_only || !hasCards) {
        pushCash(m, cat, spend, 'cash_only')
        continue
      }

      const cardable = spend * coverageFactor
      const uncovered = spend - cardable
      if (uncovered > 0.005) pushCash(m, cat, uncovered, 'uncovered')

      const best = bestCardForCategory(ccCat, cards, earnRateMap)
      const optimizedSpend = cardable * optimizationFactor
      const defaultSpend = cardable * (1 - optimizationFactor)
      if (best) {
        cardDollarsByMonth[best.cardId][m] = (cardDollarsByMonth[best.cardId][m] ?? 0) + optimizedSpend
      }
      if (defaultCard) {
        cardDollarsByMonth[defaultCard.id][m] = (cardDollarsByMonth[defaultCard.id][m] ?? 0) + defaultSpend
      }
    }
  }

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
      let balance = (byMonth[M] ?? 0) * fracEarly

      const prev = M - 1
      if (prev >= 1) {
        const dimPrev = daysInMonth(year, prev)
        const fracLatePrev = 1 - (Math.min(D, dimPrev) / dimPrev)
        balance += (byMonth[prev] ?? 0) * fracLatePrev
      }

      const closeDate = new Date(year, M - 1, closeD)
      const dueDate = new Date(closeDate.getTime() + dueOffset * 86400000)
      statements.push({ month: M, closeDate, dueDate, balance })
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
  for (const s of statements) {
    if (s.dueDate.getFullYear() === year && s.dueDate.getMonth() + 1 === month) {
      if (!match) match = { balance: 0, closeDate: s.closeDate, dueDate: s.dueDate }
      match.balance += s.balance
      if (s.dueDate < match.dueDate) { match.dueDate = s.dueDate; match.closeDate = s.closeDate }
    }
  }
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

// Split an in-month diffuse cash total across the two pay periods by day count.
// period1 = days 1..midpoint, period2 = the rest.
export function splitCashAcrossPeriods(total, midpoint, year, month) {
  const dim = daysInMonth(year, month)
  const p1Days = Math.max(0, Math.min(midpoint, dim))
  const frac1 = dim > 0 ? p1Days / dim : 0
  return { period1: total * frac1, period2: total * (1 - frac1) }
}

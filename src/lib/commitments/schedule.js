import { parseLocalDate } from '../dates.js'
import { toCents, fromCents, allocateCents } from '../money.js'

// Shared commitment → cash-demand scheduling.
//
// Commitments store a flexible `cost_structure` jsonb. This module normalizes
// the supported shapes into a month-by-month cash demand schedule so the same
// logic feeds Cash Flow Timing, the Budget Builder, and the Scenario Planner.
//
// Supported cost_structure shapes:
//   { kind: 'monthly', amount }                 — fixed amount every active month
//   { kind: 'annual',  amount, month }          — once a year in `month` (1-12)
//   { kind: 'total',   amount }                 — spread evenly across the span
//   { kind: 'custom',  schedule: { '1': 100 }}  — explicit per-month amounts (1-12)

function monthsBetween(start, end) {
  // inclusive count of calendar months between two Date objects
  return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1
}

// Is the commitment active during the given calendar month/year?
function isActiveInMonth(commitment, year, month) {
  const start = commitment.start_date ? parseLocalDate(commitment.start_date) : null
  const end = commitment.end_date ? parseLocalDate(commitment.end_date) : null
  const pointer = new Date(year, month - 1, 15) // mid-month probe
  if (start && pointer < new Date(start.getFullYear(), start.getMonth(), 1)) return false
  if (end && pointer > new Date(end.getFullYear(), end.getMonth() + 1, 0)) return false
  return true
}

// Returns the cash demand (positive $) for a single commitment in a given month.
export function commitmentMonthlyDemand(commitment, year, month) {
  if (!isActiveInMonth(commitment, year, month)) return 0
  const cs = commitment.cost_structure || {}
  const kind =
    cs.kind || (cs.monthly_amount != null ? 'monthly' : cs.annual_total != null ? 'annual' : null)

  switch (kind) {
    case 'monthly':
      return Number(cs.amount ?? cs.monthly_amount ?? 0) || 0
    case 'annual': {
      const hitMonth = Number(cs.month ?? cs.due_month ?? 1)
      return month === hitMonth ? Number(cs.amount ?? cs.annual_total ?? 0) || 0 : 0
    }
    case 'total': {
      const start = commitment.start_date ? parseLocalDate(commitment.start_date) : null
      const end = commitment.end_date ? parseLocalDate(commitment.end_date) : null
      if (!start || !end) return 0
      const span = Math.max(monthsBetween(start, end), 1)
      // Index of this month inside the span decides who gets the extra cents,
      // so the monthly parts sum exactly to the total.
      const idx = (year - start.getFullYear()) * 12 + (month - 1 - start.getMonth())
      const parts = allocateCents(toCents(Number(cs.amount ?? 0) || 0), span)
      return fromCents(parts[idx] ?? 0)
    }
    case 'custom': {
      const sched = cs.schedule || {}
      return Number(sched[String(month)] ?? 0) || 0
    }
    default:
      return 0
  }
}

// Full 12-month schedule for one commitment in a target year.
export function commitmentYearSchedule(commitment, year) {
  const months = []
  for (let m = 1; m <= 12; m++) {
    months.push(commitmentMonthlyDemand(commitment, year, m))
  }
  return months
}

// Total projected cost across the commitment's whole lifespan.
export function commitmentTotalProjected(commitment) {
  const start = commitment.start_date ? parseLocalDate(commitment.start_date) : null
  const end = commitment.end_date ? parseLocalDate(commitment.end_date) : null
  const cs = commitment.cost_structure || {}
  const kind =
    cs.kind || (cs.monthly_amount != null ? 'monthly' : cs.annual_total != null ? 'annual' : null)

  // Without both dates the span is unknown; commitmentMonthlyDemand returns 0
  // for every month in that case, so the total must agree.
  if (kind === 'total') return start && end ? fromCents(toCents(Number(cs.amount ?? 0) || 0)) : 0

  if (!start) return 0
  // Open-ended commitments: project a rolling 12 months as a representative
  // cost. Bounded ones count every calendar month from start through end.
  const monthCount = Math.min(end ? monthsBetween(start, end) : 12, 600)
  let total = 0 // cents
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  for (let i = 0; i < monthCount; i++) {
    total += toCents(
      commitmentMonthlyDemand(commitment, cursor.getFullYear(), cursor.getMonth() + 1)
    )
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return fromCents(total)
}

// Aggregate a set of commitments into a 12-month cash demand array for a year.
export function aggregateCommitmentsForYear(commitments, year) {
  const totals = Array(12).fill(0) // cents
  for (const c of commitments) {
    const sched = commitmentYearSchedule(c, year)
    for (let m = 0; m < 12; m++) totals[m] += toCents(sched[m])
  }
  return totals.map(fromCents)
}

// Human-readable summary of a commitment's cadence.
export function describeCostStructure(cs = {}) {
  const kind =
    cs.kind || (cs.monthly_amount != null ? 'monthly' : cs.annual_total != null ? 'annual' : null)
  const fmt = (n) => '$' + Math.round(Number(n) || 0).toLocaleString()
  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  switch (kind) {
    case 'monthly':
      return `${fmt(cs.amount ?? cs.monthly_amount)}/mo`
    case 'annual': {
      const monthName = MONTHS[Number(cs.month ?? cs.due_month ?? 1) - 1]
      return `${fmt(cs.amount ?? cs.annual_total)}/yr${monthName ? ` (${monthName})` : ''}`
    }
    case 'total':
      return `${fmt(cs.amount)} total`
    case 'custom':
      return 'Custom schedule'
    default:
      return '—'
  }
}

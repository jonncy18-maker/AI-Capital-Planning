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
  if (commitment.status === 'completed') {
    // completed commitments still count for past months, not future
  }
  const start = commitment.start_date ? new Date(commitment.start_date) : null
  const end = commitment.end_date ? new Date(commitment.end_date) : null
  const pointer = new Date(year, month - 1, 15) // mid-month probe
  if (start && pointer < new Date(start.getFullYear(), start.getMonth(), 1)) return false
  if (end && pointer > new Date(end.getFullYear(), end.getMonth() + 1, 0)) return false
  return true
}

// Returns the cash demand (positive $) for a single commitment in a given month.
export function commitmentMonthlyDemand(commitment, year, month) {
  if (!isActiveInMonth(commitment, year, month)) return 0
  const cs = commitment.cost_structure || {}
  const kind = cs.kind || (cs.monthly_amount != null ? 'monthly' : cs.annual_total != null ? 'annual' : null)

  switch (kind) {
    case 'monthly':
      return Number(cs.amount ?? cs.monthly_amount ?? 0) || 0
    case 'annual': {
      const hitMonth = Number(cs.month ?? cs.due_month ?? 1)
      return month === hitMonth ? (Number(cs.amount ?? cs.annual_total ?? 0) || 0) : 0
    }
    case 'total': {
      const start = commitment.start_date ? new Date(commitment.start_date) : null
      const end = commitment.end_date ? new Date(commitment.end_date) : null
      if (!start || !end) return 0
      const span = Math.max(monthsBetween(start, end), 1)
      return (Number(cs.amount ?? 0) || 0) / span
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
  const start = commitment.start_date ? new Date(commitment.start_date) : null
  const end = commitment.end_date ? new Date(commitment.end_date) : null
  const cs = commitment.cost_structure || {}
  const kind = cs.kind || (cs.monthly_amount != null ? 'monthly' : cs.annual_total != null ? 'annual' : null)

  if (kind === 'total') return Number(cs.amount ?? 0) || 0

  if (!start) return 0
  // Open-ended commitments: project a rolling 12 months as a representative cost.
  const effectiveEnd = end || new Date(start.getFullYear() + 1, start.getMonth(), start.getDate())
  let total = 0
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  let guard = 0
  while (cursor <= effectiveEnd && guard < 600) {
    total += commitmentMonthlyDemand(commitment, cursor.getFullYear(), cursor.getMonth() + 1)
    cursor.setMonth(cursor.getMonth() + 1)
    guard++
  }
  return total
}

// Aggregate a set of commitments into a 12-month cash demand array for a year.
export function aggregateCommitmentsForYear(commitments, year) {
  const totals = Array(12).fill(0)
  for (const c of commitments) {
    const sched = commitmentYearSchedule(c, year)
    for (let m = 0; m < 12; m++) totals[m] += sched[m]
  }
  return totals
}

// Human-readable summary of a commitment's cadence.
export function describeCostStructure(cs = {}) {
  const kind = cs.kind || (cs.monthly_amount != null ? 'monthly' : cs.annual_total != null ? 'annual' : null)
  const fmt = n => '$' + Math.round(Number(n) || 0).toLocaleString()
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  switch (kind) {
    case 'monthly':
      return `${fmt(cs.amount ?? cs.monthly_amount)}/mo`
    case 'annual':
      return `${fmt(cs.amount ?? cs.annual_total)}/yr (${MONTHS[(Number(cs.month ?? cs.due_month ?? 1)) - 1]})`
    case 'total':
      return `${fmt(cs.amount)} total`
    case 'custom':
      return 'Custom schedule'
    default:
      return '—'
  }
}

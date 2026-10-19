import { buildPlanSeries } from './plans.js'
import { PROJECTION_END_AGE } from './assumptions.js'

// Deterministic wealth trajectory projection.
//
// Given a starting balance, monthly contribution, annual return rate, and a
// horizon, projects net worth year by year with monthly compounding. Pure
// functions — Monte Carlo is explicitly out of V1 scope (see ARCHITECTURE §4.6).

// Project a single series forward.
// startBalance: number, monthlyContribution: number, annualReturn: 0.07 = 7%,
// years: integer. Optional annualCommitmentDrain reduces investable cash per year.
// Optional yearContributions (object or array, projection year index y -> annual
// net contribution) overrides the flat contribution for those years. An override
// year already nets commitments out (the 5-year outlook's net savings includes
// them), so the commitment drain is not applied again; negative values withdraw.
export function projectTrajectory({
  startBalance = 0,
  monthlyContribution = 0,
  annualReturn = 0.06,
  years = 30,
  annualCommitmentDrain = 0,
  yearContributions = null,
}) {
  const monthlyRate = annualReturn / 12
  const defaultDrain = annualCommitmentDrain / 12
  const series = [{ year: 0, balance: startBalance }]
  let balance = startBalance

  for (let y = 1; y <= years; y++) {
    const override = yearContributions?.[y]
    const hasOverride = override != null && Number.isFinite(Number(override))
    const contribution = hasOverride ? Number(override) / 12 : monthlyContribution
    const monthlyDrain = hasOverride ? 0 : defaultDrain
    for (let m = 0; m < 12; m++) {
      balance = balance * (1 + monthlyRate) + contribution - monthlyDrain
      if (balance < 0) balance = 0
    }
    series.push({ year: y, balance: Math.round(balance) })
  }
  return series
}

// Compute years until a target balance is reached (or null if not within horizon).
export function yearsToTarget(series, target) {
  for (const point of series) {
    if (point.balance >= target) return point.year
  }
  return null
}

// Build a baseline + scenario comparison for a given set of assumptions.
export function buildComparison(base, scenario, years) {
  const baseSeries = projectTrajectory({ ...base, years })
  const scenarioSeries = projectTrajectory({ ...scenario, years })
  const finalBase = baseSeries[baseSeries.length - 1].balance
  const finalScenario = scenarioSeries[scenarioSeries.length - 1].balance
  return {
    baseSeries,
    scenarioSeries,
    finalBase,
    finalScenario,
    delta: finalScenario - finalBase,
  }
}

// Derive a starting investable balance from a wealth snapshot.
export function investableFromSnapshot(snapshot) {
  if (!snapshot) return 0
  return (Number(snapshot.investment_balance) || 0) + (Number(snapshot.retirement_balance) || 0)
}

// ── Assumption-driven projection ────────────────────────────────────────────
const cents = (n) => Math.round(n * 100) / 100

// Retirement target: multiple x annual retirement spend, inflated from today to
// the retirement age.
export function retirementTarget(a) {
  const years = a.retirement_age - a.current_age
  return cents(a.withdrawal_multiple * a.retirement_spend * Math.pow(1 + a.inflation, years))
}

export function baseReturn(a) {
  if (a.return_mode === 'manual') return a.manual_return
  return a.presets.find((p) => p.key === a.index_preset)?.rate ?? a.manual_return
}

// Base line first, then one line per scenario (base rate + offset, floored at 0).
export function scenarioRates(a) {
  const base = baseReturn(a)
  return [
    { name: 'Base', rate: base, base: true },
    ...a.scenarios.map((s) => ({
      name: s.name,
      rate: Math.max(0, cents((base + s.delta) * 1e4) / 1e4),
      base: false,
    })),
  ]
}

// Full-year contribution flows for each calendar year of the plan.
// Payroll: 401(k) (own + match) and HSA come off the paycheck, so they are
// funded before the outlook surplus. The Roth IRA is paid from surplus, then
// surplus fills the emergency fund, and what remains goes to taxable. A
// negative surplus withdraws from taxable. The first (partial) year is returned
// as a full-year amount; expectedAt() prorates it to the remaining months.
export function annualFlows(a, startDate, horizon) {
  const startYear = +startDate.slice(0, 4)
  let emergency = a.emergency.current
  const rows = []
  for (let n = 0; n <= horizon; n++) {
    const year = startYear + n
    const age = a.current_age + n
    const grow = Math.pow(1 + a.caps.growth, year - a.caps.year)
    const pay = Math.pow(1 + a.pay_growth, year - a.caps.year)
    const cu = a.catch_up.enabled
    const k401Cap = a.caps.k401 * grow + (cu && age >= a.catch_up.age_50 ? a.catch_up.k401 : 0)
    const iraCap = a.caps.ira * grow + (cu && age >= a.catch_up.age_50 ? a.catch_up.ira : 0)
    const hsaCap = a.caps.hsa * grow + (cu && age >= a.catch_up.age_hsa ? a.catch_up.hsa : 0)
    const employee = Math.min(
      k401Cap,
      a.employee_401k * pay + (cu && age >= a.catch_up.age_50 ? a.catch_up.k401 : 0)
    )
    const match = employee * a.match_rate
    const surplus =
      a.surplus_by_year[year] != null
        ? a.surplus_by_year[year]
        : a.surplus.base * Math.pow(1 + a.pay_growth, year - a.caps.year)
    const ira = Math.min(iraCap, Math.max(0, surplus))
    const rest = surplus - ira
    const toEmergency = rest > 0 ? Math.min(rest, Math.max(0, a.emergency.target - emergency)) : 0
    emergency += toEmergency
    const taxable = rest - toEmergency
    rows.push({
      year,
      age,
      employee_401k: cents(employee),
      match_401k: cents(match),
      roth_ira: cents(ira),
      hsa: cents(hsaCap),
      surplus: cents(surplus),
      to_emergency: cents(toEmergency),
      taxable: cents(taxable),
      total: cents(employee + match + ira + hsaCap + taxable),
    })
  }
  return rows
}

export function planHorizon(a) {
  return Math.min(40, Math.max(5, Math.max(a.retirement_age, PROJECTION_END_AGE) - a.current_age))
}

// The plan row body (the existing wealth_plans columns) for a set of
// assumptions: base return, derived target and per-calendar-year contributions,
// so the saved-benchmark engine (expectedAt) works unchanged.
export function planFromAssumptions({
  name,
  startDate,
  startBalance,
  startingContributionsYtd = null,
  assumptions: a,
}) {
  const horizon = planHorizon(a)
  const flows = annualFlows(a, startDate, horizon)
  const annual = Object.fromEntries(flows.map((f) => [f.year, f.total]))
  return {
    name,
    start_date: startDate,
    horizon,
    annual_return: baseReturn(a),
    include_commitments: false,
    start_balance: startBalance,
    monthly_contribution: cents(flows[0].total / 12),
    retirement_target: retirementTarget(a),
    emergency_cash_target: a.emergency.target,
    starting_contributions_ytd: startingContributionsYtd,
    annual_commitment_drain: 0,
    annual_contributions: annual,
    annual_contributions_without_commitments: annual,
    assumptions: a,
  }
}

// Age (one decimal) at which a monthly series first reaches the target, or null.
export function targetAge(series, target, startDate, currentAge) {
  const hit = series.monthly.find((p) => p.balance >= target)
  if (!hit) return null
  const years =
    (new Date(`${hit.date}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / (365.25 * 864e5)
  return Math.floor((currentAge + years) * 10) / 10
}

// Base and scenario lines for a saved plan that carries assumptions.
export function scenarioLines(plan) {
  const a = plan.assumptions
  if (!a) return []
  return scenarioRates(a).map((s) => {
    const series = buildPlanSeries({ ...plan, annual_return: s.rate })
    return {
      ...s,
      series,
      reachedAge: targetAge(series, Number(plan.retirement_target), plan.start_date, a.current_age),
    }
  })
}

// Balance at each age row for the by-age table.
export function balanceAtAge(plan, line, age) {
  const a = plan.assumptions
  const year = +plan.start_date.slice(0, 4) + (age - a.current_age)
  const point = line.series.annual.find((p) => +p.date.slice(0, 4) === year)
  return point ? point.balance : null
}

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

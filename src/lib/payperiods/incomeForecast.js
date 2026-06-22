// Pure monthly net-income forecast from the salary/bonus assumptions in Settings.
// Mirrors the Dashboard's incomeVsExpenses() formula: salary/12 each month, the
// annual bonus in its month, minus estimated taxes (at the effective rate on
// salary + bonus), 401k contributions, and benefits — i.e. the net deposits that
// actually land in checking, which is what we reconcile against outflow.
//
// `taxEstimate` is the result of estimateNet({ grossIncome, bonus, … }) for the
// relevant year (it supplies totalTax). Returns a 12-element array indexed by
// month-1 (Jan = 0), or null when no salary is configured.

export function monthlyNetForecast(profile, taxEstimate) {
  const salary = Number(profile?.annual_income) || 0
  if (salary <= 0) return null

  const annualBonus = Number(profile?.annual_bonus) || 0
  const bonusIdx = profile?.bonus_month != null ? Number(profile.bonus_month) - 1 : null
  const totalGross = salary + annualBonus

  const benefitsAmount = Number(profile?.benefits_amount) || 0
  const benefitsPct = Number(profile?.benefits_pct) || 0
  const annualBenefits = benefitsAmount > 0
    ? benefitsAmount
    : (benefitsPct > 0 ? totalGross * benefitsPct / 100 : 0)
  const monthlyBenefits = annualBenefits / 12

  const totalTax = Number(taxEstimate?.totalTax) || 0
  const effectiveTaxRate = totalGross > 0 ? totalTax / totalGross : 0

  const four01kPct = Number(profile?.four01k_pct) || 0
  const four01kOnBonus = profile?.four01k_on_bonus ?? false
  const monthly401kSalary = salary / 12 * four01kPct / 100

  return Array(12).fill(0).map((_, m) => {
    const isBonus = bonusIdx !== null && m === bonusIdx
    const grossMonth = salary / 12 + (isBonus ? annualBonus : 0)
    const taxMonth = grossMonth * effectiveTaxRate
    const month401k = monthly401kSalary + (isBonus && four01kOnBonus ? annualBonus * four01kPct / 100 : 0)
    return Math.max(0, grossMonth - taxMonth - month401k - monthlyBenefits)
  })
}

// Pure gross→net income estimator. No DB or React imports — the caller supplies
// the resolved reference data (`taxData`) so this stays unit-testable. The async
// wrapper that loads taxData from Supabase lives in src/lib/db/taxBrackets.js.
//
// PHASE 1 scope & simplifications (documented intentionally):
//   - Federal: progressive brackets on taxable income (gross + bonus − pre-tax
//     deductions − standard deduction).
//   - FICA: Social Security 6.2% up to the wage base + Medicare 1.45% + Additional
//     Medicare 0.9% over the filing-status threshold, applied to gross + bonus.
//     Note: 401(k) deferrals do NOT reduce FICA wages (§125 cafeteria-plan
//     premiums/HSA do); for simplicity FICA here is charged on the full gross +
//     bonus, so FICA may be slightly overstated for users with §125 deductions.
//   - State: single flat effective rate (see stateTax.js).

import { computeStateTax } from './stateTax.js'

// Progressive tax on `taxableIncome` given an ascending bracket array of
// { upTo, rate } (final upTo === null is the top bracket).
export function computeBracketTax(taxableIncome, brackets) {
  let income = Math.max(0, Number(taxableIncome) || 0)
  if (!Array.isArray(brackets) || income === 0) return 0
  let tax = 0
  let lower = 0
  for (const b of brackets) {
    const upper = b.upTo == null ? Infinity : Number(b.upTo)
    const slice = Math.min(income, upper) - lower
    if (slice > 0) tax += slice * Number(b.rate)
    if (income <= upper) break
    lower = upper
  }
  return tax
}

// FICA (employee share) on wages.
export function computeFica(wages, fica, filingStatus) {
  const w = Math.max(0, Number(wages) || 0)
  if (!fica) return 0
  const ss = Math.min(w, Number(fica.ssWageBase) || 0) * (Number(fica.ssRate) || 0)
  const medicare = w * (Number(fica.medicareRate) || 0)
  const threshold = Number(fica.addlMedicareThreshold?.[filingStatus]) || Infinity
  const addl = Math.max(0, w - threshold) * (Number(fica.addlMedicareRate) || 0)
  return ss + medicare + addl
}

// Main entry point. `taxData` shape:
//   {
//     federal: { brackets: [...], standardDeduction: number },
//     fica:    { ssRate, ssWageBase, medicareRate, addlMedicareRate, addlMedicareThreshold },
//     state:   { rate },          // resolved meta for the chosen state (optional)
//     estimated: boolean,         // true when a future year was inflation-projected
//   }
export function estimateNetIncome({
  grossIncome = 0,
  bonus = 0,
  filingStatus = 'single',
  stateRateOverride = null,
  preTaxDeductions = 0,
  taxData,
} = {}) {
  const wages = (Number(grossIncome) || 0) + (Number(bonus) || 0)
  const preTax = Math.max(0, Number(preTaxDeductions) || 0)
  const stdDed = Number(taxData?.federal?.standardDeduction) || 0
  const taxableIncome = Math.max(0, wages - preTax - stdDed)

  const federalTax = computeBracketTax(taxableIncome, taxData?.federal?.brackets)
  const ficaTax = computeFica(wages, taxData?.fica, filingStatus)
  const stateTax = computeStateTax(taxableIncome, taxData?.state, stateRateOverride)

  const totalTax = federalTax + ficaTax + stateTax
  const netIncome = wages - totalTax
  const effectiveRate = wages > 0 ? totalTax / wages : 0

  return {
    grossWages: wages,
    taxableIncome,
    federalTax,
    ficaTax,
    stateTax,
    totalTax,
    netIncome,
    effectiveRate,
    estimated: !!taxData?.estimated,
  }
}

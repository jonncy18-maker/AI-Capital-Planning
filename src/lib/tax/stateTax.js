// State income tax — PHASE 1 simplified model.
//
// Each state is modeled as a single flat effective rate applied to federal
// taxable income (seeded in the tax_brackets table, jurisdiction = state code).
// A per-user override lets users plug in their own effective rate when the rough
// estimate is off. No-tax states resolve to 0. This is intentionally simple;
// progressive per-state brackets can be layered in later behind the same API.

// Compute state tax. `stateData` is the resolved tax_brackets row meta for the
// state ({ rate }); `override` is an optional user-supplied effective rate
// expressed as a percent (e.g. 6 for 6%).
export function computeStateTax(taxableIncome, stateData, override) {
  const base = Math.max(0, Number(taxableIncome) || 0)
  const rate = resolveStateRate(stateData, override)
  return base * rate
}

// Resolve the effective rate (as a fraction). Override (a percent) wins when set
// to a valid non-negative number; otherwise fall back to the seeded state rate.
// Note: null/undefined/'' mean "no override" — guard explicitly since Number(null)
// is 0, which would otherwise masquerade as a 0% override.
export function resolveStateRate(stateData, override) {
  if (override !== null && override !== undefined && override !== '') {
    const ov = Number(override)
    if (Number.isFinite(ov) && ov >= 0) return ov / 100
  }
  const rate = Number(stateData?.rate)
  return Number.isFinite(rate) && rate >= 0 ? rate : 0
}

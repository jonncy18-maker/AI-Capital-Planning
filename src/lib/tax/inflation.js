// Inflation projection for tax parameters in budget years beyond the latest
// seeded year. The IRS only publishes brackets one year at a time, so for future
// budget years we project the most recent known year's figures forward and flag
// the result as an estimate (see estimateTax.js).

// Default annual inflation factor applied to brackets / standard deduction.
export const DEFAULT_INFLATION_RATE = 0.025

// Project a single dollar value from one year to another. Returns the value
// unchanged when the years match or when value is not finite.
export function inflate(value, fromYear, toYear, rate = DEFAULT_INFLATION_RATE) {
  if (value == null || !Number.isFinite(value)) return value
  const years = (toYear ?? fromYear) - (fromYear ?? toYear)
  if (!years) return value
  return value * Math.pow(1 + rate, years)
}

// Inflate every numeric `upTo` threshold in a bracket array (null = top bracket,
// left as-is). Rates are unchanged.
export function inflateBrackets(brackets, fromYear, toYear, rate = DEFAULT_INFLATION_RATE) {
  if (!Array.isArray(brackets)) return brackets
  if ((toYear ?? fromYear) === (fromYear ?? toYear)) return brackets
  return brackets.map(b => ({
    ...b,
    upTo: b.upTo == null ? null : inflate(b.upTo, fromYear, toYear, rate),
  }))
}

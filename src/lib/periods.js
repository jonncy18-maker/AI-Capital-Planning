// Planning horizon → dashboard period filter derivation.
//
// The planning horizon is a multi-select set of years (e.g. [1, 3, 5]). Each
// selected year becomes a period the user can filter the dashboard with, and
// the smallest selected horizon is used as the default period view.
export function derivePeriods(years) {
  const sorted = [...(years || [])].sort((a, b) => a - b)
  const periodOptions = sorted.map(y => `${y}Y`)
  return { periodOptions, periodDefault: periodOptions[0] || null }
}

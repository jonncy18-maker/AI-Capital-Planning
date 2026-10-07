// Display helpers for a scenario's outlook adjustments (year · group rows where
// a positive delta means more spending).

const money = (n) => '$' + Math.abs(Math.round(n)).toLocaleString()
const signed = (n) => (n === 0 ? '$0' : (n < 0 ? '−' : '+') + money(n))

// null when there are no adjustments. byYear is sorted by year then group;
// net is the net-savings impact (the negative of that year's summed deltas).
export function summarizeOutlookAdjustments(adjustments) {
  const rows = (adjustments ?? []).filter((a) => Number.isFinite(Number(a.delta_amount)))
  if (!rows.length) return null
  const byYearMap = new Map()
  for (const a of rows) {
    const delta = Number(a.delta_amount)
    if (!byYearMap.has(a.year)) byYearMap.set(a.year, { year: a.year, items: [], sum: 0 })
    const y = byYearMap.get(a.year)
    y.items.push({ id: a.id, year: a.year, group_name: a.group_name, label: a.label || '', delta })
    y.sum += delta
  }
  const byYear = [...byYearMap.values()]
    .sort((a, b) => a.year - b.year)
    .map((y) => ({
      year: y.year,
      net: -y.sum,
      items: y.items.sort((a, b) => a.group_name.localeCompare(b.group_name)),
    }))
  return {
    count: rows.length,
    total: rows.reduce((s, a) => s + Number(a.delta_amount), 0),
    minYear: byYear[0].year,
    maxYear: byYear[byYear.length - 1].year,
    byYear,
  }
}

// Net-savings (cash) terms, matching the monthly chip: positive = better off.
// A +$1,200 spending delta reads "−$1,200 · 2029 outlook" (tone 'bad').
export function outlookChip(summary) {
  if (!summary) return null
  const years =
    summary.minYear === summary.maxYear
      ? `${summary.minYear}`
      : `${summary.minYear}–${summary.maxYear}`
  return {
    text: `${signed(-summary.total)} · ${years} outlook`,
    tone: summary.total > 0 ? 'bad' : summary.total < 0 ? 'good' : 'neutral',
  }
}

export const formatSignedMoney = signed

import { pct, usd } from './historyUi.jsx'

function Tile({ label, value, sub, tone, title }) {
  return (
    <div className="hist-card hist-tile" title={title}>
      <div className="hist-label">{label}</div>
      <div className={`hist-tile-v${tone ? ` hist-${tone}` : ''}`}>{value}</div>
      <div className="hist-tile-s">{sub}</div>
    </div>
  )
}

export default function HistoryTiles({ history }) {
  const { totals, vsBudget, columns } = history
  const n = totals.monthsWithData
  const avg = (c) => (n > 0 ? usd(Math.round(c / n)) : '—')
  const coverage = `${n} of ${totals.monthsInRange} month${totals.monthsInRange === 1 ? '' : 's'}`

  const budgeted = columns.filter((c) => c.hasData && c.budget != null)
  const overMonths = budgeted.filter((c) => c.spend > c.budget).length
  const years = [...new Set(budgeted.map((c) => c.key.slice(0, 4)))]
  const diff = vsBudget.actual - vsBudget.budget
  const net = totals.income - totals.spent

  const tiles = [
    {
      label: `Spent · ${coverage}`,
      value: usd(totals.spent),
      sub: `avg ${avg(totals.spent)} / month`,
      title: 'Spending excludes transfers and credit-card payments. Months with no transactions are skipped.',
    },
    {
      label: 'Income',
      value: usd(totals.income),
      sub: `avg ${avg(totals.income)} / month`,
    },
    {
      label: 'Savings rate',
      value: pct(totals.savingsRate),
      sub: totals.income > 0
        ? (net >= 0 ? `${usd(net)} kept` : `${usd(-net)} more spent than earned`)
        : 'No income in this range',
      tone: totals.savingsRate != null && totals.savingsRate < 0 ? 'over' : null,
    },
    vsBudget.months
      ? {
          label: `${years.length > 1 ? `${years[0]}–${years.at(-1)}` : years[0]} vs budget`,
          value: diff === 0 ? 'On budget' : `${diff > 0 ? '+' : '−'}${usd(Math.abs(diff))}`,
          sub: `${diff > 0 ? 'over in total' : diff < 0 ? 'under in total' : 'in total'} · ${overMonths} of ${vsBudget.months} months over`,
          tone: diff > 0 ? 'over' : diff < 0 ? 'under' : null,
          title: `${usd(vsBudget.actual)} spent against ${usd(vsBudget.budget)} budgeted, in months that have both.`,
        }
      : {
          label: 'vs budget',
          value: '—',
          sub: 'No budget in this range',
        },
  ]

  return (
    <div className="hist-tiles">
      {tiles.map((t) => <Tile key={t.label} {...t} />)}
    </div>
  )
}

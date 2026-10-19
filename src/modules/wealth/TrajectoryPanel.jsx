import { useMemo } from 'react'
import { scenarioLines, balanceAtAge } from '../../lib/wealth/projection.js'

const money = (n) =>
  n == null
    ? '—'
    : n >= 1e6
      ? `$${(n / 1e6).toFixed(2)}M`
      : `$${Math.round(n / 1000).toLocaleString('en-US')}k`
const full = (n) =>
  n == null
    ? '—'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }).format(n)
const COLORS = ['var(--accent)', '#d85a30', '#1d9e75', '#7f77dd', '#ba7517', '#d4537e', '#888780']
const W = 640,
  H = 230,
  L = 56,
  B = 24
const ts = (d) => new Date(`${d}T00:00:00Z`).getTime()

// Base and scenario lines for a plan that carries assumptions, a by-age table
// and the retirement target. Read-only: edits happen in the plan form.
export default function TrajectoryPanel({ plan }) {
  const lines = useMemo(() => scenarioLines(plan), [plan])
  if (!plan.assumptions || !lines.length) return null
  const a = plan.assumptions
  const target = Number(plan.retirement_target)
  const startYear = +plan.start_date.slice(0, 4)
  const retireDate = `${startYear + (a.retirement_age - a.current_age)}-12-31`
  const t0 = ts(plan.start_date),
    t1 = ts(lines[0].series.end_date)
  const max = Math.max(target * 1.1, ...lines.map((l) => l.series.monthly.at(-1).balance))
  const x = (d) => L + ((ts(d) - t0) / Math.max(1, t1 - t0)) * (W - L - 12)
  const y = (v) => H - B - (v / max) * (H - B - 12)
  const ages = [33, 40, 45, 50, 55, 60, 65].filter(
    (g) => g > a.current_age && g <= a.current_age + plan.horizon
  )
  const ageLabel = (g) => (g == null ? 'not by end of plan' : `age ${g}`)
  return (
    <div className="wealth-panel wealth-trajectory">
      <div className="wealth-kpis">
        <div>
          <span>Retire at {a.retirement_age} · target</span>
          <b>{full(target)}</b>
          <small>
            {a.withdrawal_multiple}x {full(a.retirement_spend)} today, inflated{' '}
            {(a.inflation * 100).toFixed(1)}%
          </small>
        </div>
        {lines.map((l) => (
          <div key={l.name}>
            <span>
              {l.name} · {(l.rate * 100).toFixed(2)}%
            </span>
            <b>{ageLabel(l.reachedAge)}</b>
          </div>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Projected investments for the base case and each scenario against the retirement target"
      >
        <line x1={L} y1={H - B} x2={W - 12} y2={H - B} stroke="var(--bd)" />
        <line
          x1={L}
          y1={y(target)}
          x2={W - 12}
          y2={y(target)}
          stroke="#ba7517"
          strokeDasharray="4 4"
        />
        <text x={L + 4} y={y(target) - 4} fontSize="11" fill="var(--tx-2)">
          Target {money(target)}
        </text>
        {retireDate <= lines[0].series.end_date && (
          <line
            x1={x(retireDate)}
            y1={12}
            x2={x(retireDate)}
            y2={H - B}
            stroke="var(--bd)"
            strokeDasharray="2 3"
          />
        )}
        {[0, 0.5, 1].map((f) => (
          <text key={f} x={4} y={y(max * f) + 4} fontSize="11" fill="var(--tx-2)">
            {money(max * f)}
          </text>
        ))}
        {[a.current_age, ...ages].map((g) => (
          <text
            key={g}
            x={x(`${startYear + (g - a.current_age)}-12-31`)}
            y={H - 6}
            fontSize="11"
            textAnchor="middle"
            fill="var(--tx-2)"
          >
            {g}
          </text>
        ))}
        {lines.map((l, i) => (
          <path
            key={l.name}
            d={l.series.monthly
              .map((p, j) => `${j ? 'L' : 'M'}${x(p.date)},${y(p.balance)}`)
              .join(' ')}
            stroke={COLORS[i % COLORS.length]}
            strokeWidth={l.base ? 2.5 : 1.5}
            fill="none"
          />
        ))}
      </svg>
      <div className="wealth-legend">
        {lines.map((l, i) => (
          <span key={l.name}>
            <i style={{ background: COLORS[i % COLORS.length] }} /> {l.name}
          </span>
        ))}
      </div>
      <h3>By age</h3>
      <div className="wealth-table-wrap">
        <table className="wealth-table">
          <thead>
            <tr>
              <th>Age</th>
              <th>Contributions / yr</th>
              {lines.map((l) => (
                <th key={l.name}>{l.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ages.map((g) => (
              <tr key={g}>
                <td>{g}</td>
                <td>{money(plan.annual_contributions?.[startYear + (g - a.current_age)])}</td>
                {lines.map((l) => (
                  <td key={l.name}>{money(balanceAtAge(plan, l, g))}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="wealth-muted">
        December balance at each age. Contributions are payroll 401(k) plus match and HSA, Roth IRA
        and taxable from surplus; the first year is prorated from the snapshot date.
      </p>
    </div>
  )
}

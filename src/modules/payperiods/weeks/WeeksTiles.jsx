import { MonoLabel, WHATIF, fmtDate, money } from './WeeksShared.jsx'

function Tile({ label, value, sub, valueColor, whatIf }) {
  return (
    <div style={{
      border: '1px solid var(--bd)', borderRadius: 11, background: 'var(--bg-card)',
      padding: '12px 14px', minWidth: 0,
    }}>
      <MonoLabel>{label}</MonoLabel>
      <div style={{
        fontFamily: "'DM Serif Display', serif", fontSize: 22, color: valueColor || 'var(--tx-1)',
        margin: '4px 0 2px', overflowWrap: 'anywhere',
      }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--tx-3)' }}>{sub}</div>}
      {whatIf && (
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: WHATIF, marginTop: 3 }}>
          what-if: {whatIf}
        </div>
      )}
    </div>
  )
}

// Tiles read the base series; an active what-if only adds a purple sub line.
export default function WeeksTiles({
  mobile, anchor, minBalance, today, staleDays, summary, overlaySummary,
}) {
  const has = !!anchor && summary.lowest != null
  const below = has && summary.belowCount > 0
  const moveNow = has && summary.moveBy && summary.moveBy.byDate < today
  const o = overlaySummary

  const tiles = [
    {
      label: 'TODAY',
      value: anchor ? money(Number(anchor.balance)) : '—',
      sub: anchor
        ? `as of ${fmtDate(anchor.as_of_date)}${staleDays > 14 ? ` · stale (${staleDays} days old)` : ''}`
        : 'Enter your checking balance + date to start',
      valueColor: anchor && staleDays > 14 ? 'var(--warn)' : undefined,
    },
    {
      label: 'LOWEST POINT AHEAD',
      value: has ? money(summary.lowest.amount) : '—',
      sub: has ? `week of ${fmtDate(summary.lowest.weekStart)}` : null,
      valueColor: below ? 'var(--bad)' : undefined,
      whatIf: o?.lowest ? money(o.lowest.amount) : null,
    },
    {
      label: 'WEEKS BELOW MIN',
      value: has ? `${summary.belowCount} of ${summary.weekCount}` : '—',
      sub: has ? `min ${money(minBalance)}` : null,
      valueColor: below ? 'var(--bad)' : undefined,
      whatIf: o?.belowCount != null ? `${o.belowCount} of ${o.weekCount}` : null,
    },
    {
      label: !has ? 'MOVE BY' : summary.moveBy ? (moveNow ? 'MOVE NOW' : `MOVE BY ${fmtDate(summary.moveBy.byDate).toUpperCase()}`) : 'MOVE BY',
      value: has && summary.moveBy ? money(summary.moveBy.amount) : '—',
      sub: has ? (summary.moveBy ? 'to stay above minimum' : 'Nothing to move') : null,
      valueColor: moveNow ? 'var(--bad)' : undefined,
      whatIf: o ? (o.moveBy ? money(o.moveBy.amount) : 'nothing to move') : null,
    },
  ]

  return (
    <div style={{
      display: 'grid', gap: 10,
      gridTemplateColumns: mobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))',
    }}>
      {tiles.map(t => <Tile key={t.label} {...t} />)}
    </div>
  )
}

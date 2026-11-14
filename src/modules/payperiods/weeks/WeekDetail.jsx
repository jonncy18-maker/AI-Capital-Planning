import { useState } from 'react'
import { formatMoney } from '../../../lib/money.js'
import { Badge, MonoLabel, WHATIF, fmtDate, money, money2, signedMoney } from './WeeksShared.jsx'

const isPositive = e => e.kind === 'income' || ((e.kind === 'oneoff' || e.kind === 'scenario') && e.direction === 'in')

function EventList({ events }) {
  if (events.length === 0) {
    return <MonoLabel style={{ padding: '4px 0' }}>NO EVENTS THIS WEEK</MonoLabel>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {events.map((e, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: 'var(--tx-3)', minWidth: 52 }}>
            {fmtDate(e.date)}
          </span>
          <span style={{ flex: 1, minWidth: 100, fontSize: 12, color: 'var(--tx-2)' }}>{e.label}</span>
          {e.unknownAmount && <Badge color="var(--warn)">AMOUNT UNKNOWN</Badge>}
          {e.manual && <Badge>MANUAL</Badge>}
          {e.whatIf && <Badge color={WHATIF}>WHAT-IF</Badge>}
          {e.kind === 'scenario' && <Badge>APPROX</Badge>}
          <span style={{
            fontFamily: "'DM Mono', monospace", fontSize: 11,
            color: isPositive(e) ? 'var(--accent)' : 'var(--tx-1)',
          }}>
            {e.unknownAmount ? '—' : `${isPositive(e) ? '+' : '−'}${formatMoney(e.amount)}`}
          </span>
        </div>
      ))}
    </div>
  )
}

function Cell({ label, value, color, mobile }) {
  return (
    <div style={{ minWidth: 0 }}>
      {mobile && <MonoLabel style={{ fontSize: 8.5 }}>{label}</MonoLabel>}
      <div style={{
        fontFamily: "'DM Mono', monospace", fontSize: 12, color: color || 'var(--tx-1)',
        whiteSpace: 'nowrap',
      }}>{value}</div>
    </div>
  )
}

const gridCols = showSpend => (showSpend
  ? 'minmax(90px,1fr) repeat(4, minmax(70px,1fr)) minmax(90px,1fr) minmax(110px,1fr)'
  : 'minmax(90px,1fr) repeat(3, minmax(70px,1fr)) minmax(90px,1fr) minmax(110px,1fr)')

export function WeekRow({ week, hasAnchor, showSpend, mobile, open, onToggle, overlayWeek }) {
  const flagged = week.belowMin
  const low = hasAnchor ? `${money(week.low)} · ${fmtDate(week.lowDate)}` : '—'
  const cells = [
    { label: 'INCOME', value: week.income ? signedMoney(week.income) : '—', color: week.income ? 'var(--accent)' : undefined },
    { label: 'BILLS', value: money(week.bills) },
    { label: 'CARDS', value: money(week.cardPayments) },
    ...(showSpend ? [{ label: 'SPEND', value: money(week.spend) }] : []),
    { label: 'CLOSING', value: money(week.closing), color: week.negative ? 'var(--warn)' : undefined },
    { label: 'LOW POINT', value: low },
  ]
  const overlayEvents = overlayWeek ? overlayWeek.events.filter(e => e.whatIf) : []
  return (
    <div style={{
      border: '1px solid var(--bd)', borderLeft: flagged ? '4px solid var(--warn)' : '1px solid var(--bd)',
      borderRadius: 10, background: 'var(--bg-card)', padding: mobile ? '10px 12px' : '10px 14px',
    }}>
      <button
        type="button" onClick={onToggle} aria-expanded={open}
        style={{
          all: 'unset', cursor: 'pointer', display: 'block', width: '100%', boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: mobile ? 8 : 0 }}>
          <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: 15, color: 'var(--tx-1)' }}>
            {fmtDate(week.start, true)}
          </span>
          {week.negative && <Badge color="var(--warn)">OVERDRAWN</Badge>}
          {!week.negative && flagged && <Badge color="var(--warn)">BELOW MIN</Badge>}
          <span style={{ marginLeft: 'auto', color: 'var(--tx-3)', fontSize: 11 }}>{open ? '▾' : '▸'}</span>
        </div>
        <div style={mobile
          ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }
          : { display: 'grid', gridTemplateColumns: gridCols(showSpend), gap: 12, alignItems: 'center', marginTop: 6 }}
        >
          {cells.map(c => <Cell key={c.label} mobile={mobile} {...c} />)}
        </div>
      </button>
      {overlayWeek && (
        <div style={{ marginTop: 8, fontFamily: "'DM Mono', monospace", fontSize: 11, color: WHATIF }}>
          What-if: closing {money(overlayWeek.closing)} · low {money(overlayWeek.low)}
        </div>
      )}
      {open && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--bd)' }}>
          <EventList events={week.events} />
          {overlayEvents.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <MonoLabel style={{ color: WHATIF, marginBottom: 5 }}>WHAT-IF EVENTS THIS WEEK</MonoLabel>
              <EventList events={overlayEvents} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function HistoryWeek({ point, mobile }) {
  const stat = (label, value, color) => (
    <div style={{ minWidth: 0 }}>
      <MonoLabel style={{ fontSize: 8.5 }}>{label}</MonoLabel>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: color || 'var(--tx-1)' }}>{value}</div>
    </div>
  )
  return (
    <div style={{
      border: '1px solid var(--bd)', borderRadius: 10, background: 'var(--bg-card)',
      padding: mobile ? '10px 12px' : '12px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: 15, color: 'var(--tx-1)' }}>
          {fmtDate(point.weekStart, true)}
        </span>
        <Badge>ACTUAL · from transactions</Badge>
        {(point.approximate || point.netApproximate) && <Badge color="var(--warn)">APPROXIMATE</Badge>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '8px 12px' }}>
        {stat('INFLOW', point.inflow == null ? '—' : signedMoney(point.inflow), point.inflow ? 'var(--accent)' : undefined)}
        {stat('OUTFLOW', point.outflow == null ? '—' : money2(point.outflow))}
        {stat('NET', point.net == null ? '—' : signedMoney(point.net))}
        {stat('END BALANCE', point.gap ? '—' : money2(point.balance))}
      </div>
      {point.gap && (
        <div style={{ color: 'var(--tx-3)', fontSize: 12, marginTop: 8 }}>{point.gapReason}</div>
      )}
      {point.net == null && point.netGapReason && (
        <div style={{ color: 'var(--tx-3)', fontSize: 12, marginTop: 4 }}>{point.netGapReason}</div>
      )}
      {[...point.approxReasons].map(r => (
        <div key={r} style={{ color: 'var(--warn)', fontSize: 12, marginTop: 4 }}>{r}</div>
      ))}
      {point.transactions.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--bd)', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {point.transactions.map((t, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: 'var(--tx-3)', minWidth: 52 }}>
                {fmtDate(t.date)}
              </span>
              <span style={{ flex: 1, minWidth: 100, fontSize: 12, color: 'var(--tx-2)' }}>{t.merchant || '—'}</span>
              <span style={{
                fontFamily: "'DM Mono', monospace", fontSize: 11,
                color: t.amount > 0 ? 'var(--accent)' : 'var(--tx-1)',
              }}>{signedMoney(t.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const navBtn = {
  fontFamily: "'DM Mono', monospace", fontSize: 14, color: 'var(--tx-2)', background: 'var(--bg-card)',
  border: '1px solid var(--bd)', borderRadius: 6, padding: '2px 10px', cursor: 'pointer',
}

export default function WeekDetail({
  selected, minIndex, maxIndex, onSelect, series, overlay, history, showSpend, mobile,
}) {
  const [showAll, setShowAll] = useState(false)
  const [openRow, setOpenRow] = useState(null)
  const projection = selected >= 0 ? series.weeks[selected] : null
  const point = selected < 0 ? history?.points.find(p => p.index === selected) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" aria-label="Previous week" style={navBtn} disabled={selected <= minIndex} onClick={() => onSelect(selected - 1)}>‹</button>
        <MonoLabel>{selected < 0 ? 'ACTUAL WEEK' : 'PROJECTED WEEK'}</MonoLabel>
        <button type="button" aria-label="Next week" style={navBtn} disabled={selected >= maxIndex} onClick={() => onSelect(selected + 1)}>›</button>
      </div>

      {projection && (
        <WeekRow
          week={projection} hasAnchor={series.hasAnchor} showSpend={showSpend} mobile={mobile}
          open onToggle={() => {}} overlayWeek={overlay ? overlay.weeks[projection.index] : null}
        />
      )}
      {point && <HistoryWeek point={point} mobile={mobile} />}

      <div>
        <button
          type="button" aria-expanded={showAll} onClick={() => setShowAll(v => !v)}
          style={{ ...navBtn, fontSize: 11, letterSpacing: '0.06em' }}
        >{showAll ? '▾' : '▸'} Show all weeks</button>
      </div>
      {showAll && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!mobile && (
            <div style={{ display: 'grid', gap: 12, padding: '0 14px', gridTemplateColumns: gridCols(showSpend) }}>
              {['WEEK OF', 'INCOME', 'BILLS', 'CARDS', ...(showSpend ? ['SPEND'] : []), 'CLOSING', 'LOW POINT']
                .map(h => <MonoLabel key={h}>{h}</MonoLabel>)}
            </div>
          )}
          {series.weeks.map(w => (
            <WeekRow
              key={w.index} week={w} hasAnchor={series.hasAnchor} showSpend={showSpend} mobile={mobile}
              open={openRow === w.index} onToggle={() => setOpenRow(openRow === w.index ? null : w.index)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

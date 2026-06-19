import { useState, useMemo, useEffect } from 'react'
import { spendByCategoryForGroup } from '../../lib/dashboard/widgetData.js'

const MONO = "'DM Mono', monospace"
const SERIF = "'DM Serif Display', serif"
const THRESHOLD = 0.10

function fmtK(n) {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M'
  if (abs >= 1000) return '$' + Math.round(n / 1000) + 'k'
  return '$' + Math.round(n || 0)
}
function fmtMoney(n) { return '$' + Math.round(n || 0).toLocaleString() }

function getStatus(spending, budget) {
  if (!budget) return 'none'
  const ratio = spending / budget
  if (ratio > 1 + THRESHOLD) return 'over'
  if (ratio < 1 - THRESHOLD) return 'under'
  return 'onTrack'
}

const STATUS = {
  over:    { color: 'var(--warn)' },
  under:   { color: 'var(--accent)' },
  onTrack: { color: 'var(--green)' },
  none:    { color: 'var(--tx-2)' },
}

function TRow({ label, value, color, bold, border }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: 16,
      fontFamily: MONO, fontSize: 10.5, lineHeight: 1.9,
      fontWeight: bold ? 600 : 400,
      borderTop: border ? '1px solid var(--bd)' : 'none',
      marginTop: border ? 4 : 0, paddingTop: border ? 4 : 0,
    }}>
      <span style={{ color: 'var(--tx-3)' }}>{label}</span>
      <span style={{ color: color || 'var(--tx-2)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

function CatBar({ row, isYtd, max }) {
  const [hovered, setHovered] = useState(false)

  const spending = isYtd ? row.actual : row.projected
  const budget = isYtd ? row.ytdBudget : row.fullBudget
  const status = getStatus(spending, budget)
  const actualColor = STATUS[status].color

  const actualPct = max > 0 ? Math.min((row.actual / max) * 100, 100) : 0
  const forecastPct = max > 0 ? Math.min((row.forecast / max) * 100, 100 - actualPct) : 0
  const budgetPct = max > 0 ? Math.min((budget / max) * 100, 100) : 0

  const delta = budget > 0 ? spending - budget : null
  const deltaPct = budget > 0 ? ((spending / budget) - 1) * 100 : null

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: 'relative', padding: '10px 0', borderBottom: '1px solid var(--bd-light)', cursor: 'default' }}
    >
      {/* Row header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 7 }}>
        <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--tx-2)' }}>{row.category}</span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontFamily: MONO, fontSize: 12, color: actualColor, fontVariantNumeric: 'tabular-nums' }}>
            {fmtK(spending)}
          </span>
          {budget > 0 && (
            <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--tx-3)' }}>/ {fmtK(budget)}</span>
          )}
          {deltaPct != null && (
            <span style={{
              fontFamily: MONO, fontSize: 8.5,
              color: delta > 0 ? 'var(--warn)' : 'var(--accent)',
              padding: '1px 5px',
              background: delta > 0 ? 'var(--warn-bg)' : 'var(--accent-bg)',
              borderRadius: 3,
            }}>
              {delta > 0 ? '+' : ''}{Math.round(deltaPct)}%
            </span>
          )}
        </div>
      </div>

      {/* Top bar: actual + forecast */}
      <div style={{ height: 8, background: 'var(--bd-light)', borderRadius: 4, overflow: 'hidden', marginBottom: 3 }}>
        <div style={{ display: 'flex', height: '100%' }}>
          <div style={{ width: `${actualPct}%`, background: actualColor, transition: 'width 0.3s ease' }} />
          {!isYtd && forecastPct > 0 && (
            <div style={{ width: `${forecastPct}%`, background: 'var(--forecast-bd)', transition: 'width 0.3s ease' }} />
          )}
        </div>
      </div>

      {/* Budget reference bar */}
      {budget > 0 && (
        <div style={{ height: 3, background: 'var(--bd-light)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${budgetPct}%`, height: '100%', background: 'var(--bar-budget)', borderRadius: 2, transition: 'width 0.3s ease' }} />
        </div>
      )}

      {/* Hover tooltip */}
      {hovered && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: 0,
          background: 'var(--bg-app)', border: '1px solid var(--bd)',
          borderRadius: 9, padding: '10px 12px', minWidth: 210, zIndex: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.45)', pointerEvents: 'none',
          whiteSpace: 'nowrap',
        }}>
          <div style={{ fontFamily: MONO, fontSize: 8.5, color: 'var(--tx-3)', letterSpacing: '0.06em', marginBottom: 7 }}>
            {row.category.toUpperCase()}
          </div>
          <TRow label="Actual YTD" value={fmtMoney(row.actual)} color="var(--tx-1)" />
          {!isYtd && row.forecast > 0 && (
            <TRow label="Forecast (rest)" value={fmtMoney(row.forecast)} color="var(--forecast-bd)" />
          )}
          <TRow label={isYtd ? 'YTD Total' : 'Act + Fcst'} value={fmtMoney(spending)} bold border />
          {budget > 0 && (
            <TRow label={isYtd ? 'YTD Budget' : 'Annual Budget'} value={fmtMoney(budget)} color="var(--bar-budget-tx)" border />
          )}
          {delta != null && (
            <TRow
              label="vs. budget"
              value={(delta > 0 ? '+' : '') + fmtMoney(delta)}
              color={delta > 0 ? 'var(--warn)' : 'var(--accent)'}
            />
          )}
        </div>
      )}
    </div>
  )
}

const SORTS = [
  { key: 'spend',    label: 'By Spend' },
  { key: 'variance', label: 'By Variance' },
  { key: 'name',     label: 'A–Z' },
]

function sortRows(rows, sortKey, isYtd) {
  const copy = [...rows]
  if (sortKey === 'spend') {
    copy.sort((a, b) => (isYtd ? b.actual - a.actual : b.projected - a.projected))
  } else if (sortKey === 'variance') {
    const pct = r => {
      const budget = isYtd ? r.ytdBudget : r.fullBudget
      return budget > 0 ? (isYtd ? r.actual : r.projected) / budget - 1 : -Infinity
    }
    copy.sort((a, b) => pct(b) - pct(a))
  } else {
    copy.sort((a, b) => a.category.localeCompare(b.category))
  }
  return copy
}

function Pill({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.05em',
        padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
        background: active ? 'var(--accent-bg)' : 'transparent',
        border: `1px solid ${active ? 'var(--accent-bd)' : 'var(--bd)'}`,
        color: active ? 'var(--accent)' : 'var(--tx-3)',
      }}
    >{children}</button>
  )
}

function SortPill({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: MONO, fontSize: 8.5, letterSpacing: '0.04em',
        padding: '4px 9px', borderRadius: 5, cursor: 'pointer',
        background: active ? 'var(--bg-app)' : 'transparent',
        border: `1px solid ${active ? 'var(--bd)' : 'transparent'}`,
        color: active ? 'var(--tx-2)' : 'var(--tx-3)',
      }}
    >{children}</button>
  )
}

export default function SpendGroupDetail({ group, ctx, yearTxns, onClose }) {
  const [filter, setFilter] = useState('FULL YEAR')
  const [sortKey, setSortKey] = useState('spend')

  const isYtd = filter === 'YTD'

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const { rows: rawRows } = useMemo(
    () => spendByCategoryForGroup(ctx, yearTxns, group),
    [ctx, yearTxns, group]
  )

  const rows = useMemo(() => sortRows(rawRows, sortKey, isYtd), [rawRows, sortKey, isYtd])

  const displayMax = useMemo(
    () => rows.reduce((m, r) => Math.max(m, isYtd ? Math.max(r.actual, r.ytdBudget) : Math.max(r.projected, r.fullBudget)), 1),
    [rows, isYtd]
  )

  const hasBudget = rows.some(r => r.fullBudget > 0)

  const totals = useMemo(() => rows.reduce(
    (acc, r) => ({ actual: acc.actual + r.actual, forecast: acc.forecast + r.forecast, projected: acc.projected + r.projected, fullBudget: acc.fullBudget + r.fullBudget, ytdBudget: acc.ytdBudget + r.ytdBudget }),
    { actual: 0, forecast: 0, projected: 0, fullBudget: 0, ytdBudget: 0 }
  ), [rows])

  const totalSpend = isYtd ? totals.actual : totals.projected
  const totalBudget = isYtd ? totals.ytdBudget : totals.fullBudget
  const totalStatus = getStatus(totalSpend, totalBudget)
  const totalDelta = totalBudget > 0 ? totalSpend - totalBudget : null
  const totalDeltaPct = totalBudget > 0 ? ((totalSpend / totalBudget) - 1) * 100 : null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 80,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '40px 20px', overflowY: 'auto',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)', border: '1px solid var(--bd)',
          borderRadius: 16, padding: 28, width: '100%', maxWidth: 760,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)', marginBottom: 40,
        }}
      >
        {/* ── Header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: '0.06em', color: 'var(--tx-3)', marginBottom: 4 }}>
              SPEND BY CATEGORY
            </div>
            <div style={{ fontFamily: SERIF, fontSize: 24, color: 'var(--tx-1)', lineHeight: 1.1 }}>
              {group}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: '1px solid var(--bd)', borderRadius: 8,
              color: 'var(--tx-2)', fontSize: 18, width: 32, height: 32,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', lineHeight: 1, flexShrink: 0,
            }}
          >×</button>
        </div>

        {/* ── Group summary totals ── */}
        <div style={{
          display: 'flex', gap: 0, padding: '14px 16px',
          background: 'var(--bg-app)', borderRadius: 10,
          border: '1px solid var(--bd)', marginBottom: 20,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: MONO, fontSize: 20, color: STATUS[totalStatus].color, lineHeight: 1 }}>
              {fmtK(totalSpend)}
            </div>
            <div style={{ fontFamily: MONO, fontSize: 8, color: 'var(--tx-3)', letterSpacing: '0.06em', marginTop: 5 }}>
              {isYtd ? 'YTD TOTAL' : 'FULL YEAR · ACT+FCST'}
            </div>
          </div>
          {totalBudget > 0 && (
            <>
              <div style={{ width: 1, background: 'var(--bd)', margin: '0 16px' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: MONO, fontSize: 20, color: 'var(--bar-budget-tx)', lineHeight: 1 }}>
                  {fmtK(totalBudget)}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 8, color: 'var(--tx-3)', letterSpacing: '0.06em', marginTop: 5 }}>
                  {isYtd ? 'YTD BUDGET' : 'ANNUAL BUDGET'}
                </div>
              </div>
              <div style={{ width: 1, background: 'var(--bd)', margin: '0 16px' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: MONO, fontSize: 20, color: totalDelta > 0 ? 'var(--warn)' : 'var(--accent)', lineHeight: 1 }}>
                  {totalDelta > 0 ? '+' : ''}{fmtK(totalDelta)}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 8, color: 'var(--tx-3)', letterSpacing: '0.06em', marginTop: 5 }}>
                  VS. BUDGET {totalDeltaPct != null && `(${totalDelta > 0 ? '+' : ''}${Math.round(totalDeltaPct)}%)`}
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Controls: filter + sort ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <Pill active={filter === 'FULL YEAR'} onClick={() => setFilter('FULL YEAR')}>FULL YEAR · ACT+FCST</Pill>
            <Pill active={filter === 'YTD'} onClick={() => setFilter('YTD')}>YEAR TO DATE</Pill>
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontFamily: MONO, fontSize: 8.5, color: 'var(--tx-4)', marginRight: 2 }}>SORT</span>
            {SORTS.map(s => (
              <SortPill key={s.key} active={sortKey === s.key} onClick={() => setSortKey(s.key)}>
                {s.label}
              </SortPill>
            ))}
          </div>
        </div>

        {/* ── Category rows ── */}
        {rows.length === 0 ? (
          <div style={{ fontFamily: MONO, fontSize: 12, color: 'var(--tx-3)', padding: '24px 0' }}>
            No spending data for this group.
          </div>
        ) : rows.map(r => (
          <CatBar key={r.category} row={r} isYtd={isYtd} max={displayMax} />
        ))}

        {/* ── Legend ── */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '6px 16px',
          marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--bd-light)',
        }}>
          {[
            { color: 'var(--green)',       label: 'On track (within 10%)', line: false },
            { color: 'var(--accent)',      label: 'Under budget (>10%)',   line: false },
            { color: 'var(--warn)',        label: 'Over budget (>10%)',    line: false },
            { color: 'var(--forecast-bd)', label: 'Forecast',              line: false },
            ...(hasBudget ? [{ color: 'var(--bar-budget)', label: 'Budget', line: true }] : []),
          ].map(item => (
            <span key={item.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {item.line
                ? <span style={{ width: 18, height: 3, background: item.color, display: 'inline-block', borderRadius: 2 }} />
                : <span style={{ width: 9, height: 9, borderRadius: 2, background: item.color, display: 'inline-block' }} />
              }
              <span style={{ fontFamily: MONO, fontSize: 9, color: 'var(--tx-3)' }}>{item.label}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

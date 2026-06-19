import { useState, useMemo, useEffect, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { spendByCategoryForGroup } from '../../lib/dashboard/widgetData.js'

const MONO = "'DM Mono', monospace"
const SERIF = "'DM Serif Display', serif"
const THRESHOLD = 0.10
const MONTH_LABELS = ['J','F','M','A','M','J','J','A','S','O','N','D']

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

function GroupMonthlyChart({ monthlyActual, monthlyBudget, currentMonth }) {
  const maxBar = Math.max(...monthlyActual, ...monthlyBudget, 1)
  const BAR_H = 50

  return (
    <div style={{
      padding: '14px 16px', background: 'var(--bg-app)',
      borderRadius: 10, border: '1px solid var(--bd)', marginBottom: 20,
    }}>
      <div style={{ fontFamily: MONO, fontSize: 8, color: 'var(--tx-4)', letterSpacing: '0.06em', marginBottom: 10 }}>
        MONTHLY GROUP TREND
      </div>
      <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end' }}>
        {Array.from({ length: 12 }, (_, m) => {
          const actual = monthlyActual[m] || 0
          const budget = monthlyBudget[m] || 0
          const isFuture = m > currentMonth
          const isCurrent = m === currentMonth
          const barVal = isFuture ? budget : actual
          const status = getStatus(actual, budget)
          const barColor = isFuture ? 'var(--tx-4)' : STATUS[status].color
          const barH = maxBar > 0 ? Math.max(Math.round((barVal / maxBar) * BAR_H), barVal > 0 ? 1 : 0) : 0
          const budgetH = maxBar > 0 && budget > 0 ? Math.max(Math.round((budget / maxBar) * BAR_H), 1) : 0

          return (
            <div key={m} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <div style={{ width: '100%', height: BAR_H, position: 'relative', display: 'flex', alignItems: 'flex-end' }}>
                {budgetH > 0 && (
                  <div style={{
                    position: 'absolute', left: 0, right: 0, bottom: budgetH - 1,
                    height: 1, background: 'var(--bar-budget)', opacity: 0.8,
                  }} />
                )}
                {barH > 0 && (
                  <div style={{
                    width: '100%', height: barH,
                    background: barColor,
                    opacity: isFuture ? 0.3 : 1,
                    borderRadius: '2px 2px 0 0',
                  }} />
                )}
              </div>
              <div style={{
                fontFamily: MONO, fontSize: 7,
                color: isCurrent ? 'var(--tx-2)' : 'var(--tx-4)',
                lineHeight: 1,
              }}>
                {MONTH_LABELS[m]}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TopMerchants({ category, yearTxns }) {
  const merchants = useMemo(() => {
    const totals = {}
    for (const t of yearTxns || []) {
      if (t.category !== category || Number(t.amount) >= 0) continue
      const name = t.merchant_name || t.name || t.description || '—'
      totals[name] = (totals[name] || 0) + Math.abs(Number(t.amount))
    }
    return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 3)
  }, [category, yearTxns])

  if (!merchants.length) return null

  return (
    <div style={{ paddingBottom: 12, marginBottom: 2, borderBottom: '1px solid var(--bd-light)' }}>
      <div style={{ fontFamily: MONO, fontSize: 8, color: 'var(--tx-4)', letterSpacing: '0.06em', marginBottom: 8 }}>
        TOP MERCHANTS
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {merchants.map(([name, amt]) => (
          <div key={name} style={{
            background: 'var(--bg-card)', border: '1px solid var(--bd)',
            borderRadius: 6, padding: '6px 10px',
          }}>
            <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--tx-1)', fontVariantNumeric: 'tabular-nums' }}>
              {fmtK(amt)}
            </div>
            <div style={{
              fontFamily: MONO, fontSize: 8.5, color: 'var(--tx-3)', marginTop: 2,
              maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {name}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function MonthSparkline({ row, currentMonth }) {
  const { monthlyActual = [], monthlyBudget = [] } = row
  const maxBar = Math.max(...monthlyActual, ...monthlyBudget, 1)
  const BAR_H = 44

  return (
    <div>
      <div style={{ fontFamily: MONO, fontSize: 8, color: 'var(--tx-4)', letterSpacing: '0.06em', marginBottom: 8 }}>
        MONTHLY TREND
      </div>
      <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}>
        {Array.from({ length: 12 }, (_, m) => {
          const actual = monthlyActual[m] || 0
          const budget = monthlyBudget[m] || 0
          const isFuture = m > currentMonth
          const isCurrent = m === currentMonth
          const status = getStatus(actual, budget)
          const barVal = isFuture ? budget : actual
          const barH = maxBar > 0 ? Math.max(Math.round((barVal / maxBar) * BAR_H), barVal > 0 ? 1 : 0) : 0
          const budgetH = maxBar > 0 && budget > 0 ? Math.max(Math.round((budget / maxBar) * BAR_H), 1) : 0
          const barColor = isFuture ? 'var(--tx-4)' : STATUS[status].color

          return (
            <div key={m} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <div style={{ width: '100%', height: BAR_H, position: 'relative', display: 'flex', alignItems: 'flex-end' }}>
                {budgetH > 0 && (
                  <div style={{
                    position: 'absolute', left: 0, right: 0, bottom: budgetH - 1,
                    height: 1, background: 'var(--bar-budget)', opacity: 0.8,
                  }} />
                )}
                {barH > 0 && (
                  <div style={{
                    width: '100%', height: barH,
                    background: barColor,
                    opacity: isFuture ? 0.3 : 1,
                    borderRadius: '2px 2px 0 0',
                  }} />
                )}
              </div>
              <div style={{
                fontFamily: MONO, fontSize: 7,
                color: isCurrent ? 'var(--tx-2)' : 'var(--tx-4)',
                lineHeight: 1,
              }}>
                {MONTH_LABELS[m]}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TransactionList({ category, yearTxns }) {
  const [showAll, setShowAll] = useState(false)
  const INITIAL = 8

  const txns = useMemo(() => {
    return (yearTxns || [])
      .filter(t => t.category === category && Number(t.amount) < 0)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
  }, [category, yearTxns])

  if (txns.length === 0) return (
    <div style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--tx-4)', paddingTop: 12 }}>
      No transactions found.
    </div>
  )

  const visible = showAll ? txns : txns.slice(0, INITIAL)
  const hidden = txns.length - INITIAL

  return (
    <div style={{ paddingTop: 14 }}>
      <div style={{ fontFamily: MONO, fontSize: 8, color: 'var(--tx-4)', letterSpacing: '0.06em', marginBottom: 8 }}>
        TRANSACTIONS
      </div>
      {visible.map((t, i) => {
        const d = new Date(t.date)
        const dateStr = Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        const name = t.merchant_name || t.name || t.description || '—'
        const amt = Math.abs(Number(t.amount))
        return (
          <div key={t.id || i} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '5px 0', borderBottom: '1px solid var(--bd-light)',
          }}>
            <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--tx-3)', minWidth: 46, flexShrink: 0 }}>
              {dateStr}
            </span>
            <span style={{
              fontFamily: MONO, fontSize: 10, color: 'var(--tx-2)',
              flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {name}
            </span>
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--tx-1)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
              ${amt % 1 === 0 ? Math.round(amt).toLocaleString() : amt.toFixed(2)}
            </span>
          </div>
        )
      })}
      {!showAll && hidden > 0 && (
        <button
          onClick={e => { e.stopPropagation(); setShowAll(true) }}
          style={{
            marginTop: 8, fontFamily: MONO, fontSize: 9, color: 'var(--accent)',
            background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
          }}
        >
          Show {hidden} more
        </button>
      )}
    </div>
  )
}

function CatBar({ row, isYtd, isPriorYear, priorActual, max, isExpanded, onToggle }) {
  const [hovered, setHovered] = useState(false)

  let spending, budget, actualColor, delta, deltaPct, priorRefPct

  if (isPriorYear) {
    spending = row.projected
    const comparison = priorActual || 0
    if (comparison > 0) {
      const ratio = spending / comparison
      actualColor = ratio > 1 + THRESHOLD ? 'var(--warn)' : ratio < 1 - THRESHOLD ? 'var(--accent)' : 'var(--green)'
      delta = spending - comparison
      deltaPct = (ratio - 1) * 100
    } else {
      actualColor = 'var(--tx-2)'
    }
    priorRefPct = comparison > 0 && max > 0 ? Math.min((comparison / max) * 100, 100) : 0
    budget = null
  } else {
    spending = isYtd ? row.actual : row.projected
    budget = isYtd ? row.ytdBudget : row.fullBudget
    actualColor = STATUS[getStatus(spending, budget)].color
    delta = budget > 0 ? spending - budget : null
    deltaPct = budget > 0 ? ((spending / budget) - 1) * 100 : null
    priorRefPct = 0
  }

  const actualPct = max > 0 ? Math.min((row.actual / max) * 100, 100) : 0
  const forecastPct = !isYtd && max > 0
    ? Math.min((row.forecast / max) * 100, 100 - actualPct) : 0
  const budgetPct = !isPriorYear && budget > 0 && max > 0
    ? Math.min((budget / max) * 100, 100) : 0

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onToggle}
      style={{
        position: 'relative', padding: '10px 0',
        borderBottom: isExpanded ? 'none' : '1px solid var(--bd-light)',
        cursor: 'pointer',
      }}
    >
      {/* Row header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 7 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: MONO, fontSize: 9, color: 'var(--tx-4)', lineHeight: 1, userSelect: 'none' }}>
            {isExpanded ? '▾' : '▸'}
          </span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--tx-2)' }}>{row.category}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontFamily: MONO, fontSize: 12, color: actualColor, fontVariantNumeric: 'tabular-nums' }}>
            {fmtK(spending)}
          </span>
          {isPriorYear && priorActual > 0 && (
            <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--tx-3)' }}>vs {fmtK(priorActual)}</span>
          )}
          {!isPriorYear && budget > 0 && (
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

      {/* Actual + forecast bar */}
      <div style={{ height: 8, background: 'var(--bd-light)', borderRadius: 4, overflow: 'hidden', marginBottom: 3 }}>
        <div style={{ display: 'flex', height: '100%' }}>
          <div style={{ width: `${actualPct}%`, background: actualColor, transition: 'width 0.3s ease' }} />
          {forecastPct > 0 && (
            <div style={{ width: `${forecastPct}%`, background: 'var(--forecast-bd)', transition: 'width 0.3s ease' }} />
          )}
        </div>
      </div>

      {/* Reference bar: budget or prior year */}
      {(isPriorYear ? priorRefPct > 0 : budget > 0) && (
        <div style={{ height: 3, background: 'var(--bd-light)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{
            width: `${isPriorYear ? priorRefPct : budgetPct}%`, height: '100%',
            background: isPriorYear ? 'var(--tx-3)' : 'var(--bar-budget)',
            opacity: isPriorYear ? 0.45 : 1,
            borderRadius: 2, transition: 'width 0.3s ease',
          }} />
        </div>
      )}

      {/* Hover tooltip */}
      {hovered && !isExpanded && (
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
          {isPriorYear ? (
            <>
              <TRow label="This Year (Act+Fcst)" value={fmtMoney(row.projected)} color="var(--tx-1)" />
              <TRow label="Last Year (Full)" value={fmtMoney(priorActual || 0)} color="var(--tx-3)" border />
              {delta != null && (
                <TRow
                  label="YoY change"
                  value={`${delta > 0 ? '+' : ''}${fmtMoney(delta)} (${delta > 0 ? '+' : ''}${Math.round(deltaPct)}%)`}
                  color={delta > 0 ? 'var(--warn)' : 'var(--accent)'}
                />
              )}
            </>
          ) : (
            <>
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
                  value={`${delta > 0 ? '+' : ''}${fmtMoney(delta)}`}
                  color={delta > 0 ? 'var(--warn)' : 'var(--accent)'}
                />
              )}
            </>
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

function sortRows(rows, sortKey, isYtd, isPriorYear, priorActualByCat = {}) {
  const copy = [...rows]
  if (sortKey === 'spend') {
    copy.sort((a, b) => (isYtd ? b.actual - a.actual : b.projected - a.projected))
  } else if (sortKey === 'variance') {
    if (isPriorYear) {
      const yoy = r => {
        const prior = priorActualByCat[r.category] || 0
        if (prior === 0) return r.projected > 0 ? Infinity : -Infinity
        return r.projected / prior - 1
      }
      copy.sort((a, b) => {
        const ya = yoy(a), yb = yoy(b)
        if (!isFinite(ya) && !isFinite(yb)) return 0
        if (!isFinite(ya)) return -1
        if (!isFinite(yb)) return 1
        return yb - ya
      })
    } else {
      const pct = r => {
        const budget = isYtd ? r.ytdBudget : r.fullBudget
        return budget > 0 ? (isYtd ? r.actual : r.projected) / budget - 1 : -Infinity
      }
      copy.sort((a, b) => pct(b) - pct(a))
    }
  } else {
    copy.sort((a, b) => a.category.localeCompare(b.category))
  }
  return copy
}

function Pill({ active, onClick, children, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: MONO, fontSize: 9.5, letterSpacing: '0.05em',
        padding: '5px 12px', borderRadius: 6,
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: active ? 'var(--accent-bg)' : 'transparent',
        border: `1px solid ${active ? 'var(--accent-bd)' : 'var(--bd)'}`,
        color: active ? 'var(--accent)' : disabled ? 'var(--tx-4)' : 'var(--tx-3)',
        opacity: disabled ? 0.5 : 1,
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

export default function SpendGroupDetail({ group, ctx, yearTxns, priorYearTxns, onClose }) {
  const [filter, setFilter] = useState('FULL YEAR')
  const [sortKey, setSortKey] = useState('spend')
  const [expandedCat, setExpandedCat] = useState(null)

  const isYtd = filter === 'YTD'
  const isPriorYear = filter === 'PRIOR YEAR'

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const { rows: rawRows, currentMonth, groupMonthlyActual, groupMonthlyBudget } = useMemo(
    () => spendByCategoryForGroup(ctx, yearTxns, group),
    [ctx, yearTxns, group]
  )

  // Prior year full-year actuals by category (all 12 months)
  const priorActualByCat = useMemo(() => {
    if (!priorYearTxns?.length) return {}
    const res = {}
    for (const t of priorYearTxns) {
      const amt = Number(t.amount) || 0
      if (amt >= 0) continue
      if ((t.group || 'Uncategorized') !== group) continue
      const d = new Date(t.date)
      if (Number.isNaN(d.getTime())) continue
      res[t.category] = (res[t.category] || 0) + Math.abs(amt)
    }
    return res
  }, [priorYearTxns, group])

  const hasPriorYear = Object.keys(priorActualByCat).length > 0

  const rows = useMemo(
    () => sortRows(rawRows, sortKey, isYtd, isPriorYear, priorActualByCat),
    [rawRows, sortKey, isYtd, isPriorYear, priorActualByCat]
  )

  const displayMax = useMemo(() => {
    if (isPriorYear) {
      return rows.reduce((m, r) => Math.max(m, r.projected, priorActualByCat[r.category] || 0), 1)
    }
    return rows.reduce(
      (m, r) => Math.max(m, isYtd ? Math.max(r.actual, r.ytdBudget) : Math.max(r.projected, r.fullBudget)),
      1
    )
  }, [rows, isYtd, isPriorYear, priorActualByCat])

  const hasBudget = rows.some(r => r.fullBudget > 0)

  const totals = useMemo(() => rows.reduce(
    (acc, r) => ({
      actual: acc.actual + r.actual, forecast: acc.forecast + r.forecast,
      projected: acc.projected + r.projected, fullBudget: acc.fullBudget + r.fullBudget,
      ytdBudget: acc.ytdBudget + r.ytdBudget,
    }),
    { actual: 0, forecast: 0, projected: 0, fullBudget: 0, ytdBudget: 0 }
  ), [rows])

  const priorGroupTotal = useMemo(
    () => Object.values(priorActualByCat).reduce((a, b) => a + b, 0),
    [priorActualByCat]
  )

  // Summary panel derived values
  let totalSpend, totalComparison, totalDelta, totalDeltaPct, totalStatus, comparisonLabel, spendLabel

  if (isPriorYear) {
    totalSpend = totals.projected
    totalComparison = priorGroupTotal
    spendLabel = 'THIS YEAR (ACT+FCST)'
    comparisonLabel = 'LAST YEAR (FULL)'
    if (totalComparison > 0) {
      const ratio = totalSpend / totalComparison
      totalStatus = ratio > 1 + THRESHOLD ? 'over' : ratio < 1 - THRESHOLD ? 'under' : 'onTrack'
      totalDelta = totalSpend - totalComparison
      totalDeltaPct = (ratio - 1) * 100
    } else {
      totalStatus = 'none'
    }
  } else {
    totalSpend = isYtd ? totals.actual : totals.projected
    totalComparison = isYtd ? totals.ytdBudget : totals.fullBudget
    spendLabel = isYtd ? 'YTD TOTAL' : 'FULL YEAR · ACT+FCST'
    comparisonLabel = isYtd ? 'YTD BUDGET' : 'ANNUAL BUDGET'
    totalStatus = getStatus(totalSpend, totalComparison)
    totalDelta = totalComparison > 0 ? totalSpend - totalComparison : null
    totalDeltaPct = totalComparison > 0 ? ((totalSpend / totalComparison) - 1) * 100 : null
  }

  function handleToggle(cat) {
    setExpandedCat(prev => prev === cat ? null : cat)
  }

  const legendItems = isPriorYear ? [
    { color: 'var(--accent)', label: 'Less than last year (>10%)', line: false },
    { color: 'var(--green)',  label: 'On par with last year',       line: false },
    { color: 'var(--warn)',   label: 'More than last year (>10%)',  line: false },
    { color: 'var(--tx-3)',   label: 'Prior year (full)',             line: true  },
  ] : [
    { color: 'var(--green)',       label: 'On track (within 10%)', line: false },
    { color: 'var(--accent)',      label: 'Under budget (>10%)',   line: false },
    { color: 'var(--warn)',        label: 'Over budget (>10%)',    line: false },
    { color: 'var(--forecast-bd)', label: 'Forecast',              line: false },
    ...(hasBudget ? [{ color: 'var(--bar-budget)', label: 'Budget', line: true }] : []),
  ]

  return createPortal(
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
          display: 'flex', padding: '14px 16px',
          background: 'var(--bg-app)', borderRadius: 10,
          border: '1px solid var(--bd)', marginBottom: 20,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: MONO, fontSize: 20, color: STATUS[totalStatus].color, lineHeight: 1 }}>
              {fmtK(totalSpend)}
            </div>
            <div style={{ fontFamily: MONO, fontSize: 8, color: 'var(--tx-3)', letterSpacing: '0.06em', marginTop: 5 }}>
              {spendLabel}
            </div>
          </div>
          {(totalComparison > 0) && (
            <>
              <div style={{ width: 1, background: 'var(--bd)', margin: '0 16px' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: MONO, fontSize: 20, color: isPriorYear ? 'var(--tx-2)' : 'var(--bar-budget-tx)', lineHeight: 1 }}>
                  {fmtK(totalComparison)}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 8, color: 'var(--tx-3)', letterSpacing: '0.06em', marginTop: 5 }}>
                  {comparisonLabel}
                </div>
              </div>
              <div style={{ width: 1, background: 'var(--bd)', margin: '0 16px' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: MONO, fontSize: 20, color: totalDelta > 0 ? 'var(--warn)' : 'var(--accent)', lineHeight: 1 }}>
                  {totalDelta != null ? `${totalDelta > 0 ? '+' : ''}${fmtK(totalDelta)}` : '—'}
                </div>
                <div style={{ fontFamily: MONO, fontSize: 8, color: 'var(--tx-3)', letterSpacing: '0.06em', marginTop: 5 }}>
                  {isPriorYear ? 'YOY CHANGE' : 'VS. BUDGET'}
                  {totalDeltaPct != null && ` (${totalDelta > 0 ? '+' : ''}${Math.round(totalDeltaPct)}%)`}
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Group monthly trend ── */}
        <GroupMonthlyChart
          monthlyActual={groupMonthlyActual}
          monthlyBudget={groupMonthlyBudget}
          currentMonth={currentMonth}
        />

        {/* ── Controls: filter + sort ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Pill active={filter === 'FULL YEAR'} onClick={() => setFilter('FULL YEAR')}>FULL YEAR · ACT+FCST</Pill>
            <Pill active={filter === 'YTD'} onClick={() => setFilter('YTD')}>YEAR TO DATE</Pill>
            <Pill active={filter === 'PRIOR YEAR'} onClick={() => setFilter('PRIOR YEAR')} disabled={!hasPriorYear}>
              VS. PRIOR YEAR
            </Pill>
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
          <Fragment key={r.category}>
            <CatBar
              row={r}
              isYtd={isYtd}
              isPriorYear={isPriorYear}
              priorActual={priorActualByCat[r.category] || 0}
              max={displayMax}
              isExpanded={expandedCat === r.category}
              onToggle={() => handleToggle(r.category)}
            />
            {expandedCat === r.category && (
              <div style={{
                background: 'var(--bg-app)', borderRadius: '0 0 10px 10px',
                border: '1px solid var(--bd-light)', borderTop: 'none',
                padding: '12px 16px 16px', marginBottom: 4,
              }}>
                <MonthSparkline row={r} currentMonth={currentMonth} />
                <div style={{ marginTop: 14, borderTop: '1px solid var(--bd-light)', paddingTop: 14 }}>
                  <TopMerchants category={r.category} yearTxns={yearTxns} />
                  <TransactionList category={r.category} yearTxns={yearTxns} />
                </div>
              </div>
            )}
          </Fragment>
        ))}

        {/* ── Legend ── */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '6px 16px',
          marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--bd-light)',
        }}>
          {legendItems.map(item => (
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
    </div>,
    document.body
  )
}

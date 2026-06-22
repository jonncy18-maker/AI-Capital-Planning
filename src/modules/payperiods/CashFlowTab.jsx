import { useState, useEffect, useMemo } from 'react'
import {
  getIncomeActualsRange, upsertIncomeActual, deleteIncomeActual, getIncomeTransactions,
} from '../../lib/db/income.js'
import { loadOutflowSeries, loadInflowSeries, buildMonthSlots } from '../../lib/payperiods/cashSeries.js'

const INFLOW_COLOR = '#10B981'   // green — money in
const OUTFLOW_COLOR = '#8B5CF6'  // violet — money out (matches Trends outflow)
const WARN_COLOR = 'var(--warn)'

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December']
const pad = n => String(n).padStart(2, '0')

const fmt = n => n == null ? '—' : '$' + Math.round(Math.abs(Number(n))).toLocaleString()
const fmtSigned = n => {
  const v = Math.round(Number(n) || 0)
  return (v < 0 ? '-$' : '+$') + Math.abs(v).toLocaleString()
}

function MonoLabel({ children, style }) {
  return (
    <div style={{
      fontFamily: "'DM Mono', monospace", fontSize: 9.5,
      color: 'var(--tx-3)', letterSpacing: '0.06em', ...style,
    }}>{children}</div>
  )
}

function LegendDot({ color, dashed, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        width: 10, height: 10, borderRadius: 3, background: color,
        border: dashed ? `1px dashed ${color}` : 'none', opacity: dashed ? 0.4 : 1,
        display: 'inline-block', flexShrink: 0,
      }} />
      <span style={{
        fontFamily: "'DM Mono', monospace", fontSize: 9.5,
        letterSpacing: '0.05em', color: 'var(--tx-3)', textTransform: 'uppercase',
      }}>{label}</span>
    </div>
  )
}

// A single card holding several related metrics in a row, with an optional footnote.
function MetricCard({ title, metrics, footnote, mobile }) {
  return (
    <div style={{
      border: '1px solid var(--bd)', borderRadius: 11,
      padding: mobile ? '14px' : '16px 18px', background: 'var(--bg-card)',
    }}>
      <div style={{
        fontFamily: "'DM Mono', monospace", fontSize: 8.5, color: 'var(--tx-3)',
        letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 12,
      }}>{title}</div>
      <div style={{ display: 'flex', gap: mobile ? 16 : 24, flexWrap: 'wrap' }}>
        {metrics.map((m, i) => (
          <div key={i} style={{ minWidth: 60 }}>
            <div style={{
              fontFamily: "'DM Mono', monospace", fontSize: 8, color: 'var(--tx-4)',
              letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 5,
            }}>{m.label}</div>
            <div style={{
              fontFamily: "'DM Serif Display', serif", fontSize: mobile ? 19 : 23,
              color: m.color || 'var(--tx-1)', lineHeight: 1,
            }}>{m.value}</div>
          </div>
        ))}
      </div>
      {footnote && (
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, color: 'var(--tx-4)', marginTop: 12, lineHeight: 1.5 }}>
          {footnote}
        </div>
      )}
    </div>
  )
}

export default function CashFlowTab({
  userId, bills, payDay2, mobile, profile,
  creditCards = [], budgetCategories = [], earnRateMap = {},
  ccCoverage = 80, ccOptimization = 100,
}) {
  const now = new Date()
  const [outflowData, setOutflowData] = useState(null)
  const [inflowData, setInflowData] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [hover, setHover] = useState(null)
  const [inflowVersion, setInflowVersion] = useState(0) // bump to reload inflow

  const [pulling, setPulling] = useState(false)
  const [pullMsg, setPullMsg] = useState(null)

  // Per-month override editor
  const [reconYear, setReconYear] = useState(now.getFullYear())
  const [reconMonth, setReconMonth] = useState(now.getMonth() + 1)
  const [reconValue, setReconValue] = useState('')

  const billsKey = bills.map(b => `${b.id}:${b.fixed_amount}:${b.forecast_category_id}:${b.forecast_divisor}:${b.pay_day}:${b.credit_card_id}`).join('|')
  const cardsKey = creditCards.map(c => `${c.id}:${c.statement_close_day}:${c.due_days_after_close}:${c.is_default}`).join('|')
  const catsKey = budgetCategories.map(c => `${c.id}:${c.is_active}:${c.cc_category}:${c.cash_only}:${c.pinned_card_id ?? ''}`).join('|')
  const earnKey = JSON.stringify(earnRateMap)
  const profileKey = profile
    ? `${profile.annual_income}:${profile.annual_bonus}:${profile.bonus_month}:${profile.four01k_pct}:${profile.four01k_on_bonus}:${profile.benefits_amount}:${profile.benefits_pct}:${JSON.stringify(profile.tax_profile)}`
    : 'none'

  const excludedSet = useMemo(
    () => new Set((budgetCategories ?? []).filter(c => c.exclude_from_totals).map(c => c.category)),
    [budgetCategories]
  )
  const windowSlots = useMemo(() => buildMonthSlots().slots, [])

  // ── Outflow series (bills) — only when outflow inputs change ────────────────
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    loadOutflowSeries({ userId, bills, payDay2, creditCards, budgetCategories, earnRateMap, ccCoverage, ccOptimization })
      .then(d => { if (!cancelled) setOutflowData(d) })
      .catch(e => { if (!cancelled) setLoadError(e.message) })
    return () => { cancelled = true }
  }, [userId, billsKey, payDay2, cardsKey, catsKey, earnKey, ccCoverage, ccOptimization]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Inflow series (income) — stored actuals + Settings forecast ─────────────
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    loadInflowSeries({ userId, profile })
      .then(d => { if (!cancelled) setInflowData(d) })
      .catch(e => { if (!cancelled) setLoadError(e.message) })
    return () => { cancelled = true }
  }, [userId, profileKey, inflowVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Merge by month-key ──────────────────────────────────────────────────────
  const chartData = useMemo(() => {
    if (!outflowData || !inflowData) return null
    const inflowByKey = new Map(inflowData.map(s => [`${s.year}-${s.month}`, s]))
    return outflowData.map(o => {
      const inSlot = inflowByKey.get(`${o.year}-${o.month}`) ?? { inflow: 0, inflowIsActual: false, inflowKind: 'none' }
      const outTotal = o.period1Total + o.period2Total
      return {
        ...o,
        outflow: outTotal,
        inflow: inSlot.inflow,
        inflowIsActual: inSlot.inflowIsActual,
        inflowKind: inSlot.inflowKind,
        net: inSlot.inflow - outTotal,
      }
    })
  }, [outflowData, inflowData])

  // Keep the override editor's input in sync with the resolved value for the month.
  const reconSlot = chartData?.find(s => s.year === reconYear && s.month === reconMonth)
  useEffect(() => {
    setReconValue(reconSlot?.inflowIsActual ? String(Math.round(reconSlot.inflow)) : '')
  }, [reconYear, reconMonth, reconSlot?.inflowIsActual, reconSlot?.inflow])

  // ── Handlers ────────────────────────────────────────────────────────────────
  async function handlePull() {
    if (!userId || !chartData) return
    setPulling(true)
    setPullMsg(null)
    try {
      // Only elapsed months — the current month is still in progress (forecast).
      const historySlots = chartData.filter(s => !s.isFuture && !s.isCurrent)
      if (historySlots.length === 0) { setPulling(false); return }
      const first = historySlots[0]
      const last = historySlots[historySlots.length - 1]
      const startDate = `${first.year}-${pad(first.month)}-01`
      const endDate = `${last.year}-${pad(last.month)}-${pad(new Date(last.year, last.month, 0).getDate())}`

      const txns = await getIncomeTransactions(userId, startDate, endDate)
      const byKey = {}
      for (const t of txns) {
        if (excludedSet.has(t.category)) continue
        const ym = String(t.date).slice(0, 7) // YYYY-MM
        byKey[ym] = (byKey[ym] ?? 0) + Number(t.amount)
      }

      // Preserve months the user manually adjusted.
      const existing = await getIncomeActualsRange(userId, first.year, last.year)
      const manualKeys = new Set(existing.filter(r => r.source === 'manual').map(r => `${r.year}-${r.month}`))

      let written = 0
      await Promise.all(historySlots.map(async s => {
        const key = `${s.year}-${s.month}`
        if (manualKeys.has(key)) return
        const amount = byKey[`${s.year}-${pad(s.month)}`] ?? 0
        await upsertIncomeActual(userId, s.year, s.month, amount, 'pulled')
        written += 1
      }))

      setInflowVersion(v => v + 1)
      setPullMsg(`Pulled income for ${written} month${written !== 1 ? 's' : ''} from your transactions.`)
    } catch (e) {
      setPullMsg(`Pull failed: ${e.message}`)
    } finally {
      setPulling(false)
    }
  }

  async function handleReconBlur(value) {
    try {
      if (value === '' || value == null) {
        await deleteIncomeActual(userId, reconYear, reconMonth)
      } else {
        await upsertIncomeActual(userId, reconYear, reconMonth, Number(value), 'manual')
      }
      setInflowVersion(v => v + 1)
    } catch (e) { console.error('Failed to save income override:', e) }
  }

  function stepRecon(delta) {
    let m = reconMonth + delta, y = reconYear
    if (m < 1) { m = 12; y -= 1 } else if (m > 12) { m = 1; y += 1 }
    const first = windowSlots[0], lastS = windowSlots[windowSlots.length - 1]
    const ord = (yy, mm) => yy * 12 + mm
    if (ord(y, m) < ord(first.year, first.month)) { y = first.year; m = first.month }
    else if (ord(y, m) > ord(lastS.year, lastS.month)) { y = lastS.year; m = lastS.month }
    setReconMonth(m); setReconYear(y)
  }

  // ── Loading / error ─────────────────────────────────────────────────────────
  if (!chartData) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
      </div>
    )
  }
  if (loadError) {
    return <div style={{ padding: 20, background: 'var(--warn-bg)', borderRadius: 10, color: 'var(--warn)', fontSize: 13 }}>{loadError}</div>
  }

  const data = chartData
  const max = Math.max(1, ...data.map(s => Math.max(s.inflow, s.outflow)))
  const chartH = mobile ? 150 : 200

  // 12-month (calendar-year) figures — actuals for elapsed months, forecast for the rest.
  const monthsN = data.length || 1
  const totalIn = data.reduce((s, m) => s + m.inflow, 0)
  const totalOut = data.reduce((s, m) => s + m.outflow, 0)
  const avgIn = totalIn / monthsN
  const avgOut = totalOut / monthsN
  const annualNet = totalIn - totalOut
  // Net margin = how much of inflow is left after outflow. Green at/above the
  // dashboard's variance threshold, red below it (including a deficit).
  const netPct = avgIn > 0 ? ((avgIn - avgOut) / avgIn) * 100 : (avgOut > 0 ? -100 : 0)
  const threshold = Number(profile?.variance_threshold) || 10
  const netColor = netPct >= threshold ? INFLOW_COLOR : WARN_COLOR

  const hasHistoryInflow = data.some(s => !s.isFuture && !s.isCurrent && s.inflow > 0)
  const hasForecast = Number(profile?.annual_income) > 0

  return (
    <div>
      {/* Header: legend + pull action */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <LegendDot color={INFLOW_COLOR} label="Inflow" />
          <LegendDot color={OUTFLOW_COLOR} label="Outflow" />
          <LegendDot color={INFLOW_COLOR} dashed label="Forecast" />
        </div>
        <button
          onClick={handlePull}
          disabled={pulling}
          title="Sum your income transactions (excluding transfers) into each past month"
          style={{
            background: 'none', border: '1px solid var(--bd)', borderRadius: 7,
            padding: '7px 14px', cursor: pulling ? 'not-allowed' : 'pointer',
            fontSize: 12, color: 'var(--tx-2)', opacity: pulling ? 0.6 : 1, whiteSpace: 'nowrap',
          }}
        >
          {pulling ? 'Pulling…' : '↻ Pull income from history'}
        </button>
      </div>

      {pullMsg && (
        <div style={{ marginBottom: 16, padding: '8px 12px', borderRadius: 8, background: 'var(--accent-bg)', border: '1px solid var(--accent-bd)', fontSize: 12, color: 'var(--accent)' }}>
          {pullMsg}
        </div>
      )}

      {/* Setup hints */}
      {(!hasHistoryInflow || !hasForecast) && (
        <div style={{
          padding: '12px 14px', marginBottom: 18, borderRadius: 9,
          border: '1px solid var(--accent-bd)', background: 'var(--accent-bg)',
          fontSize: 12.5, color: 'var(--accent)', lineHeight: 1.6,
        }}>
          {!hasHistoryInflow && <div><strong>Pull income from history</strong> to fill past months from your transactions.</div>}
          {!hasForecast && <div>Set your <strong>salary &amp; bonus</strong> in Settings → Income to forecast future inflow.</div>}
        </div>
      )}

      {/* Chart */}
      <div style={{ position: 'relative' }}>
        {hover != null && data[hover] && (() => {
          const s = data[hover]
          const inKind = s.inflowKind === 'actual' ? 'ACTUAL' : s.inflowKind === 'forecast' ? 'FORECAST' : '—'
          return (
            <div style={{
              position: 'absolute', top: -6, left: '50%', transform: 'translateX(-50%)',
              zIndex: 5, background: 'var(--bg-app)', border: '1px solid var(--bd)',
              borderRadius: 9, padding: '10px 13px', minWidth: mobile ? 190 : 240, maxWidth: 320,
              boxShadow: '0 8px 24px rgba(0,0,0,0.35)', pointerEvents: 'none',
            }}>
              <div style={{
                fontFamily: "'DM Mono', monospace", fontSize: 9.5, letterSpacing: '0.08em',
                color: 'var(--tx-3)', textTransform: 'uppercase', marginBottom: 8,
              }}>{s.label} {s.year}</div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, padding: '2px 0' }}>
                <span style={{ color: 'var(--tx-3)' }}>INFLOW <span style={{ fontSize: 8.5, color: 'var(--tx-4)' }}>{inKind}</span></span>
                <span style={{ color: INFLOW_COLOR, fontVariantNumeric: 'tabular-nums' }}>{fmt(s.inflow)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, padding: '2px 0' }}>
                <span style={{ color: 'var(--tx-3)' }}>OUTFLOW <span style={{ fontSize: 8.5, color: 'var(--tx-4)' }}>{s.isFuture ? 'FORECAST' : 'ACTUAL'}</span></span>
                <span style={{ color: OUTFLOW_COLOR, fontVariantNumeric: 'tabular-nums' }}>{fmt(s.outflow)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 700, marginTop: 4, paddingTop: 6, borderTop: '1px solid var(--bd)' }}>
                <span style={{ color: 'var(--tx-2)' }}>NET</span>
                <span style={{ color: s.net >= 0 ? INFLOW_COLOR : WARN_COLOR, fontVariantNumeric: 'tabular-nums' }}>{fmtSigned(s.net)}</span>
              </div>
            </div>
          )
        })()}

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: mobile ? 4 : 8, height: chartH }}>
          {data.map((s, i) => {
            const inH = (s.inflow / max) * chartH
            const outH = (s.outflow / max) * chartH
            const isHover = hover === i
            return (
              <div key={`${s.year}-${s.month}`}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                style={{
                  flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                  gap: mobile ? 2 : 3, height: '100%', position: 'relative', cursor: 'default',
                  background: isHover ? 'var(--hover)' : 'transparent', borderRadius: 5,
                }}>
                <div style={{
                  width: mobile ? 8 : '46%', maxWidth: 26,
                  height: s.inflow > 0 ? Math.max(inH, 2) : 0, background: INFLOW_COLOR,
                  border: s.isFuture ? `1px dashed ${INFLOW_COLOR}` : 'none', borderRadius: '3px 3px 0 0',
                  opacity: s.isFuture ? 0.4 : (isHover ? 1 : 0.9), transition: 'opacity .15s',
                }} />
                <div style={{
                  width: mobile ? 8 : '46%', maxWidth: 26,
                  height: s.outflow > 0 ? Math.max(outH, 2) : 0, background: OUTFLOW_COLOR,
                  border: s.isFuture ? `1px dashed ${OUTFLOW_COLOR}` : 'none', borderRadius: '3px 3px 0 0',
                  opacity: s.isFuture ? 0.4 : (isHover ? 1 : 0.92), transition: 'opacity .15s',
                }} />
                {s.isCurrent && (
                  <div style={{ position: 'absolute', left: -3, top: -14, bottom: 0, borderLeft: '1px dashed var(--forecast-bd)' }}>
                    <span style={{ position: 'absolute', top: -2, left: 4, whiteSpace: 'nowrap', fontFamily: "'DM Mono', monospace", fontSize: 8.5, letterSpacing: '0.08em', color: 'var(--tx-3)' }}>TODAY</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: mobile ? 4 : 8, marginTop: 8 }}>
          {data.map(s => (
            <div key={`${s.year}-${s.month}`} style={{
              flex: 1, textAlign: 'center', fontFamily: "'DM Mono', monospace",
              fontSize: mobile ? 8.5 : 10, color: s.isCurrent ? 'var(--accent)' : 'var(--tx-3)', letterSpacing: '0.02em',
            }}>{mobile ? s.label[0] : s.label}</div>
          ))}
        </div>
      </div>

      {/* Summary stats — 12-month (calendar-year) basis */}
      <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1.7fr 1fr', gap: 12, marginTop: 24 }}>
        <MetricCard
          title={`${data[0]?.year ?? ''} Average · per month`}
          mobile={mobile}
          metrics={[
            { label: 'Inflow', value: fmt(avgIn), color: INFLOW_COLOR },
            { label: 'Outflow', value: fmt(avgOut), color: OUTFLOW_COLOR },
            { label: 'Net margin', value: (netPct >= 0 ? '+' : '') + netPct.toFixed(0) + '%', color: netColor },
          ]}
          footnote={`Net margin is green at or above your ${threshold}% variance threshold (Settings → Analysis), red below it.`}
        />
        <MetricCard
          title="Projected annual net"
          mobile={mobile}
          metrics={[
            { label: annualNet >= 0 ? 'Surplus' : 'Shortfall', value: fmtSigned(annualNet), color: annualNet >= 0 ? INFLOW_COLOR : WARN_COLOR },
          ]}
          footnote="Inflow − outflow across the full calendar year."
        />
      </div>

      {/* Per-month override */}
      <div style={{ marginTop: 24, border: '1px solid var(--bd)', borderRadius: 12, background: 'var(--bg-card)', overflow: 'hidden' }}>
        <div style={{
          padding: '14px 18px 12px', borderBottom: '1px solid var(--bd)', background: 'var(--bg-app)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
        }}>
          <div>
            <MonoLabel>ADJUST A MONTH</MonoLabel>
            <div style={{ marginTop: 4, fontSize: 13, color: 'var(--tx-2)' }}>Override inflow for one month</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => stepRecon(-1)} style={{ background: 'none', border: '1px solid var(--bd)', borderRadius: 7, padding: '4px 10px', cursor: 'pointer', color: 'var(--tx-2)', fontSize: 13 }}>‹</button>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: 'var(--tx-1)', minWidth: 110, textAlign: 'center', letterSpacing: '0.04em' }}>{MONTH_NAMES[reconMonth - 1].slice(0, 3).toUpperCase()} {reconYear}</div>
            <button onClick={() => stepRecon(1)} style={{ background: 'none', border: '1px solid var(--bd)', borderRadius: 7, padding: '4px 10px', cursor: 'pointer', color: 'var(--tx-2)', fontSize: 13 }}>›</button>
          </div>
        </div>

        <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 140 }}>
            <MonoLabel>ACTUAL INFLOW</MonoLabel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: 'var(--tx-3)' }}>$</span>
              <input
                type="number" min="0" value={reconValue}
                placeholder={reconSlot ? String(Math.round(reconSlot.inflow)) : '0'}
                onChange={e => setReconValue(e.target.value)}
                onBlur={e => handleReconBlur(e.target.value)}
                style={{
                  width: 120, background: 'var(--bg-app)', border: '1px solid var(--bd)', borderRadius: 6, padding: '6px 9px',
                  fontFamily: "'DM Mono', monospace", fontSize: 13, color: 'var(--tx-1)', outline: 'none', textAlign: 'right',
                }} />
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--tx-4)', marginTop: 5 }}>
              {reconSlot?.inflowIsActual ? 'Overriding — clear to revert' : (reconSlot?.inflowKind === 'forecast' ? 'Forecast from Settings — type to override' : 'Empty — pull history or enter manually')}
            </div>
          </div>
          {reconSlot && (
            <div style={{ display: 'flex', gap: 18, alignItems: 'baseline' }}>
              <div><MonoLabel>OUT</MonoLabel><div style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: OUTFLOW_COLOR, marginTop: 4 }}>{fmt(reconSlot.outflow)}</div></div>
              <div>
                <MonoLabel>NET</MonoLabel>
                <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 17, color: reconSlot.net >= 0 ? INFLOW_COLOR : WARN_COLOR, marginTop: 2 }}>{fmtSigned(reconSlot.net)}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

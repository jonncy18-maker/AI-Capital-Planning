import { useState, useEffect } from 'react'
import { loadOutflowSeries } from '../../lib/payperiods/cashSeries.js'

const P1_COLOR = 'var(--accent)'
const P2_COLOR = '#8B5CF6'

function fmtMoney(n) {
  return '$' + Math.round(n || 0).toLocaleString()
}

function LegendDot({ color, dashed, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        width: 10, height: 10, borderRadius: 3,
        background: color,
        border: dashed ? `1px dashed ${color}` : 'none',
        opacity: dashed ? 0.35 : 1,
        display: 'inline-block', flexShrink: 0,
      }} />
      <span style={{
        fontFamily: "'DM Mono', monospace", fontSize: 9.5,
        letterSpacing: '0.05em', color: 'var(--tx-3)', textTransform: 'uppercase',
      }}>{label}</span>
    </div>
  )
}

function StatCard({ label, value, sub, color, mobile }) {
  return (
    <div style={{
      border: '1px solid var(--bd)', borderRadius: 11,
      padding: mobile ? '12px 14px' : '16px 18px', background: 'var(--bg-card)',
    }}>
      <div style={{
        fontFamily: "'DM Mono', monospace", fontSize: 8.5, color: 'var(--tx-3)',
        letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8,
      }}>{label}</div>
      <div style={{
        fontFamily: "'DM Serif Display', serif", fontSize: mobile ? 20 : 24,
        color: color || 'var(--tx-1)', lineHeight: 1,
      }}>{value}</div>
      {sub && (
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, color: 'var(--tx-4)', marginTop: 6 }}>
          {sub}
        </div>
      )}
    </div>
  )
}

export default function TrendsTab({
  userId, bills, payDay2, mobile,
  creditCards = [], budgetCategories = [], earnRateMap = {},
  ccCoverage = 80, ccOptimization = 100,
}) {
  const [chartData, setChartData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [hover, setHover] = useState(null)

  // Keys that drive a recompute. credit_card_id is included so re-linking a bill
  // to a card refreshes its projected statement amount; the card/category/earn-rate
  // keys keep the credit-card statement projection in sync with its inputs.
  const billsKey = bills.map(b => `${b.id}:${b.fixed_amount}:${b.forecast_category_id}:${b.forecast_divisor}:${b.pay_day}:${b.credit_card_id}`).join('|')
  const cardsKey = creditCards.map(c => `${c.id}:${c.statement_close_day}:${c.due_days_after_close}:${c.is_default}`).join('|')
  const catsKey = budgetCategories.map(c => `${c.id}:${c.is_active}:${c.cc_category}:${c.cash_only}:${c.pinned_card_id ?? ''}`).join('|')
  const earnKey = JSON.stringify(earnRateMap)

  useEffect(() => {
    if (!userId) return
    if (bills.length === 0) {
      setLoading(false)
      setChartData([])
      return
    }

    let cancelled = false
    setLoading(true)
    setLoadError(null)

    loadOutflowSeries({
      userId, bills, payDay2,
      creditCards, budgetCategories, earnRateMap, ccCoverage, ccOptimization,
    })
      .then(computed => { if (!cancelled) setChartData(computed) })
      .catch(e => { if (!cancelled) setLoadError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [userId, billsKey, payDay2, cardsKey, catsKey, earnKey, ccCoverage, ccOptimization]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Loading / error / empty states ──────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          border: '2px solid var(--accent)', borderTopColor: 'transparent',
          animation: 'spin 0.7s linear infinite',
        }} />
      </div>
    )
  }

  if (loadError) {
    return (
      <div style={{ padding: 20, background: 'var(--warn-bg)', borderRadius: 10, color: 'var(--warn)', fontSize: 13 }}>
        {loadError}
      </div>
    )
  }

  if (bills.length === 0) {
    return (
      <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--tx-3)', fontSize: 13 }}>
        Add bills in the BILLS tab to see trends.
      </div>
    )
  }

  if (!chartData || chartData.length === 0) return null

  // ── Chart metrics ────────────────────────────────────────────────────────────

  const max = Math.max(1, ...chartData.map(s => Math.max(s.period1Total, s.period2Total)))
  const chartH = mobile ? 140 : 190

  // 12-month (calendar-year) averages — actuals for elapsed months, forecast for the rest.
  const monthsN = chartData.length || 1
  const avgP1 = chartData.reduce((s, m) => s + m.period1Total, 0) / monthsN
  const avgP2 = chartData.reduce((s, m) => s + m.period2Total, 0) / monthsN
  const avgTotal = avgP1 + avgP2
  const periodDiff = avgP1 - avgP2  // + = Period 1 heavier
  const periodYear = chartData[0]?.year ?? ''

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <LegendDot color={P1_COLOR} label="Period 1" />
        <LegendDot color={P2_COLOR} label="Period 2" />
        <LegendDot color={P1_COLOR} dashed label="Forecast P1" />
        <LegendDot color={P2_COLOR} dashed label="Forecast P2" />
      </div>

      {/* Chart area */}
      <div style={{ position: 'relative' }}>

        {/* Tooltip */}
        {hover != null && (() => {
          const slot = chartData[hover]
          const combined = slot.period1Total + slot.period2Total
          const p1Bills = slot.period1Bills.filter(b => b.resolvedAmount != null && Number(b.resolvedAmount) > 0)
          const p2Bills = slot.period2Bills.filter(b => b.resolvedAmount != null && Number(b.resolvedAmount) > 0)

          const renderBillRows = (blist) => {
            const shown = blist.slice(0, 8)
            const rest = blist.length - shown.length
            return (
              <>
                {shown.map(b => (
                  <div key={b.id} style={{
                    display: 'flex', justifyContent: 'space-between', gap: 12,
                    fontSize: 11.5, padding: '1.5px 0', color: 'var(--tx-2)',
                  }}>
                    <span style={{
                      overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap', flex: 1, minWidth: 0,
                    }}>{b.name}</span>
                    <span style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtMoney(b.resolvedAmount)}
                    </span>
                  </div>
                ))}
                {rest > 0 && (
                  <div style={{ fontSize: 10.5, color: 'var(--tx-4)', padding: '1px 0' }}>
                    +{rest} more
                  </div>
                )}
              </>
            )
          }

          const PeriodSection = ({ color, label, blist, total }) => (
            <div style={{ marginBottom: 8 }}>
              <div style={{
                fontFamily: "'DM Mono', monospace", fontSize: 9, color,
                letterSpacing: '0.06em', marginBottom: 4,
              }}>{label}</div>
              {!mobile && renderBillRows(blist)}
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                fontSize: 12, fontWeight: 600,
                marginTop: (!mobile && blist.length > 0) ? 4 : 0,
                borderTop: (!mobile && blist.length > 0) ? '1px solid var(--bd-light)' : 'none',
                paddingTop: (!mobile && blist.length > 0) ? 4 : 0,
              }}>
                <span style={{ color: 'var(--tx-3)' }}>TOTAL</span>
                <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(total)}</span>
              </div>
            </div>
          )

          return (
            <div style={{
              position: 'absolute', top: -6, left: '50%', transform: 'translateX(-50%)',
              zIndex: 5, background: 'var(--bg-app)', border: '1px solid var(--bd)',
              borderRadius: 9, padding: '10px 13px',
              minWidth: mobile ? 200 : 380, maxWidth: mobile ? 270 : 560,
              boxShadow: '0 8px 24px rgba(0,0,0,0.35)', pointerEvents: 'none',
            }}>
              <div style={{
                fontFamily: "'DM Mono', monospace", fontSize: 9.5,
                letterSpacing: '0.08em', color: 'var(--tx-3)',
                textTransform: 'uppercase', marginBottom: 8,
              }}>
                {slot.label} {slot.year} · {slot.isFuture ? 'FORECAST' : 'HISTORY'}
              </div>

              {mobile ? (
                <>
                  <PeriodSection color={P1_COLOR} label="PERIOD 1" blist={p1Bills} total={slot.period1Total} />
                  <div style={{ borderTop: '1px solid var(--bd-light)', paddingTop: 8 }}>
                    <PeriodSection color={P2_COLOR} label="PERIOD 2" blist={p2Bills} total={slot.period2Total} />
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', marginBottom: 8 }}>
                  <div style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
                    <PeriodSection color={P1_COLOR} label="PERIOD 1" blist={p1Bills} total={slot.period1Total} />
                  </div>
                  <div style={{ width: 1, background: 'var(--bd-light)', alignSelf: 'stretch', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0, paddingLeft: 12 }}>
                    <PeriodSection color={P2_COLOR} label="PERIOD 2" blist={p2Bills} total={slot.period2Total} />
                  </div>
                </div>
              )}

              <div style={{
                display: 'flex', justifyContent: 'space-between',
                fontSize: 12.5, fontWeight: 700,
                borderTop: '1px solid var(--bd)', paddingTop: 8,
              }}>
                <span style={{ color: 'var(--tx-2)' }}>COMBINED</span>
                <span style={{ color: 'var(--tx-1)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtMoney(combined)}
                </span>
              </div>
            </div>
          )
        })()}

        {/* Bars */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: mobile ? 4 : 8, height: chartH }}>
          {chartData.map((slot, i) => {
            const p1H = (slot.period1Total / max) * chartH
            const p2H = (slot.period2Total / max) * chartH
            const isHover = hover === i

            return (
              <div
                key={`${slot.year}-${slot.month}`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                style={{
                  flex: 1, display: 'flex', alignItems: 'flex-end',
                  justifyContent: 'center', gap: mobile ? 2 : 3,
                  height: '100%', position: 'relative', cursor: 'default',
                  background: isHover ? 'var(--hover)' : 'transparent',
                  borderRadius: 5,
                }}
              >
                {/* Period 1 bar */}
                <div style={{
                  width: mobile ? 8 : '46%', maxWidth: 28,
                  height: slot.period1Total > 0 ? Math.max(p1H, 2) : 0,
                  background: P1_COLOR,
                  border: slot.isFuture ? `1px dashed ${P1_COLOR}` : 'none',
                  borderRadius: '3px 3px 0 0',
                  opacity: slot.isFuture ? 0.35 : (isHover ? 1 : 0.9),
                  transition: 'opacity .15s',
                }} />
                {/* Period 2 bar */}
                <div style={{
                  width: mobile ? 8 : '46%', maxWidth: 28,
                  height: slot.period2Total > 0 ? Math.max(p2H, 2) : 0,
                  background: P2_COLOR,
                  border: slot.isFuture ? `1px dashed ${P2_COLOR}` : 'none',
                  borderRadius: '3px 3px 0 0',
                  opacity: slot.isFuture ? 0.35 : (isHover ? 1 : 0.92),
                  transition: 'opacity .15s',
                }} />

                {/* TODAY separator on leading edge of current month */}
                {slot.isCurrent && (
                  <div style={{
                    position: 'absolute', left: -3, top: -14, bottom: 0,
                    borderLeft: '1px dashed var(--forecast-bd)',
                  }}>
                    <span style={{
                      position: 'absolute', top: -2, left: 4, whiteSpace: 'nowrap',
                      fontFamily: "'DM Mono', monospace", fontSize: 8.5,
                      letterSpacing: '0.08em', color: 'var(--tx-3)',
                    }}>TODAY</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Month labels */}
        <div style={{ display: 'flex', gap: mobile ? 4 : 8, marginTop: 8 }}>
          {chartData.map(slot => (
            <div key={`${slot.year}-${slot.month}`} style={{
              flex: 1, textAlign: 'center',
              fontFamily: "'DM Mono', monospace",
              fontSize: mobile ? 8.5 : 10,
              color: slot.isCurrent ? 'var(--accent)' : 'var(--tx-3)',
              letterSpacing: '0.02em',
            }}>
              {mobile ? slot.label[0] : slot.label}
            </div>
          ))}
        </div>
      </div>

      {/* Summary stats — separate cards, 12-month (calendar-year) basis */}
      <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 12, marginTop: 24 }}>
        <StatCard label="Avg Period 1" value={fmtMoney(avgP1)} sub={`${periodYear} · 12-mo avg`} color={P1_COLOR} mobile={mobile} />
        <StatCard label="Avg Period 2" value={fmtMoney(avgP2)} sub={`${periodYear} · 12-mo avg`} color={P2_COLOR} mobile={mobile} />
        <StatCard label="Avg Monthly Total" value={fmtMoney(avgTotal)} sub={`${periodYear} · 12-mo avg`} mobile={mobile} />
        <StatCard label="Period Difference" value={(periodDiff >= 0 ? '+' : '−') + fmtMoney(Math.abs(periodDiff))} sub={periodDiff >= 0 ? 'Period 1 heavier' : 'Period 2 heavier'} mobile={mobile} />
      </div>
    </div>
  )
}

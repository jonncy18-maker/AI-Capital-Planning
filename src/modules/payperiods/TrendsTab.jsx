import { useState, useEffect } from 'react'
import { getBillAmountsRange, getForecastAmountsForBills, splitBillsByPeriod } from '../../lib/db/bills.js'
import { projectedBillAmounts } from '../../lib/cashflow/cashflowEngine.js'

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
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
        background: dashed ? 'transparent' : color,
        border: dashed ? `1px dashed ${color}` : 'none',
        display: 'inline-block', flexShrink: 0,
      }} />
      <span style={{
        fontFamily: "'DM Mono', monospace", fontSize: 9.5,
        letterSpacing: '0.05em', color: 'var(--tx-3)', textTransform: 'uppercase',
      }}>{label}</span>
    </div>
  )
}

function StatCard({ label, value, subLabel, mobile }) {
  return (
    <div style={{
      border: '1px solid var(--bd)', borderRadius: 11,
      padding: mobile ? '12px 14px' : '16px 18px',
      background: 'var(--bg-card)',
    }}>
      <div style={{
        fontFamily: "'DM Mono', monospace", fontSize: 8.5,
        color: 'var(--tx-3)', letterSpacing: '0.07em',
        textTransform: 'uppercase', marginBottom: 8,
      }}>{label}</div>
      <div style={{
        fontFamily: "'DM Serif Display', serif",
        fontSize: mobile ? 20 : 24,
        color: 'var(--tx-1)', lineHeight: 1,
      }}>{value}</div>
      {subLabel && (
        <div style={{
          fontFamily: "'DM Mono', monospace", fontSize: 8,
          color: 'var(--tx-4)', marginTop: 6,
        }}>{subLabel}</div>
      )}
    </div>
  )
}

export default function TrendsTab({ userId, bills, payDay2, mobile, statementsByCard = {} }) {
  const [chartData, setChartData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [hover, setHover] = useState(null)

  const midpoint = (payDay2 ?? 30) - 1
  const billsKey = bills.map(b => `${b.id}:${b.fixed_amount}:${b.forecast_category_id}:${b.forecast_divisor}:${b.pay_day}`).join('|')

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

    async function load() {
      const now = new Date()
      const currentYear = now.getFullYear()
      const currentMonth = now.getMonth() + 1

      const slots = []
      const fwdMonths = Math.max(3, 12 - currentMonth)
      for (let offset = -6; offset <= fwdMonths; offset++) {
        const raw = currentMonth + offset
        const year = currentYear + Math.floor((raw - 1) / 12)
        const month = ((raw - 1 + 120) % 12) + 1
        slots.push({
          year, month,
          isFuture: year > currentYear || (year === currentYear && month > currentMonth),
          isCurrent: year === currentYear && month === currentMonth,
          label: MONTH_ABBR[month - 1],
        })
      }

      const startYear = slots[0].year
      const endYear = slots[slots.length - 1].year

      const rawAmounts = await getBillAmountsRange(userId, startYear, endYear)

      // Index: amountIndex[year][month][bill_id] = amount
      const amountIndex = {}
      for (const row of rawAmounts) {
        if (!amountIndex[row.year]) amountIndex[row.year] = {}
        if (!amountIndex[row.year][row.month]) amountIndex[row.year][row.month] = {}
        amountIndex[row.year][row.month][row.bill_id] = row.amount
      }

      // Most recent actual per bill (for variable bill forecast fallback)
      const sorted = [...rawAmounts].sort((a, b) =>
        a.year !== b.year ? b.year - a.year : b.month - a.month
      )
      const lastKnownAmounts = {}
      for (const row of sorted) {
        if (lastKnownAmounts[row.bill_id] === undefined && row.amount != null) {
          lastKnownAmounts[row.bill_id] = row.amount
        }
      }

      // Fallback map for variable bills (no fixed_amount) in future months
      const variableFallbackMap = {}
      for (const bill of bills) {
        if (bill.fixed_amount == null && lastKnownAmounts[bill.id] != null) {
          variableFallbackMap[bill.id] = lastKnownAmounts[bill.id]
        }
      }

      // Fetch budget-derived forecast amounts for future slots
      const futureSlots = slots.filter(s => s.isFuture)
      const forecastResults = {}
      if (futureSlots.length > 0 && bills.some(b => b.forecast_category_id)) {
        await Promise.all(futureSlots.map(async s => {
          const result = await getForecastAmountsForBills(userId, s.year, s.month, bills)
          forecastResults[`${s.year}-${s.month}`] = result
        }))
      }

      const computed = slots.map(slot => {
        const billAmountsMap = slot.isFuture
          ? {}
          : (amountIndex[slot.year]?.[slot.month] ?? {})

        const budgetForecastMap = slot.isFuture
          ? (forecastResults[`${slot.year}-${slot.month}`] ?? {})
          : {}

        // For future months, derive CC bill amounts from the statement projection engine,
        // which reflects the seasonal forecast spend routed to each card.
        const cardStatementMap = slot.isFuture
          ? projectedBillAmounts({ bills, statementsByCard, year: slot.year, month: slot.month })
          : {}

        // Priority: card statement projection > budget-derived forecast > last-known actual
        const forecastAmountsMap = slot.isFuture
          ? { ...variableFallbackMap, ...budgetForecastMap, ...cardStatementMap }
          : {}

        const { period1, period2 } = splitBillsByPeriod(bills, billAmountsMap, midpoint, forecastAmountsMap, cardStatementMap)

        const period1Total = period1.reduce((s, b) => s + (b.resolvedAmount != null ? Number(b.resolvedAmount) : 0), 0)
        const period2Total = period2.reduce((s, b) => s + (b.resolvedAmount != null ? Number(b.resolvedAmount) : 0), 0)

        return { ...slot, period1Total, period2Total, period1Bills: period1, period2Bills: period2 }
      })

      if (!cancelled) setChartData(computed)
    }

    load()
      .catch(e => { if (!cancelled) setLoadError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [userId, billsKey, payDay2]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const historicalSlots = chartData.filter(s => !s.isFuture && (s.period1Total > 0 || s.period2Total > 0))
  const hasActuals = historicalSlots.length > 0

  const avgP1 = hasActuals
    ? historicalSlots.reduce((s, m) => s + m.period1Total, 0) / historicalSlots.length
    : null
  const avgP2 = hasActuals
    ? historicalSlots.reduce((s, m) => s + m.period2Total, 0) / historicalSlots.length
    : null
  const avgTotal = hasActuals
    ? historicalSlots.reduce((s, m) => s + m.period1Total + m.period2Total, 0) / historicalSlots.length
    : null

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <LegendDot color={P1_COLOR} label="Period 1" />
        <LegendDot color={P2_COLOR} label="Period 2" />
        <LegendDot color="var(--tx-3)" dashed label="Forecast — rest of year" />
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
                      whiteSpace: 'nowrap', maxWidth: 130,
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
              borderRadius: 9, padding: '10px 13px', minWidth: 200, maxWidth: 270,
              boxShadow: '0 8px 24px rgba(0,0,0,0.35)', pointerEvents: 'none',
            }}>
              <div style={{
                fontFamily: "'DM Mono', monospace", fontSize: 9.5,
                letterSpacing: '0.08em', color: 'var(--tx-3)',
                textTransform: 'uppercase', marginBottom: 8,
              }}>
                {slot.label} {slot.year} · {slot.isFuture ? 'FORECAST' : 'HISTORY'}
              </div>

              <PeriodSection
                color={P1_COLOR}
                label="PERIOD 1"
                blist={p1Bills}
                total={slot.period1Total}
              />
              <div style={{ borderTop: '1px solid var(--bd-light)', paddingTop: 8 }}>
                <PeriodSection
                  color={P2_COLOR}
                  label="PERIOD 2"
                  blist={p2Bills}
                  total={slot.period2Total}
                />
              </div>
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
                  background: slot.isFuture ? 'transparent' : P1_COLOR,
                  border: slot.isFuture ? `1px dashed ${P1_COLOR}` : 'none',
                  borderRadius: '3px 3px 0 0',
                  opacity: slot.isFuture ? 0.55 : (isHover ? 1 : 0.9),
                  transition: 'opacity .15s',
                }} />
                {/* Period 2 bar */}
                <div style={{
                  width: mobile ? 8 : '46%', maxWidth: 28,
                  height: slot.period2Total > 0 ? Math.max(p2H, 2) : 0,
                  background: slot.isFuture ? 'transparent' : P2_COLOR,
                  border: slot.isFuture ? `1px dashed ${P2_COLOR}` : 'none',
                  borderRadius: '3px 3px 0 0',
                  opacity: slot.isFuture ? 0.55 : (isHover ? 1 : 0.92),
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

      {/* Summary stats */}
      {hasActuals ? (
        <div style={{
          display: 'grid',
          gridTemplateColumns: mobile ? '1fr' : '1fr 1fr 1fr',
          gap: 12,
          marginTop: 24,
        }}>
          <StatCard
            label="Avg Period 1"
            value={fmtMoney(avgP1)}
            subLabel={`based on ${historicalSlots.length} month${historicalSlots.length !== 1 ? 's' : ''}`}
            mobile={mobile}
          />
          <StatCard
            label="Avg Period 2"
            value={fmtMoney(avgP2)}
            subLabel={`based on ${historicalSlots.length} month${historicalSlots.length !== 1 ? 's' : ''}`}
            mobile={mobile}
          />
          <StatCard
            label="Avg Monthly Total"
            value={fmtMoney(avgTotal)}
            subLabel={`based on ${historicalSlots.length} month${historicalSlots.length !== 1 ? 's' : ''}`}
            mobile={mobile}
          />
        </div>
      ) : (
        <div style={{
          marginTop: 20,
          fontFamily: "'DM Mono', monospace", fontSize: 11,
          color: 'var(--tx-4)', lineHeight: 1.6,
        }}>
          No historical actuals yet — enter amounts in SCHEDULE view to populate history.
        </div>
      )}
    </div>
  )
}

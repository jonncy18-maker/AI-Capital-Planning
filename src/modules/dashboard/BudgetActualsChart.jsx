import { useState, useMemo } from 'react'

// Monthly Budget vs Actuals — the dashboard centerpiece. Past months render the
// real actual bar (green on-target / red over / teal under) next to the planned
// budget bar; the current and future months render a dashed forecast bar. A
// TODAY marker separates history from forecast, and hovering a month reveals a
// tooltip with the budget, actual, and variance.

function fmtMoney(n) {
  return '$' + Math.round(n || 0).toLocaleString()
}

const STATUS_COLOR = {
  on: 'var(--green)',
  under: 'var(--accent)',
  over: 'var(--red)',
  none: 'var(--bar-budget)',
}

function LegendDot({ color, dashed, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        width: 10, height: 10, borderRadius: 3,
        background: dashed ? 'var(--forecast-fill)' : color,
        border: dashed ? '1px dashed var(--forecast-bd)' : 'none',
        display: 'inline-block', flexShrink: 0,
      }} />
      <span style={{
        fontFamily: "'DM Mono', monospace", fontSize: 9.5,
        letterSpacing: '0.05em', color: 'var(--tx-3)', textTransform: 'uppercase',
      }}>{label}</span>
    </div>
  )
}

export default function BudgetActualsChart({ data, mobile }) {
  const [hover, setHover] = useState(null)

  const max = useMemo(() => {
    let m = 0
    for (const mo of data.months) {
      m = Math.max(m, mo.forecast ?? mo.budget, mo.actual ?? 0)
    }
    return m || 1
  }, [data])

  const chartH = mobile ? 150 : 200

  // No budget yet — show a clear empty state inside the same card frame.
  if (!data.hasBudget) {
    return (
      <ChartCard data={data}>
        <div style={{
          padding: '40px 8px', textAlign: 'center', color: 'var(--tx-2)',
          fontSize: 13.5, lineHeight: 1.6,
        }}>
          No budget for {data.year} yet. Generate or upload one in the{' '}
          <strong style={{ color: 'var(--tx-1)' }}>Annual Budget Builder</strong> to
          see your month-by-month plan vs. actuals here.
        </div>
      </ChartCard>
    )
  }

  return (
    <ChartCard data={data}>
      <div style={{ position: 'relative', marginTop: 8 }}>
        {/* Tooltip */}
        {hover != null && (() => {
          const mo = data.months[hover]
          const planVal = mo.forecast ?? mo.budget
          const variance = mo.actual != null ? mo.actual - planVal : null
          const vpct = planVal > 0 && variance != null ? (variance / planVal) * 100 : null
          const hasForecastOverride = mo.hasOverride && mo.forecast !== mo.budget
          return (
            <div style={{
              position: 'absolute', top: -6, left: '50%', transform: 'translateX(-50%)',
              zIndex: 5, background: 'var(--bg-app)', border: '1px solid var(--bd)',
              borderRadius: 9, padding: '10px 13px', minWidth: 180,
              boxShadow: '0 8px 24px rgba(0,0,0,0.35)', pointerEvents: 'none',
            }}>
              <div style={{
                fontFamily: "'DM Mono', monospace", fontSize: 9.5, letterSpacing: '0.08em',
                color: 'var(--tx-3)', textTransform: 'uppercase', marginBottom: 8,
              }}>
                {mo.label}{mo.isFuture ? ' · forecast' : ''}
              </div>
              {hasForecastOverride && (
                <Row label="Budget (plan)" value={fmtMoney(mo.budget)} color="var(--tx-3)" />
              )}
              <Row label={hasForecastOverride ? 'Forecast (override)' : 'Budget'} value={fmtMoney(planVal)} color="var(--tx-1)" />
              {mo.actual != null ? (
                <Row
                  label="Actual"
                  value={
                    <>
                      {fmtMoney(mo.actual)}
                      {vpct != null && (
                        <span style={{ color: STATUS_COLOR[mo.status], marginLeft: 6 }}>
                          {variance > 0 ? '▲' : '▼'}{Math.abs(Math.round(vpct))}%
                        </span>
                      )}
                    </>
                  }
                  color={STATUS_COLOR[mo.status]}
                />
              ) : (
                <Row label="Actual" value="—" color="var(--tx-3)" />
              )}
            </div>
          )
        })()}

        {/* Bars */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: mobile ? 4 : 10, height: chartH }}>
          {data.months.map(mo => {
            const planVal = mo.forecast ?? mo.budget
            const budgetH = (planVal / max) * chartH
            const actualH = mo.actual != null ? (mo.actual / max) * chartH : budgetH
            const isHover = hover === mo.month
            const showForecast = mo.actual == null
            return (
              <div
                key={mo.month}
                onMouseEnter={() => setHover(mo.month)}
                onMouseLeave={() => setHover(null)}
                style={{
                  flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                  gap: mobile ? 2 : 3, height: '100%', position: 'relative', cursor: 'default',
                  background: isHover ? 'var(--hover)' : 'transparent', borderRadius: 5,
                }}
              >
                {/* Budget bar */}
                <div style={{
                  width: mobile ? 9 : '48%', maxWidth: 30, height: Math.max(budgetH, 2),
                  background: 'var(--bar-budget)', borderRadius: '3px 3px 0 0',
                  transition: 'opacity .15s', opacity: isHover ? 1 : 0.9,
                }} />
                {/* Actual / forecast bar */}
                <div style={{
                  width: mobile ? 9 : '48%', maxWidth: 30, height: Math.max(actualH, 2),
                  background: showForecast ? 'var(--forecast-fill)' : STATUS_COLOR[mo.status],
                  border: showForecast ? '1px dashed var(--forecast-bd)' : 'none',
                  borderRadius: '3px 3px 0 0', transition: 'opacity .15s',
                  opacity: isHover ? 1 : showForecast ? 1 : 0.92,
                }} />

                {/* TODAY marker — drawn on the leading edge of the current month */}
                {mo.isCurrent && (
                  <div style={{
                    position: 'absolute', left: -3, top: -14, bottom: 0,
                    borderLeft: '1px dashed var(--forecast-bd)',
                  }}>
                    <span style={{
                      position: 'absolute', top: -2, left: 4, whiteSpace: 'nowrap',
                      fontFamily: "'DM Mono', monospace", fontSize: 8.5, letterSpacing: '0.08em',
                      color: 'var(--tx-3)',
                    }}>TODAY</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Month labels */}
        <div style={{ display: 'flex', gap: mobile ? 4 : 10, marginTop: 8 }}>
          {data.months.map(mo => (
            <div key={mo.month} style={{
              flex: 1, textAlign: 'center',
              fontFamily: "'DM Mono', monospace", fontSize: mobile ? 8.5 : 10,
              color: mo.isCurrent ? 'var(--accent)' : 'var(--tx-3)',
              letterSpacing: '0.02em',
            }}>{mobile ? mo.label[0] : mo.label}</div>
          ))}
        </div>
      </div>
    </ChartCard>
  )
}

function Row({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 12, padding: '2px 0' }}>
      <span style={{ color: 'var(--tx-3)' }}>{label}</span>
      <span style={{ color, fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{value}</span>
    </div>
  )
}

function ChartCard({ data, children }) {
  return (
    <div style={{
      border: '1px solid var(--bd)', borderRadius: 14, background: 'var(--bg-card)',
      padding: '20px 22px', gridColumn: '1 / -1',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12, marginBottom: 18,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--tx-1)' }}>
            Monthly Budget vs. Actuals
          </span>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10.5, color: 'var(--tx-3)' }}>
            {data.year}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <LegendDot color="var(--bar-budget)" label={data.hasForecastOverrides ? 'Forecast' : 'Budget'} />
          <LegendDot color="var(--green)" label={`On target ±${data.varThreshold ?? 10}%`} />
          <LegendDot color="var(--red)" label="Over" />
          <LegendDot dashed label="Forecast" />
          {data.hasActuals && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 11px', borderRadius: 20,
              border: `1px solid ${data.onTrack ? 'var(--accent-bd)' : 'var(--warn)'}`,
              background: data.onTrack ? 'var(--accent-bg)' : 'var(--warn-bg)',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: data.onTrack ? 'var(--accent)' : 'var(--warn)' }} />
              <span style={{
                fontFamily: "'DM Mono', monospace", fontSize: 9.5, letterSpacing: '0.08em',
                color: data.onTrack ? 'var(--accent)' : 'var(--warn)', textTransform: 'uppercase',
              }}>
                {data.onTrack ? 'On track' : 'Over plan'}
                {data.ytdPct != null && ` · ${Math.round(data.ytdPct)}%`}
              </span>
            </span>
          )}
        </div>
      </div>
      {children}
    </div>
  )
}

import { useState, useMemo, useEffect, useRef } from 'react'

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

export default function BudgetActualsChart({ data, mobile, onThresholdChange, onCollapse, isCollapsed, scenarioMode = 'all', onScenarioModeChange, committedScenarios = [] }) {
  const [hover, setHover] = useState(null)

  const max = useMemo(() => {
    let m = 0
    for (const mo of data.months) {
      m = Math.max(m, mo.budget, mo.forecast ?? mo.budget, mo.actual ?? 0)
    }
    return m || 1
  }, [data])

  const chartH = mobile ? 150 : 200

  // No budget yet — show a clear empty state inside the same card frame.
  if (!data.hasBudget) {
    return (
      <ChartCard data={data} onThresholdChange={onThresholdChange} onCollapse={onCollapse} isCollapsed={isCollapsed} scenarioMode={scenarioMode} onScenarioModeChange={onScenarioModeChange} committedScenarios={committedScenarios}>
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
    <ChartCard data={data} onThresholdChange={onThresholdChange} onCollapse={onCollapse} isCollapsed={isCollapsed} scenarioMode={scenarioMode} onScenarioModeChange={onScenarioModeChange} committedScenarios={committedScenarios}>
      <div style={{ position: 'relative', marginTop: 8 }}>
        {/* Tooltip */}
        {hover != null && (() => {
          const mo = data.months[hover]
          const planVal = mo.forecast ?? mo.budget
          const isForecastPeriod = mo.actual == null
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
                {mo.label}{isForecastPeriod ? ' · forecast' : ''}
              </div>
              {isForecastPeriod ? (
                // Forecast months: show the budget baseline and the forecast
                // (override-adjusted) value — not an empty "actual".
                <>
                  <Row label="Budget" value={fmtMoney(mo.budget)} color="var(--tx-3)" />
                  <Row label="Forecast" value={fmtMoney(planVal)} color="var(--tx-1)" />
                </>
              ) : (
                <>
                  {hasForecastOverride && (
                    <Row label="Budget (plan)" value={fmtMoney(mo.budget)} color="var(--tx-3)" />
                  )}
                  <Row label={hasForecastOverride ? 'Forecast (override)' : 'Budget'} value={fmtMoney(planVal)} color="var(--tx-1)" />
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
                </>
              )}
            </div>
          )
        })()}

        {/* Bars */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: mobile ? 4 : 10, height: chartH }}>
          {data.months.map(mo => {
            // Left bar is always the budget; the right bar is the actual (past
            // months) or the forecast (current/future months, dashed). Keeping
            // them distinct means a forecast edit moves only the forecast bar.
            const budgetH = (mo.budget / max) * chartH
            const rightVal = mo.actual != null ? mo.actual : (mo.forecast ?? mo.budget)
            const actualH = (rightVal / max) * chartH
            const isHover = hover === mo.month
            const showForecast = mo.actual == null
            return (
              <div
                key={mo.month}
                onMouseEnter={() => setHover(mo.month)}
                onMouseLeave={() => setHover(null)}
                style={{
                  flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                  gap: mobile ? 2 : 3, height: '100%', position: 'relative', cursor: 'default',
                  background: isHover ? 'var(--hover)' : 'transparent', borderRadius: 5,
                }}
              >
                {/* Budget bar */}
                <div style={{
                  width: '48%', maxWidth: 30, height: Math.max(budgetH, 2),
                  background: 'var(--bar-budget)', borderRadius: '3px 3px 0 0',
                  transition: 'opacity .15s', opacity: isHover ? 1 : 0.9,
                }} />
                {/* Actual / forecast bar */}
                <div style={{
                  width: '48%', maxWidth: 30, height: Math.max(actualH, 2),
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

function ThresholdChip({ varThreshold, onThresholdChange }) {
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState(varThreshold ?? 10)
  const ref = useRef(null)

  useEffect(() => { setLocal(varThreshold ?? 10) }, [varThreshold])

  useEffect(() => {
    if (!open) return
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '3px 9px', borderRadius: 6, cursor: 'pointer',
          background: open ? 'var(--accent-bg)' : 'transparent',
          border: `1px solid ${open ? 'var(--accent-bd)' : 'var(--bd)'}`,
        }}
      >
        <span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--green)', display: 'inline-block', flexShrink: 0 }} />
        <span style={{
          fontFamily: "'DM Mono', monospace", fontSize: 9.5, letterSpacing: '0.05em',
          color: open ? 'var(--accent)' : 'var(--tx-3)', textTransform: 'uppercase',
        }}>
          On target ±{local}%
        </span>
        <span style={{ fontSize: 7, color: open ? 'var(--accent)' : 'var(--tx-4)' }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          background: 'var(--bg-app)', border: '1px solid var(--bd)',
          borderRadius: 10, padding: '14px 16px', width: 228, zIndex: 40,
          boxShadow: '0 8px 28px rgba(0,0,0,0.4)',
        }}>
          <div style={{
            fontFamily: "'DM Mono', monospace", fontSize: 8.5, color: 'var(--tx-3)',
            letterSpacing: '0.06em', marginBottom: 10,
          }}>
            VARIANCE THRESHOLD
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              type="range" min="1" max="25" step="1"
              value={local}
              onChange={e => setLocal(Number(e.target.value))}
              onPointerUp={e => onThresholdChange?.(Number(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--accent)', cursor: 'pointer' }}
            />
            <span style={{
              fontFamily: "'DM Mono', monospace", fontSize: 17,
              color: 'var(--accent)', minWidth: 36, textAlign: 'right', lineHeight: 1,
            }}>
              ±{local}%
            </span>
          </div>
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            fontFamily: "'DM Mono', monospace", fontSize: 8, color: 'var(--tx-4)', marginTop: 5,
          }}>
            <span>1% strict</span><span>25% lenient</span>
          </div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8.5, color: 'var(--tx-4)', marginTop: 10, lineHeight: 1.5 }}>
            Also editable in Settings → Planning
          </div>
        </div>
      )}
    </div>
  )
}

function FullYearPill({ data }) {
  const [hovered, setHovered] = useState(false)
  const pct = data.fullYearPct
  if (pct == null) return null
  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 11px', borderRadius: 20, cursor: 'default',
        border: `1px solid ${data.onTrack ? 'var(--accent-bd)' : 'var(--warn)'}`,
        background: data.onTrack ? 'var(--accent-bg)' : 'var(--warn-bg)',
      }}>
        <span style={{ width: 6, height: 6, borderRadius: 3, background: data.onTrack ? 'var(--accent)' : 'var(--warn)' }} />
        <span style={{
          fontFamily: "'DM Mono', monospace", fontSize: 9.5, letterSpacing: '0.08em',
          color: data.onTrack ? 'var(--accent)' : 'var(--warn)', textTransform: 'uppercase',
        }}>
          {data.onTrack ? 'On track' : 'Over plan'} · {Math.round(pct)}% full yr
        </span>
      </span>
      {hovered && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0,
          background: 'var(--bg-app)', border: '1px solid var(--bd)',
          borderRadius: 9, padding: '10px 13px', minWidth: 200, zIndex: 40,
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)', pointerEvents: 'none',
          whiteSpace: 'nowrap',
        }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8.5, letterSpacing: '0.06em', color: 'var(--tx-3)', marginBottom: 8 }}>
            FULL YEAR · ACT + FORECAST
          </div>
          <Row label="Projected vs. budget" value={`${Math.round(pct)}%`} color={data.onTrack ? 'var(--accent)' : 'var(--warn)'} />
          {data.ytdPct != null && (
            <Row label="YTD vs. YTD budget" value={`${Math.round(data.ytdPct)}%`} color="var(--tx-2)" />
          )}
        </div>
      )}
    </div>
  )
}

function ScenarioDropdown({ scenarioMode, onScenarioModeChange, committedScenarios }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const activeScenario = scenarioMode !== 'all' && scenarioMode !== 'baseline'
    ? committedScenarios.find(s => s.id === scenarioMode)
    : null

  const chipLabel = scenarioMode === 'baseline'
    ? 'Baseline'
    : activeScenario
      ? `✓ ${activeScenario.name}`
      : `✓ ${committedScenarios.length} scenario${committedScenarios.length !== 1 ? 's' : ''} applied`

  const isActive = scenarioMode !== 'baseline'

  function select(mode) {
    onScenarioModeChange(mode)
    setOpen(false)
  }

  const options = [
    { key: 'baseline', label: 'Baseline' },
    { key: 'all', label: 'All scenarios applied' },
    ...committedScenarios.map(s => ({ key: s.id, label: s.name })),
  ]

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '3px 9px', borderRadius: 6, cursor: 'pointer',
          background: open ? 'var(--accent-bg)' : isActive ? 'rgba(46,204,113,0.08)' : 'transparent',
          border: `1px solid ${open ? 'var(--accent-bd)' : isActive ? 'rgba(46,204,113,0.2)' : 'var(--bd)'}`,
        }}
      >
        <span style={{
          fontFamily: "'DM Mono', monospace", fontSize: 9.5, letterSpacing: '0.05em',
          color: open ? 'var(--accent)' : isActive ? 'var(--green)' : 'var(--tx-3)',
          textTransform: 'uppercase',
        }}>
          {chipLabel}
        </span>
        <span style={{ fontSize: 7, color: open ? 'var(--accent)' : 'var(--tx-4)' }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          background: 'var(--bg-app)', border: '1px solid var(--bd)',
          borderRadius: 10, padding: '6px 0', minWidth: 210, zIndex: 40,
          boxShadow: '0 8px 28px rgba(0,0,0,0.4)',
        }}>
          <div style={{
            padding: '4px 14px 8px',
            fontFamily: "'DM Mono', monospace", fontSize: 8.5,
            color: 'var(--tx-3)', letterSpacing: '0.06em',
          }}>
            SCENARIO VIEW
          </div>
          {options.map(({ key, label }) => {
            const isSelected = scenarioMode === key
            return (
              <button
                key={key}
                onClick={() => select(key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', textAlign: 'left', padding: '7px 14px',
                  background: isSelected ? 'var(--accent-bg)' : 'transparent',
                  border: 'none', cursor: 'pointer',
                  color: isSelected ? 'var(--accent)' : 'var(--tx-2)',
                  fontSize: 12.5,
                }}
              >
                <span style={{ fontSize: 8, color: isSelected ? 'var(--accent)' : 'transparent' }}>●</span>
                {label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ChartCard({ data, children, onThresholdChange, onCollapse, isCollapsed, scenarioMode, onScenarioModeChange, committedScenarios = [] }) {
  return (
    <div style={{
      border: '1px solid var(--bd)', borderRadius: 14, background: 'var(--bg-card)',
      padding: isCollapsed ? '13px 22px' : '20px 22px', gridColumn: '1 / -1',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12, marginBottom: isCollapsed ? 0 : 18,
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
          {!isCollapsed && <>
            <LegendDot color="var(--bar-budget)" label="Budget" />
            {onThresholdChange ? (
              <ThresholdChip varThreshold={data.varThreshold} onThresholdChange={onThresholdChange} />
            ) : (
              <LegendDot color="var(--green)" label={`On target ±${data.varThreshold ?? 10}%`} />
            )}
            <LegendDot color="var(--red)" label="Over" />
            <LegendDot dashed label="Forecast" />
            {data.hasActuals && <FullYearPill data={data} />}
            {committedScenarios.length > 0 && onScenarioModeChange && (
              <ScenarioDropdown
                scenarioMode={scenarioMode}
                onScenarioModeChange={onScenarioModeChange}
                committedScenarios={committedScenarios}
              />
            )}
          </>}
          {onCollapse && (
            <button
              onClick={onCollapse}
              title={isCollapsed ? 'Expand' : 'Collapse'}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tx-4)', fontSize: 13, padding: '0 0 0 4px', lineHeight: 1 }}
            >
              {isCollapsed ? '▸' : '▾'}
            </button>
          )}
        </div>
      </div>
      {!isCollapsed && children}
    </div>
  )
}

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  spendByGroupYear,
  yearProjection,
  budgetVsActual,
  cashFlowSpike,
  commitmentsSummary,
  wealthSummary,
  monthlyBudgetVsActual,
  scenarioImpact,
  incomeVsExpenses,
} from '../../lib/dashboard/widgetData.js'
import { getLatestBriefing, saveBriefing } from '../../lib/db/aiBriefings.js'
import { getTransactionsByMonth } from '../../lib/db/transactions.js'
import { sendAIMessage } from '../../lib/ai/sendMessage.js'
import { summarizeContext } from '../../lib/ai/contextLoader.js'
import BudgetActualsChart from './BudgetActualsChart.jsx'
import SpendGroupDetail from './SpendGroupDetail.jsx'
import ModuleHeader from '../common/ModuleHeader.jsx'
import { CONTENT_MAX } from '../common/layout.js'

// v3: changes default hidden list; existing users who had v2 get fresh defaults
const LS_LAYOUT = 'acp.dashboard.layout.v3'
const DEFAULT_LAYOUT = { order: [], hidden: ['activity'] }

function fmtMoney(n) { return '$' + Math.round(n || 0).toLocaleString() }
function fmtK(n) {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M'
  if (abs >= 1000) return '$' + Math.round(n / 1000) + 'k'
  return '$' + Math.round(n || 0)
}
function fmtK1(n) {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M'
  if (abs >= 1000) return '$' + (n / 1000).toFixed(1) + 'k'
  return '$' + Math.round(n || 0)
}

// ── widget primitives ────────────────────────────────────────────────────────

function Stat({ value, label, accent = true }) {
  return (
    <div>
      <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 34, color: accent ? 'var(--accent)' : 'var(--tx-1)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: 'var(--tx-3)', letterSpacing: '0.06em', marginTop: 8 }}>{label}</div>
    </div>
  )
}
function MiniStat({ value, label }) {
  return (
    <div>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 15, color: 'var(--tx-1)' }}>{value}</div>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: 'var(--tx-3)', letterSpacing: '0.05em', marginTop: 3 }}>{label.toUpperCase()}</div>
    </div>
  )
}
function Empty({ text }) {
  return <div style={{ fontSize: 12, color: 'var(--tx-3)', lineHeight: 1.5 }}>{text}</div>
}

// ── Income vs. Expenses widget ───────────────────────────────────────────────

function IveTooltip({ visible, children }) {
  if (!visible) return null
  return (
    <div style={{
      position: 'absolute',
      bottom: 'calc(100% + 8px)',
      left: 0,
      background: 'var(--bg-app)',
      border: '1px solid var(--accent-bd)',
      borderRadius: 7,
      padding: '10px 12px',
      minWidth: 175,
      zIndex: 200,
      boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </div>
  )
}

function IveDivider() {
  return <div style={{ height: 1, background: 'var(--accent-bd)', margin: '14px 0' }} />
}

function TooltipHeader({ text }) {
  return (
    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, letterSpacing: '0.07em', color: 'var(--tx-3)', marginBottom: 6 }}>
      {text}
    </div>
  )
}

function TooltipRow({ label, value, highlight, border }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      gap: 16,
      fontFamily: "'DM Mono', monospace",
      fontSize: 10,
      color: highlight === 'accent' ? 'var(--accent)' : highlight === 'warn' ? 'var(--warn)' : 'var(--tx-2)',
      lineHeight: 1.9,
      borderTop: border ? '1px solid var(--accent-bd)' : 'none',
      marginTop: border ? 4 : 0,
      paddingTop: border ? 4 : 0,
    }}>
      <span style={{ color: 'var(--tx-3)' }}>{label}</span>
      <span>{value}</span>
    </div>
  )
}

function IveFlowRow({ income, expenses, net, hasIncome, primary = false }) {
  const valueSize = primary ? 20 : 14
  const labelSize = primary ? 8.5 : 7.5

  const items = []
  if (hasIncome) {
    items.push({ val: fmtK(income), lbl: 'INCOME', color: 'var(--tx-1)' })
    items.push('sep')
  }
  items.push({ val: fmtK(expenses), lbl: 'EXPENSES', color: 'var(--tx-1)' })
  if (net !== 0) {
    items.push('sep')
    items.push({ val: (net > 0 ? '+' : '') + fmtK(net), lbl: 'NET', color: net > 0 ? 'var(--accent)' : 'var(--warn)' })
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start' }}>
      {items.map((item, i) => item === 'sep' ? (
        <div key={i} style={{ width: 1, background: 'var(--accent-bd)', margin: '0 10px', alignSelf: 'stretch', minHeight: 28 }} />
      ) : (
        <div key={i} style={{ flex: 1 }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: valueSize, color: item.color, lineHeight: 1 }}>{item.val}</div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: labelSize, color: 'var(--tx-3)', letterSpacing: '0.06em', marginTop: 4 }}>{item.lbl}</div>
        </div>
      ))}
    </div>
  )
}

function IveSavingsRateStat({ rate, label, primary = false, tooltipLines, priorRate }) {
  const [hovered, setHovered] = useState(false)

  let yoyEl = null
  if (priorRate != null && rate != null) {
    const delta = Math.round(rate) - Math.round(priorRate)
    const color = delta > 0 ? 'var(--accent)' : delta < 0 ? 'var(--warn)' : 'var(--tx-3)'
    const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→'
    yoyEl = (
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8.5, color, marginTop: 5, lineHeight: 1 }}>
        {arrow}{Math.abs(delta)}pp vs. {Math.round(priorRate)}% last yr
      </div>
    )
  }

  return (
    <div
      style={{ position: 'relative', flex: 1 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, letterSpacing: '0.06em', color: 'var(--tx-3)', marginBottom: 5 }}>
        {label}
      </div>
      <div style={{
        fontFamily: "'DM Serif Display', serif",
        fontSize: primary ? 30 : 22,
        color: rate > 0 ? 'var(--accent)' : rate < 0 ? 'var(--warn)' : 'var(--tx-2)',
        lineHeight: 1,
        cursor: 'default',
      }}>
        {rate != null ? Math.round(rate) + '%' : '—'}
      </div>
      {yoyEl}
      <IveTooltip visible={hovered}>
        {tooltipLines}
      </IveTooltip>
    </div>
  )
}

function IncomeVsExpensesWidget({ ive }) {
  if (!ive.hasData) {
    return <Empty text="Import transactions to see your income vs. expense breakdown." />
  }

  const hasIncome = ive.ytdIncome > 0

  const fullYearTooltip = (
    <>
      <TooltipHeader text="FULL YEAR BREAKDOWN" />
      {hasIncome && <TooltipRow label="Income" value={fmtK(ive.fullYearIncome)} />}
      <TooltipRow label="Expenses" value={fmtK(ive.fullYearExpenses)} />
      <TooltipRow
        label="Net"
        value={(ive.fullYearNet > 0 ? '+' : '') + fmtK(ive.fullYearNet)}
        highlight={ive.fullYearNet > 0 ? 'accent' : 'warn'}
        border
      />
      {ive.fullYearActualExpenses != null && (
        <>
          <TooltipRow label="Act. Expenses" value={fmtK(ive.fullYearActualExpenses)} border />
          <TooltipRow label="Fcst. Expenses" value={fmtK(ive.fullYearForecastExpenses)} />
        </>
      )}
    </>
  )

  const ytdTooltip = (
    <>
      <TooltipHeader text="YEAR TO DATE" />
      {hasIncome && <TooltipRow label="Income" value={fmtK(ive.ytdIncome)} />}
      <TooltipRow label="Expenses" value={fmtK(ive.ytdExpenses)} />
      <TooltipRow
        label="Net"
        value={(ive.ytdNet > 0 ? '+' : '') + fmtK(ive.ytdNet)}
        highlight={ive.ytdNet > 0 ? 'accent' : 'warn'}
        border
      />
    </>
  )

  return (
    <div style={{ overflow: 'visible' }}>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8.5, letterSpacing: '0.06em', color: 'var(--tx-3)', marginBottom: 10 }}>
        FULL YEAR · ACT+FCST
      </div>
      <IveFlowRow
        income={ive.fullYearIncome}
        expenses={ive.fullYearExpenses}
        net={ive.fullYearNet}
        hasIncome={hasIncome}
        primary
      />

      <IveDivider />

      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8.5, letterSpacing: '0.06em', color: 'var(--tx-3)', marginBottom: 10 }}>
        SAVINGS RATE
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        <IveSavingsRateStat rate={ive.fullYearSavingsRate} label="FULL YEAR" primary tooltipLines={fullYearTooltip} priorRate={ive.priorYearSavingsRate} />
        <div style={{ width: 1, background: 'var(--accent-bd)', margin: '0 14px', alignSelf: 'stretch', minHeight: 36 }} />
        <IveSavingsRateStat rate={ive.savingsRate} label="YEAR TO DATE" tooltipLines={ytdTooltip} />
      </div>

      <IveDivider />

      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8.5, letterSpacing: '0.06em', color: 'var(--tx-3)', marginBottom: 8 }}>
        YEAR TO DATE
      </div>
      <IveFlowRow
        income={ive.ytdIncome}
        expenses={ive.ytdExpenses}
        net={ive.ytdNet}
        hasIncome={hasIncome}
      />
      {ive.topYtdGroup && (
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 10,
          padding: '3px 8px',
          background: 'var(--accent-bg)',
          border: '1px solid var(--accent-bd)',
          borderRadius: 4,
        }}>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 7.5, color: 'var(--tx-3)', letterSpacing: '0.05em' }}>TOP SPEND</span>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: 'var(--tx-2)' }}>
            {ive.topYtdGroup.name} · {fmtK(ive.topYtdGroup.amount)}
          </span>
        </div>
      )}

      <IveDivider />

      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8.5, letterSpacing: '0.06em', color: 'var(--tx-3)', marginBottom: 8 }}>
        PACE · AT CURRENT RATE
      </div>
      <div style={{
        fontFamily: "'DM Mono', monospace",
        fontSize: 11,
        color: ive.fullYearNet > 0 ? 'var(--accent)' : 'var(--warn)',
        lineHeight: 1.4,
        marginBottom: hasIncome ? 10 : 0,
      }}>
        {ive.fullYearNet > 0
          ? `On pace to save ${fmtK(ive.fullYearNet)} this year`
          : ive.fullYearNet < 0
            ? `On pace for a ${fmtK(Math.abs(ive.fullYearNet))} deficit this year`
            : 'On pace to break even this year'}
      </div>
      {hasIncome && ive.avgMonthlyIncome > 0 && (
        <div style={{ display: 'flex', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, color: 'var(--tx-1)', lineHeight: 1 }}>{fmtK1(ive.avgMonthlyExpenses)}</div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 7.5, color: 'var(--tx-3)', letterSpacing: '0.06em', marginTop: 4 }}>AVG/MO SPEND</div>
          </div>
          <div style={{ width: 1, background: 'var(--accent-bd)', margin: '0 10px', alignSelf: 'stretch', minHeight: 24 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, color: 'var(--tx-1)', lineHeight: 1 }}>{fmtK1(ive.avgMonthlyIncome)}</div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 7.5, color: 'var(--tx-3)', letterSpacing: '0.06em', marginTop: 4 }}>AVG/MO EARN</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Spend by Group widget ────────────────────────────────────────────────────
// Full-year actual + forecast (one bar, two tones) vs. the blue budget bar,
// with per-group data labels on hover.

function SpendByGroupWidget({ sgy, ctx, yearTxns, priorYearTxns }) {
  const [hover, setHover] = useState(null)
  const [selectedGroup, setSelectedGroup] = useState(null)

  if (!sgy.rows.length) {
    return <Empty text="No budget or spending data for this year yet." />
  }

  const varRatio = (ctx?.varianceThreshold ?? 10) / 100
  const max = sgy.max
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 2 }}>
        {sgy.rows.map(r => {
          const over    = r.budget > 0 && r.projected > r.budget * (1 + varRatio)
          const under   = r.budget > 0 && r.projected < r.budget * (1 - varRatio)
          const onTrack = r.budget > 0 && !over && !under
          const actualColor = over ? 'var(--warn)' : onTrack ? 'var(--green)' : 'var(--accent)'
          const isHover = hover === r.group
          const actualW  = (r.actual   / max) * 100
          const forecastW = (r.forecast / max) * 100
          const budgetW  = (r.budget   / max) * 100
          return (
            <div
              key={r.group}
              onMouseEnter={() => setHover(r.group)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setSelectedGroup(r.group)}
              style={{ position: 'relative', cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                <span style={{ color: 'var(--tx-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{r.group}</span>
                <span style={{ color: actualColor, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtK(r.projected)}{r.budget > 0 ? ` / ${fmtK(r.budget)}` : ''}
                </span>
              </div>
              {/* Actual + forecast — one bar, two tones */}
              <div style={{ display: 'flex', height: 6, background: 'var(--bd-light)', borderRadius: 3, overflow: 'hidden', marginBottom: 2 }}>
                <div style={{ width: `${actualW}%`, height: '100%', background: actualColor }} />
                <div style={{ width: `${forecastW}%`, height: '100%', background: 'var(--forecast-bd)' }} />
              </div>
              {/* Budget reference bar */}
              {r.budget > 0 && (
                <div style={{ height: 3, background: 'var(--bd-light)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${budgetW}%`, height: '100%', background: 'var(--bar-budget)', borderRadius: 2 }} />
                </div>
              )}
              {/* Hover data labels */}
              {isHover && (
                <div style={{
                  position: 'absolute', top: -8, right: 0, transform: 'translateY(-100%)',
                  zIndex: 6, background: 'var(--bg-app)', border: '1px solid var(--bd)',
                  borderRadius: 9, padding: '9px 12px', minWidth: 178,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.35)', pointerEvents: 'none',
                }}>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, letterSpacing: '0.07em', color: 'var(--tx-3)', textTransform: 'uppercase', marginBottom: 7 }}>
                    {r.group}
                  </div>
                  <SgRow label="Actual (YTD)"      value={fmtMoney(r.actual)}    color="var(--tx-1)" />
                  <SgRow label="Forecast (rest)"    value={fmtMoney(r.forecast)}  color="var(--forecast-bd)" />
                  <SgRow label="Actual + Forecast"  value={fmtMoney(r.projected)} color={actualColor} bold />
                  <SgRow label="Budget"             value={r.budget > 0 ? fmtMoney(r.budget) : '—'} color="var(--bar-budget-tx)" />
                  {r.budget > 0 && (
                    <SgRow
                      label="vs. budget"
                      value={`${r.projected - r.budget > 0 ? '+' : ''}${fmtMoney(r.projected - r.budget)}`}
                      color={over ? 'var(--warn)' : 'var(--accent)'}
                    />
                  )}
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8.5, color: 'var(--tx-3)', marginTop: 8, borderTop: '1px solid var(--bd)', paddingTop: 6 }}>
                    Click to explore categories →
                  </div>
                </div>
              )}
            </div>
          )
        })}
        <div style={{ display: 'flex', gap: 14, fontSize: 9.5, color: 'var(--tx-4)', fontFamily: "'DM Mono', monospace", letterSpacing: '0.03em', flexWrap: 'wrap' }}>
          <SgLegend color="var(--green)"       label="on track" />
          <SgLegend color="var(--accent)"      label="under budget" />
          <SgLegend color="var(--warn)"        label="over budget" />
          <SgLegend color="var(--forecast-bd)" label="forecast" />
          <SgLegend color="var(--bar-budget)"  label="budget" />
        </div>
      </div>
      {selectedGroup && (
        <SpendGroupDetail
          group={selectedGroup}
          ctx={ctx}
          yearTxns={yearTxns}
          priorYearTxns={priorYearTxns}
          onClose={() => setSelectedGroup(null)}
        />
      )}
    </>
  )
}

function SgRow({ label, value, color, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 11.5, padding: '2px 0' }}>
      <span style={{ color: 'var(--tx-3)' }}>{label}</span>
      <span style={{ color, fontVariantNumeric: 'tabular-nums', fontWeight: bold ? 600 : 500 }}>{value}</span>
    </div>
  )
}

function SgLegend({ color, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: color, display: 'inline-block' }} />
      {label}
    </span>
  )
}

// ── Spend vs. Budget widget ──────────────────────────────────────────────────

function BvaWidget({ bva, rr, varThreshold = 10 }) {
  const [projHovered, setProjHovered] = useState(false)

  if (!bva.hasBudget) {
    return <Empty text="No budget yet. Generate one in the Budget Builder to track plan vs. actual." />
  }

  const pct = bva.pct
  const over  = pct != null && pct > 100 + varThreshold
  const under = pct != null && pct < 100 - varThreshold
  const mainColor   = over ? 'var(--warn)' : 'var(--accent)'
  const statusColor = over ? 'var(--warn)' : under ? 'var(--accent)' : 'var(--green)'
  const statusText  = over
    ? `${Math.round(pct - 100)}% above plan`
    : under
    ? `${Math.round(100 - pct)}% below plan`
    : pct != null ? `On track · ${Math.round(pct)}% of plan` : 'On track with annual budget'

  return (
    <div style={{ overflow: 'visible' }}>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8.5, letterSpacing: '0.06em', color: 'var(--tx-3)', marginBottom: 8 }}>
        OF ANNUAL BUDGET
      </div>
      <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 34, color: mainColor, lineHeight: 1 }}>
        {pct != null ? Math.round(pct) + '%' : '—'}
      </div>
      {pct != null && (
        <div style={{ marginTop: 6, fontFamily: "'DM Mono', monospace", fontSize: 10.5, color: statusColor }}>
          {statusText}
        </div>
      )}

      <IveDivider />

      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        <div
          style={{ flex: 1, position: 'relative' }}
          onMouseEnter={() => setProjHovered(true)}
          onMouseLeave={() => setProjHovered(false)}
        >
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, letterSpacing: '0.06em', color: 'var(--tx-3)', marginBottom: 5 }}>
            PROJECTED
          </div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 15, color: 'var(--tx-1)', cursor: 'default' }}>
            {fmtK(bva.projected)}
          </div>
          <IveTooltip visible={projHovered}>
            <TooltipHeader text="FULL YEAR BREAKDOWN" />
            <TooltipRow label="Actual (YTD)" value={fmtK(rr.actualToDate)} />
            <TooltipRow label="Forecast (rest)" value={fmtK(rr.forecastRemaining)} />
            <TooltipRow label="Projected total" value={fmtK(bva.projected)} border />
          </IveTooltip>
        </div>
        <div style={{ width: 1, background: 'var(--accent-bd)', margin: '0 14px', alignSelf: 'stretch', minHeight: 36 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, letterSpacing: '0.06em', color: 'var(--tx-3)', marginBottom: 5 }}>
            BUDGET
          </div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 15, color: 'var(--bar-budget-tx)' }}>
            {fmtK(bva.planned)}
          </div>
        </div>
      </div>

      {pct != null && (
        <>
          <IveDivider />
          <div style={{ height: 4, background: 'var(--bd-light)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              width: `${Math.min(pct, 100)}%`, height: '100%',
              background: statusColor, borderRadius: 3, transition: 'width 0.3s ease',
            }} />
          </div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 7.5, color: 'var(--tx-4)', marginTop: 4 }}>
            {Math.min(Math.round(pct), 100)}% of budget utilized
          </div>
        </>
      )}
    </div>
  )
}

// ── Year-End Projection widget ────────────────────────────────────────────────

function YearEndWidget({ rr }) {
  if (!rr.hasActuals) {
    return <Empty text="Import transactions to see your year-end projection." />
  }

  return (
    <div>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8.5, letterSpacing: '0.06em', color: 'var(--tx-3)', marginBottom: 8 }}>
        FULL YEAR · ACT+FCST
      </div>
      <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 34, color: 'var(--accent)', lineHeight: 1 }}>
        {fmtK(rr.projectedTotal)}
      </div>

      <IveDivider />

      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8.5, letterSpacing: '0.06em', color: 'var(--tx-3)', marginBottom: 10 }}>
        BREAKDOWN
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, color: 'var(--tx-1)', lineHeight: 1 }}>
            {fmtK(rr.actualToDate)}
          </div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 7.5, color: 'var(--tx-3)', letterSpacing: '0.06em', marginTop: 4 }}>
            ACTUAL YTD
          </div>
        </div>
        <div style={{ width: 1, background: 'var(--accent-bd)', margin: '0 10px', alignSelf: 'stretch', minHeight: 24 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, color: 'var(--forecast-bd)', lineHeight: 1 }}>
            {fmtK(rr.forecastRemaining)}
          </div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 7.5, color: 'var(--tx-3)', letterSpacing: '0.06em', marginTop: 4 }}>
            FORECAST LEFT · {rr.daysLeft}D
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Scenario Plan widget ─────────────────────────────────────────────────────

function ScenarioPlanWidget({ si }) {
  if (!si.hasData) {
    return <Empty text="No scenarios yet. Use the Scenario Planner to model decisions." />
  }

  const sign = (n) => (n >= 0 ? '+' : '−') + fmtK(Math.abs(n))
  const deltaColor = (n) => n > 0 ? 'var(--warn)' : n < 0 ? 'var(--accent)' : 'var(--tx-2)'

  if (!si.hasCommitted) {
    return (
      <>
        <Stat value={si.modeled.length.toString()} label="MODELED SCENARIOS" accent={false} />
        <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--tx-3)', lineHeight: 1.5 }}>
          Promote a scenario to committed to lock it into your plan.
        </div>
      </>
    )
  }

  const displayCommitted = si.committed.slice(0, 3)
  const overflowCount = si.committed.length - displayCommitted.length

  return (
    <>
      <Stat value={sign(si.committedAnnualNet)} label="COMMITTED ANNUAL NET" accent={si.committedAnnualNet <= 0} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 12 }}>
        {displayCommitted.map((c, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 11.5, color: 'var(--tx-1)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
              {c.name}
            </span>
            <span style={{ fontSize: 11, color: deltaColor(c.netTotal), fontVariantNumeric: 'tabular-nums', fontFamily: "'DM Mono', monospace", flexShrink: 0 }}>
              {sign(c.netTotal)}
            </span>
          </div>
        ))}
        {overflowCount > 0 && (
          <div style={{ fontSize: 11, color: 'var(--tx-3)' }}>+{overflowCount} more</div>
        )}
        {si.modeled.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 2 }}>
            {si.modeled.length} modeled (not committed)
          </div>
        )}
      </div>
    </>
  )
}

// ── widget definitions ───────────────────────────────────────────────────────

function buildWidgets(ctx, summary, yearTxns = [], priorYearTxns = []) {
  const sgy = spendByGroupYear(ctx, yearTxns)
  const rr = yearProjection(ctx, yearTxns)
  const bva = budgetVsActual(ctx, yearTxns)
  const spike = cashFlowSpike(ctx)
  const cs = commitmentsSummary(ctx)
  const ws = wealthSummary(ctx)
  const si = scenarioImpact(ctx)
  const ive = incomeVsExpenses(ctx, yearTxns, priorYearTxns)

  return [
    {
      id: 'incomeExpenses',
      title: 'Income vs. Expenses',
      subtitle: 'Year-to-date flow · savings rate',
      render: () => <IncomeVsExpensesWidget ive={ive} />,
    },
    {
      id: 'spendGroup',
      title: 'Spend by Group',
      subtitle: 'Full-year actual + forecast vs. budget',
      render: () => <SpendByGroupWidget sgy={sgy} ctx={ctx} yearTxns={yearTxns} priorYearTxns={priorYearTxns} />,
    },
    {
      id: 'spikes',
      title: 'Cash Flow Spike',
      subtitle: 'Largest single-month commitment demand ahead',
      render: () => spike.hasData ? (
        <>
          <Stat value={fmtK(spike.amount)} label={`NEXT SPIKE · ${spike.month}`} />
          <div style={{ marginTop: 14 }}><MiniStat value={fmtMoney(spike.yearTotal)} label="committed this year" /></div>
        </>
      ) : <Empty text="No upcoming commitment spikes. Add commitments to forecast cash demands." />,
    },
    {
      id: 'budget',
      title: 'Spend vs. Budget',
      subtitle: 'Full-year actual + forecast vs. annual plan',
      render: () => <BvaWidget bva={bva} rr={rr} varThreshold={ctx?.varianceThreshold ?? 10} />,
    },
    {
      id: 'runrate',
      title: 'Year-End Projection',
      subtitle: 'Actuals so far + forecast through Dec 31',
      render: () => <YearEndWidget rr={rr} />,
    },
    {
      id: 'commitments',
      title: 'Commitments',
      subtitle: 'Active long-term obligations this year',
      render: () => cs.totalCount ? (
        <>
          <Stat value={cs.activeCount.toLocaleString()} label="ACTIVE" />
          <div style={{ marginTop: 14 }}><MiniStat value={fmtMoney(cs.yearTotal)} label="this year" /></div>
        </>
      ) : <Empty text="No commitments tracked. Add long-term obligations to forecast them." />,
    },
    {
      id: 'wealth',
      title: 'Wealth Trajectory',
      subtitle: 'Net worth from latest snapshot',
      render: () => ws.hasData ? (
        <>
          <Stat value={fmtK(ws.netWorth)} label="NET WORTH" />
          <div style={{ marginTop: 14 }}><MiniStat value={fmtK(ws.investable)} label="investable" /></div>
        </>
      ) : <Empty text="Add a net worth snapshot to track your trajectory." />,
    },
    {
      id: 'scenarioPlan',
      title: 'Scenario Plan',
      subtitle: 'Committed decisions layered on forecast',
      render: () => <ScenarioPlanWidget si={si} />,
    },
    {
      id: 'activity',
      title: 'Last 12 Months',
      subtitle: 'Transactions, spend & income · trailing 12 months',
      optional: true,
      render: () => (
        <>
          <Stat value={summary.transactionCount.toLocaleString()} label="TRANSACTIONS" />
          <div style={{ display: 'flex', gap: 20, marginTop: 14 }}>
            <MiniStat value={fmtMoney(summary.spendTrailing)} label="spend" />
            <MiniStat value={fmtMoney(summary.incomeTrailing)} label="income" />
          </div>
        </>
      ),
    },
  ]
}

// ── AI Briefing widget (spans full width) ────────────────────────────────────

function BriefingWidget({ userId, ctx, briefing, onGenerated }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function generate() {
    setLoading(true)
    setError(null)
    try {
      const res = await sendAIMessage({
        prompt:
          'Give me a concise briefing (3–5 sentences) on my current financial position. ' +
          'Highlight the single most important thing to watch over the next quarter, grounded in the data. ' +
          'No preamble — just the briefing.',
        context: ctx,
      })
      if (res.status !== 'ok' || !res.text) {
        setError(res.text || 'Could not generate a briefing right now.')
        return
      }
      const summary = summarizeContext(ctx)
      const saved = await saveBriefing(userId, {
        narrative: res.text,
        context_summary: `${summary.transactionCount} txns · ${summary.commitmentCount} commitments · ${summary.budgetYears.length} budget yr(s)`,
        module_context: 'dashboard',
      }).catch(() => ({ narrative: res.text, generated_at: new Date().toISOString() }))
      onGenerated(saved)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ border: '1px solid var(--accent-bd)', borderRadius: 13, background: 'var(--bg-card)', padding: 20, gridColumn: '1 / -1' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--accent)', fontSize: 13 }}>✦</span>
          <div>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--tx-1)' }}>AI Briefing</span>
            <div style={{ fontSize: 10.5, color: 'var(--tx-3)', marginTop: 1 }}>On-demand narrative of your financial position</div>
          </div>
          {briefing?.generated_at && (
            <span style={{ fontSize: 10.5, color: 'var(--tx-3)' }}>
              · {new Date(briefing.generated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
        </div>
        <button onClick={generate} disabled={loading} style={{
          padding: '6px 13px', background: briefing ? 'transparent' : 'var(--accent)',
          color: briefing ? 'var(--accent)' : 'var(--accent-tx-on)',
          border: briefing ? '1px solid var(--accent-bd)' : 'none', borderRadius: 7,
          fontSize: 11.5, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
        }}>
          {loading ? 'Generating…' : briefing ? '↻ Refresh' : 'Generate Briefing'}
        </button>
      </div>
      {error && <div style={{ fontSize: 12.5, color: 'var(--warn)', lineHeight: 1.5 }}>{error}</div>}
      {!error && briefing?.narrative && (
        <div style={{ fontSize: 13.5, color: 'var(--tx-1)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{briefing.narrative}</div>
      )}
      {!error && !briefing && !loading && (
        <Empty text="Generate an on-demand narrative summary of your financial position. Cached after generation to avoid repeat token cost." />
      )}
    </div>
  )
}

// ── Main dashboard ───────────────────────────────────────────────────────────

export default function Dashboard({ context, summary, mobile, userId, periodDefault, periodOptions = [], onThresholdChange }) {
  const [briefing, setBriefing] = useState(null)
  const [configure, setConfigure] = useState(false)
  const [configMenu, setConfigMenu] = useState(false)
  const [addReports, setAddReports] = useState(false)
  const [dragId, setDragId] = useState(null)
  const [activePeriod, setActivePeriod] = useState(periodDefault)
  const [yearTxns, setYearTxns] = useState([])
  const [priorYearTxns, setPriorYearTxns] = useState([])
  const menuRef = useRef(null)

  // Close configure dropdown when clicking outside
  useEffect(() => {
    if (!configMenu) return
    function handler(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setConfigMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [configMenu])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const year = context?.thisYear ?? new Date().getFullYear()
    getTransactionsByMonth(userId, `${year}-01-01`, `${year}-12-31`)
      .then(rows => { if (!cancelled) setYearTxns(rows) })
      .catch(() => { if (!cancelled) setYearTxns([]) })
    return () => { cancelled = true }
  }, [userId, context?.thisYear])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const year = (context?.thisYear ?? new Date().getFullYear()) - 1
    getTransactionsByMonth(userId, `${year}-01-01`, `${year}-12-31`)
      .then(rows => { if (!cancelled) setPriorYearTxns(rows) })
      .catch(() => { if (!cancelled) setPriorYearTxns([]) })
    return () => { cancelled = true }
  }, [userId, context?.thisYear])

  const monthly = useMemo(() => monthlyBudgetVsActual(context, yearTxns), [context, yearTxns])

  const [layout, setLayout] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_LAYOUT)) || DEFAULT_LAYOUT }
    catch { return DEFAULT_LAYOUT }
  })
  const persist = useCallback((next) => {
    setLayout(next)
    try { localStorage.setItem(LS_LAYOUT, JSON.stringify(next)) } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    getLatestBriefing(userId, 'dashboard')
      .then(b => { if (!cancelled) setBriefing(b) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [userId])

  const blocks = useMemo(() => [
    { id: 'monthlyChart', title: 'Monthly Budget vs. Actuals', fullWidth: true, render: () => <BudgetActualsChart data={monthly} mobile={mobile} onThresholdChange={onThresholdChange} /> },
    { id: 'briefing', title: 'AI Briefing', fullWidth: true, render: () => <BriefingWidget userId={userId} ctx={context} briefing={briefing} onGenerated={setBriefing} /> },
    ...buildWidgets(context, summary, yearTxns, priorYearTxns),
  ], [context, summary, yearTxns, priorYearTxns, monthly, mobile, userId, briefing, onThresholdChange])

  const ordered = useMemo(() => {
    const byId = Object.fromEntries(blocks.map(b => [b.id, b]))
    const seen = new Set()
    const result = []
    for (const b of blocks) {
      if (b.fullWidth && !layout.order.includes(b.id)) { result.push(b); seen.add(b.id) }
    }
    for (const id of layout.order) {
      if (byId[id] && !seen.has(id)) { result.push(byId[id]); seen.add(id) }
    }
    for (const b of blocks) if (!seen.has(b.id)) result.push(b)
    return result
  }, [blocks, layout.order])

  const hidden = new Set(layout.hidden)

  function onDrop(targetId) {
    if (!dragId || dragId === targetId) return
    const ids = ordered.map(w => w.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    if (from === -1 || to === -1) return
    const next = [...ids]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    persist({ ...layout, order: next })
    setDragId(null)
  }

  function toggleHidden(id) {
    const h = new Set(layout.hidden)
    h.has(id) ? h.delete(id) : h.add(id)
    persist({ ...layout, hidden: [...h] })
  }

  const visible = ordered.filter(w => !hidden.has(w.id))
  const optionalBlocks = blocks.filter(b => b.optional)

  return (
    <div style={{ maxWidth: CONTENT_MAX, width: '100%', margin: '0 auto' }}>
      <ModuleHeader
        mobile={mobile}
        icon="◉"
        title="Dashboard"
        subtitle="Plan vs. actuals, income, and trajectory at a glance."
        actions={(
          configure ? (
            <button onClick={() => setConfigure(false)} style={{
              background: 'var(--accent-bg)', border: '1px solid var(--accent-bd)',
              borderRadius: 8, padding: '8px 14px', fontFamily: "'DM Mono', monospace",
              fontSize: 10, letterSpacing: '0.05em', color: 'var(--accent)', cursor: 'pointer',
            }}>
              ✓ DONE
            </button>
          ) : (
            <div ref={menuRef} style={{ position: 'relative' }}>
              <button
                onClick={() => { setConfigMenu(m => !m); setAddReports(false) }}
                style={{
                  background: (configMenu || addReports) ? 'var(--accent-bg)' : 'none',
                  border: (configMenu || addReports) ? '1px solid var(--accent-bd)' : '1px solid var(--bd)',
                  borderRadius: 8, padding: '8px 14px', fontFamily: "'DM Mono', monospace",
                  fontSize: 10, letterSpacing: '0.05em',
                  color: (configMenu || addReports) ? 'var(--accent)' : 'var(--tx-2)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                ⊞ CONFIGURE <span style={{ fontSize: 8, opacity: 0.7 }}>▾</span>
              </button>
              {configMenu && (
                <div style={{
                  position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 30,
                  background: 'var(--bg-card)', border: '1px solid var(--bd)',
                  borderRadius: 10, padding: '6px 0', minWidth: 200,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                }}>
                  <MenuItem
                    icon="⊞"
                    label="Customize Layout"
                    desc="Drag, reorder, show or hide cards"
                    onClick={() => { setConfigure(true); setConfigMenu(false) }}
                  />
                  <MenuItem
                    icon="+"
                    label="Add Reports"
                    desc="Show optional data panels"
                    onClick={() => { setAddReports(r => !r); setConfigMenu(false) }}
                  />
                </div>
              )}
            </div>
          )
        )}
      />

      {/* Period filter */}
      {periodOptions.length > 0 && (
        <div style={{ display: 'flex', gap: 7, marginBottom: 22, flexWrap: 'wrap' }}>
          {periodOptions.map(p => {
            const on = p === activePeriod
            return (
              <button key={p} onClick={() => setActivePeriod(p)} style={{
                border: on ? '1px solid var(--accent)' : '1px solid var(--bd)',
                background: on ? 'var(--accent-bg)' : 'var(--bg-card)',
                color: on ? 'var(--accent)' : 'var(--tx-2)', borderRadius: 7,
                padding: '6px 13px', fontFamily: "'DM Mono', monospace", fontSize: 11, cursor: 'pointer',
              }}>{p}</button>
            )
          })}
        </div>
      )}

      {/* Add Reports panel */}
      {addReports && (
        <div style={{ border: '1px solid var(--bd)', borderRadius: 12, padding: '14px 18px', marginBottom: 18, background: 'var(--bg-card)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--tx-1)' }}>Optional Reports</div>
            <button onClick={() => setAddReports(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tx-3)', fontSize: 14 }}>✕</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {optionalBlocks.map(b => {
              const isHidden = hidden.has(b.id)
              return (
                <div key={b.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--bd-light)' }}>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--tx-1)' }}>{b.title}</div>
                    {b.subtitle && <div style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 1 }}>{b.subtitle}</div>}
                  </div>
                  <button
                    onClick={() => toggleHidden(b.id)}
                    style={{
                      padding: '5px 12px', borderRadius: 7, fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                      background: isHidden ? 'var(--accent)' : 'transparent',
                      color: isHidden ? 'var(--accent-tx-on)' : 'var(--tx-3)',
                      border: isHidden ? 'none' : '1px solid var(--bd)',
                    }}
                  >
                    {isHidden ? '+ Add' : '− Remove'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {configure && (
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: 'var(--tx-3)', letterSpacing: '0.04em', marginBottom: 14 }}>
          DRAG TO REARRANGE · TAP THE EYE TO SHOW/HIDE
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
        {(configure ? ordered : visible).map(b => {
          const isHidden = hidden.has(b.id)
          const dragProps = {
            draggable: configure,
            onDragStart: () => setDragId(b.id),
            onDragOver: e => configure && e.preventDefault(),
            onDrop: () => onDrop(b.id),
          }

          if (b.fullWidth) {
            return (
              <div key={b.id} {...dragProps} style={{
                gridColumn: '1 / -1',
                cursor: configure ? 'grab' : 'default',
                opacity: dragId === b.id ? 0.5 : isHidden ? 0.4 : 1,
                outline: dragId === b.id ? '2px solid var(--accent)' : 'none',
                outlineOffset: 3, borderRadius: 14, transition: 'opacity .15s',
              }}>
                {configure && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, padding: '0 2px' }}>
                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, letterSpacing: '0.05em', color: 'var(--tx-3)' }}>⠿ {b.title.toUpperCase()}</span>
                    <button onClick={() => toggleHidden(b.id)} title={isHidden ? 'Show' : 'Hide'} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tx-3)', fontSize: 13 }}>
                      {isHidden ? '◌' : '⏿'}
                    </button>
                  </div>
                )}
                {b.render()}
              </div>
            )
          }

          return (
            <div
              key={b.id}
              {...dragProps}
              style={{
                border: dragId === b.id ? '1px solid var(--accent)' : '1px solid var(--bd)',
                borderRadius: 13, background: 'var(--bg-card)', padding: 20, minHeight: 128,
                cursor: configure ? 'grab' : 'default',
                opacity: dragId === b.id ? 0.5 : isHidden ? 0.4 : 1,
                transition: 'border-color .15s, opacity .15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--tx-1)' }}>{b.title}</div>
                  {b.subtitle && <div style={{ fontSize: 10.5, color: 'var(--tx-3)', marginTop: 2, lineHeight: 1.4 }}>{b.subtitle}</div>}
                </div>
                {configure && (
                  <button onClick={() => toggleHidden(b.id)} title={isHidden ? 'Show' : 'Hide'} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tx-3)', fontSize: 13, flexShrink: 0, marginLeft: 8 }}>
                    {isHidden ? '◌' : '⏿'}
                  </button>
                )}
              </div>
              {b.render()}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MenuItem({ icon, label, desc, onClick }) {
  const [hov, setHov] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px',
        cursor: 'pointer', background: hov ? 'var(--hover)' : 'transparent',
      }}
    >
      <span style={{ fontSize: 13, color: 'var(--accent)', marginTop: 1, width: 16 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--tx-1)' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 1 }}>{desc}</div>
      </div>
    </div>
  )
}

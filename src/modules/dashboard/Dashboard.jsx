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
  cashFlowForecast,
} from '../../lib/dashboard/widgetData.js'
import { getTransactionsByMonth } from '../../lib/db/transactions.js'
import BudgetActualsChart from './BudgetActualsChart.jsx'
import SpendGroupDetail from './SpendGroupDetail.jsx'
import ModuleHeader from '../common/ModuleHeader.jsx'
import { CONTENT_MAX } from '../common/layout.js'
import { getCreditCards, getPointsBalances, getCCSettings, getEarnRates, buildEarnRateMap } from '../../lib/db/creditCards.js'
import { getBudgetCategories } from '../../lib/db/budgetCategories.js'
import { computePointsForecast, estimateTotalValue, estimateMonthlyEarnRate } from '../../lib/creditcards/pointsEngine.js'
import { supabase } from '../../lib/supabase.js'

// v4: adds Cash Flow widget; hides legacy Spike card by default
const LS_LAYOUT = 'acp.dashboard.layout.v4'
const DEFAULT_LAYOUT = { order: [], hidden: ['activity', 'spikes'], collapsed: [] }

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

// ── Shared full-width card wrapper ───────────────────────────────────────────

function WideCard({ title, subtitle, children, onCollapse, isCollapsed }) {
  return (
    <div style={{ border: '1px solid var(--bd)', borderRadius: 14, background: 'var(--bg-card)', padding: isCollapsed ? '13px 22px' : '20px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: isCollapsed ? 0 : 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--tx-1)' }}>{title}</span>
          {subtitle && <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10.5, color: 'var(--tx-3)' }}>{subtitle}</span>}
        </div>
        {onCollapse && (
          <button
            onClick={onCollapse}
            title={isCollapsed ? 'Expand' : 'Collapse'}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tx-4)', fontSize: 13, padding: '0 0 0 4px', lineHeight: 1, flexShrink: 0 }}
          >
            {isCollapsed ? '▸' : '▾'}
          </button>
        )}
      </div>
      {!isCollapsed && children}
    </div>
  )
}

// ── Income vs. Expenses widget ───────────────────────────────────────────────

function IveDivider() {
  return <div style={{ height: 1, background: 'var(--bd)', margin: '16px 0' }} />
}

function IveTooltipRow({ label, value, highlight, border }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: 16,
      fontFamily: "'DM Mono', monospace", fontSize: 10,
      color: highlight === 'accent' ? 'var(--accent)' : highlight === 'warn' ? 'var(--warn)' : 'var(--tx-2)',
      lineHeight: 1.9,
      borderTop: border ? '1px solid var(--bd)' : 'none',
      marginTop: border ? 4 : 0, paddingTop: border ? 4 : 0,
    }}>
      <span style={{ color: 'var(--tx-3)' }}>{label}</span>
      <span>{value}</span>
    </div>
  )
}

const IVE_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function IncomeVsExpensesWidget({ ive, mobile, onCollapse, isCollapsed }) {
  const [hover, setHover] = useState(null)

  const hasForecastIncome = !!ive.monthlyIncomeForecast
  const hasActualIncome = ive.ytdIncome > 0
  const cm = ive.currentMonth ?? 11
  const chartH = mobile ? 130 : 180

  // Per-month chart data: all 12 months
  const chartData = IVE_MONTHS.map((label, m) => {
    const isPast = m <= cm
    const income = isPast ? (ive.monthlyIncome?.[m] ?? 0) : 0
    const incForecast = !isPast ? (ive.monthlyIncomeForecast?.[m] ?? 0) : 0
    const expenses = isPast ? (ive.monthlyExpenses?.[m] ?? 0) : 0
    const expForecast = !isPast ? (ive.monthlyExpenseForecast?.[m] ?? 0) : 0
    return { m, label, income, incForecast, expenses, expForecast, isPast }
  })

  const chartMax = Math.max(
    ...chartData.map(d => Math.max(d.income, d.incForecast, d.expenses, d.expForecast)),
    1
  )

  if (!ive.hasData && !hasForecastIncome) {
    return (
      <WideCard title="Income vs. Expenses" subtitle="Full year · actuals + forecast" onCollapse={onCollapse} isCollapsed={isCollapsed}>
        <Empty text="Import transactions or set annual income in Settings to see your income vs. expense breakdown." />
      </WideCard>
    )
  }

  const netColor = ive.fullYearNet >= 0 ? 'var(--accent)' : 'var(--warn)'
  const paceText = ive.fullYearNet > 0
    ? `On pace to save ${fmtK(ive.fullYearNet)} this year`
    : ive.fullYearNet < 0
      ? `On pace for a ${fmtK(Math.abs(ive.fullYearNet))} deficit this year`
      : 'On pace to break even this year'

  return (
    <WideCard title="Income vs. Expenses" subtitle="Full year · actuals + forecast" onCollapse={onCollapse} isCollapsed={isCollapsed}>
      {/* ── Chart ── */}
      <div style={{ position: 'relative', marginTop: 4 }}>
        {/* Tooltip */}
        {hover !== null && (() => {
          const d = chartData[hover]
          if (!d) return null
          const inc = d.isPast ? d.income : d.incForecast
          const exp = d.isPast ? d.expenses : d.expForecast
          const net = inc - exp
          const isFcst = !d.isPast
          return (
            <div style={{
              position: 'absolute', top: -6, left: '50%', transform: 'translateX(-50%)',
              zIndex: 5, background: 'var(--bg-app)', border: '1px solid var(--bd)',
              borderRadius: 9, padding: '10px 13px', minWidth: 170,
              boxShadow: '0 8px 24px rgba(0,0,0,0.35)', pointerEvents: 'none', whiteSpace: 'nowrap',
            }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, letterSpacing: '0.08em', color: 'var(--tx-3)', textTransform: 'uppercase', marginBottom: 8 }}>
                {d.label}{isFcst ? ' · forecast' : ''}
              </div>
              {(hasActualIncome || hasForecastIncome) && (
                <IveTooltipRow label={isFcst ? 'Income (fcst)' : 'Income'} value={fmtMoney(inc)} highlight="accent" />
              )}
              <IveTooltipRow label={isFcst ? 'Expenses (fcst)' : 'Expenses'} value={fmtMoney(exp)} highlight="warn" />
              {(hasActualIncome || hasForecastIncome) && (
                <IveTooltipRow
                  label="Net"
                  value={(net >= 0 ? '+' : '') + fmtMoney(Math.abs(net))}
                  highlight={net >= 0 ? 'accent' : 'warn'}
                  border
                />
              )}
            </div>
          )
        })()}

        {/* Bars */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: mobile ? 3 : 8, height: chartH }}>
          {chartData.map((d) => {
            const showInc = hasActualIncome || hasForecastIncome
            const incVal = d.isPast ? d.income : d.incForecast
            const expVal = d.isPast ? d.expenses : d.expForecast
            const incH = showInc ? (incVal / chartMax) * chartH : 0
            const expH = (expVal / chartMax) * chartH
            const isHov = hover === d.m
            const isFcst = !d.isPast
            return (
              <div
                key={d.m}
                onMouseEnter={() => setHover(d.m)}
                onMouseLeave={() => setHover(null)}
                style={{
                  flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                  gap: mobile ? 1 : 2, height: '100%', position: 'relative', cursor: 'default',
                  background: isHov ? 'var(--hover)' : 'transparent', borderRadius: 5,
                }}
              >
                {/* Income bar */}
                {showInc && (
                  <div style={{
                    width: mobile ? 8 : '48%', maxWidth: 28,
                    height: Math.max(incH, 2),
                    background: isFcst ? 'var(--forecast-fill)' : 'var(--accent)',
                    border: isFcst ? '1px dashed var(--accent)' : 'none',
                    borderRadius: '3px 3px 0 0',
                    opacity: isHov ? 1 : isFcst ? 0.9 : 0.88,
                    boxSizing: 'border-box',
                  }} />
                )}
                {/* Expense bar */}
                <div style={{
                  width: mobile ? 8 : '48%', maxWidth: 28,
                  height: Math.max(expH, 2),
                  background: isFcst ? 'var(--forecast-fill)' : 'var(--warn)',
                  border: isFcst ? '1px dashed var(--warn)' : 'none',
                  borderRadius: '3px 3px 0 0',
                  opacity: isHov ? 1 : isFcst ? 0.9 : 0.8,
                  boxSizing: 'border-box',
                }} />

                {/* TODAY marker */}
                {d.m === cm && (
                  <div style={{ position: 'absolute', right: -3, top: -14, bottom: 0, borderRight: '1px dashed var(--forecast-bd)' }}>
                    <span style={{
                      position: 'absolute', top: -2, right: 4, whiteSpace: 'nowrap',
                      fontFamily: "'DM Mono', monospace", fontSize: 8.5, letterSpacing: '0.08em', color: 'var(--tx-3)',
                    }}>TODAY</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Month labels */}
        <div style={{ display: 'flex', gap: mobile ? 3 : 8, marginTop: 8 }}>
          {IVE_MONTHS.map((label, m) => (
            <div key={m} style={{
              flex: 1, textAlign: 'center',
              fontFamily: "'DM Mono', monospace", fontSize: mobile ? 8.5 : 10,
              color: m === cm ? 'var(--accent)' : 'var(--tx-3)', letterSpacing: '0.02em',
            }}>
              {mobile ? label[0] : label}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: mobile ? 10 : 18, marginTop: 10, flexWrap: 'wrap' }}>
          {(hasActualIncome || hasForecastIncome) && (
            <IveLegendDot solid color="var(--accent)" label="Income" />
          )}
          <IveLegendDot solid color="var(--warn)" label="Expenses" />
          {(hasActualIncome || hasForecastIncome) && (
            <IveLegendDot dashed borderColor="var(--accent)" label="Income fcst" />
          )}
          <IveLegendDot dashed borderColor="var(--warn)" label="Expense fcst" />
        </div>
      </div>

      {/* ── KPIs below chart ── */}
      <IveDivider />
      <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: mobile ? 14 : 20 }}>
        {/* Full-year savings rate */}
        <div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, letterSpacing: '0.06em', color: 'var(--tx-3)', marginBottom: 4 }}>
            FULL YEAR SAVINGS RATE
          </div>
          <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 28, color: ive.fullYearSavingsRate != null ? (ive.fullYearSavingsRate >= 0 ? 'var(--accent)' : 'var(--warn)') : 'var(--tx-3)', lineHeight: 1 }}>
            {ive.fullYearSavingsRate != null ? Math.round(ive.fullYearSavingsRate) + '%' : '—'}
          </div>
          {ive.priorYearSavingsRate != null && ive.fullYearSavingsRate != null && (() => {
            const delta = Math.round(ive.fullYearSavingsRate) - Math.round(ive.priorYearSavingsRate)
            const c = delta > 0 ? 'var(--accent)' : delta < 0 ? 'var(--warn)' : 'var(--tx-3)'
            const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→'
            return (
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8.5, color: c, marginTop: 4 }}>
                {arrow}{Math.abs(delta)}pp vs. last yr
              </div>
            )
          })()}
        </div>

        {/* Full-year income */}
        {(hasActualIncome || hasForecastIncome) && (
          <div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, letterSpacing: '0.06em', color: 'var(--tx-3)', marginBottom: 4 }}>
              FULL YEAR INCOME
            </div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 18, color: 'var(--tx-1)', lineHeight: 1 }}>
              {fmtK(ive.fullYearIncome)}
            </div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8.5, color: 'var(--tx-3)', marginTop: 4 }}>
              {hasForecastIncome ? 'act + salary fcst' : 'act + avg fcst'}
            </div>
          </div>
        )}

        {/* Full-year expenses */}
        <div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, letterSpacing: '0.06em', color: 'var(--tx-3)', marginBottom: 4 }}>
            FULL YEAR EXPENSES
          </div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 18, color: 'var(--tx-1)', lineHeight: 1 }}>
            {fmtK(ive.fullYearExpenses)}
          </div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8.5, color: 'var(--tx-3)', marginTop: 4 }}>
            act + budget fcst
          </div>
        </div>

        {/* Full-year net */}
        <div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, letterSpacing: '0.06em', color: 'var(--tx-3)', marginBottom: 4 }}>
            FULL YEAR NET
          </div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 18, color: netColor, lineHeight: 1 }}>
            {(ive.fullYearNet >= 0 ? '+' : '') + fmtK(ive.fullYearNet)}
          </div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8.5, color: netColor, marginTop: 4, lineHeight: 1.3 }}>
            {paceText}
          </div>
        </div>
      </div>

      {/* YTD row + top spend */}
      {ive.hasData && (
        <>
          <IveDivider />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <IveKpi label="YTD SAVINGS RATE" value={ive.savingsRate != null ? Math.round(ive.savingsRate) + '%' : '—'} color={ive.savingsRate != null ? (ive.savingsRate >= 0 ? 'var(--accent)' : 'var(--warn)') : 'var(--tx-3)'} />
              {hasActualIncome && <IveKpi label="YTD INCOME" value={fmtK(ive.ytdIncome)} color="var(--tx-1)" />}
              <IveKpi label="YTD EXPENSES" value={fmtK(ive.ytdExpenses)} color="var(--tx-1)" />
              <IveKpi label="YTD NET" value={(ive.ytdNet >= 0 ? '+' : '') + fmtK(ive.ytdNet)} color={ive.ytdNet >= 0 ? 'var(--accent)' : 'var(--warn)'} />
            </div>
            {ive.topYtdGroup && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 9px', background: 'var(--accent-bg)', border: '1px solid var(--accent-bd)', borderRadius: 5, alignSelf: 'flex-start', marginTop: 2 }}>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 7.5, color: 'var(--tx-3)', letterSpacing: '0.05em' }}>TOP SPEND</span>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: 'var(--tx-2)' }}>{ive.topYtdGroup.name} · {fmtK(ive.topYtdGroup.amount)}</span>
              </div>
            )}
          </div>
        </>
      )}
    </WideCard>
  )
}

function IveLegendDot({ solid, dashed, color, borderColor, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: 'var(--tx-4)', letterSpacing: '0.03em' }}>
      <span style={{
        width: 9, height: 9, borderRadius: 2, display: 'inline-block', flexShrink: 0,
        background: solid ? color : 'var(--forecast-fill)',
        border: dashed ? `1px dashed ${borderColor}` : 'none',
        boxSizing: 'border-box',
      }} />
      {label}
    </span>
  )
}

function IveKpi({ label, value, color }) {
  return (
    <div>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, letterSpacing: '0.06em', color: 'var(--tx-3)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, color, lineHeight: 1 }}>{value}</div>
    </div>
  )
}

// ── Spend by Group widget ────────────────────────────────────────────────────
// Full-year actual + forecast (one bar, two tones) vs. the blue budget bar,
// with per-group data labels on hover.

function SpendByGroupWidget({ sgy, ctx, yearTxns, priorYearTxns, mobile, onCollapse, isCollapsed }) {
  const [hover, setHover] = useState(null)
  const [selectedGroup, setSelectedGroup] = useState(null)

  if (!sgy.rows.length) {
    return (
      <WideCard title="Spend by Group" subtitle="Full-year actual + forecast vs. budget" onCollapse={onCollapse} isCollapsed={isCollapsed}>
        <Empty text="No budget or spending data for this year yet." />
      </WideCard>
    )
  }

  const varRatio = (ctx?.varianceThreshold ?? 10) / 100
  const max = sgy.max
  return (
    <WideCard title="Spend by Group" subtitle="Full-year actual + forecast vs. budget" onCollapse={onCollapse} isCollapsed={isCollapsed}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {sgy.rows.map(r => {
          const over    = r.budget > 0 && r.projected > r.budget * (1 + varRatio)
          const under   = r.budget > 0 && r.projected < r.budget * (1 - varRatio)
          const onTrack = r.budget > 0 && !over && !under
          const actualColor = over ? 'var(--warn)' : onTrack ? 'var(--green)' : 'var(--accent)'
          const isHover = hover === r.group
          const actualW   = (r.actual   / max) * 100
          const forecastW = (r.forecast / max) * 100
          const budgetW   = (r.budget   / max) * 100
          return (
            <div
              key={r.group}
              onMouseEnter={() => setHover(r.group)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setSelectedGroup(r.group)}
              style={{ position: 'relative', cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, marginBottom: 5 }}>
                <span style={{ color: 'var(--tx-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: mobile ? 120 : 280 }}>{r.group}</span>
                <span style={{ color: actualColor, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
                  {fmtK(r.projected)}{r.budget > 0 ? ` / ${fmtK(r.budget)}` : ''}
                </span>
              </div>
              <div style={{ display: 'flex', height: 8, background: 'var(--bd-light)', borderRadius: 3, overflow: 'hidden', marginBottom: 3 }}>
                <div style={{ width: `${actualW}%`, height: '100%', background: actualColor }} />
                <div style={{ width: `${forecastW}%`, height: '100%', background: 'var(--forecast-bd)' }} />
              </div>
              {r.budget > 0 && (
                <div style={{ height: 4, background: 'var(--bd-light)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${budgetW}%`, height: '100%', background: 'var(--bar-budget)', borderRadius: 2 }} />
                </div>
              )}
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
                  <SgRow label="Actual (YTD)"     value={fmtMoney(r.actual)}    color="var(--tx-1)" />
                  <SgRow label="Forecast (rest)"   value={fmtMoney(r.forecast)}  color="var(--forecast-bd)" />
                  <SgRow label="Actual + Forecast" value={fmtMoney(r.projected)} color={actualColor} bold />
                  <SgRow label="Budget"            value={r.budget > 0 ? fmtMoney(r.budget) : '—'} color="var(--bar-budget-tx)" />
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
        <div style={{ display: 'flex', gap: 14, fontSize: 9.5, color: 'var(--tx-4)', fontFamily: "'DM Mono', monospace", letterSpacing: '0.03em', flexWrap: 'wrap', marginTop: 2 }}>
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
    </WideCard>
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

// ── Tooltip primitives used by BvaWidget ────────────────────────────────────

function IveTooltip({ visible, children }) {
  if (!visible) return null
  return (
    <div style={{
      position: 'absolute', top: 'calc(100% + 6px)', left: 0,
      background: 'var(--bg-app)', border: '1px solid var(--bd)',
      borderRadius: 9, padding: '10px 13px', minWidth: 200, zIndex: 40,
      boxShadow: '0 8px 24px rgba(0,0,0,0.35)', pointerEvents: 'none', whiteSpace: 'nowrap',
    }}>
      {children}
    </div>
  )
}

function TooltipHeader({ text }) {
  return (
    <div style={{
      fontFamily: "'DM Mono', monospace", fontSize: 8.5, letterSpacing: '0.06em',
      color: 'var(--tx-3)', marginBottom: 8, textTransform: 'uppercase',
    }}>
      {text}
    </div>
  )
}

function TooltipRow({ label, value, border }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: 16,
      fontSize: 12, padding: '2px 0',
      borderTop: border ? '1px solid var(--bd)' : 'none',
      marginTop: border ? 4 : 0, paddingTop: border ? 4 : 0,
    }}>
      <span style={{ color: 'var(--tx-3)' }}>{label}</span>
      <span style={{ color: 'var(--tx-1)', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{value}</span>
    </div>
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

// ── Points Summary widget ────────────────────────────────────────────────────

function PointsSummaryWidget({ userId }) {
  const [data, setData] = useState(null)
  const year = new Date().getFullYear()

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    async function load() {
      try {
        const [cards, balances, settings, rates, cats] = await Promise.all([
          getCreditCards(userId),
          getPointsBalances(userId),
          getCCSettings(userId),
          getEarnRates(userId),
          getBudgetCategories(userId),
        ])
        if (!cancelled && cards.length > 0) {
          const [{ data: lineItems }, { data: forecastLines }] = await Promise.all([
            supabase.from('budget_line_items').select('*').eq('user_id', userId).eq('budget_year', year),
            supabase.from('forecast_line_items').select('*').eq('user_id', userId).eq('budget_year', year),
          ])
          const earnRateMap = buildEarnRateMap(rates)
          const { monthlyForecast } = computePointsForecast({
            cards, earnRateMap, budgetCategories: cats,
            lineItems: lineItems ?? [], forecastLines: forecastLines ?? [],
            pointsBalances: balances, redemptions: [],
            coveragePct: settings.coveragePct, optimizationPct: settings.optimizationPct, year,
          })
          if (!cancelled) {
            setData({
              cards,
              totalPts: Object.values(balances).reduce((s, b) => s + (b?.balance ?? 0), 0),
              totalValue: estimateTotalValue(cards, balances),
              monthlyRate: estimateMonthlyEarnRate(monthlyForecast),
            })
          }
        }
      } catch { /* widget-level failure is silent */ }
    }
    load()
    return () => { cancelled = true }
  }, [userId, year])

  if (!data) return <Empty text="Set up credit cards to see points summary." />

  return (
    <>
      <Stat value={data.totalPts.toLocaleString()} label="TOTAL POINTS" />
      <div style={{ display: 'flex', gap: 20, marginTop: 14 }}>
        <MiniStat value={'$' + Math.round(data.totalValue).toLocaleString()} label="est. value" />
        <MiniStat value={data.monthlyRate.toLocaleString()} label="pts/mo forecast" />
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        {data.cards.map(c => (
          <div key={c.id} style={{
            display: 'flex', alignItems: 'center', gap: 4,
            fontFamily: "'DM Mono', monospace", fontSize: 9, color: 'var(--tx-3)',
          }}>
            <div style={{ width: 6, height: 6, borderRadius: 1, background: c.color || '#3B82F6' }} />
            {c.name}
          </div>
        ))}
      </div>
    </>
  )
}

// ── Cash Flow widget ─────────────────────────────────────────────────────────

function CashFlowWidget({ cf, mobile, onCollapse, isCollapsed }) {
  const [hover, setHover] = useState(null)
  const chartH = mobile ? 110 : 150

  if (!cf.hasData) {
    return (
      <WideCard title="Cash Flow" subtitle="Full year · actuals + forecast" onCollapse={onCollapse} isCollapsed={isCollapsed}>
        <Empty text="Add commitments or a budget with Non-Monthly items to see upcoming cash demands." />
      </WideCard>
    )
  }

  return (
    <WideCard title="Cash Flow" subtitle="Full year · actuals + forecast" onCollapse={onCollapse} isCollapsed={isCollapsed}>
      <div style={{ position: 'relative', marginTop: 4 }}>
        {/* Tooltip */}
        {hover !== null && cf.data[hover] && (() => {
          const d = cf.data[hover]
          return (
            <div style={{
              position: 'absolute', top: -6, left: '50%', transform: 'translateX(-50%)',
              zIndex: 5, background: 'var(--bg-app)', border: '1px solid var(--bd)',
              borderRadius: 9, padding: '10px 13px', minWidth: 210,
              boxShadow: '0 8px 24px rgba(0,0,0,0.35)', pointerEvents: 'none', whiteSpace: 'nowrap',
            }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, letterSpacing: '0.08em', color: 'var(--tx-3)', textTransform: 'uppercase', marginBottom: 8 }}>
                {d.label}{d.year !== new Date().getFullYear() ? ' ' + d.year : ''}
              </div>
              {d.isActual ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 11.5, padding: '2px 0' }}>
                  <span style={{ color: 'var(--tx-3)' }}>Actual spending</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(d.total)}</span>
                </div>
              ) : d.sources.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--tx-3)' }}>No planned demand this month</div>
              ) : (
                d.sources.map((s, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 11.5, padding: '2px 0' }}>
                    <span style={{ color: 'var(--tx-3)' }}>{s.name}</span>
                    <span style={{ color: s.kind === 'commitment' ? 'var(--accent)' : 'var(--tx-2)', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(s.amount)}</span>
                  </div>
                ))
              )}
              {!d.isActual && d.sources.length > 1 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 11.5, padding: '2px 0', marginTop: 4, borderTop: '1px solid var(--bd)', fontWeight: 600, paddingTop: 4 }}>
                  <span style={{ color: 'var(--tx-3)' }}>Total</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(d.total)}</span>
                </div>
              )}
            </div>
          )
        })()}

        {/* Bars */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: mobile ? 6 : 14, height: chartH }}>
          {cf.data.map((d, i) => {
            const isSpike = !d.isActual && d.total > 0 && d.total === cf.max
            const isHov = hover === i
            const totalH = cf.max > 0 ? Math.max((d.total / cf.max) * chartH, d.total > 0 ? 3 : 0) : 0
            const baseColor = isSpike ? 'var(--warn)' : 'var(--accent)'

            return (
              <div
                key={i}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                style={{
                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'flex-end', height: '100%',
                  background: isHov ? 'var(--hover)' : 'transparent', borderRadius: 5, cursor: 'default',
                }}
              >
                {d.total > 0 ? (
                  d.isActual ? (
                    <div style={{ width: mobile ? '75%' : '65%', maxWidth: 44, height: totalH, borderRadius: '3px 3px 0 0', background: 'var(--accent)', opacity: isHov ? 0.65 : 0.4 }} />
                  ) : (
                    <div style={{ width: mobile ? '75%' : '65%', maxWidth: 44, borderRadius: '3px 3px 0 0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                      {(() => {
                        const commitRatio = d.total > 0 ? d.commitmentDemand / d.total : 0
                        const commitH = totalH * commitRatio
                        const budgetH = totalH - commitH
                        return <>
                          {budgetH > 0 && <div style={{ height: budgetH, background: baseColor, opacity: isHov ? 0.65 : 0.45 }} />}
                          {commitH > 0 && <div style={{ height: commitH, background: baseColor, opacity: isHov ? 1 : 0.85 }} />}
                        </>
                      })()}
                    </div>
                  )
                ) : (
                  <div style={{ width: '65%', height: 2, background: 'var(--bd)', borderRadius: 1 }} />
                )}
              </div>
            )
          })}
        </div>

        {/* Month labels + TODAY marker */}
        <div style={{ display: 'flex', gap: mobile ? 6 : 14, marginTop: 6 }}>
          {cf.data.map((d, i) => (
            <div key={i} style={{
              flex: 1, textAlign: 'center',
              fontFamily: "'DM Mono', monospace", fontSize: mobile ? 9 : 10,
              color: i === cf.todayIdx ? 'var(--accent)' : 'var(--tx-3)', letterSpacing: '0.02em',
            }}>
              {i === cf.todayIdx && <div style={{ fontSize: 7, color: 'var(--accent)', marginBottom: 1 }}>▼</div>}
              {d.label}
            </div>
          ))}
        </div>

        {/* Amount labels */}
        <div style={{ display: 'flex', gap: mobile ? 6 : 14, marginTop: 3 }}>
          {cf.data.map((d, i) => {
            const isSpike = d.total > 0 && d.total === cf.max
            return (
              <div key={i} style={{
                flex: 1, textAlign: 'center',
                fontFamily: "'DM Mono', monospace", fontSize: mobile ? 8 : 9,
                color: isSpike ? 'var(--warn)' : d.total > 0 ? 'var(--tx-2)' : 'var(--tx-4)',
              }}>
                {d.total > 0 ? fmtK(d.total) : '—'}
              </div>
            )
          })}
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
          <CfLegend baseColor="var(--accent)" opacity={0.4} label="Actuals" />
          <CfLegend baseColor="var(--accent)" opacity={0.85} label="Commitments" />
          <CfLegend baseColor="var(--accent)" opacity={0.45} label="Non-monthly budget" />
          <CfLegend baseColor="var(--warn)" opacity={0.85} label="Highest month" />
        </div>
      </div>

      {/* Period summary */}
      <IveDivider />
      <div style={{ display: 'flex', gap: 28 }}>
        {cf.halves.map((h, i) => (
          <div key={i}>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, letterSpacing: '0.06em', color: 'var(--tx-3)', marginBottom: 3 }}>
              {h.label}
            </div>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, color: h.total > 0 ? 'var(--tx-1)' : 'var(--tx-4)' }}>
              {h.total > 0 ? fmtK(h.total) : '—'}
            </div>
          </div>
        ))}
      </div>
    </WideCard>
  )
}

function CfLegend({ baseColor, opacity, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: 'var(--tx-4)', letterSpacing: '0.03em' }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, display: 'inline-block', flexShrink: 0, background: baseColor, opacity, boxSizing: 'border-box' }} />
      {label}
    </span>
  )
}

// ── widget definitions ───────────────────────────────────────────────────────

function buildWidgets(ctx, summary, yearTxns = [], priorYearTxns = [], mobile = false) {
  const sgy = spendByGroupYear(ctx, yearTxns, 12)
  const rr = yearProjection(ctx, yearTxns)
  const bva = budgetVsActual(ctx, yearTxns)
  const spike = cashFlowSpike(ctx)
  const cs = commitmentsSummary(ctx)
  const ws = wealthSummary(ctx)
  const si = scenarioImpact(ctx)
  const ive = incomeVsExpenses(ctx, yearTxns, priorYearTxns)
  const cf = cashFlowForecast(ctx, yearTxns)

  return [
    {
      id: 'incomeExpenses',
      title: 'Income vs. Expenses',
      subtitle: 'Year-to-date flow · savings rate',
      fullWidth: true,
      render: ({ onCollapse, isCollapsed } = {}) => <IncomeVsExpensesWidget ive={ive} mobile={mobile} onCollapse={onCollapse} isCollapsed={isCollapsed} />,
    },
    {
      id: 'cashFlow',
      title: 'Cash Flow',
      subtitle: 'Full year · actuals + forecast',
      fullWidth: true,
      render: ({ onCollapse, isCollapsed } = {}) => <CashFlowWidget cf={cf} mobile={mobile} onCollapse={onCollapse} isCollapsed={isCollapsed} />,
    },
    {
      id: 'spendGroup',
      title: 'Spend by Group',
      subtitle: 'Full-year actual + forecast vs. budget',
      fullWidth: true,
      render: ({ onCollapse, isCollapsed } = {}) => <SpendByGroupWidget sgy={sgy} ctx={ctx} yearTxns={yearTxns} priorYearTxns={priorYearTxns} mobile={mobile} onCollapse={onCollapse} isCollapsed={isCollapsed} />,
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

// ── Main dashboard ───────────────────────────────────────────────────────────

export default function Dashboard({ context, summary, mobile, userId, yearTxns: yearTxnsProp, periodDefault, periodOptions = [], reloadSignal, onThresholdChange }) {
  const [configure, setConfigure] = useState(false)
  const [configMenu, setConfigMenu] = useState(false)
  const [addReports, setAddReports] = useState(false)
  const [dragId, setDragId] = useState(null)
  const [activePeriod, setActivePeriod] = useState(periodDefault)
  const [yearTxnsLocal, setYearTxnsLocal] = useState([])
  const yearTxns = yearTxnsProp ?? yearTxnsLocal
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

  // Only fetch locally if the parent (AppShell) didn't provide yearTxns.
  useEffect(() => {
    if (yearTxnsProp !== undefined) return
    if (!userId) return
    let cancelled = false
    const year = context?.thisYear ?? new Date().getFullYear()
    getTransactionsByMonth(userId, `${year}-01-01`, `${year}-12-31`)
      .then(rows => { if (!cancelled) setYearTxnsLocal(rows) })
      .catch(() => { if (!cancelled) setYearTxnsLocal([]) })
    return () => { cancelled = true }
  }, [userId, context?.thisYear, reloadSignal, yearTxnsProp])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const year = (context?.thisYear ?? new Date().getFullYear()) - 1
    getTransactionsByMonth(userId, `${year}-01-01`, `${year}-12-31`)
      .then(rows => { if (!cancelled) setPriorYearTxns(rows) })
      .catch(() => { if (!cancelled) setPriorYearTxns([]) })
    return () => { cancelled = true }
  }, [userId, context?.thisYear])

  const [scenarioMode, setScenarioMode] = useState('all')
  const committedScenarios = useMemo(
    () => (context?.scenarios ?? []).filter(s => s.state === 'committed'),
    [context]
  )

  const monthly = useMemo(() => monthlyBudgetVsActual(context, yearTxns, scenarioMode), [context, yearTxns, scenarioMode])

  const [layout, setLayout] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_LAYOUT)) || DEFAULT_LAYOUT }
    catch { return DEFAULT_LAYOUT }
  })
  const persist = useCallback((next) => {
    setLayout(next)
    try { localStorage.setItem(LS_LAYOUT, JSON.stringify(next)) } catch { /* ignore */ }
  }, [])

  const blocks = useMemo(() => [
    { id: 'monthlyChart', title: 'Monthly Budget vs. Actuals', fullWidth: true, render: ({ onCollapse, isCollapsed } = {}) => <BudgetActualsChart data={monthly} mobile={mobile} onThresholdChange={onThresholdChange} onCollapse={onCollapse} isCollapsed={isCollapsed} scenarioMode={scenarioMode} onScenarioModeChange={setScenarioMode} committedScenarios={committedScenarios} /> },
    { id: 'creditPoints', title: 'Credit Card Points', subtitle: 'Balance · earning rate · estimated value', render: () => <PointsSummaryWidget userId={userId} /> },
    ...buildWidgets(context, summary, yearTxns, priorYearTxns, mobile),
  ], [context, summary, yearTxns, priorYearTxns, monthly, mobile, userId, onThresholdChange, scenarioMode, committedScenarios])

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

  const collapsedSet = new Set(layout.collapsed ?? [])
  const allCollapsed = visible.length > 0 && visible.every(b => collapsedSet.has(b.id))

  function toggleCollapsed(id) {
    const c = new Set(layout.collapsed ?? [])
    c.has(id) ? c.delete(id) : c.add(id)
    persist({ ...layout, collapsed: [...c] })
  }
  function collapseAll() { persist({ ...layout, collapsed: visible.map(b => b.id) }) }
  function expandAll() { persist({ ...layout, collapsed: [] }) }

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
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={allCollapsed ? expandAll : collapseAll}
                style={{
                  background: 'none', border: '1px solid var(--bd)',
                  borderRadius: 8, padding: '8px 14px', fontFamily: "'DM Mono', monospace",
                  fontSize: 10, letterSpacing: '0.05em', color: 'var(--tx-2)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                {allCollapsed ? '▸' : '▾'} {allCollapsed ? 'EXPAND' : 'COLLAPSE'}
              </button>
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
          const isCollapsed = collapsedSet.has(b.id)
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
                {b.render({ onCollapse: () => toggleCollapsed(b.id), isCollapsed })}
              </div>
            )
          }

          return (
            <div
              key={b.id}
              {...dragProps}
              style={{
                border: dragId === b.id ? '1px solid var(--accent)' : '1px solid var(--bd)',
                borderRadius: 13, background: 'var(--bg-card)',
                padding: isCollapsed ? '13px 20px' : 20,
                minHeight: isCollapsed ? 0 : 128,
                cursor: configure ? 'grab' : 'default',
                opacity: dragId === b.id ? 0.5 : isHidden ? 0.4 : 1,
                transition: 'border-color .15s, opacity .15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: isCollapsed ? 0 : 14 }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--tx-1)' }}>{b.title}</div>
                  {!isCollapsed && b.subtitle && <div style={{ fontSize: 10.5, color: 'var(--tx-3)', marginTop: 2, lineHeight: 1.4 }}>{b.subtitle}</div>}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, marginLeft: 8 }}>
                  {configure && (
                    <button onClick={() => toggleHidden(b.id)} title={isHidden ? 'Show' : 'Hide'} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tx-3)', fontSize: 13 }}>
                      {isHidden ? '◌' : '⏿'}
                    </button>
                  )}
                  <button
                    onClick={() => toggleCollapsed(b.id)}
                    title={isCollapsed ? 'Expand' : 'Collapse'}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tx-4)', fontSize: 13, padding: 0, lineHeight: 1 }}
                  >
                    {isCollapsed ? '▸' : '▾'}
                  </button>
                </div>
              </div>
              {!isCollapsed && b.render()}
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

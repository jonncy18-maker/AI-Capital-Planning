import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  getScenarios,
  createScenario,
  deleteScenario,
  promoteToCommitted,
  getAdjustments,
  addAdjustment,
  deleteAdjustment,
} from '../../lib/db/scenarios.js'
import { getBudgetCategories } from '../../lib/db/budgetCategories.js'
import { runScenarioAgent } from '../../lib/ai/scenarioAgent.js'
import { headerStyles } from '../common/headerStyles.js'
import Markdown from '../common/Markdown.jsx'
import { computeImpactSummary, buildComparisonRows, buildCumulativeTimeline } from '../../lib/scenarios/scenarioUtils.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const CUR_YEAR = new Date().getFullYear()
const CUR_MONTH = new Date().getMonth() // 0-indexed

function fmt(n) {
  const abs = Math.abs(n)
  const s = abs >= 1000 ? '$' + (abs / 1000).toFixed(1) + 'k' : '$' + Math.round(abs).toLocaleString()
  return n < 0 ? '-' + s : '+' + s
}

function fmtFull(n) {
  return (n < 0 ? '-$' : n > 0 ? '+$' : '$') + Math.abs(Math.round(n)).toLocaleString()
}

function fmtAbs(n) {
  return '$' + Math.abs(Math.round(n)).toLocaleString()
}

function fmtShort(n) {
  const abs = Math.abs(n)
  if (abs >= 1000) return '$' + (abs / 1000).toFixed(1) + 'k'
  return '$' + Math.round(abs)
}

// ── Tooltip ─────────────────────────────────────────────────────────────────

function HoverTooltip({ tooltip, children }) {
  return (
    <>
      {children}
      {tooltip && (
        <div style={{
          position: 'fixed',
          top: tooltip.clientY - 10,
          left: tooltip.clientX + 14,
          zIndex: 300,
          background: 'var(--bg-card)',
          border: '1px solid var(--bd)',
          borderRadius: 9,
          padding: '10px 14px',
          boxShadow: '0 6px 22px rgba(0,0,0,0.18)',
          pointerEvents: 'none',
          fontSize: 12,
          minWidth: 160,
        }}>
          {tooltip.content}
        </div>
      )}
    </>
  )
}

// ── Impact summary strip ─────────────────────────────────────────────────────

function ImpactSummaryStrip({ summary }) {
  if (!summary || summary.monthCount === 0) return null

  const signedFmt = (n) => {
    const abs = Math.abs(n)
    const s = abs >= 1000 ? '$' + (abs / 1000).toFixed(1) + 'k' : '$' + Math.round(abs)
    return (n < 0 ? '−' : '+') + s
  }

  const labelStyle = {
    fontFamily: "'DM Mono', monospace",
    fontSize: 9,
    color: 'var(--tx-3)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: 3,
  }
  const valStyle = (color) => ({
    fontSize: 14,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    color,
  })

  const deltaColor = (n) => n < 0 ? 'var(--green)' : n > 0 ? 'var(--red)' : 'var(--tx-2)'

  const segments = [
    { label: 'Monthly avg', value: signedFmt(summary.monthlyAvg), color: deltaColor(summary.monthlyAvg) },
    { label: 'Annualized', value: signedFmt(summary.annualized), color: deltaColor(summary.annualized) },
    ...(summary.hasIncome && summary.pctOfIncome != null ? [{
      label: 'Of monthly income',
      value: Math.round(summary.pctOfIncome) + '%',
      color: summary.pctOfIncome > 20 ? 'var(--red)' : summary.pctOfIncome > 10 ? 'var(--warn)' : 'var(--tx-1)',
      sub: `~${signedFmt(summary.incomeRunRate)}/mo income`,
    }] : []),
    { label: 'Horizon', value: summary.horizon, color: 'var(--tx-2)', isText: true },
  ]

  return (
    <div style={{
      display: 'flex', border: '1px solid var(--bd)', borderRadius: 8,
      overflow: 'hidden', marginTop: 14, background: 'var(--bg-app)', flexShrink: 0,
    }}>
      {segments.map((seg, i) => (
        <div key={i} style={{
          flex: 1, padding: '9px 14px',
          borderRight: i < segments.length - 1 ? '1px solid var(--bd)' : 'none', minWidth: 0,
        }}>
          <div style={labelStyle}>{seg.label}</div>
          <div style={seg.isText ? { fontSize: 12, color: seg.color, fontWeight: 500 } : valStyle(seg.color)}>
            {seg.value}
          </div>
          {seg.sub && <div style={{ fontSize: 9.5, color: 'var(--tx-3)', marginTop: 2 }}>{seg.sub}</div>}
        </div>
      ))}
    </div>
  )
}

// ── State badge ──────────────────────────────────────────────────────────────

function StateBadge({ state }) {
  const committed = state === 'committed'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 9px', borderRadius: 10, fontSize: 11, fontWeight: 600,
      letterSpacing: '0.05em', textTransform: 'uppercase',
      background: committed ? 'rgba(46,204,113,0.12)' : 'rgba(0,194,168,0.1)',
      color: committed ? 'var(--green)' : 'var(--accent)',
      border: `1px solid ${committed ? 'rgba(46,204,113,0.25)' : 'var(--accent-bd)'}`,
    }}>
      {committed ? '✓ Committed' : '◑ Modeled'}
    </span>
  )
}

// ── Scenario list item ───────────────────────────────────────────────────────

function ScenarioListItem({ scenario, selected, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px',
      background: selected ? 'var(--accent-bg)' : 'transparent', border: 'none',
      borderLeft: `2px solid ${selected ? 'var(--accent)' : 'transparent'}`,
      color: 'var(--tx-1)', cursor: 'pointer', borderRadius: '0 6px 6px 0',
      marginBottom: 2, transition: 'background 0.15s',
    }}>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 3, color: selected ? 'var(--accent)' : 'var(--tx-1)' }}>
        {scenario.name}
      </div>
      {scenario.description && (
        <div style={{ fontSize: 11, color: 'var(--tx-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {scenario.description}
        </div>
      )}
      <div style={{ fontSize: 10, color: 'var(--tx-3)', marginTop: 4 }}>
        {new Date(scenario.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </div>
    </button>
  )
}

// ── New scenario form ────────────────────────────────────────────────────────

function NewScenarioForm({ onSubmit, onCancel }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    await onSubmit({ name: name.trim(), description: desc.trim() })
    setSaving(false)
  }

  const fieldStyle = {
    width: '100%', padding: '8px 10px', background: 'var(--field)',
    border: '1px solid var(--bd)', borderRadius: 6, color: 'var(--tx-1)',
    fontSize: 13, outline: 'none', boxSizing: 'border-box',
  }

  return (
    <form onSubmit={handleSubmit} style={{ padding: '12px 14px', borderBottom: '1px solid var(--bd-light)' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx-2)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
        New Scenario
      </div>
      <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Scenario name" style={{ ...fieldStyle, marginBottom: 6 }} />
      <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description (optional)" style={{ ...fieldStyle, marginBottom: 8 }} />
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="submit" disabled={!name.trim() || saving} style={{
          flex: 1, padding: '7px 0', background: 'var(--accent)', color: 'var(--accent-tx-on)',
          border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600,
          cursor: name.trim() && !saving ? 'pointer' : 'not-allowed', opacity: name.trim() && !saving ? 1 : 0.5,
        }}>
          {saving ? 'Creating…' : 'Create'}
        </button>
        <button type="button" onClick={onCancel} style={{
          padding: '7px 12px', background: 'transparent', color: 'var(--tx-2)',
          border: '1px solid var(--bd)', borderRadius: 6, fontSize: 12, cursor: 'pointer',
        }}>
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── Add adjustment form ──────────────────────────────────────────────────────

function AddAdjustmentForm({ categories, onSubmit, onCancel }) {
  const curYear = CUR_YEAR
  const [categoryId, setCategoryId] = useState('')
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [year, setYear] = useState(curYear)
  const [delta, setDelta] = useState('')
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const grouped = {}
  for (const c of categories) {
    const g = c.group || 'Other'
    if (!grouped[g]) grouped[g] = []
    grouped[g].push(c)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setErr('')
    if (!categoryId) return setErr('Select a category.')
    const d = parseFloat(delta)
    if (isNaN(d) || d === 0) return setErr('Enter a non-zero delta amount.')
    setSaving(true)
    try {
      await onSubmit({ category_id: categoryId, month: parseInt(month), year: parseInt(year), delta_amount: d, label: label.trim() })
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setSaving(false)
    }
  }

  const fieldStyle = {
    padding: '7px 9px', background: 'var(--field)', border: '1px solid var(--bd)',
    borderRadius: 6, color: 'var(--tx-1)', fontSize: 12, outline: 'none',
  }

  return (
    <form onSubmit={handleSubmit} style={{
      background: 'var(--bg-card)', border: '1px solid var(--bd)', borderRadius: 8, padding: 16, marginTop: 12,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx-2)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12 }}>
        Add Adjustment
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={{ fontSize: 11, color: 'var(--tx-2)', display: 'block', marginBottom: 4 }}>Category</label>
          <select value={categoryId} onChange={e => setCategoryId(e.target.value)} style={{ ...fieldStyle, width: '100%' }}>
            <option value="">— select —</option>
            {Object.entries(grouped).map(([g, cats]) => (
              <optgroup key={g} label={g}>
                {cats.map(c => <option key={c.id} value={c.id}>{c.category}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--tx-2)', display: 'block', marginBottom: 4 }}>Month</label>
          <select value={month} onChange={e => setMonth(e.target.value)} style={{ ...fieldStyle, width: '100%' }}>
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--tx-2)', display: 'block', marginBottom: 4 }}>Year</label>
          <select value={year} onChange={e => setYear(e.target.value)} style={{ ...fieldStyle, width: '100%' }}>
            {[curYear - 1, curYear, curYear + 1, curYear + 2].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--tx-2)', display: 'block', marginBottom: 4 }}>Delta ($)</label>
          <input type="number" value={delta} onChange={e => setDelta(e.target.value)} placeholder="-500 or +1200" step="0.01" style={{ ...fieldStyle, width: '100%' }} />
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: 'var(--tx-2)', display: 'block', marginBottom: 4 }}>Label (optional)</label>
        <input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Celebrity Cruise — final payment" style={{ ...fieldStyle, width: '100%' }} />
      </div>
      {err && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={saving} style={{
          padding: '8px 20px', background: 'var(--accent)', color: 'var(--accent-tx-on)',
          border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600,
          cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
        }}>
          {saving ? 'Adding…' : 'Add Adjustment'}
        </button>
        <button type="button" onClick={onCancel} style={{
          padding: '8px 14px', background: 'transparent', color: 'var(--tx-2)',
          border: '1px solid var(--bd)', borderRadius: 6, fontSize: 12, cursor: 'pointer',
        }}>
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── Adjustments table (redesigned) ───────────────────────────────────────────

function AdjustmentsTable({ adjustments, onDelete, readOnly }) {
  const [hovered, setHovered] = useState(null)

  if (!adjustments.length) {
    return (
      <div style={{
        textAlign: 'center', padding: '32px 16px', color: 'var(--tx-3)', fontSize: 13,
        border: '2px dashed var(--bd)', borderRadius: 10,
      }}>
        No adjustments yet. Add one below to model a change.
      </div>
    )
  }

  const totalDelta = adjustments.reduce((s, a) => s + Number(a.delta_amount), 0)

  // Group by period (year-month)
  const byPeriod = {}
  for (const adj of adjustments) {
    const key = `${adj.year}-${String(adj.month).padStart(2, '0')}`
    if (!byPeriod[key]) byPeriod[key] = []
    byPeriod[key].push(adj)
  }
  const sortedPeriods = Object.keys(byPeriod).sort()

  return (
    <div style={{ border: '1px solid var(--bd)', borderRadius: 10, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 110px 130px auto',
        padding: '9px 16px', background: 'var(--hover)',
        fontSize: 10, fontWeight: 700, color: 'var(--tx-3)',
        letterSpacing: '0.07em', textTransform: 'uppercase',
        borderBottom: '1px solid var(--bd)',
      }}>
        <span>Category / Note</span>
        <span>Period</span>
        <span style={{ textAlign: 'right' }}>Change</span>
        {!readOnly && <span />}
      </div>

      {/* Rows grouped by period */}
      {sortedPeriods.map((periodKey, pi) => {
        const rows = byPeriod[periodKey]
        const [yr, mo] = periodKey.split('-')
        const periodLabel = `${MONTHS[parseInt(mo) - 1]} ${yr}`
        const periodTotal = rows.reduce((s, a) => s + Number(a.delta_amount), 0)

        return (
          <div key={periodKey}>
            {/* Period subheader */}
            <div style={{
              padding: '6px 16px 4px',
              background: 'var(--bg-app)',
              borderTop: pi > 0 ? '1px solid var(--bd)' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{
                fontSize: 10, fontWeight: 700, color: 'var(--tx-2)',
                fontFamily: "'DM Mono', monospace", letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>
                {periodLabel}
              </span>
              {rows.length > 1 && (
                <span style={{
                  fontSize: 10, color: periodTotal < 0 ? 'var(--green)' : 'var(--red)',
                  fontFamily: "'DM Mono', monospace", fontWeight: 600,
                }}>
                  {periodTotal < 0 ? '−' : '+'}${Math.abs(Math.round(periodTotal)).toLocaleString()} total
                </span>
              )}
            </div>

            {/* Adjustment rows for this period */}
            {rows.map((adj) => {
              const delta = Number(adj.delta_amount)
              const cat = adj.budget_categories?.category ?? '—'
              const isHovered = hovered === adj.id

              return (
                <div
                  key={adj.id}
                  onMouseEnter={() => setHovered(adj.id)}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    display: 'grid', gridTemplateColumns: '1fr 110px 130px auto',
                    alignItems: 'center', padding: '10px 16px',
                    borderTop: '1px solid var(--bd-light)',
                    background: isHovered ? 'var(--hover)' : 'transparent',
                    transition: 'background 0.1s',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--tx-1)' }}>{cat}</div>
                    {adj.label && (
                      <div style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 1 }}>{adj.label}</div>
                    )}
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--tx-3)', fontFamily: "'DM Mono', monospace" }}>
                    {MONTHS[(adj.month ?? 1) - 1]} {adj.year}
                  </span>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{
                      display: 'inline-block', padding: '4px 10px', borderRadius: 20,
                      fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                      background: delta < 0 ? 'rgba(46,204,113,0.1)' : 'rgba(229,57,53,0.1)',
                      color: delta < 0 ? 'var(--green)' : 'var(--red)',
                      border: `1px solid ${delta < 0 ? 'rgba(46,204,113,0.25)' : 'rgba(229,57,53,0.25)'}`,
                    }}>
                      {delta < 0 ? '−' : '+'}{fmtAbs(delta)}
                    </span>
                  </div>
                  {!readOnly ? (
                    <button onClick={() => onDelete(adj.id)} style={{
                      background: 'none', border: 'none', color: 'var(--tx-4)', cursor: 'pointer',
                      padding: '4px 6px', fontSize: 16, lineHeight: 1, borderRadius: 4,
                      opacity: isHovered ? 1 : 0, transition: 'opacity 0.1s',
                    }} title="Remove adjustment">
                      ×
                    </button>
                  ) : <span />}
                </div>
              )
            })}
          </div>
        )
      })}

      {/* Total row */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 110px 130px auto',
        padding: '11px 16px', borderTop: '2px solid var(--bd)',
        background: 'var(--bg-card)',
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--tx-2)' }}>
          Net impact · {adjustments.length} adjustment{adjustments.length !== 1 ? 's' : ''}
        </span>
        <span />
        <div style={{ textAlign: 'right' }}>
          <span style={{
            display: 'inline-block', padding: '4px 12px', borderRadius: 20,
            fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
            background: totalDelta < 0 ? 'rgba(46,204,113,0.12)' : totalDelta > 0 ? 'rgba(229,57,53,0.12)' : 'var(--hover)',
            color: totalDelta < 0 ? 'var(--green)' : totalDelta > 0 ? 'var(--red)' : 'var(--tx-2)',
          }}>
            {totalDelta === 0 ? '$0' : (totalDelta < 0 ? '−' : '+') + fmtAbs(totalDelta)}
          </span>
        </div>
        {!readOnly && <span />}
      </div>
    </div>
  )
}

// ── Comparison chart (visual, replaces text table) ───────────────────────────

function ComparisonChart({ adjustments, ctx }) {
  const [tooltip, setTooltip] = useState(null)

  if (!adjustments.length) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--tx-3)', fontSize: 13 }}>
        No adjustments to compare. Add adjustments to see the scenario vs. baseline.
      </div>
    )
  }

  const periods = buildComparisonRows(adjustments, ctx)
  if (!periods.length) return null

  const hasBaseline = periods.some(p => p.periodBaseline != null)

  // Chart dims
  const W = 700, H = 210
  const PL = 62, PR = 20, PT = 16, PB = 44
  const dW = W - PL - PR
  const dH = H - PT - PB

  const n = periods.length
  const groupW = dW / n
  const totalBarW = groupW * 0.7
  const barW = hasBaseline ? totalBarW / 2 - 2 : totalBarW
  const gap = 4

  const allVals = periods.flatMap(p => [p.periodBaseline ?? 0, p.periodScenario ?? 0, 0]).filter(v => v != null)
  const maxVal = Math.max(1, ...allVals) * 1.15

  const yScale = v => PT + dH - (Math.max(0, v) / maxVal) * dH
  const groupCx = i => PL + i * groupW + groupW / 2

  const yTicks = [0, Math.round(maxVal * 0.5), Math.round(maxVal)]

  return (
    <div>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 14, fontSize: 11, color: 'var(--tx-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        {hasBaseline && (
          <>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'rgba(150,150,170,0.4)', border: '1px solid rgba(150,150,170,0.5)' }} />
              Baseline (forecast/budget)
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--accent)', opacity: 0.75 }} />
              With scenario
            </span>
          </>
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontStyle: 'italic', color: 'var(--tx-4)' }}>
          Hover bars to see exact values
        </span>
      </div>

      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block', overflow: 'visible' }}>
          {/* Grid lines */}
          {yTicks.map((tick, i) => (
            <line key={i} x1={PL} y1={yScale(tick)} x2={W - PR} y2={yScale(tick)}
              stroke="var(--bd-light)" strokeWidth={1} />
          ))}

          {/* Y labels */}
          {yTicks.map((tick, i) => (
            <text key={i} x={PL - 5} y={yScale(tick)} textAnchor="end" dominantBaseline="middle"
              fontSize={8} fill="var(--tx-3)" fontFamily="'DM Mono', monospace">
              {fmtShort(tick)}
            </text>
          ))}

          {/* Bars per period */}
          {periods.map((p, i) => {
            const cx = groupCx(i)
            const baseX = hasBaseline ? cx - totalBarW / 2 : cx - barW / 2
            const scenX = hasBaseline ? cx + gap / 2 : cx - barW / 2
            const delta = p.periodDelta
            const hasScene = p.periodScenario != null

            const baseBarH = p.periodBaseline != null ? Math.max(2, dH - (yScale(p.periodBaseline) - PT)) : 0
            const scenBarH = hasScene ? Math.max(2, dH - (yScale(p.periodScenario) - PT)) : 0

            const topY = Math.min(
              p.periodBaseline != null ? yScale(p.periodBaseline) : H,
              hasScene ? yScale(p.periodScenario) : H
            )

            return (
              <g key={i}
                onMouseEnter={e => setTooltip({ period: p, clientX: e.clientX, clientY: e.clientY })}
                onMouseLeave={() => setTooltip(null)}
                style={{ cursor: 'pointer' }}
              >
                {/* Baseline bar */}
                {hasBaseline && p.periodBaseline != null && (
                  <rect x={baseX} y={yScale(p.periodBaseline)} width={barW} height={baseBarH}
                    fill="rgba(150,150,170,0.35)" stroke="rgba(150,150,170,0.5)" strokeWidth={1} rx={3} />
                )}

                {/* Scenario bar */}
                {hasScene && (
                  <rect
                    x={hasBaseline ? scenX : cx - barW / 2}
                    y={yScale(p.periodScenario)}
                    width={barW}
                    height={scenBarH}
                    fill={delta < 0 ? '#2ecc71' : 'var(--accent)'}
                    fillOpacity={0.75}
                    rx={3}
                  />
                )}

                {/* Delta label */}
                {delta !== 0 && (
                  <text
                    x={cx}
                    y={topY - 5}
                    textAnchor="middle"
                    fontSize={8.5}
                    fontWeight={700}
                    fill={delta < 0 ? '#27ae60' : '#e74c3c'}
                    fontFamily="'DM Mono', monospace"
                  >
                    {delta < 0 ? '−' : '+'}${Math.abs(Math.round(delta)).toLocaleString()}
                  </text>
                )}

                {/* X label */}
                <text x={cx} y={H - PB + 16} textAnchor="middle" fontSize={8.5}
                  fill="var(--tx-3)" fontFamily="'DM Mono', monospace">
                  {p.periodLabel}
                </text>
              </g>
            )
          })}

          {/* Zero line */}
          <line x1={PL} y1={yScale(0)} x2={W - PR} y2={yScale(0)} stroke="var(--bd)" strokeWidth={1} />
        </svg>

        {/* Hover tooltip */}
        {tooltip && (
          <div style={{
            position: 'fixed', top: tooltip.clientY - 10, left: tooltip.clientX + 14,
            zIndex: 300, background: 'var(--bg-card)', border: '1px solid var(--bd)',
            borderRadius: 9, padding: '10px 14px', boxShadow: '0 6px 22px rgba(0,0,0,0.18)',
            pointerEvents: 'none', fontSize: 12, minWidth: 190,
          }}>
            <div style={{ fontWeight: 700, color: 'var(--tx-1)', marginBottom: 8, fontSize: 13 }}>
              {tooltip.period.periodLabel}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {tooltip.period.periodBaseline != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}>
                  <span style={{ color: 'var(--tx-3)' }}>Baseline</span>
                  <span style={{ fontFamily: "'DM Mono', monospace", color: 'var(--tx-1)', fontWeight: 600 }}>
                    ${Math.round(tooltip.period.periodBaseline).toLocaleString()}
                  </span>
                </div>
              )}
              {tooltip.period.periodScenario != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}>
                  <span style={{ color: 'var(--tx-3)' }}>With scenario</span>
                  <span style={{ fontFamily: "'DM Mono', monospace", color: 'var(--tx-1)', fontWeight: 600 }}>
                    ${Math.round(tooltip.period.periodScenario).toLocaleString()}
                  </span>
                </div>
              )}
              <div style={{
                display: 'flex', justifyContent: 'space-between', gap: 20,
                paddingTop: 6, borderTop: '1px solid var(--bd-light)', marginTop: 2,
              }}>
                <span style={{ color: 'var(--tx-3)' }}>Delta</span>
                <span style={{
                  fontFamily: "'DM Mono', monospace", fontWeight: 700,
                  color: tooltip.period.periodDelta < 0 ? 'var(--green)' : 'var(--red)',
                }}>
                  {tooltip.period.periodDelta < 0 ? '−' : '+'}${Math.abs(Math.round(tooltip.period.periodDelta)).toLocaleString()}
                </span>
              </div>
            </div>
            {tooltip.period.rows.length > 1 && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--bd-light)' }}>
                {tooltip.period.rows.map((r, ri) => (
                  <div key={ri} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 3, fontSize: 11 }}>
                    <span style={{ color: 'var(--tx-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>
                      {r.category}{r.label ? ` · ${r.label}` : ''}
                    </span>
                    <span style={{ fontFamily: "'DM Mono', monospace", color: r.delta < 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600, flexShrink: 0 }}>
                      {r.delta < 0 ? '−' : '+'}${Math.abs(Math.round(r.delta)).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Running cumulative row */}
      {periods.length > 1 && (() => {
        let running = 0
        return (
          <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--bg-card)', border: '1px solid var(--bd)', borderRadius: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--tx-3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>
              Cumulative Running Total
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {periods.map((p, i) => {
                running += p.periodDelta
                const snap = running
                return (
                  <div key={i} style={{ textAlign: 'center', minWidth: 70 }}>
                    <div style={{ fontSize: 9.5, color: 'var(--tx-4)', fontFamily: "'DM Mono', monospace", marginBottom: 3 }}>
                      {p.periodLabel}
                    </div>
                    <div style={{
                      fontSize: 11.5, fontWeight: 700, fontFamily: "'DM Mono', monospace",
                      color: snap < 0 ? 'var(--green)' : snap > 0 ? 'var(--red)' : 'var(--tx-3)',
                    }}>
                      {snap === 0 ? '$0' : (snap < 0 ? '−' : '+') + fmtAbs(snap)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ── Timeline chart (improved with explanation) ───────────────────────────────

function TimelineChart({ adjustments }) {
  const [tooltip, setTooltip] = useState(null)
  const data = useMemo(() => buildCumulativeTimeline(adjustments), [adjustments])

  if (!data.labels.length) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--tx-3)', fontSize: 13 }}>
        No adjustments to chart.
      </div>
    )
  }

  const W = 600, H = 180
  const padL = 62, padR = 16, padT = 24, padB = 36
  const drawW = W - padL - padR
  const drawH = H - padT - padB

  const { labels, values, min, max } = data
  const range = max - min || 1
  const n = values.length

  const xPos = (i) => padL + (i / Math.max(n - 1, 1)) * drawW
  const yPos = (v) => padT + drawH - ((v - min) / range) * drawH
  const zeroY = yPos(0)

  const linePts = values.map((v, i) => `${xPos(i)},${yPos(v)}`).join(' ')
  const areaPath = [
    `M ${xPos(0)} ${zeroY}`,
    ...values.map((v, i) => `L ${xPos(i)} ${yPos(v)}`),
    `L ${xPos(n - 1)} ${zeroY}`,
    'Z',
  ].join(' ')

  const fmtTick = (v) => {
    const abs = Math.abs(v)
    const s = abs >= 1000 ? '$' + Math.round(abs / 1000) + 'k' : '$' + Math.round(abs)
    return v < 0 ? '−' + s : v > 0 ? '+' + s : s
  }

  const labelEvery = n > 8 ? 3 : n > 4 ? 2 : 1
  const yTicks = [...new Set([min, min < 0 && max > 0 ? 0 : null, max].filter(v => v != null))]

  const finalValue = values[values.length - 1]
  const isPositive = finalValue > 0

  return (
    <div>
      {/* Explanation */}
      <div style={{ marginBottom: 16, padding: '12px 16px', background: 'var(--accent-bg)', border: '1px solid var(--accent-bd)', borderRadius: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-1)', marginBottom: 4 }}>
          Cumulative Scenario Impact
        </div>
        <div style={{ fontSize: 12, color: 'var(--tx-2)', lineHeight: 1.55 }}>
          This shows the running total of how much this scenario cumulatively changes your spending over time.
          A line going <span style={{ color: 'var(--red)', fontWeight: 600 }}>up</span> means you're spending more in total;
          going <span style={{ color: 'var(--green)', fontWeight: 600 }}>down</span> means you're saving relative to your baseline.
          By {labels[labels.length - 1]}, the cumulative {isPositive ? 'increase' : 'savings'} is{' '}
          <strong style={{ color: isPositive ? 'var(--red)' : 'var(--green)' }}>{fmtTick(finalValue)}</strong>.
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 10, fontSize: 11, color: 'var(--tx-3)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ display: 'inline-block', width: 18, height: 2, background: 'var(--accent)', borderRadius: 1 }} />
          Cumulative spend change
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontStyle: 'italic', color: 'var(--tx-4)' }}>
          Hover dots to see values
        </span>
      </div>

      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
          style={{ width: '100%', display: 'block', overflow: 'visible' }}>
          {/* Zero baseline */}
          {min < 0 && max > 0 && (
            <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY}
              stroke="var(--bd)" strokeWidth={1} strokeDasharray="4 3" />
          )}

          {/* Grid lines */}
          {yTicks.map((tick, i) => (
            <line key={i} x1={padL} y1={yPos(tick)} x2={W - padR} y2={yPos(tick)}
              stroke="var(--bd-light)" strokeWidth={1} />
          ))}

          {/* Filled area */}
          <path d={areaPath} fill="var(--accent)" opacity={0.1} />

          {/* Line */}
          <polyline points={linePts} fill="none" stroke="var(--accent)" strokeWidth={2.5}
            strokeLinecap="round" strokeLinejoin="round" />

          {/* Dots */}
          {values.map((v, i) => (
            <circle key={i} cx={xPos(i)} cy={yPos(v)} r={4}
              fill="var(--accent)" stroke="var(--bg-card)" strokeWidth={2}
              style={{ cursor: 'pointer' }}
              onMouseEnter={e => setTooltip({ label: labels[i], value: v, clientX: e.clientX, clientY: e.clientY })}
              onMouseLeave={() => setTooltip(null)}
            />
          ))}

          {/* X-axis labels */}
          {labels.map((lbl, i) => i % labelEvery === 0 && (
            <text key={i} x={xPos(i)} y={H - 4} textAnchor="middle"
              fontSize={9} fill="var(--tx-3)" fontFamily="'DM Mono', monospace">
              {lbl}
            </text>
          ))}

          {/* Y-axis ticks */}
          {yTicks.map((tick, i) => (
            <text key={i} x={padL - 5} y={yPos(tick)} textAnchor="end" dominantBaseline="middle"
              fontSize={8.5} fill="var(--tx-3)" fontFamily="'DM Mono', monospace">
              {fmtTick(tick)}
            </text>
          ))}
        </svg>

        {tooltip && (
          <div style={{
            position: 'fixed', top: tooltip.clientY - 10, left: tooltip.clientX + 14,
            zIndex: 300, background: 'var(--bg-card)', border: '1px solid var(--bd)',
            borderRadius: 8, padding: '9px 13px', boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
            pointerEvents: 'none', fontSize: 12,
          }}>
            <div style={{ fontWeight: 600, color: 'var(--tx-1)', marginBottom: 4 }}>{tooltip.label}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
              <span style={{ color: 'var(--tx-3)' }}>Cumulative total</span>
              <span style={{
                fontFamily: "'DM Mono', monospace", fontWeight: 700,
                color: tooltip.value < 0 ? 'var(--green)' : tooltip.value > 0 ? 'var(--red)' : 'var(--tx-2)',
              }}>
                {fmtTick(tooltip.value)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Forecast impact chart (new tab) ─────────────────────────────────────────

function ForecastImpactChart({ adjustments, ctx }) {
  const [tooltip, setTooltip] = useState(null)

  if (!adjustments.length) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--tx-3)', fontSize: 13 }}>
        No adjustments to visualize. Add adjustments to see the forecast impact.
      </div>
    )
  }

  // Find the year with the most adjustments
  const yearCounts = {}
  for (const a of adjustments) yearCounts[a.year] = (yearCounts[a.year] || 0) + 1
  const displayYear = parseInt(
    Object.entries(yearCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? CUR_YEAR
  )

  // Build monthly baseline from forecast or budget
  const forecastItems = ctx?.forecastLineItems ?? []
  const budgetItems = ctx?.budgetLineItems ?? []
  const baselineItems = forecastItems.length > 0 ? forecastItems : budgetItems
  const isUsingForecast = forecastItems.length > 0

  const baseline = Array(12).fill(0)
  for (const item of baselineItems) {
    const m = (item.month ?? 1) - 1
    if (m >= 0 && m < 12) baseline[m] += Number(item.amount) || 0
  }

  // Apply scenario adjustments for displayYear
  const withScenario = [...baseline]
  for (const adj of adjustments) {
    if (Number(adj.year) === displayYear) {
      const m = (adj.month ?? 1) - 1
      if (m >= 0 && m < 12) withScenario[m] += Number(adj.delta_amount) || 0
    }
  }

  const hasImpact = baseline.some((v, i) => Math.abs(v - withScenario[i]) > 0.5)
  const annualBase = baseline.reduce((a, b) => a + b, 0)
  const annualWith = withScenario.reduce((a, b) => a + b, 0)
  const annualDelta = annualWith - annualBase

  // Chart dims
  const W = 700, H = 200
  const PL = 62, PR = 20, PT = 16, PB = 36
  const dW = W - PL - PR
  const dH = H - PT - PB

  const maxVal = Math.max(1, ...baseline, ...withScenario) * 1.12
  const barGroupW = dW / 12
  const barW = barGroupW * 0.36
  const gap = 3

  const yScale = v => PT + dH - (Math.max(0, v) / maxVal) * dH
  const groupX = i => PL + i * barGroupW
  const yTicks = [0, Math.round(maxVal * 0.5), Math.round(maxVal)]

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--tx-1)', marginBottom: 4 }}>
          {displayYear} Forecast Impact
        </div>
        <div style={{ fontSize: 12, color: 'var(--tx-2)', lineHeight: 1.5 }}>
          Side-by-side view of how this scenario shifts each month of your {displayYear} plan.
          Bars side-by-side appear only in months this scenario affects.
          {!hasImpact && ' No adjustments fall in this year — try viewing another year.'}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 11, color: 'var(--tx-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'rgba(150,150,170,0.4)', border: '1px solid rgba(150,150,170,0.5)' }} />
          Baseline ({isUsingForecast ? 'forecast' : 'budget'})
        </span>
        {hasImpact && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--accent)', opacity: 0.75 }} />
            With scenario
          </span>
        )}
        <span style={{ fontStyle: 'italic', color: 'var(--tx-4)' }}>Hover for details</span>
      </div>

      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block', overflow: 'visible' }}>
          {/* Grid */}
          {yTicks.map((tick, i) => (
            <line key={i} x1={PL} y1={yScale(tick)} x2={W - PR} y2={yScale(tick)}
              stroke="var(--bd-light)" strokeWidth={1} />
          ))}
          {yTicks.map((tick, i) => (
            <text key={i} x={PL - 5} y={yScale(tick)} textAnchor="end" dominantBaseline="middle"
              fontSize={8} fill="var(--tx-3)" fontFamily="'DM Mono', monospace">
              {fmtShort(tick)}
            </text>
          ))}

          {/* Bars */}
          {Array.from({ length: 12 }, (_, m) => {
            const gx = groupX(m)
            const delta = withScenario[m] - baseline[m]
            const hasDelta = Math.abs(delta) > 0.5
            const isCurMonth = m === CUR_MONTH && displayYear === CUR_YEAR
            const isPast = m < CUR_MONTH && displayYear === CUR_YEAR

            const baseH = Math.max(2, dH - (yScale(baseline[m]) - PT))
            const scenH = Math.max(2, dH - (yScale(withScenario[m]) - PT))

            // Positions: if delta, show two side-by-side bars; else show one centered
            const totalPair = barW * 2 + gap
            const baseX = hasDelta ? gx + (barGroupW - totalPair) / 2 : gx + (barGroupW - barW) / 2
            const scenX = baseX + barW + gap

            return (
              <g key={m}
                onMouseEnter={e => setTooltip({ m, baseline: baseline[m], with: withScenario[m], delta, clientX: e.clientX, clientY: e.clientY })}
                onMouseLeave={() => setTooltip(null)}
                style={{ cursor: 'pointer' }}
              >
                {/* Current month highlight */}
                {isCurMonth && (
                  <rect x={gx} y={PT} width={barGroupW} height={dH}
                    fill="var(--accent)" opacity={0.04} />
                )}

                {/* Baseline bar */}
                {baseline[m] > 0 && (
                  <rect x={baseX} y={yScale(baseline[m])} width={barW} height={baseH}
                    fill={isPast ? 'rgba(100,100,120,0.25)' : 'rgba(150,150,170,0.35)'}
                    stroke="rgba(150,150,170,0.4)" strokeWidth={1} rx={2} />
                )}

                {/* Scenario bar */}
                {hasDelta && withScenario[m] > 0 && (
                  <rect x={scenX} y={yScale(withScenario[m])} width={barW} height={scenH}
                    fill={delta < 0 ? '#2ecc71' : 'var(--accent)'} fillOpacity={0.75} rx={2} />
                )}

                {/* Month label */}
                <text x={gx + barGroupW / 2} y={H - PB + 14} textAnchor="middle"
                  fontSize={8.5}
                  fill={isCurMonth ? 'var(--accent)' : 'var(--tx-3)'}
                  fontWeight={isCurMonth ? 700 : 400}
                  fontFamily="'DM Mono', monospace">
                  {MONTHS[m]}
                </text>
              </g>
            )
          })}

          {/* Zero line */}
          <line x1={PL} y1={yScale(0)} x2={W - PR} y2={yScale(0)} stroke="var(--bd)" strokeWidth={1} />
        </svg>

        {tooltip && (
          <div style={{
            position: 'fixed', top: tooltip.clientY - 10, left: tooltip.clientX + 14,
            zIndex: 300, background: 'var(--bg-card)', border: '1px solid var(--bd)',
            borderRadius: 9, padding: '10px 14px', boxShadow: '0 6px 22px rgba(0,0,0,0.18)',
            pointerEvents: 'none', fontSize: 12, minWidth: 180,
          }}>
            <div style={{ fontWeight: 700, color: 'var(--tx-1)', marginBottom: 8, fontSize: 13 }}>
              {MONTHS[tooltip.m]} {displayYear}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}>
                <span style={{ color: 'var(--tx-3)' }}>Baseline</span>
                <span style={{ fontFamily: "'DM Mono', monospace", color: 'var(--tx-1)', fontWeight: 600 }}>
                  ${Math.round(tooltip.baseline).toLocaleString()}
                </span>
              </div>
              {Math.abs(tooltip.delta) > 0.5 && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}>
                    <span style={{ color: 'var(--tx-3)' }}>With scenario</span>
                    <span style={{ fontFamily: "'DM Mono', monospace", color: 'var(--tx-1)', fontWeight: 600 }}>
                      ${Math.round(tooltip.with).toLocaleString()}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, paddingTop: 5, borderTop: '1px solid var(--bd-light)', marginTop: 2 }}>
                    <span style={{ color: 'var(--tx-3)' }}>Change</span>
                    <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, color: tooltip.delta < 0 ? 'var(--green)' : 'var(--red)' }}>
                      {tooltip.delta < 0 ? '−' : '+'}${Math.abs(Math.round(tooltip.delta)).toLocaleString()}
                    </span>
                  </div>
                </>
              )}
              {Math.abs(tooltip.delta) <= 0.5 && (
                <div style={{ color: 'var(--tx-4)', fontSize: 11, fontStyle: 'italic' }}>No change this month</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Summary stats */}
      <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {[
          { label: `${displayYear} Baseline`, value: '$' + Math.round(annualBase).toLocaleString(), color: 'var(--tx-1)' },
          { label: 'With Scenario', value: '$' + Math.round(annualWith).toLocaleString(), color: 'var(--accent)' },
          {
            label: 'Annual Delta',
            value: (annualDelta === 0 ? '$0' : (annualDelta < 0 ? '−' : '+') + '$' + Math.abs(Math.round(annualDelta)).toLocaleString()),
            color: annualDelta < 0 ? 'var(--green)' : annualDelta > 0 ? 'var(--red)' : 'var(--tx-2)',
          },
        ].map((stat, i) => (
          <div key={i} style={{ padding: '12px 14px', background: 'var(--bg-card)', border: '1px solid var(--bd)', borderRadius: 8 }}>
            <div style={{ fontSize: 9.5, color: 'var(--tx-3)', fontFamily: "'DM Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
              {stat.label}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: stat.color, fontVariantNumeric: 'tabular-nums' }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Baseline panel (top-level view mode) ────────────────────────────────────

function BaselinePanel({ ctx }) {
  const [tooltip, setTooltip] = useState(null)

  const forecastItems = ctx?.forecastLineItems ?? []
  const budgetItems = ctx?.budgetLineItems ?? []
  const baselineItems = forecastItems.length > 0 ? forecastItems : budgetItems
  const isUsingForecast = forecastItems.length > 0

  // Monthly totals
  const monthly = Array(12).fill(0)
  for (const item of baselineItems) {
    const m = (item.month ?? 1) - 1
    if (m >= 0 && m < 12) monthly[m] += Number(item.amount) || 0
  }

  const annualTotal = monthly.reduce((a, b) => a + b, 0)
  const nonZeroMonths = monthly.filter(v => v > 0)
  const monthlyAvg = nonZeroMonths.length > 0
    ? nonZeroMonths.reduce((a, b) => a + b, 0) / nonZeroMonths.length
    : 0

  // Category group breakdown
  const byGroup = {}
  for (const item of baselineItems) {
    const group = item.budget_categories?.group || 'Other'
    byGroup[group] = (byGroup[group] || 0) + Number(item.amount || 0)
  }
  const groups = Object.entries(byGroup).sort((a, b) => b[1] - a[1])

  if (!baselineItems.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 42, marginBottom: 14, opacity: 0.25 }}>📊</div>
        <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--tx-1)', marginBottom: 8 }}>No baseline data yet</div>
        <div style={{ fontSize: 13, color: 'var(--tx-2)', maxWidth: 380, lineHeight: 1.65 }}>
          Your baseline comes from your Budget and Forecast modules. Set up a budget first — then come back here to see your financial baseline before any scenario adjustments.
        </div>
      </div>
    )
  }

  // Chart dims
  const W = 700, H = 150
  const PL = 58, PR = 16, PT = 14, PB = 32
  const dW = W - PL - PR
  const dH = H - PT - PB
  const maxVal = Math.max(1, ...monthly) * 1.15
  const barSpacing = dW / 12
  const barW = barSpacing * 0.65
  const xBar = i => PL + i * barSpacing + barSpacing * 0.175
  const yScale = v => PT + dH - (v / maxVal) * dH
  const yTicks = [0, Math.round(maxVal * 0.5), Math.round(maxVal)]

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 22 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--tx-1)', marginBottom: 5 }}>
            Your {CUR_YEAR} Financial Baseline
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--tx-2)', lineHeight: 1.6 }}>
            This is your current planned spending, based on your {isUsingForecast ? 'initialized forecast' : 'budget'} — before any scenario adjustments.
            Scenarios model "what if" changes against this baseline. Promoting a scenario to committed layers it onto your actual plan.
          </p>
        </div>

        {/* Summary stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 22 }}>
          {[
            { label: `${CUR_YEAR} Annual Plan`, value: '$' + Math.round(annualTotal).toLocaleString() },
            { label: 'Monthly Average', value: '$' + Math.round(monthlyAvg).toLocaleString() },
            { label: 'Categories Budgeted', value: String((ctx?.categories ?? []).length) },
          ].map((stat, i) => (
            <div key={i} style={{ padding: '16px 18px', background: 'var(--bg-card)', border: '1px solid var(--bd)', borderRadius: 10 }}>
              <div style={{ fontSize: 9.5, color: 'var(--tx-3)', fontFamily: "'DM Mono', monospace", textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 7 }}>
                {stat.label}
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--tx-1)', fontVariantNumeric: 'tabular-nums' }}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        {/* Monthly chart */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bd)', borderRadius: 10, padding: '18px 20px 14px', marginBottom: 18 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 14 }}>
            Monthly Spending Plan — {CUR_YEAR}  ·  {isUsingForecast ? 'Forecast' : 'Budget'}
          </div>
          <div style={{ position: 'relative' }}>
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block', overflow: 'visible' }}>
              {yTicks.map((tick, i) => (
                <g key={i}>
                  <line x1={PL} y1={yScale(tick)} x2={W - PR} y2={yScale(tick)} stroke="var(--bd-light)" strokeWidth={1} />
                  <text x={PL - 5} y={yScale(tick)} textAnchor="end" dominantBaseline="middle" fontSize={8} fill="var(--tx-3)" fontFamily="'DM Mono', monospace">
                    {fmtShort(tick)}
                  </text>
                </g>
              ))}
              {monthly.map((v, m) => {
                const isCur = m === CUR_MONTH
                const isPast = m < CUR_MONTH
                const barH = v > 0 ? Math.max(2, dH - (yScale(v) - PT)) : 0
                return (
                  <g key={m}
                    onMouseEnter={e => setTooltip({ m, v, clientX: e.clientX, clientY: e.clientY })}
                    onMouseLeave={() => setTooltip(null)}
                    style={{ cursor: 'pointer' }}
                  >
                    {isCur && <rect x={PL + m * barSpacing} y={PT} width={barSpacing} height={dH} fill="var(--accent)" opacity={0.04} />}
                    {v > 0 && (
                      <rect x={xBar(m)} y={yScale(v)} width={barW} height={barH}
                        fill={isCur ? 'var(--accent)' : 'var(--accent)'}
                        fillOpacity={isPast ? 0.35 : isCur ? 1 : 0.6}
                        rx={3} />
                    )}
                    <text x={xBar(m) + barW / 2} y={H - PB + 14} textAnchor="middle" fontSize={8.5}
                      fill={isCur ? 'var(--accent)' : 'var(--tx-3)'}
                      fontWeight={isCur ? 700 : 400}
                      fontFamily="'DM Mono', monospace">
                      {MONTHS[m]}
                    </text>
                  </g>
                )
              })}
              <line x1={PL} y1={yScale(0)} x2={W - PR} y2={yScale(0)} stroke="var(--bd)" strokeWidth={1} />
            </svg>

            {tooltip && (
              <div style={{
                position: 'fixed', top: tooltip.clientY - 10, left: tooltip.clientX + 14,
                zIndex: 300, background: 'var(--bg-card)', border: '1px solid var(--bd)',
                borderRadius: 8, padding: '9px 13px', boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                pointerEvents: 'none', fontSize: 12,
              }}>
                <div style={{ fontWeight: 700, color: 'var(--tx-1)', marginBottom: 4 }}>{MONTHS[tooltip.m]} {CUR_YEAR}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                  <span style={{ color: 'var(--tx-3)' }}>Planned spend</span>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, color: 'var(--tx-1)' }}>
                    ${Math.round(tooltip.v).toLocaleString()}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Group breakdown */}
        {groups.length > 0 && (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bd)', borderRadius: 10, padding: '18px 20px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 16 }}>
              Spending by Category Group
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {groups.slice(0, 8).map(([group, total], i) => {
                const pct = annualTotal > 0 ? (total / annualTotal) * 100 : 0
                return (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                      <span style={{ fontSize: 13, color: 'var(--tx-1)', fontWeight: 500 }}>{group}</span>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                        <span style={{ fontSize: 11, color: 'var(--tx-4)' }}>{Math.round(pct)}%</span>
                        <span style={{ fontSize: 13, color: 'var(--tx-2)', fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>
                          ${Math.round(total).toLocaleString()}
                        </span>
                      </div>
                    </div>
                    <div style={{ height: 6, background: 'var(--bd-light)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)', borderRadius: 3, opacity: 0.65 }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Footer hint */}
        <div style={{ marginTop: 18, padding: '12px 16px', background: 'var(--accent-bg)', border: '1px solid var(--accent-bd)', borderRadius: 8, fontSize: 12, color: 'var(--tx-2)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--tx-1)' }}>How to use this:</strong> Switch to the <strong>Scenarios</strong> tab to model "what if" changes.
          Each scenario shows its impact as a delta against this baseline. When you're ready to commit a scenario, promote it — and it will appear in the <strong>Forecast → Scenarios</strong> layer.
        </div>
      </div>
    </div>
  )
}

// ── AI Scenario Composer (iterative, conversational) ─────────────────────────

function ChatMessage({ message, onOpenScenario }) {
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{
          background: 'var(--accent-bg)', border: '1px solid var(--accent-bd)',
          borderRadius: '12px 12px 4px 12px', padding: '9px 14px',
          maxWidth: '82%', fontSize: 13, color: 'var(--tx-1)', lineHeight: 1.5,
        }}>
          {message.text}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <span style={{ flexShrink: 0, color: 'var(--accent)', fontSize: 13, marginTop: 3 }}>✦</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {message.loading ? (
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: 'var(--tx-3)', letterSpacing: '0.04em', padding: '4px 0' }}>
            {message.statusText || 'Thinking…'}
          </div>
        ) : message.error ? (
          <div style={{ fontSize: 13, color: 'var(--warn)', lineHeight: 1.5 }}>{message.text}</div>
        ) : (
          <div>
            <Markdown text={message.text} />
            {message.created?.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {message.created.map((c, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                    border: '1px solid var(--accent-bd)', background: 'var(--accent-bg)',
                    borderRadius: 8, padding: '8px 12px',
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, color: 'var(--tx-1)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        ✓ {c.name}
                      </div>
                      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: 'var(--tx-3)', marginTop: 2 }}>
                        {c.adjustmentCount} adjustment{c.adjustmentCount !== 1 ? 's' : ''} · net {c.netDelta >= 0 ? '+' : '−'}${Math.abs(Math.round(c.netDelta)).toLocaleString()}
                      </div>
                    </div>
                    {onOpenScenario && (
                      <button onClick={() => onOpenScenario(c.scenarioId)} style={{
                        flexShrink: 0, background: 'var(--accent)', color: 'var(--accent-tx-on)',
                        border: 'none', borderRadius: 6, padding: '5px 11px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      }}>
                        Open →
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const COMPOSER_EXAMPLE = "In Oct 2026 my car lease expires. Instead of $467/mo I'll lease a Tesla Model Y Premium at ~$550/mo plus $99/mo for FSD. Run this scenario."

function AiScenarioComposer({ userId, context, onCreated, onOpenScenario, mobile }) {
  const [messages, setMessages] = useState([]) // [{role, text, loading, created, error, statusText}]
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const messagesEndRef = useRef(null)

  useEffect(() => {
    if (messages.length) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function run() {
    const text = prompt.trim()
    if (!text || busy) return

    const userMsg = { role: 'user', text }
    const loadingMsg = { role: 'ai', text: '', loading: true, statusText: 'Thinking…' }
    setMessages(prev => [...prev, userMsg, loadingMsg])
    setPrompt('')
    setBusy(true)

    // Build history from prior completed messages
    const history = messages
      .filter(m => m.text && !m.loading)
      .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }))

    try {
      const res = await runScenarioAgent({
        userId,
        history,
        prompt: text,
        context,
        onStatus: (statusText) => setMessages(prev => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last?.loading) next[next.length - 1] = { ...last, statusText }
          return next
        }),
      })
      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = { role: 'ai', text: res.text, created: res.created, error: res.status !== 'ok' }
        return next
      })
      if (res.created?.length) onCreated?.(res.created)
    } catch (e) {
      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = { role: 'ai', text: e.message, error: true }
        return next
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ border: '1px solid var(--accent-bd)', borderRadius: 14, background: 'var(--bg-card)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '13px 18px', borderBottom: '1px solid var(--bd-light)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--accent)', fontSize: 14 }}>✦</span>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--tx-1)' }}>AI Scenario Builder</span>
          <span style={{ fontSize: 11, color: 'var(--tx-4)', marginLeft: 2 }}>— describe in plain English, then keep chatting to refine</span>
        </div>
        {messages.length > 0 && (
          <button onClick={() => setMessages([])} style={{
            background: 'none', border: '1px solid var(--bd)', color: 'var(--tx-3)',
            fontSize: 10, padding: '3px 8px', borderRadius: 6, cursor: 'pointer',
            fontFamily: "'DM Mono', monospace", letterSpacing: '0.04em',
          }}>
            ↺ CLEAR
          </button>
        )}
      </div>

      {/* Chat history */}
      {messages.length > 0 && (
        <div style={{ maxHeight: 300, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.map((msg, i) => (
            <ChatMessage key={i} message={msg} onOpenScenario={onOpenScenario} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input */}
      <div style={{ padding: messages.length ? '10px 18px 16px' : '14px 18px 18px' }}>
        {!messages.length && (
          <div style={{ fontSize: 12.5, color: 'var(--tx-2)', lineHeight: 1.55, marginBottom: 12 }}>
            Describe a financial "what if" — changes to income, recurring expenses, one-time costs, or any combination. After a scenario is built, keep chatting to adjust it.
          </div>
        )}
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run() }}
          placeholder={messages.length ? 'Continue refining… (⌘↵ to send)' : 'e.g. "Starting in Oct 2026, my car lease upgrades to a Tesla Model Y at $550/mo instead of $467/mo"'}
          rows={mobile ? 4 : 3}
          disabled={busy}
          style={{
            width: '100%', resize: 'vertical', background: 'var(--field)',
            border: '1px solid var(--bd)', borderRadius: 10, padding: '10px 13px',
            color: 'var(--tx-1)', fontFamily: 'Inter, sans-serif', fontSize: 13, lineHeight: 1.55,
            outline: 'none', boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
          <button onClick={run} disabled={busy || !prompt.trim()} style={{
            background: 'var(--accent)', color: 'var(--accent-tx-on)', border: 'none', borderRadius: 8,
            padding: '8px 18px', fontSize: 13, fontWeight: 600,
            cursor: busy || !prompt.trim() ? 'not-allowed' : 'pointer', opacity: busy || !prompt.trim() ? 0.6 : 1,
          }}>
            {busy ? 'Building…' : '✦ Send'}
          </button>
          {!messages.length && !busy && !prompt && (
            <button onClick={() => setPrompt(COMPOSER_EXAMPLE)} style={{
              background: 'none', border: 'none', color: 'var(--tx-3)', fontSize: 11.5, cursor: 'pointer', textDecoration: 'underline',
            }}>
              Try an example
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Scenario detail panel ────────────────────────────────────────────────────

function ScenarioDetail({
  scenario, adjustments, categories, context,
  onPromote, onDelete, onAddAdj, onDeleteAdj, loading, onGoToForecast,
}) {
  const [activeTab, setActiveTab] = useState('adjustments')
  const [showAddForm, setShowAddForm] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [promotedBanner, setPromotedBanner] = useState(false)

  const impactSummary = useMemo(
    () => computeImpactSummary(adjustments, context),
    [adjustments, context]
  )

  const isCommitted = scenario.state === 'committed'

  async function handlePromote() {
    setPromoting(true)
    try {
      await onPromote(scenario.id)
      setPromotedBanner(true)
      setTimeout(() => setPromotedBanner(false), 10000)
    } finally {
      setPromoting(false)
    }
  }

  async function handleAddAdj(data) {
    await onAddAdj(data)
    setShowAddForm(false)
  }

  const tabStyle = (active) => ({
    padding: '8px 16px', background: 'transparent', border: 'none',
    borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
    color: active ? 'var(--accent)' : 'var(--tx-2)',
    fontSize: 12.5, fontWeight: active ? 600 : 400, cursor: 'pointer',
    transition: 'color 0.15s', whiteSpace: 'nowrap',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Scenario header */}
      <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: 'var(--tx-1)', marginBottom: 6 }}>
              {scenario.name}
            </h2>
            <StateBadge state={scenario.state} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {!isCommitted && (
              <button onClick={handlePromote} disabled={promoting} style={{
                padding: '7px 14px', background: 'rgba(46,204,113,0.12)', color: 'var(--green)',
                border: '1px solid rgba(46,204,113,0.25)', borderRadius: 6, fontSize: 12, fontWeight: 600,
                cursor: promoting ? 'not-allowed' : 'pointer', opacity: promoting ? 0.6 : 1,
              }}>
                {promoting ? 'Promoting…' : '✓ Promote to Committed'}
              </button>
            )}
            {confirmDelete ? (
              <>
                <button onClick={() => onDelete(scenario.id)} style={{ padding: '7px 12px', background: 'rgba(229,57,53,0.12)', color: 'var(--red)', border: '1px solid rgba(229,57,53,0.25)', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Confirm Delete
                </button>
                <button onClick={() => setConfirmDelete(false)} style={{ padding: '7px 10px', background: 'transparent', color: 'var(--tx-2)', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                  Cancel
                </button>
              </>
            ) : (
              <button onClick={() => setConfirmDelete(true)} style={{ padding: '7px 10px', background: 'transparent', color: 'var(--tx-3)', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                Delete
              </button>
            )}
          </div>
        </div>

        {scenario.description && (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--tx-2)', lineHeight: 1.5 }}>
            {scenario.description}
          </p>
        )}
        {isCommitted && scenario.committed_at && (
          <div style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 6 }}>
            Committed {new Date(scenario.committed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </div>
        )}

        {/* Promote success banner */}
        {promotedBanner && (
          <div style={{
            marginTop: 12, padding: '10px 14px', background: 'rgba(46,204,113,0.08)',
            border: '1px solid rgba(46,204,113,0.2)', borderRadius: 8, fontSize: 12,
            color: 'var(--tx-1)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          }}>
            <span>✓ <strong>Scenario committed!</strong> It's now layered into your plan. View it in the Forecast under the <strong>+ Scenarios</strong> tab.</span>
            {onGoToForecast && (
              <button onClick={onGoToForecast} style={{
                background: 'rgba(46,204,113,0.15)', color: 'var(--green)', border: '1px solid rgba(46,204,113,0.3)',
                borderRadius: 6, padding: '4px 10px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
              }}>
                Open Forecast →
              </button>
            )}
          </div>
        )}

        {!loading && <ImpactSummaryStrip summary={impactSummary} />}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--bd)', flexShrink: 0, overflowX: 'auto' }}>
        <button style={tabStyle(activeTab === 'adjustments')} onClick={() => setActiveTab('adjustments')}>
          Adjustments {adjustments.length > 0 ? `(${adjustments.length})` : ''}
        </button>
        <button style={tabStyle(activeTab === 'forecast-impact')} onClick={() => setActiveTab('forecast-impact')}>
          Forecast Impact
        </button>
        <button style={tabStyle(activeTab === 'comparison')} onClick={() => setActiveTab('comparison')}>
          Baseline Comparison
        </button>
        <button style={tabStyle(activeTab === 'timeline')} onClick={() => setActiveTab('timeline')}>
          Cumulative Timeline
        </button>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
        {loading ? (
          <div style={{ color: 'var(--tx-3)', fontSize: 13 }}>Loading adjustments…</div>
        ) : activeTab === 'adjustments' ? (
          <>
            <AdjustmentsTable adjustments={adjustments} onDelete={onDeleteAdj} readOnly={isCommitted} />
            {!isCommitted && (
              showAddForm ? (
                <AddAdjustmentForm categories={categories} onSubmit={handleAddAdj} onCancel={() => setShowAddForm(false)} />
              ) : (
                <button onClick={() => setShowAddForm(true)} style={{
                  marginTop: 14, padding: '8px 16px', background: 'transparent',
                  color: 'var(--accent)', border: '1px solid var(--accent-bd)',
                  borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}>
                  + Add Adjustment
                </button>
              )
            )}
            {isCommitted && (
              <div style={{ marginTop: 14, padding: '10px 14px', background: 'rgba(46,204,113,0.06)', border: '1px solid rgba(46,204,113,0.15)', borderRadius: 6, fontSize: 12, color: 'var(--tx-2)' }}>
                This scenario is committed — its adjustments are locked as your actual plan baseline.
              </div>
            )}
          </>
        ) : activeTab === 'forecast-impact' ? (
          <ForecastImpactChart adjustments={adjustments} ctx={context} />
        ) : activeTab === 'comparison' ? (
          <ComparisonChart adjustments={adjustments} ctx={context} />
        ) : (
          <TimelineChart adjustments={adjustments} />
        )}
      </div>
    </div>
  )
}

// ── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ viewMode, committedCount, modeledCount }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%', padding: 40, textAlign: 'center',
    }}>
      <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>◑</div>
      <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 600, color: 'var(--tx-1)' }}>
        {viewMode === 'actual-plan' && committedCount === 0 ? 'No committed scenarios yet' : 'Select a scenario'}
      </h3>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--tx-2)', maxWidth: 360, lineHeight: 1.6 }}>
        {viewMode === 'actual-plan' && committedCount === 0
          ? 'Promote a modeled scenario to committed to lock it into your actual plan.'
          : modeledCount + committedCount === 0
          ? 'Create a scenario to start modeling "what if" decisions against your baseline.'
          : 'Select a scenario from the list to view its details.'}
      </p>
    </div>
  )
}

// ── Main module ──────────────────────────────────────────────────────────────

export default function Scenarios({ userId, mobile, reloadSignal, context, onDataChange, openScenarioId, onGoToForecast }) {
  const [scenarios, setScenarios] = useState([])
  const [adjustments, setAdjustments] = useState({}) // { [scenarioId]: adj[] }
  const [adjLoading, setAdjLoading] = useState({})
  const [categories, setCategories] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [viewMode, setViewMode] = useState('scenario') // 'baseline' | 'actual-plan' | 'scenario'
  const [showNewForm, setShowNewForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const selected = scenarios.find(s => s.id === selectedId) ?? null
  const modeled = scenarios.filter(s => s.state === 'modeled')
  const committed = scenarios.filter(s => s.state === 'committed')

  const loadScenarios = useCallback(async () => {
    if (!userId) return
    try {
      const data = await getScenarios(userId)
      setScenarios(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    loadScenarios()
    getBudgetCategories(userId).then(setCategories).catch(() => {})
  }, [userId, loadScenarios])

  useEffect(() => {
    if (!reloadSignal) return
    getScenarios(userId).then(setScenarios).catch(() => {})
    getBudgetCategories(userId).then(setCategories).catch(() => {})
  }, [reloadSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!openScenarioId) return
    setSelectedId(openScenarioId)
    setViewMode('scenario')
    loadAdjustments(openScenarioId)
  }, [openScenarioId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAiCreated(created) {
    const list = await getScenarios(userId).catch(() => null)
    if (list) setScenarios(list)
    getBudgetCategories(userId).then(setCategories).catch(() => {})
    const first = created?.[0]
    if (first?.scenarioId) {
      setAdjustments(prev => { const n = { ...prev }; delete n[first.scenarioId]; return n })
      setSelectedId(first.scenarioId)
      loadAdjustments(first.scenarioId)
    }
    onDataChange?.()
  }

  function handleOpenScenario(scenarioId) {
    setSelectedId(scenarioId)
    setViewMode('scenario')
    loadAdjustments(scenarioId)
  }

  async function loadAdjustments(scenarioId) {
    if (adjustments[scenarioId] || adjLoading[scenarioId]) return
    setAdjLoading(prev => ({ ...prev, [scenarioId]: true }))
    try {
      const data = await getAdjustments(userId, scenarioId)
      setAdjustments(prev => ({ ...prev, [scenarioId]: data }))
    } catch {
      setAdjustments(prev => ({ ...prev, [scenarioId]: [] }))
    } finally {
      setAdjLoading(prev => ({ ...prev, [scenarioId]: false }))
    }
  }

  function handleSelect(id) {
    setSelectedId(id)
    loadAdjustments(id)
  }

  async function handleCreate(data) {
    const s = await createScenario(userId, data)
    setScenarios(prev => [s, ...prev])
    setShowNewForm(false)
    setSelectedId(s.id)
    setAdjustments(prev => ({ ...prev, [s.id]: [] }))
  }

  async function handleDelete(scenarioId) {
    await deleteScenario(userId, scenarioId)
    setScenarios(prev => prev.filter(s => s.id !== scenarioId))
    if (selectedId === scenarioId) setSelectedId(null)
  }

  async function handlePromote(scenarioId) {
    const updated = await promoteToCommitted(userId, scenarioId)
    setScenarios(prev => prev.map(s => s.id === scenarioId ? updated : s))
    onDataChange?.()
  }

  async function handleAddAdj(data) {
    const adj = await addAdjustment(userId, selectedId, data)
    setAdjustments(prev => ({ ...prev, [selectedId]: [...(prev[selectedId] ?? []), adj] }))
  }

  async function handleDeleteAdj(adjId) {
    await deleteAdjustment(adjId)
    setAdjustments(prev => ({ ...prev, [selectedId]: (prev[selectedId] ?? []).filter(a => a.id !== adjId) }))
  }

  const selectedAdjs = adjustments[selectedId] ?? []
  const isAdjLoading = adjLoading[selectedId] ?? false

  const visibleSelected = viewMode === 'actual-plan' ? (committed[0] ?? null) : selected

  const btnBase = { padding: '6px 14px', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500, transition: 'all 0.15s' }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--tx-3)', fontSize: 14 }}>
        Loading scenarios…
      </div>
    )
  }

  if (error) {
    return <div style={{ padding: 32, color: 'var(--red)', fontSize: 14 }}>Error loading scenarios: {error}</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Module header */}
      <div style={{
        padding: mobile ? '16px 16px 12px' : '18px 24px 14px',
        borderBottom: '1px solid var(--bd)', flexShrink: 0,
        display: 'flex', alignItems: mobile ? 'flex-start' : 'flex-end', gap: 12, flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={headerStyles.icon}>◑</span>
            <h1 style={headerStyles.title(mobile)}>Scenario Planner</h1>
          </div>
          <div style={{ ...headerStyles.subtitle, marginTop: 6, marginLeft: 30 }}>
            Model one-off and recurring changes against your real baseline.
          </div>
        </div>
        {/* View mode toggle */}
        <div style={{ display: 'flex', gap: 0, background: 'var(--bg-card)', border: '1px solid var(--bd)', borderRadius: 8, overflow: 'hidden' }}>
          {[
            { key: 'baseline', label: 'Baseline' },
            { key: 'actual-plan', label: 'Actual Plan' },
            { key: 'scenario', label: 'Scenarios' },
          ].map(({ key, label }, i, arr) => (
            <button key={key} onClick={() => setViewMode(key)} style={{
              ...btnBase, border: 'none',
              borderRight: i < arr.length - 1 ? '1px solid var(--bd)' : 'none',
              background: viewMode === key ? 'var(--accent-bg)' : 'transparent',
              color: viewMode === key ? 'var(--accent)' : 'var(--tx-2)',
              fontWeight: viewMode === key ? 600 : 400,
              borderRadius: 0,
            }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {/* Baseline view mode */}
        {viewMode === 'baseline' && (
          <BaselinePanel ctx={context} />
        )}

        {/* Scenario / Actual-plan modes */}
        {viewMode !== 'baseline' && (
          <>
            {/* Left panel: scenario list */}
            {(viewMode === 'scenario' || !mobile) && (
              <div style={{
                width: mobile ? '100%' : 260, flexShrink: 0,
                borderRight: mobile ? 'none' : '1px solid var(--bd)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
              }}>
                {viewMode === 'scenario' && (
                  <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--bd-light)' }}>
                    <button onClick={() => { setShowNewForm(true); setSelectedId(null) }} style={{
                      width: '100%', padding: '8px 12px', background: 'var(--accent)',
                      color: 'var(--accent-tx-on)', border: 'none', borderRadius: 6,
                      fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}>
                      + New Scenario
                    </button>
                  </div>
                )}

                {showNewForm && viewMode === 'scenario' && (
                  <NewScenarioForm onSubmit={handleCreate} onCancel={() => setShowNewForm(false)} />
                )}

                <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
                  {viewMode === 'actual-plan' && (
                    <div style={{ padding: '6px 14px 8px', fontSize: 10, fontWeight: 600, color: 'var(--tx-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      Committed to Plan
                    </div>
                  )}

                  {modeled.length > 0 && viewMode === 'scenario' && (
                    <>
                      <div style={{ padding: '4px 14px 6px', fontSize: 10, fontWeight: 600, color: 'var(--tx-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                        Modeled
                      </div>
                      {modeled.map(s => (
                        <ScenarioListItem key={s.id} scenario={s} selected={selectedId === s.id} onClick={() => handleSelect(s.id)} />
                      ))}
                    </>
                  )}

                  {committed.length > 0 && (
                    <>
                      <div style={{ padding: `${modeled.length && viewMode === 'scenario' ? '14px' : '4px'} 14px 6px`, fontSize: 10, fontWeight: 600, color: 'var(--tx-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                        Committed
                      </div>
                      {committed.map(s => (
                        <ScenarioListItem key={s.id} scenario={s} selected={selectedId === s.id} onClick={() => handleSelect(s.id)} />
                      ))}
                    </>
                  )}

                  {scenarios.length === 0 && !showNewForm && viewMode === 'scenario' && (
                    <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 12, color: 'var(--tx-3)' }}>
                      No scenarios yet.<br />Create one to start modeling.
                    </div>
                  )}

                  {viewMode === 'actual-plan' && committed.length === 0 && (
                    <div style={{ padding: '20px 16px', textAlign: 'center', fontSize: 12, color: 'var(--tx-3)' }}>
                      No committed scenarios yet.<br />Promote a modeled scenario to add it to your plan.
                    </div>
                  )}
                </div>

                <div style={{ padding: '10px 14px', borderTop: '1px solid var(--bd-light)', fontSize: 11, color: 'var(--tx-3)', lineHeight: 1.5 }}>
                  Use the AI composer or "+ New Scenario" to model changes.
                </div>
              </div>
            )}

            {/* Main panel */}
            {(viewMode !== 'scenario' || !mobile || selectedId) && (
              <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {visibleSelected ? (
                  <ScenarioDetail
                    scenario={visibleSelected}
                    adjustments={viewMode === 'actual-plan'
                      ? (adjustments[visibleSelected.id] ?? [])
                      : selectedAdjs}
                    categories={categories}
                    context={context}
                    onPromote={handlePromote}
                    onDelete={handleDelete}
                    onAddAdj={handleAddAdj}
                    onDeleteAdj={handleDeleteAdj}
                    loading={viewMode === 'actual-plan' ? (adjLoading[visibleSelected?.id] ?? false) : isAdjLoading}
                    onGoToForecast={onGoToForecast}
                  />
                ) : viewMode === 'scenario' ? (
                  <div style={{ flex: 1, overflow: 'auto', padding: mobile ? 16 : 24 }}>
                    <div style={{ maxWidth: 720, margin: '0 auto' }}>
                      <AiScenarioComposer
                        userId={userId}
                        context={context}
                        onCreated={handleAiCreated}
                        onOpenScenario={handleOpenScenario}
                        mobile={mobile}
                      />
                      <div style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--tx-3)', lineHeight: 1.6, marginTop: 18 }}>
                        {scenarios.length === 0
                          ? 'Or build one manually with "+ New Scenario".'
                          : 'Pick a scenario on the left to view its details, or describe a new one above.'}
                      </div>
                    </div>
                  </div>
                ) : (
                  <EmptyState viewMode={viewMode} committedCount={committed.length} modeledCount={modeled.length} />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

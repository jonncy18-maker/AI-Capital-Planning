import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react'
import {
  getScenarios,
  createScenario,
  deleteScenario,
  promoteToCommitted,
  promoteToModeled,
  getAdjustments,
  addAdjustment,
  deleteAdjustment,
  cloneScenario,
} from '../../lib/db/scenarios.js'
import { getBudgetCategories } from '../../lib/db/budgetCategories.js'
import { getIncomeAdjustments, addIncomeAdjustment } from '../../lib/db/incomeScenarios.js'
import { computeIncomeScenarioRows } from '../../lib/income/incomeScenarioMath.js'
import { runScenarioAgent, confirmPendingScenario, cancelPendingScenario, runAdjustmentAgent, confirmPendingAdjustments, cancelPendingAdjustments } from '../../lib/ai/scenarioAgent.js'
import { headerStyles } from '../common/headerStyles.js'
import Markdown from '../common/Markdown.jsx'
import { computeImpactSummary, buildComparisonRows } from '../../lib/scenarios/scenarioUtils.js'

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
  const idea = state === 'idea'
  const bg = committed ? 'rgba(46,204,113,0.12)' : idea ? 'rgba(245,158,11,0.12)' : 'rgba(0,194,168,0.1)'
  const color = committed ? 'var(--green)' : idea ? '#f59e0b' : 'var(--accent)'
  const border = committed ? 'rgba(46,204,113,0.25)' : idea ? 'rgba(245,158,11,0.25)' : 'var(--accent-bd)'
  const label = committed ? '✓ Committed' : idea ? '◎ Idea' : '◑ Modeled'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 9px', borderRadius: 10, fontSize: 11, fontWeight: 600,
      letterSpacing: '0.05em', textTransform: 'uppercase',
      background: bg, color, border: `1px solid ${border}`,
    }}>
      {label}
    </span>
  )
}

// ── Scenario list item ───────────────────────────────────────────────────────

function ScenarioListItem({ scenario, selected, onClick, adjustments }) {
  const adjs = adjustments ?? []
  const netDelta = adjs.reduce((s, a) => s + Number(a.delta_amount), 0)
  const hasData = adjs.length > 0

  let span = null
  if (hasData) {
    const sorted = [...adjs].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    const fmtP = (a) => `${MONTHS[a.month - 1]} '${String(a.year).slice(-2)}`
    span = (first.year === last.year && first.month === last.month) ? fmtP(first) : `${fmtP(first)} – ${fmtP(last)}`
  }

  return (
    <button onClick={onClick} style={{
      display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px',
      background: selected ? 'var(--accent-bg)' : 'transparent', border: 'none',
      borderLeft: `2px solid ${selected ? 'var(--accent)' : 'transparent'}`,
      color: 'var(--tx-1)', cursor: 'pointer', borderRadius: '0 6px 6px 0',
      marginBottom: 2, transition: 'background 0.15s',
    }}>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: hasData ? 5 : 3, color: selected ? 'var(--accent)' : 'var(--tx-1)' }}>
        {scenario.name}
      </div>
      {!hasData && scenario.description && (
        <div style={{ fontSize: 11, color: 'var(--tx-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 2 }}>
          {scenario.description}
        </div>
      )}
      {hasData ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{
            display: 'inline-block', padding: '2px 7px', borderRadius: 10,
            fontSize: 10.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
            background: netDelta < 0 ? 'rgba(46,204,113,0.1)' : netDelta > 0 ? 'rgba(229,57,53,0.1)' : 'var(--hover)',
            color: netDelta < 0 ? 'var(--green)' : netDelta > 0 ? 'var(--red)' : 'var(--tx-3)',
            border: `1px solid ${netDelta < 0 ? 'rgba(46,204,113,0.2)' : netDelta > 0 ? 'rgba(229,57,53,0.2)' : 'var(--bd)'}`,
          }}>
            {netDelta === 0 ? '$0' : (netDelta < 0 ? '−' : '+') + fmtAbs(netDelta)}
          </span>
          {span && <span style={{ fontSize: 10, color: 'var(--tx-3)', fontFamily: "'DM Mono', monospace" }}>{span}</span>}
        </div>
      ) : (
        <div style={{ fontSize: 10, color: 'var(--tx-3)', marginTop: 4 }}>
          {new Date(scenario.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
      )}
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

// ── Forecast impact chart ───────────────────────────────────────────────────

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

  const year = CUR_YEAR
  const excluded = new Set((ctx?.categories ?? []).filter(c => c.exclude_from_totals).map(c => c.category))

  // Actual spending from transactions for past months
  const monthlyActual = Array(12).fill(0)
  for (const t of (ctx?.transactions ?? [])) {
    const amt = Number(t.amount) || 0
    if (amt >= 0) continue
    if (excluded.has(t.category)) continue
    const d = new Date(t.date)
    if (isNaN(d.getTime()) || d.getFullYear() !== year) continue
    monthlyActual[d.getMonth()] += Math.abs(amt)
  }

  // Planned monthly from forecast/budget
  const monthlyPlan = Array(12).fill(0)
  for (const item of baselineItems) {
    const m = (item.month ?? 1) - 1
    if (m >= 0 && m < 12) monthlyPlan[m] += Number(item.amount) || 0
  }

  // Display: past months use actual, current/future use plan
  const monthly = Array(12).fill(0).map((_, m) =>
    m < CUR_MONTH ? monthlyActual[m] : monthlyPlan[m]
  )

  const annualTotal = monthly.reduce((a, b) => a + b, 0)
  const nonZeroMonths = monthly.filter(v => v > 0)
  const monthlyAvg = nonZeroMonths.length > 0 ? nonZeroMonths.reduce((a, b) => a + b, 0) / nonZeroMonths.length : 0

  // Category group breakdown: past = actual from transactions, future = plan
  const actualByGroup = {}
  for (const t of (ctx?.transactions ?? [])) {
    const amt = Number(t.amount) || 0
    if (amt >= 0) continue
    if (excluded.has(t.category)) continue
    const d = new Date(t.date)
    if (isNaN(d.getTime()) || d.getFullYear() !== year || d.getMonth() >= CUR_MONTH) continue
    const group = t.group || 'Other'
    actualByGroup[group] = (actualByGroup[group] || 0) + Math.abs(amt)
  }
  const plannedByGroup = {}
  for (const item of baselineItems) {
    const m = (item.month ?? 1) - 1
    if (m < CUR_MONTH) continue
    const group = item.budget_categories?.group || 'Other'
    plannedByGroup[group] = (plannedByGroup[group] || 0) + Number(item.amount || 0)
  }
  const allGroupNames = new Set([...Object.keys(actualByGroup), ...Object.keys(plannedByGroup)])
  const groups = Array.from(allGroupNames).map(g => ({
    group: g,
    actual: actualByGroup[g] || 0,
    planned: plannedByGroup[g] || 0,
    total: (actualByGroup[g] || 0) + (plannedByGroup[g] || 0),
  })).sort((a, b) => b.total - a.total)

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
        <div style={{ marginBottom: 22 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--tx-1)', marginBottom: 5 }}>
            Your {CUR_YEAR} Financial Baseline
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--tx-2)', lineHeight: 1.6 }}>
            Past months show <strong>actual spending</strong>; current and future months show your {isUsingForecast ? 'forecast' : 'budget'} plan.
            Scenarios model "what if" changes against this baseline.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 22 }}>
          {[
            { label: `${CUR_YEAR} Projected`, value: '$' + Math.round(annualTotal).toLocaleString() },
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

        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bd)', borderRadius: 10, padding: '18px 20px 14px', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              Monthly Spending — {CUR_YEAR} · {isUsingForecast ? 'Forecast' : 'Budget'}
            </div>
            <div style={{ display: 'flex', gap: 14, fontSize: 10, color: 'var(--tx-3)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: 'rgba(120,120,145,0.65)', display: 'inline-block' }} />
                Actual
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--accent)', opacity: 0.65, display: 'inline-block' }} />
                Plan
              </span>
            </div>
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
                const isActual = m < CUR_MONTH
                const isCur = m === CUR_MONTH
                const isPast = m < CUR_MONTH
                const barH = v > 0 ? Math.max(2, dH - (yScale(v) - PT)) : 0
                const fill = isActual ? 'rgba(120,120,145,0.65)' : 'var(--accent)'
                const opacity = isActual ? 1 : isCur ? 1 : 0.55
                return (
                  <g key={m}
                    onMouseEnter={e => setTooltip({ m, v, isActual, clientX: e.clientX, clientY: e.clientY })}
                    onMouseLeave={() => setTooltip(null)}
                    style={{ cursor: 'pointer' }}
                  >
                    {isCur && <rect x={PL + m * barSpacing} y={PT} width={barSpacing} height={dH} fill="var(--accent)" opacity={0.04} />}
                    {v > 0 && (
                      <rect x={xBar(m)} y={yScale(v)} width={barW} height={barH}
                        fill={fill} fillOpacity={opacity} rx={3} />
                    )}
                    <text x={xBar(m) + barW / 2} y={H - PB + 14} textAnchor="middle" fontSize={8.5}
                      fill={isCur ? 'var(--accent)' : isPast ? 'var(--tx-4)' : 'var(--tx-3)'}
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
                  <span style={{ color: 'var(--tx-3)' }}>{tooltip.isActual ? 'Actual spend' : 'Planned spend'}</span>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, color: 'var(--tx-1)' }}>
                    ${Math.round(tooltip.v).toLocaleString()}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {groups.length > 0 && (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bd)', borderRadius: 10, padding: '18px 20px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 16 }}>
              Spending by Category Group
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {groups.slice(0, 8).map(({ group, actual, planned, total }, i) => {
                const pct = annualTotal > 0 ? (total / annualTotal) * 100 : 0
                const actualPct = total > 0 ? (actual / total) * 100 : 0
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
                    <div style={{ height: 6, background: 'var(--bd-light)', borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
                      {actual > 0 && (
                        <div style={{ height: '100%', width: `${actualPct}%`, background: 'rgba(120,120,145,0.65)', borderRadius: '3px 0 0 3px', flexShrink: 0 }} />
                      )}
                      {planned > 0 && (
                        <div style={{ height: '100%', width: `${100 - actualPct}%`, background: 'var(--accent)', opacity: 0.55, borderRadius: actual > 0 ? '0 3px 3px 0' : 3 }} />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div style={{ marginTop: 18, padding: '11px 15px', background: 'var(--accent-bg)', border: '1px solid var(--accent-bd)', borderRadius: 8, fontSize: 12, color: 'var(--tx-2)', lineHeight: 1.6 }}>
          Select a scenario in the sidebar to see its delta against this baseline. Commit a scenario to lock it into your plan — committed scenarios flow automatically into the Forecast.
        </div>
      </div>
    </div>
  )
}

// ── AI Scenario Composer (iterative, conversational) ─────────────────────────

function ChatMessage({ message, onOpenScenario, onConfirm, onCancel }) {
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
        ) : message.pending ? (
          <div style={{ border: '1px solid var(--accent-bd)', borderRadius: 10, overflow: 'hidden', maxWidth: 420 }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--bd-light)', background: 'var(--accent-bg)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tx-1)', marginBottom: 2 }}>
                ✦ {message.pending.preview.name}
              </div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: 'var(--tx-3)' }}>
                {message.pending.preview.adjustmentCount} adjustment{message.pending.preview.adjustmentCount !== 1 ? 's' : ''} · net {message.pending.preview.netDelta >= 0 ? '+' : '−'}${Math.abs(Math.round(message.pending.preview.netDelta)).toLocaleString()}
              </div>
            </div>
            <div style={{ padding: '8px 14px', maxHeight: 140, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {message.pending.preview.adjustments.slice(0, 8).map((a, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--tx-2)' }}>
                  <span>{a.category} · {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][a.month - 1]} {a.year}</span>
                  <span style={{ fontFamily: "'DM Mono', monospace", color: a.delta_amount >= 0 ? 'var(--warn)' : 'var(--success, #4ade80)', fontWeight: 600 }}>
                    {a.delta_amount >= 0 ? '+' : '−'}${Math.abs(Math.round(a.delta_amount)).toLocaleString()}
                  </span>
                </div>
              ))}
              {message.pending.preview.adjustments.length > 8 && (
                <div style={{ fontSize: 10, color: 'var(--tx-4)', fontStyle: 'italic' }}>
                  +{message.pending.preview.adjustments.length - 8} more…
                </div>
              )}
            </div>
            <div style={{ padding: '10px 14px', borderTop: '1px solid var(--bd-light)', display: 'flex', gap: 8 }}>
              <button onClick={onConfirm} style={{
                flex: 1, background: 'var(--accent)', color: 'var(--accent-tx-on)', border: 'none',
                borderRadius: 7, padding: '7px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}>
                ✓ Create Scenario
              </button>
              <button onClick={onCancel} style={{
                background: 'none', border: '1px solid var(--bd)', color: 'var(--tx-3)',
                borderRadius: 7, padding: '7px 14px', fontSize: 12, cursor: 'pointer',
              }}>
                Cancel
              </button>
            </div>
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
  const [messages, setMessages] = useState([]) // [{role, text, loading, pending, created, error, statusText}]
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingScenario, setPendingScenario] = useState(null)
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
      if (res.status === 'pending') {
        setPendingScenario(res.pending)
        setMessages(prev => {
          const next = [...prev]
          next[next.length - 1] = { role: 'ai', text: '', pending: res.pending }
          return next
        })
        setBusy(false)
        return
      }
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

  async function handleConfirmScenario() {
    const pending = pendingScenario
    if (!pending) return
    setPendingScenario(null)
    setBusy(true)
    setMessages(prev => {
      const next = [...prev]
      next[next.length - 1] = { role: 'ai', text: '', loading: true, statusText: `Building "${pending.preview.name}" …` }
      return next
    })
    try {
      const res = await confirmPendingScenario({ userId, pending, context,
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

  async function handleCancelScenario() {
    const pending = pendingScenario
    if (!pending) return
    setPendingScenario(null)
    setBusy(true)
    setMessages(prev => {
      const next = [...prev]
      next[next.length - 1] = { role: 'ai', text: '', loading: true, statusText: 'Cancelling…' }
      return next
    })
    try {
      const res = await cancelPendingScenario({ pending, context })
      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = { role: 'ai', text: res.text || 'Scenario cancelled.', created: [] }
        return next
      })
    } catch {
      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = { role: 'ai', text: 'Scenario cancelled.', created: [] }
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
            <ChatMessage
              key={i}
              message={msg}
              onOpenScenario={onOpenScenario}
              onConfirm={msg.pending ? handleConfirmScenario : undefined}
              onCancel={msg.pending ? handleCancelScenario : undefined}
            />
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

// ── Waterfall / bridge chart ─────────────────────────────────────────────────

function WaterfallChart({ adjustments }) {
  const [tooltip, setTooltip] = useState(null)

  if (!adjustments.length) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--tx-3)', fontSize: 13 }}>
        No adjustments to break down. Add adjustments to see how they add up.
      </div>
    )
  }

  // Group by category_id + label, preserving first-occurrence order
  const groupOrder = []
  const groups = {}
  const sortedAdjs = [...adjustments].sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month - b.month
  )
  for (const adj of sortedAdjs) {
    const cat = adj.budget_categories?.category ?? '—'
    const lbl = adj.label?.trim() || ''
    const key = `${adj.category_id}::${lbl}`
    if (!groups[key]) {
      groups[key] = { key, display: lbl ? `${cat} · ${lbl}` : cat, delta: 0, count: 0 }
      groupOrder.push(key)
    }
    groups[key].delta += Number(adj.delta_amount)
    groups[key].count++
  }

  const items = groupOrder.map(k => groups[k]).filter(g => Math.abs(g.delta) > 0.01)
  if (!items.length) return null

  const netDelta = items.reduce((s, g) => s + g.delta, 0)

  // Build running totals to determine Y range
  let running = 0
  const snapshots = [0]
  for (const item of items) {
    running += item.delta
    snapshots.push(running)
  }

  const allY = [...snapshots, 0]
  const rawMin = Math.min(...allY)
  const rawMax = Math.max(...allY)
  const range = rawMax - rawMin || 1
  const yMin = rawMin - range * 0.18
  const yMax = rawMax + range * 0.18

  const W = 700, H = 220
  const PL = 66, PR = 20, PT = 22, PB = 52
  const dW = W - PL - PR
  const dH = H - PT - PB
  const n = items.length + 1
  const groupW = dW / n
  const barW = Math.min(groupW * 0.55, 56)

  const yScale = v => PT + dH - ((v - yMin) / (yMax - yMin)) * dH
  const barCx = i => PL + i * groupW + groupW / 2
  const barLeft = i => barCx(i) - barW / 2

  const yTicks = [rawMin, 0, rawMax].filter((v, i, arr) =>
    arr.indexOf(v) === i && Math.abs(v - (arr[i - 1] ?? -Infinity)) > range * 0.1
  )

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--tx-1)', marginBottom: 4 }}>Adjustment Breakdown</div>
      <div style={{ fontSize: 12, color: 'var(--tx-2)', lineHeight: 1.5, marginBottom: 14 }}>
        How each change contributes to the net impact — grouped by item, summed across months.
      </div>

      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block', overflow: 'visible' }}>
          {/* Grid & Y labels */}
          {yTicks.map((tick, i) => (
            <g key={i}>
              <line x1={PL} y1={yScale(tick)} x2={W - PR} y2={yScale(tick)}
                stroke={tick === 0 ? 'var(--bd)' : 'var(--bd-light)'}
                strokeWidth={tick === 0 ? 1.5 : 1}
                strokeDasharray={tick === 0 ? undefined : '3,3'} />
              <text x={PL - 5} y={yScale(tick)} textAnchor="end" dominantBaseline="middle"
                fontSize={8} fill="var(--tx-3)" fontFamily="'DM Mono', monospace">
                {tick === 0 ? '$0' : (tick < 0 ? '−' : '+') + fmtAbs(tick)}
              </text>
            </g>
          ))}

          {/* Bars */}
          {(() => {
            let run = 0
            const els = []

            items.forEach((item, i) => {
              const before = run
              run += item.delta
              const y1 = yScale(before)
              const y2 = yScale(run)
              const bY = Math.min(y1, y2)
              const bH = Math.max(3, Math.abs(y1 - y2))
              const bX = barLeft(i)
              const fill = item.delta < 0 ? '#2ecc71' : '#e05252'

              if (i > 0) {
                els.push(
                  <line key={`c${i}`}
                    x1={barLeft(i - 1) + barW} y1={yScale(before)}
                    x2={bX} y2={yScale(before)}
                    stroke="rgba(255,255,255,0.15)" strokeWidth={1} strokeDasharray="2,3" />
                )
              }

              els.push(
                <g key={`b${i}`}
                  onMouseEnter={e => setTooltip({ item, clientX: e.clientX, clientY: e.clientY })}
                  onMouseLeave={() => setTooltip(null)}
                  style={{ cursor: 'pointer' }}
                >
                  <rect x={bX} y={bY} width={barW} height={bH}
                    fill={fill} fillOpacity={0.75} rx={3}
                    stroke={fill} strokeOpacity={0.45} strokeWidth={1} />
                  <text x={barCx(i)} y={item.delta < 0 ? bY - 5 : bY + bH + 11}
                    textAnchor="middle" fontSize={8.5} fontWeight={700}
                    fill={fill} fontFamily="'DM Mono', monospace">
                    {item.delta < 0 ? '−' : '+'}{fmtAbs(item.delta)}
                  </text>
                  <text x={barCx(i)} y={H - PB + 14} textAnchor="middle"
                    fontSize={7.5} fill="var(--tx-3)" fontFamily="'DM Mono', monospace">
                    {item.display.length > 15 ? item.display.slice(0, 14) + '…' : item.display}
                  </text>
                  {item.count > 1 && (
                    <text x={barCx(i)} y={H - PB + 25} textAnchor="middle"
                      fontSize={7} fill="var(--tx-4)" fontFamily="'DM Mono', monospace">
                      ×{item.count} mo
                    </text>
                  )}
                </g>
              )
            })

            // Net bar (0 → netDelta)
            const ni = items.length
            const nX = barLeft(ni)
            const y1 = yScale(0)
            const y2 = yScale(netDelta)
            const bY = Math.min(y1, y2)
            const bH = Math.max(3, Math.abs(y1 - y2))
            const netFill = netDelta < 0 ? '#2ecc71' : 'var(--accent)'

            if (items.length > 0) {
              els.push(
                <line key="c-net"
                  x1={barLeft(ni - 1) + barW} y1={yScale(netDelta)}
                  x2={nX} y2={yScale(netDelta)}
                  stroke="rgba(255,255,255,0.15)" strokeWidth={1} strokeDasharray="2,3" />
              )
            }
            els.push(
              <g key="b-net">
                <rect x={nX} y={bY} width={barW} height={bH}
                  fill={netFill} fillOpacity={0.9} rx={3}
                  stroke={netFill} strokeOpacity={0.5} strokeWidth={1.5} />
                <text x={barCx(ni)} y={netDelta < 0 ? bY - 5 : bY + bH + 11}
                  textAnchor="middle" fontSize={8.5} fontWeight={700}
                  fill={netFill} fontFamily="'DM Mono', monospace">
                  {netDelta === 0 ? '$0' : (netDelta < 0 ? '−' : '+') + fmtAbs(netDelta)}
                </text>
                <text x={barCx(ni)} y={H - PB + 14} textAnchor="middle"
                  fontSize={7.5} fill="var(--tx-2)" fontFamily="'DM Mono', monospace" fontWeight={700}>
                  Net Total
                </text>
              </g>
            )
            return els
          })()}
        </svg>

        {tooltip && (
          <div style={{
            position: 'fixed', top: tooltip.clientY - 10, left: tooltip.clientX + 14,
            zIndex: 300, background: 'var(--bg-card)', border: '1px solid var(--bd)',
            borderRadius: 9, padding: '10px 14px', boxShadow: '0 6px 22px rgba(0,0,0,0.18)',
            pointerEvents: 'none', fontSize: 12, minWidth: 180,
          }}>
            <div style={{ fontWeight: 700, color: 'var(--tx-1)', marginBottom: 6 }}>{tooltip.item.display}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
              <span style={{ color: 'var(--tx-3)' }}>Total delta</span>
              <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, color: tooltip.item.delta < 0 ? 'var(--green)' : 'var(--red)' }}>
                {tooltip.item.delta < 0 ? '−' : '+'}{fmtAbs(tooltip.item.delta)}
              </span>
            </div>
            {tooltip.item.count > 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginTop: 4 }}>
                <span style={{ color: 'var(--tx-3)' }}>Spread across</span>
                <span style={{ fontFamily: "'DM Mono', monospace", color: 'var(--tx-2)' }}>{tooltip.item.count} months</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── AI Adjustment Composer ───────────────────────────────────────────────────

function AiAdjustmentComposer({ userId, scenarioId, scenarioName, existingAdjustments, categories, context, onCompleted }) {
  const [messages, setMessages] = useState([])
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const messagesEndRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function run() {
    const text = prompt.trim()
    if (!text || busy) return
    const userMsg = { role: 'user', text }
    const loadingMsg = { role: 'ai', text: '', loading: true }
    setMessages(prev => [...prev, userMsg, loadingMsg])
    setPrompt('')
    setBusy(true)
    const history = messages
      .filter(m => m.text && !m.loading && !m.pending)
      .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }))
    try {
      const res = await runAdjustmentAgent({ userId, scenarioId, scenarioName, history, prompt: text, context, existingAdjustments })
      if (res.status === 'pending') {
        setMessages(prev => {
          const next = [...prev]
          next[next.length - 1] = { role: 'ai', text: '', pending: res.pending }
          return next
        })
        setBusy(false)
        return
      }
      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = { role: 'ai', text: res.text, error: res.status !== 'ok' }
        return next
      })
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

  async function handleConfirm(pendingData) {
    setBusy(true)
    try {
      const res = await confirmPendingAdjustments({ userId, pending: pendingData, context })
      setMessages(prev => prev.map(m => m.pending === pendingData ? { role: 'ai', text: res.text } : m))
      onCompleted?.()
    } catch (e) {
      setMessages(prev => prev.map(m => m.pending === pendingData ? { role: 'ai', text: e.message, error: true } : m))
    } finally {
      setBusy(false)
    }
  }

  async function handleCancel(pendingData) {
    const res = await cancelPendingAdjustments({ pending: pendingData, context })
    setMessages(prev => prev.map(m => m.pending === pendingData ? { role: 'ai', text: res.text } : m))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 260 }}>
      <div style={{ flex: 1, overflow: 'auto', maxHeight: 220, display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 4 }}>
        {messages.length === 0 && (
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--tx-3)', lineHeight: 1.6 }}>
            Describe what you want to add — e.g. <em>"Add $150/month to Dining from July through December"</em> or <em>"Remove $200/month from Travel in Q3."</em>
          </p>
        )}
        {messages.map((m, i) => {
          if (m.pending) {
            const p = m.pending.preview
            return (
              <div key={i} style={{ background: 'var(--accent-bg)', border: '1px solid var(--accent-bd)', borderRadius: 10, padding: '10px 14px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tx-1)', marginBottom: 6 }}>
                  Preview — {p.adjustmentCount} row{p.adjustmentCount !== 1 ? 's' : ''} · net {(p.netDelta >= 0 ? '+' : '') + '$' + Math.abs(Math.round(p.netDelta)).toLocaleString()}
                </div>
                {p.adjustments.map((a, j) => (
                  <div key={j} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--tx-2)', padding: '2px 0' }}>
                    <span>{a.category} · {MONTHS[a.month - 1]} {a.year}{a.label ? ` · ${a.label}` : ''}</span>
                    <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, color: a.delta_amount < 0 ? 'var(--green)' : 'var(--red)' }}>
                      {(a.delta_amount >= 0 ? '+' : '') + '$' + Math.abs(Math.round(a.delta_amount)).toLocaleString()}
                    </span>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button onClick={() => handleConfirm(m.pending)} disabled={busy} style={{ padding: '5px 14px', background: 'var(--accent)', color: 'var(--accent-tx-on)', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}>
                    ✓ Confirm
                  </button>
                  <button onClick={() => handleCancel(m.pending)} disabled={busy} style={{ padding: '5px 12px', background: 'transparent', color: 'var(--tx-3)', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 12, cursor: busy ? 'not-allowed' : 'pointer' }}>
                    Cancel
                  </button>
                </div>
              </div>
            )
          }
          return (
            <div key={i} style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '90%',
              background: m.role === 'user' ? 'var(--accent-bg)' : 'var(--bg-app)',
              border: '1px solid var(--bd)',
              borderRadius: m.role === 'user' ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
              padding: '7px 11px',
              fontSize: 12.5,
              color: m.error ? 'var(--red)' : m.loading ? 'var(--tx-3)' : 'var(--tx-1)',
              fontStyle: m.loading ? 'italic' : 'normal',
            }}>
              {m.loading ? 'Thinking…' : m.text}
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>
      <div style={{ display: 'flex', gap: 8, paddingTop: 10, borderTop: '1px solid var(--bd)', marginTop: 8 }}>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run() } }}
          placeholder="Describe the adjustment in plain English…"
          disabled={busy}
          rows={2}
          style={{
            flex: 1, resize: 'none', padding: '8px 10px', borderRadius: 8,
            background: 'var(--bg-app)', color: 'var(--tx-1)', border: '1px solid var(--bd)',
            fontSize: 12.5, fontFamily: 'inherit', outline: 'none',
          }}
        />
        <button
          onClick={run}
          disabled={busy || !prompt.trim()}
          style={{
            padding: '0 16px', background: 'var(--accent)', color: 'var(--accent-tx-on)',
            border: 'none', borderRadius: 8, fontSize: 16, fontWeight: 700,
            cursor: busy || !prompt.trim() ? 'not-allowed' : 'pointer',
            opacity: busy || !prompt.trim() ? 0.4 : 1, alignSelf: 'stretch',
          }}
        >→</button>
      </div>
    </div>
  )
}

// ── Scenario detail panel ────────────────────────────────────────────────────

function ScenarioDetail({
  scenario, adjustments, categories, context, userId,
  onPromote, onDelete, onAddAdj, onDeleteAdj, onClone, onAdjsRefresh, loading, onGoToForecast, mobile,
}) {
  const [rightView, setRightView] = useState('forecast')
  const [showAdjModal, setShowAdjModal] = useState(false)
  const [adjTab, setAdjTab] = useState('manual')
  const [sensitivity, setSensitivity] = useState(1.0)
  const [cloning, setCloning] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [promotedBanner, setPromotedBanner] = useState(false)

  const scaledAdjs = useMemo(
    () => sensitivity === 1 ? adjustments : adjustments.map(a => ({ ...a, delta_amount: Number(a.delta_amount) * sensitivity })),
    [adjustments, sensitivity]
  )

  const impactSummary = useMemo(
    () => computeImpactSummary(scaledAdjs, context),
    [scaledAdjs, context]
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

  async function handleClone() {
    setCloning(true)
    try { await onClone(scenario.id) } finally { setCloning(false) }
  }

  const chartToggleBtnStyle = (active) => ({
    padding: '5px 12px', border: 'none', fontSize: 11, cursor: 'pointer', transition: 'background 0.15s',
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? 'var(--accent-tx-on)' : 'var(--tx-3)',
    fontWeight: active ? 600 : 400,
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
            <button onClick={() => setShowAdjModal(true)} style={{
              padding: '7px 12px', background: 'transparent', color: 'var(--tx-2)',
              border: '1px solid var(--bd)', borderRadius: 6, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
            }}>
              {adjustments.length > 0 ? `${adjustments.length} adjustment${adjustments.length !== 1 ? 's' : ''}` : '+ Adjustments'}
            </button>
            <button onClick={handleClone} disabled={cloning} style={{
              padding: '7px 12px', background: 'transparent', color: 'var(--tx-2)',
              border: '1px solid var(--bd)', borderRadius: 6, fontSize: 12, cursor: cloning ? 'not-allowed' : 'pointer',
              opacity: cloning ? 0.5 : 1, whiteSpace: 'nowrap',
            }}>
              {cloning ? 'Cloning…' : '⧉ Clone'}
            </button>
            {!isCommitted && (
              <button onClick={handlePromote} disabled={promoting} style={{
                padding: '7px 14px', background: 'rgba(46,204,113,0.12)', color: 'var(--green)',
                border: '1px solid rgba(46,204,113,0.25)', borderRadius: 6, fontSize: 12, fontWeight: 600,
                cursor: promoting ? 'not-allowed' : 'pointer', opacity: promoting ? 0.6 : 1, whiteSpace: 'nowrap',
              }}>
                {promoting ? 'Committing…' : '✓ Commit'}
              </button>
            )}
            {confirmDelete ? (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  {isCommitted && (
                    <div style={{ fontSize: 10, color: 'var(--red)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                      This will remove it from your plan
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => onDelete(scenario.id)} style={{ padding: '7px 12px', background: 'rgba(229,57,53,0.12)', color: 'var(--red)', border: '1px solid rgba(229,57,53,0.25)', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      Confirm delete
                    </button>
                    <button onClick={() => setConfirmDelete(false)} style={{ padding: '7px 10px', background: 'transparent', color: 'var(--tx-2)', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <button onClick={() => setConfirmDelete(true)} title="Delete scenario" style={{ padding: '6px 10px', background: 'transparent', color: 'var(--tx-4)', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 14, lineHeight: 1, cursor: 'pointer' }}>
                ×
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

      {/* Chart — full width */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px', minWidth: 0 }}>
        {/* Sensitivity slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: '8px 12px', background: 'var(--bg-app)', border: '1px solid var(--bd)', borderRadius: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>Sensitivity</span>
          <span style={{ fontSize: 9.5, color: 'var(--tx-4)', fontFamily: "'DM Mono', monospace" }}>0.5×</span>
          <input type="range" min={0.5} max={2} step={0.1} value={sensitivity}
            onChange={e => setSensitivity(Number(e.target.value))}
            style={{ flex: 1, accentColor: 'var(--accent)', cursor: 'pointer', margin: 0 }} />
          <span style={{ fontSize: 9.5, color: 'var(--tx-4)', fontFamily: "'DM Mono', monospace" }}>2×</span>
          <span style={{
            fontSize: 12, fontWeight: 700, fontFamily: "'DM Mono', monospace", minWidth: 32,
            color: sensitivity !== 1 ? 'var(--accent)' : 'var(--tx-3)',
          }}>{sensitivity.toFixed(1)}×</span>
          {sensitivity !== 1 && (
            <button onClick={() => setSensitivity(1)} style={{ fontSize: 10, color: 'var(--tx-4)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0, whiteSpace: 'nowrap' }}>reset</button>
          )}
        </div>

        {/* View toggle */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
          <div style={{ display: 'flex', border: '1px solid var(--bd)', borderRadius: 7, overflow: 'hidden', background: 'var(--bg-app)' }}>
            {[{ key: 'forecast', label: 'Monthly' }, { key: 'comparison', label: 'Breakdown' }].map(({ key, label }) => (
              <button key={key} onClick={() => setRightView(key)} style={chartToggleBtnStyle(rightView === key)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {rightView === 'forecast'
          ? <ForecastImpactChart adjustments={scaledAdjs} ctx={context} />
          : <WaterfallChart adjustments={scaledAdjs} />}
      </div>

      {/* Adjustments modal */}
      {showAdjModal && (
        <div
          onClick={() => { setShowAdjModal(false); setShowAddForm(false) }}
          style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bg-card)', border: '1px solid var(--bd)', borderRadius: 14, width: 560, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 16px 48px rgba(0,0,0,0.35)' }}
          >
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--tx-1)' }}>Adjustments</span>
                <span style={{ fontSize: 12, color: 'var(--tx-3)', marginLeft: 8 }}>{scenario.name}</span>
              </div>
              <button onClick={() => { setShowAdjModal(false); setShowAddForm(false) }} style={{ background: 'none', border: 'none', color: 'var(--tx-3)', fontSize: 20, cursor: 'pointer', padding: '2px 6px', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
              {loading ? (
                <div style={{ color: 'var(--tx-3)', fontSize: 13 }}>Loading adjustments…</div>
              ) : (
                <>
                  <AdjustmentsTable adjustments={adjustments} onDelete={onDeleteAdj} readOnly={isCommitted} />
                  {!isCommitted && (
                    <>
                      {/* Tab toggle */}
                      <div style={{ display: 'flex', gap: 4, marginTop: 16, marginBottom: 14, background: 'var(--bg-app)', borderRadius: 8, padding: 3, border: '1px solid var(--bd)', width: 'fit-content' }}>
                        {[['manual', 'Manual'], ['ai', '✦ AI']].map(([key, label]) => (
                          <button
                            key={key}
                            onClick={() => { setAdjTab(key); setShowAddForm(false) }}
                            style={{
                              padding: '5px 14px', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                              background: adjTab === key ? 'var(--bg-card)' : 'transparent',
                              color: adjTab === key ? 'var(--tx-1)' : 'var(--tx-3)',
                              fontWeight: adjTab === key ? 600 : 400,
                              boxShadow: adjTab === key ? '0 1px 4px rgba(0,0,0,0.12)' : 'none',
                              transition: 'all 0.15s',
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      {adjTab === 'manual' && (showAddForm ? (
                        <AddAdjustmentForm categories={categories} onSubmit={handleAddAdj} onCancel={() => setShowAddForm(false)} />
                      ) : (
                        <button onClick={() => setShowAddForm(true)} style={{ padding: '8px 16px', background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent-bd)', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                          + Add Adjustment
                        </button>
                      ))}

                      {adjTab === 'ai' && (
                        <AiAdjustmentComposer
                          userId={userId}
                          scenarioId={scenario.id}
                          scenarioName={scenario.name}
                          existingAdjustments={adjustments}
                          categories={categories}
                          context={context}
                          onCompleted={() => onAdjsRefresh?.()}
                        />
                      )}
                    </>
                  )}
                  {isCommitted && (
                    <div style={{ marginTop: 14, padding: '10px 14px', background: 'rgba(46,204,113,0.06)', border: '1px solid rgba(46,204,113,0.15)', borderRadius: 6, fontSize: 12, color: 'var(--tx-2)' }}>
                      This scenario is committed — its adjustments are locked as your actual plan baseline.
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Actual Plan view (committed scenario cards) ──────────────────────────────

function ActualPlanView({ scenarios, adjustments, adjLoading, onViewScenario, onDelete }) {
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  if (!scenarios.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 14, opacity: 0.3 }}>✓</div>
        <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 600, color: 'var(--tx-1)' }}>No committed scenarios yet</h3>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--tx-2)', maxWidth: 340, lineHeight: 1.65 }}>
          Promote a modeled scenario to lock it into your actual plan. Committed scenarios flow into the Forecast module automatically.
        </p>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ marginBottom: 22 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--tx-1)', marginBottom: 6 }}>Actual Plan</h2>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--tx-2)', lineHeight: 1.6 }}>
            These scenarios have been committed and are now part of your financial plan. Their adjustments are locked and flow into the Forecast's <strong>+ Scenarios</strong> layer.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {scenarios.map(s => {
            const adjs = adjustments[s.id] ?? []
            const loading = adjLoading[s.id]
            const netDelta = adjs.reduce((sum, a) => sum + Number(a.delta_amount), 0)
            const periodSet = new Set(adjs.map(a => `${a.year}-${a.month}`))
            const periodCount = periodSet.size

            return (
              <div key={s.id} style={{
                background: 'var(--bg-card)', border: '1px solid var(--bd)',
                borderRadius: 12, padding: '18px 20px',
                display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
                      color: 'var(--green)', background: 'rgba(46,204,113,0.1)',
                      border: '1px solid rgba(46,204,113,0.25)', borderRadius: 10, padding: '2px 8px',
                    }}>✓ Committed</span>
                    {s.committed_at && (
                      <span style={{ fontSize: 11, color: 'var(--tx-4)', fontFamily: "'DM Mono', monospace" }}>
                        {new Date(s.committed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--tx-1)', marginBottom: s.description ? 4 : 10 }}>
                    {s.name}
                  </div>
                  {s.description && (
                    <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--tx-2)', lineHeight: 1.5 }}>{s.description}</p>
                  )}
                  {loading ? (
                    <div style={{ fontSize: 11, color: 'var(--tx-4)', fontFamily: "'DM Mono', monospace" }}>Loading…</div>
                  ) : (
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{
                        display: 'inline-block', padding: '4px 11px', borderRadius: 20,
                        fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                        background: netDelta < 0 ? 'rgba(46,204,113,0.1)' : netDelta > 0 ? 'rgba(229,57,53,0.1)' : 'var(--hover)',
                        color: netDelta < 0 ? 'var(--green)' : netDelta > 0 ? 'var(--red)' : 'var(--tx-2)',
                        border: `1px solid ${netDelta < 0 ? 'rgba(46,204,113,0.25)' : netDelta > 0 ? 'rgba(229,57,53,0.25)' : 'var(--bd)'}`,
                      }}>
                        {netDelta === 0 ? '$0' : (netDelta < 0 ? '−' : '+') + '$' + Math.abs(Math.round(netDelta)).toLocaleString()}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--tx-3)', fontFamily: "'DM Mono', monospace" }}>
                        {adjs.length} adjustment{adjs.length !== 1 ? 's' : ''}
                        {periodCount > 0 && ` · ${periodCount} month${periodCount !== 1 ? 's' : ''}`}
                      </span>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0, alignSelf: 'center' }}>
                  <button onClick={() => onViewScenario(s.id)} style={{
                    padding: '8px 16px', background: 'transparent',
                    color: 'var(--accent)', border: '1px solid var(--accent-bd)',
                    borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}>
                    View Details →
                  </button>
                  {confirmDeleteId === s.id ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => { onDelete(s.id); setConfirmDeleteId(null) }} style={{
                        flex: 1, padding: '6px 10px', background: 'rgba(229,57,53,0.12)', color: 'var(--red)',
                        border: '1px solid rgba(229,57,53,0.25)', borderRadius: 6, fontSize: 11,
                        fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                      }}>
                        Confirm delete
                      </button>
                      <button onClick={() => setConfirmDeleteId(null)} style={{
                        padding: '6px 8px', background: 'transparent', color: 'var(--tx-2)',
                        border: '1px solid var(--bd)', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                      }}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDeleteId(s.id)} style={{
                      padding: '6px 10px', background: 'transparent', color: 'var(--tx-4)',
                      border: '1px solid var(--bd)', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        {confirmDeleteId && (
          <div style={{ marginTop: 14, padding: '10px 14px', background: 'rgba(229,57,53,0.06)', border: '1px solid rgba(229,57,53,0.2)', borderRadius: 8, fontSize: 12, color: 'var(--tx-2)' }}>
            Deleting a committed scenario will remove it from your plan and the Forecast layer. This cannot be undone.
          </div>
        )}
      </div>
    </div>
  )
}

// ── Income tab ───────────────────────────────────────────────────────────────
// Model income-side changes (raise, bonus, recurring income, one-time windfall).
// You enter GROSS figures; net is derived using the same effective tax rate and
// 401k % the dashboard income forecast uses. Committing folds the post-tax net
// into that forecast (dashboard net/savings + AI brief).

const INC_GREEN = '#35c98a'
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const INCOME_TYPES = [
  { key: 'salary', label: 'Salary / raise' },
  { key: 'bonus', label: 'Bonus' },
  { key: 'recurring', label: 'Recurring' },
  { key: 'windfall', label: 'One-time' },
]

const money = (n) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(Number(n) || 0)).toLocaleString()}`

function IncomePanel({ userId, context, incomeScenarios, onChanged, mobile }) {
  const CUR_YEAR = new Date().getFullYear()
  const taxCtx = useMemo(() => ({
    effectiveRate: Number(context?.incomeEstimate?.effectiveRate) || 0,
    four01kPct: Number(context?.profile?.four01k_pct) || 0,
  }), [context])
  const hasTaxRate = taxCtx.effectiveRate > 0

  const [type, setType] = useState('salary')
  const [name, setName] = useState('')
  const [f, setF] = useState({
    newAnnualGross: '', oldAnnualGross: '', grossAmount: '', monthlyGross: '',
    startMonth: 1, endMonth: 12, month: 1, year: CUR_YEAR,
    applies401k: !!context?.profile?.four01k_on_bonus, taxable: type === 'windfall' ? false : true,
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [adjMap, setAdjMap] = useState({}) // { scenarioId: rows[] }
  const [expandedId, setExpandedId] = useState(null)

  const setField = (k, v) => setF(prev => ({ ...prev, [k]: v }))

  // Load income adjustments for each income scenario (for net-impact display).
  useEffect(() => {
    let alive = true
    ;(async () => {
      const entries = await Promise.all(
        (incomeScenarios || []).map(async s => {
          const rows = await getIncomeAdjustments(userId, s.id).catch(() => [])
          return [s.id, rows]
        })
      )
      if (alive) setAdjMap(Object.fromEntries(entries))
    })()
    return () => { alive = false }
  }, [userId, incomeScenarios])

  // Build the math input from the form.
  const buildInput = () => {
    const base = { type, year: Number(f.year) || CUR_YEAR, label: name.trim() }
    if (type === 'salary') return { ...base, startMonth: Number(f.startMonth), newAnnualGross: Number(f.newAnnualGross), oldAnnualGross: Number(f.oldAnnualGross) }
    if (type === 'bonus') return { ...base, month: Number(f.month), grossAmount: Number(f.grossAmount), applies401k: !!f.applies401k }
    if (type === 'recurring') return { ...base, startMonth: Number(f.startMonth), endMonth: Number(f.endMonth), monthlyGross: Number(f.monthlyGross), taxable: !!f.taxable }
    return { ...base, month: Number(f.month), grossAmount: Number(f.grossAmount), taxable: !!f.taxable } // windfall
  }

  const preview = useMemo(() => {
    try {
      const { rows, summary } = computeIncomeScenarioRows(buildInput(), taxCtx)
      return rows.length ? { rows, summary } : null
    } catch { return null }
  }, [type, f, name, taxCtx]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save(state) {
    if (!preview) { setErr('Enter amounts to model first.'); return }
    if (!name.trim()) { setErr('Give this scenario a name.'); return }
    setBusy(true); setErr(null)
    try {
      const scenario = await createScenario(userId, {
        name: name.trim(),
        description: previewDescription(type, f, preview.summary),
        kind: 'income',
        state: 'modeled',
      })
      for (const row of preview.rows) {
        await addIncomeAdjustment(userId, scenario.id, row)
      }
      if (state === 'committed') {
        await promoteToCommitted(userId, scenario.id)
      }
      // reset form
      setName('')
      setF(prev => ({ ...prev, newAnnualGross: '', oldAnnualGross: '', grossAmount: '', monthlyGross: '' }))
      await onChanged?.()
    } catch (e) {
      setErr(e.message || 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  async function toggleCommit(s) {
    setBusy(true); setErr(null)
    try {
      if (s.state === 'committed') await promoteToModeled(userId, s.id)
      else await promoteToCommitted(userId, s.id)
      await onChanged?.()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  async function remove(s) {
    if (!window.confirm(`Delete income scenario "${s.name}"?`)) return
    setBusy(true); setErr(null)
    try {
      await deleteScenario(userId, s.id)
      await onChanged?.()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const netOf = (s) => (adjMap[s.id] ?? []).reduce((sum, a) => sum + Number(a.net_amount || 0), 0)
  const committedInc = incomeScenarios.filter(s => s.state === 'committed')
  const modeledInc = incomeScenarios.filter(s => s.state !== 'committed')

  const input = { width: '100%', padding: '8px 10px', background: 'var(--field)', border: '1px solid var(--bd)', borderRadius: 6, color: 'var(--tx-1)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }
  const lbl = { display: 'block', fontSize: 11, color: 'var(--tx-3)', marginBottom: 4 }
  const monthSel = (val, on) => (
    <select value={val} onChange={e => on(Number(e.target.value))} style={input}>
      {MONTHS_SHORT.map((m, i) => <option key={m} value={i + 1}>{m} {f.year}</option>)}
    </select>
  )

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: mobile ? 16 : '20px 26px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto', display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr', gap: 18, alignItems: 'start' }}>

        {/* ── Model form ── */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bd)', borderRadius: 11, padding: 16 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--tx-3)', fontWeight: 700, marginBottom: 12 }}>Model an income change</div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            {INCOME_TYPES.map(t => {
              const on = type === t.key
              return (
                <button key={t.key} onClick={() => { setType(t.key); setField('taxable', t.key === 'windfall' ? false : true) }}
                  style={{ fontSize: 11.5, padding: '5px 11px', borderRadius: 999, cursor: 'pointer',
                    background: on ? 'rgba(53,201,138,0.14)' : 'transparent',
                    border: `1px solid ${on ? INC_GREEN : 'var(--bd)'}`,
                    color: on ? INC_GREEN : 'var(--tx-2)', fontWeight: on ? 650 : 500 }}>
                  {t.label}
                </button>
              )
            })}
          </div>

          <div style={{ marginBottom: 11 }}>
            <label style={lbl}>Scenario name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder={type === 'salary' ? 'e.g. Promotion raise' : type === 'bonus' ? 'e.g. Q4 bonus' : type === 'recurring' ? 'e.g. Consulting side income' : 'e.g. RSU vest'} style={input} />
          </div>

          {type === 'salary' && (<>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1, marginBottom: 11 }}><label style={lbl}>New gross salary ($/yr)</label>
                <input type="number" value={f.newAnnualGross} onChange={e => setField('newAnnualGross', e.target.value)} placeholder="150000" style={input} /></div>
              <div style={{ flex: 1, marginBottom: 11 }}><label style={lbl}>Current gross ($/yr)</label>
                <input type="number" value={f.oldAnnualGross} onChange={e => setField('oldAnnualGross', e.target.value)} placeholder="132000" style={input} /></div>
            </div>
            <div style={{ marginBottom: 11 }}><label style={lbl}>Starts</label>{monthSel(f.startMonth, v => setField('startMonth', v))}</div>
          </>)}

          {type === 'bonus' && (<>
            <div style={{ marginBottom: 11 }}><label style={lbl}>Gross bonus ($)</label>
              <input type="number" value={f.grossAmount} onChange={e => setField('grossAmount', e.target.value)} placeholder="30000" style={input} /></div>
            <div style={{ marginBottom: 11 }}><label style={lbl}>Month</label>{monthSel(f.month, v => setField('month', v))}</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--tx-2)', marginBottom: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={f.applies401k} onChange={e => setField('applies401k', e.target.checked)} /> 401k contributed on this bonus
            </label>
          </>)}

          {type === 'recurring' && (<>
            <div style={{ marginBottom: 11 }}><label style={lbl}>Amount ($/mo, gross)</label>
              <input type="number" value={f.monthlyGross} onChange={e => setField('monthlyGross', e.target.value)} placeholder="1500" style={input} /></div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1, marginBottom: 11 }}><label style={lbl}>From</label>{monthSel(f.startMonth, v => setField('startMonth', v))}</div>
              <div style={{ flex: 1, marginBottom: 11 }}><label style={lbl}>Through</label>{monthSel(f.endMonth, v => setField('endMonth', v))}</div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--tx-2)', marginBottom: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={f.taxable} onChange={e => setField('taxable', e.target.checked)} /> Taxable income
            </label>
          </>)}

          {type === 'windfall' && (<>
            <div style={{ marginBottom: 11 }}><label style={lbl}>Amount ($)</label>
              <input type="number" value={f.grossAmount} onChange={e => setField('grossAmount', e.target.value)} placeholder="8000" style={input} /></div>
            <div style={{ marginBottom: 11 }}><label style={lbl}>Month</label>{monthSel(f.month, v => setField('month', v))}</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--tx-2)', marginBottom: 4, cursor: 'pointer' }}>
              <input type="checkbox" checked={f.taxable} onChange={e => setField('taxable', e.target.checked)} /> Taxable (e.g. RSU vest — off for a refund/gift)
            </label>
          </>)}

          {!hasTaxRate && (
            <div style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 8, lineHeight: 1.5 }}>
              No salary profile set — net equals gross (no tax applied). Set your salary in Settings for an after-tax estimate.
            </div>
          )}
        </div>

        {/* ── Preview + actions ── */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bd)', borderRadius: 11, padding: 16 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--tx-3)', fontWeight: 700, marginBottom: 12 }}>Post-tax impact · {f.year}</div>
          {preview ? (<>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <Row k={`Gross (${preview.summary.monthsAffected} mo)`} v={money(preview.summary.grossTotal)} />
              {preview.summary.taxTotal > 0 && <Row k={`− est. tax @ ${preview.summary.effectiveRatePct}%`} v={`−${money(preview.summary.taxTotal).replace('−','')}`} muted />}
              {preview.summary.k401Total > 0 && <Row k={`− 401k @ ${preview.summary.four01kPct}%`} v={`−${money(preview.summary.k401Total).replace('−','')}`} muted />}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, paddingTop: 9, borderTop: '1px dashed var(--bd)' }}>
                <span style={{ color: 'var(--tx-2)' }}>Net income change</span>
                <span style={{ fontWeight: 700, color: INC_GREEN, fontFamily: "'DM Mono', monospace" }}>{money(preview.summary.netTotal)}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 9, marginTop: 15 }}>
              <button disabled={busy} onClick={() => save('committed')} style={{ padding: '8px 15px', borderRadius: 7, fontSize: 12.5, fontWeight: 650, border: 'none', cursor: busy ? 'default' : 'pointer', background: INC_GREEN, color: '#04140d', opacity: busy ? 0.6 : 1 }}>Commit to plan</button>
              <button disabled={busy} onClick={() => save('modeled')} style={{ padding: '8px 15px', borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: busy ? 'default' : 'pointer', background: 'transparent', border: '1px solid var(--bd)', color: 'var(--tx-2)' }}>Keep as modeled</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 10, lineHeight: 1.5 }}>
              Committing folds this into your Income vs Expenses forecast, net, and savings rate. Modeled scenarios stay exploratory.
            </div>
          </>) : (
            <div style={{ fontSize: 12.5, color: 'var(--tx-3)', lineHeight: 1.6 }}>Enter amounts on the left to see the post-tax impact.</div>
          )}
          {err && <div style={{ fontSize: 12, color: 'var(--red, #e53935)', marginTop: 10 }}>{err}</div>}
        </div>
      </div>

      {/* ── Existing income scenarios ── */}
      <div style={{ maxWidth: 860, margin: '22px auto 0' }}>
        {incomeScenarios.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '18px', fontSize: 12.5, color: 'var(--tx-3)' }}>
            No income scenarios yet. Model one above.
          </div>
        ) : (
          <>
            {committedInc.length > 0 && <SectionLabel>In your plan (committed)</SectionLabel>}
            {committedInc.map(s => <IncomeCard key={s.id} s={s} rows={adjMap[s.id]} net={netOf(s)} expanded={expandedId === s.id} onExpand={() => setExpandedId(expandedId === s.id ? null : s.id)} onToggleCommit={() => toggleCommit(s)} onRemove={() => remove(s)} busy={busy} />)}
            {modeledInc.length > 0 && <SectionLabel>Modeled (not in plan)</SectionLabel>}
            {modeledInc.map(s => <IncomeCard key={s.id} s={s} rows={adjMap[s.id]} net={netOf(s)} expanded={expandedId === s.id} onExpand={() => setExpandedId(expandedId === s.id ? null : s.id)} onToggleCommit={() => toggleCommit(s)} onRemove={() => remove(s)} busy={busy} />)}
          </>
        )}
      </div>
    </div>
  )
}

function previewDescription(type, f, summary) {
  const t = INCOME_TYPES.find(x => x.key === type)?.label || type
  return `${t} · net ${money(summary.netTotal)} (${summary.monthsAffected} mo, ${f.year})`
}

function Row({ k, v, muted }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
      <span style={{ color: muted ? 'var(--tx-3)' : 'var(--tx-2)' }}>{k}</span>
      <span style={{ fontWeight: 600, color: muted ? 'var(--tx-3)' : 'var(--tx-1)', fontFamily: "'DM Mono', monospace" }}>{v}</span>
    </div>
  )
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '14px 0 8px' }}>{children}</div>
}

function IncomeCard({ s, rows, net, expanded, onExpand, onToggleCommit, onRemove, busy }) {
  const committed = s.state === 'committed'
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bd)', borderRadius: 10, padding: '12px 14px', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--tx-1)' }}>{s.name}</span>
            <span style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 7px', borderRadius: 999, background: committed ? 'rgba(53,201,138,0.16)' : 'var(--hover)', color: committed ? INC_GREEN : 'var(--tx-3)' }}>
              {committed ? 'COMMITTED' : 'MODELED'}
            </span>
          </div>
          {s.description && <div style={{ fontSize: 11.5, color: 'var(--tx-3)', marginTop: 2 }}>{s.description}</div>}
        </div>
        <span style={{ fontSize: 14, fontWeight: 700, color: INC_GREEN, fontFamily: "'DM Mono', monospace" }}>{money(net)}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <button disabled={busy} onClick={onToggleCommit} style={{ fontSize: 11.5, padding: '4px 11px', borderRadius: 6, cursor: busy ? 'default' : 'pointer', border: committed ? '1px solid var(--bd)' : 'none', background: committed ? 'transparent' : INC_GREEN, color: committed ? 'var(--tx-2)' : '#04140d', fontWeight: 600 }}>
          {committed ? 'Revert to modeled' : '✓ Commit'}
        </button>
        <button onClick={onExpand} style={{ fontSize: 11.5, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--bd)', background: 'transparent', color: 'var(--tx-3)' }}>
          {expanded ? 'Hide' : 'Details'}
        </button>
        <button disabled={busy} onClick={onRemove} style={{ marginLeft: 'auto', fontSize: 11.5, padding: '4px 9px', borderRadius: 6, cursor: busy ? 'default' : 'pointer', border: 'none', background: 'transparent', color: 'var(--tx-4)' }}>Delete</button>
      </div>
      {expanded && (
        <div style={{ marginTop: 10, borderTop: '1px solid var(--bd)', paddingTop: 8 }}>
          {(rows ?? []).length === 0 ? (
            <div style={{ fontSize: 11.5, color: 'var(--tx-3)' }}>No monthly rows.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '2px 12px', fontSize: 11.5, fontFamily: "'DM Mono', monospace" }}>
              <span style={{ color: 'var(--tx-4)' }}>Month</span>
              <span style={{ color: 'var(--tx-4)', textAlign: 'right' }}>Gross</span>
              <span style={{ color: 'var(--tx-4)', textAlign: 'right' }}>Net</span>
              {(rows ?? []).map(r => (
                <Fragment key={r.id}>
                  <span style={{ color: 'var(--tx-2)' }}>{MONTHS_SHORT[(Number(r.month) || 1) - 1]} {r.year}</span>
                  <span style={{ color: 'var(--tx-3)', textAlign: 'right' }}>{money(r.gross_amount)}</span>
                  <span style={{ color: INC_GREEN, textAlign: 'right' }}>{money(r.net_amount)}</span>
                </Fragment>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main module ──────────────────────────────────────────────────────────────

const TAB_META = {
  baseline:  { label: 'Baseline',   color: 'var(--text-secondary, var(--tx-2))' },
  committed: { label: 'Committed',  color: 'var(--accent, #38bdf8)' },
  modeled:   { label: 'Modeled',    color: '#8b5cf6' },
  income:    { label: 'Income',     color: '#35c98a' },
  idea:      { label: 'Ideas',      color: '#f59e0b' },
}

export default function Scenarios({ userId, mobile, reloadSignal, context, onDataChange, openScenarioId, onGoToForecast }) {
  const [scenarios, setScenarios] = useState([])
  const [adjustments, setAdjustments] = useState({}) // { [scenarioId]: adj[] }
  const [adjLoading, setAdjLoading] = useState({})
  const [categories, setCategories] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [activeTab, setActiveTab] = useState('committed')
  const [showNewForm, setShowNewForm] = useState(false)
  const [showComposer, setShowComposer] = useState(false)
  const [showIdeaForm, setShowIdeaForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Idea form state
  const [ideaName, setIdeaName] = useState('')
  const [ideaNote, setIdeaNote] = useState('')
  const [ideaSaving, setIdeaSaving] = useState(false)

  const selected = scenarios.find(s => s.id === selectedId) ?? null
  // Expense tabs never show income-kind scenarios (they use a different
  // adjustment table and integrate via the income forecast, not forecast_line_items).
  const expenseScenarios = scenarios.filter(s => s.kind !== 'income')
  const incomeScenarios = scenarios.filter(s => s.kind === 'income')
  const modeled = expenseScenarios.filter(s => s.state === 'modeled')
  const committed = expenseScenarios.filter(s => s.state === 'committed')
  const ideas = expenseScenarios.filter(s => s.state === 'idea')

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
    setActiveTab('modeled')
    setShowComposer(false)
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
      setActiveTab('modeled')
      setShowComposer(false)
      loadAdjustments(first.scenarioId)
    }
    onDataChange?.()
  }

  function handleOpenScenario(scenarioId) {
    setSelectedId(scenarioId)
    setActiveTab('modeled')
    setShowComposer(false)
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

  // Income scenarios live in the same scenarios table (kind='income'); after any
  // income change, re-fetch the list and signal the shell so the dashboard
  // income forecast reloads.
  async function handleIncomeChanged() {
    const list = await getScenarios(userId).catch(() => null)
    if (list) setScenarios(list)
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

  async function handleAdjsRefresh() {
    if (!selectedId) return
    const data = await getAdjustments(userId, selectedId)
    setAdjustments(prev => ({ ...prev, [selectedId]: data }))
  }

  async function handleClone(scenarioId) {
    const source = scenarios.find(s => s.id === scenarioId)
    const cloned = await cloneScenario(userId, scenarioId, {
      name: source.name + ' (copy)',
      description: source.description || '',
    })
    const list = await getScenarios(userId)
    setScenarios(list)
    setSelectedId(cloned.id)
    setAdjustments(prev => ({ ...prev, [cloned.id]: [] }))
    loadAdjustments(cloned.id)
  }

  async function handleSaveIdea(e) {
    e.preventDefault()
    if (!ideaName.trim()) return
    setIdeaSaving(true)
    try {
      await createScenario(userId, { name: ideaName.trim(), description: ideaNote.trim(), state: 'idea' })
      const list = await getScenarios(userId)
      setScenarios(list)
      setIdeaName('')
      setIdeaNote('')
      setShowIdeaForm(false)
    } finally {
      setIdeaSaving(false)
    }
  }

  async function handlePromoteToModeled(scenarioId) {
    await promoteToModeled(userId, scenarioId)
    const list = await getScenarios(userId)
    setScenarios(list)
    setActiveTab('modeled')
  }

  async function handleDeleteIdea(scenarioId) {
    if (!window.confirm('Remove this idea?')) return
    await deleteScenario(userId, scenarioId)
    setScenarios(prev => prev.filter(s => s.id !== scenarioId))
  }

  const selectedAdjs = adjustments[selectedId] ?? []
  const isAdjLoading = adjLoading[selectedId] ?? false

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

  const counts = { committed: committed.length, modeled: modeled.length, income: incomeScenarios.length, idea: ideas.length }

  const tabStyle = (key) => {
    const active = activeTab === key
    const meta = TAB_META[key]
    return {
      padding: '10px 20px',
      fontSize: 13,
      fontWeight: 600,
      cursor: 'pointer',
      background: 'transparent',
      border: 'none',
      borderBottom: active ? `2px solid ${meta.color}` : '2px solid transparent',
      color: active ? meta.color : 'var(--tx-3)',
      marginBottom: -1,
      transition: 'color 0.15s, border-color 0.15s',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
    }
  }

  const countBadgeStyle = (key) => ({
    fontSize: 10,
    fontFamily: "'DM Mono', monospace",
    background: activeTab === key ? TAB_META[key].color : 'var(--hover)',
    color: activeTab === key ? 'var(--bg-app, #0f1117)' : 'var(--tx-4)',
    borderRadius: 10,
    padding: '1px 6px',
    fontWeight: 700,
  })

  const fieldStyle = {
    width: '100%', padding: '8px 10px', background: 'var(--field)',
    border: '1px solid var(--bd)', borderRadius: 6, color: 'var(--tx-1)',
    fontSize: 13, outline: 'none', boxSizing: 'border-box',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Module header */}
      <div style={{ padding: mobile ? '12px 18px 10px' : '14px 24px 12px', borderBottom: 'none', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={headerStyles.icon}>◑</span>
          <h1 style={headerStyles.title(mobile)}>Scenario Planner</h1>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--bd)', paddingLeft: mobile ? 8 : 16, flexShrink: 0 }}>
        {['baseline', 'committed', 'modeled', 'income', 'idea'].map(key => (
          <button key={key} onClick={() => setActiveTab(key)} style={tabStyle(key)}>
            {TAB_META[key].label}
            {counts[key] != null && key !== 'baseline' && (
              <span style={countBadgeStyle(key)}>{counts[key]}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* ── Baseline tab ── */}
        {activeTab === 'baseline' && (
          <BaselinePanel ctx={context} />
        )}

        {/* ── Committed tab ── */}
        {activeTab === 'committed' && (
          <ActualPlanView
            scenarios={committed}
            adjustments={adjustments}
            adjLoading={adjLoading}
            onViewScenario={(id) => {
              handleSelect(id)
              setActiveTab('modeled')
              setShowComposer(false)
            }}
            onDelete={handleDelete}
          />
        )}

        {/* ── Modeled tab ── */}
        {activeTab === 'modeled' && (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: mobile ? 'column' : 'row' }}>
            {/* Left column: scenario list */}
            {(!mobile || !selectedId) && (
              <div style={{
                width: mobile ? '100%' : 280, flexShrink: 0,
                borderRight: mobile ? 'none' : '1px solid var(--bd)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 16px 6px',
                }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--tx-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    Scenarios
                  </span>
                  <button
                    onClick={() => { setShowNewForm(f => !f); setSelectedId(null) }}
                    style={{
                      background: 'transparent', border: '1px solid var(--bd)', color: 'var(--accent)',
                      cursor: 'pointer', fontSize: 12, padding: '2px 9px',
                      borderRadius: 5, fontWeight: 600,
                    }}
                  >
                    + New
                  </button>
                </div>

                {showNewForm && (
                  <NewScenarioForm onSubmit={handleCreate} onCancel={() => setShowNewForm(false)} />
                )}

                <div style={{ flex: 1, overflow: 'auto', padding: '2px 0 8px' }}>
                  {modeled.map(s => (
                    <ScenarioListItem key={s.id} scenario={s}
                      selected={selectedId === s.id}
                      onClick={() => { handleSelect(s.id); setShowComposer(false) }}
                      adjustments={adjustments[s.id]} />
                  ))}
                  {modeled.length === 0 && !showNewForm && (
                    <div style={{ padding: '20px 16px', textAlign: 'center', fontSize: 12, color: 'var(--tx-3)', lineHeight: 1.6 }}>
                      No scenarios yet. Start with AI ↓
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Right column: detail or composer */}
            {(!mobile || selectedId) && (
              <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
                {/* Mobile back link */}
                {mobile && selectedId && (
                  <button onClick={() => setSelectedId(null)} style={{
                    background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer',
                    fontSize: 12, padding: '8px 16px', textAlign: 'left', flexShrink: 0,
                  }}>
                    ← Scenarios
                  </button>
                )}

                {(!selectedId || showComposer) ? (
                  <div style={{ flex: 1, overflow: 'auto', padding: mobile ? 16 : 24 }}>
                    <div style={{ maxWidth: 720, margin: '0 auto' }}>
                      <AiScenarioComposer
                        userId={userId}
                        context={context}
                        onCreated={handleAiCreated}
                        onOpenScenario={handleOpenScenario}
                        mobile={mobile}
                      />
                    </div>
                  </div>
                ) : (
                  <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
                    <ScenarioDetail
                      scenario={selected}
                      adjustments={selectedAdjs}
                      categories={categories}
                      context={context}
                      userId={userId}
                      onPromote={handlePromote}
                      onDelete={handleDelete}
                      onAddAdj={handleAddAdj}
                      onDeleteAdj={handleDeleteAdj}
                      onClone={handleClone}
                      onAdjsRefresh={handleAdjsRefresh}
                      loading={isAdjLoading}
                      onGoToForecast={onGoToForecast}
                      mobile={mobile}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Income tab ── */}
        {activeTab === 'income' && (
          <IncomePanel
            userId={userId}
            context={context}
            incomeScenarios={incomeScenarios}
            onChanged={handleIncomeChanged}
            mobile={mobile}
          />
        )}

        {/* ── Ideas tab ── */}
        {activeTab === 'idea' && (
          <div style={{ flex: 1, overflow: 'auto', padding: mobile ? '16px' : '24px 28px' }}>
            <div style={{ maxWidth: 720, margin: '0 auto' }}>
              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <span style={{ fontSize: 13, color: 'var(--tx-2)', fontWeight: 500 }}>
                  Parking lot — not yet modeled
                </span>
                <button onClick={() => setShowIdeaForm(f => !f)} style={{
                  background: 'transparent', border: '1px solid var(--bd)', color: 'var(--accent)',
                  cursor: 'pointer', fontSize: 12, padding: '5px 12px',
                  borderRadius: 6, fontWeight: 600,
                }}>
                  + Add Idea
                </button>
              </div>

              {/* Idea form */}
              {showIdeaForm && (
                <form onSubmit={handleSaveIdea} style={{
                  background: 'var(--bg-card)', border: '1px solid var(--bd)',
                  borderRadius: 10, padding: '14px 16px', marginBottom: 16,
                }}>
                  <input
                    autoFocus
                    value={ideaName}
                    onChange={e => setIdeaName(e.target.value)}
                    placeholder="What's the idea?"
                    required
                    style={{ ...fieldStyle, marginBottom: 8 }}
                  />
                  <textarea
                    value={ideaNote}
                    onChange={e => setIdeaNote(e.target.value)}
                    placeholder="Any context or rough numbers…"
                    rows={2}
                    style={{ ...fieldStyle, resize: 'vertical', marginBottom: 10, fontFamily: 'Inter, sans-serif', lineHeight: 1.5 }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="submit" disabled={!ideaName.trim() || ideaSaving} style={{
                      padding: '7px 16px', background: 'var(--accent)', color: 'var(--accent-tx-on)',
                      border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600,
                      cursor: ideaName.trim() && !ideaSaving ? 'pointer' : 'not-allowed',
                      opacity: ideaName.trim() && !ideaSaving ? 1 : 0.5,
                    }}>
                      {ideaSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button type="button" onClick={() => { setShowIdeaForm(false); setIdeaName(''); setIdeaNote('') }} style={{
                      padding: '7px 12px', background: 'transparent', color: 'var(--tx-2)',
                      border: '1px solid var(--bd)', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                    }}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {/* Idea cards */}
              {ideas.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {ideas.map(s => {
                    const createdDate = new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    return (
                      <div key={s.id} style={{
                        background: 'var(--bg-card)', border: '1px solid var(--bd)',
                        borderRadius: 10, padding: '14px 16px',
                        display: 'flex', alignItems: 'flex-start', gap: 12,
                      }}>
                        {/* Amber dot */}
                        <div style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: '#f59e0b', flexShrink: 0, marginTop: 5,
                        }} />

                        {/* Center content */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--tx-1)', marginBottom: s.description ? 3 : 6 }}>
                            {s.name}
                          </div>
                          {s.description && (
                            <div style={{ fontSize: 12, color: 'var(--tx-2)', marginBottom: 6, lineHeight: 1.5 }}>
                              {s.description}
                            </div>
                          )}
                          <div style={{
                            fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                            color: '#f59e0b', textTransform: 'uppercase',
                          }}>
                            MANUALLY ADDED · {createdDate}
                          </div>
                        </div>

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignSelf: 'center' }}>
                          <button onClick={() => handlePromoteToModeled(s.id)} style={{
                            padding: '5px 11px', background: 'transparent',
                            border: '1px solid var(--bd)', color: 'var(--tx-2)',
                            borderRadius: 6, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
                          }}>
                            → Model
                          </button>
                          <button onClick={() => handleDeleteIdea(s.id)} style={{
                            padding: '5px 9px', background: 'transparent',
                            border: '1px solid var(--bd)', color: 'var(--tx-4)',
                            borderRadius: 6, fontSize: 14, lineHeight: 1, cursor: 'pointer',
                          }}>
                            ✕
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : !showIdeaForm ? (
                <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--tx-3)', fontSize: 13 }}>
                  Ideas from your budget grill session will appear here.
                </div>
              ) : null}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

import { useState, useEffect, useCallback, useMemo } from 'react'
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

function fmt(n) {
  const abs = Math.abs(n)
  const s = abs >= 1000 ? '$' + (abs / 1000).toFixed(1) + 'k' : '$' + Math.round(abs).toLocaleString()
  return n < 0 ? '-' + s : '+' + s
}

function fmtFull(n) {
  return (n < 0 ? '-$' : n > 0 ? '+$' : '$') + Math.abs(Math.round(n)).toLocaleString()
}

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
    {
      label: 'Monthly avg',
      value: signedFmt(summary.monthlyAvg),
      color: deltaColor(summary.monthlyAvg),
    },
    {
      label: 'Annualized',
      value: signedFmt(summary.annualized),
      color: deltaColor(summary.annualized),
    },
    ...(summary.hasIncome && summary.pctOfIncome != null ? [{
      label: 'Of monthly income',
      value: Math.round(summary.pctOfIncome) + '%',
      color: summary.pctOfIncome > 20 ? 'var(--red)' : summary.pctOfIncome > 10 ? 'var(--warn)' : 'var(--tx-1)',
      sub: `~${signedFmt(summary.incomeRunRate)}/mo income`,
    }] : []),
    ...(summary.hasBudget ? [{
      label: 'Budget (scenario vs. plan)',
      value: signedFmt(summary.budgetProjected - summary.budgetPlanned),
      color: deltaColor(summary.budgetProjected - summary.budgetPlanned),
      sub: `${signedFmt(summary.budgetPlanned)} → ${signedFmt(summary.budgetProjected)}`,
    }] : []),
    {
      label: 'Horizon',
      value: summary.horizon,
      color: 'var(--tx-2)',
      isText: true,
    },
  ]

  return (
    <div style={{
      display: 'flex',
      border: '1px solid var(--bd)',
      borderRadius: 8,
      overflow: 'hidden',
      marginTop: 14,
      background: 'var(--bg-app)',
      flexShrink: 0,
    }}>
      {segments.map((seg, i) => (
        <div key={i} style={{
          flex: 1,
          padding: '9px 14px',
          borderRight: i < segments.length - 1 ? '1px solid var(--bd)' : 'none',
          minWidth: 0,
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

function StateBadge({ state }) {
  const committed = state === 'committed'
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '2px 9px',
      borderRadius: 10,
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: '0.05em',
      textTransform: 'uppercase',
      background: committed ? 'rgba(46,204,113,0.12)' : 'rgba(0,194,168,0.1)',
      color: committed ? 'var(--green)' : 'var(--accent)',
      border: `1px solid ${committed ? 'rgba(46,204,113,0.25)' : 'var(--accent-bd)'}`,
    }}>
      {committed ? '✓ Committed' : '◑ Modeled'}
    </span>
  )
}

function ScenarioListItem({ scenario, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '10px 14px',
        background: selected ? 'var(--accent-bg)' : 'transparent',
        border: 'none',
        borderLeft: `2px solid ${selected ? 'var(--accent)' : 'transparent'}`,
        color: 'var(--tx-1)',
        cursor: 'pointer',
        borderRadius: '0 6px 6px 0',
        marginBottom: 2,
        transition: 'background 0.15s',
      }}
    >
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
    width: '100%',
    padding: '8px 10px',
    background: 'var(--field)',
    border: '1px solid var(--bd)',
    borderRadius: 6,
    color: 'var(--tx-1)',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box',
  }

  return (
    <form onSubmit={handleSubmit} style={{ padding: '12px 14px', borderBottom: '1px solid var(--bd-light)' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx-2)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
        New Scenario
      </div>
      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Scenario name"
        style={{ ...fieldStyle, marginBottom: 6 }}
      />
      <input
        value={desc}
        onChange={e => setDesc(e.target.value)}
        placeholder="Description (optional)"
        style={{ ...fieldStyle, marginBottom: 8 }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="submit" disabled={!name.trim() || saving} style={{
          flex: 1,
          padding: '7px 0',
          background: 'var(--accent)',
          color: 'var(--accent-tx-on)',
          border: 'none',
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 600,
          cursor: name.trim() && !saving ? 'pointer' : 'not-allowed',
          opacity: name.trim() && !saving ? 1 : 0.5,
        }}>
          {saving ? 'Creating…' : 'Create'}
        </button>
        <button type="button" onClick={onCancel} style={{
          padding: '7px 12px',
          background: 'transparent',
          color: 'var(--tx-2)',
          border: '1px solid var(--bd)',
          borderRadius: 6,
          fontSize: 12,
          cursor: 'pointer',
        }}>
          Cancel
        </button>
      </div>
    </form>
  )
}

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
    padding: '7px 9px',
    background: 'var(--field)',
    border: '1px solid var(--bd)',
    borderRadius: 6,
    color: 'var(--tx-1)',
    fontSize: 12,
    outline: 'none',
  }

  return (
    <form onSubmit={handleSubmit} style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--bd)',
      borderRadius: 8,
      padding: 16,
      marginTop: 12,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx-2)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12 }}>
        Add Adjustment
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={{ fontSize: 11, color: 'var(--tx-2)', display: 'block', marginBottom: 4 }}>Category</label>
          <select
            value={categoryId}
            onChange={e => setCategoryId(e.target.value)}
            style={{ ...fieldStyle, width: '100%' }}
          >
            <option value="">— select —</option>
            {Object.entries(grouped).map(([g, cats]) => (
              <optgroup key={g} label={g}>
                {cats.map(c => (
                  <option key={c.id} value={c.id}>{c.category}</option>
                ))}
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
            {[curYear - 1, curYear, curYear + 1, curYear + 2].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--tx-2)', display: 'block', marginBottom: 4 }}>Delta ($)</label>
          <input
            type="number"
            value={delta}
            onChange={e => setDelta(e.target.value)}
            placeholder="-500 or +1200"
            step="0.01"
            style={{ ...fieldStyle, width: '100%' }}
          />
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: 'var(--tx-2)', display: 'block', marginBottom: 4 }}>Label (optional)</label>
        <input
          type="text"
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="e.g. Celebrity Cruise — final payment"
          style={{ ...fieldStyle, width: '100%' }}
        />
      </div>
      {err && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={saving} style={{
          padding: '8px 20px',
          background: 'var(--accent)',
          color: 'var(--accent-tx-on)',
          border: 'none',
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 600,
          cursor: saving ? 'not-allowed' : 'pointer',
          opacity: saving ? 0.6 : 1,
        }}>
          {saving ? 'Adding…' : 'Add Adjustment'}
        </button>
        <button type="button" onClick={onCancel} style={{
          padding: '8px 14px',
          background: 'transparent',
          color: 'var(--tx-2)',
          border: '1px solid var(--bd)',
          borderRadius: 6,
          fontSize: 12,
          cursor: 'pointer',
        }}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function AdjustmentsTable({ adjustments, onDelete, readOnly }) {
  if (!adjustments.length) {
    return (
      <div style={{
        textAlign: 'center',
        padding: '32px 16px',
        color: 'var(--tx-3)',
        fontSize: 13,
        border: '1px dashed var(--bd)',
        borderRadius: 8,
      }}>
        No adjustments yet. Add one below to model a change.
      </div>
    )
  }

  const totalDelta = adjustments.reduce((s, a) => s + Number(a.delta_amount), 0)

  return (
    <div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 80px 60px 80px 1fr auto',
        gap: '0 12px',
        padding: '6px 12px',
        fontSize: 10,
        fontWeight: 600,
        color: 'var(--tx-3)',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        borderBottom: '1px solid var(--bd)',
      }}>
        <span>Category</span>
        <span>Month</span>
        <span>Year</span>
        <span style={{ textAlign: 'right' }}>Delta</span>
        <span>Label</span>
        {!readOnly && <span />}
      </div>
      {adjustments.map(adj => {
        const delta = Number(adj.delta_amount)
        const cat = adj.budget_categories?.category ?? '—'
        return (
          <div key={adj.id} style={{
            display: 'grid',
            gridTemplateColumns: '1fr 80px 60px 80px 1fr auto',
            gap: '0 12px',
            alignItems: 'center',
            padding: '9px 12px',
            borderBottom: '1px solid var(--bd-light)',
            fontSize: 13,
          }}>
            <span style={{ color: 'var(--tx-1)', fontWeight: 500 }}>{cat}</span>
            <span style={{ color: 'var(--tx-2)' }}>{MONTHS[(adj.month ?? 1) - 1]}</span>
            <span style={{ color: 'var(--tx-2)' }}>{adj.year}</span>
            <span style={{
              textAlign: 'right',
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              color: delta < 0 ? 'var(--red)' : 'var(--green)',
            }}>
              {fmtFull(delta)}
            </span>
            <span style={{ color: 'var(--tx-2)', fontSize: 12 }}>{adj.label || '—'}</span>
            {!readOnly && (
              <button
                onClick={() => onDelete(adj.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--tx-3)',
                  cursor: 'pointer',
                  padding: '2px 4px',
                  fontSize: 14,
                  lineHeight: 1,
                  borderRadius: 4,
                }}
                title="Remove adjustment"
              >
                ×
              </button>
            )}
          </div>
        )
      })}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 80px 60px 80px 1fr auto',
        gap: '0 12px',
        padding: '8px 12px',
        borderTop: '1px solid var(--bd)',
        fontSize: 12,
        fontWeight: 600,
      }}>
        <span style={{ color: 'var(--tx-2)' }}>Total delta</span>
        <span /><span />
        <span style={{
          textAlign: 'right',
          color: totalDelta < 0 ? 'var(--red)' : totalDelta > 0 ? 'var(--green)' : 'var(--tx-2)',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {fmtFull(totalDelta)}
        </span>
        <span />{!readOnly && <span />}
      </div>
    </div>
  )
}

function ComparisonView({ adjustments, ctx }) {
  if (!adjustments.length) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--tx-3)', fontSize: 13 }}>
        No adjustments to compare. Add adjustments to see the scenario vs. baseline.
      </div>
    )
  }

  const periods = buildComparisonRows(adjustments, ctx)
  const hasBaseline = periods.some(p => p.rows.some(r => r.baseline != null))

  const hdrCell = { textAlign: 'right', color: 'var(--tx-3)' }
  const cols = hasBaseline
    ? '110px 1fr 90px 90px 90px 90px'
    : '110px 1fr 100px 100px'

  let running = 0

  return (
    <div>
      {/* Header */}
      <div style={{
        display: 'grid', gridTemplateColumns: cols, gap: '0 10px',
        padding: '6px 12px', fontSize: 10, fontWeight: 600,
        color: 'var(--tx-3)', letterSpacing: '0.06em', textTransform: 'uppercase',
        borderBottom: '1px solid var(--bd)',
      }}>
        <span>Period</span>
        <span>Line</span>
        {hasBaseline && <span style={hdrCell}>Baseline</span>}
        {hasBaseline && <span style={hdrCell}>Scenario</span>}
        <span style={hdrCell}>Delta</span>
        <span style={hdrCell}>Cumul.</span>
      </div>

      {periods.map(({ year, month, periodLabel, rows, periodDelta, periodBaseline, periodScenario }) => {
        running += periodDelta
        const runSnap = running
        const deltaColor = (n) => n < 0 ? 'var(--green)' : n > 0 ? 'var(--red)' : 'var(--tx-2)'

        return (
          <div key={`${year}-${month}`} style={{ borderBottom: '1px solid var(--bd-light)' }}>
            {/* Detail rows */}
            {rows.map((r, ri) => (
              <div key={r.id} style={{
                display: 'grid', gridTemplateColumns: cols, gap: '0 10px',
                alignItems: 'center', padding: ri === 0 ? '10px 12px 4px' : '2px 12px',
                fontSize: 12,
              }}>
                <span style={{ fontWeight: 600, color: 'var(--tx-1)', fontSize: 13 }}>
                  {ri === 0 ? periodLabel : ''}
                </span>
                <span style={{ color: 'var(--tx-2)' }}>
                  {r.category}{r.label ? ` — ${r.label}` : ''}
                </span>
                {hasBaseline && (
                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.baseline != null ? 'var(--tx-2)' : 'var(--tx-3)' }}>
                    {r.baseline != null ? fmtFull(r.baseline) : '—'}
                  </span>
                )}
                {hasBaseline && (
                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: r.scenario != null ? deltaColor(r.delta) : 'var(--tx-3)', fontWeight: r.scenario != null ? 600 : 400 }}>
                    {r.scenario != null ? fmtFull(r.scenario) : '—'}
                  </span>
                )}
                <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: deltaColor(r.delta), fontWeight: 600 }}>
                  {fmtFull(r.delta)}
                </span>
                <span />
              </div>
            ))}

            {/* Period subtotal */}
            <div style={{
              display: 'grid', gridTemplateColumns: cols, gap: '0 10px',
              alignItems: 'center', padding: '4px 12px 10px',
              fontSize: 12, borderTop: rows.length > 1 ? '1px dashed var(--bd-light)' : 'none',
            }}>
              <span />
              <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>
                {rows.length} line{rows.length > 1 ? 's' : ''}
              </span>
              {hasBaseline && (
                <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--tx-2)', fontWeight: 600 }}>
                  {periodBaseline != null ? fmtFull(periodBaseline) : '—'}
                </span>
              )}
              {hasBaseline && (
                <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: periodScenario != null ? 'var(--tx-1)' : 'var(--tx-3)', fontWeight: 600 }}>
                  {periodScenario != null ? fmtFull(periodScenario) : '—'}
                </span>
              )}
              <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: deltaColor(periodDelta), fontWeight: 700 }}>
                {fmtFull(periodDelta)}
              </span>
              <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: deltaColor(runSnap) }}>
                {fmtFull(runSnap)}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TimelineChart({ adjustments }) {
  const data = useMemo(() => buildCumulativeTimeline(adjustments), [adjustments])

  if (!data.labels.length) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--tx-3)', fontSize: 13 }}>
        No adjustments to chart.
      </div>
    )
  }

  const W = 600, H = 160
  const padL = 56, padR = 16, padT = 16, padB = 30
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

  const fmtTick = (n) => {
    const abs = Math.abs(n)
    const s = abs >= 1000 ? '$' + Math.round(abs / 1000) + 'k' : '$' + Math.round(abs)
    return n < 0 ? '−' + s : n > 0 ? '+' + s : s
  }

  // Only show labels every N steps to avoid crowding
  const labelEvery = n > 8 ? 3 : n > 4 ? 2 : 1

  const yTicks = [...new Set([min, min < 0 && max > 0 ? 0 : null, max].filter(v => v != null))]

  return (
    <div style={{ padding: '4px 0' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', display: 'block', overflow: 'visible' }}
      >
        {/* Zero baseline */}
        {min < 0 && max > 0 && (
          <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY}
            stroke="var(--bd)" strokeWidth={1} strokeDasharray="4 3" />
        )}

        {/* Filled area */}
        <path d={areaPath} fill="var(--accent)" opacity={0.1} />

        {/* Line */}
        <polyline points={linePts} fill="none" stroke="var(--accent)" strokeWidth={2}
          strokeLinecap="round" strokeLinejoin="round" />

        {/* Dots */}
        {values.map((v, i) => (
          <circle key={i} cx={xPos(i)} cy={yPos(v)} r={3.5} fill="var(--accent)" />
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
          <text key={i} x={padL - 4} y={yPos(tick)} textAnchor="end" dominantBaseline="middle"
            fontSize={8.5} fill="var(--tx-3)" fontFamily="'DM Mono', monospace">
            {fmtTick(tick)}
          </text>
        ))}
      </svg>
    </div>
  )
}

function ScenarioDetail({
  scenario,
  adjustments,
  categories,
  context,
  onPromote,
  onDelete,
  onAddAdj,
  onDeleteAdj,
  loading,
}) {
  const [activeTab, setActiveTab] = useState('adjustments')
  const [showAddForm, setShowAddForm] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const impactSummary = useMemo(
    () => computeImpactSummary(adjustments, context),
    [adjustments, context]
  )

  const isCommitted = scenario.state === 'committed'

  async function handlePromote() {
    setPromoting(true)
    try {
      await onPromote(scenario.id)
    } finally {
      setPromoting(false)
    }
  }

  async function handleAddAdj(data) {
    await onAddAdj(data)
    setShowAddForm(false)
  }

  const tabStyle = (active) => ({
    padding: '8px 16px',
    background: active ? 'var(--accent-bg)' : 'transparent',
    border: 'none',
    borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
    color: active ? 'var(--accent)' : 'var(--tx-2)',
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    transition: 'color 0.15s',
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Scenario header */}
      <div style={{
        padding: '20px 24px 16px',
        borderBottom: '1px solid var(--bd)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--tx-1)', marginBottom: 6 }}>
              {scenario.name}
            </h2>
            <StateBadge state={scenario.state} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {!isCommitted && (
              <button
                onClick={handlePromote}
                disabled={promoting}
                style={{
                  padding: '7px 14px',
                  background: 'rgba(46,204,113,0.12)',
                  color: 'var(--green)',
                  border: '1px solid rgba(46,204,113,0.25)',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: promoting ? 'not-allowed' : 'pointer',
                  opacity: promoting ? 0.6 : 1,
                }}
              >
                {promoting ? 'Promoting…' : '✓ Promote to Committed'}
              </button>
            )}
            {confirmDelete ? (
              <>
                <button onClick={() => onDelete(scenario.id)} style={{
                  padding: '7px 12px',
                  background: 'rgba(229,57,53,0.12)',
                  color: 'var(--red)',
                  border: '1px solid rgba(229,57,53,0.25)',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}>
                  Confirm Delete
                </button>
                <button onClick={() => setConfirmDelete(false)} style={{
                  padding: '7px 10px',
                  background: 'transparent',
                  color: 'var(--tx-2)',
                  border: '1px solid var(--bd)',
                  borderRadius: 6,
                  fontSize: 12,
                  cursor: 'pointer',
                }}>
                  Cancel
                </button>
              </>
            ) : (
              <button onClick={() => setConfirmDelete(true)} style={{
                padding: '7px 10px',
                background: 'transparent',
                color: 'var(--tx-3)',
                border: '1px solid var(--bd)',
                borderRadius: 6,
                fontSize: 12,
                cursor: 'pointer',
              }}>
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
        {!loading && <ImpactSummaryStrip summary={impactSummary} />}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
        <button style={tabStyle(activeTab === 'adjustments')} onClick={() => setActiveTab('adjustments')}>
          Adjustments {adjustments.length > 0 ? `(${adjustments.length})` : ''}
        </button>
        <button style={tabStyle(activeTab === 'comparison')} onClick={() => setActiveTab('comparison')}>
          Baseline View
        </button>
        <button style={tabStyle(activeTab === 'timeline')} onClick={() => setActiveTab('timeline')}>
          Timeline
        </button>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 24px' }}>
        {loading ? (
          <div style={{ color: 'var(--tx-3)', fontSize: 13 }}>Loading adjustments…</div>
        ) : activeTab === 'adjustments' ? (
          <>
            <AdjustmentsTable
              adjustments={adjustments}
              onDelete={onDeleteAdj}
              readOnly={isCommitted}
            />
            {!isCommitted && (
              showAddForm ? (
                <AddAdjustmentForm
                  categories={categories}
                  onSubmit={handleAddAdj}
                  onCancel={() => setShowAddForm(false)}
                />
              ) : (
                <button
                  onClick={() => setShowAddForm(true)}
                  style={{
                    marginTop: 14,
                    padding: '8px 16px',
                    background: 'transparent',
                    color: 'var(--accent)',
                    border: '1px solid var(--accent-bd)',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  + Add Adjustment
                </button>
              )
            )}
            {isCommitted && (
              <div style={{
                marginTop: 14,
                padding: '10px 14px',
                background: 'rgba(46,204,113,0.06)',
                border: '1px solid rgba(46,204,113,0.15)',
                borderRadius: 6,
                fontSize: 12,
                color: 'var(--tx-2)',
              }}>
                This scenario is committed — its adjustments are locked as your actual plan baseline.
              </div>
            )}
          </>
        ) : activeTab === 'timeline' ? (
          <TimelineChart adjustments={adjustments} />
        ) : (
          <ComparisonView adjustments={adjustments} ctx={context} />
        )}
      </div>
    </div>
  )
}

function EmptyState({ viewMode, committedCount, modeledCount }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      padding: 40,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>◑</div>
      <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 600, color: 'var(--tx-1)' }}>
        {viewMode === 'actual-plan' && committedCount === 0
          ? 'No committed scenarios yet'
          : viewMode === 'baseline'
          ? 'Baseline view'
          : 'Select a scenario'}
      </h3>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--tx-2)', maxWidth: 360, lineHeight: 1.6 }}>
        {viewMode === 'actual-plan' && committedCount === 0
          ? 'Promote a modeled scenario to committed to lock it into your actual plan.'
          : viewMode === 'baseline'
          ? 'The baseline represents your current financial reality before any scenario adjustments. Select a scenario from the list to model changes against it.'
          : modeledCount + committedCount === 0
          ? 'Create a scenario to start modeling "what if" decisions against your baseline.'
          : 'Select a scenario from the list to view its adjustments and compare it to your baseline.'}
      </p>
    </div>
  )
}

// Natural-language scenario builder — type a scenario in plain English and the
// AI computes the month-by-month adjustments and writes the scenario for you.
const COMPOSER_EXAMPLE =
  "In Oct 2026 my car lease expires. I'll keep the budgeted $3k down payment, but " +
  "instead of the $467/mo I budgeted I'm leasing a Tesla Model Y Premium at ~$550/mo " +
  "plus $99/mo for FSD. Run this scenario."

function AiScenarioComposer({ userId, context, onCreated, mobile }) {
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [result, setResult] = useState(null) // { text, created, error }

  async function run() {
    const text = prompt.trim()
    if (!text || busy) return
    setBusy(true); setStatus('Thinking…'); setResult(null)
    try {
      const res = await runScenarioAgent({ userId, prompt: text, context, onStatus: setStatus })
      setResult({ text: res.text, created: res.created, error: res.status !== 'ok' })
      if (res.created?.length) { setPrompt(''); onCreated?.(res.created) }
    } catch (e) {
      setResult({ text: e.message, error: true })
    } finally {
      setBusy(false); setStatus('')
    }
  }

  return (
    <div style={{ border: '1px solid var(--accent-bd)', borderRadius: 14, background: 'var(--bg-card)', padding: mobile ? 16 : 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ color: 'var(--accent)', fontSize: 14 }}>✦</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--tx-1)' }}>Describe a scenario</span>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--tx-2)', lineHeight: 1.55, marginBottom: 12 }}>
        Write it in plain English — the AI works out the month-by-month changes and builds the scenario for you.
      </div>

      <textarea
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run() }}
        placeholder={COMPOSER_EXAMPLE}
        rows={mobile ? 5 : 4}
        disabled={busy}
        style={{
          width: '100%', resize: 'vertical', background: 'var(--field)',
          border: '1px solid var(--bd)', borderRadius: 10, padding: '11px 13px',
          color: 'var(--tx-1)', fontFamily: 'Inter, sans-serif', fontSize: 13.5, lineHeight: 1.55,
          outline: 'none', boxSizing: 'border-box',
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
        <button onClick={run} disabled={busy || !prompt.trim()} style={{
          background: 'var(--accent)', color: 'var(--accent-tx-on)', border: 'none', borderRadius: 8,
          padding: '9px 18px', fontSize: 13, fontWeight: 600,
          cursor: busy || !prompt.trim() ? 'not-allowed' : 'pointer', opacity: busy || !prompt.trim() ? 0.6 : 1,
        }}>
          {busy ? 'Building…' : '✦ Build scenario'}
        </button>
        {!prompt && !busy && !result && (
          <button onClick={() => setPrompt(COMPOSER_EXAMPLE)} style={{
            background: 'none', border: 'none', color: 'var(--tx-3)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline',
          }}>
            Try an example
          </button>
        )}
        {busy && status && (
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: 'var(--tx-3)', letterSpacing: '0.03em' }}>{status}</span>
        )}
      </div>

      {result && (
        <div style={{
          marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--bd-light)',
        }}>
          {result.error ? (
            <div style={{ fontSize: 13, color: 'var(--warn)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{result.text}</div>
          ) : (
            <Markdown text={result.text} />
          )}
          {result.created?.length > 0 && (
            <div style={{
              marginTop: 12, fontFamily: "'DM Mono', monospace", fontSize: 11,
              color: 'var(--accent)', letterSpacing: '0.03em',
            }}>
              ✓ Built {result.created.length} scenario{result.created.length === 1 ? '' : 's'} — opening it now.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function Scenarios({ userId, mobile, reloadSignal, context, onDataChange, openScenarioId }) {
  const [scenarios, setScenarios] = useState([])
  const [adjustments, setAdjustments] = useState({}) // { [scenarioId]: adj[] }
  const [adjLoading, setAdjLoading] = useState({})  // { [scenarioId]: bool }
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
    getBudgetCategories(userId)
      .then(setCategories)
      .catch(() => {})
  }, [userId, loadScenarios])

  // Reload when the AI writes a scenario from elsewhere (e.g. the command bar).
  useEffect(() => {
    if (!reloadSignal) return
    getScenarios(userId).then(setScenarios).catch(() => {})
    getBudgetCategories(userId).then(setCategories).catch(() => {})
  }, [reloadSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  // When the user clicks "Open →" on an AI result card, auto-select that scenario.
  useEffect(() => {
    if (!openScenarioId) return
    setSelectedId(openScenarioId)
    setViewMode('scenario')
    loadAdjustments(openScenarioId)
  }, [openScenarioId]) // eslint-disable-line react-hooks/exhaustive-deps

  // After the in-module AI composer builds a scenario, refresh and open it.
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

  async function loadAdjustments(scenarioId) {
    if (adjustments[scenarioId] || adjLoading[scenarioId]) return
    setAdjLoading(prev => ({ ...prev, [scenarioId]: true }))
    try {
      const data = await getAdjustments(userId, scenarioId)
      setAdjustments(prev => ({ ...prev, [scenarioId]: data }))
    } catch (e) {
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
  }

  async function handleAddAdj(data) {
    const adj = await addAdjustment(userId, selectedId, data)
    setAdjustments(prev => ({
      ...prev,
      [selectedId]: [...(prev[selectedId] ?? []), adj],
    }))
  }

  async function handleDeleteAdj(adjId) {
    await deleteAdjustment(adjId)
    setAdjustments(prev => ({
      ...prev,
      [selectedId]: (prev[selectedId] ?? []).filter(a => a.id !== adjId),
    }))
  }

  const selectedAdjs = adjustments[selectedId] ?? []
  const isAdjLoading = adjLoading[selectedId] ?? false

  // View mode filter: 'actual-plan' shows only committed; others show normal selected
  const visibleSelected = viewMode === 'actual-plan'
    ? committed[0] ?? null
    : selected

  const viewModeScenarios = viewMode === 'actual-plan'
    ? committed
    : viewMode === 'baseline'
    ? []
    : scenarios

  const btnBase = {
    padding: '6px 14px',
    border: '1px solid var(--bd)',
    borderRadius: 6,
    fontSize: 12,
    cursor: 'pointer',
    fontWeight: 500,
    transition: 'all 0.15s',
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--tx-3)', fontSize: 14 }}>
        Loading scenarios…
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: 32, color: 'var(--red)', fontSize: 14 }}>
        Error loading scenarios: {error}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Module header */}
      <div style={{
        padding: mobile ? '16px 16px 12px' : '18px 24px 14px',
        borderBottom: '1px solid var(--bd)',
        flexShrink: 0,
        display: 'flex',
        alignItems: mobile ? 'flex-start' : 'flex-end',
        gap: 12,
        flexWrap: 'wrap',
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
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-card)', border: '1px solid var(--bd)', borderRadius: 8, padding: 3 }}>
          {[
            { key: 'baseline', label: 'Baseline' },
            { key: 'actual-plan', label: 'Actual Plan' },
            { key: 'scenario', label: 'Scenarios' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setViewMode(key)}
              style={{
                ...btnBase,
                border: 'none',
                background: viewMode === key ? 'var(--accent-bg)' : 'transparent',
                color: viewMode === key ? 'var(--accent)' : 'var(--tx-2)',
                fontWeight: viewMode === key ? 600 : 400,
                borderRadius: 5,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {/* Left panel: scenario list */}
        {(viewMode === 'scenario' || !mobile) && viewMode !== 'baseline' && (
          <div style={{
            width: mobile ? '100%' : 260,
            flexShrink: 0,
            borderRight: mobile ? 'none' : '1px solid var(--bd)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}>
            {/* New scenario */}
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--bd-light)' }}>
              <button
                onClick={() => { setShowNewForm(true); setSelectedId(null) }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'var(--accent)',
                  color: 'var(--accent-tx-on)',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                + New Scenario
              </button>
            </div>

            {/* New scenario form */}
            {showNewForm && (
              <NewScenarioForm
                onSubmit={handleCreate}
                onCancel={() => setShowNewForm(false)}
              />
            )}

            <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
              {/* Modeled scenarios */}
              {modeled.length > 0 && (
                <>
                  <div style={{ padding: '4px 14px 6px', fontSize: 10, fontWeight: 600, color: 'var(--tx-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    Modeled
                  </div>
                  {modeled.map(s => (
                    <ScenarioListItem
                      key={s.id}
                      scenario={s}
                      selected={selectedId === s.id}
                      onClick={() => handleSelect(s.id)}
                    />
                  ))}
                </>
              )}

              {/* Committed scenarios */}
              {committed.length > 0 && (
                <>
                  <div style={{ padding: `${modeled.length ? '14px' : '4px'} 14px 6px`, fontSize: 10, fontWeight: 600, color: 'var(--tx-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    Committed
                  </div>
                  {committed.map(s => (
                    <ScenarioListItem
                      key={s.id}
                      scenario={s}
                      selected={selectedId === s.id}
                      onClick={() => handleSelect(s.id)}
                    />
                  ))}
                </>
              )}

              {scenarios.length === 0 && !showNewForm && (
                <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 12, color: 'var(--tx-3)' }}>
                  No scenarios yet.<br />Create one to start modeling.
                </div>
              )}
            </div>

            {/* AI tip */}
            <div style={{
              padding: '10px 14px',
              borderTop: '1px solid var(--bd-light)',
              fontSize: 11,
              color: 'var(--tx-3)',
              lineHeight: 1.5,
            }}>
              Use the AI command bar to create scenarios via conversation.
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
              />
            ) : viewMode === 'scenario' ? (
              <div style={{ flex: 1, overflow: 'auto', padding: mobile ? 16 : 24 }}>
                <div style={{ maxWidth: 720, margin: '0 auto' }}>
                  <AiScenarioComposer userId={userId} context={context} onCreated={handleAiCreated} mobile={mobile} />
                  <div style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--tx-3)', lineHeight: 1.6, marginTop: 18 }}>
                    {scenarios.length === 0
                      ? 'Or build one by hand with “+ New Scenario”.'
                      : 'Pick a scenario on the left to view and edit its adjustments, or describe a new one above.'}
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState
                viewMode={viewMode}
                committedCount={committed.length}
                modeledCount={modeled.length}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

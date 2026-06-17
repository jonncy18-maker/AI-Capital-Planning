import { useState, useEffect, useCallback } from 'react'
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

function ComparisonView({ adjustments }) {
  if (!adjustments.length) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--tx-3)', fontSize: 13 }}>
        No adjustments to compare. Add adjustments to see the scenario vs. baseline.
      </div>
    )
  }

  // Group by year → month
  const byYearMonth = {}
  for (const adj of adjustments) {
    const key = `${adj.year}-${String(adj.month).padStart(2, '0')}`
    if (!byYearMonth[key]) byYearMonth[key] = { year: adj.year, month: adj.month, rows: [] }
    byYearMonth[key].rows.push(adj)
  }

  const periods = Object.values(byYearMonth).sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year
    return a.month - b.month
  })

  let running = 0

  return (
    <div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '110px 1fr 100px 100px',
        gap: '0 12px',
        padding: '6px 12px',
        fontSize: 10,
        fontWeight: 600,
        color: 'var(--tx-3)',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        borderBottom: '1px solid var(--bd)',
      }}>
        <span>Period</span>
        <span>Changes</span>
        <span style={{ textAlign: 'right' }}>Delta</span>
        <span style={{ textAlign: 'right' }}>Cumulative</span>
      </div>
      {periods.map(({ year, month, rows }) => {
        const periodDelta = rows.reduce((s, r) => s + Number(r.delta_amount), 0)
        running += periodDelta
        const runSnap = running
        return (
          <div key={`${year}-${month}`} style={{ borderBottom: '1px solid var(--bd-light)' }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '110px 1fr 100px 100px',
              gap: '0 12px',
              alignItems: 'start',
              padding: '10px 12px',
              fontSize: 13,
            }}>
              <span style={{ fontWeight: 600, color: 'var(--tx-1)' }}>{MONTHS[month - 1]} {year}</span>
              <div>
                {rows.map(r => (
                  <div key={r.id} style={{ fontSize: 12, color: 'var(--tx-2)', marginBottom: 2 }}>
                    {r.budget_categories?.category ?? '—'}{r.label ? ` — ${r.label}` : ''}
                  </div>
                ))}
              </div>
              <span style={{
                textAlign: 'right',
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
                color: periodDelta < 0 ? 'var(--red)' : 'var(--green)',
              }}>
                {fmtFull(periodDelta)}
              </span>
              <span style={{
                textAlign: 'right',
                fontVariantNumeric: 'tabular-nums',
                color: runSnap < 0 ? 'var(--red)' : runSnap > 0 ? 'var(--green)' : 'var(--tx-2)',
              }}>
                {fmtFull(runSnap)}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ScenarioDetail({
  scenario,
  adjustments,
  categories,
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
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
        <button style={tabStyle(activeTab === 'adjustments')} onClick={() => setActiveTab('adjustments')}>
          Adjustments {adjustments.length > 0 ? `(${adjustments.length})` : ''}
        </button>
        <button style={tabStyle(activeTab === 'comparison')} onClick={() => setActiveTab('comparison')}>
          Comparison View
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
        ) : (
          <ComparisonView adjustments={adjustments} />
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

export default function Scenarios({ userId, mobile }) {
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
        padding: mobile ? '16px 16px 12px' : '20px 24px 14px',
        borderBottom: '1px solid var(--bd)',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--tx-3)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
            // scenario planner
          </div>
          <h1 style={{ margin: 0, fontSize: mobile ? 18 : 22, fontWeight: 700, color: 'var(--tx-1)' }}>
            Scenario Planner
          </h1>
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
                onPromote={handlePromote}
                onDelete={handleDelete}
                onAddAdj={handleAddAdj}
                onDeleteAdj={handleDeleteAdj}
                loading={viewMode === 'actual-plan' ? (adjLoading[visibleSelected?.id] ?? false) : isAdjLoading}
              />
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

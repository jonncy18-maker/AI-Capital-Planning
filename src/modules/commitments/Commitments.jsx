import { useState, useEffect, useCallback } from 'react'
import {
  getCommitments,
  upsertCommitment,
  deleteCommitment,
} from '../../lib/db/commitments.js'
import {
  commitmentYearSchedule,
  commitmentTotalProjected,
  describeCostStructure,
} from '../../lib/commitments/schedule.js'
import ModuleHeader from '../common/ModuleHeader.jsx'

const CUR_YEAR = new Date().getFullYear()
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const TYPES = [
  { value: 'scholarship', label: 'Scholarship / Education' },
  { value: 'family_support', label: 'Family Support' },
  { value: 'lease', label: 'Lease / Loan' },
  { value: 'eldercare', label: 'Eldercare' },
  { value: 'other', label: 'Other' },
]
const STATUSES = ['active', 'paused', 'completed']
const STATUS_COLOR = { active: 'var(--green)', paused: 'var(--warn)', completed: 'var(--tx-3)' }

function fmtFull(n) { return '$' + Math.round(n || 0).toLocaleString() }
function fmt(n) {
  const abs = Math.abs(Math.round(n))
  if (abs >= 1000) return '$' + (abs / 1000).toFixed(abs >= 10000 ? 0 : 1) + 'k'
  return '$' + abs.toLocaleString()
}

const primaryBtn = { padding: '8px 16px', background: 'var(--accent)', color: 'var(--accent-tx-on)', border: 'none', borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }
const ghostBtn = { padding: '8px 14px', background: 'transparent', color: 'var(--tx-2)', border: '1px solid var(--bd)', borderRadius: 7, fontSize: 12.5, cursor: 'pointer' }
const field = { width: '100%', padding: '8px 10px', background: 'var(--field)', border: '1px solid var(--bd)', borderRadius: 6, color: 'var(--tx-1)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }
const labelStyle = { fontSize: 11, color: 'var(--tx-2)', display: 'block', marginBottom: 4, fontWeight: 500 }

function StatusBadge({ status }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 10,
      fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
      color: STATUS_COLOR[status], background: 'var(--bg-card)', border: `1px solid ${STATUS_COLOR[status]}33`,
    }}>
      {status}
    </span>
  )
}

// ── Create / edit form ───────────────────────────────────────────────────────

function CommitmentForm({ initial, onSave, onCancel, saving }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState(initial?.type ?? 'other')
  const [status, setStatus] = useState(initial?.status ?? 'active')
  const [startDate, setStartDate] = useState(initial?.start_date ?? `${CUR_YEAR}-01-01`)
  const [endDate, setEndDate] = useState(initial?.end_date ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')

  const cs = initial?.cost_structure || {}
  const initialKind = cs.kind || (cs.monthly_amount != null ? 'monthly' : cs.annual_total != null ? 'annual' : 'monthly')
  const [kind, setKind] = useState(initialKind)
  const [amount, setAmount] = useState(cs.amount ?? cs.monthly_amount ?? cs.annual_total ?? '')
  const [dueMonth, setDueMonth] = useState(cs.month ?? cs.due_month ?? 1)

  // Split rules: array of { key, pct }
  const initialSplits = Object.entries(initial?.split_rules || {}).map(([key, val]) => ({ key, pct: Math.round(Number(val) * 100) }))
  const [splits, setSplits] = useState(initialSplits)

  const [err, setErr] = useState('')

  function buildCostStructure() {
    const amt = parseFloat(amount) || 0
    if (kind === 'monthly') return { kind: 'monthly', amount: amt }
    if (kind === 'annual') return { kind: 'annual', amount: amt, month: Number(dueMonth) }
    if (kind === 'total') return { kind: 'total', amount: amt }
    return { kind: 'monthly', amount: amt }
  }

  function buildSplitRules() {
    const out = {}
    for (const s of splits) {
      if (s.key.trim() && s.pct) out[s.key.trim()] = Number(s.pct) / 100
    }
    return out
  }

  function handleSubmit(e) {
    e.preventDefault()
    setErr('')
    if (!name.trim()) return setErr('Name is required.')
    if (!startDate) return setErr('Start date is required.')
    const payload = {
      name: name.trim(),
      type,
      status,
      start_date: startDate,
      end_date: endDate || null,
      cost_structure: buildCostStructure(),
      split_rules: buildSplitRules(),
      notes: notes.trim() || null,
    }
    if (initial?.id) payload.id = initial.id
    onSave(payload)
  }

  return (
    <form onSubmit={handleSubmit} style={{ background: 'var(--bg-card)', border: '1px solid var(--bd)', borderRadius: 12, padding: 20, maxWidth: 560 }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--tx-1)', marginBottom: 16 }}>
        {initial?.id ? 'Edit Commitment' : 'New Commitment'}
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Name</label>
        <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Claire — College Scholarship" style={field} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>Type</label>
          <select value={type} onChange={e => setType(e.target.value)} style={field}>
            {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)} style={field}>
            {STATUSES.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>Start date</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={field} />
        </div>
        <div>
          <label style={labelStyle}>End date <span style={{ color: 'var(--tx-3)' }}>(blank = open-ended)</span></label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={field} />
        </div>
      </div>

      {/* Cost structure */}
      <div style={{ border: '1px solid var(--bd-light)', borderRadius: 8, padding: 14, marginBottom: 12 }}>
        <label style={{ ...labelStyle, marginBottom: 8 }}>Cost structure</label>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {[
            { k: 'monthly', l: 'Monthly' },
            { k: 'annual', l: 'Annual' },
            { k: 'total', l: 'Lump / Total' },
          ].map(({ k, l }) => (
            <button key={k} type="button" onClick={() => setKind(k)} style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
              border: `1px solid ${kind === k ? 'var(--accent)' : 'var(--bd)'}`,
              background: kind === k ? 'var(--accent-bg)' : 'transparent',
              color: kind === k ? 'var(--accent)' : 'var(--tx-2)', fontWeight: kind === k ? 600 : 400,
            }}>{l}</button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: kind === 'annual' ? '1fr 1fr' : '1fr', gap: 12 }}>
          <div>
            <label style={labelStyle}>
              {kind === 'monthly' ? 'Amount / month' : kind === 'annual' ? 'Amount / year' : 'Total amount'}
            </label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" step="0.01" style={field} />
          </div>
          {kind === 'annual' && (
            <div>
              <label style={labelStyle}>Due month</label>
              <select value={dueMonth} onChange={e => setDueMonth(e.target.value)} style={field}>
                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
          )}
        </div>
        {kind === 'total' && (
          <div style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 6 }}>
            Spread evenly across the start → end span. Requires an end date.
          </div>
        )}
      </div>

      {/* Split rules */}
      <div style={{ border: '1px solid var(--bd-light)', borderRadius: 8, padding: 14, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>Split rules <span style={{ color: 'var(--tx-3)' }}>(optional)</span></label>
          <button type="button" onClick={() => setSplits([...splits, { key: '', pct: 0 }])} style={{ ...ghostBtn, padding: '4px 10px', fontSize: 11 }}>+ Add</button>
        </div>
        {splits.length === 0 && <div style={{ fontSize: 11.5, color: 'var(--tx-3)' }}>e.g. 95% mission, 5% family support</div>}
        {splits.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
            <input value={s.key} onChange={e => setSplits(splits.map((x, j) => j === i ? { ...x, key: e.target.value } : x))} placeholder="bucket name" style={{ ...field, flex: 1 }} />
            <input type="number" value={s.pct} onChange={e => setSplits(splits.map((x, j) => j === i ? { ...x, pct: e.target.value } : x))} style={{ ...field, width: 70 }} />
            <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>%</span>
            <button type="button" onClick={() => setSplits(splits.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: 'var(--tx-3)', cursor: 'pointer', fontSize: 16 }}>×</button>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Context, terms, reminders…" style={{ ...field, resize: 'vertical', fontFamily: 'inherit' }} />
      </div>

      {err && <div style={{ fontSize: 12.5, color: 'var(--red)', marginBottom: 12 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Saving…' : initial?.id ? 'Save Changes' : 'Create Commitment'}
        </button>
        <button type="button" onClick={onCancel} style={ghostBtn}>Cancel</button>
      </div>
    </form>
  )
}

// ── Detail view ──────────────────────────────────────────────────────────────

function CommitmentDetail({ commitment, onEdit, onDelete, onBack }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const schedule = commitmentYearSchedule(commitment, CUR_YEAR)
  const yearTotal = schedule.reduce((a, b) => a + b, 0)
  const lifetimeTotal = commitmentTotalProjected(commitment)
  const maxMonth = Math.max(...schedule, 1)

  const splitEntries = Object.entries(commitment.split_rules || {})

  return (
    <div style={{ maxWidth: 720 }}>
      <button onClick={onBack} style={{ ...ghostBtn, marginBottom: 16, padding: '5px 12px' }}>← All commitments</button>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700, color: 'var(--tx-1)' }}>{commitment.name}</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <StatusBadge status={commitment.status} />
            <span style={{ fontSize: 12, color: 'var(--tx-2)' }}>{TYPES.find(t => t.value === commitment.type)?.label ?? commitment.type}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => onEdit(commitment)} style={ghostBtn}>Edit</button>
          {confirmDelete ? (
            <>
              <button onClick={() => onDelete(commitment.id)} style={{ ...ghostBtn, color: 'var(--red)', borderColor: 'var(--red)' }}>Confirm</button>
              <button onClick={() => setConfirmDelete(false)} style={ghostBtn}>Cancel</button>
            </>
          ) : (
            <button onClick={() => setConfirmDelete(true)} style={{ ...ghostBtn, color: 'var(--tx-3)' }}>Delete</button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24, margin: '20px 0 24px', flexWrap: 'wrap' }}>
        <Stat label={`${CUR_YEAR} cost`} value={fmtFull(yearTotal)} accent />
        <Stat label="Cadence" value={describeCostStructure(commitment.cost_structure)} small />
        <Stat label="Lifetime projected" value={fmtFull(lifetimeTotal)} />
        <Stat label="Window" value={`${commitment.start_date ?? '—'} → ${commitment.end_date ?? 'open'}`} small />
      </div>

      {/* Monthly timeline */}
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx-3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>
        {CUR_YEAR} monthly schedule
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 100, marginBottom: 6 }}>
        {schedule.map((v, m) => (
          <div key={m} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
            <div style={{
              width: '100%', borderRadius: '3px 3px 0 0',
              height: `${Math.max((v / maxMonth) * 100, v > 0 ? 4 : 0)}%`,
              background: v > 0 ? 'var(--accent)' : 'transparent',
              minHeight: v > 0 ? 3 : 0,
            }} title={fmtFull(v)} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {MONTHS.map((m, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: 'var(--tx-3)' }}>{m[0]}</div>
        ))}
      </div>

      {splitEntries.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx-3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>Split allocation</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {splitEntries.map(([key, val]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12.5, color: 'var(--tx-1)', width: 140 }}>{key}</span>
                <div style={{ flex: 1, height: 8, background: 'var(--bd-light)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${Number(val) * 100}%`, height: '100%', background: 'var(--accent)' }} />
                </div>
                <span style={{ fontSize: 12, color: 'var(--tx-2)', width: 44, textAlign: 'right' }}>{Math.round(Number(val) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {commitment.notes && (
        <div style={{ marginTop: 24, padding: 14, background: 'var(--bg-card)', border: '1px solid var(--bd-light)', borderRadius: 8, fontSize: 13, color: 'var(--tx-2)', lineHeight: 1.6 }}>
          {commitment.notes}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, accent, small }) {
  return (
    <div>
      <div style={{ fontFamily: small ? 'inherit' : "'DM Serif Display', serif", fontSize: small ? 14 : 24, fontWeight: small ? 500 : 400, color: accent ? 'var(--accent)' : 'var(--tx-1)', lineHeight: 1.2 }}>
        {value}
      </div>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: 'var(--tx-3)', letterSpacing: '0.06em', marginTop: 6, textTransform: 'uppercase' }}>{label}</div>
    </div>
  )
}

// ── List card ────────────────────────────────────────────────────────────────

function CommitmentCard({ commitment, onClick }) {
  const yearTotal = commitmentYearSchedule(commitment, CUR_YEAR).reduce((a, b) => a + b, 0)
  return (
    <button onClick={onClick} style={{
      textAlign: 'left', width: '100%', background: 'var(--bg-card)', border: '1px solid var(--bd)',
      borderRadius: 12, padding: 18, cursor: 'pointer', transition: 'border-color .15s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--tx-1)' }}>{commitment.name}</div>
        <StatusBadge status={commitment.status} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--tx-2)', marginBottom: 2 }}>{TYPES.find(t => t.value === commitment.type)?.label ?? commitment.type}</div>
          <div style={{ fontSize: 11.5, color: 'var(--tx-3)' }}>{describeCostStructure(commitment.cost_structure)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{fmt(yearTotal)}</div>
          <div style={{ fontSize: 9.5, color: 'var(--tx-3)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{CUR_YEAR}</div>
        </div>
      </div>
    </button>
  )
}

// ── Main module ──────────────────────────────────────────────────────────────

export default function Commitments({ userId, mobile }) {
  const [commitments, setCommitments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [view, setView] = useState('list') // 'list' | 'form' | 'detail'
  const [editing, setEditing] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getCommitments(userId, { status: null })
      setCommitments(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { load() }, [load])

  async function handleSave(payload) {
    setSaving(true)
    try {
      await upsertCommitment(userId, payload)
      await load()
      setView('list')
      setEditing(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    try {
      await deleteCommitment(id)
      await load()
      setView('list')
      setSelectedId(null)
    } catch (e) {
      setError(e.message)
    }
  }

  const selected = commitments.find(c => c.id === selectedId)
  const filtered = filter === 'all' ? commitments : commitments.filter(c => c.status === filter)
  const activeTotal = commitments
    .filter(c => c.status === 'active')
    .reduce((s, c) => s + commitmentYearSchedule(c, CUR_YEAR).reduce((a, b) => a + b, 0), 0)

  return (
    <div style={{ maxWidth: 1000 }}>
      {/* Header */}
      <ModuleHeader
        mobile={mobile}
        icon="◈"
        title="Long-Term Commitments"
        subtitle="Track recurring obligations and forecast their cash demands."
        actions={view === 'list' && (
          <button onClick={() => { setEditing(null); setView('form') }} style={primaryBtn}>+ New Commitment</button>
        )}
      />

      {error && (
        <div style={{ padding: '12px 16px', background: 'var(--warn-bg)', border: '1px solid var(--warn)', borderRadius: 8, color: 'var(--tx-1)', fontSize: 13, marginBottom: 18 }}>{error}</div>
      )}

      {loading ? (
        <div style={{ color: 'var(--tx-3)', fontSize: 14, padding: 32 }}>Loading commitments…</div>
      ) : view === 'form' ? (
        <CommitmentForm initial={editing} onSave={handleSave} onCancel={() => { setView(editing ? 'detail' : 'list'); }} saving={saving} />
      ) : view === 'detail' && selected ? (
        <CommitmentDetail
          commitment={selected}
          onEdit={(c) => { setEditing(c); setView('form') }}
          onDelete={handleDelete}
          onBack={() => { setView('list'); setSelectedId(null) }}
        />
      ) : commitments.length === 0 ? (
        <div style={{ border: '1px dashed var(--bd)', borderRadius: 12, padding: '48px 28px', textAlign: 'center' }}>
          <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 18, color: 'var(--tx-1)', marginBottom: 10 }}>No commitments tracked yet</div>
          <div style={{ fontSize: 13.5, color: 'var(--tx-2)', lineHeight: 1.6, maxWidth: 420, margin: '0 auto 20px' }}>
            Track multi-year obligations — scholarships, family support, leases, eldercare. They flow automatically into Cash Flow Timing and the Budget Builder.
          </div>
          <button onClick={() => { setEditing(null); setView('form') }} style={primaryBtn}>+ New Commitment</button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 24, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
            <Stat label={`Active — ${CUR_YEAR}`} value={fmtFull(activeTotal)} accent />
            <Stat label="Total tracked" value={commitments.length} />
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', gap: 4, background: 'var(--bg-card)', border: '1px solid var(--bd)', borderRadius: 8, padding: 3 }}>
              {['all', ...STATUSES].map(s => (
                <button key={s} onClick={() => setFilter(s)} style={{
                  padding: '5px 12px', borderRadius: 5, fontSize: 11.5, cursor: 'pointer', border: 'none',
                  background: filter === s ? 'var(--accent-bg)' : 'transparent',
                  color: filter === s ? 'var(--accent)' : 'var(--tx-2)', fontWeight: filter === s ? 600 : 400,
                  textTransform: 'capitalize',
                }}>{s}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
            {filtered.map(c => (
              <CommitmentCard key={c.id} commitment={c} onClick={() => { setSelectedId(c.id); setView('detail') }} />
            ))}
          </div>
          {filtered.length === 0 && (
            <div style={{ color: 'var(--tx-3)', fontSize: 13, padding: 24, textAlign: 'center' }}>No {filter} commitments.</div>
          )}
        </>
      )}
    </div>
  )
}

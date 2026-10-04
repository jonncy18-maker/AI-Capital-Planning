import { useState, useEffect, useMemo, useCallback } from 'react'
import { loadOutlookInputs } from '../../lib/outlook/loadOutlook.js'
import { buildOutlook, expenseGroups, DEFAULT_INFLATION } from '../../lib/outlook/outlookEngine.js'
import {
  saveOutlookAssumptions,
  createOutlookEvent,
  updateOutlookEvent,
  deleteOutlookEvent,
  getScenarioOutlookAdjustments,
} from '../../lib/db/outlook.js'

const CUR_YEAR = new Date().getFullYear()

const fmtFull = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n || 0)).toLocaleString()
const fmtSigned = n => (n < 0 ? '−$' : '+$') + Math.abs(Math.round(n)).toLocaleString()
const fmtPct = r => `${Math.round(r * 1000) / 10}%`

const mono = { fontFamily: "'DM Mono', monospace", fontVariantNumeric: 'tabular-nums' }
const fieldStyle = {
  padding: '7px 9px', background: 'var(--field)', border: '1px solid var(--bd)',
  borderRadius: 6, color: 'var(--tx-1)', fontSize: 12.5, outline: 'none', boxSizing: 'border-box',
}
const smallBtn = {
  padding: '6px 12px', background: 'transparent', color: 'var(--tx-2)',
  border: '1px solid var(--bd)', borderRadius: 6, fontSize: 12, cursor: 'pointer',
}
const primarySmall = {
  padding: '7px 14px', background: 'var(--accent)', color: 'var(--accent-tx-on)',
  border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
}
const th = {
  ...mono, fontSize: 10, fontWeight: 500, color: 'var(--tx-3)', letterSpacing: '0.06em',
  textTransform: 'uppercase', textAlign: 'right', padding: '10px 12px', whiteSpace: 'nowrap',
}
const td = { padding: '10px 12px', textAlign: 'right', fontSize: 13, color: 'var(--tx-1)', whiteSpace: 'nowrap', ...mono }
const rowLabel = { padding: '10px 12px', textAlign: 'left', fontSize: 13, color: 'var(--tx-1)', whiteSpace: 'nowrap' }

// "4" / "4.5" / "-2" -> 0.04; '' -> null (no value); anything else -> NaN.
function parsePct(text) {
  const t = String(text).trim().replace('%', '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n / 100 : NaN
}
const toPctText = r => (r == null ? '' : String(Math.round(r * 1000) / 10))

// A percent input that only commits on blur/Enter, and only reports success
// once the parent's save has resolved.
function PctInput({ value, placeholder, onCommit, busy, width = 64, ariaLabel }) {
  const [draft, setDraft] = useState(toPctText(value))
  // Re-sync the draft when the saved value changes (derived state, not an effect).
  const [seen, setSeen] = useState(value)
  if (seen !== value) { setSeen(value); setDraft(toPctText(value)) }

  function commit() {
    if (busy) return
    const parsed = parsePct(draft)
    if (Number.isNaN(parsed)) { setDraft(toPctText(value)); return }
    if (parsed === (value ?? null)) return
    onCommit(parsed)
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <input
        value={draft}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={busy}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
        inputMode="decimal"
        style={{ ...fieldStyle, ...mono, width, textAlign: 'right', opacity: busy ? 0.6 : 1 }}
      />
      <span style={{ ...mono, fontSize: 12, color: 'var(--tx-3)' }}>%</span>
    </span>
  )
}

function EventForm({ editing, years, groups, busy, onSubmit, onCancel }) {
  const [year, setYear] = useState(editing?.year ?? years[1] ?? years[0])
  const [group, setGroup] = useState(editing?.group_name ?? groups[0] ?? '')
  const [name, setName] = useState(editing?.name ?? '')
  const [amount, setAmount] = useState(editing ? String(editing.amount) : '')
  const [err, setErr] = useState('')

  const yearOptions = years.includes(year) ? years : [year, ...years]
  const groupOptions = groups.includes(group) || !group ? groups : [group, ...groups]

  async function submit(e) {
    e.preventDefault()
    setErr('')
    const amt = parseFloat(amount)
    if (!name.trim()) return setErr('Enter a name.')
    if (!group) return setErr('Pick a group.')
    if (!Number.isFinite(amt)) return setErr('Enter an amount.')
    try {
      await onSubmit({ year: Number(year), group_name: group, name: name.trim(), amount: amt })
    } catch (ex) {
      setErr(ex.message)
    }
  }

  return (
    <form onSubmit={submit} style={{ background: 'var(--bg-card)', border: '1px solid var(--bd)', borderRadius: 8, padding: 14, marginTop: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 10 }}>
        <label style={{ fontSize: 11, color: 'var(--tx-2)' }}>Year
          <select value={year} onChange={e => setYear(Number(e.target.value))} style={{ ...fieldStyle, width: '100%', marginTop: 4 }}>
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 11, color: 'var(--tx-2)' }}>Group
          <select value={group} onChange={e => setGroup(e.target.value)} style={{ ...fieldStyle, width: '100%', marginTop: 4 }}>
            {groupOptions.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 11, color: 'var(--tx-2)' }}>Name
          <input value={name} onChange={e => setName(e.target.value)} maxLength={200} placeholder="e.g. New roof" style={{ ...fieldStyle, width: '100%', marginTop: 4 }} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--tx-2)' }}>Amount (spend)
          <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="0" style={{ ...fieldStyle, ...mono, width: '100%', marginTop: 4 }} />
        </label>
      </div>
      {err && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={busy} style={{ ...primarySmall, opacity: busy ? 0.6 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}>
          {busy ? 'Saving…' : editing ? 'Save event' : 'Add event'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} style={smallBtn}>Cancel</button>
      </div>
    </form>
  )
}

export default function OutlookView({ userId, mobile }) {
  const [inputs, setInputs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [scenarioId, setScenarioId] = useState('')
  const [selectedAdjustments, setSelectedAdjustments] = useState([])
  const [scenarioBusy, setScenarioBusy] = useState(false)

  const [saving, setSaving] = useState(null) // key of the assumption being saved
  const [eventForm, setEventForm] = useState(null) // null | 'new' | event
  const [eventBusy, setEventBusy] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    return loadOutlookInputs(userId, { curYear: CUR_YEAR })
      .then(setInputs)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [userId])

  // First load goes through the promise directly: `loading` starts true, so the
  // effect never needs to set state synchronously.
  useEffect(() => {
    let cancelled = false
    loadOutlookInputs(userId, { curYear: CUR_YEAR })
      .then(res => { if (!cancelled) setInputs(res) })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [userId])

  async function pickScenario(id) {
    setScenarioId(id)
    setSelectedAdjustments([])
    if (!id) return
    setScenarioBusy(true)
    setError(null)
    try {
      setSelectedAdjustments(await getScenarioOutlookAdjustments(id))
    } catch (e) {
      setError(e.message)
      setScenarioId('')
    } finally {
      setScenarioBusy(false)
    }
  }

  const outlook = useMemo(
    () => (inputs ? buildOutlook({ ...inputs, selectedAdjustments }) : null),
    [inputs, selectedAdjustments]
  )

  const groupNames = useMemo(() => expenseGroups(inputs?.categories ?? []), [inputs])

  const pickableScenarios = useMemo(
    () => (inputs?.scenarios ?? []).filter(s => s.state === 'modeled' || s.state === 'idea'),
    [inputs]
  )

  async function saveAssumptions(key, patch) {
    setSaving(key)
    setError(null)
    try {
      const saved = await saveOutlookAssumptions(patch)
      setInputs(prev => ({ ...prev, assumptions: saved }))
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(null)
    }
  }

  async function submitEvent(data) {
    setEventBusy(true)
    try {
      if (eventForm && eventForm !== 'new') {
        const saved = await updateOutlookEvent(eventForm.id, data)
        setInputs(prev => ({ ...prev, events: prev.events.map(e => (e.id === saved.id ? saved : e)) }))
      } else {
        const saved = await createOutlookEvent(data)
        setInputs(prev => ({ ...prev, events: [...prev.events, saved] }))
      }
      setEventForm(null)
    } finally {
      setEventBusy(false)
    }
  }

  async function removeEvent(ev) {
    if (!window.confirm(`Delete "${ev.name}" (${ev.year})?`)) return
    setEventBusy(true)
    setError(null)
    try {
      await deleteOutlookEvent(ev.id)
      setInputs(prev => ({ ...prev, events: prev.events.filter(e => e.id !== ev.id) }))
    } catch (e) {
      setError(e.message)
    } finally {
      setEventBusy(false)
    }
  }

  if (loading) return <div style={{ color: 'var(--tx-3)', fontSize: 14, padding: 32 }}>Loading outlook…</div>
  if (error && !inputs) {
    return (
      <div style={{ padding: '12px 16px', background: 'var(--warn-bg)', border: '1px solid var(--warn)', borderRadius: 8, color: 'var(--tx-1)', fontSize: 13 }}>
        {error} <button onClick={load} style={{ ...smallBtn, marginLeft: 8 }}>Retry</button>
      </div>
    )
  }

  if (outlook.empty) {
    return (
      <div style={{ border: '1px dashed var(--bd)', borderRadius: 12, padding: '48px 28px', textAlign: 'center' }}>
        <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 18, color: 'var(--tx-1)', marginBottom: 10 }}>
          No budget to project from yet
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--tx-2)', lineHeight: 1.6, maxWidth: 460, margin: '0 auto' }}>
          Build the {outlook.nextYear} budget first (switch to Detailed). The outlook compounds that
          budget forward by group for the four years after it.
        </div>
      </div>
    )
  }

  const { columns } = outlook
  const assumptions = inputs.assumptions
  const years = columns.map(c => c.year)
  const inflation = Number.isFinite(Number(assumptions?.inflation_rate)) ? Number(assumptions.inflation_rate) : DEFAULT_INFLATION
  const incomeGrowth = Number(assumptions?.income_growth_rate)
  const hasIncome = outlook.income.some(v => v != null)
  const events = [...inputs.events].sort((a, b) => a.year - b.year)
  const scenarioActive = !!scenarioId
  const labelOf = ev => `${ev.year} · ${ev.group_name}`
  const dash = <span style={{ color: 'var(--tx-3)' }}>—</span>

  const cellBg = tint => (tint ? { background: 'var(--warn-bg)' } : null)

  return (
    <div>
      {error && (
        <div style={{ padding: '10px 14px', background: 'var(--warn-bg)', border: '1px solid var(--warn)', borderRadius: 8, color: 'var(--tx-1)', fontSize: 13, marginBottom: 14 }}>
          {error}
        </div>
      )}

      {outlook.baseMode === 'current' && (
        <div style={{ padding: '10px 14px', background: 'var(--accent-bg)', border: '1px solid var(--accent-bd, var(--accent))', borderRadius: 8, fontSize: 13, color: 'var(--tx-1)', marginBottom: 14 }}>
          Starting from the {outlook.baseYear} budget — build {outlook.nextYear} for a better base
        </div>
      )}

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--tx-2)', marginBottom: 4 }}>Inflation default</div>
          <PctInput
            value={inflation}
            ariaLabel="Inflation default percent"
            busy={saving === 'inflation'}
            onCommit={v => { if (v != null) saveAssumptions('inflation', { inflation_rate: v }) }}
          />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--tx-2)', marginBottom: 4 }}>Income growth</div>
          <PctInput
            value={Number.isFinite(incomeGrowth) ? incomeGrowth : null}
            ariaLabel="Income growth percent"
            busy={saving === 'growth'}
            onCommit={v => { if (v != null) saveAssumptions('growth', { income_growth_rate: v }) }}
          />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--tx-2)', marginBottom: 4 }}>Scenario</div>
          <select
            value={scenarioId}
            onChange={e => pickScenario(e.target.value)}
            disabled={scenarioBusy}
            style={{ ...fieldStyle, minWidth: 190 }}
          >
            <option value="">Baseline (committed)</option>
            {pickableScenarios.map(s => <option key={s.id} value={s.id}>{s.name}{s.state === 'idea' ? ' (idea)' : ''}</option>)}
          </select>
        </div>
        {scenarioBusy && <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>Loading scenario…</span>}
      </div>

      <div style={{ border: '1px solid var(--bd)', borderRadius: 10, background: 'var(--bg-card)', overflowX: 'auto', maxWidth: '100%' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--bd)' }}>
              <th style={{ ...th, textAlign: 'left' }}> </th>
              <th style={th}>Rate</th>
              {columns.map(c => (
                <th key={c.year} style={th}>
                  <div style={{ color: 'var(--tx-1)', fontSize: 12 }}>{c.year}</div>
                  <div style={{ fontSize: 9, color: c.kind === 'detailed' ? 'var(--accent)' : 'var(--tx-3)' }}>{c.kind}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: '1px solid var(--bd-light)' }}>
              <td style={rowLabel}>Take-home income</td>
              <td style={{ ...td, color: 'var(--tx-3)' }}>{Number.isFinite(incomeGrowth) ? fmtPct(incomeGrowth) : dash}</td>
              {outlook.income.map((v, i) => <td key={years[i]} style={td}>{v == null ? dash : fmtFull(v)}</td>)}
            </tr>
            {outlook.groups.map(g => (
              <tr key={g.name} style={{ borderBottom: '1px solid var(--bd-light)' }}>
                <td style={rowLabel}>{g.name}</td>
                <td style={td}>
                  <PctInput
                    value={g.isOverride ? g.rate : null}
                    placeholder={toPctText(g.rate)}
                    ariaLabel={`${g.name} growth rate percent`}
                    busy={saving === `g:${g.name}`}
                    onCommit={v => saveAssumptions(`g:${g.name}`, { group_rates: { [g.name]: v } })}
                  />
                  {!g.isOverride && <div style={{ fontSize: 9.5, color: 'var(--tx-3)' }}>default</div>}
                </td>
                {g.cells.map((cell, i) => (
                  <td
                    key={years[i]}
                    style={td}
                    title={cell.committedAdj ? `Includes ${fmtSigned(cell.committedAdj)} from committed scenarios` : undefined}
                  >
                    {fmtFull(cell.amount)}
                    {cell.committedAdj !== 0 && <div style={{ fontSize: 10, color: 'var(--tx-3)' }}>{fmtSigned(cell.committedAdj)} committed</div>}
                    {scenarioActive && cell.scenarioDelta !== 0 && (
                      <div style={{ fontSize: 10.5, color: cell.scenarioDelta > 0 ? 'var(--red)' : 'var(--accent)' }}>{fmtSigned(cell.scenarioDelta)}</div>
                    )}
                  </td>
                ))}
              </tr>
            ))}
            <tr style={{ borderBottom: '1px solid var(--bd-light)' }}>
              <td style={rowLabel}>Commitments</td>
              <td style={td}>{dash}</td>
              {outlook.commitments.map((v, i) => {
                const ended = outlook.commitmentEnds[i]
                return (
                  <td
                    key={years[i]}
                    style={{ ...td, ...cellBg(ended.length) }}
                    title={ended.length ? ended.map(c => `${c.name} ended ${c.ended}`).join('\n') : undefined}
                  >
                    {fmtFull(v)}
                    {ended.length > 0 && <div style={{ fontSize: 9.5, color: 'var(--tx-3)' }}>{ended.length} ended</div>}
                  </td>
                )
              })}
            </tr>
            <tr style={{ borderBottom: '1px solid var(--bd-light)' }}>
              <td style={rowLabel}>Planned events</td>
              <td style={td}>{dash}</td>
              {outlook.events.map((e, i) => (
                <td key={years[i]} style={td} title={e.items.map(x => `${x.name}: ${fmtFull(x.amount)}`).join('\n') || undefined}>
                  {e.total !== 0 ? fmtFull(e.total) : dash}
                </td>
              ))}
            </tr>
            <tr style={{ background: 'var(--accent-bg)' }}>
              <td style={{ ...rowLabel, fontWeight: 700 }}>Net savings</td>
              <td style={td}>{dash}</td>
              {outlook.netSavings.map((v, i) => (
                <td key={years[i]} style={{ ...td, fontWeight: 700, color: v == null ? 'var(--tx-3)' : v < 0 ? 'var(--red)' : 'var(--accent)' }}>
                  {v == null ? '—' : fmtFull(v)}
                  {scenarioActive && v != null && outlook.scenarioDeltaTotals[i] !== 0 && (
                    <div style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--tx-2)' }}>
                      with scenario {fmtFull(outlook.netSavingsScenario[i])}
                    </div>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {!hasIncome && (
        <div style={{ fontSize: 12, color: 'var(--tx-3)', marginTop: 8 }}>
          Income and net savings show — until a salary is set in Settings &gt; Planning.
        </div>
      )}
      <div style={{ fontSize: 11.5, color: 'var(--tx-3)', marginTop: 8, lineHeight: 1.5 }}>
        Each group compounds from the {outlook.baseYear} budget by its rate. Commitments are placed exactly and
        are not inflated; commitment-linked budget lines are not counted in the groups. Events and scenario
        adjustments land only in their own year.
      </div>

      <div style={{ marginTop: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx-3)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Planned events
          </div>
          {!eventForm && <button onClick={() => setEventForm('new')} style={smallBtn}>+ Add event</button>}
        </div>

        {eventForm && (
          <EventForm
            key={eventForm === 'new' ? 'new' : eventForm.id}
            editing={eventForm === 'new' ? null : eventForm}
            years={years}
            groups={groupNames}
            busy={eventBusy}
            onSubmit={submitEvent}
            onCancel={() => setEventForm(null)}
          />
        )}

        {events.length === 0 && !eventForm ? (
          <div style={{ fontSize: 13, color: 'var(--tx-3)', padding: '14px 0' }}>
            No planned events. Add one-off costs (a roof, a wedding) for the year they land.
          </div>
        ) : (
          <div style={{ marginTop: 10, border: events.length ? '1px solid var(--bd)' : 'none', borderRadius: 10, overflow: 'hidden' }}>
            {events.map((ev, i) => (
              <div key={ev.id} style={{
                display: 'grid',
                gridTemplateColumns: mobile ? '1fr auto' : '160px 1fr auto auto',
                gap: 12, alignItems: 'center', padding: '10px 14px', fontSize: 12.5,
                borderTop: i ? '1px solid var(--bd-light)' : 'none',
              }}>
                <span style={{ color: 'var(--tx-2)' }}>{labelOf(ev)}</span>
                {!mobile && <span style={{ color: 'var(--tx-1)' }}>{ev.name}</span>}
                <span style={{ ...mono, color: 'var(--tx-1)', textAlign: 'right' }}>
                  {mobile && <span style={{ color: 'var(--tx-1)', marginRight: 8 }}>{ev.name}</span>}
                  {fmtFull(ev.amount)}
                </span>
                <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', gridColumn: mobile ? '1 / -1' : 'auto' }}>
                  <button onClick={() => setEventForm(ev)} disabled={eventBusy} style={smallBtn}>Edit</button>
                  <button onClick={() => removeEvent(ev)} disabled={eventBusy} style={{ ...smallBtn, color: 'var(--red)' }}>Delete</button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

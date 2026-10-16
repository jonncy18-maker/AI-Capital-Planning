import { useEffect, useRef, useState } from 'react'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const field = { padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 7, background: 'var(--field)', color: 'var(--tx-1)', fontSize: 14, minWidth: 0, boxSizing: 'border-box' }
const button = { ...field, cursor: 'pointer', minHeight: 40 }
const money = value => Number(value || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

export default function ForecastGroupEditor({ rows, initialCategory, initialMonth, year, editable, onClose, onUpdateLine, onAddLine, onSetRate, onDeleteLabel }) {
  const dialogRef = useRef(null)
  const [categoryId, setCategoryId] = useState(initialCategory ?? rows[0]?.catId)
  const [knownRows] = useState(() => rows.map(category => ({ ...category, items: [] })))
  const [drafts, setDrafts] = useState({})
  const [rates, setRates] = useState({})
  const [newLabel, setNewLabel] = useState('')
  const [newRate, setNewRate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)
  const busyRef = useRef(false)
  const activeRef = useRef(true)
  const availableRows = [...rows, ...knownRows.filter(category => !rows.some(current => current.catId === category.catId))]
  const row = availableRows.find(candidate => candidate.catId === categoryId) ?? availableRows[0] ?? { catId: null, name: 'No forecast categories', group: 'Forecast', items: [] }
  const canEdit = editable && row.catId != null
  const categoryDraftLines = Object.values(drafts).filter(draft => draft.catId === row.catId && draft.line).map(draft => draft.line)
  const displayItems = [...row.items, ...categoryDraftLines.filter((line, index) => !row.items.some(current => current.id === line.id) && categoryDraftLines.findIndex(candidate => candidate.id === line.id) === index)]
  const dirty = Object.keys(drafts).length > 0
  const firstEditable = year === new Date().getFullYear() ? new Date().getMonth() : 0
  useEffect(() => {
    const dialog = dialogRef.current
    const opener = document.activeElement
    activeRef.current = true
    dialog.showModal()
    return () => { activeRef.current = false; dialog.close(); if (opener instanceof HTMLElement) opener.focus() }
  }, [])

  async function perform(action) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true); setError(null); setMessage(null)
    try { await action() } catch (err) { setError(err.message) } finally { busyRef.current = false; setBusy(false) }
  }
  function change(key, value, line, month, label) {
    setDrafts(previous => ({ ...previous, [key]: { value, line, month, label, catId: row.catId } }))
  }
  function save() {
    perform(async () => {
      for (const draft of Object.values(drafts)) {
        if (draft.value.trim() === '' || !Number.isFinite(Number(draft.value))) throw new Error('Enter a valid amount for each changed month.')
      }
      for (const [key, draft] of Object.entries(drafts)) {
        if (!activeRef.current) return
        const amount = Number(draft.value)
        if (draft.value.trim() === '' || !Number.isFinite(amount)) throw new Error('Enter a valid amount for each changed month.')
        if (draft.line) await onUpdateLine(draft.line.id, amount, true)
        else await onAddLine(draft.catId, draft.label || null, draft.month + 1, amount)
        setDrafts(previous => { const next = { ...previous }; delete next[key]; return next })
      }
      setMessage('Month changes saved.')
    })
  }
  const labels = [...new Set([...displayItems.map(line => line.label || ''), ...Object.values(drafts).filter(draft => draft.catId === row.catId).map(draft => draft.label || '')])]
  if (!labels.length) labels.push('')
  return <dialog ref={dialogRef} aria-labelledby="forecast-editor-title" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busyRef.current) onClose() } }} onCancel={event => { event.preventDefault(); if (!busyRef.current) onClose() }} style={{ margin: 'auto', textAlign: 'left', width: 'min(860px, calc(100vw - 40px))', maxHeight: 'calc(100dvh - 40px)', boxSizing: 'border-box', padding: 24, border: '1px solid var(--bd)', borderRadius: 16, background: 'var(--bg-card)', color: 'var(--tx-1)', overflow: 'auto' }}>
    <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: 16 }}>
      <h2 id="forecast-editor-title" style={{ margin: '0 0 12px', fontSize: 20, color: 'var(--tx-1)', overflowWrap: 'anywhere' }}>{row.group} · {year}</h2>
      <button type="button" aria-label="Close forecast editor" disabled={busy} onClick={onClose} style={button}>✕</button>
    </div>
    <label style={{ display: 'grid', gap: 6 }}>Category
      <select aria-label="Forecast category" value={row.catId} disabled={busy || availableRows.length === 0} onChange={event => setCategoryId(event.target.value)} style={{ ...field, width: '100%' }}>{availableRows.map(category => <option key={category.catId} value={category.catId}>{category.name}</option>)}</select>
    </label>
    <p style={{ fontSize: 12, color: 'var(--tx-3)' }}>{canEdit ? 'Month amounts are drafts until Save changes. Cancel discards unsaved amounts. Past months are read-only.' : 'Forecast line detail is read-only here. Switch to an initialized Forecast to edit.'}</p>
    {initialMonth != null && <p style={{ fontSize: 12, color: 'var(--tx-3)' }}>Opened from {MONTHS[initialMonth - 1]}.</p>}
    {error && <p role="alert" style={{ color: 'var(--warn)', overflowWrap: 'anywhere' }}>{error}</p>}
    {message && <p role="status">{message}</p>}
    {rows.length === 0 && <p role="status">No saved forecast lines remain in this group. Unsaved month drafts are retained.</p>}
    {labels.map(label => {
      const lines = displayItems.filter(line => (line.label || '') === label)
      return <section key={label} style={{ marginTop: 18, padding: 16, border: '1px solid var(--bd)', borderRadius: 10 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 15, overflowWrap: 'anywhere' }}>{label || 'Untitled line'}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
          {MONTHS.map((month, index) => {
            const monthLines = lines.filter(line => line.month === index + 1)
            const cells = monthLines.length ? monthLines : [null]
            return <div key={month} style={{ display: 'grid', gap: 4, alignContent: 'start' }}>
              {cells.map((line, lineIndex) => {
                const key = `${row.catId}:${label}:${index}:${line?.id ?? 'new'}`
                const value = drafts[key]?.value ?? String(line?.amount ?? 0)
                return <label key={key} style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--tx-3)' }}>{month}{cells.length > 1 ? ` · line ${lineIndex + 1}` : ''}
                  {canEdit && index >= firstEditable ? <input aria-label={`${row.name} ${label || 'Untitled line'} ${month}${cells.length > 1 ? ` line ${lineIndex + 1}` : ''}`} type="number" step="any" value={value} disabled={busy} onChange={event => change(key, event.target.value, line, index, label)} style={{ ...field, width: '100%', outline: initialMonth === index + 1 ? '1px solid var(--accent)' : undefined }} /> : <span style={{ padding: '9px 0', color: 'var(--tx-2)' }}>{money(line?.amount)}</span>}
                </label>
              })}
            </div>
          })}
        </div>
        {canEdit && <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ fontSize: 12 }}>Future monthly rate ($) <input aria-label={`Monthly rate for ${label || 'Untitled line'}`} type="number" step="any" value={rates[`${row.catId}::${label}`] ?? ''} onChange={event => setRates(previous => ({ ...previous, [`${row.catId}::${label}`]: event.target.value }))} disabled={busy || dirty} style={{ ...field, width: 110 }} /></label>
          <button type="button" disabled={busy || dirty || rates[`${row.catId}::${label}`] == null || rates[`${row.catId}::${label}`].trim() === ''} onClick={() => perform(async () => { await onSetRate(row.catId, label || null, Number(rates[`${row.catId}::${label}`]), true); setMessage('Future monthly rate saved immediately.') })} style={button}>Apply rate now</button>
          {lines.length > 0 && <button type="button" disabled={busy || dirty} onClick={() => perform(async () => { await onDeleteLabel(row.catId, label || null, true); setMessage('Named line deleted immediately.') })} style={button}>Delete line now</button>}
        </div>}
      </section>
    })}
    {canEdit && <section style={{ marginTop: 18, borderTop: '1px solid var(--bd)', paddingTop: 14 }}>
      <p style={{ fontSize: 12, color: 'var(--tx-3)' }}>Rate, add, and delete actions save immediately. Save or cancel month drafts before using them.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input aria-label="New forecast line name" placeholder="New named item" value={newLabel} disabled={busy || dirty} onChange={event => setNewLabel(event.target.value)} style={{ ...field, flex: '1 1 200px' }} />
        <input aria-label="New forecast monthly rate" placeholder="Monthly rate ($)" type="number" step="any" value={newRate} disabled={busy || dirty} onChange={event => setNewRate(event.target.value)} style={{ ...field, width: 150 }} />
        <button type="button" disabled={busy || dirty || !newLabel.trim() || newRate.trim() === ''} onClick={() => perform(async () => { await onSetRate(row.catId, newLabel.trim(), Number(newRate), true); setNewLabel(''); setNewRate(''); setMessage('Named item and future rate saved immediately.') })} style={button}>Add item now</button>
      </div>
    </section>}
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
      <button type="button" disabled={busy} onClick={onClose} style={button}>Cancel</button>
      {canEdit && <button type="button" disabled={busy || !dirty} onClick={save} style={{ ...button, background: 'var(--accent)', color: 'var(--accent-tx-on)' }}>{busy ? 'Saving…' : 'Save changes'}</button>}
    </div>
  </dialog>
}

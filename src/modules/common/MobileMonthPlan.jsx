import { useState, useEffect } from 'react'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const money = value => '$' + Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
const control = { minHeight: 44, border: '1px solid var(--bd)', borderRadius: 8, background: 'var(--bg-card)', color: 'var(--tx-1)', padding: '8px 12px', fontSize: 14 }
const rowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 48 }

export function MobileMonthSelector({ year, month, onChange }) {
  return <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
    <button type="button" aria-label="Previous month" style={control} disabled={month === 0} onClick={() => onChange(month - 1)}>‹</button>
    <select aria-label="Month" value={month} onChange={e => onChange(Number(e.target.value))} style={{ ...control, flex: 1, minWidth: 0 }}>
      {MONTHS.map((name, index) => <option key={name} value={index}>{name} {year}</option>)}
    </select>
    <button type="button" aria-label="Next month" style={control} disabled={month === 11} onClick={() => onChange(month + 1)}>›</button>
  </div>
}

function AmountEditor({ value, label, onSave, saveLabel, editorId, onEditingChange }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => {
    onEditingChange?.(editorId, editing)
    return () => { if (editing) onEditingChange?.(editorId, false) }
  }, [editing, editorId, onEditingChange])
  async function submit(event) {
    event.preventDefault()
    const amount = Number(draft)
    if (!Number.isFinite(amount)) return
    setBusy(true)
    setError(null)
    try { await onSave(amount); setEditing(false) } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  if (!editing) return <button type="button" aria-label={`Edit ${label}`} style={{ ...control, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }} onClick={() => { setDraft(String(value)); setEditing(true) }}>{money(value)} ✎</button>
  return <form onSubmit={submit} style={{ width: '100%', padding: '10px 0' }}>
    <label style={{ fontSize: 12 }}>{label} ($)
      <input autoFocus required type="number" step="any" value={draft} onChange={e => setDraft(e.target.value)} style={{ ...control, width: '100%', boxSizing: 'border-box', fontSize: 16, margin: '8px 0' }} />
    </label>
    <div style={{ display: 'flex', gap: 8 }}>
      <button type="submit" disabled={busy} style={control}>{busy ? 'Saving…' : saveLabel}</button>
      <button type="button" disabled={busy} style={control} onClick={() => setEditing(false)}>Cancel</button>
    </div>
    {error && <p role="alert">{error}</p>}
  </form>
}

export default function MobileMonthPlan({ rows, month, title = 'Expenses', getValue, getLines, canEdit = false, onSave, getNote, saveLabel = 'Save', onEditingChange }) {
  const grouped = new Map()
  for (const row of rows) {
    const group = row.group || 'Other'
    if (!grouped.has(group)) grouped.set(group, [])
    grouped.get(group).push(row)
  }
  const total = rows.reduce((sum, row) => sum + getValue(row, month), 0)
  return <div style={{ display: 'grid', gap: 10, minWidth: 0 }}>
    <div style={{ ...rowStyle, padding: '12px 14px', border: '1px solid var(--bd)', borderRadius: 12, background: 'var(--bg-card)' }}>
      <span>{title}</span><strong style={{ fontSize: 24, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{money(total)}</strong>
    </div>
    {[...grouped.entries()].map(([group, groupRows]) => <details key={group} style={{ border: '1px solid var(--bd)', borderRadius: 12, background: 'var(--bg-card)', padding: '0 14px' }}>
      <summary style={{ cursor: 'pointer', padding: '16px 0', color: 'var(--tx-1)' }}>{group}<strong style={{ float: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(groupRows.reduce((sum, row) => sum + getValue(row, month), 0))}</strong></summary>
      {groupRows.map(row => {
        const key = row.catId ?? row.key ?? row.name
        const lines = getLines?.(row, month) ?? []
        const value = getValue(row, month)
        return <div key={key} style={{ borderTop: '1px solid var(--bd-light)', padding: '4px 0' }}>
          <div style={{ ...rowStyle, flexWrap: 'wrap' }}>
            <span style={{ flex: 1, minWidth: 100, overflowWrap: 'anywhere' }}>{row.name}<small style={{ display: 'block', color: 'var(--tx-3)', fontSize: 11 }}>{getNote?.(row, month) ?? row.type}</small></span>
            {canEdit && lines.length <= 1 ? <AmountEditor key={`${key}-${month}`} value={value} label={row.name} saveLabel={saveLabel} editorId={`${key}-${month}`} onEditingChange={onEditingChange} onSave={amount => onSave(row, month, amount, lines[0])} /> : <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(value)}</span>}
          </div>
          {lines.length > 0 && <details>
            <summary style={{ cursor: 'pointer', padding: '12px 0', fontSize: 12, color: 'var(--tx-3)' }}>{lines.length} line item{lines.length === 1 ? '' : 's'}{canEdit && lines.length > 1 ? ' · edit individually' : ''}</summary>
            {lines.map((line, index) => <div key={line.id ?? index} style={{ ...rowStyle, flexWrap: 'wrap', paddingLeft: 10 }}>
              <span style={{ flex: 1, minWidth: 100, overflowWrap: 'anywhere', fontSize: 13 }}>{line.label || 'Untitled line'}</span>
              {canEdit ? <AmountEditor key={`${line.id}-${month}`} value={line.amount} label={line.label || row.name} saveLabel={saveLabel} editorId={`${key}-${month}-line-${line.id ?? index}`} onEditingChange={onEditingChange} onSave={amount => onSave(row, month, amount, line)} /> : <span>{money(line.amount)}</span>}
            </div>)}
          </details>}
        </div>
      })}
    </details>)}
  </div>
}

export function MobileAnnualSummary({ mobile, children }) {
  if (!mobile) return children
  return <details style={{ marginBottom: 16 }}>
    <summary style={{ padding: '12px 0', cursor: 'pointer' }}>Full-year summary</summary>
    {children}
  </details>
}

import { useRef, useState } from 'react'
import { initialBillAmountItems, normalizeBillAmountItems, totalBillAmountItems } from '../../lib/payperiods/billAmountItems.js'

const field = { minWidth: 0, width: '100%', boxSizing: 'border-box', padding: '7px', borderRadius: 5, border: '1px solid var(--bd)', background: 'var(--bg-app)', color: 'var(--tx-1)' }
const button = { padding: '6px 9px', borderRadius: 5, border: '1px solid var(--bd)', background: 'var(--bg-app)', color: 'var(--tx-1)', cursor: 'pointer' }
const money = value => Number(value).toLocaleString(undefined, { style: 'currency', currency: 'USD' })

export default function BillAmountItems({ bill, amountRow, onSave, disabled = false }) {
  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState(null)
  const [revision, setRevision] = useState(0)
  const [rowId, setRowId] = useState(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState(null)
  const panelId = `bill-items-${bill.id}`
  function toggle() {
    if (!expanded && draft === null) {
      try {
        setDraft(initialBillAmountItems(amountRow))
        setRevision(amountRow?.item_revision ?? 0)
        setRowId(amountRow?.id ?? null)
      } catch (err) { setError(err.message) }
    }
    setExpanded(value => !value)
  }
  function update(id, patch) {
    setDraft(items => items.map(item => item.id === id ? { ...item, ...patch } : item))
  }
  async function save() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const items = normalizeBillAmountItems((draft ?? []).map(item => {
        if (item.amount === '') throw new Error('Enter an amount for every item.')
        return { ...item, amount: Number(item.amount) }
      }))
      const saved = await onSave(bill.id, items, revision, rowId)
      setDraft(saved.items)
      setRevision(saved.item_revision)
      setRowId(saved.id)
    } catch (err) { setError(err.message) }
    finally { busyRef.current = false; setBusy(false) }
  }
  let draftTotal = null
  try { draftTotal = totalBillAmountItems((draft ?? []).map(item => ({ ...item, amount: item.amount === '' ? NaN : Number(item.amount) }))) } catch { /* Invalid drafts stay editable. */ }
  return <div style={{ width: '100%', fontSize: 12 }}>
    <button type="button" onClick={toggle} disabled={disabled || busy} aria-expanded={expanded} aria-controls={panelId} style={{ ...button, color: 'var(--accent)' }}>
      {expanded ? '▾' : '▸'} {amountRow?.items != null ? `Items (${amountRow.items.length})` : 'Add specific outflow items'}
    </button>
    {expanded && <div id={panelId} style={{ marginTop: 10, padding: 10, border: '1px solid var(--bd)', borderRadius: 7 }}>
      <div style={{ color: 'var(--tx-3)', marginBottom: 10 }}>Items apply to this month. Save to update the planned total.</div>
      {(draft ?? []).map((item, index) => <div key={item.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        <label style={{ flex: '1 1 140px', minWidth: 0 }}>Description
          <input aria-label={`Item ${index + 1} description`} maxLength={200} value={item.name} disabled={busy || disabled} onChange={event => update(item.id, { name: event.target.value })} style={field} />
        </label>
        <label style={{ flex: '0 1 100px' }}>Amount ($)
          <input aria-label={`Item ${index + 1} amount`} type="number" min="0" max="10000000" step="0.01" value={item.amount} disabled={busy || disabled} onChange={event => update(item.id, { amount: event.target.value })} style={field} />
        </label>
        <button type="button" aria-label={`Remove item ${index + 1}: ${item.name || 'unnamed'}`} disabled={busy || disabled} onClick={() => setDraft(items => items.filter(value => value.id !== item.id))} style={{ ...button, alignSelf: 'end', color: 'var(--warn)' }}>Remove</button>
      </div>)}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" disabled={busy || disabled || draft === null || draft.length >= 100} onClick={() => setDraft(items => [...items, { id: globalThis.crypto.randomUUID(), name: '', amount: '' }])} style={button}>+ Add item</button>
        <button type="button" disabled={busy || disabled || draft === null} onClick={save} style={{ ...button, background: 'var(--accent)', color: 'var(--accent-tx-on)' }}>{busy ? 'Saving…' : 'Save items'}</button>
        <span>Draft total: {draftTotal == null ? 'Check item fields' : money(draftTotal)}</span>
      </div>
      {error && <div role="alert" style={{ marginTop: 8, color: 'var(--warn)' }}>{error}</div>}
    </div>}
  </div>
}

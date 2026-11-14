import { useEffect, useRef, useState } from 'react'
import { previewImportUndo, commitImportUndo } from '../../lib/db/importLog.js'

const SHOWN_SKIPS = 20

const primaryBtn = {
  padding: '8px 16px', background: 'var(--accent)', color: 'var(--accent-tx-on)',
  border: 'none', borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
}
const ghostBtn = {
  padding: '8px 14px', background: 'transparent', color: 'var(--tx-2)',
  border: '1px solid var(--bd)', borderRadius: 7, fontSize: 12.5, cursor: 'pointer',
}
const mono = { fontFamily: "'DM Mono', monospace" }

function describeSkip(s) {
  if (s.reason === 'deleted') return 'deleted since the import'
  return `changed: ${(s.changed ?? []).join(', ')}`
}

const money = (v) => (v == null || Number.isNaN(Number(v)) ? '' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' }))

// Inline undo for one import-history row: preview first, then one confirm.
export default function ImportUndoPanel({ log, onDone }) {
  const [preview, setPreview] = useState(null)
  const [removeMappings, setRemoveMappings] = useState(false)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [result, setResult] = useState(null)
  // Ignores a preview that returns after the checkbox changed again.
  const seq = useRef(0)

  const load = async (remove, note = null) => {
    const mine = ++seq.current
    setBusy(true)
    setError(null)
    setNotice(note)
    try {
      const p = await previewImportUndo(null, log.id, { removeAutoMappings: remove })
      if (mine === seq.current) setPreview(p)
    } catch (err) {
      if (mine === seq.current) setError(err.body?.reason ?? err.body?.error ?? err.message)
    } finally {
      if (mine === seq.current) setBusy(false)
    }
  }

  // First preview. busy already starts true, so nothing is set before the await.
  useEffect(() => {
    let live = true
    previewImportUndo(null, log.id, { removeAutoMappings: false })
      .then(p => { if (live) setPreview(p) })
      .catch(err => { if (live) setError(err.body?.reason ?? err.body?.error ?? err.message) })
      .finally(() => { if (live) setBusy(false) })
    return () => { live = false }
  }, [log.id])

  const toggle = (checked) => {
    setRemoveMappings(checked)
    load(checked)
  }

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await commitImportUndo(null, log.id, { expected: preview.expected, removeAutoMappings: removeMappings })
      setResult(r.counts)
    } catch (err) {
      if (err.status === 409 && err.body?.error === 'plan_changed') {
        setPreview(err.body.preview)
        setNotice('Data changed since preview. Review the updated numbers and confirm again.')
      } else if (err.status === 409) {
        setError('This import was already undone.')
      } else {
        setError(err.body?.reason ?? err.message)
      }
    } finally {
      setBusy(false)
    }
  }

  const box = {
    marginTop: 8, padding: 14, border: '1px solid var(--warn)', borderRadius: 10,
    background: 'var(--bg-card)', fontSize: 12.5, color: 'var(--tx-2)', lineHeight: 1.6,
  }

  if (result) {
    return (
      <div style={box}>
        <div style={{ color: 'var(--tx-1)' }}>
          Deleted {result.deleted}, restored {result.restored}, skipped {result.skipped} (left as they are),
          removed {result.mappings_removed} mappings.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <button onClick={onDone} style={primaryBtn}>Done</button>
        </div>
      </div>
    )
  }

  const c = preview?.counts
  const skipped = preview?.skipped ?? []
  const hidden = (c?.skip ?? 0) - Math.min(skipped.length, SHOWN_SKIPS)

  return (
    <div style={box}>
      {notice && <div style={{ color: 'var(--warn)', marginBottom: 8 }}>{notice}</div>}
      {error && <div style={{ color: 'var(--warn)', marginBottom: 8 }}>{error}</div>}
      {!preview && busy && <div>Checking what can be undone…</div>}
      {preview && (
        <>
          <div style={{ color: 'var(--tx-1)' }}>
            Will delete {c.delete} rows. Will restore {c.restore} rows to their previous category/notes/tags.
            Cannot reverse {c.skip} rows (edited or deleted since import).
          </div>
          {skipped.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {skipped.slice(0, SHOWN_SKIPS).map(s => (
                <div key={s.transaction_id} style={{ ...mono, fontSize: 10.5, color: 'var(--tx-3)' }}>
                  {[s.date ? String(s.date).slice(0, 10) : null, s.merchant, money(s.amount)].filter(Boolean).join(' · ') || s.transaction_id}
                  {' — '}{describeSkip(s)}
                </div>
              ))}
              {hidden > 0 && <div style={{ ...mono, fontSize: 10.5, color: 'var(--tx-3)' }}>and {hidden} more</div>}
            </div>
          )}
          {c.mappings_removable > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={removeMappings}
                disabled={busy}
                onChange={e => toggle(e.target.checked)}
              />
              Also remove {c.mappings_removable} auto-created categories
            </label>
          )}
        </>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <button onClick={onDone} disabled={busy} style={{ ...ghostBtn, opacity: busy ? 0.6 : 1 }}>Cancel</button>
        <button onClick={confirm} disabled={busy || !preview} style={{
          ...primaryBtn, background: 'var(--warn)', color: '#1A1205',
          opacity: busy || !preview ? 0.6 : 1, cursor: busy || !preview ? 'not-allowed' : 'pointer',
        }}>
          {busy && preview ? 'Working…' : 'Confirm undo'}
        </button>
      </div>
    </div>
  )
}

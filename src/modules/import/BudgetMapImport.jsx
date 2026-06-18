import { useState, useRef } from 'react'
import { parseBudgetFile } from '../../lib/csv/budgetParser.js'
import { importCategoryMappings } from '../../lib/db/budgetCategories.js'

// Reusable drop zone for importing an existing budget / category-map file —
// CSV or .xlsx. Parses the file, upserts the mappings, and reports the result.
// Used from Settings and the Mapping module. `onImported(count)` fires on success.
export default function BudgetMapImport({ userId, onImported, compact }) {
  const [status, setStatus] = useState(null) // { kind: 'ok' | 'error', msg }
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const ref = useRef(null)

  async function handleFile(file) {
    if (!file || !userId) return
    setBusy(true)
    setStatus(null)
    try {
      const { rows, errors, sheet } = await parseBudgetFile(file)
      if (!rows.length) {
        setStatus({ kind: 'error', msg: errors[0] || 'No mappings found in that file.' })
        return
      }
      const { imported } = await importCategoryMappings(userId, rows)
      const from = sheet ? ` from “${sheet}”` : ''
      setStatus({
        kind: 'ok',
        msg: `Imported ${imported} category mapping${imported === 1 ? '' : 's'}${from}.`,
      })
      if (onImported) onImported(imported)
    } catch (err) {
      setStatus({ kind: 'error', msg: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <input
        type="file"
        accept=".csv,.xlsx,.xlsm"
        ref={ref}
        style={{ display: 'none' }}
        onChange={e => handleFile(e.target.files[0])}
      />
      <div
        onClick={() => ref.current && ref.current.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]) }}
        style={{
          border: dragOver ? '1.5px dashed var(--accent)' : '1.5px dashed var(--bd)',
          borderRadius: '10px',
          padding: compact ? '18px 16px' : '24px 20px',
          textAlign: 'center',
          background: 'var(--bg-app)',
          cursor: 'pointer',
          transition: 'border-color .15s',
        }}
      >
        <div style={{ fontSize: '20px', color: 'var(--accent)', lineHeight: 1 }}>⊹</div>
        <div style={{ fontSize: '13px', color: 'var(--tx-1)', marginTop: '9px', fontWeight: 500 }}>
          {busy ? 'Importing…' : 'Drop budget CSV or Excel file here, or click to browse'}
        </div>
        <div style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: '9.5px',
          color: 'var(--tx-3)',
          marginTop: '6px',
          letterSpacing: '0.04em',
        }}>
          COLUMNS: CATEGORY · GROUP · (OPTIONAL) MONTHLY TARGET · TYPE
        </div>
      </div>

      {status && (
        <div style={{
          marginTop: '10px',
          fontFamily: "'DM Mono', monospace",
          fontSize: '11px',
          color: status.kind === 'ok' ? 'var(--accent)' : 'var(--warn)',
        }}>
          {status.kind === 'ok' ? '✓ ' : '⚠ '}{status.msg}
        </div>
      )}
    </div>
  )
}

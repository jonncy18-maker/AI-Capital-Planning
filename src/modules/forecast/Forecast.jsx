import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react'
import { getBudgetLineItems, getBudgetYears, insertBudgetLineItem, deleteLineItem } from '../../lib/db/budgetLineItems.js'
import { getForecastOverrides, upsertForecastOverride, deleteForecastOverride } from '../../lib/db/forecastOverrides.js'
import { getTransactionsForYear } from '../../lib/db/transactions.js'
import { getBudgetCategories } from '../../lib/db/budgetCategories.js'
import { getScenarios, getAdjustments } from '../../lib/db/scenarios.js'
import ModuleHeader from '../common/ModuleHeader.jsx'
import { CONTENT_MAX } from '../common/layout.js'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const CUR_YEAR = new Date().getFullYear()
const CUR_MONTH = new Date().getMonth() // 0-indexed

function fmt(n) {
  const abs = Math.abs(Math.round(n))
  if (abs >= 1000) return '$' + (abs / 1000).toFixed(abs >= 10000 ? 0 : 1) + 'k'
  return '$' + abs.toLocaleString()
}
function fmtFull(n) {
  return '$' + Math.round(n || 0).toLocaleString()
}

const primaryBtn = {
  padding: '8px 16px', background: 'var(--accent)', color: 'var(--accent-tx-on)',
  border: 'none', borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
}
const ghostBtn = {
  padding: '8px 14px', background: 'transparent', color: 'var(--tx-2)',
  border: '1px solid var(--bd)', borderRadius: 7, fontSize: 12.5, cursor: 'pointer',
}
const lineSelect = {
  background: 'var(--field)', border: '1px solid var(--bd)', borderRadius: 6,
  padding: '5px 8px', color: 'var(--tx-1)', fontSize: 12, outline: 'none', cursor: 'pointer',
}
function lineInput(w) {
  return {
    width: w, background: 'var(--field)', border: '1px solid var(--bd)', borderRadius: 6,
    padding: '5px 9px', color: 'var(--tx-1)', fontSize: 12, outline: 'none',
  }
}

// ── Inline cell editor ───────────────────────────────────────────────────────

function CellEditor({ value, note, budgetValue, onSave, onReset, onCancel, hasOverride }) {
  const [val, setVal] = useState(String(Math.round(value ?? budgetValue ?? 0)))
  const [noteVal, setNoteVal] = useState(note ?? '')
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleSave()
    if (e.key === 'Escape') onCancel()
  }

  function handleSave() {
    const n = parseFloat(val.replace(/[^0-9.]/g, '')) || 0
    onSave(n, noteVal.trim() || null)
  }

  return (
    <div style={{
      position: 'absolute', zIndex: 50, background: 'var(--bg-card)',
      border: '1px solid var(--accent)', borderRadius: 10, padding: 14,
      boxShadow: '0 8px 28px rgba(0,0,0,0.18)', minWidth: 220,
      top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
    }}>
      <div style={{ fontSize: 11, color: 'var(--tx-3)', marginBottom: 8, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        Override forecast
      </div>
      {budgetValue != null && (
        <div style={{ fontSize: 11.5, color: 'var(--tx-3)', marginBottom: 8 }}>
          Budget baseline: <strong style={{ color: 'var(--tx-2)' }}>{fmtFull(budgetValue)}</strong>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 13, color: 'var(--tx-2)' }}>$</span>
        <input
          ref={inputRef}
          value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{
            flex: 1, background: 'var(--field)', border: '1px solid var(--accent)',
            borderRadius: 6, padding: '6px 10px', color: 'var(--tx-1)', fontSize: 14,
            fontWeight: 600, outline: 'none', width: 0,
          }}
        />
      </div>
      <input
        placeholder="Note (optional)"
        value={noteVal}
        onChange={e => setNoteVal(e.target.value)}
        onKeyDown={handleKeyDown}
        style={{
          width: '100%', background: 'var(--field)', border: '1px solid var(--bd)',
          borderRadius: 6, padding: '5px 10px', color: 'var(--tx-2)', fontSize: 12,
          outline: 'none', marginBottom: 12, boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={handleSave} style={{ ...primaryBtn, flex: 1, padding: '7px 0' }}>
          Save
        </button>
        <button onClick={onCancel} style={{ ...ghostBtn, padding: '7px 12px' }}>
          ✕
        </button>
        {hasOverride && (
          <button onClick={onReset} title="Reset to budget" style={{ ...ghostBtn, padding: '7px 12px', color: 'var(--warn)' }}>
            ↺
          </button>
        )}
      </div>
    </div>
  )
}

// Resolve the display value for a single cell based on the active layer.
function getCellDisplayValue(r, m, layer, overrideMap, scenarioDeltaMap) {
  const key = `${r.catId}::${m + 1}`
  const budgetV = r.budget[m] ?? 0
  if (layer === 'budget') return budgetV
  const forecastV = overrideMap[key] ?? budgetV
  if (layer === 'forecast') return forecastV
  return forecastV + (scenarioDeltaMap?.[key] ?? 0)
}

// ── Category drill-down (line items) ─────────────────────────────────────────
// Rendered as a set of <tr>s beneath an expanded category row. Shows each budget
// line item that rolls up into the category, plus an inline "add line" form.
// Adding a line writes a budget_line_item, which automatically re-totals into the
// category and its parent bucket.

function CategoryLineItems({ row, cellStyle, colBg, curMonth, onAddLine, onDeleteLine }) {
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [month, setMonth] = useState(String((curMonth >= 0 ? curMonth : 0) + 1))
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)

  const items = useMemo(
    () => [...row.items].sort((a, b) => a.month - b.month || (a.label || '').localeCompare(b.label || '')),
    [row.items]
  )

  async function submit() {
    const amt = parseFloat(String(amount).replace(/[^0-9.]/g, '')) || 0
    if (amt <= 0) return
    setBusy(true)
    try {
      await onAddLine(row.catId, { label: label.trim() || null, month: Number(month), amount: amt })
      setLabel(''); setAmount(''); setAdding(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {items.map(it => (
        <tr key={`li-${it.id}`} style={{ borderTop: '1px solid var(--bd-light)' }}>
          <td style={{ textAlign: 'left', fontSize: 12, color: 'var(--tx-2)', padding: '6px 14px 6px 54px', position: 'sticky', left: 0, zIndex: 1, background: 'var(--bg-app)', whiteSpace: 'nowrap' }}>
            <span style={{ color: 'var(--tx-4)', marginRight: 6 }}>↳</span>
            {it.label || 'Untitled line'}
            <button
              onClick={() => onDeleteLine(it.id)}
              title="Remove this line"
              style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--tx-4)', cursor: 'pointer', fontSize: 11, padding: 0 }}
            >
              ✕
            </button>
          </td>
          {Array.from({ length: 12 }, (_, m) => (
            <td key={m} style={{ ...cellStyle, color: m === it.month - 1 ? 'var(--tx-2)' : 'var(--tx-4)', background: colBg(m), fontSize: 11.5, padding: '6px 10px' }}>
              {m === it.month - 1 ? fmt(it.amount) : ''}
            </td>
          ))}
          <td style={{ ...cellStyle, color: 'var(--tx-2)', borderLeft: '1px solid var(--bd-light)', fontSize: 11.5 }}>{fmt(it.amount)}</td>
        </tr>
      ))}
      <tr style={{ borderTop: '1px solid var(--bd-light)' }}>
        <td colSpan={14} style={{ textAlign: 'left', padding: '7px 14px 9px 54px', background: 'var(--bg-app)' }}>
          {adding ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <input
                autoFocus
                placeholder="Line name (e.g. Flight to NYC)"
                value={label}
                onChange={e => setLabel(e.target.value)}
                style={lineInput(190)}
              />
              <select value={month} onChange={e => setMonth(e.target.value)} style={lineSelect}>
                {MONTHS.map((mL, i) => <option key={i} value={i + 1}>{mL}</option>)}
              </select>
              <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>$</span>
              <input
                placeholder="0"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setAdding(false) }}
                style={lineInput(80)}
              />
              <button onClick={submit} disabled={busy} style={{ ...primaryBtn, padding: '6px 14px', opacity: busy ? 0.6 : 1 }}>
                {busy ? 'Adding…' : 'Add'}
              </button>
              <button onClick={() => { setAdding(false); setLabel(''); setAmount('') }} style={{ ...ghostBtn, padding: '6px 11px' }}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              style={{ background: 'none', border: '1px dashed var(--bd)', borderRadius: 6, color: 'var(--tx-2)', cursor: 'pointer', fontSize: 12, padding: '5px 12px' }}
            >
              + Add line to {row.name}
            </button>
          )}
        </td>
      </tr>
    </>
  )
}

// ── Forecast grid ────────────────────────────────────────────────────────────

function ForecastGrid({ catRows, overrideMap, scenarioDeltaMap, actualMap, year, mobile, layer, onEdit, onReset, saving, editKey, collapsedGroups, onToggleGroup, expandedCats, onToggleCat, onAddLine, onDeleteLine }) {
  const curMonth = year === CUR_YEAR ? CUR_MONTH : -1 // highlight current month

  // Group rows
  const grouped = {}
  for (const r of catRows) {
    const g = r.group || '—'
    if (!grouped[g]) grouped[g] = []
    grouped[g].push(r)
  }
  const groupNames = Object.keys(grouped).sort()

  // Column totals (layer-aware)
  const forecastTotals = Array(12).fill(0)
  const actualTotals = Array(12).fill(0)
  for (const r of catRows) {
    for (let m = 0; m < 12; m++) {
      forecastTotals[m] += getCellDisplayValue(r, m, layer, overrideMap, scenarioDeltaMap)
      actualTotals[m] += actualMap[r.name]?.[m] ?? 0
    }
  }

  const cellStyle = { textAlign: 'right', fontSize: 12, padding: '8px 10px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', position: 'relative' }
  const colBg = m => (m === curMonth ? 'var(--accent-bg)' : 'transparent')
  const STICKY = 168

  if (mobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {MONTHS.map((mLabel, m) => {
          const isPast = m < curMonth || curMonth < 0
          return (
            <div key={m} style={{ border: '1px solid var(--bd)', borderRadius: 10, padding: 14, background: 'var(--bg-card)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontWeight: 600, color: 'var(--tx-1)' }}>{mLabel} {year}</span>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 600, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtFull(forecastTotals[m])}
                  </div>
                  {actualTotals[m] > 0 && isPast && (
                    <div style={{ fontSize: 11, color: 'var(--tx-3)', fontVariantNumeric: 'tabular-nums' }}>
                      actual {fmtFull(actualTotals[m])}
                    </div>
                  )}
                </div>
              </div>
              {catRows.filter(r => getCellDisplayValue(r, m, layer, overrideMap, scenarioDeltaMap) > 0).map((r, i) => {
                const key = `${r.catId}::${m + 1}`
                const displayV = getCellDisplayValue(r, m, layer, overrideMap, scenarioDeltaMap)
                const hasOv = layer !== 'budget' && overrideMap[key] != null
                const hasDelta = layer === 'scenarios' && (scenarioDeltaMap?.[key] ?? 0) !== 0
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '3px 0', color: 'var(--tx-2)' }}>
                    <span>
                      {r.name}
                      {hasOv && <span style={{ fontSize: 9, color: 'var(--accent)', marginLeft: 4 }}>●</span>}
                      {hasDelta && <span style={{ fontSize: 9, color: 'rgba(168,100,255,0.9)', marginLeft: 2 }}>◆</span>}
                    </span>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtFull(displayV)}</span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    )
  }

  // Header sits in its own sticky band so the month labels stay pinned to the top
  // of the scroll area as the user scrolls down through the rows.
  const headTh = { position: 'sticky', top: 0, zIndex: 4, background: 'var(--bg-card)' }
  return (
    <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 290px)', border: '1px solid var(--bd)', borderRadius: 12, background: 'var(--bg-card)' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', minWidth: 1040 }}>
        <thead>
          <tr>
            <th style={{ ...headTh, textAlign: 'left', fontSize: 10, color: 'var(--tx-3)', padding: '10px 14px', letterSpacing: '0.06em', textTransform: 'uppercase', left: 0, zIndex: 5, borderBottom: '1px solid var(--bd)', minWidth: STICKY }}>Category</th>
            {MONTHS.map((mLabel, mi) => (
              <th key={mLabel} style={{ ...cellStyle, ...headTh, color: mi === curMonth ? 'var(--accent)' : 'var(--tx-3)', fontWeight: 600, fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase', borderBottom: '1px solid var(--bd)', padding: '10px 10px' }}>{mLabel}</th>
            ))}
            <th style={{ ...cellStyle, ...headTh, color: 'var(--tx-2)', fontWeight: 700, fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase', borderBottom: '1px solid var(--bd)', borderLeft: '1px solid var(--bd-light)', padding: '10px 10px' }}>Total</th>
          </tr>
          {/* Actuals row */}
          <tr style={{ background: 'var(--hover)' }}>
            <td style={{ textAlign: 'left', fontSize: 10, color: 'var(--tx-4)', padding: '5px 14px', fontFamily: "'DM Mono', monospace", letterSpacing: '0.04em', position: 'sticky', left: 0, zIndex: 1, background: 'var(--bg-app)', borderBottom: '1px solid var(--bd-light)' }}>ACTUAL</td>
            {MONTHS.map((_, mi) => {
              const isPast = curMonth >= 0 ? mi < curMonth : true
              const isCurr = mi === curMonth
              const av = actualTotals[mi]
              const fv = forecastTotals[mi]
              const pct = fv > 0 && av > 0 ? av / fv : null
              const over = pct != null && pct > 1.05
              const under = pct != null && pct < 0.9
              return (
                <td key={mi} style={{ ...cellStyle, color: over ? 'var(--warn)' : under ? 'var(--accent)' : 'var(--tx-3)', background: colBg(mi), fontSize: 10.5, padding: '5px 10px', borderBottom: '1px solid var(--bd-light)' }}>
                  {(isPast || isCurr) && av > 0 ? fmt(av) : '·'}
                </td>
              )
            })}
            <td style={{ ...cellStyle, fontSize: 10.5, color: 'var(--tx-3)', borderLeft: '1px solid var(--bd-light)', padding: '5px 10px', borderBottom: '1px solid var(--bd-light)' }}>
              {fmtFull(actualTotals.reduce((a, b) => a + b, 0)) }
            </td>
          </tr>
        </thead>
        <tbody>
          {groupNames.map(g => {
            const gRows = grouped[g]
            const gForecast = Array(12).fill(0)
            for (const r of gRows) {
              for (let m = 0; m < 12; m++) {
                gForecast[m] += getCellDisplayValue(r, m, layer, overrideMap, scenarioDeltaMap)
              }
            }
            const gTotal = gForecast.reduce((a, b) => a + b, 0)
            const groupOpen = !collapsedGroups.has(g)
            return (
              <Fragment key={`group-${g}`}>
                <tr style={{ background: 'var(--hover)', cursor: 'pointer' }} onClick={() => onToggleGroup(g)}>
                  <td style={{ textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--tx-2)', padding: '7px 14px', letterSpacing: '0.05em', textTransform: 'uppercase', position: 'sticky', left: 0, zIndex: 1, background: 'var(--bg-app)' }}>
                    <span style={{ display: 'inline-block', width: 12, color: 'var(--tx-3)', transition: 'transform .12s', transform: groupOpen ? 'rotate(90deg)' : 'none' }}>▸</span>
                    {g}
                    <span style={{ marginLeft: 6, color: 'var(--tx-4)', fontWeight: 600 }}>({gRows.length})</span>
                  </td>
                  {gForecast.map((v, m) => <td key={m} style={{ ...cellStyle, color: 'var(--tx-3)', background: colBg(m) }}>{v > 0 ? fmt(v) : '·'}</td>)}
                  <td style={{ ...cellStyle, fontWeight: 700, color: 'var(--tx-2)', borderLeft: '1px solid var(--bd-light)' }}>{fmt(gTotal)}</td>
                </tr>
                {groupOpen && gRows.map((r, ri) => {
                  const rTotal = Array.from({ length: 12 }, (_, m) => getCellDisplayValue(r, m, layer, overrideMap, scenarioDeltaMap)).reduce((a, b) => a + b, 0)
                  const catOpen = expandedCats.has(r.catId)
                  return (
                    <Fragment key={`${g}-${ri}`}>
                    <tr style={{ borderTop: '1px solid var(--bd-light)' }}>
                      <td
                        onClick={() => onToggleCat(r.catId)}
                        title="Show line items"
                        style={{ textAlign: 'left', fontSize: 12.5, color: 'var(--tx-1)', padding: '8px 14px 8px 34px', position: 'sticky', left: 0, zIndex: 1, background: 'var(--bg-card)', whiteSpace: 'nowrap', cursor: 'pointer' }}
                      >
                        <span style={{ display: 'inline-block', width: 12, color: 'var(--tx-4)', transition: 'transform .12s', transform: catOpen ? 'rotate(90deg)' : 'none' }}>▸</span>
                        {r.name}
                      </td>
                      {Array.from({ length: 12 }, (_, m) => {
                        const key = `${r.catId}::${m + 1}`
                        const hasOv = layer !== 'budget' && overrideMap[key] != null
                        const hasDelta = layer === 'scenarios' && (scenarioDeltaMap?.[key] ?? 0) !== 0
                        const displayV = getCellDisplayValue(r, m, layer, overrideMap, scenarioDeltaMap)
                        const isPast = curMonth >= 0 ? m < curMonth : false
                        const isEditing = editKey === key && saving !== true
                        const canEdit = layer === 'forecast' && !isPast
                        const bg = hasOv ? 'var(--accent-bg)' : hasDelta ? 'rgba(168,100,255,0.08)' : colBg(m)
                        const col = hasOv ? 'var(--accent)' : hasDelta ? 'var(--tx-1)' : displayV > 0 ? 'var(--tx-1)' : 'var(--tx-4)'
                        return (
                          <td
                            key={m}
                            style={{
                              ...cellStyle,
                              background: bg,
                              color: col,
                              cursor: canEdit ? 'pointer' : 'default',
                              outline: isEditing ? '2px solid var(--accent)' : 'none',
                              outlineOffset: -2,
                            }}
                            onClick={() => canEdit && !isEditing && onEdit(r, m + 1)}
                          >
                            {displayV > 0 ? fmt(displayV) : '·'}
                            {hasOv && <span style={{ fontSize: 7, verticalAlign: 'super', color: 'var(--accent)', marginLeft: 1 }}>●</span>}
                            {hasDelta && <span style={{ fontSize: 7, verticalAlign: 'super', color: 'rgba(168,100,255,0.9)', marginLeft: 1 }}>◆</span>}
                          </td>
                        )
                      })}
                      <td style={{ ...cellStyle, fontWeight: 600, color: 'var(--tx-1)', borderLeft: '1px solid var(--bd-light)' }}>{rTotal > 0 ? fmt(rTotal) : '·'}</td>
                    </tr>
                    {catOpen && (
                      <CategoryLineItems
                        row={r}
                        cellStyle={cellStyle}
                        colBg={colBg}
                        curMonth={curMonth}
                        onAddLine={onAddLine}
                        onDeleteLine={onDeleteLine}
                      />
                    )}
                    </Fragment>
                  )
                })}
              </Fragment>
            )
          })}
        </tbody>
        <tfoot>
          <tr style={{ background: 'var(--bg-card)' }}>
            <td style={{ textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--tx-1)', padding: '11px 14px', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', left: 0, zIndex: 1, background: 'var(--bg-card)', borderTop: '2px solid var(--bd)' }}>
              {layer === 'budget' ? 'Budget Total' : layer === 'scenarios' ? 'With Scenarios' : 'Forecast Total'}
            </td>
            {forecastTotals.map((v, m) => <td key={m} style={{ ...cellStyle, fontWeight: 700, color: 'var(--accent)', background: colBg(m), borderTop: '2px solid var(--bd)' }}>{fmt(v)}</td>)}
            <td style={{ ...cellStyle, fontWeight: 700, color: 'var(--accent)', borderTop: '2px solid var(--bd)', borderLeft: '1px solid var(--bd-light)' }}>{fmt(forecastTotals.reduce((a, b) => a + b, 0))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ── Main module ──────────────────────────────────────────────────────────────

export default function Forecast({ userId, mobile }) {
  const [year, setYear] = useState(CUR_YEAR)
  const [years, setYears] = useState([])
  const [budgetItems, setBudgetItems] = useState([])
  const [overrides, setOverrides] = useState([])
  const [yearTxns, setYearTxns] = useState([])
  const [committedScenarios, setCommittedScenarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [layer, setLayer] = useState('forecast') // 'budget' | 'forecast' | 'scenarios'

  // Editing state: { catId, catName, month, budgetValue, currentValue, currentNote }
  const [editCell, setEditCell] = useState(null)

  // Bucket collapse + category drill-down state. Buckets start expanded so the
  // grid opens as today; the Expand/Collapse-all toggle flips every bucket at once.
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set())
  const [expandedCats, setExpandedCats] = useState(() => new Set())

  const loadData = useCallback(async (yr) => {
    setLoading(true)
    setError(null)
    try {
      const [items, ovs, txns, budgetYears, allScenarios] = await Promise.all([
        getBudgetLineItems(userId, { year: yr }),
        getForecastOverrides(userId, yr),
        getTransactionsForYear(userId, yr),
        getBudgetYears(userId),
        getScenarios(userId).catch(() => []),
      ])
      setBudgetItems(items)
      setOverrides(ovs)
      setYearTxns(txns)
      setYears(budgetYears)
      // Load adjustments for committed scenarios only
      const committed = allScenarios.filter(s => s.state === 'committed')
      const commWithAdjs = await Promise.all(
        committed.map(async s => {
          const adjs = await getAdjustments(userId, s.id).catch(() => [])
          return { ...s, adjustments: adjs }
        })
      )
      setCommittedScenarios(commWithAdjs)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { loadData(year) }, [year, loadData])

  // Build category rows: catId → { catId, name, group, type, budget[12] }
  const catRows = useMemo(() => {
    const byId = {}
    for (const li of budgetItems) {
      const id = li.category_id
      if (!id) continue
      if (!byId[id]) {
        byId[id] = {
          catId: id,
          name: li.budget_categories?.category || 'Uncategorized',
          group: li.budget_categories?.group || '—',
          type: li.budget_categories?.type || 'Flexible',
          budget: Array(12).fill(0),
          items: [],
        }
      }
      const m = (li.month ?? 1) - 1
      byId[id].budget[m] += Number(li.amount) || 0
      byId[id].items.push({ id: li.id, label: li.label, month: li.month ?? 1, amount: Number(li.amount) || 0 })
    }
    return Object.values(byId).sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name))
  }, [budgetItems])

  // Override map: "catId::month" → amount (1-indexed month)
  const overrideMap = useMemo(() => {
    const m = {}
    for (const ov of overrides) {
      if (ov.category_id && ov.month) m[`${ov.category_id}::${ov.month}`] = Number(ov.amount)
    }
    return m
  }, [overrides])

  // Override notes: "catId::month" → note
  const overrideNoteMap = useMemo(() => {
    const m = {}
    for (const ov of overrides) {
      if (ov.category_id && ov.month) m[`${ov.category_id}::${ov.month}`] = ov.note ?? null
    }
    return m
  }, [overrides])

  // Actuals: category name → [12 months of spend]
  const actualMap = useMemo(() => {
    const m = {}
    for (const t of yearTxns) {
      const amt = Number(t.amount) || 0
      if (amt >= 0) continue
      const cat = t.category || 'Uncategorized'
      if (!m[cat]) m[cat] = Array(12).fill(0)
      const d = new Date(t.date)
      if (!isNaN(d.getTime())) m[cat][d.getMonth()] += Math.abs(amt)
    }
    return m
  }, [yearTxns])

  // Scenario delta map: "catId::month" → net delta from committed scenarios
  const scenarioDeltaMap = useMemo(() => {
    const m = {}
    for (const s of committedScenarios) {
      for (const adj of (s.adjustments ?? [])) {
        if (Number(adj.year) !== year) continue
        const key = `${adj.category_id}::${adj.month}`
        m[key] = (m[key] || 0) + Number(adj.delta_amount)
      }
    }
    return m
  }, [committedScenarios, year])

  // Summary stats
  const { annualBudget, annualForecast, annualWithScenarios, overrideCount } = useMemo(() => {
    let ab = 0, af = 0, aws = 0, oc = 0
    for (const r of catRows) {
      for (let m = 0; m < 12; m++) {
        const key = `${r.catId}::${m + 1}`
        const budgetV = r.budget[m] ?? 0
        const forecastV = overrideMap[key] ?? budgetV
        const delta = scenarioDeltaMap[key] ?? 0
        ab += budgetV
        af += forecastV
        aws += forecastV + delta
        if (overrideMap[key] != null) oc++
      }
    }
    return { annualBudget: ab, annualForecast: af, annualWithScenarios: aws, overrideCount: oc }
  }, [catRows, overrideMap, scenarioDeltaMap])

  const yearOptions = useMemo(() => {
    const s = new Set([...years, CUR_YEAR, CUR_YEAR + 1])
    return [...s].sort((a, b) => a - b)
  }, [years])

  const groupNames = useMemo(
    () => [...new Set(catRows.map(r => r.group || '—'))].sort(),
    [catRows]
  )
  const allCollapsed = groupNames.length > 0 && groupNames.every(g => collapsedGroups.has(g))

  function toggleGroup(g) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      next.has(g) ? next.delete(g) : next.add(g)
      return next
    })
  }
  function toggleAllGroups() {
    setCollapsedGroups(allCollapsed ? new Set() : new Set(groupNames))
  }
  function toggleCat(catId) {
    setExpandedCats(prev => {
      const next = new Set(prev)
      next.has(catId) ? next.delete(catId) : next.add(catId)
      return next
    })
  }

  async function handleAddLine(catId, { label, month, amount }) {
    const newItem = await insertBudgetLineItem(userId, { year, categoryId: catId, month, amount, label })
    setBudgetItems(prev => [...prev, newItem])
  }
  async function handleDeleteLine(id) {
    const prev = budgetItems
    setBudgetItems(prev.filter(li => li.id !== id))
    try {
      await deleteLineItem(id)
    } catch (e) {
      setBudgetItems(prev) // revert on failure
      setError(e.message)
    }
  }

  function handleEdit(row, month) {
    const key = `${row.catId}::${month}`
    setEditCell({
      catId: row.catId,
      catName: row.name,
      month,
      budgetValue: row.budget[month - 1] ?? 0,
      currentValue: overrideMap[key] ?? row.budget[month - 1] ?? 0,
      currentNote: overrideNoteMap[key] ?? null,
      key,
    })
  }

  async function handleSave(amount, note) {
    if (!editCell) return
    setSaving(true)
    try {
      await upsertForecastOverride(userId, {
        categoryId: editCell.catId,
        year,
        month: editCell.month,
        amount,
        note,
      })
      setOverrides(prev => {
        const filtered = prev.filter(ov => !(ov.category_id === editCell.catId && ov.month === editCell.month))
        return [...filtered, {
          category_id: editCell.catId,
          budget_year: year,
          month: editCell.month,
          amount,
          note,
          budget_categories: budgetItems.find(li => li.category_id === editCell.catId)?.budget_categories,
        }]
      })
      setEditCell(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    if (!editCell) return
    setSaving(true)
    try {
      await deleteForecastOverride(userId, editCell.catId, year, editCell.month)
      setOverrides(prev => prev.filter(ov => !(ov.category_id === editCell.catId && ov.month === editCell.month)))
      setEditCell(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const variance = annualForecast - annualBudget
  const pctVariance = annualBudget > 0 ? (variance / annualBudget) * 100 : null

  return (
    <div style={{ maxWidth: CONTENT_MAX, width: '100%', margin: '0 auto' }}>
      <ModuleHeader
        mobile={mobile}
        icon="⬡"
        title="Forecast"
        subtitle="Adjust category estimates month-by-month. Expand a bucket, click a category to see its line items, or click any future cell to override. Past months show actuals."
        actions={
          <>
            <select value={year} onChange={e => setYear(Number(e.target.value))} style={{
              padding: '7px 12px', background: 'var(--bg-card)', border: '1px solid var(--bd)',
              borderRadius: 7, color: 'var(--tx-1)', fontSize: 13, outline: 'none', cursor: 'pointer',
            }}>
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </>
        }
      />

      {error && (
        <div style={{ padding: '12px 16px', background: 'var(--warn-bg)', border: '1px solid var(--warn)', borderRadius: 8, color: 'var(--tx-1)', fontSize: 13, marginBottom: 18 }}>
          {error}
        </div>
      )}

      {!loading && budgetItems.length === 0 ? (
        <div style={{ border: '1px dashed var(--bd)', borderRadius: 12, padding: '48px 28px', textAlign: 'center' }}>
          <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 18, color: 'var(--tx-1)', marginBottom: 10 }}>
            No budget for {year}
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--tx-2)', lineHeight: 1.6, maxWidth: 400, margin: '0 auto' }}>
            Build a budget first in the Budget module — the forecast starts from your budget baseline
            and lets you override any category for any month.
          </div>
        </div>
      ) : loading ? (
        <div style={{ color: 'var(--tx-3)', fontSize: 14, padding: 32 }}>Loading forecast…</div>
      ) : (
        <>
          {/* Layer toggle + bucket expand/collapse */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            <div style={{ display: 'flex', gap: 0, border: '1px solid var(--bd)', borderRadius: 8, overflow: 'hidden', width: 'fit-content' }}>
              {[
                { id: 'budget', label: 'Budget' },
                { id: 'forecast', label: '+ Overrides' },
                { id: 'scenarios', label: '+ Scenarios' },
              ].map(({ id, label }, i, arr) => (
                <button
                  key={id}
                  onClick={() => setLayer(id)}
                  style={{
                    padding: '7px 16px',
                    background: layer === id ? 'var(--accent)' : 'transparent',
                    color: layer === id ? '#fff' : 'var(--tx-2)',
                    border: 'none',
                    borderRight: i < arr.length - 1 ? '1px solid var(--bd)' : 'none',
                    fontSize: 12.5, cursor: 'pointer',
                    fontWeight: layer === id ? 600 : 400,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {!mobile && groupNames.length > 0 && (
              <button onClick={toggleAllGroups} style={ghostBtn}>
                {allCollapsed ? '⊕ Expand all' : '⊖ Collapse all'}
              </button>
            )}
          </div>

          {/* Summary strip */}
          <div style={{ display: 'flex', gap: 20, marginBottom: 20, flexWrap: 'wrap' }}>
            <SummaryStat label={`${year} budget`} value={fmtFull(annualBudget)} />
            <SummaryStat label={`${year} forecast`} value={fmtFull(annualForecast)} accent={layer !== 'budget'} />
            {layer === 'scenarios' && committedScenarios.length > 0 && (
              <SummaryStat
                label="with scenarios"
                value={fmtFull(annualWithScenarios)}
                accent
                note={annualWithScenarios !== annualForecast
                  ? `${annualWithScenarios > annualForecast ? '+' : ''}${Math.round(((annualWithScenarios - annualForecast) / annualForecast) * 100)}% vs forecast`
                  : null}
                noteColor={annualWithScenarios > annualForecast ? 'var(--warn)' : 'var(--accent)'}
              />
            )}
            {layer === 'scenarios' && committedScenarios.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--tx-3)', alignSelf: 'center' }}>
                No committed scenarios — promote one in the Scenario Planner to layer it here.
              </div>
            )}
            {layer !== 'scenarios' && overrideCount > 0 && (
              <SummaryStat
                label="overrides"
                value={overrideCount.toString()}
                note={pctVariance != null ? `${variance >= 0 ? '+' : ''}${Math.round(pctVariance)}% vs budget` : null}
                noteColor={variance > 0 ? 'var(--warn)' : 'var(--accent)'}
              />
            )}
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 11, color: 'var(--tx-3)', alignItems: 'center', flexWrap: 'wrap' }}>
            {layer === 'forecast' && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: 'var(--accent-bg)', border: '1px solid var(--accent)', opacity: 0.7 }} />
                Override — click future cell to edit
              </span>
            )}
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, border: '1px solid var(--bd)', background: 'var(--bg-card)' }} />
              {layer === 'budget' ? 'Budget baseline (read-only)' : 'Budget baseline'}
            </span>
            {layer === 'scenarios' && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: 'rgba(168,100,255,0.12)', border: '1px solid rgba(168,100,255,0.4)' }} />
                Scenario delta (◆)
              </span>
            )}
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: 'var(--hover)' }} />
              Actual (past months)
            </span>
          </div>

          {/* Grid with cell editor overlay */}
          <div style={{ position: 'relative' }}>
            <ForecastGrid
              catRows={catRows}
              overrideMap={overrideMap}
              scenarioDeltaMap={scenarioDeltaMap}
              actualMap={actualMap}
              year={year}
              mobile={mobile}
              layer={layer}
              onEdit={handleEdit}
              onReset={() => editCell && handleReset()}
              saving={saving}
              editKey={editCell?.key ?? null}
              collapsedGroups={collapsedGroups}
              onToggleGroup={toggleGroup}
              expandedCats={expandedCats}
              onToggleCat={toggleCat}
              onAddLine={handleAddLine}
              onDeleteLine={handleDeleteLine}
            />
            {editCell && layer === 'forecast' && (
              <div
                style={{ position: 'absolute', inset: 0, zIndex: 40 }}
                onClick={() => setEditCell(null)}
              >
                <div onClick={e => e.stopPropagation()}>
                  <CellEditor
                    value={editCell.currentValue}
                    note={editCell.currentNote}
                    budgetValue={editCell.budgetValue}
                    hasOverride={overrideMap[editCell.key] != null}
                    onSave={handleSave}
                    onReset={handleReset}
                    onCancel={() => setEditCell(null)}
                  />
                </div>
              </div>
            )}
          </div>

          {layer === 'forecast' && overrideCount > 0 && (
            <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--tx-3)' }}>
              {overrideCount} {overrideCount === 1 ? 'cell' : 'cells'} overridden · ● marks overrides · ↺ in editor resets to budget
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SummaryStat({ label, value, accent, note, noteColor }) {
  return (
    <div>
      <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 24, color: accent ? 'var(--accent)' : 'var(--tx-1)', lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: 'var(--tx-3)', letterSpacing: '0.06em', marginTop: 5, textTransform: 'uppercase' }}>
        {label}
      </div>
      {note && <div style={{ fontSize: 11, color: noteColor ?? 'var(--tx-3)', marginTop: 2 }}>{note}</div>}
    </div>
  )
}

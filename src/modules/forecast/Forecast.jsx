import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react'
import { getBudgetLineItems, getBudgetYears } from '../../lib/db/budgetLineItems.js'
import {
  getForecastLineItems,
  insertForecastLineItem,
  updateForecastLineItem,
  deleteForecastLineItem,
  deleteForecastItemsByLabel,
  setForecastRate,
  seedForecastFromBudget,
  resetForecastToBudget,
} from '../../lib/db/forecastLineItems.js'
import { getTransactionsForYear } from '../../lib/db/transactions.js'
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
function lineInput(w) {
  return {
    width: w, background: 'var(--field)', border: '1px solid var(--bd)', borderRadius: 6,
    padding: '5px 9px', color: 'var(--tx-1)', fontSize: 12, outline: 'none',
  }
}

// ── Inline cell editor ───────────────────────────────────────────────────────
// Edits the forecast value for a single category/month. The forecast is its own
// dataset (independent of the budget); the budget figure is shown only as a
// reference. Saving updates that month's single forecast line (or creates one).

function CellEditor({ value, budgetValue, onSave, onCancel }) {
  const [val, setVal] = useState(String(Math.round(value ?? 0)))
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleSave()
    if (e.key === 'Escape') onCancel()
  }
  function handleSave() {
    onSave(parseFloat(val.replace(/[^0-9.]/g, '')) || 0)
  }

  return (
    <div style={{
      position: 'absolute', zIndex: 50, background: 'var(--bg-card)',
      border: '1px solid var(--accent)', borderRadius: 10, padding: 14,
      boxShadow: '0 8px 28px rgba(0,0,0,0.18)', minWidth: 220,
      top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
    }}>
      <div style={{ fontSize: 11, color: 'var(--tx-3)', marginBottom: 8, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        Edit forecast
      </div>
      {budgetValue != null && (
        <div style={{ fontSize: 11.5, color: 'var(--tx-3)', marginBottom: 8 }}>
          Budget (reference): <strong style={{ color: 'var(--tx-2)' }}>{fmtFull(budgetValue)}</strong>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
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
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={handleSave} style={{ ...primaryBtn, flex: 1, padding: '7px 0' }}>Save</button>
        <button onClick={onCancel} style={{ ...ghostBtn, padding: '7px 12px' }}>✕</button>
      </div>
    </div>
  )
}

// Resolve the display value for a single cell based on the active layer.
function getCellDisplayValue(r, m, layer, scenarioDeltaMap, forecastReady) {
  if (layer === 'budget') return r.budget[m] ?? 0
  const base = forecastReady ? (r.forecast[m] ?? 0) : (r.budget[m] ?? 0)
  if (layer === 'forecast') return base
  return base + (scenarioDeltaMap?.[`${r.catId}::${m + 1}`] ?? 0)
}

// ── Single month cell within a label row ────────────────────────────────────

function MonthCell({ item, month, canEdit, cellStyle, bg, onUpdate, onAdd }) {
  const [val, setVal] = useState(item ? String(Math.round(item.amount)) : '')

  useEffect(() => {
    setVal(item ? String(Math.round(item.amount)) : '')
  }, [item?.id, item?.amount])

  function commit() {
    const n = parseFloat(String(val).replace(/[^0-9.]/g, '')) || 0
    if (item) {
      if (n !== item.amount) onUpdate(item.id, n)
    } else if (n > 0) {
      onAdd(month, n)
    }
  }

  const hasValue = item && item.amount > 0
  return (
    <td style={{ ...cellStyle, background: bg, padding: '5px 8px' }}>
      {canEdit ? (
        <input
          value={val}
          onChange={e => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') { commit(); e.currentTarget.blur() } }}
          style={{
            width: 54, textAlign: 'right',
            background: hasValue ? 'var(--field)' : 'transparent',
            border: hasValue ? '1px solid var(--bd)' : '1px solid transparent',
            borderRadius: 5, padding: '3px 5px',
            color: hasValue ? 'var(--tx-1)' : 'var(--tx-4)',
            fontSize: 11.5, outline: 'none', fontVariantNumeric: 'tabular-nums',
          }}
        />
      ) : hasValue ? (
        <span style={{ color: 'var(--tx-2)', fontSize: 11.5 }}>{fmt(item.amount)}</span>
      ) : ''}
    </td>
  )
}

// ── One row per unique label under a category ────────────────────────────────
// Left column: ↳ label  ✕  $ [rate input]
// Month columns: per-cell editable for future months, read-only for past
// Rate input: sets all future months to the same amount in one batch operation

function LabelRow({ catId, label, byMonth, curMonth, editable, cellStyle, colBg, onUpdate, onAddCell, onDeleteLabel, onSetRate }) {
  const futureAmounts = Object.entries(byMonth)
    .filter(([m]) => curMonth < 0 || Number(m) - 1 >= curMonth)
    .map(([, it]) => it.amount)
  const commonRate = futureAmounts.length > 0 && futureAmounts.every(a => a === futureAmounts[0])
    ? String(Math.round(futureAmounts[0]))
    : ''
  const [rateVal, setRateVal] = useState(commonRate)

  useEffect(() => {
    const future = Object.entries(byMonth)
      .filter(([m]) => curMonth < 0 || Number(m) - 1 >= curMonth)
      .map(([, it]) => it.amount)
    setRateVal(
      future.length > 0 && future.every(a => a === future[0]) ? String(Math.round(future[0])) : ''
    )
  }, [JSON.stringify(byMonth), curMonth])  // eslint-disable-line react-hooks/exhaustive-deps

  function commitRate() {
    const n = parseFloat(String(rateVal).replace(/[^0-9.]/g, '')) || 0
    onSetRate(catId, label, n)
  }

  const total = Object.values(byMonth).reduce((s, it) => s + (it.amount || 0), 0)

  return (
    <tr style={{ borderTop: '1px solid var(--bd-light)' }}>
      <td style={{ textAlign: 'left', fontSize: 12, color: 'var(--tx-2)', padding: '6px 14px 6px 54px', position: 'sticky', left: 0, zIndex: 1, background: 'var(--bg-app)', whiteSpace: 'nowrap' }}>
        <span style={{ color: 'var(--tx-4)', marginRight: 6 }}>&#8618;</span>
        {label || 'Untitled line'}
        {editable && (
          <>
            <button
              onClick={() => onDeleteLabel(catId, label)}
              title="Remove all lines for this item"
              style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--tx-4)', cursor: 'pointer', fontSize: 11, padding: 0 }}
            >&#x2715;</button>
            <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--tx-4)' }}>$</span>
            <input
              title="Set monthly rate for all future months"
              value={rateVal}
              onChange={e => setRateVal(e.target.value)}
              onBlur={commitRate}
              onKeyDown={e => { if (e.key === 'Enter') commitRate() }}
              placeholder="rate"
              style={{ marginLeft: 3, width: 52, textAlign: 'right', background: 'var(--field)', border: '1px solid var(--bd)', borderRadius: 5, padding: '2px 5px', color: 'var(--tx-1)', fontSize: 11, outline: 'none', fontVariantNumeric: 'tabular-nums' }}
            />
          </>
        )}
      </td>
      {Array.from({ length: 12 }, (_, m) => {
        const mNum = m + 1
        const item = byMonth[mNum]
        const isPast = curMonth >= 0 ? m < curMonth : false
        return (
          <MonthCell
            key={`${mNum}-${item?.id ?? 'empty'}-${item?.amount ?? 0}`}
            item={item}
            month={mNum}
            canEdit={editable && !isPast}
            cellStyle={cellStyle}
            bg={colBg(m)}
            onUpdate={onUpdate}
            onAdd={(month, amount) => onAddCell(catId, label, month, amount)}
          />
        )
      })}
      <td style={{ ...cellStyle, color: 'var(--tx-2)', borderLeft: '1px solid var(--bd-light)', fontSize: 11.5 }}>{total > 0 ? fmt(total) : '·'}</td>
    </tr>
  )
}

// ── Category drill-down (forecast line items) ────────────────────────────────
// Groups items by label — one LabelRow per unique label. Adding a new line
// creates it for all future months at once (label + rate). Individual month
// cells are still inline-editable for per-month overrides.

function CategoryLineItems({ row, cellStyle, colBg, curMonth, editable, onAddLine, onUpdateLine, onDeleteLabel, onSetRate }) {
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [rate, setRate] = useState('')
  const [busy, setBusy] = useState(false)

  // Group items by label (null label keyed as empty string)
  const labelGroups = useMemo(() => {
    const groups = new Map()
    for (const it of row.items) {
      const key = it.label ?? ''
      if (!groups.has(key)) groups.set(key, {})
      groups.get(key)[it.month] = it
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [row.items])

  async function submit() {
    const n = parseFloat(String(rate).replace(/[^0-9.]/g, '')) || 0
    if (n <= 0) return
    setBusy(true)
    try {
      await onSetRate(row.catId, label.trim() || null, n)
      setLabel(''); setRate(''); setAdding(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {labelGroups.map(([lbl, byMonth]) => (
        <LabelRow
          key={`lbl-${lbl}`}
          catId={row.catId}
          label={lbl || null}
          byMonth={byMonth}
          curMonth={curMonth}
          editable={editable}
          cellStyle={cellStyle}
          colBg={colBg}
          onUpdate={onUpdateLine}
          onAddCell={onAddLine}
          onDeleteLabel={onDeleteLabel}
          onSetRate={onSetRate}
        />
      ))}
      {!labelGroups.length && (
        <tr style={{ borderTop: '1px solid var(--bd-light)' }}>
          <td colSpan={14} style={{ textAlign: 'left', padding: '6px 14px 6px 54px', background: 'var(--bg-app)', fontSize: 11.5, color: 'var(--tx-4)' }}>
            No forecast lines for {row.name} yet.
          </td>
        </tr>
      )}
      {editable && (
        <tr style={{ borderTop: '1px solid var(--bd-light)' }}>
          <td colSpan={14} style={{ textAlign: 'left', padding: '7px 14px 9px 54px', background: 'var(--bg-app)' }}>
            {adding ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <input
                  autoFocus
                  placeholder="Item name (e.g. OpenAI)"
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                  style={lineInput(190)}
                />
                <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>$/mo</span>
                <input
                  placeholder="0"
                  value={rate}
                  onChange={e => setRate(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setAdding(false) }}
                  style={lineInput(80)}
                />
                <button onClick={submit} disabled={busy} style={{ ...primaryBtn, padding: '6px 14px', opacity: busy ? 0.6 : 1 }}>
                  {busy ? 'Adding…' : 'Add'}
                </button>
                <button onClick={() => { setAdding(false); setLabel(''); setRate('') }} style={{ ...ghostBtn, padding: '6px 11px' }}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAdding(true)}
                style={{ background: 'none', border: '1px dashed var(--bd)', borderRadius: 6, color: 'var(--tx-2)', cursor: 'pointer', fontSize: 12, padding: '5px 12px' }}
              >
                + Add line item to {row.name}
              </button>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

// ── Forecast grid ────────────────────────────────────────────────────────────

function ForecastGrid({ catRows, scenarioDeltaMap, actualMap, year, mobile, layer, forecastReady, onEdit, saving, editKey, expandedGroups, onToggleGroup, expandedCats, onToggleCat, onAddLine, onUpdateLine, onDeleteLabel, onSetRate }) {
  const curMonth = year === CUR_YEAR ? CUR_MONTH : -1 // highlight current month
  const canEditForecast = layer === 'forecast' && forecastReady
  const scenarioLayer = layer === 'committed' || layer === 'modeled'

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
      forecastTotals[m] += getCellDisplayValue(r, m, layer, scenarioDeltaMap, forecastReady)
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
              {catRows.filter(r => getCellDisplayValue(r, m, layer, scenarioDeltaMap, forecastReady) > 0).map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '3px 0', color: 'var(--tx-2)' }}>
                  <span>{r.name}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtFull(getCellDisplayValue(r, m, layer, scenarioDeltaMap, forecastReady))}</span>
                </div>
              ))}
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
                gForecast[m] += getCellDisplayValue(r, m, layer, scenarioDeltaMap, forecastReady)
              }
            }
            const gTotal = gForecast.reduce((a, b) => a + b, 0)
            const groupOpen = expandedGroups.has(g)
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
                  const rTotal = Array.from({ length: 12 }, (_, m) => getCellDisplayValue(r, m, layer, scenarioDeltaMap, forecastReady)).reduce((a, b) => a + b, 0)
                  const drillable = layer === 'forecast'
                  const catOpen = drillable && expandedCats.has(r.catId)
                  return (
                    <Fragment key={`${g}-${ri}`}>
                    <tr style={{ borderTop: '1px solid var(--bd-light)' }}>
                      <td
                        onClick={() => drillable && onToggleCat(r.catId)}
                        title={drillable ? 'Show forecast lines' : undefined}
                        style={{ textAlign: 'left', fontSize: 12.5, color: 'var(--tx-1)', padding: '8px 14px 8px 34px', position: 'sticky', left: 0, zIndex: 1, background: 'var(--bg-card)', whiteSpace: 'nowrap', cursor: drillable ? 'pointer' : 'default' }}
                      >
                        <span style={{ display: 'inline-block', width: 12, color: 'var(--tx-4)', transition: 'transform .12s', transform: catOpen ? 'rotate(90deg)' : 'none', opacity: drillable ? 1 : 0 }}>▸</span>
                        {r.name}
                      </td>
                      {Array.from({ length: 12 }, (_, m) => {
                        const displayV = getCellDisplayValue(r, m, layer, scenarioDeltaMap, forecastReady)
                        const isPast = curMonth >= 0 ? m < curMonth : false
                        const key = `${r.catId}::${m + 1}`
                        const isEditing = editKey === key && saving !== true
                        const canEdit = canEditForecast && !isPast
                        const hasDelta = scenarioLayer && (scenarioDeltaMap?.[key] ?? 0) !== 0
                        const bg = hasDelta ? 'rgba(168,100,255,0.08)' : colBg(m)
                        const col = hasDelta ? 'var(--tx-1)' : displayV > 0 ? 'var(--tx-1)' : 'var(--tx-4)'
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
                        editable={canEditForecast}
                        onAddLine={onAddLine}
                        onUpdateLine={onUpdateLine}
                        onDeleteLabel={onDeleteLabel}
                        onSetRate={onSetRate}
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
              {layer === 'budget' ? 'Budget Total' : scenarioLayer ? 'With Scenarios' : 'Forecast Total'}
            </td>
            {forecastTotals.map((v, m) => <td key={m} style={{ ...cellStyle, fontWeight: 700, color: 'var(--accent)', background: colBg(m), borderTop: '2px solid var(--bd)' }}>{fmt(v)}</td>)}
            <td style={{ ...cellStyle, fontWeight: 700, color: 'var(--accent)', borderTop: '2px solid var(--bd)', borderLeft: '1px solid var(--bd-light)' }}>{fmt(forecastTotals.reduce((a, b) => a + b, 0))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ── Scenario multi-select dropdown ───────────────────────────────────────────
// Anchored popover under a layer button. Lets the user pick which scenarios in
// the active tier (committed / modeled) are folded into the forecast.

const miniBtn = {
  padding: '3px 10px', background: 'transparent', color: 'var(--tx-2)',
  border: '1px solid var(--bd)', borderRadius: 6, fontSize: 11, cursor: 'pointer',
}

function ScenarioDropdown({ scenarios, selected, tier, onToggle, onAll, onNone, onClose }) {
  const accentColor = tier === 'modeled' ? 'rgba(168,100,255,1)' : 'var(--accent)'
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
      <div style={{
        position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 61,
        background: 'var(--bg-card)', border: '1px solid var(--bd)', borderRadius: 10,
        boxShadow: '0 10px 30px rgba(0,0,0,0.18)', minWidth: 250, maxHeight: 340,
        overflow: 'auto', padding: 8,
      }}>
        {scenarios.length === 0 ? (
          <div style={{ padding: '12px', fontSize: 12, color: 'var(--tx-3)', lineHeight: 1.5 }}>
            No {tier} scenarios yet. Create one in the Scenario Planner.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 6, padding: '2px 4px 8px', borderBottom: '1px solid var(--bd-light)', marginBottom: 6 }}>
              <button onClick={onAll} style={miniBtn}>All</button>
              <button onClick={onNone} style={miniBtn}>None</button>
            </div>
            {scenarios.map(s => {
              const on = selected.has(s.id)
              return (
                <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 8px', borderRadius: 7, cursor: 'pointer', fontSize: 12.5, color: 'var(--tx-1)' }}>
                  <input type="checkbox" checked={on} onChange={() => onToggle(s.id)} style={{ accentColor, cursor: 'pointer' }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name || 'Untitled scenario'}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--tx-4)', whiteSpace: 'nowrap' }}>{s.adjustments?.length ?? 0} adj</span>
                </label>
              )
            })}
          </>
        )}
      </div>
    </>
  )
}

// ── Main module ──────────────────────────────────────────────────────────────

export default function Forecast({ userId, mobile, onDataChange, reloadSignal }) {
  const [year, setYear] = useState(CUR_YEAR)
  const [years, setYears] = useState([])
  const [budgetItems, setBudgetItems] = useState([])
  const [forecastItems, setForecastItems] = useState([])
  const [forecastReady, setForecastReady] = useState(false) // forecast initialized for this year
  const [yearTxns, setYearTxns] = useState([])
  const [committedScenarios, setCommittedScenarios] = useState([])
  const [modeledScenarios, setModeledScenarios] = useState([])
  const [selectedCommitted, setSelectedCommitted] = useState(() => new Set())
  const [selectedModeled, setSelectedModeled] = useState(() => new Set())
  const [openDropdown, setOpenDropdown] = useState(null) // 'committed' | 'modeled' | null
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false) // initialize / reset in flight
  const [layer, setLayer] = useState('forecast') // 'budget' | 'forecast' | 'committed' | 'modeled'

  // Track which scenario ids we've seen so new scenarios default to selected
  // while preserving the user's existing picks across reloads/year changes.
  const knownCommittedRef = useRef(new Set())
  const knownModeledRef = useRef(new Set())

  // Editing state: { catId, month, budgetValue, currentValue, lineId, key }
  const [editCell, setEditCell] = useState(null)

  const [expandedGroups, setExpandedGroups] = useState(() => new Set())
  const [expandedCats, setExpandedCats] = useState(() => new Set())

  const loadData = useCallback(async (yr) => {
    setLoading(true)
    setError(null)
    try {
      const [items, fItems, txns, budgetYears, allScenarios] = await Promise.all([
        getBudgetLineItems(userId, { year: yr }),
        getForecastLineItems(userId, yr),
        getTransactionsForYear(userId, yr),
        getBudgetYears(userId),
        getScenarios(userId).catch(() => []),
      ])
      setBudgetItems(items)
      setForecastItems(fItems)
      setForecastReady(fItems.length > 0)
      setYearTxns(txns)
      setYears(budgetYears)
      const withAdjs = async list => Promise.all(
        list.map(async s => {
          const adjs = await getAdjustments(userId, s.id).catch(() => [])
          return { ...s, adjustments: adjs }
        })
      )
      const [commWithAdjs, modWithAdjs] = await Promise.all([
        withAdjs(allScenarios.filter(s => s.state === 'committed')),
        withAdjs(allScenarios.filter(s => s.state === 'modeled')),
      ])
      setCommittedScenarios(commWithAdjs)
      setModeledScenarios(modWithAdjs)

      // Default brand-new scenarios to selected; keep prior picks, drop removed.
      const reconcile = (prev, list, knownRef) => {
        const ids = list.map(s => s.id)
        const next = new Set([...prev].filter(id => ids.includes(id)))
        for (const id of ids) if (!knownRef.current.has(id)) next.add(id)
        knownRef.current = new Set(ids)
        return next
      }
      setSelectedCommitted(prev => reconcile(prev, commWithAdjs, knownCommittedRef))
      setSelectedModeled(prev => reconcile(prev, modWithAdjs, knownModeledRef))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { loadData(year) }, [year, loadData, reloadSignal])

  // Build category rows merging budget (baseline/reference) and forecast (live).
  // catId → { catId, name, group, type, budget[12], forecast[12], items[] (forecast lines) }
  const catRows = useMemo(() => {
    const byId = {}
    const ensure = (id, cats) => {
      if (!byId[id]) {
        byId[id] = {
          catId: id,
          name: cats?.category || 'Uncategorized',
          group: cats?.group || '—',
          type: cats?.type || 'Flexible',
          budget: Array(12).fill(0),
          forecast: Array(12).fill(0),
          items: [],
        }
      } else if (cats?.category && byId[id].name === 'Uncategorized') {
        byId[id].name = cats.category
        byId[id].group = cats.group || byId[id].group
      }
    }
    for (const li of budgetItems) {
      if (!li.category_id) continue
      ensure(li.category_id, li.budget_categories)
      const m = (li.month ?? 1) - 1
      if (m >= 0 && m < 12) byId[li.category_id].budget[m] += Number(li.amount) || 0
    }
    for (const fi of forecastItems) {
      if (!fi.category_id) continue
      ensure(fi.category_id, fi.budget_categories)
      const m = (fi.month ?? 1) - 1
      if (m >= 0 && m < 12) byId[fi.category_id].forecast[m] += Number(fi.amount) || 0
      byId[fi.category_id].items.push({ id: fi.id, label: fi.label, month: fi.month ?? 1, amount: Number(fi.amount) || 0 })
    }
    return Object.values(byId).sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name))
  }, [budgetItems, forecastItems])

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

  // Scenarios folded into the forecast for the active tier — only those the
  // user has selected in that tier's dropdown.
  const activeScenarios = useMemo(() => {
    if (layer === 'committed') return committedScenarios.filter(s => selectedCommitted.has(s.id))
    if (layer === 'modeled') return modeledScenarios.filter(s => selectedModeled.has(s.id))
    return []
  }, [layer, committedScenarios, modeledScenarios, selectedCommitted, selectedModeled])

  // Scenario delta map: "catId::month" → net delta from the selected scenarios
  const scenarioDeltaMap = useMemo(() => {
    const m = {}
    for (const s of activeScenarios) {
      for (const adj of (s.adjustments ?? [])) {
        if (Number(adj.year) !== year) continue
        const key = `${adj.category_id}::${adj.month}`
        m[key] = (m[key] || 0) + Number(adj.delta_amount)
      }
    }
    return m
  }, [activeScenarios, year])

  // Summary stats
  const { annualBudget, annualForecast, annualWithScenarios } = useMemo(() => {
    let ab = 0, af = 0, aws = 0
    for (const r of catRows) {
      for (let m = 0; m < 12; m++) {
        const budgetV = r.budget[m] ?? 0
        const forecastV = forecastReady ? (r.forecast[m] ?? 0) : budgetV
        const delta = scenarioDeltaMap[`${r.catId}::${m + 1}`] ?? 0
        ab += budgetV
        af += forecastV
        aws += forecastV + delta
      }
    }
    return { annualBudget: ab, annualForecast: af, annualWithScenarios: aws }
  }, [catRows, scenarioDeltaMap, forecastReady])

  const yearOptions = useMemo(() => {
    const s = new Set([...years, CUR_YEAR, CUR_YEAR + 1])
    return [...s].sort((a, b) => a - b)
  }, [years])

  const groupNames = useMemo(
    () => [...new Set(catRows.map(r => r.group || '—'))].sort(),
    [catRows]
  )
  const allCollapsed = groupNames.length > 0 && groupNames.every(g => !expandedGroups.has(g))

  function toggleGroup(g) {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      next.has(g) ? next.delete(g) : next.add(g)
      return next
    })
  }
  function toggleAllGroups() {
    setExpandedGroups(allCollapsed ? new Set(groupNames) : new Set())
  }
  function toggleCat(catId) {
    setExpandedCats(prev => {
      const next = new Set(prev)
      next.has(catId) ? next.delete(catId) : next.add(catId)
      return next
    })
  }

  const setterFor = tier => tier === 'committed' ? setSelectedCommitted : setSelectedModeled
  const listFor = tier => tier === 'committed' ? committedScenarios : modeledScenarios
  function toggleScenario(tier, id) {
    setterFor(tier)(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function selectAllScenarios(tier) {
    setterFor(tier)(new Set(listFor(tier).map(s => s.id)))
  }
  function selectNoScenarios(tier) {
    setterFor(tier)(new Set())
  }

  // Replace or insert a forecast line in local state by id.
  function upsertForecastLocal(row) {
    setForecastItems(prev => {
      const i = prev.findIndex(x => x.id === row.id)
      if (i >= 0) { const n = [...prev]; n[i] = row; return n }
      return [...prev, row]
    })
  }

  async function handleInitialize() {
    setBusy(true)
    setError(null)
    try {
      const rows = await seedForecastFromBudget(userId, year)
      setForecastItems(rows)
      setForecastReady(true)
      onDataChange?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleResetToBudget() {
    if (!window.confirm(`Reset the ${year} forecast to match your current budget? This replaces all forecast edits for ${year}.`)) return
    setBusy(true)
    setError(null)
    try {
      const rows = await resetForecastToBudget(userId, year)
      setForecastItems(rows)
      setForecastReady(true)
      setEditCell(null)
      onDataChange?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  function handleEdit(row, month) {
    const lines = row.items.filter(it => it.month === month)
    // A cell with multiple discrete lines can't be edited as one value — open the
    // drill-down so each line is edited individually.
    if (lines.length > 1) {
      setExpandedCats(prev => new Set(prev).add(row.catId))
      return
    }
    setEditCell({
      catId: row.catId,
      month,
      budgetValue: row.budget[month - 1] ?? 0,
      currentValue: row.forecast[month - 1] ?? 0,
      lineId: lines[0]?.id ?? null,
      key: `${row.catId}::${month}`,
    })
  }

  async function handleSaveCell(amount) {
    if (!editCell) return
    setSaving(true)
    try {
      let row
      if (editCell.lineId) {
        row = await updateForecastLineItem(editCell.lineId, { amount })
      } else {
        row = await insertForecastLineItem(userId, { year, categoryId: editCell.catId, month: editCell.month, amount })
      }
      upsertForecastLocal(row)
      setEditCell(null)
      onDataChange?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleAddLine(catId, { label, month, amount }) {
    const row = await insertForecastLineItem(userId, { year, categoryId: catId, month, amount, label })
    upsertForecastLocal(row)
    onDataChange?.()
  }

  async function handleUpdateLine(id, amount) {
    const prev = forecastItems
    setForecastItems(prev.map(li => li.id === id ? { ...li, amount } : li))
    try {
      await updateForecastLineItem(id, { amount })
      onDataChange?.()
    } catch (e) {
      setForecastItems(prev)
      setError(e.message)
    }
  }

  async function handleDeleteLine(id) {
    const prev = forecastItems
    setForecastItems(prev.filter(li => li.id !== id))
    try {
      await deleteForecastLineItem(id)
      onDataChange?.()
    } catch (e) {
      setForecastItems(prev)
      setError(e.message)
    }
  }

  async function handleDeleteLabel(catId, label) {
    const prev = forecastItems
    setForecastItems(prev.filter(li => !(li.category_id === catId && li.label === (label || null))))
    try {
      await deleteForecastItemsByLabel(userId, { year, categoryId: catId, label: label || null })
      onDataChange?.()
    } catch (e) {
      setForecastItems(prev)
      setError(e.message)
    }
  }

  async function handleSetRate(catId, label, rate) {
    const fromMonth = (year === CUR_YEAR && CUR_MONTH >= 0) ? CUR_MONTH + 1 : 1
    const normalizedLabel = label || null
    const prev = forecastItems
    // Optimistically remove old future items for this label then add placeholders
    setForecastItems(prev => prev.filter(li =>
      !(li.category_id === catId && li.label === normalizedLabel && li.month >= fromMonth)
    ))
    try {
      const rows = await setForecastRate(userId, { year, categoryId: catId, label: normalizedLabel, rate, fromMonth })
      setForecastItems(prev => [
        ...prev.filter(li => !(li.category_id === catId && li.label === normalizedLabel && li.month >= fromMonth)),
        ...rows,
      ])
      onDataChange?.()
    } catch (e) {
      setForecastItems(prev)
      setError(e.message)
    }
  }

  // Kept for individual month-cell adds within a label row (doesn't go through form).
  async function handleAddCell(catId, label, month, amount) {
    const row = await insertForecastLineItem(userId, { year, categoryId: catId, month, amount, label: label || null })
    upsertForecastLocal(row)
    onDataChange?.()
  }

  const variance = annualForecast - annualBudget
  const pctVariance = annualBudget > 0 ? (variance / annualBudget) * 100 : null
  const needsInit = !forecastReady && budgetItems.length > 0
  const scenarioLayer = layer === 'committed' || layer === 'modeled'

  return (
    <div style={{ maxWidth: CONTENT_MAX, width: '100%', margin: '0 auto' }}>
      <ModuleHeader
        mobile={mobile}
        icon="⬡"
        title="Forecast"
        subtitle="An independent month-by-month forecast, seeded from your budget. Edits here never change the budget. Click a cell to edit, or a category to manage its forecast lines."
        actions={
          <>
            <select value={year} onChange={e => setYear(Number(e.target.value))} style={{
              padding: '7px 12px', background: 'var(--bg-card)', border: '1px solid var(--bd)',
              borderRadius: 7, color: 'var(--tx-1)', fontSize: 13, outline: 'none', cursor: 'pointer',
            }}>
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            {forecastReady && !mobile && (
              <button onClick={handleResetToBudget} disabled={busy} style={{ ...ghostBtn, opacity: busy ? 0.6 : 1 }} title="Replace this year's forecast with a fresh copy of the budget">
                ↺ Reset to budget
              </button>
            )}
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
            Build a budget first in the Budget module — the forecast is seeded from your budget,
            then becomes an independent plan you can adjust without touching the budget.
          </div>
        </div>
      ) : loading ? (
        <div style={{ color: 'var(--tx-3)', fontSize: 14, padding: 32 }}>Loading forecast…</div>
      ) : (
        <>
          {/* Layer toggle + bucket expand/collapse */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            <div style={{ display: 'flex', gap: 0, border: '1px solid var(--bd)', borderRadius: 8, width: 'fit-content' }}>
              {[
                { id: 'budget', label: 'Budget' },
                { id: 'forecast', label: 'Forecast' },
                { id: 'committed', label: 'Committed Scenarios', tier: 'committed' },
                { id: 'modeled', label: 'Modeled', tier: 'modeled' },
              ].map(({ id, label, tier }, i, arr) => {
                const active = layer === id
                const scns = tier ? listFor(tier) : []
                const sel = tier === 'committed' ? selectedCommitted : tier === 'modeled' ? selectedModeled : null
                return (
                  <div key={id} style={{ position: 'relative', display: 'flex' }}>
                    <button
                      onClick={() => {
                        if (tier) {
                          if (active) setOpenDropdown(o => o === id ? null : id)
                          else { setLayer(id); setOpenDropdown(id) }
                        } else {
                          setLayer(id); setOpenDropdown(null)
                        }
                      }}
                      style={{
                        padding: '7px 14px',
                        background: active ? 'var(--accent)' : 'transparent',
                        color: active ? '#fff' : 'var(--tx-2)',
                        border: 'none',
                        borderRight: i < arr.length - 1 ? '1px solid var(--bd)' : 'none',
                        borderTopLeftRadius: i === 0 ? 7 : 0, borderBottomLeftRadius: i === 0 ? 7 : 0,
                        borderTopRightRadius: i === arr.length - 1 ? 7 : 0, borderBottomRightRadius: i === arr.length - 1 ? 7 : 0,
                        fontSize: 12.5, cursor: 'pointer', fontWeight: active ? 600 : 400,
                        display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                      }}
                    >
                      {label}
                      {tier && (
                        <>
                          <span style={{ fontSize: 10, opacity: 0.75, fontVariantNumeric: 'tabular-nums' }}>
                            {sel.size}/{scns.length}
                          </span>
                          <span style={{ fontSize: 9 }}>▾</span>
                        </>
                      )}
                    </button>
                    {tier && openDropdown === id && (
                      <ScenarioDropdown
                        scenarios={scns}
                        selected={sel}
                        tier={tier}
                        onToggle={sid => toggleScenario(tier, sid)}
                        onAll={() => selectAllScenarios(tier)}
                        onNone={() => selectNoScenarios(tier)}
                        onClose={() => setOpenDropdown(null)}
                      />
                    )}
                  </div>
                )
              })}
            </div>
            {!mobile && groupNames.length > 0 && (
              <button onClick={toggleAllGroups} style={ghostBtn}>
                {allCollapsed ? '⊕ Expand all' : '⊖ Collapse all'}
              </button>
            )}
          </div>

          {/* Initialize banner — forecast not yet set up for this year */}
          {needsInit && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', padding: '14px 16px', background: 'var(--accent-bg)', border: '1px solid var(--accent-bd)', borderRadius: 10, marginBottom: 18 }}>
              <div style={{ fontSize: 13, color: 'var(--tx-1)', lineHeight: 1.5 }}>
                <strong>Set up your {year} forecast.</strong> It starts as a copy of your budget, then
                becomes fully independent — editing it never changes the budget.
                {layer !== 'budget' && <span style={{ color: 'var(--tx-3)' }}> Showing budget values until you initialize.</span>}
              </div>
              <button onClick={handleInitialize} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                {busy ? 'Setting up…' : 'Initialize from budget'}
              </button>
            </div>
          )}

          {/* Summary strip */}
          <div style={{ display: 'flex', gap: 20, marginBottom: 20, flexWrap: 'wrap' }}>
            <SummaryStat label={`${year} budget`} value={fmtFull(annualBudget)} />
            <SummaryStat
              label={`${year} forecast`}
              value={fmtFull(annualForecast)}
              accent={layer !== 'budget'}
              note={forecastReady && pctVariance != null && Math.abs(pctVariance) >= 0.5 ? `${variance >= 0 ? '+' : ''}${Math.round(pctVariance)}% vs budget` : null}
              noteColor={variance > 0 ? 'var(--warn)' : 'var(--accent)'}
            />
            {scenarioLayer && activeScenarios.length > 0 && (
              <SummaryStat
                label={`with ${activeScenarios.length} ${layer} scenario${activeScenarios.length > 1 ? 's' : ''}`}
                value={fmtFull(annualWithScenarios)}
                accent
                note={annualWithScenarios !== annualForecast
                  ? `${annualWithScenarios > annualForecast ? '+' : ''}${Math.round(((annualWithScenarios - annualForecast) / annualForecast) * 100)}% vs forecast`
                  : null}
                noteColor={annualWithScenarios > annualForecast ? 'var(--warn)' : 'var(--accent)'}
              />
            )}
            {scenarioLayer && activeScenarios.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--tx-3)', alignSelf: 'center', maxWidth: 320, lineHeight: 1.5 }}>
                {listFor(layer).length === 0
                  ? `No ${layer} scenarios yet — create one in the Scenario Planner to layer it here.`
                  : `No ${layer} scenarios selected — pick one from the ${layer === 'committed' ? 'Committed Scenarios' : 'Modeled'} ▾ dropdown.`}
              </div>
            )}
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 11, color: 'var(--tx-3)', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, border: '1px solid var(--bd)', background: 'var(--bg-card)' }} />
              {layer === 'budget' ? 'Budget (read-only — edit in Budget module)' : layer === 'forecast' ? 'Forecast — click a cell to edit, a category to manage lines' : layer === 'committed' ? 'Forecast + selected committed scenarios' : 'Forecast + selected modeled scenarios'}
            </span>
            {scenarioLayer && (
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
              scenarioDeltaMap={scenarioDeltaMap}
              actualMap={actualMap}
              year={year}
              mobile={mobile}
              layer={layer}
              forecastReady={forecastReady}
              onEdit={handleEdit}
              saving={saving}
              editKey={editCell?.key ?? null}
              expandedGroups={expandedGroups}
              onToggleGroup={toggleGroup}
              expandedCats={expandedCats}
              onToggleCat={toggleCat}
              onAddLine={handleAddCell}
              onUpdateLine={handleUpdateLine}
              onDeleteLabel={handleDeleteLabel}
              onSetRate={handleSetRate}
            />
            {editCell && layer === 'forecast' && forecastReady && (
              <div
                style={{ position: 'absolute', inset: 0, zIndex: 40 }}
                onClick={() => setEditCell(null)}
              >
                <div onClick={e => e.stopPropagation()}>
                  <CellEditor
                    value={editCell.currentValue}
                    budgetValue={editCell.budgetValue}
                    onSave={handleSaveCell}
                    onCancel={() => setEditCell(null)}
                  />
                </div>
              </div>
            )}
          </div>
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

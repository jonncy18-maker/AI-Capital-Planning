import { useEffect, useMemo, useRef, useState } from 'react'
import { parseMoneyInput } from '../../../lib/money.js'
import { getScenarios, getAdjustments } from '../../../lib/db/scenarios.js'
import { scenarioMonthDeltas, validateQuickWhatIf } from '../../../lib/payperiods/whatIfs.js'
import { MonoLabel, WHATIF, fmtDate, inputStyle, money2 } from './WeeksShared.jsx'

const TYPES = [
  { value: 'expense', label: 'Add expense' },
  { value: 'income', label: 'Add income' },
  { value: 'skipBill', label: 'Skip a bill' },
  { value: 'moveBill', label: 'Move a bill' },
  { value: 'moveCard', label: 'Move a card payment' },
]

function describe(it) {
  if (it.type === 'expense') return `Expense ${money2(it.amount)} · ${it.label} · ${fmtDate(it.date)}`
  if (it.type === 'income') return `Income ${money2(it.amount)} · ${it.label} · ${fmtDate(it.date)}`
  if (it.type === 'skipBill') return `Skip ${it.label} · ${fmtDate(it.date)}`
  return `Move ${it.label} from ${fmtDate(it.date)} to ${fmtDate(it.toDate)}`
}

// View-only: everything here is React state handed up to WeeksTab. Nothing is stored.
export default function WeeksScenarioPanel({
  userId, series, budgetCategories, items, onItemsChange, scenarioPick, onScenarioChange,
}) {
  const [scenarios, setScenarios] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const adjustmentCache = useRef(new Map())
  const idRef = useRef(1)

  const [type, setType] = useState('expense')
  const [date, setDate] = useState('')
  const [amountText, setAmountText] = useState('')
  const [label, setLabel] = useState('')
  const [occ, setOcc] = useState('')
  const [toDate, setToDate] = useState('')
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    getScenarios(userId)
      .then(rows => { if (!cancelled) setScenarios((rows ?? []).filter(s => s.state === 'modeled')) })
      .catch(e => { if (!cancelled) setLoadError(e.message || 'Could not load scenarios') })
    return () => { cancelled = true }
  }, [userId])

  const occurrences = useMemo(() => {
    const kind = type === 'moveCard' ? 'card' : 'bill'
    const out = []
    for (const w of series.weeks) {
      for (const e of w.events) {
        if (e.kind !== kind || (kind === 'bill' ? e.billId : e.cardId) == null) continue
        const id = kind === 'bill' ? e.billId : e.cardId
        out.push({ key: `${id}|${e.ym}`, id, ym: e.ym, label: e.label, date: e.date })
      }
    }
    return out
  }, [series, type])

  async function pickScenario(id) {
    setError(null)
    if (!id) { onScenarioChange({ id: '', deltas: {}, skippedIncome: 0, skippedOther: 0 }); return }
    const scenario = scenarios.find(s => s.id === id)
    try {
      if (!adjustmentCache.current.has(id)) {
        adjustmentCache.current.set(id, await getAdjustments(userId, id))
      }
      const r = scenarioMonthDeltas(scenario, adjustmentCache.current.get(id), budgetCategories)
      onScenarioChange({ id, deltas: r.deltas, skippedIncome: r.skippedIncome, skippedOther: r.skippedOther })
    } catch (e) {
      setError(e.message || 'Could not load the scenario')
    }
  }

  function add() {
    setError(null)
    let item
    if (type === 'expense' || type === 'income') {
      const amount = parseMoneyInput(amountText)
      item = { type, id: idRef.current, date, amount: amount == null ? NaN : amount, label }
    } else {
      const o = occurrences.find(x => x.key === occ)
      if (!o) { setError('Pick a payment first.'); return }
      item = type === 'skipBill'
        ? { type, id: idRef.current, billId: o.id, ym: o.ym, label: o.label, date: o.date }
        : type === 'moveBill'
          ? { type, id: idRef.current, billId: o.id, ym: o.ym, toDate, label: o.label, date: o.date }
          : { type, id: idRef.current, cardId: o.id, dueYm: o.ym, toDate, label: o.label, date: o.date }
    }
    const v = validateQuickWhatIf(item, { start: series.start, end: series.end, existing: items })
    if (!v.ok) { setError(v.error); return }
    idRef.current += 1
    onItemsChange([...items, item])
    setAmountText(''); setLabel('')
  }

  const showDate = type === 'expense' || type === 'income'
  const showTo = type === 'moveBill' || type === 'moveCard'

  return (
    <div style={{
      border: `1px solid ${WHATIF}`, borderRadius: 11, background: 'var(--bg-card)', padding: '12px 14px',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <MonoLabel style={{ color: WHATIF }}>WHAT-IF · VIEW ONLY · NOT SAVED · gone on refresh</MonoLabel>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <MonoLabel>SCENARIO OVERLAY</MonoLabel>
        {loadError && <div style={{ color: 'var(--warn)', fontSize: 12 }}>{loadError}</div>}
        <select
          style={{ ...inputStyle, maxWidth: 320 }} value={scenarioPick.id}
          disabled={!scenarios} onChange={e => pickScenario(e.target.value)}
        >
          <option value="">None</option>
          {(scenarios ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {scenarioPick.id && (
          <div style={{ fontSize: 11, color: 'var(--tx-3)' }}>
            Month-level changes spread evenly across the month (approx.)
            {scenarioPick.skippedIncome > 0 && (
              <div>{scenarioPick.skippedIncome} income change{scenarioPick.skippedIncome === 1 ? '' : 's'} not shown; use a quick what-if</div>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <MonoLabel>QUICK WHAT-IFS</MonoLabel>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <select
            style={inputStyle} value={type}
            onChange={e => { setType(e.target.value); setOcc(''); setError(null) }}
          >
            {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          {showDate && (
            <>
              <input
                type="date" style={inputStyle} value={date} min={series.start} max={series.end}
                aria-label="Date" onChange={e => setDate(e.target.value)}
              />
              <input
                type="text" inputMode="decimal" style={{ ...inputStyle, width: 100 }} value={amountText}
                placeholder="Amount" aria-label="Amount" onChange={e => setAmountText(e.target.value)}
              />
              <input
                type="text" style={{ ...inputStyle, width: 150 }} value={label} maxLength={60}
                placeholder="Label" aria-label="Label" onChange={e => setLabel(e.target.value)}
              />
            </>
          )}
          {!showDate && (
            <select
              style={{ ...inputStyle, maxWidth: 240 }} value={occ} aria-label="Payment"
              onChange={e => setOcc(e.target.value)}
            >
              <option value="">Pick a payment…</option>
              {occurrences.map(o => <option key={o.key} value={o.key}>{o.label} · {fmtDate(o.date)}</option>)}
            </select>
          )}
          {showTo && (
            <input
              type="date" style={inputStyle} value={toDate} min={series.start} max={series.end}
              aria-label="Move to date" onChange={e => setToDate(e.target.value)}
            />
          )}
          <button
            type="button" onClick={add}
            style={{ ...inputStyle, cursor: 'pointer', color: WHATIF, borderColor: WHATIF }}
          >Add</button>
        </div>
        {error && <div style={{ color: 'var(--warn)', fontSize: 12 }}>{error}</div>}

        {items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {items.map(it => (
              <div key={it.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ flex: 1, minWidth: 140, fontSize: 12, color: 'var(--tx-2)' }}>{describe(it)}</span>
                <button
                  type="button" style={{ ...inputStyle, cursor: 'pointer', padding: '3px 8px' }}
                  onClick={() => onItemsChange(items.filter(x => x.id !== it.id))}
                >Remove</button>
              </div>
            ))}
            <div>
              <button
                type="button" style={{ ...inputStyle, cursor: 'pointer', padding: '3px 8px' }}
                onClick={() => onItemsChange([])}
              >Clear all</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  getIncomeSources, upsertIncomeSource, deleteIncomeSource,
  getIncomeAmounts, upsertIncomeAmount, deleteIncomeAmount,
  expectedInflowForMonth,
} from '../../lib/db/income.js'
import { loadOutflowSeries, loadInflowSeries, buildMonthSlots } from '../../lib/payperiods/cashSeries.js'

const INFLOW_COLOR = '#10B981'   // green — money in
const OUTFLOW_COLOR = '#8B5CF6'  // violet — money out (matches Trends outflow)
const WARN_COLOR = 'var(--warn)'

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December']

const INCOME_TYPES = [
  { id: 'salary', label: 'Salary' },
  { id: 'bonus',  label: 'Bonus' },
  { id: 'other',  label: 'Other' },
]
const INCOME_TYPE_LABELS = Object.fromEntries(INCOME_TYPES.map(t => [t.id, t.label]))

const fmt = n => n == null ? '—' : '$' + Math.round(Math.abs(Number(n))).toLocaleString()
const fmtSigned = n => {
  const v = Math.round(Number(n) || 0)
  return (v < 0 ? '-$' : '+$') + Math.abs(v).toLocaleString()
}
const ordinalMonth = m => MONTH_NAMES[m - 1]

// ─── Small shared bits ────────────────────────────────────────────────────────

function MonoLabel({ children, style }) {
  return (
    <div style={{
      fontFamily: "'DM Mono', monospace", fontSize: 9.5,
      color: 'var(--tx-3)', letterSpacing: '0.06em', ...style,
    }}>{children}</div>
  )
}

function LegendDot({ color, dashed, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        width: 10, height: 10, borderRadius: 3, background: color,
        border: dashed ? `1px dashed ${color}` : 'none', opacity: dashed ? 0.4 : 1,
        display: 'inline-block', flexShrink: 0,
      }} />
      <span style={{
        fontFamily: "'DM Mono', monospace", fontSize: 9.5,
        letterSpacing: '0.05em', color: 'var(--tx-3)', textTransform: 'uppercase',
      }}>{label}</span>
    </div>
  )
}

function StatCard({ label, value, sub, color, mobile }) {
  return (
    <div style={{
      border: '1px solid var(--bd)', borderRadius: 11,
      padding: mobile ? '12px 14px' : '16px 18px', background: 'var(--bg-card)',
    }}>
      <div style={{
        fontFamily: "'DM Mono', monospace", fontSize: 8.5, color: 'var(--tx-3)',
        letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8,
      }}>{label}</div>
      <div style={{
        fontFamily: "'DM Serif Display', serif", fontSize: mobile ? 20 : 24,
        color: color || 'var(--tx-1)', lineHeight: 1,
      }}>{value}</div>
      {sub && (
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 8, color: 'var(--tx-4)', marginTop: 6 }}>
          {sub}
        </div>
      )}
    </div>
  )
}

// ─── Income source form ────────────────────────────────────────────────────────

const EMPTY_SOURCE = { name: '', income_type: 'salary', cadence: 'monthly', amount: '', month: 1 }

function IncomeForm({ initial, onSave, onCancel, onDelete }) {
  const [form, setForm] = useState(initial
    ? { ...initial, amount: initial.amount ?? '', month: initial.month ?? 1 }
    : EMPTY_SOURCE)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSave() {
    if (!form.name.trim()) return setErr('Name is required.')
    setSaving(true); setErr(null)
    try {
      await onSave({
        ...(initial?.id ? { id: initial.id } : {}),
        name: form.name.trim(),
        income_type: form.income_type,
        cadence: form.cadence,
        amount: form.amount === '' ? null : Number(form.amount),
        month: form.cadence === 'annual' ? Number(form.month) : null,
        active: true,
      })
    } catch (e) { setErr(e.message) } finally { setSaving(false) }
  }

  const inputStyle = {
    width: '100%', boxSizing: 'border-box', background: 'var(--bg-app)',
    border: '1px solid var(--bd)', borderRadius: 7, padding: '9px 11px',
    color: 'var(--tx-1)', fontSize: 13, outline: 'none', fontFamily: 'Inter, sans-serif',
  }
  const labelStyle = {
    fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: 'var(--tx-3)',
    letterSpacing: '0.06em', marginBottom: 5, display: 'block',
  }
  const fieldGap = { marginBottom: 14 }

  return (
    <div style={{
      border: '1px solid var(--accent-bd)', borderRadius: 10,
      padding: '18px 16px', background: 'var(--bg-card)', marginBottom: 12,
    }}>
      <div style={fieldGap}>
        <label style={labelStyle}>SOURCE NAME</label>
        <input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. CrossCountry Salary" />
      </div>

      <div style={fieldGap}>
        <label style={labelStyle}>TYPE</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {INCOME_TYPES.map(t => (
            <button key={t.id} onClick={() => set('income_type', t.id)} style={{
              flex: 1, padding: '8px 0', borderRadius: 7, cursor: 'pointer', fontSize: 12,
              fontFamily: "'DM Mono', monospace", letterSpacing: '0.04em',
              background: form.income_type === t.id ? 'var(--accent)' : 'var(--bg-app)',
              color: form.income_type === t.id ? 'var(--accent-tx-on)' : 'var(--tx-2)',
              border: form.income_type === t.id ? '1px solid var(--accent)' : '1px solid var(--bd)',
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      <div style={fieldGap}>
        <label style={labelStyle}>FREQUENCY</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {[{ id: 'monthly', label: 'Every month' }, { id: 'annual', label: 'Once a year' }].map(c => (
            <button key={c.id} onClick={() => set('cadence', c.id)} style={{
              flex: 1, padding: '8px 0', borderRadius: 7, cursor: 'pointer', fontSize: 12,
              fontFamily: "'DM Mono', monospace", letterSpacing: '0.04em',
              background: form.cadence === c.id ? 'var(--accent)' : 'var(--bg-app)',
              color: form.cadence === c.id ? 'var(--accent-tx-on)' : 'var(--tx-2)',
              border: form.cadence === c.id ? '1px solid var(--accent)' : '1px solid var(--bd)',
            }}>{c.label}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: form.cadence === 'annual' ? '1fr 1fr' : '1fr', gap: 10, ...fieldGap }}>
        <div>
          <label style={labelStyle}>EXPECTED AMOUNT (NET)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: 'var(--tx-3)' }}>$</span>
            <input style={inputStyle} type="number" min="0" value={form.amount}
              onChange={e => set('amount', e.target.value)} placeholder="Leave blank if it varies" />
          </div>
        </div>
        {form.cadence === 'annual' && (
          <div>
            <label style={labelStyle}>PAID IN</label>
            <select style={{ ...inputStyle, cursor: 'pointer' }} value={form.month} onChange={e => set('month', Number(e.target.value))}>
              {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, color: 'var(--tx-3)', lineHeight: 1.5, marginBottom: 14 }}>
        Enter the <strong>net</strong> amount that lands in your account. Leave the amount blank to
        track a variable source — you'll reconcile the actual each month below.
      </div>

      {err && <div style={{ fontSize: 12, color: 'var(--warn)', marginBottom: 12 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={handleSave} disabled={saving} style={{
          flex: 1, padding: '9px 0', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600,
          background: 'var(--accent)', color: 'var(--accent-tx-on)', border: 'none', opacity: saving ? 0.6 : 1,
        }}>{saving ? 'Saving…' : 'Save Income'}</button>
        <button onClick={onCancel} style={{
          padding: '9px 16px', borderRadius: 7, cursor: 'pointer', fontSize: 12,
          background: 'none', color: 'var(--tx-2)', border: '1px solid var(--bd)',
        }}>Cancel</button>
        {initial?.id && (
          <button onClick={() => onDelete(initial.id)} style={{
            padding: '9px 12px', borderRadius: 7, cursor: 'pointer', fontSize: 12,
            background: 'none', color: 'var(--warn)', border: '1px solid var(--warn)',
          }}>Delete</button>
        )}
      </div>
    </div>
  )
}

// ─── Main tab ───────────────────────────────────────────────────────────────

export default function CashFlowTab({
  userId, bills, payDay2, mobile,
  creditCards = [], budgetCategories = [], earnRateMap = {},
  ccCoverage = 80, ccOptimization = 100,
}) {
  const now = new Date()
  const [sources, setSources] = useState([])
  const [outflowData, setOutflowData] = useState(null)
  const [inflowData, setInflowData] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [hover, setHover] = useState(null)
  const [editing, setEditing] = useState(null) // 'new' | source | null

  // Reconciliation month
  const [reconYear, setReconYear] = useState(now.getFullYear())
  const [reconMonth, setReconMonth] = useState(now.getMonth() + 1)
  const [reconActuals, setReconActuals] = useState({}) // sourceId → amount string
  const [reconVersion, setReconVersion] = useState(0)  // bumped on save to refresh inflow

  const billsKey = bills.map(b => `${b.id}:${b.fixed_amount}:${b.forecast_category_id}:${b.forecast_divisor}:${b.pay_day}:${b.credit_card_id}`).join('|')
  const cardsKey = creditCards.map(c => `${c.id}:${c.statement_close_day}:${c.due_days_after_close}:${c.is_default}`).join('|')
  const catsKey = budgetCategories.map(c => `${c.id}:${c.is_active}:${c.cc_category}:${c.cash_only}:${c.pinned_card_id ?? ''}`).join('|')
  const earnKey = JSON.stringify(earnRateMap)
  const sourcesKey = sources.map(s => `${s.id}:${s.name}:${s.amount}:${s.cadence}:${s.month}:${s.income_type}`).join('|')

  // Fixed month window (stable for the session) — used to clamp the reconcile nav.
  const windowSlots = useMemo(() => buildMonthSlots().slots, [])

  // ── Load income sources ─────────────────────────────────────────────────────
  const loadSources = useCallback(async () => {
    if (!userId) return
    const data = await getIncomeSources(userId)
    setSources(data)
  }, [userId])

  useEffect(() => { loadSources().catch(e => setLoadError(e.message)) }, [loadSources])

  // ── Load outflow series (bills) — only when outflow inputs change ────────────
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    loadOutflowSeries({ userId, bills, payDay2, creditCards, budgetCategories, earnRateMap, ccCoverage, ccOptimization })
      .then(d => { if (!cancelled) setOutflowData(d) })
      .catch(e => { if (!cancelled) setLoadError(e.message) })
    return () => { cancelled = true }
  }, [userId, billsKey, payDay2, cardsKey, catsKey, earnKey, ccCoverage, ccOptimization]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load inflow series (income) — refreshes on source edits + reconcile saves ─
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    loadInflowSeries({ userId, sources })
      .then(d => { if (!cancelled) setInflowData(d) })
      .catch(e => { if (!cancelled) setLoadError(e.message) })
    return () => { cancelled = true }
  }, [userId, sourcesKey, reconVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Merge by month (key on year-month so the two series can't misalign) ──────
  const chartData = useMemo(() => {
    if (!outflowData || !inflowData) return null
    const inflowByKey = new Map(inflowData.map(s => [`${s.year}-${s.month}`, s]))
    return outflowData.map(o => {
      const inSlot = inflowByKey.get(`${o.year}-${o.month}`) ?? { inflowTotal: 0, lines: [], inflowIsActual: false }
      const outTotal = o.period1Total + o.period2Total
      return {
        ...o,
        outflow: outTotal,
        inflow: inSlot.inflowTotal,
        inflowLines: inSlot.lines,
        inflowIsActual: inSlot.inflowIsActual,
        net: inSlot.inflowTotal - outTotal,
      }
    })
  }, [outflowData, inflowData])

  // ── Load reconciliation actuals for the selected month ──────────────────────
  const loadReconActuals = useCallback(async () => {
    if (!userId) return
    const rows = await getIncomeAmounts(userId, reconYear, reconMonth)
    const map = {}
    for (const r of rows) map[r.income_source_id] = String(r.amount)
    setReconActuals(map)
  }, [userId, reconYear, reconMonth])

  useEffect(() => { loadReconActuals().catch(() => {}) }, [loadReconActuals, sourcesKey])

  // ── Handlers ────────────────────────────────────────────────────────────────
  async function handleSaveSource(data) {
    await upsertIncomeSource(userId, data)
    setEditing(null)
    await loadSources()
  }
  async function handleDeleteSource(id) {
    await deleteIncomeSource(id)
    setEditing(null)
    await loadSources()
  }
  function handleReconChange(sourceId, value) {
    setReconActuals(prev => ({ ...prev, [sourceId]: value }))
  }
  async function handleReconBlur(sourceId, value) {
    try {
      if (value === '' || value == null) {
        await deleteIncomeAmount(sourceId, reconYear, reconMonth)
      } else {
        await upsertIncomeAmount(userId, sourceId, reconYear, reconMonth, Number(value))
      }
      await loadReconActuals()
      setReconVersion(v => v + 1) // refresh the chart with the new actual
    } catch (e) { console.error('Failed to save income actual:', e) }
  }
  function stepRecon(delta) {
    let m = reconMonth + delta, y = reconYear
    if (m < 1) { m = 12; y -= 1 } else if (m > 12) { m = 1; y += 1 }
    // Clamp to the chart window so the reconciled month always has a slot (net summary)
    const first = windowSlots[0], last = windowSlots[windowSlots.length - 1]
    const ord = (yy, mm) => yy * 12 + mm
    if (ord(y, m) < ord(first.year, first.month)) { y = first.year; m = first.month }
    else if (ord(y, m) > ord(last.year, last.month)) { y = last.year; m = last.month }
    setReconMonth(m); setReconYear(y)
  }

  // ── Loading / error ─────────────────────────────────────────────────────────
  if (!chartData) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
      </div>
    )
  }
  if (loadError) {
    return <div style={{ padding: 20, background: 'var(--warn-bg)', borderRadius: 10, color: 'var(--warn)', fontSize: 13 }}>{loadError}</div>
  }

  const data = chartData ?? []
  const max = Math.max(1, ...data.map(s => Math.max(s.inflow, s.outflow)))
  const chartH = mobile ? 150 : 200

  // Summary stats over the whole window
  const months = data.length
  const totalIn = data.reduce((s, m) => s + m.inflow, 0)
  const totalOut = data.reduce((s, m) => s + m.outflow, 0)
  const avgIn = months ? totalIn / months : 0
  const avgOut = months ? totalOut / months : 0
  const avgNet = avgIn - avgOut

  const hasSources = sources.length > 0
  const reconSeries = data.find(s => s.year === reconYear && s.month === reconMonth)

  return (
    <div>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <LegendDot color={INFLOW_COLOR} label="Inflow" />
        <LegendDot color={OUTFLOW_COLOR} label="Outflow" />
        <LegendDot color={INFLOW_COLOR} dashed label="Forecast" />
      </div>

      {!hasSources && (
        <div style={{
          padding: '12px 14px', marginBottom: 18, borderRadius: 9,
          border: '1px solid var(--accent-bd)', background: 'var(--accent-bg)',
          fontSize: 12.5, color: 'var(--accent)', lineHeight: 1.5,
        }}>
          Add your income below (e.g. <strong>CrossCountry Salary</strong> and a <strong>Bonus</strong>) to see inflow
          plotted against your bills across the year.
        </div>
      )}

      {/* Chart */}
      <div style={{ position: 'relative' }}>
        {/* Tooltip */}
        {hover != null && data[hover] && (() => {
          const s = data[hover]
          // Show any line that carries a value — including an explicit $0 actual override.
          const lines = (s.inflowLines ?? []).filter(l => l.resolved > 0 || l.actual != null)
          return (
            <div style={{
              position: 'absolute', top: -6, left: '50%', transform: 'translateX(-50%)',
              zIndex: 5, background: 'var(--bg-app)', border: '1px solid var(--bd)',
              borderRadius: 9, padding: '10px 13px', minWidth: mobile ? 200 : 280, maxWidth: 340,
              boxShadow: '0 8px 24px rgba(0,0,0,0.35)', pointerEvents: 'none',
            }}>
              <div style={{
                fontFamily: "'DM Mono', monospace", fontSize: 9.5, letterSpacing: '0.08em',
                color: 'var(--tx-3)', textTransform: 'uppercase', marginBottom: 8,
              }}>{s.label} {s.year} · {s.isFuture ? 'FORECAST' : (s.inflowIsActual ? 'ACTUAL' : 'EXPECTED')}</div>

              {/* Inflow lines */}
              {lines.length > 0 ? lines.map(l => (
                <div key={l.source.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 11.5, padding: '1.5px 0', color: 'var(--tx-2)' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{l.source.name}</span>
                  <span style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{fmt(l.resolved)}</span>
                </div>
              )) : (
                <div style={{ fontSize: 11, color: 'var(--tx-4)', padding: '1px 0' }}>No income</div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--bd-light)' }}>
                <span style={{ color: 'var(--tx-3)' }}>INFLOW</span>
                <span style={{ color: INFLOW_COLOR, fontVariantNumeric: 'tabular-nums' }}>{fmt(s.inflow)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, padding: '2px 0' }}>
                <span style={{ color: 'var(--tx-3)' }}>OUTFLOW</span>
                <span style={{ color: OUTFLOW_COLOR, fontVariantNumeric: 'tabular-nums' }}>{fmt(s.outflow)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 700, marginTop: 4, paddingTop: 6, borderTop: '1px solid var(--bd)' }}>
                <span style={{ color: 'var(--tx-2)' }}>NET</span>
                <span style={{ color: s.net >= 0 ? INFLOW_COLOR : WARN_COLOR, fontVariantNumeric: 'tabular-nums' }}>{fmtSigned(s.net)}</span>
              </div>
            </div>
          )
        })()}

        {/* Bars */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: mobile ? 4 : 8, height: chartH }}>
          {data.map((s, i) => {
            const inH = (s.inflow / max) * chartH
            const outH = (s.outflow / max) * chartH
            const isHover = hover === i
            return (
              <div key={`${s.year}-${s.month}`}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                style={{
                  flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                  gap: mobile ? 2 : 3, height: '100%', position: 'relative', cursor: 'default',
                  background: isHover ? 'var(--hover)' : 'transparent', borderRadius: 5,
                }}>
                <div style={{
                  width: mobile ? 8 : '46%', maxWidth: 26,
                  height: s.inflow > 0 ? Math.max(inH, 2) : 0, background: INFLOW_COLOR,
                  border: s.isFuture ? `1px dashed ${INFLOW_COLOR}` : 'none', borderRadius: '3px 3px 0 0',
                  opacity: s.isFuture ? 0.4 : (isHover ? 1 : 0.9), transition: 'opacity .15s',
                }} />
                <div style={{
                  width: mobile ? 8 : '46%', maxWidth: 26,
                  height: s.outflow > 0 ? Math.max(outH, 2) : 0, background: OUTFLOW_COLOR,
                  border: s.isFuture ? `1px dashed ${OUTFLOW_COLOR}` : 'none', borderRadius: '3px 3px 0 0',
                  opacity: s.isFuture ? 0.4 : (isHover ? 1 : 0.92), transition: 'opacity .15s',
                }} />
                {s.isCurrent && (
                  <div style={{ position: 'absolute', left: -3, top: -14, bottom: 0, borderLeft: '1px dashed var(--forecast-bd)' }}>
                    <span style={{ position: 'absolute', top: -2, left: 4, whiteSpace: 'nowrap', fontFamily: "'DM Mono', monospace", fontSize: 8.5, letterSpacing: '0.08em', color: 'var(--tx-3)' }}>TODAY</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Month labels */}
        <div style={{ display: 'flex', gap: mobile ? 4 : 8, marginTop: 8 }}>
          {data.map(s => (
            <div key={`${s.year}-${s.month}`} style={{
              flex: 1, textAlign: 'center', fontFamily: "'DM Mono', monospace",
              fontSize: mobile ? 8.5 : 10, color: s.isCurrent ? 'var(--accent)' : 'var(--tx-3)', letterSpacing: '0.02em',
            }}>{mobile ? s.label[0] : s.label}</div>
          ))}
        </div>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr 1fr', gap: 12, marginTop: 24 }}>
        <StatCard label="Avg Inflow / mo" value={fmt(avgIn)} sub={`across ${months} months`} color={INFLOW_COLOR} mobile={mobile} />
        <StatCard label="Avg Outflow / mo" value={fmt(avgOut)} sub={`across ${months} months`} color={OUTFLOW_COLOR} mobile={mobile} />
        <StatCard label="Avg Net / mo" value={fmtSigned(avgNet)} sub={avgNet >= 0 ? 'surplus' : 'shortfall'} color={avgNet >= 0 ? INFLOW_COLOR : WARN_COLOR} mobile={mobile} />
      </div>

      {/* ── Income sources ── */}
      <div style={{ marginTop: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--tx-1)' }}>Income</div>
            <MonoLabel style={{ marginTop: 2 }}>{sources.length} SOURCE{sources.length !== 1 ? 'S' : ''}</MonoLabel>
          </div>
          {editing !== 'new' && (
            <button onClick={() => setEditing('new')} style={{
              background: 'var(--accent)', color: 'var(--accent-tx-on)', border: 'none',
              borderRadius: 7, padding: '7px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}>+ Add Income</button>
          )}
        </div>

        {editing === 'new' && (
          <IncomeForm onSave={handleSaveSource} onCancel={() => setEditing(null)} onDelete={handleDeleteSource} />
        )}

        {sources.length === 0 && editing !== 'new' ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--tx-3)', fontSize: 13 }}>
            No income sources yet.
          </div>
        ) : (
          <div style={{ border: '1px solid var(--bd)', borderRadius: 10, overflow: 'hidden' }}>
            {sources.map((s, i) => {
              const isEditing = editing?.id === s.id
              if (isEditing) {
                return (
                  <div key={s.id} style={{ padding: 12, borderTop: i > 0 ? '1px solid var(--bd-light)' : 'none' }}>
                    <IncomeForm initial={s} onSave={handleSaveSource} onCancel={() => setEditing(null)} onDelete={handleDeleteSource} />
                  </div>
                )
              }
              const summary = s.amount == null
                ? 'Variable'
                : s.cadence === 'annual'
                  ? `${fmt(s.amount)} in ${ordinalMonth(s.month ?? 1)}`
                  : `${fmt(s.amount)} / month`
              return (
                <div key={s.id} onClick={() => setEditing(s)} style={{
                  display: 'flex', alignItems: 'stretch', cursor: 'pointer', background: 'var(--bg-card)',
                  borderTop: i > 0 ? '1px solid var(--bd-light)' : 'none', transition: 'background 0.12s',
                }}
                  onMouseEnter={e => e.currentTarget.style.background = `${INFLOW_COLOR}08`}
                  onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-card)'}>
                  <div style={{ width: 3, flexShrink: 0, background: INFLOW_COLOR }} />
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', minWidth: 0 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, color: 'var(--tx-1)', fontWeight: 600, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                      <MonoLabel style={{ fontSize: 9 }}>{(INCOME_TYPE_LABELS[s.income_type] || s.income_type).toUpperCase()}</MonoLabel>
                    </div>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: 'var(--tx-2)', flexShrink: 0, textAlign: 'right' }}>{summary}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Reconcile actuals ── */}
      {hasSources && (
        <div style={{ marginTop: 24, border: '1px solid var(--bd)', borderRadius: 12, background: 'var(--bg-card)', overflow: 'hidden' }}>
          <div style={{
            padding: '14px 18px 12px', borderBottom: '1px solid var(--bd)', background: 'var(--bg-app)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
          }}>
            <div>
              <MonoLabel>RECONCILE ACTUALS</MonoLabel>
              <div style={{ marginTop: 4, fontSize: 13, color: 'var(--tx-2)' }}>Record what actually landed</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => stepRecon(-1)} style={{ background: 'none', border: '1px solid var(--bd)', borderRadius: 7, padding: '4px 10px', cursor: 'pointer', color: 'var(--tx-2)', fontSize: 13 }}>‹</button>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: 'var(--tx-1)', minWidth: 110, textAlign: 'center', letterSpacing: '0.04em' }}>{MONTH_NAMES[reconMonth - 1].slice(0, 3).toUpperCase()} {reconYear}</div>
              <button onClick={() => stepRecon(1)} style={{ background: 'none', border: '1px solid var(--bd)', borderRadius: 7, padding: '4px 10px', cursor: 'pointer', color: 'var(--tx-2)', fontSize: 13 }}>›</button>
            </div>
          </div>

          <div style={{ padding: '6px 18px' }}>
            {sources.map((s, i) => {
              const expected = expectedInflowForMonth(s, reconMonth)
              const showExpected = expected != null && (s.cadence !== 'annual' || s.month === reconMonth)
              return (
                <div key={s.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0',
                  borderTop: i > 0 ? '0.5px solid var(--bd-light)' : 'none',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'var(--tx-1)', fontWeight: 500 }}>{s.name}</div>
                    <MonoLabel style={{ fontSize: 9, marginTop: 2 }}>
                      {showExpected ? `EXPECTED ${fmt(expected)}` : 'NO EXPECTED THIS MONTH'}
                    </MonoLabel>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: 'var(--tx-3)' }}>$</span>
                    <input type="number" min="0" value={reconActuals[s.id] ?? ''} placeholder={showExpected ? String(Math.round(expected)) : '0'}
                      onChange={e => handleReconChange(s.id, e.target.value)}
                      onBlur={e => handleReconBlur(s.id, e.target.value)}
                      style={{
                        width: 100, background: 'var(--bg-app)', border: '1px solid var(--bd)', borderRadius: 6, padding: '5px 8px',
                        fontFamily: "'DM Mono', monospace", fontSize: 12, color: 'var(--tx-1)', outline: 'none', textAlign: 'right',
                      }} />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Month net summary */}
          {reconSeries && (
            <div style={{ padding: '12px 18px', borderTop: '1px solid var(--bd)', background: 'var(--bg-app)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 16 }}>
                <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>In <strong style={{ color: INFLOW_COLOR }}>{fmt(reconSeries.inflow)}</strong></span>
                <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>Out <strong style={{ color: OUTFLOW_COLOR }}>{fmt(reconSeries.outflow)}</strong></span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <MonoLabel>NET</MonoLabel>
                <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: 16, color: reconSeries.net >= 0 ? INFLOW_COLOR : WARN_COLOR }}>{fmtSigned(reconSeries.net)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

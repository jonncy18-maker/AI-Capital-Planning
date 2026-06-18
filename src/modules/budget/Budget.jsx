import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react'
import { getTransactionsForAnalysis } from '../../lib/db/transactions.js'
import { getBudgetCategories, importCategoryMappings } from '../../lib/db/budgetCategories.js'
import { getCommitments } from '../../lib/db/commitments.js'
import { parseBudgetFile } from '../../lib/csv/budgetParser.js'
import { suggestTabMatches } from '../../lib/ai/suggestTabMatches.js'
import {
  getBudgetLineItems,
  getBudgetYears,
  saveBudgetForYear,
} from '../../lib/db/budgetLineItems.js'
import { analyzeTransactions, MONTHS } from '../../lib/budget/patternAnalyzer.js'
import { commitmentYearSchedule } from '../../lib/commitments/schedule.js'

const CUR_YEAR = new Date().getFullYear()

function fmt(n) {
  const abs = Math.abs(Math.round(n))
  if (abs >= 1000) return '$' + (abs / 1000).toFixed(abs >= 10000 ? 0 : 1) + 'k'
  return '$' + abs.toLocaleString()
}
function fmtFull(n) {
  return '$' + Math.round(n || 0).toLocaleString()
}

const TYPE_COLOR = {
  Fixed: 'var(--accent)',
  Flexible: 'var(--warn)',
  'Non-Monthly': '#8B5CF6',
}

// ── Generate flow ────────────────────────────────────────────────────────────
// Mounted fresh each time the user generates (parent keys it by analysis), so
// the editable model is initialized once from the analysis with no sync effect.

function GeneratePanel({ analysis, commitments, year, onSave, onCancel, saving }) {
  // Build a per-category editable model from the analysis.
  const initialModel = useMemo(() => {
    const m = {}
    for (const cat of analysis.categories) {
      if (!cat.category_id) continue
      if (cat.annualTotal < 1) continue
      m[cat.category_id] = {
        category: cat.category,
        category_id: cat.category_id,
        group: cat.group,
        type: cat.type,
        include: true,
        monthly: Math.round(cat.monthlyAvg),
        annual: Math.round(cat.annualTotal),
        histogram: cat.monthHistogram,
      }
    }
    return m
  }, [analysis])

  const [model, setModel] = useState(initialModel)

  function toggleInclude(id) {
    setModel(prev => ({ ...prev, [id]: { ...prev[id], include: !prev[id].include } }))
  }
  function setMonthly(id, val) {
    const n = parseFloat(val.replace(/[^0-9.]/g, '')) || 0
    setModel(prev => ({ ...prev, [id]: { ...prev[id], monthly: n, annual: Math.round(n * 12) } }))
  }

  const rows = Object.values(model)
  const includedRows = rows.filter(r => r.include)
  const plannedTotal = includedRows.reduce((s, r) => s + r.annual, 0)

  // Commitments contribute Non-Monthly demand for the year
  const commitmentAnnual = commitments.reduce(
    (s, c) => s + commitmentYearSchedule(c, year).reduce((a, b) => a + b, 0),
    0
  )

  function handleSave() {
    const items = []
    for (const r of includedRows) {
      if (r.type === 'Non-Monthly') {
        const histTotal = r.histogram.reduce((a, b) => a + b, 0)
        for (let m = 0; m < 12; m++) {
          const share = histTotal > 0 ? r.histogram[m] / histTotal : 0
          const amount = Math.round(r.annual * share)
          if (amount > 0) {
            items.push({ category_id: r.category_id, month: m + 1, amount, label: `${r.category} — ${MONTHS[m]}` })
          }
        }
      } else {
        if (r.monthly <= 0) continue
        for (let m = 0; m < 12; m++) {
          items.push({ category_id: r.category_id, month: m + 1, amount: r.monthly, label: null })
        }
      }
    }
    onSave(items)
  }

  const grouped = {}
  for (const r of rows) {
    const t = r.type
    if (!grouped[t]) grouped[t] = []
    grouped[t].push(r)
  }
  const typeOrder = ['Fixed', 'Flexible', 'Non-Monthly']

  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 16, flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--tx-1)', marginBottom: 4 }}>
            Draft budget for {year}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--tx-2)' }}>
            {analysis.sourceLabel || `Built from ${analysis.spanMonths} months of history`} · {includedRows.length} categories ·
            planned <strong style={{ color: 'var(--tx-1)' }}>{fmtFull(plannedTotal)}</strong>
            {commitmentAnnual > 0 && <> · +{fmtFull(commitmentAnnual)} in commitments</>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} style={ghostBtn}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !includedRows.length} style={{
            ...primaryBtn,
            opacity: saving || !includedRows.length ? 0.6 : 1,
            cursor: saving || !includedRows.length ? 'not-allowed' : 'pointer',
          }}>
            {saving ? 'Saving…' : `Save ${year} Budget`}
          </button>
        </div>
      </div>

      {typeOrder.filter(t => grouped[t]?.length).map(type => (
        <div key={type} style={{ marginBottom: 18 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
            fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
            color: 'var(--tx-3)',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 2, background: TYPE_COLOR[type] }} />
            {type}
            <span style={{ color: 'var(--tx-4)' }}>
              ({grouped[type].length})
            </span>
          </div>
          <div style={{ border: '1px solid var(--bd)', borderRadius: 10, overflow: 'hidden' }}>
            {grouped[type].map((r, i) => (
              <div key={r.category_id} style={{
                display: 'grid',
                gridTemplateColumns: '24px 1fr 120px 100px',
                alignItems: 'center',
                gap: 12,
                padding: '10px 14px',
                borderTop: i ? '1px solid var(--bd-light)' : 'none',
                opacity: r.include ? 1 : 0.45,
                background: 'var(--bg-card)',
              }}>
                <input
                  type="checkbox"
                  checked={r.include}
                  onChange={() => toggleInclude(r.category_id)}
                  style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--tx-1)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.category}
                  </div>
                  {r.group && <div style={{ fontSize: 11, color: 'var(--tx-3)' }}>{r.group}</div>}
                </div>
                {r.type === 'Non-Monthly' ? (
                  <div style={{ fontSize: 12, color: 'var(--tx-2)', textAlign: 'right' }}>
                    {r.histogram.filter(h => h > 0).length} mo/yr
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>$</span>
                    <input
                      value={r.monthly}
                      onChange={e => setMonthly(r.category_id, e.target.value)}
                      style={{
                        width: 70, textAlign: 'right', background: 'var(--field)',
                        border: '1px solid var(--bd)', borderRadius: 6, padding: '5px 8px',
                        color: 'var(--tx-1)', fontSize: 12.5, outline: 'none',
                      }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>/mo</span>
                  </div>
                )}
                <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: 'var(--tx-1)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtFull(r.annual)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Detail-tab match review (budget upload) ──────────────────────────────────
// After parsing an uploaded workbook, let the user confirm which detail tab
// feeds each Non-Monthly category's month-by-month amounts — auto-matched by
// name (exact or fuzzy), adjustable manually, or filled in by the AI.

function TabMatchReview({ pending, mobile, onConfirm, onCancel }) {
  const { rows, detailTabs } = pending
  const nonMonthly = useMemo(() => rows.filter(r => r.type === 'Non-Monthly'), [rows])
  const tabNames = useMemo(() => detailTabs.map(t => t.name), [detailTabs])
  const monthsByTab = useMemo(() => {
    const m = new Map()
    for (const t of detailTabs) m.set(t.name, t.months)
    return m
  }, [detailTabs])

  const [sel, setSel] = useState(() => {
    const init = {}
    for (const r of nonMonthly) init[r.category] = r.matchedTab || ''
    return init
  })
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState(null)

  async function runAI() {
    setAiBusy(true)
    setAiError(null)
    try {
      const res = await suggestTabMatches(nonMonthly.map(r => r.category), tabNames)
      if (res.error) { setAiError(res.error); return }
      setSel(prev => {
        const next = { ...prev }
        for (const m of res.matches || []) {
          if (m && m.tab && tabNames.includes(m.tab)) next[m.category] = m.tab
        }
        return next
      })
    } catch (e) {
      setAiError(e.message)
    } finally {
      setAiBusy(false)
    }
  }

  function confirm() {
    const map = new Map()
    for (const r of nonMonthly) {
      const t = sel[r.category]
      map.set(r.category, t ? (monthsByTab.get(t) || null) : null)
    }
    onConfirm(map)
  }

  function activeMonthsLabel(tab) {
    const months = monthsByTab.get(tab)
    if (!months) return null
    const active = months.map((v, i) => (v > 0 ? MONTHS[i] : null)).filter(Boolean)
    if (!active.length) return null
    return `${active.length} mo · ${active.slice(0, 4).join(', ')}${active.length > 4 ? '…' : ''}`
  }

  const matchedCount = nonMonthly.filter(r => sel[r.category]).length
  const selectStyle = {
    background: 'var(--field)', border: '1px solid var(--bd)', borderRadius: 6,
    padding: '6px 8px', color: 'var(--tx-1)', fontSize: 12.5, outline: 'none', cursor: 'pointer', width: '100%',
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--tx-1)', marginBottom: 4 }}>
            Match Non-Monthly categories to their detail tabs
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--tx-2)', maxWidth: 560 }}>
            {nonMonthly.length} Non-Monthly {nonMonthly.length === 1 ? 'category' : 'categories'} · {detailTabs.length} detail tabs ·{' '}
            <strong style={{ color: 'var(--tx-1)' }}>{matchedCount} matched</strong>. Confirm or adjust —
            anything left on “Even spread” distributes its yearly total evenly.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={runAI} disabled={aiBusy} style={{ ...ghostBtn, opacity: aiBusy ? 0.6 : 1 }}>
            {aiBusy ? 'Matching…' : '✦ AI suggest matches'}
          </button>
          <button onClick={onCancel} style={ghostBtn}>Cancel</button>
          <button onClick={confirm} style={primaryBtn}>Continue →</button>
        </div>
      </div>

      {aiError && (
        <div style={{ padding: '10px 14px', background: 'var(--warn-bg)', border: '1px solid var(--warn)', borderRadius: 8, color: 'var(--tx-1)', fontSize: 12.5, marginBottom: 14 }}>
          {aiError}
        </div>
      )}

      <div style={{ border: '1px solid var(--bd)', borderRadius: 10, overflow: 'hidden' }}>
        {nonMonthly.map((r, i) => {
          const conf = sel[r.category] === r.matchedTab ? r.matchConfidence : (sel[r.category] ? 'manual' : null)
          const label = sel[r.category] ? activeMonthsLabel(sel[r.category]) : 'Even spread'
          return (
            <div key={r.category} style={{
              display: 'grid',
              gridTemplateColumns: mobile ? '1fr' : '1fr 220px 160px',
              gap: mobile ? 6 : 12,
              alignItems: 'center',
              padding: '10px 14px',
              borderTop: i ? '1px solid var(--bd-light)' : 'none',
              background: 'var(--bg-card)',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--tx-1)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.category}
                </div>
                <div style={{ fontSize: 11, color: 'var(--tx-3)' }}>
                  {r.group}{r.annual != null ? ` · ${fmtFull(r.annual)}/yr` : ''}
                </div>
              </div>
              <select value={sel[r.category]} onChange={e => setSel(prev => ({ ...prev, [r.category]: e.target.value }))} style={selectStyle}>
                <option value="">Even spread (no tab)</option>
                {tabNames.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <div style={{
                fontSize: 11, fontFamily: "'DM Mono', monospace", textAlign: mobile ? 'left' : 'right',
                color: conf === 'exact' ? 'var(--accent)' : conf === 'fuzzy' ? 'var(--warn)' : 'var(--tx-3)',
              }}>
                {conf === 'exact' && '✓ auto · '}
                {conf === 'fuzzy' && '≈ fuzzy · '}
                {conf === 'manual' && '✎ manual · '}
                {label}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Schedule grid (annual drill-down) ────────────────────────────────────────

function ScheduleGrid({ lineItems, commitments, year, mobile }) {
  // Aggregate line items: category → [12 months]
  const byCategory = {}
  for (const li of lineItems) {
    const name = li.budget_categories?.category || 'Uncategorized'
    const group = li.budget_categories?.group || '—'
    const type = li.budget_categories?.type || 'Flexible'
    const key = li.category_id || name
    if (!byCategory[key]) {
      byCategory[key] = { name, group, type, months: Array(12).fill(0) }
    }
    const m = (li.month ?? 1) - 1
    byCategory[key].months[m] += Number(li.amount) || 0
  }

  // Commitments as synthetic rows
  for (const c of commitments) {
    const sched = commitmentYearSchedule(c, year)
    if (sched.some(v => v > 0)) {
      byCategory[`commitment_${c.id}`] = {
        name: c.name, group: 'Commitments', type: 'Non-Monthly', months: sched, isCommitment: true,
      }
    }
  }

  const rows = Object.values(byCategory)
  // group → rows
  const grouped = {}
  for (const r of rows) {
    if (!grouped[r.group]) grouped[r.group] = []
    grouped[r.group].push(r)
  }
  const groupNames = Object.keys(grouped).sort()

  const monthTotals = Array(12).fill(0)
  for (const r of rows) for (let m = 0; m < 12; m++) monthTotals[m] += r.months[m]
  const grandTotal = monthTotals.reduce((a, b) => a + b, 0)

  if (mobile) {
    // Mobile: per-month cards
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {MONTHS.map((mLabel, m) => (
          <div key={m} style={{ border: '1px solid var(--bd)', borderRadius: 10, padding: 14, background: 'var(--bg-card)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontWeight: 600, color: 'var(--tx-1)' }}>{mLabel} {year}</span>
              <span style={{ fontWeight: 600, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{fmtFull(monthTotals[m])}</span>
            </div>
            {rows.filter(r => r.months[m] > 0).sort((a, b) => b.months[m] - a.months[m]).map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '3px 0', color: 'var(--tx-2)' }}>
                <span>{r.name}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtFull(r.months[m])}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  }

  const cellStyle = { textAlign: 'right', fontSize: 11.5, padding: '6px 8px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--bd)', borderRadius: 10 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 880 }}>
        <thead>
          <tr style={{ background: 'var(--bg-card)' }}>
            <th style={{ textAlign: 'left', fontSize: 10, color: 'var(--tx-3)', padding: '8px 12px', letterSpacing: '0.05em', textTransform: 'uppercase', position: 'sticky', left: 0, background: 'var(--bg-card)' }}>Category</th>
            {MONTHS.map(m => (
              <th key={m} style={{ ...cellStyle, color: 'var(--tx-3)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>{m}</th>
            ))}
            <th style={{ ...cellStyle, color: 'var(--tx-2)', fontWeight: 700, fontSize: 10, textTransform: 'uppercase' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {groupNames.map(g => {
            const gRows = grouped[g]
            const gTotals = Array(12).fill(0)
            for (const r of gRows) for (let m = 0; m < 12; m++) gTotals[m] += r.months[m]
            const gTotal = gTotals.reduce((a, b) => a + b, 0)
            return (
              <Fragment key={`group-${g}`}>
                <tr style={{ background: 'var(--hover)' }}>
                  <td style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx-2)', padding: '6px 12px', letterSpacing: '0.04em', textTransform: 'uppercase', position: 'sticky', left: 0, background: 'var(--bg-app)' }}>{g}</td>
                  {gTotals.map((v, m) => <td key={m} style={{ ...cellStyle, color: 'var(--tx-3)' }}>{v > 0 ? fmt(v) : '·'}</td>)}
                  <td style={{ ...cellStyle, fontWeight: 700, color: 'var(--tx-2)' }}>{fmt(gTotal)}</td>
                </tr>
                {gRows.map((r, ri) => {
                  const rTotal = r.months.reduce((a, b) => a + b, 0)
                  return (
                    <tr key={`${g}-${ri}`} style={{ borderTop: '1px solid var(--bd-light)' }}>
                      <td style={{ fontSize: 12.5, color: 'var(--tx-1)', padding: '6px 12px 6px 22px', position: 'sticky', left: 0, background: 'var(--bg-app)', whiteSpace: 'nowrap' }}>
                        {r.name}
                        {r.isCommitment && <span style={{ fontSize: 9, color: '#8B5CF6', marginLeft: 6 }}>◈</span>}
                      </td>
                      {r.months.map((v, m) => <td key={m} style={{ ...cellStyle, color: v > 0 ? 'var(--tx-1)' : 'var(--tx-4)' }}>{v > 0 ? fmt(v) : '·'}</td>)}
                      <td style={{ ...cellStyle, fontWeight: 600, color: 'var(--tx-1)' }}>{fmt(rTotal)}</td>
                    </tr>
                  )
                })}
              </Fragment>
            )
          })}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '2px solid var(--bd)', background: 'var(--bg-card)' }}>
            <td style={{ fontSize: 11, fontWeight: 700, color: 'var(--tx-1)', padding: '9px 12px', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', left: 0, background: 'var(--bg-card)' }}>Total</td>
            {monthTotals.map((v, m) => <td key={m} style={{ ...cellStyle, fontWeight: 700, color: 'var(--accent)' }}>{fmt(v)}</td>)}
            <td style={{ ...cellStyle, fontWeight: 700, color: 'var(--accent)' }}>{fmt(grandTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ── Main module ──────────────────────────────────────────────────────────────

const primaryBtn = {
  padding: '8px 16px', background: 'var(--accent)', color: 'var(--accent-tx-on)',
  border: 'none', borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
}
const ghostBtn = {
  padding: '8px 14px', background: 'transparent', color: 'var(--tx-2)',
  border: '1px solid var(--bd)', borderRadius: 7, fontSize: 12.5, cursor: 'pointer',
}

export default function Budget({ userId, mobile }) {
  const [year, setYear] = useState(CUR_YEAR)
  const [years, setYears] = useState([])
  const [lineItems, setLineItems] = useState([])
  const [commitments, setCommitments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [generating, setGenerating] = useState(false)
  const [analysis, setAnalysis] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [pendingUpload, setPendingUpload] = useState(null)
  const fileRef = useRef(null)

  const loadYearData = useCallback(async (yr) => {
    setLoading(true)
    setError(null)
    try {
      const [items, yrs, cmts] = await Promise.all([
        getBudgetLineItems(userId, { year: yr }),
        getBudgetYears(userId),
        getCommitments(userId, { status: 'active' }),
      ])
      setLineItems(items)
      setYears(yrs)
      setCommitments(cmts)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { loadYearData(year) }, [year, loadYearData])

  async function handleAnalyze() {
    setAnalyzing(true)
    setError(null)
    try {
      const [txns, cats] = await Promise.all([
        getTransactionsForAnalysis(userId, 24),
        getBudgetCategories(userId),
      ])
      if (!txns.length) {
        setError('No transactions found. Import a CSV first to generate a budget from history.')
        setAnalyzing(false)
        return
      }
      const result = analyzeTransactions(txns, cats)
      setAnalysis(result)
      setGenerating(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setAnalyzing(false)
    }
  }

  // Build the editable-preview analysis from parsed upload rows.
  // `chosenMonthsByCat` (optional) is the reviewed category → 12-month array map;
  // when absent we use each row's auto-matched detail, else an even spread.
  function buildUploadAnalysis(rows, idByName, fileName, chosenMonthsByCat) {
    const categories = rows
      .map(r => {
        let detail = null
        if (chosenMonthsByCat && chosenMonthsByCat.has(r.category)) {
          detail = chosenMonthsByCat.get(r.category)
        } else if (r.monthly12 && r.monthly12.length === 12) {
          detail = r.monthly12
        }
        const monthly = r.monthlyTarget ?? (r.annual != null ? r.annual / 12 : 0)
        const annual = detail ? detail.reduce((a, b) => a + b, 0) : (r.annual ?? monthly * 12)
        return {
          category_id: idByName.get(r.category) ?? null,
          category: r.category,
          group: r.group,
          type: r.type || 'Flexible',
          monthlyAvg: monthly,
          annualTotal: annual,
          monthHistogram: detail ?? Array(12).fill(annual / 12),
        }
      })
      .filter(c => c.category_id && c.annualTotal >= 1)
    return { categories, spanMonths: null, sourceLabel: `Imported from “${fileName}”` }
  }

  // Upload an existing budget file (CSV or .xlsx). We upsert its categories so
  // they exist with the right group/type. If the workbook has Non-Monthly detail
  // tabs, we route through a review step to confirm category → tab matches first;
  // otherwise we go straight to the editable preview the history flow uses.
  async function handleUploadFile(file) {
    if (!file) return
    setImporting(true)
    setError(null)
    try {
      const { rows, errors, detailTabs } = await parseBudgetFile(file)
      if (!rows.length) {
        setError(errors[0] || 'No budget rows found in that file.')
        return
      }

      await importCategoryMappings(userId, rows)
      const cats = await getBudgetCategories(userId)
      const idByName = new Map(cats.map(c => [c.category, c.id]))

      const tabs = detailTabs || []
      const hasNonMonthly = rows.some(r => r.type === 'Non-Monthly')
      if (tabs.length && hasNonMonthly) {
        setPendingUpload({ rows, detailTabs: tabs, idByName, fileName: file.name })
        setReviewing(true)
        return
      }

      const analysis = buildUploadAnalysis(rows, idByName, file.name, null)
      if (!analysis.categories.length) {
        setError('Could not read any budget amounts from that file. Expected a category, group, and a monthly or yearly amount.')
        return
      }
      setAnalysis(analysis)
      setGenerating(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = '' // allow re-selecting the same file
    }
  }

  function handleReviewConfirm(chosenMonthsByCat) {
    const { rows, idByName, fileName } = pendingUpload
    const analysis = buildUploadAnalysis(rows, idByName, fileName, chosenMonthsByCat)
    setReviewing(false)
    setPendingUpload(null)
    if (!analysis.categories.length) {
      setError('Could not read any budget amounts from that file.')
      return
    }
    setAnalysis(analysis)
    setGenerating(true)
  }

  async function handleSaveBudget(items) {
    setSaving(true)
    try {
      await saveBudgetForYear(userId, year, 'v1', items)
      setGenerating(false)
      setAnalysis(null)
      await loadYearData(year)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const yearOptions = useMemo(() => {
    const set = new Set([...years, CUR_YEAR, CUR_YEAR + 1])
    return [...set].sort((a, b) => a - b)
  }, [years])

  const annualTotal = lineItems.reduce((s, li) => s + Number(li.amount || 0), 0)

  return (
    <div style={{ maxWidth: 1100 }}>
      <input
        type="file"
        accept=".csv,.xlsx,.xlsm"
        ref={fileRef}
        style={{ display: 'none' }}
        onChange={e => handleUploadFile(e.target.files[0])}
      />
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: 'var(--accent)', letterSpacing: '0.1em', marginBottom: 6 }}>
          // annual budget builder
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
          <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: mobile ? 24 : 30, fontWeight: 400, color: 'var(--tx-1)', margin: 0, lineHeight: 1.1 }}>
            {reviewing ? 'Match Detail Tabs' : generating ? (analysis?.sourceLabel ? 'Import Budget' : 'Generate Budget') : 'Annual Budget Builder'}
          </h1>
          {!generating && !reviewing && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <select value={year} onChange={e => setYear(Number(e.target.value))} style={{
                padding: '7px 12px', background: 'var(--bg-card)', border: '1px solid var(--bd)',
                borderRadius: 7, color: 'var(--tx-1)', fontSize: 13, outline: 'none', cursor: 'pointer',
              }}>
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <button onClick={() => fileRef.current?.click()} disabled={importing || analyzing} style={{ ...ghostBtn, opacity: importing || analyzing ? 0.6 : 1 }}>
                {importing ? 'Importing…' : '⤓ Upload Budget'}
              </button>
              <button onClick={handleAnalyze} disabled={analyzing || importing} style={{ ...primaryBtn, opacity: analyzing || importing ? 0.6 : 1 }}>
                {analyzing ? 'Analyzing…' : lineItems.length ? '↻ Regenerate' : '✦ Generate from History'}
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: 'var(--warn-bg)', border: '1px solid var(--warn)', borderRadius: 8, color: 'var(--tx-1)', fontSize: 13, marginBottom: 18 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--tx-3)', fontSize: 14, padding: 32 }}>Loading budget…</div>
      ) : reviewing && pendingUpload ? (
        <TabMatchReview
          pending={pendingUpload}
          mobile={mobile}
          onConfirm={handleReviewConfirm}
          onCancel={() => { setReviewing(false); setPendingUpload(null) }}
        />
      ) : generating && analysis ? (
        <GeneratePanel
          key={`${year}-${analysis.spanMonths}-${analysis.categories.length}`}
          analysis={analysis}
          commitments={commitments}
          year={year}
          saving={saving}
          onSave={handleSaveBudget}
          onCancel={() => { setGenerating(false); setAnalysis(null) }}
        />
      ) : lineItems.length === 0 ? (
        <div style={{ border: '1px dashed var(--bd)', borderRadius: 12, padding: '48px 28px', textAlign: 'center' }}>
          <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 18, color: 'var(--tx-1)', marginBottom: 10 }}>
            No budget for {year} yet
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--tx-2)', lineHeight: 1.6, maxWidth: 460, margin: '0 auto 20px' }}>
            Generate a month-by-month budget from your transaction history — the analyzer
            classifies each category as Fixed, Flexible, or Non-Monthly and proposes targets you
            can adjust. Or upload a budget you already maintain (CSV or Excel).
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={handleAnalyze} disabled={analyzing || importing} style={{ ...primaryBtn, opacity: analyzing || importing ? 0.6 : 1 }}>
              {analyzing ? 'Analyzing…' : '✦ Generate from History'}
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={importing || analyzing} style={{ ...ghostBtn, opacity: importing || analyzing ? 0.6 : 1 }}>
              {importing ? 'Importing…' : '⤓ Upload Budget'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 20, marginBottom: 18, flexWrap: 'wrap' }}>
            <SummaryStat label={`${year} planned`} value={fmtFull(annualTotal)} accent />
            <SummaryStat label="Avg / month" value={fmtFull(annualTotal / 12)} />
            <SummaryStat label="Line items" value={lineItems.length.toLocaleString()} />
            <SummaryStat label="Active commitments" value={commitments.length.toLocaleString()} />
          </div>
          <ScheduleGrid lineItems={lineItems} commitments={commitments} year={year} mobile={mobile} />
        </>
      )}
    </div>
  )
}

function SummaryStat({ label, value, accent }) {
  return (
    <div>
      <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 24, color: accent ? 'var(--accent)' : 'var(--tx-1)', lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: 'var(--tx-3)', letterSpacing: '0.06em', marginTop: 6, textTransform: 'uppercase' }}>
        {label}
      </div>
    </div>
  )
}

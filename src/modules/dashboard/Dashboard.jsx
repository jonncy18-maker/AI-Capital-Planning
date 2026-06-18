import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  spendByGroup,
  runRateEOY,
  budgetVsActual,
  cashFlowSpike,
  commitmentsSummary,
  wealthSummary,
  monthlyBudgetVsActual,
} from '../../lib/dashboard/widgetData.js'
import { getLatestBriefing, saveBriefing } from '../../lib/db/aiBriefings.js'
import { getTransactionsByMonth } from '../../lib/db/transactions.js'
import { sendAIMessage } from '../../lib/ai/sendMessage.js'
import { summarizeContext } from '../../lib/ai/contextLoader.js'
import BudgetActualsChart from './BudgetActualsChart.jsx'
import ModuleHeader from '../common/ModuleHeader.jsx'

const LS_LAYOUT = 'acp.dashboard.layout.v2'

function fmtMoney(n) { return '$' + Math.round(n || 0).toLocaleString() }
function fmtK(n) {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M'
  if (abs >= 1000) return '$' + Math.round(n / 1000) + 'k'
  return '$' + Math.round(n || 0)
}

// ── widget primitives ────────────────────────────────────────────────────────

function Stat({ value, label, accent = true }) {
  return (
    <div>
      <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 34, color: accent ? 'var(--accent)' : 'var(--tx-1)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: 'var(--tx-3)', letterSpacing: '0.06em', marginTop: 8 }}>{label}</div>
    </div>
  )
}
function MiniStat({ value, label }) {
  return (
    <div>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 15, color: 'var(--tx-1)' }}>{value}</div>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: 'var(--tx-3)', letterSpacing: '0.05em', marginTop: 3 }}>{label.toUpperCase()}</div>
    </div>
  )
}
function Empty({ text }) {
  return <div style={{ fontSize: 12, color: 'var(--tx-3)', lineHeight: 1.5 }}>{text}</div>
}

// ── widget definitions ───────────────────────────────────────────────────────

function buildWidgets(ctx, summary) {
  const sg = spendByGroup(ctx)
  const rr = runRateEOY(ctx)
  const bva = budgetVsActual(ctx)
  const spike = cashFlowSpike(ctx)
  const cs = commitmentsSummary(ctx)
  const ws = wealthSummary(ctx)

  return [
    {
      id: 'activity', title: '90-Day Activity',
      render: () => (
        <>
          <Stat value={summary.transactionCount.toLocaleString()} label="TRANSACTIONS" />
          <div style={{ display: 'flex', gap: 20, marginTop: 14 }}>
            <MiniStat value={fmtMoney(summary.spend90d)} label="spend" />
            <MiniStat value={fmtMoney(summary.income90d)} label="income" />
          </div>
        </>
      ),
    },
    {
      id: 'spendGroup', title: 'Spend by Group',
      render: () => sg.rows.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 2 }}>
          {sg.rows.map(r => (
            <div key={r.group}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 3 }}>
                <span style={{ color: 'var(--tx-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>{r.group}</span>
                <span style={{ color: 'var(--tx-1)', fontVariantNumeric: 'tabular-nums' }}>{fmtK(r.total)}</span>
              </div>
              <div style={{ height: 4, background: 'var(--bd-light)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${sg.max ? (r.total / sg.max) * 100 : 0}%`, height: '100%', background: 'var(--accent)' }} />
              </div>
            </div>
          ))}
        </div>
      ) : <Empty text="No spending data in the last 90 days." />,
    },
    {
      id: 'spikes', title: 'Cash Flow Spike',
      render: () => spike.hasData ? (
        <>
          <Stat value={fmtK(spike.amount)} label={`NEXT SPIKE · ${spike.month}`} />
          <div style={{ marginTop: 14 }}><MiniStat value={fmtMoney(spike.yearTotal)} label="committed this year" /></div>
        </>
      ) : <Empty text="No upcoming commitment spikes. Add commitments to forecast cash demands." />,
    },
    {
      id: 'budget', title: 'Budget vs. Projected',
      render: () => bva.hasBudget ? (
        <>
          <Stat value={bva.pct != null ? Math.round(bva.pct) + '%' : '—'} label="OF PLAN (RUN-RATE)" accent={bva.pct == null || bva.pct <= 105} />
          <div style={{ display: 'flex', gap: 20, marginTop: 14 }}>
            <MiniStat value={fmtK(bva.planned)} label="planned" />
            <MiniStat value={fmtK(bva.projected)} label="projected" />
          </div>
        </>
      ) : <Empty text="No budget yet. Generate one in the Budget Builder to track plan vs. actual." />,
    },
    {
      id: 'runrate', title: 'Run-Rate EOY',
      render: () => summary.transactionCount ? (
        <>
          <Stat value={fmtK(rr.annualized)} label="ANNUALIZED SPEND" />
          <div style={{ marginTop: 14 }}><MiniStat value={fmtMoney(rr.projectedRemaining)} label={`${rr.daysLeft}d left this year`} /></div>
        </>
      ) : <Empty text="Import transactions to see your run-rate projection." />,
    },
    {
      id: 'commitments', title: 'Commitments',
      render: () => cs.totalCount ? (
        <>
          <Stat value={cs.activeCount.toLocaleString()} label="ACTIVE" />
          <div style={{ marginTop: 14 }}><MiniStat value={fmtMoney(cs.yearTotal)} label="this year" /></div>
        </>
      ) : <Empty text="No commitments tracked. Add long-term obligations to forecast them." />,
    },
    {
      id: 'wealth', title: 'Wealth Trajectory',
      render: () => ws.hasData ? (
        <>
          <Stat value={fmtK(ws.netWorth)} label="NET WORTH" />
          <div style={{ marginTop: 14 }}><MiniStat value={fmtK(ws.investable)} label="investable" /></div>
        </>
      ) : <Empty text="Add a net worth snapshot to track your trajectory." />,
    },
  ]
}

// ── AI Briefing widget (spans full width) ────────────────────────────────────

function BriefingWidget({ userId, ctx, briefing, onGenerated }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function generate() {
    setLoading(true)
    setError(null)
    try {
      const res = await sendAIMessage({
        prompt:
          'Give me a concise briefing (3–5 sentences) on my current financial position. ' +
          'Highlight the single most important thing to watch over the next quarter, grounded in the data. ' +
          'No preamble — just the briefing.',
        context: ctx,
      })
      if (res.status !== 'ok' || !res.text) {
        setError(res.text || 'Could not generate a briefing right now.')
        return
      }
      const summary = summarizeContext(ctx)
      const saved = await saveBriefing(userId, {
        narrative: res.text,
        context_summary: `${summary.transactionCount} txns · ${summary.commitmentCount} commitments · ${summary.budgetYears.length} budget yr(s)`,
        module_context: 'dashboard',
      }).catch(() => ({ narrative: res.text, generated_at: new Date().toISOString() }))
      onGenerated(saved)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ border: '1px solid var(--accent-bd)', borderRadius: 13, background: 'var(--bg-card)', padding: 20, gridColumn: '1 / -1' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--accent)', fontSize: 13 }}>✦</span>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--tx-1)' }}>AI Briefing</span>
          {briefing?.generated_at && (
            <span style={{ fontSize: 10.5, color: 'var(--tx-3)' }}>
              · {new Date(briefing.generated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
        </div>
        <button onClick={generate} disabled={loading} style={{
          padding: '6px 13px', background: briefing ? 'transparent' : 'var(--accent)',
          color: briefing ? 'var(--accent)' : 'var(--accent-tx-on)',
          border: briefing ? '1px solid var(--accent-bd)' : 'none', borderRadius: 7,
          fontSize: 11.5, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
        }}>
          {loading ? 'Generating…' : briefing ? '↻ Refresh' : 'Generate Briefing'}
        </button>
      </div>
      {error && <div style={{ fontSize: 12.5, color: 'var(--warn)', lineHeight: 1.5 }}>{error}</div>}
      {!error && briefing?.narrative && (
        <div style={{ fontSize: 13.5, color: 'var(--tx-1)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{briefing.narrative}</div>
      )}
      {!error && !briefing && !loading && (
        <Empty text="Generate an on-demand narrative summary of your financial position. Cached after generation to avoid repeat token cost." />
      )}
    </div>
  )
}

// Wrapper that makes a full-width block (chart, briefing) configurable the same
// way grid widgets are: a label + show/hide eye in configure mode, dimmed when
// hidden. Outside configure mode it's a plain pass-through.
function ConfigBlock({ id, label, configure, isHidden, onToggle, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {configure && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, padding: '0 2px' }}>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, letterSpacing: '0.05em', color: 'var(--tx-3)' }}>{label}</span>
          <button onClick={() => onToggle(id)} title={isHidden ? 'Show' : 'Hide'} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tx-3)', fontSize: 13 }}>
            {isHidden ? '◌' : '⏿'}
          </button>
        </div>
      )}
      <div style={{ opacity: isHidden ? 0.4 : 1, transition: 'opacity .15s' }}>{children}</div>
    </div>
  )
}

// ── Main dashboard ───────────────────────────────────────────────────────────

export default function Dashboard({ context, summary, mobile, userId, periodDefault, periodOptions = [] }) {
  const [briefing, setBriefing] = useState(null)
  const [configure, setConfigure] = useState(false)
  const [dragId, setDragId] = useState(null)
  const [activePeriod, setActivePeriod] = useState(periodDefault)
  const [yearTxns, setYearTxns] = useState([])

  // Full-year transactions power the Monthly Budget vs Actuals chart. The shared
  // AI context only holds the trailing 90 days, so the chart loads the wider
  // window itself (current calendar year).
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const year = context?.thisYear ?? new Date().getFullYear()
    getTransactionsByMonth(userId, `${year}-01-01`, `${year}-12-31`)
      .then(rows => { if (!cancelled) setYearTxns(rows) })
      .catch(() => { if (!cancelled) setYearTxns([]) })
    return () => { cancelled = true }
  }, [userId, context?.thisYear])

  const monthly = useMemo(() => monthlyBudgetVsActual(context, yearTxns), [context, yearTxns])

  // Persisted layout: { order: [...ids], hidden: [...ids] }
  const [layout, setLayout] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_LAYOUT)) || { order: [], hidden: [] } }
    catch { return { order: [], hidden: [] } }
  })
  const persist = useCallback((next) => {
    setLayout(next)
    try { localStorage.setItem(LS_LAYOUT, JSON.stringify(next)) } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    getLatestBriefing(userId, 'dashboard')
      .then(b => { if (!cancelled) setBriefing(b) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [userId])

  const widgets = useMemo(() => buildWidgets(context, summary), [context, summary])

  // Apply saved order then append any new widgets not yet in the order.
  const ordered = useMemo(() => {
    const byId = Object.fromEntries(widgets.map(w => [w.id, w]))
    const seen = new Set()
    const result = []
    for (const id of layout.order) {
      if (byId[id]) { result.push(byId[id]); seen.add(id) }
    }
    for (const w of widgets) if (!seen.has(w.id)) result.push(w)
    return result
  }, [widgets, layout.order])

  const hidden = new Set(layout.hidden)

  function onDrop(targetId) {
    if (!dragId || dragId === targetId) return
    const ids = ordered.map(w => w.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    if (from === -1 || to === -1) return
    const next = [...ids]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    persist({ ...layout, order: next })
    setDragId(null)
  }

  function toggleHidden(id) {
    const h = new Set(layout.hidden)
    h.has(id) ? h.delete(id) : h.add(id)
    persist({ ...layout, hidden: [...h] })
  }

  const visible = ordered.filter(w => !hidden.has(w.id))

  return (
    <div style={{ maxWidth: 1120 }}>
      {/* Header */}
      <ModuleHeader
        mobile={mobile}
        icon="◉"
        title="Dashboard"
        subtitle="Your command center — plan vs. actuals, cash, and trajectory at a glance."
        actions={(
          <button onClick={() => setConfigure(c => !c)} style={{
            background: configure ? 'var(--accent-bg)' : 'none',
            border: configure ? '1px solid var(--accent-bd)' : '1px solid var(--bd)',
            borderRadius: 8, padding: '8px 14px', fontFamily: "'DM Mono', monospace",
            fontSize: 10, letterSpacing: '0.05em', color: configure ? 'var(--accent)' : 'var(--tx-2)', cursor: 'pointer',
          }}>
            {configure ? '✓ DONE' : '⊞ CONFIGURE'}
          </button>
        )}
      />

      {/* Period filter */}
      {periodOptions.length > 0 && (
        <div style={{ display: 'flex', gap: 7, marginBottom: 22, flexWrap: 'wrap' }}>
          {periodOptions.map(p => {
            const on = p === activePeriod
            return (
              <button key={p} onClick={() => setActivePeriod(p)} style={{
                border: on ? '1px solid var(--accent)' : '1px solid var(--bd)',
                background: on ? 'var(--accent-bg)' : 'var(--bg-card)',
                color: on ? 'var(--accent)' : 'var(--tx-2)', borderRadius: 7,
                padding: '6px 13px', fontFamily: "'DM Mono', monospace", fontSize: 11, cursor: 'pointer',
              }}>{p}</button>
            )
          })}
        </div>
      )}

      {configure && (
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: 'var(--tx-3)', letterSpacing: '0.04em', marginBottom: 14 }}>
          DRAG TO REARRANGE · TAP THE EYE TO SHOW/HIDE
        </div>
      )}

      {/* Monthly Budget vs Actuals — the centerpiece, full width */}
      {(configure || !hidden.has('monthlyChart')) && (
        <ConfigBlock id="monthlyChart" label="MONTHLY BUDGET VS ACTUALS" configure={configure} isHidden={hidden.has('monthlyChart')} onToggle={toggleHidden}>
          <BudgetActualsChart data={monthly} mobile={mobile} />
        </ConfigBlock>
      )}

      {/* AI Briefing — full width */}
      {(configure || !hidden.has('briefing')) && (
        <ConfigBlock id="briefing" label="AI BRIEFING" configure={configure} isHidden={hidden.has('briefing')} onToggle={toggleHidden}>
          <BriefingWidget userId={userId} ctx={context} briefing={briefing} onGenerated={setBriefing} />
        </ConfigBlock>
      )}

      {/* Widget grid */}
      <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
        {(configure ? ordered : visible).map(w => {
          const isHidden = hidden.has(w.id)
          return (
            <div
              key={w.id}
              draggable={configure}
              onDragStart={() => setDragId(w.id)}
              onDragOver={e => configure && e.preventDefault()}
              onDrop={() => onDrop(w.id)}
              style={{
                border: dragId === w.id ? '1px solid var(--accent)' : '1px solid var(--bd)',
                borderRadius: 13, background: 'var(--bg-card)', padding: 20, minHeight: 128,
                cursor: configure ? 'grab' : 'default',
                opacity: dragId === w.id ? 0.5 : isHidden ? 0.4 : 1,
                transition: 'border-color .15s, opacity .15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--tx-2)' }}>{w.title}</div>
                {configure && (
                  <button onClick={() => toggleHidden(w.id)} title={isHidden ? 'Show' : 'Hide'} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tx-3)', fontSize: 13 }}>
                    {isHidden ? '◌' : '⏿'}
                  </button>
                )}
              </div>
              {w.render()}
            </div>
          )
        })}
      </div>
    </div>
  )
}

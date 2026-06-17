import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  getWealthSnapshots,
  saveWealthSnapshot,
  deleteWealthSnapshot,
} from '../../lib/db/wealthSnapshots.js'
import { getCommitments } from '../../lib/db/commitments.js'
import {
  buildComparison,
  yearsToTarget,
  investableFromSnapshot,
} from '../../lib/wealth/projection.js'
import { commitmentYearSchedule } from '../../lib/commitments/schedule.js'

const CUR_YEAR = new Date().getFullYear()

function fmtFull(n) {
  const neg = n < 0
  return (neg ? '-$' : '$') + Math.abs(Math.round(n || 0)).toLocaleString()
}
function fmtM(n) {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M'
  if (abs >= 1000) return '$' + Math.round(n / 1000) + 'k'
  return '$' + Math.round(n)
}

const primaryBtn = { padding: '8px 16px', background: 'var(--accent)', color: 'var(--accent-tx-on)', border: 'none', borderRadius: 7, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }
const ghostBtn = { padding: '8px 14px', background: 'transparent', color: 'var(--tx-2)', border: '1px solid var(--bd)', borderRadius: 7, fontSize: 12.5, cursor: 'pointer' }
const field = { width: '100%', padding: '8px 10px', background: 'var(--field)', border: '1px solid var(--bd)', borderRadius: 6, color: 'var(--tx-1)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }
const labelStyle = { fontSize: 11, color: 'var(--tx-2)', display: 'block', marginBottom: 4, fontWeight: 500 }

// ── Snapshot form ────────────────────────────────────────────────────────────

function SnapshotForm({ onSave, onCancel, saving }) {
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [investment, setInvestment] = useState('')
  const [retirement, setRetirement] = useState('')
  const [other, setOther] = useState('')
  const [liabilities, setLiabilities] = useState('')
  const [notes, setNotes] = useState('')

  const netWorth = (parseFloat(investment) || 0) + (parseFloat(retirement) || 0) + (parseFloat(other) || 0) - (parseFloat(liabilities) || 0)

  function handleSubmit(e) {
    e.preventDefault()
    onSave({
      snapshot_date: date,
      net_worth: netWorth,
      investment_balance: parseFloat(investment) || 0,
      retirement_balance: parseFloat(retirement) || 0,
      other_assets: parseFloat(other) || 0,
      liabilities: parseFloat(liabilities) || 0,
      notes: notes.trim() || null,
    })
  }

  return (
    <form onSubmit={handleSubmit} style={{ background: 'var(--bg-card)', border: '1px solid var(--bd)', borderRadius: 12, padding: 20, maxWidth: 520 }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--tx-1)', marginBottom: 16 }}>New Net Worth Snapshot</div>
      <div style={{ marginBottom: 12 }}>
        <label style={labelStyle}>Date</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={field} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div><label style={labelStyle}>Investment balance</label><input type="number" value={investment} onChange={e => setInvestment(e.target.value)} placeholder="0" style={field} /></div>
        <div><label style={labelStyle}>Retirement balance</label><input type="number" value={retirement} onChange={e => setRetirement(e.target.value)} placeholder="0" style={field} /></div>
        <div><label style={labelStyle}>Other assets</label><input type="number" value={other} onChange={e => setOther(e.target.value)} placeholder="0" style={field} /></div>
        <div><label style={labelStyle}>Liabilities</label><input type="number" value={liabilities} onChange={e => setLiabilities(e.target.value)} placeholder="0" style={field} /></div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--accent-bg)', borderRadius: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 12.5, color: 'var(--tx-2)' }}>Net worth</span>
        <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)' }}>{fmtFull(netWorth)}</span>
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle}>Notes</label>
        <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="optional" style={field} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save Snapshot'}</button>
        <button type="button" onClick={onCancel} style={ghostBtn}>Cancel</button>
      </div>
    </form>
  )
}

// ── Trajectory chart (SVG) ───────────────────────────────────────────────────

function TrajectoryChart({ baseSeries, scenarioSeries, target, mobile }) {
  const W = mobile ? 320 : 640
  const H = 220
  const padL = 48, padB = 24, padT = 12, padR = 12
  const all = [...baseSeries.map(p => p.balance), ...(scenarioSeries?.map(p => p.balance) ?? []), target || 0]
  const maxVal = Math.max(...all, 1)
  const years = baseSeries.length - 1

  const x = (yr) => padL + (yr / years) * (W - padL - padR)
  const y = (val) => padT + (1 - val / maxVal) * (H - padT - padB)

  const toPath = (series) => series.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.year).toFixed(1)} ${y(p.balance).toFixed(1)}`).join(' ')

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(f => f * maxVal)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', maxWidth: W }}>
      {gridLines.map((g, i) => (
        <g key={i}>
          <line x1={padL} y1={y(g)} x2={W - padR} y2={y(g)} stroke="var(--bd-light)" strokeWidth="1" />
          <text x={padL - 6} y={y(g) + 3} textAnchor="end" fontSize="9" fill="var(--tx-3)">{fmtM(g)}</text>
        </g>
      ))}
      {target > 0 && target <= maxVal && (
        <line x1={padL} y1={y(target)} x2={W - padR} y2={y(target)} stroke="var(--warn)" strokeWidth="1.5" strokeDasharray="4 3" />
      )}
      {/* x-axis labels */}
      {Array.from({ length: Math.min(years + 1, 7) }).map((_, i) => {
        const yr = Math.round((i / Math.min(years, 6)) * years)
        return <text key={i} x={x(yr)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--tx-3)">+{yr}y</text>
      })}
      {scenarioSeries && (
        <path d={toPath(scenarioSeries)} fill="none" stroke="var(--accent)" strokeWidth="2.5" />
      )}
      <path d={toPath(baseSeries)} fill="none" stroke={scenarioSeries ? 'var(--tx-3)' : 'var(--accent)'} strokeWidth="2" strokeDasharray={scenarioSeries ? '5 4' : 'none'} />
    </svg>
  )
}

function Slider({ label, value, min, max, step, onChange, format }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--tx-2)' }}>{label}</span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--accent)' }}>{format(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }} />
    </div>
  )
}

function Stat({ label, value, accent, small }) {
  return (
    <div>
      <div style={{ fontFamily: small ? 'inherit' : "'DM Serif Display', serif", fontSize: small ? 15 : 26, fontWeight: small ? 600 : 400, color: accent ? 'var(--accent)' : 'var(--tx-1)', lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9.5, color: 'var(--tx-3)', letterSpacing: '0.06em', marginTop: 6, textTransform: 'uppercase' }}>{label}</div>
    </div>
  )
}

// ── Main module ──────────────────────────────────────────────────────────────

export default function Wealth({ userId, mobile }) {
  const [snapshots, setSnapshots] = useState([])
  const [commitments, setCommitments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  // Scenario assumptions
  const [monthlyContribution, setMonthlyContribution] = useState(2000)
  const [annualReturn, setAnnualReturn] = useState(6)
  const [horizon, setHorizon] = useState(25)
  const [retirementTarget, setRetirementTarget] = useState(1_500_000)
  const [includeCommitments, setIncludeCommitments] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [snaps, cmts] = await Promise.all([
        getWealthSnapshots(userId, 24),
        getCommitments(userId, { status: 'active' }),
      ])
      setSnapshots(snaps)
      setCommitments(cmts)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { load() }, [load])

  async function handleSave(payload) {
    setSaving(true)
    try {
      await saveWealthSnapshot(userId, payload)
      await load()
      setShowForm(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    try { await deleteWealthSnapshot(id); await load() } catch (e) { setError(e.message) }
  }

  const latest = snapshots[0] || null
  const startBalance = investableFromSnapshot(latest)

  const annualCommitmentDrain = useMemo(() => {
    if (!includeCommitments) return 0
    return commitments.reduce((s, c) => s + commitmentYearSchedule(c, CUR_YEAR).reduce((a, b) => a + b, 0), 0)
  }, [commitments, includeCommitments])

  const comparison = useMemo(() => buildComparison(
    { startBalance, monthlyContribution, annualReturn: annualReturn / 100, annualCommitmentDrain: 0 },
    { startBalance, monthlyContribution, annualReturn: annualReturn / 100, annualCommitmentDrain },
    horizon
  ), [startBalance, monthlyContribution, annualReturn, horizon, annualCommitmentDrain])

  const activeSeries = includeCommitments && annualCommitmentDrain > 0 ? comparison.scenarioSeries : comparison.baseSeries
  const yrsToTarget = yearsToTarget(activeSeries, retirementTarget)
  const finalBalance = activeSeries[activeSeries.length - 1].balance

  return (
    <div style={{ maxWidth: 1000 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: 'var(--accent)', letterSpacing: '0.1em', marginBottom: 6 }}>
          // wealth trajectory
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
          <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: mobile ? 24 : 30, fontWeight: 400, color: 'var(--tx-1)', margin: 0, lineHeight: 1.1 }}>
            Wealth Trajectory
          </h1>
          {!showForm && <button onClick={() => setShowForm(true)} style={primaryBtn}>+ Add Snapshot</button>}
        </div>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: 'var(--warn-bg)', border: '1px solid var(--warn)', borderRadius: 8, color: 'var(--tx-1)', fontSize: 13, marginBottom: 18 }}>{error}</div>
      )}

      {loading ? (
        <div style={{ color: 'var(--tx-3)', fontSize: 14, padding: 32 }}>Loading wealth data…</div>
      ) : showForm ? (
        <SnapshotForm onSave={handleSave} onCancel={() => setShowForm(false)} saving={saving} />
      ) : !latest ? (
        <div style={{ border: '1px dashed var(--bd)', borderRadius: 12, padding: '48px 28px', textAlign: 'center' }}>
          <div style={{ fontFamily: "'DM Serif Display', serif", fontSize: 18, color: 'var(--tx-1)', marginBottom: 10 }}>No net worth data yet</div>
          <div style={{ fontSize: 13.5, color: 'var(--tx-2)', lineHeight: 1.6, maxWidth: 420, margin: '0 auto 20px' }}>
            Add a net worth snapshot to model your long-term trajectory and retirement horizon. This module reflects your assumptions — it does not manage investments or give advice.
          </div>
          <button onClick={() => setShowForm(true)} style={primaryBtn}>+ Add Snapshot</button>
        </div>
      ) : (
        <>
          {/* Current standing */}
          <div style={{ display: 'flex', gap: 24, marginBottom: 24, flexWrap: 'wrap' }}>
            <Stat label="Current net worth" value={fmtFull(latest.net_worth)} accent />
            <Stat label="Investable base" value={fmtFull(startBalance)} />
            <Stat label={`Projected (+${horizon}y)`} value={fmtM(finalBalance)} />
            <Stat label="Years to target" value={yrsToTarget != null ? `${yrsToTarget}y` : `>${horizon}y`} small />
            <Stat label="As of" value={latest.snapshot_date} small />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1.4fr 1fr', gap: 20, marginBottom: 24 }}>
            {/* Chart */}
            <div style={{ border: '1px solid var(--bd)', borderRadius: 12, padding: 18, background: 'var(--bg-card)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-1)' }}>Projected net worth</div>
                <div style={{ display: 'flex', gap: 14, fontSize: 11 }}>
                  {includeCommitments && annualCommitmentDrain > 0 && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--tx-3)' }}>
                      <span style={{ width: 14, height: 0, borderTop: '2px dashed var(--tx-3)' }} /> No commitments
                    </span>
                  )}
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--accent)' }}>
                    <span style={{ width: 14, height: 2, background: 'var(--accent)' }} /> Projection
                  </span>
                  {retirementTarget > 0 && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--warn)' }}>
                      <span style={{ width: 14, height: 0, borderTop: '2px dashed var(--warn)' }} /> Target
                    </span>
                  )}
                </div>
              </div>
              <TrajectoryChart
                baseSeries={includeCommitments && annualCommitmentDrain > 0 ? comparison.baseSeries : activeSeries}
                scenarioSeries={includeCommitments && annualCommitmentDrain > 0 ? comparison.scenarioSeries : null}
                target={retirementTarget}
                mobile={mobile}
              />
            </div>

            {/* Assumption sliders */}
            <div style={{ border: '1px solid var(--bd)', borderRadius: 12, padding: 18, background: 'var(--bg-card)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-1)', marginBottom: 16 }}>Assumptions</div>
              <Slider label="Monthly contribution" value={monthlyContribution} min={0} max={15000} step={250} onChange={setMonthlyContribution} format={v => fmtFull(v)} />
              <Slider label="Annual return" value={annualReturn} min={0} max={12} step={0.5} onChange={setAnnualReturn} format={v => v + '%'} />
              <Slider label="Horizon" value={horizon} min={5} max={40} step={1} onChange={setHorizon} format={v => v + ' yrs'} />
              <Slider label="Retirement target" value={retirementTarget} min={250000} max={5_000_000} step={250000} onChange={setRetirementTarget} format={v => fmtM(v)} />
              {commitments.length > 0 && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--tx-2)', cursor: 'pointer', marginTop: 4 }}>
                  <input type="checkbox" checked={includeCommitments} onChange={e => setIncludeCommitments(e.target.checked)} style={{ accentColor: 'var(--accent)', cursor: 'pointer' }} />
                  Drain active commitments ({fmtFull(annualCommitmentDrain)}/yr)
                </label>
              )}
            </div>
          </div>

          {/* Snapshot history */}
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--tx-3)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>
            Snapshot history
          </div>
          <div style={{ border: '1px solid var(--bd)', borderRadius: 10, overflow: 'hidden' }}>
            {snapshots.map((s, i) => (
              <div key={s.id} style={{
                display: 'grid', gridTemplateColumns: mobile ? '1fr 1fr auto' : '120px 1fr 1fr 1fr 1fr auto',
                gap: 12, alignItems: 'center', padding: '10px 14px',
                borderTop: i ? '1px solid var(--bd-light)' : 'none', fontSize: 12.5,
              }}>
                <span style={{ color: 'var(--tx-2)' }}>{s.snapshot_date}</span>
                {!mobile && <span style={{ color: 'var(--tx-3)', fontSize: 11 }}>Inv {fmtM(s.investment_balance)}</span>}
                {!mobile && <span style={{ color: 'var(--tx-3)', fontSize: 11 }}>Ret {fmtM(s.retirement_balance)}</span>}
                {!mobile && <span style={{ color: 'var(--tx-3)', fontSize: 11 }}>Liab {fmtM(s.liabilities)}</span>}
                <span style={{ fontWeight: 600, color: 'var(--tx-1)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtFull(s.net_worth)}</span>
                <button onClick={() => handleDelete(s.id)} style={{ background: 'none', border: 'none', color: 'var(--tx-3)', cursor: 'pointer', fontSize: 15 }} title="Delete">×</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

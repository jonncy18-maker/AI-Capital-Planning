import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  getWealthSnapshots,
  saveWealthSnapshot,
  deleteWealthSnapshot,
} from '../../lib/db/wealthSnapshots.js'
import { getWealthPlans, saveWealthPlan } from '../../lib/db/wealthPlans.js'
import { getCommitments } from '../../lib/db/commitments.js'
import { commitmentYearSchedule } from '../../lib/commitments/schedule.js'
import { loadOutlookInputs } from '../../lib/outlook/loadOutlook.js'
import { buildOutlook } from '../../lib/outlook/outlookEngine.js'
import {
  buildPlanSeries,
  expectedAt,
  investmentActual,
  optionalActual,
  latestSnapshots,
  captureOutlook,
  validatePlan,
} from '../../lib/wealth/plans.js'
import { sumDollars } from '../../lib/money.js'
import ModuleHeader from '../common/ModuleHeader.jsx'
import { CONTENT_MAX } from '../common/layout.js'
import WealthChart from './WealthChart.jsx'
import {
  readSelectedPlanId,
  storeSelectedPlanId,
  resolveSelectedPlanId,
} from '../../lib/wealth/selection.js'
import './Wealth.css'
const fmtFull = (n) =>
  n == null
    ? '—'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }).format(n)
const primaryBtn = {
  padding: '8px 16px',
  background: 'var(--accent)',
  color: 'var(--accent-tx-on)',
  border: 0,
  borderRadius: 7,
  cursor: 'pointer',
}
const ghostBtn = {
  padding: '8px 14px',
  background: 'transparent',
  color: 'var(--tx-2)',
  border: '1px solid var(--bd)',
  borderRadius: 7,
  cursor: 'pointer',
}
const field = {
  width: '100%',
  padding: 8,
  background: 'var(--field)',
  border: '1px solid var(--bd)',
  borderRadius: 6,
  color: 'var(--tx-1)',
}
const labelStyle = { fontSize: 11, color: 'var(--tx-2)', display: 'block', marginBottom: 4 }
const months = Array.from({ length: 12 }, (_, i) =>
  new Date(2020, i, 1).toLocaleString('en-US', { month: 'long' })
)
const readWealthData = (userId) =>
  Promise.allSettled([
    getWealthSnapshots(userId, 10000),
    getWealthPlans(),
    getCommitments(userId, { status: 'active' }),
  ])
const monthEnd = (year, month) => new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10)
function gap(actual, expected) {
  if (actual == null) return 'No actual recorded'
  if (expected == null) return 'No comparable expectation'
  const delta = actual - expected
  return `${fmtFull(Math.abs(delta))} ${delta < 0 ? 'below' : delta > 0 ? 'above' : 'at'} plan${expected > 0 ? ` · ${((Math.abs(delta) / expected) * 100).toFixed(1)}%` : ''}`
}
function Benchmark({ title, actual, expected, note }) {
  return (
    <div className="wealth-benchmark">
      <h3>{title}</h3>
      <div className="wealth-amount">{fmtFull(actual)}</div>
      <div className="wealth-muted">{note || `Expected ${fmtFull(expected)}`}</div>
      <div className="wealth-gap">{gap(actual, expected)}</div>
    </div>
  )
}
function SnapshotForm({ onSave, onCancel, saving, initialDate }) {
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(initialDate || today)
  const [investment, setInvestment] = useState('')
  const [retirement, setRetirement] = useState('')
  const [other, setOther] = useState('')
  const [liabilities, setLiabilities] = useState('')
  const [notes, setNotes] = useState('')
  const [cash, setCash] = useState('')
  const [contributions, setContributions] = useState('')

  const netWorth = [investment, retirement, other, liabilities].some((value) => value === '')
    ? null
    : sumDollars([Number(investment), Number(retirement), Number(other), -Number(liabilities)])

  function handleSubmit(e) {
    e.preventDefault()
    onSave({
      snapshot_date: date,
      net_worth: netWorth,
      investment_balance: investment === '' ? null : Number(investment),
      retirement_balance: retirement === '' ? null : Number(retirement),
      other_assets: other === '' ? null : Number(other),
      liabilities: liabilities === '' ? null : Number(liabilities),
      notes: notes.trim() || null,
      emergency_cash: cash === '' ? null : Number(cash),
      investment_contributions_ytd: contributions === '' ? null : Number(contributions),
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--bd)',
        borderRadius: 12,
        padding: 20,
        maxWidth: 520,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--tx-1)', marginBottom: 16 }}>
        New Net Worth Snapshot
      </div>
      <div style={{ marginBottom: 12 }}>
        <label htmlFor="wealth-snapshot-date" style={labelStyle}>
          Date
        </label>
        <input
          id="wealth-snapshot-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={field}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label htmlFor="wealth-snapshot-investment" style={labelStyle}>
            Investment balance
          </label>
          <input
            id="wealth-snapshot-investment"
            type="number"
            step="0.01"
            value={investment}
            onChange={(e) => setInvestment(e.target.value)}
            placeholder="0"
            style={field}
          />
        </div>
        <div>
          <label htmlFor="wealth-snapshot-retirement" style={labelStyle}>
            Retirement balance
          </label>
          <input
            id="wealth-snapshot-retirement"
            type="number"
            step="0.01"
            value={retirement}
            onChange={(e) => setRetirement(e.target.value)}
            placeholder="0"
            style={field}
          />
        </div>
        <div>
          <label htmlFor="wealth-snapshot-other" style={labelStyle}>
            Other assets
          </label>
          <input
            id="wealth-snapshot-other"
            type="number"
            step="0.01"
            value={other}
            onChange={(e) => setOther(e.target.value)}
            placeholder="0"
            style={field}
          />
        </div>
        <div>
          <label htmlFor="wealth-snapshot-liabilities" style={labelStyle}>
            Liabilities
          </label>
          <input
            id="wealth-snapshot-liabilities"
            type="number"
            step="0.01"
            value={liabilities}
            onChange={(e) => setLiabilities(e.target.value)}
            placeholder="0"
            style={field}
          />
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 14px',
          background: 'var(--accent-bg)',
          borderRadius: 8,
          marginBottom: 14,
        }}
      >
        <span style={{ fontSize: 12.5, color: 'var(--tx-2)' }}>Net worth</span>
        <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)' }}>
          {fmtFull(netWorth)}
        </span>
      </div>
      <p className="wealth-muted">
        Blank balances mean unknown. Enter 0 only for a known zero balance.
      </p>
      <div className="wealth-fields">
        <label>
          Emergency cash (included in other assets)
          <input
            type="number"
            min="0"
            step="0.01"
            value={cash}
            onChange={(e) => setCash(e.target.value)}
          />
        </label>
        <label>
          Investment net deposits · calendar year to date
          <input
            type="number"
            step="0.01"
            value={contributions}
            onChange={(e) => setContributions(e.target.value)}
          />
        </label>
      </div>
      <p className="wealth-muted">
        YTD deposits are manually recorded, including retirement contributions; negative values mean
        net withdrawals. Cash is not added to net worth twice.
      </p>
      <div style={{ marginBottom: 16 }}>
        <label htmlFor="wealth-snapshot-notes" style={labelStyle}>
          Notes
        </label>
        <input
          id="wealth-snapshot-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="optional"
          style={field}
        />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="submit"
          disabled={saving}
          style={{ ...primaryBtn, opacity: saving ? 0.6 : 1 }}
        >
          {saving ? 'Saving…' : 'Save Snapshot'}
        </button>
        <button type="button" onClick={onCancel} style={ghostBtn}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function NewPlan({ snapshots, outlook, commitments, onSave, onCancel, saving }) {
  const eligible = snapshots.filter((s) => investmentActual(s) != null)
  const [snapshotId, setSnapshotId] = useState(eligible[0]?.id || '')
  const [name, setName] = useState('My baseline plan')
  const [monthly, setMonthly] = useState(2000)
  const [rate, setRate] = useState(6)
  const [horizon, setHorizon] = useState(25)
  const [target, setTarget] = useState(1500000)
  const [cash, setCash] = useState('')
  const [include, setInclude] = useState(true)
  const [useOutlook, setUseOutlook] = useState(false)
  const [allocation, setAllocation] = useState(100)
  const [error, setError] = useState('')
  const snapshot = eligible.find((s) => s.id === snapshotId)
  const captured = captureOutlook(outlook, allocation / 100)
  const drain = sumDollars(commitments, (c) =>
    sumDollars(commitmentYearSchedule(c, new Date().getFullYear()))
  )
  const draft = snapshot
    ? {
        name,
        start_date: snapshot.snapshot_date,
        start_balance: investmentActual(snapshot),
        monthly_contribution: monthly,
        annual_return: rate / 100,
        horizon,
        retirement_target: target,
        emergency_cash_target: cash === '' ? null : Number(cash),
        starting_contributions_ytd: optionalActual(snapshot.investment_contributions_ytd),
        annual_commitment_drain: drain,
        include_commitments: include,
        annual_contributions:
          useOutlook && captured
            ? include
              ? captured.withCommitments
              : captured.withoutCommitments
            : {},
        annual_contributions_without_commitments:
          useOutlook && captured ? captured.withoutCommitments : {},
      }
    : null
  let preview = null
  try {
    if (draft) preview = buildPlanSeries(validatePlan(draft))
  } catch {
    /* Invalid draft fields are explained on submit. */
  }
  async function submit(e) {
    e.preventDefault()
    setError('')
    try {
      await onSave(validatePlan(draft))
    } catch (err) {
      setError(err.message)
    }
  }
  return (
    <form className="wealth-panel" onSubmit={submit}>
      <div className="wealth-row">
        <h3>Save a new baseline</h3>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="wealth-muted">
        The starting snapshot is the close of its recorded date; contributions and growth start
        afterward. Saved versions keep their assumptions fixed. Editing these inputs creates a new
        plan; it never changes an existing benchmark.
      </p>
      {!eligible.length ? (
        <p>
          Add a dated snapshot with both investment and retirement balances (known zero is valid) to
          create a plan.
        </p>
      ) : (
        <>
          <div className="wealth-fields">
            <label>
              Plan name
              <input
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Starting snapshot
              <select value={snapshotId} onChange={(e) => setSnapshotId(e.target.value)}>
                {eligible.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.snapshot_date} · {fmtFull(investmentActual(s))}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Monthly investment net deposits
              <input
                required
                type="number"
                step="0.01"
                value={monthly}
                onChange={(e) => setMonthly(Number(e.target.value))}
              />
            </label>
            <label>
              Annual return (%)
              <input
                required
                type="number"
                min="0"
                max="12"
                step="0.1"
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
              />
            </label>
            <label>
              Horizon (years)
              <input
                required
                type="number"
                min="5"
                max="40"
                value={horizon}
                onChange={(e) => setHorizon(Number(e.target.value))}
              />
            </label>
            <label>
              Retirement investment target
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={target}
                onChange={(e) => setTarget(Number(e.target.value))}
              />
            </label>
            <label>
              Emergency cash target (optional)
              <input
                type="number"
                min="0"
                step="0.01"
                value={cash}
                onChange={(e) => setCash(e.target.value)}
              />
            </label>
          </div>
          <label className="wealth-check">
            <input
              type="checkbox"
              checked={include}
              onChange={(e) => setInclude(e.target.checked)}
            />{' '}
            Include commitment drain · {fmtFull(drain)}/year outside outlook years
          </label>
          <label className="wealth-check">
            <input
              type="checkbox"
              checked={useOutlook && !!captured}
              disabled={!captured}
              onChange={(e) => setUseOutlook(e.target.checked)}
            />{' '}
            Capture 5-year outlook
          </label>
          {!captured && (
            <p className="wealth-muted">
              Outlook unavailable: needs a loaded budget and income. Manual contributions remain
              available.
            </p>
          )}
          {useOutlook && captured && (
            <>
              <label>
                Positive outlook savings invested (%)
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={allocation}
                  onChange={(e) => setAllocation(Number(e.target.value))}
                />
              </label>
              <p className="wealth-muted">
                {allocation}% of positive net savings becomes investments; the remainder stays cash
                and is not an emergency-cash actual. Negative net savings becomes a full investment
                withdrawal. Captured calendar years:{' '}
                {Object.keys(captured.withCommitments).join(', ')}. Monthly input applies to other
                years.
              </p>
            </>
          )}
          {preview && (
            <p>
              Preview at {preview.end_date}:{' '}
              <strong>{fmtFull(preview.monthly.at(-1).balance)}</strong> · without commitments:{' '}
              {fmtFull(
                buildPlanSeries(
                  { ...draft, include_commitments: false },
                  { withoutCommitments: true }
                ).monthly.at(-1).balance
              )}
            </p>
          )}
          <button disabled={saving} type="submit" style={primaryBtn}>
            {saving ? 'Saving…' : 'Save baseline version'}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </form>
  )
}

export default function Wealth({ userId, mobile }) {
  const [snapshots, setSnapshots] = useState([]),
    [plans, setPlans] = useState([]),
    [commitments, setCommitments] = useState([])
  const [selection, setSelection] = useState({ userId: null, id: '' }),
    [dataUserId, setDataUserId] = useState(null),
    [outlook, setOutlook] = useState(null),
    [loading, setLoading] = useState(true)
  const [error, setError] = useState(''),
    [planError, setPlanError] = useState(''),
    [saving, setSaving] = useState(false)
  const [snapshotForm, setSnapshotForm] = useState(null),
    [newPlan, setNewPlan] = useState(false)
  const [tab, setTab] = useState('annual'),
    [year, setYear] = useState(new Date().getFullYear()),
    [month, setMonth] = useState(new Date().getMonth())
  const [from, setFrom] = useState(new Date().getFullYear()),
    [to, setTo] = useState(new Date().getFullYear() + 5),
    [checkpoint, setCheckpoint] = useState(new Date().getFullYear()),
    [metric, setMetric] = useState('balance'),
    [compareCommitments, setCompareCommitments] = useState(false)
  const selectionRef = useRef({ userId: null, id: '' })
  const activeUserRef = useRef(null)
  const readRevision = useRef(0)
  const choosePlan = useCallback(
    (id) => {
      const next = { userId, id }
      selectionRef.current = next
      setSelection(next)
      storeSelectedPlanId(userId, id)
    },
    [userId]
  )
  const applyResults = useCallback(
    (results) => {
      if (activeUserRef.current !== userId) return
      setDataUserId(userId)
      setError('')
      if (results[0].status === 'fulfilled') setSnapshots(results[0].value)
      else {
        setSnapshots([])
        setError(results[0].reason.message)
      }
      if (results[1].status === 'fulfilled') {
        const rows = results[1].value
        const preferred =
          selectionRef.current.userId === userId
            ? selectionRef.current.id
            : readSelectedPlanId(userId)
        choosePlan(resolveSelectedPlanId(rows, preferred))
        setPlans(rows)
        setPlanError('')
      } else {
        setPlans([])
        setPlanError(results[1].reason.message)
      }
      if (results[2].status === 'fulfilled') setCommitments(results[2].value)
      else {
        setCommitments([])
        setError(results[2].reason.message)
      }
      setLoading(false)
    },
    [userId, choosePlan]
  )
  const load = useCallback(() => {
    const revision = ++readRevision.current
    return readWealthData(userId).then((results) => {
      if (revision === readRevision.current) applyResults(results)
    })
  }, [userId, applyResults])
  useEffect(() => {
    let cancelled = false
    activeUserRef.current = userId
    const revision = ++readRevision.current
    readWealthData(userId).then((results) => {
      if (!cancelled && revision === readRevision.current) applyResults(results)
    })
    return () => {
      cancelled = true
      activeUserRef.current = null
    }
  }, [userId, applyResults])
  useEffect(() => {
    let cancelled = false
    loadOutlookInputs(userId, { curYear: new Date().getFullYear() })
      .then((i) => {
        if (!cancelled) setOutlook(buildOutlook(i))
      })
      .catch(() => {
        if (!cancelled) setOutlook(null)
      })
    return () => {
      cancelled = true
    }
  }, [userId])
  const actuals = useMemo(
    () => (dataUserId === userId ? latestSnapshots(snapshots) : []),
    [snapshots, dataUserId, userId]
  )
  const visiblePlans = dataUserId === userId ? plans : []
  const plan =
    visiblePlans.find((p) => p.id === (selection.userId === userId ? selection.id : '')) ||
    visiblePlans[0] ||
    null
  const series = useMemo(() => (plan ? buildPlanSeries(plan) : null), [plan])
  const withoutSeries = useMemo(
    () => (plan ? buildPlanSeries(plan, { withoutCommitments: true }) : null),
    [plan]
  )
  const latest = actuals[0]
  const yearlyActual = actuals.find((s) => +s.snapshot_date.slice(0, 4) === checkpoint)
  const monthlyActual = actuals.find(
    (s) => s.snapshot_date.slice(0, 7) === `${year}-${String(month + 1).padStart(2, '0')}`
  )
  const sameDate = plan && monthlyActual ? expectedAt(plan, monthlyActual.snapshot_date) : null
  const yearSameDate = plan && yearlyActual ? expectedAt(plan, yearlyActual.snapshot_date) : null
  const yearEnd = plan ? expectedAt(plan, `${checkpoint}-12-31`) : null
  const monthExpected = plan ? expectedAt(plan, monthEnd(year, month)) : null
  const targetPoint = series?.monthly.find((p) => p.balance >= Number(plan.retirement_target))
  const firstYear = Math.min(
    new Date().getFullYear() - 2,
    ...actuals.map((s) => +s.snapshot_date.slice(0, 4)),
    plan ? +plan.start_date.slice(0, 4) : 3000
  )
  const lastYear = Math.max(
    new Date().getFullYear() + 5,
    series ? +series.end_date.slice(0, 4) : 0,
    ...actuals.map((s) => +s.snapshot_date.slice(0, 4))
  )
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i)
  const selectYear = (label, value, change, options = years) => (
    <label>
      {label}
      <select value={value} onChange={(e) => change(Number(e.target.value))}>
        {options.map((y) => (
          <option key={y}>{y}</option>
        ))}
      </select>
    </label>
  )
  async function saveSnapshot(payload) {
    setSaving(true)
    try {
      await saveWealthSnapshot(userId, payload)
      setSnapshotForm(null)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }
  async function savePlan(payload) {
    setSaving(true)
    try {
      const p = await saveWealthPlan(payload)
      if (activeUserRef.current !== userId) return
      // Reads started before this insert can lack the saved row; discard them.
      readRevision.current++
      setPlans((old) => [p, ...old])
      choosePlan(p.id)
      setNewPlan(false)
      setFrom(+p.start_date.slice(0, 4))
      setTo(+p.start_date.slice(0, 4) + Math.min(5, p.horizon))
      setCheckpoint(+p.start_date.slice(0, 4))
      setYear(+p.start_date.slice(0, 4))
      setMonth(+p.start_date.slice(5, 7) - 1)
    } finally {
      setSaving(false)
    }
  }
  async function removeSnapshot(id) {
    try {
      await deleteWealthSnapshot(id)
      // A later plan save can discard load()'s result, so drop the row locally too.
      if (activeUserRef.current === userId) setSnapshots((old) => old.filter((s) => s.id !== id))
      await load()
    } catch (e) {
      setError(e.message)
    }
  }
  const monthlyPlanned = Array.from({ length: 12 }, (_, i) => {
    const date = monthEnd(year, i),
      p = plan ? expectedAt(plan, date) : null
    return {
      date,
      value:
        metric === 'cash'
          ? p
            ? optionalActual(plan.emergency_cash_target)
            : null
          : metric === 'contributions'
            ? p?.contributions_ytd
            : p?.balance,
    }
  })
  const monthlyRecorded = actuals
    .filter((s) => +s.snapshot_date.slice(0, 4) === year)
    .map((s) => ({
      date: s.snapshot_date,
      value:
        metric === 'balance'
          ? investmentActual(s)
          : optionalActual(
              s[metric === 'cash' ? 'emergency_cash' : 'investment_contributions_ytd']
            ),
    }))
  const monthlyWithout = Array.from({ length: 12 }, (_, i) => {
    const date = monthEnd(year, i)
    return {
      date,
      value: plan ? expectedAt(plan, date, { withoutCommitments: true })?.balance : null,
    }
  })
  const comparisonToggle = (
    <label className="wealth-check">
      <input
        type="checkbox"
        checked={compareCommitments}
        onChange={(e) => setCompareCommitments(e.target.checked)}
      />{' '}
      Show projection without commitments · actual variance still uses the saved baseline
    </label>
  )
  const annualRecorded = actuals.map((s) => ({ date: s.snapshot_date, value: investmentActual(s) }))
  const annualPlanned = series?.monthly.map((p) => ({ date: p.date, value: p.balance })) || []
  return (
    <div
      className="wealth-module"
      style={{ maxWidth: CONTENT_MAX, width: '100%', margin: '0 auto' }}
    >
      <ModuleHeader
        moduleId="wealth"
        mobile={mobile}
        icon="↗"
        title="Wealth Trajectory"
        subtitle="Your future plan, checked against actual progress"
        actions={
          <button
            style={primaryBtn}
            onClick={() => setSnapshotForm(new Date().toISOString().slice(0, 10))}
          >
            + Add snapshot
          </button>
        }
      />
      {error && (
        <p role="alert" className="wealth-error">
          {error}
        </p>
      )}
      {planError && (
        <p role="alert" className="wealth-error">
          {planError}
        </p>
      )}
      {loading || dataUserId !== userId ? (
        <p>Loading wealth data…</p>
      ) : (
        <>
          {snapshotForm && (
            <SnapshotForm
              key={snapshotForm}
              initialDate={snapshotForm}
              onSave={saveSnapshot}
              onCancel={() => setSnapshotForm(null)}
              saving={saving}
            />
          )}
          <div className="wealth-baseline">
            <div className="wealth-row">
              <div>
                <strong>{plan?.name || 'Create your saved baseline'}</strong>
                <p>
                  {plan
                    ? `Starts ${plan.start_date} · Investments + retirement ${fmtFull(plan.start_balance)}`
                    : 'Add a complete investment snapshot, then save fixed assumptions to benchmark progress.'}
                </p>
              </div>
              <div>
                {plan && (
                  <>
                    {Number(plan.annual_return) * 100}% return ·{' '}
                    {fmtFull(plan.monthly_contribution)}/month
                    <br />
                    Emergency cash target {fmtFull(optionalActual(plan.emergency_cash_target))}
                  </>
                )}
                <br />
                <button onClick={() => setNewPlan(true)}>Save new baseline</button>
              </div>
            </div>
            {plan && (
              <>
                <div className="wealth-row">
                  <label>
                    Saved version
                    <select value={plan.id} onChange={(e) => choosePlan(e.target.value)}>
                      {plans.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.name} · {p.start_date} · saved {String(p.created_at).slice(0, 10)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span>
                    {plan.horizon}-year horizon · investment target{' '}
                    {fmtFull(plan.retirement_target)}
                    <br />
                    Target reached {targetPoint?.date || 'beyond saved horizon'}
                  </span>
                </div>
                <p className="wealth-muted">
                  Frozen assumptions · {plan.include_commitments ? 'includes' : 'excludes'}{' '}
                  commitment drain · captured outlook years{' '}
                  {Object.keys(plan.annual_contributions).join(', ') || 'none'} · actuals from
                  manually recorded dated snapshots.
                </p>
              </>
            )}
            <p>
              Latest recorded net worth:{' '}
              <strong>{fmtFull(optionalActual(latest?.net_worth))}</strong>
              {latest ? ` · ${latest.snapshot_date}` : ''}
            </p>
          </div>
          {newPlan && (
            <NewPlan
              snapshots={actuals}
              outlook={outlook}
              commitments={commitments}
              onSave={savePlan}
              onCancel={() => setNewPlan(false)}
              saving={saving}
            />
          )}
          <div className="wealth-tabs" role="tablist" aria-label="Wealth views">
            {[
              ['annual', 'Annual outlook'],
              ['monthly', 'Monthly check-in'],
            ].map(([key, title]) => (
              <button
                key={key}
                id={`wealth-${key}-tab`}
                aria-controls={`wealth-${key}`}
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
              >
                {title}
              </button>
            ))}
          </div>
          {tab === 'annual' ? (
            <section role="tabpanel" id="wealth-annual" aria-labelledby="wealth-annual-tab">
              <div className="wealth-row">
                <h3>Annual outlook</h3>
                <div className="wealth-pickers">
                  {selectYear('From', from, (v) => {
                    setFrom(v)
                    if (v > to) setTo(v)
                  })}
                  {selectYear('To', to, (v) => {
                    setTo(v)
                    if (v < from) setFrom(v)
                  })}
                  {selectYear('Checkpoint year', checkpoint, setCheckpoint)}
                </div>
              </div>
              <p className="wealth-muted">
                January {from} – December {to} · {to - from + 1} calendar years. Changing the
                display keeps your baseline fixed.
              </p>
              <div className="wealth-benchmarks">
                <div className="wealth-benchmark">
                  <h3>Year-end investments</h3>
                  <div className="wealth-amount">{fmtFull(yearEnd?.balance)}</div>
                  <p>Expected December 31, {checkpoint}</p>
                </div>
                <div className="wealth-benchmark">
                  <h3>Contributions · planned YTD</h3>
                  <div className="wealth-amount">{fmtFull(yearEnd?.contributions_ytd)}</div>
                  <p>
                    {yearEnd?.contributions_ytd == null
                      ? 'Full-year expectation unavailable; planned since baseline ' +
                        fmtFull(yearEnd?.contribution)
                      : 'Through December 31'}
                  </p>
                </div>
                <div className="wealth-benchmark">
                  <h3>Emergency cash target</h3>
                  <div className="wealth-amount">
                    {fmtFull(yearEnd ? optionalActual(plan.emergency_cash_target) : null)}
                  </div>
                  <p>Independent reserve target</p>
                </div>
              </div>
              <div className="wealth-annual-actuals">
                <Benchmark
                  title="Recorded investment actual"
                  actual={investmentActual(yearlyActual)}
                  expected={yearSameDate?.balance}
                  note={
                    yearlyActual
                      ? `As of ${yearlyActual.snapshot_date} · expected ${fmtFull(yearSameDate?.balance)}`
                      : 'No snapshot for this year'
                  }
                />
                <Benchmark
                  title="Recorded contributions · YTD"
                  actual={optionalActual(yearlyActual?.investment_contributions_ytd)}
                  expected={yearSameDate?.contributions_ytd}
                  note={`Same-date expectation ${fmtFull(yearSameDate?.contributions_ytd)} · manually recorded net deposits`}
                />
                <Benchmark
                  title="Recorded emergency cash"
                  actual={optionalActual(yearlyActual?.emergency_cash)}
                  expected={yearSameDate ? optionalActual(plan.emergency_cash_target) : null}
                  note={`Same-date reserve target ${fmtFull(yearSameDate ? optionalActual(plan.emergency_cash_target) : null)}`}
                />
              </div>
              <p className="wealth-muted">
                {yearlyActual
                  ? `Actual checkpoint ${yearlyActual.snapshot_date} · ${yearlyActual.snapshot_date.endsWith('-12-31') ? 'year-end recorded' : 'incomplete year; latest recorded date'}`
                  : 'No actual date to compare'}
                .{' '}
                {yearlyActual?.snapshot_date === `${checkpoint}-12-31`
                  ? 'Year-end investment variance: ' +
                    gap(investmentActual(yearlyActual), yearEnd?.balance)
                  : 'No December 31 actual recorded; year-end forecast stays visible.'}
              </p>
              {plan && comparisonToggle}
              <WealthChart
                comparison={
                  compareCommitments
                    ? withoutSeries?.monthly.map((p) => ({ date: p.date, value: p.balance }))
                    : []
                }
                planned={annualPlanned}
                actual={annualRecorded}
                start={`${from}-01-01`}
                end={`${to}-12-31`}
                title="Annual investment plan and recorded actuals"
              />
            </section>
          ) : (
            <section role="tabpanel" id="wealth-monthly" aria-labelledby="wealth-monthly-tab">
              <div className="wealth-row">
                <h3>Monthly check-in</h3>
                <div className="wealth-pickers">
                  {selectYear('Year', year, setYear)}
                  <label>
                    Month
                    <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                      {months.map((m, i) => (
                        <option value={i} key={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              <p className="wealth-muted">
                {monthlyActual
                  ? `Actual checkpoint: ${monthlyActual.snapshot_date}`
                  : `No snapshot in ${months[month]} ${year}. Actuals are not carried forward.`}
              </p>
              <div className="wealth-benchmarks">
                <Benchmark
                  title="Investment balance"
                  actual={investmentActual(monthlyActual)}
                  expected={sameDate?.balance}
                  note={`Same-date expectation ${fmtFull(sameDate?.balance)} · month-end plan ${fmtFull(monthExpected?.balance)}`}
                />
                <Benchmark
                  title="Investment net deposits · YTD"
                  actual={optionalActual(monthlyActual?.investment_contributions_ytd)}
                  expected={sameDate?.contributions_ytd}
                  note={
                    sameDate?.contributions_ytd == null
                      ? `YTD expectation unavailable · planned since baseline ${fmtFull(sameDate?.contribution)}`
                      : `Expected at checkpoint ${fmtFull(sameDate.contributions_ytd)} · manually recorded net deposits`
                  }
                />
                <Benchmark
                  title="Emergency cash"
                  actual={optionalActual(monthlyActual?.emergency_cash)}
                  expected={sameDate ? optionalActual(plan.emergency_cash_target) : null}
                  note={`Same-date reserve target ${fmtFull(sameDate ? optionalActual(plan.emergency_cash_target) : null)} · separate from investments`}
                />
              </div>
              <div className="wealth-row">
                <label>
                  Chart
                  <select value={metric} onChange={(e) => setMetric(e.target.value)}>
                    <option value="balance">Investments</option>
                    <option value="contributions">Contributions · YTD</option>
                    <option value="cash">Emergency cash</option>
                  </select>
                </label>
                <button
                  onClick={() =>
                    setSnapshotForm(`${year}-${String(month + 1).padStart(2, '0')}-01`)
                  }
                >
                  Record dated snapshot
                </button>
              </div>
              {plan && metric === 'balance' && comparisonToggle}
              <WealthChart
                comparison={compareCommitments && metric === 'balance' ? monthlyWithout : []}
                monthly
                planned={monthlyPlanned}
                actual={monthlyRecorded}
                start={`${year}-01-01`}
                end={`${year}-12-31`}
                title={`Monthly ${metric} plan and actuals`}
              />
              <p className="wealth-muted">
                12 months · dots use their exact recorded dates. Missing actuals stay blank. Balance
                and contribution gaps are distinct; market performance is not inferred. No
                projection outside the saved horizon.
              </p>
            </section>
          )}
          <div className="wealth-panel">
            <h3>Snapshot history</h3>
            {snapshots.length === 0 ? (
              <p>No snapshots yet.</p>
            ) : (
              snapshots.map((s) => (
                <div className="wealth-history" key={s.id}>
                  <span>
                    {s.snapshot_date}
                    {s.snapshot_date > new Date().toISOString().slice(0, 10)
                      ? ' · future, excluded from actuals'
                      : ''}
                  </span>
                  <span>
                    Net worth {fmtFull(optionalActual(s.net_worth))}
                    <br />
                    Investments {fmtFull(investmentActual(s))}
                  </span>
                  <span>
                    Cash {fmtFull(optionalActual(s.emergency_cash))}
                    <br />
                    YTD deposits {fmtFull(optionalActual(s.investment_contributions_ytd))}
                  </span>
                  <button
                    onClick={() => {
                      if (window.confirm(`Delete snapshot dated ${s.snapshot_date}?`))
                        removeSnapshot(s.id)
                    }}
                  >
                    Delete
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

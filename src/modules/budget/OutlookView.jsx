import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { loadOutlookInputs } from '../../lib/outlook/loadOutlook.js'
import {
  buildOutlook,
  expenseGroups,
  DEFAULT_INFLATION,
  computeCushion,
} from '../../lib/outlook/outlookEngine.js'
import {
  saveOutlookAssumptions,
  createOutlookEvent,
  updateOutlookEvent,
  deleteOutlookEvent,
  getScenarioOutlookAdjustments,
} from '../../lib/db/outlook.js'

const CUR_YEAR = new Date().getFullYear()
const CUSHION_KEY = 'outlook.cushion.v1'
const DEFAULT_FLOOR = 25000

function loadCushionSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(CUSHION_KEY))
    const floor = saved?.floor
    const startCash = saved?.startCash
    return {
      floor: typeof floor === 'number' && Number.isFinite(floor) ? floor : DEFAULT_FLOOR,
      startCash: typeof startCash === 'number' && Number.isFinite(startCash) ? startCash : null,
    }
  } catch {
    return { floor: DEFAULT_FLOOR, startCash: null }
  }
}

const fmtFull = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n || 0)).toLocaleString()
const fmtSigned = (n) => (n < 0 ? '−$' : '+$') + Math.abs(Math.round(n)).toLocaleString()
const fmtPct = (r) => `${Math.round(r * 1000) / 10}%`

const mono = { fontFamily: "'DM Mono', monospace", fontVariantNumeric: 'tabular-nums' }
const fieldStyle = {
  padding: '7px 9px',
  background: 'var(--field)',
  border: '1px solid var(--bd)',
  borderRadius: 6,
  color: 'var(--tx-1)',
  fontSize: 12.5,
  outline: 'none',
  boxSizing: 'border-box',
}
const smallBtn = {
  padding: '6px 12px',
  background: 'transparent',
  color: 'var(--tx-2)',
  border: '1px solid var(--bd)',
  borderRadius: 6,
  fontSize: 12,
  cursor: 'pointer',
}
const primarySmall = {
  padding: '7px 14px',
  background: 'var(--accent)',
  color: 'var(--accent-tx-on)',
  border: 'none',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
}
const th = {
  ...mono,
  fontSize: 10,
  fontWeight: 500,
  color: 'var(--tx-3)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  textAlign: 'right',
  padding: '10px 12px',
  whiteSpace: 'nowrap',
}
const td = {
  padding: '10px 12px',
  textAlign: 'right',
  fontSize: 13,
  color: 'var(--tx-1)',
  whiteSpace: 'nowrap',
  ...mono,
}
const rowLabel = {
  padding: '10px 12px',
  textAlign: 'left',
  fontSize: 13,
  color: 'var(--tx-1)',
  whiteSpace: 'nowrap',
}

// "4" / "4.5" / "-2" -> 0.04; '' -> null (no value); anything else -> NaN.
function parsePct(text) {
  const t = String(text).trim().replace('%', '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n / 100 : NaN
}
const toPctText = (r) => (r == null ? '' : String(Math.round(r * 1000) / 10))

function PctInput({
  value,
  placeholder,
  onCommit,
  busy,
  width = 64,
  ariaLabel,
  allowClear = false,
}) {
  const [draft, setDraft] = useState(toPctText(value))
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    setDraft(toPctText(value))
  }

  function commit() {
    if (busy) return
    const parsed = parsePct(draft)
    if (Number.isNaN(parsed) || (parsed === null && !allowClear)) {
      setDraft(toPctText(value))
      return
    }
    if (parsed === (value ?? null)) return
    onCommit(parsed)
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <input
        value={draft}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        inputMode="decimal"
        style={{ ...fieldStyle, ...mono, width, textAlign: 'right', opacity: busy ? 0.6 : 1 }}
      />
      <span style={{ ...mono, fontSize: 12, color: 'var(--tx-3)' }}>%</span>
    </span>
  )
}

function EventForm({ editing, years, groups, busy, onSubmit, onCancel }) {
  const [year, setYear] = useState(editing?.year ?? years[1] ?? years[0])
  const [group, setGroup] = useState(editing?.group_name ?? groups[0] ?? '')
  const [name, setName] = useState(editing?.name ?? '')
  const [amount, setAmount] = useState(editing ? String(editing.amount) : '')
  const [err, setErr] = useState('')

  const yearOptions = years.includes(year) ? years : [year, ...years]
  const groupOptions = groups.includes(group) || !group ? groups : [group, ...groups]

  async function submit(e) {
    e.preventDefault()
    setErr('')
    const amt = parseFloat(amount)
    if (!name.trim()) return setErr('Enter a name.')
    if (!group) return setErr('Pick a group.')
    if (!Number.isFinite(amt)) return setErr('Enter an amount.')
    try {
      await onSubmit({ year: Number(year), group_name: group, name: name.trim(), amount: amt })
    } catch (ex) {
      setErr(ex.message)
    }
  }

  return (
    <form
      onSubmit={submit}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--bd)',
        borderRadius: 8,
        padding: 14,
        marginTop: 12,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: 8,
          marginBottom: 10,
        }}
      >
        <label style={{ fontSize: 11, color: 'var(--tx-2)' }}>
          Year
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            style={{ ...fieldStyle, width: '100%', marginTop: 4 }}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 11, color: 'var(--tx-2)' }}>
          Group
          <select
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            style={{ ...fieldStyle, width: '100%', marginTop: 4 }}
          >
            {groupOptions.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 11, color: 'var(--tx-2)' }}>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            placeholder="e.g. Kyoto Cherry Blossom"
            style={{ ...fieldStyle, width: '100%', marginTop: 4 }}
          />
        </label>
        <label style={{ fontSize: 11, color: 'var(--tx-2)' }}>
          Amount (spend)
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            style={{ ...fieldStyle, ...mono, width: '100%', marginTop: 4 }}
          />
        </label>
      </div>
      {err && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="submit"
          disabled={busy}
          style={{
            ...primarySmall,
            opacity: busy ? 0.6 : 1,
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? 'Saving…' : editing ? 'Save event' : 'Add event'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} style={smallBtn}>
          Cancel
        </button>
      </div>
    </form>
  )
}

export default function OutlookView({ userId, mobile, initialScenarioId = null }) {
  const [inputs, setInputs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [scenarioId, setScenarioId] = useState('')
  const [selectedAdjustments, setSelectedAdjustments] = useState([])
  const [scenarioBusy, setScenarioBusy] = useState(false)

  const [saving, setSaving] = useState(null)
  const [eventForm, setEventForm] = useState(null)
  const [eventBusy, setEventBusy] = useState(false)

  // Affordability state
  const [cushionFloor, setCushionFloor] = useState(() => loadCushionSettings().floor)
  const [startCash, setStartCash] = useState(() => loadCushionSettings().startCash)
  const [tableExpanded, setTableExpanded] = useState(false) // Default collapsed
  const [hoveredPoint, setHoveredPoint] = useState(null)
  const [inspectCell, setInspectCell] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [disabledEvents, setDisabledEvents] = useState(new Set())
  const [eventOrder, setEventOrder] = useState([])
  const [draggedId, setDraggedId] = useState(null)

  const pickSeq = useRef(0)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    return loadOutlookInputs(userId, { curYear: CUR_YEAR })
      .then(setInputs)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [userId])

  useEffect(() => {
    let cancelled = false
    loadOutlookInputs(userId, { curYear: CUR_YEAR })
      .then(async (res) => {
        if (cancelled) return
        setInputs(res)
        const target =
          initialScenarioId &&
          res.scenarios.find(
            (s) => s.id === initialScenarioId && (s.state === 'modeled' || s.state === 'idea')
          )
        if (!target) return
        const seq = ++pickSeq.current
        setScenarioId(target.id)
        try {
          const rows = await getScenarioOutlookAdjustments(target.id)
          if (!cancelled && seq === pickSeq.current) setSelectedAdjustments(rows)
        } catch (e) {
          if (!cancelled && seq === pickSeq.current) {
            setError(e.message)
            setScenarioId('')
          }
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [userId, initialScenarioId])

  async function pickScenario(id) {
    const seq = ++pickSeq.current
    setScenarioId(id)
    setSelectedAdjustments([])
    if (!id) {
      setScenarioBusy(false)
      return
    }
    setScenarioBusy(true)
    setError(null)
    try {
      const rows = await getScenarioOutlookAdjustments(id)
      if (seq === pickSeq.current) setSelectedAdjustments(rows)
    } catch (e) {
      if (seq === pickSeq.current) {
        setError(e.message)
        setScenarioId('')
      }
    } finally {
      if (seq === pickSeq.current) setScenarioBusy(false)
    }
  }

  // Filter out toggled-off events from the math
  const activeEvents = useMemo(() => {
    if (!inputs?.events) return []
    return inputs.events.filter((e) => !disabledEvents.has(e.id))
  }, [inputs, disabledEvents])

  const outlook = useMemo(
    () => (inputs ? buildOutlook({ ...inputs, events: activeEvents, selectedAdjustments }) : null),
    [inputs, activeEvents, selectedAdjustments]
  )

  const groupNames = useMemo(() => expenseGroups(inputs?.categories ?? []), [inputs])
  const pickableScenarios = useMemo(
    () => (inputs?.scenarios ?? []).filter((s) => s.state === 'modeled' || s.state === 'idea'),
    [inputs]
  )

  useEffect(() => {
    try {
      localStorage.setItem(CUSHION_KEY, JSON.stringify({ floor: cushionFloor, startCash }))
    } catch {
      /* storage unavailable */
    }
  }, [cushionFloor, startCash])

  const cushionAnalysis = useMemo(() => {
    if (!outlook || outlook.empty) return null
    return computeCushion({
      netSavings: outlook.netSavings,
      startCash,
      floor: cushionFloor,
    })
  }, [outlook, startCash, cushionFloor])

  // Manage ordering of events for drag-and-drop
  const orderedEvents = useMemo(() => {
    if (!inputs?.events) return []
    const list = [...inputs.events]
    if (!eventOrder.length) return list.sort((a, b) => a.year - b.year)
    const map = new Map(list.map((e) => [e.id, e]))
    const sorted = []
    for (const id of eventOrder) {
      if (map.has(id)) {
        sorted.push(map.get(id))
        map.delete(id)
      }
    }
    for (const remaining of map.values()) sorted.push(remaining)
    return sorted
  }, [inputs, eventOrder])

  function toggleEventActive(id) {
    setDisabledEvents((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleDragStart(id) {
    setDraggedId(id)
  }

  function handleDrop(targetId) {
    if (!draggedId || draggedId === targetId) return
    const ids = orderedEvents.map((e) => e.id)
    const fromIdx = ids.indexOf(draggedId)
    const toIdx = ids.indexOf(targetId)
    if (fromIdx !== -1 && toIdx !== -1) {
      const newOrder = [...ids]
      newOrder.splice(fromIdx, 1)
      newOrder.splice(toIdx, 0, draggedId)
      setEventOrder(newOrder)
    }
    setDraggedId(null)
  }

  async function saveAssumptions(key, patch) {
    setSaving(key)
    setError(null)
    try {
      const saved = await saveOutlookAssumptions(patch)
      setInputs((prev) => ({ ...prev, assumptions: saved }))
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(null)
    }
  }

  async function submitEvent(data) {
    setEventBusy(true)
    try {
      if (eventForm && eventForm !== 'new') {
        const saved = await updateOutlookEvent(eventForm.id, data)
        setInputs((prev) => ({
          ...prev,
          events: prev.events.map((e) => (e.id === saved.id ? saved : e)),
        }))
      } else {
        const saved = await createOutlookEvent(data)
        setInputs((prev) => ({ ...prev, events: [...prev.events, saved] }))
      }
      setEventForm(null)
    } finally {
      setEventBusy(false)
    }
  }

  async function removeEvent(ev) {
    if (!window.confirm(`Delete "${ev.name}" (${ev.year})?`)) return
    setEventBusy(true)
    setError(null)
    try {
      await deleteOutlookEvent(ev.id)
      setInputs((prev) => ({ ...prev, events: prev.events.filter((e) => e.id !== ev.id) }))
    } catch (e) {
      setError(e.message)
    } finally {
      setEventBusy(false)
    }
  }

  if (loading)
    return <div style={{ color: 'var(--tx-3)', fontSize: 14, padding: 32 }}>Loading outlook…</div>
  if (error && !inputs) {
    return (
      <div
        style={{
          padding: '12px 16px',
          background: 'var(--warn-bg)',
          border: '1px solid var(--warn)',
          borderRadius: 8,
          color: 'var(--tx-1)',
          fontSize: 13,
        }}
      >
        {error}{' '}
        <button onClick={load} style={{ ...smallBtn, marginLeft: 8 }}>
          Retry
        </button>
      </div>
    )
  }

  if (outlook.empty) {
    return (
      <div
        style={{
          border: '1px dashed var(--bd)',
          borderRadius: 12,
          padding: '48px 28px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontFamily: "'DM Serif Display', serif",
            fontSize: 18,
            color: 'var(--tx-1)',
            marginBottom: 10,
          }}
        >
          No budget to project from yet
        </div>
        <div
          style={{
            fontSize: 13.5,
            color: 'var(--tx-2)',
            lineHeight: 1.6,
            maxWidth: 460,
            margin: '0 auto',
          }}
        >
          Build the {outlook.nextYear} budget first (switch to Detailed). The outlook compounds that
          budget forward by group for the four years after it.
        </div>
      </div>
    )
  }

  const { columns } = outlook
  const assumptions = inputs.assumptions
  const years = columns.map((c) => c.year)
  const cushionReady = !!cushionAnalysis && !cushionAnalysis.incomplete
  const inflation = Number.isFinite(Number(assumptions?.inflation_rate))
    ? Number(assumptions.inflation_rate)
    : DEFAULT_INFLATION
  const incomeGrowth = Number(assumptions?.income_growth_rate)
  const scenarioActive = !!scenarioId
  const dash = <span style={{ color: 'var(--tx-3)' }}>—</span>

  // Chart coordinates
  const chartW = 700
  const chartH = 140
  const padX = 55
  const padY = 22
  const allChartVals = cushionReady ? [...cushionAnalysis.cushion, cushionFloor] : [cushionFloor]
  const maxVal = Math.max(...allChartVals) * 1.15
  const minVal = Math.min(0, Math.min(...allChartVals) * 0.9)
  const getY = (v) => chartH - padY - ((v - minVal) / (maxVal - minVal || 1)) * (chartH - 2 * padY)
  const getX = (idx) => padX + idx * ((chartW - 2 * padX) / (years.length - 1 || 1))
  const floorY = getY(cushionFloor)

  const pathD = cushionReady
    ? cushionAnalysis.cushion
        .map((v, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(v)}`)
        .join(' ')
    : ''

  return (
    <div>
      {error && (
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--warn-bg)',
            border: '1px solid var(--warn)',
            borderRadius: 8,
            color: 'var(--tx-1)',
            fontSize: 13,
            marginBottom: 14,
          }}
        >
          {error}
        </div>
      )}

      {outlook.baseMode === 'current' && (
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--accent-bg)',
            border: '1px solid var(--accent-bd, var(--accent))',
            borderRadius: 8,
            fontSize: 13,
            color: 'var(--tx-1)',
            marginBottom: 14,
          }}
        >
          Starting from the {outlook.baseYear} budget — build {outlook.nextYear} for a better base
        </div>
      )}

      {/* Top Hero: Affordability Verdict & Chart */}
      {cushionAnalysis && cushionAnalysis.incomplete && (
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--bd)',
            borderTop: '3px solid var(--warn)',
            borderRadius: 12,
            padding: 20,
            marginBottom: 24,
          }}
        >
          <div
            style={{
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--tx-3)',
              fontWeight: 600,
            }}
          >
            Affordability Verdict
          </div>
          <div
            style={{
              fontFamily: "'DM Serif Display', serif",
              fontSize: 22,
              color: 'var(--tx-1)',
              margin: '10px 0 6px',
            }}
          >
            {cushionAnalysis.reason === 'start-cash'
              ? 'Set your starting cash to see a verdict'
              : "Can't compute — add take-home income"}
          </div>
          <p style={{ fontSize: 13, color: 'var(--tx-2)', lineHeight: 1.5, margin: '0 0 12px' }}>
            {cushionAnalysis.reason === 'start-cash'
              ? 'The verdict needs the cash you are starting with. Enter it once and it is remembered on this device.'
              : 'Every projection year needs take-home income before the cash cushion can be calculated.'}
          </p>
          {cushionAnalysis.reason === 'start-cash' && (
            <button onClick={() => setSettingsOpen(true)} style={primarySmall}>
              Set starting cash
            </button>
          )}
        </div>
      )}

      {cushionReady && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: mobile ? '1fr' : '340px 1fr',
            gap: 18,
            marginBottom: 24,
          }}
        >
          {/* Verdict Card */}
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--bd)',
              borderTop: cushionAnalysis.isPass
                ? '3px solid var(--accent)'
                : '3px solid var(--bad)',
              borderRadius: 12,
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--tx-3)',
                  fontWeight: 600,
                }}
              >
                <span>Affordability Verdict</span>
                <span
                  style={{
                    padding: '3px 8px',
                    borderRadius: 6,
                    fontWeight: 700,
                    fontSize: 11,
                    background: cushionAnalysis.isPass ? 'var(--good-bg)' : 'var(--bad-bg)',
                    color: cushionAnalysis.isPass ? 'var(--good)' : 'var(--bad)',
                  }}
                >
                  {cushionAnalysis.isPass ? '✓ SAFE PLAN' : '⚠ CASH WARNING'}
                </span>
              </div>
              <div
                style={{
                  fontFamily: "'DM Serif Display', serif",
                  fontSize: 24,
                  color: 'var(--tx-1)',
                  margin: '10px 0 6px',
                }}
              >
                {cushionAnalysis.isPass ? 'Affordable' : 'Action Required'}
              </div>
              <p style={{ fontSize: 13, color: 'var(--tx-2)', lineHeight: 1.5, margin: 0 }}>
                {cushionAnalysis.isPass
                  ? `Your liquid cushion stays above your ${fmtFull(cushionFloor)} safety floor across all 5 projection years.`
                  : `Cash dips ${fmtFull(Math.abs(cushionAnalysis.buffer))} below your safety floor in ${years[cushionAnalysis.minIndex]}. Deselect an item or adjust timing.`}
              </p>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
                paddingTop: 14,
                borderTop: '1px solid var(--bd)',
                marginTop: 14,
              }}
            >
              <div>
                <div style={{ fontSize: 11, color: 'var(--tx-3)' }}>Lowest Cushion</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--accent)', ...mono }}>
                  {fmtFull(cushionAnalysis.minCushion)}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--tx-3)' }}>
                  in {years[cushionAnalysis.minIndex]}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--tx-3)' }}>Buffer vs Floor</div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: cushionAnalysis.isPass ? 'var(--good)' : 'var(--bad)',
                    ...mono,
                  }}
                >
                  {fmtSigned(cushionAnalysis.buffer)}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--tx-3)' }}>
                  vs {fmtFull(cushionFloor)}
                </div>
              </div>
            </div>
          </div>

          {/* Cushion vs Floor Chart Card */}
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--bd)',
              borderRadius: 12,
              padding: '16px 20px',
              position: 'relative',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 10,
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-1)' }}>
                  Running Cash Cushion vs Safety Floor
                </div>
                <div style={{ fontSize: 11, color: 'var(--tx-3)' }}>
                  Cumulative trajectory starting from {fmtFull(startCash)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--tx-3)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{ width: 12, height: 3, background: 'var(--accent)', borderRadius: 2 }}
                  />{' '}
                  Cushion
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 12, height: 0, borderTop: '2px dashed var(--warn)' }} />{' '}
                  Floor ({fmtFull(cushionFloor)})
                </span>
              </div>
            </div>

            {/* SVG Trajectory Chart */}
            <div style={{ position: 'relative', width: '100%', height: chartH }}>
              {/* Floating Hover Tooltip */}
              {hoveredPoint && (
                <div
                  style={{
                    position: 'absolute',
                    left: `${(hoveredPoint.x / chartW) * 100}%`,
                    top: `${(hoveredPoint.y / chartH) * 100}%`,
                    transform: 'translate(-50%, -100%)',
                    marginTop: -10,
                    background: 'rgba(19, 26, 30, 0.95)',
                    border: '1px solid var(--bd)',
                    borderRadius: 8,
                    padding: '8px 12px',
                    fontSize: 11.5,
                    pointerEvents: 'none',
                    zIndex: 20,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                    backdropFilter: 'blur(4px)',
                    minWidth: 165,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      borderBottom: '1px solid var(--bd)',
                      paddingBottom: 4,
                      marginBottom: 4,
                    }}
                  >
                    <strong style={{ color: 'var(--tx-1)' }}>{hoveredPoint.year}</strong>
                    <span style={{ color: 'var(--accent)', ...mono }}>
                      {fmtFull(hoveredPoint.cushion)}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      color: 'var(--tx-2)',
                      marginBottom: 2,
                    }}
                  >
                    <span>Est. Income:</span>
                    <span style={{ color: 'var(--good)', ...mono }}>
                      {hoveredPoint.inc == null ? '—' : fmtSigned(hoveredPoint.inc)}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      color: 'var(--tx-2)',
                      marginBottom: 4,
                    }}
                  >
                    <span>Est. Expenses:</span>
                    <span style={{ color: 'var(--bad)', ...mono }}>
                      −{fmtFull(hoveredPoint.exp)}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      borderTop: '1px dashed var(--bd)',
                      paddingTop: 4,
                      fontWeight: 600,
                      color: 'var(--tx-1)',
                    }}
                  >
                    <span>Net Annual:</span>
                    <span
                      style={{
                        color: hoveredPoint.net < 0 ? 'var(--bad)' : 'var(--accent)',
                        ...mono,
                      }}
                    >
                      {hoveredPoint.net == null ? '—' : fmtSigned(hoveredPoint.net)}
                    </span>
                  </div>
                </div>
              )}

              <svg
                viewBox={`0 0 ${chartW} ${chartH}`}
                preserveAspectRatio="none"
                style={{ width: '100%', height: '100%', overflow: 'visible' }}
              >
                {/* Dashed Safety Floor Line */}
                <line
                  x1={padX}
                  y1={floorY}
                  x2={chartW - padX}
                  y2={floorY}
                  stroke="var(--warn)"
                  strokeDasharray="5 4"
                  strokeWidth="1.5"
                />

                {/* Trajectory Path */}
                <path
                  d={pathD}
                  fill="none"
                  stroke={cushionAnalysis.isPass ? 'var(--accent)' : 'var(--bad)'}
                  strokeWidth="2.5"
                />

                {/* Yearly Points */}
                {cushionAnalysis.cushion.map((val, idx) => {
                  const x = getX(idx)
                  const y = getY(val)
                  const yr = years[idx]
                  const inc = outlook.income[idx]
                  const exp =
                    outlook.groupTotals[idx] + outlook.commitments[idx] + outlook.events[idx].total
                  const net = outlook.netSavings[idx]

                  return (
                    <g
                      key={yr}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={() =>
                        setHoveredPoint({ year: yr, cushion: val, inc, exp, net, x, y })
                      }
                      onMouseLeave={() => setHoveredPoint(null)}
                    >
                      <circle cx={x} cy={y} r="16" fill="transparent" />
                      <circle
                        cx={x}
                        cy={y}
                        r="5"
                        fill={val < cushionFloor ? 'var(--bad)' : 'var(--accent)'}
                        stroke="var(--bg-card)"
                        strokeWidth="2.5"
                      />
                      <text
                        x={x}
                        y={y - 9}
                        textAnchor="middle"
                        fill={val < cushionFloor ? 'var(--bad)' : 'var(--tx-1)'}
                        fontSize="11"
                        {...mono}
                      >
                        {fmtFull(val)}
                      </text>
                      <text
                        x={x}
                        y={chartH - 2}
                        textAnchor="middle"
                        fill="var(--tx-3)"
                        fontSize="10.5"
                        fontWeight="500"
                      >
                        {yr}
                      </text>
                    </g>
                  )
                })}
              </svg>
            </div>
          </div>
        </div>
      )}

      {/* Planning Initiatives Section with Draggable Cards */}
      <div style={{ marginBottom: 26 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            marginBottom: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx-1)' }}>
              🎯 Planned Initiatives & Milestones
            </span>
            <span
              style={{
                fontSize: 11,
                background: 'var(--field)',
                border: '1px solid var(--bd)',
                padding: '2px 8px',
                borderRadius: 12,
                color: 'var(--tx-2)',
                ...mono,
              }}
            >
              {activeEvents.length} Active
            </span>
            <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>(Drag cards to reorder)</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setSettingsOpen(true)} style={smallBtn}>
              ⚙ Floor & Drivers
            </button>
            {!eventForm && (
              <button onClick={() => setEventForm('new')} style={primarySmall}>
                + Plan Something
              </button>
            )}
          </div>
        </div>

        {eventForm && (
          <EventForm
            key={eventForm === 'new' ? 'new' : eventForm.id}
            editing={eventForm === 'new' ? null : eventForm}
            years={years}
            groups={groupNames}
            busy={eventBusy}
            onSubmit={submitEvent}
            onCancel={() => setEventForm(null)}
          />
        )}

        {/* Draggable Cards Grid */}
        {orderedEvents.length === 0 && !eventForm ? (
          <div style={{ fontSize: 13, color: 'var(--tx-3)', padding: '14px 0' }}>
            No planned initiatives. Add upcoming international trips, scholarships, or down
            payments.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
              gap: 12,
            }}
          >
            {orderedEvents.map((ev) => {
              const active = !disabledEvents.has(ev.id)
              return (
                <div
                  key={ev.id}
                  draggable
                  onDragStart={() => handleDragStart(ev.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDrop(ev.id)}
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--bd)',
                    borderStyle: active ? 'solid' : 'dashed',
                    opacity: active ? 1 : 0.55,
                    borderRadius: 10,
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: 10,
                    cursor: 'grab',
                    userSelect: 'none',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: 8,
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}
                      >
                        <span style={{ color: 'var(--tx-4)', fontSize: 11 }}>⠿</span>
                        <span
                          style={{
                            fontSize: 10.5,
                            fontWeight: 600,
                            color: 'var(--accent)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                          }}
                        >
                          {ev.group_name}
                        </span>
                      </div>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--tx-1)' }}>
                        {ev.name}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--tx-3)', marginTop: 2 }}>
                        Lands in {ev.year}
                      </div>
                    </div>
                    {/* Toggle Switch */}
                    <button
                      type="button"
                      onClick={() => toggleEventActive(ev.id)}
                      title={active ? 'Disable in outlook' : 'Enable in outlook'}
                      style={{
                        padding: '4px 8px',
                        background: active ? 'var(--accent)' : 'var(--field)',
                        color: active ? 'var(--accent-tx-on)' : 'var(--tx-3)',
                        border: '1px solid var(--bd)',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {active ? 'ON' : 'OFF'}
                    </button>
                  </div>

                  <div
                    style={{
                      background: 'var(--field)',
                      borderRadius: 6,
                      padding: '7px 10px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 11.5,
                    }}
                  >
                    <span style={{ color: 'var(--tx-2)' }}>Capital Outlay</span>
                    <span style={{ color: 'var(--tx-1)', fontWeight: 600, ...mono }}>
                      {fmtFull(ev.amount)}
                    </span>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      borderTop: '1px solid var(--bd-light)',
                      paddingTop: 6,
                    }}
                  >
                    <span style={{ fontSize: 10.5, color: active ? 'var(--good)' : 'var(--tx-3)' }}>
                      {active ? 'Active in cushion' : 'Excluded'}
                    </span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        onClick={() => setEventForm(ev)}
                        disabled={eventBusy}
                        style={smallBtn}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => removeEvent(ev)}
                        disabled={eventBusy}
                        style={{ ...smallBtn, color: 'var(--red)' }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Collapsible Multi-Year Driver Table (Collapsed by Default) */}
      <div
        style={{
          border: '1px solid var(--bd)',
          borderRadius: 12,
          background: 'var(--bg-card)',
          overflow: 'hidden',
          marginBottom: 28,
        }}
      >
        {/* Collapsible Header Bar */}
        <div
          onClick={() => setTableExpanded((prev) => !prev)}
          style={{
            padding: '12px 18px',
            background: 'var(--bg-card-2)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'pointer',
            borderBottom: tableExpanded ? '1px solid var(--bd)' : 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--tx-3)' }}>{tableExpanded ? '▲' : '▼'}</span>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--tx-1)' }}>
                📊 Multi-Year Driver Table (Detailed Breakdown)
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--tx-3)' }}>
                {tableExpanded
                  ? 'Showing all 6 streams with cell formulas'
                  : 'Collapsed by default — click to expand annual rows'}
              </div>
            </div>
          </div>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 10 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Scenario Picker */}
            <select
              value={scenarioId}
              onChange={(e) => pickScenario(e.target.value)}
              disabled={scenarioBusy}
              style={{ ...fieldStyle, minWidth: 170 }}
            >
              <option value="">Baseline (committed)</option>
              {pickableScenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.state === 'idea' ? ' (idea)' : ''}
                </option>
              ))}
            </select>
            <button onClick={() => setTableExpanded((prev) => !prev)} style={smallBtn}>
              {tableExpanded ? 'Collapse ▴' : 'Expand Table ▾'}
            </button>
          </div>
        </div>

        {/* Collapsed Teaser Strip */}
        {!tableExpanded && (
          <div
            onClick={() => setTableExpanded(true)}
            style={{
              padding: '14px 20px',
              fontSize: 12.5,
              color: 'var(--tx-2)',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'rgba(255,255,255,0.01)',
            }}
          >
            <span>
              Table is collapsed for a cleaner planning view. Base starting year is{' '}
              <strong>{outlook.baseYear} budget</strong>.
            </span>
            <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Show 6 Streams ▾</span>
          </div>
        )}

        {/* Expanded Table */}
        {tableExpanded && (
          <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 740 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--bd)' }}>
                  <th style={{ ...th, textAlign: 'left', minWidth: 190 }}>Stream</th>
                  <th style={th}>Driver</th>
                  {columns.map((c) => (
                    <th key={c.year} style={th}>
                      <div style={{ color: 'var(--tx-1)', fontSize: 12 }}>{c.year}</div>
                      <div
                        style={{
                          fontSize: 9,
                          color: c.kind === 'detailed' ? 'var(--accent)' : 'var(--tx-3)',
                        }}
                      >
                        {c.kind}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* 1. Inflow */}
                <tr style={{ borderBottom: '1px solid var(--bd-light)' }}>
                  <td style={rowLabel}>Take-home income</td>
                  <td style={{ ...td, color: 'var(--tx-3)' }}>
                    {Number.isFinite(incomeGrowth) ? fmtPct(incomeGrowth) : dash}
                  </td>
                  {outlook.income.map((v, i) => (
                    <td
                      key={years[i]}
                      style={{ ...td, cursor: 'pointer' }}
                      onClick={() =>
                        setInspectCell({
                          title: `Take-home Income · ${years[i]}`,
                          val: v == null ? '—' : fmtFull(v),
                          math: `Base income compounded at ${fmtPct(incomeGrowth)}/yr`,
                        })
                      }
                    >
                      {v == null ? dash : fmtFull(v)}
                    </td>
                  ))}
                </tr>

                {/* 2. Groups */}
                {outlook.groups.map((g) => (
                  <tr key={g.name} style={{ borderBottom: '1px solid var(--bd-light)' }}>
                    <td style={rowLabel}>{g.name}</td>
                    <td style={td}>
                      <PctInput
                        value={g.isOverride ? g.rate : null}
                        placeholder={toPctText(g.rate)}
                        ariaLabel={`${g.name} growth rate percent`}
                        allowClear
                        busy={saving === `g:${g.name}`}
                        onCommit={(v) =>
                          saveAssumptions(`g:${g.name}`, { group_rates: { [g.name]: v } })
                        }
                      />
                      {!g.isOverride && (
                        <div style={{ fontSize: 9.5, color: 'var(--tx-3)' }}>default</div>
                      )}
                    </td>
                    {g.cells.map((cell, i) => (
                      <td
                        key={years[i]}
                        style={{ ...td, cursor: 'pointer' }}
                        onClick={() =>
                          setInspectCell({
                            title: `${g.name} · ${years[i]}`,
                            val: fmtFull(cell.amount),
                            math: `Base ${fmtFull(g.base)} compounded at ${fmtPct(g.rate)}/yr`,
                          })
                        }
                      >
                        {fmtFull(cell.amount)}
                        {cell.committedAdj !== 0 && (
                          <div style={{ fontSize: 10, color: 'var(--tx-3)' }}>
                            {fmtSigned(cell.committedAdj)} committed
                          </div>
                        )}
                        {scenarioActive && cell.scenarioDelta !== 0 && (
                          <div
                            style={{
                              fontSize: 10.5,
                              color: cell.scenarioDelta > 0 ? 'var(--red)' : 'var(--accent)',
                            }}
                          >
                            {fmtSigned(cell.scenarioDelta)}
                          </div>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}

                {/* Total Operating Spend */}
                <tr
                  style={{
                    borderBottom: '1px solid var(--bd)',
                    background: 'rgba(255,255,255,0.02)',
                  }}
                >
                  <td style={{ ...rowLabel, fontWeight: 600 }}>Total Operating Spending</td>
                  <td style={td}>—</td>
                  {outlook.groupTotals.map((tot, i) => (
                    <td key={years[i]} style={{ ...td, fontWeight: 600 }}>
                      {fmtFull(tot)}
                    </td>
                  ))}
                </tr>

                {/* 3. Commitments */}
                <tr style={{ borderBottom: '1px solid var(--bd-light)' }}>
                  <td style={rowLabel}>Commitments</td>
                  <td style={td}>{dash}</td>
                  {outlook.commitments.map((v, i) => {
                    const ended = outlook.commitmentEnds[i]
                    return (
                      <td key={years[i]} style={td}>
                        {fmtFull(v)}
                        {ended.length > 0 && (
                          <div style={{ fontSize: 9.5, color: 'var(--tx-3)' }}>
                            {ended.length} ended
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>

                {/* 4. Planned Initiatives Outlay */}
                <tr style={{ borderBottom: '1px solid var(--bd-light)' }}>
                  <td style={rowLabel}>Planned initiatives</td>
                  <td style={td}>{dash}</td>
                  {outlook.events.map((e, i) => (
                    <td
                      key={years[i]}
                      style={{ ...td, color: e.total > 0 ? 'var(--warn)' : 'var(--tx-3)' }}
                    >
                      {e.total !== 0 ? fmtFull(e.total) : dash}
                    </td>
                  ))}
                </tr>

                {/* 5. Net Annual Savings */}
                <tr style={{ borderBottom: '2px solid var(--bd)', background: 'var(--bg-card-2)' }}>
                  <td style={{ ...rowLabel, fontWeight: 700 }}>Net annual savings</td>
                  <td style={td}>{dash}</td>
                  {outlook.netSavings.map((v, i) => (
                    <td
                      key={years[i]}
                      style={{
                        ...td,
                        fontWeight: 700,
                        color: v == null ? 'var(--tx-3)' : v < 0 ? 'var(--red)' : 'var(--accent)',
                      }}
                    >
                      {v == null ? '—' : fmtSigned(v)}
                    </td>
                  ))}
                </tr>

                {/* 6. Cumulative Cash Cushion */}
                {cushionReady && (
                  <tr style={{ background: 'var(--accent-bg)' }}>
                    <td style={{ ...rowLabel, fontWeight: 700 }}>
                      Cumulative Cash Cushion
                      <div style={{ fontSize: 9.5, opacity: 0.8 }}>
                        Floor: {fmtFull(cushionFloor)}
                      </div>
                    </td>
                    <td style={td}>{dash}</td>
                    {cushionAnalysis.cushion.map((v, i) => (
                      <td
                        key={years[i]}
                        style={{
                          ...td,
                          fontWeight: 700,
                          color: v < cushionFloor ? 'var(--bad)' : 'var(--accent)',
                          background: v < cushionFloor ? 'var(--bad-bg)' : undefined,
                        }}
                      >
                        {fmtFull(v)}
                        {v < cushionFloor && (
                          <div style={{ fontSize: 9, color: 'var(--bad)' }}>BELOW FLOOR</div>
                        )}
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {settingsOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--bd)',
              borderRadius: 12,
              padding: 24,
              width: 440,
              maxWidth: '90%',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--tx-1)' }}>
                ⚙ Outlook & Cushion Settings
              </div>
              <button onClick={() => setSettingsOpen(false)} style={smallBtn}>
                ✕
              </button>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label
                style={{ fontSize: 11.5, color: 'var(--tx-2)', display: 'block', marginBottom: 4 }}
              >
                Safety Cushion Floor ($)
              </label>
              <input
                type="number"
                value={cushionFloor}
                onChange={(e) =>
                  setCushionFloor(e.target.value === '' ? 0 : Number(e.target.value))
                }
                style={{ ...fieldStyle, ...mono, width: '100%' }}
              />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label
                style={{ fontSize: 11.5, color: 'var(--tx-2)', display: 'block', marginBottom: 4 }}
              >
                Starting Cash ($)
              </label>
              <input
                type="number"
                value={startCash ?? ''}
                placeholder="Enter your current liquid cash"
                onChange={(e) =>
                  setStartCash(e.target.value === '' ? null : Number(e.target.value))
                }
                style={{ ...fieldStyle, ...mono, width: '100%' }}
              />
            </div>

            <div
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}
            >
              <div>
                <label
                  style={{
                    fontSize: 11.5,
                    color: 'var(--tx-2)',
                    display: 'block',
                    marginBottom: 4,
                  }}
                >
                  Default Inflation
                </label>
                <PctInput
                  value={inflation}
                  ariaLabel="Default inflation"
                  busy={saving === 'inflation'}
                  onCommit={(v) => {
                    if (v != null) saveAssumptions('inflation', { inflation_rate: v })
                  }}
                />
              </div>
              <div>
                <label
                  style={{
                    fontSize: 11.5,
                    color: 'var(--tx-2)',
                    display: 'block',
                    marginBottom: 4,
                  }}
                >
                  Income Growth
                </label>
                <PctInput
                  value={incomeGrowth}
                  ariaLabel="Income growth"
                  busy={saving === 'growth'}
                  onCommit={(v) => {
                    if (v != null) saveAssumptions('growth', { income_growth_rate: v })
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setSettingsOpen(false)} style={primarySmall}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cell Inspector Popover */}
      {inspectCell && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--bd)',
              borderRadius: 10,
              padding: 20,
              width: 380,
              maxWidth: '90%',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 10,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--tx-1)' }}>
                {inspectCell.title}
              </div>
              <button onClick={() => setInspectCell(null)} style={smallBtn}>
                ✕
              </button>
            </div>
            <div style={{ fontSize: 13, color: 'var(--tx-2)', marginBottom: 8 }}>
              Computed Value:{' '}
              <strong style={{ color: 'var(--tx-1)', ...mono }}>{inspectCell.val}</strong>
            </div>
            <div
              style={{
                background: 'var(--field)',
                border: '1px solid var(--bd)',
                borderRadius: 6,
                padding: '8px 10px',
                fontSize: 12,
                color: 'var(--accent)',
                ...mono,
                marginBottom: 14,
              }}
            >
              {inspectCell.math}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setInspectCell(null)} style={primarySmall}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

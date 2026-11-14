import { useState, useEffect, useMemo, useCallback } from 'react'
import { parseMoneyInput } from '../../lib/money.js'
import { getCheckingAnchor, saveCheckingAnchor } from '../../lib/db/checkingAnchor.js'
import { upsertAccount } from '../../lib/db/bills.js'
import { loadWeeklyCashInputs } from '../../lib/payperiods/weeklyCashLoader.js'
import { loadCheckingHistoryInputs, loadMonarchAccountNames } from '../../lib/payperiods/checkingHistoryLoader.js'
import {
  buildCheckingHistory, snapshotCheckpoints, monarchAccountOptions, buildMonarchAccountChoices, HISTORY_WEEKS,
} from '../../lib/payperiods/checkingHistory.js'
import { buildWhatIfParam, hasWhatIf } from '../../lib/payperiods/whatIfs.js'
import { summarizeWeeks, buildWeeksChartModel } from '../../lib/payperiods/weeksSummary.js'
import {
  buildWeeklyCashSeries, resolvePayDays, addDays,
} from '../../lib/payperiods/weeklyCashSeries.js'
import {
  MonoLabel, Segmented, WHATIF, fmtDate, inputStyle, money2, signedMoney,
} from './weeks/WeeksShared.jsx'
import WeeksTiles from './weeks/WeeksTiles.jsx'
import WeeksChart, { buildSelectables } from './weeks/WeeksChart.jsx'
import WeeksNetBars from './weeks/WeeksNetBars.jsx'
import WeeksScenarioPanel from './weeks/WeeksScenarioPanel.jsx'
import WeekDetail from './weeks/WeekDetail.jsx'

const STALE_DAYS = 14
const NO_SCENARIO = { id: '', deltas: {}, skippedIncome: 0, skippedOther: 0 }

const pad = n => String(n).padStart(2, '0')

// Local calendar date; toISOString would shift it to UTC.
function toYmd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function dayDiff(a, b) {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
}

function HistoryStatus({ userId, today, primary, history, historyInputs, historyError, historyLoading, onRetry, onMapped }) {
  const [pick, setPick] = useState('')
  const [saving, setSaving] = useState(false)
  const [mapError, setMapError] = useState(null)
  const [wideRows, setWideRows] = useState(null)
  const needsMapping = history?.status === 'no-mapping'
  const narrowOptions = useMemo(() => monarchAccountOptions(historyInputs?.transactions), [historyInputs])

  useEffect(() => {
    if (!needsMapping || !userId) return undefined
    let cancelled = false
    loadMonarchAccountNames({ userId, today })
      .then(rows => { if (!cancelled) setWideRows(rows) })
      .catch(() => { if (!cancelled) setWideRows(null) })
    return () => { cancelled = true }
  }, [needsMapping, userId, today])

  const options = useMemo(() => {
    const wide = wideRows ? buildMonarchAccountChoices(wideRows, null) : []
    return wide.length > 0 ? wide : narrowOptions
  }, [wideRows, narrowOptions])

  if (historyError) {
    return (
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--warn)', fontSize: 12 }}>History unavailable: {historyError}</span>
        <button type="button" style={{ ...inputStyle, cursor: 'pointer', padding: '3px 8px' }} onClick={onRetry}>Retry</button>
      </div>
    )
  }
  if (!history) {
    return historyLoading ? <MonoLabel>Loading history…</MonoLabel> : null
  }

  async function saveMapping() {
    if (!pick) return
    setSaving(true)
    setMapError(null)
    try {
      await upsertAccount(null, { id: primary.id, monarch_account_name: pick })
      await onMapped()
    } catch (e) {
      setMapError(`Couldn't save the mapping: ${e.message}. Migration 029 may not be applied yet.`)
    } finally {
      setSaving(false)
    }
  }

  if (history.status === 'no-mapping') {
    return (
      <div style={{
        border: '1px solid var(--accent-bd)', borderRadius: 10, background: 'var(--accent-bg)', padding: '10px 14px',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <div style={{ fontSize: 13, color: 'var(--tx-1)' }}>Map your Monarch checking account to see the last 4 weeks</div>
        {options.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--tx-3)' }}>
            No Monarch transactions found to pick from. Map it in ACCOUNTS.
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select
              style={{ ...inputStyle, maxWidth: '100%' }} value={pick} aria-label="Monarch account"
              onChange={e => setPick(e.target.value)}
            >
              <option value="">Pick the Monarch account…</option>
              {options.map(o => <option key={o.name} value={o.name}>{o.name} ({o.count})</option>)}
            </select>
            <button
              type="button" onClick={saveMapping} disabled={!pick || saving}
              style={{ ...inputStyle, cursor: 'pointer', color: 'var(--accent)', borderColor: 'var(--accent-bd)' }}
            >{saving ? 'Saving…' : 'Save'}</button>
          </div>
        )}
        {mapError && <div style={{ color: 'var(--warn)', fontSize: 12 }}>{mapError}</div>}
      </div>
    )
  }

  const bad = history.reconciliation.find(r => !r.ok)
  const good = history.reconciliation.filter(r => r.ok)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <MonoLabel>
        History: {history.accountName} · transactions through {history.coverageThrough ?? 'never'}
      </MonoLabel>
      {bad ? (
        <div style={{ fontSize: 12, color: 'var(--warn)' }}>
          Off from your {bad.label} ({money2(bad.snapshot)}) by {money2(bad.diff)}; history is approximate.
        </div>
      ) : good.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--tx-3)' }}>
          Matches your {good[good.length - 1].label} within {money2(good[good.length - 1].diff)}
        </div>
      )}
      {history.possibleDuplicates.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--warn)' }}>
          {history.possibleDuplicates.length} possible duplicate{history.possibleDuplicates.length === 1 ? '' : 's'} (kept in the totals)
        </div>
      )}
    </div>
  )
}

function AnchorForm({
  primary, asOfInput, setAsOfInput, balanceInput, setBalanceInput, today, saving, formError, onSave,
}) {
  return (
    <div>
      <MonoLabel style={{ marginBottom: 8 }}>STARTING BALANCE · {primary.name}</MonoLabel>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <MonoLabel>AS OF</MonoLabel>
          <input
            type="date" value={asOfInput} max={today} style={inputStyle}
            onChange={e => setAsOfInput(e.target.value)}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <MonoLabel>BALANCE</MonoLabel>
          <input
            type="text" inputMode="decimal" value={balanceInput} placeholder="0.00"
            style={{ ...inputStyle, width: 130 }}
            onChange={e => setBalanceInput(e.target.value)}
          />
        </label>
        <button
          type="button" onClick={onSave} disabled={saving}
          style={{ ...inputStyle, cursor: 'pointer', color: 'var(--accent)', borderColor: 'var(--accent-bd)' }}
        >{saving ? 'Saving…' : 'Save'}</button>
      </div>
      {formError && <div style={{ color: 'var(--warn)', fontSize: 12, marginTop: 8 }}>{formError}</div>}
    </div>
  )
}

export default function WeeksTab({
  userId, mobile, profile, bills, accounts, onAccountsChanged,
  creditCards = [], budgetCategories = [], earnRateMap = {}, ccCoverage = 80, ccOptimization = 100,
}) {
  const [weeks, setWeeks] = useState(13)
  const [includeSpend, setIncludeSpend] = useState(true)
  const [anchor, setAnchor] = useState(null)
  const [inputs, setInputs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [selected, setSelected] = useState(null)

  const [asOfInput, setAsOfInput] = useState('')
  const [balanceInput, setBalanceInput] = useState('')
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [anchorOpen, setAnchorOpen] = useState(false)

  const [historyInputs, setHistoryInputs] = useState(null)
  const [historyError, setHistoryError] = useState(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyReloadKey, setHistoryReloadKey] = useState(0)

  const [panelOpen, setPanelOpen] = useState(false)
  const [panelEverOpen, setPanelEverOpen] = useState(false)
  const [quickItems, setQuickItems] = useState([])
  const [scenarioPick, setScenarioPick] = useState(NO_SCENARIO)

  const today = useMemo(() => toYmd(new Date()), [])
  const primary = useMemo(
    () => accounts?.find(a => a.is_primary_checking && a.type === 'checking') ?? null,
    [accounts],
  )
  const primaryId = primary?.id ?? null
  const monarchName = primary?.monarch_account_name ?? null

  const applyAnchor = useCallback(row => {
    setAnchor(row)
    setAsOfInput(row?.as_of_date ?? today)
    setBalanceInput(row ? String(row.balance) : '')
  }, [today])

  useEffect(() => {
    if (!userId || !primaryId) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    ;(async () => {
      try {
        const row = await getCheckingAnchor(primaryId)
        const loaded = await loadWeeklyCashInputs({
          userId, profile, bills, accounts, creditCards, budgetCategories,
          earnRateMap, ccCoverage, ccOptimization, today, anchorAsOf: row?.as_of_date ?? null,
        })
        if (cancelled) return
        applyAnchor(row)
        setInputs(loaded)
      } catch (e) {
        if (!cancelled) setLoadError(e.message || 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [userId, primaryId, profile, bills, accounts, creditCards, budgetCategories, earnRateMap,
    ccCoverage, ccOptimization, today, reloadKey, applyAnchor])

  // History is separate so a failure never blocks the projection.
  useEffect(() => {
    if (!userId || !primaryId) return
    let cancelled = false
    setHistoryLoading(true)
    setHistoryError(null)
    loadCheckingHistoryInputs({ userId, primary: { monarch_account_name: monarchName }, today })
      .then(r => { if (!cancelled) setHistoryInputs(r) })
      .catch(e => { if (!cancelled) setHistoryError(e.message || 'Failed to load history') })
      .finally(() => { if (!cancelled) setHistoryLoading(false) })
    return () => { cancelled = true }
  }, [userId, primaryId, monarchName, today, historyReloadKey])

  const minBalance = Number(profile?.min_checking_balance ?? 0)
  const baseArgs = useMemo(() => {
    if (!inputs) return null
    return {
      ...inputs, today, weeks, includeSpend, minBalance,
      anchor: anchor ? { asOfDate: anchor.as_of_date, balance: anchor.balance } : null,
    }
  }, [inputs, today, weeks, includeSpend, minBalance, anchor])
  const series = useMemo(() => (baseArgs ? buildWeeklyCashSeries(baseArgs) : null), [baseArgs])

  const whatIfParam = useMemo(
    () => buildWhatIfParam(quickItems, scenarioPick.deltas),
    [quickItems, scenarioPick.deltas],
  )
  const overlay = useMemo(
    () => (baseArgs && hasWhatIf(whatIfParam) ? buildWeeklyCashSeries({ ...baseArgs, whatIf: whatIfParam }) : null),
    [baseArgs, whatIfParam],
  )

  const history = useMemo(() => {
    if (!historyInputs || !series) return null
    return buildCheckingHistory({
      today, start: series.start,
      anchor: anchor ? { asOfDate: anchor.as_of_date, balance: anchor.balance } : null,
      accountName: monarchName,
      transactions: historyInputs.transactions,
      checkpoints: snapshotCheckpoints(historyInputs.balanceRows, primaryId, profile),
      fetchFrom: historyInputs.fetchFrom,
    })
  }, [historyInputs, series, anchor, today, monarchName, primaryId, profile])

  const summary = useMemo(() => (series ? summarizeWeeks(series, { minBalance }) : null), [series, minBalance])
  const overlaySummary = useMemo(
    () => (overlay ? summarizeWeeks(overlay, { minBalance }) : null),
    [overlay, minBalance],
  )
  const model = useMemo(() => {
    if (!series) return null
    return buildWeeksChartModel({
      history: history ?? { points: [] }, series, overlay, minBalance, today,
    })
  }, [series, history, overlay, minBalance, today])
  const selectables = useMemo(
    () => (series ? buildSelectables(history, series, overlay) : []),
    [series, history, overlay],
  )

  const payDays = useMemo(() => resolvePayDays(profile), [profile])

  async function handleSave() {
    setFormError(null)
    const balance = parseMoneyInput(balanceInput)
    if (balance == null) { setFormError('Enter the balance as a number, e.g. 2,450.75'); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfInput)) { setFormError('Pick an as-of date'); return }
    if (asOfInput > today) { setFormError('The as-of date cannot be in the future'); return }
    setSaving(true)
    try {
      const saved = await saveCheckingAnchor({ accountId: primaryId, asOfDate: asOfInput, balance })
      setReloadKey(k => k + 1)
      setAnchor(saved)
      setAnchorOpen(false)
    } catch (e) {
      setFormError(e.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  if (!primaryId) {
    return (
      <div style={{ padding: 16 }}>
        <MonoLabel>Mark a checking account as primary to use WEEKS (ACCOUNTS tab).</MonoLabel>
      </div>
    )
  }
  if (loadError) {
    return (
      <div style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--warn)', fontSize: 13 }}>{loadError}</span>
        <button type="button" style={inputStyle} onClick={() => setReloadKey(k => k + 1)}>Retry</button>
      </div>
    )
  }
  if (loading && !series) {
    return <div style={{ padding: 16 }}><MonoLabel>Loading weeks…</MonoLabel></div>
  }
  if (!series) return null

  const staleDays = anchor ? dayDiff(anchor.as_of_date, today) : 0
  const noData = series.totals.income === 0 && series.totals.bills === 0
    && series.totals.cardPayments === 0 && series.totals.spend === 0
  const minIndex = history && history.points.length > 0 ? -HISTORY_WEEKS : 0
  const maxIndex = series.weeks.length - 1
  const defaultSel = series.firstBelowMinIndex ?? 0
  const selectedIdx = Math.min(maxIndex, Math.max(minIndex, selected ?? defaultSel))
  const hasOverlay = !!overlay
  const anchorForm = (
    <AnchorForm
      primary={primary} asOfInput={asOfInput} setAsOfInput={setAsOfInput}
      balanceInput={balanceInput} setBalanceInput={setBalanceInput} today={today}
      saving={saving} formError={formError} onSave={handleSave}
    />
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, opacity: loading ? 0.6 : 1 }}>
      <WeeksTiles
        mobile={mobile} anchor={anchor} minBalance={minBalance} today={today} staleDays={staleDays}
        summary={summary} overlaySummary={overlaySummary}
      />

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <Segmented
          value={weeks} onChange={setWeeks}
          options={[{ value: 6, label: '6 WEEKS' }, { value: 13, label: '13 WEEKS' }]}
        />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--tx-2)' }}>
          <input type="checkbox" checked={includeSpend} onChange={e => setIncludeSpend(e.target.checked)} />
          Include day-to-day spend
        </label>
        <button
          type="button" aria-pressed={panelOpen}
          onClick={() => { setPanelOpen(v => !v); setPanelEverOpen(true) }}
          style={{
            ...inputStyle, cursor: 'pointer', color: panelOpen || hasOverlay ? WHATIF : 'var(--tx-2)',
            borderColor: panelOpen || hasOverlay ? WHATIF : 'var(--bd)',
          }}
        >+ What-if</button>
        {anchor && (
          <div style={{ fontSize: 12, color: 'var(--tx-2)' }}>
            Balance {money2(Number(anchor.balance))} as of {fmtDate(anchor.as_of_date)} ·{' '}
            <button
              type="button" onClick={() => setAnchorOpen(v => !v)}
              style={{ all: 'unset', cursor: 'pointer', color: 'var(--accent)', textDecoration: 'underline' }}
            >Update</button>
          </div>
        )}
      </div>

      {anchor && anchorOpen && (
        <div style={{
          border: '1px solid var(--bd)', borderRadius: 11, background: 'var(--bg-card)',
          padding: mobile ? '12px 14px' : '14px 18px',
        }}>
          {anchorForm}
          {staleDays > STALE_DAYS && (
            <div style={{ color: 'var(--warn)', fontSize: 12, marginTop: 8 }}>
              Stale: as-of date is {staleDays} days old
            </div>
          )}
        </div>
      )}

      {panelEverOpen && (
        <div hidden={!(panelOpen || hasOverlay)}>
          <WeeksScenarioPanel
            userId={userId} series={series} budgetCategories={budgetCategories}
            items={quickItems} onItemsChange={setQuickItems}
            scenarioPick={scenarioPick} onScenarioChange={setScenarioPick}
          />
        </div>
      )}

      <WeeksChart
        model={model} selectables={selectables} selected={selectedIdx} onSelect={setSelected}
        hasOverlay={hasOverlay} minBalance={minBalance} emptyChildren={anchorForm}
      />

      {!model.empty && (
        <WeeksNetBars model={model} selected={selectedIdx} onSelect={setSelected} hasOverlay={hasOverlay} />
      )}

      <HistoryStatus
        userId={userId} today={today} primary={primary} history={history} historyInputs={historyInputs} historyError={historyError}
        historyLoading={historyLoading} onRetry={() => setHistoryReloadKey(k => k + 1)}
        onMapped={async () => { if (onAccountsChanged) await onAccountsChanged(); setHistoryReloadKey(k => k + 1) }}
      />

      {noData && (
        <MonoLabel>No inflows or outflows were found for this window.</MonoLabel>
      )}

      <WeekDetail
        selected={selectedIdx} minIndex={minIndex} maxIndex={maxIndex} onSelect={setSelected}
        series={series} overlay={overlay} history={history} showSpend={includeSpend} mobile={mobile}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {series.hasAnchor && series.carriedIn !== 0 && (
          <MonoLabel>
            Carried in since {fmtDate(addDays(anchor.as_of_date, 1))}: {signedMoney(series.carriedIn)} (included in week 1 opening)
          </MonoLabel>
        )}
        <MonoLabel>Pay days used: {payDays.days.join(' / ')}</MonoLabel>
        {payDays.mismatch && <MonoLabel style={{ color: 'var(--warn)' }}>{payDays.mismatch}</MonoLabel>}
        {series.warnings.map(w => <MonoLabel key={w} style={{ color: 'var(--warn)' }}>{w}</MonoLabel>)}
        {overlay && overlay.warnings.filter(w => !series.warnings.includes(w))
          .map(w => <MonoLabel key={w} style={{ color: WHATIF }}>{w}</MonoLabel>)}
        <MonoLabel>Pay dates are not shifted for weekends.</MonoLabel>
      </div>
    </div>
  )
}

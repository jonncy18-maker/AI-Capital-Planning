import { useState, useEffect, useMemo, useCallback } from 'react'
import { formatMoney, parseMoneyInput } from '../../lib/money.js'
import { getCheckingAnchor, saveCheckingAnchor } from '../../lib/db/checkingAnchor.js'
import { loadWeeklyCashInputs } from '../../lib/payperiods/weeklyCashLoader.js'
import {
  buildWeeklyCashSeries, resolvePayDays, addDays,
} from '../../lib/payperiods/weeklyCashSeries.js'

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const STALE_DAYS = 14

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

function fmtDate(ymd, withWeekday = false) {
  const [y, m, d] = ymd.split('-').map(Number)
  const label = `${MONTH_ABBR[m - 1]} ${d}`
  return withWeekday ? `${DAY_ABBR[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${label}` : label
}

const money = n => (n == null ? '—' : formatMoney(n))
const signedMoney = n => formatMoney(n, { signed: true })

function MonoLabel({ children, style }) {
  return (
    <div style={{
      fontFamily: "'DM Mono', monospace", fontSize: 9.5,
      color: 'var(--tx-3)', letterSpacing: '0.06em', ...style,
    }}>{children}</div>
  )
}

function Badge({ children, color = 'var(--tx-3)' }) {
  return (
    <span style={{
      fontFamily: "'DM Mono', monospace", fontSize: 8.5, letterSpacing: '0.06em',
      color, border: `1px solid ${color}`, borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

function Segmented({ value, options, onChange }) {
  return (
    <div style={{ display: 'inline-flex', border: '1px solid var(--bd)', borderRadius: 8, overflow: 'hidden' }}>
      {options.map(o => (
        <button
          key={o.value} type="button" onClick={() => onChange(o.value)}
          style={{
            fontFamily: "'DM Mono', monospace", fontSize: 10, letterSpacing: '0.06em',
            padding: '7px 12px', border: 'none', cursor: 'pointer',
            background: value === o.value ? 'var(--accent-bg)' : 'var(--bg-card)',
            color: value === o.value ? 'var(--accent)' : 'var(--tx-3)',
          }}
        >{o.label}</button>
      ))}
    </div>
  )
}

const inputStyle = {
  fontFamily: "'DM Mono', monospace", fontSize: 12, color: 'var(--tx-1)',
  background: 'var(--bg-app)', border: '1px solid var(--bd)', borderRadius: 6, padding: '7px 9px',
}

function EventList({ events }) {
  if (events.length === 0) {
    return <MonoLabel style={{ padding: '4px 0' }}>NO EVENTS THIS WEEK</MonoLabel>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {events.map((e, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: 'var(--tx-3)', minWidth: 52 }}>
            {fmtDate(e.date)}
          </span>
          <span style={{ flex: 1, minWidth: 100, fontSize: 12, color: 'var(--tx-2)' }}>{e.label}</span>
          {e.unknownAmount && <Badge color="var(--warn)">AMOUNT UNKNOWN</Badge>}
          {e.manual && <Badge>MANUAL</Badge>}
          <span style={{
            fontFamily: "'DM Mono', monospace", fontSize: 11,
            color: e.kind === 'income' ? 'var(--accent)' : 'var(--tx-1)',
          }}>
            {e.unknownAmount ? '—' : `${e.kind === 'income' ? '+' : '−'}${formatMoney(e.amount)}`}
          </span>
        </div>
      ))}
    </div>
  )
}

function Cell({ label, value, color, mobile }) {
  return (
    <div style={{ minWidth: 0 }}>
      {mobile && <MonoLabel style={{ fontSize: 8.5 }}>{label}</MonoLabel>}
      <div style={{
        fontFamily: "'DM Mono', monospace", fontSize: 12, color: color || 'var(--tx-1)',
        whiteSpace: 'nowrap',
      }}>{value}</div>
    </div>
  )
}

function WeekRow({ week, hasAnchor, showSpend, mobile, open, onToggle }) {
  const flagged = week.belowMin
  const cols = showSpend
    ? 'minmax(90px,1fr) repeat(4, minmax(70px,1fr)) minmax(90px,1fr) minmax(110px,1fr)'
    : 'minmax(90px,1fr) repeat(3, minmax(70px,1fr)) minmax(90px,1fr) minmax(110px,1fr)'
  const low = hasAnchor ? `${money(week.low)} · ${fmtDate(week.lowDate)}` : '—'
  const cells = [
    { label: 'INCOME', value: week.income ? signedMoney(week.income) : '—', color: week.income ? 'var(--accent)' : undefined },
    { label: 'BILLS', value: money(week.bills) },
    { label: 'CARDS', value: money(week.cardPayments) },
    ...(showSpend ? [{ label: 'SPEND', value: money(week.spend) }] : []),
    { label: 'CLOSING', value: money(week.closing), color: week.negative ? 'var(--warn)' : undefined },
    { label: 'LOW POINT', value: low },
  ]
  return (
    <div style={{
      border: '1px solid var(--bd)', borderLeft: flagged ? '4px solid var(--warn)' : '1px solid var(--bd)',
      borderRadius: 10, background: 'var(--bg-card)', padding: mobile ? '10px 12px' : '10px 14px',
    }}>
      <button
        type="button" onClick={onToggle} aria-expanded={open}
        style={{
          all: 'unset', cursor: 'pointer', display: 'block', width: '100%', boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: mobile ? 8 : 0 }}>
          <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: 15, color: 'var(--tx-1)' }}>
            {fmtDate(week.start, true)}
          </span>
          {week.negative && <Badge color="var(--warn)">OVERDRAWN</Badge>}
          {!week.negative && flagged && <Badge color="var(--warn)">BELOW MIN</Badge>}
          <span style={{ marginLeft: 'auto', color: 'var(--tx-3)', fontSize: 11 }}>{open ? '▾' : '▸'}</span>
        </div>
        <div style={mobile
          ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }
          : { display: 'grid', gridTemplateColumns: cols, gap: 12, alignItems: 'center', marginTop: 6 }}
        >
          {cells.map(c => <Cell key={c.label} mobile={mobile} {...c} />)}
        </div>
      </button>
      {open && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--bd)' }}>
          <EventList events={week.events} />
        </div>
      )}
    </div>
  )
}

export default function WeeksTab({
  userId, mobile, profile, bills, accounts,
  creditCards = [], budgetCategories = [], earnRateMap = {}, ccCoverage = 80, ccOptimization = 100,
}) {
  const [weeks, setWeeks] = useState(13)
  const [includeSpend, setIncludeSpend] = useState(true)
  const [anchor, setAnchor] = useState(null)
  const [inputs, setInputs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [openWeek, setOpenWeek] = useState(null)

  const [asOfInput, setAsOfInput] = useState('')
  const [balanceInput, setBalanceInput] = useState('')
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)

  const today = useMemo(() => toYmd(new Date()), [])
  const primary = useMemo(
    () => accounts?.find(a => a.is_primary_checking && a.type === 'checking') ?? null,
    [accounts],
  )
  const primaryId = primary?.id ?? null

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

  const minBalance = Number(profile?.min_checking_balance ?? 0)
  const series = useMemo(() => {
    if (!inputs) return null
    return buildWeeklyCashSeries({
      ...inputs, today, weeks, includeSpend, minBalance,
      anchor: anchor ? { asOfDate: anchor.as_of_date, balance: anchor.balance } : null,
    })
  }, [inputs, today, weeks, includeSpend, minBalance, anchor])

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

  const shown = series.weeks
  const staleDays = anchor ? dayDiff(anchor.as_of_date, today) : 0
  const noData = series.totals.income === 0 && series.totals.bills === 0
    && series.totals.cardPayments === 0 && series.totals.spend === 0
  const first = series.firstBelowMinIndex != null ? shown[series.firstBelowMinIndex] : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, opacity: loading ? 0.6 : 1 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <Segmented
          value={weeks} onChange={setWeeks}
          options={[{ value: 6, label: '6 WEEKS' }, { value: 13, label: '13 WEEKS' }]}
        />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--tx-2)' }}>
          <input type="checkbox" checked={includeSpend} onChange={e => setIncludeSpend(e.target.checked)} />
          Include day-to-day spend
        </label>
      </div>

      <div style={{
        border: `1px solid ${anchor ? 'var(--bd)' : 'var(--accent-bd)'}`, borderRadius: 11,
        background: anchor ? 'var(--bg-card)' : 'var(--accent-bg)', padding: mobile ? '12px 14px' : '14px 18px',
      }}>
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
            type="button" onClick={handleSave} disabled={saving}
            style={{ ...inputStyle, cursor: 'pointer', color: 'var(--accent)', borderColor: 'var(--accent-bd)' }}
          >{saving ? 'Saving…' : 'Save'}</button>
        </div>
        {formError && <div style={{ color: 'var(--warn)', fontSize: 12, marginTop: 8 }}>{formError}</div>}
        {anchor && staleDays > STALE_DAYS && (
          <div style={{ color: 'var(--warn)', fontSize: 12, marginTop: 8 }}>
            Stale: as-of date is {staleDays} days old
          </div>
        )}
        {!anchor && (
          <div style={{ color: 'var(--tx-3)', fontSize: 12, marginTop: 8 }}>
            Enter your checking balance to see running balances and flags.
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <MonoLabel>MINIMUM {formatMoney(minBalance)}</MonoLabel>
        {series.hasAnchor && (first ? (
          <span style={{ color: 'var(--warn)', fontSize: 13 }}>
            Dips below minimum in week of {fmtDate(first.start, true)}
          </span>
        ) : (
          <span style={{ color: 'var(--accent)', fontSize: 13 }}>Stays above minimum</span>
        ))}
      </div>

      {noData && (
        <MonoLabel>No inflows or outflows were found for this window.</MonoLabel>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {!mobile && (
          <div style={{
            display: 'grid', gap: 12, padding: '0 14px',
            gridTemplateColumns: includeSpend
              ? 'minmax(90px,1fr) repeat(4, minmax(70px,1fr)) minmax(90px,1fr) minmax(110px,1fr)'
              : 'minmax(90px,1fr) repeat(3, minmax(70px,1fr)) minmax(90px,1fr) minmax(110px,1fr)',
          }}>
            {['WEEK OF', 'INCOME', 'BILLS', 'CARDS', ...(includeSpend ? ['SPEND'] : []), 'CLOSING', 'LOW POINT']
              .map(h => <MonoLabel key={h}>{h}</MonoLabel>)}
          </div>
        )}
        {shown.map(w => (
          <WeekRow
            key={w.index} week={w} hasAnchor={series.hasAnchor} showSpend={includeSpend} mobile={mobile}
            open={openWeek === w.index} onToggle={() => setOpenWeek(openWeek === w.index ? null : w.index)}
          />
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {series.hasAnchor && series.carriedIn !== 0 && (
          <MonoLabel>
            Carried in since {fmtDate(addDays(anchor.as_of_date, 1))}: {signedMoney(series.carriedIn)} (included in week 1 opening)
          </MonoLabel>
        )}
        <MonoLabel>Pay days used: {payDays.days.join(' / ')}</MonoLabel>
        {payDays.mismatch && <MonoLabel style={{ color: 'var(--warn)' }}>{payDays.mismatch}</MonoLabel>}
        {series.warnings.map(w => <MonoLabel key={w} style={{ color: 'var(--warn)' }}>{w}</MonoLabel>)}
        <MonoLabel>Pay dates are not shifted for weekends.</MonoLabel>
      </div>
    </div>
  )
}

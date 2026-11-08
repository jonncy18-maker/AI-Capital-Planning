import { useState, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import ModuleHeader from '../common/ModuleHeader.jsx'
import { CONTENT_MAX } from '../common/layout.js'
import { getTransactionsByMonth } from '../../lib/db/transactions.js'
import { getBudgetYears, getBudgetLineItems } from '../../lib/db/budgetLineItems.js'
import { getExcludedCategoryNames } from '../../lib/db/budgetCategories.js'
import {
  buildHistory, buildMonthDetail, categoryTrend, categoryTransactions,
} from '../../lib/history/historySeries.js'
import HistoryTiles from './HistoryTiles.jsx'
import HistoryGrid from './HistoryGrid.jsx'
import MonthDetail from './MonthDetail.jsx'
import CategoryDrill from './CategoryDrill.jsx'
import { Segmented, currentMonthKey, fullDayLabel, longMonth, shortMonthYear } from './historyUi.jsx'
import './History.css'

const GROUPS = [
  { value: 'group', label: 'Group' },
  { value: 'category', label: 'Category' },
  { value: 'merchant', label: 'Merchant' },
]

async function loadAll(userId) {
  const [txns, years, excluded] = await Promise.all([
    getTransactionsByMonth(userId, '2000-01-01', '2099-12-31'),
    getBudgetYears(userId),
    getExcludedCategoryNames(userId),
  ])
  const lineItems = (await Promise.all(years.map((year) => getBudgetLineItems(userId, { year })))).flat()
  return { txns, lineItems, excluded }
}

function Skeleton() {
  return (
    <div aria-busy="true">
      <span className="hist-sr" role="status">Loading history…</span>
      <div className="hist-toolbar">
        <div className="hist-skel" style={{ width: 280, height: 30 }} />
        <div className="hist-skel" style={{ width: 340, maxWidth: '100%', height: 30 }} />
      </div>
      <div className="hist-tiles">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="hist-card hist-tile">
            <div className="hist-skel" style={{ width: '50%', height: 10 }} />
            <div className="hist-skel" style={{ width: '70%', height: 24, margin: '10px 0 8px' }} />
            <div className="hist-skel" style={{ width: '40%', height: 10 }} />
          </div>
        ))}
      </div>
      <div className="hist-card" style={{ padding: 16, display: 'grid', gap: 12 }}>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="hist-skel" style={{ height: 14, width: `${100 - (i % 3) * 12}%` }} />
        ))}
      </div>
    </div>
  )
}

export default function History({ userId, mobile }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [range, setRange] = useState('all')
  const [offset, setOffset] = useState(0)
  const [groupBy, setGroupBy] = useState('category')
  const [mode, setMode] = useState('spending')
  const [view, setView] = useState('grid')
  const [month, setMonth] = useState(null)
  const [drill, setDrill] = useState(null)
  const [drillFrom, setDrillFrom] = useState('grid')
  const rootRef = useRef(null)
  const firstView = useRef(true)

  useEffect(() => {
    let live = true
    loadAll(userId).then(
      (d) => { if (live) setData(d) },
      (e) => { if (live) setError(e) },
    )
    return () => { live = false }
  }, [userId, attempt])

  useEffect(() => {
    if (firstView.current) { firstView.current = false; return }
    rootRef.current?.scrollIntoView?.({ block: 'start' })
  }, [view, drill])

  const retry = () => { setError(null); setData(null); setAttempt((a) => a + 1) }

  const now = useMemo(() => new Date(), [])
  const currentKey = currentMonthKey(now)

  const history = useMemo(
    () => (data ? buildHistory({ ...data, groupBy, range, offset, now }) : null),
    [data, groupBy, range, offset, now],
  )
  const allCols = useMemo(
    () => (data ? buildHistory({ ...data, groupBy: 'group', range: 'all' }).columns : []),
    [data],
  )
  const allKeys = useMemo(() => allCols.map((c) => c.key), [allCols])
  const hasData = useMemo(() => {
    const s = new Set(allCols.filter((c) => c.hasData).map((c) => c.key))
    return (k) => s.has(k)
  }, [allCols])

  // Category -> group, budget first (the plan's grouping), then transactions.
  const groupOf = useMemo(() => {
    const out = {}
    if (!data) return out
    for (const li of data.lineItems) {
      const bc = li.budget_categories
      if (bc?.category && bc.group) out[bc.category] = bc.group
    }
    for (const t of data.txns) if (t.category && t.group) out[t.category] ??= t.group
    return out
  }, [data])

  const lastDate = useMemo(() => {
    if (!data?.txns.length) return null
    let max = ''
    for (const t of data.txns) if (String(t.date) > max) max = String(t.date)
    return fullDayLabel(max)
  }, [data])

  const empty = data && data.txns.length === 0

  const openMonth = (key) => { setMonth(key); setView('month') }
  const openCategory = (from) => (name, key) => {
    setDrill(name)
    setDrillFrom(from)
    setMonth((m) => key ?? (from === 'month' ? m : null) ?? allCols.filter((c) => c.hasData).at(-1)?.key ?? allKeys.at(-1))
    setView('category')
  }
  const toGrid = () => setView('grid')
  const changeGroup = (g) => {
    setGroupBy(g)
    if (g === 'merchant') setMode('spending')
  }

  const firstKey = allKeys[0]
  const pages = range !== 'all'
  const canEarlier = pages && history && history.columns[0]?.key > firstKey
  const fyLabel = `FY${String(now.getFullYear() - (range === 'fy' ? offset : 0)).slice(2)}`
  const ranges = [
    { value: '12', label: '12 mo' },
    { value: 'fy', label: fyLabel },
    { value: 'all', label: 'All' },
  ]
  const modes = [
    { value: 'spending', label: 'Spending' },
    {
      value: 'vsbudget',
      label: 'vs budget',
      disabled: groupBy === 'merchant',
      title: groupBy === 'merchant' ? 'Budgets are set per category, not per merchant' : 'Show what was left or overspent each month',
    },
  ]

  let body
  if (error) {
    body = (
      <div className="hist-card hist-state" role="alert">
        <div className="hist-state-icon" aria-hidden="true" style={{ color: 'var(--red)' }}>!</div>
        <h2>Couldn&apos;t load history. Your data is unchanged.</h2>
        <p>This page only reads your data, so nothing was lost. Check your connection and try again.</p>
        <button type="button" className="hist-btn hist-btn-primary" onClick={retry}>Retry</button>
      </div>
    )
  } else if (!data) {
    body = <Skeleton />
  } else if (empty) {
    body = (
      <div className="hist-card hist-state">
        <div className="hist-state-icon" aria-hidden="true">▤</div>
        <h2>No history yet</h2>
        <p>Import a Monarch export to see past months.</p>
        <Link href="/settings" className="hist-btn hist-btn-primary">Go to Settings</Link>
      </div>
    )
  } else if (view === 'month' && month) {
    body = (
      <MonthDetail
        detail={buildMonthDetail({ ...data, month })}
        monthKeys={allKeys}
        hasData={hasData}
        onMonth={setMonth}
        onCategory={openCategory('month')}
        onBack={toGrid}
      />
    )
  } else if (view === 'category' && drill && month) {
    const crumbs = [{ label: 'History', onClick: toGrid }]
    if (drillFrom === 'month') crumbs.push({ label: longMonth(month), onClick: () => setView('month') })
    body = (
      <CategoryDrill
        key={drill}
        category={drill}
        group={groupOf[drill]}
        bars={categoryTrend({ ...data, category: drill, monthKeys: allKeys })}
        month={month}
        rows={categoryTransactions({ txns: data.txns, excluded: data.excluded, category: drill, month })}
        onMonth={setMonth}
        crumbs={crumbs}
        hasData={hasData}
      />
    )
  } else {
    const cols = history.columns
    body = (
      <>
        <div className="hist-toolbar">
          <div className="hist-ctl">
            <Segmented ariaLabel="Date range" value={range} options={ranges} onChange={(v) => { setRange(v); setOffset(0) }} />
            {pages && (
              <span style={{ display: 'inline-flex', gap: 4 }}>
                <button type="button" className="hist-iconbtn" disabled={!canEarlier} onClick={() => setOffset((o) => o + 1)} aria-label={range === 'fy' ? 'Previous year' : 'Previous month'}>‹</button>
                <button type="button" className="hist-iconbtn" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - 1))} aria-label={range === 'fy' ? 'Next year' : 'Next month'}>›</button>
              </span>
            )}
            {cols.length > 0 && (
              <span className="hist-span" aria-live="polite">{shortMonthYear(cols[0].key)} – {shortMonthYear(cols.at(-1).key)}</span>
            )}
          </div>
          <div className="hist-ctl-group">
            <div className="hist-ctl">
              <span className="hist-ctl-label">Rows</span>
              <Segmented ariaLabel="Group rows by" value={groupBy} options={GROUPS} onChange={changeGroup} />
            </div>
            <div className="hist-ctl">
              <span className="hist-ctl-label">Show</span>
              <Segmented ariaLabel="Show" value={mode} options={modes} onChange={setMode} />
            </div>
          </div>
        </div>
        <HistoryTiles history={history} />
        {cols.length === 0 ? (
          <div className="hist-card hist-state">
            <h2>No months in this range</h2>
            <p>Choose All to see every month on file.</p>
          </div>
        ) : (
          <HistoryGrid
            key={`${groupBy}-${range}`}
            history={history}
            groupBy={groupBy}
            mode={mode}
            groupOf={groupOf}
            currentKey={currentKey}
            lastDate={lastDate}
            onMonth={openMonth}
            onCategory={openCategory('grid')}
            mobile={mobile}
          />
        )}
        <p className="hist-note" style={{ marginTop: 10 }}>
          {mobile
            ? 'Tap a month to see planned, actual and what is left.'
            : groupBy === 'category'
              ? 'Click a month to see planned, actual and what is left; click a category or cell for its history and transactions.'
              : 'Click a month to see planned, actual and what is left. Switch rows to Category to open a category’s history.'}
          {' '}Budget appears only where one was set, so earlier months are never marked over or under.
        </p>
      </>
    )
  }

  return (
    <div ref={rootRef} className="hist" style={{ maxWidth: CONTENT_MAX, margin: '0 auto', scrollMarginTop: 24 }}>
      <ModuleHeader
        moduleId="history"
        icon="▤"
        title="Income and spending history"
        subtitle="Every month on file, with your budget overlaid from 2026"
        mobile={mobile}
      />
      {body}
    </div>
  )
}

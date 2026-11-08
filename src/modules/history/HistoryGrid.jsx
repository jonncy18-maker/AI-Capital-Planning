import { useLayoutEffect, useRef, useState } from 'react'
import { budgetStatus } from '../../lib/history/historySeries.js'
import { longMonth, num, usd } from './historyUi.jsx'

const ROW_LIMIT = 25
const CARD_PAGE = 6
const CARD_ROWS = 5
const GROUP_ORDER = ['Fixed', 'Flexible', 'Non-monthly']

const statusClass = (s) => (s === 'over' ? 'c-over' : s === 'under' ? 'c-under' : '')

// One figure for a cell. "Spending" shows actual with a muted "/ budget";
// "vs budget" shows what was left or overspent. No budget: actual, no colour.
function CellBody({ actual, budget, mode }) {
  if (budget == null) return <>{num(actual)}</>
  if (mode === 'vsbudget') {
    const d = budget - actual
    if (d === 0) return <><span className="c-zero">0</span><span className="hist-tag">left</span></>
    return <>{num(Math.abs(d))}<span className="hist-tag">{d > 0 ? 'left' : 'over'}</span></>
  }
  return <>{num(actual)}<span className="hist-tag">/ {num(budget)}</span></>
}

function cellTitle(name, col, cell) {
  const when = longMonth(col.key)
  if (!cell) return `${name}, ${when}: nothing spent`
  if (cell.budget == null) return `${name}, ${when}: ${usd(cell.actual)} spent${cell.unbudgeted ? ', no budget set' : ''}`
  const d = cell.budget - cell.actual
  return `${name}, ${when}: ${usd(cell.actual)} of ${usd(cell.budget)} budget (${usd(Math.abs(d))} ${d >= 0 ? 'left' : 'over'})`
}

function groupRows(rows, groupOf) {
  const buckets = new Map()
  for (const r of rows) {
    const g = groupOf[r.name] || 'Other'
    if (!buckets.has(g)) buckets.set(g, [])
    buckets.get(g).push(r)
  }
  const rank = (g) => {
    const i = GROUP_ORDER.indexOf(g)
    return i < 0 ? GROUP_ORDER.length : i
  }
  return [...buckets.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
}

function MonthCards({ history, mode, onMonth, currentKey }) {
  const [count, setCount] = useState(CARD_PAGE)
  const cols = history.columns.filter((c) => c.key <= currentKey).reverse()
  const shown = cols.slice(0, count)
  return (
    <div className="hist-cards">
      {shown.map((col) => {
        if (!col.hasData) {
          return (
            <div key={col.key} className="hist-card hist-mcard c-gap">
              <div className="hist-mcard-head">
                <strong>{longMonth(col.key)}</strong>
                <span className="hist-mono">no data</span>
              </div>
              <div className="hist-note" style={{ marginTop: 4 }}>No transactions synced for this month. Totals skip it.</div>
            </div>
          )
        }
        const monthRows = history.rows
          .filter((r) => r.cells[col.key])
          .sort((a, b) => b.cells[col.key].actual - a.cells[col.key].actual)
        const top = monthRows.slice(0, CARD_ROWS)
        const status = budgetStatus(col.spend, col.budget)
        return (
          <button
            key={col.key}
            type="button"
            className="hist-card hist-mcard"
            onClick={() => onMonth(col.key)}
            aria-label={`Open ${longMonth(col.key)}: ${usd(col.spend)} spent`}
          >
            <div className="hist-mcard-head">
              <strong>{longMonth(col.key)}</strong>
              <span className={`hist-mono ${status === 'over' ? 'hist-over' : ''}`}>
                {usd(col.spend)}
                {col.budget != null && <span className="hist-tag">/ {num(col.budget)}</span>}
              </span>
            </div>
            <div className="hist-note" style={{ marginBottom: 6 }}>Income {usd(col.income)}</div>
            {top.map((r) => {
              const cell = r.cells[col.key]
              return (
                <div key={r.name} className="hist-mcard-row">
                  <span>{r.name}</span>
                  <span className={`hist-mono ${statusClass(cell.status)}`}>
                    <CellBody actual={cell.actual} budget={cell.budget} mode={mode} />
                  </span>
                </div>
              )
            })}
            <div className="hist-note" style={{ marginTop: 6, color: 'var(--accent)' }}>
              {monthRows.length > CARD_ROWS ? `+${monthRows.length - CARD_ROWS} more · ` : ''}See month ›
            </div>
          </button>
        )
      })}
      {cols.length > count && (
        <button type="button" className="hist-btn" style={{ justifyContent: 'center' }} onClick={() => setCount((c) => c + CARD_PAGE)}>
          Show earlier months ({cols.length - count} more)
        </button>
      )}
    </div>
  )
}

export default function HistoryGrid({ history, groupBy, mode, groupOf, currentKey, lastDate, onMonth, onCategory, mobile }) {
  const scrollRef = useRef(null)
  const [showAll, setShowAll] = useState(false)
  const { columns, rows } = history
  const canDrill = groupBy === 'category'
  const firstKey = columns[0]?.key

  // Open on the newest months; the range usually starts years back.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const toEnd = () => { el.scrollLeft = el.scrollWidth }
    toEnd()
    // Web fonts widen the columns after first paint; re-pin once they land.
    document.fonts?.ready.then(toEnd)
  }, [columns.length, firstKey, groupBy, mode])

  if (mobile) return <MonthCards key={`${columns[0]?.key}-${groupBy}`} history={history} mode={mode} onMonth={onMonth} currentKey={currentKey} />

  const anyBudget = columns.some((c) => c.hasData && c.budget != null)
  const visible = showAll ? rows : rows.slice(0, ROW_LIMIT)
  const sections = groupBy === 'category' ? groupRows(visible, groupOf) : [[null, visible]]
  const span = columns.length + 1

  const renderRow = (r) => (
    <tr key={r.name}>
      <td className="hist-name" title={r.name}>
        {canDrill ? (
          <button type="button" className="hist-rowbtn" onClick={() => onCategory(r.name)} aria-label={`Open ${r.name} history`}>
            {r.name}
          </button>
        ) : r.name}
        {r.noBudget && <span className="hist-nobud">no budget</span>}
      </td>
      {columns.map((c) => {
        if (c.key > currentKey) return <td key={c.key} className="c-future" aria-label="future month" />
        if (!c.hasData) return <td key={c.key} className="c-gap" title={`${longMonth(c.key)}: no transactions synced`} />
        const cell = r.cells[c.key]
        const open = canDrill ? () => onCategory(r.name, c.key) : () => onMonth(c.key)
        if (!cell) return <td key={c.key} className="c-zero is-click" title={cellTitle(r.name, c, null)} onClick={open}>–</td>
        const tone = cell.budget != null ? statusClass(cell.status) : mode === 'vsbudget' ? 'c-grey' : ''
        return (
          <td key={c.key} className={`${tone} is-click`} title={cellTitle(r.name, c, cell)} onClick={open}>
            <CellBody actual={cell.actual} budget={cell.budget} mode={mode} />
          </td>
        )
      })}
      <td className="hist-tot">{num(r.total)}</td>
    </tr>
  )

  return (
    <div className="hist-card hist-gridcard">
      <div className="hist-scroll" ref={scrollRef}>
        <table className="hist-table">
          <thead>
            <tr>
              <th scope="col" className="hist-name">{groupBy === 'merchant' ? 'Merchant' : groupBy === 'group' ? 'Group' : 'Category'}</th>
              {columns.map((c) => (
                <th key={c.key} scope="col">
                  {c.hasData ? (
                    <button type="button" className="hist-mbtn" onClick={() => onMonth(c.key)} aria-label={`Open ${longMonth(c.key)}`} title={`Open ${longMonth(c.key)}`}>
                      {c.label}
                    </button>
                  ) : (
                    <span className="hist-th-muted" title={c.key > currentKey ? 'Future month' : 'No transactions synced'}>{c.label}</span>
                  )}
                </th>
              ))}
              <th scope="col" className="hist-tot">Total</th>
            </tr>
          </thead>
          <tbody>
            {sections.map(([group, list]) => [
              group && (
                <tr key={`g-${group}`} className="hist-grp">
                  <td className="hist-name" style={{ background: 'var(--bg-card-2)' }}>{group}</td>
                  <td colSpan={span} />
                </tr>
              ),
              ...list.map(renderRow),
            ])}
          </tbody>
          <tfoot>
            <tr>
              <td className="hist-name">Total spent</td>
              {columns.map((c) => {
                if (c.key > currentKey) return <td key={c.key} className="c-future" />
                if (!c.hasData) return <td key={c.key} className="c-gap">no data</td>
                const status = budgetStatus(c.spend, c.budget)
                return (
                  <td key={c.key} className={`${c.budget != null ? statusClass(status) : ''} is-click`} onClick={() => onMonth(c.key)} title={`Open ${longMonth(c.key)}`}>
                    <CellBody actual={c.spend} budget={c.budget} mode={mode} />
                  </td>
                )
              })}
              <td className="hist-tot">{num(history.totals.spent)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {rows.length > ROW_LIMIT && (
        <div className="hist-more">
          <button type="button" className="hist-link" onClick={() => setShowAll((s) => !s)}>
            {showAll ? `Show top ${ROW_LIMIT} only` : `Show all ${rows.length} ${groupBy === 'merchant' ? 'merchants' : 'rows'}`}
          </button>
        </div>
      )}
      <div className="hist-gridfoot">
        <div className="hist-legend">
          {anyBudget && <span><i className="hist-sw c-over" />over budget</span>}
          {anyBudget && <span><i className="hist-sw c-under" />under by 10%+</span>}
          <span><i className="hist-sw c-gap" />no transactions synced</span>
          <span className="hist-mono">{mode === 'vsbudget' ? 'left / over budget, $' : <>spent <span className="hist-tag">/ budget</span>, $</>}</span>
        </div>
        <span>
          Totals cover {history.totals.monthsWithData} of {history.totals.monthsInRange} months
          {lastDate ? ` · transactions through ${lastDate}` : ''}
        </span>
      </div>
    </div>
  )
}

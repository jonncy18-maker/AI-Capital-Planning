import { budgetStatus } from '../../lib/history/historySeries.js'
import { Breadcrumb, MonthStepper, longMonth, num, usd } from './historyUi.jsx'

const GROUP_ORDER = ['Fixed', 'Flexible', 'Non-monthly']

function CategoryRow({ c, hasBudget, onCategory }) {
  const status = budgetStatus(c.actual, c.planned)
  const over = c.planned != null && c.actual > c.planned
  const fill = c.planned == null ? 0 : c.planned > 0 ? Math.min(100, (c.actual / c.planned) * 100) : c.actual > 0 ? 100 : 0
  let note = null
  if (c.planned != null) note = c.left >= 0 ? `${usd(c.left)} left` : `${usd(-c.left)} over`
  else if (hasBudget) note = 'no budget'
  return (
    <div className="hist-crow">
      <div className="hist-crow-nm">
        <button type="button" className="hist-rowbtn" onClick={() => onCategory(c.name)} aria-label={`Open ${c.name} history`}>{c.name}</button>
        {c.planned != null && (
          <div className="hist-meter" role="img" aria-label={`${Math.round(fill)}% of budget used`}>
            <i className={over ? 'hot' : ''} style={{ width: `${fill}%` }} />
          </div>
        )}
      </div>
      <div className={`hist-crow-amt ${status === 'over' ? 'hist-over' : ''}`}>
        {num(c.actual)}{c.planned != null && <span className="hist-tag">/ {num(c.planned)}</span>}
        {note && <small>{note}</small>}
      </div>
    </div>
  )
}

function Flow({ income, expenses }) {
  const saved = income - expenses
  const max = Math.max(income, expenses, Math.abs(saved), 1)
  const h = (v) => `${(Math.abs(v) / max) * 100}%`
  const bars = [
    { name: 'Income', v: income, color: 'var(--accent)' },
    { name: 'Expenses', v: expenses, color: 'var(--red)' },
    { name: saved >= 0 ? 'Saved' : 'Overspent', v: saved, color: saved >= 0 ? 'var(--green)' : 'var(--bad-bg)', border: saved < 0 ? '1px dashed var(--red)' : 'none' },
  ]
  return (
    <div role="img" aria-label={`Income ${usd(income)}, expenses ${usd(expenses)}, ${saved >= 0 ? 'saved' : 'overspent'} ${usd(Math.abs(saved))}`}>
      <div className="hist-flow">
        {bars.map((b) => (
          <div key={b.name} className="hist-flow-col">
            <b>{usd(Math.abs(b.v))}</b>
            <div className="hist-flow-bar" style={{ height: h(b.v), background: b.color, border: b.border }} />
          </div>
        ))}
      </div>
      <div className="hist-flow-labels">
        {bars.map((b) => <span key={b.name}>{b.name}</span>)}
      </div>
    </div>
  )
}

export default function MonthDetail({ detail, monthKeys, hasData, onMonth, onCategory, onBack }) {
  const groups = new Map()
  for (const c of detail.categories) {
    const g = c.group || 'Other'
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g).push(c)
  }
  const rank = (g) => (GROUP_ORDER.includes(g) ? GROUP_ORDER.indexOf(g) : GROUP_ORDER.length)
  const sections = [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
  const plannedStatus = budgetStatus(detail.expenses, detail.planned)

  return (
    <div>
      <div className="hist-pagehead">
        <Breadcrumb items={[{ label: 'History', onClick: onBack }, { label: longMonth(detail.month) }]} />
        <MonthStepper keys={monthKeys} value={detail.month} onChange={onMonth} hasData={hasData} />
      </div>

      {!detail.hasData ? (
        <div className="hist-card hist-state">
          <div className="hist-state-icon" aria-hidden="true">▤</div>
          <h2>No data for {longMonth(detail.month)}</h2>
          <p>No transactions were synced for this month, so it is left out of every total rather than shown as $0.</p>
        </div>
      ) : (
        <div className="hist-two">
          <section className="hist-card hist-panel" aria-label="Spending by category">
            <div className="hist-panel-head">
              <span className="hist-label">Expenses by category</span>
              <span className={`hist-mono ${plannedStatus === 'over' ? 'hist-over' : ''}`}>
                {usd(detail.expenses)}
                {detail.planned != null && <span className="hist-tag">of {usd(detail.planned)} planned</span>}
              </span>
            </div>
            {!detail.hasBudget && <p className="hist-note" style={{ margin: '0 0 6px' }}>No budget was set for this month, so only spending is shown.</p>}
            {sections.map(([g, list]) => (
              <div key={g}>
                {sections.length > 1 && <div className="hist-label hist-subgrp">{g}</div>}
                {list.map((c) => <CategoryRow key={c.name} c={c} hasBudget={detail.hasBudget} onCategory={onCategory} />)}
              </div>
            ))}
          </section>
          <section className="hist-card hist-panel" aria-label="Income vs expenses">
            <div className="hist-label" style={{ marginBottom: 4 }}>Income vs expenses</div>
            <Flow income={detail.income} expenses={detail.expenses} />
            <p className="hist-note" style={{ marginTop: 12 }}>Transfers and credit-card payments are left out of both, the same rule the Dashboard uses.</p>
            <p className="hist-note" style={{ marginTop: 6 }}>Select a category to see its month-by-month history and transactions.</p>
          </section>
        </div>
      )}
    </div>
  )
}

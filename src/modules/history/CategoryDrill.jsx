import { useState } from 'react'
import { Breadcrumb, MonthStepper, dayLabel, longMonth, num, shortMonth, usd, usd2 } from './historyUi.jsx'

const WINDOW = 12

export default function CategoryDrill({ category, group, bars, month, rows, onMonth, crumbs, hasData }) {
  const keys = bars.map((b) => b.key)
  const sel = Math.max(0, keys.indexOf(month))
  const [end, setEnd] = useState(Math.max(sel, Math.min(keys.length - 1, WINDOW - 1)))
  // Keep the selected month inside the visible 12-month window.
  const winEnd = sel > end ? sel : sel < end - (WINDOW - 1) ? sel + WINDOW - 1 : end
  const start = Math.max(0, winEnd - (WINDOW - 1))
  const shown = bars.slice(start, winEnd + 1)
  const max = Math.max(1, ...shown.map((b) => Math.max(b.actual, b.budget ?? 0)))
  const pctOf = (v) => `${(v / max) * 100}%`

  const cur = bars[sel]
  const withData = bars.filter((b) => b.hasData)
  const avg = withData.length ? Math.round(withData.reduce((s, b) => s + b.actual, 0) / withData.length) : null
  const total = rows.reduce((s, r) => s + r.cents, 0)
  const sorted = [...rows].sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.index - a.index)

  const shift = (d) => setEnd(Math.min(keys.length - 1, Math.max(WINDOW - 1, winEnd + d)))

  return (
    <div>
      <div className="hist-pagehead">
        <Breadcrumb items={[...crumbs, { label: category }]} />
        <MonthStepper keys={keys} value={month} onChange={onMonth} hasData={hasData} />
      </div>

      <div className="hist-stats">
        <div className="hist-card hist-tile">
          <div className="hist-label">{longMonth(month)}</div>
          <div className={`hist-tile-v ${cur?.budget != null && cur.actual > cur.budget ? 'hist-over' : ''}`}>
            {cur?.hasData ? usd(cur.actual) : '—'}
          </div>
          <div className="hist-tile-s">
            {!cur?.hasData ? 'no data this month' : cur.budget != null ? `of ${usd(cur.budget)} budget` : 'no budget this month'}
          </div>
        </div>
        <div className="hist-card hist-tile">
          <div className="hist-label">Monthly average</div>
          <div className="hist-tile-v">{avg == null ? '—' : usd(avg)}</div>
          <div className="hist-tile-s">over {withData.length} months with data</div>
        </div>
        <div className="hist-card hist-tile hist-hide-m">
          <div className="hist-label">Group</div>
          <div className="hist-tile-v" style={{ fontSize: 19 }}>{group || '—'}</div>
          <div className="hist-tile-s">{category}</div>
        </div>
      </div>

      <section className="hist-card hist-panel" style={{ marginBottom: 14 }} aria-label={`${category} by month`}>
        <div className="hist-panel-head">
          <span className="hist-label">{category} by month · {longMonth(shown[0]?.key)} – {longMonth(shown.at(-1)?.key)}</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="hist-iconbtn" disabled={start === 0} onClick={() => shift(-WINDOW)} aria-label="Earlier 12 months">‹</button>
            <button type="button" className="hist-iconbtn" disabled={winEnd >= keys.length - 1} onClick={() => shift(WINDOW)} aria-label="Later 12 months">›</button>
          </span>
        </div>
        <div className="hist-chart">
          <span className="hist-chart-axis" style={{ top: 8 }}>{num(max)}</span>
          <span className="hist-chart-axis" style={{ top: 178 }}>0</span>
          <div className="hist-bars">
            <div className="hist-bars-grid" style={{ top: 0 }} />
            <div className="hist-bars-grid" style={{ top: '50%' }} />
            {shown.map((b) => {
              const over = b.budget != null && b.actual > b.budget
              const label = `${longMonth(b.key)}: ${b.hasData ? `${usd(b.actual)}${b.budget != null ? ` of ${usd(b.budget)} budget` : ''}` : 'no data'}`
              return (
                <button
                  key={b.key}
                  type="button"
                  className={`hist-barcol${b.key === month ? ' is-sel' : ''}`}
                  onClick={() => onMonth(b.key)}
                  aria-label={label}
                  aria-pressed={b.key === month}
                  title={label}
                >
                  {b.hasData
                    ? <div className={`hist-bar${over ? ' hot' : ''}`} style={{ height: pctOf(b.actual) }} />
                    : <div className="hist-bar gap" />}
                  {b.budget != null && b.hasData && <div className="hist-budtick" style={{ bottom: pctOf(b.budget) }} />}
                </button>
              )
            })}
          </div>
          <div className="hist-barlabels" aria-hidden="true">
            {shown.map((b, i) => (
              <span key={b.key} className={b.key === month ? 'is-sel' : ''}>
                {shortMonth(b.key)}
                {(i === 0 || b.key.endsWith('-01')) && <><br />{b.key.slice(0, 4)}</>}
              </span>
            ))}
          </div>
        </div>
        <p className="hist-note" style={{ marginTop: 10 }}>
          Dashed line is that month&apos;s budget; bars over it turn red. Hatched means no transactions synced. Select a bar to see its transactions.
        </p>
      </section>

      <section className="hist-card hist-panel" aria-label={`${category} transactions in ${longMonth(month)}`}>
        <div className="hist-panel-head">
          <span className="hist-label">{longMonth(month)} · {rows.length} transaction{rows.length === 1 ? '' : 's'}</span>
          {rows.length > 0 && <span className="hist-mono">{usd2(total)}</span>}
        </div>
        {sorted.length === 0 && (
          <p className="hist-note" style={{ padding: '6px 0' }}>
            {cur?.hasData ? `No ${category} spending in ${longMonth(month)}.` : `No transactions were synced for ${longMonth(month)}.`}
          </p>
        )}
        {sorted.map((r) => (
          <div key={r.index} className="hist-txn">
            <div className="hist-txn-nm">
              <div title={r.merchant}>{r.merchant}</div>
              <small>{dayLabel(r.date)}{r.account ? ` · ${r.account}` : ''}</small>
            </div>
            <span className="hist-mono">{usd2(r.cents)}</span>
          </div>
        ))}
      </section>
    </div>
  )
}

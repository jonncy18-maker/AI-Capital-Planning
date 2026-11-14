import { formatMoney, fromCents } from '../../lib/money.js'

export const usd = (cents) => formatMoney(fromCents(cents))
export const usd2 = (cents) => formatMoney(fromCents(cents), { decimals: 2 })
// Grid figures: whole dollars without the "$" so dense columns stay readable.
export const num = (cents) => usd(cents).replace('$', '')
export const pct = (ratio) => (ratio == null ? '—' : `${(ratio * 100).toFixed(1)}%`)

const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function longMonth(key) {
  if (!key) return ''
  const [y, m] = key.split('-').map(Number)
  return `${LONG[m - 1]} ${y}`
}
export function shortMonthYear(key) {
  if (!key) return ''
  const [y, m] = key.split('-').map(Number)
  return `${SHORT[m - 1]} ${y}`
}
export function shortMonth(key) {
  return SHORT[Number(key.split('-')[1]) - 1]
}
export function dayLabel(date) {
  const m = String(date).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${SHORT[Number(m[2]) - 1]} ${Number(m[3])}` : String(date)
}
export function fullDayLabel(date) {
  const m = String(date).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${SHORT[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : String(date)
}
export function currentMonthKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function Segmented({ value, options, onChange, ariaLabel }) {
  return (
    <div role="group" aria-label={ariaLabel} className="hist-seg">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// items: [{ label, onClick }]; the last item is the current page.
export function Breadcrumb({ items }) {
  return (
    <nav aria-label="Breadcrumb" className="hist-crumb">
      {items.map((it, i) => {
        const last = i === items.length - 1
        return (
          <span key={it.label} className="hist-crumb-item">
            {last ? (
              <span aria-current="page" className="hist-crumb-here">{it.label}</span>
            ) : (
              <button type="button" className="hist-link" onClick={it.onClick}>
                {i === 0 ? '‹ ' : ''}{it.label}
              </button>
            )}
            {!last && <span aria-hidden="true" className="hist-crumb-sep">›</span>}
          </span>
        )
      })}
    </nav>
  )
}

export function MonthStepper({ keys, value, onChange, hasData }) {
  const idx = keys.indexOf(value)
  return (
    <div className="hist-stepper">
      <button type="button" className="hist-iconbtn" disabled={idx <= 0} onClick={() => onChange(keys[idx - 1])} aria-label="Previous month">‹</button>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Choose month">
        {[...keys].reverse().map((k) => (
          <option key={k} value={k}>{longMonth(k)}{hasData && !hasData(k) ? ' (no data)' : ''}</option>
        ))}
      </select>
      <button type="button" className="hist-iconbtn" disabled={idx < 0 || idx >= keys.length - 1} onClick={() => onChange(keys[idx + 1])} aria-label="Next month">›</button>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { formatMoney } from '../../../lib/money.js'

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Same precedent as Forecast.jsx: the what-if purple is not a theme token.
export const WHATIF = '#a864ff'

// Chart plot margins, shared so the net bars line up with the balance line.
export const CHART_LEFT = 46
export const CHART_RIGHT = 12
export const MIN_CHART_WIDTH = 280

export function fmtDate(ymd, withWeekday = false) {
  const [y, m, d] = ymd.split('-').map(Number)
  const label = `${MONTH_ABBR[m - 1]} ${d}`
  return withWeekday ? `${DAY_ABBR[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${label}` : label
}

export const money = n => (n == null ? '—' : formatMoney(n))
export const signedMoney = n => formatMoney(n, { signed: true })
export const money2 = n => (n == null ? '—' : formatMoney(n, { decimals: 2 }))

export function MonoLabel({ children, style }) {
  return (
    <div style={{
      fontFamily: "'DM Mono', monospace", fontSize: 9.5,
      color: 'var(--tx-3)', letterSpacing: '0.06em', ...style,
    }}>{children}</div>
  )
}

export function Badge({ children, color = 'var(--tx-3)' }) {
  return (
    <span style={{
      fontFamily: "'DM Mono', monospace", fontSize: 8.5, letterSpacing: '0.06em',
      color, border: `1px solid ${color}`, borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

export function Segmented({ value, options, onChange }) {
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

export const inputStyle = {
  fontFamily: "'DM Mono', monospace", fontSize: 12, color: 'var(--tx-1)',
  background: 'var(--bg-app)', border: '1px solid var(--bd)', borderRadius: 6, padding: '7px 9px',
}

// Width of the element, tracked with ResizeObserver, never below the minimum.
export function useChartWidth() {
  const ref = useRef(null)
  const [width, setWidth] = useState(MIN_CHART_WIDTH)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const measure = () => setWidth(Math.max(MIN_CHART_WIDTH, Math.floor(el.getBoundingClientRect().width)))
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

export function makeXScale(width, xDomain) {
  const plotW = width - CHART_LEFT - CHART_RIGHT
  return u => CHART_LEFT + (u / (xDomain[1] - xDomain[0])) * plotW
}

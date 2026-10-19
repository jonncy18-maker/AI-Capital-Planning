import { useEffect, useRef, useState } from 'react'
import ChartTooltip, { nearestIndex } from './ChartTooltip.jsx'

export default function WealthChart({
  planned,
  actual,
  start,
  end,
  title,
  comparison = [],
  monthly = false,
}) {
  const container = useRef(null)
  const [width, setWidth] = useState(700)
  const [hover, setHover] = useState(null)
  useEffect(() => {
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(240, entries[0].contentRect.width))
    )
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [])
  const visible = (rows) =>
    rows.filter(
      (p) => p.date >= start && p.date <= end && p.value != null && Number.isFinite(Number(p.value))
    )
  const expected = visible(planned),
    recorded = visible(actual),
    overlay = visible(comparison)
  const values = [...expected, ...recorded, ...overlay].map((p) => Number(p.value))
  const min = Math.min(0, ...values),
    max = Math.max(1, ...values),
    span = max - min
  const timestamp = (s) => new Date(`${s}T00:00:00Z`).getTime()
  const x = (d) =>
    60 +
    ((timestamp(d) - timestamp(start)) / Math.max(1, timestamp(end) - timestamp(start))) *
      (width - 80)
  const y = (n) => 20 + ((max - Number(n)) / span) * 200
  const path = (rows) => rows.map((p, i) => `${i ? 'L' : 'M'}${x(p.date)},${y(p.value)}`).join(' ')
  const tickDates = monthly
    ? Array.from(
        { length: 12 },
        (_, i) => `${start.slice(0, 4)}-${String(i + 1).padStart(2, '0')}-01`
      )
    : Array.from({ length: 5 }, (_, i) =>
        new Date(timestamp(start) + ((timestamp(end) - timestamp(start)) * i) / 4)
          .toISOString()
          .slice(0, 10)
      )
  // Hover stops: every planned point plus any recorded date, in date order.
  const stops = [...new Set([...expected, ...recorded, ...overlay].map((p) => p.date))].sort()
  const at = (rows, d) => rows.find((p) => p.date === d)
  const money = (n) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(n)
  const hoverDate = hover != null ? stops[hover] : null
  const ticks = Array.from({ length: 5 }, (_, i) => min + (span * i) / 4)
  const displayedTicks =
    width < 500
      ? tickDates.filter((_, i) => (monthly ? i % 2 === 0 || i === 11 : i % 2 === 0))
      : tickDates
  return (
    <div className="wealth-panel">
      <div ref={container}>
        <h3>{title}</h3>
        <p className="wealth-muted">
          Dashed: saved plan · dots: recorded actuals (gaps are not interpolated)
          {overlay.length > 0 ? ' · solid: without commitments' : ''}
        </p>
        {!values.length ? (
          <p>No saved plan or actuals in this period.</p>
        ) : (
          <svg
            viewBox={`0 0 ${width} 260`}
            role="img"
            aria-label={title}
            className="wealth-chart"
            onPointerMove={(e) =>
              setHover(
                nearestIndex(
                  e,
                  width,
                  stops.map((d) => x(d))
                )
              )
            }
            onPointerLeave={() => setHover(null)}
            style={{ touchAction: 'pan-y' }}
          >
            <title>{title}</title>
            {ticks.map((value, i) => (
              <g key={i}>
                <line x1="60" x2={width - 20} y1={y(value)} y2={y(value)} stroke="var(--bd)" />
                <text x="54" y={y(value) + 4} textAnchor="end" fontSize="11" fill="var(--tx-3)">
                  {new Intl.NumberFormat('en-US', {
                    notation: 'compact',
                    style: 'currency',
                    currency: 'USD',
                    maximumFractionDigits: 1,
                  }).format(value)}
                </text>
              </g>
            ))}
            <path
              d={path(expected)}
              fill="none"
              stroke="var(--tx-3)"
              strokeWidth="2"
              strokeDasharray="5 4"
            />
            {overlay.length > 0 && (
              <path d={path(overlay)} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
            )}
            {recorded.map((p, i) => (
              <circle
                key={`${p.date}-${i}`}
                cx={x(p.date)}
                cy={y(p.value)}
                r="4"
                fill="var(--accent)"
              >
                <title>
                  {p.date}:{' '}
                  {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
                    p.value
                  )}
                </title>
              </circle>
            ))}
            {displayedTicks.map((d, i) => (
              <text
                key={i}
                x={x(d)}
                y="246"
                textAnchor={i === 0 ? 'start' : i === displayedTicks.length - 1 ? 'end' : 'middle'}
                fontSize="11"
                fill="var(--tx-3)"
              >
                {monthly
                  ? new Date(`${d}T00:00:00Z`).toLocaleString('en-US', {
                      month: 'short',
                      timeZone: 'UTC',
                    })
                  : d.slice(0, 7)}
              </text>
            ))}
            {hoverDate && (
              <ChartTooltip
                x={x(hoverDate)}
                top={20}
                bottom={220}
                width={width}
                title={new Date(`${hoverDate}T00:00:00Z`).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  timeZone: 'UTC',
                })}
                rows={[
                  ['Plan', expected, 'var(--tx-3)'],
                  ['Without commitments', overlay, 'var(--accent)'],
                  ['Recorded', recorded, 'var(--accent)'],
                ]
                  .map(([label, rows, color]) => [label, at(rows, hoverDate), color])
                  .filter(([, p]) => p)
                  .map(([label, p, color]) => ({
                    label,
                    text: money(Number(p.value)),
                    color,
                    y: y(p.value),
                  }))}
              />
            )}
          </svg>
        )}
      </div>
    </div>
  )
}

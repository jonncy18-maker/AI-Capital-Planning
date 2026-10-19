// Hover readout for the wealth SVG charts: a guide line, a dot per series and a
// small box with the period label and one row per series. Coordinates are in
// the chart's viewBox units; the box flips left near the right edge.
export default function ChartTooltip({ x, top, bottom, width, title, rows }) {
  const lineH = 16
  const boxW = Math.max(
    130,
    ...[title, ...rows.map((r) => `${r.label}  ${r.text}`)].map((t) => t.length * 6.4 + 20)
  )
  const boxH = 10 + lineH * (rows.length + 1)
  const left = x + 12 + boxW > width ? x - 12 - boxW : x + 12
  return (
    <g pointerEvents="none">
      <line x1={x} x2={x} y1={top} y2={bottom} stroke="var(--tx-3)" strokeDasharray="3 3" />
      {rows
        .filter((r) => r.y != null)
        .map((r) => (
          <circle
            key={r.label}
            cx={x}
            cy={r.y}
            r="4"
            fill={r.color}
            stroke="var(--bg-card)"
            strokeWidth="1.5"
          />
        ))}
      <rect
        x={left}
        y={top}
        width={boxW}
        height={boxH}
        rx="6"
        fill="var(--bg-card)"
        stroke="var(--bd)"
      />
      <text x={left + 10} y={top + 18} fontSize="11" fontWeight="600" fill="var(--tx-1)">
        {title}
      </text>
      {rows.map((r, i) => (
        <g key={r.label}>
          <circle cx={left + 13} cy={top + 14 + lineH * (i + 1)} r="3.5" fill={r.color} />
          <text x={left + 22} y={top + 18 + lineH * (i + 1)} fontSize="11" fill="var(--tx-2)">
            {r.label}
          </text>
          <text
            x={left + boxW - 10}
            y={top + 18 + lineH * (i + 1)}
            fontSize="11"
            textAnchor="end"
            fill="var(--tx-1)"
          >
            {r.text}
          </text>
        </g>
      ))}
    </g>
  )
}

// Index of the point whose x is nearest to the pointer, in viewBox units.
export function nearestIndex(event, viewWidth, xs) {
  const rect = event.currentTarget.getBoundingClientRect()
  const vx = ((event.clientX - rect.left) / Math.max(1, rect.width)) * viewWidth
  let best = -1,
    dist = Infinity
  xs.forEach((px, i) => {
    const d = Math.abs(px - vx)
    if (d < dist) {
      dist = d
      best = i
    }
  })
  return best
}

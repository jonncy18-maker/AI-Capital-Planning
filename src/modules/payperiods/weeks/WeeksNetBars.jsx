import { CHART_LEFT, CHART_RIGHT, makeXScale, money, signedMoney, useChartWidth } from './WeeksShared.jsx'

const HEIGHT = 90
const PAD = 14

// Weekly net cash movement on the same x scale as the balance chart. Shows the
// base plan only, never a what-if.
export default function WeeksNetBars({ model, selected, onSelect, hasOverlay }) {
  const [wrapRef, width] = useChartWidth()
  const x = makeXScale(width, model.xDomain)
  const nets = model.bars.filter(b => b.net != null).map(b => Math.abs(b.net))
  const max = Math.max(1, ...nets)
  const mid = HEIGHT / 2
  const scale = (mid - PAD) / max
  const barW = Math.max(4, (x(7) - x(0)) * 0.6)

  return (
    <div ref={wrapRef}>
      <div style={{ border: '1px solid var(--bd)', borderRadius: 11, background: 'var(--bg-card)' }}>
        <svg width="100%" height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} style={{ display: 'block' }}>
          <line x1={CHART_LEFT} x2={width - CHART_RIGHT} y1={mid} y2={mid} stroke="var(--bd)" strokeWidth="1" />
          <text x={CHART_LEFT - 6} y={PAD - 2} fontSize="10" textAnchor="end" fill="var(--tx-3)">+{money(max)}</text>
          <text x={CHART_LEFT - 6} y={HEIGHT - 4} fontSize="10" textAnchor="end" fill="var(--tx-3)">−{money(max)}</text>
          {model.bars.map(b => {
            const cx = x(b.xc)
            const h = b.net == null ? 0 : Math.abs(b.net) * scale
            const top = b.net != null && b.net >= 0 ? mid - h : mid
            return (
              <g key={`${b.kind}${b.index}`} onClick={() => onSelect(b.index)} style={{ cursor: 'pointer' }}>
                <rect x={cx - barW / 2 - 2} y={0} width={barW + 4} height={HEIGHT} fill="transparent" />
                {b.net != null && (
                  <rect
                    x={cx - barW / 2} y={top} width={barW} height={Math.max(1, h)}
                    fill={b.kind === 'actual' ? 'var(--tx-3)' : 'var(--accent)'}
                    fillOpacity={b.kind === 'actual' ? 1 : 0.6}
                    stroke={b.approximate ? 'var(--warn)' : 'none'} strokeWidth="1.5"
                  >
                    <title>{`Week of ${b.weekStart}: ${signedMoney(b.net)}`}</title>
                  </rect>
                )}
                {b.index === selected && (
                  <rect x={cx - barW / 2 - 3} y={1} width={barW + 6} height={HEIGHT - 2} rx="4" fill="none" stroke="var(--tx-1)" strokeWidth="1" />
                )}
              </g>
            )
          })}
        </svg>
      </div>
      <div style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 4 }}>
        Weekly net cash in or out · grey = actual, tinted = projected
        {hasOverlay && ' · What-ifs are not shown in the bars'}
      </div>
    </div>
  )
}

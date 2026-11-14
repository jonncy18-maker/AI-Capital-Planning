import { useState } from 'react'
import ChartTooltip, { nearestIndex } from '../../wealth/ChartTooltip.jsx'
import {
  CHART_LEFT, CHART_RIGHT, MonoLabel, WHATIF, fmtDate, makeXScale, money, money2, signedMoney, useChartWidth,
} from './WeeksShared.jsx'

const HEIGHT = 220
const TOP = 14
const BOTTOM = 26

// Gap reasons are long; the tooltip box sizes itself to its widest line, so wrap.
function wrap(text, size = 28) {
  const words = String(text).split(' ')
  const lines = []
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > size && cur) { lines.push(cur); cur = w } else cur = (cur + ' ' + w).trim()
  }
  if (cur) lines.push(cur)
  return lines
}

export function describeWeek(sel) {
  if (!sel) return ''
  const when = `Week of ${fmtDate(sel.weekStart)}`
  if (sel.gap) return `${when}: ${sel.gapReason}`
  return `${when}: ${money2(sel.value)}`
}

// One selectable entry per week, history first. x is the week's end (u = 28 + 7 * (i + 1)).
export function buildSelectables(history, series, overlay) {
  const out = []
  for (const p of history?.points ?? []) {
    out.push({
      index: p.index, kind: 'actual', weekStart: p.weekStart, x: 28 + 7 * (p.index + 1),
      value: p.balance, gap: p.gap, gapReason: p.gapReason, approximate: p.approximate,
      approxReasons: p.approxReasons, net: p.net,
    })
  }
  for (const w of series.weeks) {
    const o = overlay?.weeks[w.index]
    out.push({
      index: w.index, kind: 'projected', weekStart: w.start, x: 28 + 7 * (w.index + 1),
      value: w.closing, gap: false, low: w.low, lowDate: w.lowDate, belowMin: w.belowMin, net: w.net,
      overlayClosing: o ? o.closing : null,
    })
  }
  return out
}

export default function WeeksChart({
  model, selectables, selected, onSelect, hasOverlay, emptyChildren, minBalance,
}) {
  const [wrapRef, width] = useChartWidth()
  const [hover, setHover] = useState(null)
  const narrow = width < 480
  const tickFont = narrow ? 10 : 11

  const plotBottom = HEIGHT - BOTTOM
  const x = makeXScale(width, model.xDomain)
  const [yLo, yHi] = model.yDomain ?? [0, 1]
  const y = v => TOP + ((yHi - v) / (yHi - yLo)) * (plotBottom - TOP)

  if (model.empty) {
    return (
      <div ref={wrapRef}>
        <div style={{
          border: '1px dashed var(--bd)', borderRadius: 11, padding: '16px 14px', background: 'var(--bg-card)',
        }}>
          <div style={{ borderTop: '2px dotted var(--tx-3)', margin: '6px 0 4px' }} />
          <MonoLabel style={{ marginBottom: 12 }}>MINIMUM {money(minBalance)}</MonoLabel>
          <div style={{ color: 'var(--tx-2)', fontSize: 13, marginBottom: 10 }}>
            Nothing is projected until a balance exists.
          </div>
          {emptyChildren}
        </div>
      </div>
    )
  }

  const xs = selectables.map(s => x(s.x))
  const path = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.x)},${y(p.value)}`).join(' ')
  const sel = selectables.find(s => s.index === selected)
  const hov = hover != null ? selectables[hover] : null

  function onKeyDown(e) {
    const order = selectables.map(s => s.index)
    const at = Math.max(0, order.indexOf(selected))
    let next = null
    if (e.key === 'ArrowRight') next = order[Math.min(order.length - 1, at + 1)]
    else if (e.key === 'ArrowLeft') next = order[Math.max(0, at - 1)]
    else if (e.key === 'Home') next = order[0]
    else if (e.key === 'End') next = order[order.length - 1]
    if (next != null) { e.preventDefault(); onSelect(next) }
  }

  function tooltipFor(s) {
    const rows = []
    if (s.gap) {
      wrap(s.gapReason).forEach((line, i) => {
        // Distinct invisible labels keep the row keys unique for continuation lines.
        rows.push({ label: i === 0 ? 'Gap' : '​'.repeat(i), text: line, color: 'var(--tx-3)', y: null })
      })
    } else {
      rows.push({
        label: 'Balance', text: money2(s.value), y: y(s.value),
        color: s.kind === 'actual' ? 'var(--tx-1)' : s.belowMin ? 'var(--bad)' : 'var(--accent)',
      })
    }
    if (s.kind === 'projected' && s.low != null) {
      rows.push({ label: 'Low point', text: `${money2(s.low)} · ${fmtDate(s.lowDate)}`, color: 'var(--bad)', y: null })
    }
    if (s.net != null) rows.push({ label: 'Net', text: signedMoney(s.net), color: 'var(--tx-3)', y: null })
    if (hasOverlay && s.overlayClosing != null) {
      rows.push({ label: 'What-if closing', text: money2(s.overlayClosing), y: y(s.overlayClosing), color: WHATIF })
    }
    if (s.approximate) {
      wrap(s.approxReasons.join('; ')).forEach((line, i) => {
        rows.push({ label: i === 0 ? 'Approximate' : '​'.repeat(i + 3), text: line, color: 'var(--warn)', y: null })
      })
    }
    return rows
  }

  const axisLabels = model.weekAxis.filter((_, i) => !narrow || i % 2 === 0)

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div
        tabIndex={0} role="group"
        aria-label="Checking balance by week; use arrow keys to select a week"
        onKeyDown={onKeyDown}
        style={{ border: '1px solid var(--bd)', borderRadius: 11, background: 'var(--bg-card)', outlineOffset: 2 }}
      >
        <svg
          width="100%" height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} style={{ display: 'block' }}
          onPointerMove={e => setHover(nearestIndex(e, width, xs))}
          onPointerLeave={() => setHover(null)}
          onClick={e => {
            const i = nearestIndex(e, width, xs)
            if (i >= 0) { setHover(i); onSelect(selectables[i].index) }
          }}
        >
          <rect
            x={CHART_LEFT} y={y(minBalance)} width={width - CHART_LEFT - CHART_RIGHT}
            height={Math.max(0, plotBottom - y(minBalance))} fill="var(--bad-bg)"
          />
          {model.yTicks.map(t => (
            <g key={t}>
              <line x1={CHART_LEFT} x2={width - CHART_RIGHT} y1={y(t)} y2={y(t)} stroke="var(--bd)" strokeWidth="0.5" />
              <text x={CHART_LEFT - 6} y={y(t) + 3} fontSize={tickFont} textAnchor="end" fill="var(--tx-3)">{money(t)}</text>
            </g>
          ))}
          <line
            x1={CHART_LEFT} x2={width - CHART_RIGHT} y1={y(minBalance)} y2={y(minBalance)}
            stroke="var(--tx-3)" strokeWidth="1.25" strokeDasharray="1.5 3"
          />
          <text x={width - CHART_RIGHT - 2} y={y(minBalance) - 4} fontSize={tickFont - 1} textAnchor="end" fill="var(--tx-3)">
            min {money(minBalance)}
          </text>

          {axisLabels.map(a => (
            <text key={a.index} x={x(a.x0)} y={HEIGHT - 8} fontSize={tickFont} textAnchor="middle" fill="var(--tx-3)">
              {fmtDate(a.date)}
            </text>
          ))}

          <line
            x1={x(model.todayX)} x2={x(model.todayX)} y1={TOP} y2={plotBottom}
            stroke="var(--tx-3)" strokeWidth="1" strokeDasharray="2 3"
          />
          <text x={x(model.todayX) + 4} y={TOP + 8} fontSize={tickFont - 1} fill="var(--tx-3)">Today</text>

          {model.historyLine.map((seg, i) => (
            <path key={i} d={path(seg)} fill="none" stroke="var(--tx-1)" strokeWidth="2" />
          ))}
          <path d={path(model.projectionLine)} fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray="6 4" />
          {model.overlayLine && (
            <path d={path(model.overlayLine)} fill="none" stroke={WHATIF} strokeWidth="2" strokeDasharray="5 3" />
          )}

          {model.historyLine.flat().map(p => (
            <g key={`h${p.index}`}>
              {p.approximate && <circle cx={x(p.x)} cy={y(p.value)} r="7" fill="none" stroke="var(--warn)" strokeWidth="1.5" />}
              <circle cx={x(p.x)} cy={y(p.value)} r="3.5" fill="var(--tx-1)" />
            </g>
          ))}
          {selectables.filter(s => s.gap).map(s => (
            <circle key={`g${s.index}`} cx={x(s.x)} cy={plotBottom - 7} r="4" fill="var(--bg-card)" stroke="var(--tx-3)" strokeWidth="1.5" />
          ))}
          {model.projectionLine.filter(p => p.index != null).map(p => (
            <circle
              key={`p${p.index}`} cx={x(p.x)} cy={y(p.value)} r="3.5"
              fill={p.belowMin ? 'var(--bad)' : 'var(--accent)'}
            />
          ))}
          {model.overlayLine?.filter(p => p.index != null).map(p => (
            <circle key={`o${p.index}`} cx={x(p.x)} cy={y(p.value)} r="2.5" fill={WHATIF} />
          ))}

          {sel && (
            <circle
              cx={x(sel.x)} cy={sel.gap ? plotBottom - 7 : y(sel.value)} r="9"
              fill="none" stroke="var(--tx-1)" strokeWidth="1.5"
            />
          )}

          {hov && (
            <ChartTooltip
              x={x(hov.x)} top={TOP} bottom={plotBottom} width={width}
              title={`Week of ${fmtDate(hov.weekStart)}${hov.kind === 'actual' ? ' · actual' : ' · projected'}`}
              rows={tooltipFor(hov)}
            />
          )}
        </svg>
      </div>
      <div aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {describeWeek(sel)}
      </div>
      <div style={{ fontSize: 11, color: 'var(--tx-3)', marginTop: 6 }}>
        Solid = actual (from transactions) · Dashed = projected · Red = below minimum
        {hasOverlay && <span style={{ color: WHATIF }}> · Purple dashed = what-if (view only)</span>}
      </div>
    </div>
  )
}

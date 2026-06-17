import { useState } from 'react'

// Phase 3: dashboard canvas with an empty/scaffold widget grid and a
// drag-to-rearrange scaffold. A few widgets render real numbers from the loaded
// AI context; the rest are placeholders that fill in across Phases 4–9.

function fmtMoney(n) {
  return '$' + Math.round(n || 0).toLocaleString()
}

function buildWidgets(summary) {
  return [
    {
      id: 'activity',
      title: '90-Day Activity',
      live: true,
      render: () => (
        <>
          <Stat value={summary.transactionCount.toLocaleString()} label="TRANSACTIONS" />
          <div style={{ display: 'flex', gap: '20px', marginTop: '14px' }}>
            <MiniStat value={fmtMoney(summary.spend90d)} label="spend" />
            <MiniStat value={fmtMoney(summary.income90d)} label="income" />
          </div>
        </>
      ),
    },
    {
      id: 'categories',
      title: 'Budget Categories',
      live: true,
      render: () => <Stat value={summary.categoryCount.toLocaleString()} label="MAPPED CATEGORIES" />,
    },
    {
      id: 'commitments',
      title: 'Active Commitments',
      live: true,
      render: () => <Stat value={summary.commitmentCount.toLocaleString()} label="TRACKED" />,
    },
    { id: 'spikes', title: 'Cash Flow Spikes', phase: 'Phase 4' },
    { id: 'budget', title: 'Budget vs. Actual', phase: 'Phase 6' },
    { id: 'wealth', title: 'Wealth Trajectory', phase: 'Phase 8' },
    { id: 'briefing', title: 'AI Briefing', phase: 'Phase 9' },
  ]
}

function Stat({ value, label }) {
  return (
    <div>
      <div style={{
        fontFamily: "'DM Serif Display', serif",
        fontSize: '34px',
        color: 'var(--accent)',
        lineHeight: 1,
      }}>
        {value}
      </div>
      <div style={{
        fontFamily: "'DM Mono', monospace",
        fontSize: '9.5px',
        color: 'var(--tx-3)',
        letterSpacing: '0.06em',
        marginTop: '8px',
      }}>
        {label}
      </div>
    </div>
  )
}

function MiniStat({ value, label }) {
  return (
    <div>
      <div style={{
        fontFamily: "'DM Mono', monospace",
        fontSize: '15px',
        color: 'var(--tx-1)',
      }}>
        {value}
      </div>
      <div style={{
        fontFamily: "'DM Mono', monospace",
        fontSize: '9px',
        color: 'var(--tx-3)',
        letterSpacing: '0.05em',
        marginTop: '3px',
      }}>
        {label.toUpperCase()}
      </div>
    </div>
  )
}

export default function Dashboard({ summary, mobile, periodDefault, periodOptions = [] }) {
  const [widgets, setWidgets] = useState(() => buildWidgets(summary))
  const [configure, setConfigure] = useState(false)
  const [dragId, setDragId] = useState(null)
  const [activePeriod, setActivePeriod] = useState(periodDefault)

  // keep live widget numbers fresh if summary changes (ids stable, order preserved)
  const summarized = buildWidgets(summary)
  const ordered = widgets.map(w => summarized.find(s => s.id === w.id) ?? w)

  function onDrop(targetId) {
    if (!dragId || dragId === targetId) return
    setWidgets(prev => {
      const from = prev.findIndex(w => w.id === dragId)
      const to = prev.findIndex(w => w.id === targetId)
      if (from === -1 || to === -1) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
    setDragId(null)
  }

  return (
    <div style={{ maxWidth: '960px' }}>
      {/* Header row */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        marginBottom: '24px',
      }}>
        <div>
          <div style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: '10px',
            color: 'var(--accent)',
            letterSpacing: '0.1em',
            marginBottom: '8px',
          }}>
            // dashboard
          </div>
          <div style={{
            fontFamily: "'DM Serif Display', serif",
            fontSize: '30px',
            color: 'var(--tx-1)',
            letterSpacing: '-0.015em',
            lineHeight: 1.1,
          }}>
            Your control center
          </div>
        </div>

        <button
          onClick={() => setConfigure(c => !c)}
          style={{
            background: configure ? 'var(--accent-bg)' : 'none',
            border: configure ? '1px solid var(--accent-bd)' : '1px solid var(--bd)',
            borderRadius: '8px',
            padding: '8px 14px',
            fontFamily: "'DM Mono', monospace",
            fontSize: '10px',
            letterSpacing: '0.05em',
            color: configure ? 'var(--accent)' : 'var(--tx-2)',
            cursor: 'pointer',
          }}
        >
          {configure ? '✓ DONE' : '⊞ CONFIGURE'}
        </button>
      </div>

      {/* Period filter */}
      {periodOptions.length > 0 && (
        <div style={{ display: 'flex', gap: '7px', marginBottom: '22px', flexWrap: 'wrap' }}>
          {periodOptions.map(p => {
            const on = p === activePeriod
            return (
              <button
                key={p}
                onClick={() => setActivePeriod(p)}
                style={{
                  border: on ? '1px solid var(--accent)' : '1px solid var(--bd)',
                  background: on ? 'var(--accent-bg)' : 'var(--bg-card)',
                  color: on ? 'var(--accent)' : 'var(--tx-2)',
                  borderRadius: '7px',
                  padding: '6px 13px',
                  fontFamily: "'DM Mono', monospace",
                  fontSize: '11px',
                  cursor: 'pointer',
                }}
              >
                {p}
              </button>
            )
          })}
        </div>
      )}

      {configure && (
        <div style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: '10px',
          color: 'var(--tx-3)',
          letterSpacing: '0.04em',
          marginBottom: '14px',
        }}>
          DRAG WIDGETS TO REARRANGE
        </div>
      )}

      {/* Widget grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: mobile ? '1fr' : 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: '14px',
      }}>
        {ordered.map(w => (
          <div
            key={w.id}
            draggable={configure}
            onDragStart={() => setDragId(w.id)}
            onDragOver={e => configure && e.preventDefault()}
            onDrop={() => onDrop(w.id)}
            style={{
              border: dragId === w.id ? '1px solid var(--accent)' : '1px solid var(--bd)',
              borderRadius: '13px',
              background: 'var(--bg-card)',
              padding: '20px',
              minHeight: '128px',
              cursor: configure ? 'grab' : 'default',
              opacity: dragId === w.id ? 0.5 : 1,
              transition: 'border-color .15s, opacity .15s',
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '16px',
            }}>
              <div style={{
                fontSize: '12.5px',
                fontWeight: 500,
                color: 'var(--tx-2)',
              }}>
                {w.title}
              </div>
              {configure && <span style={{ color: 'var(--tx-3)', fontSize: '13px' }}>⠿</span>}
            </div>

            {w.live ? (
              w.render()
            ) : (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                justifyContent: 'center',
                height: '60px',
              }}>
                <div style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: '10px',
                  color: 'var(--tx-3)',
                  letterSpacing: '0.05em',
                  border: '1px solid var(--bd)',
                  borderRadius: '5px',
                  padding: '4px 8px',
                }}>
                  {w.phase}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

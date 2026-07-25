import { useState } from 'react'
import { hardRefresh } from '../../lib/pwa/hardRefresh.js'

// Pulls the newest deploy into the installed PWA. `variant="row"` matches the
// sidebar footer rows; the default is the compact icon used in the mobile bar.
export default function RefreshButton({ variant = 'icon', collapsed = false }) {
  const [busy, setBusy] = useState(false)

  function run() {
    if (busy) return
    setBusy(true)
    hardRefresh()
  }

  const spin = busy ? { animation: 'spin 0.8s linear infinite' } : null

  if (variant === 'row') {
    return (
      <div
        onClick={run}
        title="Check for updates"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: collapsed ? 0 : '12px',
          justifyContent: collapsed ? 'center' : 'flex-start',
          padding: collapsed ? '10px 0' : '9px 12px',
          borderRadius: '8px',
          cursor: busy ? 'default' : 'pointer',
          color: 'var(--tx-2)',
          fontSize: '13px',
          opacity: busy ? 0.6 : 1,
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--hover)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      >
        <span style={{ fontSize: '14px', width: '18px', textAlign: 'center', display: 'inline-block', ...spin }}>⟳</span>
        {!collapsed && <span>{busy ? 'Refreshing…' : 'Refresh app'}</span>}
      </div>
    )
  }

  return (
    <button
      onClick={run}
      title="Check for updates"
      aria-label="Refresh app"
      style={{
        background: 'none',
        border: 'none',
        cursor: busy ? 'default' : 'pointer',
        color: 'var(--tx-2)',
        fontSize: '18px',
        lineHeight: 1,
        padding: 0,
        width: '20px',
        opacity: busy ? 0.6 : 1,
        ...spin,
      }}
    >
      ⟳
    </button>
  )
}

import { useState } from 'react'
import { AIPersonalizationPanel } from '../settings/AIPersonalization.jsx'

// Always-available AI-presentation control that lives next to the command bar.
// Opens a popover (above the bar) where the user can adjust how AI briefings and
// AI-generated content are framed, or launch the full personalization interview —
// from anywhere in the app, without navigating to Settings.

export default function AIPrefsButton({ userId, context, onChange, mobile = false }) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="AI presentation settings"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          height: mobile ? 'auto' : '100%',
          background: open ? 'var(--accent-bg)' : 'transparent',
          border: '1px solid var(--accent-bd)', borderRadius: 9,
          padding: '9px 11px', color: 'var(--accent)', cursor: 'pointer',
          fontFamily: "'DM Mono', monospace", fontSize: 11, letterSpacing: '0.04em',
        }}
      >
        <span style={{ fontSize: 13 }}>✦</span>
        <span>AI</span>
      </button>

      {open && (
        <>
          {/* outside-click catcher */}
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
          <div style={{
            position: 'absolute', bottom: 'calc(100% + 10px)', left: mobile ? 0 : 'auto', right: 0,
            zIndex: 100, width: 'min(380px, 90vw)', maxHeight: '70vh', overflowY: 'auto',
            background: 'var(--bg-card)', border: '1px solid var(--accent-bd)', borderRadius: 13,
            boxShadow: '0 10px 40px rgba(0,0,0,0.4)', padding: '16px 18px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--accent)', fontSize: 13 }}>✦</span>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--tx-1)' }}>AI presentation</span>
              </div>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--tx-3)', fontSize: 17, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--tx-3)', marginBottom: 10, lineHeight: 1.5 }}>
              Tune how AI briefings and answers are framed across the app.
            </div>
            <AIPersonalizationPanel userId={userId} context={context} onChange={onChange} compact />
          </div>
        </>
      )}
    </div>
  )
}

// Confirmation card for a write the assistant wants to make. Driven entirely by
// the preview payload a tool returns ({ title, subtitle, rows, footer,
// destructive }), so a new tool needs no UI work here.

const TONE_COLOR = {
  good: '#4ade80',
  bad: '#f87171',
  muted: 'var(--tx-3)',
  neutral: 'var(--tx-1)',
}

export default function PendingActionCard({ preview }) {
  const { title, subtitle, rows = [], footer, destructive, error } = preview

  return (
    <div style={{
      border: `1px solid ${destructive ? 'var(--warn)' : 'var(--accent-bd)'}`,
      background: 'var(--accent-bg)',
      borderRadius: '10px',
      padding: '11px 13px',
      marginTop: '6px',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--tx-1)' }}>{title}</div>
        {destructive && (
          <span style={{
            flexShrink: 0,
            fontFamily: "'DM Mono', monospace",
            fontSize: '9.5px',
            letterSpacing: '0.06em',
            color: 'var(--warn)',
            border: '1px solid var(--warn)',
            borderRadius: 999,
            padding: '1px 6px',
          }}>
            REMOVES DATA
          </span>
        )}
      </div>

      {subtitle && (
        <div style={{ fontSize: '11.5px', color: 'var(--tx-3)', marginTop: '3px', lineHeight: 1.5 }}>{subtitle}</div>
      )}

      {error && (
        <div style={{ fontSize: '11.5px', color: 'var(--warn)', marginTop: '5px' }}>
          Could not preview this change: {error}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div style={{ borderTop: '1px solid var(--bd)', margin: '8px 0' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '11.5px' }}>
                <span style={{ color: 'var(--tx-2)' }}>{r.label}</span>
                <span style={{
                  fontFamily: "'DM Mono', monospace",
                  fontWeight: 600,
                  textAlign: 'right',
                  color: TONE_COLOR[r.tone] ?? TONE_COLOR.neutral,
                }}>
                  {r.value}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {footer && (
        <div style={{ fontSize: '11px', color: 'var(--tx-3)', marginTop: '6px' }}>{footer}</div>
      )}
    </div>
  )
}

// Mapping module — reserved navigation slot. Full build-out is Phase 2+ backlog,
// so this is a true "Coming Soon" stub rather than a near-term phase placeholder.

export default function Mapping() {
  return (
    <div style={{
      maxWidth: '560px',
      padding: '8px 0 48px',
    }}>
      <div style={{
        fontFamily: "'DM Mono', monospace",
        fontSize: '10px',
        color: 'var(--accent)',
        letterSpacing: '0.1em',
        marginBottom: '14px',
      }}>
        // mapping
      </div>

      <div style={{
        border: '1px solid var(--bd)',
        borderRadius: '14px',
        background: 'var(--bg-card)',
        padding: '40px 36px',
        textAlign: 'center',
      }}>
        <div style={{
          fontSize: '32px',
          color: 'var(--tx-3)',
          lineHeight: 1,
          marginBottom: '18px',
        }}>
          ⊹
        </div>
        <div style={{
          fontFamily: "'DM Serif Display', serif",
          fontSize: '26px',
          color: 'var(--tx-1)',
          letterSpacing: '-0.01em',
          marginBottom: '12px',
        }}>
          Category Mapping — Coming Soon
        </div>
        <div style={{
          fontSize: '13.5px',
          lineHeight: '1.7',
          color: 'var(--tx-2)',
          maxWidth: '420px',
          margin: '0 auto',
        }}>
          A dedicated workspace to review and refine how your imported categories
          map to budget groups and types. For now, mapping happens automatically
          on import — unmapped categories are surfaced for confirmation during the
          CSV import flow.
        </div>
        <div style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: '10px',
          color: 'var(--tx-3)',
          letterSpacing: '0.05em',
          marginTop: '24px',
        }}>
          PHASE 2+ BACKLOG
        </div>
      </div>
    </div>
  )
}

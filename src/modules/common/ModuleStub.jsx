// Shared placeholder for modules whose full build lands in a later phase.
// Each module file renders this with its own identity + planned capabilities,
// giving every future phase a real file to expand into.

export default function ModuleStub({ icon, eyebrow, title, description, phase, features = [] }) {
  return (
    <div style={{ maxWidth: '640px', padding: '8px 0 48px' }}>
      <div style={{
        fontFamily: "'DM Mono', monospace",
        fontSize: '10px',
        color: 'var(--accent)',
        letterSpacing: '0.1em',
        marginBottom: '14px',
      }}>
        {eyebrow}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
        <div style={{
          width: '46px',
          height: '46px',
          flexShrink: 0,
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '22px',
          color: 'var(--accent)',
          background: 'var(--accent-bg)',
          border: '1px solid var(--accent-bd)',
        }}>
          {icon}
        </div>
        <div style={{
          fontFamily: "'DM Serif Display', serif",
          fontSize: '22px',
          lineHeight: '1.15',
          color: 'var(--tx-1)',
          letterSpacing: '-0.015em',
        }}>
          {title}
        </div>
      </div>

      <div style={{
        fontSize: '14px',
        lineHeight: '1.7',
        color: 'var(--tx-2)',
        marginBottom: '24px',
        maxWidth: '540px',
      }}>
        {description}
      </div>

      {phase && (
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          border: '1px solid var(--warn)',
          background: 'var(--warn-bg)',
          borderRadius: '7px',
          padding: '7px 12px',
          marginBottom: '28px',
        }}>
          <span style={{ color: 'var(--warn)', fontSize: '11px' }}>●</span>
          <span style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: '10.5px',
            color: 'var(--warn)',
            letterSpacing: '0.05em',
          }}>
            PLANNED FOR {phase.toUpperCase()}
          </span>
        </div>
      )}

      {features.length > 0 && (
        <>
          <div style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: '9.5px',
            color: 'var(--tx-3)',
            letterSpacing: '0.06em',
            marginBottom: '12px',
          }}>
            PLANNED CAPABILITIES
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
            {features.map((f, i) => (
              <div key={i} style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '11px',
                padding: '11px 0',
                borderBottom: '0.5px solid var(--bd-light)',
              }}>
                <span style={{
                  color: 'var(--tx-3)',
                  fontFamily: "'DM Mono', monospace",
                  fontSize: '11px',
                  marginTop: '1px',
                }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span style={{ fontSize: '13.5px', color: 'var(--tx-1)', lineHeight: '1.5' }}>
                  {f}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

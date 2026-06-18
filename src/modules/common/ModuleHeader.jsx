// Shared module header — an accent icon tile above a serif title, optionally
// with a subtitle and right-aligned actions. This is the house style the
// Dashboard and Cash Flow modules already use; routing every module through it
// retires the old tiny teal "// eyebrow" labels for a consistent, calmer header.

export default function ModuleHeader({ icon, title, subtitle, actions, mobile }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        display: 'flex',
        alignItems: mobile ? 'flex-start' : 'flex-end',
        flexDirection: mobile ? 'column' : 'row',
        justifyContent: 'space-between',
        gap: 14,
      }}>
        <div style={{ textAlign: 'left' }}>
          {icon && (
            <div style={{
              width: 46, height: 46, borderRadius: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, color: 'var(--accent)',
              background: 'var(--accent-bg)', border: '1px solid var(--accent-bd)',
              marginBottom: 12,
            }}>
              {icon}
            </div>
          )}
          <h1 style={{
            fontFamily: "'DM Serif Display', serif",
            fontSize: mobile ? 24 : 30,
            fontWeight: 400, color: 'var(--tx-1)',
            margin: 0, lineHeight: 1.1, letterSpacing: '-0.01em',
          }}>
            {title}
          </h1>
          {subtitle && (
            <div style={{ fontSize: 14, color: 'var(--tx-2)', marginTop: 6, lineHeight: 1.5 }}>
              {subtitle}
            </div>
          )}
        </div>
        {actions && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}

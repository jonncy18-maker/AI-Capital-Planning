import { MODULES, SECTION_LABELS } from '../registry.js'

// Persistent left sidebar (web). Collapses to an icon rail. Also rendered inside
// the mobile drawer (always expanded there).

export default function Sidebar({
  activeModule,
  onSelect,
  collapsed,
  onToggleCollapse,
  onSignOut,
  theme,
  onToggleTheme,
  showCollapseToggle = true,
}) {
  // group modules by section, preserving registry order
  const sections = []
  for (const m of MODULES) {
    let s = sections.find(x => x.key === m.section)
    if (!s) { s = { key: m.section, items: [] }; sections.push(s) }
    s.items.push(m)
  }

  return (
    <div style={{
      width: collapsed ? '64px' : '236px',
      flexShrink: 0,
      height: '100%',
      background: 'var(--bg-card)',
      borderRight: '1px solid var(--bd)',
      display: 'flex',
      flexDirection: 'column',
      transition: 'width .18s ease',
      overflow: 'hidden',
    }}>
      {/* Brand + collapse toggle */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        gap: '8px',
        padding: collapsed ? '20px 0' : '20px 18px',
        borderBottom: '1px solid var(--bd)',
      }}>
        {!collapsed && (
          <div style={{
            fontFamily: "'DM Serif Display', serif",
            fontSize: '16px',
            color: 'var(--tx-1)',
            letterSpacing: '-0.01em',
            whiteSpace: 'nowrap',
          }}>
            Capital Planning
          </div>
        )}
        {showCollapseToggle && (
          <button
            onClick={onToggleCollapse}
            title={collapsed ? 'Expand' : 'Collapse'}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--tx-3)',
              fontSize: '15px',
              lineHeight: 1,
              padding: '2px',
            }}
          >
            {collapsed ? '»' : '«'}
          </button>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '12px 10px' }}>
        {sections.map(section => (
          <div key={section.key} style={{ marginBottom: '14px' }}>
            {!collapsed && SECTION_LABELS[section.key] && (
              <div style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: '9px',
                color: 'var(--tx-3)',
                letterSpacing: '0.08em',
                padding: '4px 10px 8px',
              }}>
                {SECTION_LABELS[section.key]}
              </div>
            )}
            {section.items.map(m => {
              const active = m.id === activeModule
              return (
                <div
                  key={m.id}
                  onClick={() => onSelect(m.id)}
                  title={collapsed ? m.label : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: collapsed ? 0 : '12px',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    padding: collapsed ? '11px 0' : '10px 12px',
                    marginBottom: '2px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    background: active ? 'var(--accent-bg)' : 'transparent',
                    border: active ? '1px solid var(--accent-bd)' : '1px solid transparent',
                    color: active ? 'var(--accent)' : 'var(--tx-2)',
                    transition: 'background .12s, color .12s',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--hover)' }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ fontSize: '15px', flexShrink: 0, width: '18px', textAlign: 'center' }}>
                    {m.icon}
                  </span>
                  {!collapsed && (
                    <span style={{
                      fontSize: '13px',
                      whiteSpace: 'nowrap',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '7px',
                    }}>
                      {m.label}
                      {m.comingSoon && (
                        <span style={{
                          fontFamily: "'DM Mono', monospace",
                          fontSize: '8px',
                          color: 'var(--tx-3)',
                          border: '0.5px solid var(--bd)',
                          borderRadius: '4px',
                          padding: '1px 4px',
                          letterSpacing: '0.04em',
                        }}>
                          SOON
                        </span>
                      )}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Footer: theme toggle + sign out */}
      <div style={{
        borderTop: '1px solid var(--bd)',
        padding: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
      }}>
        <div
          onClick={onToggleTheme}
          title="Toggle theme"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: collapsed ? 0 : '12px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? '10px 0' : '9px 12px',
            borderRadius: '8px',
            cursor: 'pointer',
            color: 'var(--tx-2)',
            fontSize: '13px',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--hover)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          <span style={{ fontSize: '14px', width: '18px', textAlign: 'center', color: 'var(--accent)' }}>
            {theme === 'light' ? '☀' : '☾'}
          </span>
          {!collapsed && <span>{theme === 'light' ? 'Light mode' : 'Dark mode'}</span>}
        </div>
        <div
          onClick={onSignOut}
          title="Sign out"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: collapsed ? 0 : '12px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? '10px 0' : '9px 12px',
            borderRadius: '8px',
            cursor: 'pointer',
            color: 'var(--tx-3)',
            fontSize: '13px',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--hover)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          <span style={{ fontSize: '14px', width: '18px', textAlign: 'center' }}>⏻</span>
          {!collapsed && <span>Sign out</span>}
        </div>
      </div>
    </div>
  )
}

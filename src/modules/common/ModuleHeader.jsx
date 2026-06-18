// Shared module header — the single source of truth for every module's title
// block, so titles and subtitles render in the exact same fonts everywhere.
// Style follows the Scenario Planner header: an inline accent icon + serif
// title, with a smaller subtitle beneath. Optional right-aligned actions.
// The shared type ramp lives in headerStyles.js so modules that hand-roll their
// header (e.g. Scenarios' sticky layout) stay pixel-consistent.

import { headerStyles } from './headerStyles.js'

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
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {icon && <span style={headerStyles.icon}>{icon}</span>}
            <h1 style={headerStyles.title(mobile)}>{title}</h1>
          </div>
          {subtitle && (
            <div style={{ ...headerStyles.subtitle, marginTop: 6, marginLeft: icon ? 30 : 0 }}>
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

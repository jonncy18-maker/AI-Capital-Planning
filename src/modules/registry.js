// Central module registry — single source of truth for navigation and routing.
// Each future phase fills in the component for its module; the shell renders
// whatever is registered here.

// `hue` is the module's domain colour — identity only (nav dot, header icon,
// chart series). It never encodes state; --good/--warn/--bad do that.
export const MODULES = [
  { id: 'dashboard',   label: 'Dashboard',             short: 'Dashboard',   icon: '◉', section: 'main',    hue: 'var(--dom-dashboard)' },
  { id: 'payperiods',  label: 'Pay Period Planner',    short: 'Pay Periods', icon: '◫', section: 'modules', hue: 'var(--dom-payperiods)' },
  { id: 'creditcards', label: 'Credit Cards',           short: 'Credit Cards', icon: '▬', section: 'modules', hue: 'var(--dom-creditcards)' },
  { id: 'scenarios',   label: 'Scenario Planner',      short: 'Scenarios',   icon: '◑', section: 'modules', hue: 'var(--dom-scenarios)' },
  { id: 'budget',      label: 'Annual Budget Builder', short: 'Budget',      icon: '▦', section: 'modules', hue: 'var(--dom-budget)' },
  { id: 'forecast',    label: 'Forecast',              short: 'Forecast',    icon: '⬡', section: 'modules', hue: 'var(--dom-forecast)' },
  { id: 'commitments', label: 'Long-Term Commitments', short: 'Commitments', icon: '◈', section: 'modules', hue: 'var(--dom-commitments)' },
  { id: 'wealth',      label: 'Wealth Trajectory',     short: 'Wealth',      icon: '↗', section: 'modules', hue: 'var(--dom-wealth)' },
  { id: 'settings',    label: 'Settings',              short: 'Settings',    icon: '⚙', section: 'system',  hue: 'var(--dom-system)' },
  { id: 'mapping',     label: 'Mapping',               short: 'Mapping',     icon: '⊹', section: 'system',  hue: 'var(--dom-system)' },
]

export const SECTION_LABELS = {
  main: null,
  modules: 'MODULES',
  system: 'SYSTEM',
}

export function getModule(id) {
  return MODULES.find(m => m.id === id) ?? MODULES[0]
}

export function moduleHue(id) {
  return MODULES.find(m => m.id === id)?.hue ?? 'var(--accent)'
}

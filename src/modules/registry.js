// Central module registry — single source of truth for navigation and routing.
// Each future phase fills in the component for its module; the shell renders
// whatever is registered here.

export const MODULES = [
  { id: 'dashboard',   label: 'Dashboard',             short: 'Dashboard',   icon: '◉', section: 'main' },
  { id: 'cashflow',    label: 'Cash Flow Timing',      short: 'Cash Flow',   icon: '◷', section: 'modules' },
  { id: 'creditcards', label: 'Credit Cards',           short: 'Credit Cards', icon: '▬', section: 'modules' },
  { id: 'scenarios',   label: 'Scenario Planner',      short: 'Scenarios',   icon: '◑', section: 'modules' },
  { id: 'budget',      label: 'Annual Budget Builder', short: 'Budget',      icon: '▦', section: 'modules' },
  { id: 'forecast',    label: 'Forecast',              short: 'Forecast',    icon: '⬡', section: 'modules' },
  { id: 'commitments', label: 'Long-Term Commitments', short: 'Commitments', icon: '◈', section: 'modules' },
  { id: 'wealth',      label: 'Wealth Trajectory',     short: 'Wealth',      icon: '↗', section: 'modules' },
  { id: 'settings',    label: 'Settings',              short: 'Settings',    icon: '⚙', section: 'system' },
  { id: 'mapping',     label: 'Mapping',               short: 'Mapping',     icon: '⊹', section: 'system' },
]

export const SECTION_LABELS = {
  main: null,
  modules: 'MODULES',
  system: 'SYSTEM',
}

export function getModule(id) {
  return MODULES.find(m => m.id === id) ?? MODULES[0]
}

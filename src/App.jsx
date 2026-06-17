import { useState } from 'react'
import './App.css'
import Onboarding from './modules/onboarding/Onboarding.jsx'

const MODULES = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'cashflow', label: 'Cash Flow Timing' },
  { id: 'scenarios', label: 'Scenario Planner' },
  { id: 'budget', label: 'Annual Budget Builder' },
  { id: 'commitments', label: 'Long-Term Commitments' },
  { id: 'wealth', label: 'Wealth Trajectory' },
  { id: 'settings', label: 'Settings' },
  { id: 'mapping', label: 'Mapping (Coming Soon)' },
]

function App() {
  const [showOnboarding, setShowOnboarding] = useState(true)

  if (showOnboarding) {
    return <Onboarding onComplete={() => setShowOnboarding(false)} />
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-brand">AI Capital Planning</div>
        <nav>
          {MODULES.map((m) => (
            <div key={m.id} className="sidebar-item">
              {m.label}
            </div>
          ))}
        </nav>
      </aside>

      <main className="canvas">
        <h1>Dashboard</h1>
        <p>Phase 0 complete — scaffolding live. Phase 1: Supabase schema next.</p>
      </main>

      <div className="command-bar">
        <span className="command-bar-icon">✦</span>
        <input placeholder="Ask anything about your finances…" disabled />
      </div>
    </div>
  )
}

export default App

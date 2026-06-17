import { useState } from 'react'
import './App.css'
import Onboarding from './modules/onboarding/Onboarding.jsx'
import Settings from './modules/settings/Settings.jsx'

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

const activeItemStyle = {
  borderLeft: '2px solid #00C2A8',
  paddingLeft: '18px',
  color: '#e2e8f0',
  background: '#2d3148',
}

function App() {
  const [showOnboarding, setShowOnboarding] = useState(true)
  const [profile, setProfile] = useState(() => {
    try { return JSON.parse(localStorage.getItem('aicap_profile') || 'null') } catch { return null }
  })
  const [activeModule, setActiveModule] = useState('dashboard')

  function handleOnboardingComplete(profileData) {
    localStorage.setItem('aicap_profile', JSON.stringify(profileData))
    setProfile(profileData)
    setShowOnboarding(false)
  }

  if (showOnboarding) {
    return <Onboarding onComplete={handleOnboardingComplete} />
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-brand">AI Capital Planning</div>
        <nav>
          {MODULES.map((m) => (
            <div
              key={m.id}
              className="sidebar-item"
              onClick={() => setActiveModule(m.id)}
              style={m.id === activeModule ? activeItemStyle : {}}
            >
              {m.label}
            </div>
          ))}
        </nav>
      </aside>

      <main className="canvas">
        {activeModule === 'settings' ? (
          <Settings
            profile={profile}
            onSave={(updated) => {
              localStorage.setItem('aicap_profile', JSON.stringify(updated))
              setProfile(updated)
            }}
            onBack={() => setActiveModule('dashboard')}
          />
        ) : (
          <>
            <h1>Dashboard</h1>
            <p>Phase 0 complete — scaffolding live. Phase 1: Supabase schema next.</p>
          </>
        )}
      </main>

      <div className="command-bar">
        <span className="command-bar-icon">✦</span>
        <input placeholder="Ask anything about your finances…" disabled />
      </div>
    </div>
  )
}

export default App

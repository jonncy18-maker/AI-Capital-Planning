import { useState, useEffect } from 'react'
import './App.css'
import { supabase } from './lib/supabase.js'
import { useAuth } from './lib/auth/useAuth.js'
import { getProfile, saveProfile } from './lib/db/profile.js'
import Login from './modules/auth/Login.jsx'
import Onboarding from './modules/onboarding/Onboarding.jsx'
import ImportFlow from './modules/import/ImportFlow.jsx'
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
  const { session, loading: authLoading, user } = useAuth()
  const [profile, setProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [activeModule, setActiveModule] = useState('dashboard')
  const [pendingImport, setPendingImport] = useState(null)
  // pendingImport = { csvRaw, csvName, profileData }

  // Load profile from DB when user session is established
  useEffect(() => {
    if (!user) { setProfile(null); return }
    setProfileLoading(true)
    getProfile(user.id)
      .then(p => setProfile(p))
      .catch(() => setProfile(null))
      .finally(() => setProfileLoading(false))
  }, [user?.id])

  async function handleOnboardingComplete(profileData) {
    if (profileData.csvFile?.raw) {
      const { raw, name } = profileData.csvFile
      setPendingImport({
        csvRaw: raw,
        csvName: name,
        profileData: { ...profileData, csvFile: null },
      })
    } else {
      const saved = await saveProfile(user.id, { ...profileData, onboardingComplete: true })
      setProfile(saved)
    }
  }

  async function handleImportDone() {
    if (pendingImport?.profileData) {
      const saved = await saveProfile(user.id, { ...pendingImport.profileData, onboardingComplete: true })
      setProfile(saved)
    }
    setPendingImport(null)
  }

  function handleStartReImport(csvRaw, csvName) {
    setPendingImport({ csvRaw, csvName })
  }

  async function handleProfileSave(updated) {
    const saved = await saveProfile(user.id, updated)
    setProfile(saved)
  }

  function handleSignOut() {
    supabase.auth.signOut()
  }

  // Auth loading
  if (authLoading) return <div className="app-loading" />

  // Not signed in
  if (!session) return <Login />

  // Profile loading
  if (profileLoading) return <div className="app-loading" />

  // Onboarding incomplete
  const onboardingDone = profile?.onboarding_complete
  if (!onboardingDone && !pendingImport) {
    return <Onboarding onComplete={handleOnboardingComplete} />
  }

  // CSV import flow (between onboarding and main app)
  if (pendingImport) {
    return (
      <ImportFlow
        csvRaw={pendingImport.csvRaw}
        csvName={pendingImport.csvName}
        userId={user.id}
        onComplete={handleImportDone}
      />
    )
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
        <div
          className="sidebar-item"
          onClick={handleSignOut}
          style={{ marginTop: 'auto', fontSize: '12px', color: 'var(--tx-3, #475569)' }}
        >
          Sign out
        </div>
      </aside>

      <main className="canvas">
        {activeModule === 'settings' ? (
          <Settings
            profile={profile}
            onSave={handleProfileSave}
            onBack={() => setActiveModule('dashboard')}
            onImport={handleStartReImport}
            userId={user.id}
          />
        ) : (
          <>
            <h1>Dashboard</h1>
            <p>Phase 2 complete — CSV import pipeline live. Phase 3: Dashboard shell and navigation next.</p>
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

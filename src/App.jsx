import { useState, useEffect } from 'react'
import './App.css'
import { supabase } from './lib/supabase.js'
import { useAuth } from './lib/auth/useAuth.js'
import { getProfile, saveProfile } from './lib/db/profile.js'
import Login from './modules/auth/Login.jsx'
import Onboarding from './modules/onboarding/Onboarding.jsx'
import ImportFlow from './modules/import/ImportFlow.jsx'
import AppShell from './modules/shell/AppShell.jsx'

function App() {
  const { session, loading: authLoading, user } = useAuth()
  const [profile, setProfile] = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)
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
    <AppShell
      user={user}
      profile={profile}
      onProfileSave={handleProfileSave}
      onSignOut={handleSignOut}
      onStartReImport={handleStartReImport}
    />
  )
}

export default App

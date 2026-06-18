import { useState, useEffect } from 'react'
import './App.css'
import { supabase } from './lib/supabase.js'
import { useAuth } from './lib/auth/useAuth.js'
import { getProfile, saveProfile } from './lib/db/profile.js'
import { parseBudgetCSV } from './lib/csv/budgetParser.js'
import { importCategoryMappings } from './lib/db/budgetCategories.js'
import Login from './modules/auth/Login.jsx'
import Onboarding from './modules/onboarding/Onboarding.jsx'
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
    // Seed the user's own category map first (if provided) so the subsequent
    // transaction import maps cleanly against their real buckets.
    if (profileData.budgetMap?.raw) {
      try {
        const { rows } = parseBudgetCSV(profileData.budgetMap.raw)
        if (rows.length) await importCategoryMappings(user.id, rows)
      } catch {
        // Non-fatal — the user can re-import the map from Settings later.
      }
    }
    const cleaned = { ...profileData, budgetMap: null }
    if (cleaned.csvFile?.raw) {
      const { raw, name } = cleaned.csvFile
      setPendingImport({
        csvRaw: raw,
        csvName: name,
        profileData: { ...cleaned, csvFile: null },
      })
    } else {
      const saved = await saveProfile(user.id, { ...cleaned, onboardingComplete: true })
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

  return (
    <AppShell
      user={user}
      profile={profile}
      onProfileSave={handleProfileSave}
      onSignOut={handleSignOut}
      onStartReImport={handleStartReImport}
      pendingImport={pendingImport}
      onImportDone={handleImportDone}
    />
  )
}

export default App

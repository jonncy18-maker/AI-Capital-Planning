'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import '../src/App.css'
import { authClient } from '../src/lib/neon/authClient.js'
import { useAuth } from '../src/lib/auth/useAuth.js'
import { getProfile, saveProfile } from '../src/lib/db/profile.js'
import { parseBudgetCSV } from '../src/lib/csv/budgetParser.js'
import { importCategoryMappings } from '../src/lib/db/budgetCategories.js'
import { useTheme } from '../src/lib/theme/useTheme.js'
import { loadAIContext, summarizeContext } from '../src/lib/ai/contextLoader.js'
import { getTransactionsByMonth } from '../src/lib/db/transactions.js'
import { getModule } from '../src/modules/registry.js'
import Login from '../src/modules/auth/Login.jsx'
import Onboarding from '../src/modules/onboarding/Onboarding.jsx'
import Sidebar from '../src/modules/shell/Sidebar.jsx'
import RefreshButton from '../src/modules/shell/RefreshButton.jsx'
import ImportFlow from '../src/modules/import/ImportFlow.jsx'
import { ShellContext } from './shellContext.js'

function useWindowWidth() {
  const [width, setWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1280
  )
  useEffect(() => {
    const handle = () => setWidth(window.innerWidth)
    window.addEventListener('resize', handle)
    return () => window.removeEventListener('resize', handle)
  }, [])
  return width
}

function AppShell({ children }) {
  const { session, loading: authLoading, user } = useAuth()
  const [profile, setProfile] = useState(null)
  // Starts true: the fetch effect below only flips it after the first render,
  // so a false initial value opens a one-render window where profile is null
  // but nothing is "loading" — which briefly mounts <Onboarding/> on every
  // page load. Its unmount cleanup then strips data-theme from <html>,
  // reverting the visible theme to dark while React state still says light.
  const [profileLoading, setProfileLoading] = useState(true)
  const [pendingImport, setPendingImport] = useState(null)
  // pendingImport = { csvRaw, csvName, profileData }

  // Resume an in-progress MCP OAuth consent flow after login. The authorize
  // route (app/api/mcp/authorize) bounces an unauthenticated request here
  // with ?mcp_authorize=<encoded original query>, since login itself lives
  // in this SPA rather than a separate route it could redirect back to.
  useEffect(() => {
    if (!session) return
    const params = new URLSearchParams(window.location.search)
    const resume = params.get('mcp_authorize')
    // `resume` is already the full "/api/mcp/authorize?..." path+query (that's
    // what the authorize route encoded it from) — navigate to it directly.
    // Prepending "/api/mcp/authorize?" here again doubled the path, so the
    // server saw a query string starting with a stray literal "/api/mcp/
    // authorize?response_type" instead of "response_type", and every param
    // lookup (response_type, client_id, ...) came back null.
    if (resume) window.location.href = resume
  }, [session])

  // Load profile from DB when user session is established
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets stale profile on sign-out
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
    authClient.signOut()
  }

  // --- AppShell logic below ---

  const { theme, toggleTheme } = useTheme()
  const vw = useWindowWidth()
  const mobile = vw < 760
  const tablet = vw >= 760 && vw < 1100

  const pathname = usePathname()
  const router = useRouter()
  const activeModule = (pathname && pathname !== '/') ? pathname.replace(/^\//, '') : 'dashboard'

  const [collapsed, setCollapsed] = useState(tablet)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // AI context: a plain data feed (transactions, categories, commitments, wealth)
  // that pages read through the shell context.
  const [aiContext, setAiContext] = useState(null)
  // Bumped whenever data changes outside a module (e.g. an import) so dependent
  // modules reload without a manual refresh.
  const [dataNonce, setDataNonce] = useState(0)
  // Lets other screens ask the Scenarios module to auto-select a scenario; it
  // reads this on mount/change.
  const [openScenarioId, setOpenScenarioId] = useState(null)

  const reloadAiContext = useCallback(() => {
    if (!user) return
    loadAIContext(user.id)
      .then(ctx => setAiContext(ctx))
      .catch(() => {})
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user) return
    let cancelled = false
    loadAIContext(user.id)
      .then(ctx => { if (!cancelled) setAiContext(ctx) })
      .catch(() => { if (!cancelled) setAiContext({ transactions: [], categories: [], commitments: [], wealth: null }) })
    return () => { cancelled = true }
  }, [user?.id])

  const summary = useMemo(() => summarizeContext(aiContext), [aiContext])

  // yearTxns lives here so every page reads the same fresh data as the
  // dashboard widgets (not the stale ctx.transactions which is capped at 1000 rows).
  const [yearTxns, setYearTxns] = useState([])
  useEffect(() => {
    if (!user) return
    let cancelled = false
    const year = aiContext?.thisYear ?? new Date().getFullYear()
    getTransactionsByMonth(user.id, `${year}-01-01`, `${year}-12-31`)
      .then(rows => { if (!cancelled) setYearTxns(rows) })
      .catch(() => { if (!cancelled) setYearTxns([]) })
    return () => { cancelled = true }
  }, [user?.id, aiContext?.thisYear, dataNonce]) // eslint-disable-line react-hooks/exhaustive-deps

  function selectModule(id) {
    setDrawerOpen(false)
    router.push('/' + id)
  }

  const current = getModule(activeModule)

  const sidebarProps = {
    activeModule,
    onSelect: selectModule,
    onSignOut: handleSignOut,
    theme,
    onToggleTheme: toggleTheme,
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

  const shellValue = {
    user,
    userId: user.id,
    profile,
    onProfileSave: handleProfileSave,
    onStartReImport: handleStartReImport,
    aiContext,
    summary,
    mobile,
    yearTxns,
    dataNonce,
    setDataNonce,
    reloadAiContext,
    openScenarioId,
    setOpenScenarioId,
    selectModule,
  }

  return (
    <ShellContext.Provider value={shellValue}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: 'var(--bg-app)',
        color: 'var(--tx-1)',
        fontFamily: 'Inter, sans-serif',
        WebkitFontSmoothing: 'antialiased',
      }}>
        {/* Mobile top bar */}
        {mobile && (
          <div style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: '1px solid var(--bd)',
            background: 'var(--bg-card)',
          }}>
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--tx-1)', fontSize: '20px', lineHeight: 1,
                // 44px hit area; the negative margin keeps the bar's height and the glyph's position unchanged
                width: 44, height: 44, margin: '-12px 0 -12px -12px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              ☰
            </button>
            <div style={{
              fontFamily: "'DM Serif Display', serif",
              fontSize: '16px',
              color: 'var(--tx-1)',
            }}>
              {current.short}
            </div>
            <RefreshButton />
          </div>
        )}

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* Desktop / tablet sidebar */}
          {!mobile && (
            <Sidebar
              {...sidebarProps}
              collapsed={collapsed}
              onToggleCollapse={() => setCollapsed(c => !c)}
            />
          )}

          {/* Mobile drawer */}
          {mobile && drawerOpen && (
            <div
              onClick={() => setDrawerOpen(false)}
              style={{
                position: 'fixed', inset: 0, zIndex: 60,
                background: 'rgba(0,0,0,0.5)',
                display: 'flex',
              }}
            >
              <div onClick={e => e.stopPropagation()} style={{ height: '100%' }}>
                <Sidebar
                  {...sidebarProps}
                  collapsed={false}
                  showCollapseToggle={false}
                />
              </div>
            </div>
          )}

          {/* Canvas */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <main style={{ flex: 1, overflowY: 'auto', padding: mobile ? '22px 18px 80px' : '34px 28px 80px' }}>
              <div style={{ maxWidth: '1440px', margin: '0 auto' }}>
                {pendingImport ? (
                  <ImportFlow
                    csvRaw={pendingImport.csvRaw}
                    csvName={pendingImport.csvName}
                    userId={user.id}
                    onComplete={async () => { await handleImportDone(); setDataNonce(n => n + 1); reloadAiContext() }}
                    mobile={mobile}
                  />
                ) : children}
              </div>
            </main>
          </div>
        </div>
      </div>
    </ShellContext.Provider>
  )
}

// Routes that render without the signed-in shell (no auth gate or sidebar).
const PUBLIC_PATHS = ['/welcome']

export default function AppRoot({ children }) {
  const pathname = usePathname()
  if (PUBLIC_PATHS.includes(pathname?.replace(/\/$/, ''))) return children
  return <AppShell>{children}</AppShell>
}

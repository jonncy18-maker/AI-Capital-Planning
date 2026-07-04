'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import '../src/App.css'
import { supabase } from '../src/lib/supabase.js'
import { useAuth } from '../src/lib/auth/useAuth.js'
import { getProfile, saveProfile } from '../src/lib/db/profile.js'
import { parseBudgetCSV } from '../src/lib/csv/budgetParser.js'
import { importCategoryMappings } from '../src/lib/db/budgetCategories.js'
import { useTheme } from '../src/lib/theme/useTheme.js'
import { loadAIContext, summarizeContext } from '../src/lib/ai/contextLoader.js'
import { runScenarioAgent, confirmPendingScenario, cancelPendingScenario } from '../src/lib/ai/scenarioAgent.js'
import { getTransactionsByMonth } from '../src/lib/db/transactions.js'
import { getModule } from '../src/modules/registry.js'
import Login from '../src/modules/auth/Login.jsx'
import Onboarding from '../src/modules/onboarding/Onboarding.jsx'
import Sidebar from '../src/modules/shell/Sidebar.jsx'
import CommandBar from '../src/modules/shell/CommandBar.jsx'
import AIPrefsButton from '../src/modules/shell/AIPrefsButton.jsx'
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

// Replace the last message in the thread (the loading assistant placeholder)
// with the resolved assistant turn.
function replaceLast(messages, next) {
  if (!messages.length) return [next]
  return [...messages.slice(0, -1), next]
}

export default function AppRoot({ children }) {
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

  // AI context + command bar state. `conversation` is the running multi-turn
  // thread ([{ role, content, status }]); the assistant can ask a follow-up and
  // the user answers in the same command bar without losing context.
  const [aiContext, setAiContext] = useState(null)
  const [conversation, setConversation] = useState([]) // { role, content, status, created }
  const [aiLoading, setAiLoading] = useState(false)
  // Bumped whenever the AI writes data (e.g. creates a scenario) so dependent
  // modules reload without a manual refresh.
  const [dataNonce, setDataNonce] = useState(0)
  const [pendingScenario, setPendingScenario] = useState(null)
  // When the user clicks "Open →" on an AI-created scenario card, we store the
  // ID here so the Scenarios module can auto-select it on mount/change.
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

  // yearTxns lives here so the AI command bar uses the same fresh data as the
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

  async function handleAiSubmit(prompt) {
    // Build history from completed turns, then run the agent (tool-enabled, so it
    // can actually create a scenario rather than only describing it).
    const history = conversation
      .filter(m => m.content && m.status !== 'loading')
      .map(m => ({ role: m.role, content: m.content }))

    setAiLoading(true)
    setConversation(prev => [
      ...prev,
      { role: 'user', content: prompt },
      { role: 'assistant', content: '', status: 'loading' },
    ])

    try {
      const res = await runScenarioAgent({
        userId: user.id,
        history,
        prompt,
        context: aiContext,
        yearTxns,
        onStatus: (statusText) => setConversation(prev => replaceLast(prev, { role: 'assistant', content: '', status: 'loading', statusText })),
      })

      if (res.status === 'pending') {
        setConversation(prev => replaceLast(prev, { role: 'assistant', content: '', status: 'pending', pending: res.pending }))
        setPendingScenario(res.pending)
        setAiLoading(false)
        return
      }

      setConversation(prev => replaceLast(prev, { role: 'assistant', content: res.text, status: res.status, created: res.created }))
      if (res.created && res.created.length) {
        setDataNonce(n => n + 1)
        reloadAiContext()
      }
    } catch (e) {
      setConversation(prev => replaceLast(prev, { role: 'assistant', content: e.message, status: 'error' }))
    } finally {
      setAiLoading(false)
    }
  }

  async function handleConfirmScenario() {
    const pending = pendingScenario
    if (!pending) return
    setPendingScenario(null)
    setAiLoading(true)
    setConversation(prev => replaceLast(prev, { role: 'assistant', content: '', status: 'loading', statusText: `Building "${pending.preview.name}" …` }))
    try {
      const res = await confirmPendingScenario({
        userId: user.id,
        pending,
        context: aiContext,
        yearTxns,
        onStatus: (statusText) => setConversation(prev => replaceLast(prev, { role: 'assistant', content: '', status: 'loading', statusText })),
      })
      setConversation(prev => replaceLast(prev, { role: 'assistant', content: res.text, status: res.status, created: res.created }))
      if (res.created?.length) {
        setDataNonce(n => n + 1)
        reloadAiContext()
      }
    } catch (e) {
      setConversation(prev => replaceLast(prev, { role: 'assistant', content: e.message, status: 'error' }))
    } finally {
      setAiLoading(false)
    }
  }

  async function handleCancelScenario() {
    const pending = pendingScenario
    if (!pending) return
    setPendingScenario(null)
    setAiLoading(true)
    setConversation(prev => replaceLast(prev, { role: 'assistant', content: '', status: 'loading', statusText: 'Cancelling…' }))
    try {
      const res = await cancelPendingScenario({ pending, context: aiContext, yearTxns })
      setConversation(prev => replaceLast(prev, { role: 'assistant', content: res.text || 'Scenario cancelled.', status: 'ok', created: [] }))
    } catch {
      setConversation(prev => replaceLast(prev, { role: 'assistant', content: 'Scenario cancelled.', status: 'ok', created: [] }))
    } finally {
      setAiLoading(false)
    }
  }

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
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--tx-1)', fontSize: '20px', lineHeight: 1,
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
            <div style={{ width: '20px' }} />
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

          {/* Canvas + command bar */}
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

            <CommandBar
              mobile={mobile}
              loading={aiLoading}
              hasPending={!!pendingScenario}
              onSubmit={handleAiSubmit}
              onConfirmScenario={handleConfirmScenario}
              onCancelScenario={handleCancelScenario}
              placeholder={`Ask about ${current.short.toLowerCase()}…`}
              conversation={conversation}
              onClear={() => setConversation([])}
              onViewScenarios={(scenarioId) => {
                setOpenScenarioId(scenarioId ?? null)
                selectModule('scenarios')
              }}
              accessory={
                <AIPrefsButton
                  userId={user.id}
                  context={aiContext}
                  onChange={reloadAiContext}
                  mobile={mobile}
                />
              }
            />
          </div>
        </div>
      </div>
    </ShellContext.Provider>
  )
}

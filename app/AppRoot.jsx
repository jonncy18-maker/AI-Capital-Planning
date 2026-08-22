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
import { runAssistant, confirmPendingActions, cancelPendingActions, reviseWithFeedback } from '../src/lib/ai/toolAgent.js'
import { buildUserContent } from '../src/lib/ai/attachments.js'
import { executeTool } from '../src/lib/ai/tools/index.js'
import { getActionLog, recordActions, markUndone, clearActionLog } from '../src/lib/ai/actionLog.js'
import { getTransactionsByMonth } from '../src/lib/db/transactions.js'
import { getModule } from '../src/modules/registry.js'
import Login from '../src/modules/auth/Login.jsx'
import Onboarding from '../src/modules/onboarding/Onboarding.jsx'
import Sidebar from '../src/modules/shell/Sidebar.jsx'
import CommandBar from '../src/modules/shell/CommandBar.jsx'
import AIPrefsButton from '../src/modules/shell/AIPrefsButton.jsx'
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

// Replace the last message in the thread (the loading assistant placeholder)
// with the resolved assistant turn.
function replaceLast(messages, next) {
  if (!messages.length) return [next]
  return [...messages.slice(0, -1), next]
}

export default function AppRoot({ children }) {
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
    if (resume) window.location.href = `/api/mcp/authorize?${resume}`
  }, [session])

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

  // AI context + command bar state. `conversation` is the running multi-turn
  // thread ([{ role, content, status }]); the assistant can ask a follow-up and
  // the user answers in the same command bar without losing context.
  const [aiContext, setAiContext] = useState(null)
  const [conversation, setConversation] = useState([]) // { role, content, status, created }
  const [aiLoading, setAiLoading] = useState(false)
  // Bumped whenever the AI writes data (e.g. creates a scenario) so dependent
  // modules reload without a manual refresh.
  const [dataNonce, setDataNonce] = useState(0)
  const [pendingActions, setPendingActions] = useState(null)
  // Recent assistant writes, with an undo where one is well-defined.
  const [actionLog, setActionLog] = useState([])
  const [undoingId, setUndoingId] = useState(null)
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

  useEffect(() => {
    setActionLog(user ? getActionLog(user.id) : [])
  }, [user?.id])

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

  async function handleAiSubmit(prompt, file) {
    // A confirmation card is already up — the user typed a correction instead
    // of clicking Confirm/Cancel. Route that as feedback on the pending write
    // rather than starting a fresh top-level turn.
    if (pendingActions) return handleReviseWhilePending(prompt, file)

    // Build history from completed turns, then run the agent (tool-enabled, so it
    // can actually create a scenario rather than only describing it).
    const history = conversation
      .filter(m => m.content && m.status !== 'loading')
      .map(m => ({ role: m.role, content: m.content }))

    const content = file ? buildUserContent(prompt, file) : prompt

    setAiLoading(true)
    setConversation(prev => [
      ...prev,
      { role: 'user', content, attachment: file ? { name: file.name, kind: file.kind } : null },
      { role: 'assistant', content: '', status: 'loading' },
    ])

    try {
      const res = await runAssistant({
        userId: user.id,
        history,
        prompt: content,
        context: aiContext,
        yearTxns,
        activeModule: current.short,
        onStatus: (statusText) => setConversation(prev => replaceLast(prev, { role: 'assistant', content: '', status: 'loading', statusText })),
      })
      applyAgentResult(res)
    } catch (e) {
      setConversation(prev => replaceLast(prev, { role: 'assistant', content: e.message, status: 'error' }))
    } finally {
      setAiLoading(false)
    }
  }

  // Shared tail for every agent turn: a pause parks the pending writes for the
  // confirmation card; a finished turn logs whatever was written and refreshes
  // the modules that read it.
  function applyAgentResult(res) {
    // Writes are logged and the modules refreshed even when the turn pauses
    // again — a chained change confirms in two rounds, and the first round's
    // write is already saved by then.
    if (res.actions?.length) {
      setActionLog(recordActions(user.id, res.actions))
    }
    if (res.actions?.length || res.created?.length) {
      setDataNonce(n => n + 1)
      reloadAiContext()
    }

    if (res.status === 'pending') {
      setConversation(prev => replaceLast(prev, { role: 'assistant', content: res.text || '', status: 'pending', pending: res.pending }))
      setPendingActions(res.pending)
      return
    }

    setConversation(prev => replaceLast(prev, { role: 'assistant', content: res.text, status: res.status, created: res.created }))
  }

  // The user typed a correction instead of confirming the pending card.
  // Nothing was saved, so this drops the stale card's Confirm/Cancel buttons
  // (they'd otherwise still be clickable but now reference cleared state),
  // then feeds the correction back to the model as feedback on that turn.
  async function handleReviseWhilePending(prompt, file) {
    const pending = pendingActions
    if (!pending) return
    const trimmed = (prompt || '').trim()
    const content = file ? buildUserContent(trimmed, file) : (trimmed || 'Let me adjust that.')

    setPendingActions(null)
    setAiLoading(true)
    setConversation(prev => {
      const last = prev[prev.length - 1]
      const withoutPendingCard = last?.pending
        ? [...prev.slice(0, -1), { ...last, status: 'ok', pending: null }]
        : prev
      return [
        ...withoutPendingCard,
        { role: 'user', content, attachment: file ? { name: file.name, kind: file.kind } : null },
        { role: 'assistant', content: '', status: 'loading' },
      ]
    })

    try {
      const res = await reviseWithFeedback({
        userId: user.id,
        pending,
        content,
        context: aiContext,
        yearTxns,
        activeModule: current.short,
        onStatus: (statusText) => setConversation(prev => replaceLast(prev, { role: 'assistant', content: '', status: 'loading', statusText })),
      })
      applyAgentResult(res)
    } catch (e) {
      setConversation(prev => replaceLast(prev, { role: 'assistant', content: e.message, status: 'error' }))
    } finally {
      setAiLoading(false)
    }
  }

  async function handleConfirmActions() {
    const pending = pendingActions
    if (!pending) return
    setPendingActions(null)
    setAiLoading(true)
    const first = pending.previews?.[0]
    setConversation(prev => replaceLast(prev, {
      role: 'assistant',
      content: '',
      status: 'loading',
      statusText: `${first?.title ?? first?.name ?? 'Saving'} …`,
    }))
    try {
      const res = await confirmPendingActions({
        userId: user.id,
        pending,
        context: aiContext,
        yearTxns,
        activeModule: current.short,
        onStatus: (statusText) => setConversation(prev => replaceLast(prev, { role: 'assistant', content: '', status: 'loading', statusText })),
      })
      applyAgentResult(res)
    } catch (e) {
      setConversation(prev => replaceLast(prev, { role: 'assistant', content: e.message, status: 'error' }))
    } finally {
      setAiLoading(false)
    }
  }

  async function handleCancelActions() {
    const pending = pendingActions
    if (!pending) return
    setPendingActions(null)
    setAiLoading(true)
    setConversation(prev => replaceLast(prev, { role: 'assistant', content: '', status: 'loading', statusText: 'Cancelling…' }))
    try {
      const res = await cancelPendingActions({ pending, context: aiContext, yearTxns })
      setConversation(prev => replaceLast(prev, { role: 'assistant', content: res.text || 'Cancelled — nothing was saved.', status: 'ok', created: [] }))
    } catch {
      setConversation(prev => replaceLast(prev, { role: 'assistant', content: 'Cancelled — nothing was saved.', status: 'ok', created: [] }))
    } finally {
      setAiLoading(false)
    }
  }

  // Undo runs the inverse tool directly — no AI call, no confirmation card:
  // the user is already looking at what they asked to reverse.
  async function handleUndoAction(entry) {
    if (!entry?.undo) return
    setUndoingId(entry.id)
    try {
      await executeTool(entry.undo.tool, user.id, entry.undo.input, {
        userId: user.id,
        aiContext,
        categories: aiContext?.categories ?? [],
      })
      setActionLog(markUndone(user.id, entry.id))
      setDataNonce(n => n + 1)
      reloadAiContext()
    } catch (e) {
      setConversation(prev => [...prev, {
        role: 'assistant',
        content: `Could not undo that: ${e.message}`,
        status: 'error',
      }])
    } finally {
      setUndoingId(null)
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
              hasPending={!!pendingActions}
              onSubmit={handleAiSubmit}
              onConfirmAction={handleConfirmActions}
              onCancelAction={handleCancelActions}
              placeholder={`Ask or change anything in ${current.short.toLowerCase()}…`}
              conversation={conversation}
              onClear={() => { setConversation([]); setPendingActions(null) }}
              actionLog={actionLog}
              undoingId={undoingId}
              onUndoAction={handleUndoAction}
              onClearLog={() => setActionLog(clearActionLog(user.id))}
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

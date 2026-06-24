import { useState, useEffect, useMemo, useCallback } from 'react'
import { useTheme } from '../../lib/theme/useTheme.js'
import { loadAIContext, summarizeContext } from '../../lib/ai/contextLoader.js'
import { runScenarioAgent } from '../../lib/ai/scenarioAgent.js'
import { getTransactionsByMonth } from '../../lib/db/transactions.js'
import { getModule } from '../registry.js'
import Sidebar from './Sidebar.jsx'
import CommandBar from './CommandBar.jsx'
import AIPrefsButton from './AIPrefsButton.jsx'
import ImportFlow from '../import/ImportFlow.jsx'
import Dashboard from '../dashboard/Dashboard.jsx'
import PayPeriodPlanner from '../payperiods/PayPeriodPlanner.jsx'
import CreditCards from '../creditcards/CreditCards.jsx'
import Scenarios from '../scenarios/Scenarios.jsx'
import Budget from '../budget/Budget.jsx'
import Forecast from '../forecast/Forecast.jsx'
import Commitments from '../commitments/Commitments.jsx'
import Wealth from '../wealth/Wealth.jsx'
import Mapping from '../mapping/Mapping.jsx'
import Settings from '../settings/Settings.jsx'

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

export default function AppShell({ user, profile, onProfileSave, onSignOut, onStartReImport, pendingImport, onImportDone }) {
  const { theme, toggleTheme } = useTheme()
  const vw = useWindowWidth()
  const mobile = vw < 760
  const tablet = vw >= 760 && vw < 1100

  const [activeModule, setActiveModule] = useState(() => {
    try { return sessionStorage.getItem('acp.activeModule') || 'dashboard' } catch { return 'dashboard' }
  })
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

  function selectModule(id) {
    setActiveModule(id)
    try { sessionStorage.setItem('acp.activeModule', id) } catch {}
    setDrawerOpen(false)
  }

  const current = getModule(activeModule)

  function renderModule() {
    switch (activeModule) {
      case 'dashboard':
        return (
          <Dashboard
            context={aiContext}
            summary={summary}
            mobile={mobile}
            userId={user.id}
            yearTxns={yearTxns}
            periodOptions={profile?.period_options ?? []}
            periodDefault={profile?.period_default ?? null}
            reloadSignal={dataNonce}
            onThresholdChange={async (val) => {
              await onProfileSave({ ...(profile || {}), varianceThreshold: val })
              reloadAiContext()
            }}
          />
        )
      case 'payperiods':  return <PayPeriodPlanner userId={user.id} mobile={mobile} />
      case 'creditcards': return <CreditCards userId={user.id} mobile={mobile} />
      case 'scenarios':   return <Scenarios userId={user.id} mobile={mobile} reloadSignal={dataNonce} context={aiContext} onDataChange={() => { setDataNonce(n => n + 1); reloadAiContext() }} openScenarioId={openScenarioId} onGoToForecast={() => selectModule('forecast')} />
      case 'budget':      return <Budget userId={user.id} mobile={mobile} />
      case 'forecast':    return <Forecast userId={user.id} mobile={mobile} reloadSignal={dataNonce} onDataChange={() => { setDataNonce(n => n + 1); reloadAiContext() }} />
      case 'commitments': return <Commitments userId={user.id} mobile={mobile} />
      case 'wealth':      return <Wealth userId={user.id} mobile={mobile} />
      case 'mapping':     return <Mapping userId={user.id} mobile={mobile} />
      case 'settings':
        return (
          <Settings
            profile={profile}
            onSave={async (updated) => { await onProfileSave(updated); reloadAiContext() }}
            onBack={() => selectModule('dashboard')}
            onImport={onStartReImport}
            userId={user.id}
            context={aiContext}
            onAIPrefsChange={reloadAiContext}
          />
        )
      default:
        return <Dashboard context={aiContext} summary={summary} mobile={mobile} userId={user.id} />
    }
  }

  const sidebarProps = {
    activeModule,
    onSelect: selectModule,
    onSignOut,
    theme,
    onToggleTheme: toggleTheme,
  }

  return (
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
                  onComplete={async () => { await onImportDone(); setDataNonce(n => n + 1); reloadAiContext() }}
                  mobile={mobile}
                />
              ) : renderModule()}
            </div>
          </main>

          <CommandBar
            mobile={mobile}
            loading={aiLoading}
            onSubmit={handleAiSubmit}
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
  )
}

// Replace the last message in the thread (the loading assistant placeholder)
// with the resolved assistant turn.
function replaceLast(messages, next) {
  if (!messages.length) return [next]
  return [...messages.slice(0, -1), next]
}


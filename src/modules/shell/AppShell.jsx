import { useState, useEffect, useMemo, useCallback } from 'react'
import { useTheme } from '../../lib/theme/useTheme.js'
import { loadAIContext, summarizeContext } from '../../lib/ai/contextLoader.js'
import { runScenarioAgent } from '../../lib/ai/scenarioAgent.js'
import { getModule } from '../registry.js'
import Markdown from '../common/Markdown.jsx'

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
          <main style={{ flex: 1, overflowY: 'auto', padding: mobile ? '22px 18px 90px' : '34px 28px' }}>
            <div style={{ maxWidth: '1440px', margin: '0 auto' }}>
              {pendingImport ? (
                <ImportFlow
                  csvRaw={pendingImport.csvRaw}
                  csvName={pendingImport.csvName}
                  userId={user.id}
                  onComplete={async () => { await onImportDone(); setDataNonce(n => n + 1); reloadAiContext() }}
                  mobile={mobile}
                />
              ) : (
                <>
                  {conversation.length > 0 && (
                    <ConversationCard
                      messages={conversation}
                      onClear={() => setConversation([])}
                      onViewScenarios={(scenarioId) => {
                        setOpenScenarioId(scenarioId ?? null)
                        selectModule('scenarios')
                      }}
                    />
                  )}
                  {renderModule()}
                </>
              )}
            </div>
          </main>

          <CommandBar
            mobile={mobile}
            loading={aiLoading}
            onSubmit={handleAiSubmit}
            placeholder={conversation.length > 0 ? 'Reply to continue the conversation…' : `Ask about ${current.short.toLowerCase()}…`}
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

// Running conversation thread. Renders each turn; the user can keep answering in
// the command bar and the assistant retains context across turns.
function ConversationCard({ messages, onClear, onViewScenarios }) {
  const [collapsed, setCollapsed] = useState(false)
  const turnCount = messages.filter(m => m.role === 'user').length
  return (
    <div style={{
      border: '1px solid var(--accent-bd)',
      borderRadius: '12px',
      background: 'var(--bg-card)',
      padding: '16px 20px',
      marginBottom: '24px',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '14px', marginBottom: collapsed ? 0 : '14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: 'var(--accent)', fontSize: '14px' }}>✦</span>
          <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--tx-1)' }}>Assistant</span>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '10px', color: 'var(--tx-3)', letterSpacing: '0.04em' }}>
            {turnCount} turn{turnCount !== 1 ? 's' : ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expand' : 'Collapse'}
            style={{
              flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--tx-3)', fontSize: '13px', padding: '4px 8px', lineHeight: 1,
            }}
          >
            {collapsed ? '▸' : '▾'}
          </button>
          <button
            onClick={onClear}
            title="Start a new conversation"
            style={{
              flexShrink: 0, background: 'none', border: '1px solid var(--bd)', cursor: 'pointer',
              color: 'var(--tx-2)', fontFamily: "'DM Mono', monospace", fontSize: '10px',
              letterSpacing: '0.04em', borderRadius: '7px', padding: '5px 10px',
            }}
          >
            ↺ NEW
          </button>
        </div>
      </div>

      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {messages.map((m, i) => (
            <Turn key={i} message={m} onViewScenarios={onViewScenarios} />
          ))}
        </div>
      )}
    </div>
  )
}

function Turn({ message, onViewScenarios }) {
  const { role, content, status, statusText, created } = message

  if (role === 'user') {
    return (
      <div style={{ display: 'flex', gap: '9px', alignItems: 'flex-start' }}>
        <span style={{
          flexShrink: 0, fontFamily: "'DM Mono', monospace", fontSize: '9.5px',
          color: 'var(--tx-3)', letterSpacing: '0.06em', marginTop: '3px', width: '34px',
        }}>YOU</span>
        <div style={{ fontSize: '13.5px', lineHeight: 1.6, color: 'var(--tx-2)', whiteSpace: 'pre-wrap', minWidth: 0 }}>
          {content}
        </div>
      </div>
    )
  }

  const isError = status === 'error' || status === 'gated'
  return (
    <div style={{ display: 'flex', gap: '9px', alignItems: 'flex-start' }}>
      <span style={{ flexShrink: 0, color: isError ? 'var(--warn)' : 'var(--accent)', fontSize: '13px', marginTop: '2px', width: '34px' }}>✦</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        {status === 'loading' ? (
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '12px', color: 'var(--tx-3)', letterSpacing: '0.04em', marginTop: '2px' }}>
            {statusText || 'Thinking…'}
          </div>
        ) : isError ? (
          <div style={{ fontSize: '13.5px', lineHeight: 1.65, color: 'var(--warn)', whiteSpace: 'pre-wrap' }}>{content}</div>
        ) : (
          <Markdown text={content} />
        )}

        {created && created.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {created.map((c, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                border: '1px solid var(--accent-bd)', background: 'var(--accent-bg)',
                borderRadius: 9, padding: '9px 12px',
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--tx-1)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    ✓ {c.name}
                  </div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: 'var(--tx-3)', letterSpacing: '0.03em', marginTop: 2 }}>
                    {c.adjustmentCount} adjustment{c.adjustmentCount === 1 ? '' : 's'} · net {c.netDelta >= 0 ? '+' : '−'}${Math.abs(Math.round(c.netDelta)).toLocaleString()}
                  </div>
                </div>
                <button onClick={() => onViewScenarios(c.scenarioId)} style={{
                  flexShrink: 0, background: 'var(--accent)', color: 'var(--accent-tx-on)', border: 'none',
                  borderRadius: 7, padding: '6px 12px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                }}>
                  Open →
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

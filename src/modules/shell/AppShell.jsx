import { useState, useEffect, useMemo } from 'react'
import { useTheme } from '../../lib/theme/useTheme.js'
import { loadAIContext, summarizeContext } from '../../lib/ai/contextLoader.js'
import { sendAIMessage } from '../../lib/ai/sendMessage.js'
import { getModule } from '../registry.js'

import Sidebar from './Sidebar.jsx'
import CommandBar from './CommandBar.jsx'
import ImportFlow from '../import/ImportFlow.jsx'
import Dashboard from '../dashboard/Dashboard.jsx'
import CashFlow from '../cashflow/CashFlow.jsx'
import Scenarios from '../scenarios/Scenarios.jsx'
import Budget from '../budget/Budget.jsx'
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

  const [activeModule, setActiveModule] = useState('dashboard')
  const [collapsed, setCollapsed] = useState(tablet)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // AI context + command bar state. `conversation` is the running multi-turn
  // thread ([{ role, content, status }]); the assistant can ask a follow-up and
  // the user answers in the same command bar without losing context.
  const [aiContext, setAiContext] = useState(null)
  const [conversation, setConversation] = useState([]) // { role, content, status }
  const [aiLoading, setAiLoading] = useState(false)

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
    // Build the API history from completed turns, then append the new question.
    const history = conversation
      .filter(m => m.content && m.status !== 'loading')
      .map(m => ({ role: m.role, content: m.content }))
    const apiMessages = [...history, { role: 'user', content: prompt }]

    setAiLoading(true)
    setConversation(prev => [
      ...prev,
      { role: 'user', content: prompt },
      { role: 'assistant', content: '', status: 'loading' },
    ])

    try {
      const res = await sendAIMessage({ messages: apiMessages, context: aiContext })
      setConversation(prev => replaceLast(prev, { role: 'assistant', content: res.text, status: res.status }))
    } catch (e) {
      setConversation(prev => replaceLast(prev, { role: 'assistant', content: e.message, status: 'error' }))
    } finally {
      setAiLoading(false)
    }
  }

  function selectModule(id) {
    setActiveModule(id)
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
          />
        )
      case 'cashflow':    return <CashFlow userId={user.id} mobile={mobile} />
      case 'scenarios':   return <Scenarios userId={user.id} mobile={mobile} />
      case 'budget':      return <Budget userId={user.id} mobile={mobile} />
      case 'commitments': return <Commitments userId={user.id} mobile={mobile} />
      case 'wealth':      return <Wealth userId={user.id} mobile={mobile} />
      case 'mapping':     return <Mapping userId={user.id} mobile={mobile} />
      case 'settings':
        return (
          <Settings
            profile={profile}
            onSave={onProfileSave}
            onBack={() => setActiveModule('dashboard')}
            onImport={onStartReImport}
            userId={user.id}
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
            <div style={{ maxWidth: '1240px', margin: '0 auto' }}>
              {pendingImport ? (
                <ImportFlow
                  csvRaw={pendingImport.csvRaw}
                  csvName={pendingImport.csvName}
                  userId={user.id}
                  onComplete={onImportDone}
                  mobile={mobile}
                />
              ) : (
                <>
                  {conversation.length > 0 && (
                    <ConversationCard
                      messages={conversation}
                      onClear={() => setConversation([])}
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
            placeholder={`Ask about ${current.short.toLowerCase()}…`}
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
function ConversationCard({ messages, onClear }) {
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
        gap: '14px', marginBottom: '14px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: 'var(--accent)', fontSize: '14px' }}>✦</span>
          <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--tx-1)' }}>Assistant</span>
        </div>
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {messages.map((m, i) => (
          <Turn key={i} message={m} />
        ))}
      </div>
    </div>
  )
}

function Turn({ message }) {
  const { role, content, status } = message

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
      {status === 'loading' ? (
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '12px', color: 'var(--tx-3)', letterSpacing: '0.04em', marginTop: '2px' }}>
          Thinking…
        </div>
      ) : (
        <div style={{ fontSize: '13.5px', lineHeight: 1.65, color: isError ? 'var(--warn)' : 'var(--tx-1)', whiteSpace: 'pre-wrap', minWidth: 0 }}>
          {content}
        </div>
      )}
    </div>
  )
}

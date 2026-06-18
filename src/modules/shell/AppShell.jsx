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

  // AI context + command bar state
  const [aiContext, setAiContext] = useState(null)
  const [aiResponse, setAiResponse] = useState(null) // { prompt, status, text }
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
    setAiLoading(true)
    setAiResponse({ prompt, status: 'loading', text: '' })
    try {
      const res = await sendAIMessage({ prompt, context: aiContext })
      setAiResponse({ prompt, status: res.status, text: res.text })
    } catch (e) {
      setAiResponse({ prompt, status: 'error', text: e.message })
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
            <div style={{ maxWidth: '960px', margin: '0 auto' }}>
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
                  {aiResponse && (
                    <AiResponseCard
                      response={aiResponse}
                      onDismiss={() => setAiResponse(null)}
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

function AiResponseCard({ response, onDismiss }) {
  const { prompt, status, text } = response
  const accentByStatus = {
    loading: 'var(--accent)',
    ok: 'var(--accent)',
    error: 'var(--warn)',
    gated: 'var(--warn)',
  }
  return (
    <div style={{
      border: `1px solid ${status === 'error' || status === 'gated' ? 'var(--warn)' : 'var(--accent-bd)'}`,
      borderRadius: '12px',
      background: 'var(--bg-card)',
      padding: '18px 20px',
      marginBottom: '24px',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '14px',
        marginBottom: '12px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0 }}>
          <span style={{ color: accentByStatus[status] ?? 'var(--accent)', fontSize: '14px' }}>✦</span>
          <span style={{
            fontSize: '13px',
            color: 'var(--tx-2)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {prompt}
          </span>
        </div>
        <button
          onClick={onDismiss}
          style={{
            flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--tx-3)', fontSize: '15px', lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {status === 'loading' ? (
        <div style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: '12px',
          color: 'var(--tx-3)',
          letterSpacing: '0.04em',
        }}>
          Thinking…
        </div>
      ) : (
        <div style={{
          fontSize: '13.5px',
          lineHeight: '1.65',
          color: 'var(--tx-1)',
          whiteSpace: 'pre-wrap',
        }}>
          {text}
        </div>
      )}
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import { sendGrillMessage } from '../../lib/ai/grillSession.js'
import { getProfile } from '../../lib/db/profile.js'
import { getTransactionsForAnalysis } from '../../lib/db/transactions.js'

const PHASE_NAMES = ['Income', 'Life Events', 'Commitments', 'Non-Monthly', 'Categories', 'Envelope']

export default function GrillSession({ userId, targetYear, commitments, lineItems, onGenerateDraft, onCancel, mobile }) {
  const [messages, setMessages] = useState([])
  const [phase, setPhase] = useState(1)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingCtx, setLoadingCtx] = useState(true)
  const [profile, setProfile] = useState(null)
  const [spendingGroups, setSpendingGroups] = useState({})
  const [priorBudgetGroups, setPriorBudgetGroups] = useState({})
  const messagesEndRef = useRef(null)

  useEffect(() => {
    async function loadCtx() {
      try {
        const prof = await getProfile(userId)
        setProfile(prof)

        const txns = await getTransactionsForAnalysis(userId, 12)
        const byGroup = {}
        for (const t of txns) {
          if (!t.group || t.amount >= 0) continue
          byGroup[t.group] = (byGroup[t.group] || 0) + Math.abs(t.amount)
        }
        setSpendingGroups(byGroup)

        const budgetByGroup = {}
        for (const item of lineItems) {
          const g = item.budget_categories?.group
          if (!g) continue
          budgetByGroup[g] = (budgetByGroup[g] || 0) + (item.amount || 0)
        }
        setPriorBudgetGroups(budgetByGroup)
      } catch (e) {
        console.error('GrillSession context load error:', e)
      } finally {
        setLoadingCtx(false)
      }
    }
    loadCtx()
  }, [userId]) // lineItems deliberately omitted — snapshot at open time

  useEffect(() => {
    if (!loadingCtx && messages.length === 0) {
      sendPhaseOpen()
    }
  }, [loadingCtx]) // eslint-disable-line react-hooks/exhaustive-deps

  async function sendPhaseOpen() {
    setSending(true)
    try {
      const res = await sendGrillMessage({
        messages: [],
        phase: 1,
        targetYear,
        profile,
        commitments,
        priorBudgetGroups,
        spendingGroups,
      })
      setMessages([{ role: 'assistant', content: res.content }])
    } catch (e) {
      setMessages([{ role: 'assistant', content: 'Having trouble connecting. Try refreshing, or proceed to Generate Draft.' }])
    } finally {
      setSending(false)
    }
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    const userMsg = { role: 'user', content: text }
    const next = [...messages, userMsg]
    setMessages(next)
    setSending(true)
    try {
      const res = await sendGrillMessage({
        messages: next,
        phase,
        targetYear,
        profile,
        commitments,
        priorBudgetGroups,
        spendingGroups,
      })
      setMessages(m => [...m, { role: 'assistant', content: res.content }])
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', content: 'Error reaching AI. Please try again.' }])
    } finally {
      setSending(false)
    }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  function advancePhase() {
    if (phase < 6) setPhase(p => p + 1)
  }

  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    border: '1px solid var(--bd)',
    borderRadius: 12,
    overflow: 'hidden',
    background: 'var(--bg-card)',
  }

  const headerStyle = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid var(--bd)',
    gap: 12,
    flexWrap: 'wrap',
  }

  const chatAreaStyle = {
    flex: 1,
    minHeight: 320,
    maxHeight: 480,
    overflowY: 'auto',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  }

  const inputRowStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 16px',
    borderTop: '1px solid var(--bd)',
  }

  const ghostBtn = {
    padding: '7px 13px',
    background: 'transparent',
    color: 'var(--tx-2)',
    border: '1px solid var(--bd)',
    borderRadius: 7,
    fontSize: 12,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  }

  const accentBtn = {
    padding: '7px 14px',
    background: 'var(--accent)',
    color: 'var(--accent-tx-on, #fff)',
    border: 'none',
    borderRadius: 7,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  }

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        {/* Phase stepper */}
        {mobile ? (
          <div style={{ fontSize: 12.5, color: 'var(--tx-2)', fontWeight: 500 }}>
            <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{PHASE_NAMES[phase - 1]}</span>
            <span style={{ color: 'var(--tx-3)', marginLeft: 6 }}>— Phase {phase} of 6</span>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {PHASE_NAMES.map((name, i) => {
              const num = i + 1
              const isCompleted = num < phase
              const isCurrent = num === phase
              return (
                <div key={num} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: isCurrent ? '4px 10px' : '4px 8px',
                    borderRadius: 20,
                    background: isCurrent ? 'var(--accent-bg)' : 'transparent',
                    border: isCurrent ? '1px solid var(--accent-bd, var(--accent))' : '1px solid transparent',
                    transition: 'all .15s',
                  }}>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: isCompleted ? 'var(--tx-3)' : isCurrent ? 'var(--accent)' : 'var(--tx-4)',
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {isCompleted ? '✓' : num}
                    </span>
                    {isCurrent && (
                      <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--accent)' }}>
                        {name}
                      </span>
                    )}
                    {!isCurrent && (
                      <span style={{ fontSize: 11, color: isCompleted ? 'var(--tx-3)' : 'var(--tx-4)' }}>
                        {name}
                      </span>
                    )}
                  </div>
                  {num < 6 && (
                    <span style={{ fontSize: 10, color: 'var(--tx-4)', userSelect: 'none' }}>›</span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Right buttons */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <button
            onClick={advancePhase}
            disabled={phase === 6}
            style={{
              ...ghostBtn,
              color: phase === 6 ? 'var(--accent)' : 'var(--tx-2)',
              borderColor: phase === 6 ? 'var(--accent-bd, var(--accent))' : 'var(--bd)',
              opacity: phase === 6 ? 0.7 : 1,
              cursor: phase === 6 ? 'default' : 'pointer',
            }}
          >
            {phase === 6 ? 'Done ✓' : 'Next Phase →'}
          </button>
          <button onClick={onCancel} style={{ ...ghostBtn, fontSize: 13 }}>× Exit</button>
        </div>
      </div>

      {/* Chat area */}
      <div style={chatAreaStyle}>
        {loadingCtx ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--tx-3)', fontSize: 13 }}>
            Loading your financial picture…
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  alignItems: 'flex-start',
                  gap: 8,
                }}
              >
                {msg.role === 'assistant' && (
                  <span style={{ fontSize: 13, color: 'var(--accent)', marginTop: 10, flexShrink: 0 }}>✦</span>
                )}
                <div style={{
                  maxWidth: msg.role === 'user' ? '75%' : '80%',
                  padding: '10px 14px',
                  borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '2px 12px 12px 12px',
                  background: msg.role === 'user'
                    ? 'var(--accent-muted, rgba(56,189,248,0.1))'
                    : 'var(--surface-2, rgba(255,255,255,0.05))',
                  fontSize: 13.5,
                  color: 'var(--text-primary, var(--tx-1))',
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                  border: '1px solid var(--bd)',
                }}>
                  {msg.content}
                </div>
              </div>
            ))}

            {sending && (
              <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--accent)', marginTop: 10, flexShrink: 0 }}>✦</span>
                <div style={{
                  padding: '12px 16px',
                  borderRadius: '2px 12px 12px 12px',
                  background: 'var(--surface-2, rgba(255,255,255,0.05))',
                  border: '1px solid var(--bd)',
                  fontSize: 16,
                  color: 'var(--tx-3)',
                  letterSpacing: 4,
                }}>
                  · · ·
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input row */}
      <div style={inputRowStyle}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend()
          }}
          placeholder="Type your response…"
          disabled={loadingCtx || sending}
          style={{
            flex: 1,
            background: 'var(--field, var(--bg-card))',
            border: '1px solid var(--bd)',
            borderRadius: 7,
            padding: '9px 13px',
            color: 'var(--tx-1)',
            fontSize: 13.5,
            outline: 'none',
          }}
        />
        <button
          onClick={handleSend}
          disabled={sending || loadingCtx || !input.trim()}
          style={{
            ...ghostBtn,
            opacity: sending || loadingCtx || !input.trim() ? 0.5 : 1,
            cursor: sending || loadingCtx || !input.trim() ? 'not-allowed' : 'pointer',
          }}
        >
          Send
        </button>
        <button
          onClick={onGenerateDraft}
          disabled={loadingCtx}
          style={{
            ...accentBtn,
            opacity: loadingCtx ? 0.5 : 1,
            cursor: loadingCtx ? 'not-allowed' : 'pointer',
          }}
        >
          Generate Draft →
        </button>
      </div>
    </div>
  )
}

import { useState, useRef, useEffect } from 'react'
import Markdown from '../common/Markdown.jsx'

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function PendingScenarioCard({ preview, onConfirm, onCancel }) {
  const { name, description, adjustments, adjustmentCount, netDelta } = preview
  const shown = adjustments.slice(0, 5)
  const overflow = adjustments.length - shown.length
  return (
    <div style={{
      border: '1px solid var(--accent-bd)',
      background: 'var(--accent-bg)',
      borderRadius: '10px',
      padding: '11px 13px',
      marginTop: '6px',
    }}>
      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--tx-1)' }}>{name}</div>
      {description && (
        <div style={{ fontSize: '11.5px', color: 'var(--tx-3)', marginTop: '3px', lineHeight: 1.5 }}>{description}</div>
      )}
      <div style={{ borderTop: '1px solid var(--bd)', margin: '8px 0' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {shown.map((a, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px' }}>
            <span style={{ color: 'var(--tx-2)' }}>
              {a.category} · {MONTH_SHORT[(a.month - 1) % 12]} {a.year}
            </span>
            <span style={{
              fontFamily: "'DM Mono', monospace",
              fontWeight: 600,
              color: a.delta_amount >= 0 ? '#f87171' : '#4ade80',
            }}>
              {a.delta_amount >= 0 ? '+' : '−'}${Math.abs(Math.round(a.delta_amount)).toLocaleString()}
            </span>
          </div>
        ))}
        {overflow > 0 && (
          <div style={{ fontSize: '11px', color: 'var(--tx-3)' }}>…and {overflow} more</div>
        )}
      </div>
      <div style={{ borderTop: '1px solid var(--bd)', margin: '8px 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '10.5px', color: 'var(--tx-3)' }}>
          {adjustmentCount} adjustment{adjustmentCount === 1 ? '' : 's'} · net {netDelta >= 0 ? '+' : '−'}${Math.abs(Math.round(netDelta)).toLocaleString()}
        </div>
        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
          <button
            onClick={onCancel}
            style={{
              background: 'transparent',
              border: '1px solid var(--bd)',
              borderRadius: '7px',
              padding: '5px 11px',
              fontSize: '11px',
              color: 'var(--tx-2)',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              background: '#22c55e',
              border: 'none',
              borderRadius: '7px',
              padding: '5px 11px',
              fontSize: '11px',
              fontWeight: 600,
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            ✓ Confirm
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CommandBar({
  mobile,
  loading,
  hasPending,
  onSubmit,
  onConfirmScenario,
  onCancelScenario,
  placeholder,
  accessory,
  conversation = [],
  onClear,
  onViewScenarios,
}) {
  const [open, setOpen] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [input, setInput] = useState('')
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const ph = placeholder || 'Ask anything about your finances…'
  const hasMessages = conversation.length > 0

  // Auto-open popup when a request is in flight
  useEffect(() => {
    if (loading) setOpen(true)
  }, [loading])

  // Scroll to bottom when conversation grows (only while open)
  useEffect(() => {
    if (open) {
      // Defer one tick so the DOM has painted
      const id = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      }, 50)
      return () => clearTimeout(id)
    }
  }, [conversation, open])

  // Focus input when popup opens
  useEffect(() => {
    if (open) {
      const id = setTimeout(() => inputRef.current?.focus(), 80)
      return () => clearTimeout(id)
    }
  }, [open])

  function submit() {
    const trimmed = input.trim()
    if (!trimmed || loading) return
    onSubmit(trimmed)
    setInput('')
    setOpen(true)
  }

  function handleViewScenarios(id) {
    onViewScenarios(id)
    setOpen(false)
  }

  const popupWidth = mobile
    ? 'calc(100vw - 36px)'
    : maximized ? 'min(760px, calc(100vw - 80px))' : '400px'
  const popupHeight = maximized ? 'calc(100dvh - 100px)' : '520px'

  return (
    <>
      {/* ── Floating bubble ── */}
      <button
        onClick={() => setOpen(o => !o)}
        title={open ? 'Close assistant' : 'Open assistant'}
        style={{
          position: 'fixed',
          right: '18px',
          bottom: '18px',
          zIndex: 200,
          width: '54px',
          height: '54px',
          borderRadius: '50%',
          border: 'none',
          background: open ? 'var(--tx-1)' : 'var(--accent)',
          color: open ? 'var(--bg-app)' : 'var(--accent-tx-on)',
          fontSize: open ? '22px' : '22px',
          boxShadow: '0 4px 22px rgba(0,0,0,0.28)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 0.15s',
          flexShrink: 0,
        }}
      >
        {open ? '×' : '✦'}

        {/* Notification dot — visible when popup is closed and there is history */}
        {!open && hasMessages && (
          <span style={{
            position: 'absolute',
            top: '5px',
            right: '5px',
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: loading ? 'var(--accent)' : '#22c55e',
            border: '2px solid var(--bg-app)',
            animation: loading ? 'pulse 1.2s ease-in-out infinite' : 'none',
          }} />
        )}
      </button>

      {/* ── Floating popup ── */}
      {open && (
        <>
          {/* Scrim on mobile only — tap outside closes */}
          {mobile && (
            <div
              onClick={() => setOpen(false)}
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 198,
                background: 'rgba(0,0,0,0.35)',
              }}
            />
          )}

          <div style={{
            position: 'fixed',
            right: '18px',
            bottom: '82px',
            zIndex: 199,
            width: popupWidth,
            height: popupHeight,
            maxHeight: 'calc(100dvh - 100px)',
            transition: 'width 0.2s ease, height 0.2s ease',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-card)',
            border: '1px solid var(--bd)',
            borderRadius: '16px',
            boxShadow: '0 8px 40px rgba(0,0,0,0.22)',
            overflow: 'hidden',
          }}>

            {/* Header */}
            <div style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '11px 14px 11px 16px',
              borderBottom: '1px solid var(--bd)',
              gap: '8px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: 'var(--accent)', fontSize: '14px' }}>✦</span>
                <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--tx-1)', letterSpacing: '0.01em' }}>
                  Assistant
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {accessory}
                {!mobile && (
                  <button
                    onClick={() => setMaximized(m => !m)}
                    title={maximized ? 'Restore' : 'Maximize'}
                    style={{
                      background: 'none',
                      border: '1px solid var(--bd)',
                      cursor: 'pointer',
                      color: 'var(--tx-2)',
                      fontSize: '13px',
                      borderRadius: '7px',
                      padding: '4px 8px',
                      lineHeight: 1,
                    }}
                  >
                    {maximized ? '⊟' : '⊞'}
                  </button>
                )}
                {hasMessages && (
                  <button
                    onClick={() => { onClear(); }}
                    title="Start new conversation"
                    style={{
                      background: 'none',
                      border: '1px solid var(--bd)',
                      cursor: 'pointer',
                      color: 'var(--tx-2)',
                      fontFamily: "'DM Mono', monospace",
                      fontSize: '10px',
                      letterSpacing: '0.04em',
                      borderRadius: '7px',
                      padding: '4px 9px',
                    }}
                  >
                    ↺ NEW
                  </button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: hasMessages ? '14px 16px' : '0',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
            }}>
              {!hasMessages ? (
                <div style={{
                  flex: 1,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '28px 24px',
                  gap: '12px',
                  color: 'var(--tx-3)',
                  textAlign: 'center',
                }}>
                  <span style={{ fontSize: '32px', opacity: 0.3 }}>✦</span>
                  <div style={{ fontSize: '13px', lineHeight: 1.65, maxWidth: '260px' }}>
                    Ask anything about your finances — scenarios, forecasts, budget vs. actuals.
                  </div>
                </div>
              ) : (
                conversation.map((m, i) => (
                  <Turn
                    key={i}
                    message={m}
                    onViewScenarios={handleViewScenarios}
                    onConfirm={onConfirmScenario}
                    onCancel={onCancelScenario}
                  />
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div style={{
              flexShrink: 0,
              borderTop: '1px solid var(--bd)',
              padding: '11px 13px',
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '9px',
                border: '1px solid var(--accent-bd)',
                borderRadius: '10px',
                background: 'var(--accent-bg)',
                padding: '9px 12px',
              }}>
                <input
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !loading) submit() }}
                  placeholder={ph}
                  disabled={loading || hasPending}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: 'none',
                    border: 'none',
                    outline: 'none',
                    color: 'var(--tx-1)',
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '13.5px',
                  }}
                />
                <button
                  onClick={submit}
                  disabled={loading || hasPending || !input.trim()}
                  style={{
                    flexShrink: 0,
                    background: input.trim() && !loading ? 'var(--accent)' : 'transparent',
                    color: input.trim() && !loading ? 'var(--accent-tx-on)' : 'var(--tx-3)',
                    border: 'none',
                    borderRadius: '7px',
                    padding: '6px 12px',
                    fontFamily: "'DM Mono', monospace",
                    fontSize: '11px',
                    letterSpacing: '0.04em',
                    cursor: input.trim() && !loading ? 'pointer' : 'default',
                  }}
                >
                  {loading ? '···' : 'ASK'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </>
  )
}

function Turn({ message, onViewScenarios, onConfirm, onCancel }) {
  const { role, content, status, statusText, created, pending } = message

  if (role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{
          maxWidth: '80%',
          background: 'var(--accent-bg)',
          border: '1px solid var(--accent-bd)',
          borderRadius: '12px 12px 4px 12px',
          padding: '8px 12px',
          fontSize: '13px',
          lineHeight: 1.6,
          color: 'var(--tx-1)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {content}
        </div>
      </div>
    )
  }

  if (status === 'pending' && pending) {
    return (
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
        <span style={{ color: 'var(--accent)', fontSize: '13px', marginTop: '3px', flexShrink: 0 }}>✦</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: '13px', color: 'var(--tx-2)', lineHeight: 1.55 }}>
            Here's what I'd create — confirm to save it:
          </div>
          <PendingScenarioCard preview={pending.preview} onConfirm={onConfirm} onCancel={onCancel} />
        </div>
      </div>
    )
  }

  const isError = status === 'error' || status === 'gated'
  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
      <span style={{
        flexShrink: 0,
        color: isError ? 'var(--warn)' : 'var(--accent)',
        fontSize: '13px',
        marginTop: '3px',
      }}>✦</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        {status === 'loading' ? (
          <div style={{
            fontFamily: "'DM Mono', monospace",
            fontSize: '12px',
            color: 'var(--tx-3)',
            letterSpacing: '0.04em',
            marginTop: '2px',
          }}>
            {statusText || 'Thinking…'}
          </div>
        ) : isError ? (
          <div style={{ fontSize: '13px', lineHeight: 1.65, color: 'var(--warn)', whiteSpace: 'pre-wrap' }}>
            {content}
          </div>
        ) : (
          <Markdown text={content} />
        )}

        {created && created.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
            {created.map((c, i) => (
              <div key={i} style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                border: '1px solid var(--accent-bd)',
                background: 'var(--accent-bg)',
                borderRadius: 9,
                padding: '8px 11px',
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: 12.5,
                    color: 'var(--tx-1)',
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    ✓ {c.name}
                  </div>
                  <div style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 10,
                    color: 'var(--tx-3)',
                    letterSpacing: '0.03em',
                    marginTop: 2,
                  }}>
                    {c.adjustmentCount} adjustment{c.adjustmentCount === 1 ? '' : 's'} · net {c.netDelta >= 0 ? '+' : '−'}${Math.abs(Math.round(c.netDelta)).toLocaleString()}
                  </div>
                </div>
                <button
                  onClick={() => onViewScenarios(c.scenarioId)}
                  style={{
                    flexShrink: 0,
                    background: 'var(--accent)',
                    color: 'var(--accent-tx-on)',
                    border: 'none',
                    borderRadius: 7,
                    padding: '5px 11px',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
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

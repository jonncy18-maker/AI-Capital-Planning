import { useState, useRef, useEffect } from 'react'
import Markdown from '../common/Markdown.jsx'
import PendingActionCard from './PendingActionCard.jsx'
import ActivityPanel from './ActivityPanel.jsx'
import { ACCEPT_ATTR, MAX_FILE_BYTES, UNSUPPORTED_FILE_MESSAGE, isSupportedFile, readFileAsAttachment, formatFileSize } from '../../lib/ai/attachments.js'

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function PendingScenarioCard({ preview }) {
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
              // Cash terms: more income is green, more spending is red.
              color: (a.isIncome ? a.delta_amount : -a.delta_amount) >= 0 ? '#4ade80' : '#f87171',
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
      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '10.5px', color: 'var(--tx-3)' }}>
        {adjustmentCount} adjustment{adjustmentCount === 1 ? '' : 's'} · net {netDelta >= 0 ? '+' : '−'}${Math.abs(Math.round(netDelta)).toLocaleString()}
      </div>
    </div>
  )
}

// One or more writes the assistant wants to make, confirmed as a batch — the
// model may pair a change with its follow-on (e.g. create a category, then
// budget it), and approving half of that would leave the data inconsistent.
function PendingActions({ previews = [], onConfirm, onCancel }) {
  const label = previews.length === 1
    ? "Here's what I'd change — confirm to save it:"
    : `Here are the ${previews.length} changes I'd make — confirm to save them:`

  return (
    <div style={{ minWidth: 0, flex: 1 }}>
      <div style={{ fontSize: '13px', color: 'var(--tx-2)', lineHeight: 1.55 }}>{label}</div>

      {previews.map((p, i) => (
        p.kind === 'scenario'
          ? <PendingScenarioCard key={p.blockId ?? i} preview={p} />
          : <PendingActionCard key={p.blockId ?? i} preview={p} />
      ))}

      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', marginTop: '8px' }}>
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
  )
}

export default function CommandBar({
  mobile,
  loading,
  hasPending,
  onSubmit,
  onConfirmAction,
  onCancelAction,
  placeholder,
  accessory,
  conversation = [],
  onClear,
  onViewScenarios,
  actionLog = [],
  undoingId,
  onUndoAction,
  onClearLog,
}) {
  const [open, setOpen] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [tab, setTab] = useState('chat')
  const [input, setInput] = useState('')
  const [stagedFile, setStagedFile] = useState(null)
  const [fileError, setFileError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const fileInputRef = useRef(null)
  const dragCounter = useRef(0)
  const ph = placeholder || 'Ask anything about your finances…'
  const hasMessages = conversation.length > 0

  async function handleFiles(fileList) {
    const file = fileList?.[0]
    if (!file) return
    if (!isSupportedFile(file)) {
      setFileError(UNSUPPORTED_FILE_MESSAGE)
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setFileError(`That file is too large — max ${formatFileSize(MAX_FILE_BYTES)}.`)
      return
    }
    setFileError(null)
    try {
      setStagedFile(await readFileAsAttachment(file))
    } catch (e) {
      setFileError(e.message || 'Could not read that file.')
    }
  }

  function handleDragEnter(e) {
    e.preventDefault()
    dragCounter.current += 1
    setDragOver(true)
  }
  function handleDragOver(e) {
    e.preventDefault()
  }
  function handleDragLeave(e) {
    e.preventDefault()
    dragCounter.current -= 1
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setDragOver(false)
    }
  }
  function handleDrop(e) {
    e.preventDefault()
    dragCounter.current = 0
    setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }

  // Auto-open popup when a request is in flight
  useEffect(() => {
    if (loading) { setOpen(true); setTab('chat') }
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
    if ((!trimmed && !stagedFile) || loading) return
    onSubmit(trimmed, stagedFile)
    setInput('')
    setStagedFile(null)
    setFileError(null)
    setOpen(true)
    setTab('chat')
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

          <div
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
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
            {dragOver && (
              <div style={{
                position: 'absolute',
                inset: '8px',
                zIndex: 5,
                borderRadius: '10px',
                border: '1.5px dashed var(--accent)',
                background: 'var(--accent-bg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                gap: '6px',
                pointerEvents: 'none',
              }}>
                <span style={{ fontSize: '22px', color: 'var(--accent)' }}>⇩</span>
                <span style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: '10.5px',
                  letterSpacing: '0.03em',
                  color: 'var(--accent)',
                }}>DROP FILE TO ATTACH</span>
              </div>
            )}

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
                <button
                  onClick={() => setTab(t => (t === 'activity' ? 'chat' : 'activity'))}
                  title={tab === 'activity' ? 'Back to conversation' : 'Changes made by the assistant'}
                  style={{
                    background: tab === 'activity' ? 'var(--accent-bg)' : 'none',
                    border: `1px solid ${tab === 'activity' ? 'var(--accent-bd)' : 'var(--bd)'}`,
                    cursor: 'pointer',
                    color: tab === 'activity' ? 'var(--accent)' : 'var(--tx-2)',
                    fontFamily: "'DM Mono', monospace",
                    fontSize: '10px',
                    letterSpacing: '0.04em',
                    borderRadius: '7px',
                    padding: '4px 9px',
                  }}
                >
                  {actionLog.length ? `⟲ ${actionLog.length} CHANGES` : '⟲ CHANGES'}
                </button>
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

            {/* Activity log */}
            {tab === 'activity' && (
              <div style={{ flex: 1, minHeight: 0 }}>
                <ActivityPanel
                  entries={actionLog}
                  busyId={undoingId}
                  onUndo={onUndoAction}
                  onClear={onClearLog}
                />
              </div>
            )}

            {/* Messages */}
            {tab === 'chat' && (
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
                    onConfirm={onConfirmAction}
                    onCancel={onCancelAction}
                  />
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
            )}

            {/* Input */}
            <div style={{
              flexShrink: 0,
              borderTop: '1px solid var(--bd)',
              padding: '11px 13px',
            }}>
              {stagedFile && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '8px',
                  padding: '6px 8px',
                  borderRadius: '8px',
                  background: 'var(--bg-card-2)',
                  border: '1px solid var(--bd)',
                }}>
                  <span style={{
                    width: '22px', height: '22px', flexShrink: 0,
                    borderRadius: '5px',
                    background: 'var(--accent-bg)',
                    color: 'var(--accent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '11px',
                  }}>{stagedFile.kind === 'image' ? '◱' : '▤'}</span>
                  <span style={{
                    flex: 1, minWidth: 0,
                    fontSize: '11.5px', fontWeight: 500, color: 'var(--tx-1)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{stagedFile.name}</span>
                  <span style={{
                    fontFamily: "'DM Mono', monospace", fontSize: '9.5px', color: 'var(--tx-3)', flexShrink: 0,
                  }}>{formatFileSize(stagedFile.size)}</span>
                  <button
                    onClick={() => setStagedFile(null)}
                    title="Remove attachment"
                    style={{
                      flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--tx-3)', fontSize: '13px', padding: '0 2px', lineHeight: 1,
                    }}
                  >✕</button>
                </div>
              )}
              {fileError && (
                <div style={{ fontSize: '11px', color: 'var(--warn)', marginBottom: '8px' }}>{fileError}</div>
              )}
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
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPT_ATTR}
                  onChange={e => { handleFiles(e.target.files); e.target.value = '' }}
                  style={{ display: 'none' }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading || hasPending}
                  title="Attach a file"
                  style={{
                    flexShrink: 0,
                    width: '26px',
                    height: '26px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--accent-bd)',
                    borderRadius: '7px',
                    color: 'var(--accent)',
                    fontSize: '13px',
                    cursor: loading || hasPending ? 'default' : 'pointer',
                  }}
                >📎</button>
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
                  disabled={loading || hasPending || (!input.trim() && !stagedFile)}
                  style={{
                    flexShrink: 0,
                    background: (input.trim() || stagedFile) && !loading ? 'var(--accent)' : 'transparent',
                    color: (input.trim() || stagedFile) && !loading ? 'var(--accent-tx-on)' : 'var(--tx-3)',
                    border: 'none',
                    borderRadius: '7px',
                    padding: '6px 12px',
                    fontFamily: "'DM Mono', monospace",
                    fontSize: '11px',
                    letterSpacing: '0.04em',
                    cursor: (input.trim() || stagedFile) && !loading ? 'pointer' : 'default',
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
  const { role, content, status, statusText, created, pending, attachment } = message

  if (role === 'user') {
    const text = typeof content === 'string' ? content : (content.find(b => b.type === 'text')?.text || '')
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
          {text}
          {attachment && (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              marginTop: '7px',
              padding: '4px 9px 4px 7px',
              borderRadius: '8px',
              background: 'var(--bg-card-2)',
              border: '1px solid var(--bd)',
              fontFamily: "'DM Mono', monospace",
              fontSize: '10.5px',
              color: 'var(--tx-2)',
            }}>
              <span>{attachment.kind === 'image' ? '◱' : '▤'}</span>
              {attachment.name}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (status === 'pending' && pending) {
    return (
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
        <span style={{ color: 'var(--accent)', fontSize: '13px', marginTop: '3px', flexShrink: 0 }}>✦</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          {content && (
            <div style={{ marginBottom: 8 }}><Markdown text={content} /></div>
          )}
          <PendingActions previews={pending.previews} onConfirm={onConfirm} onCancel={onCancel} />
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

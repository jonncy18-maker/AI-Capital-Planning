import { useState } from 'react'

// Persistent, context-aware AI input. Desktop: bottom-of-canvas bar.
// Mobile: floating action button that expands to a bottom sheet.
// Submitting calls onSubmit(prompt); the shell runs the request and renders the
// response as a card in the canvas.

function Field({ value, onChange, onSubmit, loading, placeholder, autoFocus }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      border: '1px solid var(--accent-bd)',
      borderRadius: '10px',
      background: 'var(--accent-bg)',
      padding: '10px 14px',
    }}>
      <span style={{ color: 'var(--accent)', fontSize: '15px', flexShrink: 0 }}>✦</span>
      <input
        value={value}
        autoFocus={autoFocus}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !loading) onSubmit() }}
        placeholder={placeholder}
        disabled={loading}
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
        onClick={onSubmit}
        disabled={loading || !value.trim()}
        style={{
          flexShrink: 0,
          background: value.trim() && !loading ? 'var(--accent)' : 'transparent',
          color: value.trim() && !loading ? 'var(--accent-tx-on)' : 'var(--tx-3)',
          border: 'none',
          borderRadius: '7px',
          padding: '6px 12px',
          fontFamily: "'DM Mono', monospace",
          fontSize: '11px',
          letterSpacing: '0.04em',
          cursor: value.trim() && !loading ? 'pointer' : 'default',
        }}
      >
        {loading ? '···' : 'ASK'}
      </button>
    </div>
  )
}

export default function CommandBar({ mobile, loading, onSubmit, placeholder, accessory }) {
  const [input, setInput] = useState('')
  const [sheetOpen, setSheetOpen] = useState(false)
  const ph = placeholder || 'Ask anything about your finances…'

  function submit() {
    const trimmed = input.trim()
    if (!trimmed || loading) return
    onSubmit(trimmed)
    setInput('')
    setSheetOpen(false)
  }

  // ── Desktop: persistent bottom bar ──
  if (!mobile) {
    return (
      <div style={{
        flexShrink: 0,
        borderTop: '1px solid var(--bd)',
        background: 'var(--bg-card)',
        padding: '12px 28px',
      }}>
        <div style={{ maxWidth: '960px', margin: '0 auto', display: 'flex', alignItems: 'stretch', gap: '10px' }}>
          {accessory}
          <div style={{ flex: 1, minWidth: 0 }}>
            <Field
              value={input}
              onChange={setInput}
              onSubmit={submit}
              loading={loading}
              placeholder={ph}
            />
          </div>
        </div>
      </div>
    )
  }

  // ── Mobile: FAB + bottom sheet ──
  return (
    <>
      {!sheetOpen && (
        <button
          onClick={() => setSheetOpen(true)}
          style={{
            position: 'fixed',
            right: '18px',
            bottom: '18px',
            zIndex: 40,
            width: '54px',
            height: '54px',
            borderRadius: '50%',
            border: 'none',
            background: 'var(--accent)',
            color: 'var(--accent-tx-on)',
            fontSize: '22px',
            boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
            cursor: 'pointer',
          }}
        >
          ✦
        </button>
      )}

      {sheetOpen && (
        <div
          onClick={() => setSheetOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'flex-end',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%',
              background: 'var(--bg-card)',
              borderTop: '1px solid var(--bd)',
              borderRadius: '16px 16px 0 0',
              padding: '16px 16px 22px',
            }}
          >
            <div style={{
              width: '36px',
              height: '4px',
              borderRadius: '2px',
              background: 'var(--bd)',
              margin: '0 auto 16px',
            }} />
            {accessory && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                {accessory}
              </div>
            )}
            <Field
              value={input}
              onChange={setInput}
              onSubmit={submit}
              loading={loading}
              placeholder={ph}
              autoFocus
            />
          </div>
        </div>
      )}
    </>
  )
}

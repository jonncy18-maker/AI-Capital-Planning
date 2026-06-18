import { useState } from 'react'
import { syncMonarchTransactions } from '../../lib/integrations/monarch.js'

// Monarch Money connection card. Monarch has no official API, so this drives the
// unofficial server-side sync (monarch-sync Edge Function). On success it hands
// the pulled rows to the same CSV import pipeline a manual upload uses, via the
// `onImport(csv, name)` callback. The CSV export stays the reliable fallback.

const field = {
  width: '100%', background: 'var(--field)', border: '1px solid var(--bd)',
  borderRadius: 8, padding: '9px 11px', color: 'var(--tx-1)', fontSize: 13,
  outline: 'none', fontFamily: 'Inter, sans-serif',
}
const label = {
  fontFamily: "'DM Mono', monospace", fontSize: 9.5, letterSpacing: '0.06em',
  color: 'var(--tx-3)', textTransform: 'uppercase', marginBottom: 6, display: 'block',
}

export default function MonarchConnect({ onImport }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // { kind: 'ok'|'error'|'gated', text }

  async function connect() {
    setBusy(true)
    setResult(null)
    try {
      const res = await syncMonarchTransactions({ email, password, mfaCode })
      if (res.status === 'ok') {
        if (!res.count) {
          setResult({ kind: 'error', text: 'Connected, but Monarch returned no transactions.' })
          return
        }
        // Reuse the existing CSV import pipeline (parse → map → dedup).
        onImport?.(res.csv, 'Monarch sync')
        setResult({ kind: 'ok', text: `Pulled ${res.count.toLocaleString()} transactions — opening import…` })
        setPassword('')
        setMfaCode('')
      } else {
        setResult({ kind: res.status === 'gated' ? 'gated' : 'error', text: res.message })
      }
    } catch (e) {
      setResult({ kind: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const tone = result?.kind === 'ok' ? 'var(--accent)' : 'var(--warn)'

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 9, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, color: 'var(--accent)',
            background: 'var(--accent-bg)', border: '1px solid var(--accent-bd)',
          }}>◆</div>
          <div>
            <div style={{ fontSize: 13.5, color: 'var(--tx-1)', fontWeight: 500 }}>Monarch Money</div>
            <div style={{ fontSize: 11.5, color: 'var(--tx-3)' }}>Direct sync · unofficial API</div>
          </div>
        </div>
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            border: '1px solid var(--bd)', background: 'transparent', color: 'var(--tx-2)',
            borderRadius: 8, padding: '7px 14px', fontSize: 12.5, cursor: 'pointer',
          }}
        >
          {open ? 'Close' : 'Connect'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 12.5, color: 'var(--tx-2)', lineHeight: 1.6 }}>
            Monarch has no official API. This connects through Monarch's private
            endpoint server-side (the same approach community connectors use). Your
            credentials are used once to pull transactions and are never stored. If
            this isn't set up yet, use the CSV export below.
          </div>

          <div>
            <span style={label}>Monarch email</span>
            <input style={field} type="email" value={email} autoComplete="off"
              onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <div>
            <span style={label}>Password</span>
            <input style={field} type="password" value={password} autoComplete="off"
              onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          <div>
            <span style={label}>Multi-factor code (if enabled)</span>
            <input style={field} type="text" value={mfaCode} inputMode="numeric"
              onChange={e => setMfaCode(e.target.value)} placeholder="123456" />
          </div>

          {result && (
            <div style={{
              fontSize: 12.5, lineHeight: 1.55, color: 'var(--tx-1)',
              border: `1px solid ${tone}`, background: result.kind === 'ok' ? 'var(--accent-bg)' : 'var(--warn-bg)',
              borderRadius: 8, padding: '10px 12px',
            }}>
              {result.text}
            </div>
          )}

          <button
            onClick={connect}
            disabled={busy || !email || !password}
            style={{
              alignSelf: 'flex-start',
              background: 'var(--accent)', color: 'var(--accent-tx-on)', border: 'none',
              borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600,
              cursor: busy || !email || !password ? 'not-allowed' : 'pointer',
              opacity: busy || !email || !password ? 0.6 : 1,
            }}
          >
            {busy ? 'Connecting…' : 'Connect & Sync'}
          </button>
        </div>
      )}
    </div>
  )
}

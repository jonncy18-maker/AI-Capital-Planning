import { useState } from 'react'
import { authClient } from '../../lib/neon/authClient.js'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState(null) // { type: 'error'|'info', text }

  // Coerce any error shape (Error, Neon Auth/Better Auth error, plain object,
  // string) into displayable text. Error subclasses keep message/status/code
  // on non-enumerable props, so JSON.stringify alone yields "{}" — pull the
  // known fields explicitly so the box is never blank/uninformative.
  function readableError(err) {
    if (!err) return ''
    if (typeof err === 'string') return err

    const parts = []
    if (err.message) parts.push(err.message)
    if (err.error_description && err.error_description !== err.message) parts.push(err.error_description)
    if (err.status) parts.push(`status ${err.status}`)
    if (err.code && err.code !== err.status) parts.push(`code ${err.code}`)
    if (!parts.length && err.name) parts.push(err.name)
    if (parts.length) return parts.join(' · ')

    try {
      const own = Object.getOwnPropertyNames(err).reduce((o, k) => { o[k] = err[k]; return o }, {})
      const s = JSON.stringify(own)
      return s && s !== '{}' ? s : String(err)
    } catch {
      return String(err)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    let result
    try {
      result = mode === 'signup'
        ? await authClient.signUp.email({ email, password, name: name || email.split('@')[0] })
        : await authClient.signIn.email({ email, password })
    } catch (err) {
      // Network/CORS/thrown errors never reach the { error } shape below.
      console.error('[auth] threw:', err)
      setLoading(false)
      setMessage({ type: 'error', text: readableError(err) || 'Request failed — check the console.' })
      return
    }

    const { error } = result
    setLoading(false)

    if (error) {
      console.error('[auth] error:', error)
      setMessage({ type: 'error', text: readableError(error) })
      return
    }

    // Neon Auth's default config has no email-confirmation step (confirmed
    // during the pilot) — a successful sign-up returns a session cookie
    // immediately, same as sign-in. useAuth's useSession() picks it up via
    // its own subscription, so there's nothing further to do here.
  }

  const field = {
    width: '100%',
    padding: '12px 14px',
    borderRadius: '8px',
    border: '1px solid var(--bd, #2d3148)',
    background: 'var(--bg-card, #1e2130)',
    color: 'var(--tx-1, #e2e8f0)',
    fontFamily: 'Inter, sans-serif',
    fontSize: '14px',
    outline: 'none',
    boxSizing: 'border-box',
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg, #141624)',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '380px',
        padding: '0 24px',
      }}>
        <div style={{
          fontFamily: "'DM Serif Display', serif",
          fontSize: '26px',
          color: 'var(--tx-1, #e2e8f0)',
          marginBottom: '6px',
          letterSpacing: '-0.01em',
        }}>
          AI Capital Planning
        </div>
        <div style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: '11px',
          color: 'var(--tx-3, #475569)',
          letterSpacing: '0.06em',
          marginBottom: '32px',
        }}>
          {mode === 'signin' ? '// SIGN IN' : '// CREATE ACCOUNT'}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {mode === 'signup' && (
            <input
              type="text"
              placeholder="Name"
              value={name}
              onChange={e => setName(e.target.value)}
              style={field}
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            style={field}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={6}
            style={field}
          />

          {message && (
            <div style={{
              padding: '10px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              fontFamily: 'Inter, sans-serif',
              background: message.type === 'error' ? 'rgba(239,68,68,0.1)' : 'rgba(0,194,168,0.08)',
              color: message.type === 'error' ? '#f87171' : 'var(--accent, #00C2A8)',
              border: `1px solid ${message.type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(0,194,168,0.2)'}`,
            }}>
              {message.text}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '13px',
              borderRadius: '8px',
              border: 'none',
              background: 'var(--accent, #00C2A8)',
              color: '#fff',
              fontFamily: 'Inter, sans-serif',
              fontSize: '14px',
              fontWeight: 500,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              marginTop: '4px',
            }}
          >
            {loading ? '…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div style={{
          marginTop: '20px',
          fontSize: '13px',
          color: 'var(--tx-3, #475569)',
          fontFamily: 'Inter, sans-serif',
          textAlign: 'center',
        }}>
          {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
          <span
            onClick={() => { setMode(m => m === 'signin' ? 'signup' : 'signin'); setMessage(null) }}
            style={{ color: 'var(--accent, #00C2A8)', cursor: 'pointer' }}
          >
            {mode === 'signin' ? 'Create one' : 'Sign in'}
          </span>
        </div>
      </div>
    </div>
  )
}

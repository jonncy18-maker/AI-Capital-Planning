import { useState } from 'react'
import { supabase } from '../../lib/supabase.js'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState(null) // { type: 'error'|'info', text }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    const fn = mode === 'signup'
      ? supabase.auth.signUp({ email, password })
      : supabase.auth.signInWithPassword({ email, password })

    const { error } = await fn
    setLoading(false)

    if (error) {
      setMessage({ type: 'error', text: error.message })
    } else if (mode === 'signup') {
      setMessage({ type: 'info', text: 'Check your email to confirm your account.' })
    }
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

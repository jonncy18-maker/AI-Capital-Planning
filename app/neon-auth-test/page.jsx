'use client'

import { useState } from 'react'
import { authClient } from '../../src/lib/neon/authClient.js'

// Throwaway diagnostic page for the Neon + Neon Auth pilot. Intentionally
// NOT linked from src/modules/registry.js, the Sidebar, or anywhere else —
// reachable only by typing the URL directly. Exercises the official
// @neondatabase/auth SDK (cookie-based sessions, no manual token handling)
// and the pilot /api/commitments routes end to end.
// Delete this directory once the pilot is validated or abandoned.

const COMMITMENT_TYPES = ['scholarship', 'family_support', 'lease', 'eldercare', 'other']

function resultOrError(result, setResult, setError) {
  if (result?.error) {
    setError(result.error.message || JSON.stringify(result.error))
    setResult(null)
    return
  }
  setError(null)
  setResult(result?.data ?? result)
}

export default function NeonAuthTestPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [authResult, setAuthResult] = useState(null)
  const [authError, setAuthError] = useState(null)

  const [sessionResult, setSessionResult] = useState(null)
  const [sessionError, setSessionError] = useState(null)

  const [commitmentForm, setCommitmentForm] = useState({
    name: '',
    type: 'other',
    start_date: '',
    end_date: '',
    notes: '',
  })
  const [commitments, setCommitments] = useState(null)
  const [apiError, setApiError] = useState(null)
  const [apiBusy, setApiBusy] = useState(false)

  async function handleSignUp() {
    try {
      const result = await authClient.signUp.email({ email, password, name })
      resultOrError(result, setAuthResult, setAuthError)
    } catch (err) {
      setAuthError(String(err))
      setAuthResult(null)
    }
  }

  async function handleSignIn() {
    try {
      const result = await authClient.signIn.email({ email, password })
      resultOrError(result, setAuthResult, setAuthError)
    } catch (err) {
      setAuthError(String(err))
      setAuthResult(null)
    }
  }

  async function handleGetSession() {
    try {
      const result = await authClient.getSession()
      resultOrError(result, setSessionResult, setSessionError)
    } catch (err) {
      setSessionError(String(err))
      setSessionResult(null)
    }
  }

  async function listCommitments() {
    setApiError(null)
    setApiBusy(true)
    try {
      // No Authorization header needed — the session cookie set by
      // sign-up/sign-in auto-attaches via credentials: 'include'.
      const res = await fetch('/api/commitments?status=', {
        credentials: 'include',
      })
      const body = await res.json()
      if (!res.ok) {
        setApiError(`${res.status}: ${JSON.stringify(body)}`)
        setCommitments(null)
        return
      }
      setCommitments(body)
    } catch (err) {
      setApiError(String(err))
    } finally {
      setApiBusy(false)
    }
  }

  async function createCommitment(e) {
    e.preventDefault()
    setApiError(null)
    setApiBusy(true)
    try {
      const res = await fetch('/api/commitments', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: commitmentForm.name,
          type: commitmentForm.type,
          start_date: commitmentForm.start_date,
          end_date: commitmentForm.end_date || null,
          notes: commitmentForm.notes || null,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setApiError(`${res.status}: ${JSON.stringify(body)}`)
        return
      }
      setCommitmentForm({ name: '', type: 'other', start_date: '', end_date: '', notes: '' })
      await listCommitments()
    } catch (err) {
      setApiError(String(err))
    } finally {
      setApiBusy(false)
    }
  }

  async function deleteCommitment(id) {
    setApiError(null)
    setApiBusy(true)
    try {
      const res = await fetch(`/api/commitments/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.status !== 204) {
        const body = await res.json().catch(() => null)
        setApiError(`${res.status}: ${JSON.stringify(body)}`)
        return
      }
      await listCommitments()
    } catch (err) {
      setApiError(String(err))
    } finally {
      setApiBusy(false)
    }
  }

  return (
    <div style={{ fontFamily: 'monospace', padding: 24, maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: 18 }}>Neon Auth + Commitments pilot test harness</h1>
      <p style={{ fontSize: 12, color: '#666' }}>
        Throwaway diagnostic page. Not linked from app navigation. Uses @neondatabase/auth
        (cookie-based sessions) — no manual token capture required.
      </p>

      <section style={{ border: '1px solid #ccc', padding: 16, marginTop: 16 }}>
        <h2 style={{ fontSize: 14 }}>1. Sign up / Sign in</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320 }}>
          <input placeholder="name (sign-up only)" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input
            placeholder="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleSignUp}>Sign Up</button>
            <button onClick={handleSignIn}>Sign In</button>
          </div>
        </div>

        {authError && <pre style={{ color: 'crimson', whiteSpace: 'pre-wrap' }}>{authError}</pre>}
        {authResult && (
          <div style={{ marginTop: 8 }}>
            <div>Auth response:</div>
            <pre style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 8 }}>
              {JSON.stringify(authResult, null, 2)}
            </pre>
          </div>
        )}
      </section>

      <section style={{ border: '1px solid #ccc', padding: 16, marginTop: 16 }}>
        <h2 style={{ fontSize: 14 }}>2. Get Session (cookie-based, no token needed)</h2>
        <button onClick={handleGetSession}>Get Session</button>
        {sessionError && <pre style={{ color: 'crimson', whiteSpace: 'pre-wrap' }}>{sessionError}</pre>}
        {sessionResult && (
          <pre style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 8, marginTop: 8 }}>
            {JSON.stringify(sessionResult, null, 2)}
          </pre>
        )}
      </section>

      <section style={{ border: '1px solid #ccc', padding: 16, marginTop: 16 }}>
        <h2 style={{ fontSize: 14 }}>3. Create a commitment</h2>
        <form onSubmit={createCommitment} style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320 }}>
          <input
            placeholder="name"
            value={commitmentForm.name}
            onChange={(e) => setCommitmentForm({ ...commitmentForm, name: e.target.value })}
            required
          />
          <select
            value={commitmentForm.type}
            onChange={(e) => setCommitmentForm({ ...commitmentForm, type: e.target.value })}
          >
            {COMMITMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <label>
            start date
            <input
              type="date"
              value={commitmentForm.start_date}
              onChange={(e) => setCommitmentForm({ ...commitmentForm, start_date: e.target.value })}
              required
            />
          </label>
          <label>
            end date (optional)
            <input
              type="date"
              value={commitmentForm.end_date}
              onChange={(e) => setCommitmentForm({ ...commitmentForm, end_date: e.target.value })}
            />
          </label>
          <input
            placeholder="notes (optional)"
            value={commitmentForm.notes}
            onChange={(e) => setCommitmentForm({ ...commitmentForm, notes: e.target.value })}
          />
          <button type="submit" disabled={apiBusy}>
            Create
          </button>
        </form>
      </section>

      <section style={{ border: '1px solid #ccc', padding: 16, marginTop: 16 }}>
        <h2 style={{ fontSize: 14 }}>4. List commitments</h2>
        <button onClick={listCommitments} disabled={apiBusy}>
          List Commitments
        </button>

        {apiError && <pre style={{ color: 'crimson', whiteSpace: 'pre-wrap' }}>{apiError}</pre>}

        {commitments && (
          <ul>
            {commitments.map((c) => (
              <li key={c.id} style={{ marginBottom: 4 }}>
                {c.name} — {c.type} — {c.start_date} — {c.status}{' '}
                <button onClick={() => deleteCommitment(c.id)}>Delete</button>
              </li>
            ))}
            {commitments.length === 0 && <li>(none)</li>}
          </ul>
        )}
      </section>
    </div>
  )
}

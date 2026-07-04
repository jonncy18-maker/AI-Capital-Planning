'use client'

import { useState } from 'react'

// Throwaway diagnostic page for the Neon + Neon Auth pilot. Intentionally
// NOT linked from src/modules/registry.js, the Sidebar, or anywhere else —
// reachable only by typing the URL directly. Exercises Better Auth's
// email/password endpoints and the pilot /api/commitments routes end to end.
// Delete this directory once the pilot is validated or abandoned.

const AUTH_BASE_URL =
  'https://ep-royal-smoke-ajjxuq8k.neonauth.c-3.us-east-2.aws.neon.tech/neondb/auth'

const COMMITMENT_TYPES = ['scholarship', 'family_support', 'lease', 'eldercare', 'other']

export default function NeonAuthTestPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [authResult, setAuthResult] = useState(null)
  const [authError, setAuthError] = useState(null)
  const [token, setToken] = useState('')

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

  async function callAuth(path) {
    setAuthError(null)
    setAuthResult(null)
    try {
      const res = await fetch(`${AUTH_BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // retain any session cookie Better Auth sets
        body: JSON.stringify(path.includes('sign-up') ? { email, password, name } : { email, password }),
      })

      const text = await res.text()
      let body
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }

      if (!res.ok) {
        setAuthError(`${res.status} ${res.statusText}: ${JSON.stringify(body)}`)
        return
      }

      setAuthResult(body)

      // Confirmed empirically + against Neon's docs: sign-up/sign-in's own
      // response `token` field is an opaque session token, NOT a JWT (fails
      // JWKS verification with "Invalid Compact JWS"). The actual JWT must be
      // fetched separately from GET {base_url}/token, authenticated via the
      // session cookie sign-up/sign-in just set (credentials: 'include').
      await fetchJwt()
    } catch (err) {
      setAuthError(String(err))
    }
  }

  async function fetchJwt() {
    try {
      const res = await fetch(`${AUTH_BASE_URL}/token`, {
        credentials: 'include', // uses the session cookie set by sign-up/sign-in
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setAuthError(`Token fetch failed: ${res.status} ${JSON.stringify(body)}`)
        return
      }
      const jwt = body?.token || body?.data?.token || ''
      if (jwt) setToken(jwt)
      else setAuthError(`Token fetch succeeded but no token in response: ${JSON.stringify(body)}`)
    } catch (err) {
      setAuthError(`Token fetch error: ${String(err)}`)
    }
  }

  async function listCommitments() {
    setApiError(null)
    setApiBusy(true)
    try {
      const res = await fetch('/api/commitments?status=', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include', // in case Better Auth uses a session cookie instead of a bearer token
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
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
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
        headers: token ? { Authorization: `Bearer ${token}` } : {},
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
        Throwaway diagnostic page. Not linked from app navigation.
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
            <button onClick={() => callAuth('/sign-up/email')}>Sign Up</button>
            <button onClick={() => callAuth('/sign-in/email')}>Sign In</button>
            <button onClick={fetchJwt}>Fetch JWT (retry)</button>
          </div>
        </div>

        {authError && <pre style={{ color: 'crimson', whiteSpace: 'pre-wrap' }}>{authError}</pre>}
        {authResult && (
          <div style={{ marginTop: 8 }}>
            <div>Auth response:</div>
            <pre style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 8 }}>
              {JSON.stringify(authResult, null, 2)}
            </pre>
            <div>
              Captured token (from JSON body, if any): <br />
              <input
                style={{ width: '100%' }}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="paste/edit bearer token manually if needed"
              />
            </div>
          </div>
        )}
      </section>

      <section style={{ border: '1px solid #ccc', padding: 16, marginTop: 16 }}>
        <h2 style={{ fontSize: 14 }}>2. Create a commitment</h2>
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
        <h2 style={{ fontSize: 14 }}>3. List commitments</h2>
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

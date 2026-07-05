// Neon-backed client seam for ai_preferences, fronting app/api/ai-preferences/route.js
// (Neon Auth session cookie via credentials: 'include' — no token handling).
// `userId` params are kept for signature compatibility with existing callers
// (contextLoader.js, AIPersonalization.jsx) even though the route derives the
// real identity from the session itself.
//
// A missing row means the user has never personalized — the AI uses its
// neutral defaults. We default to an empty object (and swallow errors) so the
// UI keeps working even if the request fails.

const EMPTY = { preferences: {}, interview: null, grill_enabled: false }

export async function getAIPreferences(_userId) {
  try {
    const res = await fetch('/api/ai-preferences', { credentials: 'include' })
    if (!res.ok) return { ...EMPTY }
    const data = await res.json().catch(() => null)
    if (!data) return { ...EMPTY }
    return {
      preferences: data.preferences ?? {},
      interview: data.interview ?? null,
      grill_enabled: !!data.grill_enabled,
    }
  } catch {
    return { ...EMPTY }
  }
}

export async function saveAIPreferences(_userId, { preferences, interview, grill_enabled }) {
  const body = {}
  if (preferences !== undefined) body.preferences = preferences
  if (interview !== undefined) body.interview = interview
  if (grill_enabled !== undefined) body.grill_enabled = grill_enabled

  const res = await fetch('/api/ai-preferences', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    throw new Error(errBody?.error || `Request failed (${res.status})`)
  }
}

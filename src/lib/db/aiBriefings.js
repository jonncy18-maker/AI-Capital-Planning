// Neon-backed client seam for ai_briefings, fronting app/api/ai-briefings/route.js
// (Neon Auth session cookie via credentials: 'include' — no token handling).
// `userId` params are kept for signature compatibility with existing callers
// even though the route derives the real identity from the session itself.

async function parseJsonOrThrow(res) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return body
}

// Most recent cached briefing for a module context (or dashboard overview).
export async function getLatestBriefing(_userId, moduleContext = 'dashboard') {
  const params = new URLSearchParams({ module_context: moduleContext })
  const res = await fetch(`/api/ai-briefings?${params.toString()}`, { credentials: 'include' })
  return parseJsonOrThrow(res)
}

export async function saveBriefing(_userId, { narrative, context_summary, module_context = 'dashboard' }) {
  const res = await fetch('/api/ai-briefings', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ narrative, context_summary: context_summary ?? null, module_context }),
  })
  return parseJsonOrThrow(res)
}

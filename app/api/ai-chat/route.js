import { auth } from '../../../src/lib/neon/authServer.js'

// Next.js port of supabase/functions/ai-chat (Deno edge function). Server-side
// proxy to the Anthropic API — the ANTHROPIC_API_KEY secret lives only in this
// route's server environment, never shipped to the browser. Set a FRESH key
// as a Vercel env var; do not reuse the Supabase function's secret.
//
// The Supabase version relied on the platform gateway to verify the caller's
// JWT before invocation ("Supabase verifies the JWT at the gateway"). Neon
// Auth has no equivalent gateway, so this route does the same check itself,
// matching every other route in this migration.
//
// Invoked from src/lib/ai/sendMessage.js#invokeAIChat. Request/response shape
// is unchanged from the Supabase version so the client needs no changes when
// it's later switched over: { messages, system, maxTokens, model, modelFamily,
// cacheSystem, tools } in, { text, content, stop_reason } (or { error }) out.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const MODEL_FALLBACKS = {
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-4-6',
}
const DEFAULT_FAMILY = 'sonnet'
const RESOLVE_TTL_MS = 6 * 60 * 60 * 1000

// Module-level cache persists across invocations only within a warm
// serverless instance (same caveat as the original Deno deployment).
const modelCache = {}

async function resolveModel(family) {
  const fam = MODEL_FALLBACKS[family] ? family : DEFAULT_FAMILY

  const cached = modelCache[fam]
  if (cached && Date.now() - cached.at < RESOLVE_TTL_MS) return cached.id

  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
    })
    if (res.ok) {
      const { data } = await res.json()
      const newest = (data ?? [])
        .filter(m => typeof m.id === 'string' && m.id.includes(fam))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
      if (newest?.id) {
        modelCache[fam] = { id: newest.id, at: Date.now() }
        return newest.id
      }
    }
  } catch {
    // fall through to the pinned fallback (not cached, so we retry next call)
  }
  return MODEL_FALLBACKS[fam]
}

export async function POST(request) {
  const { data: session } = await auth.getSession()
  if (!session?.user?.id) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }

  if (!ANTHROPIC_API_KEY) {
    return Response.json({ error: 'ANTHROPIC_API_KEY is not configured on this deployment.' }, { status: 500 })
  }

  let payload
  try {
    payload = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const { messages, system, maxTokens, model, modelFamily, cacheSystem, tools } = payload || {}
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: 'messages[] is required.' }, { status: 400 })
  }

  const resolvedModel = model ?? (await resolveModel(modelFamily ?? DEFAULT_FAMILY))

  const systemParam = system
    ? cacheSystem
      ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
      : system
    : undefined

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: resolvedModel,
        max_tokens: maxTokens ?? 1024,
        system: systemParam,
        messages,
        ...(Array.isArray(tools) && tools.length ? { tools } : {}),
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return Response.json(
        { error: err?.error?.message || `Anthropic API error: ${res.status}` },
        { status: res.status }
      )
    }

    const data = await res.json()
    const content = Array.isArray(data?.content) ? data.content : []
    const text = content
      .filter(b => b?.type === 'text')
      .map(b => b.text ?? '')
      .join('\n')
      .trim()
    return Response.json({ text, content, stop_reason: data?.stop_reason ?? 'end_turn' })
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}

// Supabase Edge Function: ai-chat
// Server-side proxy to the Anthropic API. The ANTHROPIC_API_KEY secret lives
// only in the Supabase function environment — it is never shipped to the browser.
//
// Deploy:
//   supabase functions deploy ai-chat
// Set the secret (name must match Deno.env.get below):
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// Invoked from the app via supabase.functions.invoke('ai-chat', { body }),
// which automatically attaches the signed-in user's JWT. Supabase verifies the
// JWT at the gateway, so only authenticated users can reach this function.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')

// Pinned fallbacks — used only if the Models API can't be reached. The client
// sends a model *family* ('haiku' | 'sonnet'); resolveModel() floats each family
// to its newest available model so new releases are adopted without a code edit.
const MODEL_FALLBACKS: Record<string, string> = {
  haiku: 'claude-haiku-4-5',   // group mapping / classification
  sonnet: 'claude-sonnet-4-6', // command bar / AI briefing
}
const DEFAULT_FAMILY = 'sonnet'
const RESOLVE_TTL_MS = 6 * 60 * 60 * 1000 // re-check family → newest every 6h

// Module-level cache persists across invocations in a warm function instance,
// so the Models API is hit at most once per family per ~6h per instance.
const modelCache: Record<string, { id: string; at: number }> = {}

async function resolveModel(family: string): Promise<string> {
  const fam = MODEL_FALLBACKS[family] ? family : DEFAULT_FAMILY

  const cached = modelCache[fam]
  if (cached && Date.now() - cached.at < RESOLVE_TTL_MS) return cached.id

  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: {
        'x-api-key': ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
    })
    if (res.ok) {
      const { data } = await res.json()
      const newest = (data ?? [])
        .filter((m: { id?: string }) => typeof m.id === 'string' && m.id.includes(fam))
        .sort(
          (a: { created_at: string }, b: { created_at: string }) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )[0]
      if (newest?.id) {
        modelCache[fam] = { id: newest.id, at: Date.now() } // cache only on success
        return newest.id
      }
    }
  } catch {
    // fall through to the pinned fallback (not cached, so we retry next call)
  }
  return MODEL_FALLBACKS[fam]
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  if (!ANTHROPIC_API_KEY) {
    return json({ error: 'ANTHROPIC_API_KEY secret is not configured on this function.' }, 500)
  }

  let payload: {
    messages?: unknown
    system?: string
    maxTokens?: number
    model?: string
    modelFamily?: string
    cacheSystem?: boolean
  }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400)
  }

  const { messages, system, maxTokens, model, modelFamily, cacheSystem } = payload
  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: 'messages[] is required.' }, 400)
  }

  // An explicit model wins; otherwise resolve the requested family to its newest.
  const resolvedModel = model ?? (await resolveModel(modelFamily ?? DEFAULT_FAMILY))

  // Cache the system prompt when the caller reuses it across requests in a
  // session (e.g. the command bar reuses the same financial context brief).
  // Prompt caching is GA — no beta header needed. Reads cost ~0.1x.
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
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return json({ error: err?.error?.message || `Anthropic API error: ${res.status}` }, res.status)
    }

    const data = await res.json()
    const text = data?.content?.[0]?.text ?? ''
    return json({ text })
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})

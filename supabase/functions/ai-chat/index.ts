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
const MODEL = 'claude-sonnet-4-6'

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

  let payload: { messages?: unknown; system?: string; maxTokens?: number }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400)
  }

  const { messages, system, maxTokens } = payload
  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: 'messages[] is required.' }, 400)
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens ?? 1024,
        system: system || undefined,
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

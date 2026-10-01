/* global process */
// Server-only: imported by app/api/ai-chat/route.js, never by client code.
//
// Opt-in GPT-6 Luna path for the text-only Haiku-class tasks named in
// AI_TASKS (models.js). Everything stays on Anthropic until a task is listed in
// AI_LUNA_TASKS (comma list, or `all`) AND OPENAI_API_KEY is set;
// AI_FORCE_ANTHROPIC=1 overrides both. Env-driven so a Vercel Preview can try
// Luna while Production stays put. The model ID is an API argument, so it stays
// pinned to an exact ID (CLAUDE.md-style "IDs in code, families in prose").
import { AI_TASKS } from './models.js'

export const LUNA_MODEL = 'gpt-6-luna'

const LUNA_TASKS = Object.values(AI_TASKS)
const OPENAI_URL = 'https://api.openai.com/v1/responses'
// Reasoning tokens count against max_output_tokens, so a tight cap can be spent
// entirely on thinking and return nothing. Headroom is added to the caller's cap.
const REASONING_HEADROOM = 600
const TIMEOUT_MS = 25000

export function lunaEnabledFor(task, env = process.env) {
  if (!LUNA_TASKS.includes(task)) return false
  if (env.AI_FORCE_ANTHROPIC === '1' || !env.OPENAI_API_KEY) return false
  const flipped = (env.AI_LUNA_TASKS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  return flipped.includes('all') || flipped.includes(task)
}

// Luna takes plain text only here: tool calls and image/document blocks stay on
// Anthropic. Returns null when the request isn't plain text, so the caller falls
// through to the Anthropic path.
export function toLunaInput(messages) {
  const input = []
  for (const m of messages) {
    if (m?.role !== 'user' && m?.role !== 'assistant') return null
    let content = m.content
    if (Array.isArray(content)) {
      if (!content.every(b => b?.type === 'text')) return null
      content = content.map(b => b.text ?? '').join('\n')
    }
    if (typeof content !== 'string') return null
    input.push({ role: m.role, content })
  }
  return input
}

// Returns the reply text, or throws (HTTP error, truncation, empty reply) so the
// route can fall back to Anthropic for that call.
export async function callLuna({ system, input, maxTokens }) {
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({
      model: LUNA_MODEL,
      ...(system ? { instructions: system } : {}),
      input,
      max_output_tokens: (maxTokens ?? 1024) + REASONING_HEADROOM,
      reasoning: { effort: 'low' },
      store: false,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`OpenAI ${res.status}: ${err?.error?.message || res.statusText}`)
  }
  const data = await res.json()
  if (data.status === 'incomplete') {
    throw new Error(`OpenAI response incomplete (${data.incomplete_details?.reason || 'unknown'})`)
  }
  const text = (data.output || [])
    .filter(item => item.type === 'message')
    .flatMap(item => item.content || [])
    .filter(part => part.type === 'output_text')
    .map(part => part.text)
    .join('')
    .trim()
  if (!text) throw new Error('OpenAI returned no text')
  return text
}

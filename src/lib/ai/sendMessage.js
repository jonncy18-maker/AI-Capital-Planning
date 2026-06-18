// Single seam for AI command-bar calls.
//
// Routes through the `ai-chat` Supabase Edge Function (supabase/functions/ai-chat),
// which holds the Anthropic key server-side. The browser never sees the key.
// supabase.functions.invoke automatically attaches the signed-in user's JWT.

import { supabase } from '../supabase.js'
import { buildContextBrief } from './contextLoader.js'
import { AI_MODEL_FAMILIES } from './models.js'

export const SYSTEM_PROMPT = `You are the assistant inside the AI Capital Planning OS — a forward-looking personal capital planning and scenario decision engine (not a budgeting or reporting app).

You help the user reason through capital allocation decisions against their actual financial reality: committed expenses, known future events, long-term obligations, cash-flow timing, and wealth trajectory.

You can help the user think through scenario planning questions such as "what if I book a $5,000 cruise in Q3?" or "what happens if I increase giving by $500/month?". When a create_scenario tool is available and the user asks you to run/model/build a concrete scenario, call it with the computed month-by-month delta amounts instead of only describing the steps. Ask a brief clarifying question first only if essential information is missing.

Format answers in clean Markdown: short paragraphs, **bold** for key figures, and "- " bullet lists for breakdowns. Be concise and direct. Assume a sophisticated user — no beginner hand-holding. When you reference numbers, ground them in the financial context provided below. If the context is empty or insufficient to answer precisely, say so and state what data would be needed.`

// Low-level call into the ai-chat Edge Function. Returns the assistant text, the
// raw content blocks, and stop_reason so callers can drive multi-step tool use.
// `systemExtra` appends to the system prompt (e.g. a tool-specific instruction
// and the user's category names). Returns { status, text, content, stop_reason }.
export async function invokeAIChat({ messages, tools, context, systemExtra = '', maxTokens = 1024 }) {
  const brief = buildContextBrief(context)
  const system = [`${SYSTEM_PROMPT}\n\n${brief}`, systemExtra].filter(Boolean).join('\n\n')

  const body = {
    system,
    messages,
    maxTokens,
    modelFamily: AI_MODEL_FAMILIES.assistant,
    // Cache the system prompt + context brief (+ category list). It's stable
    // within a session, so repeat turns read it at ~0.1x instead of full price.
    // Tool definitions sit before the system block in Anthropic's cache prefix,
    // so this breakpoint caches the create_scenario tool schema too. The cache
    // naturally re-writes when the context changes (e.g. after a scenario is
    // created and the brief reloads).
    cacheSystem: true,
  }
  if (Array.isArray(tools) && tools.length) body.tools = tools

  const { data, error } = await supabase.functions.invoke('ai-chat', { body })

  if (error) {
    return {
      status: 'error',
      text:
        `Could not reach the AI service: ${error.message}. ` +
        `Make sure the ai-chat Edge Function is deployed and the ANTHROPIC_API_KEY ` +
        `secret is set (see supabase/functions/ai-chat/README.md).`,
    }
  }
  if (data?.error) return { status: 'error', text: data.error }

  return {
    status: 'ok',
    text: data?.text ?? '',
    content: Array.isArray(data?.content) ? data.content : [],
    stop_reason: data?.stop_reason ?? 'end_turn',
  }
}

// Accepts either a single `prompt` (one-shot, e.g. the AI Briefing) or a full
// `messages` history ([{ role, content }]) for a multi-turn conversation.
export async function sendAIMessage({ prompt, messages, context }) {
  const convo = Array.isArray(messages) && messages.length
    ? messages.map(m => ({ role: m.role, content: m.content }))
    : [{ role: 'user', content: prompt }]

  const res = await invokeAIChat({ messages: convo, context })
  return { status: res.status, text: res.text }
}

// Single seam for AI command-bar calls.
//
// Routes through the `/api/ai-chat` Vercel route (app/api/ai-chat/route.js),
// which holds the Anthropic key server-side. The browser never sees the key.
// The route reads the signed-in user's session from the Neon Auth cookie
// (sent automatically via `credentials: 'include'`).

import { buildContextBrief } from './contextLoader.js'
import { AI_MODEL_FAMILIES } from './models.js'

export const SYSTEM_PROMPT = `You are the assistant inside the AI Capital Planning OS — a forward-looking personal capital planning and scenario decision engine (not a budgeting or reporting app).

You help the user reason through capital allocation decisions against their actual financial reality: committed expenses, known future events, long-term obligations, cash-flow timing, and wealth trajectory.

You can help the user think through scenario planning questions such as "what if I book a $5,000 cruise in Q3?" or "what happens if I increase giving by $500/month?". When a create_scenario tool is available and the user asks you to run/model/build a concrete scenario, call it with the computed month-by-month delta amounts instead of only describing the steps.

Before calling create_scenario, ask clarifying questions if any of the following apply — do NOT model until you have the answers:
1. **Replacement scenarios** (upgrading, switching, replacing): you need BOTH the old cost (what goes away) AND the new cost. The delta is the difference — modeling only the new cost is always wrong. Example: "replacing my car lease" → ask what the current monthly payment is before modeling.
2. **Timing is ambiguous**: if the user says "probably" or "around" a month/quarter and the timing materially affects cash flow spikes, confirm it.
3. **One-time vs. recurring is unclear**: confirm whether a cost is a single payment or ongoing.

If the user's message already contains all the above information, proceed directly to modeling without asking questions.

Format answers in clean Markdown: short paragraphs, **bold** for key figures, and "- " bullet lists for breakdowns. Be concise and direct. Assume a sophisticated user — no beginner hand-holding. When you reference numbers, ground them in the financial context provided below. If the context is empty or insufficient to answer precisely, say so and state what data would be needed.

If the context includes a "How To Brief This User (personalization)" section, treat it as authoritative guidance on tone, length, and what to emphasize or downplay.

When the financial context contains both a "Current year projection" and a "Salary profile", the current-year projection is the authoritative income and expense figure — it blends YTD actuals with forward salary and budget forecasts. The salary profile provides gross salary and tax breakdown for reference only. Never quote annual net take-home derived from the salary profile alone; use the current-year projected net instead.`

// Low-level call into the ai-chat API route. Returns the assistant text, the
// raw content blocks, and stop_reason so callers can drive multi-step tool use.
// `systemExtra` appends to the system prompt (e.g. a tool-specific instruction
// and the user's category names). Returns { status, text, content, stop_reason }.
export async function invokeAIChat({ messages, tools, context, yearTxns, systemExtra = '', maxTokens = 1024 }) {
  const brief = buildContextBrief(context, yearTxns)
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

  let res
  try {
    res = await fetch('/api/ai-chat', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    return {
      status: 'error',
      text:
        `Could not reach the AI service: ${err.message}. ` +
        `Make sure the ai-chat API route is deployed and the ANTHROPIC_API_KEY ` +
        `env var is set (see app/api/ai-chat/route.js).`,
    }
  }

  let data = null
  try {
    data = await res.json()
  } catch {}

  if (!res.ok) {
    const message = data?.error || res.statusText || `HTTP ${res.status}`
    return {
      status: 'error',
      text:
        `Could not reach the AI service: ${message}. ` +
        `Make sure the ai-chat API route is deployed and the ANTHROPIC_API_KEY ` +
        `env var is set (see app/api/ai-chat/route.js).`,
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
export async function sendAIMessage({ prompt, messages, context, yearTxns }) {
  const convo = Array.isArray(messages) && messages.length
    ? messages.map(m => ({ role: m.role, content: m.content }))
    : [{ role: 'user', content: prompt }]

  const res = await invokeAIChat({ messages: convo, context, yearTxns })
  return { status: res.status, text: res.text }
}

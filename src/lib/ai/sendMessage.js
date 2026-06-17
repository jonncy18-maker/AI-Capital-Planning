// Single seam for AI command-bar calls.
//
// Routes through the `ai-chat` Supabase Edge Function (supabase/functions/ai-chat),
// which holds the Anthropic key server-side. The browser never sees the key.
// supabase.functions.invoke automatically attaches the signed-in user's JWT.

import { supabase } from '../supabase.js'
import { buildContextBrief } from './contextLoader.js'

const SYSTEM_PROMPT = `You are the assistant inside the AI Capital Planning OS — a forward-looking personal capital planning and scenario decision engine (not a budgeting or reporting app).

You help the user reason through capital allocation decisions against their actual financial reality: committed expenses, known future events, long-term obligations, cash-flow timing, and wealth trajectory.

You can help the user think through scenario planning questions such as "what if I book a $5,000 cruise in Q3?" or "what happens if I increase giving by $500/month?". When asked, describe the scenario in terms of categories, months, years, and delta amounts so the user can enter it manually or replicate it in the Scenario Planner module.

Be concise and direct. Assume a sophisticated user — no beginner hand-holding. When you reference numbers, ground them in the financial context provided below. If the context is empty or insufficient to answer precisely, say so and state what data would be needed.`

export async function sendAIMessage({ prompt, context }) {
  const brief = buildContextBrief(context)
  const system = `${SYSTEM_PROMPT}\n\n${brief}`

  const { data, error } = await supabase.functions.invoke('ai-chat', {
    body: {
      system,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 1024,
    },
  })

  if (error) {
    // Edge Function not deployed yet, or network/auth failure.
    return {
      status: 'error',
      text:
        `Could not reach the AI service: ${error.message}. ` +
        `Make sure the ai-chat Edge Function is deployed and the ANTHROPIC_API_KEY ` +
        `secret is set (see supabase/functions/ai-chat/README.md).`,
    }
  }
  if (data?.error) {
    return { status: 'error', text: data.error }
  }

  return { status: 'ok', text: data?.text ?? '' }
}
